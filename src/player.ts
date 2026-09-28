import { sfx } from './audio';
import { EFFECTS, type ActiveEffect, type EffectId } from './effects';
import { Inventory } from './inventory';
import { enchLevel, itemDef, type ItemStack } from './items';
import { Body } from './physics';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const SNEAK_EYE_HEIGHT = 1.27;

export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
/** Damage that doesn't come from a creature or an explosion, so difficulty doesn't scale it. */
const ENVIRONMENT = new Set(['fall', 'fire', 'lava', 'drowning', 'starvation', 'void', 'command', 'glide', 'poison', 'cactus', 'suffocation', 'magma', 'berry']);
const DAMAGE_SCALE: Record<Difficulty, number> = { peaceful: 0.5, easy: 0.5, normal: 1, hard: 1.5 };

export class Player {
  body: Body;
  yaw = 0;
  pitch = 0;
  eyeHeight = EYE_HEIGHT;
  inv = new Inventory(36);
  /** Helmet, chestplate, leggings, boots. */
  armor = new Inventory(4);
  xpLevel = 0;
  xpProgress = 0;
  xpTotal = 0;
  achievements = new Set<string>();
  /** Running totals for the statistics screen (see STAT_NAMES). */
  stats: Record<string, number> = {};
  /** Set from the world: scales damage from creatures and changes hunger. */
  difficulty: Difficulty = 'normal';
  onAchievement: (id: string) => void = () => {};
  selected = 0;
  health = 20;
  food = 20;
  saturation = 5;
  exhaustion = 0;
  air = 300;
  foodTimer = 0;
  hurtTime = 0;
  invulnerable = 0;
  burning = 0;
  alive = true;
  flying = false;
  sneaking = false;
  sprinting = false;
  /** Riding the air on a glider. */
  gliding = false;
  creative = false;
  spawn: [number, number, number] = [0.5, 80, 0.5];
  lastDamageSource = '';
  /** New worlds: snap to the real surface once the spawn chunk has loaded. */
  needsSurface = false;
  /** Just came through a gate: find or build one on arrival. */
  portalArrival = false;
  /** Coming home to the spawn point from another dimension. */
  arriveAtSpawn = false;
  /** Ticks before a gate can be used again (must step out first). */
  portalCooldown = 0;
  portalTime = 0;
  regenTicks = 0;
  /** Movement multiplier set with /speed (walking and flying). */
  speed = 1;
  /** Active status effects (from potions and some foods). */
  effects = new Map<EffectId, ActiveEffect>();
  /** Raising a shield: hits from in front are blocked. */
  blocking = false;
  /** Called when the shield takes a hit (so the game can wear it down and play a sound). */
  onBlock: (amount: number) => void = () => {};
  onDeath: (source: string) => void = () => {};
  onHurt: () => void = () => {};

  constructor(x: number, y: number, z: number) {
    this.body = new Body(x, y, z, PLAYER_WIDTH, PLAYER_HEIGHT);
  }

  get held(): ItemStack | null {
    return this.inv.slots[this.selected];
  }

  eye(): [number, number, number] {
    return [this.body.pos[0], this.body.pos[1] + this.eyeHeight, this.body.pos[2]];
  }

