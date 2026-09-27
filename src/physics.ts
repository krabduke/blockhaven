// Collision shapes, voxel raycasting and tick-based body movement.
// Movement constants follow the classic block-game feel: 20 ticks/second,
// gravity 0.08 blocks/tick^2 with 0.98 drag, jump velocity 0.42.

import { B, BLOCKS, SOLID, connectsFence } from './blocks';

export interface Box { min: [number, number, number]; max: [number, number, number] }

export interface BlockReader {
  getBlockPhysics(x: number, y: number, z: number): number;
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
}

/** Stairs: meta bits 0-1 facing (the high side: 0 -z, 1 -x... see stairBoxes), bit 2 upside down. */
export function stairBoxes(meta: number): Box[] {
  const upside = (meta & 4) !== 0;
  const f = meta & 3;
  const base: Box = upside ? { min: [0, 0.5, 0], max: [1, 1, 1] } : { min: [0, 0, 0], max: [1, 0.5, 1] };
  const y0 = upside ? 0 : 0.5, y1 = upside ? 0.5 : 1;
  // Facing = the direction the player looked when placing; the tall half is on that side.
  const step: Box = f === 0 ? { min: [0, y0, 0], max: [1, y1, 0.5] }
    : f === 1 ? { min: [0, y0, 0], max: [0.5, y1, 1] }
    : f === 2 ? { min: [0, y0, 0.5], max: [1, y1, 1] }
    : { min: [0.5, y0, 0], max: [1, y1, 1] };
  return [base, step];
}

/** Fence post plus arms toward connecting neighbours. `tall` extends to 1.5 for collision. */
export function fenceBoxes(w: BlockReader | null, x: number, y: number, z: number, tall: boolean): Box[] {
  const h = tall ? 1.5 : 1;
  const out: Box[] = [{ min: [6 / 16, 0, 6 / 16], max: [10 / 16, h, 10 / 16] }];
  if (!w) return out;
  if (connectsFence(w.getBlock(x, y, z - 1))) out.push({ min: [7 / 16, 0, 0], max: [9 / 16, h, 6 / 16] });
  if (connectsFence(w.getBlock(x, y, z + 1))) out.push({ min: [7 / 16, 0, 10 / 16], max: [9 / 16, h, 1] });
  if (connectsFence(w.getBlock(x - 1, y, z))) out.push({ min: [0, 0, 7 / 16], max: [6 / 16, h, 9 / 16] });
  if (connectsFence(w.getBlock(x + 1, y, z))) out.push({ min: [10 / 16, 0, 7 / 16], max: [1, h, 9 / 16] });
  return out;
}

export function paneBoxes(w: BlockReader | null, x: number, y: number, z: number): Box[] {
  const c0 = 7 / 16, c1 = 9 / 16;
  if (!w) return [{ min: [c0, 0, c0], max: [c1, 1, c1] }];
  const n = connectsFence(w.getBlock(x, y, z - 1)), s = connectsFence(w.getBlock(x, y, z + 1));
  const we = connectsFence(w.getBlock(x - 1, y, z)), e = connectsFence(w.getBlock(x + 1, y, z));
  const none = !n && !s && !we && !e;
  const out: Box[] = [];
  if (n || s || none) out.push({ min: [c0, 0, n || none ? 0 : c0], max: [c1, 1, s || none ? 1 : c1] });
  if (we || e || none) out.push({ min: [we || none ? 0 : c0, 0, c0], max: [e || none ? 1 : c1, 1, c1] });
  return out;
}

export function trapdoorBox(meta: number): Box {
  const f = meta & 3, open = (meta & 4) !== 0, top = (meta & 8) !== 0, t = 3 / 16;
  if (!open) return top ? { min: [0, 1 - t, 0], max: [1, 1, 1] } : { min: [0, 0, 0], max: [1, t, 1] };
  if (f === 0) return { min: [0, 0, 1 - t], max: [1, 1, 1] };
  if (f === 2) return { min: [0, 0, 0], max: [1, 1, t] };
  if (f === 1) return { min: [1 - t, 0, 0], max: [1, 1, 1] };
  return { min: [0, 0, 0], max: [t, 1, 1] };
}

