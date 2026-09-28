// Procedural pixel art. Every texture in the game is painted here at startup;
// there are no image assets.

import { hashString, mulberry32 } from './noise';
import { TILE_NAMES, TINTED, baseTile } from './tiles';
import { BIOME_TINT } from './world/worldgen';
import { EFFECTS } from './effects';
import { COLOR_HEX, DYE_COLORS, WOOL_KEY } from './blocks';

type RGB = [number, number, number];
const S = 16;

function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class Painter {
  readonly data = new Uint8ClampedArray(S * S * 4);
  readonly rand: () => number;
  constructor(name: string) {
    this.rand = mulberry32(hashString(name));
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (x + y * S) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (x + y * S) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  alpha(x: number, y: number): number {
    return this.data[(x + y * S) * 4 + 3];
  }
  clear(x: number, y: number): void {
    this.data[(x + y * S) * 4 + 3] = 0;
  }
  jit(c: RGB, amount: number): RGB {
    const f = 1 + (this.rand() * 2 - 1) * amount;
    return [c[0] * f, c[1] * f, c[2] * f];
  }
  /** Fill with a base colour and per-pixel brightness noise. */
  fill(c: RGB, amount = 0.08): void {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, this.jit(c, amount));
  }
  /** Fill choosing from a weighted palette (softly clustered). */
  mottle(colors: RGB[], weights?: number[]): void {
    const w = weights ?? colors.map(() => 1);
    const total = w.reduce((a, b) => a + b, 0);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let r = this.rand() * total, k = 0;
      while (r > w[k] && k < colors.length - 1) { r -= w[k]; k++; }
      this.set(x, y, this.jit(colors[k], 0.04));
    }
  }
  speckle(c: RGB, prob: number, amount = 0.08): void {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (this.rand() < prob) this.set(x, y, this.jit(c, amount));
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB, amount = 0): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, amount ? this.jit(c, amount) : c);
  }
  shade(x: number, y: number, f: number): void {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (x + y * S) * 4;
    this.data[i] *= f; this.data[i + 1] *= f; this.data[i + 2] *= f;
  }
  /** Blobs of colour, grown from random seeds. */
  blobs(c: RGB, count: number, size: number, amount = 0.08): void {
    for (let b = 0; b < count; b++) {
      let x = Math.floor(this.rand() * S), y = Math.floor(this.rand() * S);
      for (let i = 0; i < size; i++) {
        this.set(x, y, this.jit(c, amount));
        x = Math.max(0, Math.min(S - 1, x + Math.round(this.rand() * 2 - 1)));
        y = Math.max(0, Math.min(S - 1, y + Math.round(this.rand() * 2 - 1)));
      }
    }
  }
  /** Draw a sprite from rows of characters mapped through a palette. */
  sprite(rows: string[], pal: Record<string, RGB | null>, jitter = 0.04, ox = 0, oy = 0): void {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (c === null) { this.clear(x + ox, y + oy); continue; }
        if (c) this.set(x + ox, y + oy, this.jit(c, jitter));
      }
    });
  }
  transparent(): void {
    this.data.fill(0);
  }
  /** Voronoi-ish stones with dark gaps (cobblestone-style). */
  stones(base: RGB, gap: RGB, cells: number): void {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < cells; i++) pts.push([this.rand() * S, this.rand() * S, 0.85 + this.rand() * 0.3]);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let oy = -S; oy <= S; oy += S) for (let ox = -S; ox <= S; ox += S) {
          const dx = x + 0.5 - (pts[i][0] + ox), dy = y + 0.5 - (pts[i][1] + oy);
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1) < 1.1;
      if (edge) this.set(x, y, this.jit(gap, 0.08));
      else {
        const f = pts[best][2];
        this.set(x, y, this.jit([base[0] * f, base[1] * f, base[2] * f], 0.06));
      }
    }
  }
  /** Tileable value noise in [0,1] with `cells` lattice cells across the tile. */
  field(cells: number, octaves = 2): Float32Array {
    const out = new Float32Array(S * S);
    let amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      const n = cells << o;
      const lat = new Float32Array(n * n);
      for (let i = 0; i < lat.length; i++) lat[i] = this.rand();
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const fx = (x / S) * n, fy = (y / S) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (a: number, b: number) => lat[((a % n) + n) % n + (((b % n) + n) % n) * n];
        const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
        out[x + y * S] += v * amp;
      }
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }
  /** Paint through a colour ramp indexed by a field value (0..1), with a little dither. */
  ramp(field: Float32Array, colors: RGB[], dither = 0.08): void {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let t = field[x + y * S] + (this.rand() - 0.5) * dither;
      t = Math.max(0, Math.min(0.999, t));
      const f = t * (colors.length - 1), i = Math.floor(f), k = f - i;
      const a = colors[i], b = colors[Math.min(colors.length - 1, i + 1)];
      this.set(x, y, [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    }
  }
  /** Stones with bevelled edges: lit top-left, shadowed bottom-right, dark mortar. */
  bevelStones(colors: RGB[], gap: RGB, cells: number, jitterCells = 0.1): void {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < cells; i++) pts.push([this.rand() * S, this.rand() * S, this.rand()]);
    const id = new Int16Array(S * S), edge = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let i = 0; i < pts.length; i++) for (let oy = -S; oy <= S; oy += S) for (let ox = -S; ox <= S; ox += S) {
        const d = (x + 0.5 - (pts[i][0] + ox)) ** 2 + (y + 0.5 - (pts[i][1] + oy)) ** 2;
        if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
      }
      id[x + y * S] = best;
      edge[x + y * S] = Math.sqrt(d2) - Math.sqrt(d1) < 1.0 ? 1 : 0;
    }
    const f = this.field(4, 2);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = x + y * S;
      if (edge[i]) { this.set(x, y, this.jit(gap, 0.06)); continue; }
      const tone = Math.min(0.999, pts[id[i]][2] * 0.55 + f[i] * 0.45 + (this.rand() - 0.5) * jitterCells);
      const c = colors[Math.floor(tone * colors.length)];
      this.set(x, y, c);
      // Bevel: neighbour to the top/left is an edge -> highlight; bottom/right -> shadow.
      const up = y > 0 ? edge[i - S] : edge[i + S * (S - 1)], left = x > 0 ? edge[i - 1] : edge[i + S - 1];
      const down = y < S - 1 ? edge[i + S] : edge[x], right = x < S - 1 ? edge[i + 1] : edge[i - x];
      if (up || left) this.shade(x, y, 1.18);
      else if (down || right) this.shade(x, y, 0.8);
    }
  }
  border(c: RGB, f = 1): void {
    for (let i = 0; i < S; i++) {
      this.set(i, 0, c); this.set(i, S - 1, c); this.set(0, i, c); this.set(S - 1, i, c);
    }
    if (f !== 1) for (let i = 1; i < S - 1; i++) { this.shade(i, 1, f); this.shade(1, i, f); }
  }
}

// ---------- Palette ----------
const C = {
  stone: hex('#7f7f82'), stoneDark: hex('#606066'), stoneLight: hex('#99999c'),
  dirt: hex('#8a5f3c'), dirtDark: hex('#6b4529'), dirtLight: hex('#a07350'),
  grass: hex('#cfd2c8'), grassSide: hex('#6fa045'), grassSideDark: hex('#57863a'),
  sand: hex('#dccf9a'), sandDark: hex('#c8b980'),
  bark: hex('#6b4f2d'), barkDark: hex('#4d381f'), wood: hex('#b8914f'), woodDark: hex('#94713a'), woodLight: hex('#c9a262'),
  plank: hex('#b08a50'), plankDark: hex('#8a6a3a'),
  water: hex('#3b6fd6'), lava: hex('#e2581c'), lavaHot: hex('#ffb13b'),
  coal: hex('#232326'), iron: hex('#d9a883'), gold: hex('#f6d23e'), diamond: hex('#55e3d5'),
  snow: hex('#f2f6f8'), ice: hex('#9cc4f2'),
  cactus: hex('#3f8a2f'), cactusDark: hex('#2d6a22'),
  brick: hex('#9c4a3a'), mortar: hex('#b8aa9c'),
  obsidian: hex('#1d1428'), obsidianHi: hex('#4b2f6b'),
  wool: hex('#e9e9e4'), red: hex('#c2342e'), yellow: hex('#f4d03f'),
  black: hex('#1a1a1a'), white: hex('#ffffff'),
  birch: hex('#e3e0d3'), birchMark: hex('#35322b'), spruceBark: hex('#4a3421'), spruceWood: hex('#7d5b36'),
  metalIron: hex('#dcdcdc'), metalGold: hex('#f3cf3a'), metalDiamond: hex('#62e8dc'),
  stick: hex('#7d5b2e'), stickDark: hex('#5a3f1f'),
};

const painters: Record<string, (p: Painter) => void> = {};
const tile = (name: string, fn: (p: Painter) => void) => { painters[name] = fn; };

