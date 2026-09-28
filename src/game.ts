// Ties everything together: the main loop, player control, mining and
// placing, interactions, commands, saving, and the title screen flyover.

import * as THREE from 'three';
import { audioLevel, initAudio, setCave, setMusicVolume, setVolume, sfx, spatial } from './audio';
import { Music, type Mood } from './music';
import { Ambience } from './ambience';
import { B, BLOCKS, SOLID } from './blocks';
import { EntityManager, MOBS, Mob, TntEntity } from './entities/entities';
import { makeVehicle, type Vehicle } from './entities/vehicles';
import { createAvatar } from './entities/avatar';
import type { MobModel } from './entities/models';
import { I, itemDef } from './items';
import { craft } from './crafting';
import { hashString } from './noise';
import { collisionBox, raycast, stepBody, updateContacts } from './physics';
import { EYE_HEIGHT, Player, SNEAK_EYE_HEIGHT } from './player';
import { Renderer } from './render/renderer';
import { deleteWorld, download, exportWorld, importWorld, listWorlds, saveWorldMeta, savedChunkKeys, type WorldMeta } from './storage';
import type { Atlas } from './textures';
import { ContainerScreen } from './ui/containers';
import { Hud } from './ui/hud';
import { TouchControls, isTouchDevice } from './ui/touch';
import { Menus, loadSettings, type Settings } from './ui/menus';
import { SEA_LEVEL } from './world/chunk';
import { WorkerPool } from './world/pool';
import { BIOME, BIOME_NAMES, WorldGen } from './world/worldgen';
import { HOLLOW_ARRIVAL, HOLLOW_TOP } from './world/hollowgen';
import { World } from './world/world';
import { Actions } from './game/actions';
import { Chat } from './game/chat';
import { runCommand } from './game/commands';
import { EditHistory } from './game/history';
import { Input } from './game/input';
import { Signs } from './game/signs';
import { Waypoints } from './game/waypoints';
import { Raids } from './game/raids';
import { MapStore } from './game/maps';
import { FrameItems } from './game/frames';
import { Instruments } from './ui/instruments';
import { nearestStructure } from './world/structures';
import { GuestSession, HostSession, type Welcome } from './net/session';
import { answerInvite, type Link } from './net/peer';
import { ShareScreens } from './ui/share';
import { glideStep, wornGlider } from './game/glide';
import type { Difficulty } from './player';
import { WorldMap } from './ui/map';

const TICK = 1 / 20;
const DEATH_MESSAGES: Record<string, string> = {
  fall: 'You hit the ground too hard.',
  poison: 'Poison got the better of you.',
  bee: 'You angered the bees.',
  raider: 'A raider brought you down.',
  colossus: 'The Hollow Colossus crushed you.',
  glide: 'You flew into something too fast.',
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
  zombie: 'A zombie got you.',
  skeleton: 'A skeleton shot you.',
  witch: 'A witch’s potion got you.',
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
  astral: ['Stargazer', 'Open an Astral Gate'],
  hollow: ['Beyond the stars', 'Step into the Hollow'],
  colossus: ['Giant slayer', 'Defeat the Hollow Colossus'],
  glide: ['On the wind', 'Glide a hundred blocks'],
  map: ['Cartographer', 'Draw a map of where you are'],
  treasure: ['X marks the spot', 'Dig up buried treasure'],
  named: ['What’s in a name', 'Name a creature with a name tag'],
  trade: ['Fair deal', 'Trade with a villager'],
  tame: ['Best friends', 'Tame a fox or a mossback'],
  brew: ['Local brewery', 'Brew a potion'],
  hero: ['Hero of the village', 'Beat back a raid'],
};

type Mode = 'title' | 'loading' | 'playing';
export type Dimension = 'overworld' | 'ember' | 'hollow';

