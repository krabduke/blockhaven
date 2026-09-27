// The live world on the main thread: loaded chunks, block edits and their
// side effects (light, fluids, falling blocks, support), random ticks,
// block entities, and scheduling chunk generation and meshing.

import { B, BLOCKS, EMIT, LIGHT_OPACITY, RAIL_DIRS, RAIL_EXITS, SOLID, isLeaves, isLog, isRail, type RailDir } from '../blocks';
import { SMELTING } from '../crafting';
import { BREW_TICKS, brewFuel, brewResult } from '../brewing';
import { Inventory, type Slot } from '../inventory';
import { coloredItem, itemDef, type ItemStack } from '../items';
import { mulberry32 } from '../noise';
import { loadChunk, saveChunk } from '../storage';
import { CH, CS, Chunk, SUBS, VOLUME, chunkKey, idx } from './chunk';
import { LightEngine, type ChunkSource } from './light';
import { P, pidx, type SubMesh } from './mesher';
import type { WorkerPool } from './pool';
import type { Spawn } from './worldgen';

export interface ChestBE { kind: 'chest'; inv: Inventory }
export interface FurnaceBE { kind: 'furnace'; inv: Inventory; burn: number; burnMax: number; cook: number }
export interface SignBE { kind: 'sign'; lines: string[] }
/** Slots: 0 ingredient, 1 fuel, 2-4 bottles. */
export interface BrewingBE { kind: 'brewing'; inv: Inventory; fuel: number; brew: number }
export type BlockEntity = ChestBE | FurnaceBE | SignBE | BrewingBE;

const HORIZ: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Dungeon chest loot. */
function fillLoot(inv: Inventory, rand: () => number): void {
  const table: [number, number, number, number][] = [
    // id, min, max, weight
    [258, 1, 4, 10], [273, 1, 3, 15], [277, 2, 4, 10], [270, 2, 6, 15], [261, 1, 4, 12],
    [259, 1, 3, 5], [260, 1, 2, 2], [275, 1, 1, 8], [284, 2, 8, 10], [286, 2, 6, 10],
    [289, 1, 2, 5], [262, 1, 3, 8], [294, 1, 4, 8], [293, 1, 3, 6], [352, 1, 1, 1], [362, 1, 1, 1],
  ];
  const total = table.reduce((a, t) => a + t[3], 0);
  const rolls = 4 + Math.floor(rand() * 5);
  for (let r = 0; r < rolls; r++) {
    let pick = rand() * total, k = 0;
    while (pick > table[k][3]) { pick -= table[k][3]; k++; }
    const [id, lo, hi] = table[k];
    // Scatter stacks through the chest; if the slot is taken, use the next free one (none are lost).
    let slot = Math.floor(rand() * 27);
    for (let t = 0; t < 27 && inv.slots[slot]; t++) slot = (slot + 1) % 27;
    if (!inv.slots[slot]) inv.slots[slot] = { id, count: lo + Math.floor(rand() * (hi - lo + 1)) };
  }
}
const DIRS6: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Blocks a fluid washes away (dropping them). */
function washable(id: number): boolean {
  const d = BLOCKS[id];
  return id === 0 || (!d.solid && !d.fluid && !d.waterlogged && (d.shape === 'cross' || d.shape === 'torch'));
}

export class World implements ChunkSource {
  readonly chunks = new Map<string, Chunk>();
  readonly light: LightEngine;
  readonly blockEntities = new Map<string, BlockEntity>();
  time = 6000; // 0 = sunrise-ish, 6000 = noon, 18000 = midnight (24000 per day)
  weather: 'clear' | 'rain' | 'thunder' = 'clear';
  weatherTimer = 12000 + Math.floor(Math.random() * 60000);
  /** Positions of monster cages in loaded chunks. */
  readonly spawners = new Set<string>();
  tickCount = 0;

  onSubMesh: (cx: number, sy: number, cz: number, mesh: SubMesh | null) => void = () => {};
  onChunkUnload: (cx: number, cz: number) => void = () => {};
  onDrop: (x: number, y: number, z: number, stack: ItemStack) => void = () => {};
  onEvent: (kind: 'fizz' | 'break' | 'brewed', x: number, y: number, z: number, id: number) => void = () => {};
  /** Creatures a freshly generated chunk wants spawned (villagers, guardians). */
  onSpawns: (spawns: Spawn[]) => void = () => {};
  /** TNT set off by power. */
  onIgnite: (x: number, y: number, z: number) => void = () => {};
  /** Chunks whose generated creatures have already been spawned. */
  spawnedChunks = new Set<string>();
  dimension: 'overworld' | 'ember' = 'overworld';

  private genPending = new Set<string>();
  private meshSeq = new Map<string, number>();
  private meshInFlight = 0;
  private scheduled = new Map<string, { x: number; y: number; z: number; due: number }>();
  /** Modified chunks unloaded this session, kept until they reach IndexedDB. */
  private stash = new Map<string, { blocks: Uint8Array; meta: Uint8Array }>();
  private rand = mulberry32(12345);
  private lastChunk: Chunk | undefined;
  private center: [number, number] = [0, 0];

  constructor(
    readonly worldId: string,
    readonly seed: number,
    private pool: WorkerPool,
    private savedKeys: Set<string>,
  ) {
    this.light = new LightEngine(this);
  }

