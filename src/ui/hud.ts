// Heads-up display: crosshair, hotbar, health / hunger / air meters.

import * as THREE from 'three';
import { I, itemDef, maxDurability } from '../items';
import type { Player } from '../player';
import type { Game } from '../game';
import { BIOME_NAMES } from '../world/worldgen';
import { EFFECTS, formatTicks } from '../effects';
import { iconURL } from './icons';

type Pix = string[];
function sprite(rows: Pix, pal: Record<string, string>): string {
  const cv = document.createElement('canvas');
  cv.width = rows[0].length; cv.height = rows.length;
  const g = cv.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); }
  }));
  return cv.toDataURL();
}

const HEART = ['.kk.kk.', 'kffkffk', 'kfhffff', 'kffffff', '.kffff.', '..kff..', '...k...'];
const HALF_HEART = ['.kk.kk.', 'kffkeek', 'kfhfeee', 'kfffeee', '.kffee.', '..kfe..', '...k...'];
const LOAF = ['..kkkk..', '.kbbbbk.', 'kbhbhbbk', 'kbbbbbbk', 'kdddddk.', '.kkkkk..'];
const HALF_LOAF = ['..kkkk..', '.kbbeek.', 'kbhbeeek', 'kbbbeeek', 'kddeeek.', '.kkkkk..'];
const BUBBLE = ['.kkk.', 'kwbbk', 'kbbbk', 'kbbbk', '.kkk.'];
const SHIELD = ['kkkkkkk', 'kfhfffk', 'kffffff', 'kffffek', '.kffek.', '..kek..', '...k...'];
const HALF_SHIELD = ['kkkkkkk', 'kfhfeek', 'kffeeek', 'kffeeek', '.kfeek.', '..kek..', '...k...'];

let icons: Record<string, string> | null = null;
function hudIcons(): Record<string, string> {
  if (icons) return icons;
  const heartPal = { k: '#2a0e0a', f: '#d9383a', h: '#ff9a8a', e: '#4a2a26' };
  const emptyPal = { k: '#2a0e0a', f: '#4a2a26', h: '#5a3a36', e: '#4a2a26' };
  const loafPal = { k: '#2a1a0a', b: '#d08a3a', h: '#f0c070', d: '#8a5a22', e: '#3a2a1c' };
  const loafEmpty = { k: '#2a1a0a', b: '#3a2a1c', h: '#3a2a1c', d: '#2a1d14', e: '#3a2a1c' };
  icons = {
    heart: sprite(HEART, heartPal), halfHeart: sprite(HALF_HEART, heartPal), emptyHeart: sprite(HEART, emptyPal),
    loaf: sprite(LOAF, loafPal), halfLoaf: sprite(HALF_LOAF, loafPal), emptyLoaf: sprite(LOAF, loafEmpty),
    bubble: sprite(BUBBLE, { k: '#0e2a4a', w: '#ffffff', b: '#5aa8ec' }),
    shield: sprite(SHIELD, { k: '#1c1c22', f: '#c8ccd4', h: '#ffffff', e: '#8a8e96' }),
    halfShield: sprite(HALF_SHIELD, { k: '#1c1c22', f: '#c8ccd4', h: '#ffffff', e: '#34343c' }),
  };
  return icons;
}

