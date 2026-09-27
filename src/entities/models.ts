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

export type Paint = (g: CanvasRenderingContext2D, w: number, h: number, face: number, rand: () => number) => void;
type V3 = [number, number, number];

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
  g.fillRect(x, y, w, h);
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
  return (g, w, h, f, rand) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c: number[];
      if (f === TOP) c = t;
      else if (f === BOTTOM) c = under ?? d;
      else {
        const k = h > 1 ? y / (h - 1) : 0.5;
        c = k < 0.5 ? t.map((v, i) => v + (b[i] - v) * k * 2) : b.map((v, i) => v + (d[i] - v) * (k - 0.5) * 2);
        if (under && k > 0.75) c = c.map((v, i) => v + (under[i] - v) * (k - 0.75) * 3);
      }
      const n = 1 + (rand() * 2 - 1) * noise;
      px(g, css(c.map((v) => v * n)), x, y);
    }
  };
}

/** Fur: a tone with strands running down the sides and a ragged lower edge. */
export function fur(base: string, o: { top?: string; bottom?: string; under?: string; strand?: number } = {}): Paint {
  const t = tone(base, { ...o, noise: 0.05 });
  const strand = o.strand ?? 0.16;
  return (g, w, h, f, rand) => {
    t(g, w, h, f, rand);
    if (f === TOP || f === BOTTOM) {
      for (let i = 0; i < w * h * 0.25; i++) px(g, 'rgba(0,0,0,0.12)', Math.floor(rand() * w), Math.floor(rand() * h));
      return;
    }
    for (let x = 0; x < w; x++) {
      const dark = rand() < 0.5;
      const len = 1 + Math.floor(rand() * Math.max(1, h * 0.6));
      const y0 = Math.floor(rand() * h);
      px(g, dark ? `rgba(0,0,0,${strand})` : `rgba(255,255,255,${strand * 0.6})`, x, y0, 1, len);
    }
    for (let x = 0; x < w; x++) if (rand() < 0.45) px(g, 'rgba(0,0,0,0.25)', x, h - 1);
  };
}

/** Wool: puffy curls, small light bumps with shadowed undersides. */
export function wool(base: string, o: { dark?: string; light?: string } = {}): Paint {
  const t = tone(base, { noise: 0.04 });
  const dark = o.dark ?? shade(base, 0.8), light = o.light ?? shade(base, 1.08);
  return (g, w, h, f, rand) => {
    t(g, w, h, f, rand);
    // Scattered curls: a lit crown and a shadowed underside, jittered so they never line up.
    const n = Math.floor(w * h * 0.22);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rand() * w), y = Math.floor(rand() * h);
      const big = rand() < 0.35;
      px(g, dark, x, y + 1, big ? 2 : 1, 1);
      px(g, light, x, y, big ? 2 : 1, 1);
      if (big && rand() < 0.5) px(g, dark, x + 2, y);
    }
    // Deeper shade low on the sides, where the fleece hangs.
    if (f !== TOP && f !== BOTTOM) for (let x = 0; x < w; x++) if (rand() < 0.6) px(g, dark, x, h - 1 - Math.floor(rand() * 2));
  };
}

/** Overlapping scales or plates. */
export function scales(base: string, o: { edge?: string; rows?: number } = {}): Paint {
  const t = tone(base, { noise: 0.05 });
  const edge = o.edge ?? shade(base, 0.72), rows = o.rows ?? 2;
  return (g, w, h, f, rand) => {
    t(g, w, h, f, rand);
    for (let y = rows - 1; y < h; y += rows) for (let x = (y / rows) % 2; x < w; x += 2) px(g, edge, x, y);
  };
}

/** Scatter spots or blotches over another paint (optionally on some faces only). */
export function spots(basePaint: Paint, color: string, density = 0.06, size = 2, only?: number[]): Paint {
  return (g, w, h, f, rand) => {
    basePaint(g, w, h, f, rand);
    if (only && !only.includes(f)) return;
    const n = Math.max(1, Math.floor(w * h * density));
    for (let i = 0; i < n; i++) {
      const s = 1 + Math.floor(rand() * size);
      px(g, color, Math.floor(rand() * w), Math.floor(rand() * h), s, s > 1 && rand() < 0.5 ? s - 1 : s);
    }
  };
}

/** Horizontal bands of colour from top to bottom (clothing, stripes). */
export function bands(rows: [string, number][], noise = 0.06): Paint {
  return (g, w, h, _f, rand) => {
    let y = 0;
    for (const [c, n] of rows) for (let k = 0; k < n && y < h; k++, y++) for (let x = 0; x < w; x++) px(g, shade(c, 1 + (rand() * 2 - 1) * noise), x, y);
    const last = rows[rows.length - 1][0];
    while (y < h) { for (let x = 0; x < w; x++) px(g, shade(last, 1 + (rand() * 2 - 1) * noise), x, y); y++; }
  };
}

type Draw = (g: CanvasRenderingContext2D, w: number, h: number, rand: () => number) => void;

/** Paint a base, then draw extra detail on chosen faces. */
export function faces(base: Paint, draw: Partial<Record<number, Draw>>): Paint {
  return (g, w, h, f, rand) => { base(g, w, h, f, rand); draw[f]?.(g, w, h, rand); };
}

export function withFace(base: Paint, front: Draw): Paint {
  return faces(base, { [FRONT]: front });
}

/** A solid colour with light noise. */
export function solid(c: string, noise = 0.05): Paint {
  return (g, w, h, _f, rand) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(g, shade(c, 1 + (rand() * 2 - 1) * noise), x, y); };
}

/** Simple helper for small parts: base colour with dark and light flecks. */
export function speckle(base: string, dark: string, light?: string, amount = 0.25): Paint {
  return (g, w, h, _f, rand) => {
    px(g, base, 0, 0, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = rand();
      if (r < amount) px(g, dark, x, y);
      else if (light && r > 1 - amount * 0.6) px(g, light, x, y);
    }
  };
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
  for (const bx of boxes) {
    const w = Math.max(1, Math.round(bx.size[0])), h = Math.max(1, Math.round(bx.size[1])), d = Math.max(1, Math.round(bx.size[2]));
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    dims.forEach(([fw, fh], f) => faces.push({ key: bx.key + f, w: fw, h: fh, paint: bx.paint, f }));
  }
  // Shelf packing, tallest first, with a pixel of padding so nearest sampling never bleeds.
  const W = 256;
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
  const tg = tmp.getContext('2d')!;
  for (const fc of faces) {
    const [rx, ry] = rects.get(fc.key)!;
    tmp.width = fc.w; tmp.height = fc.h;
    fc.paint(tg, fc.w, fc.h, fc.f, mulberry32(hashString(fc.key)));
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
  const material = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true });
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