  // ---------- Access ----------
  getChunk(cx: number, cz: number): Chunk | undefined {
    const l = this.lastChunk;
    if (l && l.cx === cx && l.cz === cz) return l;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) this.lastChunk = c;
    return c;
  }

  isLoaded(x: number, z: number): boolean {
    return !!this.getChunk(x >> 4, z >> 4);
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= CH) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.blocks[idx(x & 15, y, z & 15)] : 0;
  }

  /** Like getBlock but unloaded space counts as solid stone (so players don't fall into the void). */
  getBlockPhysics(x: number, y: number, z: number): number {
    if (y < 0) return B.bedrock;
    if (y >= CH) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.blocks[idx(x & 15, y, z & 15)] : B.stone;
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= CH) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.meta[idx(x & 15, y, z & 15)] : 0;
  }

  getSky(x: number, y: number, z: number): number { return this.light.getLight(x, y, z, 4); }
  getBlockLight(x: number, y: number, z: number): number { return this.light.getLight(x, y, z, 0); }

  setMeta(x: number, y: number, z: number, m: number): void {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || y < 0 || y >= CH) return;
    c.meta[idx(x & 15, y, z & 15)] = m;
    c.modified = true;
    this.markDirty(x, y, z);
  }

  /** While true, setBlock skips neighbour reactions (used to place multi-block structures in one go). */
  private quiet = false;

  /** Place or remove a block with all side effects. */
  setBlock(x: number, y: number, z: number, id: number, meta = 0): boolean {
    if (y < 0 || y >= CH) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return false;
    const i = idx(x & 15, y, z & 15);
    const old = c.blocks[i];
    if (old === id && c.meta[i] === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    c.modified = true;
    c.version++;
    if (old === B.spawner) this.spawners.delete(`${x},${y},${z}`);
    if (id === B.spawner) this.spawners.add(`${x},${y},${z}`);
    if (old !== id) {
      const key = `${x},${y},${z}`;
      if (this.blockEntities.has(key) && id !== B.furnace && id !== B.furnace_lit && id !== B.chest && id !== B.sign && id !== B.brewing_stand) {
        const be = this.blockEntities.get(key)!;
        if (be.kind !== 'sign') for (const s of be.inv.slots) if (s) this.onDrop(x + 0.5, y + 0.5, z + 0.5, s);
        this.blockEntities.delete(key);
      }
      if (LIGHT_OPACITY[old] !== LIGHT_OPACITY[id] || EMIT[old] !== EMIT[id]) this.light.update(x, y, z);
    }
    this.markDirty(x, y, z);
    if (this.quiet) return true;
    this.schedule(x, y, z, 1);
    for (const [dx, dy, dz] of DIRS6) this.neighborChanged(x + dx, y + dy, z + dz);
    return true;
  }

  private markDirty(x: number, y: number, z: number): void {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    const lx = x & 15, lz = z & 15, sy = y >> 4, ly = y & 15;
    c.dirty.add(sy);
    if (ly === 0 && sy > 0) c.dirty.add(sy - 1);
    if (ly === 15 && sy < SUBS - 1) c.dirty.add(sy + 1);
    const nx = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const nz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    const mark = (dx: number, dz: number) => {
      const n = this.getChunk(c.cx + dx, c.cz + dz);
      if (!n) return;
      n.dirty.add(sy);
      if (ly === 0 && sy > 0) n.dirty.add(sy - 1);
      if (ly === 15 && sy < SUBS - 1) n.dirty.add(sy + 1);
    };
    if (nx) mark(nx, 0);
    if (nz) mark(0, nz);
    if (nx && nz) mark(nx, nz);
  }

  onLightChanged(x: number, y: number, z: number): void {
    this.markDirty(x, y, z);
  }

  // ---------- Block rules ----------
  canStay(x: number, y: number, z: number, id: number, meta: number): boolean {
    const d = BLOCKS[id];
    if (!d.needsSupport) return true;
    const below = this.getBlock(x, y - 1, z);
    switch (d.shape) {
      case 'cross':
        if (id === B.wheat || id === B.carrots) return below === B.farmland;
        if (id === B.dead_bush) return below === B.sand || below === B.dirt || below === B.grass;
        if (id === B.sugar_cane) {
          if (below === B.sugar_cane) return true;
          if (below !== B.grass && below !== B.dirt && below !== B.sand) return false;
          return HORIZ.some(([dx, dz]) => this.getBlock(x + dx, y - 1, z + dz) === B.water);
        }
        if (id === B.red_mushroom || id === B.brown_mushroom) return SOLID[below] === 1;
        if (id === B.dry_grass) return below === B.sand || below === B.red_sand || below === B.coarse_dirt || below === B.grass || below === B.dirt;
        if (id === B.bamboo) return below === B.bamboo || below === B.grass || below === B.dirt || below === B.sand || below === B.loam;
        if (id === B.cattail) return below === B.grass || below === B.dirt || below === B.mud || below === B.sand || below === B.clay;
        return below === B.grass || below === B.dirt || below === B.snowy_grass || below === B.farmland || below === B.moss_block || below === B.loam || below === B.coarse_dirt || below === B.mud;
      case 'cactus':
        return below === B.cactus || below === B.sand;
      case 'torch': {
        const off = [[0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][meta & 7] ?? [0, -1, 0];
        const s = this.getBlock(x + off[0], y + off[1], z + off[2]);
        return SOLID[s] === 1 && BLOCKS[s].shape === 'cube';
      }
      case 'door':
        if (meta & 8) return this.getBlock(x, y - 1, z) === B.door;
        return SOLID[below] === 1 && BLOCKS[below].shape === 'cube' && this.getBlock(x, y + 1, z) === B.door;
      case 'bed':
        return SOLID[below] === 1;
      case 'lantern':
        return meta & 1 ? SOLID[this.getBlock(x, y + 1, z)] === 1 || this.getBlock(x, y + 1, z) === B.fence : SOLID[below] === 1;
      case 'wire':
      case 'plate':
      case 'cake':
      case 'carpet':
      case 'rail':
        return SOLID[below] === 1 && below !== B.lily_pad;
      case 'button': {
        const off = [[0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][meta & 7] ?? [0, -1, 0];
        return SOLID[this.getBlock(x + off[0], y + off[1], z + off[2])] === 1;
      }
      case 'sign': {
        if (!(meta & 4)) return SOLID[below] === 1;
        const off = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]][meta & 3];
        return SOLID[this.getBlock(x + off[0], y, z + off[2])] === 1;
      }
      case 'flat':
        return below === B.water;
      case 'layer':
        return SOLID[below] === 1 && BLOCKS[below].shape === 'cube';
      default:
        return true;
    }
  }

  // ---------- Rails ----------
  /** Rail track shape at a position (0-9), or -1 if there's no rail. */
  railShape(x: number, y: number, z: number): number {
    const id = this.getBlock(x, y, z);
    if (!isRail(id)) return -1;
    const m = this.getMeta(x, y, z);
    return id === B.powered_rail ? m & 7 : m & 15;
  }

  /** Directions from this rail to rails it could join (level, one up, or one down). */
  private railLinks(x: number, y: number, z: number): { dir: RailDir; up: boolean }[] {
    const out: { dir: RailDir; up: boolean }[] = [];
    for (const dir of ['n', 's', 'e', 'w'] as RailDir[]) {
      const [dx, dz] = RAIL_DIRS[dir];
      if (isRail(this.getBlock(x + dx, y, z + dz)) || isRail(this.getBlock(x + dx, y - 1, z + dz))) out.push({ dir, up: false });
      else if (isRail(this.getBlock(x + dx, y + 1, z + dz))) out.push({ dir, up: true });
    }
    return out;
  }

  /** How many ends of a rail's current shape lead to another rail. */
  private railEndsUsed(x: number, y: number, z: number): number {
    const s = this.railShape(x, y, z);
    if (s < 0) return 0;
    const links = this.railLinks(x, y, z).map((l) => l.dir);
    const e = RAIL_EXITS[s];
    return (links.includes(e.a) ? 1 : 0) + (links.includes(e.b) ? 1 : 0);
  }

  /**
   * Shape a rail to join its neighbours: straight, sloped toward a rail one block up, or (plain
   * rails only) curved between two perpendicular neighbours. Neighbours with a free end then
   * turn to join it, so laying track just works.
   */
  fitRail(x: number, y: number, z: number, refitNeighbours = true): void {
    const id = this.getBlock(x, y, z);
    if (!isRail(id)) return;
    const powered = id === B.powered_rail;
    const links = this.railLinks(x, y, z);
    const has = (d: RailDir) => links.some((l) => l.dir === d);
    const up = (d: RailDir) => links.some((l) => l.dir === d && l.up);
    let shape = this.railShape(x, y, z);
    const ns = has('n') || has('s'), ew = has('e') || has('w');
    if (ns && ew && !powered) shape = has('s') && has('e') ? 6 : has('s') && has('w') ? 7 : has('n') && has('w') ? 8 : 9;
    else if (ns) shape = up('n') ? 4 : up('s') ? 5 : 0;
    else if (ew) shape = up('e') ? 2 : up('w') ? 3 : 1;
    const m = this.getMeta(x, y, z);
    const nm = powered ? (m & 8) | shape : shape;
    if (nm !== m) this.setMetaQuiet(x, y, z, nm);
    if (!refitNeighbours) return;
    for (const l of links) {
      const [dx, dz] = RAIL_DIRS[l.dir];
      for (const dy of [0, 1, -1]) {
        if (!isRail(this.getBlock(x + dx, y + dy, z + dz))) continue;
        if (this.railEndsUsed(x + dx, y + dy, z + dz) < 2) this.fitRail(x + dx, y + dy, z + dz, false);
        break;
      }
    }
  }

  // ---------- Power (spark dust wiring) ----------
  /** Strength a block emits into its neighbours (levers, buttons, plates). */
  private sourcePower(x: number, y: number, z: number): number {
    const id = this.getBlock(x, y, z);
    if (id === B.lever || id === B.button) return this.getMeta(x, y, z) & 8 ? 15 : 0;
    if (id === B.pressure_plate) return this.getMeta(x, y, z) & 1 ? 15 : 0;
    return 0;
  }

  /** Is the block at (x,y,z) receiving power from a source, a solid block a source is attached to, or live wire? */
  isPowered(x: number, y: number, z: number): boolean {
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (this.sourcePower(nx, ny, nz) > 0) return true;
      const nid = this.getBlock(nx, ny, nz);
      if (nid === B.wire && (this.getMeta(nx, ny, nz) & 15) > 0) return true;
      // Power passes through a solid block from a lever/button attached to it or a plate on top.
      if (SOLID[nid] && BLOCKS[nid].shape === 'cube') {
        for (const [ex, ey, ez] of DIRS6) {
          const sx = nx + ex, sy = ny + ey, sz = nz + ez;
          if (sx === x && sy === y && sz === z) continue;
          const sid = this.getBlock(sx, sy, sz);
          if (sid === B.lever || sid === B.button) {
            const m = this.getMeta(sx, sy, sz);
            const off = [[0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][m & 7] ?? [0, -1, 0];
            if ((m & 8) && sx + off[0] === nx && sy + off[1] === ny && sz + off[2] === nz) return true;
          }
          if (sid === B.pressure_plate && ey === 1 && (this.getMeta(sx, sy, sz) & 1)) return true;
        }
      }
    }
    return false;
  }

  /** Recompute wire networks and consumers around a changed position. */
  updatePower(x: number, y: number, z: number): void {
    // 1. Collect connected wire near the change.
    const wires = new Map<string, [number, number, number]>();
    const queue: [number, number, number][] = [];
    const consider = (a: number, b: number, c: number) => {
      const k = `${a},${b},${c}`;
      if (!wires.has(k) && this.getBlock(a, b, c) === B.wire) { wires.set(k, [a, b, c]); queue.push([a, b, c]); }
    };
    for (let dy = -2; dy <= 2; dy++) for (const [dx, , dz] of [[0, 0, 0], ...DIRS6]) consider(x + dx, y + dy, z + dz);
    while (queue.length && wires.size < 4096) {
      const [a, b, c] = queue.pop()!;
      for (const [dx, dz] of HORIZ) for (const dy of [-1, 0, 1]) consider(a + dx, b + dy, c + dz);
    }
    // 2. Flood power levels from sources, losing one per wire.
    const level = new Map<string, number>();
    const frontier: [string, number][] = [];
    for (const [k, [a, b, c]] of wires) {
      let s = 0;
      for (const [dx, dy, dz] of DIRS6) s = Math.max(s, this.sourcePower(a + dx, b + dy, c + dz));
      // A source attached to the block under the wire powers it too.
      if (this.isPoweredBlockBelow(a, b, c)) s = 15;
      if (s > 0) { level.set(k, s); frontier.push([k, s]); }
    }
    while (frontier.length) {
      frontier.sort((p, q) => q[1] - p[1]);
      const [k, s] = frontier.shift()!;
      if ((level.get(k) ?? 0) > s || s <= 1) continue;
      const [a, b, c] = wires.get(k)!;
      for (const [dx, dz] of HORIZ) for (const dy of [-1, 0, 1]) {
        const nk = `${a + dx},${b + dy},${c + dz}`;
        if (!wires.has(nk)) continue;
        if ((level.get(nk) ?? 0) < s - 1) { level.set(nk, s - 1); frontier.push([nk, s - 1]); }
      }
    }
    const touched = new Set<string>();
    for (const [k, [a, b, c]] of wires) {
      const want = level.get(k) ?? 0;
      if ((this.getMeta(a, b, c) & 15) !== want) this.setMetaQuiet(a, b, c, want);
      for (const [dx, dy, dz] of DIRS6) touched.add(`${a + dx},${b + dy},${c + dz}`);
    }
    for (const [dx, dy, dz] of [[0, 0, 0], ...DIRS6]) {
      touched.add(`${x + dx},${y + dy},${z + dz}`);
      for (const [ex, ey, ez] of DIRS6) touched.add(`${x + dx + ex},${y + dy + ey},${z + dz + ez}`);
    }
    // 3. Consumers react to their new power state.
    for (const k of touched) {
      const [a, b, c] = k.split(',').map(Number);
      const id = this.getBlock(a, b, c);
      if (id === B.lamp || id === B.lamp_on) {
        const want = this.isPowered(a, b, c) ? B.lamp_on : B.lamp;
        if (want !== id) this.setBlock(a, b, c, want);
      } else if (id === B.powered_rail) {
        const m = this.getMeta(a, b, c), on = this.isPowered(a, b, c) || this.isPowered(a, b - 1, c);
        if (((m & 8) !== 0) !== on) this.setMetaQuiet(a, b, c, (m & 7) | (on ? 8 : 0));
      } else if (id === B.tnt && this.isPowered(a, b, c)) {
        this.setBlock(a, b, c, 0);
        this.onIgnite(a, b, c);
      } else if (id === B.door || id === B.trapdoor || id === B.fence_gate) {
        const m = this.getMeta(a, b, c);
        if (id === B.door && (m & 8)) continue; // the bottom half decides
        const powered = this.isPowered(a, b, c) || (id === B.door && this.isPowered(a, b + 1, c));
        const was = (m & 16) !== 0;
        if (powered === was) continue;
        const nm = (m & ~(4 | 16)) | (powered ? 4 | 16 : 0);
        this.setMetaQuiet(a, b, c, nm);
        if (id === B.door && this.getBlock(a, b + 1, c) === B.door) this.setMetaQuiet(a, b + 1, c, (this.getMeta(a, b + 1, c) & ~4) | (powered ? 4 : 0));
      }
    }
  }

  private isPoweredBlockBelow(a: number, b: number, c: number): boolean {
    const below = this.getBlock(a, b - 1, c);
    if (!SOLID[below]) return false;
    for (const [dx, dy, dz] of DIRS6) {
      const sx = a + dx, sy = b - 1 + dy, sz = c + dz;
      const sid = this.getBlock(sx, sy, sz);
      if (sid !== B.lever && sid !== B.button) continue;
      const m = this.getMeta(sx, sy, sz);
      const off = [[0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][m & 7] ?? [0, -1, 0];
      if ((m & 8) && sx + off[0] === a && sy + off[1] === b - 1 && sz + off[2] === c) return true;
    }
    return false;
  }

  /** Change meta without triggering neighbour updates (used by the power system). */
  private setMetaQuiet(x: number, y: number, z: number, m: number): void {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || y < 0 || y >= CH) return;
    c.meta[idx(x & 15, y, z & 15)] = m;
    c.modified = true;
    this.markDirty(x, y, z);
  }

  /** Press a button: it pops back out after a second. */
  pressButton(x: number, y: number, z: number): void {
    const m = this.getMeta(x, y, z);
    if (m & 8) return;
    this.setMetaQuiet(x, y, z, m | 8);
    this.updatePower(x, y, z);
    this.schedule(x, y, z, 20);
  }

  setPlate(x: number, y: number, z: number, pressed: boolean): void {
    if (this.getBlock(x, y, z) !== B.pressure_plate) return;
    const m = this.getMeta(x, y, z);
    if (((m & 1) !== 0) === pressed) return;
    this.setMetaQuiet(x, y, z, pressed ? 1 : 0);
    this.updatePower(x, y, z);
  }

  toggleLever(x: number, y: number, z: number): void {
    this.setMetaQuiet(x, y, z, this.getMeta(x, y, z) ^ 8);
    this.updatePower(x, y, z);
  }

  // ---------- Portals ----------
  /** Try to fill an obsidian frame around (x, y, z) with an Ember Gate. */
  tryLightPortal(x: number, y: number, z: number): boolean {
    for (const axis of [0, 1]) {
      const [ax, az] = axis === 0 ? [1, 0] : [0, 1];
      // Walk down to the frame bottom and left to the frame side.
      let by = y;
      while (by > y - 22 && this.getBlock(x, by - 1, z) !== B.obsidian) { if (!this.portalAir(x, by - 1, z)) break; by--; }
      if (this.getBlock(x, by - 1, z) !== B.obsidian) continue;
      let lx = x, lz = z;
      while (Math.abs(lx - x) + Math.abs(lz - z) < 22 && this.getBlock(lx - ax, by, lz - az) !== B.obsidian) { if (!this.portalAir(lx - ax, by, lz - az)) break; lx -= ax; lz -= az; }
      if (this.getBlock(lx - ax, by, lz - az) !== B.obsidian) continue;
      let width = 0;
      while (width < 22 && this.portalAir(lx + ax * width, by, lz + az * width)) width++;
      if (width < 2 || width > 21 || this.getBlock(lx + ax * width, by, lz + az * width) !== B.obsidian) continue;
      let height = 0;
      while (height < 22 && this.portalAir(lx, by + height, lz)) height++;
      if (height < 3 || height > 21) continue;
      let ok = true;
      for (let u = 0; u < width && ok; u++) {
        if (this.getBlock(lx + ax * u, by - 1, lz + az * u) !== B.obsidian) ok = false;
        if (this.getBlock(lx + ax * u, by + height, lz + az * u) !== B.obsidian) ok = false;
        for (let v = 0; v < height && ok; v++) if (!this.portalAir(lx + ax * u, by + v, lz + az * u)) ok = false;
      }
      for (let v = 0; v < height && ok; v++) {
        if (this.getBlock(lx - ax, by + v, lz - az) !== B.obsidian) ok = false;
        if (this.getBlock(lx + ax * width, by + v, lz + az * width) !== B.obsidian) ok = false;
      }
      if (!ok) continue;
      this.quiet = true;
      for (let u = 0; u < width; u++) for (let v = 0; v < height; v++) this.setBlock(lx + ax * u, by + v, lz + az * u, B.portal, axis);
      this.quiet = false;
      return true;
    }
    return false;
  }

  private portalAir(x: number, y: number, z: number): boolean {
    const b = this.getBlock(x, y, z);
    return b === 0 || b === B.fire;
  }

  /** Nearest Ember Gate block within `r` blocks horizontally, among loaded chunks. */
  findPortal(x: number, y: number, z: number, r: number): [number, number, number] | null {
    let best: [number, number, number] | null = null, bd = Infinity;
    for (const c of this.chunks.values()) {
      const cx0 = c.cx * 16, cz0 = c.cz * 16;
      if (cx0 + 16 < x - r || cx0 > x + r || cz0 + 16 < z - r || cz0 > z + r) continue;
      for (let i = 0; i < VOLUME; i++) {
        if (c.blocks[i] !== B.portal) continue;
        const px = cx0 + (i & 15), py = i >> 8, pz = cz0 + ((i >> 4) & 15);
        if (this.getBlock(px, py - 1, pz) === B.portal) continue; // bottom row only
        const d = Math.hypot(px - x, (py - y) * 0.5, pz - z);
        if (d < bd && Math.abs(px - x) <= r && Math.abs(pz - z) <= r) { bd = d; best = [px, py, pz]; }
      }
    }
    return best;
  }

  /** Build a fresh gate (with a small platform) at the given spot. */
  buildPortal(x: number, y: number, z: number): void {
    for (let u = -1; u <= 2; u++) for (let v = -1; v <= 3; v++) {
      const edge = u === -1 || u === 2 || v === -1 || v === 3;
      this.setBlock(x + u, y + v, z, edge ? B.obsidian : 0);
    }
    for (let u = -1; u <= 2; u++) for (const dz of [-1, 1]) {
      if (!SOLID[this.getBlock(x + u, y - 1, z + dz)]) this.setBlock(x + u, y - 1, z + dz, B.obsidian);
      for (let v = 0; v <= 2; v++) this.setBlock(x + u, y + v, z + dz, 0);
    }
    this.quiet = true;
    for (let u = 0; u <= 1; u++) for (let v = 0; v <= 2; v++) this.setBlock(x + u, y + v, z, B.portal, 0);
    this.quiet = false;
  }

  /** Break a block as if mined, dropping what it would drop. */
  breakBlock(x: number, y: number, z: number, drop: boolean): void {
    const id = this.getBlock(x, y, z);
    if (id === 0) return;
    const meta = this.getMeta(x, y, z);
    this.onEvent('break', x, y, z, id);
    if (drop) {
      const d = BLOCKS[id];
      let res = d.drop ? d.drop(this.rand()) : null;
      // Coloured blocks drop the item of their colour.
      if (res && (id === B.carpet || id === B.banner) && res[0] === id) res = [coloredItem(id, (meta >> (d.metaShift ?? 0)) & 15), 1];
      if (res) this.onDrop(x + 0.5, y + 0.5, z + 0.5, { id: res[0], count: res[1] });
      if (id === B.wheat) {
        if (meta >= 7) this.onDrop(x + 0.5, y + 0.5, z + 0.5, { id: 274, count: 1 });
        this.onDrop(x + 0.5, y + 0.5, z + 0.5, { id: 277, count: meta >= 7 ? 1 + Math.floor(this.rand() * 3) : 1 });
      }
      if (id === B.carrots) this.onDrop(x + 0.5, y + 0.5, z + 0.5, { id: 293, count: meta >= 7 ? 2 + Math.floor(this.rand() * 3) : 1 });
    }
    // Two-block structures remove their other half.
    if (id === B.door) {
      const oy = meta & 8 ? y - 1 : y + 1;
      this.setBlock(x, y, z, 0);
      if (this.getBlock(x, oy, z) === B.door) this.setBlock(x, oy, z, 0);
      return;
    }
    if (BLOCKS[id].waterlogged) {
      // Underwater plants leave water behind.
      this.setBlock(x, y, z, B.water, 0);
      return;
    }
    if (id === B.bed) {
      const other = this.bedOther(x, y, z, meta);
      this.setBlock(x, y, z, 0);
      if (this.getBlock(other[0], y, other[1]) === B.bed) this.setBlock(other[0], y, other[1], 0);
      return;
    }
    this.setBlock(x, y, z, 0);
  }

  bedOther(x: number, _y: number, z: number, meta: number): [number, number] {
    const f = meta & 3; // direction foot -> head
    const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][f];
    return meta & 8 ? [x - dx, z - dz] : [x + dx, z + dz];
  }

  private neighborChanged(x: number, y: number, z: number): void {
    if (y < 0 || y >= CH) return;
    const id = this.getBlock(x, y, z);
    if (id === 0) return;
    const d = BLOCKS[id];
    if (d.needsSupport && !this.canStay(x, y, z, id, this.getMeta(x, y, z))) {
      this.breakBlock(x, y, z, true);
      return;
    }
    if (d.fluid) this.schedule(x, y, z, id === B.lava ? 30 : 5);
    if (id === B.sand || id === B.gravel) this.schedule(x, y, z, 2);
    if (id === B.portal && !this.portalIntact(x, y, z)) { this.setBlock(x, y, z, 0); return; }
    if (id === B.fire) this.schedule(x, y, z, 30 + Math.floor(this.rand() * 10));
    if (id === B.wire || id === B.lamp || id === B.lamp_on || id === B.door || id === B.trapdoor || id === B.tnt || id === B.fence_gate || id === B.powered_rail) this.schedule(x, y, z, 1);
  }

  private portalIntact(x: number, y: number, z: number): boolean {
    const axis = this.getMeta(x, y, z) & 1;
    const [ax, az] = axis === 0 ? [1, 0] : [0, 1];
    for (const [dx, dy, dz] of [[ax, 0, az], [-ax, 0, -az], [0, 1, 0], [0, -1, 0]]) {
      const b = this.getBlock(x + dx, y + dy, z + dz);
      if (b !== B.portal && b !== B.obsidian) return false;
    }
    return true;
  }

  schedule(x: number, y: number, z: number, delay: number): void {
    const key = `${x},${y},${z}`;
    const due = this.tickCount + delay;
    const cur = this.scheduled.get(key);
    if (!cur || cur.due > due) this.scheduled.set(key, { x, y, z, due });
  }

  private scheduledTick(x: number, y: number, z: number): void {
    const id = this.getBlock(x, y, z);
    if (id === B.button && (this.getMeta(x, y, z) & 8)) {
      this.setMetaQuiet(x, y, z, this.getMeta(x, y, z) & ~8);
      this.updatePower(x, y, z);
      return;
    }
    if (id === B.fire) { this.fireTick(x, y, z); return; }
    if (id === B.wire || id === B.lamp || id === B.lamp_on || id === B.door || id === B.trapdoor || id === B.tnt || id === B.fence_gate || id === B.powered_rail) { this.updatePower(x, y, z); return; }
    if (id === B.water && this.dimension === 'ember') { this.setBlock(x, y, z, 0); this.onEvent('fizz', x, y, z, id); return; }
    if (id === 0) {
      // A block was removed: wires next to it may lose power.
      for (const [dx, dy, dz] of DIRS6) if (this.getBlock(x + dx, y + dy, z + dz) === B.wire) { this.updatePower(x, y, z); break; }
    }
    if (id === B.water || id === B.lava) this.fluidTick(x, y, z, id);
    else if (id === B.sand || id === B.gravel) {
      const below = this.getBlock(x, y - 1, z);
      if (y > 0 && (below === 0 || BLOCKS[below].fluid || washable(below)) && this.isLoaded(x, z)) {
        if (washable(below) && below !== 0) this.breakBlock(x, y - 1, z, true);
        this.setBlock(x, y, z, 0);
        this.setBlock(x, y - 1, z, id);
      }
    }
  }

  private fluidTick(x: number, y: number, z: number, id: number): void {
    const lava = id === B.lava;
    const other = lava ? B.water : B.lava;
    const step = lava ? 2 : 1;
    let meta = this.getMeta(x, y, z);

    // Lava meeting water hardens.
    if (lava) {
      const touching = HORIZ.some(([dx, dz]) => this.getBlock(x + dx, y, z + dz) === other) || this.getBlock(x, y + 1, z) === other;
      if (touching) {
        this.setBlock(x, y, z, (meta & 15) === 0 ? B.obsidian : B.cobblestone);
        this.onEvent('fizz', x, y, z, id);
        return;
      }
    }

    const level = meta & 7, falling = (meta & 8) !== 0;
    const isSource = level === 0 && !falling;
    if (!isSource) {
      let best = 99, sources = 0;
      for (const [dx, dz] of HORIZ) {
        if (this.getBlock(x + dx, y, z + dz) !== id) continue;
        const nm = this.getMeta(x + dx, y, z + dz);
        const nl = nm & 8 ? 0 : nm & 7;
        if ((nm & 15) === 0) sources++;
        best = Math.min(best, nl + step);
      }
      let next: number;
      const below = this.getBlock(x, y - 1, z);
      if (!lava && sources >= 2 && (SOLID[below] || (below === id && (this.getMeta(x, y - 1, z) & 15) === 0))) next = 0;
      else if (this.getBlock(x, y + 1, z) === id) next = 8;
      else if (best <= 7) next = best;
      else next = -1;
      if (next < 0) { this.setBlock(x, y, z, 0); return; }
      if (next !== meta) { this.setBlock(x, y, z, id, next); meta = next; }
    }

    // Flow down first.
    if (y > 0) {
      const below = this.getBlock(x, y - 1, z);
      if (below === other) {
        this.setBlock(x, y - 1, z, lava ? B.stone : ((this.getMeta(x, y - 1, z) & 15) === 0 ? B.obsidian : B.cobblestone));
        this.onEvent('fizz', x, y - 1, z, id);
        return;
      }
      if (washable(below)) {
        if (below !== 0) this.breakBlock(x, y - 1, z, true);
        this.setBlock(x, y - 1, z, id, 8);
        if (!isSource) return;
      }
      if (below === id && !isSource) return;
    }
    const spread = ((meta & 8) ? 0 : meta & 7) + step;
    if (spread > 7) return;
    for (const [dx, dz] of HORIZ) {
      const nx = x + dx, nz = z + dz;
      if (!this.isLoaded(nx, nz)) continue;
      const n = this.getBlock(nx, y, nz);
      if (n === other) {
        if (lava) { this.setBlock(nx, y, nz, (this.getMeta(nx, y, nz) & 15) === 0 ? B.stone : B.cobblestone); this.onEvent('fizz', nx, y, nz, id); }
        continue;
      }
      if (washable(n)) {
        if (n !== 0) this.breakBlock(nx, y, nz, true);
        this.setBlock(nx, y, nz, id, spread);
      } else if (n === id) {
        const nm = this.getMeta(nx, y, nz);
        if ((nm & 15) !== 0 && !(nm & 8) && (nm & 7) > spread) this.setBlock(nx, y, nz, id, spread);
      }
    }
  }

  // ---------- Fire ----------
  private fireTick(x: number, y: number, z: number): void {
    const below = this.getBlock(x, y - 1, z);
    const eternal = below === B.cinderstone || below === B.magma;
    const age = this.getMeta(x, y, z);
    const rainedOn = this.weather !== 'clear' && this.dimension === 'overworld' && this.getSky(x, y, z) >= 15;
    const fuel = DIRS6.some(([dx, dy, dz]) => BLOCKS[this.getBlock(x + dx, y + dy, z + dz)].flammable);
    if (!eternal && (rainedOn || (!fuel && !SOLID[below]) || (age > 6 && this.rand() < 0.3) || age > 15)) { this.setBlock(x, y, z, 0); return; }
    if (!eternal) this.setMetaQuiet(x, y, z, Math.min(15, age + 1 + Math.floor(this.rand() * 2)));
    // Burn and spread into flammable neighbours.
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const nid = this.getBlock(nx, ny, nz);
      if (BLOCKS[nid].flammable && this.rand() < 0.3) {
        if (nid === B.tnt) { this.setBlock(nx, ny, nz, 0); this.onIgnite(nx, ny, nz); continue; }
        this.setBlock(nx, ny, nz, this.rand() < 0.5 ? B.fire : 0);
      }
    }
    for (let k = 0; k < 2; k++) {
      const nx = x + Math.floor(this.rand() * 3) - 1, ny = y + Math.floor(this.rand() * 4) - 1, nz = z + Math.floor(this.rand() * 3) - 1;
      if (this.getBlock(nx, ny, nz) !== 0) continue;
      if (DIRS6.some(([dx, dy, dz]) => BLOCKS[this.getBlock(nx + dx, ny + dy, nz + dz)].flammable) && this.rand() < 0.3) this.setBlock(nx, ny, nz, B.fire);
    }
    this.schedule(x, y, z, 20 + Math.floor(this.rand() * 10));
  }

  // ---------- Block entities ----------
  getBlockEntity(x: number, y: number, z: number): BlockEntity | undefined {
    const key = `${x},${y},${z}`;
    let be = this.blockEntities.get(key);
    const id = this.getBlock(x, y, z);
    if (!be) {
      if (id === B.chest) {
        be = { kind: 'chest', inv: new Inventory(27) };
        const m = this.getMeta(x, y, z);
        if (m & 16) {
          fillLoot(be.inv, this.rand);
          this.setMeta(x, y, z, m & 15);
        }
      }
      else if (id === B.furnace || id === B.furnace_lit) be = { kind: 'furnace', inv: new Inventory(3), burn: 0, burnMax: 0, cook: 0 };
      else if (id === B.sign) be = { kind: 'sign', lines: ['', '', '', ''] };
      else if (id === B.brewing_stand) be = { kind: 'brewing', inv: new Inventory(5), fuel: 0, brew: 0 };
      if (be) this.blockEntities.set(key, be);
    }
    return be;
  }

  /** Brewing stands: ingredient + fuel turn bottles into potions over BREW_TICKS. */
  private tickBrewing(): void {
    for (const [key, be] of this.blockEntities) {
      if (be.kind !== 'brewing') continue;
      const [x, , z] = key.split(',').map(Number);
      if (!this.isLoaded(x, z)) continue;
      const [ing, fuel] = be.inv.slots;
      const bottles = [2, 3, 4];
      const can = !!ing && bottles.some((i) => { const b = be.inv.slots[i]; return b && brewResult(ing.id, b.id) !== undefined; });
      if (be.fuel === 0 && can && fuel && brewFuel(fuel.id)) { be.fuel = brewFuel(fuel.id); be.inv.removeOne(1); }
      if (!can || be.fuel === 0) { be.brew = 0; continue; }
      if (++be.brew < BREW_TICKS) continue;
      be.brew = 0;
      be.fuel--;
      for (const i of bottles) {
        const b = be.inv.slots[i];
        const r = b ? brewResult(ing!.id, b.id) : undefined;
        if (r !== undefined) be.inv.slots[i] = { id: r, count: 1 };
      }
      be.inv.removeOne(0);
      this.onEvent('brewed', x, 0, z, 0);
    }
  }

  private tickFurnaces(): void {
    for (const [key, be] of this.blockEntities) {
      if (be.kind !== 'furnace') continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!this.isLoaded(x, z)) continue;
      const [input, fuel, output] = be.inv.slots;
      const result = input ? SMELTING[input.id] : undefined;
      const canSmelt = result !== undefined && (!output || (output.id === result && output.count < (itemDef(result)?.maxStack ?? 64)));
      const wasBurning = be.burn > 0;
      if (be.burn > 0) be.burn--;
      if (be.burn === 0 && canSmelt && fuel && itemDef(fuel.id)?.fuelTicks) {
        be.burn = be.burnMax = itemDef(fuel.id)!.fuelTicks!;
        if (fuel.id === 278) be.inv.slots[1] = { id: 275, count: 1 };
        else be.inv.removeOne(1);
      }
      if (be.burn > 0 && canSmelt) {
        be.cook++;
        if (be.cook >= 200) {
          be.cook = 0;
          be.inv.removeOne(0);
          if (output) output.count++;
          else be.inv.slots[2] = { id: result!, count: 1 };
        }
      } else be.cook = Math.max(0, be.cook - 2);
      const burning = be.burn > 0;
      if (burning !== wasBurning) {
        const id = this.getBlock(x, y, z);
        const want = burning ? B.furnace_lit : B.furnace;
        if (id !== want && (id === B.furnace || id === B.furnace_lit)) {
          const m = this.getMeta(x, y, z);
          const saved = this.blockEntities.get(key)!;
          this.setBlock(x, y, z, want, m);
          this.blockEntities.set(key, saved);
        }
      }
    }
  }

  // ---------- Ticking ----------
  tick(px: number, py: number, pz: number, randomTicks: boolean): void {
    this.tickCount++;
    this.time = (this.time + 1) % 24000;
    if (--this.weatherTimer <= 0) {
      if (this.weather === 'clear') {
        this.weather = this.rand() < 0.25 ? 'thunder' : 'rain';
        this.weatherTimer = 12000 + Math.floor(this.rand() * 12000);
      } else {
        this.weather = 'clear';
        this.weatherTimer = 12000 + Math.floor(this.rand() * 144000);
      }
    }
    // Scheduled ticks (fluids, falling blocks), capped per tick.
    if (this.scheduled.size) {
      const due: { x: number; y: number; z: number }[] = [];
      for (const [k, s] of this.scheduled) {
        if (s.due <= this.tickCount) { due.push(s); this.scheduled.delete(k); if (due.length > 400) break; }
      }
      for (const s of due) this.scheduledTick(s.x, s.y, s.z);
    }
    this.tickFurnaces();
    this.tickBrewing();
    if (randomTicks) this.randomTicks(px, py, pz);
  }

  private randomTicks(px: number, _py: number, pz: number): void {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    const R = 4;
    for (let cz = pcz - R; cz <= pcz + R; cz++) for (let cx = pcx - R; cx <= pcx + R; cx++) {
      const c = this.getChunk(cx, cz);
      if (!c) continue;
      for (let sy = 0; sy < SUBS; sy++) {
        for (let k = 0; k < 3; k++) {
          const r = Math.floor(this.rand() * 4096);
          const lx = r & 15, lz = (r >> 4) & 15, ly = (r >> 8) + sy * 16;
          const id = c.blocks[idx(lx, ly, lz)];
          if (id === 0 || id === B.stone) continue;
          this.randomTick(cx * 16 + lx, ly, cz * 16 + lz, id);
        }
      }
    }
  }

  private randomTick(x: number, y: number, z: number, id: number): void {
    const r = this.rand();
    const above = this.getBlock(x, y + 1, z);
    const lightAbove = Math.max(this.getSky(x, y + 1, z), this.getBlockLight(x, y + 1, z));
    if (id === B.grass) {
      if (LIGHT_OPACITY[above] >= 15 || BLOCKS[above].fluid) { this.setBlock(x, y, z, B.dirt); return; }
      if (lightAbove >= 9) {
        const tx = x + Math.floor(this.rand() * 3) - 1, ty = y + Math.floor(this.rand() * 5) - 3, tz = z + Math.floor(this.rand() * 3) - 1;
        if (this.getBlock(tx, ty, tz) === B.dirt) {
          const a = this.getBlock(tx, ty + 1, tz);
          if (LIGHT_OPACITY[a] < 15 && !BLOCKS[a].fluid && this.getSky(tx, ty + 1, tz) >= 4) this.setBlock(tx, ty, tz, B.grass);
        }
      }
    } else if (id === B.wheat) {
      const m = this.getMeta(x, y, z);
      if (m < 7 && lightAbove >= 9 && r < 0.33) this.setMeta(x, y, z, m + 1);
    } else if (id === B.carrots) {
      const m = this.getMeta(x, y, z);
      if (m < 7 && lightAbove >= 9 && r < 0.33) this.setMeta(x, y, z, m + 1);
    } else if (id === B.sapling) {
      if (lightAbove >= 9 && r < 0.15) this.growTree(x, y, z);
    } else if (id === B.sugar_cane || id === B.cactus) {
      if (above === 0 && r < 0.1) {
        let h = 1;
        while (this.getBlock(x, y - h, z) === id) h++;
        if (h < 3) this.setBlock(x, y + 1, z, id);
      }
    } else if (isLeaves(id)) {
      if ((this.getMeta(x, y, z) & 1) === 0 && !this.logNearby(x, y, z)) this.breakBlock(x, y, z, true);
    }
  }

  /** Apply bone meal. Returns true if it did something (and should be used up). */
  boneMeal(x: number, y: number, z: number): boolean {
    const id = this.getBlock(x, y, z);
    if (id === B.wheat || id === B.carrots) {
      const m = this.getMeta(x, y, z);
      if (m >= 7) return false;
      this.setMeta(x, y, z, Math.min(7, m + 2 + Math.floor(this.rand() * 4)));
      return true;
    }
    if (id === B.sapling) {
      if (this.rand() < 0.45) this.growTree(x, y, z);
      return true;
    }
    if (id === B.grass) {
      for (let k = 0; k < 24; k++) {
        const tx = x + Math.floor(this.rand() * 7) - 3, tz = z + Math.floor(this.rand() * 7) - 3;
        for (let ty = y + 2; ty >= y - 2; ty--) {
          if (this.getBlock(tx, ty, tz) === B.grass && this.getBlock(tx, ty + 1, tz) === 0) {
            const r = this.rand();
            this.setBlock(tx, ty + 1, tz, r < 0.8 ? B.tall_grass : r < 0.9 ? B.poppy : B.dandelion);
            break;
          }
        }
      }
      return true;
    }
    return false;
  }

  private logNearby(x: number, y: number, z: number): boolean {
    const seen = new Set<string>();
    const q: [number, number, number, number][] = [[x, y, z, 0]];
    while (q.length) {
      const [cx, cy, cz, d] = q.shift()!;
      for (const [dx, dy, dz] of DIRS6) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        const key = nx + ',' + ny + ',' + nz;
        if (seen.has(key)) continue;
        seen.add(key);
        const b = this.getBlock(nx, ny, nz);
        if (isLog(b)) return true;
        if (!this.isLoaded(nx, nz)) return true;
        if (isLeaves(b) && d < 4) q.push([nx, ny, nz, d + 1]);
      }
    }
    return false;
  }

  growTree(x: number, y: number, z: number): boolean {
    const height = 4 + Math.floor(this.rand() * 3);
    for (let i = 1; i <= height + 1; i++) {
      const b = this.getBlock(x, y + i, z);
      if (b !== 0 && !isLeaves(b)) return false;
    }
    const top = y + height;
    for (let ly = top - 3; ly <= top; ly++) {
      const radius = ly >= top - 1 ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && (ly === top || this.rand() < 0.5)) continue;
        if (this.getBlock(x + dx, ly, z + dz) === 0) this.setBlock(x + dx, ly, z + dz, B.leaves);
      }
    }
    for (let i = 0; i < height; i++) this.setBlock(x, y + i, z, B.log);
    if (this.getBlock(x, y - 1, z) === B.grass) this.setBlock(x, y - 1, z, B.dirt);
    return true;
  }

  // ---------- Loading ----------
  update(px: number, pz: number, renderDistance: number): void {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    this.center = [pcx, pcz];
    const loadR = renderDistance + 1;
    const wanted: [number, number, number][] = [];
    for (let dz = -loadR; dz <= loadR; dz++) for (let dx = -loadR; dx <= loadR; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > (loadR + 0.5) * (loadR + 0.5)) continue;
      const cx = pcx + dx, cz = pcz + dz;
      const key = chunkKey(cx, cz);
      if (this.chunks.has(key) || this.genPending.has(key)) continue;
      wanted.push([cx, cz, d2]);
    }
    wanted.sort((a, b) => a[2] - b[2]);
    const maxInFlight = this.pool.size * 2;
    for (const [cx, cz] of wanted) {
      if (this.genPending.size >= maxInFlight) break;
      this.requestChunk(cx, cz);
    }
    // Unload far chunks.
    const unloadR = renderDistance + 3;
    for (const c of [...this.chunks.values()]) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > unloadR * unloadR) this.unload(c);
    }
    this.pumpMeshes(renderDistance);
  }

  private async requestChunk(cx: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cz);
    this.genPending.add(key);
    let saved: { blocks: Uint8Array; meta: Uint8Array } | undefined;
    const st = this.stash.get(key);
    if (st) saved = { blocks: st.blocks.slice(), meta: st.meta.slice() };
    else if (this.savedKeys.has(key)) saved = (await loadChunk(this.worldId, cx, cz, VOLUME)) ?? undefined;
    const res = await this.pool.generate(cx, cz, saved);
    this.genPending.delete(key);
    const [pcx, pcz] = this.center;
    if (this.disposed) return;
    if (Math.abs(cx - pcx) > 40 || Math.abs(cz - pcz) > 40) return;
    const chunk = new Chunk(cx, cz, res.blocks, res.meta, res.biomes);
    chunk.light.set(res.light);
    chunk.modified = !!saved;
    chunk.lit = true;
    chunk.markAllDirty();
    this.chunks.set(key, chunk);
    this.light.stitch(chunk);
    for (const i of res.spawners ?? []) this.spawners.add(`${cx * 16 + (i & 15)},${i >> 8},${cz * 16 + ((i >> 4) & 15)}`);
    // Resume fluids and falling blocks that were mid-flow when saved.
    if (saved) this.rescanPending(chunk);
    if (res.spawns?.length && !this.spawnedChunks.has(key)) this.onSpawns(res.spawns);
    this.spawnedChunks.add(key);
  }

  private rescanPending(c: Chunk): void {
    for (let i = 0; i < VOLUME; i++) {
      const id = c.blocks[i];
      if ((id === B.water || id === B.lava) && c.meta[i] !== 0) {
        this.schedule(c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), 10);
      }
    }
  }

  private unload(c: Chunk): void {
    const key = chunkKey(c.cx, c.cz);
    if (c.modified) {
      this.stash.set(key, { blocks: c.blocks, meta: c.meta });
      this.savedKeys.add(key);
      saveChunk(this.worldId, c.cx, c.cz, c.blocks, c.meta).then(() => {
        if (!this.chunks.has(key)) this.stash.delete(key);
      });
    }
    this.chunks.delete(key);
    for (const s of [...this.spawners]) {
      const [sx, , sz] = s.split(',').map(Number);
      if (sx >> 4 === c.cx && sz >> 4 === c.cz) this.spawners.delete(s);
    }
    if (this.lastChunk === c) this.lastChunk = undefined;
    this.onChunkUnload(c.cx, c.cz);
  }

  /** Persist all modified loaded chunks. */
  async saveAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const c of this.chunks.values()) {
      if (!c.modified) continue;
      this.savedKeys.add(chunkKey(c.cx, c.cz));
      jobs.push(saveChunk(this.worldId, c.cx, c.cz, c.blocks, c.meta));
    }
    await Promise.all(jobs);
  }

  disposed = false;
  dispose(): void {
    this.disposed = true;
  }

  private neighborsLoaded(c: Chunk): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dz) && !this.getChunk(c.cx + dx, c.cz + dz)) return false;
    }
    return true;
  }

  private pumpMeshes(renderDistance: number): void {
    const [pcx, pcz] = this.center;
    const maxInFlight = this.pool.size * 3;
    if (this.meshInFlight >= maxInFlight) return;
    const candidates: [Chunk, number][] = [];
    for (const c of this.chunks.values()) {
      if (!c.dirty.size) continue;
      const dx = c.cx - pcx, dz = c.cz - pcz;
      const d2 = dx * dx + dz * dz;
      if (d2 > (renderDistance + 0.5) * (renderDistance + 0.5)) continue;
      candidates.push([c, d2]);
    }
    candidates.sort((a, b) => a[1] - b[1]);
    for (const [c] of candidates) {
      if (!this.neighborsLoaded(c)) continue;
      for (const sy of [...c.dirty]) {
        if (this.meshInFlight >= maxInFlight) return;
        c.dirty.delete(sy);
        this.meshSub(c, sy);
      }
    }
  }

  private meshSub(c: Chunk, sy: number): void {
    const key = `${c.cx},${sy},${c.cz}`;
    // Empty subchunks never produce geometry.
    const start = sy * 16 * 256, end = start + 16 * 256;
    let empty = true;
    for (let i = start; i < end; i++) if (c.blocks[i] !== 0) { empty = false; break; }
    const seq = (this.meshSeq.get(key) ?? 0) + 1;
    this.meshSeq.set(key, seq);
    if (empty) {
      this.onSubMesh(c.cx, sy, c.cz, null);
      return;
    }
    const size = P * P * P;
    const blocks = new Uint8Array(size), meta = new Uint8Array(size), light = new Uint8Array(size);
    const x0 = c.cx * CS, y0 = sy * 16, z0 = c.cz * CS;
    const around: (Chunk | undefined)[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) around.push(this.getChunk(c.cx + dx, c.cz + dz));
    for (let py = -1; py <= 16; py++) {
      const wy = y0 + py;
      for (let pz = -1; pz <= 16; pz++) {
        const cz = pz < 0 ? 0 : pz > 15 ? 2 : 1;
        const lz = (pz + 16) & 15;
        for (let px = -1; px <= 16; px++) {
          const o = pidx(px, py, pz);
          if (wy < 0) { blocks[o] = B.bedrock; continue; }
          if (wy >= CH) { light[o] = 15 << 4; continue; }
          const cx = px < 0 ? 0 : px > 15 ? 2 : 1;
          const ch = around[cx + cz * 3];
          if (!ch) continue;
          const i = idx((px + 16) & 15, wy, lz);
          blocks[o] = ch.blocks[i];
          meta[o] = ch.meta[i];
          light[o] = ch.light[i];
        }
      }
    }
    this.meshInFlight++;
    this.pool.mesh(blocks, meta, light, c.biomes.slice(), [x0, y0, z0]).then(({ mesh }) => {
      this.meshInFlight--;
      if (this.meshSeq.get(key) !== seq || this.disposed) return;
      if (!this.chunks.has(chunkKey(c.cx, c.cz))) return;
      this.onSubMesh(c.cx, sy, c.cz, mesh);
    });
  }

  get pendingWork(): number {
    return this.genPending.size + this.meshInFlight;
  }

  // ---------- Serialization of block entities ----------
  serializeBlockEntities(): unknown {
    const out: Record<string, unknown> = {};
    for (const [k, be] of this.blockEntities) {
      out[k] = be.kind === 'sign' ? { kind: 'sign', lines: be.lines }
        : be.kind === 'chest' ? { kind: 'chest', slots: be.inv.toJSON() }
          : be.kind === 'brewing' ? { kind: 'brewing', slots: be.inv.toJSON(), fuel: be.fuel, brew: be.brew }
            : { kind: 'furnace', slots: be.inv.toJSON(), burn: be.burn, burnMax: be.burnMax, cook: be.cook };
    }
    return out;
  }

  loadBlockEntities(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    for (const [k, v] of Object.entries(data as Record<string, { kind: string; slots: Slot[]; burn?: number; burnMax?: number; cook?: number; lines?: string[]; fuel?: number; brew?: number }>)) {
      if (v.kind === 'brewing') { const inv = new Inventory(5); inv.load(v.slots); this.blockEntities.set(k, { kind: 'brewing', inv, fuel: v.fuel ?? 0, brew: v.brew ?? 0 }); continue; }
      if (v.kind === 'sign') { this.blockEntities.set(k, { kind: 'sign', lines: (v.lines ?? []).slice(0, 4).map(String) }); continue; }
      if (v.kind === 'chest') {
        const inv = new Inventory(27); inv.load(v.slots);
        this.blockEntities.set(k, { kind: 'chest', inv });
      } else if (v.kind === 'furnace') {
        const inv = new Inventory(3); inv.load(v.slots);
        this.blockEntities.set(k, { kind: 'furnace', inv, burn: v.burn ?? 0, burnMax: v.burnMax ?? 0, cook: v.cook ?? 0 });
      }
    }
  }

  /** Top of the ground at a column, ignoring tree canopies. */
  groundY(x: number, z: number): number {
    for (let y = CH - 1; y > 0; y--) {
      const b = this.getBlock(x, y, z);
      if (isLeaves(b) || isLog(b)) continue;
      if (SOLID[b] || BLOCKS[b].fluid) return y + 1;
    }
    return 64;
  }

  /** Surface height at a column for spawning (highest solid block + 1). */
  surfaceY(x: number, z: number): number {
    for (let y = CH - 1; y > 0; y--) {
      const b = this.getBlock(x, y, z);
      if (SOLID[b] || BLOCKS[b].fluid) return y + 1;
    }
    return 64;
  }
}
