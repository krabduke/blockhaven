// Village raids. Some nights, if you're in a village, a war horn sounds and
// raiders march on it in three waves. Beat every wave and you become a Village
// Hero (villagers charge less amber for a while). Lose every villager, or walk
// away, and the raid ends without you.

import { sfx } from '../audio';
import type { Mob } from '../entities/entities';
import { I } from '../items';
import { nearestVillage } from '../world/villages';
import { WorldGen } from '../world/worldgen';
import type { Game } from '../game';

const WAVES = 3;
/** Ticks of calm between waves. */
const WAVE_GAP = 200;
/** How close to a village centre counts as being in it. */
const VILLAGE_RADIUS = 48;
const HERO_TICKS = 20 * 60 * 20;

interface Raid {
  cx: number;
  cz: number;
  wave: number;
  raiders: Mob[];
  waveSize: number;
  /** Ticks until the next wave marches in (0 while one is under way). */
  gap: number;
  /** Ticks into the current wave. */
  age: number;
  /** Ticks the player has been away from the village. */
  away: number;
}

export class Raids {
  active: Raid | null = null;
  private el: HTMLElement;
  private label: HTMLElement;
  private fill: HTMLElement;
  private checkedTonight = false;
  private gen: WorldGen | null = null;
  private banner = 0;

  constructor(private g: Game, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'raidbar';
    this.el.setAttribute('role', 'status');
    this.el.innerHTML = '<span></span><div class="track"><i></i></div>';
    this.label = this.el.querySelector('span')!;
    this.fill = this.el.querySelector('i')!;
    parent.appendChild(this.el);
  }

  private village(x: number, z: number): { cx: number; cz: number } | null {
    const w = this.g.world;
    if (!w || w.dimension !== 'overworld') return null;
    if (!this.gen || this.gen.seed !== w.seed) this.gen = new WorldGen(w.seed);
    const v = nearestVillage(this.gen, x, z);
    return v && Math.hypot(v.cx - x, v.cz - z) < VILLAGE_RADIUS ? { cx: v.cx, cz: v.cz } : null;
  }

  private villagers(r: Raid): number {
    return this.g.entities!.mobs().filter((m) => m.spec.trader && m.health > 0 && Math.hypot(m.body.pos[0] - r.cx, m.body.pos[2] - r.cz) < 64).length;
  }

  /** Begin a raid on the village you're in. Returns why not, or null when it started. */
  start(): string | null {
    const p = this.g.player.body.pos;
    if (this.active) return 'A raid is already under way.';
    const v = this.village(p[0], p[2]);
    if (!v) return 'You need to be in a village.';
    this.active = { cx: v.cx, cz: v.cz, wave: 0, raiders: [], waveSize: 0, gap: 60, age: 0, away: 0 };
    sfx.warHorn();
    this.g.chat.say('A war horn sounds in the distance. Raiders are coming!');
    return null;
  }

  /** Call off the raid; remaining raiders scatter. */
  stop(msg?: string): void {
    const r = this.active;
    if (!r) return;
    for (const m of r.raiders) m.rally = null;
    this.active = null;
    if (msg) this.g.chat.say(msg);
    this.banner = 0;
  }

