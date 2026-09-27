// Peaceful creatures, villagers and the village guardian. Original designs.

import {
  BACK, BOTTOM, FRONT, LEFT, RIGHT, TOP,
  bands, build, eye, faces, fur, glow, px, shade, solid, speckle, spots, tone, withFace, wool,
  type MobModel, type Paint, type PartSpec,
} from './models';

const hoof = solid('#241c16');
const box = (size: [number, number, number], offset: [number, number, number], paint: Paint, rot?: [number, number, number]) => ({ size, offset, paint, rot });

const ivory = tone('#eee4c8', { bottom: '#c8bc9c' });

// ---------------------------------------------------------------- Boar
// A stocky wild boar: bristly dark mane, flat pink snout, curved tusks.
function boar(): MobModel {
  const hide = fur('#6e5038', { top: '#4e3826', under: '#8a6a4e' });
  const face = withFace(fur('#634630', { top: '#4e3826' }), (g, w) => {
    px(g, '#3a2818', 0, 1, w, 1);                       // heavy brow
    eye(g, 1, 2, '#2a1a10', 'r'); eye(g, w - 3, 2, '#2a1a10', 'l');
    px(g, '#7e5e42', 0, 5, w, 3);                       // lighter jowls
  });
  const snout = faces(tone('#c08a74', { top: '#d09a84', bottom: '#9a6a58' }), {
    [FRONT]: (g, w) => { px(g, '#5a2e28', 1, 1, 1, 2); px(g, '#5a2e28', w - 2, 1, 1, 2); px(g, '#e0aa94', 0, 0, w, 1); },
  });
  const leg = faces(fur('#5a4030', { top: '#4a3424' }), {});
  const parts: PartSpec[] = [
    { name: 'torso', size: [11, 10, 16], pivot: [0, 7, 0.5], offset: [0, 5, 0], paint: hide },
    {
      name: 'mane', size: [3, 3, 14], pivot: [0, 17, 0], offset: [0, 0.5, -0.5], paint: spots(fur('#2e2016'), '#6a5040', 0.1, 1), parent: 'torso',
      // Bristles standing up along the spine, tallest over the shoulders.
      extra: [[-5, 3], [-2, 2.5], [1, 2], [4, 1.5]].map(([z, hgt]) => ({ size: [1.5, hgt, 2] as [number, number, number], offset: [0, 2 + hgt / 2, z] as [number, number, number], paint: fur('#241810') })),
    },
    { name: 'head', size: [9, 8, 7], pivot: [0, 12, -7.5], offset: [0, 0, -3.5], paint: face },
    { name: 'lids', size: [2, 2, 0.4], pivot: [2.5, 13, -14.6], offset: [0, 0, 0], paint: fur('#4e3826'), parent: 'head', extra: [{ size: [2, 2, 0.4], offset: [-5, 0, 0], paint: fur('#4e3826') }] },
    { name: 'snout', size: [6, 4, 3], pivot: [0, 10, -14.5], offset: [0, 0, -1.5], paint: snout, parent: 'head' },
    { name: 'tuskL', size: [1, 3, 1], pivot: [-3, 10, -15], offset: [0, 1.5, 0], paint: ivory, parent: 'snout', rot: [0.35, 0, -0.3] },
    { name: 'tuskR', size: [1, 3, 1], pivot: [3, 10, -15], offset: [0, 1.5, 0], paint: ivory, parent: 'snout', rot: [0.35, 0, 0.3] },
    { name: 'earL', size: [3, 3, 1], pivot: [-3.5, 15.5, -9], offset: [-0.5, 1.5, 0], paint: fur('#4e3826'), parent: 'head', rot: [0.2, 0, 0.55] },
    { name: 'earR', size: [3, 3, 1], pivot: [3.5, 15.5, -9], offset: [0.5, 1.5, 0], paint: fur('#4e3826'), parent: 'head', rot: [0.2, 0, -0.55] },
    { name: 'tail', size: [1, 5, 1], pivot: [0, 15, 8.5], offset: [0, -2.5, 0], paint: fur('#4e3826'), parent: 'torso', rot: [0.35, 0, 0], extra: [{ size: [2, 2, 2], offset: [0, -5.5, 0], paint: fur('#2e2016') }] },
  ];
  for (const [n, x, z] of [['legFL', -3.5, -4.5], ['legFR', 3.5, -4.5], ['legBL', -3.5, 5], ['legBR', 3.5, 5]] as const) {
    parts.push({ name: n, size: [3, 7, 3], pivot: [x, 7, z], offset: [0, -3.5, 0], paint: leg, extra: [{ size: [3.3, 1.5, 3.3], offset: [0, -6.3, -0.1], paint: hoof }] });
  }
  return build('boar', parts, 1.35);
}

