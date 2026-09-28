// Shared worlds. The host's game is the real one: it simulates the world, the creatures and the
// items, and streams the results to each guest over a direct link. Guests generate untouched
// terrain themselves from the seed (it comes out identical) and ask the host only for chunks that
// have been changed. Every block change goes host -> guests; a guest's own changes go to the host,
// which applies them with all their side effects (water flows, redstone reacts) and passes them on.
//
//   host -> guest   welcome, blocks, chunk, snap (creatures, items, players), time, chat,
//                   hurt / give / xp / effect (things happening to that guest), bye
//   guest -> host   hello, state (where you are), chunk (a request), set (a block you changed),
//                   drop (an item you threw or dropped), hit (a creature you struck), chat

import * as THREE from 'three';
import { Body } from '../physics';
import type { EffectId } from '../effects';
import { createAvatar } from '../entities/avatar';
import { ItemEntity, Mob, MOBS, Projectile, TntEntity, XpOrb, type PlayerLike, type ProjectileKind } from '../entities/entities';
import type { Entity } from '../entities/entity';
import type { MobModel } from '../entities/models';
import type { ItemStack } from '../items';
import { rleDecode, rleEncode } from '../storage';
import { CH, CS } from '../world/chunk';
import type { Game } from '../game';
import { createInvite, type Link, type Message } from './peer';
import { nameTag } from '../render/nametag';

const VOLUME = CS * CS * CH;
/** Creatures and items within this distance of a guest are sent to them. */
const VIEW = 72;
export const MAX_GUESTS = 4;

export interface PlayerState { name: string; pos: [number, number, number]; yaw: number; pitch: number; held: number; sneak: boolean; alive: boolean; creative: boolean }

// ---------------------------------------------------------------- Other players, drawn
/** Another player's figure with a floating name tag, easing toward their latest position. */
class Figure {
  model: MobModel;
  private tag: THREE.Sprite;
  private target: [number, number, number];
  private yaw = 0;
  private walk = 0;
  private last: [number, number, number];
  constructor(scene: THREE.Scene, public name: string, pos: [number, number, number]) {
    this.model = createAvatar();
    this.tag = nameTag(name);
    this.tag.position.y = 2.25;
    this.model.root.add(this.tag);
    scene.add(this.model.root);
    this.target = [...pos];
    this.last = [...pos];
    this.model.root.position.set(...pos);
  }
  set(s: PlayerState): void {
    this.target = [...s.pos];
    this.yaw = s.yaw;
    const p = this.model.parts;
    p.head.rotation.x = s.pitch * 0.9;
    p.body.rotation.x = s.sneak ? 0.35 : 0;
    this.model.root.visible = s.alive;
  }
  frame(dt: number): void {
    const r = this.model.root, k = Math.min(1, dt * 12);
    r.position.x += (this.target[0] - r.position.x) * k;
    r.position.y += (this.target[1] - r.position.y) * k;
    r.position.z += (this.target[2] - r.position.z) * k;
    let dy = this.yaw - r.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.rotation.y += dy * k;
    const speed = Math.hypot(r.position.x - this.last[0], r.position.z - this.last[2]) / Math.max(dt, 0.001);
    this.last = [r.position.x, r.position.y, r.position.z];
    const amp = Math.min(1, speed / 4);
    this.walk += speed * dt * 3;
    const s = Math.sin(this.walk) * 0.8 * amp, p = this.model.parts;
    p.legL.rotation.x = s; p.legR.rotation.x = -s; p.armL.rotation.x = -s * 0.8; p.armR.rotation.x = s * 0.8;
  }
  dispose(): void { this.model.root.removeFromParent(); }
}

// ---------------------------------------------------------------- Host
/** A guest as the host's creatures and items see them: hits and pickups are passed on over the link. */
class RemotePlayer implements PlayerLike {
  body = new Body(0, 0, 0, 0.6, 1.8);
  eyeHeight = 1.62;
  yaw = 0;
  /** Not counted until their first position arrives. */
  alive = false;
  creative = false;
  held: ItemStack | null = null;
  constructor(private link: Link) {}
  damage(amount: number, source: string, knock?: [number, number]): void { if (this.alive && !this.creative) this.link.send({ op: 'hurt', amount, source, knock }); }
  pickUp(stack: ItemStack): ItemStack | null { this.link.send({ op: 'give', stack }); return null; }
  addXp(n: number): void { this.link.send({ op: 'xp', n }); }
  addEffect(id: EffectId, ticks: number, level = 1): void { this.link.send({ op: 'effect', id, ticks, level }); }
}