  lookDir(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  /** Cardinal direction the player faces: 0 = -z, 1 = -x, 2 = +z, 3 = +x. */
  quadrant(): number {
    return ((Math.round(this.yaw / (Math.PI / 2)) % 4) + 4) % 4;
  }

  pickUp(stack: ItemStack): ItemStack | null {
    return this.inv.add(stack);
  }

  addExhaustion(n: number): void {
    if (!this.creative) this.exhaustion += n;
  }

  get armorPoints(): number {
    return this.armor.slots.reduce((n, s) => n + (s ? itemDef(s.id)?.armor?.points ?? 0 : 0), 0);
  }

  /** XP needed to go from `level` to the next one. */
  static xpForLevel(level: number): number {
    return level < 16 ? 2 * level + 7 : level < 31 ? 5 * level - 38 : 9 * level - 158;
  }

  addXp(n: number): void {
    this.xpTotal += n;
    let pts = this.xpProgress * Player.xpForLevel(this.xpLevel) + n;
    while (pts >= Player.xpForLevel(this.xpLevel)) {
      pts -= Player.xpForLevel(this.xpLevel);
      this.xpLevel++;
      if (this.xpLevel % 5 === 0) sfx.levelUp();
    }
    this.xpProgress = pts / Player.xpForLevel(this.xpLevel);
  }

  spendLevels(n: number): void {
    this.xpLevel = Math.max(0, this.xpLevel - n);
  }

  achieve(id: string): void {
    if (this.achievements.has(id)) return;
    this.achievements.add(id);
    this.onAchievement(id);
  }

  effectLevel(id: EffectId): number { return this.effects.get(id)?.level ?? 0; }

  /** Start (or extend) an effect; instant ones apply at once. */
  addEffect(id: EffectId, ticks: number, level = 1): void {
    if (id === 'healing') { this.health = Math.min(20, this.health + 4 * level); return; }
    const cur = this.effects.get(id);
    if (!cur || cur.level < level || cur.ticks < ticks) this.effects.set(id, { level: Math.max(level, cur?.level ?? 0), ticks: Math.max(ticks, cur?.ticks ?? 0) });
  }

  damage(amount: number, source: string, knock?: [number, number]): void {
    if (!this.alive || this.creative && source !== 'void') return;
    if (this.invulnerable > 0) return;
    if (this.effects.has('fire_resistance') && (source === 'fire' || source === 'lava')) return;
    // A raised shield stops hits from in front (the knock direction points away from the attacker).
    if (this.blocking && knock && (knock[0] || knock[1])) {
      const d = this.lookDir();
      if (-(knock[0] * d[0] + knock[1] * d[2]) > 0.2) {
        this.onBlock(amount);
        this.body.vel[0] += knock[0] * 0.15;
        this.body.vel[2] += knock[1] * 0.15;
        this.invulnerable = 5;
        return;
      }
    }
    // Difficulty: creatures and explosions hit softer on Easy and harder on Hard.
    if (!ENVIRONMENT.has(source)) amount *= DAMAGE_SCALE[this.difficulty];
    // Armor and Protection (not for starvation, drowning, the void or commands).
    if (!['starvation', 'drowning', 'void', 'command'].includes(source)) {
      const armor = Math.min(20, this.armorPoints);
      let prot = 0;
      for (const s of this.armor.slots) prot += enchLevel(s, 'protection');
      if (source === 'fall') prot += 2 * enchLevel(this.armor.slots[3], 'feather_falling');
      amount *= (1 - armor / 25) * (1 - Math.min(20, prot) * 0.04);
      if (armor > 0) {
        const wear = Math.max(1, Math.floor(amount / 4));
        this.armor.slots.forEach((s, i) => {
          if (!s) return;
          const def = itemDef(s.id)?.armor;
          // Gliders wear from flying, not from blows.
          if (!def || def.points === 0) return;
          if (Math.random() < 1 / (enchLevel(s, 'unbreaking') + 1)) s.damage = (s.damage ?? 0) + wear;
          if ((s.damage ?? 0) >= def.durability) this.armor.slots[i] = null;
        });
      }
    }
    this.health -= amount;
    this.stat('damageTaken', amount);
    this.hurtTime = 10;
    this.invulnerable = 10;
    this.lastDamageSource = source;
    this.addExhaustion(0.1);
    if (knock) {
      this.body.vel[0] += knock[0] * 0.4;
      this.body.vel[2] += knock[1] * 0.4;
      this.body.vel[1] = Math.max(this.body.vel[1], 0.36);
    }
    sfx.hurt();
    this.onHurt();
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.onDeath(source);
    }
  }

  /** Add to a running total. */
  stat(key: string, n = 1): void { this.stats[key] = (this.stats[key] ?? 0) + n; }

  eat(stack: ItemStack): boolean {
    const food = itemDef(stack.id)?.food;
    if (!food || (this.food >= 20 && !this.creative)) return false;
    this.stat('eaten');
    this.food = Math.min(20, this.food + food.hunger);
    this.saturation = Math.min(this.food, this.saturation + food.saturation);
    sfx.burp();
    return true;
  }