// ---------------------------------------------------------------- Hen
// A plump speckled hen with a tall arched tail, a slate-blue crest and a little wattle.
function hen(): MobModel {
  const plumage = spots(fur('#b07a48', { top: '#9a6a3a', under: '#e8d0a8' }), '#6a4428', 0.07, 1, [TOP, LEFT, RIGHT, BACK]);
  const body = faces(plumage, { [FRONT]: (g, w, h, rand) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(g, shade('#e2c49a', 0.94 + rand() * 0.1), x, y); } });
  const sideEye = (g: CanvasRenderingContext2D, x: number) => { px(g, '#e8b040', x, 1, 1, 2); px(g, '#1a120c', x, 2); px(g, 'rgba(255,255,255,0.9)', x, 1); };
  const head = faces(tone('#a8703e', { top: '#8a5a30' }), {
    [RIGHT]: (g, w) => sideEye(g, w - 2), [LEFT]: (g) => sideEye(g, 1),
    [FRONT]: (g, w) => px(g, '#c89a6a', 1, 3, w - 2, 3),
  });
  const beak = tone('#e8a830', { bottom: '#b87a18' });
  // Glossy dark tail feathers with a bronze sheen.
  const feather = bands([['#3a4a2e', 1], ['#24301e', 2], ['#6a4a24', 1], ['#24301e', 3], ['#1a2216', 2]]);
  const leg = tone('#e09a30');
  const toes = (s: number) => ({ size: [3, 1, 3] as [number, number, number], offset: [0, -3.6, -0.8] as [number, number, number], paint: leg, rot: [0, 0.2 * s, 0] as [number, number, number] });
  return build('hen', [
    { name: 'legL', size: [1, 4, 1], pivot: [-1.5, 4, 0.5], offset: [0, -2, 0], paint: leg, extra: [toes(-1)] },
    { name: 'legR', size: [1, 4, 1], pivot: [1.5, 4, 0.5], offset: [0, -2, 0], paint: leg, extra: [toes(1)] },
    { name: 'torso', size: [7, 7, 9], pivot: [0, 4, 0], offset: [0, 3.5, 0.5], paint: body, extra: [{ size: [6, 4, 2], offset: [0, 2.5, -4.5], paint: tone('#e2c49a') }] },
    {
      name: 'tailFan', size: [2, 8, 2], pivot: [0, 9, 4], offset: [0, 3.5, 0.5], paint: feather, parent: 'torso', rot: [-0.25, 0, 0],
      extra: [
        { size: [1.5, 7, 2], offset: [-1.6, 2.5, 0.8], paint: feather, rot: [0.2, 0, 0.35] },
        { size: [1.5, 7, 2], offset: [1.6, 2.5, 0.8], paint: feather, rot: [0.2, 0, -0.35] },
        { size: [1, 5, 1.5], offset: [0, 5.5, 3], paint: feather, rot: [1.1, 0, 0] },
      ],
    },
    { name: 'wingL', size: [1, 5, 7], pivot: [-3.8, 9.5, -1], offset: [0, -2, 1], paint: spots(fur('#8a5a30'), '#5a3a1e', 0.1, 1), parent: 'torso' },
    { name: 'wingR', size: [1, 5, 7], pivot: [3.8, 9.5, -1], offset: [0, -2, 1], paint: spots(fur('#8a5a30'), '#5a3a1e', 0.1, 1), parent: 'torso' },
    { name: 'head', size: [5, 6, 5], pivot: [0, 9, -3], offset: [0, 2.5, -1.5], paint: head, parent: 'torso' },
    {
      name: 'crest', size: [1, 2, 2], pivot: [0, 15, -4.5], offset: [0, 1, 0], paint: tone('#5a6a8a'), parent: 'head', rot: [-0.3, 0, 0],
      extra: [{ size: [1, 3, 1.5], offset: [0, 1.5, 1.5], paint: tone('#4a5a7a') }, { size: [1, 2, 1.5], offset: [0, 0.8, 3], paint: tone('#3e4e6e') }],
    },
    { name: 'beak', size: [2, 1.5, 2], pivot: [0, 11.5, -6.5], offset: [0, 0, -1], paint: beak, parent: 'head', extra: [{ size: [1.6, 1, 1.2], offset: [0, -1, -0.6], paint: tone('#c88a20') }] },
    { name: 'wattle', size: [1.5, 2, 1], pivot: [0, 10.5, -7], offset: [0, -1, 0], paint: tone('#b8483a'), parent: 'head' },
  ], 0.75);
}

// ---------------------------------------------------------------- Woolback
// A big fluffy ram with a dark face and heavy spiral horns. Shearing shows its thin body.
function woolback(): MobModel {
  const fleece = wool('#ece4cf', { dark: '#cfc4a8', light: '#faf6ea' });
  const face = withFace(tone('#3b3431', { top: '#2e2826', bottom: '#4a4240' }), (g, w) => {
    // Amber eyes with horizontal pupils.
    for (const x of [0, w - 2]) { px(g, '#e0b040', x, 2, 2, 2); px(g, '#140e0a', x, 3, 2, 1); px(g, 'rgba(255,255,255,0.8)', x, 2); }
    px(g, '#5a504c', 2, 5, w - 4, 2);
    px(g, '#1e1816', 2, 6); px(g, '#1e1816', w - 3, 6);
  });
  const horn = bands([['#c8b088', 1], ['#9a8460', 1]]);
  const skin = tone('#5a504c', { top: '#6a605c' });
  const leg = tone('#3a3432', { top: '#4a4240' });
  const parts: PartSpec[] = [
    { name: 'torso', size: [9, 8, 14], pivot: [0, 9, 0], offset: [0, 4, 0], paint: skin },
    { name: 'wool', size: [14, 11, 17], pivot: [0, 8, 0], offset: [0, 5.5, 0], paint: fleece, parent: 'torso' },
    { name: 'woolTop', size: [10, 3, 12], pivot: [0, 19, 0], offset: [0, 0.5, 0], paint: fleece, parent: 'wool' },
    { name: 'tail', size: [3, 4, 2], pivot: [0, 15, 8.5], offset: [0, -1.5, 0.5], paint: fleece, parent: 'torso' },
    { name: 'head', size: [7, 7, 7], pivot: [0, 15.5, -8], offset: [0, 0, -3.5], paint: face },
    { name: 'headWool', size: [8, 3, 6], pivot: [0, 19.5, -9], offset: [0, 0, -1], paint: fleece, parent: 'head' },
    { name: 'lids', size: [2, 2, 0.4], pivot: [2.5, 16, -15.1], offset: [0, 0, 0], paint: tone('#2e2826'), parent: 'head', extra: [{ size: [2, 2, 0.4], offset: [-5, 0, 0], paint: tone('#2e2826') }] },
    { name: 'earL', size: [3, 1, 2], pivot: [-3.5, 16, -9], offset: [-1.5, 0, 0], paint: skin, parent: 'head', rot: [0, 0, 0.35] },
    { name: 'earR', size: [3, 1, 2], pivot: [3.5, 16, -9], offset: [1.5, 0, 0], paint: skin, parent: 'head', rot: [0, 0, -0.35] },
  ];
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    parts.push(
      { name: 'horn' + L + '1', size: [2, 2, 4], pivot: [3.5 * s, 18, -9], offset: [s, 0, 1.5], paint: horn, parent: 'head', rot: [0, 0.25 * s, 0] },
      { name: 'horn' + L + '2', size: [2, 4, 2], pivot: [4.5 * s, 18, -6], offset: [s, -1.5, 0.5], paint: horn, parent: 'horn' + L + '1' },
      { name: 'horn' + L + '3', size: [2, 2, 3], pivot: [4.5 * s, 15, -6], offset: [s, -0.5, -1.5], paint: horn, parent: 'horn' + L + '2', rot: [-0.3, 0, 0] },
    );
  }
  for (const [n, x, z] of [['legFL', -3, -4.5], ['legFR', 3, -4.5], ['legBL', -3, 4.5], ['legBR', 3, 4.5]] as const) {
    parts.push({ name: n, size: [3, 9, 3], pivot: [x, 9, z], offset: [0, -4.5, 0], paint: leg, extra: [{ size: [3.3, 1.5, 3.3], offset: [0, -8.3, -0.1], paint: hoof }] });
  }
  return build('woolback', parts, 1.45);
}