interface Guest { id: number; link: Link; name: string; proxy: RemotePlayer; figure: Figure | null; state: PlayerState | null; chunkQueue: [number, number][]; }

export class HostSession {
  readonly guests = new Map<number, Guest>();
  private seq = 0;
  private changes: [number, number, number, number, number][] = [];
  private ids = new WeakMap<Entity, number>();
  private byId = new Map<number, Entity>();
  private nextEntity = 1;

  constructor(private g: Game) {
    const w = g.world!;
    w.onChange = (x, y, z, id, meta) => { if (this.guests.size) this.changes.push([x, y, z, id, meta]); };
    g.entities!.others = [];
  }

  get guestNames(): string[] { return [...this.guests.values()].map((q) => q.name); }

  /** Make an invite; `accept` finishes it with the friend's reply. */
  async invite(): Promise<{ code: string; accept: (reply: string) => Promise<string> }> {
    if (this.guests.size >= MAX_GUESTS) throw new Error(`Up to ${MAX_GUESTS} friends can join at once.`);
    const inv = await createInvite();
    return {
      code: inv.code,
      accept: async (reply: string) => {
        const link = await inv.accept(reply);
        return new Promise<string>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Your friend connected but never said hello.')), 20_000);
          link.onMessage = (m) => {
            if (m.op !== 'hello') return;
            clearTimeout(t);
            if (m.build !== __BUILD_ID__) { link.send({ op: 'bye', reason: 'You and the host are running different versions of Blockhaven. Both reload the page, then try again.' }); setTimeout(() => link.close(), 500); reject(new Error('Your friend is on a different version of the game. Ask them to reload the page.')); return; }
            resolve(this.admit(link, String(m.name || 'Friend').slice(0, 16)));
          };
        });
      },
    };
  }

  private admit(link: Link, name: string): string {
    const g = this.g, w = g.world!, p = g.player;
    const id = ++this.seq;
    const proxy = new RemotePlayer(link);
    const guest: Guest = { id, link, name, proxy, figure: null, state: null, chunkQueue: [] };
    this.guests.set(id, guest);
    g.entities!.others.push(proxy);
    link.onMessage = (m) => this.receive(guest, m);
    link.onClose = () => this.remove(guest, `${name} left the game.`);
    const spawn: [number, number, number] = [p.body.pos[0] + 1.5, p.body.pos[1], p.body.pos[2] + 1.5];
    link.send({ op: 'welcome', seed: w.seed, world: g.meta?.name ?? 'World', time: w.time, weather: w.weather, gamemode: p.creative ? 'creative' : 'survival', spawn, host: g.playerName });
    g.chat.say(`${name} joined the game.`);
    this.broadcast({ op: 'chat', text: `${name} joined the game.` }, guest);
    return name;
  }

  private remove(q: Guest, msg: string): void {
    if (!this.guests.has(q.id)) return;
    this.guests.delete(q.id);
    q.figure?.dispose();
    const ents = this.g.entities;
    if (ents) ents.others = ents.others.filter((o) => o !== q.proxy);
    this.g.chat.say(msg);
    this.broadcast({ op: 'chat', text: msg });
    this.broadcast({ op: 'gone', name: q.name });
  }

  private broadcast(m: Message, except?: Guest): void {
    for (const q of this.guests.values()) if (q !== except) q.link.send(m);
  }

  say(text: string): void { this.broadcast({ op: 'chat', text: `<${this.g.playerName}> ${text}` }); }

  private receive(q: Guest, m: Message): void {
    const g = this.g, w = g.world, ents = g.entities;
    if (!w || !ents) return;
    switch (m.op) {
      case 'state': {
        const s = m.s as PlayerState;
        q.state = s;
        q.proxy.body.pos = [...s.pos];
        q.proxy.yaw = s.yaw; q.proxy.alive = s.alive; q.proxy.creative = s.creative;
        q.proxy.held = s.held ? { id: s.held, count: 1 } : null;
        if (!q.figure) q.figure = new Figure(g.renderer.scene, q.name, s.pos);
        q.figure.set(s);
        break;
      }
      case 'chunk': q.chunkQueue.push([m.cx as number, m.cz as number]); break;
      case 'set': {
        const [x, y, z, id, meta] = m.b as number[];
        w.setBlock(x, y, z, id, meta);
        break;
      }
      case 'drop': {
        const [x, y, z] = m.pos as number[];
        ents.dropItem(x, y, z, m.stack as ItemStack, (m.delay as number) ?? 10, m.vel as [number, number, number] | undefined);
        break;
      }
      case 'hit': {
        const e = this.byId.get(m.id as number);
        if (e instanceof Mob && !e.dead) e.hurt(ents, m.amount as number, (m.from as [number, number, number] | null) ?? q.proxy.body.pos as [number, number, number], (m.knock as number) ?? 0.4, true);
        break;
      }
      case 'chat': {
        const text = `<${q.name}> ${String(m.text).slice(0, 200)}`;
        g.chat.say(text);
        // Everyone else; the sender already shows their own line.
        this.broadcast({ op: 'chat', text }, q);
        break;
      }
    }
  }

  private netId(e: Entity): number {
    let id = this.ids.get(e);
    if (!id) { id = this.nextEntity++; this.ids.set(e, id); }
    this.byId.set(id, e);
    return id;
  }

  /** Once a game tick. */
  tick(): void {
    const g = this.g, w = g.world, ents = g.entities;
    if (!w || !ents || !this.guests.size) { this.changes.length = 0; return; }
    w.tickAround = [...this.guests.values()].filter((q) => q.state).map((q) => [q.state!.pos[0], q.state!.pos[2]]);
    if (this.changes.length) { this.broadcast({ op: 'blocks', l: this.changes }); this.changes = []; }
    for (const q of this.guests.values()) this.serveChunks(q);
    if (w.tickCount % 2 === 0) {
      // Forget ids of entities that are gone.
      for (const [id, e] of this.byId) if (e.dead) this.byId.delete(id);
      const me = g.player;
      const players: PlayerState[] = [{ name: g.playerName, pos: [...me.body.pos] as [number, number, number], yaw: me.yaw, pitch: me.pitch, held: me.held?.id ?? 0, sneak: me.sneaking, alive: me.alive, creative: me.creative }];
      for (const q of this.guests.values()) if (q.state) players.push(q.state);
      for (const q of this.guests.values()) {
        if (!q.state) continue;
        const [px, , pz] = q.state.pos;
        const list: unknown[] = [];
        for (const e of ents.list) {
          if (e.dead || e.netId) continue;
          const b = e.body.pos;
          if (Math.abs(b[0] - px) > VIEW || Math.abs(b[2] - pz) > VIEW) continue;
          const r = (v: number) => Math.round(v * 100) / 100;
          const id = this.netId(e);
          if (e instanceof Mob) {
            const f = (e.hurtTime > 0 ? 1 : 0) | (e.deathTime > 0 ? 2 : 0) | (e.baby ? 4 : 0) | (e.sheared ? 8 : 0) | (e.aiming ? 16 : 0) | (e.tamed ? 32 : 0) | (e.sitting ? 64 : 0) | (e.captain ? 128 : 0) | (e.saddled ? 256 : 0) | (e.attackCooldown > 0 ? 512 : 0);
            list.push(['m', id, e.spec.kind, r(b[0]), r(b[1]), r(b[2]), r(e.yaw), f, e.spec.trader ? e.profession : e.fuse]);
          } else if (e instanceof ItemEntity) list.push(['i', id, e.stack.id, e.stack.count, r(b[0]), r(b[1]), r(b[2])]);
          else if (e instanceof Projectile) list.push(['p', id, e.kind, r(b[0]), r(b[1]), r(b[2])]);
          else if (e instanceof XpOrb) list.push(['x', id, e.value, r(b[0]), r(b[1]), r(b[2])]);
          else if (e instanceof TntEntity) list.push(['t', id, e.fuse, r(b[0]), r(b[1]), r(b[2])]);
        }
        q.link.send({ op: 'snap', e: list, p: players.filter((s) => s !== q.state) });
      }
    }
    if (w.tickCount % 40 === 0) this.broadcast({ op: 'time', time: w.time, weather: w.weather });
  }

  /** Send a few requested chunks, holding back when the link is busy. */
  private serveChunks(q: Guest): void {
    const w = this.g.world!;
    for (let n = 0; n < 4 && q.chunkQueue.length && q.link.backlog < 1_000_000; n++) {
      const [cx, cz] = q.chunkQueue.shift()!;
      void w.chunkData(cx, cz).then((d) => {
        if (!d) { q.link.send({ op: 'chunk', cx, cz, none: true }); return; }
        const a = rleEncode(d.blocks), b = rleEncode(d.meta);
        const bin = new Uint8Array(4 + a.length + b.length);
        new DataView(bin.buffer).setUint32(0, a.length);
        bin.set(a, 4); bin.set(b, 4 + a.length);
        q.link.send({ op: 'chunk', cx, cz }, bin);
      });
    }
  }

  frame(dt: number): void { for (const q of this.guests.values()) q.figure?.frame(dt); }

  /** Close the world to friends (when the host quits). */
  close(): void {
    for (const q of this.guests.values()) { q.link.send({ op: 'bye', reason: 'The host closed the world.' }); q.figure?.dispose(); setTimeout(() => q.link.close(), 300); }
    this.guests.clear();
    if (this.g.world) { this.g.world.onChange = null; this.g.world.tickAround = []; }
    if (this.g.entities) this.g.entities.others = [];
  }
}

