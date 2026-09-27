// The Emberdeep: a sealed cavern world of cinderstone and lava seas, reached
// through an Ember Gate. Distances here are 1/8 of the overworld's.

import { B } from '../blocks';
import { Simplex, hash3, mulberry32 } from '../noise';
import { CH, CS, idx } from './chunk';
import { BIOME, type GenResult } from './worldgen';

export const EMBER_LAVA_LEVEL = 31;
export const EMBER_CEILING = 127;

export class EmberGen {
  private a: Simplex;
  private b: Simplex;
  private c: Simplex;
  private patch: Simplex;

  constructor(readonly seed: number) {
    this.a = new Simplex(seed ^ 0x51ed);
    this.b = new Simplex(seed ^ 0x2b7);
    this.c = new Simplex(seed ^ 0x77f1);
    this.patch = new Simplex(seed ^ 0x9e3);
  }

  /** Solid when > 0. */
  private density(x: number, y: number, z: number): number {
    let d = this.a.noise3(x / 64, y / 42, z / 64) * 0.8 + this.b.noise3(x / 24, y / 18, z / 24) * 0.35;
    const floor = Math.max(0, (36 - y) / 36), ceil = Math.max(0, (y - 96) / 31);
    d += floor * floor * 1.6 + ceil * ceil * 1.8 - 0.28;
    // Tall open chambers: fewer blocks in the middle band.
    d -= this.c.noise2(x / 90, z / 90) * 0.18;
    return d;
  }

