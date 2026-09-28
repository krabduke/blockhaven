// Structures scattered across the overworld, each laid out deterministically
// from the seed and built into whichever chunks it overlaps (like villages):
//
//   Sun temple     a stepped sandstone pyramid in the desert, with a vault under its floor
//   Shipwreck      a broken hull on the sea floor, with a hold and a captain's chest
//   Abandoned mine timbered tunnels with old rails, cobwebs, a nest of crawlers and supply chests
//   Sanctum        a buried stone hall around the Astral Gate, the way into the Hollow
//
// Chest meta carries the loot table in bits 5-7 (see LOOT in world.ts).

import { B, SPAWNER_KINDS } from '../blocks';
import { hash3, mulberry32 } from '../noise';
import { CH, CS, SEA_LEVEL, idx } from './chunk';
import { villageInRegion } from './villages';
import type { WorldGen } from './worldgen';
import { BIOME } from './worldgen';

export type StructureKind = 'temple' | 'shipwreck' | 'mine' | 'sanctum' | 'treasure';
export const LOOT_TABLE: Record<StructureKind | 'dungeon', number> = { dungeon: 0, temple: 1, shipwreck: 2, mine: 3, sanctum: 4, treasure: 6 };

const REGION = 256;
/** Each 3x3 block of regions holds exactly one sanctum. */
const SANCTUM_SECTOR = 3;

interface Rect { x0: number; z0: number; x1: number; z1: number }
interface Tunnel extends Rect { axis: 'x' | 'z' }
export interface Structure {
  kind: StructureKind;
  x: number; y: number; z: number;
  rot: number;
  seed: number;
  bounds: Rect;
  tunnels?: Tunnel[];
  /** Mine dead ends: [x, z, direction the tunnel ran]. */
  ends?: [number, number, number][];
}

const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const floorDiv = (a: number, b: number) => Math.floor(a / b);
const cache = new Map<string, Structure[]>();

