// Builds render geometry for one 16x16x16 subchunk. Input arrays are padded
// by one block on every side (18^3) so faces and lighting at the edges can
// look at neighbouring chunks without further lookups.
//
// Vertex format (packed to keep GPU memory low):
//   position  Int16 x4   (block coords * 16; w unused)
//   uv        Uint8 x4   (u*16, v*16, texture layer, flags: 1 = waving, 2 = liquid)
//   light     Uint8 x4   (sky*16, block*16, ao/face brightness 0-255, unused)
//   tint      Uint8 x4   (rgb multiplier, unused)

import { B, BLOCKS, OPAQUE, SHAPE_CUBE, connectsFence, isLeaves } from '../blocks';
import { gateBox, stairBoxes } from '../physics';
import { TINTED, tileIndex } from '../tiles';
import { BIOME_TINT } from './worldgen';

export const P = 18;
export const pidx = (x: number, y: number, z: number) => (x + 1) + (z + 1) * P + (y + 1) * P * P;

export interface MeshInput {
  blocks: Uint8Array; // P^3
  meta: Uint8Array; // P^3
  light: Uint8Array; // P^3, sky << 4 | block
  biomes: Uint8Array; // 16*16
}

export interface LayerMesh {
  pos: Int16Array;
  uv: Uint8Array;
  light: Uint8Array;
  tint: Uint8Array;
  index: Uint16Array | Uint32Array;
}

export interface SubMesh {
  opaque: LayerMesh | null;
  cutout: LayerMesh | null;
  translucent: LayerMesh | null;
}

class Builder {
  pos: number[] = [];
  uv: number[] = [];
  light: number[] = [];
  tint: number[] = [];
  index: number[] = [];
  verts = 0;

  vert(x: number, y: number, z: number, u: number, v: number, layer: number, flags: number, sky: number, blk: number, bright: number, t: readonly number[]): void {
    this.pos.push(Math.round(x * 16), Math.round(y * 16), Math.round(z * 16), 0);
    this.uv.push(Math.round(u * 16), Math.round(v * 16), layer, flags);
    this.light.push(Math.min(255, Math.round(sky * 16)), Math.min(255, Math.round(blk * 16)), Math.round(bright * 255), 0);
    this.tint.push(t[0], t[1], t[2], 255);
    this.verts++;
  }

  quad(flip: boolean, doubleSided = false): void {
    const b = this.verts - 4;
    if (flip) this.index.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    else this.index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    if (doubleSided) {
      if (flip) this.index.push(b + 1, b + 3, b + 2, b + 1, b, b + 3);
      else this.index.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  }

  build(): LayerMesh | null {
    if (this.verts === 0) return null;
    return {
      pos: new Int16Array(this.pos),
      uv: new Uint8Array(this.uv),
      light: new Uint8Array(this.light),
      tint: new Uint8Array(this.tint),
      index: this.verts > 65535 ? new Uint32Array(this.index) : new Uint16Array(this.index),
    };
  }
}

// Face definitions: normal, the 4 corners (in CCW order seen from outside),
// and the in-plane axes used for AO sampling.
interface FaceDef {
  n: [number, number, number];
  corners: [number, number, number][];
  shade: number;
}
const FACES: FaceDef[] = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6 }, // +x
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6 }, // -x
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 }, // +y
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 }, // -y
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8 }, // +z
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8 }, // -z
];
const AO_CURVE = [0.45, 0.65, 0.82, 1.0];
const WHITE = [255, 255, 255] as const;

/** Texture u,v for a point on a face, so partial boxes show matching partial textures. */
function faceUV(face: number, x: number, y: number, z: number): [number, number] {
  switch (face) {
    case 0: return [1 - z, 1 - y];
    case 1: return [z, 1 - y];
    case 2: return [x, z];
    case 3: return [x, 1 - z];
    case 4: return [x, 1 - y];
    default: return [1 - x, 1 - y];
  }
}

