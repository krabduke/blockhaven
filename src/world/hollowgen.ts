// The Hollow: pale stone islands adrift in a starry void, reached through an
// Astral Gate. The great central island holds eight anchor stones on tall
// pillars (they mend the Hollow Colossus while they stand) and, at its heart,
// the dais where the way home opens once the Colossus falls. Far out, smaller
// islands drift, some crowned with the ruins of old watchtowers.

import { B } from '../blocks';
import { Simplex, hash3, mulberry32 } from '../noise';
import { CH, CS, idx } from './chunk';
import { BIOME, type GenResult } from './worldgen';

/** Height of the central island's surface. */
export const HOLLOW_TOP = 64;
/** Radius of the central island. */
export const HOLLOW_RADIUS = 72;
/** Where you arrive: on the island's southern rim. */
export const HOLLOW_ARRIVAL: [number, number, number] = [0.5, HOLLOW_TOP + 2, HOLLOW_RADIUS - 6.5];
const PILLAR_RING = 44;
const OUTER_CELL = 96;
const OUTER_START = 360;

/** The eight anchor pillars: [x, z, height above the surface]. */
export function anchorPillars(seed: number): [number, number, number][] {
  const r = mulberry32((seed ^ 0xa11c) >>> 0);
  const off = r() * Math.PI * 2;
  return Array.from({ length: 8 }, (_, i) => {
    const a = off + (i / 8) * Math.PI * 2;
    return [Math.round(Math.cos(a) * PILLAR_RING), Math.round(Math.sin(a) * PILLAR_RING), 14 + ((i * 5) % 4) * 6];
  });
}

export class HollowGen {
  private edge: Simplex;
  private under: Simplex;
  private top: Simplex;

  constructor(readonly seed: number) {
    this.edge = new Simplex(seed ^ 0x401);
    this.under = new Simplex(seed ^ 0x402);
    this.top = new Simplex(seed ^ 0x403);
  }

  /** An outer island for a grid cell, or null. */
  private outer(gx: number, gz: number): { x: number; z: number; r: number; y: number; ruin: boolean } | null {
    const h = (k: number) => hash3(this.seed + k, gx, 0, gz);
    const x = gx * OUTER_CELL + 16 + Math.floor(h(1) * (OUTER_CELL - 32));
    const z = gz * OUTER_CELL + 16 + Math.floor(h(2) * (OUTER_CELL - 32));
    if (Math.hypot(x, z) < OUTER_START || h(3) > 0.55) return null;
    return { x, z, r: 9 + h(4) * 18, y: 48 + Math.floor(h(5) * 32), ruin: h(6) < 0.25 };
  }

