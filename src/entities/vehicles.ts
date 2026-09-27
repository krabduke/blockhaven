// Boats and minecarts: entities the player can ride. A vehicle reads the
// rider's movement keys each tick; the game keeps the player seated on it.

import * as THREE from 'three';
import { B, BLOCKS, RAIL_DIRS, RAIL_EXITS, isRail } from '../blocks';
import { I } from '../items';
import { Body, moveBody } from '../physics';
import { Entity } from './entity';
import { build, faces, px, tone, type MobModel } from './models';
import type { EntityManager } from './entities';

/** What the rider is doing this tick. */
export interface RiderInput { forward: number; strafe: number; jump: boolean; yaw: number; sprint: boolean }

export abstract class Vehicle extends Entity {
  /** Being ridden by the player. */
  ridden = false;
  input: RiderInput = { forward: 0, strafe: 0, jump: false, yaw: 0, sprint: false };
  yaw = 0;
  hits = 0;
  hitCooldown = 0;
  /** Height of the seat above the vehicle's base. */
  abstract readonly seat: number;
  abstract readonly item: number;
  abstract readonly kind: 'boat' | 'minecart';

  /** A punch: two quick hits break it back into an item. */
  hit(m: EntityManager): void {
    if (this.hitCooldown > 0) return;
    this.hitCooldown = 6;
    this.object.rotation.z = 0.2;
    if (++this.hits >= 2) {
      this.dead = true;
      m.dropItem(this.body.pos[0], this.body.pos[1] + 0.4, this.body.pos[2], { id: this.item, count: 1 });
      m.puff(this.body.pos[0], this.body.pos[1] + 0.4, this.body.pos[2]);
    }
  }

  protected common(): void {
    this.prev = [...this.body.pos];
    this.age++;
    if (this.hitCooldown > 0) this.hitCooldown--;
    else if (this.age % 40 === 0) this.hits = 0;
  }

  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    this.object.rotation.y = this.yaw;
    this.object.rotation.z *= 0.8;
  }

  serialize(): { kind: string; pos: number[]; yaw: number } {
    return { kind: this.kind, pos: [...this.body.pos], yaw: this.yaw };
  }
}

// ---------------------------------------------------------------- Boat
function boatModel(): MobModel {
  const plank = tone('#a8804a', { top: '#b8905a', bottom: '#7a5a30' });
  const dark = tone('#7a5a30', { top: '#8a6a3a' });
  const boards = faces(plank, { 0: (g, w, h) => { for (let y = 1; y < h; y += 3) px(g, 'rgba(60,40,20,0.35)', 0, y, w, 1); }, 1: (g, w, h) => { for (let y = 1; y < h; y += 3) px(g, 'rgba(60,40,20,0.35)', 0, y, w, 1); } });
  return build('boat', [
    { name: 'hull', size: [14, 2, 24], pivot: [0, 1, 0], offset: [0, 0, 0], paint: plank },
    { name: 'sideL', size: [2, 5, 24], pivot: [-7, 2, 0], offset: [0, 1.5, 0], paint: boards },
    { name: 'sideR', size: [2, 5, 24], pivot: [7, 2, 0], offset: [0, 1.5, 0], paint: boards },
    { name: 'bow', size: [12, 5, 2], pivot: [0, 2, -12], offset: [0, 1.5, 0], paint: boards },
    { name: 'stern', size: [12, 5, 2], pivot: [0, 2, 12], offset: [0, 1.5, 0], paint: boards },
    { name: 'seat', size: [12, 1, 4], pivot: [0, 4, 2], offset: [0, 0, 0], paint: dark },
    { name: 'oarL', size: [1, 1, 14], pivot: [-8, 5, 0], offset: [0, 0, 5], paint: dark, rot: [0.4, 0.3, -0.5], extra: [{ size: [1, 3, 4], offset: [0, 0, 12], paint: dark }] },
    { name: 'oarR', size: [1, 1, 14], pivot: [8, 5, 0], offset: [0, 0, 5], paint: dark, rot: [0.4, -0.3, 0.5], extra: [{ size: [1, 3, 4], offset: [0, 0, 12], paint: dark }] },
  ], 1.6);
}

export class Boat extends Vehicle {
  readonly seat = 0.25;
  readonly item = I.boat;
  readonly kind = 'boat' as const;
  private model: MobModel;
  private rowing = 0;
  constructor(x: number, y: number, z: number, yaw = 0) {
    const model = boatModel();
    super(new Body(x, y, z, 1.3, 0.55), model.root);
    this.model = model;
    this.yaw = yaw;
  }