tile('stone', (p) => {
  p.ramp(p.field(3, 3), [hex('#646468'), hex('#737377'), hex('#808084'), hex('#8c8c90'), hex('#9a9a9e')], 0.12);
  // Faint strata and hairline cracks.
  for (let i = 0; i < 3; i++) { let x = Math.floor(p.rand() * S); const y0 = Math.floor(p.rand() * S); for (let k = 0; k < 5; k++) { p.shade(x, (y0 + k) % S, 0.78); x = (x + (p.rand() < 0.5 ? 1 : 0)) % S; } }
});
tile('cobblestone', (p) => p.bevelStones([hex('#6a6a6e'), hex('#7a7a7e'), hex('#88888c'), hex('#96969a')], hex('#4e4e52'), 8));
tile('mossy_cobblestone', (p) => {
  p.bevelStones([hex('#6a6a6e'), hex('#7a7a7e'), hex('#88888c'), hex('#96969a')], hex('#3e3e42'), 8);
  const f = p.field(3, 2);
  for (let i = 0; i < S * S; i++) if (f[i] > 0.58) p.set(i % S, Math.floor(i / S), p.jit(f[i] > 0.7 ? hex('#6a9a3e') : hex('#4f7a2e'), 0.1));
});
tile('dirt', (p) => {
  p.ramp(p.field(4, 2), [hex('#5e3e24'), hex('#74502f'), hex('#86603a'), hex('#946c44')], 0.2);
  for (let i = 0; i < 6; i++) { const x = Math.floor(p.rand() * 15), y = Math.floor(p.rand() * 15); p.set(x, y, hex('#a88a6a')); p.set(x + 1, y + 1, hex('#5a3c24')); }
});
tile('grass_top', (p) => {
  p.ramp(p.field(4, 2), [hex('#868a7e'), hex('#9a9e92'), hex('#aeb2a6'), hex('#c2c6ba')], 0.25);
  // Individual blades: short vertical strokes with a lit tip.
  for (let i = 0; i < 22; i++) { const x = Math.floor(p.rand() * S), y = Math.floor(p.rand() * S); p.set(x, y, hex('#eceee6')); p.shade(x, (y + 1) % S, 0.8); }
});
tile('grass_side', (p) => {
  painters.dirt(p);
  const greens = [hex('#4d7a2c'), hex('#5f8f36'), hex('#6fa045'), hex('#7db250')];
  for (let x = 0; x < S; x++) {
    const d = 3 + Math.floor(p.rand() * 2) + (p.rand() < 0.35 ? 2 : 0);
    for (let y = 0; y < d; y++) p.set(x, y, p.jit(greens[Math.min(3, Math.max(0, 3 - y + (p.rand() < 0.3 ? -1 : 0)))], 0.05));
    p.shade(x, d, 0.72); // shadow under the overhang
  }
});
tile('snowy_grass_side', (p) => {
  painters.dirt(p);
  for (let x = 0; x < S; x++) {
    const d = 3 + Math.floor(p.rand() * 2);
    for (let y = 0; y < d; y++) p.set(x, y, p.jit(C.snow, 0.03));
  }
});
tile('snow', (p) => { p.fill(C.snow, 0.02); p.speckle(hex('#dde6ee'), 0.12, 0.02); });
tile('sand', (p) => {
  const f = p.field(2, 3);
  // Wind ripples: a sine across the field.
  for (let i = 0; i < S * S; i++) f[i] = f[i] * 0.6 + (Math.sin((i % S) * 0.5 + Math.floor(i / S) * 1.1 + f[i] * 4) * 0.5 + 0.5) * 0.4;
  p.ramp(f, [hex('#c8b882'), hex('#d4c592'), hex('#dfd2a0'), hex('#e9ddb0')], 0.15);
});
tile('gravel', (p) => p.bevelStones([hex('#6e6660'), hex('#827a72'), hex('#958c83'), hex('#a8a096'), hex('#7a6e62')], hex('#4a4440'), 18, 0.2));
tile('clay', (p) => { p.fill(hex('#9ea3b0'), 0.04); p.speckle(hex('#8a8f9c'), 0.2); });
tile('bedrock', (p) => { p.mottle([hex('#2b2b2b'), hex('#565656'), hex('#7b7b7b'), hex('#141414')], [3, 3, 1, 2]); });
tile('log_side', (p) => {
  // Vertical bark ridges with lit crests and dark furrows.
  const f = p.field(4, 2);
  for (let x = 0; x < S; x++) {
    const phase = Math.sin(x * 1.3 + p.rand() * 0.8);
    for (let y = 0; y < S; y++) {
      const t = phase * 0.35 + f[x + y * S] * 0.5 + (p.rand() - 0.5) * 0.15;
      const c = t > 0.45 ? hex('#7f603a') : t > 0.2 ? hex('#6b4f2d') : t > -0.1 ? hex('#584024') : hex('#3f2c18');
      p.set(x, y, c);
    }
  }
});
const rings = (p: Painter, bark: RGB, wood: RGB, dark: RGB) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const c = d > 6.5 ? bark : Math.floor(d) % 2 === 0 ? dark : wood;
    p.set(x, y, p.jit(c, 0.05));
  }
};
tile('log_top', (p) => {
  // Growth rings, slightly off-centre and wobbly, inside a bark rim.
  const cx = 7.5 + (p.rand() - 0.5), cy = 7.5 + (p.rand() - 0.5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (edge > 6.5) { p.set(x, y, p.jit(C.bark, 0.06)); continue; }
    const r = Math.hypot(x + 0.5 - cx - 0.5, y + 0.5 - cy - 0.5) + Math.sin(Math.atan2(y - cy, x - cx) * 3) * 0.3;
    const ring = Math.floor(r * 0.9) % 2 === 0;
    p.set(x, y, p.jit(ring ? hex('#a78448') : hex('#bf9a5a'), 0.04));
  }
});
tile('birch_log_side', (p) => {
  p.fill(C.birch, 0.04);
  for (let i = 0; i < 7; i++) {
    const y = Math.floor(p.rand() * S), x = Math.floor(p.rand() * 12), w = 2 + Math.floor(p.rand() * 4);
    p.rect(x, y, w, 1, C.birchMark, 0.1);
  }
});
tile('birch_log_top', (p) => rings(p, C.birch, hex('#d6c28e'), hex('#bda56f')));
tile('spruce_log_side', (p) => {
  for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) p.set(x, y, p.jit(x % 3 === 0 ? hex('#3a2818') : C.spruceBark, 0.07));
});
tile('spruce_log_top', (p) => rings(p, C.spruceBark, C.spruceWood, hex('#6a4b2b')));
tile('planks', (p) => {
  const grain = p.field(2, 2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const board = y >> 2;
    const joint = (board * 7 + 3) % S;
    const seam = y % 4 === 3 || x === joint;
    // Wood grain runs along the board; each board has its own tone.
    const g = Math.sin((x + board * 5) * 0.9 + grain[x + y * S] * 5) * 0.5 + 0.5;
    const tone = [0.96, 1.04, 0.92, 1.0][board];
    const base: RGB = g > 0.7 ? hex('#c49a5c') : g > 0.35 ? hex('#b08a50') : hex('#9c7744');
    if (seam) p.set(x, y, p.jit(hex('#6e5230'), 0.04));
    else {
      p.set(x, y, p.jit([base[0] * tone, base[1] * tone, base[2] * tone], 0.03));
      if (y % 4 === 0) p.shade(x, y, 1.1); // lit top edge of each board
      if (y % 4 === 2) p.shade(x, y, 0.92);
    }
  }
  p.set(1, 1, hex('#5a4630')); p.set(14, 9, hex('#5a4630'));
});
const leaves = (p: Painter, base: RGB, holes: number) => {
  // Clusters of leaves: lit upper-left edges, shaded interiors, gaps between clumps.
  const f = p.field(4, 2);
  const [r, g, b] = base;
  p.ramp(f, [[r * 0.62, g * 0.62, b * 0.62], [r * 0.78, g * 0.78, b * 0.78], [r * 0.92, g * 0.92, b * 0.92], [r * 1.05, g * 1.05, b * 1.05]], 0.3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (f[x + y * S] < 0.3 && p.rand() < holes * 3) p.clear(x, y);
    else if (p.rand() < holes * 0.5) p.clear(x, y);
  }
  for (let i = 0; i < 14; i++) { const x = Math.floor(p.rand() * S), y = Math.floor(p.rand() * S); if (p.alpha(x, y)) p.set(x, y, [Math.min(255, r * 1.2), Math.min(255, g * 1.2), Math.min(255, b * 1.2)]); }
};
tile('leaves', (p) => leaves(p, hex('#c4c9bd'), 0.18));
tile('spruce_leaves', (p) => leaves(p, hex('#a9b4ad'), 0.14));
tile('birch_leaves', (p) => { p.fill(hex('#7fa35a'), 0.14); p.speckle(hex('#62853f'), 0.25); for (let i = 0; i < 40; i++) p.clear(Math.floor(p.rand() * S), Math.floor(p.rand() * S)); });
tile('glass', (p) => {
  p.transparent();
  const edge = hex('#d8eef6'), shadow = hex('#8fb4c4');
  for (let i = 0; i < S; i++) { p.set(i, 0, edge); p.set(0, i, edge); p.set(i, S - 1, shadow); p.set(S - 1, i, shadow); }
  // Streaks of reflected light.
  for (let i = 0; i < 5; i++) { p.set(3 + i, 7 - i, C.white, 190); if (i < 3) p.set(4 + i, 7 - i, C.white, 110); }
  for (let i = 0; i < 3; i++) p.set(10 + i, 13 - i, C.white, 150);
  p.set(12, 3, C.white, 120);
});
tile('water', (p) => {
  const f = p.field(3, 2);
  for (let i = 0; i < S * S; i++) f[i] = Math.abs(Math.sin(f[i] * 9));
  p.ramp(f, [hex('#2a5cc0'), hex('#3468d0'), hex('#3f76e0'), hex('#5a8ff0'), hex('#7eaaf6')], 0.1);
});
tile('water_flow', (p) => { p.fill(C.water, 0.06); for (let y = 0; y < S; y += 3) for (let x = 0; x < S; x++) if ((x * 3 + y) % 5 === 0) p.set(x, y, hex('#6a9aee')); });
tile('lava', (p) => { p.fill(C.lava, 0.08); p.blobs(C.lavaHot, 6, 8, 0.1); p.blobs(hex('#b8330f'), 5, 5); });
const ore = (color: RGB, count: number) => (p: Painter) => {
  painters.stone(p);
  const hi: RGB = [Math.min(255, color[0] * 1.35 + 30), Math.min(255, color[1] * 1.35 + 30), Math.min(255, color[2] * 1.35 + 30)];
  const lo: RGB = [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6];
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(p.rand() * 12), y = 1 + Math.floor(p.rand() * 12);
    // A small faceted nugget: highlight, body, shadow, and a dark socket below.
    p.set(x, y, hi); p.set(x + 1, y, p.jit(color, 0.06));
    p.set(x, y + 1, p.jit(color, 0.06)); p.set(x + 1, y + 1, lo);
    if (p.rand() < 0.6) p.set(x + 2, y + 1, p.jit(color, 0.08));
    p.shade(x, y + 2, 0.7); p.shade(x + 1, y + 2, 0.7);
  }
};
tile('coal_ore', ore(C.coal, 6));
tile('iron_ore', ore(C.iron, 5));
tile('gold_ore', ore(C.gold, 5));
tile('diamond_ore', ore(C.diamond, 5));
tile('ice', (p) => { p.fill(C.ice, 0.03); for (let i = 0; i < 3; i++) { let x = Math.floor(p.rand() * S), y = 0; while (y < S) { p.set(x, y, hex('#d8ecff')); y++; x += Math.round(p.rand() * 2 - 1); } } });
tile('cactus_side', (p) => {
  p.transparent();
  for (let y = 0; y < S; y++) for (let x = 1; x < 15; x++) p.set(x, y, p.jit(x % 4 === 1 ? C.cactusDark : C.cactus, 0.06));
  for (let i = 0; i < 8; i++) p.set(1 + Math.floor(p.rand() * 14), Math.floor(p.rand() * S), hex('#e8e0b0'));
});
tile('cactus_top', (p) => { p.transparent(); for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) p.set(x, y, p.jit((x + y) % 5 === 0 ? C.cactusDark : hex('#5aa23f'), 0.05)); });
tile('sandstone', (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, p.jit(y < 3 || y === 9 ? hex('#cdbb82') : C.sand, 0.035));
  for (let x = 0; x < S; x++) p.set(x, 3, hex('#b9a46c'));
});
tile('sandstone_top', (p) => { p.fill(hex('#d9c98f'), 0.03); });
tile('crafting_top', (p) => {
  painters.planks(p);
  for (let i = 0; i < S; i++) { p.set(i, 0, C.woodDark); p.set(i, 15, C.woodDark); p.set(0, i, C.woodDark); p.set(15, i, C.woodDark); }
  for (let i = 2; i < 14; i++) { p.set(i, 5, C.barkDark); p.set(i, 10, C.barkDark); p.set(5, i, C.barkDark); p.set(10, i, C.barkDark); }
});
tile('crafting_side', (p) => {
  painters.planks(p);
  p.rect(0, 0, 16, 3, C.bark, 0.05);
  // a hanging saw and mallet, drawn fresh
  p.sprite([
    '................',
    '................',
    '................',
    '...gg.......hh..',
    '...gg......hhhh.',
    '..gggg.....hhhh.',
    '..gggg......ss..',
    '..gggg......ss..',
    '..gggg......ss..',
    '..gggg......ss..',
    '...ss.......ss..',
    '...ss...........',
  ], { g: hex('#b7b7b7'), h: hex('#6b4a2a'), s: C.stickDark });
});
tile('crafting_front', (p) => { painters.crafting_side(p); });
tile('furnace_side', (p) => { p.fill(hex('#8a8a8a'), 0.05); p.speckle(C.stoneDark, 0.12); p.border(hex('#6a6a6a')); });
tile('furnace_top', (p) => { p.fill(hex('#8f8f8f'), 0.04); p.speckle(C.stoneDark, 0.1); });
const furnaceFront = (lit: boolean) => (p: Painter) => {
  painters.furnace_side(p);
  p.rect(3, 8, 10, 6, hex('#262626'));
  p.rect(3, 7, 10, 1, hex('#5a5a5a'));
  p.rect(4, 3, 8, 2, hex('#5a5a5a'));
  if (lit) { p.rect(4, 11, 8, 3, hex('#f58a1f'), 0.2); p.rect(5, 10, 6, 1, hex('#ffd24a'), 0.2); }
};
tile('furnace_front', furnaceFront(false));
tile('furnace_front_lit', furnaceFront(true));
tile('torch', (p) => {
  p.transparent();
  for (let y = 8; y < 16; y++) { p.set(7, y, C.stick); p.set(8, y, C.stickDark); }
  p.rect(7, 6, 2, 2, hex('#ffcf4a'));
  p.set(7, 6, hex('#fff1a8')); p.set(8, 7, hex('#ff8a1f'));
});
tile('lever', (p) => {
  p.transparent();
  for (let y = 5; y < 13; y++) { p.set(7, y, C.stick); p.set(8, y, C.stickDark); }
  p.rect(5, 12, 6, 4, hex('#8a8a8a'), 0.06);
});
tile('tall_grass', (p) => {
  p.transparent();
  for (let b = 0; b < 9; b++) {
    let x = 1 + Math.floor(p.rand() * 14);
    const top = 3 + Math.floor(p.rand() * 8);
    for (let y = 15; y >= top; y--) {
      p.set(x, y, p.jit(hex('#c7cabf'), 0.12));
      if (p.rand() < 0.25) x += p.rand() < 0.5 ? -1 : 1;
    }
  }
});
const flower = (petal: RGB, center: RGB) => (p: Painter) => {
  p.transparent();
  for (let y = 8; y < 16; y++) p.set(7, y, hex('#3f7d2a'));
  p.set(6, 12, hex('#4d9234')); p.set(5, 11, hex('#4d9234')); p.set(8, 11, hex('#4d9234')); p.set(9, 10, hex('#4d9234'));
  p.sprite(['.pp.', 'pccp', 'pccp', '.pp.'], { p: petal, c: center }, 0.08, 6, 4);
};
tile('poppy', flower(C.red, hex('#2a1a12')));
tile('dandelion', flower(C.yellow, hex('#e89a1a')));
tile('dead_bush', (p) => {
  p.transparent();
  p.sprite([
    '................', '................', '................', '..b.........b...',
    '...b.......b....', '...b..b...b.....', '....b.b..b...b..', '.b...bb.b...b...',
    '..b...bbb..b....', '...b...bb.b.....', '....b..bbb......', '.....b.bb.......',
    '......bb........', '.......b........', '.......b........', '.......b........',
  ], { b: hex('#8a6233') }, 0.12);
});
tile('obsidian', (p) => { p.fill(C.obsidian, 0.1); p.blobs(C.obsidianHi, 5, 5, 0.12); p.speckle(hex('#0c0812'), 0.1); });
tile('bricks', (p) => {
  const tones = [hex('#8e4132'), hex('#9c4a3a'), hex('#a85442'), hex('#93473a')];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = y >> 2, off = row % 2 ? 4 : 0;
    const col = Math.floor((x + off) / 8);
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    if (mortar) { p.set(x, y, p.jit(C.mortar, 0.04)); continue; }
    p.set(x, y, p.jit(tones[(row * 3 + col) % 4], 0.07));
    if (y % 4 === 0) p.shade(x, y, 1.14);
    if (y % 4 === 2) p.shade(x, y, 0.88);
  }
});
tile('stone_bricks', (p) => {
  const f = p.field(4, 2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = y >> 3, off = row % 2 ? 4 : 0;
    const gap = y % 8 === 7 || (x + off) % 8 === 7;
    const hi = y % 8 === 0 || (x + off) % 8 === 0;
    const lo = y % 8 === 6 || (x + off) % 8 === 6;
    const base: RGB = f[x + y * S] > 0.55 ? hex('#8a8a8e') : hex('#7c7c80');
    p.set(x, y, gap ? p.jit(hex('#4a4a4e'), 0.04) : p.jit(base, 0.04));
    if (!gap && hi) p.shade(x, y, 1.15);
    if (!gap && lo) p.shade(x, y, 0.85);
  }
});
tile('glowstone', (p) => { p.stones(hex('#e8c060'), hex('#8c6a2f'), 10); p.speckle(hex('#fff2b0'), 0.12); });
tile('lamp_off', (p) => { p.stones(hex('#6f5a3c'), hex('#3d3020'), 8); p.border(hex('#4a3a28')); });
tile('lamp_on', (p) => { p.stones(hex('#f5d27a'), hex('#b8843a'), 8); p.border(hex('#8a6a3a')); });
tile('wool', (p) => { p.fill(C.wool, 0.04); for (let i = 0; i < 30; i++) { const x = Math.floor(p.rand() * 15), y = Math.floor(p.rand() * 15); p.shade(x, y, 0.92); p.shade(x + 1, y + 1, 0.95); } });
const chestBase = (p: Painter) => {
  p.fill(hex('#a8793c'), 0.06);
  for (let x = 0; x < S; x++) if (p.rand() < 0.3) p.shade(x, Math.floor(p.rand() * S), 0.85);
  p.border(hex('#5a3a18'));
};
tile('chest_top', chestBase);
tile('chest_side', (p) => { chestBase(p); p.rect(1, 5, 14, 1, hex('#5a3a18')); });
tile('chest_front', (p) => { painters.chest_side(p); p.rect(7, 4, 2, 4, hex('#d9d9d9')); p.set(7, 6, hex('#555555')); });
tile('door_bottom', (p) => {
  p.fill(C.plank, 0.05);
  p.rect(0, 0, 16, 16, C.plank, 0.05);
  p.border(C.plankDark);
  p.rect(3, 2, 10, 5, C.woodDark, 0.04); p.rect(3, 9, 10, 5, C.woodDark, 0.04);
  p.rect(12, 0, 2, 2, hex('#c8c8c8'));
});
tile('door_top', (p) => {
  p.fill(C.plank, 0.05);
  p.border(C.plankDark);
  p.rect(3, 3, 4, 5, hex('#b8dcec')); p.rect(9, 3, 4, 5, hex('#b8dcec'));
  p.rect(3, 11, 10, 3, C.woodDark, 0.04);
});
tile('door_item', (p) => {
  p.transparent();
  p.rect(4, 0, 8, 16, C.plank, 0.05);
  p.rect(5, 2, 2, 3, hex('#b8dcec')); p.rect(9, 2, 2, 3, hex('#b8dcec'));
  p.rect(5, 9, 6, 4, C.woodDark); p.set(10, 7, hex('#c8c8c8'));
});
tile('bed_top', (p) => { p.fill(hex('#b8322c'), 0.05); p.rect(0, 0, 16, 5, C.wool, 0.03); for (let x = 0; x < S; x += 4) p.rect(x, 6, 1, 10, hex('#9a2a24')); });
tile('bed_foot', (p) => { p.fill(hex('#b8322c'), 0.05); for (let x = 0; x < S; x += 4) p.rect(x, 0, 1, 16, hex('#9a2a24')); });
tile('bed_side', (p) => { p.transparent(); p.rect(0, 7, 16, 4, hex('#b8322c'), 0.05); p.rect(0, 11, 16, 2, C.plank, 0.05); p.rect(0, 13, 2, 3, C.plankDark); p.rect(14, 13, 2, 3, C.plankDark); });
tile('bed_item', (p) => { p.transparent(); p.rect(1, 6, 14, 4, hex('#b8322c'), 0.05); p.rect(1, 6, 4, 4, C.wool); p.rect(1, 10, 14, 2, C.plank); p.rect(1, 12, 2, 2, C.plankDark); p.rect(13, 12, 2, 2, C.plankDark); });
tile('bookshelf', (p) => {
  painters.planks(p);
  const colors = [hex('#8a2f2f'), hex('#2f4f8a'), hex('#3c7a3a'), hex('#8a7a2f'), hex('#6a3a8a')];
  for (const y0 of [1, 9]) {
    let x = 1;
    while (x < 15) {
      const w = 1 + Math.floor(p.rand() * 2), h = 5 + Math.floor(p.rand() * 2);
      p.rect(x, y0 + (6 - h), w, h, colors[Math.floor(p.rand() * colors.length)], 0.08);
      x += w;
    }
    p.rect(0, y0 + 6, 16, 1, C.plankDark);
  }
});
const metalBlock = (c: RGB) => (p: Painter) => {
  p.fill(c, 0.03);
  for (let i = 0; i < S; i++) { p.shade(i, 15, 0.7); p.shade(15, i, 0.7); p.shade(i, 0, 1.15); p.shade(0, i, 1.15); }
  for (let i = 2; i < 6; i++) p.set(i, 7 - i, C.white, 200);
};
tile('iron_block', metalBlock(C.metalIron));
tile('gold_block', metalBlock(C.metalGold));
tile('diamond_block', metalBlock(C.metalDiamond));
tile('ladder', (p) => {
  p.transparent();
  for (let y = 0; y < S; y++) { p.set(2, y, C.plankDark); p.set(3, y, C.plank); p.set(12, y, C.plank); p.set(13, y, C.plankDark); }
  for (let y = 2; y < S; y += 4) for (let x = 2; x < 14; x++) p.set(x, y, p.jit(C.plank, 0.05));
});
tile('sapling', (p) => {
  p.transparent();
  p.sprite([
    '................', '................', '......ll........', '....llllll......',
    '...lllLllll.....', '..llLlllLlll....', '...lllllllll....', '....lLlllll.....',
    '......lll.......', '.......t........', '.......t........', '.......t........',
    '......tt........', '.......t........', '.......t........', '.......t........',
  ], { l: hex('#4f8a2e'), L: hex('#3b6e22'), t: C.bark }, 0.1);
});
for (let s = 0; s <= 7; s++) {
  tile('wheat_' + s, (p) => {
    p.transparent();
    const h = 3 + s * 1.5;
    const col = s === 7 ? hex('#c9a83a') : s > 4 ? hex('#8aa83a') : hex('#4f9a2e');
    for (let b = 0; b < 5; b++) {
      const x = 2 + b * 3;
      for (let y = 15; y > 15 - h; y--) p.set(x, y, p.jit(col, 0.1));
      if (s >= 5) { p.set(x - 1, Math.floor(16 - h), p.jit(col, 0.1)); p.set(x + 1, Math.floor(17 - h), p.jit(col, 0.1)); }
    }
  });
}
tile('farmland', (p) => { p.fill(hex('#5e3d22'), 0.06); for (let y = 1; y < S; y += 4) for (let x = 0; x < S; x++) p.shade(x, y, 0.7); p.border(hex('#4a2f1a')); });
tile('tnt_side', (p) => {
  p.fill(hex('#c23a2a'), 0.05);
  for (let x = 0; x < S; x += 4) p.rect(x, 0, 1, 16, hex('#8f2a1f'));
  p.rect(0, 6, 16, 4, hex('#e8e1cc'), 0.02);
  for (let x = 2; x < 14; x += 3) p.rect(x, 7, 2, 2, hex('#2a2a2a'));
});
tile('tnt_top', (p) => { p.fill(hex('#b8352a'), 0.05); p.rect(6, 6, 4, 4, hex('#e8e1cc')); p.rect(7, 7, 2, 2, hex('#2a2a2a')); });
tile('tnt_bottom', (p) => { p.fill(hex('#9a2c22'), 0.05); });
tile('pumpkin_side', (p) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, p.jit(x % 4 === 0 ? hex('#b86a12') : hex('#e08a1c'), 0.05)); });
tile('pumpkin_top', (p) => { painters.pumpkin_side(p); p.rect(7, 6, 2, 3, hex('#5a7a2a')); });
tile('sugar_cane', (p) => {
  p.transparent();
  for (const x of [3, 8, 12]) for (let y = 0; y < S; y++) { p.set(x, y, p.jit(hex('#c8d4be'), 0.06)); p.set(x + 1, y, p.jit(hex('#aab8a0'), 0.06)); if (y % 5 === 0) { p.shade(x, y, 0.75); p.shade(x + 1, y, 0.75); } }
});
// Breaking: the block fractures into shards. Seams spread out from a few
// impact points stage by stage, with lit chipped edges, and pieces start
// crumbling away near the end. Each stage contains everything before it.
const FRACTURE = (() => {
  const rand = mulberry32(4242);
  const pts: [number, number][] = [];
  for (let i = 0; i < 9; i++) pts.push([rand() * S, rand() * S]);
  const cell = new Int8Array(S * S);
  const seam: { x: number; y: number; rank: number }[] = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let d1 = 1e9, d2 = 1e9, best = 0;
    pts.forEach(([px, py], i) => {
      const d = (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2;
      if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
    });
    cell[x + y * S] = best;
    if (Math.sqrt(d2) - Math.sqrt(d1) < 0.9) {
      // Seams nearer the centre appear first.
      seam.push({ x, y, rank: Math.hypot(x - 7.5, y - 7.5) + rand() * 3 });
    }
  }
  seam.sort((a, b) => a.rank - b.rank);
  const chips: [number, number][] = [];
  for (const p of seam) if (rand() < 0.35) chips.push([p.x + (rand() < 0.5 ? 1 : -1), p.y]);
  return { seam, chips, cell };
})();
for (let s = 0; s < 10; s++) {
  tile('destroy_' + s, (p) => {
    p.transparent();
    const t = (s + 1) / 10;
    const shown = FRACTURE.seam.slice(0, Math.ceil(FRACTURE.seam.length * Math.min(1, t * 1.15)));
    for (const q of shown) {
      p.set(q.x, q.y, [18, 14, 10], 190);
      // A lit edge on one side of each seam makes it read as a split, not a drawn line.
      if (q.x + 1 < S && q.y + 1 < S) p.set(q.x + 1, q.y + 1, [255, 250, 235], 45);
    }
    // Late stages: fragments crumble out along the seams.
    if (s >= 5) {
      const n = Math.floor(FRACTURE.chips.length * ((s - 4) / 5));
      for (const [x, y] of FRACTURE.chips.slice(0, n)) if (x >= 0 && x < S) p.set(x, y, [8, 6, 4], 220);
    }
    // Whole shards darken slightly as they loosen.
    if (s >= 7) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (p.alpha(x, y) === 0 && FRACTURE.cell[x + y * S] % 3 === s % 3) p.set(x, y, [0, 0, 0], 45);
      }
    }
  });
}

