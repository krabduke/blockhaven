// Dropped items, primed TNT, and mobs: their AI, spawning, combat and rendering.

import * as THREE from 'three';
import { EFFECTS, type EffectId } from '../effects';
import { sfx, spatial } from '../audio';
import { B, BLOCKS, SOLID, SPAWNER_KINDS } from '../blocks';
import { I, itemDef, type ItemStack } from '../items';
import { Body, moveBody, raycast, stepBody, updateContacts } from '../physics';
import type { Renderer } from '../render/renderer';
import { tileIndex } from '../tiles';
import type { World } from '../world/world';
import { createModel, type MobModel } from './models';
import { Entity, dist } from './entity';
import { Vehicle, makeVehicle, type RiderInput } from './vehicles';
import { animateMob, newAnimState } from './animate';
import { tradesFor, type TradeOffer } from '../trading';
import { HOLLOW_TOP, anchorPillars } from '../world/hollowgen';
import { nameTag } from '../render/nametag';

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
  addEffect(id: EffectId, ticks: number, level?: number): void;
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
  projectile?: ProjectileKind;
  flying?: boolean;
  aquatic?: boolean;
  fireImmune?: boolean;
  /** Attacks hostile mobs instead of the player. */
  guardian?: boolean;
  trader?: boolean;
  hops?: boolean;
  /** Creeps up, swells and bursts. */
  exploder?: boolean;
  /** Ticks between ranged attacks. */
  shotDelay?: number;
  /** A boss: no knockback, a long death, its own AI. */
  boss?: boolean;
  /** Where it naturally spawns. */
  habitat?: 'ember' | 'cave' | 'water' | 'desert' | 'cold' | 'forest' | 'swamp';
}

/** Flowers bees visit. */
const FLOWERS = new Set<number>([B.poppy, B.dandelion, B.blue_flower, B.white_flower, B.purple_flower]);

