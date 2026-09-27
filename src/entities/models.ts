// Blocky mob models, built from boxes with small procedurally painted
// textures. All creature designs here are original to this project.

import * as THREE from 'three';
import { hashString, mulberry32 } from '../noise';
import { HOSTILE_MODELS } from './hostile-models';

export type Paint = (g: CanvasRenderingContext2D, w: number, h: number, face: number, rand: () => number) => void;

export function speckle(base: string, dark: string, light?: string, amount = 0.25): Paint {
  return (g, w, h, _f, rand) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = rand();
      if (r < amount) { g.fillStyle = dark; g.fillRect(x, y, 1, 1); }
      else if (light && r > 1 - amount * 0.6) { g.fillStyle = light; g.fillRect(x, y, 1, 1); }
    }
  };
}

/** Face index in BoxGeometry order: +x, -x, +y, -y, +z, -z. Front of a mob is -z. */
export function withFace(base: Paint, front: (g: CanvasRenderingContext2D, w: number, h: number) => void): Paint {
  return (g, w, h, f, rand) => {
    base(g, w, h, f, rand);
    if (f === 5) front(g, w, h);
  };
}

export function shade(hexColor: string, f: number): string {
  const n = parseInt(hexColor.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const matCache = new Map<string, THREE.MeshBasicMaterial[]>();

function boxMaterials(key: string, paint: Paint, px: [number, number, number]): THREE.MeshBasicMaterial[] {
  const cached = matCache.get(key);
  if (cached) return cached.map((m) => m.clone());
  const dims: [number, number][] = [[px[2], px[1]], [px[2], px[1]], [px[0], px[2]], [px[0], px[2]], [px[0], px[1]], [px[0], px[1]]];
  const mats = dims.map(([w, h], f) => {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, w); cv.height = Math.max(1, h);
    const g = cv.getContext('2d')!;
    paint(g, cv.width, cv.height, f, mulberry32(hashString(key + f)));
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace;
    const shade = [0.75, 0.75, 1, 0.55, 0.9, 0.9][f];
    const m = new THREE.MeshBasicMaterial({ map: t });
    m.userData.shade = shade;
    m.color.setScalar(shade);
    return m;
  });
  matCache.set(key, mats);
  return mats.map((m) => m.clone());
}

export interface PartSpec {
  name: string;
  /** Size in model pixels (16 px = 1 block). */
  size: [number, number, number];
  /** Pivot position in model pixels (relative to the entity's feet). */
  pivot: [number, number, number];
  /** Box offset from the pivot. */
  offset: [number, number, number];
  paint: Paint;
  parent?: string;
  /** Resting rotation in radians; animations add to it. */
  rot?: [number, number, number];
}

export interface MobModel {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  materials: THREE.MeshBasicMaterial[];
}

export function build(kind: string, specs: PartSpec[]): MobModel {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const parts: Record<string, THREE.Object3D> = { body: inner };
  const materials: THREE.MeshBasicMaterial[] = [];
  for (const s of specs) {
    const pivot = new THREE.Group();
    pivot.position.set(s.pivot[0] / 16, s.pivot[1] / 16, s.pivot[2] / 16);
    const mats = boxMaterials(kind + ':' + s.name, s.paint, s.size);
    materials.push(...mats);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.size[0] / 16, s.size[1] / 16, s.size[2] / 16), mats);
    mesh.position.set(s.offset[0] / 16, s.offset[1] / 16, s.offset[2] / 16);
    pivot.add(mesh);
    const parent = s.parent ? parts[s.parent] : inner;
    if (s.parent) pivot.position.sub(parts[s.parent].userData.worldPivot ?? new THREE.Vector3());
    pivot.userData.worldPivot = new THREE.Vector3(s.pivot[0] / 16, s.pivot[1] / 16, s.pivot[2] / 16);
    const r = s.rot ?? [0, 0, 0];
    pivot.rotation.set(r[0], r[1], r[2]);
    pivot.userData.baseRot = r;
    parent.add(pivot);
    parts[s.name] = pivot;
  }
  return { root, parts, materials };
}