export function gateBox(meta: number, tall: boolean): Box | null {
  if (meta & 4) return tall ? null : { min: [0, 0, 0], max: [1, 1, 1] };
  const h = tall ? 1.5 : 1;
  return (meta & 1) === 0 ? { min: [0, 0, 7 / 16], max: [1, h, 9 / 16] } : { min: [7 / 16, 0, 0], max: [9 / 16, h, 1] };
}

const FULL: Box = { min: [0, 0, 0], max: [1, 1, 1] };

function doorBox(meta: number): Box {
  const facing = meta & 3, open = (meta >> 2) & 1;
  const side = open ? (facing + 1) & 3 : facing;
  const t = 3 / 16;
  if (side === 0) return { min: [0, 0, 0], max: [1, 1, t] };
  if (side === 2) return { min: [0, 0, 1 - t], max: [1, 1, 1] };
  if (side === 1) return { min: [1 - t, 0, 0], max: [1, 1, 1] };
  return { min: [0, 0, 0], max: [t, 1, 1] };
}

/** Boxes (in block-local coords) that stop movement. */
export function collisionBox(id: number, meta: number): Box | null {
  if (!SOLID[id]) return null;
  const d = BLOCKS[id];
  switch (d.shape) {
    case 'slabBottom': return { min: [0, 0, 0], max: [1, id === B.dirt_path ? 15 / 16 : 0.5, 1] };
    case 'cactus': return { min: [1 / 16, 0, 1 / 16], max: [15 / 16, 15 / 16, 15 / 16] };
    case 'door': return doorBox(meta);
    case 'bed': return { min: [0, 0, 0], max: [1, 9 / 16, 1] };
    case 'table': return { min: [0, 0, 0], max: [1, 12 / 16, 1] };
    case 'pane': return { min: [7 / 16, 0, 7 / 16], max: [9 / 16, 1, 9 / 16] };
    case 'trapdoor': return trapdoorBox(meta);
    case 'lantern': return id === B.bell ? { min: [4 / 16, 4 / 16, 4 / 16], max: [12 / 16, 1, 12 / 16] } : { min: [5 / 16, meta & 1 ? 2 / 16 : 0, 5 / 16], max: [11 / 16, (meta & 1 ? 2 / 16 : 0) + 9 / 16, 11 / 16] };
    case 'flat': return { min: [0, 0, 0], max: [1, 1 / 16, 1] };
    case 'cake': return { min: [1 / 16 + Math.min(6, meta & 7) * 2 / 16, 0, 1 / 16], max: [15 / 16, 8 / 16, 15 / 16] };
    case 'carpet': return { min: [0, 0, 0], max: [1, 1 / 16, 1] };
    case 'stairs': return FULL;
    case 'fence': return { min: [6 / 16, 0, 6 / 16], max: [10 / 16, 1, 10 / 16] };
    case 'gate': return gateBox(meta, false);
    default:
      if (id === B.chest) return { min: [1 / 16, 0, 1 / 16], max: [15 / 16, 14 / 16, 15 / 16] };
      if (id === B.farmland) return { min: [0, 0, 0], max: [1, 15 / 16, 1] };
      return FULL;
  }
}

