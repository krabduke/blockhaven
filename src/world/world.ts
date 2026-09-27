// The live world on the main thread: loaded chunks, block edits and their
// side effects (light, fluids, falling blocks, support), random ticks,
// block entities, and scheduling chunk generation and meshing.

import { B, BLOCKS, EMIT, LIGHT_OPACITY, SOLID, isLeaves, isLog } from '../blocks';
import { SMELTING } from '../crafting';
import { Inventory, type Slot } from '../inventory';
import { itemDef, type ItemStack } from '../items';
import { mulberry32 } from '../noise';
import { loadChunk, saveChunk } from '../storage';
import { CH, CS, Chunk, SUBS, VOLUME, chunkKey, idx } from './chunk';
import { LightEngine, type ChunkSource } from './light';
import { P, pidx, type SubMesh } from './mesher';
import type { WorkerPool } from './pool';

export interface ChestBE { kind: 'chest'; inv: Inventory }
export interface FurnaceBE { kind: 'furnace'; inv: Inventory; burn: number; burnMax: number; cook: number }
export type BlockEntity = ChestBE | FurnaceBE;

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
    const slot = Math.floor(rand() * 27);
    if (!inv.slots[slot]) inv.slots[slot] = { id, count: lo + Math.floor(rand() * (hi - lo + 1)) };
  }
}
const DIRS6: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Blocks a fluid washes away (dropping them). */
function washable(id: number): boolean {
  const d = BLOCKS[id];
  return id === 0 || (!d.solid && !d.fluid && (d.shape === 'cross' || d.shape === 'torch'));
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
  onEvent: (kind: 'fizz' | 'break', x: number, y: number, z: number, id: number) => void = () => {};

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
    if (old === B.spawner) this.spawners.delete(`${x},${y},${z}`);
    if (id === B.spawner) this.spawners.add(`${x},${y},${z}`);
    if (old !== id) {
      const key = `${x},${y},${z}`;
      if (this.blockEntities.has(key) && id !== B.furnace && id !== B.furnace_lit && id !== B.chest) {
        const be = this.blockEntities.get(key)!;
        for (const s of be.inv.slots) if (s) this.onDrop(x + 0.5, y + 0.5, z + 0.5, s);
        this.blockEntities.delete(key);
      }
      if (LIGHT_OPACITY[old] !== LIGHT_OPACITY[id] || EMIT[old] !== EMIT[id]) this.light.update(x, y, z);
    }
    this.markDirty(x, y, z);
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
        return below === B.grass || below === B.dirt || below === B.snowy_grass || below === B.farmland;
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
      default:
        return true;
    }
  }

  /** Break a block as if mined, dropping what it would drop. */
  breakBlock(x: number, y: number, z: number, drop: boolean): void {
    const id = this.getBlock(x, y, z);
    if (id === 0) return;
    const meta = this.getMeta(x, y, z);
    this.onEvent('break', x, y, z, id);
    if (drop) {
      const d = BLOCKS[id];
      const res = d.drop ? d.drop(this.rand()) : null;
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
  }

  schedule(x: number, y: number, z: number, delay: number): void {
    const key = `${x},${y},${z}`;
    const due = this.tickCount + delay;
    const cur = this.scheduled.get(key);
    if (!cur || cur.due > due) this.scheduled.set(key, { x, y, z, due });
  }

  private scheduledTick(x: number, y: number, z: number): void {
    const id = this.getBlock(x, y, z);
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
      if (be) this.blockEntities.set(key, be);
    }
    return be;
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
    for (let i = 0; i < VOLUME; i++) if (res.blocks[i] === B.spawner) this.spawners.add(`${cx * 16 + (i & 15)},${i >> 8},${cz * 16 + ((i >> 4) & 15)}`);
    // Resume fluids and falling blocks that were mid-flow when saved.
    if (saved) this.rescanPending(chunk);
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
    void x0; void z0;
    this.meshInFlight++;
    this.pool.mesh(blocks, meta, light, c.biomes.slice()).then(({ mesh }) => {
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
      out[k] = be.kind === 'chest' ? { kind: 'chest', slots: be.inv.toJSON() } : { kind: 'furnace', slots: be.inv.toJSON(), burn: be.burn, burnMax: be.burnMax, cook: be.cook };
    }
    return out;
  }

  loadBlockEntities(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    for (const [k, v] of Object.entries(data as Record<string, { kind: string; slots: Slot[]; burn?: number; burnMax?: number; cook?: number }>)) {
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