// Precompute tile layers per block/face.
const TILE_LAYERS: Int16Array = (() => {
  const t = new Int16Array(256 * 6).fill(-1);
  for (const b of BLOCKS) {
    if (b.shape === 'none') continue;
    for (let f = 0; f < 6; f++) {
      try { t[b.id * 6 + f] = tileIndex(b.tiles[f]); } catch { t[b.id * 6 + f] = 0; }
    }
  }
  return t;
})();
const TINTED_LAYER = new Uint8Array(1024);
for (const n of TINTED) TINTED_LAYER[tileIndex(n)] = 1;

const WAVING = new Uint8Array(256);
for (const b of BLOCKS) if (b.shape === 'cross' || isLeaves(b.id)) WAVING[b.id] = 1;
const LAYER_OF = new Uint8Array(256); // 0 opaque, 1 cutout, 2 translucent
for (const b of BLOCKS) LAYER_OF[b.id] = b.layer === 'opaque' ? 0 : b.layer === 'cutout' ? 1 : 2;

/** Facing stored in meta bits 0-1 for directional blocks: 0 = +z, 1 = -x, 2 = -z, 3 = +x. */
export function facingToFaceIndex(facing: number): number {
  return [4, 1, 5, 0][facing & 3];
}

export function meshSubchunk(input: MeshInput): SubMesh {
  const { blocks, meta, light, biomes } = input;
  const layers = [new Builder(), new Builder(), new Builder()];

  const skyAt = (i: number) => light[i] >> 4;
  const blkAt = (i: number) => light[i] & 15;

  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const i = pidx(x, y, z);
        const id = blocks[i];
        if (id === 0) continue;
        const def = BLOCKS[id];
        const bld = layers[LAYER_OF[id]];
        const bt = BIOME_TINT[biomes[x + z * 16]] ?? BIOME_TINT[1];
        const tint = [Math.round(bt[0] * 255), Math.round(bt[1] * 255), Math.round(bt[2] * 255)];
        const m = meta[i];

        if (SHAPE_CUBE[id]) {
          // Directional front face.
          const directional = id === B.furnace || id === B.furnace_lit || id === B.crafting_table || id === B.pumpkin || id === B.chest;
          const front = directional ? facingToFaceIndex(m) : -1;
          for (let f = 0; f < 6; f++) {
            const fd = FACES[f];
            const ni = pidx(x + fd.n[0], y + fd.n[1], z + fd.n[2]);
            const nid = blocks[ni];
            if (OPAQUE[nid]) continue;
            if (nid === id && !def.opaque && !isLeaves(id)) continue; // glass, ice
            let layer: number;
            if (directional) {
              const tiles = def.tiles;
              const name = f === front ? tiles[4] : f === 2 ? tiles[2] : f === 3 ? tiles[3] : tiles[0];
              layer = tileIndex(name);
            } else layer = TILE_LAYERS[id * 6 + f];
            if (id === B.chest) { box(bld, x, y, z, 1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16, f, layer, WHITE, light[i], 0, true); continue; }
            emitCubeFace(bld, blocks, light, x, y, z, f, layer, TINTED_LAYER[layer] ? tint : WHITE, WAVING[id]);
          }
          continue;
        }

        switch (def.shape) {
          case 'cross': {
            let layer = TILE_LAYERS[id * 6];
            if (id === B.wheat) layer = tileIndex('wheat_' + Math.min(7, m));
            if (id === B.carrots) layer = tileIndex('carrots_' + Math.min(3, m >> 1));
            const t = TINTED_LAYER[layer] ? tint : WHITE;
            const s = skyAt(i), bl = blkAt(i);
            const o = 0.15, flags = WAVING[id];
            // jitter position slightly like natural foliage
            const jx = id === B.tall_grass ? (((x * 7 + z * 13) % 5) - 2) / 32 : 0;
            const jz = id === B.tall_grass ? (((x * 11 + z * 3) % 5) - 2) / 32 : 0;
            for (const [ax, az, bx, bz] of [[o, o, 1 - o, 1 - o], [o, 1 - o, 1 - o, o]]) {
              bld.vert(x + ax + jx, y, z + az + jz, 0, 1, layer, 0, s, bl, 0.9, t);
              bld.vert(x + bx + jx, y, z + bz + jz, 1, 1, layer, 0, s, bl, 0.9, t);
              bld.vert(x + bx + jx, y + 1, z + bz + jz, 1, 0, layer, flags, s, bl, 0.9, t);
              bld.vert(x + ax + jx, y + 1, z + az + jz, 0, 0, layer, flags, s, bl, 0.9, t);
              bld.quad(false, true);
            }
            break;
          }
          case 'liquid':
            emitLiquid(layers[LAYER_OF[id]], blocks, meta, light, x, y, z, id);
            break;
          case 'cactus': {
            for (let f = 0; f < 6; f++) {
              const layer = TILE_LAYERS[id * 6 + f];
              const fd = FACES[f];
              if (fd.n[1] !== 0 && OPAQUE[blocks[pidx(x, y + fd.n[1], z)]]) continue;
              if (fd.n[1] === 1 && blocks[pidx(x, y + 1, z)] === id) continue;
              if (fd.n[1] === -1 && blocks[pidx(x, y - 1, z)] === id) continue;
              if (f < 2 || f > 3) box(bld, x, y, z, 1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16, f, layer, WHITE, light[i], 0, false, true);
              else box(bld, x, y, z, 0, 0, 0, 1, 1, 1, f, layer, WHITE, light[i], 0, false);
            }
            break;
          }
          case 'slabBottom':
            for (let f = 0; f < 6; f++) {
              const fd = FACES[f];
              const nid = blocks[pidx(x + fd.n[0], y + fd.n[1], z + fd.n[2])];
              if (f === 3 && OPAQUE[nid]) continue;
              if (f !== 2 && f !== 3 && OPAQUE[nid]) continue;
              box(bld, x, y, z, 0, 0, 0, 1, 0.5, 1, f, TILE_LAYERS[id * 6 + f], WHITE, f === 2 ? light[i] : light[pidx(x + fd.n[0], y + fd.n[1], z + fd.n[2])] || light[i], 0, true);
            }
            break;
          case 'torch':
            emitTorch(bld, x, y, z, m, TILE_LAYERS[id * 6], light[i], id === B.lever);
            break;
          case 'ladder': {
            const layer = TILE_LAYERS[id * 6];
            const s = skyAt(i), bl = blkAt(i);
            const facing = m & 3; // attached wall is on the opposite side of facing
            const d = 1 / 16;
            const quads: Record<number, [number, number, number][]> = {
              0: [[0, 0, d], [1, 0, d], [1, 1, d], [0, 1, d]],
              2: [[1, 0, 1 - d], [0, 0, 1 - d], [0, 1, 1 - d], [1, 1, 1 - d]],
              3: [[d, 0, 1], [d, 0, 0], [d, 1, 0], [d, 1, 1]],
              1: [[1 - d, 0, 0], [1 - d, 0, 1], [1 - d, 1, 1], [1 - d, 1, 0]],
            };
            const q = quads[facing];
            const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
            q.forEach((c, k) => bld.vert(x + c[0], y + c[1], z + c[2], uvs[k][0], uvs[k][1], layer, 0, s, bl, 0.8, WHITE));
            bld.quad(false, true);
            break;
          }
          case 'door':
            emitDoor(bld, x, y, z, m, light[i]);
            break;
          case 'stairs': {
            const layer = TILE_LAYERS[id * 6];
            for (const bx of stairBoxes(m)) emitBox(bld, blocks, light, x, y, z, bx.min, bx.max, layer, i);
            break;
          }
          case 'fence': {
            const layer = TILE_LAYERS[id * 6];
            emitBox(bld, blocks, light, x, y, z, [6 / 16, 0, 6 / 16], [10 / 16, 1, 10 / 16], layer, i);
            const arms: [number, number, number, number][] = [];
            if (connectsFence(blocks[pidx(x, y, z - 1)])) arms.push([7 / 16, 0, 9 / 16, 6 / 16]);
            if (connectsFence(blocks[pidx(x, y, z + 1)])) arms.push([7 / 16, 10 / 16, 9 / 16, 1]);
            if (connectsFence(blocks[pidx(x - 1, y, z)])) arms.push([0, 7 / 16, 6 / 16, 9 / 16]);
            if (connectsFence(blocks[pidx(x + 1, y, z)])) arms.push([10 / 16, 7 / 16, 1, 9 / 16]);
            for (const [ax0, az0, ax1, az1] of arms) {
              emitBox(bld, blocks, light, x, y, z, [ax0, 6 / 16, az0], [ax1, 9 / 16, az1], layer, i);
              emitBox(bld, blocks, light, x, y, z, [ax0, 12 / 16, az0], [ax1, 15 / 16, az1], layer, i);
            }
            break;
          }
          case 'gate': {
            const layer = TILE_LAYERS[id * 6];
            const alongX = (m & 1) === 0;
            const open = (m & 4) !== 0;
            // Posts at each end, plus two rails (swung 90 degrees when open).
            const posts: [number[], number[]][] = alongX
              ? [[[0, 5 / 16, 7 / 16], [2 / 16, 1, 9 / 16]], [[14 / 16, 5 / 16, 7 / 16], [1, 1, 9 / 16]]]
              : [[[7 / 16, 5 / 16, 0], [9 / 16, 1, 2 / 16]], [[7 / 16, 5 / 16, 14 / 16], [9 / 16, 1, 1]]];
            for (const [a, b] of posts) emitBox(bld, blocks, light, x, y, z, a, b, layer, i);
            for (const ry of [6 / 16, 12 / 16]) {
              if (!open) {
                if (alongX) emitBox(bld, blocks, light, x, y, z, [2 / 16, ry, 7 / 16], [14 / 16, ry + 3 / 16, 9 / 16], layer, i);
                else emitBox(bld, blocks, light, x, y, z, [7 / 16, ry, 2 / 16], [9 / 16, ry + 3 / 16, 14 / 16], layer, i);
              } else if (alongX) {
                emitBox(bld, blocks, light, x, y, z, [0, ry, 9 / 16], [2 / 16, ry + 3 / 16, 15 / 16], layer, i);
                emitBox(bld, blocks, light, x, y, z, [14 / 16, ry, 9 / 16], [1, ry + 3 / 16, 15 / 16], layer, i);
              } else {
                emitBox(bld, blocks, light, x, y, z, [9 / 16, ry, 0], [15 / 16, ry + 3 / 16, 2 / 16], layer, i);
                emitBox(bld, blocks, light, x, y, z, [9 / 16, ry, 14 / 16], [15 / 16, ry + 3 / 16, 1], layer, i);
              }
            }
            void gateBox;
            break;
          }
          case 'table':
            for (let f = 0; f < 6; f++) {
              const fd = FACES[f];
              if (f === 3 && OPAQUE[blocks[pidx(x, y - 1, z)]]) continue;
              const nl = f === 2 ? light[i] : light[pidx(x + fd.n[0], y + fd.n[1], z + fd.n[2])] || light[i];
              box(bld, x, y, z, 0, 0, 0, 1, 12 / 16, 1, f, TILE_LAYERS[id * 6 + f], WHITE, nl, 0);
            }
            break;
          case 'bed':
            emitBed(bld, blocks, x, y, z, m, light[i]);
            break;
        }
      }
    }
  }
  return { opaque: layers[0].build(), cutout: layers[1].build(), translucent: layers[2].build() };
}