// ---------------------------------------------------------------- Guest
export interface Welcome { seed: number; world: string; time: number; weather: 'clear' | 'rain' | 'thunder'; gamemode: 'survival' | 'creative'; spawn: [number, number, number]; host: string }

export class GuestSession {
  readonly guest = true;
  private chunkWaits = new Map<string, (d: { blocks: Uint8Array; meta: Uint8Array } | null) => void>();
  private puppets = new Map<number, Entity>();
  private figures = new Map<string, Figure>();
  onBye: (reason: string) => void = () => {};
  private ended = false;

  constructor(private g: Game, readonly link: Link, readonly welcome: Welcome) {
    link.onMessage = (m, bin) => this.receive(m, bin);
    link.onClose = () => this.end('The connection to the host was lost.');
  }

  /** Point a freshly made world and entity manager at the host. */
  attach(): void {
    const g = this.g, w = g.world!, ents = g.entities!;
    w.simulate = false;
    w.persist = false;
    w.weather = this.welcome.weather;
    w.remoteChunk = (cx, cz) => new Promise((resolve) => {
      const key = `${cx},${cz}`;
      this.chunkWaits.set(key, resolve);
      this.link.send({ op: 'chunk', cx, cz });
      setTimeout(() => { if (this.chunkWaits.get(key) === resolve) { this.chunkWaits.delete(key); resolve(null); } }, 15_000);
    });
    w.onChange = (x, y, z, id, meta) => this.link.send({ op: 'set', b: [x, y, z, id, meta] });
    w.onDrop = (x, y, z, stack) => this.link.send({ op: 'drop', pos: [x, y, z], stack });
    ents.remoteDrop = (x, y, z, stack, delay, vel) => this.drop(x, y, z, stack, delay, vel);
    w.onSpawns = () => {};
    ents.puppets = true;
    ents.onPuppetHit = (mob, amount, from, knock) => this.link.send({ op: 'hit', id: mob.netId, amount, from, knock });
  }