// ---------- Items ----------
const outlineDark = hex('#2a1e14');
tile('stick', (p) => { p.transparent(); for (let i = 0; i < 10; i++) { p.set(3 + i, 12 - i, C.stick); p.set(4 + i, 12 - i, C.stickDark); } });
tile('coal', (p) => { p.transparent(); p.sprite(['....kkkk....', '..kkKkkkkk..', '.kkkkkkKkkk.', '.kKkkkkkkkk.', 'kkkkkkkkkKkk', 'kkkKkkkkkkkk', '.kkkkkkkkkk.', '..kkkkKkkk..', '....kkkk....'], { k: hex('#2a2a2e'), K: hex('#55555c') }, 0.08, 2, 4); });
const ingot = (c: RGB, dark: RGB) => (p: Painter) => {
  p.transparent();
  p.sprite(['....hhhhhhhh', '...hccccccch', '..hccccccchd', '.hccccccchdd', 'hccccccchddd', 'dddddddddd..'], { h: [Math.min(255, c[0] * 1.2), Math.min(255, c[1] * 1.2), Math.min(255, c[2] * 1.2)], c, d: dark }, 0.03, 2, 6);
};
tile('iron_ingot', ingot(C.metalIron, hex('#8f8f8f')));
tile('gold_ingot', ingot(C.metalGold, hex('#b8901a')));
tile('diamond', (p) => { p.transparent(); p.sprite(['...hhhhhh...', '..hccchccch..', '.hcccchccccd.', 'hddddddddddd', '.dccccccccd.', '..dccccccd..', '...dccccd...', '....dccd....', '.....dd.....'].map((r) => r.slice(0, 12)), { h: hex('#c8fff8'), c: C.metalDiamond, d: hex('#2aa8a0') }, 0.03, 2, 3); });
tile('string', (p) => { p.transparent(); for (let i = 0; i < 12; i++) p.set(2 + i, 8 + Math.round(Math.sin(i * 0.9) * 3), hex('#eeeeee')); });
tile('apple', (p) => { p.transparent(); p.sprite(['......s.....', '.....sl.....', '..rrrsrrr...', '.rrhrrrrrr..', 'rrhrrrrrrrr.', 'rrrrrrrrrrr.', 'rrrrrrrrrrd.', '.rrrrrrrrd..', '..rrrrrrd...', '...rr.rr....'], { s: C.stickDark, l: hex('#4f9a2e'), r: hex('#d02a2a'), h: hex('#ff8a7a'), d: hex('#8a1a1a') }, 0.04, 2, 3); });
const meat = (c: RGB, fat: RGB) => (p: Painter) => { p.transparent(); p.sprite(['...cccccc...', '.ccccfcccc..', 'cccfccccccc.', 'cccccccfcccd', 'ccfcccccccdd', '.cccccccddd.', '...ddddd....'], { c, f: fat, d: [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7] }, 0.06, 2, 5); };
tile('raw_pork', meat(hex('#e8908a'), hex('#f8d0c8')));
tile('cooked_pork', meat(hex('#b0703a'), hex('#e0b070')));
tile('raw_mutton', meat(hex('#d8544a'), hex('#f0c0b0')));
tile('cooked_mutton', meat(hex('#8a4a2a'), hex('#c8904a')));
const drumstick = (c: RGB) => (p: Painter) => { p.transparent(); p.sprite(['....cccc....', '..cccccccc..', '.cccccccccc.', '.ccccccccdd.', '..cccccddd..', '....ccdd....', '.....bb.....', '....b..b....'], { c, d: [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], b: hex('#f0ead8') }, 0.06, 2, 3); };
tile('raw_chicken', drumstick(hex('#f0c8b0')));
tile('cooked_chicken', drumstick(hex('#c07a3a')));
tile('rotten_flesh', meat(hex('#7a8a3a'), hex('#a05a3a')));
tile('bone', (p) => { p.transparent(); for (let i = 0; i < 9; i++) { p.set(4 + i, 11 - i, hex('#eeeadb')); p.set(5 + i, 11 - i, hex('#cfc9b4')); } p.rect(2, 11, 3, 3, hex('#eeeadb')); p.rect(12, 2, 3, 3, hex('#eeeadb')); });
tile('feather', (p) => { p.transparent(); for (let i = 0; i < 11; i++) { p.set(3 + i, 13 - i, hex('#b0b0b0')); p.set(4 + i, 12 - i, hex('#f4f4f4')); p.set(5 + i, 13 - i, hex('#e0e0e0')); } });
tile('flint', (p) => { p.transparent(); p.sprite(['...kk...', '..kkKk..', '.kkkkkk.', 'kkKkkkkk', 'kkkkkkKk', '.kkkkkk.', '..kkkk..'], { k: hex('#3a3a3e'), K: hex('#7a7a80') }, 0.06, 4, 5); });
tile('bread', (p) => { p.transparent(); p.sprite(['...bbbbbbb..', '.bbhbbhbbbbb', 'bbbbbbbbbbbd', 'bbbbbbbbbbdd', '.ddddddddddd'], { b: hex('#c8883a'), h: hex('#e8b060'), d: hex('#8a5a22') }, 0.05, 2, 6); });
tile('wheat_item', (p) => { p.transparent(); for (let b = 0; b < 4; b++) for (let i = 0; i < 10; i++) p.set(3 + b * 2 + Math.floor(i / 4), 14 - i, p.jit(hex('#d8b84a'), 0.1)); });
tile('seeds', (p) => { p.transparent(); for (let i = 0; i < 7; i++) { const x = 3 + Math.floor(p.rand() * 10), y = 5 + Math.floor(p.rand() * 8); p.set(x, y, hex('#4f9a2e')); p.set(x + 1, y, hex('#3a7a22')); } });
const bucket = (fill: RGB | null) => (p: Painter) => {
  p.transparent();
  p.sprite(['.dddddddddd.', 'dhhhhhhhhhhd', 'dffffffffffd', '.dmmmmmmmmd.', '.dmmmmmmmmd.', '..dmmmmmmd..', '..dmmmmmmd..', '...dddddd...'], { d: hex('#5a5a5a'), h: hex('#e0e0e0'), f: fill ?? hex('#3a3a3a'), m: hex('#bcbcbc') }, 0.04, 2, 5);
};
tile('bucket', bucket(null));
tile('water_bucket', bucket(C.water));
tile('lava_bucket', bucket(C.lava));
tile('flint_and_steel', (p) => { p.transparent(); p.sprite(['..mmmm......', '.m....m.....', '.m....m.....', '..mmmm......', '......kk....', '.....kkKk...', '.....kkkk...', '......kk....'], { m: hex('#cfcfcf'), k: hex('#3a3a3e'), K: hex('#7a7a80') }, 0.05, 2, 4); });
tile('paper', (p) => { p.transparent(); p.rect(3, 2, 10, 12, hex('#f4f2ea'), 0.02); for (let y = 4; y < 13; y += 2) p.rect(5, y, 6, 1, hex('#cfcabb')); });
tile('sugar', (p) => { p.transparent(); for (let i = 0; i < 26; i++) p.set(4 + Math.floor(p.rand() * 8), 7 + Math.floor(p.rand() * 6), hex('#f8f8f8')); });

// ---------- Batch 2: new blocks and items ----------
tile('spawner', (p) => {
  p.transparent();
  const bar = hex('#2a2f3a'), hi = hex('#4a5366');
  for (let i = 0; i < S; i++) {
    for (const k of [0, 5, 10, 15]) { p.set(k, i, i % 5 === 0 ? hi : bar); p.set(i, k, i % 5 === 0 ? hi : bar); }
  }
  for (let i = 0; i < 6; i++) p.set(6 + (i % 3) * 2, 6 + Math.floor(i / 3) * 3, hex('#6a2a8a'), 140);
});
tile('enchant_top', (p) => {
  p.fill(hex('#8a2230'), 0.05);
  p.border(hex('#2a0f14'));
  p.rect(4, 4, 8, 8, hex('#e8e0c8'), 0.03);
  for (let y = 5; y < 11; y += 2) p.rect(5, y, 6, 1, hex('#6a5ab0'));
});
tile('enchant_side', (p) => {
  p.fill(C.obsidian, 0.1);
  p.rect(0, 0, 16, 4, hex('#8a2230'), 0.05);
  p.rect(0, 4, 16, 1, hex('#e0b040'));
  p.speckle(hex('#7a4ab0'), 0.06);
});
tile('fence_item', (p) => {
  p.transparent();
  for (const x of [2, 12]) p.rect(x, 1, 3, 15, C.plank, 0.05);
  for (const y of [4, 10]) p.rect(0, y, 16, 2, C.plankDark, 0.05);
});
tile('gate_item', (p) => {
  p.transparent();
  for (const x of [0, 13]) p.rect(x, 2, 3, 12, C.plank, 0.05);
  for (const y of [4, 10]) p.rect(3, y, 10, 2, C.plankDark, 0.05);
  p.rect(7, 4, 2, 8, C.plank, 0.05);
});
for (let s = 0; s <= 3; s++) {
  tile('carrots_' + s, (p) => {
    p.transparent();
    for (let b = 0; b < 4; b++) {
      const x = 2 + b * 4, h = 3 + s * 2;
      for (let y = 15; y > 15 - h; y--) p.set(x + ((y + b) % 2), y, p.jit(hex('#4f9a2e'), 0.12));
      if (s === 3) { p.set(x, 15, hex('#e8782a')); p.set(x + 1, 15, hex('#c85a1a')); }
    }
  });
}
tile('leather', (p) => { p.transparent(); p.sprite(['..hhhhhhh...', '.hhhhhhhhhh.', 'hhhdhhhhhhhh', 'hhhhhhhdhhhh', '.hhhhhhhhhh.', '..hhhhhhhh..', '...hh..hh...'], { h: hex('#9a5a2a'), d: hex('#7a4420') }, 0.06, 2, 4); });
const bowSprite = (pulled: boolean) => (p: Painter) => {
  p.transparent();
  const wood = hex('#8a5a2a'), dark = hex('#5a3a1a'), str = hex('#dcdcdc');
  const arc: [number, number][] = [[3, 13], [3, 12], [4, 11], [4, 10], [5, 9], [5, 8], [6, 7], [7, 6], [8, 5], [9, 5], [10, 4], [11, 4], [12, 3], [13, 3]];
  arc.forEach(([x, y], i) => { p.set(x, y, i % 3 ? wood : dark); p.set(x + 1, y + 1, dark); });
  const pull = pulled ? 3 : 0;
  for (let i = 0; i < 10; i++) p.set(3 + i + (i > 3 && i < 7 ? 0 : 0), 13 - i - pull + (pull ? Math.abs(i - 5) * 0.6 : 0) | 0, str);
  if (pulled) { for (let i = 0; i < 7; i++) p.set(5 + i, 11 - i, hex('#c8c8c8')); }
};
tile('bow', bowSprite(false));
tile('bow_pull', bowSprite(true));
tile('arrow', (p) => {
  p.transparent();
  for (let i = 0; i < 10; i++) p.set(3 + i, 12 - i, C.stick);
  p.sprite(['.hh', 'hhh', 'hh.'], { h: hex('#bcbcbc') }, 0.04, 12, 1);
  p.sprite(['f.f', '.f.', 'f.f'], { f: hex('#f0f0f0') }, 0.04, 2, 11);
});
// ---------- Rails ----------
const railTile = (rail: RGB, rail2: RGB, tie: RGB, curve: boolean, glow?: RGB) => (p: Painter) => {
  p.transparent();
  if (!curve) {
    for (let y = 1; y < S; y += 4) p.rect(1, y, 14, 2, tie, 0.08);                 // sleepers
    for (const x of [3, 11]) { p.rect(x, 0, 2, S, rail, 0.04); p.rect(x, 0, 1, S, rail2); }
    if (glow) for (let y = 0; y < S; y += 2) { p.set(7, y, glow); p.set(8, y + 1, glow); }
  } else {
    // A quarter turn from the south edge to the east edge.
    for (let k = 0; k < 5; k++) { const a = (k / 4) * Math.PI / 2; p.rect(Math.round(16 - Math.cos(a) * 10) - 1, Math.round(16 - Math.sin(a) * 10) - 1, 3, 3, tie, 0.08); }
    for (const r of [4.5, 12.5]) for (let t = 0; t <= 60; t++) {
      const a = (t / 60) * Math.PI / 2;
      const x = Math.round(16 - Math.cos(a) * r), y = Math.round(16 - Math.sin(a) * r);
      p.set(x, y, rail); p.set(x - 1, y, rail2);
    }
  }
};
tile('rail', railTile(hex('#9a9aa0'), hex('#c8c8cc'), hex('#6a4a2a'), false));
tile('rail_curve', railTile(hex('#9a9aa0'), hex('#c8c8cc'), hex('#6a4a2a'), true));
tile('powered_rail', railTile(hex('#c8a040'), hex('#e8c860'), hex('#5a3a22'), false, hex('#6a1a14')));
tile('powered_rail_on', railTile(hex('#e8b840'), hex('#fff0a0'), hex('#5a3a22'), false, hex('#ff5a3a')));