  generate(cx: number, cz: number): GenResult {
    const blocks = new Uint8Array(CS * CS * CH);
    const meta = new Uint8Array(CS * CS * CH);
    const biomes = new Uint8Array(CS * CS).fill(BIOME.hollow);
    const x0 = cx * CS, z0 = cz * CS;
    const put = (x: number, y: number, z: number, id: number, m = 0) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 1 || y >= CH) return;
      blocks[idx(lx, y, lz)] = id; meta[idx(lx, y, lz)] = m;
    };
    /** Carve one island: a gently rolling top over a long jagged underside. */
    const island = (icx: number, icz: number, radius: number, topY: number, depth: number, salt: number) => {
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        const d = Math.hypot(wx - icx, wz - icz);
        const rEdge = radius * (1 + this.edge.noise2(wx / 40 + salt, wz / 40) * 0.12);
        if (d > rEdge) continue;
        const t = d / rEdge;
        const surface = topY + Math.round(this.top.noise2(wx / 30 + salt, wz / 30) * 2 * (1 - t) - t * t * 2);
        const bottom = surface - Math.round((1 - t * t) * depth * (0.7 + (this.under.noise2(wx / 12 + salt, wz / 12) + 1) * 0.3)) - 2;
        for (let y = Math.max(1, bottom); y <= surface && y < CH; y++) blocks[idx(x, y, z)] = B.hollowstone;
        if (hash3(this.seed + 9, wx, surface, wz) < 0.025 && t < 0.92) blocks[idx(x, surface + 1, z)] = B.starbloom;
      }
    };

    // The central island.
    if (Math.hypot(x0 + 8, z0 + 8) < HOLLOW_RADIUS * 1.2 + 16) {
      island(0, 0, HOLLOW_RADIUS, HOLLOW_TOP, 48, 0);
      // Eight obsidian pillars, each crowned with an anchor stone in a small cage.
      for (const [px, pz, hgt] of anchorPillars(this.seed)) {
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 3) continue;
          for (let y = HOLLOW_TOP - 6; y <= HOLLOW_TOP + hgt; y++) put(px + dx, y, pz + dz, B.obsidian);
        }
        put(px, HOLLOW_TOP + hgt + 1, pz, B.anchor_stone);
      }
      // The heart dais: a ring of hollow bricks around the 3x3 well where the way home will open.
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        put(dx, HOLLOW_TOP, dz, d <= 1 ? B.obsidian : B.hollow_bricks);
        put(dx, HOLLOW_TOP + 1, dz, d === 4 || d === 2 ? B.hollow_bricks : 0);
        for (let y = HOLLOW_TOP + 2; y <= HOLLOW_TOP + 4; y++) put(dx, y, dz, 0);
      }
      for (const [dx, dz] of [[0, 2], [0, -2], [2, 0], [-2, 0], [0, 4], [0, -4], [4, 0], [-4, 0]]) put(dx, HOLLOW_TOP + 1, dz, 0);
      for (let y = HOLLOW_TOP + 1; y <= HOLLOW_TOP + 4; y++) put(0, y, 0, B.hollow_bricks);
      put(0, HOLLOW_TOP + 5, 0, B.anchor_stone);
      // A little landing of bricks where you arrive.
      const [ax, , az] = HOLLOW_ARRIVAL.map(Math.floor);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        put(ax + dx, HOLLOW_TOP, az + dz, B.hollow_bricks);
        for (let y = HOLLOW_TOP + 1; y <= HOLLOW_TOP + 4; y++) put(ax + dx, y, az + dz, 0);
      }
    }

    // Outer islands.
    const g0x = Math.floor((x0 - 48) / OUTER_CELL), g1x = Math.floor((x0 + CS + 48) / OUTER_CELL);
    const g0z = Math.floor((z0 - 48) / OUTER_CELL), g1z = Math.floor((z0 + CS + 48) / OUTER_CELL);
    for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
      const o = this.outer(gx, gz);
      if (!o) continue;
      island(o.x, o.z, o.r, o.y, o.r * 1.4, gx * 7 + gz * 13);
      if (o.ruin) this.ruin(o.x, o.y, o.z, put);
    }
    return { blocks, meta, biomes, spawns: [] };
  }

  /** A broken watchtower of hollow bricks with a chest at the top. */
  private ruin(x: number, y: number, z: number, put: (x: number, y: number, z: number, id: number, m?: number) => void): void {
    const h = 9 + Math.floor(hash3(this.seed + 20, x, 0, z) * 6);
    for (let dy = 1; dy <= h; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const wall = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      const broken = dy > h - 3 && hash3(this.seed + 21, x + dx, y + dy, z + dz) < 0.5;
      const door = dz === 2 && dx === 0 && dy <= 2;
      put(x + dx, y + dy, z + dz, wall && !broken && !door ? B.hollow_bricks : dy === h - 4 && !wall && !(dx === 0 && dz === -1) ? B.hollow_bricks : 0);
    }
    for (let dy = 1; dy <= h - 4; dy++) put(x, y + dy, z - 1, B.ladder, 0);
    put(x - 1, y + h - 3, z, B.chest, 16 | (5 << 5));
    put(x + 1, y + h - 3, z, B.lantern);
  }
}