function emitCubeFace(bld: Builder, blocks: Uint8Array, light: Uint8Array, x: number, y: number, z: number, f: number, layer: number, tint: readonly number[], waving: number): void {
  const fd = FACES[f];
  const [nx, ny, nz] = fd.n;
  // Two in-plane axes.
  const ua: [number, number, number] = nx !== 0 ? [0, 1, 0] : [1, 0, 0];
  const va: [number, number, number] = nz !== 0 || nx !== 0 ? (nx !== 0 ? [0, 0, 1] : [0, 1, 0]) : [0, 0, 1];
  const ox = x + nx, oy = y + ny, oz = z + nz;
  const centerLight = light[pidx(ox, oy, oz)];
  const aos: number[] = [], skies: number[] = [], blks: number[] = [];
  for (const c of fd.corners) {
    // Direction of this corner along each in-plane axis: -1 or +1.
    const du = (c[0] * ua[0] + c[1] * ua[1] + c[2] * ua[2]) ? 1 : -1;
    const dv = (c[0] * va[0] + c[1] * va[1] + c[2] * va[2]) ? 1 : -1;
    const s1x = ox + ua[0] * du, s1y = oy + ua[1] * du, s1z = oz + ua[2] * du;
    const s2x = ox + va[0] * dv, s2y = oy + va[1] * dv, s2z = oz + va[2] * dv;
    const cx = ox + ua[0] * du + va[0] * dv, cy = oy + ua[1] * du + va[1] * dv, cz = oz + ua[2] * du + va[2] * dv;
    const i1 = pidx(s1x, s1y, s1z), i2 = pidx(s2x, s2y, s2z), ic = pidx(cx, cy, cz);
    const o1 = OPAQUE[blocks[i1]], o2 = OPAQUE[blocks[i2]], oc = OPAQUE[blocks[ic]];
    const ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
    aos.push(ao);
    // Smooth light: average the light of the non-opaque cells around this corner.
    let sSum = centerLight >> 4, bSum = centerLight & 15, n = 1;
    if (!o1) { sSum += light[i1] >> 4; bSum += light[i1] & 15; n++; }
    if (!o2) { sSum += light[i2] >> 4; bSum += light[i2] & 15; n++; }
    if (!oc && !(o1 && o2)) { sSum += light[ic] >> 4; bSum += light[ic] & 15; n++; }
    skies.push(sSum / n);
    blks.push(bSum / n);
  }
  for (let k = 0; k < 4; k++) {
    const c = fd.corners[k];
    const [u, v] = faceUV(f, c[0], c[1], c[2]);
    const flags = waving && c[1] === 1 ? 1 : 0;
    bld.vert(x + c[0], y + c[1], z + c[2], u, v, layer, flags, skies[k], blks[k], fd.shade * AO_CURVE[aos[k]], tint);
  }
  // Flip the triangulation so AO interpolates without a visible seam.
  bld.quad(aos[0] + aos[2] < aos[1] + aos[3]);
}