/** Boxes used for the targeting outline and ray hits. */
export function selectionBox(id: number, meta: number): Box | null {
  const d = BLOCKS[id];
  if (id === 0 || d.fluid) return null;
  switch (d.shape) {
    case 'cross': return { min: [0.15, 0, 0.15], max: [0.85, id === B.tall_grass ? 0.8 : 0.9, 0.85] };
    case 'torch': {
      const lean = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]][meta & 7] ?? [0, 0];
      if ((meta & 7) === 0) return { min: [0.4, 0, 0.4], max: [0.6, 0.6, 0.6] };
      const cx = 0.5 - lean[0] * 0.3, cz = 0.5 - lean[1] * 0.3;
      return { min: [cx - 0.15, 0.2, cz - 0.15], max: [cx + 0.15, 0.8, cz + 0.15] };
    }
    case 'wire': return { min: [0, 0, 0], max: [1, 1 / 16, 1] };
    case 'plate': return { min: [1 / 16, 0, 1 / 16], max: [15 / 16, 1 / 16, 15 / 16] };
    case 'button': {
      const f = meta & 7;
      if (f === 0) return { min: [5 / 16, 0, 6 / 16], max: [11 / 16, 2 / 16, 10 / 16] };
      if (f === 1) return { min: [5 / 16, 6 / 16, 0], max: [11 / 16, 10 / 16, 2 / 16] };
      if (f === 2) return { min: [5 / 16, 6 / 16, 14 / 16], max: [11 / 16, 10 / 16, 1] };
      if (f === 3) return { min: [0, 6 / 16, 5 / 16], max: [2 / 16, 10 / 16, 11 / 16] };
      return { min: [14 / 16, 6 / 16, 5 / 16], max: [1, 10 / 16, 11 / 16] };
    }
    case 'sign': return (meta & 4) ? { min: [0, 4 / 16, 0], max: [1, 12 / 16, 1] } : { min: [0.25, 0, 0.25], max: [0.75, 1, 0.75] };
    case 'fire': return { min: [0, 0, 0], max: [1, 1 / 16, 1] };
    case 'portal': return null;
    case 'banner':
      if (meta & 64) return { min: [0.3, 0, 0.3], max: [0.7, 1, 0.7] };
    // falls through: wall banners are picked like a ladder
    case 'painting':
    case 'vine':
    case 'ladder': {
      const f = meta & 3, t = 2 / 16;
      if (f === 0) return { min: [0, 0, 0], max: [1, 1, t] };
      if (f === 2) return { min: [0, 0, 1 - t], max: [1, 1, 1] };
      if (f === 3) return { min: [0, 0, 0], max: [t, 1, 1] };
      return { min: [1 - t, 0, 0], max: [1, 1, 1] };
    }
    default:
      return collisionBox(id, meta) ?? FULL;
  }
}

export interface RayHit {
  pos: [number, number, number];
  normal: [number, number, number];
  point: [number, number, number];
  id: number;
  dist: number;
}

function rayBox(o: number[], d: number[], bmin: number[], bmax: number[]): { t: number; axis: number; sign: number } | null {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < bmin[a] || o[a] > bmax[a]) return null;
      continue;
    }
    let t1 = (bmin[a] - o[a]) / d[a], t2 = (bmax[a] - o[a]) / d[a];
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), axis, sign };
}

/** Voxel DDA raycast. `fluids` makes fluid source blocks hittable (buckets). */
export function raycast(w: BlockReader, origin: number[], dir: number[], maxDist: number, fluids = false): RayHit | null {
  let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
  const stepX = Math.sign(dir[0]), stepY = Math.sign(dir[1]), stepZ = Math.sign(dir[2]);
  const tDeltaX = stepX ? Math.abs(1 / dir[0]) : Infinity;
  const tDeltaY = stepY ? Math.abs(1 / dir[1]) : Infinity;
  const tDeltaZ = stepZ ? Math.abs(1 / dir[2]) : Infinity;
  let tMaxX = stepX ? ((stepX > 0 ? x + 1 - origin[0] : origin[0] - x) * tDeltaX) : Infinity;
  let tMaxY = stepY ? ((stepY > 0 ? y + 1 - origin[1] : origin[1] - y) * tDeltaY) : Infinity;
  let tMaxZ = stepZ ? ((stepZ > 0 ? z + 1 - origin[2] : origin[2] - z) * tDeltaZ) : Infinity;
  let t = 0;
  for (let i = 0; i < 200 && t <= maxDist; i++) {
    const id = w.getBlock(x, y, z);
    if (id !== 0) {
      const meta = w.getMeta(x, y, z);
      let box = selectionBox(id, meta);
      if (!box && fluids && BLOCKS[id].fluid && (meta & 15) === 0) box = FULL;
      if (box) {
        const o = [origin[0] - x, origin[1] - y, origin[2] - z];
        const hit = rayBox(o, dir, box.min, box.max);
        if (hit && hit.t <= maxDist) {
          const normal: [number, number, number] = [0, 0, 0];
          if (hit.axis >= 0) normal[hit.axis] = hit.sign;
          else normal[1] = 1;
          return {
            pos: [x, y, z], normal,
            point: [origin[0] + dir[0] * hit.t, origin[1] + dir[1] * hit.t, origin[2] + dir[2] * hit.t],
            id, dist: hit.t,
          };
        }
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; }
  }
  return null;
}

// ---------- Bodies ----------

export class Body {
  pos: [number, number, number];
  vel: [number, number, number] = [0, 0, 0];
  onGround = false;
  collidedH = false;
  inWater = false;
  inLava = false;
  eyeInWater = false;
  onLadder = false;
  inWeb = false;
  inPortal = false;
  inFire = false;
  fallDistance = 0;
  constructor(x: number, y: number, z: number, public width: number, public height: number) {
    this.pos = [x, y, z];
  }
  aabb(): Box {
    const hw = this.width / 2;
    return { min: [this.pos[0] - hw, this.pos[1], this.pos[2] - hw], max: [this.pos[0] + hw, this.pos[1] + this.height, this.pos[2] + hw] };
  }
}

function collectBoxes(w: BlockReader, box: Box, out: Box[]): void {
  out.length = 0;
  const x0 = Math.floor(box.min[0]), x1 = Math.floor(box.max[0] - 1e-7);
  const y0 = Math.floor(box.min[1]) - 1, y1 = Math.floor(box.max[1] - 1e-7);
  const z0 = Math.floor(box.min[2]), z1 = Math.floor(box.max[2] - 1e-7);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = w.getBlockPhysics(x, y, z);
    if (!SOLID[id]) continue;
    const meta = w.getMeta(x, y, z);
    const shape = BLOCKS[id].shape;
    const list = shape === 'stairs' ? stairBoxes(meta) : shape === 'fence' ? fenceBoxes(w, x, y, z, true) : shape === 'gate' ? [gateBox(meta, true)] : shape === 'pane' ? paneBoxes(w, x, y, z) : [collisionBox(id, meta)];
    for (const b of list) {
      if (!b) continue;
      out.push({ min: [x + b.min[0], y + b.min[1], z + b.min[2]], max: [x + b.max[0], y + b.max[1], z + b.max[2]] });
    }
  }
}

