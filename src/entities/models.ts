// Blocky mob models, built from boxes with small procedurally painted
// textures. All creature designs here are original to this project.

import * as THREE from 'three';
import { hashString, mulberry32 } from '../noise';

type Paint = (g: CanvasRenderingContext2D, w: number, h: number, face: number, rand: () => number) => void;

function speckle(base: string, dark: string, light?: string, amount = 0.25): Paint {
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
function withFace(base: Paint, front: (g: CanvasRenderingContext2D, w: number, h: number) => void): Paint {
  return (g, w, h, f, rand) => {
    base(g, w, h, f, rand);
    if (f === 5) front(g, w, h);
  };
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

interface PartSpec {
  name: string;
  /** Size in model pixels (16 px = 1 block). */
  size: [number, number, number];
  /** Pivot position in model pixels (relative to the entity's feet). */
  pivot: [number, number, number];
  /** Box offset from the pivot. */
  offset: [number, number, number];
  paint: Paint;
  parent?: string;
}

export interface MobModel {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  materials: THREE.MeshBasicMaterial[];
}

function build(kind: string, specs: PartSpec[]): MobModel {
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
    parent.add(pivot);
    parts[s.name] = pivot;
  }
  return { root, parts, materials };
}

const eyes = (color: string, pupil: string, y: number, spread: number) => (g: CanvasRenderingContext2D, w: number) => {
  const cx = Math.floor(w / 2);
  g.fillStyle = color;
  g.fillRect(cx - spread - 1, y, 2, 2); g.fillRect(cx + spread - 1, y, 2, 2);
  g.fillStyle = pupil;
  g.fillRect(cx - spread, y + 1, 1, 1); g.fillRect(cx + spread - 1, y + 1, 1, 1);
};

export function createModel(kind: string): MobModel {
  switch (kind) {
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
    case 'mirewalker': {
      const mud = speckle('#3f4a2e', '#2c3520', '#5a6a3a', 0.4);
      const face = withFace(mud, (g, w) => {
        g.fillStyle = '#1a1f12'; g.fillRect(1, 3, w - 2, 2);
        g.fillStyle = '#f2d24a'; g.fillRect(2, 3, 2, 1); g.fillRect(w - 4, 3, 2, 1);
      });
      return build(kind, [
        { name: 'torso', size: [8, 12, 4], pivot: [0, 18, 0], offset: [0, 0, 0], paint: mud },
        { name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: face },
        { name: 'armL', size: [3, 14, 3], pivot: [-5.5, 23, 0], offset: [0, -6, 0], paint: speckle('#34402a', '#252e1c') },
        { name: 'armR', size: [3, 14, 3], pivot: [5.5, 23, 0], offset: [0, -6, 0], paint: speckle('#34402a', '#252e1c') },
        { name: 'legL', size: [4, 12, 4], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: speckle('#2c3520', '#1f2717') },
        { name: 'legR', size: [4, 12, 4], pivot: [2, 12, 0], offset: [0, -6, 0], paint: speckle('#2c3520', '#1f2717') },
      ]);
    }
    case 'brambler': {
      const bark = speckle('#34462a', '#243220', '#4a6236', 0.4);
      const thorny: Paint = (g, w, h, f, rand) => {
        bark(g, w, h, f, rand);
        g.fillStyle = '#a8342a';
        for (let i = 0; i < Math.max(2, (w * h) / 10); i++) g.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 1, 1);
      };
      const face = withFace(thorny, (g, w) => {
        g.fillStyle = '#141a10'; g.fillRect(1, 2, w - 2, 3);
        g.fillStyle = '#f5b030'; g.fillRect(Math.floor(w / 2) - 1, 3, 2, 1);
      });
      return build(kind, [
        { name: 'torso', size: [8, 11, 6], pivot: [0, 18, 1], offset: [0, 0, 0], paint: thorny },
        { name: 'head', size: [7, 7, 7], pivot: [0, 23, -1], offset: [0, 3.5, -1], paint: face },
        { name: 'crest', size: [2, 4, 6], pivot: [0, 30, -1], offset: [0, 1, 0], paint: speckle('#a8342a', '#7a2018'), parent: 'head' },
        { name: 'armL', size: [2, 14, 2], pivot: [-5, 22, 0], offset: [0, -6, 0], paint: thorny },
        { name: 'armR', size: [2, 14, 2], pivot: [5, 22, 0], offset: [0, -6, 0], paint: thorny },
        { name: 'legL', size: [3, 12, 3], pivot: [-2, 12, 1], offset: [0, -6, 0], paint: speckle('#243220', '#18220f') },
        { name: 'legR', size: [3, 12, 3], pivot: [2, 12, 1], offset: [0, -6, 0], paint: speckle('#243220', '#18220f') },
      ]);
    }
    case 'shellcrawler': {
      const shell = speckle('#2f6f6a', '#1f4f4b', '#4a948c', 0.35);
      const face = withFace(speckle('#244a47', '#1a3634'), (g, w) => {
        g.fillStyle = '#f0a030';
        g.fillRect(1, 1, 1, 1); g.fillRect(3, 2, 1, 1); g.fillRect(w - 2, 1, 1, 1); g.fillRect(w - 4, 2, 1, 1);
      });
      const leg = speckle('#1a3634', '#10221f');
      const legs: PartSpec[] = [];
      for (let i = 0; i < 3; i++) {
        const z = -4 + i * 4;
        legs.push({ name: 'legL' + i, size: [12, 2, 2], pivot: [-5, 5, z], offset: [-6, 0, 0], paint: leg });
        legs.push({ name: 'legR' + i, size: [12, 2, 2], pivot: [5, 5, z], offset: [6, 0, 0], paint: leg });
      }
      return build(kind, [
        { name: 'torso', size: [11, 6, 14], pivot: [0, 6, 1], offset: [0, 0, 0], paint: shell },
        { name: 'head', size: [8, 5, 5], pivot: [0, 6, -6], offset: [0, 0, -2.5], paint: face },
        ...legs,
      ]);
    }
    default:
      throw new Error('Unknown mob ' + kind);
  }
}