/** Axis-aligned box face with flat lighting (used for non-cube shapes). */
function box(bld: Builder, x: number, y: number, z: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: number, layer: number, tint: readonly number[], packedLight: number, flags: number, _unused = false, insetSides = false): void {
  const fd = FACES[f];
  const s = packedLight >> 4, bl = packedLight & 15;
  for (const c of fd.corners) {
    let px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
    if (insetSides) { /* cactus sides are already inset via x0/x1 */ }
    const [u, v] = faceUV(f, px, py, pz);
    bld.vert(x + px, y + py, z + pz, u, v, layer, flags, s, bl, fd.shade, tint);
  }
  bld.quad(false);
}

/** A sub-box with flat lighting, skipping faces flush against opaque neighbours. */
function emitBox(bld: Builder, blocks: Uint8Array, light: Uint8Array, x: number, y: number, z: number, mn: number[], mx: number[], layer: number, selfIdx: number): void {
  for (let f = 0; f < 6; f++) {
    const fd = FACES[f];
    const onEdge = (fd.n[0] === 1 && mx[0] === 1) || (fd.n[0] === -1 && mn[0] === 0) || (fd.n[1] === 1 && mx[1] === 1) || (fd.n[1] === -1 && mn[1] === 0) || (fd.n[2] === 1 && mx[2] === 1) || (fd.n[2] === -1 && mn[2] === 0);
    const ni = pidx(x + fd.n[0], y + fd.n[1], z + fd.n[2]);
    if (onEdge && OPAQUE[blocks[ni]]) continue;
    const pl = onEdge ? light[ni] : light[selfIdx];
    box(bld, x, y, z, mn[0], mn[1], mn[2], mx[0], mx[1], mx[2], f, layer, WHITE, pl || light[selfIdx], 0);
  }
}

