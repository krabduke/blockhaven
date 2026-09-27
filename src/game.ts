import * as THREE from 'three';
// Ties everything together: the main loop, player control, mining and
// placing, interactions, commands, saving, and the title screen flyover.

import { initAudio, setVolume, sfx, spatial } from './audio';
import { B, BLOCKS, SOLID, isLeaves, isLog } from './blocks';
import { Bobber, EntityManager, MOBS, TntEntity } from './entities/entities';
import { I, ITEMS, enchLevel, itemDef, maxStack, type ItemStack } from './items';
import { hashString } from './noise';
import { raycast, selectionBox, stepBody, updateContacts, type RayHit } from './physics';
import { EYE_HEIGHT, Player, SNEAK_EYE_HEIGHT } from './player';
import { Renderer } from './render/renderer';
import { listWorlds, saveWorldMeta, savedChunkKeys, type WorldMeta } from './storage';
import type { Atlas } from './textures';
import { ContainerScreen } from './ui/containers';
import { Hud } from './ui/hud';
import { Menus, loadSettings, type Settings } from './ui/menus';
import { SEA_LEVEL } from './world/chunk';
import { WorkerPool } from './world/pool';
import { BIOME, BIOME_NAMES, WorldGen } from './world/worldgen';
import { nearestVillage } from './world/villages';
import { World } from './world/world';

const TICK = 1 / 20;
const DEATH_MESSAGES: Record<string, string> = {
  fall: 'You hit the ground too hard.',
  drowning: 'You ran out of air.',
  lava: 'You tried to swim in lava.',
  fire: 'You burned to death.',
  starvation: 'You starved.',
  explosion: 'You were caught in an explosion.',
  mirewalker: 'A Mirewalker got you.',
  shellcrawler: 'A Shellcrawler got you.',
  void: 'You fell out of the world.',
  command: 'You gave up.',
  brambler: 'A Brambler shot you full of thorns.',
};

/** Achievements: id -> [title, description]. */
export const ACHIEVEMENTS: Record<string, [string, string]> = {
  wood: ['Timber!', 'Chop down a tree for its wood'],
  table: ['Workbench', 'Craft a crafting table'],
  pickaxe: ['Time to mine', 'Craft a pickaxe'],
  stone: ['Stone Age', 'Craft a stone pickaxe'],
  furnace: ['Hot Stuff', 'Build a furnace'],
  iron: ['Forged in fire', 'Smelt an iron ingot'],
  diamond: ['Sparkle', 'Find a diamond'],
  hunter: ['Monster Hunter', 'Defeat a hostile creature'],
  rancher: ['Rancher', 'Breed two animals'],
  archer: ['Sharpshooter', 'Hit a creature with an arrow from 20 blocks away'],
  fish: ['Gone fishing', 'Catch a fish'],
  sleep: ['Sweet dreams', 'Sleep in a bed'],
  enchant: ['Enchanter', 'Enchant an item'],
  bread: ['Bake bread', 'Turn wheat into bread'],
  armor: ['Suit up', 'Wear a piece of iron armor'],
  gate: ['Into the fire', 'Light an Ember Gate'],
  ember: ['Down below', 'Enter the Emberdeep'],
  trade: ['Fair deal', 'Trade with a villager'],
};

type Mode = 'title' | 'loading' | 'playing';
export type Dimension = 'overworld' | 'ember';

interface DimState { blockEntities?: unknown; entities?: unknown; spawned?: string[] }
type SaveMeta = WorldMeta & {
  entities?: unknown;
  weather?: World['weather'];
  weatherTimer?: number;
  dimension?: Dimension;
  dims?: Partial<Record<Dimension, DimState>>;
};

function dimState(meta: WorldMeta, dim: Dimension): DimState {
  const m = meta as SaveMeta;
  const s = m.dims?.[dim];
  if (s) return s;
  // Saves from before dimensions existed.
  if (dim === 'overworld') return { blockEntities: m.blockEntities, entities: m.entities };
  return {};
}

export class Game {
  renderer: Renderer;
  menus: Menus;
  hud: Hud;
  containers: ContainerScreen;
  settings: Settings;
  mode: Mode = 'title';
  world: World | null = null;
  pool: WorkerPool | null = null;
  entities: EntityManager | null = null;
  player = new Player(0.5, 90, 0.5);
  meta: WorldMeta | null = null;
  dimension: Dimension = 'overworld';

  private keys = new Set<string>();
  private mouse = [false, false, false];
  private acc = 0;
  private last = performance.now();
  private fps = 0;
  private frames = 0;
  private fpsTime = 0;
  private target: RayHit | null = null;
  private breakProgress = 0;
  private breakPos: string | null = null;
  private breakCooldown = 0;
  private useCooldown = 0;
  private eating = 0;
  private lastSpace = 0;
  private lastW = 0;
  private stepDist = 0;
  private prevPos: [number, number, number] = [0, 0, 0];
  private titleAngle = 0;
  private debug = false;
  private hudHidden = false;
  private autosave = 0;
  private fovCurrent = 70;
  private canvas: HTMLCanvasElement;
  private cmdEl: HTMLElement;
  private cmdInput: HTMLInputElement;
  private chatlog: HTMLElement;
  private debugEl: HTMLElement;
  private vignette: HTMLElement;
  private waterOverlay: HTMLElement;
  private fadeEl: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private loadStart = 0;
  private bowCharge = 0;
  private bobber: Bobber | null = null;
  private achEl!: HTMLElement;
  private achQueue: string[] = [];
  private achTimer = 0;
  private lightningEl!: HTMLElement;
  private thunderTimer = 200;