export class Hud {
  root: HTMLElement;
  private slots: HTMLElement[] = [];
  private hearts: HTMLImageElement[] = [];
  private loaves: HTMLImageElement[] = [];
  private bubbles: HTMLElement;
  private armorEl: HTMLElement;
  private xpBar: HTMLElement;
  private xpText: HTMLElement;
  private lastArmor = -1;
  private stats: HTMLElement;
  private heldName: HTMLElement;
  private nameTimer = 0;
  private lastSel = -1;
  private lastKey = '';
  private coords: HTMLElement;
  private effectsEl: HTMLElement;
  private effectsKey = '';
  private effectsTimer = 0;
  private markerLayer: HTMLElement;
  private markers = new Map<string, HTMLElement>();
  private tmp = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.coords = document.createElement('div');
    this.coords.id = 'coords';
    parent.appendChild(this.coords);
    this.effectsEl = document.createElement('div');
    this.effectsEl.id = 'effects';
    this.effectsEl.setAttribute('aria-label', 'Active effects');
    parent.appendChild(this.effectsEl);
    this.markerLayer = document.createElement('div');
    this.markerLayer.id = 'markers';
    parent.appendChild(this.markerLayer);
    const ic = hudIcons();
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="crosshair"></div>
      <div class="hotbar-wrap">
        <div class="held-name fade"></div>
        <div class="stats top"><div class="meter armor"></div><div class="air"></div></div>
        <div class="stats"><div class="meter hearts"></div><div class="meter food"></div></div>
        <div class="xp"><i></i><span></span></div>
        <div class="hotbar"></div>
      </div>`;
    parent.appendChild(this.root);
    const hb = this.root.querySelector('.hotbar')!;
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'hslot';
      hb.appendChild(s);
      this.slots.push(s);
    }
    const h = this.root.querySelector('.hearts')!, f = this.root.querySelector('.food')!;
    for (let i = 0; i < 10; i++) {
      const a = new Image(); a.src = ic.heart; a.alt = ''; h.appendChild(a); this.hearts.push(a);
      const b = new Image(); b.src = ic.loaf; b.alt = ''; f.appendChild(b); this.loaves.push(b);
    }
    this.bubbles = this.root.querySelector('.air')!;
    this.armorEl = this.root.querySelector('.armor')!;
    this.xpBar = this.root.querySelector('.xp > i')!;
    this.xpText = this.root.querySelector('.xp > span')!;
    this.stats = this.root.querySelector('.stats')!;
    this.heldName = this.root.querySelector('.held-name')!;
  }

  /** Make hotbar slots tappable (touch screens). */
  enableTouch(onSelect: (slot: number) => void): void {
    this.root.classList.add('touchable');
    this.slots.forEach((el, i) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); onSelect(i); }));
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  update(p: Player, dt: number): void {
    const ic = hudIcons();
    // Hotbar contents (only touch the DOM when something changed).
    const key = p.inv.slots.slice(0, 9).map((s) => (s ? `${s.id}:${s.count}:${s.damage ?? ''}:${s.ench?.length ?? 0}` : '-')).join('|') + '#' + p.selected;
    if (key !== this.lastKey) {
      this.lastKey = key;
      for (let i = 0; i < 9; i++) {
        const s = p.inv.slots[i];
        const el = this.slots[i];
        el.classList.toggle('sel', i === p.selected);
        el.innerHTML = s ? slotHTML(s.id, s.count, s.damage, !!s.ench?.length) : '';
      }
    }
    if (p.selected !== this.lastSel) {
      this.lastSel = p.selected;
      const s = p.held;
      this.heldName.textContent = s ? s.name ?? itemDef(s.id)?.name ?? '' : '';
      this.heldName.classList.remove('fade');
      this.nameTimer = 2;
    }
    if (this.nameTimer > 0) {
      this.nameTimer -= dt;
      if (this.nameTimer <= 0) this.heldName.classList.add('fade');
    }
    this.stats.style.visibility = p.creative ? 'hidden' : 'visible';
    if (!p.creative) {
      const hp = Math.ceil(p.health);
      this.hearts.forEach((img, i) => {
        const want = hp >= (i + 1) * 2 ? ic.heart : hp === i * 2 + 1 ? ic.halfHeart : ic.emptyHeart;
        if (img.src !== want) img.src = want;
        img.style.transform = p.health <= 4 && Math.random() < 0.3 ? `translateY(${Math.random() < 0.5 ? -2 : 2}px)` : '';
      });
      this.loaves.forEach((img, i) => {
        const want = p.food >= (i + 1) * 2 ? ic.loaf : p.food === i * 2 + 1 ? ic.halfLoaf : ic.emptyLoaf;
        if (img.src !== want) img.src = want;
      });
    }
    const armor = p.creative ? 0 : p.armorPoints;
    if (armor !== this.lastArmor) {
      this.lastArmor = armor;
      this.armorEl.innerHTML = '';
      if (armor > 0) for (let i = 0; i < 10; i++) {
        const img = new Image();
        img.alt = '';
        img.src = armor >= (i + 1) * 2 ? ic.shield : armor === i * 2 + 1 ? ic.halfShield : ic.shield;
        if (armor < i * 2 + 1) img.style.opacity = '0.25';
        this.armorEl.appendChild(img);
      }
    }
    (this.xpBar.parentElement as HTMLElement).style.visibility = p.creative ? 'hidden' : 'visible';
    this.xpBar.style.width = `${Math.round(p.xpProgress * 100)}%`;
    this.xpText.textContent = p.xpLevel > 0 ? String(p.xpLevel) : '';
    const bubbles = p.air < 300 && !p.creative ? Math.max(0, Math.ceil((p.air / 300) * 10)) : 0;
    if (this.bubbles.childElementCount !== bubbles) {
      this.bubbles.innerHTML = '';
      for (let i = 0; i < bubbles; i++) { const b = new Image(); b.src = ic.bubble; b.alt = ''; this.bubbles.appendChild(b); }
    }
  }

  /** Active potion effects with time left (refreshed twice a second). */
  private updateEffects(g: Game, dt: number): void {
    this.effectsTimer -= dt;
    if (this.effectsTimer > 0) return;
    this.effectsTimer = 0.5;
    const p = g.player;
    const list = g.mode === 'playing' && !g.hudHidden ? [...p.effects] : [];
    const key = list.map(([id, e]) => `${id}${e.level}:${formatTicks(e.ticks)}`).join('|');
    if (key === this.effectsKey) return;
    this.effectsKey = key;
    this.effectsEl.innerHTML = list.map(([id, e]) => {
      const def = EFFECTS[id];
      const icon = I['potion_' + id] ?? (id === 'hero' ? I.amber : undefined);
      const lvl = e.level > 1 ? ' ' + ['', 'I', 'II', 'III', 'IV'][e.level] : '';
      return `<div class="fx${def.good ? '' : ' bad'}${e.ticks < 200 ? ' ending' : ''}">${icon ? `<img src="${iconURL(icon)}" alt="">` : ''}<span>${def.name}${lvl}</span><b>${formatTicks(e.ticks)}</b></div>`;
    }).join('');
  }

  /** Coordinates line and on-screen waypoint markers. */
  updateInfo(g: Game, dt = 0.016): void {
    this.updateEffects(g, dt);
    const show = g.mode === 'playing' && !g.hudHidden && !!g.world;
    const p = g.player;
    this.coords.style.display = show && g.settings.showCoords ? 'block' : 'none';
    if (show && g.settings.showCoords) {
      const [x, y, z] = p.body.pos;
      const facing = ['north', 'west', 'south', 'east'][p.quadrant()];
      const c = g.world!.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
      const biome = c ? BIOME_NAMES[c.biomes[(Math.floor(x) & 15) + (Math.floor(z) & 15) * 16]] : '';
      const text = `${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)} · facing ${facing}${biome && g.world!.dimension === 'overworld' ? ' · ' + biome : ''}`;
      if (this.coords.textContent !== text) this.coords.textContent = text;
    }
    const seen = new Set<string>();
    if (show) {
      const cam = g.renderer.camera, w = window.innerWidth, h = window.innerHeight;
      for (const wp of g.waypoints.list(g.dimension)) {
        const v = this.tmp.set(wp.pos[0], wp.pos[1] + 1.2, wp.pos[2]).project(cam);
        const dist = Math.hypot(wp.pos[0] - p.body.pos[0], wp.pos[1] - p.body.pos[1], wp.pos[2] - p.body.pos[2]);
        if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1 || dist < 2) continue;
        seen.add(wp.name);
        let el = this.markers.get(wp.name);
        if (!el) {
          el = document.createElement('div');
          el.className = 'marker' + (wp.death ? ' death' : '');
          this.markerLayer.appendChild(el);
          this.markers.set(wp.name, el);
        }
        el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        const label = `${wp.name} · ${Math.round(dist)} m`;
        if (el.textContent !== label) el.textContent = label;
      }
    }
    for (const [k, el] of this.markers) if (!seen.has(k)) { el.remove(); this.markers.delete(k); }
  }
}

export function slotHTML(id: number, count: number, damage?: number, enchanted = false): string {
  let html = `<img src="${iconURL(id)}" alt=""${enchanted ? ' class="glint"' : ''}>`;
  if (count > 1) html += `<span class="count">${count}</span>`;
  const max = maxDurability(id);
  if (max && damage !== undefined && damage > 0) {
    const f = 1 - damage / max;
    const col = `hsl(${Math.round(f * 120)}, 80%, 50%)`;
    html += `<span class="dura"><i style="width:${Math.round(f * 100)}%;background:${col}"></i></span>`;
  }
  return html;
}