function emitTorch(bld: Builder, x: number, y: number, z: number, m: number, layer: number, packedLight: number, lever: boolean): void {
  // m: 0 floor, 1..4 attached to wall on -z, +z, -x, +x side (torch leans away from wall).
  const w = 1 / 16;
  const h = lever ? 8 / 16 : 10 / 16;
  const on = lever && (m & 8) !== 0;
  m &= 7;
  const s = packedLight >> 4, bl = Math.max(packedLight & 15, lever ? 0 : 14);
  const lean: [number, number] = ([[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]][m] ?? [0, 0]) as [number, number];
  const baseY = m === 0 ? 0 : 3 / 16;
  const shift = m === 0 ? 0 : 5 / 16;
  const cx = 0.5 - lean[0] * shift, cz = 0.5 - lean[1] * shift;
  const tilt = m === 0 ? (lever ? (on ? 0.6 : -0.6) : 0) : on ? -0.4 : 0.4;
  const pt = (px: number, py: number, pz: number): [number, number, number] => {
    const t = (py - baseY) * tilt;
    // Floor levers tip along x; wall torches/levers lean away from their wall.
    if (m === 0) return [x + px + t, y + py, z + pz];
    return [x + px + lean[0] * t, y + py, z + pz + lean[1] * t];
  };
  const x0 = cx - w, x1 = cx + w, z0 = cz - w, z1 = cz + w, y0 = baseY, y1 = baseY + h;
  for (let f = 0; f < 6; f++) {
    if (f === 3 && m === 0) continue;
    const fd = FACES[f];
    for (const c of fd.corners) {
      const px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
      // Map uv to the centre strip of the tile regardless of box position.
      let u: number, v: number;
      if (f === 2 || f === 3) { u = 7 / 16 + (c[0] ? 2 / 16 : 0); v = 6 / 16 + (c[2] ? 2 / 16 : 0); }
      else { u = 7 / 16 + ((f < 2 ? c[2] : c[0]) ? 2 / 16 : 0); v = c[1] ? 16 / 16 - h : 1; }
      const [vx, vy, vz] = pt(px, py, pz);
      bld.vert(vx, vy, vz, u, v, layer, 0, s, bl, fd.shade, WHITE);
    }
    bld.quad(false);
  }
}