  constructor(private root: HTMLElement, atlas: Atlas) {
    this.canvas = root.querySelector('canvas#game')!;
    this.renderer = new Renderer(this.canvas, atlas);
    this.settings = loadSettings();
    this.hud = new Hud(root);
    this.hud.setVisible(false);
    this.containers = new ContainerScreen(root, this.player);
    this.containers.onClose = () => this.lockPointer();
    this.containers.onDrop = (s) => this.throwStack(s);
    this.menus = new Menus(root, {
      play: (w) => this.play(w),
      create: (name, seed, gm) => this.createWorld(name, seed, gm),
      resume: () => { this.menus.show(null); this.lockPointer(); },
      saveAndQuit: () => this.quitToTitle(),
      respawn: () => this.respawn(),
      settingsChanged: (s) => this.applySettings(s),
    }, this.settings);

    this.cmdEl = root.querySelector('#cmd')!;
    this.cmdInput = this.cmdEl.querySelector('input')!;
    this.chatlog = root.querySelector('#chatlog')!;
    this.debugEl = root.querySelector('#debug')!;
    this.vignette = root.querySelector('#vignette')!;
    this.waterOverlay = root.querySelector('#water-overlay')!;
    this.fadeEl = root.querySelector('#fade')!;
    this.toastEl = root.querySelector('#toast')!;

    this.achEl = document.createElement('div');
    this.achEl.id = 'achievement';
    root.appendChild(this.achEl);
    this.lightningEl = document.createElement('div');
    this.lightningEl.id = 'lightning';
    root.appendChild(this.lightningEl);
    this.applySettings(this.settings);
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    window.addEventListener('beforeunload', () => { this.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    this.startTitle();
    requestAnimationFrame((t) => this.frame(t));
    (window as unknown as { blockhaven: Game }).blockhaven = this;
  }

  // ---------- Setup ----------
  private applySettings(s: Settings): void {
    this.renderer.renderDistance = s.renderDistance;
    this.renderer.fancy = s.fancy;
    this.renderer.shadows = s.shadows;
    this.renderer.uniforms.uGamma.value = s.brightness;
    setVolume(s.volume);
  }

  private resize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }

  private startWorld(meta: WorldMeta, dim: Dimension = 'overworld'): Promise<void> {
    this.disposeWorld();
    this.meta = meta;
    this.dimension = dim;
    this.pool = new WorkerPool(meta.seed, dim);
    this.renderer.dimension = dim;
    const storeId = dim === 'ember' ? meta.id + '~ember' : meta.id;
    const state = dimState(meta, dim);
    return (meta.id === '__title' ? Promise.resolve(new Set<string>()) : savedChunkKeys(storeId).catch(() => new Set<string>())).then((keys) => {
      const world = new World(storeId, meta.seed, this.pool!, keys);
      world.dimension = dim;
      world.spawnedChunks = new Set(state.spawned ?? []);
      world.time = meta.time;
      world.onSubMesh = (cx, sy, cz, m) => this.renderer.setSubMesh(cx, sy, cz, m);
      world.onChunkUnload = (cx, cz) => this.renderer.removeChunk(cx, cz);
      world.onDrop = (x, y, z, s) => this.entities?.dropItem(x, y, z, s);
      world.onEvent = (kind, x, y, z, id) => {
        const p = this.player.body.pos;
        const sp = spatial(p[0], p[1] + 1.6, p[2], this.player.yaw, x + 0.5, y + 0.5, z + 0.5);
        if (kind === 'fizz') sfx.fizz(sp);
        else if (kind === 'break' && this.mode === 'playing') {
          this.entities?.blockBreakParticles(x, y, z, id, 16);
          sfx.breakBlock(BLOCKS[id].sound, sp);
        }
      };
      world.loadBlockEntities(state.blockEntities);
      this.world = world;
      const ents = new EntityManager(world, this.renderer, this.player);
      this.entities = ents;
      ents.load(state.entities);
      world.onSpawns = (spawns) => {
        for (const s of spawns) if (MOBS[s.kind]) ents.spawnMob(s.kind, s.x, s.y, s.z, s.profession);
      };
      world.onIgnite = (x, y, z) => { ents.add(new TntEntity(x, y, z, this.renderer)); };
      ents.onMobKilled = (mob, byPlayer) => { if (byPlayer && mob.spec.hostile) this.player.achieve('hunter'); };
      ents.onBred = () => this.player.achieve('rancher');
      ents.onProjectileHit = (proj, mob) => {
        const pp = this.player.body.pos;
        if (proj.kind === 'arrow' && Math.hypot(mob.body.pos[0] - pp[0], mob.body.pos[2] - pp[2]) >= 20) this.player.achieve('archer');
      };
    });
  }

  private disposeWorld(): void {
    for (const v of this.signMeshes?.values() ?? []) v.mesh.removeFromParent();
    this.signMeshes?.clear();
    this.entities?.clear();
    this.entities = null;
    this.world?.dispose();
    this.world = null;
    this.pool?.dispose();
    this.pool = null;
    this.renderer.clearTerrain();
  }

  private async startTitle(): Promise<void> {
    this.mode = 'title';
    this.hud.setVisible(false);
    this.menus.show('title');
    const gen = new WorldGen(hashString('blockhaven-title'));
    const [sx, sz] = findLand(gen);
    await this.startWorld({ id: '__title', name: 'title', seed: hashString('blockhaven-title'), seedText: '', gamemode: 'creative', created: 0, lastPlayed: 0, time: 4200 });
    this.player = new Player(sx + 0.5, gen.column(sx, sz).height + 1, sz + 0.5);
    this.entities!.player = this.player;
  }

  private async createWorld(name: string, seedText: string, gamemode: 'survival' | 'creative'): Promise<void> {
    const seedStr = seedText || String(Math.floor(Math.random() * 1e12));
    const seed = /^-?\d+$/.test(seedStr) ? (Number(seedStr) >>> 0) || hashString(seedStr) : hashString(seedStr);
    const meta: WorldMeta = { id: 'w' + Date.now().toString(36), name, seed, seedText: seedStr, gamemode, created: Date.now(), lastPlayed: Date.now(), time: 1000 };
    try { await saveWorldMeta(meta); } catch { this.toast('Saving is unavailable in this browser. Your world will not be kept.'); }
    this.play(meta);
  }

  async play(meta: WorldMeta): Promise<void> {
    initAudio();
    this.mode = 'loading';
    this.menus.setLoading('Building terrain…');
    this.menus.show('loading');
    this.loadStart = performance.now();
    await this.startWorld(meta, (meta as SaveMeta).dimension ?? 'overworld');
    const p = new Player(0.5, 100, 0.5);
    p.creative = meta.gamemode === 'creative';
    if (meta.player) p.load(meta.player);
    else {
      const gen = new WorldGen(meta.seed);
      const [sx, sz] = findLand(gen);
      p.body.pos = [sx + 0.5, gen.column(sx, sz).height + 1.2, sz + 0.5];
      p.spawn = [...p.body.pos];
      p.needsSurface = true;
      if (!p.creative) this.toast('Punch a tree to get started. Press E for your inventory.');
    }
    p.onDeath = (src) => this.onDeath(src);
    p.onAchievement = (id) => this.achQueue.push(id);
    p.onHurt = () => { this.vignette.classList.add('hurt'); setTimeout(() => this.vignette.classList.remove('hurt'), 250); };
    this.player = p;
    this.containers = this.rebuildContainers();
    this.entities!.player = p;
    const wm = meta as SaveMeta;
    if (wm.weather) { this.world!.weather = wm.weather; this.world!.weatherTimer = wm.weatherTimer ?? 12000; }
    this.prevPos = [...p.body.pos];
  }

  /** Step through an Ember Gate into the other dimension. */
  async travel(to: Dimension): Promise<void> {
    if (!this.meta || !this.world) return;
    const p = this.player;
    await this.save();
    const scale = to === 'ember' ? 1 / 8 : 8;
    const tx = Math.floor(p.body.pos[0] * scale), tz = Math.floor(p.body.pos[2] * scale);
    const weather = this.world.weather, weatherTimer = this.world.weatherTimer;
    this.mode = 'loading';
    this.containers.close();
    document.exitPointerLock?.();
    this.menus.setLoading(to === 'ember' ? 'Descending into the Emberdeep…' : 'Returning to the surface…');
    this.menus.show('loading');
    this.loadStart = performance.now();
    await this.startWorld(this.meta, to);
    this.world!.weather = weather; this.world!.weatherTimer = weatherTimer;
    this.entities!.player = p;
    p.body.pos = [tx + 0.5, to === 'ember' ? 64 : 90, tz + 0.5];
    p.body.vel = [0, 0, 0];
    p.portalArrival = true;
    p.portalCooldown = 200;
    this.prevPos = [...p.body.pos];
    if (to === 'ember') p.achieve('ember');
  }

  /** Put the player at a matching gate, building one if none is near. */
  private arriveThroughPortal(): void {
    const w = this.world!, p = this.player;
    const [x, , z] = p.body.pos.map(Math.floor);
    const found = w.findPortal(x, 64, z, w.dimension === 'ember' ? 16 : 96);
    if (found) {
      p.body.pos = [found[0] + 0.5, found[1], found[2] + 0.5];
      return;
    }
    // Look for solid ground with room to stand, spiralling out.
    const ember = w.dimension === 'ember';
    for (let r = 0; r <= 16; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = x + dx, cz = z + dz;
        const top = ember ? 118 : w.groundY(cx, cz) + 1;
        const bottom = ember ? 34 : top - 1;
        for (let y = top; y >= bottom; y--) {
          const ground = w.getBlock(cx, y - 1, cz);
          if (!SOLID[ground] || BLOCKS[ground].fluid) continue;
          let clear = true;
          for (let u = -1; u <= 2 && clear; u++) for (let v = 0; v <= 3 && clear; v++) if (w.getBlock(cx + u, y + v, cz) !== 0 && !BLOCKS[w.getBlock(cx + u, y + v, cz)].replaceable) clear = false;
          if (!clear) continue;
          w.buildPortal(cx, y, cz);
          p.body.pos = [cx + 0.5, y, cz + 0.5];
          return;
        }
      }
    }
    // Nowhere suitable: carve a pocket and float a platform.
    const y = ember ? 70 : Math.max(70, w.groundY(x, z));
    for (let u = -3; u <= 4; u++) for (let v = -1; v <= 4; v++) for (let q = -2; q <= 2; q++) w.setBlock(x + u, y + v, z + q, v === -1 ? B.obsidian : 0);
    w.buildPortal(x, y, z);
    p.body.pos = [x + 0.5, y, z + 0.5];
  }

