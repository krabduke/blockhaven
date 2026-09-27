// Flood-fill lighting with two channels: sky light (sunlight, 0-15) and
// block light (torches, lava, glowstone). Stored packed as sky << 4 | block.
//
// Initial light for a freshly generated chunk is computed in isolation in the
// worker (computeChunkLight). The main thread then stitches borders with
// neighbouring chunks and handles incremental updates when blocks change.

import { EMIT, LIGHT_OPACITY } from '../blocks';
import { CH, CS, Chunk, VOLUME, idx } from './chunk';

const DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Chunk-local light, as if the chunk were surrounded by darkness at its sides. */
export function computeChunkLight(blocks: Uint8Array): Uint8Array {
  const light = new Uint8Array(VOLUME);
  const queue = new Int32Array(VOLUME * 2);
  let head = 0, tail = 0;
  const heights = new Int16Array(CS * CS);

  // Direct sunlight straight down each column.
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    let level = 15;
    let y = CH - 1;
    for (; y >= 0; y--) {
      const op = LIGHT_OPACITY[blocks[idx(x, y, z)]];
      if (op > 0) level -= op;
      if (level <= 0) break;
      light[idx(x, y, z)] = level << 4;
    }
    heights[x + z * CS] = y;
  }
  // Seed sunlit cells beside shadowed ones.
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    let top = heights[x + z * CS];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= CS || nz < 0 || nz >= CS) continue;
      top = Math.max(top, heights[nx + nz * CS]);
    }
    for (let y = Math.max(0, heights[x + z * CS] + 1); y <= Math.min(CH - 1, top + 1); y++) {
      const i = idx(x, y, z);
      if ((light[i] >> 4) > 1) queue[tail++] = i;
    }
  }
  // Also seed any partially-lit cells (under leaves/water).
  for (let i = 0; i < VOLUME; i++) {
    const s = light[i] >> 4;
    if (s > 1 && s < 15) queue[tail++] = i;
  }
  const spread = (shift: number) => {
    while (head < tail) {
      const i = queue[head++];
      const level = (light[i] >> shift) & 15;
      if (level <= 1) continue;
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      for (let d = 0; d < 6; d++) {
        const [dx, dy, dz] = DIRS[d];
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nx >= CS || nz < 0 || nz >= CS || ny < 0 || ny >= CH) continue;
        const ni = idx(nx, ny, nz);
        const op = LIGHT_OPACITY[blocks[ni]];
        if (op >= 15) continue;
        const nl = shift === 4 && dy === -1 && level === 15 && op === 0 ? 15 : level - Math.max(1, op);
        const cur = (light[ni] >> shift) & 15;
        if (nl > cur) {
          light[ni] = (light[ni] & ~(15 << shift)) | (nl << shift);
          if (tail >= queue.length) { queue.copyWithin(0, head, tail); tail -= head; head = 0; }
          queue[tail++] = ni;
        }
      }
    }
  };
  spread(4);
  // Block light from emitters.
  head = 0; tail = 0;
  for (let i = 0; i < VOLUME; i++) {
    const e = EMIT[blocks[i]];
    if (e > 0) { light[i] |= e; queue[tail++] = i; }
  }
  spread(0);
  return light;
}

export interface ChunkSource {
  getChunk(cx: number, cz: number): Chunk | undefined;
  /** Called when a cell's light changed, so the owning subchunk can be remeshed. */
  onLightChanged(x: number, y: number, z: number): void;
}

/** World-space light propagation across loaded chunks. */
export class LightEngine {
  private addQ: number[] = [];
  private remQ: number[] = [];

  constructor(private src: ChunkSource) {}

  private chunkAt(x: number, z: number): Chunk | undefined {
    return this.src.getChunk(x >> 4, z >> 4);
  }

  getLight(x: number, y: number, z: number, shift: number): number {
    if (y >= CH) return shift === 4 ? 15 : 0;
    if (y < 0) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return (c.light[idx(x & 15, y, z & 15)] >> shift) & 15;
  }

  private setLight(c: Chunk, x: number, y: number, z: number, shift: number, v: number): void {
    const i = idx(x & 15, y, z & 15);
    c.light[i] = (c.light[i] & ~(15 << shift)) | (v << shift);
    this.src.onLightChanged(x, y, z);
  }