export function structuresInRegion(gen: WorldGen, rx: number, rz: number): Structure[] {
  const key = `${gen.seed}:${rx},${rz}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Structure[] = [];
  const rand = mulberry32((gen.seed ^ Math.imul(rx, 0x3c6ef372) ^ Math.imul(rz, 0x1b873593) ^ 0x5717) >>> 0);
  const seed = (gen.seed ^ Math.imul(rx, 7919) ^ Math.imul(rz, 104729)) >>> 0;

  // A surface structure where the biome suits one.
  const sx = rx * REGION + 40 + Math.floor(rand() * (REGION - 80));
  const sz = rz * REGION + 40 + Math.floor(rand() * (REGION - 80));
  const roll = rand();
  const col = gen.column(sx, sz);
  if (col.biome === BIOME.desert && roll < 0.7 && col.height > SEA_LEVEL + 1) {
    let lo = col.height, hi = col.height;
    for (const [dx, dz] of [[-10, -10], [10, 10], [-10, 10], [10, -10]]) { const h = gen.column(sx + dx, sz + dz).height; lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const v = villageInRegion(gen, floorDiv(sx, 320), floorDiv(sz, 320));
    const nearVillage = !!v && Math.hypot(v.cx - sx, v.cz - sz) < 90;
    if (hi - lo <= 6 && !nearVillage) out.push({ kind: 'temple', x: sx, y: col.height, z: sz, rot: 0, seed, bounds: { x0: sx - 14, z0: sz - 14, x1: sx + 14, z1: sz + 14 } });
  } else if (col.biome === BIOME.ocean && roll < 0.6 && col.height < SEA_LEVEL - 5) {
    const rot = Math.floor(rand() * 4);
    out.push({ kind: 'shipwreck', x: sx, y: col.height + 1, z: sz, rot, seed, bounds: { x0: sx - 10, z0: sz - 10, x1: sx + 10, z1: sz + 10 } });
  }

  // An abandoned mine underground.
  if (rand() < 0.4) {
    const mx = rx * REGION + 60 + Math.floor(rand() * (REGION - 120));
    const mz = rz * REGION + 60 + Math.floor(rand() * (REGION - 120));
    const my = 18 + Math.floor(rand() * 14);
    if (gen.column(mx, mz).height > my + 14) out.push(mineLayout(mx, my, mz, seed ^ 0x9e37, rand));
  }

  // Buried treasure: a chest under a sandy beach, found with a treasure map.
  if (rand() < 0.6) {
    for (let t = 0; t < 12; t++) {
      const tx = rx * REGION + 16 + Math.floor(rand() * (REGION - 32)), tz = rz * REGION + 16 + Math.floor(rand() * (REGION - 32));
      const c = gen.column(tx, tz);
      if (c.biome === BIOME.beach && c.height >= SEA_LEVEL && c.height <= SEA_LEVEL + 3) {
        out.push({ kind: 'treasure', x: tx, y: c.height - 2, z: tz, rot: 0, seed, bounds: { x0: tx, z0: tz, x1: tx, z1: tz } });
        break;
      }
    }
  }

  // The sanctum for this sector, if it falls in this region.
  const sxr = floorDiv(rx, SANCTUM_SECTOR), szr = floorDiv(rz, SANCTUM_SECTOR);
  const srand = mulberry32((gen.seed ^ Math.imul(sxr, 0x2545f491) ^ Math.imul(szr, 0x61c88647) ^ 0x5a9c) >>> 0);
  const pick = [Math.floor(srand() * SANCTUM_SECTOR), Math.floor(srand() * SANCTUM_SECTOR)];
  if (rx - sxr * SANCTUM_SECTOR === pick[0] && rz - szr * SANCTUM_SECTOR === pick[1]) {
    const x = rx * REGION + 60 + Math.floor(srand() * (REGION - 120));
    const z = rz * REGION + 60 + Math.floor(srand() * (REGION - 120));
    const y = 20 + Math.floor(srand() * 6);
    out.push({ kind: 'sanctum', x, y, z, rot: 0, seed: seed ^ 0x51, bounds: { x0: x - 40, z0: z - 40, x1: x + 40, z1: z + 40 } });
  }

  cache.set(key, out);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return out;
}

function mineLayout(mx: number, my: number, mz: number, seed: number, rand: () => number): Structure {
  const tunnels: Tunnel[] = [];
  const ends: [number, number, number][] = [];
  const heads: { x: number; z: number; dir: number; depth: number }[] = [];
  for (let d = 0; d < 4; d++) if (rand() < 0.85) heads.push({ x: mx + DIRS[d][0] * 5, z: mz + DIRS[d][1] * 5, dir: d, depth: 0 });
  while (heads.length && tunnels.length < 18) {
    const h = heads.shift()!;
    const [dx, dz] = DIRS[h.dir];
    let len = 8 + Math.floor(rand() * 16);
    // Stay within 44 blocks of the hub.
    while (len > 4 && Math.max(Math.abs(h.x + dx * len - mx), Math.abs(h.z + dz * len - mz)) > 44) len--;
    if (len <= 4) { ends.push([h.x, h.z, h.dir]); continue; }
    const ex = h.x + dx * len, ez = h.z + dz * len;
    const axis = dx !== 0 ? 'x' : 'z';
    tunnels.push(axis === 'x'
      ? { x0: Math.min(h.x, ex), x1: Math.max(h.x, ex), z0: h.z - 1, z1: h.z + 1, axis }
      : { x0: h.x - 1, x1: h.x + 1, z0: Math.min(h.z, ez), z1: Math.max(h.z, ez), axis });
    const r = rand();
    if (h.depth >= 4 || r < 0.15) { ends.push([ex, ez, h.dir]); continue; }
    if (r < 0.5) heads.push({ x: ex, z: ez, dir: h.dir, depth: h.depth + 1 });
    if (r >= 0.35) heads.push({ x: ex, z: ez, dir: (h.dir + (rand() < 0.5 ? 1 : 3)) % 4, depth: h.depth + 1 });
    if (r > 0.8) heads.push({ x: ex, z: ez, dir: (h.dir + 2 + (rand() < 0.5 ? 1 : -1)) % 4, depth: h.depth + 1 });
  }
  const xs = tunnels.flatMap((t) => [t.x0, t.x1]), zs = tunnels.flatMap((t) => [t.z0, t.z1]);
  const bounds = { x0: Math.min(mx - 6, ...xs) - 2, z0: Math.min(mz - 6, ...zs) - 2, x1: Math.max(mx + 6, ...xs) + 2, z1: Math.max(mz + 6, ...zs) + 2 };
  return { kind: 'mine', x: mx, y: my, z: mz, rot: 0, seed, bounds, tunnels, ends };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;
}

/** Structures whose bounds touch chunk (cx, cz). */
export function structuresNear(gen: WorldGen, cx: number, cz: number): Structure[] {
  const x0 = cx * CS, z0 = cz * CS;
  const chunk: Rect = { x0, z0, x1: x0 + CS - 1, z1: z0 + CS - 1 };
  const rx = floorDiv(x0, REGION), rz = floorDiv(z0, REGION);
  const out: Structure[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const s of structuresInRegion(gen, rx + dx, rz + dz)) if (overlaps(s.bounds, chunk)) out.push(s);
  return out;
}

/** The closest structure of a kind, searching outward a few regions. */
export function nearestStructure(gen: WorldGen, kind: StructureKind, x: number, z: number, maxRings = 8): Structure | null {
  const rx = floorDiv(x, REGION), rz = floorDiv(z, REGION);
  let best: Structure | null = null, bd = Infinity;
  for (let r = 0; r <= maxRings; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const s of structuresInRegion(gen, rx + dx, rz + dz)) {
        if (s.kind !== kind) continue;
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < bd) { bd = d; best = s; }
      }
    }
    // Anything in a further ring is at least (r * REGION) away.
    if (best && bd < r * REGION) return best;
  }
  return best;
}

/** Write the parts of `s` that fall inside chunk (cx, cz). */
export function buildStructure(gen: WorldGen, s: Structure, blocks: Uint8Array, meta: Uint8Array, cx: number, cz: number): void {
  const x0 = cx * CS, z0 = cz * CS;
  const set = (x: number, y: number, z: number, id: number, m = 0) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 1 || y >= CH) return;
    const i = idx(lx, y, lz);
    blocks[i] = id;
    meta[i] = m;
  };
  const get = (x: number, y: number, z: number) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= CH) return -1;
    return blocks[idx(lx, y, lz)];
  };
  /** A per-block coin flip that's the same whichever chunk asks. */
  const h = (x: number, y: number, z: number, salt = 0) => hash3(s.seed + salt, x, y, z);
  const chest = (x: number, y: number, z: number, facing: number) => set(x, y, z, B.chest, (facing & 3) | 16 | (LOOT_TABLE[s.kind] << 5));
  switch (s.kind) {
    case 'temple': temple(gen, s, set, chest); break;
    case 'shipwreck': shipwreck(gen, s, set, h, chest); break;
    case 'mine': mine(s, set, get, h, chest); break;
    case 'sanctum': sanctum(s, set, h, chest); break;
    case 'treasure': chest(s.x, s.y, s.z, 0); set(s.x, s.y - 1, s.z, B.sandstone); break;
  }
}

type Set = (x: number, y: number, z: number, id: number, m?: number) => void;
type Get = (x: number, y: number, z: number) => number;
type Hash = (x: number, y: number, z: number, salt?: number) => number;
type Chest = (x: number, y: number, z: number, facing: number) => void;

// ---------------------------------------------------------------- Sun temple
function temple(gen: WorldGen, s: Structure, set: Set, chest: Chest): void {
  const { x, y, z } = s;
  // A sunken courtyard dug out of the dunes around it.
  for (let dz = -14; dz <= 14; dz++) for (let dx = -14; dx <= 14; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) <= 10) continue;
    const ground = gen.column(x + dx, z + dz).height;
    for (let yy = y + 1; yy <= ground; yy++) set(x + dx, yy, z + dz, 0);
    for (let yy = Math.min(ground, y) - 1; yy <= y; yy++) set(x + dx, yy, z + dz, yy === y ? B.sand : B.sandstone);
  }
  // Foundation down to the sand, and a sun set into the chamber floor.
  for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) {
    const ground = gen.column(x + dx, z + dz).height;
    for (let yy = Math.min(ground, y - 1) - 2; yy < y; yy++) set(x + dx, yy, z + dz, B.sandstone);
    const d = Math.max(Math.abs(dx), Math.abs(dz));
    const floor = d === 0 ? B.terracotta_orange : d === 1 ? B.terracotta_yellow : d === 3 ? B.terracotta_orange : d === 5 ? B.terracotta_white : B.sandstone;
    set(x + dx, y, z + dz, floor);
  }
  // Ten stepped layers; the hall inside narrows toward the peak.
  for (let k = 0; k <= 9; k++) {
    const half = 10 - k, yy = y + 1 + k;
    for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d === half) set(x + dx, yy, z + dz, k === 2 || k === 6 ? B.red_sandstone : B.sandstone);
      else set(x + dx, yy, z + dz, d <= 6 && k <= 6 ? 0 : B.sandstone);
    }
  }
  set(x, y + 11, z, B.glowstone);
  // Doorways on all four sides, and sun-slot windows above them.
  for (const [ddx, ddz] of DIRS) {
    for (let t = 6; t <= 10; t++) for (let w = -1; w <= 1; w++) for (let dy = 1; dy <= 3; dy++) {
      set(x + ddx * t + (ddz !== 0 ? w : 0), y + dy, z + ddz * t + (ddx !== 0 ? w : 0), 0);
    }
    for (let t = 4; t <= 6; t++) set(x + ddx * t, y + 6, z + ddz * t, 0);
  }
  // Lamps in the hall's corners.
  for (const [cx, cz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) { set(x + cx, y + 1, z + cz, B.sandstone); set(x + cx, y + 2, z + cz, B.lantern); }
  // Obelisks at the outer corners.
  for (const [cx, cz] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) for (let yy = y - 1; yy <= y + 5; yy++) set(x + cx, yy, z + cz, yy === y + 5 ? B.red_sandstone : B.sandstone);
  // Under the sun: a dark shaft down to a vault of four chests, its floor wired to a store of TNT.
  for (let yy = y - 1; yy >= y - 9; yy--) set(x, yy, z, 0);
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) for (let yy = y - 14; yy <= y - 8; yy++) {
    const d = Math.max(Math.abs(dx), Math.abs(dz));
    let id = 0;
    if (yy === y - 14) id = d <= 1 ? B.tnt : B.sandstone;                  // the charge under the floor
    else if (yy === y - 13) id = d === 0 ? B.tnt : B.sandstone;             // the plate's own block
    else if (d === 3 || yy === y - 8) id = yy === y - 10 ? B.red_sandstone : B.sandstone;
    set(x + dx, yy, z + dz, id);
  }
  set(x, y - 8, z, 0);
  set(x, y - 12, z, B.pressure_plate);
  chest(x + 2, y - 12, z, 1); chest(x - 2, y - 12, z, 3); chest(x, y - 12, z + 2, 2); chest(x, y - 12, z - 2, 0);
}

// ---------------------------------------------------------------- Shipwreck
function shipwreck(gen: WorldGen, s: Structure, set: Set, h: Hash, chest: Chest): void {
  const { x, y, z, rot } = s;
  // Local (u along the hull, v across) -> world.
  const at = (u: number, v: number): [number, number] => {
    const a = u - 7;
    switch (rot) {
      case 0: return [x + a, z + v];
      case 1: return [x - v, z + a];
      case 2: return [x - a, z - v];
      default: return [x + v, z - a];
    }
  };
  const fill = (yy: number) => (yy <= SEA_LEVEL ? B.water : 0);
  const put = (u: number, dy: number, v: number, id: number, m = 0, decay = 0.14) => {
    const [wx, wz] = at(u, v);
    if (id !== 0 && id !== B.water && h(wx, y + dy, wz) < decay) { set(wx, y + dy, wz, fill(y + dy)); return; }
    set(wx, y + dy, wz, id, m);
  };
  const half = (u: number) => (u <= 1 || u >= 13 ? 1 : 2);
  for (let u = 0; u <= 14; u++) {
    const hw = half(u);
    for (let v = -hw; v <= hw; v++) {
      // Sand heaped under the keel.
      const [wx, wz] = at(u, v);
      const floor = gen.column(wx, wz).height;
      for (let yy = floor + 1; yy < y; yy++) set(wx, yy, wz, B.sand);
      put(u, 0, v, v === 0 ? B.log : B.planks, v === 0 ? (rot % 2 === 0 ? 1 : 2) : 0, 0);
      for (let dy = 1; dy <= 3; dy++) {
        const wall = Math.abs(v) === hw || u === 0 || u === 14;
        put(u, dy, v, wall ? B.planks : fill(y + dy));
      }
      const hatch = (u === 4 || u === 5) && v === 0;
      put(u, 4, v, hatch ? fill(y + 4) : B.planks, 0, 0.22);
    }
  }
  // The captain's cabin at the stern, its windows long since smashed.
  for (let u = 10; u <= 13; u++) for (let v = -2; v <= 2; v++) for (let dy = 5; dy <= 8; dy++) {
    const wall = Math.abs(v) === 2 || u === 10 || u === 13;
    const window = dy === 6 && Math.abs(v) === 2 && (u === 11 || u === 12);
    if (dy === 8) put(u, dy, v, B.plank_slab, 0, 0.25);
    else put(u, dy, v, wall && !window ? B.planks : fill(y + dy));
  }
  put(11, 5, -1, fill(y + 5)); // doorway
  // A snapped mast stump, with the rest lying on the sea floor beside the hull.
  for (let dy = 1; dy <= 7; dy++) put(6, dy, 0, B.log, 0, 0);
  for (let u = 2; u <= 9; u++) {
    const [wx, wz] = at(u, 4);
    const fy = gen.column(wx, wz).height + 1;
    if (h(wx, fy, wz, 5) < 0.85) set(wx, fy, wz, B.log, rot % 2 === 0 ? 1 : 2);
  }
  const [hx, hz] = at(3, 0);
  chest(hx, y + 1, hz, 0);
  const [cx, cz] = at(12, 0);
  chest(cx, y + 5, cz, (rot + 1) & 3);
}

// ---------------------------------------------------------------- Abandoned mine
function mine(s: Structure, set: Set, get: Get, h: Hash, chest: Chest): void {
  const { x, y, z } = s;
  const shore = (wx: number, wz: number) => { const b = get(wx, y - 1, wz); if (b === 0 || b === B.water || b === B.lava) set(wx, y - 1, wz, B.planks); };
  // The hub: a low cavern with a dirt floor.
  for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
    set(x + dx, y - 1, z + dz, B.dirt);
    for (let dy = 0; dy <= 3; dy++) set(x + dx, y + dy, z + dz, 0);
  }
  for (const [cx, cz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { set(x + cx, y, z + cz, B.fence); set(x + cx, y + 1, z + cz, B.fence); set(x + cx, y + 2, z + cz, B.lantern); }
  for (const t of s.tunnels!) {
    const along = t.axis === 'x';
    for (let wz = t.z0; wz <= t.z1; wz++) for (let wx = t.x0; wx <= t.x1; wx++) {
      for (let dy = 0; dy <= 2; dy++) set(wx, y + dy, wz, 0);
      shore(wx, wz);
      const a = along ? wx : wz;            // position along the tunnel
      const c = along ? wz - t.z0 : wx - t.x0; // 0..2 across it
      if (a % 4 === 0) {
        // A timber frame: two posts and a beam.
        if (c !== 1) { set(wx, y, wz, B.fence); set(wx, y + 1, wz, B.fence); }
        set(wx, y + 2, wz, B.planks);
      } else if (c === 1) {
        if (h(wx, y, wz, 1) < 0.72) set(wx, y, wz, B.rail, along ? 1 : 0);
      } else if (h(wx, y + 2, wz, 2) < 0.1) set(wx, y + 2, wz, B.cobweb);
      if (a % 16 === 2 && c === 0 && h(wx, y, wz, 3) < 0.5) set(wx, y + 1, wz, B.torch);
    }
  }
  s.ends!.forEach(([ex, ez, dir], i) => {
    if (i === 0) {
      // A crawler nest: a cage choked with webs.
      set(ex, y, ez, B.spawner, SPAWNER_KINDS.indexOf('shellcrawler'));
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 2; dy++) {
        if ((dx || dz || dy) && get(ex + dx, y + dy, ez + dz) === 0 && h(ex + dx, y + dy, ez + dz, 4) < 0.45) set(ex + dx, y + dy, ez + dz, B.cobweb);
      }
    } else if (h(ex, y, ez, 6) < 0.7) {
      // Supplies left at the end of the line.
      const [dx, dz] = DIRS[dir];
      set(ex + dx, y, ez + dz, 0); set(ex + dx, y + 1, ez + dz, 0); shore(ex + dx, ez + dz);
      chest(ex + dx, y, ez + dz, [3, 2, 1, 0][dir]);
    }
  });
}

// ---------------------------------------------------------------- Sanctum
function sanctum(s: Structure, set: Set, h: Hash, chest: Chest): void {
  const { x, y, z } = s;
  const brick = (wx: number, wy: number, wz: number) => { const r = h(wx, wy, wz, 9); return r < 0.15 ? B.mossy_stone_bricks : r < 0.28 ? B.cracked_stone_bricks : B.stone_bricks; };
  /** A hollow box of bricks, walls one thick. */
  const room = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number) => {
    for (let wz = az; wz <= bz; wz++) for (let wx = ax; wx <= bx; wx++) for (let wy = y0; wy <= y1; wy++) {
      const shell = wx === ax || wx === bx || wz === az || wz === bz || wy === y0 || wy === y1;
      set(wx, wy, wz, shell ? brick(wx, wy, wz) : 0);
    }
  };
  // Corridors first, so the rooms cut their doorways.
  const reach = 26;
  for (const [dx, dz] of DIRS) {
    for (let t = 7; t <= reach; t++) for (let w = -2; w <= 2; w++) for (let dy = -1; dy <= 3; dy++) {
      const wx = x + dx * t + (dz !== 0 ? w : 0), wz = z + dz * t + (dx !== 0 ? w : 0);
      const shell = Math.abs(w) === 2 || dy === -1 || dy === 3;
      set(wx, y + dy, wz, shell ? brick(wx, y + dy, wz) : 0);
      if (!shell && w === 0 && dy === 2 && t % 6 === 0) set(wx, y + dy, wz, B.lantern, 1);
    }
  }
  // The gate hall.
  room(x - 7, z - 7, x + 7, z + 7, y - 1, y + 8);
  for (const [cx, cz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) for (let dy = 0; dy <= 7; dy++) set(x + cx, y + dy, z + cz, dy === 7 ? B.glowstone : B.polished_slate);
  // The dais and the ring of twelve frame stones around a 3x3 well over lava.
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) set(x + dx, y, z + dz, B.stone_bricks);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { set(x + dx, y, z + dz, 0); set(x + dx, y - 1, z + dz, B.lava); set(x + dx, y - 2, z + dz, B.stone_bricks); }
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const ring = (Math.abs(dx) === 2 && Math.abs(dz) <= 1) || (Math.abs(dz) === 2 && Math.abs(dx) <= 1);
    if (ring) set(x + dx, y + 1, z + dz, B.astral_frame, h(x + dx, y + 1, z + dz, 11) < 0.1 ? 4 : 0);
  }
  // Doorways from the hall into the corridors.
  for (const [dx, dz] of DIRS) for (let w = -1; w <= 1; w++) for (let dy = 0; dy <= 2; dy++) set(x + dx * 7 + (dz !== 0 ? w : 0), y + dy, z + dz * 7 + (dx !== 0 ? w : 0), 0);
  // East: a library.
  const e = x + reach;
  room(e, z - 5, e + 10, z + 5, y - 1, y + 6);
  for (let wz = z - 4; wz <= z + 4; wz++) for (let dy = 0; dy <= 3; dy++) { if (Math.abs(wz - z) > 1 || dy > 2) set(e + 9, y + dy, wz, B.bookshelf); }
  for (let wx = e + 2; wx <= e + 8; wx += 3) for (let dy = 0; dy <= 2; dy++) { set(wx, y + dy, z - 4, B.bookshelf); set(wx, y + dy, z + 4, B.bookshelf); }
  for (let w = -1; w <= 1; w++) for (let dy = 0; dy <= 2; dy++) set(e, y + dy, z + w, 0);
  set(e + 5, y, z, B.enchanting_table);
  chest(e + 8, y, z, 1);
  // West: the warden's cage, a spawner behind iron bars.
  const wv = x - reach;
  room(wv - 8, z - 4, wv, z + 4, y - 1, y + 5);
  for (let w = -1; w <= 1; w++) for (let dy = 0; dy <= 2; dy++) set(wv, y + dy, z + w, 0);
  set(wv - 4, y, z, B.spawner, SPAWNER_KINDS.indexOf('skeleton'));
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) set(wv - 4 + dx, y + 1, z + dz, B.iron_bars);
  chest(wv - 7, y, z + 3, 3);
  // North: a storeroom.
  const n = z - reach;
  room(x - 4, n - 8, x + 4, n, y - 1, y + 5);
  for (let w = -1; w <= 1; w++) for (let dy = 0; dy <= 2; dy++) set(x + w, y + dy, n, 0);
  chest(x - 3, y, n - 7, 0); chest(x + 3, y, n - 7, 0);
  set(x, y + 3, n - 4, B.lantern, 1);
  // South: the corridor ends in a collapse.
  for (let t = reach - 5; t <= reach; t++) for (let w = -1; w <= 1; w++) for (let dy = 0; dy <= 2; dy++) {
    const wx = x + w, wz = z + t;
    if (dy <= (t - reach + 5) * 0.6 || h(wx, y + dy, wz, 13) < 0.4) set(wx, y + dy, wz, h(wx, y + dy, wz, 14) < 0.5 ? B.gravel : B.cobblestone);
  }
}
