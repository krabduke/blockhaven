// Blocky creature models: boxes with small procedurally painted textures.
// Every creature design in Blockhaven is original to this project.
//
// Units are model pixels (16 = one block). A part is a box hung from a
// pivot; parts can be nested so that rotating a pivot moves everything below
// it, and a part can carry extra boxes for small details.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hashString, mulberry32 } from '../noise';
import { HOSTILE_MODELS } from './hostile-models';
import { PASSIVE_MODELS } from './passive-models';

export type Paint = ((g: CanvasRenderingContext2D, w: number, h: number, face: number, rand: () => number) => void) & { native?: boolean };
type V3 = [number, number, number];

// ---------------------------------------------------------------- resolution
// Creature textures are painted at RES texels per model pixel. "Native" paints (the surface
// generators below, and anything made with `faces`/`native`) work in texels and get finer with
// RES: fur strands, wool curls and freckles become smaller and denser. Everything else is drawn
// in model pixels on a scaled canvas, so hand-placed details (eyes, stripes) land where they
// always did and may use fractions of a pixel (in steps of 1 / RES) for finer work.
export const RES = 3;
/** Texels per model pixel for the paint currently running (1 inside a scaled drawing). */
let U = 1;

/** Mark a paint as working in texels. */
export function native(p: Paint): Paint { p.native = true; return p; }

/** Run `fn` on a canvas scaled so one unit is one model pixel. */
function scaled(g: CanvasRenderingContext2D, fn: () => void): void {
  const u = U;
  if (u === 1) { fn(); return; }
  g.save();
  g.scale(u, u);
  U = 1;
  try { fn(); } finally { U = u; g.restore(); }
}

/** Paint a face at `u` texels per model pixel, whatever kind of paint it is. */
function paintFace(p: Paint, g: CanvasRenderingContext2D, wTex: number, hTex: number, f: number, rand: () => number, u: number): void {
  const prev = U;
  U = u;
  try {
    if (p.native) p(g, wTex, hTex, f, rand);
    else scaled(g, () => p(g, wTex / u, hTex / u, f, rand));
  } finally { U = prev; }
}