  /** Survival mechanics, once per tick. */
  tickStats(): void {
    if (this.alive) this.stat('ticks');
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerable > 0) this.invulnerable--;
    if (!this.alive || this.creative) {
      this.air = 300;
      return;
    }
    // Peaceful: never hungry, and wounds close on their own.
    if (this.difficulty === 'peaceful') {
      this.exhaustion = 0;
      if (++this.foodTimer >= 40) { this.foodTimer = 0; this.food = Math.min(20, this.food + 1); if (this.health < 20) this.health = Math.min(20, this.health + 1); }
      return;
    }
    // Hunger.
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    this.foodTimer++;
    if (this.food >= 20 && this.saturation > 0 && this.health < 20) {
      if (this.foodTimer >= 10) {
        const heal = Math.min(this.saturation, 6) / 6;
        this.health = Math.min(20, this.health + heal);
        this.addExhaustion(heal * 6);
        this.foodTimer = 0;
      }
    } else if (this.food >= 18 && this.health < 20) {
      if (this.foodTimer >= 80) {
        this.health = Math.min(20, this.health + 1);
        this.addExhaustion(6);
        this.foodTimer = 0;
      }
    } else if (this.food <= 0) {
      if (this.foodTimer >= 80) {
        // Starving: Easy leaves you on half health, Normal on half a heart, Hard lets it kill you.
        const floor = this.difficulty === 'easy' ? 10 : this.difficulty === 'hard' ? 0 : 1;
        if (this.health > floor) this.damage(1, 'starvation');
        this.foodTimer = 0;
      }
    } else this.foodTimer = 0;
    // Effects.
    for (const [id, e] of this.effects) {
      if (id === 'regeneration' && e.ticks % Math.max(10, 50 >> (e.level - 1)) === 0) this.health = Math.min(20, this.health + 1);
      if (id === 'poison' && e.ticks % Math.max(5, 25 >> (e.level - 1)) === 0 && this.health > 1) this.damage(1, 'poison');
      if (--e.ticks <= 0) this.effects.delete(id);
    }
    // Air.
    if (this.body.eyeInWater && !this.effects.has('water_breathing')) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.damage(2, 'drowning');
      }
    } else this.air = Math.min(300, this.air + 5);
    // Fire and lava.
    if (this.body.inLava) {
      this.damage(4, 'lava');
      this.burning = 160;
    }
    if (this.burning > 0) {
      this.burning--;
      if (this.body.inWater) this.burning = 0;
      if (this.burning % 20 === 0) this.damage(1, 'fire');
    }
    if (this.body.pos[1] < -64) this.damage(4, 'void');
  }

  serialize(): unknown {
    return {
      pos: this.body.pos, yaw: this.yaw, pitch: this.pitch, inv: this.inv.toJSON(), selected: this.selected,
      armor: this.armor.toJSON(), xpLevel: this.xpLevel, xpProgress: this.xpProgress, xpTotal: this.xpTotal, achievements: [...this.achievements], stats: this.stats,
      health: this.health, food: this.food, saturation: this.saturation, flying: this.flying, spawn: this.spawn,
      effects: [...this.effects].map(([id, e]) => [id, e.level, e.ticks]),
    };
  }

  load(d: any): void {
    if (!d) return;
    this.body.pos = [...d.pos] as [number, number, number];
    this.yaw = d.yaw ?? 0;
    this.pitch = d.pitch ?? 0;
    this.inv.load(d.inv);
    this.armor.load(d.armor);
    this.xpLevel = d.xpLevel ?? 0;
    this.xpProgress = d.xpProgress ?? 0;
    this.xpTotal = d.xpTotal ?? 0;
    this.achievements = new Set(d.achievements ?? []);
    this.stats = { ...d.stats };
    this.selected = d.selected ?? 0;
    this.health = d.health ?? 20;
    this.food = d.food ?? 20;
    this.saturation = d.saturation ?? 5;
    this.flying = !!d.flying;
    if (d.spawn) this.spawn = d.spawn;
    this.effects.clear();
    for (const [id, level, ticks] of (d.effects ?? []) as [EffectId, number, number][]) if (EFFECTS[id]) this.effects.set(id, { level, ticks });
  }
}