// ---------------------------------------------------------------- Burrowfox
// A slender russet fox: narrow face, cream cheeks and bib, black socks, tall dark-backed ears and a huge brush tail.
function burrowfox(): MobModel {
  const coat = fur('#d0692a', { top: '#b85a20', under: '#f0e2cc' });
  const face = faces(fur('#d0692a', { top: '#b85a20' }), {
    [FRONT]: (g, w, h) => {
      px(g, '#f2e6d2', 0, h - 2, 2, 2); px(g, '#f2e6d2', w - 2, h - 2, 2, 2);   // cream cheeks
      px(g, '#e8a820', 0, 1, 2, 1); px(g, '#e8a820', w - 2, 1, 2, 1);           // amber eyes, slanted
      px(g, '#140e0a', 1, 1); px(g, '#140e0a', w - 2, 1);
      px(g, '#8a3a14', 0, 0, 2, 1); px(g, '#8a3a14', w - 2, 0, 2, 1);           // dark brow line
    },
    [LEFT]: (g, w, h) => px(g, '#f2e6d2', 0, h - 2, w, 2), [RIGHT]: (g, w, h) => px(g, '#f2e6d2', 0, h - 2, w, 2),
  });
  const muzzle = faces(tone('#f2e6d2', { top: '#d0692a' }), {
    [FRONT]: (g, w) => px(g, '#1a1210', Math.floor(w / 2) - 1, 0, 2, 1),
    [TOP]: (g, w, h) => px(g, '#1a1210', Math.floor(w / 2) - 1, 0, 2, Math.min(1, h)),
  });
  const ear = faces(bands([['#1e1612', 1], ['#c05a22', 3]]), { [FRONT]: (g, w, h) => px(g, '#f2e6d2', Math.floor(w / 2), 1, 1, h - 1) });
  const sock = bands([['#c8682a', 2], ['#2a1a12', 4]]);
  const parts: PartSpec[] = [
    { name: 'torso', size: [6, 5, 12], pivot: [0, 6, 0], offset: [0, 2.5, 0], paint: coat },
    { name: 'chest', size: [4.5, 5, 2], pivot: [0, 6, -6], offset: [0, 2, 0], paint: tone('#f2e6d2'), parent: 'torso' },
    { name: 'head', size: [6, 5, 5], pivot: [0, 10, -5.5], offset: [0, 0.5, -2.5], paint: face },
    { name: 'muzzle', size: [3, 2, 3.5], pivot: [0, 9.5, -10.5], offset: [0, -0.5, -1.7], paint: muzzle, parent: 'head' },
    { name: 'lids', size: [2, 1, 0.4], pivot: [2, 12, -10.7], offset: [0, 0, 0], paint: tone('#d0692a'), parent: 'head', extra: [{ size: [2, 1, 0.4], offset: [-4, 0, 0], paint: tone('#d0692a') }] },
    { name: 'collar', size: [6.4, 1.5, 3], pivot: [0, 10.2, -5.8], offset: [0, 0, 0], paint: faces(tone('#b8302a'), { [FRONT]: (g, w) => px(g, '#f0c040', Math.floor(w / 2), 0, 1, 1) }), parent: 'head' },
    { name: 'earL', size: [2, 4, 1], pivot: [-1.8, 13, -6.5], offset: [0, 2, 0], paint: ear, parent: 'head', rot: [0, 0, 0.12] },
    { name: 'earR', size: [2, 4, 1], pivot: [1.8, 13, -6.5], offset: [0, 2, 0], paint: ear, parent: 'head', rot: [0, 0, -0.12] },
    { name: 'tail', size: [4, 4, 10], pivot: [0, 10, 5.5], offset: [0, -0.5, 4.5], paint: coat, rot: [0.55, 0, 0], extra: [{ size: [4.4, 4.4, 3], offset: [0, -0.5, 10.5], paint: tone('#f4ecde') }] },
  ];
  for (const [n, x, z] of [['legFL', -1.8, -4.5], ['legFR', 1.8, -4.5], ['legBL', -1.8, 4.5], ['legBR', 1.8, 4.5]] as const) {
    parts.push({ name: n, size: [2, 6, 2], pivot: [x, 6, z], offset: [0, -3, 0], paint: sock });
  }
  return build('burrowfox', parts, 0.95);
}