// ---------------------------------------------------------------- colour helpers
/** Parse '#rrggbb' or 'rgb(r,g,b)'. */
export function rgb(h: string): V3 {
  if (h.startsWith('rgb')) {
    const m = h.match(/-?[\d.]+/g)!.map(Number);
    return [m[0], m[1], m[2]];
  }
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function css(c: number[]): string {
  return `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(',')})`;
}
export function shade(hexColor: string, f: number): string {
  return css(rgb(hexColor).map((v) => v * f));
}
export function mixC(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return css(x.map((v, i) => v + (y[i] - v) * t));
}
export function px(g: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1): void {
  g.fillStyle = c;
  const s = g.getTransform().a;
  if (s === 1) { g.fillRect(x, y, w, h); return; }
  // On a scaled canvas, snap to whole texels so edges stay crisp.
  const x0 = Math.round(x * s), y0 = Math.round(y * s);
  g.fillRect(x0 / s, y0 / s, Math.max(1, Math.round((x + w) * s) - x0) / s, Math.max(1, Math.round((y + h) * s) - y0) / s);
}

// ---------------------------------------------------------------- paints
/** Face index in BoxGeometry order: 0 +x, 1 -x, 2 top, 3 bottom, 4 back (+z), 5 front (-z). */
export const FRONT = 5, BACK = 4, TOP = 2, BOTTOM = 3, RIGHT = 0, LEFT = 1;

/**
 * A soft vertical gradient (lighter on top, darker underneath) with per-pixel noise.
 * The top face takes the light colour and the bottom face the dark one, which reads as
 * light from above and gives each box some volume.
 */
export function tone(base: string, o: { top?: string; bottom?: string; noise?: number; under?: string } = {}): Paint {
  const b = rgb(base), t = rgb(o.top ?? shade(base, 1.12)), d = rgb(o.bottom ?? shade(base, 0.8));
  const under = o.under ? rgb(o.under) : null;
  const noise = o.noise ?? 0.07;
  return native((g, w, h, f, rand) => {
    // Called from a scaled (model-pixel) drawing: paint rect by rect so the scale applies.
    if (g.getTransform().a !== 1) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = h > 1 ? y / (h - 1) : 0.5;
        const c = f === TOP ? t : f === BOTTOM ? under ?? d : k < 0.5 ? t.map((v, i) => v + (b[i] - v) * k * 2) : b.map((v, i) => v + (d[i] - v) * (k - 0.5) * 2);
        const n = 1 + (rand() * 2 - 1) * noise;
        px(g, css(c.map((v) => v * n)), x, y);
      }
      return;
    }
    // Paint through an ImageData buffer: far quicker than a rect per texel.
    const img = g.getImageData(0, 0, w, h), d8 = img.data;
    // Noise in soft blobs about a model pixel wide, plus a finer grain on top.
    const cell = Math.max(1, U);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c: number[];
      if (f === TOP) c = t;
      else if (f === BOTTOM) c = under ?? d;
      else {
        const k = h > 1 ? y / (h - 1) : 0.5;
        c = k < 0.5 ? t.map((v, i) => v + (b[i] - v) * k * 2) : b.map((v, i) => v + (d[i] - v) * (k - 0.5) * 2);
        if (under && k > 0.75) c = c.map((v, i) => v + (under[i] - v) * (k - 0.75) * 3);
      }
      const coarse = hashNoise(Math.floor(x / cell), Math.floor(y / cell), f) * 2 - 1;
      const n = 1 + (coarse * 0.65 + (rand() * 2 - 1) * 0.5) * noise;
      const o4 = (x + y * w) * 4;
      d8[o4] = clamp8(c[0] * n); d8[o4 + 1] = clamp8(c[1] * n); d8[o4 + 2] = clamp8(c[2] * n); d8[o4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Fill every texel from `color(x, y)` (an [r, g, b] triple). Writes straight into the pixel buffer when
 * the canvas isn't scaled, which is far faster than a rectangle per texel.
 */
export function fillTexels(g: CanvasRenderingContext2D, w: number, h: number, color: (x: number, y: number) => number[]): void {
  if (g.getTransform().a !== 1) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(g, css(color(x, y)), x, y); return; }
  const img = g.getImageData(0, 0, w, h), d8 = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = color(x, y), o = (x + y * w) * 4;
    d8[o] = clamp8(c[0]); d8[o + 1] = clamp8(c[1]); d8[o + 2] = clamp8(c[2]); d8[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
/** A repeatable 0..1 value for a texel cell (so coarse noise is stable across a face). */
function hashNoise(x: number, y: number, f: number): number {
  let h = (x * 374761393 + y * 668265263 + f * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Fur: a tone with strands running down the sides and a ragged lower edge. */
export function fur(base: string, o: { top?: string; bottom?: string; under?: string; strand?: number } = {}): Paint {
  const t = tone(base, { ...o, noise: 0.05 });
  const strand = o.strand ?? 0.16;
  return native((g, w, h, f, rand) => {
    t(g, w, h, f, rand);
    const u = U;
    if (f === TOP || f === BOTTOM) {
      // Tufts seen from above: short dark flecks.
      for (let i = 0; i < w * h * 0.2; i++) px(g, 'rgba(0,0,0,0.12)', Math.floor(rand() * w), Math.floor(rand() * h), 1, Math.max(1, Math.floor(u * 0.7)));
      return;
    }
    // Hair strands, a texel wide, running downward; lit ones catch the light at their tips.
    for (let x = 0; x < w; x++) for (let k = 0; k < Math.max(1, Math.floor(u * 0.8)); k++) {
      const dark = rand() < 0.55;
      const len = u + Math.floor(rand() * Math.max(1, h * 0.55));
      const y0 = Math.floor(rand() * h);
      px(g, dark ? `rgba(0,0,0,${strand})` : `rgba(255,255,255,${strand * 0.6})`, x, y0, 1, len);
    }
    // A ragged hem where the coat ends.
    for (let x = 0; x < w; x++) if (rand() < 0.5) px(g, 'rgba(0,0,0,0.25)', x, h - 1 - Math.floor(rand() * u), 1, u);
  });
}

/** Wool: puffy curls, small light bumps with shadowed undersides. */
export function wool(base: string, o: { dark?: string; light?: string } = {}): Paint {
  const t = tone(base, { noise: 0.04 });
  const dark = o.dark ?? shade(base, 0.8), light = o.light ?? shade(base, 1.08);
  return native((g, w, h, f, rand) => {
    t(g, w, h, f, rand);
    const u = U;
    // Scattered curls, each a lit crescent over a shadow, sized to about a model pixel.
    const n = Math.floor((w * h * 0.22) / u);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rand() * w), y = Math.floor(rand() * h);
      const s = Math.max(1, Math.round(u * (rand() < 0.35 ? 1.6 : 1)));
      px(g, dark, x, y + Math.max(1, Math.floor(s / 2)), s, Math.max(1, Math.floor(s / 2)));
      px(g, light, x, y, s, Math.max(1, Math.ceil(s / 2)));
      if (u > 1) px(g, shade(light, 1.06), x + Math.floor(s / 3), y, Math.max(1, Math.floor(s / 3)), 1);
    }
    // Deeper shade low on the sides, where the fleece hangs.
    if (f !== TOP && f !== BOTTOM) for (let x = 0; x < w; x++) if (rand() < 0.6) px(g, dark, x, h - Math.max(1, Math.round(u * (1 + rand()))), 1, h);
  });
}

/** Overlapping scales or plates: each a darker rim and a lighter crown. */
export function scales(base: string, o: { edge?: string; rows?: number } = {}): Paint {
  const t = tone(base, { noise: 0.05 });
  const edge = o.edge ?? shade(base, 0.72), rows = o.rows ?? 2;
  return native((g, w, h, f, rand) => {
    t(g, w, h, f, rand);
    const u = U, r = Math.max(1, rows * u), cw = 2 * u;
    for (let y = r - Math.max(1, Math.floor(u / 2)), row = 0; y < h; y += r, row++) {
      for (let x = (row % 2) * u - u; x < w; x += cw) {
        px(g, edge, x, y, cw - 1, Math.max(1, Math.floor(u / 2)));
        if (u > 1) px(g, shade(base, 1.1), x + 1, y - r + 1, cw - 2, 1);
      }
    }
  });
}

/** Scatter spots or blotches over another paint (optionally on some faces only); sizes are in model pixels. */
export function spots(basePaint: Paint, color: string, density = 0.06, size = 2, only?: number[]): Paint {
  return native((g, w, h, f, rand) => {
    paintFace(basePaint, g, w, h, f, rand, U);
    if (only && !only.includes(f)) return;
    const u = U;
    const n = Math.max(1, Math.floor((w * h * density) / (u * u)));
    for (let i = 0; i < n; i++) {
      const s = Math.max(1, Math.round((1 + rand() * (size - 1 + 0.99)) * u));
      const sh = s > u && rand() < 0.5 ? s - u : s;
      const x = Math.floor(rand() * w), y = Math.floor(rand() * h);
      px(g, color, x, y, s, sh);
    }
  });
}

/** Horizontal bands of colour from top to bottom (clothing, stripes); row heights are in model pixels. */
export function bands(rows: [string, number][], noise = 0.06): Paint {
  const cols = rows.map(([c, n]) => [rgb(c), n] as const);
  return native((g, w, h, _f, rand) => {
    // Which band each texel row falls in.
    const which: number[] = [];
    for (let i = 0; i < cols.length; i++) for (let k = 0; k < Math.round(cols[i][1] * U); k++) which.push(i);
    fillTexels(g, w, h, (_x, y) => { const c = cols[which[y] ?? cols.length - 1][0], n = 1 + (rand() * 2 - 1) * noise; return [c[0] * n, c[1] * n, c[2] * n]; });
  });
}

type Draw = (g: CanvasRenderingContext2D, w: number, h: number, rand: () => number) => void;

/** Paint `base`, then draw over it in texels; `u` is texels per model pixel. */
export function over(base: Paint, fn: (g: CanvasRenderingContext2D, w: number, h: number, f: number, rand: () => number, u: number) => void): Paint {
  return native((g, w, h, f, rand) => { paintFace(base, g, w, h, f, rand, U); fn(g, w, h, f, rand, U); });
}

/** Paint a base, then draw extra detail on chosen faces (in model pixels, with fractions allowed). */
export function faces(base: Paint, draw: Partial<Record<number, Draw>>): Paint {
  return native((g, w, h, f, rand) => {
    paintFace(base, g, w, h, f, rand, U);
    const d = draw[f];
    if (d) { const u = U; scaled(g, () => d(g, w / u, h / u, rand)); }
  });
}

export function withFace(base: Paint, front: Draw): Paint {
  return faces(base, { [FRONT]: front });
}

/** A solid colour with light noise. */
export function solid(c: string, noise = 0.05): Paint {
  return tone(c, { top: c, bottom: c, noise });
}

/** Simple helper for small parts: base colour with dark and light flecks (flecks about a third of a pixel). */
export function speckle(base: string, dark: string, light?: string, amount = 0.25): Paint {
  const b = rgb(base), d = rgb(dark), l = light ? rgb(light) : null;
  return native((g, w, h, _f, rand) => {
    fillTexels(g, w, h, () => { const r = rand(); return r < amount ? d : l && r > 1 - amount * 0.6 ? l : b; });
  });
}

/**
 * An eye with a glint: iris, a dark pupil on the inner side and a white highlight.
 * `inner` is the side facing the nose ('l' or 'r' in texture space).
 */
export function eye(g: CanvasRenderingContext2D, x: number, y: number, iris: string, inner: 'l' | 'r', o: { pupil?: string; big?: boolean; white?: string } = {}): void {
  const s = o.big ? 3 : 2;
  if (o.white) px(g, o.white, x, y, s, s);
  px(g, iris, inner === 'r' ? x + (o.white ? 1 : 0) : x, y, o.white ? s - 1 : s, s);
  px(g, o.pupil ?? '#140e0a', inner === 'r' ? x + s - 1 : x, y + s - 1, 1, 1);
  px(g, 'rgba(255,255,255,0.9)', inner === 'r' ? x + (o.white ? 1 : 0) : x + s - 1, y);
}

/**
 * A detailed eye for high-resolution faces, in model pixels (thirds allowed): an optional white,
 * an iris with a darker rim, a round or slit pupil, and a glint. `look` shifts the iris sideways
 * (-1 to 1) when there's a white to move within.
 */
export function eye2(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, iris: string, o: { white?: string; pupil?: string; slit?: 'h' | 'v'; look?: number; lid?: string } = {}): void {
  const t = 1 / 3;
  if (o.white) px(g, o.white, x, y, w, h);
  const iw = o.white ? Math.max(t * 2, Math.round((w * 0.62) * 3) / 3) : w;
  const ix = o.white ? x + Math.round(((w - iw) / 2 + (o.look ?? 0) * (w - iw) / 2) * 3) / 3 : x;
  px(g, shade(iris, 0.62), ix, y, iw, h);
  if (iw > t * 2 && h > t * 2) px(g, iris, ix + t, y + t, iw - t * 2, h - t * 2);
  if (iw > t * 3 && h > t * 3) px(g, shade(iris, 1.25), ix + t, y + h - t * 2, iw - t * 2, t);
  const pupil = o.pupil ?? '#120c08';
  if (o.slit === 'h') px(g, pupil, ix, y + Math.round((h / 2 - t / 2) * 3) / 3, iw, t);
  else if (o.slit === 'v') px(g, pupil, ix + Math.round((iw / 2 - t / 2) * 3) / 3, y, t, h);
  else { const p = Math.max(t, Math.round(Math.min(iw, h) * 0.45 * 3) / 3); px(g, pupil, ix + Math.round(((iw - p) / 2) * 3) / 3, y + Math.round(((h - p) / 2) * 3) / 3, p, p); }
  px(g, 'rgba(255,255,255,0.95)', ix + t, y + t, t, t);
  if (o.lid) px(g, o.lid, x, y - t, w, t);
}

/** A glowing eye slit. */
export function glow(g: CanvasRenderingContext2D, x: number, y: number, w: number, color: string, core?: string): void {
  px(g, color, x, y, w, 1);
  if (core) px(g, core, x + Math.floor(w / 2), y);
}

// ---------------------------------------------------------------- building
// Every face of every box in a creature is painted into one texture atlas per
// creature kind, face shading is baked into vertex colours, and the boxes that
// hang from the same pivot are merged into one mesh. A creature is then one
// material and one draw call per moving part, instead of one per box face.

/** Relative brightness of each box face (+x, -x, top, bottom, back, front): light from above. */
const FACE_SHADE = [0.78, 0.78, 1, 0.55, 0.9, 0.92];

interface KindAtlas { texture: THREE.CanvasTexture; rects: Map<string, [number, number, number, number]> }
const atlases = new Map<string, KindAtlas>();

/** Paint every face of every box of a kind into one atlas (cached per kind). */
function kindAtlas(kind: string, boxes: { key: string; paint: Paint; size: V3 }[]): KindAtlas {
  const cached = atlases.get(kind);
  if (cached) return cached;
  const faces: { key: string; w: number; h: number; paint: Paint; f: number }[] = [];
  // Faces are painted at RES texels per model pixel (thin parts get at least one pixel's worth).
  const texels = (v: number) => Math.max(RES, Math.round(v * RES));
  for (const bx of boxes) {
    const w = texels(bx.size[0]), h = texels(bx.size[1]), d = texels(bx.size[2]);
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    dims.forEach(([fw, fh], f) => faces.push({ key: bx.key + f, w: fw, h: fh, paint: bx.paint, f }));
  }
  // Shelf packing, tallest first, with a pixel of padding so nearest sampling never bleeds.
  const W = 1024;
  const order = [...faces].sort((p, q) => q.h - p.h);
  const rects = new Map<string, [number, number, number, number]>();
  let x = 0, y = 0, shelf = 0;
  for (const fc of order) {
    if (x + fc.w + 1 > W) { x = 0; y += shelf + 1; shelf = 0; }
    rects.set(fc.key, [x, y, fc.w, fc.h]);
    x += fc.w + 1;
    shelf = Math.max(shelf, fc.h);
  }
  const H = Math.max(8, 1 << Math.ceil(Math.log2(y + shelf + 1)));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const tmp = document.createElement('canvas');
  const tg = tmp.getContext('2d', { willReadFrequently: true })!;
  for (const fc of faces) {
    const [rx, ry] = rects.get(fc.key)!;
    tmp.width = fc.w; tmp.height = fc.h;
    tg.setTransform(1, 0, 0, 1, 0, 0);
    paintFace(fc.paint, tg, fc.w, fc.h, fc.f, mulberry32(hashString(fc.key)), RES);
    g.drawImage(tmp, rx, ry);
  }
  const texture = new THREE.CanvasTexture(cv);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  const atlas = { texture, rects };
  atlases.set(kind, atlas);
  return atlas;
}

/** A box whose faces sample their atlas rects, with face shading in vertex colours. */
function atlasBox(atlas: KindAtlas, key: string, size: V3, offset: V3, rot?: V3): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16).toNonIndexed();
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const tex = atlas.texture.image as HTMLCanvasElement;
  const colors = new Float32Array(uv.count * 3);
  // Non-indexed box: 6 vertices per face, faces in the order +x -x +y -y +z -z.
  for (let f = 0; f < 6; f++) {
    const [rx, ry, rw, rh] = atlas.rects.get(key + f)!;
    for (let v = 0; v < 6; v++) {
      const i = f * 6 + v;
      const u = uv.getX(i), w = uv.getY(i);
      uv.setXY(i, (rx + u * rw) / tex.width, 1 - (ry + (1 - w) * rh) / tex.height);
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = FACE_SHADE[f];
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('normal');
  if (rot) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  geo.translate(offset[0] / 16, offset[1] / 16, offset[2] / 16);
  return geo;
}

export interface Detail {
  size: V3;
  offset: V3;
  paint: Paint;
  rot?: V3;
}

export interface PartSpec {
  name: string;
  /** Box size in model pixels. */
  size: V3;
  /** Pivot position in model pixels, measured from the creature's feet (absolute, even for children). */
  pivot: V3;
  /** Box centre relative to the pivot. */
  offset: V3;
  paint: Paint;
  parent?: string;
  /** Resting rotation in radians; animations add to it. */
  rot?: V3;
  /** Small extra boxes carried by this part (snouts, claws, spikes). */
  extra?: Detail[];
}

export interface MobModel {
  root: THREE.Group;
  /** Named pivots; `body` is the group everything hangs from (used for bobbing). */
  parts: Record<string, THREE.Object3D>;
  materials: THREE.MeshBasicMaterial[];
  shadow: THREE.Mesh;
}

let shadowTex: THREE.Texture | null = null;
function makeShadow(): THREE.Mesh {
  if (!shadowTex) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(16, 16, 2, 16, 16, 16);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    shadowTex = new THREE.CanvasTexture(cv);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.userData.isShadow = true;
  return m;
}

export function build(kind: string, specs: PartSpec[], shadowSize = 1): MobModel {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const parts: Record<string, THREE.Object3D> = { body: inner };
  const atlas = kindAtlas(kind, specs.flatMap((s) => [
    { key: `${kind}:${s.name}`, paint: s.paint, size: s.size },
    ...(s.extra ?? []).map((d, i) => ({ key: `${kind}:${s.name}:${i}`, paint: d.paint, size: d.size })),
  ]));
  // One material per creature (so damage flashes and light can tint it alone).
  // Alpha test lets paints cut ragged hems, moth holes and torn wings into a part.
  const material = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 });
  for (const s of specs) {
    const pivot = new THREE.Group();
    pivot.position.set(s.pivot[0] / 16, s.pivot[1] / 16, s.pivot[2] / 16);
    const geos = [atlasBox(atlas, `${kind}:${s.name}`, s.size, s.offset)];
    s.extra?.forEach((d, i) => geos.push(atlasBox(atlas, `${kind}:${s.name}:${i}`, d.size, d.offset, d.rot)));
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;
    if (geos.length > 1) for (const g of geos) g.dispose();
    pivot.add(new THREE.Mesh(merged, material));
    const parent = s.parent ? parts[s.parent] : inner;
    if (!parent) throw new Error(`${kind}: part '${s.name}' needs its parent '${s.parent}' defined before it`);
    if (s.parent) pivot.position.sub(parts[s.parent].userData.worldPivot ?? new THREE.Vector3());
    pivot.userData.worldPivot = new THREE.Vector3(s.pivot[0] / 16, s.pivot[1] / 16, s.pivot[2] / 16);
    const r = s.rot ?? [0, 0, 0];
    pivot.rotation.set(r[0], r[1], r[2]);
    pivot.userData.baseRot = r;
    pivot.userData.basePos = pivot.position.clone();
    parent.add(pivot);
    parts[s.name] = pivot;
  }
  const shadow = makeShadow();
  shadow.scale.setScalar(shadowSize);
  root.add(shadow);
  return { root, parts, materials: [material], shadow };
}

export function createModel(kind: string): MobModel {
  const hostile = HOSTILE_MODELS[kind];
  if (hostile) return hostile();
  const [base, variant] = kind.split(':');
  const passive = PASSIVE_MODELS[base];
  if (passive) return passive(variant);
  throw new Error('Unknown mob ' + kind);
}