  private rebuildContainers(): ContainerScreen {
    this.containers.root.remove();
    const c = new ContainerScreen(this.root, this.player);
    const p = this.player;
    c.onClose = () => this.lockPointer();
    c.onDrop = (s) => this.throwStack(s);
    c.onSmeltTaken = (s) => {
      const per = s.id === I.iron_ingot || s.id === I.gold_ingot ? 0.7 : s.id === B.glass || s.id === B.stone ? 0.1 : 0.35;
      const xp = Math.floor(per * s.count + Math.random());
      if (xp > 0) p.addXp(xp);
      if (s.id === I.iron_ingot) p.achieve('iron');
    };
    c.onCrafted = (s) => {
      if (s.id === B.crafting_table) p.achieve('table');
      if (itemDef(s.id)?.tool?.kind === 'pickaxe') p.achieve('pickaxe');
      if (s.id === I.stone_pickaxe) p.achieve('stone');
      if (s.id === B.furnace) p.achieve('furnace');
      if (s.id === I.bread) p.achieve('bread');
    };
    c.onEnchanted = () => p.achieve('enchant');
    c.onTraded = () => p.achieve('trade');
    return c;
  }

  private finishLoading(): void {
    const p = this.player;
    if (p.portalArrival && this.world) {
      p.portalArrival = false;
      this.arriveThroughPortal();
      this.prevPos = [...p.body.pos];
    }
    if (p.needsSurface && this.world) {
      const x = Math.floor(p.body.pos[0]), z = Math.floor(p.body.pos[2]);
      p.body.pos[1] = this.world.groundY(x, z) + 0.01;
      p.spawn = [...p.body.pos];
      p.needsSurface = false;
    }
    this.mode = 'playing';
    this.menus.show(null);
    this.hud.setVisible(!this.hudHidden);
    this.lockPointer();
  }

  async save(): Promise<void> {
    if (!this.world || !this.meta || this.meta.id === '__title' || this.mode !== 'playing') return;
    const prev = this.meta as SaveMeta;
    const meta: SaveMeta = {
      ...prev,
      lastPlayed: Date.now(),
      time: this.world.time,
      player: this.player.serialize(),
      weather: this.world.weather,
      weatherTimer: this.world.weatherTimer,
      dimension: this.dimension,
      dims: {
        ...(prev.dims ?? {}),
        [this.dimension]: {
          blockEntities: this.world.serializeBlockEntities(),
          entities: this.entities?.serialize(),
          spawned: [...this.world.spawnedChunks],
        },
      },
    };
    // Older saves kept the overworld state at the top level.
    delete meta.blockEntities;
    delete (meta as { entities?: unknown }).entities;
    meta.gamemode = this.player.creative ? 'creative' : 'survival';
    this.meta = meta;
    try {
      await Promise.all([saveWorldMeta(meta), this.world.saveAll()]);
    } catch (e) {
      console.warn('Save failed', e);
    }
  }

  private async quitToTitle(): Promise<void> {
    this.containers.close();
    await this.save();
    document.exitPointerLock?.();
    this.startTitle();
  }

  // ---------- Helpers for scripts and debugging ----------
  /** Nearest column (spiralling out from the origin) whose biome is one of `biomes`. */
  findBiome(biomes: number[]): [number, number, number] | null {
    if (!this.world) return null;
    const gen = new WorldGen(this.world.seed);
    for (let r = 200; r < 6000; r += 64) for (let a = 0; a < 6.28; a += 0.3) {
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      const c = gen.column(x, z);
      if (biomes.includes(c.biome)) return [x, c.height, z];
    }
    return null;
  }

  listWorlds(): Promise<WorldMeta[]> {
    return listWorlds();
  }

