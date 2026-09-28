// What the player does to the world: mining, attacking, placing, using items and
// blocks, fishing, archery, sleeping and dropping items.

import { sfx, spatial } from '../audio';
import { B, BLOCKS, DYE_COLORS, POTTED, SOLID, WOOL_KEY, isLeaves, isLog, isRail } from '../blocks';
import { SMELTING } from '../crafting';
import { Bobber, SeekerOrb, TntEntity } from '../entities/entities';
import { Boat, Minecart } from '../entities/vehicles';
import { I, coloredItem, enchLevel, itemDef, maxStack, type ItemStack } from '../items';
import { raycast, selectionBox, type RayHit } from '../physics';
import { nearestStructure } from '../world/structures';
import { askText } from '../ui/prompt';
import { WorldGen } from '../world/worldgen';
import type { Game } from '../game';

export class Actions {
  /** The block under the crosshair (null when nothing is in reach). */
  target: RayHit | null = null;
  breakProgress = 0;
  breakPos: string | null = null;
  private breakCooldown = 0;
  useCooldown = 0;
  eating = 0;
  bowCharge = 0;
  /** Ticks spent loading a crossbow (it loads after 25). */
  crossbowLoad = 0;
  bobber: Bobber | null = null;

  constructor(private g: Game) {}

  private get world() { return this.g.world; }
  private get player() { return this.g.player; }
  private get entities() { return this.g.entities; }
  private get renderer() { return this.g.renderer; }
  private get containers() { return this.g.containers; }

  /** Per-tick upkeep: mining progress, bow draw, and repeating placement or eating while right click is held. */
  tick(active: boolean): void {
    const p = this.player;
    this.tickBreaking();
    const holding = this.g.input.mouse[2] && (active || this.g.input.locked);
    p.blocking = holding && p.alive && p.held?.id === I.shield;
    this.g.spyglass = holding && p.alive && p.held?.id === I.spyglass;
    if (this.crossbowLoad > 0) {
      const cb = p.held;
      if (!holding || cb?.id !== I.crossbow) this.crossbowLoad = 0;
      else if (++this.crossbowLoad >= 25) {
        this.crossbowLoad = 0;
        const slot = p.inv.slots.findIndex((s) => s?.id === I.arrow);
        if (p.creative || slot >= 0) {
          if (!p.creative) p.inv.removeOne(slot);
          cb.charged = true;
          sfx.click();
        }
      }
    }
    if (this.bowCharge > 0) {
      if (p.held?.id !== I.bow || !this.g.input.mouse[2]) this.bowCharge = 0;
      else this.bowCharge++;
    }
    // Holding right click repeats placing / keeps eating.
    if (this.g.input.mouse[2] && (active || this.g.input.locked)) {
      if (this.eating > 0) {
        const held = p.held;
        const hdef = held ? itemDef(held.id) : undefined;
        const drink = hdef?.potion && !hdef.potion.splash ? hdef.potion : undefined;
        const food = hdef?.food;
        if (!held || (!food && !drink)) this.eating = 0;
        else if (drink) {
          this.eating++;
          if (this.eating % 4 === 0) sfx.eat();
          if (this.eating > 32) {
            p.addEffect(drink.effect, drink.ticks);
            if (!p.creative) p.inv.slots[p.selected] = { id: I.glass_bottle, count: 1 };
            this.eating = 0;
          }
        }
        else {
          this.eating++;
          if (this.eating % 4 === 0) sfx.eat();
          if (this.eating > 32) {
            const eff = itemDef(held.id)?.effect;
            const bowl = held.id === I.mushroom_stew || held.id === I.redroot_stew;
            const bottle = held.id === I.honey_bottle;
            if (p.eat(held) && !p.creative) {
              held.count--;
              if (held.count <= 0) p.inv.slots[p.selected] = bowl ? { id: I.bowl, count: 1 } : null;
              if (bottle) { const left = p.inv.add({ id: I.glass_bottle, count: 1 }); if (left) this.throwStack(left); }
            }
            if (eff === 'regen') p.regenTicks = 100;
            else if (eff === 'cure') p.effects.delete('poison');
            else if (eff) p.addEffect(eff, 600);
            this.eating = 0;
          }
        }
      } else if (++this.useCooldown >= 4) {
        this.useCooldown = 0;
        this.use(true);
      }
    }
  }

  /** What the crosshair is on, refreshed every frame. */
  updateTarget(): void {
    const w = this.world!;
    const p = this.player;
    if (!p.alive || this.containers.open) { this.target = null; this.renderer.setHighlight(null); return; }
    const hit = raycast(w, p.eye(), p.lookDir(), this.reach());
    this.target = hit;
    if (hit) {
      const box = selectionBox(hit.id, w.getMeta(...hit.pos));
      this.renderer.setHighlight(hit.pos, box ?? undefined);
    } else this.renderer.setHighlight(null);
  }

  reach(): number {
    return this.player.creative ? 5 : 4.5;
  }

  attack(): void {
    if (!this.world || !this.entities || !this.player.alive) return;
    this.renderer.swingHand();
    const p = this.player;
    const eye = p.eye(), dir = p.lookDir();
    const mobHit = this.entities.raycastMob(eye, dir, 3);
    const blockDist = this.target ? this.target.dist : Infinity;
    const vHit = this.entities.raycastVehicle(eye, dir, 3);
    if (vHit && vHit.dist < blockDist && (!mobHit || vHit.dist < mobHit.dist) && vHit.vehicle !== this.g.riding) { vHit.vehicle.hit(this.entities); return; }
    if (mobHit && mobHit.dist < blockDist && mobHit.mob !== this.g.riding) {
      const held = p.held;
      const tool = held ? itemDef(held.id)?.tool : undefined;
      let dmg = tool && held?.id !== I.bow && held?.id !== I.shears && held?.id !== I.fishing_rod ? tool.damage : 1;
      const sharp = enchLevel(held, 'sharpness');
      if (sharp) dmg += 0.5 * sharp + 0.5;
      dmg += 3 * p.effectLevel('strength');
      const crit = p.body.vel[1] < -0.1 && !p.body.onGround && !p.body.inWater;
      if (crit) dmg *= 1.5;
      mobHit.mob.hurt(this.entities, dmg, p.body.pos, p.sprinting ? 0.7 : 0.4, true);
      if (p.sprinting) p.sprinting = false;
      p.addExhaustion(0.1);
      if (tool) this.damageTool(tool.kind === 'sword' ? 1 : 2);
    }
  }