// ---------- Boat, minecart, saddle ----------
tile('boat', (p) => { p.transparent(); p.sprite(['p............p', 'pp..........pp', 'pdpppppppppppd', '.pdddddddddddp.', '..pppppppppp..'].map((r) => r.slice(0, 14)), { p: hex('#a8804a'), d: hex('#7a5a30') }, 0.05, 1, 6); });
tile('minecart', (p) => { p.transparent(); p.sprite(['mmmmmmmmmmmm', 'mhhhhhhhhhhm', 'm..........m', 'mmmmmmmmmmmm', '.w.......w..', 'www.....www.', '.w.......w..'], { m: hex('#8a8a90'), h: hex('#b8b8be'), w: hex('#3a3a3e') }, 0.05, 2, 5); });
tile('saddle', (p) => { p.transparent(); p.sprite(['....llll....', '..llllllll..', '.lllgllllll.', 'lllllllllldl', 'l.dllllld..l', 'i..l....l..i', 'i..l....l..i'], { l: hex('#7a4a28'), d: hex('#5a3418'), g: hex('#c8a048'), i: hex('#9a9aa0') }, 0.05, 2, 4); });

// ---------- Power components ----------
const machineSide = (p: Painter) => { p.fill(hex('#7a7a7e'), 0.08); p.border(hex('#4a4a4e')); };
tile('piston_side', (p) => { p.fill(hex('#7a7a7e'), 0.08); p.rect(0, 0, 16, 4, C.plank, 0.05); p.rect(0, 4, 16, 1, C.plankDark); p.rect(7, 5, 2, 11, hex('#9a9aa0')); p.border(hex('#4a4a4e')); });
tile('piston_top', (p) => { p.fill(C.plank, 0.05); for (let y = 0; y < S; y += 4) p.rect(0, y, 16, 1, C.plankDark); p.rect(6, 6, 4, 4, hex('#9a9aa0')); p.border(hex('#5a4020')); });
tile('piston_top_sticky', (p) => { painters['piston_top'](p); for (let i = 0; i < 40; i++) p.set(2 + Math.floor(p.rand() * 12), 2 + Math.floor(p.rand() * 12), hex(p.rand() < 0.5 ? '#6a9a3a' : '#8ac050')); });
tile('piston_bottom', (p) => { machineSide(p); p.rect(5, 5, 6, 6, hex('#5a5a5e')); });
tile('piston_inner', (p) => { machineSide(p); p.rect(4, 4, 8, 8, hex('#3a3a3e')); p.rect(6, 6, 4, 4, hex('#9a9aa0')); });
tile('hopper_top', (p) => { p.fill(hex('#4a4a50'), 0.06); p.rect(2, 2, 12, 12, hex('#2a2a2e')); p.border(hex('#7a7a80')); });
tile('hopper_side', (p) => { p.fill(hex('#5a5a60'), 0.08); p.border(hex('#3a3a3e')); p.rect(2, 7, 12, 1, hex('#7a7a80')); });
tile('hopper_item', (p) => { p.transparent(); p.sprite(['mmmmmmmmmmmm', 'mddddddddddm', '.mmmmmmmmmm.', '..mddddddm..', '...mddddm...', '....mddm....', '.....mm.....'], { m: hex('#7a7a80'), d: hex('#3a3a3e') }, 0.04, 2, 4); });
tile('watcher_face', (p) => { p.fill(hex('#5a5a60'), 0.06); p.border(hex('#3a3a3e')); p.rect(3, 5, 10, 6, hex('#1a1a1e')); p.rect(5, 6, 6, 4, hex('#3ac8c0')); p.rect(7, 7, 2, 2, hex('#0a2a28')); p.set(6, 6, hex('#c8fff8')); });
tile('watcher_side', (p) => { p.fill(hex('#6a6a70'), 0.08); p.border(hex('#3a3a3e')); for (let y = 3; y < 13; y += 3) p.rect(2, y, 12, 1, hex('#4a4a50')); });
tile('watcher_back', (p) => { p.fill(hex('#6a6a70'), 0.08); p.border(hex('#3a3a3e')); p.rect(6, 6, 4, 4, hex('#5a1a14')); });
tile('watcher_back_on', (p) => { p.fill(hex('#6a6a70'), 0.08); p.border(hex('#3a3a3e')); p.rect(6, 6, 4, 4, hex('#ff5a3a')); p.set(7, 7, hex('#ffd0a0')); });
const repeaterTop = (on: boolean) => (p: Painter) => { p.fill(hex('#9a9a98'), 0.05); p.border(hex('#7a7a78')); for (let y = 1; y < 15; y++) { p.set(7, y, hex(on ? '#ff5a3a' : '#6a1a14')); p.set(8, y, hex(on ? '#e84a2a' : '#5a1410')); } p.rect(6, 12, 4, 2, hex('#6a6a68')); };
tile('repeater', repeaterTop(false));
tile('repeater_on', repeaterTop(true));
tile('repeater_torch', (p) => { p.fill(hex('#5a1410')); p.rect(0, 0, 16, 4, hex('#8a2a1e')); });
tile('repeater_torch_on', (p) => { p.fill(hex('#c83a24')); p.rect(0, 0, 16, 4, hex('#ffb08a')); });
tile('repeater_item', (p) => { p.transparent(); p.rect(1, 9, 14, 4, hex('#9a9a98'), 0.05); p.rect(1, 9, 14, 1, hex('#b8b8b6')); for (const x of [4, 10]) { p.rect(x, 4, 2, 5, hex('#8a2a1e')); p.rect(x, 3, 2, 2, hex('#ff5a3a')); } });

// ---------- Brewing, potions, shield, crossbow ----------
const bottle = (liquid: RGB | null, splash: boolean) => (p: Painter) => {
  p.transparent();
  const glass = hex('#c8dcec'), rim = hex('#8aa4b8'), cork = hex('#9a6a3a');
  // A round flask (drinkable) or a squat, wide-necked one (splash).
  const rows = splash
    ? ['....cccc....', '....gccg....', '...gg..gg...', '..g......g..', '.g........g.', 'g..........g', 'g..........g', 'g..........g', '.g........g.', '..gggggggg..']
    : ['.....cc.....', '.....cc.....', '....gccg....', '....g..g....', '...g....g...', '..g......g..', '.g........g.', '.g........g.', '.g........g.', '..g......g..', '...gggggg...'];
  const oy = splash ? 4 : 3;
  p.sprite(rows, { c: cork, g: rim }, 0.02, 2, oy);
  // Fill: glass-tinted interior, liquid in the lower part.
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y];
    const a = r.indexOf('g'), b = r.lastIndexOf('g');
    if (a < 0 || b <= a) continue;
    for (let x = a + 1; x < b; x++) {
      const deep = y >= (splash ? 4 : 5);
      const c = liquid && deep ? liquid : glass;
      p.set(2 + x, oy + y, [c[0] * (0.92 + 0.08 * ((x + y) % 2)), c[1] * (0.92 + 0.08 * ((x + y) % 2)), c[2] * (0.92 + 0.08 * ((x + y) % 2))], liquid && deep ? 255 : 110);
    }
  }
  if (liquid) p.set(2 + (splash ? 3 : 4), oy + (splash ? 5 : 6), hex('#ffffff'), 200);
};
tile('glass_bottle', bottle(null, false));
tile('water_bottle', bottle(hex('#3b6fd6'), false));
for (const [effect, def] of Object.entries(EFFECTS)) {
  if (effect === 'hero') continue;
  tile('potion_' + effect, bottle(hex(def.color), false));
  tile('splash_potion_' + effect, bottle(hex(def.color), true));
}
tile('brewing_top', (p) => {
  p.fill(hex('#7a7a7e'), 0.08);
  p.border(hex('#4a4a4e'));
  p.rect(7, 7, 2, 2, hex('#e8c848'));
  for (const [x, y] of [[3, 3], [11, 3], [7, 12]]) p.rect(x, y, 2, 2, hex('#b8d0e0'));
});
tile('brewing_side', (p) => {
  p.transparent();
  p.rect(0, 12, 16, 4, hex('#6a6a6e'), 0.08);
  p.rect(7, 1, 2, 11, hex('#e8c848'), 0.06);
  for (const x of [1, 11]) { p.rect(x, 7, 4, 5, hex('#b8d0e0'), 0.04); p.rect(x + 1, 9, 2, 3, hex('#d85a8a')); }
});
tile('brewing_item', (p) => {
  p.transparent();
  p.rect(2, 13, 12, 2, hex('#6a6a6e'), 0.08);
  p.rect(7, 2, 2, 11, hex('#e8c848'), 0.06);
  for (const x of [2, 10]) { p.rect(x, 8, 4, 5, hex('#b8d0e0'), 0.04); p.rect(x + 1, 10, 2, 3, hex('#d85a8a')); }
});
tile('shield', (p) => {
  p.transparent();
  const rows = ['.mmmmmmmmmm.', 'mwwwwwwwwwwm', 'mwwwwwwwwwwm', 'mwwbbbbbbwwm', 'mwwbwwwwbwwm', 'mwwbwwwwbwwm', 'mwwbbbbbbwwm', 'mwwwwwwwwwwm', '.mwwwwwwwwm.', '..mwwwwwwm..', '...mmwwmm...', '.....mm.....'];
  p.sprite(rows, { m: hex('#8a8a90'), w: hex('#9a6a3a'), b: hex('#c8a048') }, 0.05, 2, 2);
});
const crossbowSprite = (loaded: boolean) => (p: Painter) => {
  p.transparent();
  const wood = hex('#8a5a2a'), dark = hex('#5a3a1a'), metal = hex('#9a9aa0'), str = hex('#dcdcdc');
  for (let i = 0; i < 11; i++) { p.set(3 + i, 12 - i, i % 2 ? wood : dark); p.set(4 + i, 12 - i, dark); }   // stock
  const limb: [number, number][] = [[2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [9, 13], [10, 12], [11, 11], [12, 10], [13, 9]];
  for (const [x, y] of limb) p.set(x, y, metal);
  for (let i = 0; i < 8; i++) p.set(2 + i + (loaded ? 1 : 0), 6 + i - (loaded ? 1 : 0), str);             // string
  if (loaded) { for (let i = 0; i < 6; i++) p.set(6 + i, 9 - i, hex('#c8c8c8')); p.set(12, 3, hex('#e8e8e8')); p.set(12, 4, hex('#e8e8e8')); }
};
tile('crossbow', crossbowSprite(false));
tile('crossbow_loaded', crossbowSprite(true));
tile('bog_slime', (p) => { p.transparent(); p.sprite(['...gggg...', '..gGggGg..', '.gggggggg.', 'gggGggggGg', 'gggggggggg', '.gggGgggg.', '..gggggg..'], { g: hex('#6a9a3a'), G: hex('#a8d060') }, 0.06, 3, 5); });

tile('shears', (p) => { p.transparent(); p.sprite(['......mm', '.....mhm', '....mhm.', '...mhm..', 'kkmhm...', 'k.km....', 'kkk.....'], { m: hex('#9a9a9a'), h: hex('#e8e8e8'), k: hex('#5a3a2a') }, 0.03, 4, 4); });
tile('bone_meal', (p) => { p.transparent(); for (let i = 0; i < 30; i++) p.set(4 + Math.floor(p.rand() * 8), 6 + Math.floor(p.rand() * 7), hex('#eeeadb')); });
tile('snowball', (p) => { p.transparent(); p.sprite(['..www..', '.wwwww.', 'wwwwwws', 'wwwwwss', '.wwwss.', '..sss..'], { w: hex('#fbfdff'), s: hex('#c8d8e8') }, 0.02, 4, 5); });
tile('egg', (p) => { p.transparent(); p.sprite(['..ee..', '.eeee.', 'eeeees', 'eeeess', 'eeeess', '.esss.'], { e: hex('#e8d8b8'), s: hex('#c8b090') }, 0.03, 5, 5); });
tile('book', (p) => { p.transparent(); p.rect(3, 3, 10, 11, hex('#7a3a1a'), 0.05); p.rect(4, 4, 8, 9, hex('#9a4a22'), 0.05); p.rect(12, 4, 1, 10, hex('#efe6d2')); });
tile('fishing_rod', (p) => {
  p.transparent();
  for (let i = 0; i < 11; i++) { p.set(2 + i, 14 - i, C.stick); }
  for (let y = 4; y < 13; y++) p.set(13, y, hex('#dcdcdc'));
  p.set(12, 13, hex('#9a9a9a')); p.set(13, 13, hex('#9a9a9a'));
});
const fish = (body: RGB, belly: RGB) => (p: Painter) => { p.transparent(); p.sprite(['....bbbb...t', '..bbbbbbb.tt', '.bkbbbbbbbtt', 'bbbbbbbbbbt.', '.dddddddd.tt', '..dddddd...t'], { b: body, d: belly, k: hex('#101010'), t: [body[0] * 0.8, body[1] * 0.8, body[2] * 0.8] }, 0.05, 2, 5); };
tile('raw_fish', fish(hex('#6a8ab0'), hex('#c8d8e0')));
tile('cooked_fish', fish(hex('#b07a3a'), hex('#e0b070')));
tile('carrot', (p) => { p.transparent(); for (let i = 0; i < 9; i++) { p.set(4 + i, 12 - i, hex('#e8782a')); p.set(5 + i, 12 - i, hex('#c85a1a')); if (i < 7) p.set(4 + i, 13 - i, hex('#d8681f')); } p.sprite(['g.g', '.gg', 'gg.'], { g: hex('#4f9a2e') }, 0.05, 12, 1); });
tile('gunpowder', (p) => { p.transparent(); for (let i = 0; i < 40; i++) p.set(4 + Math.floor(p.rand() * 8), 6 + Math.floor(p.rand() * 7), p.rand() < 0.5 ? hex('#5a5a5a') : hex('#3a3a3a')); });
tile('glow_dust', (p) => { p.transparent(); for (let i = 0; i < 34; i++) p.set(4 + Math.floor(p.rand() * 8), 6 + Math.floor(p.rand() * 7), p.rand() < 0.5 ? hex('#f8d870') : hex('#d8a040')); });

// ---------- Living world: crops, bees, fish ----------
for (let st = 0; st <= 3; st++) {
  tile('potatoes_' + st, (p) => {
    p.transparent();
    for (let b = 0; b < 3; b++) {
      const cx = 3 + b * 5, h = 3 + st * 2;
      for (let y = 15; y > 15 - h; y--) { p.set(cx + ((y + b) % 2), y, p.jit(hex('#4a8a2a'), 0.12)); if (y < 13) { p.set(cx - 1, y, p.jit(hex('#5a9a36'), 0.1)); p.set(cx + 2, y, p.jit(hex('#3e7a24'), 0.1)); } }
      if (st === 3) { p.set(cx, 15 - h, hex('#f0f0e8')); p.set(cx + 1, 15 - h, hex('#f0e060')); p.set(cx, 15, hex('#c8a060')); }
    }
  });
  tile('redroot_' + st, (p) => {
    p.transparent();
    for (let b = 0; b < 4; b++) {
      const cx = 2 + b * 4, h = 2 + st * 2;
      for (let y = 15; y > 15 - h; y--) p.set(cx + (y % 2), y, p.jit(hex(y > 12 ? '#8a2a3a' : '#5a9a36'), 0.1));
      if (st >= 2) p.set(cx + 1, 16 - h, p.jit(hex('#6aa83e'), 0.1));
      if (st === 3) { p.set(cx, 15, hex('#b8243a')); p.set(cx + 1, 15, hex('#d83a50')); }
    }
  });
}
const combCells = (p: Painter, base: string, cell: string) => {
  p.fill(hex(base), 0.06);
  for (let y = 1; y < S; y += 4) for (let x = (y % 8 === 1 ? 1 : 3); x < S; x += 4) { p.rect(x, y, 2, 2, hex(cell)); }
};
tile('nest_side', (p) => { combCells(p, '#c89a4a', '#9a6a2a'); p.rect(6, 7, 4, 3, hex('#2a1a10')); p.border(hex('#8a5a2a')); });
tile('nest_honey', (p) => { combCells(p, '#c89a4a', '#9a6a2a'); p.rect(6, 7, 4, 3, hex('#2a1a10')); for (const x of [3, 7, 11]) p.rect(x, 9, 2, 5 + (x % 3), hex('#f0a820')); p.border(hex('#8a5a2a')); });
tile('hive_side', (p) => { p.fill(C.plank, 0.05); for (let y = 0; y < S; y += 4) p.rect(0, y, 16, 1, C.plankDark); p.rect(5, 8, 6, 3, hex('#2a1a10')); p.rect(4, 11, 8, 1, C.plankDark); });
tile('hive_honey', (p) => { painters['hive_side'](p); for (const x of [5, 8, 10]) p.rect(x, 11, 1, 3 + (x % 3), hex('#f0a820')); p.rect(5, 8, 6, 3, hex('#f0a820')); });
tile('potato', (p) => { p.transparent(); p.sprite(['..pppp..', '.ppppdp.', 'pphpppp.', 'pppppdpp', '.pdpppp.', '..pppp..'], { p: hex('#c8a060'), h: hex('#e8c888'), d: hex('#8a6a3a') }, 0.06, 4, 5); });
tile('baked_potato', (p) => { p.transparent(); p.sprite(['..pppp..', '.pphhpp.', 'pphyyhpp', 'ppyyyypp', '.pppppp.', '..pppp..'], { p: hex('#b8803a'), h: hex('#f0e0a0'), y: hex('#f8d060') }, 0.06, 4, 5); });
tile('redroot', (p) => { p.transparent(); p.sprite(['...gg...', '..gggg..', '...rr...', '..rrrr..', '.rrhrrr.', '.rrrrrr.', '..rrrr..', '...rr...'], { g: hex('#5a9a36'), r: hex('#b8243a'), h: hex('#e85a6a') }, 0.06, 4, 3); });
tile('redroot_seeds', (p) => { p.transparent(); for (let i = 0; i < 10; i++) p.set(4 + Math.floor(p.rand() * 8), 6 + Math.floor(p.rand() * 6), hex(i % 2 ? '#8a2a3a' : '#6a1e2a')); });
tile('redroot_stew', (p) => { p.transparent(); p.sprite(['............', 'rrrrrrrrrrrr', 'wrrhrrrrrrrw', '.wrrrrrrrrw.', '..wwwwwwww..'], { r: hex('#b8243a'), h: hex('#e85a6a'), w: hex('#8a5a2a') }, 0.05, 2, 6); });
tile('honey_bottle', bottle(hex('#f0a820'), false));
tile('honeycomb', (p) => { p.transparent(); p.sprite(['..hhhh..', '.hchhch.', 'hhhhhhhh', 'hchhchhc', 'hhhhhhhh', '.hchhch.', '..hhhh..'], { h: hex('#f0b030'), c: hex('#c88a1a') }, 0.05, 4, 4); });
const fishSprite = (body: string, belly: string, fin: string, glow?: string) => (p: Painter) => { p.transparent(); p.sprite(['....bbbb...f', '..bbbbbbb.ff', '.bebbbbbbbff', 'bbbbbbbbbbf.', '.ylllllll.ff', '..llllll...f'], { b: hex(body), l: hex(belly), f: hex(fin), e: hex('#101010'), y: hex(glow ?? belly) }, 0.05, 2, 5); };
tile('salmon', fishSprite('#b8584a', '#e89a88', '#8a3a30'));
tile('cooked_salmon', fishSprite('#c8784a', '#e8b890', '#8a5a30'));
tile('glimmerfish', fishSprite('#3a8ab0', '#bfe8f0', '#2a6a90', '#7af0e8'));

// ---------- The Astral Gate and the Hollow ----------
tile('hollowstone', (p) => {
  p.ramp(p.field(3, 3), [hex('#a89cba'), hex('#b6abc6'), hex('#c3b9d1'), hex('#cfc6db'), hex('#dbd4e5')], 0.08);
  p.speckle(hex('#8e7fa8'), 0.05, 0.05);
  p.speckle(hex('#eee8f6'), 0.03, 0.03);
});
tile('hollow_bricks', (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const off = (y >> 2) % 2 ? 4 : 0;
    const gap = y % 4 === 3 || (x + off) % 8 === 7;
    p.set(x, y, gap ? p.jit(hex('#7a6e90'), 0.04) : p.jit(hex(y % 4 === 0 ? '#d6cde2' : '#c2b8d0'), 0.05));
  }
});
const frameStone = (p: Painter) => { p.ramp(p.field(3, 2), [hex('#1e2a36'), hex('#243242'), hex('#2a3a4c')], 0.06); p.speckle(hex('#3e5a70'), 0.06, 0.05); };
tile('astral_frame_side', (p) => { frameStone(p); p.rect(0, 0, 16, 3, hex('#2e4458')); p.rect(0, 3, 16, 1, hex('#c8a24a')); for (let x = 1; x < S; x += 4) p.rect(x, 8, 2, 2, hex('#6ad0e0')); p.rect(0, 13, 16, 1, hex('#c8a24a')); });
const frameTop = (lit: boolean) => (p: Painter) => {
  frameStone(p);
  p.border(hex('#c8a24a'));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 3) p.set(x, y, lit ? p.jit(hex('#bff6ff'), 0.05) : hex('#0a1016'));
    else if (d < 4.3) p.set(x, y, lit ? hex('#5ad8f0') : hex('#3a5a6e'));
  }
  // A star point at each compass mark.
  for (const [x, y] of [[7, 1], [8, 1], [7, 14], [8, 14], [1, 7], [1, 8], [14, 7], [14, 8]]) p.set(x, y, hex(lit ? '#e8fcff' : '#6ad0e0'));
};
tile('astral_frame_top', frameTop(false));
tile('astral_frame_top_full', frameTop(true));
tile('astral_eye', (p) => { p.fill(hex('#7ae8f8'), 0.1); p.rect(5, 5, 6, 6, hex('#d8fcff')); p.rect(7, 7, 2, 2, hex('#ffffff')); p.border(hex('#2a8aa8')); });
tile('astral_portal', (p) => {
  const f = p.field(2, 2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = f[x + y * S];
    p.set(x, y, v > 0.62 ? hex('#1c1a48') : v > 0.4 ? hex('#12102e') : hex('#08081a'));
  }
  for (let i = 0; i < 14; i++) p.set(Math.floor(p.rand() * S), Math.floor(p.rand() * S), [hex('#ffffff'), hex('#9ae8ff'), hex('#d8a8ff')][i % 3]);
});
tile('anchor_stone', (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const facet = ((x + y) >> 2) % 2 === 0, edge = (x + y) % 4 === 0 || (x - y + 16) % 6 === 0;
    p.set(x, y, edge ? hex('#fff0ff') : p.jit(hex(facet ? '#e86ae0' : '#9a4ae8'), 0.06));
  }
  p.border(hex('#5a2a8a'));
});
tile('starbloom', (p) => {
  p.transparent();
  for (let y = 8; y < S; y++) p.set(7 + (y % 3 === 0 ? 1 : 0), y, p.jit(hex('#9a8ab8'), 0.08));
  p.set(5, 12, hex('#9a8ab8')); p.set(6, 11, hex('#9a8ab8')); p.set(10, 11, hex('#9a8ab8')); p.set(9, 12, hex('#9a8ab8'));
  p.sprite(['...s...', '..sws..', 'sswCwss', '..sws..', '...s...'], { s: hex('#7ad8f0'), w: hex('#d8f8ff'), C: hex('#ffffff') }, 0.03, 4, 3);
});
tile('starseeker', (p) => {
  p.transparent();
  p.sprite(['.....b.....', '....bcb....', '...bcwcb...', '..bccwccb..', '.bcccwcccb.', 'bwwwwCwwwwb', '.bcccwcccb.', '..bccwccb..', '...bcwcb...', '....bcb....', '.....b.....'], { b: hex('#b8903a'), c: hex('#4ac8e0'), w: hex('#bff4ff'), C: hex('#ffffff') }, 0.04, 2, 2);
});
tile('glider', (p) => {
  p.transparent();
  p.sprite(['r............r', 'mr..........rm', 'mmr........rmm', 'mmmr......rmmm', 'mmmmr.hh.rmmmm', 'mmmmmrhhrmmmmm', '.mmmmmrrmmmmm.', '..mmmm..mmmm..', '...mm....mm...'], { m: hex('#6a58a8'), r: hex('#d8c8a0'), h: hex('#8a6a3a') }, 0.06, 1, 4);
});