  private spawnWave(r: Raid): void {
    const w = this.g.world!, ents = this.g.entities!;
    r.wave++;
    r.age = 0;
    const n = 2 + r.wave * 2;
    r.raiders = [];
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      // They come from one side, fanned out a little.
      for (let tries = 0; tries < 8; tries++) {
        const a = base + (Math.random() - 0.5) * 1.2 + tries * 0.8;
        const d = 26 + Math.random() * 8 - tries * 2;
        const x = Math.floor(r.cx + Math.cos(a) * d), z = Math.floor(r.cz + Math.sin(a) * d);
        if (!w.getChunk(x >> 4, z >> 4)) continue;
        const y = w.surfaceY(x, z);
        if (w.getBlock(x, y - 1, z) === this.g.ids.water) continue;
        const m = ents.spawnMob('raider', x + 0.5, y, z + 0.5);
        m.rally = [r.cx, r.cz];
        if (r.wave === WAVES && i === 0) { m.captain = true; m.health = 40; }
        r.raiders.push(m);
        break;
      }
    }
    r.waveSize = r.raiders.length;
    sfx.warHorn();
    this.g.chat.say(r.wave === WAVES ? `The final wave is here, led by a raid captain!` : `Wave ${r.wave} of ${WAVES}: raiders sighted!`);
  }

  private victory(): void {
    const p = this.g.player, ents = this.g.entities!;
    this.active = null;
    sfx.fanfare();
    p.addEffect('hero', HERO_TICKS);
    p.achieve('hero');
    const pp = p.body.pos;
    ents.dropItem(pp[0], pp[1] + 0.5, pp[2], { id: I.amber, count: 4 + Math.floor(Math.random() * 5) });
    ents.dropItem(pp[0], pp[1] + 0.5, pp[2], { id: I.golden_apple, count: 1 });
    this.g.chat.say(`The raid is beaten and the village is safe. You're a Village Hero: trades cost less for 20 minutes.`);
    this.banner = 100;
  }

  /** Once a game tick. */
  tick(): void {
    const w = this.g.world, p = this.g.player;
    if (!w || !this.g.entities) return;
    // Once a night, at dusk: maybe a raid, if you're in a village and not in Creative.
    const t = w.time;
    if (t < 13000 || t > 13200) this.checkedTonight = false;
    else if (!this.checkedTonight) {
      this.checkedTonight = true;
      if (!this.active && !p.creative && p.alive && Math.random() < 0.3) this.start();
    }
    const r = this.active;
    if (!r) { this.banner = Math.max(0, this.banner - 1); this.render(); return; }
    if (w.dimension !== 'overworld') { this.stop(); return; }
    const pp = p.body.pos;
    r.away = Math.hypot(pp[0] - r.cx, pp[2] - r.cz) > 128 ? r.away + 1 : 0;
    if (r.away > 600) { this.stop('You left the village; the raiders move on.'); return; }
    if (w.tickCount % 20 === 0 && this.villagers(r) === 0 && r.wave > 0) { this.stop('The village has fallen to the raiders.'); return; }
    if (r.gap > 0) {
      if (--r.gap === 0) this.spawnWave(r);
    } else {
      r.age++;
      r.raiders = r.raiders.filter((m) => !m.dead && m.health > 0);
      // Stragglers that wander off or get stuck far away after two minutes just leave.
      if (r.age > 2400) r.raiders = r.raiders.filter((m) => { const far = Math.hypot(m.body.pos[0] - pp[0], m.body.pos[2] - pp[2]) > 48; if (far) m.dead = true; return !far; });
      if (r.raiders.length === 0) {
        if (r.wave >= WAVES) { this.victory(); this.render(); return; }
        r.gap = WAVE_GAP;
        this.g.chat.say(`Wave ${r.wave} beaten. More are coming…`);
      }
    }
    this.render();
  }

  private lastKey = '';
  private render(): void {
    const r = this.active;
    const show = this.g.mode === 'playing' && !this.g.hudHidden && (!!r || this.banner > 0);
    let text = '', frac = 0;
    if (r) {
      if (r.gap > 0) { text = r.wave === 0 ? 'Raid: the raiders gather' : `Raid: wave ${r.wave + 1} of ${WAVES} approaching`; frac = 1 - r.gap / (r.wave === 0 ? 60 : WAVE_GAP); }
      else { text = `Raid: wave ${r.wave} of ${WAVES} · ${r.raiders.length} left`; frac = r.waveSize ? r.raiders.length / r.waveSize : 0; }
    } else if (this.banner > 0) { text = 'Victory'; frac = 1; }
    const key = `${show}|${text}|${frac.toFixed(2)}|${!!r}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.el.classList.toggle('show', show);
    this.el.classList.toggle('won', !r);
    this.label.textContent = text;
    this.fill.style.width = `${Math.round(frac * 100)}%`;
  }
}