interface DimState { blockEntities?: unknown; entities?: unknown; spawned?: string[] }
type SaveMeta = WorldMeta & {
  entities?: unknown;
  weather?: World['weather'];
  weatherTimer?: number;
  dimension?: Dimension;
  dims?: Partial<Record<Dimension, DimState>>;
  /** The Hollow Colossus has been beaten (it doesn't come back). */
  colossusDefeated?: boolean;
  waypoints?: unknown;
  maps?: unknown;
  day?: number;
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

  readonly input: Input;
  readonly actions: Actions;
  readonly signs: Signs;
  readonly chat: Chat;
  readonly history: EditHistory;
  readonly waypoints = new Waypoints();
  /** Paper maps made in this world. */
  readonly maps = new MapStore();
  private frameItems = new FrameItems(this);
  private instruments!: Instruments;
  private spyEl!: HTMLElement;
  /** Looking through a spyglass. */
  spyglass = false;
  private mapTimer = 0;
  /** A shared world: this game is the host, or a guest in someone else's. */
  net: HostSession | GuestSession | null = null;
  /** The Invite a friend and Join a friend screens. */
  readonly share: ShareScreens;
  readonly music = new Music();
  readonly ambience = new Ambience();
  private soundTimer = 0;
  raids!: Raids;
  readonly map: WorldMap;
  /** 0 first person, 1 behind, 2 in front. */
  perspective = 0;
  /** What the player is riding (a boat, a minecart or a saddled mossback). */
  riding: Vehicle | Mob | null = null;
  private wasSneaking = false;
  private acc = 0;
  private last = performance.now();
  private fps = 0;
  private frames = 0;
  private fpsTime = 0;
  private stepDist = 0;
  private prevPos: [number, number, number] = [0, 0, 0];
  private titleAngle = 0;
  private debug = false;
  hudHidden = false;
  readonly touchMode = isTouchDevice();
  touch: TouchControls | null = null;
  private autosave = 0;
  private fovCurrent = 70;
  readonly canvas: HTMLCanvasElement;
  private debugEl: HTMLElement;
  private resumeEl: HTMLElement;
  private vignette: HTMLElement;
  private waterOverlay: HTMLElement;
  readonly fadeEl: HTMLElement;
  private toastEl: HTMLElement;
  private saveEl: HTMLElement;
  private bossEl: HTMLElement;
  private bossKey = '';
  private saveFailed = false;
  private toastTimer = 0;
  private loadStart = 0;
  private achEl!: HTMLElement;
  private achQueue: string[] = [];
  private achTimer = 0;
  private lightningEl!: HTMLElement;
  private thunderTimer = 200;

  constructor(readonly root: HTMLElement, atlas: Atlas) {
    this.canvas = root.querySelector('canvas#game')!;
    this.input = new Input(this);
    this.actions = new Actions(this);
    this.signs = new Signs(this);
    this.history = new EditHistory(this);
    this.chat = new Chat(this, root);
    this.map = new WorldMap(this, root);
    this.map.setAtlas(atlas);
    this.renderer = new Renderer(this.canvas, atlas);
    this.settings = loadSettings();
    if (this.touchMode) {
      let saved = false;
      try { saved = !!localStorage.getItem('blockhaven.settings'); } catch { /* no storage */ }
      // Phones: lighter graphics until the player chooses otherwise.
      if (!saved) Object.assign(this.settings, { renderDistance: 6, shadows: false, post: false, sensitivity: 1 });
      document.body.classList.add('touch');
    }
    this.hud = new Hud(root);
    this.instruments = new Instruments(root);
    this.spyEl = document.createElement('div');
    this.spyEl.id = 'spyglass';
    root.appendChild(this.spyEl);
    this.raids = new Raids(this, root);
    if (this.touchMode) {
      this.touch = new TouchControls(root, {
        mineStart: () => { if (!this.input.controlling) return; this.input.mouse[0] = true; this.actions.attack(); },
        mineEnd: () => { this.input.mouse[0] = false; this.actions.breakProgress = 0; this.actions.breakPos = null; },
        useStart: () => { if (!this.input.controlling) return; this.input.mouse[2] = true; this.actions.useCooldown = 0; this.actions.use(); },
        useEnd: () => { this.input.mouse[2] = false; this.actions.eating = 0; this.actions.releaseBow(); },
        jumpStart: () => this.input.jumpPressed(),
        inventory: () => { if (this.input.controlling && this.player.alive) this.openInventory(); },
        chat: () => this.chat.open('/'),
        pause: () => { if (this.mode === 'playing') this.menus.show('pause'); },
        drop: () => this.actions.dropHeld(false),
      });
      this.hud.enableTouch((i) => { this.player.selected = i; });
    }
    this.hud.setVisible(false);
    this.containers = new ContainerScreen(root, this.player);
    this.containers.onClose = () => this.input.lockPointer();
    this.containers.onDrop = (s) => this.actions.throwStack(s);
    this.menus = new Menus(root, {
      play: (w) => this.play(w),
      create: (name, seed, gm, opts) => this.createWorld(name, seed, gm, opts),
      difficulty: (next) => {
        const order: Difficulty[] = ['peaceful', 'easy', 'normal', 'hard'];
        if (next) this.setDifficulty(order[(order.indexOf(this.player.difficulty) + 1) % order.length]);
        const d = this.player.difficulty;
        return d[0].toUpperCase() + d.slice(1);
      },
      progress: () => this.progress(),
      resume: () => { this.menus.show(null); this.input.lockPointer(); },
      saveAndQuit: () => this.quitToTitle(),
      respawn: () => this.respawn(),
      settingsChanged: (s) => this.applySettings(s),
      exportCurrent: async () => {
        if (!this.meta) return;
        await this.save();
        try { const { blob, name } = await exportWorld(this.meta.id); download(blob, name); this.toast(`Backup saved as ${name}`, 4); }
        catch (e) { this.toast(`Couldn’t export: ${(e as Error).message}`); }
      },
    }, this.settings);
    this.share = new ShareScreens(this, this.menus);

    this.debugEl = root.querySelector('#debug')!;
    this.resumeEl = root.querySelector('#resume')!;
    this.vignette = root.querySelector('#vignette')!;
    this.waterOverlay = root.querySelector('#water-overlay')!;
    this.fadeEl = root.querySelector('#fade')!;
    this.toastEl = root.querySelector('#toast')!;
    this.saveEl = document.createElement('div');
    this.saveEl.id = 'saving';
    this.saveEl.textContent = 'Saving…';
    root.appendChild(this.saveEl);

    this.bossEl = document.createElement('div');
    this.bossEl.id = 'bossbar';
    this.bossEl.setAttribute('role', 'status');
    this.bossEl.innerHTML = '<span>The Hollow Colossus</span><div class="track"><i></i></div>';
    root.appendChild(this.bossEl);
    this.achEl = document.createElement('div');
    this.achEl.id = 'achievement';
    root.appendChild(this.achEl);
    this.lightningEl = document.createElement('div');
    this.lightningEl.id = 'lightning';
    root.appendChild(this.lightningEl);
    this.applySettings(this.settings);
    this.input.bind();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    window.addEventListener('beforeunload', () => { this.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    this.startTitle();
    requestAnimationFrame((t) => this.frame(t));
    (window as unknown as { blockhaven: Game }).blockhaven = this;
  }

  // ---------- Setup ----------
  applySettings(s: Settings): void {
    this.renderer.renderDistance = s.renderDistance;
    this.renderer.fancy = s.fancy;
    this.renderer.shadows = s.shadows;
    this.renderer.post = s.post;
    this.renderer.uniforms.uGamma.value = s.brightness;
    document.documentElement.style.setProperty('--ui', String(s.uiScale));
    setVolume(s.volume);
    setMusicVolume(s.music);
    this.music.setEnabled(s.music > 0);
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
    const storeId = dim === 'overworld' ? meta.id : meta.id + '~' + dim;
    const state = dimState(meta, dim);
    return (meta.id === '__title' ? Promise.resolve(new Set<string>()) : savedChunkKeys(storeId).catch(() => new Set<string>())).then((keys) => {
      const world = new World(storeId, meta.seed, this.pool!, keys);
      world.dimension = dim;
      world.spawnedChunks = new Set(state.spawned ?? []);
      world.time = meta.time;
      world.day = (meta as SaveMeta).day ?? 0;
      world.onSubMesh = (cx, sy, cz, m) => this.renderer.setSubMesh(cx, sy, cz, m);
      world.onChunkUnload = (cx, cz) => this.renderer.removeChunk(cx, cz);
      world.onDrop = (x, y, z, s) => this.entities?.dropItem(x, y, z, s);
      world.onEvent = (kind, x, y, z, id) => {
        const p = this.player.body.pos;
        const sp = spatial(p[0], p[1] + 1.6, p[2], this.player.yaw, x + 0.5, y + 0.5, z + 0.5);
        // An anchor stone bursts when it's broken.
        if (kind === 'break' && id === B.anchor_stone) this.entities?.explode(x + 0.5, y + 0.5, z + 0.5, 3);
        if (kind === 'fizz') sfx.fizz(sp);
        else if (kind === 'piston') sfx.piston(id === 1, sp);
        else if (kind === 'brewed') { sfx.brewed(sp); if (Math.hypot(x - p[0], z - p[2]) < 12) this.player.achieve('brew'); }
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
      // Pistons shove whatever stands where the blocks moved; hoppers take items dropped on them.
      world.onPush = (min, max, d) => {
        const bodies = [this.player.body, ...ents.mobs().map((m) => m.body), ...ents.vehicles().map((v) => v.body)];
        for (const b of bodies) {
          const a = b.aabb();
          if (a.max[0] > min[0] && a.min[0] < max[0] && a.max[1] > min[1] && a.min[1] < max[1] && a.max[2] > min[2] && a.min[2] < max[2]) {
            b.pos[0] += d[0] * 1.01; b.pos[1] += d[1] * 1.01 + (d[1] === 0 ? 0 : 0.01); b.pos[2] += d[2] * 1.01;
          }
        }
      };
      world.collectItems = (x, y, z, take) => ents.collectInto(x, y, z, take);
      ents.onMobKilled = (mob, byPlayer) => { if (!byPlayer) return; this.player.stat('kills'); if (mob.spec.hostile) this.player.achieve('hunter'); };
      ents.onBred = () => this.player.achieve('rancher');
      ents.onBossDefeated = (mob) => this.colossusDefeated(mob);
      ents.onProjectileHit = (proj, mob) => {
        const pp = this.player.body.pos;
        if (proj.kind === 'arrow' && Math.hypot(mob.body.pos[0] - pp[0], mob.body.pos[2] - pp[2]) >= 20) this.player.achieve('archer');
      };
    });
  }

  private disposeWorld(): void {
    this.signs.clear();
    this.frameItems.clear();
    this.history.clear();
    this.riding = null;
    this.map.clear();
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
    this.menus.setGuest(false);
    this.hud.setVisible(false);
    this.menus.show('title');
    const gen = new WorldGen(hashString('blockhaven-title'));
    const [sx, sz] = findLand(gen);
    await this.startWorld({ id: '__title', name: 'title', seed: hashString('blockhaven-title'), seedText: '', gamemode: 'creative', created: 0, lastPlayed: 0, time: 4200 });
    this.player = new Player(sx + 0.5, gen.column(sx, sz).height + 1, sz + 0.5);
    this.entities!.player = this.player;
  }

  private async createWorld(name: string, seedText: string, gamemode: 'survival' | 'creative', opts: { difficulty?: Difficulty; keepInventory?: boolean } = {}): Promise<void> {
    const seedStr = seedText || String(Math.floor(Math.random() * 1e12));
    const seed = /^-?\d+$/.test(seedStr) ? (Number(seedStr) >>> 0) || hashString(seedStr) : hashString(seedStr);
    const meta: WorldMeta = { id: 'w' + Date.now().toString(36), name, seed, seedText: seedStr, gamemode, created: Date.now(), lastPlayed: Date.now(), time: 1000, difficulty: opts.difficulty ?? 'normal', keepInventory: opts.keepInventory ?? false };
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
    this.waypoints.load((meta as SaveMeta).waypoints);
    this.maps.load((meta as SaveMeta).maps);
    this.raids.stop();
    if (meta.player) p.load(meta.player);
    else {
      const gen = new WorldGen(meta.seed);
      const [sx, sz] = findLand(gen);
      p.body.pos = [sx + 0.5, gen.column(sx, sz).height + 1.2, sz + 0.5];
      p.spawn = [...p.body.pos];
      p.needsSurface = true;
      if (!p.creative) this.toast(this.touchMode ? 'Hold Mine on a tree to get started. Tap ▦ for your inventory.' : 'Punch a tree to get started. Press E for your inventory.');
    }
    p.onDeath = (src) => this.onDeath(src);
    p.difficulty = meta.difficulty ?? 'normal';
    p.onBlock = (amount) => {
      sfx.shieldBlock();
      const sh = p.held;
      if (sh?.id === I.shield && !p.creative) {
        sh.damage = (sh.damage ?? 0) + Math.max(1, Math.ceil(amount));
        if (sh.damage >= (itemDef(sh.id)?.tool?.durability ?? 336)) { p.inv.slots[p.selected] = null; sfx.breakBlock('wood'); }
      }
    };
    p.onAchievement = (id) => this.achQueue.push(id);
    p.onHurt = () => { this.vignette.classList.add('hurt'); setTimeout(() => this.vignette.classList.remove('hurt'), 250); };
    this.player = p;
    this.containers = this.rebuildContainers();
    this.entities!.player = p;
    this.entities!.peaceful = p.difficulty === 'peaceful';
    const wm = meta as SaveMeta;
    if (wm.weather) { this.world!.weather = wm.weather; this.world!.weatherTimer = wm.weatherTimer ?? 12000; }
    this.prevPos = [...p.body.pos];
  }

  /**
   * Step through a gate into another dimension. Ember Gates link matching spots (distances there are 1/8);
   * the Astral Gate always opens on the Hollow's rim, and the way home from the Hollow (or dying
   * anywhere but the overworld) lands you at your spawn point.
   */
  async travel(to: Dimension, opts: { toSpawn?: boolean } = {}): Promise<void> {
    if (!this.meta || !this.world) return;
    const p = this.player;
    // Friends can't follow through gates yet.
    if (this.net && !opts.toSpawn) {
      p.portalCooldown = 100;
      this.toast(this.net instanceof GuestSession ? 'Gates only work for the host in a shared world.' : 'Your friends can’t follow you through gates yet. Close the world to friends first.', 4);
      return;
    }
    const from = this.world.dimension;
    await this.save();
    const home = to === 'overworld' && (from === 'hollow' || opts.toSpawn);
    const scale = to === 'ember' ? 1 / 8 : 8;
    const tx = Math.floor(p.body.pos[0] * scale), tz = Math.floor(p.body.pos[2] * scale);
    const weather = this.world.weather, weatherTimer = this.world.weatherTimer;
    this.mode = 'loading';
    this.containers.close();
    document.exitPointerLock?.();
    this.menus.setLoading(to === 'ember' ? 'Descending into the Emberdeep…' : to === 'hollow' ? 'Stepping through the Astral Gate…' : home ? 'Returning home…' : 'Returning to the surface…');
    this.menus.show('loading');
    this.loadStart = performance.now();
    await this.startWorld(this.meta, to);
    this.world!.weather = weather; this.world!.weatherTimer = weatherTimer;
    this.entities!.player = p;
    if (to === 'hollow') p.body.pos = [...HOLLOW_ARRIVAL];
    else if (home) { p.body.pos = [...p.spawn]; p.arriveAtSpawn = true; }
    else { p.body.pos = [tx + 0.5, to === 'ember' ? 64 : 90, tz + 0.5]; p.portalArrival = true; }
    p.body.vel = [0, 0, 0];
    p.body.fallDistance = 0;
    p.portalCooldown = 200;
    this.prevPos = [...p.body.pos];
    if (to === 'ember') p.achieve('ember');
    if (to === 'hollow') p.achieve('hollow');
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
    c.onClose = () => this.input.lockPointer();
    c.onDrop = (s) => this.actions.throwStack(s);
    c.onSmeltTaken = (s) => {
      const per = s.id === I.iron_ingot || s.id === I.gold_ingot ? 0.7 : s.id === B.glass || s.id === B.stone ? 0.1 : 0.35;
      const xp = Math.floor(per * s.count + Math.random());
      if (xp > 0) p.addXp(xp);
      if (s.id === I.iron_ingot) p.achieve('iron');
    };
    c.onCrafted = (s) => {
      p.stat('crafted', s.count);
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
    if (p.arriveAtSpawn && this.world) {
      // Home from another dimension: stand on the spawn point (or on top of whatever's there now).
      p.arriveAtSpawn = false;
      const [x, y, z] = p.body.pos.map(Math.floor);
      if (SOLID[this.world.getBlock(x, y, z)] || SOLID[this.world.getBlock(x, y + 1, z)]) p.body.pos[1] = this.world.surfaceY(x, z);
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
    this.input.lockPointer();
  }

  async save(): Promise<void> {
    // A guest's world belongs to the host.
    if (this.net instanceof GuestSession) return;
    if (!this.world || !this.meta || this.meta.id === '__title' || this.mode !== 'playing') return;
    const prev = this.meta as SaveMeta;
    const meta: SaveMeta = {
      ...prev,
      lastPlayed: Date.now(),
      time: this.world.time,
      day: this.world.day,
      maps: this.maps.serialize(),
      player: this.player.serialize(),
      weather: this.world.weather,
      weatherTimer: this.world.weatherTimer,
      dimension: this.dimension,
      waypoints: this.waypoints.serialize(),
      dims: {
        ...prev.dims,
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
    this.saveEl.classList.add('show');
    try {
      await Promise.all([saveWorldMeta(meta), this.world.saveAll()]);
      this.saveFailed = false;
    } catch (e) {
      console.warn('Save failed', e);
      // Say so once (not every autosave), so progress is never lost silently.
      if (!this.saveFailed) this.toast('Couldn’t save the world: the browser refused storage (private browsing or a full disk?). Export a backup from the pause menu.', 10);
      this.saveFailed = true;
    } finally {
      setTimeout(() => this.saveEl.classList.remove('show'), 600);
    }
  }

  private async quitToTitle(): Promise<void> {
    this.containers.close();
    await this.save();
    this.net?.close();
    this.net = null;
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

  /** A column well inside a biome: it and a ring of points `radius` away all share the biome. */
  findBiomeArea(biomes: number[], radius = 32, maxSlope = Infinity): [number, number, number] | null {
    if (!this.world) return null;
    const gen = new WorldGen(this.world.seed);
    // Score candidates by how many surrounding points share the biome and sit near the same height.
    let best: [number, number, number] | null = null, bestScore = -1;
    for (let r = 150; r < 8000; r += 48) for (let a = 0; a < 6.28; a += 0.2) {
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      const c = gen.column(x, z);
      if (!biomes.includes(c.biome)) continue;
      let score = 0;
      for (let k = 0; k < 8; k++) for (const f of [0.5, 1]) {
        const col = gen.column(x + Math.round(Math.cos(k * 0.785) * radius * f), z + Math.round(Math.sin(k * 0.785) * radius * f));
        if (biomes.includes(col.biome)) score++;
        if (Math.abs(col.height - c.height) <= maxSlope) score++;
      }
      if (score > bestScore) { bestScore = score; best = [x, c.height, z]; }
      if (score === 32) return best;
    }
    return best;
  }

  listWorlds(): Promise<WorldMeta[]> {
    return listWorlds();
  }

  toast(text: string, seconds = 5): void {
    this.toastEl.textContent = text;
    this.toastTimer = seconds;
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

  private onDeath(source: string): void {
    const p = this.player;
    p.stat('deaths');
    const keep = !!this.meta?.keepInventory;
    if (!p.creative && !keep) {
      // Everything you carried and wore spills out, with some of your experience.
      for (const inv of [p.inv, p.armor]) for (let i = 0; i < inv.size; i++) {
        const s = inv.slots[i];
        if (s) { this.entities?.dropItem(p.body.pos[0], p.body.pos[1] + 1, p.body.pos[2], s, 40, [(Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4]); inv.slots[i] = null; }
      }
      const xp = Math.min(100, p.xpLevel * 7);
      if (xp > 0) this.entities?.dropXp(p.body.pos[0], p.body.pos[1] + 1, p.body.pos[2], xp);
      p.xpLevel = 0; p.xpProgress = 0;
    }
    this.containers.close();
    document.exitPointerLock();
    this.waypoints.setDeath([...p.body.pos] as [number, number, number], this.dimension);
    this.menus.setDeathReason((DEATH_MESSAGES[source] ?? 'You died.') + (keep || p.creative ? ' You kept everything you were carrying.' : ` Your belongings are at ${p.body.pos.map((v) => Math.floor(v)).join(', ')}; it's marked on your screen and map.`));
    this.menus.show('death');
  }

  private respawn(): void {
    const p = this.player;
    p.alive = true;
    p.health = 20; p.food = 20; p.saturation = 5; p.air = 300; p.burning = 0; p.exhaustion = 0;
    // Spawn points are in the overworld.
    if (this.world && this.world.dimension !== 'overworld') { void this.travel('overworld', { toSpawn: true }); return; }
    p.body.pos = [...p.spawn];
    // Bed gone? fall back to the world spawn surface.
    const w = this.world!;
    const bx = Math.floor(p.spawn[0]), by = Math.floor(p.spawn[1]), bz = Math.floor(p.spawn[2]);
    if (w.isLoaded(bx, bz) && SOLID[w.getBlock(bx, by, bz)]) p.body.pos[1] = w.surfaceY(bx, bz);
    p.body.vel = [0, 0, 0];
    p.body.fallDistance = 0;
    this.prevPos = [...p.body.pos];
    this.menus.show(null);
    this.input.lockPointer();
  }

  // ---------- The Hollow Colossus ----------
  /** Wake the Colossus when you're in the Hollow and it hasn't been beaten. */
  private tickHollow(): void {
    const w = this.world!, ents = this.entities!;
    if (w.dimension !== 'hollow' || w.tickCount % 100 !== 0 || (this.meta as SaveMeta).colossusDefeated) return;
    // Count a boss that's still in its death throes, too (mobs() leaves those out).
    if (!w.isLoaded(0, 0) || ents.list.some((e) => e instanceof Mob && e.spec.boss && !e.dead)) return;
    const c = ents.spawnMob('colossus', 0.5, HOLLOW_TOP + 30, 0.5);
    c.orbit = Math.atan2(this.player.body.pos[2], this.player.body.pos[0]) + Math.PI;
    this.chat.say('Something vast stirs above the island…');
  }

  private colossusDefeated(mob: Mob): void {
    const w = this.world!, ents = this.entities!, p = this.player;
    (this.meta as SaveMeta).colossusDefeated = true;
    // The way home opens around the pillar at the island's heart.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) w.setBlock(dx, HOLLOW_TOP + 1, dz, B.astral_portal);
    ents.dropItem(0.5, HOLLOW_TOP + 3, 3.5, { id: I.glider, count: 1 }, 20, [0, 0.2, 0]);
    ents.dropXp(mob.body.pos[0], mob.body.pos[1], mob.body.pos[2], 300);
    p.achieve('colossus');
    sfx.fanfare();
    this.chat.say('The Colossus falls. A way home opens at the heart of the island, and something it guarded is left on the dais.');
    void this.save();
  }

  /** Tell the music, the ambience and the cave echo where you are. */
  private listen(): void {
    const w = this.world!, p = this.player;
    const [x, y, z] = [p.body.pos[0], p.body.pos[1] + p.eyeHeight, p.body.pos[2]].map(Math.floor);
    const c = w.getChunk(x >> 4, z >> 4);
    const biome = c ? c.biomes[(x & 15) + (z & 15) * 16] : BIOME.plains;
    const sky = w.getSky(x, y, z) / 15;
    const dim = w.dimension;
    // Enclosure: dark overhead and rock close by in most directions.
    let cave = 0;
    if (dim === 'ember') cave = 0.75;
    else if (dim === 'overworld' && sky < 0.3) {
      let hits = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        for (let k = 1; k <= 12; k++) if (SOLID[w.getBlock(x + dx * k, y + dy * k, z + dz * k)]) { hits++; break; }
      }
      cave = (1 - sky / 0.3) * (hits / 6);
    }
    let water = 0;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = 3 + (i % 3) * 3;
      const wx = Math.floor(x + Math.cos(a) * r), wz = Math.floor(z + Math.sin(a) * r);
      for (let dy = -4; dy <= 1; dy++) if (w.getBlock(wx, y + dy, wz) === B.water) { water++; break; }
    }
    const day = this.entities?.isDay() ?? true;
    this.ambience.set({ dimension: dim, biome, day, y, sky, cave, water: Math.min(1, water / 8), rain: this.renderer.rain, underwater: p.body.eyeInWater });
    setCave(cave);
    const snowy = biome === BIOME.taiga || (biome === BIOME.mountains && y > 110);
    const mood: Mood = dim === 'ember' ? 'ember' : dim === 'hollow' ? 'hollow' : cave > 0.5 ? 'cave' : snowy ? 'snow' : day ? 'day' : 'night';
    this.music.setMood(mood);
  }

  private updateBossBar(): void {
    const boss = this.mode === 'playing' && !this.hudHidden && this.world?.dimension === 'hollow' ? this.entities?.mobs().find((m) => m.spec.boss && m.deathTime === 0) : undefined;
    const near = boss && Math.hypot(boss.body.pos[0] - this.player.body.pos[0], boss.body.pos[2] - this.player.body.pos[2]) < 160;
    const key = near ? `${Math.round((boss.health / boss.spec.health) * 200)}|${!!boss.healFrom}` : '';
    if (key === this.bossKey) return;
    this.bossKey = key;
    this.bossEl.classList.toggle('show', !!near);
    if (!near) return;
    (this.bossEl.querySelector('i') as HTMLElement).style.width = `${(boss.health / boss.spec.health) * 100}%`;
    this.bossEl.classList.toggle('mending', !!boss.healFrom);
  }

  // ---------- Riding ----------
  mount(what: Vehicle | Mob): void {
    this.riding = what;
    const p = this.player;
    p.sprinting = false;
    p.flying = false;
    this.seatPlayer();
    this.prevPos = [...p.body.pos];
    this.toast(what instanceof Mob ? 'Look where you want to go; sprint to gallop, jump to leap. Sneak to get off.' : 'W and S to move, A and D to steer. Sneak to get off.', 3);
  }

  dismount(): void {
    const r = this.riding;
    if (!r) return;
    this.riding = null;
    r.ridden = false;
    // Step off to the side, clear of the vehicle.
    const p = this.player, w = this.world!, rp = r.body.pos;
    const side = r.body.width / 2 + 0.6;
    for (const a of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
      const yaw = r.yaw + a;
      const x = rp[0] - Math.sin(yaw) * side, z = rp[2] - Math.cos(yaw) * side;
      const y = Math.floor(rp[1] + 0.5);
      if (!SOLID[w.getBlock(Math.floor(x), y, Math.floor(z))] && !SOLID[w.getBlock(Math.floor(x), y + 1, Math.floor(z))]) {
        p.body.pos = [x, y, z];
        p.body.vel = [0, 0, 0];
        return;
      }
    }
    p.body.pos = [rp[0], rp[1] + r.body.height + 0.1, rp[2]];
  }

  /** Keep the player sitting on whatever they ride. */
  private seatPlayer(): void {
    const r = this.riding!, p = this.player;
    const seat = r instanceof Mob ? r.body.height * 0.72 : r.seat;
    p.body.pos = [r.body.pos[0], r.body.pos[1] + seat - 0.45, r.body.pos[2]];
    p.body.vel = [...r.body.vel] as [number, number, number];
    p.body.fallDistance = 0;
    p.body.onGround = true;
  }

  // ---------- Small actions used by input and the UI ----------
  /** Turn the view by yaw/pitch deltas (radians). */
  turn(dYaw: number, dPitch: number): void {
    const p = this.player;
    // Finer control while zoomed in.
    if (this.spyglass) { dYaw *= 0.2; dPitch *= 0.2; }
    p.yaw += dYaw;
    p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch + dPitch));
  }

  openInventory(): void {
    document.exitPointerLock();
    this.containers.show(this.player.creative ? 'creative' : 'player');
  }

  toggleDebug(): void { this.debug = !this.debug; this.debugEl.classList.toggle('show', this.debug); }
  toggleHud(): void { this.hudHidden = !this.hudHidden; this.hud.setVisible(!this.hudHidden); }

  /** Creative flight speed: scroll (while sprinting or holding Ctrl) to change it. */
  adjustFlySpeed(dir: number): void {
    const p = this.player;
    p.speed = Math.round(Math.max(0.25, Math.min(20, p.speed * (dir > 0 ? 1.25 : 0.8))) * 100) / 100;
    this.toast(`Flying speed ${p.speed}×`, 1.5);
  }

  /** First person, then behind, then in front. */
  cyclePerspective(): void {
    this.perspective = (this.perspective + 1) % 3;
  }

  private shotPending = false;
  /** Save a PNG of the next frame (the HUD's DOM overlay isn't included, only the world and hand). */
  screenshot(): void { this.shotPending = true; }
  private saveScreenshot(): void {
    this.shotPending = false;
    // Read the canvas right after rendering, before the browser clears the drawing buffer.
    this.canvas.toBlob((blob) => {
      if (!blob) { this.toast('Couldn’t capture a screenshot.'); return; }
      const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
      const name = `qubecraft-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.png`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      this.toast(`Screenshot saved as ${name}`, 3);
    }, 'image/png');
  }

  // ---------- Third-person avatar ----------
  avatar: MobModel | null = null;
  private avatarWalk = 0;
  private updateAvatar(alpha: number, dt: number): void {
    const show = this.perspective !== 0 && this.player.alive && this.mode === 'playing';
    if (!show) { if (this.avatar) this.avatar.root.visible = false; return; }
    if (!this.avatar) { this.avatar = createAvatar(); this.renderer.scene.add(this.avatar.root); }
    const a = this.avatar, p = this.player, parts = a.parts;
    a.root.visible = true;
    const x = this.prevPos[0] + (p.body.pos[0] - this.prevPos[0]) * alpha;
    const y = this.prevPos[1] + (p.body.pos[1] - this.prevPos[1]) * alpha;
    const z = this.prevPos[2] + (p.body.pos[2] - this.prevPos[2]) * alpha;
    a.root.position.set(x, y, z);
    a.root.rotation.y = p.yaw;
    const speed = Math.hypot(p.body.vel[0], p.body.vel[2]);
    const amp = Math.min(1, speed * 7) * (p.flying ? 0.25 : 1);
    this.avatarWalk += speed * dt * 70;
    const s = Math.sin(this.avatarWalk) * 0.8 * amp;
    parts.legL.rotation.x = s; parts.legR.rotation.x = -s;
    const swing = this.renderer.swingAmount();
    parts.armL.rotation.x = -s * 0.8;
    parts.armR.rotation.x = s * 0.8 - swing * 1.6;
    parts.head.rotation.x = p.pitch * 0.9;
    parts.body.rotation.x = p.sneaking ? 0.35 : 0;
    parts.body.position.y = p.sneaking ? -0.15 : 0;
    a.shadow.visible = p.body.onGround;
  }

  // ---------- Pass-throughs kept for scripts and tests ----------
  // ---------- Shared worlds ----------
  /** Open this world to a friend: an invite code, and a way to finish with their reply (resolves to their name). */
  async inviteFriend(): Promise<{ code: string; accept: (reply: string) => Promise<string> }> {
    if (!this.world || this.mode !== 'playing') throw new Error('Open a world first.');
    if (this.net instanceof GuestSession) throw new Error('You’re a guest in this world; only the host can invite people.');
    if (this.world.dimension !== 'overworld') throw new Error('Shared worlds are overworld only for now. Head back to the overworld first.');
    if (!this.net) this.net = new HostSession(this);
    return this.net.invite();
  }

  /** Join a friend's world: your reply code, and a promise that resolves once you're in. */
  async joinFriend(invite: string): Promise<{ code: string; joined: Promise<void> }> {
    const { code, link } = await answerInvite(invite);
    const joined = link.then((l) => new Promise<void>((resolve, reject) => {
      l.onClose = () => reject(new Error('The connection closed before the world arrived.'));
      l.onMessage = (m) => {
        if (m.op === 'bye') { reject(new Error(String(m.reason))); l.close(); return; }
        if (m.op === 'welcome') this.startGuest(l, m as unknown as Welcome).then(resolve, reject);
      };
      l.send({ op: 'hello', name: this.playerName, build: __BUILD_ID__ });
    }));
    return { code, joined };
  }

  private async startGuest(link: Link, w: Welcome): Promise<void> {
    if (this.mode === 'playing') await this.quitToTitle();
    const session = new GuestSession(this, link, w);
    this.net = session;
    session.onBye = (reason) => {
      if (this.net !== session) return;
      this.net = null;
      this.containers.close();
      document.exitPointerLock?.();
      void this.startTitle().then(() => this.toast(reason, 8));
    };
    this.menus.setGuest(true);
    const meta: WorldMeta = { id: 'guest', name: `${w.host}’s world`, seed: w.seed, seedText: '', gamemode: w.gamemode, created: Date.now(), lastPlayed: Date.now(), time: w.time };
    await this.play(meta);
    session.attach();
    const p = this.player;
    p.body.pos = [...w.spawn];
    p.spawn = [...w.spawn];
    p.needsSurface = true;
    this.prevPos = [...p.body.pos];
  }

  /** Walking into a one-block step with room above it: hop up. */
  private shouldAutoJump(forward: number, strafe: number): boolean {
    const w = this.world!, p = this.player, b = p.body;
    if (!b.onGround || p.flying || p.sneaking || b.inWater || this.riding || (forward <= 0 && strafe === 0)) return false;
    const sp = Math.hypot(b.vel[0], b.vel[2]);
    // Head the way you're pushing: your facing when standing still, else your motion.
    const fx = -Math.sin(p.yaw) * forward + Math.cos(p.yaw) * strafe, fz = -Math.cos(p.yaw) * forward - Math.sin(p.yaw) * strafe;
    const dl = Math.hypot(fx, fz);
    const [dx, dz] = sp > 0.03 ? [b.vel[0] / sp, b.vel[2] / sp] : [fx / (dl || 1), fz / (dl || 1)];
    const x = Math.floor(b.pos[0] + dx * 0.75), z = Math.floor(b.pos[2] + dz * 0.75), y = Math.floor(b.pos[1] + 0.01);
    const box = collisionBox(w.getBlock(x, y, z), w.getMeta(x, y, z));
    if (!box || box.max[1] <= 0.5 || box.max[1] > 1) return false;
    const clear = (cx: number, cy: number, cz: number) => !collisionBox(w.getBlock(cx, cy, cz), w.getMeta(cx, cy, cz));
    return clear(x, y + 1, z) && clear(x, y + 2, z) && clear(Math.floor(b.pos[0]), y + 2, Math.floor(b.pos[2]));
  }

  /** A map in your hand fills in around you; a treasure map is drawn the first time you look at it. */
  private heldMap(dt: number): void {
    const held = this.player.held, w = this.world;
    if (!held || !w || this.mode !== 'playing') return;
    if (held.id === I.treasure_map && held.map === undefined) {
      if (w.dimension !== 'overworld') return;
      const gen = new WorldGen(w.seed);
      const t = nearestStructure(gen, 'treasure', this.player.body.pos[0], this.player.body.pos[2], 12);
      if (!t) { this.toast('The map is too faded to read.'); held.id = I.empty_map; return; }
      held.map = this.maps.createTreasure(gen, t.x, t.z);
      return;
    }
    if (held.id !== I.filled_map || held.map === undefined || (this.mapTimer -= dt) > 0) return;
    this.mapTimer = 0.5;
    this.maps.explore(held.map, w, this.map, this.player.body.pos[0], this.player.body.pos[2]);
  }

  // ---------- Difficulty, rules and progress ----------
  setDifficulty(d: Difficulty): void {
    this.player.difficulty = d;
    if (this.meta) this.meta.difficulty = d;
    if (this.entities) this.entities.peaceful = d === 'peaceful';
    if (d === 'peaceful') this.raids.stop();
  }

  setKeepInventory(on: boolean): void { if (this.meta) this.meta.keepInventory = on; }

  private progress(): { achievements: { title: string; desc: string; done: boolean }[]; stats: [string, string][] } {
    const p = this.player, st = p.stats;
    const n = (k: string) => Math.floor(st[k] ?? 0).toLocaleString();
    const dist = (k: string) => { const m = st[k] ?? 0; return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`; };
    const secs = Math.floor((st.ticks ?? 0) / 20);
    const time = secs >= 3600 ? `${Math.floor(secs / 3600)} h ${Math.floor((secs % 3600) / 60)} min` : `${Math.floor(secs / 60)} min`;
    return {
      achievements: Object.entries(ACHIEVEMENTS).map(([id, [title, desc]]) => ({ title, desc, done: p.achievements.has(id) })),
      stats: [
        ['Time played', time], ['Blocks mined', n('mined')], ['Blocks placed', n('placed')], ['Items crafted', n('crafted')],
        ['Creatures defeated', n('kills')], ['Deaths', n('deaths')], ['Damage taken', `${Math.round(st.damageTaken ?? 0) / 2} hearts`],
        ['Food eaten', n('eaten')], ['Fish caught', n('fish')], ['Jumps', n('jumps')],
        ['Walked', dist('walked')], ['Swum', dist('swum')], ['Flown', dist('flown')], ['Glided', dist('glided')], ['Ridden', dist('ridden')],
        ['Level', String(p.xpLevel)],
      ],
    };
  }

  /** Your name in shared worlds. */
  get playerName(): string { return this.settings.name.trim() || 'Wanderer'; }
  /** Test hook: how loud the game is right now. */
  audioLevel = audioLevel;
  /** Test and command hook: build a vehicle by kind. */
  makeVehicle = makeVehicle;
  /** Block ids by name (so scripts don't hard-code numbers). */
  get ids(): Record<string, number> { return B; }
  /** Item ids by name. */
  get items(): Record<string, number> { return I; }
  readonly storage = { exportWorld, importWorld, deleteWorld };
  /** The crafting grid matcher (for scripts and tests). */
  readonly craft = craft;
  get target() { return this.actions.target; }
  get mouse() { return this.input.mouse; }
  get keys() { return this.input.keys; }
  get bobber() { return this.actions.bobber; }
  get cmdEl() { return this.chat.el; }
  attack(): void { this.actions.attack(); }
  use(): void { this.actions.use(); }
  releaseBow(): void { this.actions.releaseBow(); }
  say(text: string): void { this.chat.say(text); }
  runCommand(line: string): void { runCommand(this, line.startsWith('/') ? line : '/' + line); }

  // ---------- Loop ----------
  private lastDrawn = 0;
  private slowTime = 0;
  private fastTime = 0;
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    // Frame-rate cap: skip frames that come too soon (with a little slack for timer jitter).
    const cap = this.settings.fpsCap;
    if (cap > 0 && now - this.lastDrawn < 1000 / cap - 1) return;
    this.lastDrawn = now;
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.autoQuality(dt);
    this.last = now;
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) { this.fps = this.frames; this.frames = 0; this.fpsTime = 0; }

    this.music.update();
    this.ambience.update(dt);
    const w = this.world;
    if (!w) {
      this.renderer.renderFrame(dt, false, 1, false);
      return;
    }
    if (this.mode === 'title') {
      this.music.setMood('title');
      this.ambience.silence();
      this.titleFrame(dt);
      return;
    }
    if (this.mode === 'loading') {
      w.update(this.player.body.pos[0], this.player.body.pos[2], this.settings.renderDistance);
      const ready = this.nearbyReady(2);
      const secs = (performance.now() - this.loadStart) / 1000;
      this.menus.setLoading(`Building terrain… ${Math.min(99, Math.round(ready * 100))}%`);
      if (this.pool?.failed) {
        this.menus.showLoadError('The terrain generator couldn’t start. This usually means the game was updated while this tab was open. Reloading fixes it, and your worlds are safe.');
      } else if (secs > 15 && w.chunks.size === 0) {
        this.menus.showLoadError('No terrain has generated after 15 seconds. Reload the page to try again; your worlds are safe.');
      } else if (ready >= 1 || (secs > 25 && w.chunks.size > 0)) this.finishLoading();
      this.placeCamera(1);
      this.renderer.updateSky(w.time, this.renderer.camera.position);
      this.renderer.renderFrame(dt, false, 1, false);
      return;
    }

    const paused = this.menus.current === 'pause' || this.menus.current === 'settings' || this.menus.current === 'controls';
    if (!paused) {
      this.acc += dt;
      while (this.acc >= TICK) {
        this.acc -= TICK;
        this.tick();
      }
    }
    const alpha = paused ? 1 : this.acc / TICK;
    const input = this.input;
    input.pollGamepad(dt);
    if (input.controlling) this.turn(input.padLook[0], input.padLook[1]);
    if (this.touch) {
      this.touch.setVisible(input.controlling && this.player.alive && !this.hudHidden);
      const [dx, dy] = this.touch.takeLook();
      if (input.controlling) {
        const s = 0.0055 * this.settings.sensitivity;
        this.turn(-dx * s, -dy * s * (this.settings.invertY ? -1 : 1));
      }
    }
    // After Escape closes a screen the browser won't give the mouse back until you click
    // (Escape doesn't count as a gesture), so say so instead of looking frozen.
    const needClick = input.everLocked && !this.touchMode && !input.padActive && !input.locked && !this.containers.open && !this.menus.current
      && !this.chat.isOpen && !this.map.open && this.player.alive;
    this.resumeEl.classList.toggle('show', needClick);
    w.update(this.player.body.pos[0], this.player.body.pos[2], this.settings.renderDistance);
    this.placeCamera(alpha);
    this.actions.updateTarget();
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
    const held = this.player.held, heldId = held?.id ?? 0;
    this.renderer.setHeldItem(heldId, heldId === I.bow && this.actions.bowCharge > 8 ? 'pull' : held?.charged ? 'loaded' : this.player.blocking ? 'block' : '');
    this.renderer.nightVision = this.player.effects.has('night_vision') ? Math.min(1, (this.player.effects.get('night_vision')!.ticks) / 200) : 0;
    this.tickAchievements(dt);
    if (w.tickCount % 5 === 0) { this.signs.sync(); this.frameItems.sync(); }
    this.updateAvatar(alpha, dt);
    const handLight = this.entities!.lightAt(cam.x, cam.y, cam.z);
    const moving = Math.hypot(this.player.body.vel[0], this.player.body.vel[2]) > 0.02 && this.player.body.onGround && this.settings.viewBobbing;
    this.renderer.renderFrame(dt, moving && !this.settings.reduceMotion, handLight, !this.hudHidden && this.player.alive && this.perspective === 0);
    if (this.shotPending) this.saveScreenshot();
    this.hud.update(this.player, dt);
    this.hud.updateInfo(this, dt);
    this.heldMap(dt);
    this.instruments.update(this, dt);
    this.spyEl.classList.toggle('show', this.spyglass && this.player.alive);
    this.updateBossBar();
    this.net?.frame(dt);
    if ((this.soundTimer -= dt) <= 0) { this.soundTimer = 0.25; this.listen(); }
    this.map.frame(dt);
    if (this.containers.open && w.tickCount % 2 === 0) this.containers.render();
    if (this.toastTimer > 0) { this.toastTimer -= dt; this.toastEl.style.opacity = this.toastTimer > 0 ? '1' : '0'; }
    if (this.debug) this.updateDebug();
  }

  /**
   * Automatic quality: after about two seconds of slow frames (under ~45 fps), render at a lower
   * resolution, in steps down to 55%; after five seconds of fast ones, step back up.
   */
  private autoQuality(dt: number): void {
    const r = this.renderer;
    if (!this.settings.autoQuality || this.mode !== 'playing') { if (!this.settings.autoQuality && r.renderScale !== 1) r.setRenderScale(1); return; }
    const cap = this.settings.fpsCap || 1000;
    const slow = dt > 1 / Math.min(45, cap * 0.8), fast = dt < 1 / Math.min(70, cap * 0.95);
    this.slowTime = slow ? this.slowTime + dt : Math.max(0, this.slowTime - dt * 0.5);
    this.fastTime = fast ? this.fastTime + dt : 0;
    if (this.slowTime > 2 && r.renderScale > 0.56) { r.setRenderScale(Math.max(0.55, r.renderScale - 0.15)); this.slowTime = 0; this.fastTime = 0; }
    else if (this.fastTime > 5 && r.renderScale < 1) { r.setRenderScale(Math.min(1, r.renderScale + 0.15)); this.fastTime = 0; }
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
    const calm = this.settings.reduceMotion;
    const hurtTilt = p.hurtTime > 0 && !calm ? Math.sin((p.hurtTime / 10) * Math.PI) * 0.08 : 0;
    if (this.perspective === 0) cam.rotation.set(p.pitch, p.yaw, hurtTilt, 'YXZ');
    else {
      // Third person: pull the camera back (or out in front) along the view line, stopping short of walls.
      const front = this.perspective === 2;
      const d = p.lookDir(), sign = front ? 1 : -1;
      let dist = 4;
      const eye = [cam.position.x, cam.position.y, cam.position.z] as [number, number, number];
      const hit = this.world ? raycast(this.world, eye, [d[0] * sign, d[1] * sign, d[2] * sign], dist + 0.3) : null;
      if (hit) dist = Math.max(0.6, hit.dist - 0.3);
      cam.position.set(eye[0] + d[0] * sign * dist, eye[1] + d[1] * sign * dist, eye[2] + d[2] * sign * dist);
      cam.rotation.set(front ? -p.pitch : p.pitch, front ? p.yaw + Math.PI : p.yaw, hurtTilt, 'YXZ');
    }
    let fov = this.settings.fov;
    if (this.spyglass) fov = 12;
    if (p.sprinting && !calm) fov *= 1.12;
    if (p.flying && p.sprinting && !calm) fov *= 1.05;
    this.fovCurrent += (fov - this.fovCurrent) * 0.2;
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) { cam.fov = this.fovCurrent; cam.updateProjectionMatrix(); }
  }

  private tick(): void {
    const w = this.world!, p = this.player, ents = this.entities!;
    this.prevPos = [...p.body.pos];
    const active = this.input.controlling && p.alive;
    // Keys (rebindable), the touch stick and a gamepad all feed the same movement.
    // Ctrl sprints; R does too, for keyboards where Ctrl+Space is taken by the system
    // (on macOS it switches input source).
    const mv = this.input.movement();
    let { forward, strafe } = mv;
    let { jump } = mv;
    if (!jump && this.settings.autoJump && this.shouldAutoJump(forward, strafe)) jump = true;
    // A raised shield slows you to a walk.
    if (p.blocking) { forward *= 0.3; strafe *= 0.3; }
    p.sneaking = mv.sneak;
    if (mv.sprint && forward > 0) p.sprinting = true;
    // Bumping a wall ends a sprint on foot; in flight only when it actually stops you, so grazing
    // a cliff face on the way up doesn't make the view pulse.
    const blocked = p.body.collidedH && (!p.flying || Math.hypot(p.body.vel[0], p.body.vel[2]) < 0.1);
    if (forward <= 0 || (p.sneaking && !p.flying) || (p.food <= 6 && !p.creative) || blocked) { p.sprinting = false; if (forward <= 0) this.input.sprintLatch = false; }
    if (!p.creative) p.flying = false;
    updateContacts(w, p.body, p.eyeHeight);
    const wasOnGround = p.body.onGround;
    if (p.blocking) p.sprinting = false;
    // Riding: the keys steer the mount; sneak climbs off.
    const ride = this.riding;
    if (ride && (ride.dead || !p.alive)) this.dismount();
    if (this.riding) {
      const inp = { forward, strafe, jump, yaw: p.yaw, sprint: mv.sprint };
      if (this.riding instanceof Mob) { this.riding.ridden = true; this.riding.riderInput = inp; }
      else { this.riding.ridden = true; this.riding.input = inp; }
      if (mv.sneak && !this.wasSneaking) this.dismount();
    }
    this.wasSneaking = mv.sneak;
    // Gliding: jump while falling with a glider on; landing, water or flying folds it away.
    if (!p.gliding && jump && !this.wasJump && p.alive && !this.riding && !p.flying && !p.body.onGround && !p.body.inWater && p.body.vel[1] < 0 && wornGlider(p)) {
      p.gliding = true; this.glideStart = [p.body.pos[0], p.body.pos[2]]; this.glideTicks = 0;
    }
    if (p.gliding && (!p.alive || this.riding || p.flying || p.body.onGround || p.body.inWater || !wornGlider(p))) p.gliding = false;
    this.wasJump = jump;
    if (p.gliding) {
      const crash = glideStep(w, p);
      if (crash > 0) p.damage(crash, 'glide');
      if (++this.glideTicks % 20 === 0 && !p.creative) {
        const g = wornGlider(p);
        if (g) g.damage = (g.damage ?? 0) + 1;
        if (!wornGlider(p)) this.toast('Your glider is worn through. Mend it with leather at a crafting table.', 4);
      }
      if (Math.hypot(p.body.pos[0] - this.glideStart[0], p.body.pos[2] - this.glideStart[1]) >= 100) p.achieve('glide');
      if (p.body.onGround || p.body.inWater) p.gliding = false;
    } else if (p.alive && !this.riding) {
      const speed = p.speed * (1 + 0.2 * p.effectLevel('swiftness')) * Math.max(0.2, 1 - 0.15 * p.effectLevel('slowness'));
      stepBody(w, p.body, { forward, strafe, jump, sneak: p.sneaking, sprint: p.sprinting, yaw: p.yaw, jumpBoost: p.effectLevel('leaping'), slowFall: p.effects.has('slow_falling') }, p.flying, speed);
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
    if (jump && wasOnGround && !p.body.onGround) { p.addExhaustion(p.sprinting ? 0.2 : 0.05); p.stat('jumps'); }
    if (moved > 0 && moved < 5) p.stat(this.riding ? 'ridden' : p.gliding ? 'glided' : p.flying ? 'flown' : p.body.inWater ? 'swum' : 'walked', moved);
    if (p.body.onGround && !p.sneaking) {
      this.stepDist += moved;
      if (this.stepDist > 1.7) { this.stepDist = 0; sfx.step(this.soundBelow()); }
    }
    if (!p.body.inWater && p.body.eyeInWater === false && this.wasInWater) sfx.splash();
    this.wasInWater = p.body.inWater;

    p.tickStats();
    // Regeneration, magma floors and fire.
    if (p.regenTicks > 0) { p.regenTicks--; if (p.regenTicks % 25 === 0) p.health = Math.min(20, p.health + 1); }
    if (p.alive && p.body.onGround && !p.sneaking && w.getBlock(Math.floor(p.body.pos[0]), Math.floor(p.body.pos[1] - 0.1), Math.floor(p.body.pos[2])) === B.magma && w.tickCount % 20 === 0) p.damage(1, 'fire');
    if (p.alive && p.body.inFire) p.burning = Math.max(p.burning, 80);
    if (p.alive && p.body.onCampfire && w.tickCount % 20 === 0) p.damage(1, 'fire');
    // Smoke rising from campfires nearby.
    if (w.tickCount % 3 === 0) for (const key of w.campfires) {
      const [cx, cy, cz] = key.split(',').map(Number);
      if (Math.abs(cx - p.body.pos[0]) > 40 || Math.abs(cz - p.body.pos[2]) > 40) continue;
      const g = 0.55 + Math.random() * 0.2;
      ents.particles.add(new THREE.Vector3(cx + 0.35 + Math.random() * 0.3, cy + 0.7, cz + 0.35 + Math.random() * 0.3), new THREE.Vector3((Math.random() - 0.5) * 0.01, 0.07, (Math.random() - 0.5) * 0.01), new THREE.Color(g, g, g), 70, 0.14, -0.0008);
    }
    // Standing in a gate for 4 seconds (instantly in Creative) takes you through.
    if (p.portalCooldown > 0 && !p.body.inPortal) p.portalCooldown = Math.max(0, p.portalCooldown - 1);
    if (p.body.inPortal && p.alive && p.portalCooldown === 0) {
      p.portalTime++;
      if (p.portalTime % 20 === 1) sfx.fizz({ gain: 0.3, pan: 0 });
      if (p.portalTime >= (p.creative ? 1 : 80)) { p.portalTime = 0; this.travel(w.dimension === 'ember' ? 'overworld' : 'ember'); return; }
    } else p.portalTime = 0;
    // The Astral Gate takes you straight through.
    if (p.body.inAstral && p.alive && p.portalCooldown === 0) { this.travel(w.dimension === 'hollow' ? 'overworld' : 'hollow'); return; }
    // Thunder and lightning.
    if (w.weather === 'thunder' && --this.thunderTimer <= 0) {
      this.thunderTimer = 100 + Math.floor(Math.random() * 400);
      this.renderer.flash = 1;
      this.lightningEl.style.transition = 'none';
      this.lightningEl.style.opacity = '0.35';
      requestAnimationFrame(() => { this.lightningEl.style.transition = 'opacity 0.6s'; this.lightningEl.style.opacity = '0'; });
      setTimeout(() => sfx.explode({ gain: 0.5, pan: (Math.random() - 0.5) }), 300 + Math.random() * 1500);
    }
    this.actions.tick(active);
    w.tick(p.body.pos[0], p.body.pos[1], p.body.pos[2], true);
    ents.tick();
    this.net?.tick();
    this.raids.tick();
    this.tickHollow();
    if (this.riding) this.seatPlayer();
    // Autosave every 30 seconds.
    if (++this.autosave >= 600) { this.autosave = 0; this.save(); }
  }

  private wasInWater = false;
  private wasJump = false;
  private glideStart: [number, number] = [0, 0];
  private glideTicks = 0;

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
      `QubeCraft 0.1   ${this.fps} fps`,
      `XYZ ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}`,
      `Block ${bx} ${by} ${bz}   Chunk ${bx >> 4} ${bz >> 4}`,
      `Facing ${facing}`,
      `Biome ${biome}`,
      `Light sky ${w.getSky(bx, by + 1, bz)}  block ${w.getBlockLight(bx, by + 1, bz)}`,
      `Chunks ${w.chunks.size}  meshes ${this.renderer.meshCount}  queue ${w.pendingWork}`,
      `Entities ${this.entities!.list.length}   Time ${w.time}`,
      `Draw calls ${this.renderer.gl.info.render.calls}   Tris ${this.renderer.gl.info.render.triangles}`,
    ];
    if (this.actions.target) lines.push(`Looking at ${BLOCKS[this.actions.target.id].name} (${this.actions.target.pos.join(', ')})`);
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
