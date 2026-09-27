// Villages: one possible village per 320x320 region, laid out
// deterministically from the seed and built into whichever chunks it
// overlaps. Pieces sit on the terrain height at their centre, with a
// foundation filled down to the ground.

import { B } from '../blocks';
import { mulberry32 } from '../noise';
import { CH, CS, SEA_LEVEL, idx } from './chunk';
import type { Spawn, WorldGen } from './worldgen';
import { BIOME } from './worldgen';

const REGION = 320;

type PieceType = 'well' | 'hut' | 'house' | 'farm' | 'smith' | 'library' | 'lamp';
type Style = 'oak' | 'spruce' | 'sand';

interface Piece { type: PieceType; x0: number; z0: number; x1: number; z1: number; y: number; rot: number; w: number; d: number }
interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Village { cx: number; cz: number; style: Style; pieces: Piece[]; roads: Rect[]; bounds: Rect }

const SIZES: Record<PieceType, [number, number]> = { well: [5, 5], hut: [5, 5], house: [9, 7], farm: [7, 9], smith: [7, 7], library: [9, 7], lamp: [1, 1] };

function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.z0 - pad <= b.z1 && a.z1 + pad >= b.z0;
}

const cache = new Map<string, Village | null>();

export function villageInRegion(gen: WorldGen, rx: number, rz: number): Village | null {
  const key = `${gen.seed}:${rx},${rz}`;
  if (cache.has(key)) return cache.get(key)!;
  const rand = mulberry32((gen.seed ^ Math.imul(rx, 0x27d4eb2d) ^ Math.imul(rz, 0x165667b1) ^ 0xabc) >>> 0);
  let v: Village | null = null;
  if (rand() < 0.75) {
    const cx = rx * REGION + 64 + Math.floor(rand() * (REGION - 128));
    const cz = rz * REGION + 64 + Math.floor(rand() * (REGION - 128));
    const col = gen.column(cx, cz);
    const ok = [BIOME.plains, BIOME.savanna, BIOME.desert, BIOME.taiga].includes(col.biome as 1) && col.height > SEA_LEVEL + 1;
    if (ok) {
      // Needs fairly flat ground.
      let lo = col.height, hi = col.height;
      for (const [dx, dz] of [[-20, 0], [20, 0], [0, -20], [0, 20], [-14, -14], [14, 14], [-14, 14], [14, -14]]) {
        const h = gen.column(cx + dx, cz + dz).height;
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (hi - lo <= 9) v = layout(gen, cx, cz, col.biome, rand);
    }
  }
  cache.set(key, v);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return v;
}

function layout(gen: WorldGen, cx: number, cz: number, biome: number, rand: () => number): Village {
  const style: Style = biome === BIOME.desert ? 'sand' : biome === BIOME.taiga ? 'spruce' : 'oak';
  const pieces: Piece[] = [];
  const roads: Rect[] = [];
  const place = (type: PieceType, x0: number, z0: number, rot: number): boolean => {
    const [w, d] = SIZES[type];
    const sx = rot % 2 ? d : w, sz = rot % 2 ? w : d;
    const r: Rect = { x0, z0, x1: x0 + sx - 1, z1: z0 + sz - 1 };
    if (pieces.some((p) => overlaps(p, r, 1)) || roads.some((q) => overlaps(q, r))) return false;
    const y = gen.column(Math.floor((r.x0 + r.x1) / 2), Math.floor((r.z0 + r.z1) / 2)).height + 1;
    if (y <= SEA_LEVEL + 1) return false;
    pieces.push({ type, ...r, y, rot, w, d });
    return true;
  };
  place('well', cx - 2, cz - 2, 0);
  const arms: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of arms) {
    if (rand() < 0.2) continue;
    const len = 18 + Math.floor(rand() * 26);
    const road: Rect = dx !== 0
      ? { x0: dx > 0 ? cx + 3 : cx - 3 - len, x1: dx > 0 ? cx + 3 + len : cx - 3, z0: cz - 1, z1: cz + 1 }
      : { z0: dz > 0 ? cz + 3 : cz - 3 - len, z1: dz > 0 ? cz + 3 + len : cz - 3, x0: cx - 1, x1: cx + 1 };
    roads.push(road);
    for (let t = 6; t < len - 3; t += 9 + Math.floor(rand() * 4)) {
      for (const side of [-1, 1]) {
        if (rand() < 0.3) continue;
        const r = rand();
        const type: PieceType = r < 0.32 ? 'hut' : r < 0.55 ? 'house' : r < 0.74 ? 'farm' : r < 0.84 ? 'smith' : r < 0.94 ? 'library' : 'lamp';
        const [w, d] = SIZES[type];
        // Doors face the road.
        if (dx !== 0) {
          const along = dx > 0 ? cx + 3 + t : cx - 3 - t - w;
          const rot = side < 0 ? 2 : 0; // side -1 = north of the road (-z), door faces +z
          const z0 = side < 0 ? cz - 3 - d : cz + 3;
          place(type, along, z0, rot);
        } else {
          const along = dz > 0 ? cz + 3 + t : cz - 3 - t - w;
          const rot = side < 0 ? 1 : 3;
          const x0 = side < 0 ? cx - 3 - d : cx + 3;
          place(type, x0, along, rot);
        }
      }
    }
  }
  const all: Rect[] = [...pieces, ...roads];
  const bounds = { x0: Math.min(...all.map((r) => r.x0)) - 2, z0: Math.min(...all.map((r) => r.z0)) - 2, x1: Math.max(...all.map((r) => r.x1)) + 2, z1: Math.max(...all.map((r) => r.z1)) + 2 };
  return { cx, cz, style, pieces, roads, bounds };
}

