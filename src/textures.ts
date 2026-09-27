// Procedural pixel art. Every texture in the game is painted here at startup;
// there are no image assets.

import { hashString, mulberry32 } from './noise';
import { TILE_NAMES, TINTED } from './tiles';
import { BIOME_TINT } from './world/worldgen';

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

tile('stone', (p) => { p.fill(C.stone, 0.05); p.blobs(C.stoneDark, 9, 5, 0.05); p.blobs(C.stoneLight, 6, 4, 0.04); });
tile('cobblestone', (p) => p.stones(C.stone, C.stoneDark, 9));
tile('mossy_cobblestone', (p) => { p.stones(C.stone, C.stoneDark, 9); p.blobs(hex('#5d8a3a'), 6, 7, 0.1); });
tile('dirt', (p) => { p.fill(C.dirt, 0.06); p.blobs(C.dirtDark, 10, 4); p.speckle(C.dirtLight, 0.08); });
tile('grass_top', (p) => { p.fill(C.grass, 0.1); p.speckle(hex('#a8ab9f'), 0.25, 0.06); p.speckle(hex('#e6e8e0'), 0.1, 0.03); });
tile('grass_side', (p) => {
  painters.dirt(p);
  for (let x = 0; x < S; x++) {
    const d = 3 + Math.floor(p.rand() * 3) - (p.rand() < 0.3 ? 1 : 0);
    for (let y = 0; y < d; y++) p.set(x, y, p.jit(y === d - 1 ? C.grassSideDark : C.grassSide, 0.08));
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
tile('sand', (p) => { p.fill(C.sand, 0.04); p.speckle(C.sandDark, 0.2, 0.05); });
tile('gravel', (p) => { p.stones(hex('#8b8580'), hex('#5c5652'), 16); p.speckle(hex('#a39a92'), 0.1); });
tile('clay', (p) => { p.fill(hex('#9ea3b0'), 0.04); p.speckle(hex('#8a8f9c'), 0.2); });
tile('bedrock', (p) => { p.mottle([hex('#2b2b2b'), hex('#565656'), hex('#7b7b7b'), hex('#141414')], [3, 3, 1, 2]); });
tile('log_side', (p) => {
  for (let x = 0; x < S; x++) {
    const c = x % 4 === 0 || p.rand() < 0.15 ? C.barkDark : C.bark;
    for (let y = 0; y < S; y++) p.set(x, y, p.jit(p.rand() < 0.1 ? C.barkDark : c, 0.07));
  }
});
const rings = (p: Painter, bark: RGB, wood: RGB, dark: RGB) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const c = d > 6.5 ? bark : Math.floor(d) % 2 === 0 ? dark : wood;
    p.set(x, y, p.jit(c, 0.05));
  }
};
tile('log_top', (p) => rings(p, C.bark, C.wood, C.woodDark));
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
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const board = y >> 2;
    const seam = y % 4 === 3 || (x === ((board * 7 + 3) % S));
    p.set(x, y, p.jit(seam ? C.plankDark : C.plank, seam ? 0.04 : 0.06));
  }
});
const leaves = (p: Painter, base: RGB, holes: number) => {
  p.fill(base, 0.14);
  p.speckle(hex('#8e9288'), 0.2, 0.1);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (p.rand() < holes) p.clear(x, y);
};
tile('leaves', (p) => leaves(p, hex('#c4c9bd'), 0.18));
tile('spruce_leaves', (p) => leaves(p, hex('#a9b4ad'), 0.14));
tile('birch_leaves', (p) => { p.fill(hex('#7fa35a'), 0.14); p.speckle(hex('#62853f'), 0.25); for (let i = 0; i < 40; i++) p.clear(Math.floor(p.rand() * S), Math.floor(p.rand() * S)); });
tile('glass', (p) => {
  p.transparent();
  const edge = hex('#c9e4ee');
  for (let i = 0; i < S; i++) { p.set(i, 0, edge); p.set(i, S - 1, edge); p.set(0, i, edge); p.set(S - 1, i, edge); }
  for (let i = 0; i < 4; i++) { p.set(3 + i, 5 - i, C.white, 200); p.set(10 + i, 12 - i, C.white, 160); }
});
tile('water', (p) => { p.fill(C.water, 0.06); for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x++) if ((x + y) % 7 < 2) p.set(x, (y + (x >> 2)) % S, p.jit(hex('#5b8ee8'), 0.04)); });
tile('water_flow', (p) => { p.fill(C.water, 0.06); for (let y = 0; y < S; y += 3) for (let x = 0; x < S; x++) if ((x * 3 + y) % 5 === 0) p.set(x, y, hex('#6a9aee')); });
tile('lava', (p) => { p.fill(C.lava, 0.08); p.blobs(C.lavaHot, 6, 8, 0.1); p.blobs(hex('#b8330f'), 5, 5); });
const ore = (color: RGB, count: number) => (p: Painter) => {
  painters.stone(p);
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(p.rand() * 13), y = 1 + Math.floor(p.rand() * 13);
    p.set(x, y, p.jit(color, 0.08)); p.set(x + 1, y, p.jit(color, 0.08));
    p.set(x, y + 1, p.jit(color, 0.12)); if (p.rand() < 0.5) p.set(x + 1, y + 1, p.jit(color, 0.15));
    p.shade(x + 1, y + 2, 0.75);
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
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = y >> 2, off = row % 2 ? 4 : 0;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    p.set(x, y, p.jit(mortar ? C.mortar : C.brick, mortar ? 0.03 : 0.1));
  }
});
tile('stone_bricks', (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = y >> 3, off = row % 2 ? 4 : 0;
    const gap = y % 8 === 7 || (x + off) % 8 === 7;
    const hi = y % 8 === 0 || (x + off) % 8 === 0;
    p.set(x, y, p.jit(gap ? C.stoneDark : hi ? C.stoneLight : C.stone, 0.04));
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
for (let s = 0; s < 10; s++) {
  tile('destroy_' + s, (p) => {
    p.transparent();
    const rand = mulberry32(99);
    const cracks = 2 + s;
    for (let c = 0; c < cracks; c++) {
      let x = 8, y = 8;
      const len = 3 + s;
      const ang = rand() * Math.PI * 2;
      for (let i = 0; i < len; i++) {
        p.set(Math.round(x), Math.round(y), [0, 0, 0], 150);
        x += Math.cos(ang) + (rand() - 0.5);
        y += Math.sin(ang) + (rand() - 0.5);
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
    const p = new Painter(name);
    const fn = painters[name];
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
  return TILE_NAMES.filter((n) => !painters[n]);
}
