// Dropped items, primed TNT, and mobs: their AI, spawning, combat and rendering.

import * as THREE from 'three';
import { sfx, spatial } from '../audio';
import { B, BLOCKS, SOLID } from '../blocks';
import { I, itemDef, type ItemStack } from '../items';
import { Body, moveBody, raycast, stepBody, updateContacts } from '../physics';
import type { Renderer } from '../render/renderer';
import { tileIndex } from '../tiles';
import type { World } from '../world/world';
import { createModel, type MobModel } from './models';

export interface PlayerLike {
  body: Body;
  eyeHeight: number;
  yaw: number;
  alive: boolean;
  creative: boolean;
  held: ItemStack | null;
  damage(amount: number, source: string, knock?: [number, number]): void;
  pickUp(stack: ItemStack): ItemStack | null;
  addXp(n: number): void;
}

interface MobSpec {
  kind: string;
  width: number;
  height: number;
  health: number;
  speed: number;
  hostile: boolean;
  attack?: number;
  burnsInDay?: boolean;
  pitch: number;
  drops: (r: () => number) => ItemStack[];
  /** Items that tempt and breed this animal. */
  food?: number[];
  ranged?: boolean;
  xp: number;
}

export const MOBS: Record<string, MobSpec> = {
  boar: { kind: 'boar', width: 0.9, height: 0.9, health: 10, speed: 0.7, hostile: false, pitch: 180, xp: 2, food: [I.carrot, I.wheat_item], drops: (r) => [{ id: I.raw_pork, count: 1 + Math.floor(r() * 3) }, { id: I.leather, count: Math.floor(r() * 2) }] },
  hen: { kind: 'hen', width: 0.4, height: 0.7, health: 4, speed: 0.7, hostile: false, pitch: 900, xp: 2, food: [I.seeds], drops: (r) => [{ id: I.raw_chicken, count: 1 }, { id: I.feather, count: Math.floor(r() * 3) }] },
  woolback: { kind: 'woolback', width: 0.9, height: 1.3, health: 8, speed: 0.65, hostile: false, pitch: 320, xp: 2, food: [I.wheat_item], drops: (r) => [{ id: B.wool, count: 1 }, { id: I.raw_mutton, count: 1 + Math.floor(r() * 2) }] },
  mirewalker: { kind: 'mirewalker', width: 0.6, height: 1.95, health: 20, speed: 0.75, hostile: true, attack: 3, burnsInDay: true, pitch: 110, xp: 5, drops: (r) => [{ id: I.rotten_flesh, count: Math.floor(r() * 3) }, ...(r() < 0.1 ? [{ id: I.bone, count: 1 }] : []), ...(r() < 0.03 ? [{ id: I.carrot, count: 1 }] : [])] },
  shellcrawler: { kind: 'shellcrawler', width: 1.3, height: 0.8, health: 16, speed: 0.9, hostile: true, attack: 2, pitch: 420, xp: 5, drops: (r) => [{ id: I.string, count: Math.floor(r() * 3) }] },
  brambler: { kind: 'brambler', width: 0.6, height: 1.9, health: 20, speed: 0.7, hostile: true, ranged: true, burnsInDay: true, pitch: 260, xp: 5, drops: (r) => [{ id: I.arrow, count: Math.floor(r() * 3) }, { id: I.bone, count: Math.floor(r() * 3) }, { id: I.gunpowder, count: Math.floor(r() * 2) }] },
};

abstract class Entity {
  dead = false;
  age = 0;
  prev: [number, number, number];
  object: THREE.Object3D;
  constructor(readonly body: Body, object: THREE.Object3D) {
    this.prev = [...body.pos];
    this.object = object;
  }
  abstract tick(m: EntityManager): void;
  render(alpha: number, m: EntityManager): void {
    const p = this.body.pos;
    this.object.position.set(this.prev[0] + (p[0] - this.prev[0]) * alpha, this.prev[1] + (p[1] - this.prev[1]) * alpha, this.prev[2] + (p[2] - this.prev[2]) * alpha);
    const l = m.lightAt(p[0], p[1] + this.body.height / 2, p[2]);
    this.object.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat) return;
      for (const mm of Array.isArray(mat) ? mat : [mat]) {
        const bm = mm as THREE.MeshBasicMaterial;
        const shade = (bm.userData.shade as number | undefined) ?? 1;
        const hurt = this instanceof Mob && this.hurtTime > 0;
        bm.color.setRGB(l * shade, l * shade * (hurt ? 0.5 : 1), l * shade * (hurt ? 0.5 : 1));
      }
    });
  }
}

export class ItemEntity extends Entity {
  pickupDelay: number;
  spin = Math.random() * Math.PI * 2;
  constructor(readonly stack: ItemStack, x: number, y: number, z: number, renderer: Renderer, delay = 10) {
    const body = new Body(x, y, z, 0.25, 0.25);
    super(body, ItemEntity.makeObject(stack.id, renderer));
    this.pickupDelay = delay;
    body.vel = [(Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2];
  }
  static makeObject(id: number, renderer: Renderer): THREE.Object3D {
    const def = itemDef(id);
    const g = new THREE.Group();
    if (id < 256 && def && !def.icon) {
      const m = renderer.blockModel(id, 0.25);
      m.position.y = 0.15;
      g.add(m);
    } else {
      const m = renderer.itemModel(def?.icon ?? 'stick', 0.4);
      m.position.y = 0.2;
      g.add(m);
    }
    return g;
  }
  tick(m: EntityManager): void {
    this.prev = [...this.body.pos];
    this.age++;
    if (this.pickupDelay > 0) this.pickupDelay--;
    const b = this.body;
    updateContacts(m.world, b, 0.1);
    b.vel[1] -= b.inWater ? -0.005 : 0.04;
    b.vel[1] = Math.max(-2, b.vel[1]);
    stepBodyNoInput(m.world, b);
    const f = b.onGround ? 0.6 * 0.98 : 0.98;
    b.vel[0] *= f; b.vel[2] *= f; b.vel[1] *= 0.98;
    if (b.inWater) { b.vel[0] *= 0.9; b.vel[2] *= 0.9; }
    if (this.age > 6000 || b.pos[1] < -10) this.dead = true;
    if (m.world.getBlock(Math.floor(b.pos[0]), Math.floor(b.pos[1]), Math.floor(b.pos[2])) === B.lava) this.dead = true;
    // Merge with nearby identical stacks.
    if (this.age % 10 === 0) {
      for (const e of m.list) {
        if (e === this || !(e instanceof ItemEntity) || e.dead || e.stack.id !== this.stack.id || this.stack.damage || e.stack.damage) continue;
        const d = dist(e.body.pos, b.pos);
        const max = itemDef(this.stack.id)?.maxStack ?? 64;
        if (d < 1 && e.stack.count + this.stack.count <= max) {
          e.stack.count += this.stack.count;
          this.dead = true;
          break;
        }
      }
    }
    // Pickup.
    const p = m.player;
    if (p.alive && this.pickupDelay === 0) {
      const pa = p.body.aabb(), ia = b.aabb();
      const near = ia.max[0] > pa.min[0] - 1 && ia.min[0] < pa.max[0] + 1 && ia.max[1] > pa.min[1] - 0.5 && ia.min[1] < pa.max[1] + 0.5 && ia.max[2] > pa.min[2] - 1 && ia.min[2] < pa.max[2] + 1;
      if (near) {
        const left = p.pickUp(this.stack);
        if (!left) { this.dead = true; sfx.pop(); }
        else if (left.count !== this.stack.count) { this.stack.count = left.count; sfx.pop(); }
      }
    }
  }
  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    this.spin += 0.03;
    this.object.rotation.y = this.spin;
    this.object.position.y += Math.sin(this.spin * 2) * 0.05 + 0.05;
  }
}