// ---------------------------------------------------------------- Mossback
// A tall, gentle deer: a fawn coat with pale dapples, a strip of living moss down its spine with
// tiny flowers, branching antlers hung with moss, long legs and a white tail. Tame it with apples
// or wheat, saddle it, and ride it.
function mossback(): MobModel {
  const coat = spots(fur('#a8784a', { top: '#96683e', under: '#e8d8b8' }), '#e8dcc0', 0.035, 1, [TOP, LEFT, RIGHT]);
  const moss: Paint = (g, w, h, f, rand) => {
    fur('#5a8a36', { top: '#6a9a3e', strand: 0.3 })(g, w, h, f, rand);
    if (f === TOP) for (let i = 0; i < Math.max(2, (w * h) / 10); i++) px(g, ['#f0e060', '#e890a8', '#f0f0f0'][i % 3], Math.floor(rand() * w), Math.floor(rand() * h));
  };
  const face = withFace(fur('#9a6a3e', { top: '#86582e' }), (g, w) => {
    eye(g, 0, 2, '#2a1a10', 'r', { big: true }); eye(g, w - 3, 2, '#2a1a10', 'l', { big: true });
    px(g, '#e8d8b8', 1, 6, w - 2, 2);
  });
  const snout = faces(tone('#e8d8b8', { top: '#9a6a3e' }), { [FRONT]: (g, w) => { px(g, '#241810', 1, 0, w - 2, 2); } });
  const antler = tone('#d8c8a0', { bottom: '#a89878' });
  const leg = bands([['#a8784a', 11], ['#8a603a', 3], ['#2a1e16', 2]]);
  const saddle = faces(tone('#6a3a20', { top: '#7a4a28' }), { [TOP]: (g, w, h) => { px(g, '#c8a048', 0, Math.floor(h / 2), w, 1); } });
  const parts: PartSpec[] = [
    { name: 'torso', size: [11, 11, 22], pivot: [0, 16, 0], offset: [0, 5, 0], paint: coat },
    { name: 'moss', size: [5, 2, 18], pivot: [0, 26, 0], offset: [0, 1, -0.5], paint: moss, parent: 'torso', extra: [{ size: [3, 2, 3], offset: [0, 2.2, -5], paint: moss }, { size: [3, 1.5, 3], offset: [1, 2, 4], paint: moss }] },
    { name: 'saddle', size: [12, 2, 9], pivot: [0, 27, -1], offset: [0, 0.5, 0], paint: saddle, parent: 'torso', extra: [{ size: [1, 7, 2], offset: [-6.3, -3.5, 0], paint: tone('#4a2a18') }, { size: [1, 7, 2], offset: [6.3, -3.5, 0], paint: tone('#4a2a18') }] },
    { name: 'neck', size: [6, 12, 6], pivot: [0, 24, -9], offset: [0, 5, -1], paint: coat, rot: [0.35, 0, 0] },
    { name: 'head', size: [7, 7, 8], pivot: [0, 35, -12], offset: [0, 1, -3], paint: face, parent: 'neck' },
    { name: 'snout', size: [5, 4, 4], pivot: [0, 34, -19], offset: [0, 0, -1.5], paint: snout, parent: 'head' },
    { name: 'lids', size: [2, 2, 0.4], pivot: [2.5, 37, -19.1], offset: [0, 0, 0], paint: tone('#86582e'), parent: 'head', extra: [{ size: [2, 2, 0.4], offset: [-5, 0, 0], paint: tone('#86582e') }] },
    { name: 'earL', size: [4, 2, 1], pivot: [-3.5, 38, -12], offset: [-2, 0, 0], paint: fur('#9a6a3e'), parent: 'head', rot: [0, 0, 0.3] },
    { name: 'earR', size: [4, 2, 1], pivot: [3.5, 38, -12], offset: [2, 0, 0], paint: fur('#9a6a3e'), parent: 'head', rot: [0, 0, -0.3] },
    { name: 'tail', size: [3, 5, 2], pivot: [0, 25, 11], offset: [0, -2, 0.5], paint: tone('#f0ece0'), parent: 'torso', rot: [0.3, 0, 0] },
  ];
  // Antlers: a main beam that forks twice, with moss hanging from the tines.
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    parts.push(
      { name: 'antler' + L, size: [1.5, 7, 1.5], pivot: [2.2 * s, 39, -13], offset: [0, 3.5, 0], paint: antler, parent: 'head', rot: [-0.25, 0, -0.45 * s],
        extra: [
          { size: [1.2, 4, 1.2], offset: [1.8 * s, 6, -1], paint: antler, rot: [-0.5, 0, -0.6 * s] },
          { size: [1.2, 5, 1.2], offset: [-0.8 * s, 7.5, 1], paint: antler, rot: [0.4, 0, 0.3 * s] },
          { size: [1.2, 3, 1.2], offset: [0.5 * s, 3, -1.8], paint: antler, rot: [-0.9, 0, 0] },
          { size: [2, 2.5, 1.5], offset: [1.2 * s, 5, -0.2], paint: moss },
        ] },
    );
  }
  for (const [n, x, z] of [['legFL', -3.5, -8], ['legFR', 3.5, -8], ['legBL', -3.5, 8], ['legBR', 3.5, 8]] as const) {
    parts.push({ name: n, size: [3, 16, 3], pivot: [x, 16, z], offset: [0, -8, 0], paint: leg, extra: [{ size: [3.3, 1.5, 3.6], offset: [0, -15.3, -0.2], paint: hoof }] });
  }
  return build('mossback', parts, 1.7);
}

// ---------------------------------------------------------------- Bogfrog
// A squat mottled frog with bulging golden eyes and a pale, pulsing throat.
function bogfrog(): MobModel {
  const mottled = spots(tone('#4f8a32', { top: '#5a9a38', under: '#d8d8a0' }), '#2e5a1e', 0.07, 2, [TOP, LEFT, RIGHT, BACK]);
  const skin = faces(mottled, { [TOP]: (g, w, h) => px(g, '#c8c050', Math.floor(w / 2), 0, 1, h) });
  const head = faces(skin, { [FRONT]: (g, w) => { px(g, '#1e3a14', 0, 2, w, 1); px(g, '#8ab85a', 0, 1, w, 1); } });
  const iris = (g: CanvasRenderingContext2D, w: number) => { px(g, '#e8c040', 0, 0, w, 2); px(g, '#140e0a', 0, 1, w, 1); px(g, 'rgba(255,255,255,0.9)', 0, 0); };
  const eyeball = faces(tone('#4f8a32'), { [FRONT]: iris, [LEFT]: iris, [RIGHT]: iris });
  return build('bogfrog', [
    { name: 'torso', size: [9, 5, 9], pivot: [0, 1.5, 1], offset: [0, 2.5, 0], paint: skin },
    { name: 'head', size: [9, 3, 6], pivot: [0, 5, -2.5], offset: [0, 1.5, -3], paint: head, parent: 'torso' },
    { name: 'eyeL', size: [3, 3, 3], pivot: [-3, 8, -5], offset: [0, 1, 0], paint: eyeball, parent: 'head' },
    { name: 'eyeR', size: [3, 3, 3], pivot: [3, 8, -5], offset: [0, 1, 0], paint: eyeball, parent: 'head' },
    { name: 'throat', size: [5, 1, 3], pivot: [0, 4.2, -6.5], offset: [0, -0.5, 0], paint: tone('#d8dca0', { top: '#e8ecb8' }), parent: 'head' },
    { name: 'thighL', size: [3, 3, 5], pivot: [-4.5, 3, 2.5], offset: [0, 0, 1], paint: skin, rot: [0, 0.3, 0], extra: [{ size: [3, 1, 4], offset: [-0.5, -1.5, -1], paint: tone('#3e7a28') }] },
    { name: 'thighR', size: [3, 3, 5], pivot: [4.5, 3, 2.5], offset: [0, 0, 1], paint: skin, rot: [0, -0.3, 0], extra: [{ size: [3, 1, 4], offset: [0.5, -1.5, -1], paint: tone('#3e7a28') }] },
    { name: 'armL', size: [2, 4, 2], pivot: [-3.5, 4, -2.5], offset: [0, -2, 0], paint: skin },
    { name: 'armR', size: [2, 4, 2], pivot: [3.5, 4, -2.5], offset: [0, -2, 0], paint: skin },
  ], 0.9);
}