/** Villages whose bounds touch this chunk. */
export function villagesNear(gen: WorldGen, cx: number, cz: number): Village[] {
  const out: Village[] = [];
  const wx = cx * CS, wz = cz * CS;
  const rx = Math.floor(wx / REGION), rz = Math.floor(wz / REGION);
  const chunk: Rect = { x0: wx, z0: wz, x1: wx + CS - 1, z1: wz + CS - 1 };
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const v = villageInRegion(gen, rx + dx, rz + dz);
    if (v && overlaps(v.bounds, chunk)) out.push(v);
  }
  return out;
}

export function nearestVillage(gen: WorldGen, x: number, z: number): Village | null {
  let best: Village | null = null, bd = Infinity;
  const rx = Math.floor(x / REGION), rz = Math.floor(z / REGION);
  for (let r = 0; r <= 6; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const v = villageInRegion(gen, rx + dx, rz + dz);
      if (!v) continue;
      const d = Math.hypot(v.cx - x, v.cz - z);
      if (d < bd) { bd = d; best = v; }
    }
    if (best) return best;
  }
  return best;
}

const PROFESSIONS: Record<PieceType, string[]> = {
  hut: ['farmer', 'shepherd', 'fisher'], house: ['butcher', 'cleric', 'farmer'], farm: ['farmer'], smith: ['smith'], library: ['librarian'], well: [], lamp: [],
};