  private damageTool(n: number): void {
    const p = this.player;
    const held = p.held;
    if (!held || p.creative) return;
    const tool = itemDef(held.id)?.tool;
    if (!tool) return;
    const unb = enchLevel(held, 'unbreaking');
    if (unb && Math.random() > 1 / (unb + 1)) return;
    held.damage = (held.damage ?? 0) + n;
    if (held.damage >= tool.durability) {
      p.inv.slots[p.selected] = null;
      sfx.breakBlock('wood');
    }
  }

  private canHarvest(blockId: number): boolean {
    const d = BLOCKS[blockId];
    if (d.harvestTier < 0) return true;
    const tool = this.player.held ? itemDef(this.player.held.id)?.tool : undefined;
    return !!tool && tool.kind === d.tool && tool.tier >= d.harvestTier;
  }

  private breakSpeed(blockId: number): number {
    const d = BLOCKS[blockId];
    if (d.hardness < 0) return 0;
    if (d.hardness === 0) return Infinity;
    const tool = this.player.held ? itemDef(this.player.held.id)?.tool : undefined;
    let speed = tool && tool.kind === d.tool ? tool.speed : 1;
    if (tool?.kind === 'sword' && isLeaves(blockId)) speed = 1.5;
    if (this.player.held?.id === I.shears && (isLeaves(blockId) || blockId === B.wool)) speed = isLeaves(blockId) ? 15 : 5;
    const eff = enchLevel(this.player.held, 'efficiency');
    if (eff && speed > 1) speed += eff * eff + 1;
    if (this.player.body.eyeInWater) speed /= 5;
    if (!this.player.body.onGround && !this.player.flying) speed /= 5;
    return speed / d.hardness / (this.canHarvest(blockId) ? 30 : 100);
  }

  tickBreaking(): void {
    const w = this.world!, p = this.player;
    if (this.breakCooldown > 0) this.breakCooldown--;
    if (!this.g.input.mouse[0] || !this.target || !p.alive) { this.breakProgress = 0; this.breakPos = null; this.renderer.setCrack(null, 0); return; }
    const t = this.target;
    const key = t.pos.join(',');
    if (this.breakPos !== key) { this.breakPos = key; this.breakProgress = 0; }
    if (this.breakCooldown > 0) return;
    const id = w.getBlock(t.pos[0], t.pos[1], t.pos[2]);
    if (id === 0) return;
    if (p.creative) {
      const held = p.held ? itemDef(p.held.id)?.tool : undefined;
      if (held?.kind === 'sword') return;
      this.finishBreak(t.pos, id, false);
      this.breakCooldown = 6;
      return;
    }
    const rate = this.breakSpeed(id);
    if (rate === 0) return;
    this.breakProgress += rate;
    if (w.tickCount % 4 === 0) { sfx.dig(BLOCKS[id].sound); this.renderer.swingHand(); this.entities!.digParticles(t.pos[0], t.pos[1], t.pos[2], id, t.normal); }
    if (this.breakProgress >= 1) {
      this.finishBreak(t.pos, id, this.canHarvest(id));
      this.breakProgress = 0;
      this.breakCooldown = 5;
      p.addExhaustion(0.005);
      if (BLOCKS[id].hardness > 0) this.damageTool(itemDef(p.held?.id ?? 0)?.tool?.kind === 'sword' ? 2 : 1);
    }
    this.renderer.setCrack(t.pos, this.breakProgress);
  }

  private finishBreak(pos: [number, number, number], id: number, drop: boolean): void {
    const w = this.world!, p = this.player;
    p.stat('mined');
    const shears = p.held?.id === I.shears;
    if (drop && shears && (isLeaves(id) || id === B.tall_grass)) {
      // Shears collect the block itself.
      w.setBlock(pos[0], pos[1], pos[2], 0);
      this.entities!.dropItem(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, { id, count: 1 });
      this.entities!.blockBreakParticles(pos[0], pos[1], pos[2], id, 12);
      sfx.breakBlock(BLOCKS[id].sound);
      this.damageTool(1);
    } else {
      if (p.creative) { this.g.history.begin(); this.g.history.record(pos[0], pos[1], pos[2]); }
      w.breakBlock(pos[0], pos[1], pos[2], drop);
    }
    this.renderer.setCrack(null, 0);
    if (drop && !p.creative) {
      const xp = id === B.coal_ore ? Math.floor(Math.random() * 3) : id === B.diamond_ore ? 3 + Math.floor(Math.random() * 5) : 0;
      if (xp) this.entities!.dropXp(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, xp);
      if (isLog(id)) p.achieve('wood');
      if (id === B.diamond_ore) p.achieve('diamond');
    }
  }