  tick(m: EntityManager): void {
    this.common();
    const b = this.body, w = m.world;
    // Float: find the water surface under the boat and settle a little below it.
    const bx = Math.floor(b.pos[0]), bz = Math.floor(b.pos[2]);
    let surface = -1;
    for (let y = Math.floor(b.pos[1] + 1); y >= Math.floor(b.pos[1]) - 1; y--) {
      if (w.getBlock(bx, y, bz) === B.water) { surface = y + (w.getBlock(bx, y + 1, bz) === B.water ? 1 : 14 / 16); break; }
    }
    const afloat = surface >= 0 && b.pos[1] < surface + 0.2;
    if (afloat) b.vel[1] += (surface - 0.2 - b.pos[1]) * 0.12 - b.vel[1] * 0.25;
    else b.vel[1] -= 0.04;
    // Rowing and steering.
    const inp = this.ridden ? this.input : { forward: 0, strafe: 0, jump: false, yaw: this.yaw, sprint: false };
    this.yaw -= inp.strafe * 0.06;
    const push = inp.forward > 0 ? 0.035 : inp.forward < 0 ? -0.012 : 0;
    b.vel[0] -= Math.sin(this.yaw) * push * (afloat ? 1 : 0.15);
    b.vel[2] -= Math.cos(this.yaw) * push * (afloat ? 1 : 0.15);
    moveBody(w, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
    const drag = afloat ? 0.9 : b.onGround ? 0.5 : 0.95;
    b.vel[0] *= drag; b.vel[2] *= drag;
    if (b.onGround) b.vel[1] = 0;
    this.rowing = inp.forward !== 0 || inp.strafe !== 0 ? this.rowing + 0.35 : this.rowing;
    if (b.pos[1] < -20) this.dead = true;
  }

  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    const p = this.model.parts;
    const r = this.rowing;
    p.oarL.rotation.set(0.4 + Math.sin(r) * 0.5, 0.3 + Math.cos(r) * 0.4, -0.5);
    p.oarR.rotation.set(0.4 + Math.sin(r) * 0.5, -0.3 - Math.cos(r) * 0.4, 0.5);
    // A gentle bob on the water.
    p.body.position.y = Math.sin(this.age * 0.08) * 0.02;
    p.body.rotation.x = Math.sin(this.age * 0.05) * 0.02;
  }
}

// ---------------------------------------------------------------- Minecart
function cartModel(): MobModel {
  const iron = tone('#8a8a90', { top: '#a8a8ae', bottom: '#5a5a60' });
  const rivets = faces(iron, { 0: (g, w, h) => { for (let x = 1; x < w; x += 4) { px(g, '#c8c8cc', x, 1); px(g, '#c8c8cc', x, h - 2); } }, 1: (g, w, h) => { for (let x = 1; x < w; x += 4) { px(g, '#c8c8cc', x, 1); px(g, '#c8c8cc', x, h - 2); } }, 4: (g, w, h) => { for (let x = 1; x < w; x += 4) px(g, '#c8c8cc', x, h - 2); }, 5: (g, w, h) => { for (let x = 1; x < w; x += 4) px(g, '#c8c8cc', x, h - 2); } });
  const wheel = tone('#3a3a3e', { top: '#4a4a4e' });
  return build('minecart', [
    { name: 'floor', size: [12, 1, 16], pivot: [0, 3, 0], offset: [0, 0, 0], paint: iron },
    { name: 'wallL', size: [1, 7, 16], pivot: [-6, 3, 0], offset: [0, 3.5, 0], paint: rivets },
    { name: 'wallR', size: [1, 7, 16], pivot: [6, 3, 0], offset: [0, 3.5, 0], paint: rivets },
    { name: 'wallF', size: [11, 7, 1], pivot: [0, 3, -8], offset: [0, 3.5, 0], paint: rivets },
    { name: 'wallB', size: [11, 7, 1], pivot: [0, 3, 8], offset: [0, 3.5, 0], paint: rivets },
    ...[-5, 5].flatMap((z) => [-6.5, 6.5].map((x, i) => ({ name: `wheel${z}${i}`, size: [1, 3, 3] as [number, number, number], pivot: [x, 2, z] as [number, number, number], offset: [0, 0, 0] as [number, number, number], paint: wheel }))),
  ], 1.2);
}

export class Minecart extends Vehicle {
  readonly seat = 0.2;
  readonly item = I.minecart;
  readonly kind = 'minecart' as const;
  private model: MobModel;
  /** Speed along the track (blocks per tick, signed along the rail's a->b direction). */
  private dirVec: [number, number, number] = [0, 0, 1];
  pitch = 0;
  constructor(x: number, y: number, z: number, yaw = 0) {
    const model = cartModel();
    super(new Body(x, y, z, 0.98, 0.7), model.root);
    this.model = model;
    this.yaw = yaw;
  }

  /** The rail the cart is on (its own block, or the one below when it sits on a slope's top). */
  private railAt(m: EntityManager): [number, number, number, number] | null {
    const w = m.world, b = this.body.pos;
    const x = Math.floor(b[0]), y = Math.floor(b[1] + 0.1), z = Math.floor(b[2]);
    for (const yy of [y, y - 1]) {
      const s = w.railShape(x, yy, z);
      if (s >= 0) return [x, yy, z, s];
    }
    return null;
  }