function stepBodyNoInput(w: World, b: Body): void {
  moveBody(w, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
}

export class TntEntity extends Entity {
  fuse: number;
  constructor(x: number, y: number, z: number, renderer: Renderer, fuse = 80) {
    const body = new Body(x + 0.5, y, z + 0.5, 0.98, 0.98);
    const obj = new THREE.Group();
    const cube = renderer.blockModel(B.tnt, 1);
    cube.position.y = 0.5;
    obj.add(cube);
    super(body, obj);
    this.fuse = fuse;
    body.vel = [(Math.random() - 0.5) * 0.04, 0.2, (Math.random() - 0.5) * 0.04];
  }
  tick(m: EntityManager): void {
    this.prev = [...this.body.pos];
    const b = this.body;
    b.vel[1] -= 0.04;
    stepBodyNoInput(m.world, b);
    b.vel[0] *= 0.98; b.vel[1] *= 0.98; b.vel[2] *= 0.98;
    if (b.onGround) { b.vel[0] *= 0.7; b.vel[2] *= 0.7; }
    if (--this.fuse <= 0) {
      this.dead = true;
      m.explode(b.pos[0], b.pos[1] + 0.5, b.pos[2], 4);
    }
  }
  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    const flash = Math.floor(this.fuse / 5) % 2 === 0;
    const s = 1 + Math.max(0, (10 - this.fuse) / 10) * 0.2;
    this.object.scale.setScalar(s);
    this.object.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat) return;
      for (const mm of Array.isArray(mat) ? mat : [mat]) if (flash) (mm as THREE.MeshBasicMaterial).color.setScalar(1.6);
    });
  }
}

export class Mob extends Entity {
  health: number;
  hurtTime = 0;
  deathTime = 0;
  attackCooldown = 0;
  yaw = Math.random() * Math.PI * 2;
  headYaw = 0;
  walkAnim = 0;
  target: [number, number, number] | null = null;
  wanderTimer = 0;
  panic = 0;
  burning = 0;
  /** Ticks left until a baby grows up (0 = adult). */
  growing = 0;
  love = 0;
  breedCooldown = 0;
  sheared = false;
  eggTimer = 6000 + Math.floor(Math.random() * 6000);
  hurtByPlayer = 0;
  model: MobModel;
  constructor(readonly spec: MobSpec, x: number, y: number, z: number) {
    const body = new Body(x, y, z, spec.width, spec.height);
    const model = createModel(spec.kind);
    super(body, model.root);
    this.model = model;
    this.health = spec.health;
  }

  get baby(): boolean { return this.growing > 0; }

  makeBaby(): void {
    this.growing = 6000;
    this.body.width = this.spec.width * 0.5;
    this.body.height = this.spec.height * 0.5;
  }

  hurt(m: EntityManager, amount: number, from: [number, number, number] | null, knock = 0.4, byPlayer = false): void {
    if (this.hurtTime > 0 || this.deathTime > 0) return;
    this.health -= amount;
    this.hurtTime = 10;
    if (byPlayer) this.hurtByPlayer = 100;
    if (from) {
      const dx = this.body.pos[0] - from[0], dz = this.body.pos[2] - from[2];
      const d = Math.hypot(dx, dz) || 1;
      this.body.vel[0] += (dx / d) * knock;
      this.body.vel[2] += (dz / d) * knock;
      this.body.vel[1] = Math.max(this.body.vel[1], 0.3);
    }
    const s = m.spatialFor(this.body.pos);
    sfx.mobHurt(this.spec.pitch * (this.baby ? 1.5 : 1), s);
    if (!this.spec.hostile) this.panic = 60;
    if (this.health <= 0) {
      this.deathTime = 1;
      if (!this.baby) {
        for (const st of this.spec.drops(Math.random)) if (st.count > 0) m.dropItem(this.body.pos[0], this.body.pos[1] + 0.5, this.body.pos[2], st);
        if (this.hurtByPlayer > 0) m.dropXp(this.body.pos[0], this.body.pos[1] + 0.5, this.body.pos[2], this.spec.hostile ? this.spec.xp : 1 + Math.floor(Math.random() * this.spec.xp + 1));
      }
      m.onMobKilled(this, this.hurtByPlayer > 0);
    }
  }

  /** Right-click with an item. Returns true if the item was used. */
  interact(m: EntityManager, stack: ItemStack | null): 'fed' | 'sheared' | null {
    if (!stack || this.deathTime) return null;
    if (this.spec.kind === 'woolback' && stack.id === I.shears && !this.sheared && !this.baby) {
      this.sheared = true;
      const n = 1 + Math.floor(Math.random() * 3);
      m.dropItem(this.body.pos[0], this.body.pos[1] + 1, this.body.pos[2], { id: B.wool, count: n });
      sfx.place('wool');
      return 'sheared';
    }
    if (this.spec.food?.includes(stack.id)) {
      if (this.baby) { this.growing = Math.max(1, this.growing - 600); return 'fed'; }
      if (this.breedCooldown > 0 || this.love > 0) return null;
      this.love = 600;
      for (let i = 0; i < 5; i++) m.heart(this.body.pos[0], this.body.pos[1] + this.body.height + 0.2, this.body.pos[2]);
      return 'fed';
    }
    return null;
  }