// ---------- Instruments: compass, clock, spyglass, maps, name tag, lead ----------
tile('compass', (p) => {
  p.transparent();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 6.2) p.set(x, y, p.jit(hex(d > 5 ? '#8a8e92' : '#e8e0c8'), 0.04));
    else if (d < 7.2) p.set(x, y, hex('#4a4e52'));
  }
  for (let k = 1; k <= 4; k++) { p.set(8, 8 - k, hex('#c83a2a')); p.set(7, 7 + k, hex('#3a4a6a')); }
  p.set(7, 7, hex('#2a2a2a')); p.set(8, 8, hex('#2a2a2a'));
});
tile('clock', (p) => {
  p.transparent();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 6.2) p.set(x, y, y < 8 ? p.jit(hex('#6ab0e8'), 0.05) : p.jit(hex('#1a2250'), 0.05));
    else if (d < 7.2) p.set(x, y, hex('#d8a830'));
  }
  p.rect(3, 4, 3, 3, hex('#f8e060')); p.set(11, 10, hex('#e8e8ff')); p.set(12, 11, hex('#e8e8ff')); p.set(10, 12, hex('#e8e8ff'));
  p.rect(7, 2, 2, 12, hex('#3a2a10'), 0);
});
tile('spyglass', (p) => {
  p.transparent();
  for (let i = 0; i < 12; i++) { const x = 2 + i, y = 13 - i; const w = i < 5 ? 2 : 1; p.rect(x, y - w + 1, 2, w + 1, hex(i < 5 ? '#b8903a' : i < 9 ? '#d8b04a' : '#8a6a2a')); }
  p.rect(12, 1, 3, 3, hex('#9ae8ff')); p.set(13, 2, hex('#e8ffff'));
});
const parchment = (p: Painter) => { p.fill(hex('#e0d0a0'), 0.05); p.border(hex('#a88a5a')); };
tile('empty_map', (p) => { parchment(p); for (const y of [4, 7, 10]) p.rect(3, y, 10, 1, hex('#c8b488')); });
tile('filled_map', (p) => {
  parchment(p);
  p.rect(2, 2, 12, 12, hex('#6aa0c8'));
  p.sprite(['..gggg....', '.ggGggg...', 'gggggggs..', '.gGgg.ss..', '..gg...sss', '.......sss'], { g: hex('#6a9a4a'), G: hex('#4a7a3a'), s: hex('#d8c888') }, 0.05, 3, 4);
  p.border(hex('#a88a5a'));
});
tile('treasure_map', (p) => {
  parchment(p);
  p.rect(2, 2, 12, 12, hex('#c8b890'));
  for (const [x, y] of [[3, 12], [5, 11], [7, 10], [8, 8], [9, 6]]) p.set(x, y, hex('#8a5a3a'));
  p.set(10, 4, hex('#c82a2a')); p.set(12, 4, hex('#c82a2a')); p.set(11, 5, hex('#c82a2a')); p.set(10, 6, hex('#c82a2a')); p.set(12, 6, hex('#c82a2a'));
  p.border(hex('#a88a5a'));
});
tile('name_tag', (p) => {
  p.transparent();
  p.sprite(['....ttttttttt', '...tttttttttt', '..tttttttttt.', '.ttotttttttt.', '..tttttttttt.', '...tttttttttt', '....ttttttttt'], { t: hex('#e8d8b0'), o: hex('#6a5a4a') }, 0.04, 1, 5);
  for (let i = 0; i < 4; i++) p.set(2 - (i >> 1) + i, 4 - i, hex('#c8c0a8'));
});
tile('lead', (p) => {
  p.transparent();
  for (let a = 0; a < 6.2; a += 0.15) { const x = Math.round(7.5 + Math.cos(a) * 5), y = Math.round(6.5 + Math.sin(a) * 4); p.set(x, y, hex(a % 0.6 < 0.3 ? '#b89a6a' : '#8a6a4a')); }
  for (let y = 10; y < 15; y++) p.set(12 + (y % 2), y, hex('#8a6a4a'));
  p.rect(11, 9, 3, 2, hex('#5a9a4a'));
});

// ---------- Workshop and home: comparator, anvil, campfire, smoker, barrel, composter, frames, pots ----------
tile('comparator', (p) => { painters['repeater'](p); p.rect(3, 7, 10, 2, hex('#6a2a2a')); });
tile('comparator_on', (p) => { painters['repeater'](p); p.rect(3, 7, 10, 2, hex('#e84a3a')); });
tile('comparator_item', (p) => {
  p.transparent();
  p.rect(1, 9, 14, 5, hex('#8a8a8e')); p.rect(1, 9, 14, 1, hex('#a8a8ac'));
  for (const x of [3, 11]) { p.rect(x, 4, 2, 5, hex('#6a4a2a')); p.rect(x, 3, 2, 2, hex('#e84a3a')); }
  p.rect(7, 6, 2, 3, hex('#6a4a2a')); p.rect(7, 5, 2, 1, hex('#8a3a2a'));
});
const iron = (p: Painter) => { p.ramp(p.field(3, 2), [hex('#3a3a3e'), hex('#46464a'), hex('#525256')], 0.05); };
tile('anvil_top', (p) => { iron(p); p.rect(0, 0, 16, 1, hex('#6a6a6e')); p.rect(3, 4, 10, 8, hex('#2e2e32')); p.rect(4, 5, 8, 6, hex('#3a3a3e')); });
tile('anvil_side', (p) => { iron(p); p.rect(0, 0, 16, 1, hex('#6a6a6e')); p.rect(0, 15, 16, 1, hex('#26262a')); });
tile('anvil_item', (p) => {
  p.transparent();
  p.rect(1, 3, 14, 4, hex('#4a4a4e')); p.rect(1, 3, 14, 1, hex('#6a6a6e')); p.rect(0, 4, 2, 2, hex('#4a4a4e'));
  p.rect(5, 7, 6, 4, hex('#3e3e42')); p.rect(3, 11, 10, 3, hex('#46464a')); p.rect(3, 13, 10, 1, hex('#2a2a2e'));
});
tile('campfire_log', (p) => { p.fill(C.plankDark ?? hex('#5a3a22'), 0.06); for (let y = 0; y < S; y += 4) p.rect(0, y, 16, 1, hex('#3a2414')); p.speckle(hex('#1a1008'), 0.08); });
tile('campfire_fire', (p) => {
  p.transparent();
  for (let x = 2; x < 14; x++) {
    const h = 6 + Math.floor(p.rand() * 8) - Math.abs(x - 8);
    for (let y = S - 1; y >= S - h; y--) { const t = (S - 1 - y) / h; p.set(x, y, hex(t < 0.35 ? '#fff0a0' : t < 0.7 ? '#f8a030' : '#d8482a')); }
  }
});
tile('campfire_item', (p) => {
  p.transparent();
  for (let x = 3; x < 13; x++) { const h = 3 + Math.floor(p.rand() * 5) - (Math.abs(x - 8) >> 1); for (let y = 10; y > 10 - h; y--) p.set(x, y, hex(y > 8 ? '#f8a030' : '#fff0a0')); }
  p.rect(1, 11, 14, 2, hex('#6a4428')); p.rect(2, 13, 12, 2, hex('#5a3a22')); p.rect(1, 11, 14, 1, hex('#8a5a34'));
});
tile('smoker_top', (p) => { p.fill(hex('#5a4a3a'), 0.06); p.border(hex('#3a2e24')); p.rect(5, 5, 6, 6, hex('#2a2018')); });
tile('smoker_side', (p) => { p.bevelStones([hex('#6a6a6e'), hex('#7a7a7e'), hex('#88888c')], hex('#4a4a4e'), 6); p.rect(0, 0, 16, 3, hex('#5a4a3a')); p.rect(0, 13, 16, 3, hex('#5a4a3a')); });
const smokerFront = (lit: boolean) => (p: Painter) => { painters['smoker_side'](p); p.rect(3, 6, 10, 6, hex('#1a1410')); if (lit) for (let x = 4; x < 12; x++) { const h = 2 + Math.floor(p.rand() * 3); p.rect(x, 12 - h, 1, h, hex(h > 3 ? '#f8a030' : '#d8482a')); } p.rect(3, 5, 10, 1, hex('#3a3a3e')); };
tile('smoker_front', smokerFront(false));
tile('smoker_front_lit', smokerFront(true));
tile('barrel_side', (p) => { p.fill(hex('#8a5e34'), 0.05); for (let x = 0; x < S; x += 4) p.rect(x, 0, 1, 16, hex('#6a4424')); for (const y of [2, 13]) p.rect(0, y, 16, 1, hex('#4a4a4e')); });
tile('barrel_top', (p) => { p.fill(hex('#9a6a3c'), 0.05); p.border(hex('#6a4424')); p.rect(3, 3, 10, 10, hex('#8a5e34')); p.rect(6, 7, 4, 2, hex('#4a3018')); });
tile('barrel_bottom', (p) => { p.fill(hex('#8a5e34'), 0.05); p.border(hex('#6a4424')); });
tile('composter_side', (p) => { p.fill(hex('#8a6a3c'), 0.05); for (let y = 0; y < S; y += 5) p.rect(0, y, 16, 1, hex('#5a4020')); p.border(hex('#5a4020')); });
tile('composter_top', (p) => { p.fill(hex('#8a6a3c'), 0.05); p.border(hex('#5a4020')); });
tile('composter_bottom', (p) => { p.fill(hex('#7a5a30'), 0.05); });
tile('composter_item', (p) => { p.transparent(); p.rect(2, 4, 12, 10, hex('#8a6a3c')); p.rect(4, 4, 8, 3, hex('#4a6a2a')); for (const y of [7, 10]) p.rect(2, y, 12, 1, hex('#5a4020')); });
tile('compost', (p) => { p.fill(hex('#4a3a24'), 0.1); p.speckle(hex('#5a7a2a'), 0.25, 0.1); });
tile('compost_ready', (p) => { p.fill(hex('#5a4a34'), 0.1); p.speckle(hex('#e8e0c8'), 0.3, 0.05); });
tile('item_frame', (p) => { p.fill(hex('#c8a878'), 0.05); p.border(hex('#6a4a28')); p.rect(1, 1, 14, 1, hex('#8a6a3c')); p.rect(1, 14, 14, 1, hex('#8a6a3c')); p.rect(2, 2, 12, 12, hex('#b89868')); });
tile('item_frame_item', (p) => { p.transparent(); p.rect(1, 1, 14, 14, hex('#8a6a3c')); p.rect(2, 2, 12, 12, hex('#c8a878')); p.rect(5, 5, 6, 6, hex('#6a9a4a')); });
tile('flower_pot', (p) => { p.fill(hex('#a0583a'), 0.06); p.rect(0, 0, 16, 2, hex('#b86a48')); p.speckle(hex('#8a4a30'), 0.08); });
tile('flower_pot_item', (p) => { p.transparent(); p.rect(4, 7, 8, 8, hex('#a0583a')); p.rect(3, 7, 10, 2, hex('#b86a48')); p.rect(5, 8, 6, 1, hex('#4a3020')); });