// ---------------------------------------------------------------- Cave moth
// A big fuzzy moth with a cream ruff, feathery antennae and dusky wings marked by pale cyan eyespots
// that stand out in the dark.
function cavemoth(): MobModel {
  const body = fur('#6a5a4a', { top: '#7a6a58' });
  const wingPaint = (base: string, spot: boolean): Paint => faces(tone(base, { top: shade(base, 1.08) }), {
    [TOP]: (g, w, h, rand) => {
      // Veins, a scalloped darker rim and (on the forewings) a glowing eyespot.
      for (let x = 1; x < w; x += 3) px(g, 'rgba(40,30,20,0.35)', x, 0, 1, h);
      for (let x = 0; x < w; x++) if (rand() < 0.6) px(g, '#4a3e30', x, h - 1);
      px(g, '#5a4a3a', w - 1, 0, 1, h);
      if (spot) {
        const cx = Math.floor(w * 0.55), cy = Math.floor(h / 2) - 1;
        px(g, '#2a2220', cx - 1, cy - 1, 4, 4); px(g, '#7af0e8', cx, cy, 2, 2); px(g, '#e8fffc', cx, cy);
      } else px(g, '#8a7a64', 1, 1, w - 3, 1);
    },
    [BOTTOM]: (g, w, h) => px(g, 'rgba(255,240,220,0.12)', 0, 0, w, h),
  });
  const fore = wingPaint('#9a8a70', true), hind = wingPaint('#8a765e', false);
  const sideEye = (g: CanvasRenderingContext2D, w: number, h: number) => { px(g, '#140e0a', 0, 0, w, h); px(g, 'rgba(160,240,255,0.7)', 0, 0); };
  const antenna = faces(speckle('#c8b898', '#8a7a60'), { [TOP]: (g, w, h) => { for (let y = 0; y < h; y += 2) px(g, '#e8dcc0', 0, y, w, 1); } });
  return build('cavemoth', [
    { name: 'torso', size: [4, 4, 9], pivot: [0, 6, 0], offset: [0, 0, 1.5], paint: body, extra: [{ size: [3, 3, 5], offset: [0, -0.5, 7.5], paint: bands([['#6a5a4a', 1], ['#4a3e32', 1]]) }] },
    { name: 'ruff', size: [5, 5, 3], pivot: [0, 6, -2.5], offset: [0, 0, 0], paint: wool('#e6dcc4'), parent: 'torso' },
    { name: 'head', size: [3, 3, 3], pivot: [0, 6, -4], offset: [0, 0, -1.5], paint: faces(body, { [LEFT]: sideEye, [RIGHT]: sideEye }), parent: 'torso' },
    { name: 'antennaL', size: [2, 0.5, 6], pivot: [-1, 7.5, -5.5], offset: [0, 0, -3], paint: antenna, parent: 'head', rot: [-0.6, -0.45, 0] },
    { name: 'antennaR', size: [2, 0.5, 6], pivot: [1, 7.5, -5.5], offset: [0, 0, -3], paint: antenna, parent: 'head', rot: [-0.6, 0.45, 0] },
    { name: 'wingL', size: [9, 0.6, 10], pivot: [-2, 7.5, -2], offset: [-4.5, 0, 2.5], paint: fore, extra: [box([4, 0.6, 3], [-3, 0, -3.5], fore)] },
    { name: 'wingR', size: [9, 0.6, 10], pivot: [2, 7.5, -2], offset: [4.5, 0, 2.5], paint: fore, extra: [box([4, 0.6, 3], [3, 0, -3.5], fore)] },
    { name: 'wingBL', size: [7, 0.6, 7], pivot: [-2, 7, 4], offset: [-3.5, 0, 2.5], paint: hind },
    { name: 'wingBR', size: [7, 0.6, 7], pivot: [2, 7, 4], offset: [3.5, 0, 2.5], paint: hind },
  ], 0.8);
}

// ---------------------------------------------------------------- Streamfish
// A speckled trout: olive back, silver belly, a pink band down each side, and a forked tail.
function streamfish(): MobModel {
  const stripe = (g: CanvasRenderingContext2D, w: number) => { px(g, '#e07a8a', 0, 2, w, 1); px(g, 'rgba(255,160,170,0.5)', 0, 1, w, 1); };
  const body = faces(spots(tone('#6a8a5a', { top: '#5a7a4a', under: '#e8eef0' }), '#2a3222', 0.12, 1, [TOP, LEFT, RIGHT]), { [LEFT]: stripe, [RIGHT]: stripe });
  const sideEye = (g: CanvasRenderingContext2D, w: number) => { px(g, '#e8e0c0', w - 2, 0, 2, 2); px(g, '#140e0a', w - 2, 1); };
  const headPaint = faces(tone('#7a9a6a', { under: '#e8eef0' }), { [LEFT]: (g) => { px(g, '#e8e0c0', 0, 0, 2, 2); px(g, '#140e0a', 1, 1); }, [RIGHT]: sideEye });
  const fin = tone('#9aa88a', { top: '#aab89a' });
  return build('streamfish', [
    { name: 'torso', size: [3, 4, 7], pivot: [0, 3, 0], offset: [0, 0, 0.5], paint: body },
    { name: 'head', size: [3, 3, 3], pivot: [0, 3, -3], offset: [0, 0.3, -1.5], paint: headPaint, parent: 'torso' },
    { name: 'jaw', size: [2.5, 1, 2], pivot: [0, 2, -3.5], offset: [0, -0.5, -1.2], paint: tone('#d8e0d8'), parent: 'torso' },
    { name: 'tail', size: [1, 2, 3], pivot: [0, 3, 4], offset: [0, 0, 1.5], paint: fin, parent: 'torso', extra: [
      { size: [1, 3, 2.5], offset: [0, 1.6, 3.4], paint: fin, rot: [0.5, 0, 0] },
      { size: [1, 3, 2.5], offset: [0, -1.6, 3.4], paint: fin, rot: [-0.5, 0, 0] },
    ] },
    { name: 'dorsal', size: [1, 2, 3], pivot: [0, 5, 0], offset: [0, 1, 0.5], paint: fin, parent: 'torso', rot: [0.3, 0, 0] },
    { name: 'finL', size: [2, 0.5, 2], pivot: [-1.5, 1.8, -1.5], offset: [-1, 0, 0.5], paint: fin, parent: 'torso', rot: [0, 0, 0.3] },
    { name: 'finR', size: [2, 0.5, 2], pivot: [1.5, 1.8, -1.5], offset: [1, 0, 0.5], paint: fin, parent: 'torso', rot: [0, 0, -0.3] },
  ], 0.4);
}