  tick(m: EntityManager): void {
    this.prev = [...this.body.pos];
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.hurtByPlayer > 0) this.hurtByPlayer--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.breedCooldown > 0) this.breedCooldown--;
    if (this.growing > 0 && --this.growing === 0) { this.body.width = this.spec.width; this.body.height = this.spec.height; }
    if (this.deathTime > 0) {
      this.deathTime++;
      if (this.deathTime > 20) { this.dead = true; m.puff(this.body.pos[0], this.body.pos[1] + 0.5, this.body.pos[2]); }
      return;
    }
    const w = m.world, b = this.body, p = m.player;
    updateContacts(w, b, this.body.height * 0.85);
    let forward = 0;
    let jump = false;
    const toPlayer = [p.body.pos[0] - b.pos[0], p.body.pos[1] - b.pos[1], p.body.pos[2] - b.pos[2]];
    const pd = Math.hypot(toPlayer[0], toPlayer[1], toPlayer[2]);
    const daylight = m.isDay();
    const face = (dx: number, dz: number) => { this.yaw = Math.atan2(-dx, -dz); };

    const aggressive = this.spec.hostile && p.alive && !p.creative && pd < 16 && !(this.spec.kind === 'shellcrawler' && daylight && this.panic === 0 && this.hurtTime === 0 && this.health === this.spec.health);
    const tempted = !this.spec.hostile && p.alive && pd < 10 && !!p.held && !!this.spec.food?.includes(p.held.id);
    if (aggressive && this.spec.ranged) {
      // Keep a distance and shoot thorns when there's a clear line of sight.
      face(toPlayer[0], toPlayer[2]);
      const sees = m.lineOfSight([b.pos[0], b.pos[1] + 1.6, b.pos[2]], [p.body.pos[0], p.body.pos[1] + 1.5, p.body.pos[2]]);
      forward = pd > 10 || !sees ? 1 : pd < 5 ? -1 : 0;
      if (sees && pd < 14 && this.attackCooldown === 0) {
        this.attackCooldown = 40;
        m.shoot('thorn', this, [b.pos[0], b.pos[1] + 1.5, b.pos[2]], [toPlayer[0], toPlayer[1] + 0.2 + pd * 0.03, toPlayer[2]], 1.4, 0.15);
      }
    } else if (aggressive) {
      face(toPlayer[0], toPlayer[2]);
      forward = pd > 0.9 ? 1 : 0;
      if (pd < 1.3 + this.spec.width / 2 && Math.abs(toPlayer[1]) < 1.5 && this.attackCooldown === 0) {
        this.attackCooldown = 20;
        p.damage(this.spec.attack ?? 2, this.spec.kind, [toPlayer[0] / (pd || 1), toPlayer[2] / (pd || 1)]);
      }
    } else if (this.panic > 0) {
      this.panic--;
      if (this.age % 20 === 0) this.yaw = Math.random() * Math.PI * 2;
      forward = 1.25;
    } else if (this.love > 0) {
      this.love--;
      if (this.age % 10 === 0) m.heart(b.pos[0], b.pos[1] + b.height + 0.2, b.pos[2]);
      const mate = m.mobs().find((o) => o !== this && o.spec === this.spec && o.love > 0 && !o.baby && dist(o.body.pos, b.pos) < 8);
      if (mate) {
        const dx = mate.body.pos[0] - b.pos[0], dz = mate.body.pos[2] - b.pos[2];
        face(dx, dz);
        forward = Math.hypot(dx, dz) > 1.2 ? 1 : 0;
        if (Math.hypot(dx, dz) < 1.5) {
          this.love = mate.love = 0;
          this.breedCooldown = mate.breedCooldown = 6000;
          const baby = m.spawnMob(this.spec.kind, (b.pos[0] + mate.body.pos[0]) / 2, b.pos[1], (b.pos[2] + mate.body.pos[2]) / 2);
          baby.makeBaby();
          m.dropXp(b.pos[0], b.pos[1] + 0.5, b.pos[2], 1 + Math.floor(Math.random() * 7));
          m.onBred();
        }
      }
    } else if (tempted) {
      face(toPlayer[0], toPlayer[2]);
      forward = pd > 2.2 ? 1 : 0;
      this.headYaw = 0;
    } else {
      if (--this.wanderTimer <= 0) {
        this.wanderTimer = 60 + Math.floor(Math.random() * 120);
        this.target = Math.random() < 0.6 ? null : [b.pos[0] + (Math.random() - 0.5) * 16, 0, b.pos[2] + (Math.random() - 0.5) * 16];
      }
      if (this.target) {
        const dx = this.target[0] - b.pos[0], dz = this.target[2] - b.pos[2];
        if (Math.hypot(dx, dz) < 1) this.target = null;
        else { face(dx, dz); forward = 0.6; }
      }
      if (pd < 6) this.headYaw = Math.atan2(-toPlayer[0], -toPlayer[2]) - this.yaw;
      else this.headYaw *= 0.9;
    }
    // Babies follow a nearby adult.
    if (this.baby && forward === 0 && this.age % 20 === 0) {
      const parent = m.mobs().find((o) => o.spec === this.spec && !o.baby && dist(o.body.pos, b.pos) < 10 && dist(o.body.pos, b.pos) > 3);
      if (parent) { face(parent.body.pos[0] - b.pos[0], parent.body.pos[2] - b.pos[2]); this.target = [...parent.body.pos]; }
    }
    // Avoid walking off cliffs (unless chasing).
    if (forward > 0 && !aggressive) {
      const ax = b.pos[0] - Math.sin(this.yaw) * 0.8, az = b.pos[2] - Math.cos(this.yaw) * 0.8;
      let drop = 0;
      for (let y = Math.floor(b.pos[1]) - 1; y > Math.floor(b.pos[1]) - 5; y--) {
        if (SOLID[w.getBlockPhysics(Math.floor(ax), y, Math.floor(az))]) break;
        drop++;
      }
      if (drop >= 3) { forward = 0; this.wanderTimer = 0; }
      const ahead = w.getBlock(Math.floor(ax), Math.floor(b.pos[1]), Math.floor(az));
      if (ahead === B.lava || ahead === B.cactus) { forward = 0; this.wanderTimer = 0; }
    }
    if (b.collidedH && forward > 0) jump = true;
    if (b.inWater) jump = true;
    const speed = this.spec.speed * (forward > 1 ? 1.25 : 1) * (forward > 0 && forward < 1 ? 0.8 : 1) * (this.baby ? 1.2 : 1);
    stepBody(w, b, { forward: forward > 0 ? 1 : forward < 0 ? -1 : 0, strafe: 0, jump, sneak: false, sprint: false, yaw: this.yaw }, false, speed);
    if (b.onGround && b.fallDistance > 3) this.hurt(m, Math.ceil(b.fallDistance - 3), null);
    if (b.onGround) b.fallDistance = 0;
    if (b.inLava) { this.hurt(m, 4, null, 0); this.burning = 160; }
    // Burning in daylight (rain and water put it out).
    const raining = m.world.weather !== 'clear';
    if (this.spec.burnsInDay && daylight && !b.inWater && !raining) {
      const sky = w.getSky(Math.floor(b.pos[0]), Math.floor(b.pos[1] + 1.6), Math.floor(b.pos[2]));
      if (sky >= 15) this.burning = 60;
    }
    if (this.burning > 0) {
      this.burning--;
      if (b.inWater || (raining && w.getSky(Math.floor(b.pos[0]), Math.floor(b.pos[1] + 1), Math.floor(b.pos[2])) >= 15)) this.burning = 0;
      if (this.age % 20 === 0) this.hurt(m, 1, null, 0);
      if (this.age % 3 === 0) m.flame(b.pos[0], b.pos[1] + Math.random() * this.body.height, b.pos[2]);
    }
    // Woolbacks regrow wool by grazing; hens lay eggs.
    if (this.sheared && Math.random() < 1 / 600) {
      const gx = Math.floor(b.pos[0]), gy = Math.floor(b.pos[1] - 0.5), gz = Math.floor(b.pos[2]);
      if (w.getBlock(gx, gy, gz) === B.grass) { w.setBlock(gx, gy, gz, B.dirt); this.sheared = false; }
    }
    if (this.spec.kind === 'hen' && !this.baby && --this.eggTimer <= 0) {
      this.eggTimer = 6000 + Math.floor(Math.random() * 6000);
      m.dropItem(b.pos[0], b.pos[1] + 0.3, b.pos[2], { id: I.egg, count: 1 });
    }
    if (this.age % 200 === 0 && Math.random() < 0.4 && pd < 16) sfx.mobSay(this.spec.pitch * (this.baby ? 1.5 : 1), m.spatialFor(b.pos));
    const sp = Math.hypot(b.vel[0], b.vel[2]);
    this.walkAnim += sp * 3.5;
    // Despawn far hostiles.
    if (this.spec.hostile && (pd > 96 || (pd > 40 && Math.random() < 1 / 800))) this.dead = true;
    if (b.pos[1] < -20) this.dead = true;
  }

  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    const parts = this.model.parts;
    this.object.rotation.y = this.yaw;
    this.object.scale.setScalar(this.baby ? 0.55 : 1);
    if (this.baby && parts.head) parts.head.scale.setScalar(1.35);
    const swing = Math.sin(this.walkAnim) * 0.7;
    for (const [name, o] of Object.entries(parts)) {
      if (name.startsWith('leg')) {
        const phase = /FL|BR|L$|L0|R1|L2/.test(name) ? 1 : -1;
        if (this.spec.kind === 'shellcrawler') o.rotation.y = swing * 0.4 * phase;
        else o.rotation.x = swing * phase;
      }
      if (name === 'armL' || name === 'armR') {
        const raise = this.spec.ranged ? (this.attackCooldown > 30 ? -2.2 : -1.2) : -1.4;
        o.rotation.x = raise + Math.sin(this.walkAnim) * 0.2 * (name === 'armL' ? 1 : -1) - (!this.spec.ranged && this.attackCooldown > 14 ? 0.6 : 0);
      }
      if (name === 'wingL') o.rotation.z = this.body.onGround ? 0 : Math.sin(this.age) * 0.8;
      if (name === 'wingR') o.rotation.z = this.body.onGround ? 0 : -Math.sin(this.age) * 0.8;
    }
    if (parts.torso && this.spec.kind === 'woolback') parts.torso.scale.set(this.sheared ? 0.78 : 1, this.sheared ? 0.8 : 1, this.sheared ? 0.92 : 1);
    if (parts.head) parts.head.rotation.y = Math.max(-1, Math.min(1, this.headYaw));
    if (this.deathTime > 0) this.object.rotation.z = Math.min(Math.PI / 2, this.deathTime / 10 * Math.PI / 2);
    else this.object.rotation.z = 0;
    if (this.burning > 0) {
      this.object.traverse((o) => {
        const mat = (o as THREE.Mesh).material;
        if (!mat) return;
        for (const mm of Array.isArray(mat) ? mat : [mat]) (mm as THREE.MeshBasicMaterial).color.multiply(new THREE.Color(1.4, 0.8, 0.4));
      });
    }
  }
}