  /** An item you threw or dropped goes to the host, which owns all items. */
  drop(x: number, y: number, z: number, stack: ItemStack, delay: number, vel?: [number, number, number]): void {
    this.link.send({ op: 'drop', pos: [x, y, z], stack, delay, vel });
  }

  say(text: string): void { this.link.send({ op: 'chat', text }); }

  private receive(m: Message, bin?: Uint8Array): void {
    const g = this.g, w = g.world, ents = g.entities, p = g.player;
    if (m.op === 'bye') { this.end(String(m.reason ?? 'The host closed the world.')); return; }
    if (!w || !ents) return;
    switch (m.op) {
      case 'blocks': for (const [x, y, z, id, meta] of m.l as number[][]) w.applyRemote(x, y, z, id, meta); break;
      case 'chunk': {
        const key = `${m.cx},${m.cz}`;
        const done = this.chunkWaits.get(key);
        if (!done) break;
        this.chunkWaits.delete(key);
        if (m.none || !bin) { done(null); break; }
        const n = new DataView(bin.buffer, bin.byteOffset).getUint32(0);
        done({ blocks: rleDecode(bin.subarray(4, 4 + n), VOLUME), meta: rleDecode(bin.subarray(4 + n), VOLUME) });
        break;
      }
      case 'snap': this.snap(m.e as unknown[][], m.p as PlayerState[]); break;
      case 'time': w.time = m.time as number; w.weather = m.weather as typeof w.weather; break;
      case 'chat': g.chat.say(String(m.text)); break;
      case 'gone': { const f = this.figures.get(String(m.name)); f?.dispose(); this.figures.delete(String(m.name)); break; }
      case 'hurt': p.damage(m.amount as number, String(m.source), m.knock as [number, number] | undefined); break;
      case 'give': {
        const left = p.pickUp(m.stack as ItemStack);
        if (left) this.drop(p.body.pos[0], p.body.pos[1] + 0.5, p.body.pos[2], left, 40);
        break;
      }
      case 'xp': p.addXp(m.n as number); break;
      case 'effect': p.addEffect(m.id as EffectId, m.ticks as number, m.level as number); break;
    }
  }