  /**
   * Right click. `repeat` is true when called again because the button is still held (every 4
   * ticks, so you can keep placing blocks): drawing a bow, loading a crossbow and casting a rod
   * only start on a fresh press, or holding the button would keep restarting them.
   */
  use(repeat = false): void {
    const w = this.world, p = this.player;
    if (!w || !this.entities || !p.alive) return;
    const held = p.held;
    const def = held ? itemDef(held.id) : undefined;
    if (repeat && (def?.use === 'bow' || def?.use === 'crossbow' || def?.use === 'rod' || def?.use === 'shield' || def?.potion && !def.potion.splash)) return;
    const eye = p.eye(), dir = p.lookDir();
    const hit = raycast(w, eye, dir, this.reach(), held?.id === I.bucket);
    const sneaking = p.sneaking;
    const consume = () => { if (!p.creative && held) { held.count--; if (held.count <= 0) p.inv.slots[p.selected] = null; } };

    // Vehicles: climb into a boat or minecart.
    const vHit = this.entities.raycastVehicle(eye, dir, 3.5);
    const mobHit0 = this.entities.raycastMob(eye, dir, 3.5);
    if (vHit && (!hit || vHit.dist < hit.dist) && (!mobHit0 || vHit.dist < mobHit0.dist) && !this.g.riding) {
      if (!repeat) this.g.mount(vHit.vehicle);
      return;
    }
    // Placing a boat (on water or ground) or a minecart (on a rail).
    if ((held?.id === I.boat || held?.id === I.minecart) && !repeat) {
      const fh = raycast(w, eye, dir, this.reach(), held.id === I.boat);
      if (!fh) return;
      const [x, y, z] = fh.pos;
      if (held.id === I.minecart) {
        if (!isRail(fh.id)) return;
        this.entities.add(new Minecart(x + 0.5, y + 0.0625, z + 0.5, p.yaw));
      } else {
        const onWater = fh.id === B.water;
        if (!onWater && fh.normal[1] !== 1) return;
        this.entities.add(new Boat(x + 0.5, y + (onWater ? 0.8 : 1), z + 0.5, p.yaw));
      }
      consume();
      this.renderer.swingHand();
      return;
    }
    // Animals: feeding, breeding, shearing, taming and riding.
    const mobHit = mobHit0;
    if (mobHit && (!hit || mobHit.dist < hit.dist) && !repeat && !mobHit.mob.netId) {
      const mob = mobHit.mob;
      // A creature on a lead: let it go.
      if (mob.leash && held?.id !== I.name_tag) { mob.dropLead(this.entities); sfx.click(); this.renderer.swingHand(); return; }
      if (held?.id === I.lead && !mob.spec.hostile && !mob.spec.boss && !mob.ridden) {
        mob.leash = 'player';
        consume(); sfx.click(); this.renderer.swingHand();
        return;
      }
      if (held?.id === I.name_tag) {
        const tag = held;
        void askText(this.g, 'Name this creature', mob.customName, 20).then((name) => {
          if (!name || mob.dead) return;
          mob.customName = name;
          if (!p.creative) { tag.count--; if (tag.count <= 0) { const i = p.inv.slots.indexOf(tag); if (i >= 0) p.inv.slots[i] = null; } }
          p.achieve('named');
        });
        return;
      }
    }
    if (mobHit && (!hit || mobHit.dist < hit.dist)) {
      const res = mobHit.mob.interact(this.entities, held);
      if (res === 'fed' || res === 'tamed') { consume(); this.renderer.swingHand(); if (res === 'tamed') p.achieve('tame'); return; }
      if (res === 'saddled') { consume(); return; }
      if (res === 'ride') { if (!repeat && !this.g.riding) this.g.mount(mobHit.mob); return; }
      if (res === 'sit') { if (!repeat) this.renderer.swingHand(); return; }
      if (res === 'sheared') { this.damageTool(1); this.renderer.swingHand(); return; }
      if (res === 'trade') {
        const v = mobHit.mob;
        v.yaw = Math.atan2(-(p.body.pos[0] - v.body.pos[0]), -(p.body.pos[2] - v.body.pos[2]));
        document.exitPointerLock();
        this.containers.show('trade', { villager: v });
        sfx.mobSay(v.spec.pitch, { gain: 1, pan: 0 });
        return;
      }
    }
    if ((def?.use === 'ignite' || def?.use === 'firecharge') && hit && held) {
      const [x, y, z] = hit.pos;
      const tx = x + hit.normal[0], ty = y + hit.normal[1], tz = z + hit.normal[2];
      let did = false;
      if (hit.id === B.tnt) { w.setBlock(x, y, z, 0); this.entities.add(new TntEntity(x, y, z, this.renderer)); sfx.fuse(spatial(eye[0], eye[1], eye[2], p.yaw, x, y, z)); did = true; }
      else if (hit.id === B.obsidian && w.tryLightPortal(tx, ty, tz)) { sfx.fizz(); did = true; p.achieve('gate'); }
      else if (w.getBlock(tx, ty, tz) === 0 && SOLID[hit.id]) { w.setBlock(tx, ty, tz, B.fire); sfx.fizz({ gain: 0.4, pan: 0 }); did = true; }
      if (did) { if (def.use === 'ignite') this.damageTool(1); else consume(); this.renderer.swingHand(); }
      return;
    }
    if (def?.use === 'bow') { this.bowCharge = 1; return; }
    if (def?.use === 'rod') { this.castOrReel(); return; }
    if (def?.use === 'throw' && held) {
      if (def.potion) {
        // Splash potions arc a little higher and slower than snowballs.
        const proj = this.entities.shoot('potion', 'player', eye, [dir[0], dir[1] + 0.15, dir[2]], 1.0, 0.01, 0);
        proj.effect = { id: def.potion.effect, ticks: def.potion.ticks };
      } else this.entities.shoot(held.id === I.snowball ? 'snowball' : 'egg', 'player', eye, dir, 1.5, 0.02);
      consume();
      this.renderer.swingHand();
      return;
    }
    // Shields are raised by holding right click (see tick); they never place anything.
    if (def?.use === 'shield') return;
    if (def?.use === 'crossbow' && held) {
      if (held.charged) {
        const dmg = 3 + (enchLevel(held, 'power') ? enchLevel(held, 'power') * 0.5 + 0.5 : 0);
        this.entities.shoot('arrow', 'player', eye, dir, 3.2, 0.002, dmg, !p.creative);
        held.charged = false;
        this.damageTool(1);
        sfx.click();
        this.renderer.swingHand();
      } else if (p.creative || p.inv.slots.some((s) => s?.id === I.arrow)) this.crossbowLoad = 1;
      return;
    }
    // Filling a glass bottle from water (a full bee nest is handled below with the other blocks).
    const nestHit = !!hit && (hit.id === B.bee_nest || hit.id === B.beehive) && w.getMeta(hit.pos[0], hit.pos[1], hit.pos[2]) >= 5;
    if (held?.id === I.glass_bottle && !nestHit) {
      const wh = raycast(w, eye, dir, this.reach(), true);
      if (wh && wh.id === B.water) {
        sfx.splash();
        if (held.count === 1) p.inv.slots[p.selected] = { id: I.water_bottle, count: 1 };
        else { held.count--; const left = p.inv.add({ id: I.water_bottle, count: 1 }); if (left) this.throwStack(left); }
        this.renderer.swingHand();
      }
      return;
    }
    // Drinking a potion works like eating.
    if (def?.potion && !def.potion.splash) { this.eating = 1; return; }
    // An empty map: start drawing the area you're in.
    if (held?.id === I.empty_map && !repeat) {
      if (w.dimension !== 'overworld') { this.g.toast('Maps only work in the overworld.', 3); return; }
      const id = this.g.maps.create(p.body.pos[0], p.body.pos[2]);
      // The new map goes in your hand; any other blank ones move to your pack.
      const rest = p.creative ? held.count : held.count - 1;
      p.inv.slots[p.selected] = { id: I.filled_map, count: 1, map: id };
      if (rest > 0) { const left = p.inv.add({ id: I.empty_map, count: rest }); if (left) this.throwStack(left); }
      sfx.place('wool'); this.renderer.swingHand();
      p.achieve('map');
      return;
    }
    // Starseekers: set into an Astral Frame, or thrown to show the way to the nearest sanctum.
    if (held?.id === I.starseeker && !repeat) {
      if (hit && hit.id === B.astral_frame) {
        const [x, y, z] = hit.pos;
        const m = w.getMeta(x, y, z);
        if (m & 4) return;
        w.setMeta(x, y, z, m | 4);
        consume();
        this.renderer.swingHand();
        sfx.brewed();
        if (w.tryOpenAstralGate(x, y, z)) { sfx.warHorn(); p.achieve('astral'); this.g.chat.say('The Astral Gate opens.'); }
        return;
      }
      if (w.dimension !== 'overworld') { this.g.chat.say('The Starseeker spins without finding anything.'); return; }
      const s = nearestStructure(new WorldGen(w.seed), 'sanctum', p.body.pos[0], p.body.pos[2]);
      if (!s) return;
      this.entities.add(new SeekerOrb(eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2], [s.x + 0.5, s.z + 0.5]));
      consume();
      this.renderer.swingHand();
      return;
    }