// ---------- Projectiles, XP orbs, fishing bobber ----------
export type ProjectileKind = 'arrow' | 'thorn' | 'snowball' | 'egg';

export class Projectile extends Entity {
  stuck = 0;
  constructor(readonly kind: ProjectileKind, readonly owner: Mob | 'player', x: number, y: number, z: number, vel: [number, number, number], readonly baseDamage: number, renderer: Renderer, readonly pickup: boolean) {
    const body = new Body(x, y, z, 0.25, 0.25);
    body.vel = vel;
    super(body, Projectile.makeObject(kind, renderer));
  }
  static makeObject(kind: ProjectileKind, renderer: Renderer): THREE.Object3D {
    const g = new THREE.Group();
    if (kind === 'arrow' || kind === 'thorn') {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: kind === 'arrow' ? 0x8a6a3a : 0x3f6a2a }));
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: kind === 'arrow' ? 0xbcbcbc : 0xa02a2a }));
      tip.position.z = -0.32;
      g.add(shaft, tip);
    } else {
      const t = new THREE.CanvasTexture(renderer.atlas.canvases[tileIndex(kind)]);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, alphaTest: 0.5 }));
      s.scale.setScalar(0.3);
      g.add(s);
    }
    return g;
  }
  tick(m: EntityManager): void {
    this.prev = [...this.body.pos];
    this.age++;
    const b = this.body;
    if (this.stuck > 0) {
      this.stuck++;
      if (this.stuck > 1200) this.dead = true;
      // Stuck player arrows can be picked back up.
      if (this.pickup && this.stuck > 10 && dist([m.player.body.pos[0], m.player.body.pos[1] + 0.9, m.player.body.pos[2]], b.pos) < 1.4) {
        if (!m.player.pickUp({ id: I.arrow, count: 1 })) { this.dead = true; sfx.pop(); }
      }
      return;
    }
    const speed = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
    const dir = [b.vel[0] / speed, b.vel[1] / speed, b.vel[2] / speed];
    // Entity hits along this tick's path.
    const targetHit = (): boolean => {
      if (this.owner === 'player') {
        const hit = m.raycastMob(b.pos, dir, speed);
        if (hit) {
          const dmg = this.kind === 'arrow' ? Math.ceil(speed * this.baseDamage) : this.kind === 'egg' || this.kind === 'snowball' ? 0 : this.baseDamage;
          if (dmg > 0) hit.mob.hurt(m, dmg, b.pos, 0.4, true);
          else { hit.mob.body.vel[0] += dir[0] * 0.3; hit.mob.body.vel[2] += dir[2] * 0.3; hit.mob.body.vel[1] += 0.2; }
          m.onProjectileHit(this, hit.mob);
          return true;
        }
      } else {
        const p = m.player;
        if (!p.alive) return false;
        const a = p.body.aabb();
        const lo = [a.min[0] - 0.1, a.min[1], a.min[2] - 0.1], hi = [a.max[0] + 0.1, a.max[1], a.max[2] + 0.1];
        for (let s = 0; s <= 4; s++) {
          const q = [b.pos[0] + dir[0] * speed * s / 4, b.pos[1] + dir[1] * speed * s / 4, b.pos[2] + dir[2] * speed * s / 4];
          if (q[0] > lo[0] && q[0] < hi[0] && q[1] > lo[1] && q[1] < hi[1] && q[2] > lo[2] && q[2] < hi[2]) {
            p.damage(Math.ceil(speed * this.baseDamage), (this.owner as Mob).spec.kind, [dir[0], dir[2]]);
            return true;
          }
        }
      }
      return false;
    };
    if (targetHit()) {
      this.dead = true;
      this.impact(m);
      return;
    }
    const hit = raycast(m.world, b.pos, dir, speed);
    if (hit) {
      b.pos = [...hit.point] as [number, number, number];
      if (this.kind === 'arrow' || this.kind === 'thorn') {
        this.stuck = 1;
        sfx.dig('wood');
        if (this.kind === 'thorn') this.dead = true;
      } else {
        this.dead = true;
        this.impact(m);
      }
      return;
    }
    b.pos[0] += b.vel[0]; b.pos[1] += b.vel[1]; b.pos[2] += b.vel[2];
    const inWater = m.world.getBlock(Math.floor(b.pos[0]), Math.floor(b.pos[1]), Math.floor(b.pos[2])) === B.water;
    const drag = inWater ? 0.6 : 0.99;
    b.vel[0] *= drag; b.vel[1] *= drag; b.vel[2] *= drag;
    b.vel[1] -= this.kind === 'arrow' || this.kind === 'thorn' ? 0.05 : 0.03;
    if (this.age > 400 || b.pos[1] < -20) this.dead = true;
  }
  private impact(m: EntityManager): void {
    const b = this.body;
    if (this.kind === 'snowball') for (let i = 0; i < 6; i++) m.particles.add(new THREE.Vector3(...b.pos), new THREE.Vector3((Math.random() - 0.5) * 0.1, Math.random() * 0.1, (Math.random() - 0.5) * 0.1), new THREE.Color(0.95, 0.97, 1), 12, 0.07);
    if (this.kind === 'egg') {
      for (let i = 0; i < 6; i++) m.particles.add(new THREE.Vector3(...b.pos), new THREE.Vector3((Math.random() - 0.5) * 0.1, Math.random() * 0.1, (Math.random() - 0.5) * 0.1), new THREE.Color(0.9, 0.85, 0.7), 12, 0.07);
      if (Math.random() < 1 / 8) m.spawnMob('hen', b.pos[0], b.pos[1], b.pos[2]).makeBaby();
    }
  }
  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    const v = this.body.vel;
    if (this.stuck === 0 && (this.kind === 'arrow' || this.kind === 'thorn')) {
      this.object.rotation.set(0, 0, 0);
      this.object.lookAt(this.object.position.x - v[0], this.object.position.y - v[1], this.object.position.z - v[2]);
    }
  }
}