  // ---------- Input ----------
  private lockPointer(): void {
    if (this.mode !== 'playing' || this.containers.open || this.menus.current || this.cmdEl.classList.contains('show')) return;
    const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private bindInput(): void {
    this.canvas.addEventListener('click', () => { initAudio(); this.lockPointer(); });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked && this.mode === 'playing' && !this.containers.open && !this.menus.current && !this.cmdEl.classList.contains('show') && this.player.alive) {
        this.menus.show('pause');
      }
      if (!this.locked) { this.mouse = [false, false, false]; this.keys.clear(); }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022 * this.settings.sensitivity;
      this.player.yaw -= e.movementX * s;
      this.player.pitch -= e.movementY * s * (this.settings.invertY ? -1 : 1);
      this.player.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.player.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouse[e.button] = true;
      if (e.button === 0) this.attack();
      if (e.button === 2) { this.useCooldown = 0; this.use(); }
      if (e.button === 1) this.pickBlock();
    });
    document.addEventListener('mouseup', (e) => {
      this.mouse[e.button] = false;
      if (e.button === 0) { this.breakProgress = 0; this.breakPos = null; }
      if (e.button === 2) { this.eating = 0; this.releaseBow(); }
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      const d = Math.sign(e.deltaY);
      this.player.selected = (this.player.selected + d + 9) % 9;
    }, { passive: true });
    document.addEventListener('keydown', (e) => this.keyDown(e));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.cmdInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = this.cmdInput.value.trim();
        this.closeCommand();
        if (v) this.runCommand(v);
      } else if (e.key === 'Escape') {
        this.closeCommand();
      }
    });
  }

  private keyDown(e: KeyboardEvent): void {
    if (this.mode !== 'playing') return;
    const code = e.code;
    if (['F1', 'F3', 'Tab'].includes(code)) e.preventDefault();
    if (this.containers.open) {
      if (code === 'KeyE' || code === 'Escape') { e.preventDefault(); this.containers.close(); }
      else if (code.startsWith('Digit')) { const n = Number(code.slice(5)) - 1; if (n >= 0 && n < 9) this.containers.hotkey(n); }
      return;
    }
    if (this.menus.current) {
      if (code === 'Escape' && this.menus.current === 'pause') { this.menus.show(null); this.lockPointer(); }
      return;
    }
    if (code === 'Slash' || code === 'KeyT') {
      e.preventDefault();
      this.openCommand(code === 'Slash' ? '/' : '');
      return;
    }
    if (!this.locked) return;
    this.keys.add(code);
    if (code === 'Space') {
      const now = performance.now();
      if (this.player.creative && now - this.lastSpace < 300) {
        this.player.flying = !this.player.flying;
        this.lastSpace = 0;
      } else this.lastSpace = now;
    }
    if (code === 'KeyW' && !e.repeat) {
      const now = performance.now();
      if (now - this.lastW < 280) this.player.sprinting = true;
      this.lastW = now;
    }
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5)) - 1;
      if (n >= 0 && n < 9) this.player.selected = n;
    }
    if (code === 'KeyE' && this.player.alive) {
      document.exitPointerLock();
      this.containers.show(this.player.creative ? 'creative' : 'player');
    }
    if (code === 'KeyQ') this.dropHeld(e.ctrlKey || e.metaKey);
    if (code === 'F3') { this.debug = !this.debug; this.debugEl.classList.toggle('show', this.debug); }
    if (code === 'F1') { this.hudHidden = !this.hudHidden; this.hud.setVisible(!this.hudHidden); }
  }

  private openCommand(prefix: string): void {
    document.exitPointerLock();
    this.cmdEl.classList.add('show');
    this.cmdInput.value = prefix;
    setTimeout(() => this.cmdInput.focus(), 0);
  }

  private closeCommand(): void {
    this.cmdEl.classList.remove('show');
    this.cmdInput.blur();
    this.lockPointer();
  }

  private say(text: string): void {
    const d = document.createElement('div');
    d.textContent = text;
    this.chatlog.appendChild(d);
    setTimeout(() => d.remove(), 8000);
    while (this.chatlog.childElementCount > 8) this.chatlog.firstElementChild!.remove();
  }

  toast(text: string, seconds = 5): void {
    this.toastEl.textContent = text;
    this.toastTimer = seconds;
  }

  runCommand(line: string): void {
    const parts = line.replace(/^\//, '').split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const p = this.player, w = this.world!;
    const findItem = (name: string) => ITEMS.find((it) => it && (it.key === name || it.name.toLowerCase() === name.replace(/_/g, ' ')));
    switch (cmd) {
      case 'help':
        this.say('Commands: /gamemode survival|creative, /time set day|night|<ticks>, /weather clear|rain|thunder, /give <item> [count], /xp <n>, /tp <x> <y> <z>, /spawn <mob>, /locate village, /dimension overworld|ember, /seed, /kill');
        break;
      case 'gamemode': case 'gm': {
        const m = parts[1]?.toLowerCase();
        if (m === 'creative' || m === 'c' || m === '1') { p.creative = true; this.say('Game mode set to Creative'); }
        else if (m === 'survival' || m === 's' || m === '0') { p.creative = false; p.flying = false; this.say('Game mode set to Survival'); }
        else this.say('Usage: /gamemode survival|creative');
        break;
      }
      case 'time': {
        const v = parts[2]?.toLowerCase();
        const t = v === 'day' ? 1000 : v === 'noon' ? 6000 : v === 'sunset' ? 12000 : v === 'night' ? 13000 : v === 'midnight' ? 18000 : Number(v);
        if (parts[1] === 'set' && Number.isFinite(t)) { w.time = ((t % 24000) + 24000) % 24000; this.say(`Time set to ${w.time}`); }
        else this.say('Usage: /time set day|noon|sunset|night|midnight|<ticks>');
        break;
      }
      case 'give': {
        const it = findItem((parts[1] ?? '').toLowerCase());
        if (!it) { this.say(`No item called "${parts[1] ?? ''}"`); break; }
        const n = Math.max(1, Math.min(2304, Number(parts[2]) || 1));
        let left = n;
        while (left > 0) {
          const c = Math.min(left, maxStack(it.id));
          const rest = p.inv.add({ id: it.id, count: c });
          if (rest) this.throwStack(rest);
          left -= c;
        }
        this.say(`Gave ${n} × ${it.name}`);
        break;
      }
      case 'tp': {
        const [x, y, z] = parts.slice(1, 4).map(Number);
        if ([x, y, z].every(Number.isFinite)) { p.body.pos = [x, y, z]; p.body.vel = [0, 0, 0]; this.say(`Teleported to ${x}, ${y}, ${z}`); }
        else this.say('Usage: /tp <x> <y> <z>');
        break;
      }
      case 'spawn': case 'summon': {
        const kind = parts[1]?.toLowerCase();
        if (!kind || !MOBS[kind]) { this.say(`Mobs: ${Object.keys(MOBS).join(', ')}`); break; }
        const d = p.lookDir();
        this.entities!.spawnMob(kind, p.body.pos[0] + d[0] * 3, p.body.pos[1] + 0.5, p.body.pos[2] + d[2] * 3);
        break;
      }
      case 'seed': this.say(`Seed: ${this.meta?.seedText ?? w.seed}`); break;
      case 'weather': {
        const v = parts[1]?.toLowerCase();
        if (v === 'clear' || v === 'rain' || v === 'thunder') { w.weather = v; w.weatherTimer = 12000 + Math.floor(Math.random() * 12000); this.say(`Weather set to ${v}`); }
        else this.say('Usage: /weather clear|rain|thunder');
        break;
      }
      case 'locate': {
        if (parts[1] !== 'village') { this.say('Usage: /locate village'); break; }
        if (w.dimension !== 'overworld') { this.say('There are no villages down here.'); break; }
        const v = nearestVillage(new WorldGen(w.seed), p.body.pos[0], p.body.pos[2]);
        this.say(v ? `Nearest village is at ${v.cx}, ${v.cz} (${Math.round(Math.hypot(v.cx - p.body.pos[0], v.cz - p.body.pos[2]))} blocks away)` : 'No village found nearby.');
        break;
      }
      case 'dimension': {
        const d = parts[1];
        if (d === 'ember' || d === 'overworld') { if (d !== w.dimension) this.travel(d); }
        else this.say('Usage: /dimension overworld|ember');
        break;
      }
      case 'xp': {
        const n = Number(parts[1]);
        if (Number.isFinite(n)) { p.addXp(n); this.say(`Gave ${n} experience`); } else this.say('Usage: /xp <amount>');
        break;
      }
      case 'kill': p.creative = false; p.invulnerable = 0; p.damage(1000, 'command'); break;
      default: this.say(`Unknown command "${cmd}". Type /help for a list.`);
    }
  }

  // ---------- Actions ----------
  private reach(): number {
    return this.player.creative ? 5 : 4.5;
  }

  private attack(): void {
    if (!this.world || !this.entities || !this.player.alive) return;
    this.renderer.swingHand();
    const p = this.player;
    const eye = p.eye(), dir = p.lookDir();
    const mobHit = this.entities.raycastMob(eye, dir, 3);
    const blockDist = this.target ? this.target.dist : Infinity;
    if (mobHit && mobHit.dist < blockDist) {
      const held = p.held;
      const tool = held ? itemDef(held.id)?.tool : undefined;
      let dmg = tool && held?.id !== I.bow && held?.id !== I.shears && held?.id !== I.fishing_rod ? tool.damage : 1;
      const sharp = enchLevel(held, 'sharpness');
      if (sharp) dmg += 0.5 * sharp + 0.5;
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

  private tickBreaking(): void {
    const w = this.world!, p = this.player;
    if (this.breakCooldown > 0) this.breakCooldown--;
    if (!this.mouse[0] || !this.target || !p.alive) { this.breakProgress = 0; this.breakPos = null; this.renderer.setCrack(null, 0); return; }
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
    const shears = p.held?.id === I.shears;
    if (drop && shears && (isLeaves(id) || id === B.tall_grass)) {
      // Shears collect the block itself.
      w.setBlock(pos[0], pos[1], pos[2], 0);
      this.entities!.dropItem(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, { id, count: 1 });
      this.entities!.blockBreakParticles(pos[0], pos[1], pos[2], id, 12);
      sfx.breakBlock(BLOCKS[id].sound);
      this.damageTool(1);
    } else {
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

  private use(): void {
    const w = this.world, p = this.player;
    if (!w || !this.entities || !p.alive) return;
    const held = p.held;
    const def = held ? itemDef(held.id) : undefined;
    const eye = p.eye(), dir = p.lookDir();
    const hit = raycast(w, eye, dir, this.reach(), held?.id === I.bucket);
    const sneaking = p.sneaking;
    const consume = () => { if (!p.creative && held) { held.count--; if (held.count <= 0) p.inv.slots[p.selected] = null; } };

    // Animals: feeding, breeding and shearing.
    const mobHit = this.entities.raycastMob(eye, dir, 3.5);
    if (mobHit && (!hit || mobHit.dist < hit.dist)) {
      const res = mobHit.mob.interact(this.entities, held);
      if (res === 'fed') { consume(); this.renderer.swingHand(); return; }
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
      this.entities.shoot(held.id === I.snowball ? 'snowball' : 'egg', 'player', eye, dir, 1.5, 0.02);
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
      if (id === B.furnace || id === B.furnace_lit) { const be = w.getBlockEntity(x, y, z); if (be?.kind === 'furnace') { document.exitPointerLock(); this.containers.show('furnace', { furnace: be }); } return; }
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
      if (id === B.sign) { this.editSign(x, y, z); return; }
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
      const [x, y, z] = hit.pos;
      if (hit.id === B.wool || hit.id === B.carpet) { w.setBlock(x, y, z, hit.id === B.carpet ? B.carpet : B[def.dye]); consume(); this.renderer.swingHand(); }
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
    this.placeBlock(hit, blockId, consume);
  }

  private placeTarget(hit: RayHit): [number, number, number] | null {
    const w = this.world!;
    const inPlace = BLOCKS[hit.id].replaceable && hit.id !== 0;
    const t: [number, number, number] = inPlace ? [...hit.pos] : [hit.pos[0] + hit.normal[0], hit.pos[1] + hit.normal[1], hit.pos[2] + hit.normal[2]];
    const cur = w.getBlock(t[0], t[1], t[2]);
    if (!BLOCKS[cur].replaceable || t[1] < 0 || t[1] > 255 || !w.isLoaded(t[0], t[2])) return null;
    return t;
  }

  private placeBlock(hit: RayHit, blockId: number, consume: () => void): void {
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
    } else if (blockId === B.furnace || blockId === B.chest || blockId === B.crafting_table || blockId === B.pumpkin) {
      meta = [0, 3, 2, 1][q];
    } else if (isLeaves(blockId)) {
      meta = 1; // player-placed leaves never decay
    } else if (BLOCKS[blockId].shape === 'stairs') {
      const upper = n[1] === -1 || (n[1] === 0 && hit.point[1] - Math.floor(hit.point[1]) > 0.5);
      meta = q | (upper ? 4 : 0);
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
      w.setBlock(x, y, z, blockId, meta);
      if (blockId === B.sapling && p.creative && this.keys.has('ControlLeft')) w.growTree(x, y, z);
      if (blockId === B.sign) setTimeout(() => this.editSign(x, y, z), 0);
    }
    sfx.place(d.sound);
    consume();
    this.renderer.swingHand();
  }

  private supportOk(x: number, y: number, z: number, id: number, meta: number): boolean {
    return this.world!.canStay(x, y, z, id, meta);
  }

  private sleep(x: number, y: number, z: number): void {
    const w = this.world!;
    if (w.dimension === 'ember') {
      // Beds don't work down here.
      w.setBlock(x, y, z, 0);
      this.entities!.explode(x + 0.5, y + 0.5, z + 0.5, 5, true);
      return;
    }
    if (w.time < 12541 || w.time > 23458) { this.toast('You can only sleep at night.'); return; }
    const monsters = this.entities!.mobs().some((m) => m.spec.hostile && Math.hypot(m.body.pos[0] - x, m.body.pos[1] - y, m.body.pos[2] - z) < 8);
    if (monsters) { this.toast('You may not rest now. There are monsters nearby.'); return; }
    this.player.spawn = [x + 0.5, y + 0.6, z + 0.5];
    this.player.achieve('sleep');
    this.fadeEl.style.opacity = '1';
    setTimeout(() => {
      w.time = 0;
      if (w.weather !== 'clear') { w.weather = 'clear'; w.weatherTimer = 12000 + Math.floor(Math.random() * 100000); }
      this.fadeEl.style.opacity = '0';
      this.toast('Respawn point set.');
    }, 1200);
  }

  private signMeshes = new Map<string, { mesh: THREE.Mesh; text: string }>();
  private signEditor: HTMLElement | null = null;

  /** Open the text editor for a sign. */
  editSign(x: number, y: number, z: number): void {
    const w = this.world;
    if (!w || w.getBlock(x, y, z) !== B.sign) return;
    const be = w.getBlockEntity(x, y, z);
    if (!be || be.kind !== 'sign') return;
    document.exitPointerLock();
    if (!this.signEditor) {
      const el = document.createElement('div');
      el.className = 'screen dim';
      el.id = 'sign-editor';
      el.innerHTML = `<div class="panel title-menu stack"><h2>Edit sign</h2>${[0, 1, 2, 3].map((i) => `<input class="field" maxlength="18" aria-label="Line ${i + 1}" data-line="${i}">`).join('')}<button class="btn primary" type="button">Done</button></div>`;
      el.querySelectorAll('input').forEach((inp) => inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') (el.querySelector('button') as HTMLButtonElement).click(); }));
      this.root.appendChild(el);
      this.signEditor = el;
    }
    const el = this.signEditor;
    const inputs = [...el.querySelectorAll('input')] as HTMLInputElement[];
    inputs.forEach((inp, i) => { inp.value = be.lines[i] ?? ''; });
    const done = el.querySelector('button') as HTMLButtonElement;
    done.onclick = () => {
      be.lines = inputs.map((i) => i.value.slice(0, 18));
      const c = w.getChunk(x >> 4, z >> 4);
      if (c) c.modified = true;
      el.classList.remove('show');
      this.menus.current = null;
      this.lockPointer();
    };
    el.classList.add('show');
    this.menus.current = 'sign';
    setTimeout(() => inputs[0].focus(), 0);
  }

  /** Keep sign text meshes in step with sign block entities in loaded chunks. */
  private syncSigns(): void {
    const w = this.world;
    if (!w) return;
    const seen = new Set<string>();
    for (const [key, be] of w.blockEntities) {
      if (be.kind !== 'sign') continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!w.isLoaded(x, z) || w.getBlock(x, y, z) !== B.sign) continue;
      seen.add(key);
      const text = be.lines.join('\n');
      const cur = this.signMeshes.get(key);
      if (cur && cur.text === text) continue;
      if (cur) { cur.mesh.removeFromParent(); cur.mesh.geometry.dispose(); }
      const mesh = this.renderer.signText(be.lines);
      const m = w.getMeta(x, y, z), f = m & 3, wall = (m & 4) !== 0;
      const n = [[0, 1], [-1, 0], [0, -1], [1, 0]][f]; // direction the text faces
      const off = wall ? -0.5 + 2 / 16 + 0.01 : 1 / 16 + 0.01;
      mesh.position.set(x + 0.5 + n[0] * off, y + (wall ? 0.5 : 0.78), z + 0.5 + n[1] * off);
      mesh.rotation.y = [0, -Math.PI / 2, Math.PI, Math.PI / 2][f];
      this.renderer.scene.add(mesh);
      this.signMeshes.set(key, { mesh, text });
    }
    for (const [key, v] of this.signMeshes) if (!seen.has(key)) { v.mesh.removeFromParent(); v.mesh.geometry.dispose(); this.signMeshes.delete(key); }
  }

  private releaseBow(): void {
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
        const loot = r < 0.8 ? { id: I.raw_fish, count: 1 } : r < 0.9 ? { id: [I.leather, I.bone, I.string, I.stick][Math.floor(Math.random() * 4)], count: 1 } : { id: [I.book, B.sapling, I.bow, I.iron_ingot][Math.floor(Math.random() * 4)], count: 1 };
        const e = p.eye();
        const d = [e[0] - b.body.pos[0], e[1] - b.body.pos[1], e[2] - b.body.pos[2]];
        ents.dropItem(b.body.pos[0], b.body.pos[1] + 0.3, b.body.pos[2], loot, 0, [d[0] * 0.1, d[1] * 0.1 + Math.hypot(d[0], d[2]) * 0.03, d[2] * 0.1]);
        ents.dropXp(p.body.pos[0], p.body.pos[1] + 0.5, p.body.pos[2], 1 + Math.floor(Math.random() * 6));
        if (loot.id === I.raw_fish) p.achieve('fish');
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

  private tickAchievements(dt: number): void {
    if (this.achTimer > 0) {
      this.achTimer -= dt;
      if (this.achTimer <= 0) this.achEl.classList.remove('show');
      return;
    }
    const id = this.achQueue.shift();
    if (!id) return;
    const [title, desc] = ACHIEVEMENTS[id] ?? [id, ''];
    this.achEl.innerHTML = `<b>Achievement unlocked</b><span>${title}</span><div class="hint">${desc}</div>`;
    this.achEl.classList.add('show');
    this.achTimer = 4;
    sfx.levelUp();
  }

  private pickBlock(): void {
    const p = this.player;
    if (!this.target) return;
    let id = this.target.id;
    if (id === B.furnace_lit) id = B.furnace;
    if (id === B.lamp_on) id = B.lamp;
    if (id === B.wheat) id = I.seeds;
    const inHotbar = p.inv.slots.slice(0, 9).findIndex((s) => s?.id === id);
    if (inHotbar >= 0) { p.selected = inHotbar; return; }
    if (p.creative) p.inv.slots[p.selected] = { id, count: maxStack(id) };
  }

  private dropHeld(all: boolean): void {
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

  private onDeath(source: string): void {
    const p = this.player;
    if (!p.creative) {
      for (let i = 0; i < p.inv.size; i++) {
        const s = p.inv.slots[i];
        if (s) { this.entities?.dropItem(p.body.pos[0], p.body.pos[1] + 1, p.body.pos[2], s, 40, [(Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4]); p.inv.slots[i] = null; }
      }
    }
    this.containers.close();
    document.exitPointerLock();
    this.menus.setDeathReason(DEATH_MESSAGES[source] ?? 'You died.');
    this.menus.show('death');
  }

  private respawn(): void {
    const p = this.player;
    p.alive = true;
    p.health = 20; p.food = 20; p.saturation = 5; p.air = 300; p.burning = 0; p.exhaustion = 0;
    p.body.pos = [...p.spawn];
    // Bed gone? fall back to the world spawn surface.
    const w = this.world!;
    const bx = Math.floor(p.spawn[0]), by = Math.floor(p.spawn[1]), bz = Math.floor(p.spawn[2]);
    if (w.isLoaded(bx, bz) && SOLID[w.getBlock(bx, by, bz)]) p.body.pos[1] = w.surfaceY(bx, bz);
    p.body.vel = [0, 0, 0];
    p.body.fallDistance = 0;
    this.prevPos = [...p.body.pos];
    this.menus.show(null);
    this.lockPointer();
  }

  // ---------- Loop ----------
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) { this.fps = this.frames; this.frames = 0; this.fpsTime = 0; }

    const w = this.world;
    if (!w) {
      this.renderer.renderFrame(dt, false, 1, false);
      return;
    }
    if (this.mode === 'title') {
      this.titleFrame(dt);
      return;
    }
    if (this.mode === 'loading') {
      w.update(this.player.body.pos[0], this.player.body.pos[2], this.settings.renderDistance);
      const ready = this.nearbyReady(2);
      const secs = (performance.now() - this.loadStart) / 1000;
      this.menus.setLoading(`Building terrain… ${Math.min(99, Math.round(ready * 100))}%`);
      if (ready >= 1 || secs > 20) this.finishLoading();
      this.placeCamera(1);
      this.renderer.updateSky(w.time, this.renderer.camera.position);
      this.renderer.renderFrame(dt, false, 1, false);
      return;
    }

    const paused = this.menus.current === 'pause' || this.menus.current === 'settings';
    if (!paused) {
      this.acc += dt;
      while (this.acc >= TICK) {
        this.acc -= TICK;
        this.tick();
      }
    }
    const alpha = paused ? 1 : this.acc / TICK;
    w.update(this.player.body.pos[0], this.player.body.pos[2], this.settings.renderDistance);
    this.placeCamera(alpha);
    this.updateTarget();
    this.entities!.render(alpha);
    const cam = this.renderer.camera.position;
    this.renderer.underwater = this.player.body.eyeInWater;
    this.waterOverlay.style.display = this.player.body.eyeInWater ? 'block' : 'none';
    const targetRain = w.weather === 'clear' ? 0 : 1, targetThunder = w.weather === 'thunder' ? 1 : 0;
    this.renderer.rain += (targetRain - this.renderer.rain) * Math.min(1, dt * 0.3);
    this.renderer.thunder += (targetThunder - this.renderer.thunder) * Math.min(1, dt * 0.3);
    if (this.renderer.rain > 0.01) {
      this.renderer.updateWeather(dt, cam, (x, y, z) => w.isLoaded(x, z) && w.getSky(x, y, z) >= 15 && !SOLID[w.getBlock(x, y, z)], (x, z) => {
        const c = w.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
        const b = c ? c.biomes[(Math.floor(x) & 15) + (Math.floor(z) & 15) * 16] : 1;
        return b === BIOME.taiga || (b === BIOME.mountains && cam.y > 110);
      });
    } else this.renderer.updateWeather(dt, cam, () => false, () => false);
    this.renderer.updateSky(w.time, cam);
    const heldId = this.player.held?.id ?? 0;
    this.renderer.setHeldItem(heldId === I.bow && this.bowCharge > 8 ? -2 : heldId);
    this.tickAchievements(dt);
    if (w.tickCount % 5 === 0) this.syncSigns();
    const handLight = this.entities!.lightAt(cam.x, cam.y, cam.z);
    const moving = Math.hypot(this.player.body.vel[0], this.player.body.vel[2]) > 0.02 && this.player.body.onGround && this.settings.viewBobbing;
    this.renderer.renderFrame(dt, moving, handLight, !this.hudHidden && this.player.alive);
    this.hud.update(this.player, dt);
    if (this.containers.open && w.tickCount % 2 === 0) this.containers.render();
    if (this.toastTimer > 0) { this.toastTimer -= dt; this.toastEl.style.opacity = this.toastTimer > 0 ? '1' : '0'; }
    if (this.debug) this.updateDebug();
  }

  private nearbyReady(r: number): number {
    const w = this.world!;
    const pcx = Math.floor(this.player.body.pos[0]) >> 4, pcz = Math.floor(this.player.body.pos[2]) >> 4;
    let ok = 0, total = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      total++;
      const c = w.getChunk(pcx + dx, pcz + dz);
      if (c && c.dirty.size === 0) ok++;
    }
    return w.pendingWork > 0 && ok === total ? 0.99 : ok / total;
  }

  private titleFrame(dt: number): void {
    const w = this.world!;
    const p = this.player.body.pos;
    w.update(p[0], p[2], Math.min(this.settings.renderDistance, 8));
    this.titleAngle += dt * 0.05;
    const cam = this.renderer.camera;
    const r = 30;
    cam.position.set(p[0] + Math.cos(this.titleAngle) * r, p[1] + 18, p[2] + Math.sin(this.titleAngle) * r);
    cam.lookAt(p[0], p[1] + 4, p[2]);
    cam.fov = 70;
    cam.updateProjectionMatrix();
    w.time = 4200;
    this.renderer.underwater = false;
    this.renderer.updateSky(w.time, cam.position);
    this.renderer.renderFrame(dt, false, 1, false);
  }

  private placeCamera(alpha: number): void {
    const p = this.player, cam = this.renderer.camera;
    const x = this.prevPos[0] + (p.body.pos[0] - this.prevPos[0]) * alpha;
    const y = this.prevPos[1] + (p.body.pos[1] - this.prevPos[1]) * alpha;
    const z = this.prevPos[2] + (p.body.pos[2] - this.prevPos[2]) * alpha;
    const targetEye = p.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
    p.eyeHeight += (targetEye - p.eyeHeight) * 0.3;
    cam.position.set(x, y + p.eyeHeight, z);
    const hurtTilt = p.hurtTime > 0 ? Math.sin((p.hurtTime / 10) * Math.PI) * 0.08 : 0;
    cam.rotation.set(p.pitch, p.yaw, hurtTilt, 'YXZ');
    let fov = this.settings.fov;
    if (p.sprinting) fov *= 1.12;
    if (p.flying && p.sprinting) fov *= 1.05;
    this.fovCurrent += (fov - this.fovCurrent) * 0.2;
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) { cam.fov = this.fovCurrent; cam.updateProjectionMatrix(); }
  }

  private updateTarget(): void {
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

  private tick(): void {
    const w = this.world!, p = this.player, ents = this.entities!;
    this.prevPos = [...p.body.pos];
    const active = this.locked && p.alive;
    const k = (c: string) => active && this.keys.has(c);
    const forward = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    const strafe = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    p.sneaking = k('ShiftLeft') || k('ShiftRight');
    if (k('ControlLeft') && forward > 0) p.sprinting = true;
    if (forward <= 0 || p.sneaking || (p.food <= 6 && !p.creative) || p.body.collidedH) p.sprinting = false;
    if (!p.creative) p.flying = false;
    updateContacts(w, p.body, p.eyeHeight);
    const wasOnGround = p.body.onGround;
    const jump = k('Space');
    if (p.alive) {
      stepBody(w, p.body, { forward, strafe, jump, sneak: p.sneaking, sprint: p.sprinting, yaw: p.yaw }, p.flying);
    }
    if (p.flying && p.body.onGround) p.flying = false;
    // Landing.
    if (p.body.onGround) {
      if (p.body.fallDistance > 3 && !p.body.inWater && !p.creative) {
        const below = w.getBlock(Math.floor(p.body.pos[0]), Math.floor(p.body.pos[1] - 0.2), Math.floor(p.body.pos[2]));
        const dmg = Math.ceil(p.body.fallDistance - 3) * (below === B.bed ? 0.5 : 1);
        if (dmg > 0) p.damage(dmg, 'fall');
      }
      if (!wasOnGround && p.body.fallDistance > 1) sfx.step(this.soundBelow());
      p.body.fallDistance = 0;
    }
    if (p.body.inWater) p.body.fallDistance = 0;
    // Exhaustion and footsteps.
    const moved = Math.hypot(p.body.pos[0] - this.prevPos[0], p.body.pos[2] - this.prevPos[2]);
    if (p.body.inWater) p.addExhaustion(0.01 * moved);
    else if (p.sprinting) p.addExhaustion(0.1 * moved);
    if (jump && wasOnGround && !p.body.onGround) p.addExhaustion(p.sprinting ? 0.2 : 0.05);
    if (p.body.onGround && !p.sneaking) {
      this.stepDist += moved;
      if (this.stepDist > 1.7) { this.stepDist = 0; sfx.step(this.soundBelow()); }
    }
    if (!p.body.inWater && p.body.eyeInWater === false && this.wasInWater) sfx.splash();
    this.wasInWater = p.body.inWater;

    p.tickStats();
    this.tickBreaking();
    // Regeneration, magma floors and fire.
    if (p.regenTicks > 0) { p.regenTicks--; if (p.regenTicks % 25 === 0) p.health = Math.min(20, p.health + 1); }
    if (p.alive && p.body.onGround && !p.sneaking && w.getBlock(Math.floor(p.body.pos[0]), Math.floor(p.body.pos[1] - 0.1), Math.floor(p.body.pos[2])) === B.magma && w.tickCount % 20 === 0) p.damage(1, 'fire');
    if (p.alive && p.body.inFire) p.burning = Math.max(p.burning, 80);
    // Standing in a gate for 4 seconds (instantly in Creative) takes you through.
    if (p.portalCooldown > 0 && !p.body.inPortal) p.portalCooldown = Math.max(0, p.portalCooldown - 1);
    if (p.body.inPortal && p.alive && p.portalCooldown === 0) {
      p.portalTime++;
      if (p.portalTime % 20 === 1) sfx.fizz({ gain: 0.3, pan: 0 });
      if (p.portalTime >= (p.creative ? 1 : 80)) { p.portalTime = 0; this.travel(w.dimension === 'ember' ? 'overworld' : 'ember'); return; }
    } else p.portalTime = 0;
    if (this.bowCharge > 0) {
      if (p.held?.id !== I.bow || !this.mouse[2]) this.bowCharge = 0;
      else this.bowCharge++;
    }
    // Thunder and lightning.
    if (w.weather === 'thunder' && --this.thunderTimer <= 0) {
      this.thunderTimer = 100 + Math.floor(Math.random() * 400);
      this.renderer.flash = 1;
      this.lightningEl.style.transition = 'none';
      this.lightningEl.style.opacity = '0.35';
      requestAnimationFrame(() => { this.lightningEl.style.transition = 'opacity 0.6s'; this.lightningEl.style.opacity = '0'; });
      setTimeout(() => sfx.explode({ gain: 0.5, pan: (Math.random() - 0.5) }), 300 + Math.random() * 1500);
    }
    // Holding right click repeats placing / keeps eating.
    if (this.mouse[2] && active) {
      if (this.eating > 0) {
        const held = p.held;
        const food = held ? itemDef(held.id)?.food : undefined;
        if (!held || !food) this.eating = 0;
        else {
          this.eating++;
          if (this.eating % 4 === 0) sfx.eat();
          if (this.eating > 32) {
            const eff = itemDef(held.id)?.effect;
            const bowl = held.id === I.mushroom_stew;
            if (p.eat(held) && !p.creative) {
              held.count--;
              if (held.count <= 0) p.inv.slots[p.selected] = bowl ? { id: I.bowl, count: 1 } : null;
            }
            if (eff === 'regen') p.regenTicks = 100;
            this.eating = 0;
          }
        }
      } else if (++this.useCooldown >= 4) {
        this.useCooldown = 0;
        this.use();
      }
    }
    w.tick(p.body.pos[0], p.body.pos[1], p.body.pos[2], true);
    ents.tick();
    // Autosave every 30 seconds.
    if (++this.autosave >= 600) { this.autosave = 0; this.save(); }
  }

  private wasInWater = false;

  private soundBelow() {
    const p = this.player.body.pos;
    const id = this.world!.getBlock(Math.floor(p[0]), Math.floor(p[1] - 0.2), Math.floor(p[2]));
    return BLOCKS[id].sound;
  }

  private updateDebug(): void {
    const w = this.world!, p = this.player;
    const [x, y, z] = p.body.pos;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const c = w.getChunk(bx >> 4, bz >> 4);
    const biome = c ? BIOME_NAMES[c.biomes[(bx & 15) + (bz & 15) * 16]] : '?';
    const facing = ['north (-z)', 'west (-x)', 'south (+z)', 'east (+x)'][p.quadrant()];
    const lines = [
      `Blockhaven 0.1   ${this.fps} fps`,
      `XYZ ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}`,
      `Block ${bx} ${by} ${bz}   Chunk ${bx >> 4} ${bz >> 4}`,
      `Facing ${facing}`,
      `Biome ${biome}`,
      `Light sky ${w.getSky(bx, by + 1, bz)}  block ${w.getBlockLight(bx, by + 1, bz)}`,
      `Chunks ${w.chunks.size}  meshes ${this.renderer.meshCount}  queue ${w.pendingWork}`,
      `Entities ${this.entities!.list.length}   Time ${w.time}`,
      `Draw calls ${this.renderer.gl.info.render.calls}   Tris ${this.renderer.gl.info.render.triangles}`,
    ];
    if (this.target) lines.push(`Looking at ${BLOCKS[this.target.id].name} (${this.target.pos.join(', ')})`);
    this.debugEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }
}

/** Find a dry-land spawn column near the origin. */
function findLand(gen: WorldGen): [number, number] {
  const friendly = new Set<number>([BIOME.plains, BIOME.forest, BIOME.birch_forest]);
  for (let r = 0; r < 3000; r += 16) {
    const steps = Math.max(1, Math.floor((r * 2 * Math.PI) / 16));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      const col = gen.column(x, z);
      if (col.height > SEA_LEVEL + 1 && friendly.has(col.biome)) return [x, z];
    }
  }
  for (let r = 0; r < 2000; r += 16) {
    const steps = Math.max(1, Math.floor((r * 2 * Math.PI) / 16));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      const col = gen.column(x, z);
      if (col.height > SEA_LEVEL + 1 && col.biome !== BIOME.ocean && col.biome !== BIOME.beach && col.biome !== BIOME.mountains) return [x, z];
    }
  }
  return [0, 0];
}