// ---------- Batch 3: Emberdeep, villages, building blocks ----------
tile('portal', (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = Math.sin((x + y) * 0.7) * 0.5 + Math.sin((x - y) * 0.45 + 2) * 0.5;
    const c: RGB = v > 0.3 ? hex('#d88aff') : v > -0.2 ? hex('#8a3ad8') : hex('#4a1a8a');
    p.set(x, y, p.jit(c, 0.08), 200);
  }
});
tile('fire', (p) => {
  p.transparent();
  for (let x = 0; x < S; x++) {
    const h = 6 + Math.floor(p.rand() * 9);
    for (let y = S - 1; y >= S - h; y--) {
      const t = (S - 1 - y) / h;
      const c = t < 0.35 ? hex('#fff0a0') : t < 0.7 ? hex('#ffa030') : hex('#d8401a');
      if (p.rand() < 0.9 - t * 0.3) p.set(x, y, p.jit(c, 0.08));
    }
  }
});
tile('cinderstone', (p) => { p.fill(hex('#6a2a28'), 0.1); p.blobs(hex('#4a1a1a'), 10, 5); p.speckle(hex('#8a3a32'), 0.12); });
tile('ashsand', (p) => { p.fill(hex('#4a3a30'), 0.08); for (let i = 0; i < 5; i++) { const x = 2 + Math.floor(p.rand() * 11), y = 2 + Math.floor(p.rand() * 11); p.rect(x, y, 2, 1, hex('#2a2018')); p.set(x, y + 1, hex('#2a2018')); } });
tile('emberquartz_ore', (p) => { painters.cinderstone(p); for (let i = 0; i < 6; i++) { const x = 1 + Math.floor(p.rand() * 13), y = 1 + Math.floor(p.rand() * 13); p.set(x, y, hex('#f0e6dc')); p.set(x + 1, y, hex('#d8c8bc')); p.set(x, y + 1, hex('#e8dcd0')); } });
tile('emberquartz_block', (p) => { p.fill(hex('#ece2d8'), 0.03); p.border(hex('#cfc2b4')); });
tile('cinder_bricks', (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = y >> 2, off = row % 2 ? 4 : 0;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    p.set(x, y, p.jit(mortar ? hex('#1e0e10') : hex('#4a1e20'), mortar ? 0.05 : 0.1));
  }
});
tile('magma', (p) => { p.stones(hex('#5a1e12'), hex('#ff7a1a'), 10); p.speckle(hex('#ffc050'), 0.05); });
tile('ember_cap', (p) => { p.transparent(); p.sprite(['....oooooo....', '..oooyooyoo...', '.ooooooooooo..', '..ssssssss....', '.....ss.......', '.....ss.......', '....sss.......'], { o: hex('#e8601a'), y: hex('#ffd060'), s: hex('#6a3a2a') }, 0.08, 1, 6); });
tile('amber_ore', (p) => { painters.stone(p); for (let i = 0; i < 4; i++) { const x = 2 + Math.floor(p.rand() * 11), y = 2 + Math.floor(p.rand() * 11); p.sprite(['.a.', 'aha', '.a.'], { a: hex('#e8962a'), h: hex('#ffd890') }, 0.04, x, y); } });
tile('amber_block', (p) => { p.fill(hex('#e8962a'), 0.04); p.border(hex('#b86a12')); for (let i = 3; i < 8; i++) p.set(i, 10 - i, hex('#ffd890')); });
tile('path_top', (p) => { p.fill(hex('#9a7a4a'), 0.06); p.speckle(hex('#7a5a32'), 0.2); });
tile('path_side', (p) => { painters.dirt(p); for (let x = 0; x < S; x++) p.set(x, 0, p.jit(hex('#9a7a4a'), 0.05)); for (let x = 0; x < S; x++) p.clear(x, 15); });
tile('hay_top', (p) => { p.fill(hex('#c8a83a'), 0.08); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x * 3 + y * 5) % 7 === 0) p.set(x, y, hex('#a8882a')); p.border(hex('#8a6a1a')); });
tile('hay_side', (p) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, p.jit(x % 3 === 0 ? hex('#b8982f') : hex('#d4b440'), 0.06)); p.rect(0, 3, 16, 2, hex('#7a3a1a')); p.rect(0, 11, 16, 2, hex('#7a3a1a')); });
tile('melon_side', (p) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, p.jit(x % 4 < 2 ? hex('#5a9a2a') : hex('#3a7a1a'), 0.06)); });
tile('melon_top', (p) => { p.fill(hex('#4a8a22'), 0.06); p.rect(7, 7, 2, 2, hex('#6a4a1a')); });
tile('terracotta', (p) => { p.fill(hex('#a8604a'), 0.04); p.speckle(hex('#98543e'), 0.2); });
const woolTile = (c: RGB) => (p: Painter) => { p.fill(c, 0.05); for (let i = 0; i < 30; i++) { const x = Math.floor(p.rand() * 15), y = Math.floor(p.rand() * 15); p.shade(x, y, 0.88); p.shade(x + 1, y + 1, 0.93); } };
tile('wool_red', woolTile(hex('#b8302a')));
tile('wool_yellow', woolTile(hex('#e8c830')));
tile('wool_green', woolTile(hex('#4a8a2a')));
tile('wool_blue', woolTile(hex('#3a4ab0')));
tile('wool_black', woolTile(hex('#262228')));
tile('wool_orange', woolTile(hex('#e8781f')));
tile('iron_bars', (p) => { p.transparent(); for (const x of [1, 6, 11]) for (let y = 0; y < S; y++) { p.set(x, y, hex('#9a9a9a')); p.set(x + 1, y, hex('#d8d8d8')); } for (const y of [2, 13]) p.rect(0, y, 16, 1, hex('#7a7a7a')); });
tile('trapdoor', (p) => {
  p.transparent();
  p.rect(0, 0, 16, 16, C.plank, 0.05);
  p.border(C.plankDark);
  for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) p.rect(x, y, 4, 4, hex('#4a3a28'));
});
tile('lantern', (p) => {
  p.transparent();
  p.rect(5, 5, 6, 9, hex('#3a3a42'));
  p.rect(6, 7, 4, 6, hex('#ffc860'));
  p.rect(7, 8, 2, 4, hex('#fff0b0'));
  p.rect(6, 3, 4, 2, hex('#2a2a30'));
  p.rect(7, 1, 2, 2, hex('#5a5a62'));
});
tile('lantern_item', (p) => { painters.lantern(p); });
tile('bell', (p) => { p.fill(hex('#e8b830'), 0.05); p.rect(0, 0, 16, 2, hex('#c89818')); for (let y = 3; y < 14; y += 4) p.rect(0, y, 16, 1, hex('#fbe070')); });
tile('bell_item', (p) => { p.transparent(); p.sprite(['....bb....', '...bbbb...', '..bbhbbb..', '..bbbbbb..', '.bbbbbbbb.', 'bbbbbbbbbb', '....dd....'], { b: hex('#e8b830'), h: hex('#fff0a0'), d: hex('#8a6a1a') }, 0.04, 3, 4); });
tile('wire', (p) => {
  p.transparent();
  const c = hex('#e6e6e6');
  for (let i = 0; i < S; i++) { p.set(i, 7, c); p.set(i, 8, c); p.set(7, i, c); p.set(8, i, c); }
  p.rect(5, 5, 6, 6, c);
});
tile('spark_dust', (p) => { p.transparent(); for (let i = 0; i < 40; i++) p.set(4 + Math.floor(p.rand() * 8), 5 + Math.floor(p.rand() * 8), p.rand() < 0.5 ? hex('#e8301a') : hex('#b81a0a')); });
tile('spark_ore', (p) => { painters.stone(p); for (let i = 0; i < 7; i++) { const x = 1 + Math.floor(p.rand() * 14), y = 1 + Math.floor(p.rand() * 14); p.set(x, y, hex('#e8301a')); p.set(x + 1, y, hex('#ff6a4a')); } });
tile('button_item', (p) => { p.transparent(); p.rect(4, 6, 8, 5, hex('#8a8a8a'), 0.05); p.rect(4, 6, 8, 1, hex('#a8a8a8')); p.rect(4, 10, 8, 1, hex('#5a5a5a')); });
tile('plate_item', (p) => { p.transparent(); p.rect(1, 10, 14, 3, hex('#8a8a8a'), 0.05); p.rect(1, 10, 14, 1, hex('#a8a8a8')); });
tile('sign_item', (p) => { p.transparent(); p.rect(1, 2, 14, 8, C.plank, 0.05); p.rect(1, 2, 14, 1, C.plankDark); p.rect(1, 9, 14, 1, C.plankDark); for (let y = 4; y < 9; y += 2) p.rect(3, y, 10, 1, hex('#5a4020')); p.rect(7, 10, 2, 6, C.stick); });
tile('lily_pad', (p) => { p.transparent(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 7.2 && !(x >= 7 && x <= 8 && y < 8)) p.set(x, y, p.jit(hex('#c4c9bd'), 0.1)); } });
tile('vine', (p) => { p.transparent(); for (let b = 0; b < 5; b++) { let x = 1 + b * 3; for (let y = 0; y < S; y++) { if (p.rand() < 0.85) p.set(x, y, p.jit(hex('#b8bdb0'), 0.1)); if (p.rand() < 0.3) p.set(x + 1, y, p.jit(hex('#a8ad9f'), 0.1)); if (p.rand() < 0.2) x = Math.max(0, Math.min(15, x + (p.rand() < 0.5 ? -1 : 1))); } } });
tile('cake_top', (p) => { p.fill(hex('#f4ecde'), 0.03); for (let i = 0; i < 8; i++) p.set(2 + Math.floor(p.rand() * 12), 2 + Math.floor(p.rand() * 12), hex('#d8303a')); });
tile('cake_side', (p) => { p.transparent(); p.rect(0, 8, 16, 8, hex('#c89a5a'), 0.04); p.rect(0, 8, 16, 2, hex('#f4ecde')); p.rect(0, 12, 16, 1, hex('#d8303a')); });
tile('cake_bottom', (p) => { p.fill(hex('#b08040'), 0.04); });
tile('cake_item', (p) => { p.transparent(); p.sprite(['..rwwwwr..', '.wwwwwwww.', 'wwwwwwwwww', 'bbbbbbbbbb', 'brrrrrrrrb', 'bbbbbbbbbb', 'bbbbbbbbbb'], { w: hex('#f4ecde'), r: hex('#d8303a'), b: hex('#c89a5a') }, 0.04, 3, 5); });
tile('red_mushroom', (p) => { p.transparent(); p.sprite(['..rrrr..', '.rwrrwr.', 'rrrrrrrr', '...ss...', '...ss...', '...ss...'], { r: hex('#d02a2a'), w: hex('#f0f0f0'), s: hex('#e8e0c8') }, 0.05, 4, 8); });
tile('brown_mushroom', (p) => { p.transparent(); p.sprite(['..bbbb..', '.bbbbbb.', 'bbbbbbbb', '...ss...', '...ss...'], { b: hex('#9a6a4a'), s: hex('#e0d4b8') }, 0.05, 4, 9); });
tile('cobweb', (p) => { p.transparent(); const c = hex('#e8e8e8'); for (let i = 0; i < S; i++) { p.set(i, i, c, 200); p.set(15 - i, i, c, 200); p.set(7, i, c, 160); p.set(i, 8, c, 160); } for (const r of [3, 6]) for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2; p.set(Math.round(7.5 + Math.cos(t) * r), Math.round(7.5 + Math.sin(t) * r), c, 170); } });
tile('slate', (p) => { p.fill(hex('#4a4e58'), 0.05); for (let y = 0; y < S; y += 3) for (let x = 0; x < S; x++) if (p.rand() < 0.6) p.shade(x, y, 0.8); });
tile('polished_slate', (p) => { p.fill(hex('#565a64'), 0.03); p.border(hex('#3a3e46')); });
tile('marble', (p) => { p.fill(hex('#e8e6e0'), 0.03); for (let i = 0; i < 3; i++) { let x = Math.floor(p.rand() * S); for (let y = 0; y < S; y++) { p.set(x, y, hex('#b8b4ac')); if (p.rand() < 0.5) x = (x + (p.rand() < 0.5 ? 1 : 15)) % S; } } });
tile('polished_marble', (p) => { p.fill(hex('#f0eee8'), 0.02); p.border(hex('#cfccc4')); });
tile('mossy_stone_bricks', (p) => { painters.stone_bricks(p); p.blobs(hex('#5d8a3a'), 6, 6, 0.1); });
tile('cracked_stone_bricks', (p) => { painters.stone_bricks(p); let x = 3, y = 0; while (y < S) { p.set(x, y, hex('#3a3a3e')); y++; x = Math.max(0, Math.min(15, x + Math.round(p.rand() * 2 - 1))); } });
tile('blue_flower', flower(hex('#4a6ae0'), hex('#e8d040')));
tile('sunwood_side', (p) => { for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) p.set(x, y, p.jit(x % 4 === 0 ? hex('#5a5048') : hex('#766a5e'), 0.07)); });
tile('sunwood_top', (p) => rings(p, hex('#766a5e'), hex('#d8783a'), hex('#b8602a')));
tile('sunwood_leaves', (p) => leaves(p, hex('#c8ccb8'), 0.22));
// items
tile('amber', (p) => { p.transparent(); p.sprite(['...hhh...', '..hccch..', '.hcccccd.', 'hccccccdd', '.dcccccd.', '..dcccd..', '...ddd...'], { h: hex('#ffd890'), c: hex('#e8962a'), d: hex('#b86a12') }, 0.03, 3, 4); });
tile('emberquartz', (p) => { p.transparent(); p.sprite(['..hh....', '.hccd...', 'hcccd.h.', 'dccdd.cd', '.ddd.hcd', '....dcc.', '.....dd.'], { h: hex('#ffffff'), c: hex('#ece2d8'), d: hex('#bcaea0') }, 0.03, 4, 4); });
tile('cinder_brick', (p) => { p.transparent(); p.sprite(['..hhhhhhhh', '.hccccccch', 'hcccccccdd', 'dddddddddd'], { h: hex('#6a2a2a'), c: hex('#4a1e20'), d: hex('#2a0e10') }, 0.04, 3, 6); });
tile('ember_core', (p) => { p.transparent(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 5) p.set(x, y, d < 2 ? hex('#fff0a0') : d < 3.5 ? hex('#ffa030') : hex('#c8401a')); } });
const dye = (c: RGB) => (p: Painter) => { p.transparent(); p.sprite(['...cc...', '..cccc..', '.cchccc.', '.cccccc.', '.cccccd.', '..cccd..'], { c, h: [Math.min(255, c[0] * 1.4), Math.min(255, c[1] * 1.4), Math.min(255, c[2] * 1.4)], d: [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6] }, 0.04, 4, 5); };
tile('dye_red', dye(hex('#c8302a')));
tile('dye_yellow', dye(hex('#e8c830')));
tile('dye_green', dye(hex('#4a8a2a')));
tile('dye_blue', dye(hex('#3a4ab0')));
tile('dye_black', dye(hex('#2a2628')));
tile('dye_orange', dye(hex('#e8781f')));