export class XpOrb extends Entity {
  constructor(readonly value: number, x: number, y: number, z: number) {
    const body = new Body(x, y, z, 0.25, 0.25);
    body.vel = [(Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2];
    const size = value >= 7 ? 0.22 : value >= 3 ? 0.17 : 0.12;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial({ color: 0xb8f04a }));
    super(body, mesh);
  }
  tick(m: EntityManager): void {
    this.prev = [...this.body.pos];
    this.age++;
    const b = this.body, p = m.player;
    const target = [p.body.pos[0], p.body.pos[1] + 0.9, p.body.pos[2]];
    const d = dist(target, b.pos);
    if (p.alive && d < 8) {
      const f = (1 - d / 8) * 0.1;
      b.vel[0] += (target[0] - b.pos[0]) / d * f;
      b.vel[1] += (target[1] - b.pos[1]) / d * f;
      b.vel[2] += (target[2] - b.pos[2]) / d * f;
    }
    b.vel[1] -= 0.03;
    moveBody(m.world, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
    const f = b.onGround ? 0.6 : 0.98;
    b.vel[0] *= f; b.vel[2] *= f; b.vel[1] *= 0.98;
    if (p.alive && d < 1.2 && this.age > 5) {
      p.addXp(this.value);
      sfx.pop();
      this.dead = true;
    }
    if (this.age > 6000) this.dead = true;
  }
  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    const t = this.age * 0.25;
    (this.object as THREE.Mesh).material instanceof THREE.MeshBasicMaterial && ((this.object as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setRGB(0.6 + Math.sin(t) * 0.3, 1, 0.3);
    this.object.rotation.y = t * 0.3;
  }
}

export class Bobber extends Entity {
  state: 'flying' | 'floating' | 'ground' = 'flying';
  waitTicks = 0;
  biteTicks = 0;
  line: THREE.Line;
  constructor(x: number, y: number, z: number, vel: [number, number, number]) {
    const body = new Body(x, y, z, 0.2, 0.2);
    body.vel = vel;
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), new THREE.MeshBasicMaterial({ color: 0xd8342a }));
    top.position.y = 0.1;
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), new THREE.MeshBasicMaterial({ color: 0xf0f0f0 }));
    bottom.position.y = 0.02;
    g.add(top, bottom);
    super(body, g);
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x222222 }));
    this.line.frustumCulled = false;
  }
  tick(m: EntityManager): void {
    this.prev = [...this.body.pos];
    this.age++;
    const b = this.body, w = m.world;
    const cell = w.getBlock(Math.floor(b.pos[0]), Math.floor(b.pos[1] + 0.05), Math.floor(b.pos[2]));
    if (cell === B.water) {
      if (this.state !== 'floating') {
        this.state = 'floating';
        this.waitTicks = 100 + Math.floor(Math.random() * 500 * (w.weather !== 'clear' ? 0.7 : 1));
        sfx.splash();
      }
      b.vel[0] *= 0.8; b.vel[2] *= 0.8;
      b.vel[1] = b.vel[1] * 0.7 + 0.03;
    } else {
      b.vel[1] -= 0.04;
    }
    moveBody(w, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
    if (b.onGround && this.state === 'flying') this.state = 'ground';
    if (this.state === 'floating') {
      if (this.biteTicks > 0) {
        this.biteTicks--;
        b.pos[1] -= 0.02;
        if (this.biteTicks === 0) this.waitTicks = 100 + Math.floor(Math.random() * 400);
      } else if (--this.waitTicks <= 0) {
        this.biteTicks = 20;
        sfx.splash();
        for (let i = 0; i < 8; i++) m.particles.add(new THREE.Vector3(b.pos[0], b.pos[1] + 0.1, b.pos[2]), new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.08, (Math.random() - 0.5) * 0.08), new THREE.Color(0.7, 0.8, 1), 12, 0.06);
      }
    }
    const p = m.player;
    if (!p.alive || dist(p.body.pos, b.pos) > 32 || p.held?.id !== I.fishing_rod) this.dead = true;
  }
  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    const cam = m.renderer.camera;
    const tip = new THREE.Vector3(0.35, -0.2, -0.6).applyQuaternion(cam.quaternion).add(cam.position);
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, tip.x, tip.y, tip.z);
    pos.setXYZ(1, this.object.position.x, this.object.position.y + 0.12, this.object.position.z);
    pos.needsUpdate = true;
    if (!this.line.parent) m.renderer.scene.add(this.line);
    if (this.dead) this.line.removeFromParent();
  }
}