  private snap(list: unknown[][], players: PlayerState[]): void {
    const ents = this.g.entities!, r = this.g.renderer;
    const seen = new Set<number>();
    for (const row of list) {
      const [type, id] = row as [string, number];
      seen.add(id);
      let e = this.puppets.get(id);
      const pos = (i: number): [number, number, number] => [row[i] as number, row[i + 1] as number, row[i + 2] as number];
      if (type === 'm') {
        const kind = row[2] as string, f = row[7] as number;
        if (!MOBS[kind]) continue;
        if (!e) { e = ents.add(new Mob(MOBS[kind], ...pos(3), MOBS[kind].trader ? (row[8] as string) : undefined)); if (f & 4) (e as Mob).makeBaby(); }
        const mob = e as Mob;
        mob.yaw = row[6] as number;
        if ((f & 1) && mob.hurtTime === 0) mob.hurtTime = 10;
        if ((f & 2) && mob.deathTime === 0) mob.deathTime = 1;
        mob.sheared = !!(f & 8); mob.aiming = !!(f & 16); mob.tamed = !!(f & 32); mob.sitting = !!(f & 64); mob.captain = !!(f & 128); mob.saddled = !!(f & 256);
        if ((f & 512) && mob.attackCooldown === 0) mob.attackCooldown = 10;
        if (!mob.spec.trader) mob.fuse = (row[8] as number) ?? 0;
        e.netTarget = pos(3);
      } else if (type === 'i') {
        if (!e) e = ents.add(new ItemEntity({ id: row[2] as number, count: row[3] as number }, ...pos(4), r, 99999));
        (e as ItemEntity).stack.count = row[3] as number;
        e.netTarget = pos(4);
      } else if (type === 'p') {
        if (!e) e = ents.add(new Projectile(row[2] as ProjectileKind, 'player', ...pos(3), [0, 0, 0], 0, r, false));
        e.netTarget = pos(3);
      } else if (type === 'x') {
        if (!e) e = ents.add(new XpOrb(row[2] as number, ...pos(3)));
        e.netTarget = pos(3);
      } else if (type === 't') {
        if (!e) e = ents.add(new TntEntity(0, 0, 0, r, row[2] as number));
        (e as TntEntity).fuse = row[2] as number;
        e.netTarget = pos(3);
      }
      if (e && !e.netId) { e.netId = id; e.body.pos = [...e.netTarget!]; e.prev = [...e.body.pos]; this.puppets.set(id, e); }
    }
    for (const [id, e] of this.puppets) if (!seen.has(id)) { e.dead = true; this.puppets.delete(id); }
    // The other players.
    const names = new Set<string>();
    for (const s of players) {
      names.add(s.name);
      let f = this.figures.get(s.name);
      if (!f) { f = new Figure(r.scene, s.name, s.pos); this.figures.set(s.name, f); }
      f.set(s);
    }
    for (const [n, f] of this.figures) if (!names.has(n)) { f.dispose(); this.figures.delete(n); }
  }

  /** Once a game tick: tell the host where you are. */
  tick(): void {
    const p = this.g.player, w = this.g.world;
    if (!w || w.tickCount % 2 !== 0) return;
    const s: PlayerState = { name: this.g.playerName, pos: [...p.body.pos] as [number, number, number], yaw: p.yaw, pitch: p.pitch, held: p.held?.id ?? 0, sneak: p.sneaking, alive: p.alive, creative: p.creative };
    this.link.send({ op: 'state', s });
  }

  frame(dt: number): void { for (const f of this.figures.values()) f.frame(dt); }

  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    for (const f of this.figures.values()) f.dispose();
    this.figures.clear();
    this.onBye(reason);
  }

  close(): void {
    this.ended = true;
    for (const f of this.figures.values()) f.dispose();
    this.link.close();
  }
}