export const MOBS: Record<string, MobSpec> = {
  boar: { kind: 'boar', width: 0.9, height: 0.9, health: 10, speed: 0.7, hostile: false, pitch: 180, xp: 2, food: [I.carrot, I.wheat_item], drops: (r) => [{ id: I.raw_pork, count: 1 + Math.floor(r() * 3) }, { id: I.leather, count: Math.floor(r() * 2) }] },
  hen: { kind: 'hen', width: 0.4, height: 0.7, health: 4, speed: 0.7, hostile: false, pitch: 900, xp: 2, food: [I.seeds], drops: (r) => [{ id: I.raw_chicken, count: 1 }, { id: I.feather, count: Math.floor(r() * 3) }] },
  woolback: { kind: 'woolback', width: 0.9, height: 1.3, health: 8, speed: 0.65, hostile: false, pitch: 320, xp: 2, food: [I.wheat_item], drops: (r) => [{ id: B.wool, count: 1 }, { id: I.raw_mutton, count: 1 + Math.floor(r() * 2) }] },
  mirewalker: { kind: 'mirewalker', width: 0.6, height: 1.95, health: 20, speed: 0.75, hostile: true, attack: 3, burnsInDay: true, pitch: 110, xp: 5, drops: (r) => [{ id: I.rotten_flesh, count: Math.floor(r() * 3) }, ...(r() < 0.1 ? [{ id: I.bone, count: 1 }] : []), ...(r() < 0.03 ? [{ id: I.carrot, count: 1 }] : [])] },
  shellcrawler: { kind: 'shellcrawler', width: 1.3, height: 0.8, health: 16, speed: 0.9, hostile: true, attack: 2, pitch: 420, xp: 5, drops: (r) => [{ id: I.string, count: Math.floor(r() * 3) }] },
  villager: { kind: 'villager', width: 0.6, height: 1.95, health: 20, speed: 0.55, hostile: false, trader: true, pitch: 300, xp: 0, drops: () => [] },
  stonewarden: { kind: 'stonewarden', width: 1.4, height: 2.7, health: 100, speed: 0.5, hostile: false, guardian: true, attack: 9, pitch: 70, xp: 0, drops: (r) => [{ id: I.iron_ingot, count: 3 + Math.floor(r() * 3) }] },
  emberwisp: { kind: 'emberwisp', width: 0.9, height: 1.1, health: 12, speed: 0.6, hostile: true, ranged: true, projectile: 'fireball', flying: true, fireImmune: true, habitat: 'ember', pitch: 520, xp: 5, drops: (r) => [{ id: I.ember_core, count: r() < 0.5 ? 1 : 0 }, { id: I.gunpowder, count: Math.floor(r() * 2) }] },
  cinderbrute: { kind: 'cinderbrute', width: 1.1, height: 1.7, health: 30, speed: 0.6, hostile: true, attack: 6, fireImmune: true, habitat: 'ember', pitch: 90, xp: 8, drops: (r) => [{ id: I.cinder_brick, count: Math.floor(r() * 4) }, { id: I.gold_ingot, count: r() < 0.25 ? 1 : 0 }, { id: I.emberquartz, count: Math.floor(r() * 3) }] },
  bee: { kind: 'bee', width: 0.45, height: 0.4, health: 8, speed: 0.55, hostile: false, flying: true, pitch: 1600, xp: 1, drops: () => [] },
  mossback: { kind: 'mossback', width: 1.2, height: 1.75, health: 26, speed: 1.0, hostile: false, food: [I.wheat_item, I.apple], pitch: 160, xp: 3, drops: (r) => [{ id: I.leather, count: Math.floor(r() * 3) }] },
  burrowfox: { kind: 'burrowfox', width: 0.6, height: 0.7, health: 10, speed: 0.85, hostile: false, habitat: 'forest', food: [I.apple], pitch: 700, xp: 2, drops: (r) => [{ id: I.leather, count: Math.floor(r() * 2) }] },
  bogfrog: { kind: 'bogfrog', width: 0.5, height: 0.5, health: 6, speed: 0.6, hostile: false, hops: true, habitat: 'swamp', food: [I.seeds], pitch: 250, xp: 1, drops: (r) => [{ id: I.bog_slime, count: r() < 0.6 ? 1 : 0 }] },
  dunescuttler: { kind: 'dunescuttler', width: 0.8, height: 0.5, health: 10, speed: 1.1, hostile: true, attack: 2, habitat: 'desert', pitch: 800, xp: 5, drops: (r) => [{ id: I.string, count: Math.floor(r() * 2) }, { id: I.bone, count: Math.floor(r() * 2) }] },
  frostling: { kind: 'frostling', width: 0.5, height: 1.4, health: 14, speed: 0.75, hostile: true, ranged: true, projectile: 'snowball', habitat: 'cold', pitch: 1100, xp: 5, drops: (r) => [{ id: I.snowball, count: 1 + Math.floor(r() * 4) }, ...(r() < 0.2 ? [{ id: B.ice, count: 1 }] : [])] },
  cavemoth: { kind: 'cavemoth', width: 0.6, height: 0.5, health: 4, speed: 0.4, hostile: false, flying: true, habitat: 'cave', pitch: 1400, xp: 0, drops: () => [] },
  streamfish: { kind: 'streamfish', width: 0.4, height: 0.3, health: 3, speed: 0.5, hostile: false, aquatic: true, habitat: 'water', pitch: 1200, xp: 1, drops: () => [{ id: I.raw_fish, count: 1 }] },
  zombie: { kind: 'zombie', width: 0.6, height: 1.95, health: 20, speed: 0.7, hostile: true, attack: 3, burnsInDay: true, pitch: 140, xp: 5, drops: (r) => [{ id: I.rotten_flesh, count: Math.floor(r() * 3) }, ...(r() < 0.03 ? [{ id: I.iron_ingot, count: 1 }] : r() < 0.04 ? [{ id: I.carrot, count: 1 }] : r() < 0.04 ? [{ id: I.potato, count: 1 }] : [])] },
  skeleton: { kind: 'skeleton', width: 0.6, height: 1.95, health: 20, speed: 0.7, hostile: true, ranged: true, projectile: 'arrow', shotDelay: 34, burnsInDay: true, pitch: 480, xp: 5, drops: (r) => [{ id: I.bone, count: Math.floor(r() * 3) }, { id: I.arrow, count: Math.floor(r() * 3) }] },
  colossus: { kind: 'colossus', width: 2.4, height: 4.4, health: 300, speed: 1, hostile: true, flying: true, fireImmune: true, boss: true, pitch: 55, xp: 0, drops: () => [] },
  raider: { kind: 'raider', width: 0.6, height: 1.95, health: 24, speed: 0.75, hostile: true, ranged: true, projectile: 'arrow', shotDelay: 50, pitch: 210, xp: 6, drops: (r) => [{ id: I.arrow, count: Math.floor(r() * 3) }, ...(r() < 0.35 ? [{ id: I.amber, count: 1 }] : []), ...(r() < 0.06 ? [{ id: I.crossbow, count: 1 }] : [])] },
  witch: { kind: 'witch', width: 0.6, height: 1.95, health: 26, speed: 0.6, hostile: true, ranged: true, projectile: 'potion', shotDelay: 60, pitch: 620, xp: 5, drops: (r) => [[I.glow_dust, I.sugar, I.string, I.stick, I.gunpowder][Math.floor(r() * 5)]].map((id) => ({ id, count: 1 + Math.floor(r() * 2) })) },
  blastcap: { kind: 'blastcap', width: 0.8, height: 1.1, health: 16, speed: 0.8, hostile: true, exploder: true, pitch: 360, xp: 5, drops: (r) => [{ id: I.gunpowder, count: Math.floor(r() * 3) }] },
  brambler: { kind: 'brambler', width: 0.6, height: 1.9, health: 20, speed: 0.7, hostile: true, ranged: true, projectile: 'thorn', burnsInDay: true, pitch: 260, xp: 5, drops: (r) => [{ id: I.arrow, count: Math.floor(r() * 3) }, { id: I.bone, count: Math.floor(r() * 3) }, { id: I.gunpowder, count: Math.floor(r() * 2) }] },
};

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
    // Pickup, by whoever is nearest.
    const p = m.nearestPlayer(b.pos);
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
  /** Tamed by the player (foxes follow and defend you; mossbacks can be saddled and ridden). */
  tamed = false;
  /** A tamed fox told to stay. */
  sitting = false;
  saddled = false;
  /** Mossbacks warm to you with each feeding. */
  temper = 0;
  /** Bees: their nest, whether they carry nectar, and how long they stay angry. */
  home: [number, number, number] | null = null;
  nectar = false;
  beeAnger = 0;
  /** Raiders march on this point (a village centre) when nothing is in range. */
  rally: [number, number] | null = null;
  /** Raid captains are tougher and carry a banner. */
  captain = false;
  /** Boss state: circling the island, diving at you, or climbing back out. */
  bossPhase: 'circle' | 'swoop' | 'return' = 'circle';
  bossTimer = 0;
  orbit = 0;
  /** The anchor stone mending it, if any (drawn as a beam). */
  healFrom: [number, number, number] | null = null;
  private beam?: THREE.Line;
  /** A name given with a name tag: shown above it, and it never despawns. */
  customName = '';
  private tag?: THREE.Sprite;
  private tagText = '';
  /** On a lead: held by you, or tied to the fence post at this spot. */
  leash: 'player' | [number, number, number] | null = null;
  private leashLine?: THREE.Line;
  private beeTimer = 0;
  /** Ridden by the player: movement comes from the rider's keys. */
  ridden = false;
  riderInput: RiderInput = { forward: 0, strafe: 0, jump: false, yaw: 0, sprint: false };
  eggTimer = 6000 + Math.floor(Math.random() * 6000);
  hurtByPlayer = 0;
  /** Guardians get angry at a player who hits them. */
  angry = 0;
  profession = 'farmer';
  offers: TradeOffer[] = [];
  hopTimer = 0;
  flyTarget: [number, number, number] | null = null;
  /** Aiming at or chasing a target this tick (drives arm poses). */
  aiming = false;
  /** Blastcap fuse, 0..30. */
  fuse = 0;
  healCooldown = 0;
  /** Grazing or pecking at the ground (peaceful animals). */
  grazeTicks = 0;
  anim = newAnimState();
  /** Individuals differ a little in size. */
  readonly sizeJitter = 0.93 + Math.random() * 0.14;
  private lastFrame = performance.now();
  model: MobModel;
  constructor(readonly spec: MobSpec, x: number, y: number, z: number, profession?: string) {
    const body = new Body(x, y, z, spec.width, spec.height);
    const model = createModel(spec.trader ? `villager:${profession ?? 'farmer'}` : spec.kind);
    super(body, model.root);
    this.model = model;
    this.health = spec.health;
    if (spec.trader) {
      this.profession = profession ?? 'farmer';
      this.offers = tradesFor(this.profession, Math.random);
    }
  }

  get baby(): boolean { return this.growing > 0; }

  makeBaby(): void {
    this.growing = 6000;
    this.body.width = this.spec.width * 0.5;
    this.body.height = this.spec.height * 0.5;
  }

  hurt(m: EntityManager, amount: number, from: [number, number, number] | null, knock = 0.4, byPlayer = false): void {
    // A guest's copy of the host's creature: the host decides what the hit does.
    if (this.netId) { if (this.hurtTime === 0 && this.deathTime === 0) { m.onPuppetHit(this, amount, from, knock); this.hurtTime = 10; } return; }
    if (this.hurtTime > 0 || this.deathTime > 0) return;
    this.health -= amount;
    this.hurtTime = 10;
    if (byPlayer) { this.hurtByPlayer = 100; if (this.spec.guardian) this.angry = 600; }
    if (from && !this.spec.boss) {
      const dx = this.body.pos[0] - from[0], dz = this.body.pos[2] - from[2];
      const d = Math.hypot(dx, dz) || 1;
      this.body.vel[0] += (dx / d) * knock;
      this.body.vel[2] += (dz / d) * knock;
      this.body.vel[1] = Math.max(this.body.vel[1], 0.3);
    }
    const s = m.spatialFor(this.body.pos);
    sfx.mobHurt(this.spec.pitch * (this.baby ? 1.5 : 1), s);
    if (!this.spec.hostile) { this.panic = 60; this.grazeTicks = 0; }
    if (this.spec.kind === 'bee' && byPlayer) for (const o of m.mobs()) if (o.spec.kind === 'bee' && dist(o.body.pos, this.body.pos) < 12) o.beeAnger = 400;
    if (this.health <= 0) {
      this.deathTime = 1;
      if (this.leash) this.dropLead(m);
      if (!this.baby) {
        for (const st of this.spec.drops(Math.random)) if (st.count > 0) m.dropItem(this.body.pos[0], this.body.pos[1] + 0.5, this.body.pos[2], st);
        if (this.hurtByPlayer > 0) m.dropXp(this.body.pos[0], this.body.pos[1] + 0.5, this.body.pos[2], this.spec.hostile ? this.spec.xp : 1 + Math.floor(Math.random() * this.spec.xp + 1));
      }
      m.onMobKilled(this, this.hurtByPlayer > 0);
    }
  }

  /** Right-click with an item. Returns true if the item was used. */
  interact(m: EntityManager, stack: ItemStack | null): 'fed' | 'sheared' | 'trade' | 'tamed' | 'saddled' | 'ride' | 'sit' | null {
    if (this.deathTime || this.netId) return null;
    if (this.spec.trader && !this.baby) return 'trade';
    const b = this.body.pos;
    // Taming: foxes take apples, mossbacks warm up to you over several feedings.
    if (!this.tamed && !this.baby && stack && ((this.spec.kind === 'burrowfox' && stack.id === I.apple) || (this.spec.kind === 'mossback' && this.spec.food?.includes(stack.id)))) {
      this.temper += this.spec.kind === 'mossback' ? 2 : 4;
      if (Math.random() * 10 < this.temper) {
        this.tamed = true;
        this.panic = 0;
        for (let i = 0; i < 7; i++) m.heart(b[0], b[1] + this.body.height + 0.2, b[2]);
        sfx.levelUp();
        return 'tamed';
      }
      for (let i = 0; i < 5; i++) m.puff(b[0], b[1] + this.body.height, b[2]);
      return 'fed';
    }
    if (this.tamed && this.spec.kind === 'mossback') {
      if (!this.saddled && stack?.id === I.saddle) { this.saddled = true; sfx.place('wool'); return 'saddled'; }
      if (this.saddled && !this.baby && (!stack || !this.spec.food?.includes(stack.id))) return 'ride';
    }
    if (this.tamed && this.spec.kind === 'burrowfox' && (!stack || stack.id !== I.apple)) {
      this.sitting = !this.sitting;
      return 'sit';
    }
    if (!stack) return null;
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
      if (this.spec.boss) {
        // It comes apart slowly, shedding light, then bursts.
        const b = this.body;
        b.pos[1] += 0.05;
        for (let i = 0; i < 4; i++) m.particles.add(new THREE.Vector3(b.pos[0] + (Math.random() - 0.5) * 3, b.pos[1] + Math.random() * 4.4, b.pos[2] + (Math.random() - 0.5) * 3), new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3), new THREE.Color(0.7 + Math.random() * 0.3, 0.6, 1), 30, 0.25, -0.004);
        if (this.deathTime % 15 === 0) sfx.explode({ gain: 0.5, pan: 0 });
        if (this.deathTime > 90) { this.dead = true; this.beam?.removeFromParent(); m.puff(b.pos[0], b.pos[1] + 2, b.pos[2]); m.onBossDefeated(this); }
        return;
      }
      if (this.deathTime > 20) { this.dead = true; m.puff(this.body.pos[0], this.body.pos[1] + 0.5, this.body.pos[2]); }
      return;
    }
    const w = m.world, b = this.body, p = m.nearestPlayer(this.body.pos);
    updateContacts(w, b, this.body.height * 0.85);
    if (this.leash) this.leashTick(m);
    if (b.onCampfire && this.age % 20 === 0 && !this.spec.fireImmune) this.hurt(m, 1, null, 0);
    if (this.angry > 0) this.angry--;
    if (this.healCooldown > 0) this.healCooldown--;
    this.aiming = false;
    if (this.ridden) { this.rideTick(m); return; }
    if (this.tamed && this.spec.kind === 'burrowfox' && this.companionTick(m)) return;
    if (this.spec.kind === 'bee') { this.beeTick(m); return; }
    if (this.spec.boss) { this.colossusTick(m); return; }
    if (this.spec.flying) { this.flyTick(m); return; }
    if (this.spec.aquatic) { this.swimTick(m); return; }
    let forward = 0;
    let jump = false;
    const daylight = m.isDay() || w.dimension !== 'overworld';
    const face = (dx: number, dz: number) => { this.yaw = Math.atan2(-dx, -dz); };
    const pd0 = dist(p.body.pos, b.pos);
    // Pick a target: hostiles go for the player or villagers; guardians go for hostiles.
    let target: { pos: number[]; hit: (dmg: number, knock: [number, number]) => void; eye: number } | null = null;
    if (this.spec.hostile || (this.spec.guardian && this.angry > 0)) {
      if (p.alive && !p.creative && pd0 < (this.rally ? 24 : 16)) target = { pos: p.body.pos, hit: (d, k) => p.damage(d, this.spec.kind, k), eye: 1.5 };
    }
    if (this.spec.hostile && this.spec.kind !== 'shellcrawler' && this.age % 10 === 0 || this.spec.guardian) {
      const pool = m.mobs().filter((o) => o !== this && (this.spec.guardian ? o.spec.hostile : o.spec.trader));
      let best: Mob | null = null, bd = target ? pd0 : this.rally ? 32 : 16;
      for (const o of pool) { const d = dist(o.body.pos, b.pos); if (d < bd) { bd = d; best = o; } }
      if (best) { const o = best; target = { pos: o.body.pos, hit: (d) => o.hurt(m, d, b.pos, 0.5), eye: o.body.height * 0.8 }; }
    }
    const toPlayer = target ? [target.pos[0] - b.pos[0], target.pos[1] - b.pos[1], target.pos[2] - b.pos[2]] : [p.body.pos[0] - b.pos[0], p.body.pos[1] - b.pos[1], p.body.pos[2] - b.pos[2]];
    const pd = Math.hypot(toPlayer[0], toPlayer[1], toPlayer[2]);

    const aggressive = !!target && !(this.spec.kind === 'shellcrawler' && daylight && this.panic === 0 && this.hurtTime === 0 && this.health === this.spec.health);
    const tempted = !this.spec.hostile && p.alive && pd0 < 10 && !!p.held && !!this.spec.food?.includes(p.held.id);
    // Villagers run from nearby monsters.
    if (this.spec.trader && this.age % 20 === 0 && m.mobs().some((o) => o.spec.hostile && dist(o.body.pos, b.pos) < 8)) this.panic = 40;
    if (aggressive && this.spec.ranged) {
      // Keep a distance and shoot thorns when there's a clear line of sight.
      face(toPlayer[0], toPlayer[2]);
      const tp = target!.pos;
      const sees = m.lineOfSight([b.pos[0], b.pos[1] + b.height * 0.8, b.pos[2]], [tp[0], tp[1] + target!.eye, tp[2]]);
      forward = pd > 10 || !sees ? 1 : pd < 5 ? -1 : 0;
      this.aiming = sees && pd < 16;
      // Witches drink a healing brew when badly hurt.
      if (this.spec.kind === 'witch' && this.health < this.spec.health * 0.4 && this.healCooldown === 0) {
        this.health = Math.min(this.spec.health, this.health + 10);
        this.healCooldown = 400;
        for (let i = 0; i < 8; i++) m.heart(b.pos[0], b.pos[1] + 1.8, b.pos[2]);
      }
      if (sees && pd < 14 && this.attackCooldown === 0) {
        this.attackCooldown = this.spec.shotDelay ?? (this.spec.projectile === 'snowball' ? 25 : 40);
        const kind = this.spec.projectile ?? 'thorn';
        const speed = kind === 'snowball' ? 1.3 : kind === 'potion' ? 0.75 : kind === 'arrow' ? 1.6 : 1.4;
        const lob = kind === 'potion' ? pd * 0.09 : pd * 0.03;
        m.shoot(kind, this, [b.pos[0], b.pos[1] + b.height * 0.8, b.pos[2]], [toPlayer[0], toPlayer[1] + target!.eye - b.height * 0.8 + lob, toPlayer[2]], speed, kind === 'arrow' ? 0.06 : 0.12);
      }
    } else if (aggressive && this.spec.exploder) {
      face(toPlayer[0], toPlayer[2]);
      this.aiming = true;
      const close = pd < 3 && m.lineOfSight([b.pos[0], b.pos[1] + 0.8, b.pos[2]], [target!.pos[0], target!.pos[1] + target!.eye, target!.pos[2]]);
      if (close || (this.fuse > 0 && pd < 7)) {
        if (this.fuse === 0) sfx.fuse(m.spatialFor(b.pos));
        this.fuse++;
        forward = 0;
        if (this.fuse >= 30) {
          this.dead = true;
          m.explode(b.pos[0], b.pos[1] + 0.5, b.pos[2], 3);
          return;
        }
      } else {
        this.fuse = Math.max(0, this.fuse - 1);
        forward = pd > 1.5 ? 1 : 0;
      }
    } else if (aggressive) {
      face(toPlayer[0], toPlayer[2]);
      this.aiming = true;
      forward = pd > 0.9 ? 1 : 0;
      if (pd < 1.3 + this.spec.width / 2 && Math.abs(toPlayer[1]) < 1.8 && this.attackCooldown === 0) {
        this.attackCooldown = this.spec.guardian ? 30 : 20;
        target!.hit(this.spec.attack ?? 2, [toPlayer[0] / (pd || 1), toPlayer[2] / (pd || 1)]);
        if (this.spec.guardian) sfx.explode({ gain: 0.2, pan: 0 });
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
      // Animals stop now and then to graze or peck at the ground.
      const grazer = this.spec.kind === 'boar' || this.spec.kind === 'woolback' || this.spec.kind === 'hen' || this.spec.kind === 'burrowfox';
      if (grazer && this.grazeTicks === 0 && Math.random() < 0.006) { this.grazeTicks = 30 + Math.floor(Math.random() * 60); this.target = null; }
      if (this.grazeTicks > 0) {
        this.grazeTicks--;
        if (this.spec.kind === 'woolback' && this.sheared && this.grazeTicks === 1 && w.getBlock(Math.floor(b.pos[0]), Math.floor(b.pos[1] - 0.5), Math.floor(b.pos[2])) === B.grass) this.sheared = false;
      }
      if (this.rally && Math.hypot(this.rally[0] - b.pos[0], this.rally[1] - b.pos[2]) > 6) this.target = [this.rally[0], 0, this.rally[1]];
      else if (this.grazeTicks === 0 && --this.wanderTimer <= 0) {
        this.wanderTimer = 60 + Math.floor(Math.random() * 120);
        this.target = Math.random() < 0.6 ? null : [b.pos[0] + (Math.random() - 0.5) * 16, 0, b.pos[2] + (Math.random() - 0.5) * 16];
      }
      if (this.target) {
        const dx = this.target[0] - b.pos[0], dz = this.target[2] - b.pos[2];
        if (Math.hypot(dx, dz) < 1) this.target = null;
        else { face(dx, dz); forward = this.rally ? 1 : 0.6; }
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
    if (this.spec.hops) {
      if (!b.onGround) forward = 1;
      else if (--this.hopTimer <= 0 && (forward > 0 || Math.random() < 0.02)) { this.hopTimer = 20 + Math.floor(Math.random() * 30); jump = true; forward = 1; }
      else forward = 0;
    }
    const speed = this.spec.speed * (forward > 1 ? 1.25 : 1) * (forward > 0 && forward < 1 ? 0.8 : 1) * (this.baby ? 1.2 : 1);
    stepBody(w, b, { forward: forward > 0 ? 1 : forward < 0 ? -1 : 0, strafe: 0, jump, sneak: false, sprint: false, yaw: this.yaw }, false, speed);
    if (b.onGround && b.fallDistance > 3) this.hurt(m, Math.ceil(b.fallDistance - 3), null);
    if (b.onGround) b.fallDistance = 0;
    if (b.inLava && !this.spec.fireImmune) { this.hurt(m, 4, null, 0); this.burning = 160; }
    if (b.inFire && !this.spec.fireImmune) this.burning = Math.max(this.burning, 80);
    // Burning in daylight (rain and water put it out).
    const raining = m.world.weather !== 'clear';
    if (this.spec.burnsInDay && daylight && !b.inWater && !raining) {
      const sky = w.getSky(Math.floor(b.pos[0]), Math.floor(b.pos[1] + 1.6), Math.floor(b.pos[2]));
      if (sky >= 15) this.burning = 60;
    }
    if (this.spec.fireImmune) this.burning = 0;
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
    if (!this.rally && !this.spec.boss && !this.customName && !this.leash && (this.spec.hostile || this.spec.habitat === 'cave' || this.spec.habitat === 'water') && (pd0 > 96 || (pd0 > 40 && Math.random() < 1 / 800))) this.dead = true;
    if (b.pos[1] < -20) this.dead = true;
  }

  /**
   * The Hollow Colossus: circles the central island, hurls volleys of void shards, and now and then
   * dives at you to slam with its fists. While an anchor stone stands it mends itself.
   */
  private colossusTick(m: EntityManager): void {
    const b = this.body, p = m.nearestPlayer(this.body.pos), pp = p.body.pos;
    const target = p.alive && !p.creative;
    const toP = [pp[0] - b.pos[0], pp[1] + 1 - (b.pos[1] + 2.2), pp[2] - b.pos[2]];
    const dP = Math.hypot(toP[0], toP[1], toP[2]);
    // Mending from the nearest anchor stone.
    if (this.age % 20 === 0) {
      let best: [number, number, number] | null = null, bd = Infinity;
      for (const a of m.anchorsStanding()) { const d = dist(a, b.pos); if (d < bd) { bd = d; best = a; } }
      this.healFrom = best;
      if (best && this.health < this.spec.health) this.health = Math.min(this.spec.health, this.health + 2);
    }
    let goal: number[];
    let maxSpeed = 0.42;
    this.bossTimer++;
    if (this.bossPhase === 'circle') {
      this.orbit += 0.008;
      goal = [Math.cos(this.orbit) * 34, HOLLOW_TOP + 22 + Math.sin(this.age / 45) * 4, Math.sin(this.orbit) * 34];
      // A volley of three shards every few seconds.
      const cycle = this.bossTimer % 110;
      if (target && dP < 72 && (cycle === 80 || cycle === 88 || cycle === 96)) {
        const lead = dP / 0.9;
        const aim = [toP[0] + p.body.vel[0] * lead * 0.5, toP[1], toP[2] + p.body.vel[2] * lead * 0.5];
        m.shoot('shard', this, [b.pos[0], b.pos[1] + 2.6, b.pos[2]], aim, 0.9, 0.03, 5.5);
        this.aiming = true;
      }
      if (target && dP < 80 && this.bossTimer > 380) { this.bossPhase = 'swoop'; this.bossTimer = 0; sfx.warHorn(); }
    } else if (this.bossPhase === 'swoop') {
      goal = [pp[0], pp[1] + 0.5, pp[2]];
      maxSpeed = 0.75;
      this.aiming = true;
      if (dP < 3.6 && target) {
        p.damage(7, 'colossus', [toP[0] / (dP || 1), toP[2] / (dP || 1)]);
        p.body.vel[1] = Math.max(p.body.vel[1], 0.7);
        this.attackCooldown = 30;
        sfx.explode({ gain: 0.6, pan: 0 });
        this.bossPhase = 'return'; this.bossTimer = 0;
      } else if (!target || this.bossTimer > 200) { this.bossPhase = 'return'; this.bossTimer = 0; }
    } else {
      goal = [Math.cos(this.orbit) * 34, HOLLOW_TOP + 24, Math.sin(this.orbit) * 34];
      if (dist(goal, b.pos) < 6 || this.bossTimer > 240) { this.bossPhase = 'circle'; this.bossTimer = 0; }
    }
    const d = [goal[0] - b.pos[0], goal[1] - b.pos[1], goal[2] - b.pos[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    for (let k = 0; k < 3; k++) b.vel[k] = b.vel[k] * 0.94 + (d[k] / dl) * 0.035;
    const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
    if (sp > maxSpeed) for (let k = 0; k < 3; k++) b.vel[k] *= maxSpeed / sp;
    b.pos[0] += b.vel[0]; b.pos[1] += b.vel[1]; b.pos[2] += b.vel[2];
    // Face where it's going, or you when it's attacking.
    const look = this.aiming ? toP : b.vel;
    if (Math.hypot(look[0], look[2]) > 0.01) {
      let dy = Math.atan2(-look[0], -look[2]) - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * 0.12;
    }
    // Brushing past it hurts.
    if (target && dP < 2.6 && this.age % 20 === 0) p.damage(4, 'colossus', [toP[0] / (dP || 1), toP[2] / (dP || 1)]);
    if (this.age % 160 === 0 && dP < 64) sfx.mobSay(this.spec.pitch, m.spatialFor(b.pos));
  }

  /** Where the other end of its lead is. */
  leashAnchor(m: EntityManager): [number, number, number] | null {
    if (!this.leash) return null;
    if (this.leash === 'player') { const pp = m.player.body.pos; return [pp[0], pp[1] + 1.1, pp[2]]; }
    return [this.leash[0] + 0.5, this.leash[1] + 0.6, this.leash[2] + 0.5];
  }

  /** A lead pulls it along when it strays, and snaps if dragged too far. */
  private leashTick(m: EntityManager): void {
    const b = this.body;
    const tied = Array.isArray(this.leash) ? this.leash : null;
    if (tied && m.world.getBlock(tied[0], tied[1], tied[2]) !== B.fence) { this.dropLead(m); return; }
    if (this.leash === 'player' && !m.player.alive) { this.dropLead(m); return; }
    const a = this.leashAnchor(m)!;
    const dx = a[0] - b.pos[0], dy = a[1] - 1 - b.pos[1], dz = a[2] - b.pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > 12) { this.dropLead(m); sfx.click(); return; }
    if (d > 3.5) {
      const k = Math.min(0.12, (d - 3.5) * 0.03) / d;
      b.vel[0] += dx * k; b.vel[2] += dz * k;
      if (dy > 0.5 && b.onGround) b.vel[1] = Math.max(b.vel[1], 0.42);
      this.yaw = Math.atan2(-dx, -dz);
      this.panic = 0;
    }
  }

  dropLead(m: EntityManager): void {
    if (!this.leash) return;
    this.leash = null;
    m.dropItem(this.body.pos[0], this.body.pos[1] + 0.5, this.body.pos[2], { id: I.lead, count: 1 });
  }

  /** Carrying the player: turn toward where they look, run when they sprint, leap with jump. */
  private rideTick(m: EntityManager): void {
    const b = this.body, inp = this.riderInput;
    let dy = inp.yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * 0.35;
    const speed = inp.forward > 0 ? (inp.sprint ? 1.9 : 1.2) : inp.forward < 0 ? 0.5 : 0;
    const jump = inp.jump && b.onGround;
    stepBody(m.world, b, { forward: inp.forward > 0 ? 1 : inp.forward < 0 ? -1 : 0, strafe: inp.strafe * 0.5, jump: false, sneak: false, sprint: false, yaw: this.yaw }, false, speed * this.spec.speed);
    if (jump) { b.vel[1] = 0.62; b.vel[0] -= Math.sin(this.yaw) * 0.25; b.vel[2] -= Math.cos(this.yaw) * 0.25; }
    b.fallDistance = 0;
    this.walkAnim += Math.hypot(b.vel[0], b.vel[2]) * 3.5;
    this.headYaw *= 0.8;
  }

  /**
   * A tamed fox: stays put when told to sit, otherwise defends you from nearby monsters and
   * trots after you, catching up by teleporting if you get far ahead. Returns true when it acted.
   */
  private companionTick(m: EntityManager): boolean {
    const b = this.body, p = m.player;
    if (this.sitting) {
      stepBody(m.world, b, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: this.yaw }, false, 0);
      return true;
    }
    const pd = dist(p.body.pos, b.pos);
    if (pd > 24 && p.alive) {
      b.pos = [p.body.pos[0] + (Math.random() - 0.5) * 2, p.body.pos[1], p.body.pos[2] + (Math.random() - 0.5) * 2];
      b.vel = [0, 0, 0];
      return true;
    }
    const foe = m.mobs().find((o) => o.spec.hostile && dist(o.body.pos, p.body.pos) < 10 && dist(o.body.pos, b.pos) < 14);
    const goal = foe ? foe.body.pos : pd > 3 ? p.body.pos : null;
    if (!goal) return false;
    const dx = goal[0] - b.pos[0], dz = goal[2] - b.pos[2];
    this.yaw = Math.atan2(-dx, -dz);
    const d = Math.hypot(dx, dz);
    if (foe) {
      this.aiming = true;
      if (d < 1.4 && this.attackCooldown === 0) { this.attackCooldown = 16; foe.hurt(m, 3, b.pos, 0.4); }
    }
    stepBody(m.world, b, { forward: d > (foe ? 0.9 : 2) ? 1 : 0, strafe: 0, jump: b.collidedH || b.inWater, sneak: false, sprint: false, yaw: this.yaw }, false, this.spec.speed * (foe || pd > 8 ? 1.4 : 1));
    this.walkAnim += Math.hypot(b.vel[0], b.vel[2]) * 3.5;
    if (b.onGround) b.fallDistance = 0;
    return true;
  }

  /**
   * Bees: forage at flowers near their nest, bring nectar home (a level of honey per trip),
   * help crops they fly over grow, and sting you if angered (then calm down).
   */
  private beeTick(m: EntityManager): void {
    const b = this.body, w = m.world, p = m.nearestPlayer(this.body.pos);
    if (!this.home && (this.age === 1 || this.age % 200 === 0)) {
      // Find the nest it came from (spawned beside it).
      for (let dy = -2; dy <= 2 && !this.home; dy++) for (let dz = -3; dz <= 3 && !this.home; dz++) for (let dx = -3; dx <= 3; dx++) {
        const id = w.getBlock(Math.floor(b.pos[0]) + dx, Math.floor(b.pos[1]) + dy, Math.floor(b.pos[2]) + dz);
        if (id === B.bee_nest || id === B.beehive) { this.home = [Math.floor(b.pos[0]) + dx, Math.floor(b.pos[1]) + dy, Math.floor(b.pos[2]) + dz]; break; }
      }
    }
    let goal: number[] | null = null;
    if (this.beeAnger > 0 && p.alive && !p.creative) {
      this.beeAnger--;
      goal = [p.body.pos[0], p.body.pos[1] + 1.4, p.body.pos[2]];
      if (dist(goal, b.pos) < 1.2 && this.attackCooldown === 0) {
        const d = [p.body.pos[0] - b.pos[0], p.body.pos[2] - b.pos[2]], l = Math.hypot(d[0], d[1]) || 1;
        p.damage(1, 'bee', [d[0] / l, d[1] / l]);
        p.addEffect('poison', 100);
        this.attackCooldown = 40;
        this.beeAnger = 0; // one sting, then it calms down
      }
    } else if (this.home && this.nectar) {
      goal = [this.home[0] + 0.5, this.home[1] + 0.5, this.home[2] + 0.5];
      if (dist(goal, b.pos) < 1.4) {
        const [hx, hy, hz] = this.home, id = w.getBlock(hx, hy, hz);
        if (id === B.bee_nest || id === B.beehive) { const lvl = w.getMeta(hx, hy, hz); if (lvl < 5) w.setMeta(hx, hy, hz, lvl + 1); }
        else this.home = null;
        this.nectar = false;
        this.flyTarget = null;
      }
    } else {
      // Forage: pick a flower near home, hover at it a moment, then head back with nectar.
      const base = this.home ?? b.pos.map(Math.floor);
      if (!this.flyTarget || this.age % 200 === 0) {
        this.flyTarget = null;
        for (let t = 0; t < 12 && !this.flyTarget; t++) {
          const x = base[0] + Math.floor(Math.random() * 21) - 10, z = base[2] + Math.floor(Math.random() * 21) - 10;
          for (let y = base[1] + 4; y > base[1] - 8; y--) if (FLOWERS.has(w.getBlock(x, y, z))) { this.flyTarget = [x + 0.5, y + 0.6, z + 0.5]; break; }
        }
        if (!this.flyTarget) this.flyTarget = [base[0] + (Math.random() - 0.5) * 8, base[1] + Math.random() * 3, base[2] + (Math.random() - 0.5) * 8];
      }
      goal = this.flyTarget;
      if (dist(goal, b.pos) < 0.8) {
        if (++this.beeTimer > 40) { this.beeTimer = 0; if (FLOWERS.has(w.getBlock(Math.floor(goal[0]), Math.floor(goal[1] - 0.5), Math.floor(goal[2])))) this.nectar = true; this.flyTarget = null; }
      }
    }
    // Carrying nectar over crops helps them grow.
    if (this.nectar && this.age % 10 === 0) {
      const cx = Math.floor(b.pos[0]), cz = Math.floor(b.pos[2]);
      for (let dy = 1; dy <= 3; dy++) {
        const cy = Math.floor(b.pos[1]) - dy, id = w.getBlock(cx, cy, cz);
        if ((id === B.wheat || id === B.carrots || id === B.potatoes || id === B.redroot) && Math.random() < 0.3) { const mm = w.getMeta(cx, cy, cz); if (mm < 7) w.setMeta(cx, cy, cz, mm + 1); break; }
      }
    }
    if (goal) {
      const d = [goal[0] - b.pos[0], goal[1] - b.pos[1], goal[2] - b.pos[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
      const acc = this.spec.speed * (this.beeAnger > 0 ? 0.045 : 0.025);
      b.vel[0] += d[0] / l * acc; b.vel[1] += d[1] / l * acc; b.vel[2] += d[2] / l * acc;
    }
    b.vel[0] += (Math.random() - 0.5) * 0.02; b.vel[1] += (Math.random() - 0.5) * 0.02; b.vel[2] += (Math.random() - 0.5) * 0.02;
    moveBody(w, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
    b.vel[0] *= 0.88; b.vel[1] *= 0.88; b.vel[2] *= 0.88;
    if (Math.hypot(b.vel[0], b.vel[2]) > 0.01) this.yaw = Math.atan2(-b.vel[0], -b.vel[2]);
    this.walkAnim += 0.4;
    if (b.pos[1] < -20 || dist(p.body.pos, b.pos) > 96) this.dead = true;
  }

  /** Floating movement for Emberwisps and moths. */
  private flyTick(m: EntityManager): void {
    const b = this.body, p = m.nearestPlayer(this.body.pos), w = m.world;
    const pd = dist(p.body.pos, b.pos);
    const hostile = this.spec.hostile && p.alive && !p.creative && pd < 32;
    if (!this.flyTarget || dist(this.flyTarget, b.pos) < 1.5 || this.age % 100 === 0) {
      const r = this.spec.hostile ? 10 : 4;
      const base = hostile ? [p.body.pos[0], p.body.pos[1] + 5, p.body.pos[2]] : b.pos;
      this.flyTarget = [base[0] + (Math.random() - 0.5) * r * 2, base[1] + (Math.random() - 0.5) * r, base[2] + (Math.random() - 0.5) * r * 2];
    }
    const t = this.flyTarget;
    const d = dist(t, b.pos) || 1;
    const acc = this.spec.speed * 0.02;
    b.vel[0] += (t[0] - b.pos[0]) / d * acc; b.vel[1] += (t[1] - b.pos[1]) / d * acc; b.vel[2] += (t[2] - b.pos[2]) / d * acc;
    if (this.spec.kind === 'cavemoth') { b.vel[0] += (Math.random() - 0.5) * 0.03; b.vel[1] += (Math.random() - 0.5) * 0.03; b.vel[2] += (Math.random() - 0.5) * 0.03; }
    moveBody(w, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
    b.vel[0] *= 0.9; b.vel[1] *= 0.9; b.vel[2] *= 0.9;
    if (b.collidedH) this.flyTarget = null;
    this.yaw = Math.atan2(-b.vel[0], -b.vel[2]);
    if (hostile) {
      const to = [p.body.pos[0] - b.pos[0], p.body.pos[1] + 1.4 - b.pos[1], p.body.pos[2] - b.pos[2]];
      this.yaw = Math.atan2(-to[0], -to[2]);
      if (this.attackCooldown === 0 && pd < 24 && m.lineOfSight([b.pos[0], b.pos[1] + 0.5, b.pos[2]], [p.body.pos[0], p.body.pos[1] + 1.5, p.body.pos[2]])) {
        this.attackCooldown = 60 + Math.floor(Math.random() * 40);
        m.shoot('fireball', this, [b.pos[0], b.pos[1] + 0.5, b.pos[2]], to, 0.9, 0.05, 5);
      }
    }
    this.walkAnim += 0.3;
    if (b.inLava && !this.spec.fireImmune) this.hurt(m, 4, null, 0);
    if (this.spec.hostile && (pd > 96 || (pd > 48 && Math.random() < 1 / 600))) this.dead = true;
    if (this.spec.habitat === 'cave' && pd > 64) this.dead = true;
  }

  /** Swimming movement for fish; they flop and suffocate out of water. */
  private swimTick(m: EntityManager): void {
    const b = this.body, w = m.world;
    if (!b.inWater) {
      b.vel[1] -= 0.08;
      if (b.onGround && Math.random() < 0.1) { b.vel[1] = 0.3; b.vel[0] = (Math.random() - 0.5) * 0.2; b.vel[2] = (Math.random() - 0.5) * 0.2; }
      moveBody(w, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
      b.vel[0] *= 0.8; b.vel[2] *= 0.8;
      if (this.age % 20 === 0) this.hurt(m, 1, null, 0);
      return;
    }
    if (!this.flyTarget || dist(this.flyTarget, b.pos) < 1 || this.age % 80 === 0 || this.panic > 0) {
      this.flyTarget = [b.pos[0] + (Math.random() - 0.5) * 10, b.pos[1] + (Math.random() - 0.5) * 3, b.pos[2] + (Math.random() - 0.5) * 10];
    }
    const t = this.flyTarget, d = dist(t, b.pos) || 1;
    const acc = this.spec.speed * (this.panic > 0 ? 0.05 : 0.02);
    if (this.panic > 0) this.panic--;
    b.vel[0] += (t[0] - b.pos[0]) / d * acc; b.vel[1] += (t[1] - b.pos[1]) / d * acc; b.vel[2] += (t[2] - b.pos[2]) / d * acc;
    moveBody(w, b, b.vel[0], b.vel[1], b.vel[2], 0, false);
    b.vel[0] *= 0.85; b.vel[1] *= 0.85; b.vel[2] *= 0.85;
    if (b.collidedH) this.flyTarget = null;
    this.yaw = Math.atan2(-b.vel[0], -b.vel[2]);
    this.walkAnim += 0.5;
    if (dist(m.player.body.pos, b.pos) > 64) this.dead = true;
  }

  render(alpha: number, m: EntityManager): void {
    super.render(alpha, m);
    const dt = Math.min(0.1, Math.max(0.001, (performance.now() - this.lastFrame) / 1000));
    this.lastFrame = performance.now();
    const size = (this.baby ? 0.55 : 1) * (this.spec.trader ? 1 + (this.sizeJitter - 1) * 0.5 : this.sizeJitter);
    this.object.scale.setScalar(size);
    const parts = this.model.parts;
    if (this.baby && parts.head) parts.head.scale.setScalar(1.35);
    const p = m.player.body.pos, b = this.body.pos;
    animateMob(this, parts, dt, [p[0] - b[0], p[1] + m.player.eyeHeight - (b[1] + this.body.height * 0.85), p[2] - b[2]]);
    this.object.rotation.y = this.anim.yaw;
    // Recoil when hurt; fall over when dying.
    parts.body.rotation.x = this.hurtTime > 0 ? -Math.sin((this.hurtTime / 10) * Math.PI) * 0.25 : 0;
    if (this.deathTime > 0 && !this.spec.boss) this.object.rotation.z = Math.min(Math.PI / 2, (this.deathTime / 10) * (Math.PI / 2));
    else this.object.rotation.z = 0;
    // Ground the shadow: find the floor below and fade it with height.
    const sh = this.model.shadow;
    const w = m.world, fx = Math.floor(b[0]), fz = Math.floor(b[2]);
    let drop = -1;
    for (let k = 0; k < 6; k++) { if (SOLID[w.getBlock(fx, Math.floor(b[1] - 0.01) - k, fz)]) { drop = (b[1] - (Math.floor(b[1] - 0.01) - k + 1)); break; } }
    sh.visible = drop >= 0 && this.deathTime === 0 && !this.spec.aquatic;
    if (sh.visible) {
      sh.position.y = -drop / size + 0.03;
      (sh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - drop / 5);
    }
    // A name tag, and a lead drawn as a sagging line.
    if (this.customName !== this.tagText) {
      this.tag?.removeFromParent();
      this.tag = undefined;
      this.tagText = this.customName;
      if (this.customName) { this.tag = nameTag(this.customName); this.object.add(this.tag); }
    }
    if (this.tag) this.tag.position.y = (this.body.height + 0.45) / Math.max(0.01, this.object.scale.y);
    const anchor = this.deathTime === 0 ? this.leashAnchor(m) : null;
    if (anchor) {
      if (!this.leashLine) {
        this.leashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 9 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0x8a6a4a }));
        this.leashLine.frustumCulled = false;
        m.renderer.scene.add(this.leashLine);
      }
      const pos = this.leashLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const o = this.object.position, sy = o.y + this.body.height * 0.75;
      const len = Math.hypot(anchor[0] - o.x, anchor[1] - sy, anchor[2] - o.z);
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, sag = Math.sin(t * Math.PI) * Math.max(0, 1.2 - len * 0.12);
        pos.setXYZ(i, o.x + (anchor[0] - o.x) * t, sy + (anchor[1] - sy) * t - sag, o.z + (anchor[2] - o.z) * t);
      }
      pos.needsUpdate = true;
      this.leashLine.visible = true;
    } else if (this.leashLine) this.leashLine.visible = false;
    if (this.dead) { this.leashLine?.removeFromParent(); }
    // A boss being mended: a beam of light from the anchor stone.
    if (this.spec.boss) {
      if (!this.beam) {
        this.beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe8a8ff }));
        this.beam.frustumCulled = false;
        m.renderer.scene.add(this.beam);
      }
      const a = this.healFrom;
      this.beam.visible = !!a && this.deathTime === 0;
      if (a) {
        const pos = this.beam.geometry.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, a[0] + 0.5, a[1] + 0.5, a[2] + 0.5);
        pos.setXYZ(1, this.object.position.x, this.object.position.y + 2.4, this.object.position.z);
        pos.needsUpdate = true;
      }
    }
    if (this.fuse > 0) {
      // Swell and flash white before bursting.
      const t = this.fuse / 30;
      this.object.scale.multiplyScalar(1 + t * 0.35 + Math.sin(this.age * 1.3) * 0.03 * t);
      if (Math.floor(this.age / 3) % 2 === 0) this.tint(new THREE.Color(1, 1, 1), 0.5 + t * 0.4);
    }
    if (this.burning > 0) this.tint(new THREE.Color(1.4, 0.8, 0.4), 0.5);
  }

  private tint(c: THREE.Color, amt: number): void {
    this.object.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat || o.userData.isShadow) return;
      for (const mm of Array.isArray(mat) ? mat : [mat]) (mm as THREE.MeshBasicMaterial).color.lerp(c, amt);
    });
  }
}

