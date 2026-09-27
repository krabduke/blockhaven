// Maps: a small north-up minimap in the corner and a full-screen world map
// (M) of every chunk seen this session. Each column is coloured by the top
// block's average texture colour (tinted by biome for grass and leaves) and
// shaded by height so terrain reads at a glance.

import { BLOCKS } from '../blocks';
import { TILE_NAMES, TINTED, tileIndex } from '../tiles';
import { CH, CS, idx, type Chunk } from '../world/chunk';
import { BIOME_TINT } from '../world/worldgen';
import type { Atlas } from '../textures';
import type { Game } from '../game';

const S = 16; // texture tile size

interface Tile { canvas: HTMLCanvasElement; version: number; dim: string; y: number }

export class WorldMap {
  private colors: Uint8Array | null = null; // rgb per block id
  private tinted = new Uint8Array(256);
  private tiles = new Map<string, Tile>();
  private el: HTMLElement;
  private big: HTMLCanvasElement;
  private mini: HTMLCanvasElement;
  open = false;
  private center: [number, number] = [0, 0];
  private zoom = 2;
  private drag: { x: number; y: number; cx: number; cz: number } | null = null;
  private miniTimer = 0;
  private refreshBudget = 0;

  constructor(private g: Game, root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'worldmap';
    this.el.className = 'screen dim';
    this.el.innerHTML = '<div class="map-frame panel"><div class="map-head"><h3>World map</h3><span class="hint">Drag to move, scroll to zoom<span class="tp-hint">, double-click to teleport</span></span><button type="button" class="close-x" aria-label="Close map" title="Close (M or Esc)">×</button></div><canvas></canvas></div>';
    root.appendChild(this.el);
    this.big = this.el.querySelector('canvas')!;
    this.el.querySelector('.close-x')!.addEventListener('click', () => this.close());
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });
    this.mini = document.createElement('canvas');
    this.mini.id = 'minimap';
    this.mini.width = this.mini.height = 136;
    root.appendChild(this.mini);
    const cv = this.big;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY, cx: this.center[0], cz: this.center[1] }; });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.center = [this.drag.cx - (e.clientX - this.drag.x) / this.zoom, this.drag.cz - (e.clientY - this.drag.y) / this.zoom];
      this.drawBig();
    });
    cv.addEventListener('pointerup', () => { this.drag = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.25, Math.min(8, this.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      this.drawBig();
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => {
      const p = this.g.player;
      if (!p.creative || !this.g.world) return;
      const r = cv.getBoundingClientRect();
      const x = Math.floor(this.center[0] + (e.clientX - r.left - r.width / 2) / this.zoom);
      const z = Math.floor(this.center[1] + (e.clientY - r.top - r.height / 2) / this.zoom);
      p.body.pos = [x + 0.5, this.g.world.isLoaded(x, z) ? this.g.world.surfaceY(x, z) + 1 : 120, z + 0.5];
      p.body.vel = [0, 0, 0];
      p.flying = !this.g.world.isLoaded(x, z);
      this.g.toast(`Teleported to ${x}, ${z}`, 2);
      this.close();
    });
  }

  show(): void {
    if (!this.g.world) return;
    this.open = true;
    const p = this.g.player.body.pos;
    this.center = [p[0], p[2]];
    this.el.classList.add('show');
    this.el.classList.toggle('creative', this.g.player.creative);
    this.resizeBig();
    this.drawBig();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('show');
    this.g.input.lockPointer();
  }

  clear(): void { this.tiles.clear(); }

  /** Per-frame: keep tiles current, redraw the minimap a few times a second. */
  frame(dt: number): void {
    const g = this.g;
    const showMini = g.settings.minimap && g.mode === 'playing' && !g.hudHidden && !!g.world;
    this.mini.style.display = showMini ? 'block' : 'none';
    this.refreshBudget = 6;
    if (this.open) { this.drawBig(); return; }
    if (!showMini) return;
    this.miniTimer -= dt;
    if (this.miniTimer > 0) return;
    this.miniTimer = 0.25;
    this.drawMini();
  }

  // ---------- colours ----------
  setAtlas(atlas: Atlas): void {
    const c = new Uint8Array(256 * 3);
    const avg = (tile: number) => {
      let r = 0, g = 0, b = 0, n = 0;
      const base = tile * S * S * 4;
      for (let i = 0; i < S * S; i++) {
        const a = atlas.layers[base + i * 4 + 3];
        if (a < 128) continue;
        r += atlas.layers[base + i * 4]; g += atlas.layers[base + i * 4 + 1]; b += atlas.layers[base + i * 4 + 2]; n++;
      }
      return n ? [r / n, g / n, b / n] : [0, 0, 0];
    };
    for (let id = 1; id < 256; id++) {
      const d = BLOCKS[id];
      if (!d) continue;
      if (d.shape === 'none') continue;
      const name = d.tiles[2];
      let ti: number;
      try { ti = tileIndex(name); } catch { continue; }
      if (ti < 0 || ti >= TILE_NAMES.length) continue;
      const [r, g, b] = avg(ti);
      c[id * 3] = r; c[id * 3 + 1] = g; c[id * 3 + 2] = b;
      if (TINTED.has(name)) this.tinted[id] = 1;
    }
    this.colors = c;
  }

  private tileFor(ch: Chunk, dim: string, sliceY: number): HTMLCanvasElement | null {
    const key = `${dim}:${ch.cx},${ch.cz}`;
    const cur = this.tiles.get(key);
    if (cur && cur.version === ch.version && (dim === 'overworld' || Math.abs(sliceY - cur.y) < 8)) return cur.canvas;
    if (this.refreshBudget <= 0 && cur) return cur.canvas;
    if (this.refreshBudget <= 0) return null;
    this.refreshBudget--;
    const cv = cur?.canvas ?? Object.assign(document.createElement('canvas'), { width: CS, height: CS });
    this.paint(ch, cv, dim === 'overworld' ? CH - 1 : sliceY);
    const t = { canvas: cv, version: ch.version, dim, y: sliceY };
    this.tiles.set(key, t);
    return cv;
  }

  private paint(ch: Chunk, cv: HTMLCanvasElement, startY: number): void {
    const colors = this.colors;
    if (!colors) return;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(CS, CS);
    const heights = new Int16Array(CS * CS);
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      let y = startY;
      // Below a ceiling (other dimensions), skip down through solid rock to the first open floor.
      if (startY < CH - 1) { while (y > 0 && ch.blocks[idx(x, y, z)] !== 0) y--; }
      while (y > 0 && (ch.blocks[idx(x, y, z)] === 0 || BLOCKS[ch.blocks[idx(x, y, z)]].shape === 'cross')) y--;
      const id = ch.blocks[idx(x, y, z)];
      let r = colors[id * 3], g = colors[id * 3 + 1], b = colors[id * 3 + 2];
      if (this.tinted[id]) { const t = BIOME_TINT[ch.biomes[x + z * 16]] ?? BIOME_TINT[1]; r *= t[0] * 1.25; g *= t[1] * 1.25; b *= t[2] * 1.25; }
      if (BLOCKS[id].fluid) {
        // Deeper water is darker.
        let d = 0;
        for (let yy = y - 1; yy > 0 && d < 12 && BLOCKS[ch.blocks[idx(x, yy, z)]].fluid; yy--) d++;
        const k = 1 - d * 0.035;
        r *= k; g *= k; b *= k;
      }
      heights[x + z * CS] = y;
      const o = (x + z * CS) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    // Shade by slope toward the north-west, like a relief map.
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = heights[x + z * CS];
      const n = heights[x + Math.max(0, z - 1) * CS], w = heights[Math.max(0, x - 1) + z * CS];
      const k = Math.max(0.7, Math.min(1.25, 1 + ((h - n) + (h - w)) * 0.06));
      const o = (x + z * CS) * 4;
      img.data[o] *= k; img.data[o + 1] *= k; img.data[o + 2] *= k;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- drawing ----------
  private drawChunks(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, zoom: number): void {
    const g = this.g, world = g.world!;
    const dim = world.dimension;
    const sliceY = Math.floor(g.player.body.pos[1]) + 1;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#16110d';
    ctx.fillRect(0, 0, w, h);
    const x0 = Math.floor((cx - w / 2 / zoom) / CS) - 1, x1 = Math.floor((cx + w / 2 / zoom) / CS) + 1;
    const z0 = Math.floor((cz - h / 2 / zoom) / CS) - 1, z1 = Math.floor((cz + h / 2 / zoom) / CS) + 1;
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      const ch = world.getChunk(tx, tz);
      let cv: HTMLCanvasElement | null | undefined = ch ? this.tileFor(ch, dim, sliceY) : this.tiles.get(`${dim}:${tx},${tz}`)?.canvas;
      if (!cv) continue;
      const sx = w / 2 + (tx * CS - cx) * zoom, sy = h / 2 + (tz * CS - cz) * zoom;
      ctx.drawImage(cv, Math.floor(sx), Math.floor(sy), Math.ceil(CS * zoom), Math.ceil(CS * zoom));
      cv = null;
    }
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, zoom: number, labels: boolean): void {
    const g = this.g, p = g.player;
    const toScreen = (x: number, z: number) => [w / 2 + (x - cx) * zoom, h / 2 + (z - cz) * zoom];
    ctx.font = '12px "Pixelify Sans", sans-serif';
    for (const wp of g.waypoints.list(g.dimension)) {
      let [sx, sy] = toScreen(wp.pos[0], wp.pos[2]);
      const inside = sx >= 4 && sy >= 4 && sx <= w - 4 && sy <= h - 4;
      sx = Math.max(4, Math.min(w - 4, sx)); sy = Math.max(4, Math.min(h - 4, sy));
      ctx.fillStyle = wp.death ? '#e0523b' : '#f2b544';
      ctx.strokeStyle = '#140e0a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, inside ? 4 : 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (labels && inside) { ctx.fillStyle = '#efe6d2'; ctx.strokeText(wp.name, sx + 7, sy + 4); ctx.fillText(wp.name, sx + 7, sy + 4); }
    }
    // The player: an arrow pointing where you face.
    const [px, py] = toScreen(p.body.pos[0], p.body.pos[2]);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#140e0a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  private drawMini(): void {
    const ctx = this.mini.getContext('2d')!;
    const p = this.g.player.body.pos, w = this.mini.width, h = this.mini.height;
    this.drawChunks(ctx, w, h, p[0], p[2], 1.25);
    this.drawMarkers(ctx, w, h, p[0], p[2], 1.25, false);
    ctx.fillStyle = '#efe6d2';
    ctx.font = '11px "Pixelify Sans", sans-serif';
    ctx.fillText('N', w / 2 - 3, 11);
  }

  private resizeBig(): void {
    const r = this.el.querySelector('.map-frame')!.getBoundingClientRect();
    this.big.width = Math.max(200, Math.floor(r.width - 24));
    this.big.height = Math.max(160, Math.floor(r.height - 64));
  }

  private drawBig(): void {
    if (!this.open || !this.g.world) return;
    const ctx = this.big.getContext('2d')!;
    const { width: w, height: h } = this.big;
    this.drawChunks(ctx, w, h, this.center[0], this.center[1], this.zoom);
    this.drawMarkers(ctx, w, h, this.center[0], this.center[1], this.zoom, true);
    ctx.fillStyle = '#b9ad95';
    ctx.font = '13px "Pixelify Sans", sans-serif';
    ctx.fillText(`${Math.floor(this.center[0])}, ${Math.floor(this.center[1])}   ${this.zoom >= 1 ? this.zoom.toFixed(this.zoom % 1 ? 2 : 0) + ' px/block' : Math.round(1 / this.zoom) + ' blocks/px'}`, 8, h - 8);
  }
}