function emitDoor(bld: Builder, x: number, y: number, z: number, m: number, packedLight: number): void {
  // meta: bits 0-1 facing, bit 2 open, bit 3 top half.
  const facing = m & 3, open = (m >> 2) & 1, top = (m >> 3) & 1;
  const t = 3 / 16;
  // Closed door sits on the side the player faced when placing; open rotates 90°.
  const side = open ? (facing + 1) & 3 : facing;
  let x0 = 0, x1 = 1, z0 = 0, z1 = 1;
  if (side === 0) z1 = t; else if (side === 2) z0 = 1 - t; else if (side === 1) x0 = 1 - t; else x1 = t;
  const layer = tileIndex(top ? 'door_top' : 'door_bottom');
  for (let f = 0; f < 6; f++) box(bld, x, y, z, x0, 0, z0, x1, 1, z1, f, layer, WHITE, packedLight, 0);
}

function emitBed(bld: Builder, blocks: Uint8Array, x: number, y: number, z: number, m: number, packedLight: number): void {
  // meta: bits 0-1 facing (direction from foot to head), bit 3 = head part.
  const head = (m >> 3) & 1;
  const topLayer = tileIndex(head ? 'bed_top' : 'bed_foot');
  const sideLayer = tileIndex('bed_side');
  const h = 9 / 16;
  for (let f = 0; f < 6; f++) {
    if (f === 3) { box(bld, x, y, z, 0, 3 / 16, 0, 1, h, 1, f, tileIndex('planks'), WHITE, packedLight, 0); continue; }
    const fd = FACES[f];
    if (f !== 2 && blocks[pidx(x + fd.n[0], y, z + fd.n[2])] === B.bed) continue;
    box(bld, x, y, z, 0, 0, 0, 1, h, 1, f, f === 2 ? topLayer : sideLayer, WHITE, packedLight, 0);
  }
  void m;
}