  generate(cx: number, cz: number): GenResult {
    const blocks = new Uint8Array(CS * CS * CH);
    const meta = new Uint8Array(CS * CS * CH);
    const biomes = new Uint8Array(CS * CS).fill(BIOME.emberdeep);
    const x0 = cx * CS, z0 = cz * CS;
    const seed = this.seed;
    // Density sampled on a 4x4x4 grid and interpolated.
    const GX = 5, GY = 33, GZ = 5;
    const grid = new Float32Array(GX * GY * GZ);
    for (let gy = 0; gy < GY; gy++) for (let gz = 0; gz < GZ; gz++) for (let gx = 0; gx < GX; gx++) {
      grid[gx + gz * GX + gy * GX * GZ] = this.density(x0 + gx * 4, gy * 4, z0 + gz * 4);
    }
    const sample = (x: number, y: number, z: number) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const ix = Math.min(GX - 2, Math.floor(fx)), iy = Math.min(GY - 2, Math.floor(fy)), iz = Math.min(GZ - 2, Math.floor(fz));
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const at = (a: number, b: number, c: number) => grid[(ix + a) + (iz + c) * GX + (iy + b) * GX * GZ];
      const l = (a: number, b: number, t: number) => a + (b - a) * t;
      return l(l(l(at(0, 0, 0), at(1, 0, 0), tx), l(at(0, 1, 0), at(1, 1, 0), tx), ty), l(l(at(0, 0, 1), at(1, 0, 1), tx), l(at(0, 1, 1), at(1, 1, 1), tx), ty), tz);
    };
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = x0 + x, wz = z0 + z;
      for (let y = 0; y <= EMBER_CEILING; y++) {
        const i = idx(x, y, z);
        if (y <= 3 && hash3(seed, wx, y, wz) < 1 - y / 4) { blocks[i] = B.bedrock; continue; }
        if (y >= EMBER_CEILING - 3 && hash3(seed, wx, y, wz) < (y - (EMBER_CEILING - 4)) / 4) { blocks[i] = B.bedrock; continue; }
        if (y === 0 || y === EMBER_CEILING) { blocks[i] = B.bedrock; continue; }
        const d = sample(x, y, z);
        if (d > 0) blocks[i] = B.cinderstone;
        else if (y <= EMBER_LAVA_LEVEL) blocks[i] = B.lava;
      }
      // Surface dressing: ashsand patches, magma near the lava line.
      const pn = this.patch.noise2(wx / 20, wz / 20);
      for (let y = EMBER_CEILING - 4; y > 4; y--) {
        const i = idx(x, y, z);
        if (blocks[i] !== B.cinderstone) continue;
        const above = blocks[idx(x, y + 1, z)];
        if (above !== 0) continue;
        if (pn > 0.35) { blocks[i] = B.ashsand; if (y > 1 && blocks[idx(x, y - 1, z)] === B.cinderstone) blocks[idx(x, y - 1, z)] = B.ashsand; }
        else if (y >= EMBER_LAVA_LEVEL - 3 && y <= EMBER_LAVA_LEVEL + 3 && pn < -0.3) blocks[i] = B.magma;
        else if (pn < -0.55) blocks[i] = B.gravel;
      }
    }
    const rand = mulberry32((seed ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x5eed) >>> 0);
    // Emberquartz and magma veins.
    const vein = (id: number, veins: number, size: number, minY: number, maxY: number) => {
      for (let v = 0; v < veins; v++) {
        let x = rand() * CS, y = minY + rand() * (maxY - minY), z = rand() * CS;
        for (let s = 0; s < size; s++) {
          const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
          if (bx >= 0 && bx < CS && bz >= 0 && bz < CS && by > 0 && by < CH && blocks[idx(bx, by, bz)] === B.cinderstone) blocks[idx(bx, by, bz)] = id;
          x += rand() * 2 - 1; y += rand() * 2 - 1; z += rand() * 2 - 1;
        }
      }
    };
    vein(B.emberquartz_ore, 14, 10, 10, 118);
    vein(B.magma, 3, 18, 26, 38);
    vein(B.gold_ore, 4, 6, 10, 118);
    // Glowstone clusters hanging from ceilings.
    if (rand() < 0.6) {
      const x = 3 + Math.floor(rand() * 10), z = 3 + Math.floor(rand() * 10);
      for (let y = EMBER_CEILING - 5; y > 60; y--) {
        if (blocks[idx(x, y, z)] === 0 && blocks[idx(x, y + 1, z)] === B.cinderstone) {
          // A drip-shaped cluster hanging from the ceiling, fattest at the top.
          const len = 3 + Math.floor(rand() * 5);
          for (let d = 0; d < len; d++) {
            const r = d === 0 ? 1.6 : d < len / 2 ? 1.1 : 0.6;
            for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
              if (Math.hypot(dx, dz) > r + rand() * 0.5) continue;
              const px = x + dx, pz = z + dz, py = y - d;
              if (blocks[idx(px, py, pz)] === 0) blocks[idx(px, py, pz)] = B.glowstone;
            }
          }
          break;
        }
      }
    }
    // Ember caps and eternal fires on the ground.
    for (let k = 0; k < 24; k++) {
      const x = Math.floor(rand() * CS), z = Math.floor(rand() * CS);
      for (let y = EMBER_CEILING - 5; y > EMBER_LAVA_LEVEL; y--) {
        const i = idx(x, y, z);
        const below = blocks[idx(x, y - 1, z)];
        if (blocks[i] === 0 && (below === B.cinderstone || below === B.ashsand)) {
          if (rand() < 0.35) blocks[i] = rand() < 0.3 && below === B.cinderstone ? B.fire : B.ember_cap;
          break;
        }
      }
    }
    if (rand() < 0.1) this.keep(blocks, meta, rand);
    return { blocks, meta, biomes, spawns: [] };
  }

  /** A small ruined keep of cinder bricks with a monster cage and loot. */
  private keep(blocks: Uint8Array, meta: Uint8Array, rand: () => number): void {
    const cx = 4 + Math.floor(rand() * 8), cz = 4 + Math.floor(rand() * 8);
    // Find floor: first air-over-solid going down from the middle.
    let floor = -1;
    for (let y = 100; y > EMBER_LAVA_LEVEL + 1; y--) {
      if (blocks[idx(cx, y, cz)] === 0 && blocks[idx(cx, y - 1, cz)] !== 0 && blocks[idx(cx, y - 1, cz)] !== B.lava) { floor = y; break; }
    }
    if (floor < 0) return;
    const R = 3;
    for (let y = floor - 1; y <= floor + 5; y++) for (let z = cz - R; z <= cz + R; z++) for (let x = cx - R; x <= cx + R; x++) {
      const edge = Math.abs(x - cx) === R || Math.abs(z - cz) === R;
      const i = idx(x, y, z);
      if (y === floor - 1 || y === floor + 5) blocks[i] = B.cinder_bricks;
      else if (edge) {
        const window = y === floor + 2 && (x === cx || z === cz);
        const door = (y === floor || y === floor + 1) && x === cx && z === cz - R;
        const ruined = y >= floor + 3 && rand() < 0.3;
        blocks[i] = window ? B.iron_bars : door || ruined ? 0 : B.cinder_bricks;
      } else blocks[i] = 0;
    }
    // Support pillars down to the ground or lava.
    for (const [px, pz] of [[cx - R, cz - R], [cx + R, cz - R], [cx - R, cz + R], [cx + R, cz + R]]) {
      for (let y = floor - 2; y > 4; y--) {
        const i = idx(px, y, pz);
        if (blocks[i] !== 0 && blocks[i] !== B.lava) break;
        blocks[i] = B.cinder_bricks;
      }
    }
    blocks[idx(cx, floor, cz)] = B.spawner;
    blocks[idx(cx + 2, floor, cz + 2)] = B.chest;
    meta[idx(cx + 2, floor, cz + 2)] = 1 | 16;
    blocks[idx(cx - 2, floor + 1, cz + 2)] = B.lantern;
  }
}