    if (hit && !sneaking) {
      const [x, y, z] = hit.pos;
      const id = hit.id;
      if (id === B.fence_gate) {
        const m = w.getMeta(x, y, z);
        // Open away from the player.
        w.setMeta(x, y, z, m ^ 4);
        sfx.door((m & 4) === 0);
        this.renderer.swingHand();
        return;
      }
      if (id === B.enchanting_table) {
        let shelves = 0;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 1; dy++) {
          if ((Math.abs(dx) === 2 || Math.abs(dz) === 2) && w.getBlock(x + dx, y + dy, z + dz) === B.bookshelf) shelves++;
        }
        document.exitPointerLock();
        this.containers.show('enchant', { bookshelves: shelves });
        return;
      }
      if (id === B.crafting_table) { this.openScreen('crafting'); return; }
      if ((id === B.bee_nest || id === B.beehive) && w.getMeta(x, y, z) >= 5 && (held?.id === I.glass_bottle || held?.id === I.shears)) {
        // Harvest honey: a torch or fire under the nest keeps the bees calm; otherwise they swarm you.
        if (held.id === I.glass_bottle) {
          if (held.count === 1) p.inv.slots[p.selected] = { id: I.honey_bottle, count: 1 };
          else { held.count--; const left = p.inv.add({ id: I.honey_bottle, count: 1 }); if (left) this.throwStack(left); }
        } else {
          this.entities.dropItem(x + 0.5, y + 0.5, z + 0.5, { id: I.honeycomb, count: 3 });
          this.damageTool(1);
        }
        w.setMeta(x, y, z, 0);
        sfx.place('wood');
        this.renderer.swingHand();
        let smoked = false;
        for (let dy = 1; dy <= 5 && !smoked; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const b = w.getBlock(x + dx, y - dy, z + dz); if (b === B.torch || b === B.fire || b === B.lantern || b === B.campfire) smoked = true; }
        if (!smoked) for (const b of this.entities.mobs()) if (b.spec.kind === 'bee' && Math.hypot(b.body.pos[0] - x, b.body.pos[2] - z) < 16) b.beeAnger = 400;
        return;
      }
      if (id === B.repeater) {
        const m = w.getMeta(x, y, z);
        w.setMeta(x, y, z, (m & ~12) | ((((m >> 2) & 3) + 1) % 4 << 2));
        sfx.click();
        return;
      }
      // In someone else's world, containers stay with the host for now.
      if (this.g.net && 'guest' in this.g.net && (id === B.hopper || id === B.brewing_stand || id === B.furnace || id === B.furnace_lit || id === B.chest || id === B.barrel || id === B.smoker || id === B.smoker_lit || id === B.campfire || id === B.item_frame)) { this.g.toast('Only the host can use this in a shared world.', 3); return; }
      if (this.useWorkshopBlock(x, y, z, id, held, consume)) return;
      if (id === B.hopper) { const be = w.getBlockEntity(x, y, z); if (be?.kind === 'hopper') { document.exitPointerLock(); this.containers.show('hopper', { hopper: be }); } return; }
      if (id === B.brewing_stand) { const be = w.getBlockEntity(x, y, z); if (be?.kind === 'brewing') { document.exitPointerLock(); this.containers.show('brewing', { brewing: be }); } return; }
      if (id === B.furnace || id === B.furnace_lit) { const be = w.getBlockEntity(x, y, z); if (be?.kind === 'furnace') { document.exitPointerLock(); this.containers.show('furnace', { furnace: be }); } return; }
      // Tie creatures you're leading to a fence post.
      if (id === B.fence && !repeat) {
        const led = this.entities.mobs().filter((m) => m.leash === 'player' && Math.hypot(m.body.pos[0] - p.body.pos[0], m.body.pos[2] - p.body.pos[2]) < 12);
        if (led.length) { for (const m of led) m.leash = [x, y, z]; sfx.click(); this.renderer.swingHand(); return; }
      }
      if (id === B.chest && (w.getMeta(x, y, z) & 16) && ((w.getMeta(x, y, z) >> 5) & 7) === 6) p.achieve('treasure');
      if (id === B.chest) { const be = w.getBlockEntity(x, y, z); if (be?.kind === 'chest') { document.exitPointerLock(); this.containers.show('chest', { chest: be.inv }); } return; }
      if (id === B.door) {
        const m = w.getMeta(x, y, z);
        const by = m & 8 ? y - 1 : y;
        for (const yy of [by, by + 1]) if (w.getBlock(x, yy, z) === B.door) w.setMeta(x, yy, z, w.getMeta(x, yy, z) ^ 4);
        sfx.door(((m >> 2) & 1) === 0);
        this.renderer.swingHand();
        return;
      }
      if (id === B.bed) { this.sleep(x, y, z); return; }
      if (id === B.lever) { w.toggleLever(x, y, z); sfx.click(); return; }
      if (id === B.button) { w.pressButton(x, y, z); sfx.click(); return; }
      if (id === B.bell) { sfx.levelUp(); this.renderer.swingHand(); return; }
      if (id === B.trapdoor) {
        const m = w.getMeta(x, y, z);
        w.setMeta(x, y, z, m ^ 4);
        sfx.door((m & 4) === 0);
        this.renderer.swingHand();
        return;
      }
      if (id === B.cake) {
        if (p.food >= 20 && !p.creative) return;
        const m = w.getMeta(x, y, z);
        p.food = Math.min(20, p.food + 2);
        p.saturation = Math.min(p.food, p.saturation + 0.4);
        sfx.eat();
        if (m >= 6) w.setBlock(x, y, z, 0); else w.setMeta(x, y, z, m + 1);
        return;
      }
      if (id === B.sign) { this.g.signs.edit(x, y, z); return; }
    }

    if (!held || !def) return;
    // Food.
    if (def.food && (p.food < 20 || p.creative)) {
      this.eating = 1;
      return;
    }
    // Buckets.
    if (held.id === I.bucket) {
      if (hit && BLOCKS[hit.id].fluid && (w.getMeta(...hit.pos) & 15) === 0) {
        const filled = hit.id === B.water ? I.water_bucket : I.lava_bucket;
        w.setBlock(hit.pos[0], hit.pos[1], hit.pos[2], 0);
        sfx.splash();
        if (!p.creative) {
          if (held.count === 1) p.inv.slots[p.selected] = { id: filled, count: 1 };
          else { held.count--; const left = p.inv.add({ id: filled, count: 1 }); if (left) this.throwStack(left); }
        }
      }
      return;
    }
    if (def.armor && !hit) {
      const slot = def.armor.slot;
      const prev = p.armor.slots[slot];
      p.armor.slots[slot] = held;
      p.inv.slots[p.selected] = prev;
      sfx.place('wool');
      if (held.id >= 358 && held.id <= 361) p.achieve('armor');
      return;
    }
    if (held.id === B.lily_pad) {
      const wh = raycast(w, eye, dir, this.reach(), true);
      if (wh && wh.id === B.water && w.getBlock(wh.pos[0], wh.pos[1] + 1, wh.pos[2]) === 0) {
        w.setBlock(wh.pos[0], wh.pos[1] + 1, wh.pos[2], B.lily_pad);
        sfx.place('grass'); consume(); this.renderer.swingHand();
      }
      return;
    }
    if (!hit) return;
    if (held.id === I.water_bucket || held.id === I.lava_bucket) {
      const t = this.placeTarget(hit);
      if (!t) return;
      if (held.id === I.water_bucket && w.dimension === 'ember') {
        sfx.fizz();
        for (let i = 0; i < 8; i++) this.entities.puff(t[0] + 0.5, t[1] + 0.5, t[2] + 0.5);
        if (!p.creative) p.inv.slots[p.selected] = { id: I.bucket, count: 1 };
        return;
      }
      w.setBlock(t[0], t[1], t[2], held.id === I.water_bucket ? B.water : B.lava, 0);
      sfx.splash();
      if (!p.creative) p.inv.slots[p.selected] = { id: I.bucket, count: 1 };
      this.renderer.swingHand();
      return;
    }
    if (def.use === 'bonemeal') {
      if (w.boneMeal(hit.pos[0], hit.pos[1], hit.pos[2])) {
        consume();
        for (let i = 0; i < 8; i++) this.entities.heart(hit.pos[0] + 0.5, hit.pos[1] + 0.8, hit.pos[2] + 0.5);
        this.renderer.swingHand();
      }
      return;
    }
    // Armor: right-click to wear.
    if (def.armor) {
      const slot = def.armor.slot;
      const prev = p.armor.slots[slot];
      p.armor.slots[slot] = held;
      p.inv.slots[p.selected] = prev;
      sfx.place('wool');
      if (held.id >= 358 && held.id <= 361) p.achieve('armor');
      return;
    }
    // Dye recolours white wool.
    if (def.use === 'dye' && def.dye) {
      // Dye recolours wool, and the colour of carpets, stained glass and banners.
      const [x, y, z] = hit.pos;
      const ci = DYE_COLORS.indexOf(def.dye), m = w.getMeta(x, y, z);
      let done = true;
      if (Object.values(WOOL_KEY).some((k) => B[k] === hit.id)) w.setBlock(x, y, z, B[WOOL_KEY[def.dye]]);
      else if (hit.id === B.carpet || hit.id === B.stained_glass) w.setMeta(x, y, z, ci);
      else if (hit.id === B.banner) w.setMeta(x, y, z, (m & ~(15 << 2)) | (ci << 2));
      else done = false;
      if (done) { consume(); this.renderer.swingHand(); }
      return;
    }
    // Shovel on grass makes a path.
    if (def.tool?.kind === 'shovel' && hit.id === B.grass && hit.normal[1] === 1 && w.getBlock(hit.pos[0], hit.pos[1] + 1, hit.pos[2]) === 0) {
      w.setBlock(hit.pos[0], hit.pos[1], hit.pos[2], B.dirt_path);
      sfx.place('gravel');
      this.damageTool(1);
      this.renderer.swingHand();
      return;
    }
    // Hoe: till grass/dirt.
    if (def.tool?.kind === 'hoe' && !def.use) {
      const [x, y, z] = hit.pos;
      if ((hit.id === B.grass || hit.id === B.dirt) && w.getBlock(x, y + 1, z) === 0 && hit.normal[1] !== -1) {
        w.setBlock(x, y, z, B.farmland);
        sfx.place('gravel');
        this.damageTool(1);
        this.renderer.swingHand();
      }
      return;
    }
    // Placing blocks (or items that place a block).
    const blockId = def.places ?? (held.id < 256 ? held.id : -1);
    if (blockId < 0) return;
    this.placeBlock(hit, blockId, consume, def.placeMeta ?? 0);
  }

  private placeTarget(hit: RayHit): [number, number, number] | null {
    const w = this.world!;
    const inPlace = BLOCKS[hit.id].replaceable && hit.id !== 0;
    const t: [number, number, number] = inPlace ? [...hit.pos] : [hit.pos[0] + hit.normal[0], hit.pos[1] + hit.normal[1], hit.pos[2] + hit.normal[2]];
    const cur = w.getBlock(t[0], t[1], t[2]);
    if (!BLOCKS[cur].replaceable || t[1] < 0 || t[1] > 255 || !w.isLoaded(t[0], t[2])) return null;
    return t;
  }

  private placeBlock(hit: RayHit, blockId: number, consume: () => void, color = 0): void {
    const w = this.world!, p = this.player;
    const d = BLOCKS[blockId];
    // Slab on slab makes a full block.
    if ((blockId === B.cobble_slab || blockId === B.plank_slab) && hit.id === blockId && hit.normal[1] === 1) {
      w.setBlock(hit.pos[0], hit.pos[1], hit.pos[2], blockId === B.cobble_slab ? B.cobblestone : B.planks);
      sfx.place(d.sound); consume(); this.renderer.swingHand();
      return;
    }
    const t = this.placeTarget(hit);
    if (!t) return;
    const [x, y, z] = t;
    const q = p.quadrant();
    let meta = 0;
    const n = hit.normal;
    if (d.shape === 'torch') {
      if (n[1] === -1) return;
      meta = n[1] === 1 ? 0 : n[2] === 1 ? 1 : n[2] === -1 ? 2 : n[0] === 1 ? 3 : 4;
    } else if (d.shape === 'ladder') {
      if (n[1] !== 0) return;
      meta = n[2] === 1 ? 0 : n[2] === -1 ? 2 : n[0] === 1 ? 3 : 1;
    } else if (blockId === B.furnace || blockId === B.smoker || blockId === B.chest || blockId === B.crafting_table || blockId === B.pumpkin) {
      meta = [0, 3, 2, 1][q];
    } else if (isLeaves(blockId)) {
      meta = 1; // player-placed leaves never decay
    } else if (BLOCKS[blockId].shape === 'stairs') {
      const upper = n[1] === -1 || (n[1] === 0 && hit.point[1] - Math.floor(hit.point[1]) > 0.5);
      meta = q | (upper ? 4 : 0);
    } else if (isLog(blockId) || blockId === B.basalt || blockId === B.hay_bale) {
      meta = n[0] !== 0 ? 1 : n[2] !== 0 ? 2 : 0; // lie along the axis of the face you clicked
    } else if (blockId === B.fence_gate) {
      meta = q === 0 || q === 2 ? 0 : 1;
    } else if (blockId === B.trapdoor) {
      const upper = n[1] === -1 || (n[1] === 0 && hit.point[1] - Math.floor(hit.point[1]) > 0.5);
      meta = [2, 3, 0, 1][q] | (upper ? 8 : 0);
    } else if (blockId === B.lantern) {
      meta = n[1] === -1 ? 1 : 0;
    } else if (blockId === B.button) {
      meta = n[1] === 1 ? 0 : n[2] === 1 ? 1 : n[2] === -1 ? 2 : n[0] === 1 ? 3 : n[0] === -1 ? 4 : 0;
      if (n[1] === -1) return;
    } else if (blockId === B.sign) {
      if (n[1] === -1) return;
      meta = n[1] === 1 ? [0, 3, 2, 1][q] : (n[2] === 1 ? 0 : n[2] === -1 ? 2 : n[0] === 1 ? 3 : 1) | 4;
    } else if (blockId === B.repeater || blockId === B.comparator) {
      if (n[1] !== 1) return;
      meta = [2, 1, 0, 3][q];
    } else if (blockId === B.anvil) {
      meta = q % 2 === 0 ? 0 : 1;
    } else if (blockId === B.item_frame) {
      if (n[1] !== 0) return;
      meta = n[2] === 1 ? 0 : n[2] === -1 ? 2 : n[0] === 1 ? 3 : 1;
    } else if (blockId === B.piston || blockId === B.sticky_piston || blockId === B.watcher) {
      // Pistons face you (so they push away from where you stand); watchers look where you look.
      const d = p.lookDir();
      const look = Math.abs(d[1]) > 0.72 ? (d[1] > 0 ? 1 : 0) : [2, 4, 3, 5][q];
      meta = blockId === B.watcher ? look : look ^ 1;
    } else if (blockId === B.hopper) {
      // It points into the block you clicked (down when placed on top of something).
      meta = n[1] === 1 ? 0 : n[1] === -1 ? 0 : n[2] === 1 ? 2 : n[2] === -1 ? 3 : n[0] === 1 ? 4 : 5;
    } else if (blockId === B.rail || blockId === B.powered_rail) {
      if (n[1] === -1) return;
      meta = q === 0 || q === 2 ? 0 : 1;
    } else if (blockId === B.carpet || blockId === B.stained_glass) {
      meta = color;
    } else if (blockId === B.banner) {
      // On a wall it hangs flat against it; on the ground it stands on a pole, facing you.
      if (n[1] === -1) return;
      const wall = n[2] === 1 ? 0 : n[2] === -1 ? 2 : n[0] === 1 ? 3 : 1;
      meta = n[1] === 1 ? ([2, 3, 0, 1][q] | 64) : wall;
      meta |= color << 2;
    } else if (blockId === B.painting) {
      if (n[1] !== 0) return;
      meta = (n[2] === 1 ? 0 : n[2] === -1 ? 2 : n[0] === 1 ? 3 : 1) | (Math.floor(Math.random() * 16) << 2);
    }
    // Keep solid blocks out of entities.
    if (SOLID[blockId]) {
      const box = selectionBox(blockId, meta) ?? { min: [0, 0, 0], max: [1, 1, 1] };
      const bodies = [p.body, ...this.entities!.mobs().map((m) => m.body)];
      for (const b of bodies) {
        const a = b.aabb();
        if (a.max[0] > x + box.min[0] && a.min[0] < x + box.max[0] && a.max[1] > y + box.min[1] && a.min[1] < y + box.max[1] && a.max[2] > z + box.min[2] && a.min[2] < z + box.max[2]) return;
      }
    }
    if (blockId === B.door) {
      if (!BLOCKS[w.getBlock(x, y + 1, z)].replaceable) return;
      const dm = [0, 3, 2, 1][q];
      w.setBlock(x, y + 1, z, B.door, dm | 8);
      w.setBlock(x, y, z, B.door, dm);
      if (!w.canStay(x, y, z, B.door, dm)) { w.setBlock(x, y, z, 0); w.setBlock(x, y + 1, z, 0); return; }
    } else if (blockId === B.bed) {
      const f = [2, 1, 0, 3][q];
      const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][f];
      const hx = x + dx, hz = z + dz;
      if (!BLOCKS[w.getBlock(hx, y, hz)].replaceable || !SOLID[w.getBlock(hx, y - 1, hz)] || !SOLID[w.getBlock(x, y - 1, z)]) return;
      w.setBlock(x, y, z, B.bed, f);
      w.setBlock(hx, y, hz, B.bed, f | 8);
    } else {
      if (!w.canStay(x, y, z, blockId, meta)) {
        // canStay reads the world, so check support with a temporary write.
        const prev = w.getBlock(x, y, z);
        if (prev !== 0 && !BLOCKS[prev].replaceable) return;
        if (!this.supportOk(x, y, z, blockId, meta)) return;
      }
      if (p.creative) { this.g.history.begin(); this.g.history.record(x, y, z); }
      w.setBlock(x, y, z, blockId, meta);
      if (blockId === B.sapling && p.creative && this.g.input.keys.has('ControlLeft')) w.growTree(x, y, z);
      if (blockId === B.sign) setTimeout(() => this.g.signs.edit(x, y, z), 0);
      if (blockId === B.rail || blockId === B.powered_rail) { w.fitRail(x, y, z); if (blockId === B.powered_rail) w.updatePower(x, y, z); }
    }
    sfx.place(d.sound);
    consume();
    this.renderer.swingHand();
    p.stat('placed');
  }

  /** Right-click on the newer blocks: comparators, anvils, barrels, smokers, campfires, composters, frames and pots. */
  private useWorkshopBlock(x: number, y: number, z: number, id: number, held: ItemStack | null, consume: () => void): boolean {
    const w = this.world!, p = this.player;
    if (id === B.comparator) {
      w.setMeta(x, y, z, w.getMeta(x, y, z) ^ 4);
      sfx.click();
      return true;
    }
    if (id === B.anvil) { document.exitPointerLock(); this.containers.show('anvil'); return true; }
    if (id === B.barrel) { const be = w.getBlockEntity(x, y, z); if (be?.kind === 'chest') { document.exitPointerLock(); this.containers.show('chest', { chest: be.inv, title: 'Barrel' }); } return true; }
    if (id === B.smoker || id === B.smoker_lit) { const be = w.getBlockEntity(x, y, z); if (be?.kind === 'furnace') { document.exitPointerLock(); this.containers.show('furnace', { furnace: be, title: 'Smoker' }); } return true; }
    if (id === B.campfire) {
      // Lay raw food on the fire.
      const be = w.getBlockEntity(x, y, z);
      if (!held || be?.kind !== 'campfire' || SMELTING[held.id] === undefined || !itemDef(SMELTING[held.id])?.food) return false;
      const i = be.inv.slots.findIndex((s) => !s);
      if (i < 0) return true;
      be.inv.slots[i] = { id: held.id, count: 1 };
      be.cook[i] = 0;
      consume();
      sfx.place('wood'); this.renderer.swingHand();
      return true;
    }
    if (id === B.composter) {
      const m = w.getMeta(x, y, z);
      if (m >= 8) {
        w.setMeta(x, y, z, 0);
        this.entities!.dropItem(x + 0.5, y + 1.1, z + 0.5, { id: I.bone_meal, count: 1 });
        sfx.place('gravel');
        return true;
      }
      const chance = held ? compostChance(held.id) : 0;
      if (!chance || m >= 7) return !!chance;
      consume();
      this.renderer.swingHand();
      if (Math.random() < chance) {
        // The seventh layer ripens into bone meal after a moment.
        w.setMeta(x, y, z, m + 1);
        if (m + 1 === 7) setTimeout(() => { if (w.getBlock(x, y, z) === B.composter && w.getMeta(x, y, z) === 7) w.setMeta(x, y, z, 8); }, 1000);
      }
      sfx.place('grass');
      return true;
    }
    if (id === B.item_frame) {
      const be = w.getBlockEntity(x, y, z);
      if (be?.kind !== 'frame') return true;
      const cur = be.inv.slots[0];
      if (cur) {
        // Take it back out.
        be.inv.slots[0] = null;
        const left = p.inv.add(cur);
        if (left) this.throwStack(left);
      } else if (held) {
        be.inv.slots[0] = { ...held, count: 1 };
        consume();
      } else return true;
      const c = w.getChunk(x >> 4, z >> 4);
      if (c) { c.modified = true; c.version++; }
      sfx.place('wood'); this.renderer.swingHand();
      return true;
    }
    if (id === B.flower_pot) {
      const m = w.getMeta(x, y, z);
      if (m) {
        w.setMeta(x, y, z, 0);
        const left = p.inv.add({ id: POTTED[m], count: 1 });
        if (left) this.throwStack(left);
        return true;
      }
      const k = held ? POTTED.indexOf(held.id) : -1;
      if (k <= 0) return false;
      w.setMeta(x, y, z, k);
      consume();
      sfx.place('grass'); this.renderer.swingHand();
      return true;
    }
    return false;
  }

  private supportOk(x: number, y: number, z: number, id: number, meta: number): boolean {
    return this.world!.canStay(x, y, z, id, meta);
  }

  sleep(x: number, y: number, z: number): void {
    const w = this.world!;
    if (w.dimension === 'ember') {
      // Beds don't work down here.
      w.setBlock(x, y, z, 0);
      this.entities!.explode(x + 0.5, y + 0.5, z + 0.5, 5, true);
      return;
    }
    if (w.time < 12541 || w.time > 23458) { this.g.toast('You can only sleep at night.'); return; }
    const monsters = this.entities!.mobs().some((m) => m.spec.hostile && Math.hypot(m.body.pos[0] - x, m.body.pos[1] - y, m.body.pos[2] - z) < 8);
    if (monsters) { this.g.toast('You may not rest now. There are monsters nearby.'); return; }
    this.player.spawn = [x + 0.5, y + 0.6, z + 0.5];
    this.player.achieve('sleep');
    this.g.fadeEl.style.opacity = '1';
    setTimeout(() => {
      w.time = 0;
      if (w.weather !== 'clear') { w.weather = 'clear'; w.weatherTimer = 12000 + Math.floor(Math.random() * 100000); }
      this.g.fadeEl.style.opacity = '0';
      this.g.toast('Respawn point set.');
    }, 1200);
  }

  releaseBow(): void {
    const charge = this.bowCharge;
    this.bowCharge = 0;
    const p = this.player, held = p.held;
    if (!charge || !held || held.id !== I.bow || !this.entities || !p.alive) return;
    const t = (charge - 1) / 20;
    let power = (t * t + t * 2) / 3;
    if (power < 0.1) return;
    power = Math.min(1, power);
    const arrowSlot = p.inv.slots.findIndex((s) => s?.id === I.arrow);
    if (arrowSlot < 0 && !p.creative) return;
    const dmg = 2 + (enchLevel(held, 'power') ? enchLevel(held, 'power') * 0.5 + 0.5 : 0);
    const arrow = this.entities.shoot('arrow', 'player', p.eye(), p.lookDir(), power * 3, 0.0075, dmg, !p.creative);
    void arrow;
    if (!p.creative) { p.inv.removeOne(arrowSlot); this.damageTool(1); }
  }

  private castOrReel(): void {
    const p = this.player, ents = this.entities!;
    if (this.bobber && !this.bobber.dead) {
      const b = this.bobber;
      if (b.biteTicks > 0) {
        const r = Math.random();
        // Mostly fish (trout, salmon, the rare glowing glimmerfish), sometimes junk, now and then treasure.
        const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
        const loot = r < 0.65 ? { id: pick([I.raw_fish, I.raw_fish, I.raw_fish, I.raw_fish, I.salmon, I.salmon, I.glimmerfish]), count: 1 }
          : r < 0.85 ? { id: pick([I.leather, I.bone, I.string, I.stick, I.bowl, B.lily_pad, I.rotten_flesh, I.water_bottle]), count: 1 }
            : { id: pick([I.saddle, I.book, I.gold_ingot, I.diamond, I.bow, I.crossbow, I.golden_apple, I.honeycomb]), count: 1 };
        const e = p.eye();
        const d = [e[0] - b.body.pos[0], e[1] - b.body.pos[1], e[2] - b.body.pos[2]];
        ents.dropItem(b.body.pos[0], b.body.pos[1] + 0.3, b.body.pos[2], loot, 0, [d[0] * 0.1, d[1] * 0.1 + Math.hypot(d[0], d[2]) * 0.03, d[2] * 0.1]);
        ents.dropXp(p.body.pos[0], p.body.pos[1] + 0.5, p.body.pos[2], 1 + Math.floor(Math.random() * 6));
        if (loot.id === I.raw_fish || loot.id === I.salmon || loot.id === I.glimmerfish) { p.achieve('fish'); p.stat('fish'); }
      }
      b.dead = true;
      this.bobber = null;
      this.damageTool(1);
      this.renderer.swingHand();
      return;
    }
    const e = p.eye(), d = p.lookDir();
    this.bobber = ents.add(new Bobber(e[0] + d[0] * 0.5, e[1] + d[1] * 0.5, e[2] + d[2] * 0.5, [d[0] * 0.8, d[1] * 0.8 + 0.15, d[2] * 0.8]));
    this.renderer.swingHand();
  }

  pickBlock(): void {
    const p = this.player;
    if (!this.target) return;
    let id = this.target.id;
    if (id === B.furnace_lit) id = B.furnace;
    if (id === B.lamp_on) id = B.lamp;
    if (id === B.wheat) id = I.seeds;
    if (id === B.carpet || id === B.stained_glass || id === B.banner) id = coloredItem(id, (this.world!.getMeta(...this.target.pos) >> (BLOCKS[id].metaShift ?? 0)) & 15);
    const inHotbar = p.inv.slots.slice(0, 9).findIndex((s) => s?.id === id);
    if (inHotbar >= 0) { p.selected = inHotbar; return; }
    if (p.creative) p.inv.slots[p.selected] = { id, count: maxStack(id) };
  }

  dropHeld(all: boolean): void {
    const p = this.player;
    const held = p.held;
    if (!held) return;
    const n = all ? held.count : 1;
    this.throwStack({ ...held, count: n });
    held.count -= n;
    if (held.count <= 0) p.inv.slots[p.selected] = null;
  }

  throwStack(s: ItemStack): void {
    if (!this.entities) return;
    const p = this.player, d = p.lookDir(), e = p.eye();
    this.entities.dropItem(e[0], e[1] - 0.3, e[2], s, 40, [d[0] * 0.3, d[1] * 0.3 + 0.1, d[2] * 0.3]);
  }

  private openScreen(kind: 'crafting'): void {
    document.exitPointerLock();
    this.containers.show(kind);
  }
}

/** How likely an item is to add a layer of compost (0 = it can't be composted). */
function compostChance(id: number): number {
  const d = itemDef(id);
  if (!d) return 0;
  const k = d.key;
  if (/seeds|leaves|sapling|tall_grass|fern|kelp|seagrass|cattail|vine|moss/.test(k) || isLeaves(id)) return 0.3;
  if (/flower|poppy|dandelion|mushroom|melon|pumpkin|cactus|sugar_cane|bamboo|bush|wheat|carrot|potato|redroot|apple|berries|hay/.test(k)) return 0.65;
  if (/bread|cake|baked_potato|stew|cookie|pie/.test(k)) return 0.85;
  return 0;
}