/** Fluid height (0..1) of the cell for smooth surfaces. */
function fluidHeight(blocks: Uint8Array, meta: Uint8Array, x: number, y: number, z: number, id: number): number {
  const i = pidx(x, y, z);
  if (blocks[i] !== id) return -1;
  if (blocks[pidx(x, y + 1, z)] === id) return 1;
  const level = meta[i] & 7;
  return level === 0 ? 14 / 16 : Math.max(0.1, (8 - level) / 9);
}

function emitLiquid(bld: Builder, blocks: Uint8Array, meta: Uint8Array, light: Uint8Array, x: number, y: number, z: number, id: number): void {
  const layer = tileIndex(id === B.water ? 'water' : 'lava');
  const flowLayer = id === B.water ? tileIndex('water_flow') : layer;
  const i = pidx(x, y, z);
  const s = light[i] >> 4, bl = Math.max(light[i] & 15, id === B.lava ? 15 : 0);
  const flags = 2;
  // Corner heights: average of the up to 4 cells sharing the corner.
  const corner = (cx: number, cz: number) => {
    let sum = 0, n = 0;
    for (const [dx, dz] of [[cx - 1, cz - 1], [cx, cz - 1], [cx - 1, cz], [cx, cz]]) {
      if (blocks[pidx(x + dx, y + 1, z + dz)] === id) return 1;
      const h = fluidHeight(blocks, meta, x + dx, y, z + dz, id);
      if (h >= 0) { sum += h; n++; }
      else if (!OPAQUE[blocks[pidx(x + dx, y, z + dz)]]) { n += 0.3; }
    }
    return n ? sum / n : 14 / 16;
  };
  const h00 = corner(0, 0), h10 = corner(1, 0), h01 = corner(0, 1), h11 = corner(1, 1);
  const ht = (cx: number, cz: number) => (cx ? (cz ? h11 : h10) : (cz ? h01 : h00));
  const level = meta[i] & 7;
  for (let f = 0; f < 6; f++) {
    const fd = FACES[f];
    const ni = pidx(x + fd.n[0], y + fd.n[1], z + fd.n[2]);
    const nid = blocks[ni];
    if (nid === id) continue;
    if (f !== 2 && OPAQUE[nid]) continue;
    if (f === 2 && blocks[pidx(x, y + 1, z)] === id) continue;
    const nl = f === 2 ? light[i] : light[ni];
    const ns = Math.max(nl >> 4, f === 2 ? s : 0), nb = Math.max(nl & 15, bl);
    const lyr = f === 2 && level === 0 ? layer : f === 2 ? flowLayer : layer;
    for (const c of fd.corners) {
      const py = c[1] ? ht(c[0], c[2]) : 0;
      const [u, v] = faceUV(f, c[0], py, c[2]);
      bld.vert(x + c[0], y + py, z + c[2], u, v, lyr, flags, ns, nb, fd.shade, WHITE);
    }
    bld.quad(false, id === B.water && f === 2);
  }
}