  /** Seed propagation across the borders between this chunk and its loaded neighbours. */
  stitch(chunk: Chunk): void {
    const x0 = chunk.cx * CS, z0 = chunk.cz * CS;
    for (const shift of [4, 0]) {
      this.addQ.length = 0;
      for (let y = 0; y < CH; y++) {
        for (let k = 0; k < CS; k++) {
          // Cells on this chunk's edge and the matching cells just outside it.
          const pairs = [
            [x0, z0 + k, x0 - 1, z0 + k], [x0 + CS - 1, z0 + k, x0 + CS, z0 + k],
            [x0 + k, z0, x0 + k, z0 - 1], [x0 + k, z0 + CS - 1, x0 + k, z0 + CS],
          ];
          for (const [ax, az, bx, bz] of pairs) {
            const la = this.getLight(ax, y, az, shift), lb = this.getLight(bx, y, bz, shift);
            if (la > lb + 1) this.addQ.push(ax, y, az);
            else if (lb > la + 1 && this.chunkAt(bx, bz)) this.addQ.push(bx, y, bz);
          }
        }
      }
      this.propagate(shift);
    }
  }

  private propagate(shift: number): void {
    const q = this.addQ;
    let head = 0;
    while (head < q.length) {
      const x = q[head++], y = q[head++], z = q[head++];
      const level = this.getLight(x, y, z, shift);
      if (level <= 1) continue;
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < 0 || ny >= CH) continue;
        const c = this.chunkAt(nx, nz);
        if (!c) continue;
        const op = LIGHT_OPACITY[c.blocks[idx(nx & 15, ny, nz & 15)]];
        if (op >= 15) continue;
        const nl = shift === 4 && dy === -1 && level === 15 && op === 0 ? 15 : level - Math.max(1, op);
        if (nl > ((c.light[idx(nx & 15, ny, nz & 15)] >> shift) & 15)) {
          this.setLight(c, nx, ny, nz, shift, nl);
          q.push(nx, ny, nz);
        }
      }
      if (head > 300000) { q.splice(0, head); head = 0; }
    }
    q.length = 0;
  }

  /** Recompute light around a block that just changed. */
  update(x: number, y: number, z: number): void {
    const c = this.chunkAt(x, z);
    if (!c || y < 0 || y >= CH) return;
    const id = c.blocks[idx(x & 15, y, z & 15)];
    for (const shift of [4, 0]) {
      // 1. Remove light that depended on this cell.
      const old = this.getLight(x, y, z, shift);
      this.remQ.length = 0;
      this.addQ.length = 0;
      if (old > 0) {
        this.setLight(c, x, y, z, shift, 0);
        this.remQ.push(x, y, z, old);
      }
      // Sky: a newly opaque block also cuts off direct sunlight below it.
      let head = 0;
      const rq = this.remQ;
      while (head < rq.length) {
        const rx = rq[head++], ry = rq[head++], rz = rq[head++], rl = rq[head++];
        for (const [dx, dy, dz] of DIRS) {
          const nx = rx + dx, ny = ry + dy, nz = rz + dz;
          if (ny < 0 || ny >= CH) continue;
          const nc = this.chunkAt(nx, nz);
          if (!nc) continue;
          const nl = this.getLight(nx, ny, nz, shift);
          if (nl === 0) continue;
          const direct = shift === 4 && dy === -1 && rl === 15 && nl === 15;
          if (nl < rl || direct) {
            this.setLight(nc, nx, ny, nz, shift, 0);
            rq.push(nx, ny, nz, nl);
          } else {
            this.addQ.push(nx, ny, nz);
          }
        }
      }
      // 2. The cell's own emission.
      if (shift === 0 && EMIT[id] > 0) {
        this.setLight(c, x, y, z, 0, EMIT[id]);
        this.addQ.push(x, y, z);
      }
      // 3. Refill from neighbours (and from open sky above).
      if (shift === 4 && y === CH - 1 && LIGHT_OPACITY[id] === 0) {
        this.setLight(c, x, y, z, 4, 15);
        this.addQ.push(x, y, z);
      }
      for (const [dx, dy, dz] of DIRS) {
        if (this.getLight(x + dx, y + dy, z + dz, shift) > 0) this.addQ.push(x + dx, y + dy, z + dz);
      }
      this.propagate(shift);
    }
  }
}