function dist(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------- Particles ----------
class Particles {
  mesh: THREE.InstancedMesh;
  private data: { p: THREE.Vector3; v: THREE.Vector3; life: number; size: number; grav: number }[] = [];
  private tmp = new THREE.Object3D();
  constructor(scene: THREE.Scene, readonly max = 600) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  add(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, life: number, size: number, grav = 0.04): void {
    if (this.data.length >= this.max) this.data.shift();
    if (this.colors.length >= this.max) this.colors.shift();
    this.data.push({ p, v, life, size, grav });
    this.colors.push(color);
  }
  private colors: THREE.Color[] = [];
  tick(world: World): void {
    for (const d of this.data) {
      d.v.y -= d.grav;
      d.p.add(d.v);
      if (SOLID[world.getBlock(Math.floor(d.p.x), Math.floor(d.p.y), Math.floor(d.p.z))]) { d.p.sub(d.v); d.v.multiplyScalar(0.3); }
      d.v.multiplyScalar(0.96);
      d.life--;
    }
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].life <= 0) { this.data.splice(i, 1); this.colors.splice(i, 1); }
  }
  render(): void {
    this.mesh.count = this.data.length;
    this.data.forEach((d, i) => {
      this.tmp.position.copy(d.p);
      this.tmp.scale.setScalar(d.size);
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
      if (this.colors[i]) this.mesh.setColorAt(i, this.colors[i]);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- Manager ----------
export class EntityManager {
  list: Entity[] = [];
  particles: Particles;
  private tileColors = new Map<number, THREE.Color[]>();
  onExplosion: (x: number, y: number, z: number) => void = () => {};
  onMobKilled: (mob: Mob, byPlayer: boolean) => void = () => {};
  onBred: () => void = () => {};
  onProjectileHit: (p: Projectile, mob: Mob) => void = () => {};
  private spawnerTimers = new Map<string, number>();

  constructor(readonly world: World, readonly renderer: Renderer, public player: PlayerLike) {
    this.particles = new Particles(renderer.scene);
  }

  add<T extends Entity>(e: T): T {
    this.list.push(e);
    this.renderer.scene.add(e.object);
    return e;
  }

  dropItem(x: number, y: number, z: number, stack: ItemStack, delay = 10, vel?: [number, number, number]): ItemEntity {
    const e = this.add(new ItemEntity({ ...stack }, x, y, z, this.renderer, delay));
    if (vel) e.body.vel = [...vel];
    return e;
  }

  spawnMob(kind: string, x: number, y: number, z: number): Mob {
    return this.add(new Mob(MOBS[kind], x, y, z));
  }

  dropXp(x: number, y: number, z: number, amount: number): void {
    while (amount > 0) {
      const v = amount >= 7 ? 7 : amount >= 3 ? 3 : 1;
      this.add(new XpOrb(v, x, y, z));
      amount -= v;
    }
  }

  shoot(kind: ProjectileKind, owner: Mob | 'player', from: number[], dir: number[], speed: number, spread: number, damage = 2, pickup = false): Projectile {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const v: [number, number, number] = [
      (dir[0] / l + (Math.random() - 0.5) * spread) * speed,
      (dir[1] / l + (Math.random() - 0.5) * spread) * speed,
      (dir[2] / l + (Math.random() - 0.5) * spread) * speed,
    ];
    if (kind === 'arrow' || kind === 'thorn') sfx.mobSay(kind === 'thorn' ? 500 : 900, this.spatialFor(from));
    return this.add(new Projectile(kind, owner, from[0], from[1], from[2], v, damage, this.renderer, pickup));
  }

  lineOfSight(a: number[], b: number[]): boolean {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const hit = raycast(this.world, a, [d[0] / len, d[1] / len, d[2] / len], len);
    return !hit || (SOLID[hit.id] === 0);
  }

  heart(x: number, y: number, z: number): void {
    this.particles.add(new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6), new THREE.Vector3(0, 0.03, 0), new THREE.Color(0.95, 0.25, 0.35), 20, 0.12, -0.001);
  }

  private tickSpawners(): void {
    const p = this.player.body.pos;
    for (const key of this.world.spawners) {
      const [x, y, z] = key.split(',').map(Number);
      if (Math.hypot(x + 0.5 - p[0], y - p[1], z + 0.5 - p[2]) > 16) continue;
      if (Math.random() < 0.3) this.flame(x + 0.5, y + 0.3 + Math.random() * 0.5, z + 0.5);
      let t = this.spawnerTimers.get(key) ?? 20 + Math.floor(Math.random() * 200);
      if (--t > 0) { this.spawnerTimers.set(key, t); continue; }
      this.spawnerTimers.set(key, 200 + Math.floor(Math.random() * 600));
      const kinds = ['mirewalker', 'shellcrawler', 'brambler'];
      const kind = kinds[(x * 31 + z * 17 + y) % 3 < 0 ? 0 : (x * 31 + z * 17 + y) % 3];
      const nearby = this.mobs().filter((m) => m.spec.kind === kind && Math.hypot(m.body.pos[0] - x, m.body.pos[1] - y, m.body.pos[2] - z) < 9).length;
      if (nearby >= 6) continue;
      const n = 1 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const sx = x + Math.floor(Math.random() * 9) - 4, sy = y + Math.floor(Math.random() * 3) - 1, sz = z + Math.floor(Math.random() * 9) - 4;
        if (this.world.getBlock(sx, sy, sz) !== 0 || this.world.getBlock(sx, sy + 1, sz) !== 0 || !SOLID[this.world.getBlock(sx, sy - 1, sz)]) continue;
        if (this.world.getBlockLight(sx, sy, sz) > 7) continue;
        this.spawnMob(kind, sx + 0.5, sy, sz + 0.5);
        this.puff(sx + 0.5, sy + 0.5, sz + 0.5);
      }
    }
  }

  isDay(): boolean {
    const t = this.world.time;
    return t < 12500 || t > 23500;
  }

  lightAt(x: number, y: number, z: number): number {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const sky = this.world.getSky(fx, fy, fz) / 15 * (this.renderer.uniforms.uSun.value as number);
    const bl = this.world.getBlockLight(fx, fy, fz) / 15;
    const f = Math.max(sky, bl);
    return Math.max(0.08, Math.min(1, f * f * 0.5 + f * 0.5));
  }

  spatialFor(pos: number[]) {
    const p = this.player.body.pos;
    return spatial(p[0], p[1] + this.player.eyeHeight, p[2], this.player.yaw, pos[0], pos[1], pos[2]);
  }

  tick(): void {
    for (const e of this.list) if (!e.dead) e.tick(this);
    // Mobs push each other apart a little.
    const mobs = this.list.filter((e): e is Mob => e instanceof Mob);
    for (let i = 0; i < mobs.length; i++) for (let j = i + 1; j < mobs.length; j++) {
      const a = mobs[i].body, b = mobs[j].body;
      const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2];
      const d = Math.hypot(dx, dz), min = (a.width + b.width) / 2;
      if (d < min && d > 0.001 && Math.abs(a.pos[1] - b.pos[1]) < 1) {
        const push = (min - d) * 0.05 / d;
        a.vel[0] -= dx * push; a.vel[2] -= dz * push; b.vel[0] += dx * push; b.vel[2] += dz * push;
      }
    }
    for (const e of this.list) if (e.dead) e.object.removeFromParent();
    this.list = this.list.filter((e) => !e.dead);
    this.particles.tick(this.world);
    this.spawnTick();
    this.tickSpawners();
  }

  render(alpha: number): void {
    for (const e of this.list) e.render(alpha, this);
    this.particles.render();
  }

  mobs(): Mob[] {
    return this.list.filter((e): e is Mob => e instanceof Mob && e.deathTime === 0);
  }

  /** First mob hit by a ray, within maxDist. */
  raycastMob(origin: number[], dir: number[], maxDist: number): { mob: Mob; dist: number } | null {
    let best: { mob: Mob; dist: number } | null = null;
    for (const m of this.mobs()) {
      const a = m.body.aabb();
      let tmin = 0, tmax = maxDist, ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(dir[k]) < 1e-9) { if (origin[k] < a.min[k] || origin[k] > a.max[k]) ok = false; continue; }
        let t1 = (a.min[k] - origin[k]) / dir[k], t2 = (a.max[k] - origin[k]) / dir[k];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) ok = false;
      }
      if (ok && (!best || tmin < best.dist)) best = { mob: m, dist: tmin };
    }
    return best;
  }

  private spawnTick(): void {
    if (this.world.tickCount % 20 !== 0) return;
    const p = this.player.body.pos;
    const mobs = this.mobs();
    const hostile = mobs.filter((m) => m.spec.hostile).length;
    const passive = mobs.length - hostile;
    const tryPos = (minD: number, maxD: number): [number, number, number] | null => {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = Math.floor(p[0] + Math.cos(a) * d), z = Math.floor(p[2] + Math.sin(a) * d);
      if (!this.world.isLoaded(x, z)) return null;
      return [x, 0, z];
    };
    // Passive animals on grass in daylight-lit areas.
    if (passive < 10 && Math.random() < 0.3) {
      const pos = tryPos(20, 48);
      if (pos) {
        const y = this.world.surfaceY(pos[0], pos[2]);
        if (this.world.getBlock(pos[0], y - 1, pos[2]) === B.grass && this.world.getSky(pos[0], y, pos[2]) >= 9) {
          const kinds = ['boar', 'hen', 'woolback'];
          const kind = kinds[Math.floor(Math.random() * kinds.length)];
          const n = 2 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) {
            const sx = pos[0] + Math.floor(Math.random() * 5) - 2, sz = pos[2] + Math.floor(Math.random() * 5) - 2;
            const sy = this.world.surfaceY(sx, sz);
            if (this.world.getBlock(sx, sy - 1, sz) === B.grass) this.spawnMob(kind, sx + 0.5, sy, sz + 0.5);
          }
        }
      }
    }
    // Hostiles in the dark (surface at night, caves any time).
    if (hostile < 14) {
      for (let tries = 0; tries < 6; tries++) {
        const pos = tryPos(20, 44);
        if (!pos) continue;
        const y0 = Math.max(4, Math.floor(p[1]) - 20 + Math.floor(Math.random() * 40));
        for (let y = y0; y > y0 - 12 && y > 1; y--) {
          const ground = this.world.getBlock(pos[0], y - 1, pos[2]);
          if (!SOLID[ground] || BLOCKS[ground].shape !== 'cube' || ground === B.bedrock || ground === B.glass || isLeafy(ground)) continue;
          if (this.world.getBlock(pos[0], y, pos[2]) !== 0 || this.world.getBlock(pos[0], y + 1, pos[2]) !== 0) continue;
          const bl = this.world.getBlockLight(pos[0], y, pos[2]);
          const sky = this.world.getSky(pos[0], y, pos[2]) * (this.isDay() ? 1 : 0.25);
          if (bl > 0 || sky > 7) break;
          const r = Math.random();
          const kind = r < 0.45 ? 'mirewalker' : r < 0.7 ? 'shellcrawler' : 'brambler';
          if (kind === 'shellcrawler' && (this.world.getBlock(pos[0] + 1, y, pos[2]) !== 0 || this.world.getBlock(pos[0], y, pos[2] + 1) !== 0)) break;
          this.spawnMob(kind, pos[0] + 0.5, y, pos[2] + 0.5);
          break;
        }
      }
    }
  }

  // ---------- Effects ----------
  private colorsFor(id: number): THREE.Color[] {
    let c = this.tileColors.get(id);
    if (c) return c;
    const cv = this.renderer.atlas.canvases[tileIndex(BLOCKS[id].tiles[0])];
    const d = cv.getContext('2d')!.getImageData(0, 0, 16, 16).data;
    c = [];
    for (let i = 0; i < 24; i++) {
      const k = Math.floor(Math.random() * 256) * 4;
      if (d[k + 3] < 128) continue;
      c.push(new THREE.Color(d[k] / 255, d[k + 1] / 255, d[k + 2] / 255));
    }
    if (!c.length) c.push(new THREE.Color(0.5, 0.5, 0.5));
    this.tileColors.set(id, c);
    return c;
  }

  blockBreakParticles(x: number, y: number, z: number, id: number, count = 24): void {
    const cols = this.colorsFor(id);
    const l = this.lightAt(x + 0.5, y + 0.5, z + 0.5);
    for (let i = 0; i < count; i++) {
      const col = cols[i % cols.length].clone().multiplyScalar(l);
      this.particles.add(
        new THREE.Vector3(x + Math.random(), y + Math.random(), z + Math.random()),
        new THREE.Vector3((Math.random() - 0.5) * 0.15, Math.random() * 0.2, (Math.random() - 0.5) * 0.15),
        col, 15 + Math.floor(Math.random() * 15), 0.08 + Math.random() * 0.05);
    }
  }

  digParticles(x: number, y: number, z: number, id: number, normal: number[]): void {
    const cols = this.colorsFor(id);
    const l = this.lightAt(x + 0.5 + normal[0], y + 0.5 + normal[1], z + 0.5 + normal[2]);
    const p = new THREE.Vector3(x + 0.5 + normal[0] * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(normal[0])), y + 0.5 + normal[1] * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(normal[1])), z + 0.5 + normal[2] * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(normal[2])));
    this.particles.add(p, new THREE.Vector3(normal[0] * 0.05 + (Math.random() - 0.5) * 0.05, 0.08, normal[2] * 0.05 + (Math.random() - 0.5) * 0.05), cols[Math.floor(Math.random() * cols.length)].clone().multiplyScalar(l), 12, 0.07);
  }

  puff(x: number, y: number, z: number): void {
    for (let i = 0; i < 14; i++) {
      this.particles.add(new THREE.Vector3(x + (Math.random() - 0.5), y + (Math.random() - 0.5), z + (Math.random() - 0.5)), new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.04, (Math.random() - 0.5) * 0.05), new THREE.Color(0.85, 0.85, 0.85), 20, 0.15, -0.002);
    }
  }

  flame(x: number, y: number, z: number): void {
    this.particles.add(new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6), new THREE.Vector3(0, 0.05, 0), new THREE.Color(1, 0.6 + Math.random() * 0.3, 0.1), 10, 0.1, -0.002);
  }

  explode(x: number, y: number, z: number, power: number): void {
    const w = this.world;
    sfx.explode(this.spatialFor([x, y, z]));
    const destroyed = new Set<string>();
    // Rays from the centre, losing strength through resistant blocks.
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
      if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
      let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
      const len = Math.hypot(dx, dy, dz);
      dx /= len; dy /= len; dz /= len;
      let strength = power * (0.7 + Math.random() * 0.6);
      let px = x, py = y, pz = z;
      while (strength > 0) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
        const id = w.getBlock(bx, by, bz);
        if (id !== 0) {
          const d = BLOCKS[id];
          const res = d.hardness < 0 ? (d.fluid ? 100 : 3600000) : d.hardness * 3;
          strength -= (res + 0.3) * 0.3;
          if (strength > 0) destroyed.add(`${bx},${by},${bz}`);
        }
        px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
        strength -= 0.225;
      }
    }
    for (const key of destroyed) {
      const [bx, by, bz] = key.split(',').map(Number);
      const id = w.getBlock(bx, by, bz);
      if (id === 0) continue;
      if (id === B.tnt) {
        w.setBlock(bx, by, bz, 0);
        const t = this.add(new TntEntity(bx, by, bz, this.renderer, 10 + Math.floor(Math.random() * 20)));
        t.body.vel = [(Math.random() - 0.5) * 0.3, 0.3, (Math.random() - 0.5) * 0.3];
        continue;
      }
      if (Math.random() < 1 / power) w.breakBlock(bx, by, bz, true);
      else { w.setBlock(bx, by, bz, 0); }
    }
    for (let i = 0; i < 40; i++) {
      this.particles.add(new THREE.Vector3(x + (Math.random() - 0.5) * power * 1.5, y + (Math.random() - 0.5) * power, z + (Math.random() - 0.5) * power * 1.5), new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.05, (Math.random() - 0.5) * 0.1), new THREE.Color().setScalar(0.5 + Math.random() * 0.4), 30 + Math.floor(Math.random() * 20), 0.4 + Math.random() * 0.4, -0.002);
    }
    // Damage and knock back entities.
    const hitBody = (b: Body): number => {
      const cx = b.pos[0], cy = b.pos[1] + b.height / 2, cz = b.pos[2];
      const d = Math.hypot(cx - x, cy - y, cz - z) / (power * 2);
      if (d > 1) return 0;
      const impact = 1 - d;
      const len = Math.hypot(cx - x, cy - y, cz - z) || 1;
      b.vel[0] += (cx - x) / len * impact; b.vel[1] += (cy - y) / len * impact + 0.2; b.vel[2] += (cz - z) / len * impact;
      return Math.floor((impact * impact + impact) / 2 * 7 * power * 2 + 1);
    };
    for (const e of this.list) {
      if (e instanceof Mob) { const dmg = hitBody(e.body); if (dmg) e.hurt(this, dmg, null, 0.4, true); }
      else if (e instanceof ItemEntity && hitBody(e.body) > 20) e.dead = true;
    }
    const pd = hitBody(this.player.body);
    if (pd) this.player.damage(pd, 'explosion');
    this.onExplosion(x, y, z);
  }

  clear(): void {
    for (const e of this.list) e.object.removeFromParent();
    this.list = [];
  }

  serialize(): unknown[] {
    return this.list.filter((e) => e instanceof Mob && e.deathTime === 0 && !(e as Mob).spec.hostile).map((e) => {
      const m = e as Mob;
      return { kind: m.spec.kind, pos: m.body.pos, health: m.health, growing: m.growing, sheared: m.sheared };
    });
  }

  load(data: unknown): void {
    if (!Array.isArray(data)) return;
    for (const d of data as { kind: string; pos: [number, number, number]; health: number; growing?: number; sheared?: boolean }[]) {
      if (!MOBS[d.kind]) continue;
      const m = this.spawnMob(d.kind, d.pos[0], d.pos[1], d.pos[2]);
      m.health = d.health;
      if (d.growing) { m.makeBaby(); m.growing = d.growing; }
      m.sheared = !!d.sheared;
    }
  }
}

function isLeafy(id: number): boolean {
  return BLOCKS[id].layer === 'cutout' && BLOCKS[id].shape === 'cube';
}