/** Write the parts of `v` that fall inside chunk (cx, cz). Returns villagers to spawn here. */
export function buildVillage(gen: WorldGen, v: Village, blocks: Uint8Array, meta: Uint8Array, cx: number, cz: number): Spawn[] {
  const x0 = cx * CS, z0 = cz * CS;
  const spawns: Spawn[] = [];
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
  const S = v.style;
  const wall = S === 'sand' ? B.sandstone : B.planks;
  const frame = S === 'sand' ? B.sandstone : S === 'spruce' ? B.spruce_log : B.log;
  const floorB = S === 'sand' ? B.sandstone : B.cobblestone;
  const pathB = S === 'sand' ? B.sandstone : B.dirt_path;

  // Roads follow the terrain; water gets a plank bridge.
  for (const r of v.roads) {
    for (let z = Math.max(r.z0, z0); z <= Math.min(r.z1, z0 + CS - 1); z++) for (let x = Math.max(r.x0, x0); x <= Math.min(r.x1, x0 + CS - 1); x++) {
      if (v.pieces.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1)) continue;
      let top = -1;
      for (let y = Math.min(CH - 2, SEA_LEVEL + 40); y > 1; y--) { const b = get(x, y, z); if (b !== 0 && b !== B.tall_grass && b !== B.poppy && b !== B.dandelion && b !== B.blue_flower && !isFoliage(b)) { top = y; break; } }
      if (top < 0) continue;
      const tb = get(x, top, z);
      if (tb === B.water || tb === B.ice) set(x, SEA_LEVEL + 1 > top ? SEA_LEVEL : top, z, B.planks);
      else set(x, top, z, S === 'sand' ? B.sandstone : pathB);
      for (let y = top + 1; y <= top + 3; y++) set(x, y, z, 0);
    }
  }

  for (const p of v.pieces) {
    if (p.x1 < x0 || p.x0 > x0 + CS - 1 || p.z1 < z0 || p.z0 > z0 + CS - 1) continue;
    const { w, d, y } = p;
    // Local (u along the front, v depth from the front) -> world.
    const at = (u: number, vv: number): [number, number] => {
      switch (p.rot) {
        case 0: return [p.x0 + u, p.z0 + vv];
        case 1: return [p.x1 - vv, p.z0 + u];
        case 2: return [p.x1 - u, p.z1 - vv];
        default: return [p.x0 + vv, p.z1 - u];
      }
    };
    const put = (u: number, dy: number, vv: number, id: number, m = 0) => { const [x, z] = at(u, vv); set(x, y + dy, z, id, m); };
    // Foundation and clearing.
    for (let vv = 0; vv < d; vv++) for (let u = 0; u < w; u++) {
      const [x, z] = at(u, vv);
      const ground = gen.column(x, z).height;
      for (let yy = Math.min(ground, y - 1); yy < y; yy++) set(x, yy, z, p.type === 'farm' ? B.dirt : floorB);
      for (let yy = y; yy <= y + 9; yy++) set(x, yy, z, 0);
    }
    const [mx, mz] = at(Math.floor(w / 2), Math.floor(d / 2));
    const inChunk = mx >= x0 && mx < x0 + CS && mz >= z0 && mz < z0 + CS;

    switch (p.type) {
      case 'well': {
        for (let vv = 0; vv < 5; vv++) for (let u = 0; u < 5; u++) {
          const edge = u === 0 || u === 4 || vv === 0 || vv === 4;
          put(u, -1, vv, floorB);
          if (edge) put(u, 0, vv, floorB);
          else for (let dy = -4; dy <= 0; dy++) put(u, dy, vv, dy === -4 ? floorB : B.water);
          put(u, 3, vv, S === 'sand' ? B.sandstone : B.cobble_slab);
        }
        for (const [u, vv] of [[0, 0], [4, 0], [0, 4], [4, 4]]) { put(u, 1, vv, B.fence); put(u, 2, vv, B.fence); }
        put(2, 2, 2, B.bell, 1);
        if (inChunk) spawns.push({ kind: 'stonewarden', x: mx + 4.5, y, z: mz + 0.5 });
        break;
      }
      case 'lamp':
        put(0, 0, 0, B.fence); put(0, 1, 0, B.fence); put(0, 2, 0, B.lantern);
        break;
      case 'farm': {
        for (let vv = 0; vv < d; vv++) for (let u = 0; u < w; u++) {
          const edge = u === 0 || u === w - 1 || vv === 0 || vv === d - 1;
          if (edge) { put(u, -1, vv, frame); continue; }
          if (u === 3) { put(u, -1, vv, B.water); continue; }
          put(u, -1, vv, B.farmland);
          const crop = (vv + u) % 4 === 0 ? B.carrots : (vv + u) % 4 === 2 ? B.potatoes : B.wheat;
          put(u, 0, vv, crop, 3 + ((u * 7 + vv * 3) % 5));
        }
        if (inChunk) spawns.push({ kind: 'villager', x: mx + 0.5, y: y, z: mz + 0.5, profession: 'farmer' });
        break;
      }
      default: {
        const H = p.type === 'hut' ? 3 : 4;
        const upV = [2, 1, 0, 3][p.rot], downV = [0, 3, 2, 1][p.rot]; // stairs facing local +v / -v
        const axisU = p.rot % 2 === 0 ? 1 : 2, axisV = axisU === 1 ? 2 : 1; // log lying along local u / v
        const stair = S === 'spruce' ? B.cobble_stairs : S === 'sand' ? 0 : B.oak_stairs;
        const beam = S === 'sand' ? B.sandstone : S === 'spruce' ? B.spruce_log : B.log;
        const du = Math.floor(w / 2);
        // Floor and walls: timber frame with corner posts, a beam round the top, windows between.
        for (let vv = 0; vv < d; vv++) for (let u = 0; u < w; u++) {
          const edgeU = u === 0 || u === w - 1, edgeV = vv === 0 || vv === d - 1;
          const edge = edgeU || edgeV;
          put(u, -1, vv, edge ? floorB : p.type === 'smith' ? B.cobblestone : S === 'sand' ? B.sandstone : B.planks);
          if (!edge) continue;
          const corner = edgeU && edgeV;
          for (let dy = 0; dy < H; dy++) {
            let id = p.type === 'smith' && dy === 0 ? B.cobblestone : wall, m = 0;
            if (corner) id = frame;
            else if (dy === H - 1 && S !== 'sand') { id = beam; m = edgeV ? axisU : axisV; }
            else if (dy === 1 || (dy === 2 && H > 3)) {
              const alongFront = edgeV && u % 2 === 0 && u !== du && u > 0 && u < w - 1;
              const alongSide = edgeU && vv % 2 === 0 && vv > 0 && vv < d - 1;
              if ((alongFront || alongSide) && dy === 1) id = B.glass_pane;
              if ((alongFront || alongSide) && dy === 2 && H > 3) id = B.glass_pane;
            }
            put(u, dy, vv, id, m);
          }
        }
        put(du, 0, 0, B.door, [0, 1, 2, 3][p.rot]);
        put(du, 1, 0, B.door, [0, 1, 2, 3][p.rot] | 8);
        // Attic ceiling.
        for (let vv = 1; vv < d - 1; vv++) for (let u = 1; u < w - 1; u++) put(u, H, vv, S === 'sand' ? B.sandstone : B.planks);
        let ridgeTop = H;
        if (S === 'sand') {
          // Desert houses: flat roof with a low parapet.
          for (let vv = 0; vv < d; vv++) for (let u = 0; u < w; u++) {
            put(u, H, vv, B.sandstone);
            if (u === 0 || u === w - 1 || vv === 0 || vv === d - 1) put(u, H + 1, vv, (u + vv) % 2 ? B.sandstone : 0);
          }
        } else {
          // Gable roof: stair rows climbing from front and back to a ridge, overhanging by one.
          for (let k = 0; ; k++) {
            const fv = k - 1, bv = d - k, y2 = H + k;
            if (fv > bv) break;
            for (let u = -1; u <= w; u++) {
              if (fv === bv) put(u, y2, fv, S === 'spruce' ? B.cobblestone : B.planks);
              else { put(u, y2, fv, stair, upV); put(u, y2, bv, stair, downV); }
            }
            // Fill the triangular gable ends under this row.
            for (let vv = fv + 1; vv < bv; vv++) { put(0, y2, vv, wall); put(w - 1, y2, vv, wall); }
            ridgeTop = y2;
            if (fv === bv || fv + 1 === bv) break;
          }
        }
        // Chimney through the roof on bigger buildings.
        if (p.type === 'house' || p.type === 'smith') {
          for (let dy = 0; dy <= ridgeTop + 1; dy++) put(w - 2, dy, d - 2, B.cobblestone);
          put(w - 2, 0, d - 3, 0);
        }
        // Porch light under the front eave, and one inside.
        if (S !== 'sand') put(du + 1, H - 1, -1, B.lantern, 1);
        put(du, H - 1, Math.floor(d / 2), B.lantern, 1);
        // Furnishings.
        const fm = [2, 3, 0, 1][p.rot]; // directional blocks face the door side
        const bedMeta = [3, 0, 1, 2][p.rot];
        if (p.type === 'hut') {
          put(1, 0, d - 2, B.bed, bedMeta); put(2, 0, d - 2, B.bed, bedMeta | 8);
          put(w - 2, 0, d - 2, B.chest, fm);
          put(w - 2, 0, 1, B.crafting_table, fm);
        } else if (p.type === 'house') {
          put(1, 0, d - 2, B.bed, bedMeta); put(2, 0, d - 2, B.bed, bedMeta | 8);
          put(1, 0, d - 3, B.bed, bedMeta); put(2, 0, d - 3, B.bed, bedMeta | 8);
          put(w - 2, 0, 1, B.crafting_table, fm);
          put(w - 3, 0, 1, B.furnace, fm);
          put(1, 0, 1, B.chest, fm);
          put(1, 0, 2, B.bookshelf);
          for (let u = 3; u < w - 3; u++) for (let vv = 2; vv < d - 2; vv++) put(u, 0, vv, B.carpet);
        } else if (p.type === 'smith') {
          put(1, 0, d - 2, B.furnace, fm);
          put(2, 0, d - 2, B.furnace, fm);
          put(w - 2, 0, 1, B.chest, fm | 16);
          put(1, 0, 1, B.iron_block);
          put(3, -1, 3, B.cobblestone);
          put(3, 0, 3, B.lava);
          put(2, 0, 3, B.iron_bars); put(4, 0, 3, B.iron_bars);
        } else if (p.type === 'library') {
          for (let u = 1; u < w - 1; u++) { if (u === w - 2) continue; put(u, 0, d - 2, B.bookshelf); put(u, 1, d - 2, B.bookshelf); }
          for (let vv = 1; vv < d - 2; vv++) { put(1, 0, vv, B.bookshelf); put(1, 1, vv, B.bookshelf); }
          put(w - 2, 0, 1, B.crafting_table, fm);
          put(w - 2, 0, d - 2, B.chest, fm);
          for (let u = 3; u < w - 2; u++) for (let vv = 2; vv < d - 2; vv++) put(u, 0, vv, B.carpet);
        }
        if (inChunk) {
          const choices = PROFESSIONS[p.type];
          const prof = choices[(mx * 31 + mz * 17) % choices.length < 0 ? 0 : (mx * 31 + mz * 17) % choices.length];
          spawns.push({ kind: 'villager', x: mx + 0.5, y, z: mz + 0.5, profession: prof });
        }
      }
    }
    void get;
  }
  return spawns;
}

function isFoliage(id: number): boolean {
  return id === B.leaves || id === B.birch_leaves || id === B.spruce_leaves || id === B.sunwood_leaves || id === B.log || id === B.birch_log || id === B.spruce_log || id === B.sunwood_log || id === B.vine || id === B.cactus || id === B.dead_bush || id === B.sugar_cane || id === B.pumpkin || id === B.melon;
}