// ---------- Sixteen colours: wool, stained glass, banners, dyes ----------
for (const c of DYE_COLORS) {
  const col = hex(COLOR_HEX[c]);
  const wk = WOOL_KEY[c];
  if (!painters[wk]) tile(wk, woolTile(col));
  if (!painters['dye_' + c]) tile('dye_' + c, dye(col));
  // Stained glass: a tinted, see-through pane with a darker leaded rim and a highlight streak.
  tile('stained_glass_' + c, (p) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
      const streak = (x + y === 5 || x + y === 6) && x > 1 && y > 1;
      const k = edge ? 0.62 : streak ? 1.35 : 1;
      p.set(x, y, [Math.min(255, col[0] * k), Math.min(255, col[1] * k), Math.min(255, col[2] * k)], edge ? 240 : streak ? 190 : 150);
    }
  });
  // Banner: cloth in the colour with a woven border and a lantern emblem in a contrasting tone.
  tile('banner_' + c, (p) => {
    p.transparent();
    const light = [0, 1, 2, 3, 4, 5, 6, 8].includes(DYE_COLORS.indexOf(c));
    const trim = light ? hex('#3a2a20') : hex('#e8dcc0');
    for (let y = 0; y < S; y++) for (let x = 2; x < 14; x++) {
      if (y === S - 1 && (x % 3 === 0)) continue; // notched hem
      const n = 0.94 + ((x * 7 + y * 13) % 5) * 0.03;
      p.set(x, y, [col[0] * n, col[1] * n, col[2] * n]);
    }
    p.rect(2, 1, 12, 1, trim); p.rect(3, 13, 10, 1, trim);
    for (let y = 2; y < 13; y++) { p.set(3, y, trim); p.set(12, y, trim); }
    // Emblem: a little lantern.
    p.rect(7, 4, 2, 1, trim); p.rect(6, 5, 4, 5, trim); p.rect(7, 6, 2, 3, hex('#f2b544')); p.rect(7, 10, 2, 1, trim);
  });
}

// ---------- Paintings: sixteen small original artworks in wooden frames ----------
type Art = (p: Painter, px: (x: number, y: number, c: string) => void) => void;
const framed = (art: Art) => (p: Painter) => {
  p.fill(hex('#1a1410'));
  const px = (x: number, y: number, c: string) => { if (x >= 1 && y >= 1 && x < S - 1 && y < S - 1) p.set(x, y, hex(c)); };
  art(p, px);
  for (let i = 0; i < S; i++) {
    for (const [x, y] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) p.set(x, y, (x + y) % 4 === 0 ? hex('#8a5a2a') : hex('#6a4420'));
  }
};
const sky = (px: (x: number, y: number, c: string) => void, top: string, bottom: string, until = 15) => {
  for (let y = 1; y < until; y++) for (let x = 1; x < 15; x++) px(x, y, y < until / 2 ? top : bottom);
};
const ARTS: Art[] = [
  // 0 Sunset over rolling hills.
  (_p, px) => { sky(px, '#f08a4a', '#f8c060'); for (let x = 1; x < 15; x++) { const h = 10 + Math.round(Math.sin(x * 0.7) * 1.5); for (let y = h; y < 15; y++) px(x, y, y === h ? '#5a8a36' : '#3e6a28'); } px(10, 5, '#fff0b0'); px(11, 5, '#fff0b0'); px(10, 6, '#ffe080'); px(11, 6, '#ffe080'); },
  // 1 Moonlit night over the sea.
  (_p, px) => { sky(px, '#10183a', '#1a2a5a', 10); for (let y = 10; y < 15; y++) for (let x = 1; x < 15; x++) px(x, y, (x + y) % 3 ? '#1a3a6a' : '#2a5a8a'); px(4, 3, '#f0f0e0'); px(5, 3, '#f0f0e0'); px(4, 4, '#f0f0e0'); px(5, 4, '#d8d8c8'); for (const [x, y] of [[9, 2], [12, 4], [7, 6], [13, 7], [2, 7]]) px(x, y, '#c8d8ff'); for (let y = 10; y < 15; y += 2) px(4 + (y % 3), y, '#c8d8e8'); },
  // 2 Autumn forest.
  (_p, px) => { sky(px, '#a8c8e8', '#c8e0f0'); for (const [tx, c] of [[3, '#c8642a'], [7, '#e8a030'], [11, '#b8342a']] as [number, string][]) { for (let y = 4; y < 10; y++) for (let x = tx - 2; x <= tx + 2; x++) if (Math.abs(x - tx) + Math.abs(y - 7) < 4) px(x, y, c); for (let y = 10; y < 14; y++) px(tx, y, '#5a3a1e'); } for (let x = 1; x < 15; x++) px(x, 14, '#6a8a3a'); },
  // 3 Snowy peaks.
  (_p, px) => { sky(px, '#8ab8e8', '#b8d8f0'); for (let x = 1; x < 15; x++) { const h = 3 + Math.abs(((x * 3) % 12) - 6); for (let y = h; y < 15; y++) px(x, y, y < h + 2 ? '#f0f4f8' : y < h + 5 ? '#8a8e96' : '#5a6a4a'); } },
  // 4 A boar, side on.
  (_p, px) => { sky(px, '#d8c89a', '#c8b886'); for (let y = 6; y < 11; y++) for (let x = 3; x < 12; x++) px(x, y, '#6e5038'); for (let y = 7; y < 10; y++) for (let x = 11; x < 14; x++) px(x, y, '#634630'); px(13, 9, '#d09a84'); px(12, 8, '#140e0a'); for (const x of [4, 6, 9, 11]) { px(x, 11, '#241c16'); px(x, 12, '#241c16'); } for (let x = 4; x < 10; x++) px(x, 5, '#2e2016'); px(13, 10, '#eee4c8'); },
  // 5 Lighthouse on a cliff.
  (_p, px) => { sky(px, '#2a3a6a', '#4a5a8a'); for (let y = 11; y < 15; y++) for (let x = 1; x < 15; x++) px(x, y, x < 9 ? '#5a5a5e' : '#1a3a6a'); for (let y = 4; y < 11; y++) for (let x = 5; x < 8; x++) px(x, y, y % 3 === 0 ? '#b8302a' : '#f0ece0'); px(5, 3, '#ffe080'); px(6, 3, '#fff4b0'); px(7, 3, '#ffe080'); for (let x = 8; x < 15; x++) px(x, 3, '#6a6a40'); },
  // 6 Still life: flowers in a vase.
  (_p, px) => { sky(px, '#5a3a4a', '#4a2e3a', 15); for (let y = 10; y < 14; y++) for (let x = 6; x < 10; x++) px(x, y, '#3a6a8a'); for (const [x, y, c] of [[5, 5, '#e8c830'], [8, 3, '#b8302a'], [10, 5, '#e890a8'], [7, 6, '#f0f0f0'], [9, 7, '#7a3ab0']] as [number, number, string][]) { px(x, y, c); px(x + 1, y, c); px(x, y + 1, c); } for (let y = 6; y < 10; y++) px(8, y, '#4a8a2a'); for (let x = 1; x < 15; x++) px(x, 14, '#6a4428'); },
  // 7 Desert dunes and a lone cactus.
  (_p, px) => { sky(px, '#f0c878', '#f8e0a0'); for (let x = 1; x < 15; x++) { const h = 9 + Math.round(Math.sin(x * 0.5 + 1) * 2); for (let y = h; y < 15; y++) px(x, y, (x + y) % 5 ? '#dccf9a' : '#c8b980'); } for (let y = 5; y < 10; y++) px(11, y, '#3f8a2f'); px(10, 7, '#3f8a2f'); px(12, 6, '#3f8a2f'); px(3, 3, '#ffffff'); px(4, 3, '#fff8d8'); },
  // 8 Abstract: warm blocks.
  (_p, px) => { const cols = ['#c8642a', '#e8c830', '#b8302a', '#f0e0c0', '#3a4ab0']; for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) px(x, y, cols[(Math.floor(x / 5) + Math.floor(y / 4) * 2) % cols.length]); for (let i = 1; i < 15; i++) { px(5, i, '#1a1410'); px(i, 5, '#1a1410'); px(10, i, '#1a1410'); } },
  // 9 Abstract: spiral.
  (_p, px) => { sky(px, '#2a8a90', '#2a8a90', 15); let x = 7, y = 7, dx = 1, dy = 0, len = 1; for (let n = 0; n < 60; n += 0) { for (let k = 0; k < len; k++) { px(x, y, '#f0e0c0'); x += dx; y += dy; n++; } [dx, dy] = [-dy, dx]; if (dy === 0) len++; } },
  // 10 A village at dusk.
  (_p, px) => { sky(px, '#6a4a8a', '#e88a5a', 10); for (let x = 1; x < 15; x++) for (let y = 12; y < 15; y++) px(x, y, '#3e5a28'); for (const hx of [2, 8]) { for (let y = 8; y < 12; y++) for (let x = hx; x < hx + 5; x++) px(x, y, '#c8a068'); for (let k = 0; k < 3; k++) for (let x = hx + k; x < hx + 5 - k; x++) px(x, 7 - k, '#8a3a2a'); px(hx + 2, 10, '#ffd060'); } },
  // 11 Waves and a sailing boat.
  (_p, px) => { sky(px, '#b8d8f0', '#d8ecf8', 9); for (let y = 9; y < 15; y++) for (let x = 1; x < 15; x++) px(x, y, (x + y * 2) % 4 === 0 ? '#e8f0f8' : '#3a6ad6'); for (let y = 3; y < 8; y++) for (let x = 7; x < 7 + (y - 2); x++) px(x, y, '#f0ece0'); for (let y = 2; y < 9; y++) px(6, y, '#5a3a1e'); for (let x = 3; x < 11; x++) px(x, 9, '#6a4428'); },
  // 12 A cave with glowing crystals.
  (_p, px) => { sky(px, '#1a1418', '#241c22', 15); for (const [x, y] of [[3, 12], [5, 11], [10, 12], [12, 10], [8, 13]]) { px(x, y, '#7af0e8'); px(x, y - 1, '#c8fff8'); } for (let x = 1; x < 15; x++) { px(x, 1, '#3a3438'); px(x, 14, '#3a3438'); if (x % 3 === 0) px(x, 2, '#3a3438'); } },
  // 13 A tree in blossom.
  (_p, px) => { sky(px, '#e8f0f8', '#f0f4f8'); for (let y = 3; y < 9; y++) for (let x = 3; x < 13; x++) if (Math.hypot(x - 8, y - 6) < 4.5) px(x, y, (x * y) % 3 ? '#f0a8c8' : '#f8d0e0'); for (let y = 9; y < 14; y++) px(8, y, '#6a4428'); for (let x = 1; x < 15; x++) px(x, 14, '#7ac83a'); },
  // 14 Portrait: a frostling.
  (_p, px) => { sky(px, '#3a4a6a', '#2a3a5a', 15); for (let y = 5; y < 12; y++) for (let x = 5; x < 11; x++) px(x, y, '#b8d8f0'); px(6, 7, '#2a6ad8'); px(9, 7, '#2a6ad8'); for (let x = 6; x < 10; x++) px(x, 10, '#6a9ac8'); for (const [x, y] of [[6, 3], [8, 2], [10, 3], [7, 4], [9, 4]]) px(x, y, '#e8f6ff'); },
  // 15 The Emberdeep: a lava sea under glowing rock.
  (_p, px) => { sky(px, '#3a1410', '#5a1c10', 10); for (let y = 10; y < 15; y++) for (let x = 1; x < 15; x++) px(x, y, (x + y) % 3 ? '#e2581c' : '#ffb13b'); for (const x of [3, 7, 12]) { px(x, 1, '#f8d060'); px(x, 2, '#e8a040'); } for (let x = 5; x < 10; x++) px(x, 9, '#2e2a2c'); },
];
ARTS.forEach((art, i) => tile('painting_' + i, framed(art)));
tile('painting_item', framed(ARTS[0]));


tile('bowl', (p) => { p.transparent(); p.sprite(['wwwwwwwwwwww', '.bbbbbbbbbb.', '..bbbbbbbb..', '...bbbbbb...'], { w: C.plankDark, b: C.plank }, 0.05, 2, 8); });
tile('mushroom_stew', (p) => { painters.bowl(p); p.rect(3, 7, 10, 2, hex('#c8986a'), 0.08); p.set(5, 7, hex('#d02a2a')); p.set(9, 7, hex('#9a6a4a')); });
tile('melon_slice', (p) => { p.transparent(); p.sprite(['gggggggggg', '.rrrrrrrr.', '..rkrrkr..', '...rrrr...', '....rr....'], { g: hex('#4a8a22'), r: hex('#e8404a'), k: hex('#1a1a1a') }, 0.05, 3, 5); });
tile('fire_charge', (p) => { p.transparent(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 5.5) p.set(x, y, p.jit(d < 2.5 ? hex('#ffb030') : hex('#3a2a22'), 0.12)); } });
tile('golden_apple', (p) => { painters.apple(p); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (p.alpha(x, y) && !(x >= 6 && x <= 8 && y <= 4)) { const c = p.get(x, y); const l = (c[0] + c[1] + c[2]) / 3 / 255; p.set(x, y, [255 * Math.min(1, l * 1.6 + 0.2), 200 * Math.min(1, l * 1.5 + 0.15), 60 * l]); } });