const tmpBoxes: Box[] = [];

function sweepAxis(boxes: Box[], a: Box, axis: number, d: number): number {
  const o1 = (axis + 1) % 3, o2 = (axis + 2) % 3;
  for (const b of boxes) {
    if (a.max[o1] <= b.min[o1] + 1e-7 || a.min[o1] >= b.max[o1] - 1e-7) continue;
    if (a.max[o2] <= b.min[o2] + 1e-7 || a.min[o2] >= b.max[o2] - 1e-7) continue;
    if (d > 0 && a.max[axis] <= b.min[axis] + 1e-7) d = Math.min(d, b.min[axis] - a.max[axis]);
    else if (d < 0 && a.min[axis] >= b.max[axis] - 1e-7) d = Math.max(d, b.max[axis] - a.min[axis]);
  }
  return d;
}

function expand(a: Box, dx: number, dy: number, dz: number): Box {
  return {
    min: [a.min[0] + Math.min(0, dx), a.min[1] + Math.min(0, dy), a.min[2] + Math.min(0, dz)],
    max: [a.max[0] + Math.max(0, dx), a.max[1] + Math.max(0, dy), a.max[2] + Math.max(0, dz)],
  };
}

function offsetBox(a: Box, dx: number, dy: number, dz: number): void {
  a.min[0] += dx; a.max[0] += dx; a.min[1] += dy; a.max[1] += dy; a.min[2] += dz; a.max[2] += dz;
}

/** Move with collision; returns the actual displacement. */
function collideMove(w: BlockReader, a: Box, dx: number, dy: number, dz: number): [number, number, number] {
  collectBoxes(w, expand(a, dx, dy, dz), tmpBoxes);
  const box: Box = { min: [...a.min], max: [...a.max] };
  const ry = sweepAxis(tmpBoxes, box, 1, dy); offsetBox(box, 0, ry, 0);
  const rx = sweepAxis(tmpBoxes, box, 0, dx); offsetBox(box, rx, 0, 0);
  const rz = sweepAxis(tmpBoxes, box, 2, dz);
  return [rx, ry, rz];
}