export const eyes = (color: string, pupil: string, y: number, spread: number) => (g: CanvasRenderingContext2D, w: number) => {
  const cx = Math.floor(w / 2);
  g.fillStyle = color;
  g.fillRect(cx - spread - 1, y, 2, 2); g.fillRect(cx + spread - 1, y, 2, 2);
  g.fillStyle = pupil;
  g.fillRect(cx - spread, y + 1, 1, 1); g.fillRect(cx + spread - 1, y + 1, 1, 1);
};

const ROBES: Record<string, [string, string]> = {
  farmer: ['#8a6a2a', '#d8b848'], shepherd: ['#e8e2d4', '#8a7a5a'], fisher: ['#3a6a8a', '#d8c888'], butcher: ['#b8b0a8', '#9a2a2a'],
  cleric: ['#6a3a8a', '#e8c848'], smith: ['#3a3a3a', '#8a5a2a'], librarian: ['#2a4a7a', '#e8e0c8'],
};

export function createModel(kind: string): MobModel {
  const hostile = HOSTILE_MODELS[kind];
  if (hostile) return hostile();
  if (kind.startsWith('villager')) {
    const prof = kind.split(':')[1] ?? 'farmer';
    const [robe, trim] = ROBES[prof] ?? ROBES.farmer;
    const face = withFace(speckle('#c89a78', '#b8886a'), (g, w) => {
      g.fillStyle = '#2a1e14'; g.fillRect(2, 3, 1, 1); g.fillRect(w - 3, 3, 1, 1);
      g.fillStyle = '#9a6a52'; g.fillRect(Math.floor(w / 2) - 1, 5, 2, 1);
    });
    const robeP: Paint = (g, w, h, f, rand) => {
      speckle(robe, shade(robe, 0.8))(g, w, h, f, rand);
      g.fillStyle = trim; g.fillRect(0, 0, w, 1); g.fillRect(0, h - 1, w, 1);
    };
    return build(kind, [
      { name: 'torso', size: [8, 14, 5], pivot: [0, 17, 0], offset: [0, 0, 0], paint: robeP },
      { name: 'head', size: [7, 7, 7], pivot: [0, 24, 0], offset: [0, 3.5, 0], paint: face },
      { name: 'hat', size: [11, 1, 11], pivot: [0, 31, 0], offset: [0, 0, 0], paint: speckle(trim, shade(trim, 0.8)), parent: 'head' },
      { name: 'hatTop', size: [6, 2, 6], pivot: [0, 32, 0], offset: [0, 0.5, 0], paint: speckle(trim, shade(trim, 0.8)), parent: 'head' },
      { name: 'armL', size: [3, 11, 3], pivot: [-5.5, 22, 0], offset: [0, -5, 0], paint: robeP },
      { name: 'armR', size: [3, 11, 3], pivot: [5.5, 22, 0], offset: [0, -5, 0], paint: robeP },
      { name: 'legL', size: [3, 10, 3], pivot: [-2, 10, 0], offset: [0, -5, 0], paint: speckle('#4a3a2a', '#3a2a1e') },
      { name: 'legR', size: [3, 10, 3], pivot: [2, 10, 0], offset: [0, -5, 0], paint: speckle('#4a3a2a', '#3a2a1e') },
    ]);
  }
  switch (kind) {
    case 'stonewarden': {
      const stone = speckle('#7a7a74', '#5a5a56', '#9a9a92', 0.4);
      const mossy: Paint = (g, w, h, f, rand) => { stone(g, w, h, f, rand); g.fillStyle = '#4f7a2e'; for (let i = 0; i < (w * h) / 6; i++) g.fillRect(Math.floor(rand() * w), Math.floor(rand() * Math.max(1, h / 3)), 1, 1); };
      const face = withFace(mossy, (g, w) => { g.fillStyle = '#1e1e1c'; g.fillRect(2, 3, w - 4, 3); g.fillStyle = '#ffd060'; g.fillRect(Math.floor(w / 2) - 1, 4, 2, 1); });
      return build(kind, [
        { name: 'torso', size: [14, 14, 8], pivot: [0, 26, 0], offset: [0, 0, 0], paint: mossy },
        { name: 'head', size: [8, 8, 8], pivot: [0, 33, -1], offset: [0, 4, 0], paint: face },
        { name: 'crown', size: [10, 2, 10], pivot: [0, 41, -1], offset: [0, 0, 0], paint: speckle('#4f7a2e', '#3a5e20'), parent: 'head' },
        { name: 'armL', size: [5, 22, 5], pivot: [-9.5, 32, 0], offset: [0, -10, 0], paint: stone },
        { name: 'armR', size: [5, 22, 5], pivot: [9.5, 32, 0], offset: [0, -10, 0], paint: stone },
        { name: 'legL', size: [5, 19, 5], pivot: [-3.5, 19, 0], offset: [0, -9.5, 0], paint: stone },
        { name: 'legR', size: [5, 19, 5], pivot: [3.5, 19, 0], offset: [0, -9.5, 0], paint: stone },
      ]);
    }
    case 'burrowfox': {
      const fur = speckle('#c8682a', '#a8521e', '#e0843a', 0.3);
      const face = withFace(fur, (g, w) => { g.fillStyle = '#f0e8dc'; g.fillRect(1, 4, w - 2, 2); g.fillStyle = '#1a1210'; g.fillRect(1, 2, 1, 1); g.fillRect(w - 2, 2, 1, 1); g.fillRect(Math.floor(w / 2), 5, 1, 1); });
      return build(kind, [
        { name: 'torso', size: [6, 6, 11], pivot: [0, 7, 0], offset: [0, 0, 0], paint: fur },
        { name: 'head', size: [7, 6, 5], pivot: [0, 9, -6], offset: [0, 1, -2], paint: face },
        { name: 'earL', size: [2, 3, 1], pivot: [-2, 13, -7], offset: [0, 0.5, 0], paint: speckle('#3a2418', '#2a1810'), parent: 'head' },
        { name: 'earR', size: [2, 3, 1], pivot: [2, 13, -7], offset: [0, 0.5, 0], paint: speckle('#3a2418', '#2a1810'), parent: 'head' },
        { name: 'tail', size: [4, 4, 9], pivot: [0, 8, 5], offset: [0, 0, 4], paint: withFace(fur, () => {}) },
        { name: 'tip', size: [4, 4, 3], pivot: [0, 8, 14], offset: [0, 0, 1], paint: speckle('#f0e8dc', '#d8d0c4'), parent: 'tail' },
        { name: 'legFL', size: [2, 4, 2], pivot: [-2, 4, -4], offset: [0, -2, 0], paint: speckle('#2a1a12', '#1a100a') },
        { name: 'legFR', size: [2, 4, 2], pivot: [2, 4, -4], offset: [0, -2, 0], paint: speckle('#2a1a12', '#1a100a') },
        { name: 'legBL', size: [2, 4, 2], pivot: [-2, 4, 4], offset: [0, -2, 0], paint: speckle('#2a1a12', '#1a100a') },
        { name: 'legBR', size: [2, 4, 2], pivot: [2, 4, 4], offset: [0, -2, 0], paint: speckle('#2a1a12', '#1a100a') },
      ]);
    }
    case 'bogfrog': {
      const skin = speckle('#4a7a2a', '#3a5e1e', '#6a9a3a', 0.35);
      return build(kind, [
        { name: 'torso', size: [7, 4, 8], pivot: [0, 3, 0], offset: [0, 0, 0], paint: skin },
        { name: 'head', size: [7, 3, 4], pivot: [0, 5, -3], offset: [0, 1, -1], paint: withFace(skin, (g, w) => { g.fillStyle = '#d8784a'; g.fillRect(0, 2, w, 1); }) },
        { name: 'eyeL', size: [2, 2, 2], pivot: [-2.5, 8, -3], offset: [0, 0, 0], paint: withFace(speckle('#e8e0a0', '#d8d090'), (g) => { g.fillStyle = '#101010'; g.fillRect(0, 0, 1, 1); }), parent: 'head' },
        { name: 'eyeR', size: [2, 2, 2], pivot: [2.5, 8, -3], offset: [0, 0, 0], paint: withFace(speckle('#e8e0a0', '#d8d090'), (g) => { g.fillStyle = '#101010'; g.fillRect(1, 0, 1, 1); }), parent: 'head' },
        { name: 'legBL', size: [3, 2, 4], pivot: [-4, 1, 3], offset: [0, 0, 0], paint: skin },
        { name: 'legBR', size: [3, 2, 4], pivot: [4, 1, 3], offset: [0, 0, 0], paint: skin },
      ]);
    }
    case 'cavemoth': {
      const dust = speckle('#8a7a6a', '#6a5a4a', '#a89888', 0.4);
      return build(kind, [
        { name: 'torso', size: [2, 2, 5], pivot: [0, 4, 0], offset: [0, 0, 0], paint: speckle('#4a3a2a', '#3a2a1e') },
        { name: 'wingL', size: [6, 0.5, 5], pivot: [-1, 5, 0], offset: [-3, 0, 0], paint: dust },
        { name: 'wingR', size: [6, 0.5, 5], pivot: [1, 5, 0], offset: [3, 0, 0], paint: dust },
      ]);
    }
    case 'streamfish': {
      const scales = speckle('#6a8ab0', '#4a6a90', '#9ab8d8', 0.35);
      return build(kind, [
        { name: 'torso', size: [2, 4, 7], pivot: [0, 2, 0], offset: [0, 0, 0], paint: withFace(scales, (g) => { g.fillStyle = '#101010'; g.fillRect(0, 1, 1, 1); }) },
        { name: 'tail', size: [0.5, 4, 3], pivot: [0, 2, 3.5], offset: [0, 0, 1.5], paint: speckle('#e0a060', '#c08040') },
      ]);
    }
    case 'boar': {
      const hide = speckle('#6b5140', '#4f3a2c', '#86694f', 0.35);
      const face = withFace(hide, (g, w, h) => {
        eyes('#1c140f', '#1c140f', 2, 3)(g, w);
      });
      const snout = withFace(speckle('#b58a78', '#9a6f5f'), (g) => { g.fillStyle = '#4a2d25'; g.fillRect(1, 1, 1, 1); g.fillRect(4, 1, 1, 1); });
      return build(kind, [
        { name: 'torso', size: [10, 9, 15], pivot: [0, 12, 0], offset: [0, 0, 0], paint: hide },
        { name: 'mane', size: [4, 3, 12], pivot: [0, 17, 0], offset: [0, 0, 0], paint: speckle('#3b2b20', '#2a1e16') },
        { name: 'head', size: [9, 8, 7], pivot: [0, 12, -8], offset: [0, 1, -3], paint: face },
        { name: 'snout', size: [6, 4, 3], pivot: [0, 10, -14], offset: [0, 0, -0.5], paint: snout, parent: 'head' },
        { name: 'tuskL', size: [1, 3, 1], pivot: [-3, 10, -14], offset: [0, 1, 0], paint: speckle('#efe7d2', '#d6ccb2'), parent: 'head' },
        { name: 'tuskR', size: [1, 3, 1], pivot: [3, 10, -14], offset: [0, 1, 0], paint: speckle('#efe7d2', '#d6ccb2'), parent: 'head' },
        { name: 'legFL', size: [3, 7, 3], pivot: [-3, 7, -5], offset: [0, -3.5, 0], paint: speckle('#4f3a2c', '#3a2a20') },
        { name: 'legFR', size: [3, 7, 3], pivot: [3, 7, -5], offset: [0, -3.5, 0], paint: speckle('#4f3a2c', '#3a2a20') },
        { name: 'legBL', size: [3, 7, 3], pivot: [-3, 7, 5], offset: [0, -3.5, 0], paint: speckle('#4f3a2c', '#3a2a20') },
        { name: 'legBR', size: [3, 7, 3], pivot: [3, 7, 5], offset: [0, -3.5, 0], paint: speckle('#4f3a2c', '#3a2a20') },
      ]);
    }
    case 'hen': {
      const feathers = speckle('#b9875a', '#8f6440', '#d8b48a', 0.4);
      const face = withFace(feathers, eyes('#111', '#111', 2, 2));
      return build(kind, [
        { name: 'torso', size: [6, 6, 8], pivot: [0, 6, 0], offset: [0, 0, 0], paint: feathers },
        { name: 'head', size: [4, 5, 4], pivot: [0, 9, -3], offset: [0, 1.5, -1], paint: face },
        { name: 'beak', size: [2, 1, 2], pivot: [0, 10, -6], offset: [0, 0, -0.5], paint: speckle('#e0a030', '#c08020'), parent: 'head' },
        { name: 'crest', size: [1, 2, 3], pivot: [0, 13, -4], offset: [0, 0.5, 0], paint: speckle('#5a8a3a', '#3f6a28'), parent: 'head' },
        { name: 'wingL', size: [1, 4, 6], pivot: [-3.5, 8, 0], offset: [0, -2, 0], paint: speckle('#8f6440', '#6f4a2c') },
        { name: 'wingR', size: [1, 4, 6], pivot: [3.5, 8, 0], offset: [0, -2, 0], paint: speckle('#8f6440', '#6f4a2c') },
        { name: 'legL', size: [1, 3, 1], pivot: [-1.5, 3, 0], offset: [0, -1.5, 0], paint: speckle('#d09a30', '#b08020') },
        { name: 'legR', size: [1, 3, 1], pivot: [1.5, 3, 0], offset: [0, -1.5, 0], paint: speckle('#d09a30', '#b08020') },
      ]);
    }
    case 'woolback': {
      const wool = speckle('#ece4cf', '#d4c9ae', '#faf6ea', 0.4);
      const face = withFace(speckle('#3b3431', '#2b2522'), eyes('#e8d060', '#1a1a1a', 2, 2));
      const horn = speckle('#a08a6a', '#7a6548');
      return build(kind, [
        { name: 'torso', size: [11, 10, 15], pivot: [0, 14, 0], offset: [0, 0, 0], paint: wool },
        { name: 'head', size: [6, 7, 6], pivot: [0, 17, -8], offset: [0, 0, -3], paint: face },
        { name: 'hornL', size: [2, 4, 3], pivot: [-4, 19, -10], offset: [0, -1, 1], paint: horn, parent: 'head' },
        { name: 'hornR', size: [2, 4, 3], pivot: [4, 19, -10], offset: [0, -1, 1], paint: horn, parent: 'head' },
        { name: 'legFL', size: [3, 9, 3], pivot: [-3, 9, -5], offset: [0, -4.5, 0], paint: speckle('#3b3431', '#2b2522') },
        { name: 'legFR', size: [3, 9, 3], pivot: [3, 9, -5], offset: [0, -4.5, 0], paint: speckle('#3b3431', '#2b2522') },
        { name: 'legBL', size: [3, 9, 3], pivot: [-3, 9, 5], offset: [0, -4.5, 0], paint: speckle('#3b3431', '#2b2522') },
        { name: 'legBR', size: [3, 9, 3], pivot: [3, 9, 5], offset: [0, -4.5, 0], paint: speckle('#3b3431', '#2b2522') },
      ]);
    }
    default:
      throw new Error('Unknown mob ' + kind);
  }
}
