// A toolkit for building structures into one chunk at a time. Every structure is laid out in
// world coordinates; the builder quietly drops anything outside the chunk being generated, so
// the same code, run for each chunk a structure overlaps, assembles it seamlessly.

import { B, SPAWNER_KINDS } from '../blocks';
import { hash3 } from '../noise';
import { CH, CS, idx } from './chunk';
import type { Spawn } from './worldgen';

/**
 * Chest metadata: facing in bits 0-1, "fill with loot when first opened" in bit 4, and the loot
 * table split across bits 5-7 (low three bits) and 2-3 (high two), so tables 0-31 fit and chests
 * saved before there were more than eight tables still read the same.
 */
export function chestMeta(facing: number, table: number): number {
  return (facing & 3) | (((table >> 3) & 3) << 2) | 16 | ((table & 7) << 5);
}
export function lootTableOf(meta: number): number {
  return ((meta >> 5) & 7) | (((meta >> 2) & 3) << 3);
}

type Fill = number | ((x: number, y: number, z: number) => number);

export class Builder {
  readonly x0: number;
  readonly z0: number;
  constructor(private blocks: Uint8Array, private meta: Uint8Array, cx: number, cz: number, public seed: number, readonly spawns: Spawn[] = []) {
    this.x0 = cx * CS; this.z0 = cz * CS;
  }

  inside(x: number, z: number): boolean { const lx = x - this.x0, lz = z - this.z0; return lx >= 0 && lx < CS && lz >= 0 && lz < CS; }

  set(x: number, y: number, z: number, id: number, m = 0): void {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 1 || y >= CH) return;
    const i = idx(lx, y, lz);
    this.blocks[i] = id;
    this.meta[i] = m;
  }

  /** Block at a spot in this chunk, or -1 outside it. */
  get(x: number, y: number, z: number): number {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= CH) return -1;
    return this.blocks[idx(lx, y, lz)];
  }

  /** A repeatable coin flip for a spot (the same whichever chunk asks). */
  h(x: number, y: number, z: number, salt = 0): number { return hash3(this.seed + salt, x, y, z); }

  /** A weighted pick of blocks that varies block by block (the same whichever chunk asks). */
  mix(salt: number, ...opts: [number, number][]): (x: number, y: number, z: number) => number {
    const total = opts.reduce((a, o) => a + o[1], 0);
    return (x, y, z) => {
      let r = this.h(x, y, z, salt) * total;
      for (const [id, w] of opts) if ((r -= w) < 0) return id;
      return opts[opts.length - 1][0];
    };
  }

  chest(x: number, y: number, z: number, facing: number, table: number): void { this.set(x, y, z, B.chest, chestMeta(facing, table)); }
  spawner(x: number, y: number, z: number, kind: string): void { this.set(x, y, z, B.spawner, Math.max(0, SPAWNER_KINDS.indexOf(kind))); }
  /** A creature to spawn when this chunk is first made (only in the chunk that holds the spot). */
  spawn(kind: string, x: number, y: number, z: number, profession?: string): void {
    if (this.inside(Math.floor(x), Math.floor(z))) this.spawns.push({ kind, x: x + 0.5, y, z: z + 0.5, profession });
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: Fill, m = 0): void {
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0], [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0], [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
    // Only walk the part that overlaps this chunk.
    const sx = Math.max(ax, this.x0), ex = Math.min(bx, this.x0 + CS - 1), sz = Math.max(az, this.z0), ez = Math.min(bz, this.z0 + CS - 1);
    for (let x = sx; x <= ex; x++) for (let z = sz; z <= ez; z++) for (let y = ay; y <= by; y++) this.set(x, y, z, typeof id === 'number' ? id : id(x, y, z), m);
  }

  /** A hollow box: walls of `wall`, inside filled with `inner` (-1 leaves the inside alone). */
  room(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: Fill, inner = 0, floor?: Fill, ceiling?: Fill): void {
    this.fill(x0, y0, z0, x1, y1, z1, (x, y, z) => {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      const pick = (f: Fill) => (typeof f === 'number' ? f : f(x, y, z));
      if (y === y0 && floor !== undefined) return pick(floor);
      if (y === y1 && ceiling !== undefined) return pick(ceiling);
      if (edge || y === y0 || y === y1) return pick(wall);
      return inner < 0 ? Math.max(0, this.get(x, y, z)) : inner;
    });
  }

  /** Prop a structure up: fill down from `y` while there's air or fluid, up to `depth` blocks. */
  foundation(x: number, y: number, z: number, id: Fill, depth = 30): void {
    for (let yy = y; yy > Math.max(1, y - depth); yy--) {
      const b = this.get(x, yy, z);
      if (b < 0) return;
      if (b !== 0 && b !== B.water && b !== B.lava && b !== B.tall_grass && b !== B.snow_layer && b !== B.seagrass && b !== B.kelp) return;
      this.set(x, yy, z, typeof id === 'number' ? id : id(x, yy, z));
    }
  }

  /** Clear everything above a footprint up to `height` (so hillsides don't bury a building). */
  clearAbove(x0: number, z0: number, x1: number, z1: number, y: number, height: number, water = false): void {
    this.fill(x0, y, z0, x1, y + height, z1, (_x, yy) => (water && yy <= 62 ? B.water : 0));
  }

  /** Work in a turned local frame: u along the front, v back from it, `rot` quarter turns. */
  frame(ox: number, oy: number, oz: number, rot: number): Frame { return new Frame(this, ox, oy, oz, rot & 3); }
}