// ---------- Projectiles, XP orbs, fishing bobber ----------
export type ProjectileKind = 'arrow' | 'thorn' | 'snowball' | 'egg' | 'fireball' | 'potion' | 'shard';

export class Projectile extends Entity {
  stuck = 0;
  /** Splash potions thrown by the player carry an effect. */
  effect: { id: EffectId; ticks: number } | null = null;
  constructor(readonly kind: ProjectileKind, readonly owner: Mob | 'player', x: number, y: number, z: number, vel: [number, number, number], readonly baseDamage: number, renderer: Renderer, readonly pickup: boolean) {
    const body = new Body(x, y, z, 0.25, 0.25);
    body.vel = vel;
    super(body, Projectile.makeObject(kind, renderer));
  }
  static makeObject(kind: ProjectileKind, renderer: Renderer): THREE.Object3D {
    const g = new THREE.Group();
    if (kind === 'shard') {
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0xc88aff }));
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), new THREE.MeshBasicMaterial({ color: 0xf4e8ff }));
      g.add(core, glow);
    } else if (kind === 'potion') {
      const bottle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), new THREE.MeshBasicMaterial({ color: 0x9a4ad8 }));
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0x8a6a3a }));
      neck.position.y = 0.16;
      g.add(bottle, neck);
    } else if (kind === 'arrow' || kind === 'thorn') {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: kind === 'arrow' ? 0x8a6a3a : 0x3f6a2a }));
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: kind === 'arrow' ? 0xbcbcbc : 0xa02a2a }));
      tip.position.z = -0.32;
      g.add(shaft, tip);
    } else {
      const t = new THREE.CanvasTexture(renderer.atlas.canvases[tileIndex(kind === 'fireball' ? 'fire_charge' : kind)]);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, alphaTest: 0.5 }));
      s.scale.setScalar(kind === 'fireball' ? 0.7 : 0.3);
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
        for (const p of m.allPlayers()) {
          if (!p.alive) continue;
          const a = p.body.aabb();
          const lo = [a.min[0] - 0.1, a.min[1], a.min[2] - 0.1], hi = [a.max[0] + 0.1, a.max[1], a.max[2] + 0.1];
          for (let s = 0; s <= 4; s++) {
            const q = [b.pos[0] + dir[0] * speed * s / 4, b.pos[1] + dir[1] * speed * s / 4, b.pos[2] + dir[2] * speed * s / 4];
            if (q[0] > lo[0] && q[0] < hi[0] && q[1] > lo[1] && q[1] < hi[1] && q[2] > lo[2] && q[2] < hi[2]) {
              if (this.kind === 'potion') return true; // splash damage is dealt on impact
              p.damage(Math.ceil(speed * this.baseDamage), (this.owner as Mob).spec.kind, [dir[0], dir[2]]);
              return true;
            }
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
      // Arrows shatter anchor stones.
      if (hit.id === B.anchor_stone && this.owner === 'player') { this.dead = true; m.breakAnchor(hit.pos[0], hit.pos[1], hit.pos[2]); return; }
      if (this.kind === 'fireball') {
        b.pos = [hit.point[0] - dir[0] * 0.3, hit.point[1] - dir[1] * 0.3, hit.point[2] - dir[2] * 0.3];
        this.dead = true;
        this.impact(m);
      } else if (this.kind === 'arrow' || this.kind === 'thorn') {
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
    const drag = inWater ? 0.6 : this.kind === 'shard' ? 1 : 0.99;
    b.vel[0] *= drag; b.vel[1] *= drag; b.vel[2] *= drag;
    if (this.kind === 'fireball') { if (this.age % 2 === 0) m.flame(b.pos[0], b.pos[1], b.pos[2]); }
    else if (this.kind === 'shard') { if (this.age % 2 === 0) m.particles.add(new THREE.Vector3(...b.pos), new THREE.Vector3(0, 0, 0), new THREE.Color(0.8, 0.55, 1), 14, 0.12, 0); }
    else b.vel[1] -= this.kind === 'arrow' || this.kind === 'thorn' ? 0.05 : 0.03;
    if (this.age > 400 || b.pos[1] < -20) this.dead = true;
  }
  private impact(m: EntityManager): void {
    const b = this.body;
    if (this.kind === 'fireball') { m.explode(b.pos[0], b.pos[1], b.pos[2], 1.2, true); return; }
    if (this.kind === 'potion' && this.effect) {
      // A thrown splash potion: everything within 4 blocks gets the effect, stronger nearer the middle.
      sfx.breakBlock('glass', m.spatialFor(b.pos));
      const col = new THREE.Color(EFFECTS[this.effect.id].color);
      for (let i = 0; i < 32; i++) m.particles.add(new THREE.Vector3(...b.pos), new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.18, (Math.random() - 0.5) * 0.3), col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15), 22, 0.08, 0.01);
      const { id, ticks } = this.effect;
      const p = m.player;
      const dp = Math.hypot(p.body.pos[0] - b.pos[0], p.body.pos[1] + 0.9 - b.pos[1], p.body.pos[2] - b.pos[2]);
      if (p.alive && dp < 4) p.addEffect(id, Math.round(ticks * (1 - dp / 5)));
      for (const mob of m.mobs()) {
        const d = Math.hypot(mob.body.pos[0] - b.pos[0], mob.body.pos[1] - b.pos[1], mob.body.pos[2] - b.pos[2]);
        if (d >= 4) continue;
        if (id === 'healing') mob.health = Math.min(mob.spec.health, mob.health + 4);
        else if (id === 'poison') mob.hurt(m, 2, b.pos, 0.1, true);
        else if (id === 'slowness') { mob.body.vel[0] *= 0.2; mob.body.vel[2] *= 0.2; }
      }
      return;
    }
    if (this.kind === 'potion') {
      sfx.breakBlock('glass', m.spatialFor(b.pos));
      for (let i = 0; i < 24; i++) m.particles.add(new THREE.Vector3(...b.pos), new THREE.Vector3((Math.random() - 0.5) * 0.25, Math.random() * 0.15, (Math.random() - 0.5) * 0.25), new THREE.Color(0.6 + Math.random() * 0.2, 0.3, 0.85), 18, 0.08, 0.01);
      const p = m.player;
      const d = Math.hypot(p.body.pos[0] - b.pos[0], p.body.pos[1] + 0.9 - b.pos[1], p.body.pos[2] - b.pos[2]);
      if (p.alive && d < 2.6) p.damage(Math.ceil(5 * (1 - d / 2.6)) + 1, 'witch');
      return;
    }
    if (this.kind === 'shard') {
      sfx.breakBlock('glass', m.spatialFor(b.pos));
      for (let i = 0; i < 14; i++) m.particles.add(new THREE.Vector3(...b.pos), new THREE.Vector3((Math.random() - 0.5) * 0.25, Math.random() * 0.2, (Math.random() - 0.5) * 0.25), new THREE.Color(0.75, 0.5, 1), 18, 0.1, 0.01);
    }
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
    const b = this.body, p = m.nearestPlayer(this.body.pos);
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
    const mat = (this.object as THREE.Mesh).material;
    if (mat instanceof THREE.MeshBasicMaterial) mat.color.setRGB(0.6 + Math.sin(t) * 0.3, 1, 0.3);
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


/** A thrown Starseeker: it climbs, streaks toward the nearest sanctum for a few seconds, then falls (or shatters). */
export class SeekerOrb extends Entity {
  private startY: number;
  constructor(x: number, y: number, z: number, readonly target: [number, number]) {
    const body = new Body(x, y, z, 0.25, 0.25);
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ color: 0x9af0ff }));
    core.rotation.set(0.6, 0.6, 0);
    g.add(core);
    super(body, g);
    this.startY = y;
  }
  tick(m: EntityManager): void {
    this.prev = [...this.body.pos];
    this.age++;
    const b = this.body;
    const dx = this.target[0] - b.pos[0], dz = this.target[1] - b.pos[2];
    const d = Math.hypot(dx, dz);
    // Close by, it dives toward the spot; otherwise it holds a height above where it was thrown.
    const aimY = d < 12 ? this.startY - 2 : this.startY + 5;
    const sp = Math.min(0.32, d * 0.05);
    b.vel = [d > 0.1 ? (dx / d) * sp : 0, (aimY - b.pos[1]) * 0.08, d > 0.1 ? (dz / d) * sp : 0];
    b.pos[0] += b.vel[0]; b.pos[1] += b.vel[1]; b.pos[2] += b.vel[2];
    if (this.age % 2 === 0) m.particles.add(new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]), new THREE.Vector3((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.02), new THREE.Color(0.6, 0.95, 1), 18, 0.08, 0.001);
    this.object.rotation.y += 0.2;
    if (this.age > 80) {
      this.dead = true;
      if (Math.random() < 0.8) m.dropItem(b.pos[0], b.pos[1], b.pos[2], { id: I.starseeker, count: 1 }, 10, [0, 0, 0]);
      else { m.puff(b.pos[0], b.pos[1], b.pos[2]); sfx.breakBlock('glass', m.spatialFor(b.pos)); }
    }
  }
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
/** Distance along a ray to an axis-aligned box, or null if it misses within maxDist. */
export function rayBox(origin: number[], dir: number[], maxDist: number, a: { min: number[]; max: number[] }): number | null {
  let tmin = 0, tmax = maxDist;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-9) { if (origin[k] < a.min[k] || origin[k] > a.max[k]) return null; continue; }
    let t1 = (a.min[k] - origin[k]) / dir[k], t2 = (a.max[k] - origin[k]) / dir[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export class EntityManager {
  list: Entity[] = [];
  particles: Particles;
  private tileColors = new Map<number, THREE.Color[]>();
  onExplosion: (x: number, y: number, z: number) => void = () => {};
  onMobKilled: (mob: Mob, byPlayer: boolean) => void = () => {};
  onBossDefeated: (mob: Mob) => void = () => {};
  /** Peaceful difficulty: no monsters spawn. */
  peaceful = false;

  // ---------- Shared worlds ----------
  /** Other players in a shared world (on the host), as creatures and items see them. */
  others: PlayerLike[] = [];
  /** On a guest: creatures and items are the host's, shown as copies that follow its updates. */
  puppets = false;
  /** A guest hit one of the host's creatures. */
  onPuppetHit: (mob: Mob, amount: number, from: [number, number, number] | null, knock: number) => void = () => {};

  allPlayers(): PlayerLike[] { return this.others.length ? [this.player, ...this.others] : [this.player]; }

  /** The closest living player to a point (you, if nobody is alive). */
  nearestPlayer(pos: number[]): PlayerLike {
    if (!this.others.length) return this.player;
    let best: PlayerLike = this.player, bd = this.player.alive ? dist(this.player.body.pos, pos) : Infinity;
    for (const o of this.others) {
      if (!o.alive) continue;
      const d = dist(o.body.pos, pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** Follow the host's position for a copied entity. */
  private puppetTick(e: Entity): void {
    e.prev = [...e.body.pos];
    e.age++;
    const t = e.netTarget, b = e.body;
    if (t) {
      const dx = t[0] - b.pos[0], dy = t[1] - b.pos[1], dz = t[2] - b.pos[2];
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 8) b.pos = [...t];
      else { b.pos[0] += dx * 0.45; b.pos[1] += dy * 0.45; b.pos[2] += dz * 0.45; }
      b.vel = [b.pos[0] - e.prev[0], b.pos[1] - e.prev[1], b.pos[2] - e.prev[2]];
    }
    if (e instanceof Mob) {
      e.walkAnim += Math.hypot(b.vel[0], b.vel[2]) * 3.5;
      if (e.hurtTime > 0) e.hurtTime--;
      if (e.deathTime > 0) e.deathTime++;
      if (e.attackCooldown > 0) e.attackCooldown--;
    }
  }
  private anchorCache: { tick: number; list: [number, number, number][] } = { tick: -1, list: [] };

  /** Anchor stones still standing in the Hollow (checked at most once a second). */
  anchorsStanding(): [number, number, number][] {
    const w = this.world;
    if (w.dimension !== 'hollow') return [];
    if (w.tickCount - this.anchorCache.tick < 20) return this.anchorCache.list;
    const spots: [number, number, number][] = anchorPillars(w.seed).map(([x, z, h]) => [x, HOLLOW_TOP + h + 1, z]);
    spots.push([0, HOLLOW_TOP + 5, 0]);
    this.anchorCache = { tick: w.tickCount, list: spots.filter(([x, y, z]) => w.getBlock(x, y, z) === B.anchor_stone) };
    return this.anchorCache.list;
  }

  /** An anchor stone shatters in a burst of light that hurts anything close. */
  breakAnchor(x: number, y: number, z: number): void {
    if (this.world.getBlock(x, y, z) !== B.anchor_stone) return;
    this.world.setBlock(x, y, z, 0);
    this.anchorCache.tick = -1;
    this.explode(x + 0.5, y + 0.5, z + 0.5, 3);
  }
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

  /** On a guest: items belong to the host, so drops are sent there instead of made here. */
  remoteDrop: ((x: number, y: number, z: number, stack: ItemStack, delay: number, vel?: [number, number, number]) => void) | null = null;

  dropItem(x: number, y: number, z: number, stack: ItemStack, delay = 10, vel?: [number, number, number]): ItemEntity {
    if (this.remoteDrop) { this.remoteDrop(x, y, z, { ...stack }, delay, vel); return new ItemEntity({ ...stack }, x, y, z, this.renderer, delay); }
    const e = this.add(new ItemEntity({ ...stack }, x, y, z, this.renderer, delay));
    if (vel) e.body.vel = [...vel];
    return e;
  }

  spawnMob(kind: string, x: number, y: number, z: number, profession?: string): Mob {
    return this.add(new Mob(MOBS[kind], x, y, z, profession));
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
    if (this.peaceful) return;
    const p = this.player.body.pos;
    for (const key of this.world.spawners) {
      const [x, y, z] = key.split(',').map(Number);
      if (Math.hypot(x + 0.5 - p[0], y - p[1], z + 0.5 - p[2]) > 16) continue;
      if (Math.random() < 0.3) this.flame(x + 0.5, y + 0.3 + Math.random() * 0.5, z + 0.5);
      let t = this.spawnerTimers.get(key) ?? 20 + Math.floor(Math.random() * 200);
      if (--t > 0) { this.spawnerTimers.set(key, t); continue; }
      this.spawnerTimers.set(key, 200 + Math.floor(Math.random() * 600));
      const kinds = this.world.dimension === 'ember' ? ['emberwisp', 'cinderbrute'] : ['zombie', 'skeleton', 'shellcrawler', 'mirewalker', 'brambler'];
      const sm = this.world.getMeta(x, y, z);
      const kind = sm && SPAWNER_KINDS[sm] ? SPAWNER_KINDS[sm] : kinds[Math.abs(x * 31 + z * 17 + y) % kinds.length];
      const nearby = this.mobs().filter((m) => m.spec.kind === kind && Math.hypot(m.body.pos[0] - x, m.body.pos[1] - y, m.body.pos[2] - z) < 9).length;
      if (nearby >= 6) continue;
      const n = 1 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const sx = x + Math.floor(Math.random() * 9) - 4, sy = y + Math.floor(Math.random() * 3) - 1, sz = z + Math.floor(Math.random() * 9) - 4;
        if (this.world.getBlock(sx, sy, sz) !== 0 || this.world.getBlock(sx, sy + 1, sz) !== 0 || !SOLID[this.world.getBlock(sx, sy - 1, sz)]) continue;
        if (this.world.getBlockLight(sx, sy, sz) > 7) continue;
        this.spawnMob(kind, sx + 0.5, sy + (kind === 'emberwisp' ? 2 : 0), sz + 0.5);
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
    for (const e of this.list) if (!e.dead) { if (e.netId) this.puppetTick(e); else e.tick(this); }
    if (this.puppets) {
      for (const e of this.list) if (e.dead) e.object.removeFromParent();
      this.list = this.list.filter((e) => !e.dead);
      this.particles.tick(this.world);
      return;
    }
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
    this.tickPlates();
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

  private biomeAt(x: number, z: number): number {
    const c = this.world.getChunk(x >> 4, z >> 4);
    return c ? c.biomes[(x & 15) + (z & 15) * 16] : 1;
  }

  private spawnTick(): void {
    // Nothing spawns on its own in the Hollow: only its Colossus lives there.
    if (this.world.tickCount % 20 !== 0 || this.world.dimension === 'hollow') return;
    // Peaceful: monsters that wander in fade away.
    if (this.peaceful) for (const m of this.mobs()) if (m.spec.hostile && !m.spec.boss) { m.dead = true; this.puff(m.body.pos[0], m.body.pos[1] + 0.8, m.body.pos[2]); }
    const w = this.world;
    const p = this.player.body.pos;
    const mobs = this.mobs();
    const count = (f: (m: Mob) => boolean) => mobs.filter(f).length;
    const hostile = count((m) => m.spec.hostile);
    const tryPos = (minD: number, maxD: number): [number, number, number] | null => {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = Math.floor(p[0] + Math.cos(a) * d), z = Math.floor(p[2] + Math.sin(a) * d);
      if (!w.isLoaded(x, z)) return null;
      return [x, 0, z];
    };
    const open = (x: number, y: number, z: number, h = 2) => { for (let k = 0; k < h; k++) if (w.getBlock(x, y + k, z) !== 0) return false; return true; };

    if (w.dimension === 'ember') {
      if (hostile >= 12 || this.peaceful) return;
      for (let tries = 0; tries < 4; tries++) {
        const pos = tryPos(18, 44);
        if (!pos) continue;
        const y0 = Math.max(34, Math.floor(p[1]) - 16 + Math.floor(Math.random() * 32));
        for (let y = y0; y > y0 - 16 && y > 32; y--) {
          const ground = w.getBlock(pos[0], y - 1, pos[2]);
          if (!SOLID[ground] || !open(pos[0], y, pos[2], 3) || w.getBlockLight(pos[0], y, pos[2]) > 11) continue;
          if (Math.random() < 0.35) this.spawnMob('emberwisp', pos[0] + 0.5, y + 3, pos[2] + 0.5);
          else this.spawnMob('cinderbrute', pos[0] + 0.5, y, pos[2] + 0.5);
          break;
        }
      }
      return;
    }

    // Passive animals on grass in lit areas, picked by biome.
    if (count((m) => !m.spec.hostile && !m.spec.trader && !m.spec.guardian && !m.spec.habitat) < 10 && Math.random() < 0.3) {
      const pos = tryPos(20, 48);
      if (pos) {
        const y = w.surfaceY(pos[0], pos[2]);
        const biome = this.biomeAt(pos[0], pos[2]);
        if (w.getBlock(pos[0], y - 1, pos[2]) === B.grass && w.getSky(pos[0], y, pos[2]) >= 9) {
          const kinds = biome === 8 ? ['bogfrog', 'bogfrog', 'hen'] : biome === 2 || biome === 4 || biome === 7 ? ['burrowfox', 'boar', 'woolback', 'mossback'] : ['boar', 'hen', 'woolback', 'boar', 'mossback'];
          const kind = kinds[Math.floor(Math.random() * kinds.length)];
          const n = kind === 'burrowfox' ? 1 + Math.floor(Math.random() * 2) : kind === 'mossback' ? 2 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) {
            const sx = pos[0] + Math.floor(Math.random() * 5) - 2, sz = pos[2] + Math.floor(Math.random() * 5) - 2;
            const sy = w.surfaceY(sx, sz);
            if (w.getBlock(sx, sy - 1, sz) === B.grass) this.spawnMob(kind, sx + 0.5, sy, sz + 0.5);
          }
        }
      }
    }
    // Fish in water, moths in caves.
    if (count((m) => m.spec.habitat === 'water') < 6 && Math.random() < 0.3) {
      const pos = tryPos(12, 36);
      if (pos) {
        const y = w.surfaceY(pos[0], pos[2]) - 2;
        if (w.getBlock(pos[0], y, pos[2]) === B.water && w.getBlock(pos[0], y + 1, pos[2]) === B.water) {
          for (let i = 0; i < 3; i++) this.spawnMob('streamfish', pos[0] + 0.5 + Math.random(), y + 0.2, pos[2] + 0.5 + Math.random());
        }
      }
    }
    if (count((m) => m.spec.habitat === 'cave') < 4 && Math.random() < 0.2 && p[1] < 60) {
      const pos = tryPos(10, 28);
      if (pos) {
        const y = Math.floor(p[1]) + Math.floor(Math.random() * 16) - 8;
        if (y > 4 && open(pos[0], y, pos[2], 2) && w.getSky(pos[0], y, pos[2]) === 0 && w.getBlockLight(pos[0], y, pos[2]) < 4) this.spawnMob('cavemoth', pos[0] + 0.5, y, pos[2] + 0.5);
      }
    }
    // Hostiles in the dark (surface at night, caves any time).
    if (hostile < 14 && !this.peaceful) {
      for (let tries = 0; tries < 6; tries++) {
        const pos = tryPos(20, 44);
        if (!pos) continue;
        const y0 = Math.max(4, Math.floor(p[1]) - 20 + Math.floor(Math.random() * 40));
        for (let y = y0; y > y0 - 12 && y > 1; y--) {
          const ground = w.getBlock(pos[0], y - 1, pos[2]);
          if (!SOLID[ground] || BLOCKS[ground].shape !== 'cube' || ground === B.bedrock || ground === B.glass || isLeafy(ground)) continue;
          if (!open(pos[0], y, pos[2])) continue;
          const bl = w.getBlockLight(pos[0], y, pos[2]);
          const sky = w.getSky(pos[0], y, pos[2]) * (this.isDay() ? 1 : 0.25);
          if (bl > 0 || sky > 7) break;
          const biome = this.biomeAt(pos[0], pos[2]);
          const surface = w.getSky(pos[0], y, pos[2]) > 10;
          const table: [string, number][] = biome === 8
            ? [['witch', 3], ['mirewalker', 4], ['zombie', 2], ['blastcap', 1]]
            : [['zombie', 26], ['skeleton', 20], ['blastcap', 14], ['shellcrawler', 14], ['mirewalker', 8], ['brambler', 8], ['witch', 4]];
          let pick = Math.random() * table.reduce((n, t) => n + t[1], 0);
          let kind = table[0][0];
          for (const [k, wgt] of table) { if (pick < wgt) { kind = k; break; } pick -= wgt; }
          if (surface && biome === 3 && Math.random() < 0.5) kind = 'dunescuttler';
          if (surface && (biome === 4 || biome === 5) && Math.random() < 0.5) kind = 'frostling';
          if (kind === 'shellcrawler' && (w.getBlock(pos[0] + 1, y, pos[2]) !== 0 || w.getBlock(pos[0], y, pos[2] + 1) !== 0)) break;
          this.spawnMob(kind, pos[0] + 0.5, y, pos[2] + 0.5);
          break;
        }
      }
    }
  }

  private pressed = new Set<string>();
  /** Pressure plates react to anything standing on them. */
  private tickPlates(): void {
    const now = new Set<string>();
    const bodies = [...this.allPlayers().map((p) => (p.alive ? p.body : null)), ...this.list.filter((e) => !e.dead).map((e) => e.body)];
    for (const b of bodies) {
      if (!b) continue;
      const x = Math.floor(b.pos[0]), y = Math.floor(b.pos[1] + 0.01), z = Math.floor(b.pos[2]);
      if (this.world.getBlock(x, y, z) === B.pressure_plate) now.add(`${x},${y},${z}`);
    }
    for (const k of now) if (!this.pressed.has(k)) { const [x, y, z] = k.split(',').map(Number); this.world.setPlate(x, y, z, true); sfx.click(); }
    for (const k of this.pressed) if (!now.has(k)) { const [x, y, z] = k.split(',').map(Number); this.world.setPlate(x, y, z, false); }
    this.pressed = now;
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
    // The block itself is still solid here, so sample the brightest open neighbour.
    let l = 0.08;
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) l = Math.max(l, this.lightAt(x + 0.5 + dx, y + 0.5 + dy, z + 0.5 + dz));
    for (let i = 0; i < count; i++) {
      const col = cols[i % cols.length].clone().multiplyScalar(l);
      this.particles.add(
        new THREE.Vector3(x + Math.random(), y + Math.random(), z + Math.random()),
        new THREE.Vector3((Math.random() - 0.5) * 0.15, Math.random() * 0.2, (Math.random() - 0.5) * 0.15),
        col, 15 + Math.floor(Math.random() * 15), 0.05 + Math.random() * 0.04);
    }
  }

  digParticles(x: number, y: number, z: number, id: number, normal: number[]): void {
    const cols = this.colorsFor(id);
    const l = this.lightAt(x + 0.5 + normal[0], y + 0.5 + normal[1], z + 0.5 + normal[2]);
    const p = new THREE.Vector3(x + 0.5 + normal[0] * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(normal[0])), y + 0.5 + normal[1] * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(normal[1])), z + 0.5 + normal[2] * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(normal[2])));
    this.particles.add(p, new THREE.Vector3(normal[0] * 0.05 + (Math.random() - 0.5) * 0.05, 0.08, normal[2] * 0.05 + (Math.random() - 0.5) * 0.05), cols[Math.floor(Math.random() * cols.length)].clone().multiplyScalar(l), 12, 0.045);
  }

  puff(x: number, y: number, z: number): void {
    for (let i = 0; i < 14; i++) {
      this.particles.add(new THREE.Vector3(x + (Math.random() - 0.5), y + (Math.random() - 0.5), z + (Math.random() - 0.5)), new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.04, (Math.random() - 0.5) * 0.05), new THREE.Color(0.85, 0.85, 0.85), 20, 0.15, -0.002);
    }
  }

  flame(x: number, y: number, z: number): void {
    this.particles.add(new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6), new THREE.Vector3(0, 0.05, 0), new THREE.Color(1, 0.6 + Math.random() * 0.3, 0.1), 10, 0.1, -0.002);
  }

  explode(x: number, y: number, z: number, power: number, fire = false): void {
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
    if (fire) {
      for (let k = 0; k < 12; k++) {
        const fx = Math.floor(x + (Math.random() - 0.5) * power * 3), fy = Math.floor(y + (Math.random() - 0.5) * power * 2), fz = Math.floor(z + (Math.random() - 0.5) * power * 3);
        if (w.getBlock(fx, fy, fz) === 0 && SOLID[w.getBlock(fx, fy - 1, fz)]) w.setBlock(fx, fy, fz, B.fire);
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
      if (e.dead) continue;
      if (e instanceof Mob) { const dmg = hitBody(e.body); if (dmg) e.hurt(this, dmg, null, 0.4, true); }
      else if (e instanceof ItemEntity && hitBody(e.body) > 20) e.dead = true;
    }
    for (const pl of this.allPlayers()) { const pd = hitBody(pl.body); if (pd) pl.damage(pd, 'explosion'); }
    this.onExplosion(x, y, z);
  }

  clear(): void {
    for (const e of this.list) e.object.removeFromParent();
    this.list = [];
  }

  serialize(): unknown[] {
    const mobs = this.list.filter((e) => e instanceof Mob && e.deathTime === 0 && !e.netId && ((e as Mob).customName || (!(e as Mob).spec.hostile && (!(e as Mob).spec.flying || (e as Mob).spec.kind === 'bee') && !(e as Mob).spec.aquatic))).map((e) => {
      const m = e as Mob;
      return {
        kind: m.spec.kind, pos: m.body.pos, health: m.health, growing: m.growing, sheared: m.sheared, profession: m.spec.trader ? m.profession : undefined, offers: m.spec.trader ? m.offers : undefined,
        tamed: m.tamed || undefined, sitting: m.sitting || undefined, saddled: m.saddled || undefined, home: m.home ?? undefined,
        name: m.customName || undefined, tied: Array.isArray(m.leash) ? m.leash : undefined,
      };
    });
    const vehicles = this.vehicles().map((v) => ({ vehicle: v.kind, pos: v.body.pos, yaw: v.yaw }));
    return [...mobs, ...vehicles];
  }

  /** Hand items lying in a block's space to `take` (a hopper); whatever it can't hold stays. */
  collectInto(x: number, y: number, z: number, take: (s: ItemStack) => ItemStack | null): void {
    for (const e of this.list) {
      if (!(e instanceof ItemEntity) || e.dead) continue;
      const p = e.body.pos;
      if (p[0] < x || p[0] > x + 1 || p[1] < y - 0.1 || p[1] > y + 1 || p[2] < z || p[2] > z + 1) continue;
      const left = take({ ...e.stack });
      if (!left) e.dead = true;
      else e.stack.count = left.count;
      return;
    }
  }

  vehicles(): Vehicle[] {
    return this.list.filter((e): e is Vehicle => e instanceof Vehicle && !e.dead);
  }

  /** Nearest vehicle the ray passes through. */
  raycastVehicle(origin: number[], dir: number[], maxDist: number): { vehicle: Vehicle; dist: number } | null {
    let best: { vehicle: Vehicle; dist: number } | null = null;
    for (const v of this.vehicles()) {
      const t = rayBox(origin, dir, maxDist, v.body.aabb());
      if (t !== null && (!best || t < best.dist)) best = { vehicle: v, dist: t };
    }
    return best;
  }

  load(data: unknown): void {
    if (!Array.isArray(data)) return;
    for (const d of data as { kind: string; vehicle?: string; yaw?: number; pos: [number, number, number]; health: number; growing?: number; sheared?: boolean; profession?: string; offers?: TradeOffer[]; tamed?: boolean; sitting?: boolean; saddled?: boolean; home?: [number, number, number]; name?: string; tied?: [number, number, number] }[]) {
      if (d.vehicle) { const v = makeVehicle(d.vehicle, d.pos[0], d.pos[1], d.pos[2], d.yaw ?? 0); if (v) this.add(v); continue; }
      if (!MOBS[d.kind]) continue;
      const m = this.spawnMob(d.kind, d.pos[0], d.pos[1], d.pos[2], d.profession);
      if (d.offers) m.offers = d.offers;
      m.health = d.health;
      if (d.growing) { m.makeBaby(); m.growing = d.growing; }
      m.sheared = !!d.sheared;
      m.tamed = !!d.tamed; m.sitting = !!d.sitting; m.saddled = !!d.saddled;
      if (d.home) m.home = d.home;
      if (d.name) m.customName = d.name;
      if (d.tied) m.leash = d.tied;
    }
  }
}

function isLeafy(id: number): boolean {
  return BLOCKS[id].layer === 'cutout' && BLOCKS[id].shape === 'cube';
}