// ---------- Batch 4: natural variety ----------
const rockTile = (colors: RGB[], cells: number, extra?: (p: Painter) => void) => (p: Painter) => {
  p.ramp(p.field(cells, 3), colors, 0.14);
  extra?.(p);
};
tile('granite', rockTile([hex('#8a5e4e'), hex('#9c6c58'), hex('#b07c66'), hex('#c4917a')], 4, (p) => { p.speckle(hex('#e0c0b0'), 0.06); p.speckle(hex('#4a2e26'), 0.05); }));
tile('polished_granite', (p) => { painters.granite(p); p.border(hex('#7a4e40')); for (let i = 1; i < 15; i++) p.shade(i, 1, 1.12); });
tile('limestone', (p) => {
  p.ramp(p.field(3, 2), [hex('#b8b0a0'), hex('#c8c0ae'), hex('#d6cebc'), hex('#e2dccb')], 0.08);
  for (let y = 3; y < S; y += 5) for (let x = 0; x < S; x++) if (p.rand() < 0.7) p.shade(x, y, 0.88);
  for (let i = 0; i < 4; i++) p.set(Math.floor(p.rand() * S), Math.floor(p.rand() * S), hex('#9a9282'));
});
tile('polished_limestone', (p) => { p.fill(hex('#d8d0be'), 0.02); p.border(hex('#b4ac9a')); });
tile('basalt_side', (p) => {
  for (let x = 0; x < S; x++) {
    const col = x % 4 === 0 ? 0.7 : x % 4 === 3 ? 0.85 : 1;
    for (let y = 0; y < S; y++) p.set(x, y, p.jit([58 * col, 58 * col, 64 * col], 0.08));
  }
});
tile('basalt_top', (p) => { p.bevelStones([hex('#3e3e44'), hex('#46464c'), hex('#505056')], hex('#2a2a2e'), 5, 0.05); });
tile('deepstone', rockTile([hex('#3c3c42'), hex('#46464c'), hex('#505058'), hex('#5a5a62')], 4, (p) => { for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x++) if (p.rand() < 0.15) p.shade(x, y, 0.8); }));
tile('cobbled_deepstone', (p) => p.bevelStones([hex('#3a3a40'), hex('#45454b'), hex('#505056'), hex('#5a5a60')], hex('#222226'), 9));
tile('deepstone_bricks', (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const off = (y >> 2) % 2 ? 4 : 0;
    const gap = y % 4 === 3 || (x + off) % 8 === 7;
    p.set(x, y, gap ? p.jit(hex('#26262a'), 0.05) : p.jit(hex('#4a4a52'), 0.06));
    if (!gap && y % 4 === 0) p.shade(x, y, 1.15);
  }
});
tile('chalk', rockTile([hex('#dcdad4'), hex('#e6e4de'), hex('#eeece8'), hex('#f6f5f2')], 3));
tile('mud', (p) => { p.ramp(p.field(4, 2), [hex('#3a2e2a'), hex('#453632'), hex('#4e3e38'), hex('#5a4840')], 0.15); for (let i = 0; i < 6; i++) { const x = Math.floor(p.rand() * 15), y = Math.floor(p.rand() * 15); p.set(x, y, hex('#6a5850')); } });
tile('mud_bricks', (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const off = (y >> 2) % 2 ? 4 : 0;
    const gap = y % 4 === 3 || (x + off) % 8 === 7;
    p.set(x, y, gap ? p.jit(hex('#6a5846'), 0.05) : p.jit(hex('#9a8466'), 0.06));
  }
});
tile('moss_block', (p) => { p.ramp(p.field(5, 2), [hex('#8a8e82'), hex('#a0a498'), hex('#b4b8ac'), hex('#c6cabe')], 0.3); for (let i = 0; i < 20; i++) p.set(Math.floor(p.rand() * S), Math.floor(p.rand() * S), hex('#d4d8cc')); });
tile('mossy_stone_top', (p) => { painters.moss_block(p); });
tile('mossy_stone_side', (p) => {
  painters.stone(p);
  for (let x = 0; x < S; x++) { const d = 2 + Math.floor(p.rand() * 3) + (p.rand() < 0.2 ? 3 : 0); for (let y = 0; y < d; y++) p.set(x, y, p.jit(hex('#5a7a32'), 0.12)); }
});
tile('coarse_dirt', (p) => { painters.dirt(p); p.speckle(hex('#8a8078'), 0.18, 0.1); p.speckle(hex('#4a3a2a'), 0.08); });
tile('loam_top', (p) => {
  p.ramp(p.field(4, 2), [hex('#4a3620'), hex('#5a4228'), hex('#6a4e30'), hex('#7a5c3a')], 0.2);
  for (let i = 0; i < 18; i++) { const x = Math.floor(p.rand() * S), y = Math.floor(p.rand() * S); p.set(x, y, p.rand() < 0.5 ? hex('#8a6a30') : hex('#6a7a30')); }
});
tile('loam_side', (p) => { painters.dirt(p); for (let x = 0; x < S; x++) { const d = 2 + Math.floor(p.rand() * 2); for (let y = 0; y < d; y++) p.set(x, y, p.jit(hex('#5a4228'), 0.1)); } });
tile('red_sand', (p) => { const f = p.field(2, 3); for (let i = 0; i < S * S; i++) f[i] = f[i] * 0.6 + (Math.sin((i % S) * 0.5 + Math.floor(i / S) * 1.1 + f[i] * 4) * 0.5 + 0.5) * 0.4; p.ramp(f, [hex('#a8582a'), hex('#b86432'), hex('#c8723c'), hex('#d68248')], 0.15); });
tile('red_sandstone', (p) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, p.jit(y < 3 || y === 9 ? hex('#a8582a') : hex('#c06a34'), 0.04)); for (let x = 0; x < S; x++) p.set(x, 3, hex('#8a4a22')); });
tile('red_sandstone_top', (p) => { p.fill(hex('#c46e38'), 0.03); });
const terra = (c: RGB) => (p: Painter) => { p.ramp(p.field(3, 2), [[c[0] * 0.9, c[1] * 0.9, c[2] * 0.9], c, [Math.min(255, c[0] * 1.07), Math.min(255, c[1] * 1.07), Math.min(255, c[2] * 1.07)]], 0.1); };
tile('terracotta_orange', terra(hex('#a8582e')));
tile('terracotta_yellow', terra(hex('#b88a34')));
tile('terracotta_white', terra(hex('#d2b4a0')));
tile('terracotta_brown', terra(hex('#6e4430')));
tile('terracotta_red', terra(hex('#8e3a2e')));
tile('packed_ice', (p) => { p.ramp(p.field(3, 2), [hex('#7aa8e0'), hex('#8cb6e8'), hex('#a0c4ee'), hex('#b8d6f6')], 0.06); for (let i = 0; i < 3; i++) { let x = Math.floor(p.rand() * S); for (let y = 0; y < S; y++) { p.set(x, y, hex('#d0e6ff')); if (p.rand() < 0.3) x = (x + 1) % S; } } });
tile('dripstone', (p) => { for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) p.set(x, y, p.jit(Math.sin(x * 0.9 + y * 0.15) > 0.2 ? hex('#8a6e5a') : hex('#7a604e'), 0.06)); });
tile('pointed_dripstone', (p) => { p.transparent(); for (let y = 0; y < S; y++) { const w = Math.max(0, Math.floor((S - y) / 3)); for (let x = 8 - w; x <= 7 + w; x++) p.set(x, y, p.jit(x < 8 ? hex('#8a6e5a') : hex('#6e5646'), 0.05)); } });
tile('glowmoss', (p) => { p.transparent(); for (let b = 0; b < 5; b++) { let x = 2 + b * 3; for (let y = 0; y < 12 + Math.floor(p.rand() * 4); y++) { p.set(x, y, p.jit(hex('#4f7a3e'), 0.1)); if (p.rand() < 0.25) p.set(x, y, hex('#e8f070')); if (p.rand() < 0.2) x = Math.max(0, Math.min(15, x + (p.rand() < 0.5 ? -1 : 1))); } } });
tile('crystal_block', (p) => { p.bevelStones([hex('#7a4ab8'), hex('#8e5ccc'), hex('#a472de'), hex('#bc8cf0')], hex('#4a2a7a'), 6, 0.05); p.speckle(hex('#e8d0ff'), 0.05); });
tile('crystal_cluster', (p) => { p.transparent(); for (const [x0, h] of [[4, 10], [7, 14], [10, 9], [12, 6]]) for (let y = S - 1; y > S - h; y--) { p.set(x0, y, hex('#b88cf0')); p.set(x0 + 1, y, hex('#8e5ccc')); } p.set(7, S - 14, hex('#f0e0ff')); });
tile('fern', (p) => { p.transparent(); for (const [cx, dir] of [[8, 0], [5, -1], [11, 1]]) for (let y = 15; y > 3; y--) { const x = Math.round(cx + dir * (15 - y) * 0.35); p.set(x, y, p.jit(hex('#b8bcb0'), 0.1)); if (y % 2 === 0) { p.set(x - 1, y, hex('#a4a89c')); p.set(x + 1, y - 1, hex('#a4a89c')); } } });
tile('bush', (p) => { p.transparent(); const f = p.field(4, 2); for (let y = 4; y < S; y++) for (let x = 1; x < 15; x++) { const d = Math.hypot(x - 7.5, (y - 10) * 1.3); if (d < 7 && f[x + y * S] > 0.3) p.set(x, y, p.jit(f[x + y * S] > 0.6 ? hex('#c8ccbf') : hex('#9ea296'), 0.08)); } });
tile('berry_bush', (p) => { p.transparent(); for (let y = 5; y < S; y++) for (let x = 1; x < 15; x++) if (Math.hypot(x - 7.5, (y - 10) * 1.3) < 7 && p.rand() < 0.75) p.set(x, y, p.jit(hex('#3e6a2a'), 0.12)); for (let i = 0; i < 7; i++) { const x = 3 + Math.floor(p.rand() * 10), y = 7 + Math.floor(p.rand() * 7); p.set(x, y, hex('#d8283a')); p.set(x + 1, y, hex('#a01a2a')); } });
tile('cattail', (p) => { p.transparent(); for (const x of [4, 8, 11]) { for (let y = 15; y > 2; y--) p.set(x, y, hex('#5a8a3a')); p.rect(x, 3 + (x % 3), 1, 4, hex('#6a4028')); } p.set(6, 8, hex('#6a9a3a')); p.set(9, 6, hex('#6a9a3a')); });
tile('seagrass', (p) => { p.transparent(); for (let b = 0; b < 6; b++) { let x = 1 + b * 2.6; for (let y = 15; y > 3 + (b % 3) * 2; y--) { p.set(Math.round(x), y, p.jit(hex('#3a8a4a'), 0.1)); x += Math.sin(y * 0.8 + b) * 0.4; } } });
tile('kelp', (p) => { p.transparent(); for (let y = 0; y < S; y++) { const x = 7 + Math.round(Math.sin(y * 0.6) * 1.5); p.set(x, y, hex('#4a7a2a')); p.set(x + 1, y, hex('#3a6a22')); if (y % 4 === 0) { p.set(x + 2, y, hex('#5a8a32')); p.set(x + 3, y + 1, hex('#5a8a32')); } if (y % 4 === 2) { p.set(x - 1, y, hex('#5a8a32')); p.set(x - 2, y + 1, hex('#5a8a32')); } } });
tile('blossom_log_side', (p) => { for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) p.set(x, y, p.jit(x % 5 === 0 ? hex('#3a2230') : hex('#4e3040'), 0.08)); });
tile('blossom_log_top', (p) => rings(p, hex('#4e3040'), hex('#d8a8a0'), hex('#c48c88')));
tile('blossom_leaves', (p) => {
  const f = p.field(4, 2);
  p.ramp(f, [hex('#d886a8'), hex('#e89ab8'), hex('#f2b0c8'), hex('#fac8d8')], 0.3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((f[x + y * S] < 0.3 && p.rand() < 0.5) || p.rand() < 0.08) p.clear(x, y);
  for (let i = 0; i < 10; i++) p.set(Math.floor(p.rand() * S), Math.floor(p.rand() * S), hex('#fff0f4'));
});
tile('jungle_log_side', (p) => { for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) p.set(x, y, p.jit((x + Math.floor(y / 3)) % 4 === 0 ? hex('#4a3a1a') : hex('#62502a'), 0.08)); for (let i = 0; i < 6; i++) p.set(Math.floor(p.rand() * S), Math.floor(p.rand() * S), hex('#5a7a2a')); });
tile('jungle_log_top', (p) => rings(p, hex('#62502a'), hex('#b88a50'), hex('#a07640')));
tile('jungle_leaves', (p) => leaves(p, hex('#b4bca8'), 0.1));
tile('bamboo', (p) => { p.transparent(); for (let y = 0; y < S; y++) { p.set(7, y, hex('#6a9a2a')); p.set(8, y, hex('#5a8a22')); if (y % 5 === 0) { p.set(7, y, hex('#8ab84a')); p.set(8, y, hex('#8ab84a')); } } p.set(9, 3, hex('#6aa02a')); p.set(10, 2, hex('#6aa02a')); p.set(6, 9, hex('#6aa02a')); p.set(5, 8, hex('#6aa02a')); });
tile('dry_grass', (p) => { p.transparent(); for (let b = 0; b < 8; b++) { let x = 1 + Math.floor(p.rand() * 14); const top = 5 + Math.floor(p.rand() * 7); for (let y = 15; y >= top; y--) { p.set(x, y, p.jit(hex('#c8a85a'), 0.12)); if (p.rand() < 0.25) x += p.rand() < 0.5 ? -1 : 1; } } });
tile('white_flower', flower(hex('#f4f4f0'), hex('#f0c830')));
tile('purple_flower', (p) => { p.transparent(); for (const x of [5, 8, 11]) { for (let y = 15; y > 6; y--) p.set(x, y, hex('#4f7a3a')); for (let y = 3; y < 8; y++) p.set(x + (y % 2), y, p.jit(hex('#9a6ad8'), 0.1)); } });
tile('geode_shell', rockTile([hex('#4a4a4e'), hex('#56565a'), hex('#626266')], 5, (p) => p.speckle(hex('#8a7aa0'), 0.08)));
tile('red_berries', (p) => { p.transparent(); for (const [x, y] of [[5, 7], [9, 6], [7, 10], [10, 10], [4, 11]]) p.sprite(['rr', 'rd'], { r: hex('#d8283a'), d: hex('#9a1a2a') }, 0.05, x, y); p.set(8, 4, hex('#3e6a2a')); p.set(9, 5, hex('#3e6a2a')); });
tile('crystal_shard', (p) => { p.transparent(); p.sprite(['....h', '...hc', '..hcd', '.hcd.', 'hcd..', 'cd...'], { h: hex('#f0e0ff'), c: hex('#b88cf0'), d: hex('#6a3ab0') }, 0.04, 5, 5); });

// Armor: original silhouettes per piece, coloured by material.
const ARMOR_SHAPES: Record<string, string[]> = {
  helmet: ['................', '................', '................', '...mmmmmmmmmm...', '..mhhhhhhhhhhm..', '..mhmmmmmmmmhm..', '..mhm......mhm..', '..mhm......mhm..', '..mmm......mmm..'],
  chestplate: ['................', '..mmm......mmm..', '.mhhm......mhhm.', '.mhhmmmmmmmmhhm.', '.mhhhhhhhhhhhhm.', '..mmhhhhhhhhmm..', '...mhhhhhhhhm...', '...mhhhhhhhhm...', '...mhhhhhhhhm...', '...mhhhhhhhhm...', '...mmmmmmmmmm...'],
  leggings: ['................', '................', '...mmmmmmmmmm...', '...mhhhhhhhhm...', '...mhhhmmhhhm...', '...mhhm..mhhm...', '...mhhm..mhhm...', '...mhhm..mhhm...', '...mhhm..mhhm...', '...mhhm..mhhm...', '...mmmm..mmmm...'],
  boots: ['................', '................', '................', '................', '................', '...mmm....mmm...', '...mhm....mhm...', '...mhm....mhm...', '..mmhm....mhmm..', '.mhhhm....mhhhm.', '.mmmmm....mmmmm.'],
};
const ARMOR_COLORS: Record<string, [RGB, RGB]> = {
  leather: [hex('#7a4420'), hex('#a8683a')],
  golden: [hex('#c8981a'), hex('#fbe070')],
  iron: [hex('#9a9a9a'), hex('#e6e6e6')],
  diamond: [hex('#2aa8a0'), hex('#9afff0')],
};
for (const mat of Object.keys(ARMOR_COLORS)) for (const piece of Object.keys(ARMOR_SHAPES)) {
  tile(`${mat}_${piece}`, (p) => { p.transparent(); const [m, h] = ARMOR_COLORS[mat]; p.sprite(ARMOR_SHAPES[piece], { m, h }, 0.04, 0, 2); });
}

// Tools: shared diagonal handle, original heads per tool kind.
const HEADS: Record<string, string[]> = {
  pickaxe: [
    '....mmmmmm......', '..mmhhhhhhmm....', '.mhh......mm....', 'mh.......m.m....',
    'm.......m..m....', '.......m...m....', '............m...', '................',
  ],
  axe: [
    '......mmm.......', '.....mhhmm......', '....mhhhmm......', '....mhhmm.......',
    '.....mm.m.......', '.......m........', '................', '................',
  ],
  shovel: [
    '..........mmm...', '.........mhhmm..', '........mhhhhm..', '........mhhhm...',
    '.........mmm....', '................', '................', '................',
  ],
  sword: [
    '.............mm.', '............mhm.', '...........mhm..', '..........mhm...',
    '.........mhm....', '........mhm.....', '...xx..mhm......', '....xxmhm.......',
  ],
  hoe: [
    '......mmmmm.....', '.....mhhhhm.....', '.........mm.....', '................',
    '................', '................', '................', '................',
  ],
};
const MAT_COLORS: Record<string, [RGB, RGB]> = {
  wooden: [hex('#9c7a44'), hex('#c9a262')],
  stone: [hex('#6e6e6e'), hex('#a3a3a3')],
  iron: [hex('#b8b8b8'), hex('#f2f2f2')],
  golden: [hex('#d9a81a'), hex('#fff08a')],
  diamond: [hex('#2ab8aa'), hex('#a8fff4')],
};
for (const mat of Object.keys(MAT_COLORS)) {
  for (const kind of Object.keys(HEADS)) {
    tile(`${mat}_${kind}`, (p) => {
      p.transparent();
      const [m, h] = MAT_COLORS[mat];
      if (kind === 'sword') {
        p.sprite(HEADS.sword, { m, h, x: outlineDark }, 0.03);
        for (let i = 0; i < 4; i++) { p.set(2 + i, 13 - i, C.stick); p.set(3 + i, 13 - i, C.stickDark); }
        p.set(1, 14, outlineDark);
        return;
      }
      for (let i = 0; i < 10; i++) { p.set(2 + i, 14 - i, C.stick); p.set(3 + i, 14 - i, C.stickDark); }
      p.sprite(HEADS[kind], { m, h }, 0.03, kind === 'hoe' ? 3 : 2, 1);
    });
  }
}

export interface Atlas {
  /** RGBA pixel data for every tile, stacked as texture-array layers. */
  layers: Uint8Array;
  count: number;
  /** One small canvas per tile, for UI icons. */
  canvases: HTMLCanvasElement[];
}

export function buildAtlas(): Atlas {
  const count = TILE_NAMES.length;
  const layers = new Uint8Array(count * S * S * 4);
  const canvases: HTMLCanvasElement[] = [];
  TILE_NAMES.forEach((name, i) => {
    // Variants ("stone~2") reuse the base painter with their own random seed.
    const p = new Painter(name);
    const fn = painters[name] ?? painters[baseTile(name)];
    if (fn) fn(p);
    else { p.fill(hex('#ff00ff')); p.rect(0, 0, 8, 8, C.black); p.rect(8, 8, 8, 8, C.black); }
    layers.set(p.data, i * S * S * 4);
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const img = new ImageData(new Uint8ClampedArray(p.data), S, S);
    if (TINTED.has(name)) {
      const t = BIOME_TINT[1];
      for (let k = 0; k < img.data.length; k += 4) { img.data[k] *= t[0]; img.data[k + 1] *= t[1]; img.data[k + 2] *= t[2]; }
    }
    cv.getContext('2d')!.putImageData(img, 0, 0);
    canvases.push(cv);
  });
  return { layers, count, canvases };
}

/** Names of tiles that are drawn but have no painter (for tests / debugging). */
export function missingPainters(): string[] {
  return TILE_NAMES.filter((n) => !painters[n] && !painters[baseTile(n)]);
}