export class Frame {
  constructor(readonly b: Builder, readonly ox: number, readonly oy: number, readonly oz: number, readonly rot: number) {}
  at(u: number, v: number): [number, number] {
    switch (this.rot) {
      case 0: return [this.ox + u, this.oz + v];
      case 1: return [this.ox - v, this.oz + u];
      case 2: return [this.ox - u, this.oz - v];
      default: return [this.ox + v, this.oz - u];
    }
  }
  /** A local facing (0 +v, 1 -u, 2 -v, 3 +u) in world terms. */
  face(f: number): number { return (f + this.rot) & 3; }
  set(u: number, dy: number, v: number, id: number, m = 0): void { const [x, z] = this.at(u, v); this.b.set(x, this.oy + dy, z, id, m); }
  get(u: number, dy: number, v: number): number { const [x, z] = this.at(u, v); return this.b.get(x, this.oy + dy, z); }
  h(u: number, dy: number, v: number, salt = 0): number { const [x, z] = this.at(u, v); return this.b.h(x, this.oy + dy, z, salt); }
  fill(u0: number, d0: number, v0: number, u1: number, d1: number, v1: number, id: Fill, m = 0): void {
    for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v++) {
      const [x, z] = this.at(u, v);
      if (!this.b.inside(x, z)) continue;
      for (let d = Math.min(d0, d1); d <= Math.max(d0, d1); d++) this.b.set(x, this.oy + d, z, typeof id === 'number' ? id : id(x, this.oy + d, z), m);
    }
  }
  room(u0: number, d0: number, v0: number, u1: number, d1: number, v1: number, wall: Fill, inner = 0, floor?: Fill, ceiling?: Fill): void {
    this.fill(u0, d0, v0, u1, d1, v1, (x, y, z) => {
      const [u, v] = this.local(x, z), d = y - this.oy;
      const edge = u === Math.min(u0, u1) || u === Math.max(u0, u1) || v === Math.min(v0, v1) || v === Math.max(v0, v1);
      const pick = (f: Fill) => (typeof f === 'number' ? f : f(x, y, z));
      if (d === Math.min(d0, d1) && floor !== undefined) return pick(floor);
      if (d === Math.max(d0, d1) && ceiling !== undefined) return pick(ceiling);
      if (edge || d === Math.min(d0, d1) || d === Math.max(d0, d1)) return pick(wall);
      return inner < 0 ? Math.max(0, this.b.get(x, y, z)) : inner;
    });
  }
  /** World (x, z) back to local (u, v). */
  local(x: number, z: number): [number, number] {
    const dx = x - this.ox, dz = z - this.oz;
    switch (this.rot) {
      case 0: return [dx, dz];
      case 1: return [dz, -dx];
      case 2: return [-dx, -dz];
      default: return [-dz, dx];
    }
  }
  chest(u: number, dy: number, v: number, facing: number, table: number): void { const [x, z] = this.at(u, v); this.b.chest(x, this.oy + dy, z, this.face(facing), table); }
  spawner(u: number, dy: number, v: number, kind: string): void { const [x, z] = this.at(u, v); this.b.spawner(x, this.oy + dy, z, kind); }
  spawn(kind: string, u: number, dy: number, v: number, profession?: string): void { const [x, z] = this.at(u, v); this.b.spawn(kind, x, this.oy + dy, z, profession); }
  foundation(u: number, dy: number, v: number, id: Fill, depth = 30): void { const [x, z] = this.at(u, v); this.b.foundation(x, this.oy + dy, z, id, depth); }

  /** Level a yard: `top` at dy 0, `under` down to the ground beneath, and `clear` blocks of air above. */
  yard(u0: number, v0: number, u1: number, v1: number, top: Fill, under: Fill, clear = 10, air: Fill = 0): void {
    this.fill(u0, 1, v0, u1, clear, v1, air);
    this.fill(u0, 0, v0, u1, 0, v1, top);
    for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v++) this.foundation(u, -1, v, under, 16);
  }
  /** A local facing's (du, dv) step. */
  static step(f: number): [number, number] { return [[0, 1], [-1, 0], [0, -1], [1, 0]][f & 3] as [number, number]; }
  /** A wall banner (facing away from its wall) in a dye colour. */
  banner(u: number, dy: number, v: number, facing: number, color: number): void { this.set(u, dy, v, B.banner, this.face(facing) | (color << 2)); }
  ladder(u: number, d0: number, d1: number, v: number, facing: number): void { for (let d = d0; d <= d1; d++) this.set(u, d, v, B.ladder, this.face(facing)); }
  /** A log lying along local u (axis 'u') or v, in world terms. */
  logMeta(axis: 'u' | 'v'): number { return (axis === 'u') === (this.rot % 2 === 0) ? 1 : 2; }
}