export function moveBody(w: BlockReader, body: Body, dx: number, dy: number, dz: number, stepHeight: number, sneakEdge: boolean): void {
  const a = body.aabb();
  // Sneaking: don't walk off edges.
  if (sneakEdge && body.onGround) {
    const test = (ox: number, oz: number) => {
      const b: Box = { min: [a.min[0] + ox, a.min[1] - 0.6, a.min[2] + oz], max: [a.max[0] + ox, a.min[1], a.max[2] + oz] };
      collectBoxes(w, b, tmpBoxes);
      return tmpBoxes.some((c) => c.max[1] > b.min[1] && c.min[1] < b.max[1] && c.max[0] > b.min[0] && c.min[0] < b.max[0] && c.max[2] > b.min[2] && c.min[2] < b.max[2]);
    };
    const step = 0.05;
    while (dx !== 0 && !test(dx, 0)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
    while (dz !== 0 && !test(0, dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    while (dx !== 0 && dz !== 0 && !test(dx, dz)) {
      dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    }
  }
  let [rx, ry, rz] = collideMove(w, a, dx, dy, dz);
  // Step up small ledges (slabs, stairs-like terrain).
  const blockedH = rx !== dx || rz !== dz;
  if (stepHeight > 0 && blockedH && (body.onGround || (dy < 0 && ry !== dy))) {
    const up = collideMove(w, a, 0, stepHeight, 0);
    const raised: Box = { min: [...a.min], max: [...a.max] };
    offsetBox(raised, 0, up[1], 0);
    const hz = collideMove(w, raised, dx, 0, dz);
    offsetBox(raised, hz[0], 0, hz[2]);
    const down = collideMove(w, raised, 0, -up[1] + Math.min(0, dy), 0);
    if (hz[0] * hz[0] + hz[2] * hz[2] > rx * rx + rz * rz + 1e-6) {
      rx = hz[0]; rz = hz[2]; ry = up[1] + down[1];
    }
  }
  body.pos[0] += rx; body.pos[1] += ry; body.pos[2] += rz;
  body.collidedH = Math.abs(rx - dx) > 1e-6 || Math.abs(rz - dz) > 1e-6;
  body.onGround = dy < 0 && Math.abs(ry - dy) > 1e-6;
  if (Math.abs(rx - dx) > 1e-6) body.vel[0] = 0;
  if (Math.abs(rz - dz) > 1e-6) body.vel[2] = 0;
  if (Math.abs(ry - dy) > 1e-6) body.vel[1] = 0;
}

/** Update fluid / ladder contact flags. */
export function updateContacts(w: BlockReader, body: Body, eyeHeight: number): void {
  const a = body.aabb();
  body.inWater = false; body.inLava = false; body.onLadder = false; body.inWeb = false; body.inPortal = false; body.inFire = false;
  const x0 = Math.floor(a.min[0] + 0.001), x1 = Math.floor(a.max[0] - 0.001);
  const y0 = Math.floor(a.min[1] + 0.001), y1 = Math.floor(a.max[1] - 0.4);
  const z0 = Math.floor(a.min[2] + 0.001), z1 = Math.floor(a.max[2] - 0.001);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = w.getBlock(x, y, z);
    if (id === B.water || BLOCKS[id].waterlogged) body.inWater = true;
    else if (id === B.lava) body.inLava = true;
    else if (id === B.cobweb) body.inWeb = true;
    else if (id === B.portal) body.inPortal = true;
    else if (id === B.fire) body.inFire = true;
  }
  const fx = Math.floor(body.pos[0]), fz = Math.floor(body.pos[2]);
  const feet = w.getBlock(fx, Math.floor(body.pos[1] + 0.01), fz);
  const head = w.getBlock(fx, Math.floor(body.pos[1] + 1), fz);
  body.onLadder = BLOCKS[feet].climbable || BLOCKS[head].climbable;
  const ey = body.pos[1] + eyeHeight;
  const eid = w.getBlock(fx, Math.floor(ey), fz);
  if (eid !== B.water && BLOCKS[eid].waterlogged) body.eyeInWater = true;
  else if (eid === B.water) {
    const meta = w.getMeta(fx, Math.floor(ey), fz);
    const above = w.getBlock(fx, Math.floor(ey) + 1, fz);
    const h = above === B.water ? 1 : (meta & 8) ? 1 : (meta & 7) === 0 ? 14 / 16 : (8 - (meta & 7)) / 9;
    body.eyeInWater = ey - Math.floor(ey) < h;
  } else body.eyeInWater = false;
}

export interface MoveInput {
  forward: number;
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  yaw: number;
  /** Leaping effect level (higher jumps). */
  jumpBoost?: number;
  /** Slow falling: drift down gently and take no fall damage. */
  slowFall?: boolean;
}

/** One 20 Hz physics tick for a walking/swimming/flying body. */
export function stepBody(w: BlockReader, body: Body, input: MoveInput, flying: boolean, speedMul = 1): void {
  let f = input.forward, s = input.strafe;
  const len = Math.hypot(f, s);
  if (len > 1) { f /= len; s /= len; }
  f *= 0.98; s *= 0.98;
  if (input.sneak && !flying) { f *= 0.3; s *= 0.3; }
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  const accelVec = (a: number) => {
    // yaw 0 looks toward -z; strafe right is +x.
    body.vel[0] += (s * cos - f * sin) * a;
    body.vel[2] += (-f * cos - s * sin) * a;
  };
  const prevY = body.pos[1];

  if (flying) {
    // Horizontal: top speed 0.55 blocks/tick (1.1 sprinting), reached in about half a second,
    // with a short glide when you let go.
    const drag = 0.8;
    accelVec((input.sprint ? 0.22 : 0.11) * speedMul);
    // Vertical: eases toward the target climb rate on the same timescale instead of snapping,
    // and climbs faster while sprinting so a sprinting climb keeps a sensible angle.
    const climb = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
    const vTarget = climb * 0.375 * (input.sprint ? 1.8 : 1) * Math.max(1, Math.sqrt(speedMul));
    body.vel[1] += (vTarget - body.vel[1]) * 0.45;
    moveBody(w, body, body.vel[0], body.vel[1], body.vel[2], 0, false);
    body.vel[0] *= drag; body.vel[2] *= drag;
    if (Math.abs(body.vel[1]) < 0.003) body.vel[1] = 0;
    body.fallDistance = 0;
    return;
  }

  if (body.inWater || body.inLava) {
    accelVec(0.02 * speedMul);
    if (input.jump) body.vel[1] += 0.04;
    moveBody(w, body, body.vel[0], body.vel[1], body.vel[2], 0.6, false);
    const drag = body.inLava ? 0.5 : 0.8;
    body.vel[0] *= drag; body.vel[1] *= drag; body.vel[2] *= drag;
    body.vel[1] -= 0.02;
    // Hop out onto a ledge.
    if (body.collidedH && input.jump) body.vel[1] = 0.3;
    body.fallDistance = 0;
    return;
  }

  const below = w.getBlockPhysics(Math.floor(body.pos[0]), Math.floor(body.pos[1] - 0.5), Math.floor(body.pos[2]));
  const slip = body.onGround ? (below === B.ice ? 0.98 : 0.6) * 0.91 : 0.91;
  if (body.onGround && BLOCKS[below].slow < 1) speedMul *= BLOCKS[below].slow;
  const accel = body.onGround ? 0.1 * (0.16277136 / (slip * slip * slip)) : 0.02;
  accelVec(accel * (input.sprint ? 1.3 : 1) * speedMul);
  if (input.jump && body.onGround) {
    body.vel[1] = 0.42 + (input.jumpBoost ?? 0) * 0.1;
    if (input.sprint) { body.vel[0] -= sin * 0.2; body.vel[2] -= cos * 0.2; }
  }
  if (body.onLadder) {
    body.vel[0] = Math.max(-0.15, Math.min(0.15, body.vel[0]));
    body.vel[2] = Math.max(-0.15, Math.min(0.15, body.vel[2]));
    body.vel[1] = Math.max(body.vel[1], input.sneak ? 0 : -0.15);
    body.fallDistance = 0;
  }
  if (body.inWeb) {
    // Cobwebs: crawl slowly and barely fall.
    body.vel[0] *= 0.25; body.vel[2] *= 0.25; body.vel[1] *= 0.05;
    body.fallDistance = 0;
  }
  moveBody(w, body, body.vel[0], body.vel[1], body.vel[2], 0.6, input.sneak);
  if (body.onLadder && (body.collidedH || input.jump)) body.vel[1] = 0.2;
  body.vel[1] = (body.vel[1] - 0.08) * 0.98;
  if (input.slowFall && body.vel[1] < -0.07) { body.vel[1] = -0.07; body.fallDistance = 0; }
  body.vel[0] *= slip; body.vel[2] *= slip;
  const dy = body.pos[1] - prevY;
  if (dy < 0 && !body.onGround) body.fallDistance -= dy;
}