  tick(m: EntityManager): void {
    this.common();
    const b = this.body, w = m.world;
    const rail = this.railAt(m);
    if (!rail) {
      // Off the rails: slide to a stop, falling if there's nothing below.
      b.vel[1] -= 0.04;
      moveBody(w, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
      const drag = b.onGround ? 0.5 : 0.95;
      b.vel[0] *= drag; b.vel[2] *= drag;
      if (b.onGround) b.vel[1] = 0;
      this.pitch *= 0.8;
      if (b.pos[1] < -20) this.dead = true;
      return;
    }
    const [rx, ry, rz, shape] = rail;
    const ex = RAIL_EXITS[shape];
    // The track's centreline through this block, from end a to end b (ends at edge midpoints).
    const end = (d: keyof typeof RAIL_DIRS, up: boolean): [number, number, number] => [rx + 0.5 + RAIL_DIRS[d][0] * 0.5, ry + (up ? 1 : 0), rz + 0.5 + RAIL_DIRS[d][1] * 0.5];
    const pa = end(ex.a, ex.up === ex.a), pb = end(ex.b, ex.up === ex.b);
    const seg = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const len = Math.hypot(seg[0], seg[1], seg[2]);
    const d: [number, number, number] = [seg[0] / len, seg[1] / len, seg[2] / len];
    // Keep the speed through bends: carry the magnitude over, pointing along the new direction.
    const v0 = b.vel[0] * this.dirVec[0] + b.vel[1] * this.dirVec[1] + b.vel[2] * this.dirVec[2];
    const along = b.vel[0] * d[0] + b.vel[2] * d[2] + b.vel[1] * d[1];
    let v = Math.hypot(b.vel[0], b.vel[1], b.vel[2]) * Math.sign(along || v0 || 0);
    // Gravity on slopes, a little rolling friction.
    v -= d[1] * 0.035;
    v *= 0.997;
    // The rider can push the cart along the way they're looking.
    if (this.ridden && this.input.forward > 0 && Math.abs(v) < 0.2) {
      const lx = -Math.sin(this.input.yaw), lz = -Math.cos(this.input.yaw);
      v += Math.sign(lx * d[0] + lz * d[2] || 1) * 0.01;
    }
    // Powered rails: boost when powered, brake when not.
    if (w.getBlock(rx, ry, rz) === B.powered_rail) {
      if (w.getMeta(rx, ry, rz) & 8) {
        if (Math.abs(v) < 0.02) {
          // Standing start: push away from a solid block at one end.
          const [ax, az] = RAIL_DIRS[ex.a];
          v = BLOCKS[w.getBlock(rx + ax, ry, rz + az)].solid ? 0.1 : -0.1;
        } else v += Math.sign(v) * 0.06;
      } else v *= 0.5;
    }
    v = Math.max(-0.5, Math.min(0.5, v));
    // Snap onto the centreline, then move along it.
    const t = Math.max(0, Math.min(len, (b.pos[0] - pa[0]) * d[0] + (b.pos[1] - pa[1]) * d[1] + (b.pos[2] - pa[2]) * d[2]));
    b.pos = [pa[0] + d[0] * t + d[0] * v, pa[1] + d[1] * t + d[1] * v + 0.0625, pa[2] + d[2] * t + d[2] * v];
    b.vel = [d[0] * v, d[1] * v, d[2] * v];
    this.dirVec = d;
    // A rail that ends against a wall stops the cart.
    const next = [Math.floor(b.pos[0] + d[0] * Math.sign(v) * 0.5), Math.floor(b.pos[2] + d[2] * Math.sign(v) * 0.5)];
    if ((next[0] !== rx || next[1] !== rz) && !isRail(w.getBlock(next[0], ry, next[1])) && !isRail(w.getBlock(next[0], ry + 1, next[1])) && !isRail(w.getBlock(next[0], ry - 1, next[1])) && BLOCKS[w.getBlock(next[0], ry, next[1])].solid) {
      b.vel = [0, 0, 0];
    }
    if (Math.abs(v) > 0.01) this.yaw = Math.atan2(-d[0] * Math.sign(v), -d[2] * Math.sign(v));
    this.pitch = Math.asin(d[1]) * Math.sign(v || 1);
    b.onGround = true;
  }

  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    this.model.parts.body.rotation.x = this.pitch;
  }
}

export function makeVehicle(kind: string, x: number, y: number, z: number, yaw = 0): Vehicle | null {
  if (kind === 'boat') return new Boat(x, y, z, yaw);
  if (kind === 'minecart') return new Minecart(x, y, z, yaw);
  return null;
}

void THREE;