// ---------------------------------------------------------------- Villagers
interface Look { robe: string; trim: string; hair: string | null; trousers: string; extras: () => PartSpec[] }

const SKINS = ['#e0b896', '#c8966e', '#a8724e', '#8a5a3a', '#f0cca8'];

/** A beard hanging from the chin, with a moustache and optional sideburns. */
function beard(color: string, width: number, length: number, sideburns: boolean): PartSpec {
  const f = fur(color, { strand: 0.22 });
  const extra = [box([width - 2, 1, 1.3], [0, 1.6, -0.2], fur(shade(color, 0.85)))];
  if (sideburns) extra.push(box([0.8, 3, 2.5], [-3.7, 2, 1.2], f), box([0.8, 3, 2.5], [3.7, 2, 1.2], f));
  return { name: 'beard', size: [width, length, 1.2], pivot: [0, 24.4, -4.3], offset: [0, -length / 2 + 0.6, 0], paint: f, parent: 'head', extra };
}

function villager(profession = 'farmer'): MobModel {
  const h = [...profession].reduce((a, c) => a + c.charCodeAt(0), 0);
  const skinC = SKINS[h % SKINS.length];
  const trimBand = (c: string): Partial<Record<number, (g: CanvasRenderingContext2D, w: number, h: number) => void>> =>
    Object.fromEntries([FRONT, BACK, LEFT, RIGHT].map((f) => [f, (g: CanvasRenderingContext2D, w: number, hh: number) => px(g, c, 0, hh - 1, w, 1)]));
  const looks: Record<string, Look> = {
    farmer: {
      robe: '#6a7a3a', trim: '#c8a048', hair: '#6a4a2a', trousers: '#5a4a32',
      extras: () => [
        { name: 'hatBrim', size: [14, 1, 14], pivot: [0, 31, 0], offset: [0, 0.5, 0], paint: spots(tone('#e0c878'), '#b89848', 0.12, 1), parent: 'head', rot: [0.06, 0, 0],
          extra: [box([8, 3, 8], [0, 2.5, 0], faces(tone('#d8b860'), trimBand('#8a3a2a')))] },
      ],
    },
    shepherd: {
      robe: '#8a6a4a', trim: '#e8e2d4', hair: '#b8b0a0', trousers: '#4a3a2a',
      extras: () => [
        { name: 'shawl', size: [10, 4, 7], pivot: [0, 23, 0], offset: [0, -1.5, 0], paint: wool('#ece4cf'), parent: 'torso' },
        { name: 'crook', size: [1, 19, 1], pivot: [5.5, 12, -1.5], offset: [0, 3.5, 0], paint: tone('#8a6a3a'), parent: 'armR',
          extra: [box([1, 1, 4], [0, 13, -1.5], tone('#8a6a3a')), box([1, 3, 1], [0, 11.5, -3.5], tone('#8a6a3a'))] },
        beard('#d8d2c4', 6, 3, false),
      ],
    },
    fisher: {
      robe: '#3a5a7a', trim: '#d8c888', hair: '#b8642a', trousers: '#3a3a3a',
      extras: () => [
        { name: 'cap', size: [9, 3, 9], pivot: [0, 31, 0], offset: [0, 0.5, 0], paint: faces(tone('#2a3a5a'), trimBand('#c8b878')), parent: 'head', extra: [box([9, 1, 3], [0, -0.5, -5.5], tone('#1e2a44'))] },
        beard('#b8642a', 7, 3.5, true),
        { name: 'pipe', size: [0.8, 0.8, 3], pivot: [-1.8, 24.2, -4.6], offset: [0, 0, -1.4], paint: tone('#5a3a22'), parent: 'head', rot: [0.15, 0.3, 0],
          extra: [box([1.6, 2, 1.6], [0, 0.6, -3.2], faces(tone('#6a4428'), { [TOP]: (g, w, hh) => { px(g, '#2a1a10', 0, 0, w, hh); px(g, '#e86a2a', 0, 0); } }))] },
      ],
    },
    butcher: {
      robe: '#8a3a32', trim: '#e8e2d4', hair: null, trousers: '#3a3030',
      extras: () => [
        { name: 'apron', size: [7, 9, 1], pivot: [0, 11, -2.8], offset: [0, 5, 0], paint: spots(tone('#ece8e0'), '#a83a3a', 0.03, 2), parent: 'torso' },
        { name: 'bandana', size: [8.6, 2.6, 8.6], pivot: [0, 31, 0], offset: [0, -0.6, 0], paint: spots(tone('#b8342a'), '#f0e8d8', 0.08, 1), parent: 'head',
          extra: [box([2, 2, 1.2], [0, -1.6, 4.8], tone('#a02e24')), box([1.2, 3, 0.8], [-0.8, -3.5, 5.2], tone('#a02e24'), [0.3, 0, 0.3]), box([1.2, 3, 0.8], [0.8, -3.5, 5.2], tone('#a02e24'), [0.3, 0, -0.3])] },
        { name: 'mustache', size: [6, 1.2, 1.2], pivot: [0, 25.6, -4.4], offset: [0, 0, 0], paint: fur('#4a2e1e'), parent: 'head', extra: [box([1.2, 2, 1.2], [-3, -0.6, 0], fur('#4a2e1e')), box([1.2, 2, 1.2], [3, -0.6, 0], fur('#4a2e1e'))] },
      ],
    },
    cleric: {
      robe: '#5a3a7a', trim: '#e8c848', hair: null, trousers: '#3a2a4a',
      extras: () => [
        {
          name: 'hood', size: [9.2, 1.6, 9.2], pivot: [0, 31, 0], offset: [0, 0.8, 0], paint: tone('#4a2e6a'), parent: 'head',
          extra: [
            box([9.2, 8.5, 1.6], [0, -3.5, 4.4], tone('#4a2e6a')),
            box([1.6, 8.5, 8], [-4.4, -3.5, 0.6], faces(tone('#4a2e6a'), { [FRONT]: (g, w, h2) => px(g, '#e8c848', 0, 0, w, h2) })),
            box([1.6, 8.5, 8], [4.4, -3.5, 0.6], faces(tone('#4a2e6a'), { [FRONT]: (g, w, h2) => px(g, '#e8c848', 0, 0, w, h2) })),
            box([3, 3, 2], [0, -1, 5.5], tone('#4a2e6a'), [-0.5, 0, 0]),
          ],
        },
        { name: 'pendant', size: [2, 3, 1], pivot: [0, 18, -2.8], offset: [0, 0, 0], paint: faces(tone('#f0d050'), { [FRONT]: (g) => px(g, '#fff4b0', 0, 0) }), parent: 'torso', extra: [box([4, 0.5, 0.5], [0, 4, 0.2], tone('#c8a830'))] },
      ],
    },
    smith: {
      robe: '#4a4442', trim: '#8a5a2a', hair: '#2a1e18', trousers: '#2e2a28',
      extras: () => [
        { name: 'apron', size: [7.5, 10, 1], pivot: [0, 11, -2.8], offset: [0, 5, 0], paint: faces(tone('#6a4428'), { [FRONT]: (g, w) => { px(g, '#3a2414', 0, 0, w, 1); px(g, '#8a8a8a', 1, 5, 2, 2); } }), parent: 'torso' },
        { name: 'goggles', size: [9, 2, 1], pivot: [0, 30, -4.4], offset: [0, 0, 0], paint: faces(tone('#6a4a2a'), { [FRONT]: (g) => { px(g, '#b88a3a', 1, 0, 3, 2); px(g, '#b88a3a', 5, 0, 3, 2); px(g, '#5ab8c8', 2, 0, 1, 2); px(g, '#5ab8c8', 6, 0, 1, 2); } }), parent: 'head' },
        beard('#6a4028', 6, 3, true),
      ],
    },
    librarian: {
      robe: '#2a4a6a', trim: '#e8e0c8', hair: '#8a8a8a', trousers: '#2a2a3a',
      extras: () => [
        { name: 'cap', size: [7, 3, 7], pivot: [0, 31, 0], offset: [0, 1, 0.5], paint: tone('#6a2a3a'), parent: 'head', extra: [box([1, 1, 1], [0, 2, 0], tone('#e8c848')), box([0.6, 3, 0.6], [0, 0.5, 3.8], tone('#e8c848'), [0.4, 0, 0])] },
        { name: 'book', size: [4, 5, 1.5], pivot: [-5.5, 13, -1.5], offset: [0, 0, -1], paint: faces(tone('#8a2a2a'), { [TOP]: (g, w, h2) => px(g, '#efe6d2', 0, 0, w, h2) }), parent: 'armL', rot: [-0.9, 0, 0] },
        { name: 'quill', size: [0.5, 5, 0.5], pivot: [4.2, 28, 1], offset: [0, 1.5, 0], paint: tone('#f4f0e8'), parent: 'head', rot: [0.4, 0, -0.35], extra: [box([0.6, 3, 1.2], [0, 2.5, 0.3], tone('#f4f0e8'))] },
      ],
    },
  };
  const L = looks[profession] ?? looks.farmer;
  const skin = tone(skinC, { noise: 0.03 });
  const face = withFace(skin, (g, w) => {
    if (L.hair) { px(g, shade(L.hair, 0.9), 1, 2, 2, 1); px(g, shade(L.hair, 0.9), w - 3, 2, 2, 1); }   // brows
    eye(g, 1, 3, '#3a5a2a', 'r'); eye(g, w - 3, 3, '#3a5a2a', 'l');
    if (profession === 'librarian') { px(g, '#3a3a40', 0, 3, 4, 1); px(g, '#3a3a40', w - 4, 3, 4, 1); px(g, '#3a3a40', 4, 3, w - 8, 1); }
    px(g, 'rgba(200,80,70,0.35)', 0, 5, 2, 1); px(g, 'rgba(200,80,70,0.35)', w - 2, 5, 2, 1); // cheeks
    px(g, '#6a3a2a', 3, 6, 2, 1);                                                          // mouth
  });
  const robe: Paint = faces(tone(L.robe), {
    [FRONT]: (g, w) => { px(g, shade(L.trim, 1), 0, 6, w, 1); px(g, '#3a2a1e', Math.floor(w / 2) - 1, 6, 2, 1); px(g, shade(L.trim, 1), 0, 0, w, 1); px(g, shade(L.robe, 0.75), Math.floor(w / 2), 1, 1, 5); },
    [BACK]: (g, w) => px(g, shade(L.trim, 1), 0, 6, w, 1), [LEFT]: (g, w) => px(g, shade(L.trim, 1), 0, 6, w, 1), [RIGHT]: (g, w) => px(g, shade(L.trim, 1), 0, 6, w, 1),
  });
  const sleeve = bands([[L.robe, 7], [L.trim, 1], [skinC, 3]]);
  const legs = bands([[L.trousers, 8], ['#3a2618', 3]]);
  const parts: PartSpec[] = [
    { name: 'legL', size: [3, 11, 3], pivot: [-2, 11, 0], offset: [0, -5.5, 0], paint: legs },
    { name: 'legR', size: [3, 11, 3], pivot: [2, 11, 0], offset: [0, -5.5, 0], paint: legs },
    { name: 'torso', size: [8, 12, 5], pivot: [0, 11, 0], offset: [0, 6, 0], paint: robe },
    { name: 'head', size: [8, 8, 8], pivot: [0, 23, 0], offset: [0, 4, 0], paint: face, parent: 'torso' },
    { name: 'nose', size: [2, 2, 1.2], pivot: [0, 26, -4], offset: [0, 0, -0.5], paint: tone(shade(skinC, 0.94)), parent: 'head' },
    { name: 'lids', size: [2, 2, 0.4], pivot: [2, 27, -4.15], offset: [0, 0, 0], paint: tone(shade(skinC, 0.9)), parent: 'head', extra: [box([2, 2, 0.4], [-4, 0, 0], tone(shade(skinC, 0.9)))] },
    { name: 'armL', size: [3, 11, 3], pivot: [-5.5, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso' },
    { name: 'armR', size: [3, 11, 3], pivot: [5.5, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso' },
  ];
  if (L.hair) parts.push({ name: 'hair', size: [8.6, 2, 8.6], pivot: [0, 31, 0], offset: [0, -0.4, 0.2], paint: fur(L.hair), parent: 'head', extra: [box([8.4, 5, 1], [0, -3.2, 4.1], fur(L.hair)), box([1, 3, 5], [-4.2, -2, 1.8], fur(L.hair)), box([1, 3, 5], [4.2, -2, 1.8], fur(L.hair))] });
  parts.push(...L.extras());
  return build('villager:' + profession, parts, 0.9);
}

// ---------------------------------------------------------------- Stonewarden
// A mossy stone giant with boulder shoulders, a glowing amber heart and a sapling on its head.
function stonewarden(): MobModel {
  const stone = spots(tone('#86867e', { top: '#9a9a92', bottom: '#6a6a64' }), '#5e5e58', 0.05, 2);
  const mossy: Paint = faces(stone, {
    [TOP]: (g, w, h, rand) => { for (let i = 0; i < w * h * 0.5; i++) px(g, rand() < 0.5 ? '#4f7a2e' : '#6a9a3a', Math.floor(rand() * w), Math.floor(rand() * h)); },
    [FRONT]: (g, w, _h, rand) => { for (let x = 0; x < w; x++) if (rand() < 0.5) px(g, '#4f7a2e', x, 0, 1, 1 + Math.floor(rand() * 3)); },
    [BACK]: (g, w, _h, rand) => { for (let x = 0; x < w; x++) if (rand() < 0.5) px(g, '#4f7a2e', x, 0, 1, 1 + Math.floor(rand() * 3)); },
  });
  const face = withFace(stone, (g, w) => { px(g, '#3a3a36', 0, 2, w, 2); glow(g, 1, 3, 2, '#ffc040'); glow(g, w - 3, 3, 2, '#ffc040'); px(g, '#4a4a44', 2, 5, w - 4, 1); });
  const vine = (g: CanvasRenderingContext2D, w: number, h: number, rand: () => number) => { let x = Math.floor(rand() * w); for (let y = 0; y < h; y++) { px(g, '#3f6a2a', x, y); if (rand() < 0.3) x = Math.max(0, Math.min(w - 1, x + (rand() < 0.5 ? -1 : 1))); } };
  const arm = faces(stone, { [LEFT]: vine, [RIGHT]: vine, [FRONT]: vine });
  return build('stonewarden', [
    { name: 'legL', size: [6, 15, 6], pivot: [-4.5, 15, 0], offset: [0, -7.5, 0], paint: stone },
    { name: 'legR', size: [6, 15, 6], pivot: [4.5, 15, 0], offset: [0, -7.5, 0], paint: stone },
    {
      name: 'torso', size: [16, 14, 10], pivot: [0, 15, 0], offset: [0, 7, 0], paint: mossy, rot: [-0.08, 0, 0],
      // A few wildflowers growing in the moss on its chest.
      extra: [[-6, 13.5, -3, '#e8d040'], [5, 13.8, -2, '#d86a8a'], [-3, 14, 3, '#f0f0f0']].map(([x, y, z, c]) => ({ size: [1.5, 1.5, 1.5] as [number, number, number], offset: [x as number, y as number, z as number], paint: tone(c as string) })),
    },
    { name: 'heart', size: [4, 4, 1], pivot: [0, 23, -5.4], offset: [0, 0, 0], paint: faces(tone('#ffb030', { top: '#ffe080' }), { [FRONT]: (g) => { px(g, '#fff0a0', 1, 1, 2, 2); } }), parent: 'torso' },
    { name: 'shoulderL', size: [7, 6, 8], pivot: [-9, 28, 0], offset: [0, 0.5, 0], paint: mossy, parent: 'torso' },
    { name: 'shoulderR', size: [7, 6, 8], pivot: [9, 28, 0], offset: [0, 0.5, 0], paint: mossy, parent: 'torso' },
    { name: 'head', size: [8, 7, 7], pivot: [0, 29, -1], offset: [0, 3, -1.5], paint: face, parent: 'torso' },
    { name: 'sapling', size: [1, 4, 1], pivot: [1, 36, -1], offset: [0, 2, 0], paint: tone('#6a4a2a'), parent: 'head', extra: [{ size: [4, 3, 4], offset: [0, 5, 0], paint: spots(tone('#4f8a2e'), '#3a6a22', 0.2, 1) }] },
    { name: 'armL', size: [6, 21, 6], pivot: [-11, 26, 0], offset: [0, -10, 0], paint: arm, parent: 'torso', extra: [{ size: [7, 6, 7], offset: [0, -21.5, 0], paint: stone }] },
    { name: 'armR', size: [6, 21, 6], pivot: [11, 26, 0], offset: [0, -10, 0], paint: arm, parent: 'torso', extra: [{ size: [7, 6, 7], offset: [0, -21.5, 0], paint: stone }] },
  ], 2.1);
}

export const PASSIVE_MODELS: Record<string, (variant?: string) => MobModel> = {
  boar, hen, woolback, burrowfox, bogfrog, cavemoth, streamfish, villager, stonewarden, mossback,
};

