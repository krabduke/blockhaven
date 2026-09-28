// Peaceful creatures, villagers and the village guardian. Original designs, painted at high
// resolution: faces are drawn in model pixels with details down to a third of a pixel, and
// bodies are built from layered boxes so their outlines read as rounded, muscled or fluffy.

import {
  BACK, BOTTOM, FRONT, LEFT, RIGHT, TOP,
  bands, build, eye2, faces, fur, glow, over, px, scales, shade, speckle, spots, tone, withFace, wool,
  type Detail, type MobModel, type Paint, type PartSpec,
} from './models';

type V3 = [number, number, number];
const box = (size: V3, offset: V3, paint: Paint, rot?: V3): Detail => ({ size, offset, paint, rot });
const T = 1 / 3;

const hoof = tone('#2a201a', { top: '#3a2e26', bottom: '#140e0a', noise: 0.05 });
const ivory = tone('#f0e6cc', { top: '#fffaea', bottom: '#b8aa88' });

/** Pale-tipped hairs scattered over a coat. */
const grizzle = (base: Paint, color: string, density = 0.05): Paint => over(base, (g, w, h, _f, rand, u) => {
  for (let i = 0; i < w * h * density; i++) px(g, color, Math.floor(rand() * w), Math.floor(rand() * h), 1, Math.max(1, Math.round(u * 0.7)));
});

/** A split hoof with a dewclaw behind it, for a leg of the given width whose bottom is at `y`. */
function cloven(w: number, y: number, d = w): Detail[] {
  return [
    box([w / 2 - 0.15, 1.6, d + 0.3], [-w / 4 - 0.1, y + 0.8, -0.15], hoof),
    box([w / 2 - 0.15, 1.6, d + 0.3], [w / 4 + 0.1, y + 0.8, -0.15], hoof),
    box([1, 0.7, 0.7], [0, y + 2.2, d / 2 + 0.2], hoof),
  ];
}

// ---------------------------------------------------------------- Boar
// A stocky wild boar: a grizzled bristly coat, a shoulder hump and a crest of bristles down the
// spine, heavy jowls, a wet pink snout disc, two-part curling tusks, pointed ears with pink insides,
// a curly tail with a tuft, and split hooves.
function boar(): MobModel {
  const hide = grizzle(fur('#6e5038', { top: '#4e3826', under: '#8a6a4e', strand: 0.22 }), 'rgba(236,214,182,0.35)');
  const belly = fur('#8a6a4e', { top: '#8a6a4e', strand: 0.12 });
  const face = withFace(grizzle(fur('#634630', { top: '#4e3826' }), 'rgba(236,214,182,0.3)'), (g, w) => {
    px(g, '#3a2818', 0, 1, w, 1 + T);                                          // heavy brow
    px(g, 'rgba(0,0,0,0.3)', 0.67, 2.33, 3, 2); px(g, 'rgba(0,0,0,0.3)', w - 3.67, 2.33, 3, 2); // sockets
    eye2(g, 1, 2.67, 2, 1.67, '#6a3a18', { white: '#e8dcc0', look: 0.6 });
    eye2(g, w - 3, 2.67, 2, 1.67, '#6a3a18', { white: '#e8dcc0', look: -0.6 });
    px(g, '#8a6a4e', 0, 5, w, 3);                                              // lighter jowls
    px(g, '#e8dcc0', 1.33, 3.67, 1.33, T); px(g, '#e8dcc0', 1.67, 4, T, T);     // an old scar under one eye
  });
  const snout = faces(tone('#c08a74', { top: '#d09a84', bottom: '#9a6a58' }), {
    [FRONT]: (g, w, h) => {
      px(g, '#d8a28c', 0, 0, w, T); px(g, '#8a5a4a', 0, h - T, w, T);           // disc rim
      px(g, '#3a1a14', 1, 1.33, 1.33, 1.67); px(g, '#3a1a14', w - 2.33, 1.33, 1.33, 1.67); // nostrils
      px(g, '#5a2e28', 1.33, 1.33, 0.67, T); px(g, '#5a2e28', w - 2, 1.33, 0.67, T);
      px(g, 'rgba(255,255,255,0.55)', 0.67, 0.67, T, T); px(g, 'rgba(255,255,255,0.4)', w - 1.33, 2.67, T, T); // wet shine
    },
    [TOP]: (g, w, h) => { for (let y = 0.67; y < h; y += 1) px(g, 'rgba(90,50,40,0.35)', 0.67, y, w - 1.33, T); },
  });
  const earPaint = faces(fur('#4e3826'), { [FRONT]: (g, w, h) => { px(g, '#c08a74', T, T, w - 2 * T, h - T); px(g, '#9a6a58', w / 2 - T / 2, T, T, h - T); } });
  const parts: PartSpec[] = [
    {
      name: 'torso', size: [11, 10, 16], pivot: [0, 7, 0.5], offset: [0, 5, 0], paint: hide,
      extra: [
        box([9, 2, 13], [0, -0.4, 0.5], belly),                                  // belly
        box([10, 3, 6], [0, 10.6, -4.5], hide),                                  // shoulder hump
        box([1.2, 7, 7], [-5.9, 5, 4.5], hide), box([1.2, 7, 7], [5.9, 5, 4.5], hide), // haunches
        box([1.2, 6, 5], [-5.8, 5.5, -4.5], hide), box([1.2, 6, 5], [5.8, 5.5, -4.5], hide), // shoulders
      ],
    },
    {
      name: 'mane', size: [3, 3, 14], pivot: [0, 17, 0], offset: [0, 0.5, -0.5], paint: spots(fur('#2e2016'), '#6a5040', 0.1, 1), parent: 'torso',
      // Bristles standing up along the spine, tallest over the shoulders.
      extra: [[-6.5, 4, -0.2], [-4.5, 3.6, 0.15], [-2.5, 3, -0.15], [-0.5, 2.6, 0.1], [1.5, 2.2, -0.1], [3.5, 1.8, 0.1], [5.5, 1.3, 0]].map(([z, hgt, tilt]) => box([1.6, hgt, 1.8], [0, 2 + hgt / 2, z], fur('#241810', { strand: 0.3 }), [0.25, 0, tilt])),
    },
    {
      name: 'head', size: [9, 8, 7], pivot: [0, 12, -7.5], offset: [0, 0, -3.5], paint: face,
      extra: [box([2, 4, 4], [-4.8, -2, -3.5], fur('#7a5a3e')), box([2, 4, 4], [4.8, -2, -3.5], fur('#7a5a3e')), box([9.4, 1.4, 2], [0, 3.1, -6.4], fur('#3a2818'))],
    },
    { name: 'lids', size: [2.2, 1.8, 0.4], pivot: [3, 13.4, -14.6], offset: [0, 0, 0], paint: fur('#4e3826'), parent: 'head', extra: [box([2.2, 1.8, 0.4], [-6, 0, 0], fur('#4e3826'))] },
    { name: 'snout', size: [6, 4, 3], pivot: [0, 10, -14.5], offset: [0, 0, -1.5], paint: snout, parent: 'head' },
    { name: 'jaw', size: [5, 1.5, 3.5], pivot: [0, 8.2, -12.5], offset: [0, -0.5, -1.5], paint: faces(tone('#9a6a58'), { [FRONT]: (g, w) => px(g, '#5a2e28', T, 0, w - 2 * T, T) }), parent: 'head' },
    { name: 'tuskL', size: [1, 3, 1], pivot: [-2.7, 9.5, -15], offset: [0, 1.5, 0], paint: ivory, parent: 'snout', rot: [0.35, 0, -0.3], extra: [box([0.8, 2, 0.8], [0, 3.4, 0.6], ivory, [0.8, 0, 0])] },
    { name: 'tuskR', size: [1, 3, 1], pivot: [2.7, 9.5, -15], offset: [0, 1.5, 0], paint: ivory, parent: 'snout', rot: [0.35, 0, 0.3], extra: [box([0.8, 2, 0.8], [0, 3.4, 0.6], ivory, [0.8, 0, 0])] },
    { name: 'earL', size: [3, 3, 1], pivot: [-3.5, 15.5, -9], offset: [-0.5, 1.5, 0], paint: earPaint, parent: 'head', rot: [0.2, 0, 0.55], extra: [box([2, 1.6, 0.8], [-0.5, 3.6, 0], fur('#3a2818'))] },
    { name: 'earR', size: [3, 3, 1], pivot: [3.5, 15.5, -9], offset: [0.5, 1.5, 0], paint: earPaint, parent: 'head', rot: [0.2, 0, -0.55], extra: [box([2, 1.6, 0.8], [0.5, 3.6, 0], fur('#3a2818'))] },
    { name: 'tail', size: [1, 4, 1], pivot: [0, 15, 8.5], offset: [0, -2, 0], paint: fur('#4e3826'), parent: 'torso', rot: [0.35, 0, 0] },
    { name: 'tail2', size: [1, 3, 1], pivot: [0, 11.3, 9.8], offset: [0, -1.5, 0], paint: fur('#4e3826'), parent: 'tail', rot: [-0.9, 0, 0], extra: [box([2, 2, 2], [0, -3.4, 0], fur('#241810', { strand: 0.35 }))] },
  ];
  for (const [n, x, z] of [['legFL', -3.5, -4.5], ['legFR', 3.5, -4.5], ['legBL', -3.5, 5], ['legBR', 3.5, 5]] as const) {
    const back = n.includes('B');
    parts.push({ name: n, size: [3, 7, 3], pivot: [x, 7, z], offset: [0, -3.5, 0], paint: fur('#5a4030', { top: '#4a3424' }), extra: [box([3.4, 3, 3.4], [0, -1, back ? 0.3 : -0.2], fur('#6a4a34')), ...cloven(3, -7)] });
  }
  return build('boar', parts, 1.35);
}

// ---------------------------------------------------------------- Hen
// A plump speckled hen: layered breast feathers, wing coverts over long primaries, a tall arched
// sickle tail, a serrated red comb, white ear patches and a double wattle, a two-part beak, and
// scaly legs with three toes forward and one behind.
function hen(): MobModel {
  const plumage = spots(fur('#b07a48', { top: '#9a6a3a', under: '#e8d0a8' }), '#6a4428', 0.07, 1, [TOP, LEFT, RIGHT, BACK]);
  const breast = faces(scales('#e2c49a', { edge: '#b89868', rows: 1 }), {});
  const body = faces(plumage, { [FRONT]: (g, w, h) => { for (let y = 0.33; y < h; y += 1) for (let x = (y * 3) % 2 ? 0 : 0.5; x < w; x += 1) px(g, 'rgba(120,80,40,0.35)', x, y, 0.67, T); } });
  const head = faces(tone('#a8703e', { top: '#8a5a30' }), {
    [RIGHT]: (g, w) => { eye2(g, w - 2.33, 1, 1.67, 1.67, '#e8a830'); px(g, '#f4ece0', w - 2.33, 3, 1.67, 1); },
    [LEFT]: (g) => { eye2(g, 0.67, 1, 1.67, 1.67, '#e8a830'); px(g, '#f4ece0', 0.67, 3, 1.67, 1); },
    [FRONT]: (g, w) => { px(g, '#c89a6a', 1, 3, w - 2, 3); px(g, '#8a5a30', w / 2 - T / 2, 0, T, 3); },
  });
  const beak = tone('#e8b030', { top: '#f8c850', bottom: '#b87a18' });
  // Glossy dark tail feathers with a green-bronze sheen and a pale shaft.
  const feather = over(bands([['#3a4a2e', 1], ['#24301e', 2], ['#6a4a24', 1], ['#24301e', 3], ['#1a2216', 2]]), (g, w, h) => px(g, 'rgba(220,210,170,0.45)', Math.floor(w / 2), 0, 1, h));
  const primaries = faces(bands([['#8a5a30', 3], ['#5a3a1e', 1], ['#3a2616', 2]]), { [LEFT]: (g, w, h) => { for (let x = 0.67; x < w; x += 1.33) px(g, 'rgba(0,0,0,0.3)', x, 0, T, h); }, [RIGHT]: (g, w, h) => { for (let x = 0.67; x < w; x += 1.33) px(g, 'rgba(0,0,0,0.3)', x, 0, T, h); } });
  const legScales = over(tone('#e09a30', { top: '#f0b040' }), (g, w, h, _f, _r, u) => { for (let y = u; y < h; y += u) px(g, 'rgba(120,70,10,0.45)', 0, y, w, 1); });
  const foot = (s: number): Detail[] => [
    box([0.7, 0.6, 2.4], [-0.8, -3.7, -1.2], legScales, [0, 0.35 * s, 0]), box([0.7, 0.6, 2.6], [0, -3.7, -1.3], legScales), box([0.7, 0.6, 2.4], [0.8, -3.7, -1.2], legScales, [0, -0.35 * s, 0]),
    box([0.6, 0.6, 1.4], [0, -3.7, 0.7], legScales),
  ];
  return build('hen', [
    { name: 'legL', size: [1, 4, 1], pivot: [-1.5, 4, 0.5], offset: [0, -2, 0], paint: legScales, extra: [box([1.8, 1.4, 1.8], [0, 0.2, 0], fur('#e8d0a8')), ...foot(-1)] },
    { name: 'legR', size: [1, 4, 1], pivot: [1.5, 4, 0.5], offset: [0, -2, 0], paint: legScales, extra: [box([1.8, 1.4, 1.8], [0, 0.2, 0], fur('#e8d0a8')), ...foot(1)] },
    {
      name: 'torso', size: [7, 7, 9], pivot: [0, 4, 0], offset: [0, 3.5, 0.5], paint: body,
      extra: [box([6, 4.5, 2.4], [0, 2.4, -4.4], breast), box([5.4, 3, 2], [0, 5.8, -3.4], breast), box([6, 3, 2.5], [0, 2, 5], wool('#e8d0a8', { dark: '#c8a878' }))],
    },
    {
      name: 'tailFan', size: [2, 8, 2], pivot: [0, 9, 4], offset: [0, 3.5, 0.5], paint: feather, parent: 'torso', rot: [-0.25, 0, 0],
      extra: [
        box([1.5, 7, 2], [-1.6, 2.5, 0.8], feather, [0.2, 0, 0.35]), box([1.5, 7, 2], [1.6, 2.5, 0.8], feather, [0.2, 0, -0.35]),
        box([1, 5, 1.5], [0, 5.5, 3], feather, [1.1, 0, 0]),
        box([1, 6, 1.2], [-0.9, 6.5, 2], feather, [0.8, 0, 0.2]), box([1, 6, 1.2], [0.9, 6.5, 2], feather, [0.8, 0, -0.2]),
        box([0.8, 4, 1], [0, 7.5, 4.5], feather, [1.5, 0, 0]),
      ],
    },
    { name: 'wingL', size: [1, 5, 7], pivot: [-3.8, 9.5, -1], offset: [0, -2, 1], paint: spots(fur('#8a5a30'), '#5a3a1e', 0.1, 1), parent: 'torso', extra: [box([0.8, 3, 5], [-0.2, -4, 3], primaries, [0.25, 0, 0])] },
    { name: 'wingR', size: [1, 5, 7], pivot: [3.8, 9.5, -1], offset: [0, -2, 1], paint: spots(fur('#8a5a30'), '#5a3a1e', 0.1, 1), parent: 'torso', extra: [box([0.8, 3, 5], [0.2, -4, 3], primaries, [0.25, 0, 0])] },
    { name: 'head', size: [5, 6, 5], pivot: [0, 9, -3], offset: [0, 2.5, -1.5], paint: head, parent: 'torso', extra: [box([5.4, 2.5, 3], [0, -0.5, 0.6], fur('#b07a48'))] },
    {
      // A serrated comb: five rounded points, tallest in the middle.
      name: 'crest', size: [1, 1.5, 4], pivot: [0, 14.8, -4.5], offset: [0, 0.4, 0.4], paint: tone('#c8382a', { top: '#e84a3a' }), parent: 'head', rot: [-0.2, 0, 0],
      extra: [[-1.3, 1.4], [-0.3, 2.2], [0.8, 2.6], [1.9, 2], [2.8, 1.3]].map(([z, hgt]) => box([0.9, hgt, 0.9], [0, 1 + hgt / 2, z], tone('#d8402e', { top: '#f05a44' }))),
    },
    { name: 'beak', size: [2, 1.2, 2], pivot: [0, 11.8, -6.5], offset: [0, 0, -1], paint: beak, parent: 'head', extra: [box([1.4, 0.8, 1], [0, -0.3, -1.8], beak, [0.4, 0, 0])] },
    { name: 'jaw', size: [1.6, 0.8, 1.6], pivot: [0, 11.2, -6.5], offset: [0, -0.4, -0.8], paint: tone('#c88a20'), parent: 'head' },
    { name: 'wattle', size: [1, 2, 1], pivot: [-0.6, 10.5, -7], offset: [0, -1, 0], paint: tone('#c8382a', { top: '#e84a3a' }), parent: 'head', extra: [box([1, 1.7, 1], [1.2, 0.1, 0], tone('#b8302a'))] },
  ], 0.75);
}

// ---------------------------------------------------------------- Woolback
// A big fluffy ram: a cloud of fleece built from overlapping lumps, a long dark face with a pale
// muzzle and split lip, goat-gold eyes with bar pupils, heavy ridged horns spiralling back and
// round, woolly cuffs on dark legs, split hooves, and a fluffy tail.
function woolback(): MobModel {
  const fleece = wool('#ece4cf', { dark: '#cfc4a8', light: '#faf6ea' });
  const face = withFace(tone('#3b3431', { top: '#2e2826', bottom: '#4a4240' }), (g, w) => {
    px(g, '#2a2422', 0, 1.67, w, T);
    eye2(g, 0, 2, 2, 2, '#e0b040', { slit: 'h' }); eye2(g, w - 2, 2, 2, 2, '#e0b040', { slit: 'h' });
    px(g, '#4a4240', 2, 1, w - 4, 4);                                      // a paler blaze down the nose
    px(g, '#5a504c', 2.33, 2, w - 4.67, 3);
  });
  const muzzle = faces(tone('#6a605c', { top: '#5a504c' }), { [FRONT]: (g, w, h) => {
    px(g, '#1e1816', 0.67, 0.67, 1, 1); px(g, '#1e1816', w - 1.67, 0.67, 1, 1);           // nostrils
    px(g, '#2a2220', w / 2 - T / 2, 1.33, T, h - 1.33); px(g, '#2a2220', 1, h - T, w - 2, T); // split lip
  } });
  const horn = over(bands([['#c8b088', 1], ['#9a8460', 1]]), (g, w, h, _f, rand, u) => { for (let y = 0; y < h; y += u) if (rand() < 0.5) px(g, 'rgba(255,245,220,0.35)', 0, y, w, 1); });
  const skin = tone('#5a504c', { top: '#6a605c' });
  const leg = tone('#3a3432', { top: '#4a4240' });
  const parts: PartSpec[] = [
    { name: 'torso', size: [9, 8, 14], pivot: [0, 9, 0], offset: [0, 4, 0], paint: skin },
    {
      name: 'wool', size: [14, 11, 17], pivot: [0, 8, 0], offset: [0, 5.5, 0], paint: fleece, parent: 'torso',
      // Lumps round the fleece so it reads as a cloud, not a crate.
      extra: [
        box([2, 8, 13], [-7.6, 5.5, 0], fleece), box([2, 8, 13], [7.6, 5.5, 0], fleece),
        box([11, 8, 2], [0, 5.5, 9.2], fleece), box([11, 8, 2], [0, 5.5, -9.2], fleece),
        box([12, 1.5, 15], [0, -0.4, 0], fleece),
        box([4, 3, 4], [-4, 11.5, -4], fleece), box([4, 3, 4], [4, 11.5, 3], fleece), box([3.5, 2.5, 3.5], [3.5, 11.2, -5], fleece), box([3.5, 2.5, 3.5], [-4, 11.2, 4.5], fleece),
      ],
    },
    { name: 'woolTop', size: [10, 3, 12], pivot: [0, 19, 0], offset: [0, 0.5, 0], paint: fleece, parent: 'wool' },
    { name: 'tail', size: [3, 4, 2], pivot: [0, 15, 8.5], offset: [0, -1.5, 0.5], paint: fleece, parent: 'torso', extra: [box([3.5, 2.5, 2.5], [0, -3.5, 0.6], fleece)] },
    { name: 'head', size: [7, 7, 7], pivot: [0, 15.5, -8], offset: [0, 0, -3.5], paint: face },
    { name: 'muzzle', size: [5, 4, 3], pivot: [0, 14, -14.5], offset: [0, -0.5, -1.2], paint: muzzle, parent: 'head' },
    { name: 'headWool', size: [8, 3, 6], pivot: [0, 19.5, -9], offset: [0, 0, -1], paint: fleece, parent: 'head', extra: [box([6, 2, 3], [0, -1.6, -3.4], fleece), box([3, 2.5, 3], [-3, 1, 1], fleece), box([3, 2.5, 3], [3, 1, 1], fleece)] },
    { name: 'lids', size: [2.2, 2.2, 0.4], pivot: [2.5, 16, -15.1], offset: [0, 0, 0], paint: tone('#2e2826'), parent: 'head', extra: [box([2.2, 2.2, 0.4], [-5, 0, 0], tone('#2e2826'))] },
    { name: 'earL', size: [3, 1, 2], pivot: [-3.5, 16, -9], offset: [-1.5, 0, 0], paint: faces(skin, { [BOTTOM]: (g, w, h) => px(g, '#8a6a64', T, T, w - 2 * T, h - 2 * T) }), parent: 'head', rot: [0, 0, 0.35] },
    { name: 'earR', size: [3, 1, 2], pivot: [3.5, 16, -9], offset: [1.5, 0, 0], paint: faces(skin, { [BOTTOM]: (g, w, h) => px(g, '#8a6a64', T, T, w - 2 * T, h - 2 * T) }), parent: 'head', rot: [0, 0, -0.35] },
  ];
  // Horns: a thick root, then segments that curl back, down and forward, narrowing as they go.
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    parts.push(
      { name: 'horn' + L + '1', size: [2.4, 2.4, 4], pivot: [3.5 * s, 18, -9], offset: [s, 0, 1.5], paint: horn, parent: 'head', rot: [0, 0.25 * s, 0] },
      { name: 'horn' + L + '2', size: [2.2, 4, 2.2], pivot: [4.5 * s, 18, -6], offset: [s, -1.5, 0.5], paint: horn, parent: 'horn' + L + '1', extra: [box([2, 2, 2], [s * 0.2, 0.8, 1.6], horn)] },
      { name: 'horn' + L + '3', size: [2, 2, 3], pivot: [4.5 * s, 15, -6], offset: [s, -0.5, -1.5], paint: horn, parent: 'horn' + L + '2', rot: [-0.3, 0, 0], extra: [box([1.6, 1.6, 2], [s * 0.9, 0.9, -3.2], horn, [0.5, 0.3 * s, 0]), box([1.2, 1.2, 1.5], [s * 1.6, 2.1, -4], horn, [1, 0.4 * s, 0])] },
    );
  }
  for (const [n, x, z] of [['legFL', -3, -4.5], ['legFR', 3, -4.5], ['legBL', -3, 4.5], ['legBR', 3, 4.5]] as const) {
    parts.push({ name: n, size: [3, 9, 3], pivot: [x, 9, z], offset: [0, -4.5, 0], paint: leg, extra: [box([3.8, 2.5, 3.8], [0, -0.6, 0], fleece), box([3.3, 1.2, 3.3], [0, -6.5, 0], tone('#2e2826')), ...cloven(3, -9)] });
  }
  return build('woolback', parts, 1.45);
}

// ---------------------------------------------------------------- Burrowfox
// A slender russet fox: a wedge snout with a black nose, cream cheek ruffs that flare sideways,
// amber eyes with slit pupils, whiskers, tall ears with dark backs, pale insides and black tips,
// a layered cream bib, black socks with neat paws, and a three-part brush tail with a white tip.
function burrowfox(): MobModel {
  const coat = grizzle(fur('#d0692a', { top: '#b85a20', under: '#f0e2cc' }), 'rgba(255,210,150,0.3)', 0.04);
  const cream = fur('#f2e6d2', { top: '#fbf4e8', strand: 0.1 });
  const face = faces(fur('#d0692a', { top: '#b85a20' }), {
    [FRONT]: (g, w, h) => {
      px(g, '#f2e6d2', 0, h - 2.33, 2, 2.33); px(g, '#f2e6d2', w - 2, h - 2.33, 2, 2.33);   // cream cheeks
      px(g, '#8a3a14', 0, 0.67, 2.33, T); px(g, '#8a3a14', w - 2.33, 0.67, 2.33, T);       // dark brow line
      eye2(g, 0.33, 1, 2, 1.33, '#e8a820', { slit: 'v' }); eye2(g, w - 2.33, 1, 2, 1.33, '#e8a820', { slit: 'v' });
      px(g, '#2a1410', 2.33, 1.67, T, 1); px(g, '#2a1410', w - 2.67, 1.67, T, 1);         // tear marks
    },
    [LEFT]: (g, w, h) => px(g, '#f2e6d2', 0, h - 2, w, 2), [RIGHT]: (g, w, h) => px(g, '#f2e6d2', 0, h - 2, w, 2),
  });
  const muzzle = faces(tone('#f2e6d2', { top: '#d0692a' }), {
    [FRONT]: (g, w, h) => { px(g, '#1a1210', w / 2 - 1, 0, 2, 1); px(g, 'rgba(255,255,255,0.6)', w / 2 - 0.67, T, T, T); px(g, '#6a4a3a', w / 2 - T / 2, 1, T, h - 1); },
    [TOP]: (g, w, h) => px(g, '#1a1210', w / 2 - 1, 0, 2, Math.min(1, h)),
  });
  const ear = faces(bands([['#1e1612', 1.33], ['#c05a22', 2.67]]), { [FRONT]: (g, w, h) => { px(g, '#f2e6d2', T, 1.33, w - 2 * T, h - 1.33); px(g, '#e8c8a8', w / 2 - T / 2, 1.67, T, h - 2); } });
  const sock = bands([['#c8682a', 2], ['#3a2418', 0.67], ['#2a1a12', 3.33]]);
  const whisker = tone('#f4ecde', { noise: 0 });
  const parts: PartSpec[] = [
    { name: 'torso', size: [6, 5, 12], pivot: [0, 6, 0], offset: [0, 2.5, 0], paint: coat, extra: [box([5, 1.5, 10], [0, -0.2, 0], cream), box([6.4, 4.5, 4], [0, 2.4, 4], coat)] },
    { name: 'chest', size: [4.5, 5, 2], pivot: [0, 6, -6], offset: [0, 2, 0], paint: cream, parent: 'torso', extra: [box([3.5, 3, 1.5], [0, 0.5, -1.2], cream), box([2.5, 2, 1], [0, -1.5, -1.8], cream)] },
    { name: 'head', size: [6, 5, 5], pivot: [0, 10, -5.5], offset: [0, 0.5, -2.5], paint: face, extra: [box([1.6, 2.5, 2.5], [-3.4, -0.6, -2.4], cream, [0, 0.3, 0.3]), box([1.6, 2.5, 2.5], [3.4, -0.6, -2.4], cream, [0, -0.3, -0.3])] },
    { name: 'muzzle', size: [3, 2, 3.5], pivot: [0, 9.5, -10.5], offset: [0, -0.5, -1.7], paint: muzzle, parent: 'head', extra: [box([2.4, 0.8, 3], [0, -1.4, -1.3], cream)] },
    {
      name: 'whiskers', size: [0.2, 0.2, 0.2], pivot: [0, 9.3, -12.3], offset: [0, 0, 0], paint: whisker, parent: 'head',
      extra: [box([4, 0.2, 0.2], [-3, 0.2, 0], whisker, [0, 0.25, 0.1]), box([4, 0.2, 0.2], [-3, -0.3, 0], whisker, [0, 0.4, -0.1]), box([4, 0.2, 0.2], [3, 0.2, 0], whisker, [0, -0.25, -0.1]), box([4, 0.2, 0.2], [3, -0.3, 0], whisker, [0, -0.4, 0.1])],
    },
    { name: 'lids', size: [2, 1.3, 0.4], pivot: [2, 11.8, -10.7], offset: [0, 0, 0], paint: tone('#d0692a'), parent: 'head', extra: [box([2, 1.3, 0.4], [-4, 0, 0], tone('#d0692a'))] },
    { name: 'collar', size: [6.4, 1.5, 3], pivot: [0, 10.2, -5.8], offset: [0, 0, 0], paint: faces(tone('#b8302a'), { [FRONT]: (g, w) => { px(g, '#f0c040', w / 2 - T, 0.33, 0.67, 1); } }), parent: 'head' },
    { name: 'earL', size: [2, 4, 1], pivot: [-1.8, 13, -6.5], offset: [0, 2, 0], paint: ear, parent: 'head', rot: [0, 0, 0.12], extra: [box([1.2, 1.5, 0.8], [0, 4.5, 0], tone('#1e1612'))] },
    { name: 'earR', size: [2, 4, 1], pivot: [1.8, 13, -6.5], offset: [0, 2, 0], paint: ear, parent: 'head', rot: [0, 0, -0.12], extra: [box([1.2, 1.5, 0.8], [0, 4.5, 0], tone('#1e1612'))] },
    { name: 'tail', size: [3.6, 3.6, 5], pivot: [0, 10, 5.5], offset: [0, -0.5, 2.3], paint: coat, rot: [0.55, 0, 0] },
    { name: 'tail2', size: [4.4, 4.4, 5], pivot: [0, 9.5, 10], offset: [0, 0, 2.4], paint: coat, parent: 'tail' },
    { name: 'tail3', size: [3.8, 3.8, 3.5], pivot: [0, 9.5, 14.8], offset: [0, 0, 1.6], paint: cream, parent: 'tail2', extra: [box([2.4, 2.4, 1.2], [0, 0, 3.6], cream)] },
  ];
  for (const [n, x, z] of [['legFL', -1.8, -4.5], ['legFR', 1.8, -4.5], ['legBL', -1.8, 4.5], ['legBR', 1.8, 4.5]] as const) {
    parts.push({ name: n, size: [2, 6, 2], pivot: [x, 6, z], offset: [0, -3, 0], paint: sock, extra: [box([2.3, 0.8, 2.8], [0, -5.6, -0.3], tone('#1e1410')), ...(n.includes('B') ? [box([2.6, 3, 3], [0, -0.8, 0.4], coat)] : [])] });
  }
  return build('burrowfox', parts, 0.95);
}

// ---------------------------------------------------------------- Mossback
// A tall, gentle deer: a fawn coat with pale dapples, a strip of living moss down its spine with tiny
// flowers and a mushroom or two, a shaggy neck mane, a pale throat patch, big dark eyes, branching
// antlers with three tiers of tines hung with moss, long legs with dark knees, split hooves, and a
// white tail. Tame it with apples or wheat, saddle it, and ride it.
function mossback(): MobModel {
  const coat = spots(fur('#a8784a', { top: '#96683e', under: '#e8d8b8' }), '#e8dcc0', 0.035, 1, [TOP, LEFT, RIGHT]);
  const moss: Paint = over(fur('#5a8a36', { top: '#6a9a3e', strand: 0.3 }), (g, w, h, f, rand, u) => {
    if (f === TOP) for (let i = 0; i < Math.max(2, (w * h) / (8 * u * u)); i++) { const c = ['#f0e060', '#e890a8', '#f0f0f0', '#a8d0f0'][i % 4]; const x = Math.floor(rand() * w), y = Math.floor(rand() * h); px(g, c, x, y, u, u); px(g, '#f8e8a0', x + Math.floor(u / 2), y + Math.floor(u / 2), 1, 1); }
    else for (let x = 0; x < w; x++) if (rand() < 0.4) px(g, '#3a5a22', x, h - 1 - Math.floor(rand() * u * 2), 1, u * 2);
  });
  const face = withFace(fur('#9a6a3e', { top: '#86582e' }), (g, w) => {
    eye2(g, 0, 2, 2.33, 2.33, '#3a2210', { white: '#1a1008', pupil: '#0a0604' });
    eye2(g, w - 2.33, 2, 2.33, 2.33, '#3a2210', { white: '#1a1008', pupil: '#0a0604' });
    px(g, '#e8d8b8', 1, 6, w - 2, 2);
    px(g, '#6a4424', 0, 1.33, 2.67, T); px(g, '#6a4424', w - 2.67, 1.33, 2.67, T);
  });
  const snout = faces(tone('#e8d8b8', { top: '#9a6a3e' }), { [FRONT]: (g, w) => { px(g, '#241810', 0.67, 0, w - 1.33, 2); px(g, 'rgba(255,255,255,0.5)', 1, 0.33, 0.67, T); px(g, '#3a2418', w / 2 - T / 2, 2, T, 1); } });
  const antler = over(tone('#d8c8a0', { bottom: '#a89878' }), (g, w, h, _f, rand) => { for (let i = 0; i < h; i += 2) if (rand() < 0.4) px(g, 'rgba(120,100,70,0.4)', 0, i, w, 1); });
  const leg = bands([['#a8784a', 7], ['#8a603a', 1], ['#6a4a2e', 1], ['#a8784a', 3], ['#8a603a', 2], ['#2a1e16', 2]]);
  const saddle = faces(tone('#6a3a20', { top: '#7a4a28' }), { [TOP]: (g, w, h) => { px(g, '#c8a048', 0, h / 2 - T / 2, w, T); px(g, '#5a2a18', 0.67, 0.67, w - 1.33, T); px(g, '#5a2a18', 0.67, h - 1, w - 1.33, T); } });
  const shroom = faces(tone('#c8502a', { top: '#d8603a' }), { [TOP]: (g, w, h) => { px(g, '#f4ecd8', T, T, T, T); px(g, '#f4ecd8', w - 2 * T, h - 2 * T, T, T); } });
  const mane = fur('#7a5430', { top: '#6a4628', strand: 0.3 });
  const parts: PartSpec[] = [
    {
      name: 'torso', size: [11, 11, 22], pivot: [0, 16, 0], offset: [0, 5, 0], paint: coat,
      extra: [box([9, 2, 18], [0, -0.4, 0], fur('#e8d8b8', { strand: 0.1 })), box([12, 8, 7], [0, 6, 7], coat), box([11.6, 8, 6], [0, 5.5, -7.5], coat)],
    },
    { name: 'moss', size: [5, 2, 18], pivot: [0, 26, 0], offset: [0, 1, -0.5], paint: moss, parent: 'torso', extra: [box([3, 2, 3], [0, 2.2, -5], moss), box([3, 1.5, 3], [1, 2, 4], moss), box([1, 1.5, 1], [-1.5, 2.5, 2], tone('#e8dcc0')), box([2.4, 0.8, 2.4], [-1.5, 3.4, 2], shroom), box([0.8, 1, 0.8], [1.2, 2.2, -1], tone('#e8dcc0')), box([1.6, 0.6, 1.6], [1.2, 2.9, -1], shroom)] },
    { name: 'saddle', size: [12, 2, 9], pivot: [0, 27, -1], offset: [0, 0.5, 0], paint: saddle, parent: 'torso', extra: [box([1, 7, 2], [-6.3, -3.5, 0], tone('#4a2a18')), box([1, 7, 2], [6.3, -3.5, 0], tone('#4a2a18')), box([2, 1, 2.4], [-6.5, -7.4, 0], tone('#9a9a9e')), box([2, 1, 2.4], [6.5, -7.4, 0], tone('#9a9a9e')), box([3, 2, 1.5], [0, 1.5, -4], tone('#7a4a28'))] },
    { name: 'neck', size: [6, 12, 6], pivot: [0, 24, -9], offset: [0, 5, -1], paint: coat, rot: [0.35, 0, 0], extra: [box([2, 11, 3], [0, 5, 2.4], mane), box([5, 5, 1.2], [0, 3, -4.2], fur('#e8d8b8', { strand: 0.1 }))] },
    { name: 'head', size: [7, 7, 8], pivot: [0, 35, -12], offset: [0, 1, -3], paint: face, parent: 'neck' },
    { name: 'snout', size: [5, 4, 4], pivot: [0, 34, -19], offset: [0, 0, -1.5], paint: snout, parent: 'head' },
    { name: 'lids', size: [2.4, 2.4, 0.4], pivot: [2.33, 37.2, -19.1], offset: [0, 0, 0], paint: tone('#86582e'), parent: 'head', extra: [box([2.4, 2.4, 0.4], [-4.67, 0, 0], tone('#86582e'))] },
    { name: 'earL', size: [4, 2, 1], pivot: [-3.5, 38, -12], offset: [-2, 0, 0], paint: faces(fur('#9a6a3e'), { [FRONT]: (g, w, h) => px(g, '#e8c8b0', 0.67, T, w - 1.33, h - 2 * T) }), parent: 'head', rot: [0, 0, 0.3] },
    { name: 'earR', size: [4, 2, 1], pivot: [3.5, 38, -12], offset: [2, 0, 0], paint: faces(fur('#9a6a3e'), { [FRONT]: (g, w, h) => px(g, '#e8c8b0', 0.67, T, w - 1.33, h - 2 * T) }), parent: 'head', rot: [0, 0, -0.3] },
    { name: 'tail', size: [3, 5, 2], pivot: [0, 25, 11], offset: [0, -2, 0.5], paint: tone('#f0ece0'), parent: 'torso', rot: [0.3, 0, 0], extra: [box([2.4, 3, 1], [0, -1, 1.4], tone('#8a603a'))] },
  ];
  // Antlers: a main beam with three tiers of tines, and moss hanging from them.
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    parts.push(
      {
        name: 'antler' + L, size: [1.5, 7, 1.5], pivot: [2.2 * s, 39, -13], offset: [0, 3.5, 0], paint: antler, parent: 'head', rot: [-0.25, 0, -0.45 * s],
        extra: [
          box([1.2, 4, 1.2], [1.8 * s, 6, -1], antler, [-0.5, 0, -0.6 * s]),
          box([1.2, 5, 1.2], [-0.8 * s, 7.5, 1], antler, [0.4, 0, 0.3 * s]),
          box([1.2, 3, 1.2], [0.5 * s, 3, -1.8], antler, [-0.9, 0, 0]),
          box([1, 3, 1], [2.8 * s, 8.4, -2.2], antler, [-0.3, 0, -0.9 * s]),
          box([1, 3.5, 1], [-1.4 * s, 10.5, 1.8], antler, [0.6, 0, 0.5 * s]),
          box([1, 2.5, 1], [0.4 * s, 10.8, 0.2], antler, [0.1, 0, -0.2 * s]),
          box([2, 2.5, 1.5], [1.2 * s, 5, -0.2], moss),
          box([0.7, 3, 0.7], [2 * s, 3, -0.8], moss), box([0.7, 2, 0.7], [-0.8 * s, 5.5, 1.2], moss),
        ],
      },
    );
  }
  for (const [n, x, z] of [['legFL', -3.5, -8], ['legFR', 3.5, -8], ['legBL', -3.5, 8], ['legBR', 3.5, 8]] as const) {
    const back = n.includes('B');
    parts.push({ name: n, size: [3, 16, 3], pivot: [x, 16, z], offset: [0, -8, 0], paint: leg, extra: [...(back ? [box([3.8, 6, 5], [0, -2, 0.6], coat)] : [box([3.6, 5, 4], [0, -1.5, 0], coat)]), box([3.3, 1.4, 3.3], [0, -9.5, 0], tone('#6a4a2e')), ...cloven(3, -16)] });
  }
  return build('mossback', parts, 1.7);
}

// ---------------------------------------------------------------- Bee
// A round, fuzzy bee: a fluffy amber thorax, a banded abdomen that pumps as it flies, a dark head
// with big faceted eyes and little mandibles, elbowed antennae, six jointed legs with pollen baskets,
// two pairs of veined see-through wings and a tiny stinger.
function bee(): MobModel {
  const fuzz = (c: string) => over(tone(c), (g, w, h, _f, rand) => { for (let i = 0; i < w * h * 0.3; i++) px(g, rand() < 0.5 ? 'rgba(255,240,180,0.35)' : 'rgba(60,30,10,0.25)', Math.floor(rand() * w), Math.floor(rand() * h)); });
  const abdomen = faces(over(bands([['#e8b030', 1.33], ['#3a2418', 1], ['#e8b030', 1.33], ['#3a2418', 1], ['#e8b030', 1], ['#3a2418', 1.33]]), (g, w, h, _f, rand) => { for (let i = 0; i < w * h * 0.15; i++) px(g, 'rgba(255,240,180,0.3)', Math.floor(rand() * w), Math.floor(rand() * h)); }), {});
  const headP = faces(fuzz('#3a2418'), {
    [FRONT]: (g, w, h) => {
      // Faceted eyes: a honeycomb of dark cells with one bright glint each.
      for (const x0 of [0, w - 2]) { px(g, '#1a1008', x0, 0.33, 2, h - 1); for (let y = 0.67; y < h - 1; y += 0.67) for (let x = x0 + ((y * 3) % 2 ? T : 0); x < x0 + 2; x += 0.67) px(g, '#2e2418', x, y, T, T); px(g, 'rgba(255,255,255,0.85)', x0 + 0.33, 0.67, T, T); }
      px(g, '#c8902a', 2, h - 1, w - 4, T);
    },
  });
  const wing = faces(tone('#dceef8', { top: '#f0f8ff' }), { [TOP]: (g, w, h) => { px(g, 'rgba(120,150,180,0.6)', 0, h / 2, w, T); px(g, 'rgba(120,150,180,0.5)', w / 3, 0, T, h); px(g, 'rgba(120,150,180,0.5)', (w * 2) / 3, h / 4, T, h * 0.6); px(g, 'rgba(90,110,140,0.6)', 0, 0, w, T); } });
  const legP = tone('#2a1a10');
  const pollen = tone('#f0c040', { top: '#f8e070' });
  const legs: PartSpec[] = [];
  [-1, 1].forEach((s) => [-2.5, 0, 2.5].forEach((z, i) => {
    legs.push({ name: `leg${s < 0 ? 'L' : 'R'}${i}`, size: [0.6, 2, 0.6], pivot: [1.8 * s, 2, z], offset: [0.3 * s, -1, 0], paint: legP, parent: 'torso', rot: [0.2 * (i - 1), 0, -0.5 * s], extra: [box([0.5, 1.6, 0.5], [0.8 * s, -2.3, -0.3], legP, [0.4, 0, 0.6 * s]), ...(i === 2 ? [box([1, 1, 1], [0.6 * s, -1.4, 0], pollen)] : [])] });
  }));
  return build('bee', [
    { name: 'torso', size: [6, 6, 5], pivot: [0, 4, -1.5], offset: [0, 0, 0], paint: fuzz('#e8b030'), extra: [box([6.6, 3, 4], [0, 1.6, 0], fuzz('#d8a028'))] },
    { name: 'abdomen', size: [5.5, 5.5, 5], pivot: [0, 4.2, 1], offset: [0, -0.3, 2.4], paint: abdomen, parent: 'torso', rot: [0.15, 0, 0], extra: [box([1, 1, 2], [0, -0.6, 5.3], tone('#2a1a10')), box([0.4, 0.4, 1], [0, -0.6, 6.6], tone('#e8e0c8'))] },
    { name: 'head', size: [5, 4.5, 3], pivot: [0, 4.3, -4], offset: [0, 0, -1.5], paint: headP, parent: 'torso', extra: [box([0.8, 0.8, 1.2], [-0.8, -1.9, -3.2], tone('#5a3a1e'), [0, 0.3, 0]), box([0.8, 0.8, 1.2], [0.8, -1.9, -3.2], tone('#5a3a1e'), [0, -0.3, 0])] },
    { name: 'antennaL', size: [0.7, 3, 0.7], pivot: [-1.2, 6.2, -6], offset: [0, 1.5, 0], paint: legP, parent: 'head', rot: [-0.5, 0, 0.3], extra: [box([0.7, 0.7, 2], [0, 3, -0.8], legP), box([1, 1, 1], [0, 3, -1.9], legP)] },
    { name: 'antennaR', size: [0.7, 3, 0.7], pivot: [1.2, 6.2, -6], offset: [0, 1.5, 0], paint: legP, parent: 'head', rot: [-0.5, 0, -0.3], extra: [box([0.7, 0.7, 2], [0, 3, -0.8], legP), box([1, 1, 1], [0, 3, -1.9], legP)] },
    { name: 'wingL', size: [5, 0.4, 4], pivot: [-1, 7, -1.5], offset: [-2.5, 0, 1], paint: wing, parent: 'torso', extra: [box([3.5, 0.4, 2.6], [-2, -0.2, 3.6], wing)] },
    { name: 'wingR', size: [5, 0.4, 4], pivot: [1, 7, -1.5], offset: [2.5, 0, 1], paint: wing, parent: 'torso', extra: [box([3.5, 0.4, 2.6], [2, -0.2, 3.6], wing)] },
    ...legs,
  ], 0.4);
}

// ---------------------------------------------------------------- Bogfrog
// A squat mottled frog: warty skin with ridges down its back, bulging golden eyes with bar pupils
// under heavy lids, nostrils and a wide mouth line, a pale pulsing throat sac, splayed fingers
// with round toe pads, and big webbed back feet.
function bogfrog(): MobModel {
  const mottled = spots(tone('#4f8a32', { top: '#5a9a38', under: '#d8d8a0' }), '#2e5a1e', 0.07, 2, [TOP, LEFT, RIGHT, BACK]);
  const warty = over(mottled, (g, w, h, f, rand, u) => { if (f === BOTTOM) return; for (let i = 0; i < (w * h) / (u * u * 5); i++) { const x = Math.floor(rand() * w), y = Math.floor(rand() * h); px(g, '#6aa844', x, y, Math.max(1, u - 1), Math.max(1, u - 1)); px(g, '#2e5a1e', x, y + Math.max(1, u - 1), Math.max(1, u - 1), 1); } });
  const skin = faces(warty, { [TOP]: (g, w, h) => { px(g, '#c8c050', w / 2 - T / 2, 0, T, h); px(g, '#3e7a28', 0.67, 0, T, h); px(g, '#3e7a28', w - 1, 0, T, h); } });
  const head = faces(skin, { [FRONT]: (g, w) => { px(g, '#1e3a14', 0, 2, w, T); px(g, '#8ab85a', 0, 1.67, w, T); px(g, '#1a2a10', 3, 0.67, 0.67, 0.67); px(g, '#1a2a10', w - 3.67, 0.67, 0.67, 0.67); } });
  const iris = (g: CanvasRenderingContext2D, w: number, h: number) => { eye2(g, 0, 0.33, w, h - 0.67, '#e8c040', { slit: 'h' }); };
  const eyeball = faces(tone('#4f8a32'), { [FRONT]: iris, [LEFT]: iris, [RIGHT]: iris, [TOP]: (g, w, h) => px(g, '#3e7a28', 0, 0, w, h) });
  const pad = tone('#c8d890', { top: '#d8e8a0' });
  const fingers = (s: number): Detail[] => [-0.8, 0, 0.8].map((dz, i) => box([0.6, 0.5, 1.8], [0.2 * s + (i - 1) * 0.6 * s, -4, -1.2 + dz * 0.4], skin, [0, (i - 1) * 0.6 * s, 0])).concat([-0.8, 0, 0.8].map((dz, i) => box([0.9, 0.5, 0.9], [0.2 * s + (i - 1) * 1.1 * s, -4, -2.1 + dz * 0.3], pad)));
  const webbed = (s: number): Detail[] => [box([3.5, 0.5, 4], [-0.5 * s, -1.9, -1.5], faces(tone('#3e7a28'), { [TOP]: (g, w, h) => { for (let x = 0.67; x < w; x += 1.33) px(g, '#2e5a1e', x, 0, T, h); } })), box([1, 0.6, 1], [-1.8 * s, -1.9, -3.6], pad), box([1, 0.6, 1], [-0.5 * s, -1.9, -3.8], pad), box([1, 0.6, 1], [0.8 * s, -1.9, -3.6], pad)];
  return build('bogfrog', [
    { name: 'torso', size: [9, 5, 9], pivot: [0, 1.5, 1], offset: [0, 2.5, 0], paint: skin, extra: [box([7, 1, 8], [0, 5.2, 0.5], skin), box([8, 1.5, 7], [0, -0.3, 0], tone('#d8d8a0'))] },
    { name: 'head', size: [9, 3, 6], pivot: [0, 5, -2.5], offset: [0, 1.5, -3], paint: head, parent: 'torso', extra: [box([8.4, 1.4, 5.4], [0, -0.6, -3.2], tone('#d8d8a0'))] },
    { name: 'eyeL', size: [3, 3, 3], pivot: [-3, 8, -5], offset: [0, 1, 0], paint: eyeball, parent: 'head', extra: [box([3.4, 0.8, 2.4], [0, 2.6, 0.3], skin)] },
    { name: 'eyeR', size: [3, 3, 3], pivot: [3, 8, -5], offset: [0, 1, 0], paint: eyeball, parent: 'head', extra: [box([3.4, 0.8, 2.4], [0, 2.6, 0.3], skin)] },
    { name: 'throat', size: [5, 1, 3], pivot: [0, 4.2, -6.5], offset: [0, -0.5, 0], paint: tone('#e8ecb8', { top: '#f4f8c8' }), parent: 'head' },
    { name: 'thighL', size: [3, 3, 5], pivot: [-4.5, 3, 2.5], offset: [0, 0, 1], paint: skin, rot: [0, 0.3, 0], extra: [box([2.4, 1.2, 4.4], [-0.4, -1.5, -1], skin), ...webbed(1)] },
    { name: 'thighR', size: [3, 3, 5], pivot: [4.5, 3, 2.5], offset: [0, 0, 1], paint: skin, rot: [0, -0.3, 0], extra: [box([2.4, 1.2, 4.4], [0.4, -1.5, -1], skin), ...webbed(-1)] },
    { name: 'armL', size: [2, 4, 2], pivot: [-3.5, 4, -2.5], offset: [0, -2, 0], paint: skin, extra: fingers(-1) },
    { name: 'armR', size: [2, 4, 2], pivot: [3.5, 4, -2.5], offset: [0, -2, 0], paint: skin, extra: fingers(1) },
  ], 0.9);
}

// ---------------------------------------------------------------- Cave moth
// A big fuzzy moth: a cream ruff, a banded fuzzy abdomen, feathery antennae with fine side combs,
// six thin legs, and dusky scalloped wings marked with ringed pale-cyan eyespots that glow in the
// dark.
function cavemoth(): MobModel {
  const body = fur('#6a5a4a', { top: '#7a6a58' });
  const wingPaint = (base: string, spot: boolean): Paint => faces(tone(base, { top: shade(base, 1.08) }), {
    [TOP]: (g, w, h, rand) => {
      // Veins, a scalloped darker rim, a wavy band, and (on the forewings) a ringed glowing eyespot.
      for (let x = 1; x < w; x += 2) px(g, 'rgba(40,30,20,0.35)', x, 0, T, h);
      for (let x = 0; x < w; x += 1) px(g, '#4a3e30', x, h - 1 + (x % 2 ? 0.33 : 0), 0.67, 1);
      for (let x = 0; x < w; x += T) px(g, 'rgba(230,210,180,0.35)', x, h * 0.3 + Math.sin(x * 1.3) * 0.67, T, T);
      px(g, '#5a4a3a', w - 1, 0, 1, h);
      if (spot) {
        const cx = w * 0.55, cy = h / 2 - 1;
        px(g, '#2a2220', cx - 1.33, cy - 1.33, 4.67, 4.67); px(g, '#e8dcc0', cx - 0.67, cy - 0.67, 3.33, 3.33); px(g, '#2a2220', cx - 0.33, cy - 0.33, 2.67, 2.67);
        px(g, '#7af0e8', cx, cy, 2, 2); px(g, '#e8fffc', cx + 0.33, cy + 0.33, 0.67, 0.67);
      } else px(g, '#8a7a64', 1, 1, w - 3, T);
      void rand;
    },
    [BOTTOM]: (g, w, h) => px(g, 'rgba(255,240,220,0.12)', 0, 0, w, h),
  });
  const fore = wingPaint('#9a8a70', true), hind = wingPaint('#8a765e', false);
  const sideEye = (g: CanvasRenderingContext2D, w: number, h: number) => { px(g, '#140e0a', 0, 0, w, h); for (let y = 0.33; y < h; y += 0.67) for (let x = 0.33; x < w; x += 0.67) px(g, '#2a2420', x, y, T, T); px(g, 'rgba(160,240,255,0.8)', T, T, T, T); };
  const antenna = faces(speckle('#c8b898', '#8a7a60'), { [TOP]: (g, w, h) => { px(g, '#8a7a60', w / 2 - T / 2, 0, T, h); for (let y = 0; y < h; y += 0.67) px(g, '#e8dcc0', 0, y, w, T); } });
  const legP = tone('#4a3e32');
  const legs: PartSpec[] = [];
  [-1, 1].forEach((s) => [-1, 1, 3].forEach((z, i) => legs.push({ name: `leg${s < 0 ? 'L' : 'R'}${i}`, size: [0.5, 2.5, 0.5], pivot: [1.6 * s, 4.5, z], offset: [0, -1.2, 0], paint: legP, parent: 'torso', rot: [0.3 * (i - 1), 0, -0.6 * s], extra: [box([0.4, 2, 0.4], [0.9 * s, -2.8, 0], legP, [0, 0, 0.9 * s])] })));
  return build('cavemoth', [
    { name: 'torso', size: [4, 4, 9], pivot: [0, 6, 0], offset: [0, 0, 1.5], paint: body, extra: [box([3, 3, 5], [0, -0.5, 7.5], bands([['#6a5a4a', 0.67], ['#4a3e32', 0.67]])), box([2.4, 2.4, 2], [0, -0.7, 10.6], bands([['#6a5a4a', 0.67], ['#4a3e32', 0.67]]))] },
    { name: 'ruff', size: [5, 5, 3], pivot: [0, 6, -2.5], offset: [0, 0, 0], paint: wool('#e6dcc4'), parent: 'torso', extra: [box([6, 3, 2], [0, 1.4, 0.8], wool('#e6dcc4'))] },
    { name: 'head', size: [3, 3, 3], pivot: [0, 6, -4], offset: [0, 0, -1.5], paint: faces(body, { [LEFT]: sideEye, [RIGHT]: sideEye }), parent: 'torso', extra: [box([1.4, 1.4, 1.4], [-1.5, 0.3, -1.3], faces(body, { [LEFT]: sideEye, [FRONT]: sideEye })), box([1.4, 1.4, 1.4], [1.5, 0.3, -1.3], faces(body, { [RIGHT]: sideEye, [FRONT]: sideEye }))] },
    { name: 'antennaL', size: [2, 0.5, 6], pivot: [-1, 7.5, -5.5], offset: [0, 0, -3], paint: antenna, parent: 'head', rot: [-0.6, -0.45, 0], extra: [box([2.8, 0.3, 3], [0, 0, -4], antenna)] },
    { name: 'antennaR', size: [2, 0.5, 6], pivot: [1, 7.5, -5.5], offset: [0, 0, -3], paint: antenna, parent: 'head', rot: [-0.6, 0.45, 0], extra: [box([2.8, 0.3, 3], [0, 0, -4], antenna)] },
    { name: 'wingL', size: [9, 0.6, 10], pivot: [-2, 7.5, -2], offset: [-4.5, 0, 2.5], paint: fore, extra: [box([4, 0.6, 3], [-3, 0, -3.5], fore), box([3, 0.5, 3], [-8.4, 0, 5.5], fore)] },
    { name: 'wingR', size: [9, 0.6, 10], pivot: [2, 7.5, -2], offset: [4.5, 0, 2.5], paint: fore, extra: [box([4, 0.6, 3], [3, 0, -3.5], fore), box([3, 0.5, 3], [8.4, 0, 5.5], fore)] },
    { name: 'wingBL', size: [7, 0.6, 7], pivot: [-2, 7, 4], offset: [-3.5, 0, 2.5], paint: hind, extra: [box([3, 0.5, 2.5], [-2, 0, 6.5], hind)] },
    { name: 'wingBR', size: [7, 0.6, 7], pivot: [2, 7, 4], offset: [3.5, 0, 2.5], paint: hind, extra: [box([3, 0.5, 2.5], [2, 0, 6.5], hind)] },
    ...legs,
  ], 0.8);
}

// ---------------------------------------------------------------- Streamfish
// A speckled trout: an olive back with dark spots ringed in pale halos, a silver belly, a pink band
// down each side with a fine lateral line, gill covers, golden eyes, a hooked jaw, and a full set of
// fins: dorsal, adipose, pectorals, pelvics, anal and a forked tail.
function streamfish(): MobModel {
  const side = (g: CanvasRenderingContext2D, w: number) => { px(g, 'rgba(255,160,170,0.55)', 0, 1.33, w, 1.33); px(g, '#e07a8a', 0, 1.67, w, 0.67); px(g, 'rgba(40,50,40,0.5)', 0, 2, w, T); };
  const body = faces(over(tone('#6a8a5a', { top: '#5a7a4a', under: '#e8eef0' }), (g, w, h, f, rand, u) => {
    if (f === BOTTOM) return;
    for (let i = 0; i < (w * h) / (u * u * 6); i++) { const x = Math.floor(rand() * w), y = Math.floor(rand() * h * 0.6); px(g, 'rgba(230,240,220,0.5)', x - 1, y - 1, u + 1, u + 1); px(g, '#2a3222', x, y, u - 1, u - 1); }
  }), { [LEFT]: side, [RIGHT]: side });
  const gill = (g: CanvasRenderingContext2D, w: number, h: number) => { px(g, 'rgba(60,40,40,0.5)', w - 0.67, 0.33, T, h - 0.67); px(g, 'rgba(230,120,130,0.4)', w - 1, 1, T, h - 2); };
  const headPaint = faces(tone('#7a9a6a', { under: '#e8eef0' }), {
    [LEFT]: (g, w, h) => { eye2(g, 0.33, 0.33, 1.33, 1.33, '#e8c050', { white: '#e8e0c0' }); gill(g, w, h); },
    [RIGHT]: (g, w, h) => { eye2(g, w - 1.67, 0.33, 1.33, 1.33, '#e8c050', { white: '#e8e0c0' }); px(g, 'rgba(60,40,40,0.5)', 0.33, 0.33, T, h - 0.67); },
  });
  const fin = over(tone('#9aa88a', { top: '#aab89a' }), (g, w, h, _f, _r, u) => { for (let x = 0; x < w; x += u) px(g, 'rgba(60,70,50,0.35)', x, 0, 1, h); });
  return build('streamfish', [
    { name: 'torso', size: [3, 4, 7], pivot: [0, 3, 0], offset: [0, 0, 0.5], paint: body, extra: [box([2.4, 3, 2], [0, 0, 4.6], body)] },
    { name: 'head', size: [3, 3, 3], pivot: [0, 3, -3], offset: [0, 0.3, -1.5], paint: headPaint, parent: 'torso' },
    { name: 'jaw', size: [2.5, 1, 2], pivot: [0, 2, -3.5], offset: [0, -0.5, -1.2], paint: tone('#d8e0d8'), parent: 'torso', extra: [box([0.8, 0.6, 0.6], [0, 0.2, -2.1], tone('#c8d0c8'))] },
    { name: 'tail', size: [1, 2, 3], pivot: [0, 3, 5.5], offset: [0, 0, 1.5], paint: fin, parent: 'torso', extra: [box([1, 3, 2.5], [0, 1.6, 3.4], fin, [0.5, 0, 0]), box([1, 3, 2.5], [0, -1.6, 3.4], fin, [-0.5, 0, 0])] },
    { name: 'dorsal', size: [1, 2, 3], pivot: [0, 5, -0.5], offset: [0, 1, 0.5], paint: fin, parent: 'torso', rot: [0.3, 0, 0], extra: [box([0.8, 1, 1], [0, -0.4, 5.3], fin)] },
    { name: 'finL', size: [2, 0.5, 2], pivot: [-1.5, 1.8, -1.5], offset: [-1, 0, 0.5], paint: fin, parent: 'torso', rot: [0, 0, 0.3], extra: [box([1.4, 0.4, 1.4], [0.2, -0.3, 3.3], fin)] },
    { name: 'finR', size: [2, 0.5, 2], pivot: [1.5, 1.8, -1.5], offset: [1, 0, 0.5], paint: fin, parent: 'torso', rot: [0, 0, -0.3], extra: [box([1.4, 0.4, 1.4], [-0.2, -0.3, 3.3], fin)] },
    { name: 'anal', size: [0.8, 1.4, 1.6], pivot: [0, 1, 3.5], offset: [0, -0.5, 0], paint: fin, parent: 'torso', rot: [-0.3, 0, 0] },
  ], 0.4);
}

// ---------------------------------------------------------------- Villagers
interface Look { robe: string; trim: string; hair: string | null; trousers: string; eyes: string; extras: () => PartSpec[] }

const SKINS = ['#e0b896', '#c8966e', '#a8724e', '#8a5a3a', '#f0cca8'];

/** A beard hanging from the chin, with a moustache and optional sideburns. */
function beard(color: string, width: number, length: number, sideburns: boolean): PartSpec {
  const f = fur(color, { strand: 0.3 });
  const extra = [box([width - 2, 1, 1.3], [0, 1.6, -0.2], fur(shade(color, 0.85))), box([width - 3, length * 0.4, 1], [0, -length * 0.55, -0.2], f)];
  if (sideburns) extra.push(box([0.8, 3, 2.5], [-3.7, 2, 1.2], f), box([0.8, 3, 2.5], [3.7, 2, 1.2], f));
  return { name: 'beard', size: [width, length, 1.2], pivot: [0, 24.4, -4.3], offset: [0, -length / 2 + 0.6, 0], paint: f, parent: 'head', extra };
}

function villager(profession = 'farmer'): MobModel {
  const h = [...profession].reduce((a, c) => a + c.charCodeAt(0), 0);
  const skinC = SKINS[h % SKINS.length];
  const trimBand = (c: string): Partial<Record<number, (g: CanvasRenderingContext2D, w: number, h: number) => void>> =>
    Object.fromEntries([FRONT, BACK, LEFT, RIGHT].map((f) => [f, (g: CanvasRenderingContext2D, w: number, hh: number) => { px(g, c, 0, hh - 1, w, 1); px(g, shade(c, 1.2), 0, hh - 1, w, T); }]));
  const wood = tone('#8a6a3a', { top: '#9a7a4a', bottom: '#6a4a2a' });
  const steel = tone('#a8acb0', { top: '#d0d4d8', bottom: '#6a6e72', noise: 0.03 });
  const looks: Record<string, Look> = {
    farmer: {
      robe: '#6a7a3a', trim: '#c8a048', hair: '#6a4a2a', trousers: '#5a4a32', eyes: '#3a5a2a',
      extras: () => [
        { name: 'hatBrim', size: [14, 1, 14], pivot: [0, 31, 0], offset: [0, 0.5, 0], paint: over(spots(tone('#e0c878'), '#b89848', 0.12, 1), (g, w, hh, f, _r, u) => { if (f === TOP || f === BOTTOM) for (let r = 0; r < Math.min(w, hh) / 2; r += u) px(g, 'rgba(120,90,40,0.25)', r, r, w - 2 * r, 1); }), parent: 'head', rot: [0.06, 0, 0],
          extra: [box([8, 3, 8], [0, 2.5, 0], faces(tone('#d8b860'), trimBand('#8a3a2a'))), box([1, 1.5, 0.6], [2, 2.5, -4.2], tone('#e8e0a0')), box([1.2, 1, 0.6], [2.8, 3.3, -4.2], tone('#c8402a'))] },
        { name: 'hoe', size: [0.8, 16, 0.8], pivot: [5.5, 12, -1.5], offset: [0, 3, 0], paint: wood, parent: 'armR', extra: [box([0.9, 1.2, 3.5], [0, 11, -1.4], steel), box([1, 1, 1], [0, 10.5, 0], wood)] },
      ],
    },
    shepherd: {
      robe: '#8a6a4a', trim: '#e8e2d4', hair: '#b8b0a0', trousers: '#4a3a2a', eyes: '#4a3a2a',
      extras: () => [
        { name: 'shawl', size: [10, 4, 7], pivot: [0, 23, 0], offset: [0, -1.5, 0], paint: wool('#ece4cf'), parent: 'torso', extra: [box([6, 5, 1.5], [0, -4, -3.5], wool('#ece4cf')), box([1.5, 1.5, 1.2], [0, -1.2, -4.3], tone('#8a5a3a'))] },
        { name: 'crook', size: [1, 19, 1], pivot: [5.5, 12, -1.5], offset: [0, 3.5, 0], paint: wood, parent: 'armR',
          extra: [box([1, 1, 4], [0, 13, -1.5], wood), box([1, 3, 1], [0, 11.5, -3.5], wood), box([1.3, 1.3, 1.3], [0, 12.5, 0], tone('#c8a048'))] },
        beard('#d8d2c4', 6, 3, false),
      ],
    },
    fisher: {
      robe: '#3a5a7a', trim: '#d8c888', hair: '#b8642a', trousers: '#3a3a3a', eyes: '#2a4a6a',
      extras: () => [
        { name: 'cap', size: [9, 3, 9], pivot: [0, 31, 0], offset: [0, 0.5, 0], paint: faces(tone('#2a3a5a'), trimBand('#c8b878')), parent: 'head', extra: [box([9, 1, 3], [0, -0.5, -5.5], tone('#1e2a44')), box([1.5, 1.5, 1.5], [0, 2.5, 0], tone('#c8b878'))] },
        beard('#b8642a', 7, 3.5, true),
        { name: 'pipe', size: [0.8, 0.8, 3], pivot: [-1.8, 24.2, -4.6], offset: [0, 0, -1.4], paint: tone('#5a3a22'), parent: 'head', rot: [0.15, 0.3, 0],
          extra: [box([1.6, 2, 1.6], [0, 0.6, -3.2], faces(tone('#6a4428'), { [TOP]: (g, w, hh) => { px(g, '#2a1a10', 0, 0, w, hh); px(g, '#e86a2a', 0.33, 0.33, 0.67, 0.67); px(g, '#ffc040', 0.33, 0.33, T, T); } }))] },
        { name: 'rod', size: [0.6, 20, 0.6], pivot: [5.5, 12, -1.5], offset: [0, 4, 0], paint: wood, parent: 'armR', rot: [0.5, 0, 0], extra: [box([1.4, 1.4, 1.4], [0.6, 1.5, 0], steel), box([0.2, 8, 0.2], [0, 9.5, -1.8], tone('#e8e8e0', { noise: 0 }), [-0.3, 0, 0])] },
      ],
    },
    butcher: {
      robe: '#8a3a32', trim: '#e8e2d4', hair: null, trousers: '#3a3030', eyes: '#3a2a2a',
      extras: () => [
        { name: 'apron', size: [7, 9, 1], pivot: [0, 11, -2.8], offset: [0, 5, 0], paint: over(spots(tone('#ece8e0'), '#a83a3a', 0.03, 2), (g, w, hh, f) => { if (f === FRONT) { px(g, '#c8c0b0', 0, 0, w, 1); px(g, '#c8c0b0', Math.floor(w / 2), 0, 1, hh); } }), parent: 'torso', extra: [box([7.4, 0.8, 5.4], [0, 3.4, 2.6], tone('#ece8e0'))] },
        { name: 'bandana', size: [8.6, 2.6, 8.6], pivot: [0, 31, 0], offset: [0, -0.6, 0], paint: spots(tone('#b8342a'), '#f0e8d8', 0.08, 1), parent: 'head',
          extra: [box([2, 2, 1.2], [0, -1.6, 4.8], tone('#a02e24')), box([1.2, 3, 0.8], [-0.8, -3.5, 5.2], tone('#a02e24'), [0.3, 0, 0.3]), box([1.2, 3, 0.8], [0.8, -3.5, 5.2], tone('#a02e24'), [0.3, 0, -0.3])] },
        { name: 'mustache', size: [6, 1.2, 1.2], pivot: [0, 25.6, -4.4], offset: [0, 0, 0], paint: fur('#4a2e1e'), parent: 'head', extra: [box([1.2, 2, 1.2], [-3, -0.6, 0], fur('#4a2e1e')), box([1.2, 2, 1.2], [3, -0.6, 0], fur('#4a2e1e'))] },
        { name: 'cleaver', size: [0.6, 3, 3.5], pivot: [-4.5, 12, -2], offset: [0, 0, 0], paint: steel, parent: 'torso', rot: [0, 0, 0.2], extra: [box([0.8, 3, 1], [0, -2.6, 1], wood)] },
      ],
    },
    cleric: {
      robe: '#5a3a7a', trim: '#e8c848', hair: null, trousers: '#3a2a4a', eyes: '#6a4a8a',
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
        { name: 'pendant', size: [2, 3, 1], pivot: [0, 18, -2.8], offset: [0, 0, 0], paint: faces(tone('#f0d050'), { [FRONT]: (g) => { px(g, '#fff4b0', 0.33, 0.33, 0.67, 0.67); px(g, '#8a2a8a', 0.67, 1.33, 0.67, 1); } }), parent: 'torso', extra: [box([4, 0.5, 0.5], [0, 4, 0.2], tone('#c8a830'))] },
        { name: 'staff', size: [0.9, 22, 0.9], pivot: [5.5, 12, -1.5], offset: [0, 4, 0], paint: tone('#e8e0c8'), parent: 'armR', extra: [box([2.4, 2.4, 2.4], [0, 15.5, 0], faces(tone('#b060e0', { top: '#e0a0ff' }), { [FRONT]: (g) => px(g, '#f8e8ff', 0.67, 0.67, 0.67, 0.67) }), [0.6, 0.6, 0]), box([2, 0.6, 0.6], [0, 14, 0], tone('#e8c848'))] },
      ],
    },
    smith: {
      robe: '#4a4442', trim: '#8a5a2a', hair: '#2a1e18', trousers: '#2e2a28', eyes: '#3a3a3a',
      extras: () => [
        { name: 'apron', size: [7.5, 10, 1], pivot: [0, 11, -2.8], offset: [0, 5, 0], paint: faces(tone('#6a4428'), { [FRONT]: (g, w) => { px(g, '#3a2414', 0, 0, w, 1); px(g, '#8a8a8a', 1, 5, 2, 2); px(g, '#2a1a10', 1.33, 5.33, 1.33, T); px(g, 'rgba(0,0,0,0.3)', 3.5, 2, 3, 3); } }), parent: 'torso' },
        { name: 'goggles', size: [9, 2, 1], pivot: [0, 30, -4.4], offset: [0, 0, 0], paint: faces(tone('#6a4a2a'), { [FRONT]: (g) => { px(g, '#b88a3a', 1, 0, 3, 2); px(g, '#b88a3a', 5, 0, 3, 2); px(g, '#5ab8c8', 1.67, 0.33, 1.67, 1.33); px(g, '#5ab8c8', 5.67, 0.33, 1.67, 1.33); px(g, '#d8f8ff', 1.67, 0.33, T, T); px(g, '#d8f8ff', 5.67, 0.33, T, T); } }), parent: 'head' },
        beard('#6a4028', 6, 3, true),
        { name: 'hammer', size: [0.9, 8, 0.9], pivot: [5.5, 12, -1.5], offset: [0, 1, -0.5], paint: wood, parent: 'armR', rot: [1.2, 0, 0], extra: [box([2, 2, 3.5], [0, 5, -0.5], steel)] },
      ],
    },
    librarian: {
      robe: '#2a4a6a', trim: '#e8e0c8', hair: '#8a8a8a', trousers: '#2a2a3a', eyes: '#2a3a5a',
      extras: () => [
        { name: 'cap', size: [7, 3, 7], pivot: [0, 31, 0], offset: [0, 1, 0.5], paint: tone('#6a2a3a'), parent: 'head', extra: [box([1, 1, 1], [0, 2, 0], tone('#e8c848')), box([0.6, 3, 0.6], [0, 0.5, 3.8], tone('#e8c848'), [0.4, 0, 0])] },
        { name: 'book', size: [4, 5, 1.5], pivot: [-5.5, 13, -1.5], offset: [0, 0, -1], paint: faces(tone('#8a2a2a'), { [TOP]: (g, w, h2) => { px(g, '#efe6d2', 0, 0, w, h2); for (let x = 0.33; x < w; x += 0.67) px(g, '#c8bea8', x, 0, T, h2); }, [FRONT]: (g, w, h2) => { px(g, '#e8c848', 0.67, 0.67, w - 1.33, T); px(g, '#e8c848', 0.67, h2 - 1, w - 1.33, T); px(g, '#e8c848', w / 2 - 0.5, 1.67, 1, 1.67); } }), parent: 'armL', rot: [-0.9, 0, 0] },
        { name: 'quill', size: [0.5, 5, 0.5], pivot: [4.2, 28, 1], offset: [0, 1.5, 0], paint: tone('#f4f0e8'), parent: 'head', rot: [0.4, 0, -0.35], extra: [box([0.6, 3, 1.2], [0, 2.5, 0.3], tone('#f4f0e8'))] },
      ],
    },
  };
  const L = looks[profession] ?? looks.farmer;
  const skin = tone(skinC, { noise: 0.03 });
  const face = withFace(skin, (g, w) => {
    if (L.hair) { px(g, shade(L.hair, 0.9), 0.67, 2, 2.33, 0.67); px(g, shade(L.hair, 0.9), w - 3, 2, 2.33, 0.67); }   // brows
    else { px(g, shade(skinC, 0.72), 0.67, 2, 2.33, 0.67); px(g, shade(skinC, 0.72), w - 3, 2, 2.33, 0.67); }
    eye2(g, 1, 3, 2, 1.33, L.eyes, { white: '#f4ece0', look: 0.35 }); eye2(g, w - 3, 3, 2, 1.33, L.eyes, { white: '#f4ece0', look: -0.35 });
    if (profession === 'librarian') { px(g, '#3a3a40', 0.67, 2.67, 2.67, T); px(g, '#3a3a40', 0.67, 4.33, 2.67, T); px(g, '#3a3a40', 0.67, 2.67, T, 2); px(g, '#3a3a40', 3, 2.67, T, 2); px(g, '#3a3a40', w - 3.33, 2.67, 2.67, T); px(g, '#3a3a40', w - 3.33, 4.33, 2.67, T); px(g, '#3a3a40', w - 3.33, 2.67, T, 2); px(g, '#3a3a40', w - 1, 2.67, T, 2); px(g, '#3a3a40', 3.33, 3, w - 6.67, T); }
    px(g, 'rgba(200,80,70,0.3)', 0.33, 5, 1.67, 0.67); px(g, 'rgba(200,80,70,0.3)', w - 2, 5, 1.67, 0.67); // cheeks
    px(g, shade(skinC, 0.75), 2.67, 6, 2.67, T); px(g, '#8a4a3a', 3, 6.33, 2, T);                      // mouth
    px(g, shade(skinC, 0.85), 2.33, 7, 3.33, T);                                                        // chin shadow
  });
  const earP = faces(skin, { [LEFT]: (g, w, hh) => px(g, shade(skinC, 0.8), T, T, w - 2 * T, hh - 2 * T), [RIGHT]: (g, w, hh) => px(g, shade(skinC, 0.8), T, T, w - 2 * T, hh - 2 * T) });
  const robe: Paint = faces(tone(L.robe), {
    [FRONT]: (g, w) => {
      px(g, shade(L.trim, 1), 0, 6, w, 1); px(g, shade(L.trim, 1.15), 0, 6, w, T); px(g, '#3a2a1e', w / 2 - 1, 6, 2, 1); px(g, '#c8a048', w / 2 - T, 6.33, 0.67, T);
      px(g, shade(L.trim, 1), 0, 0, w, 1); px(g, shade(L.robe, 0.75), w / 2 - T / 2, 1, T, 5);
      for (let y = 1.67; y < 6; y += 1.33) px(g, shade(L.trim, 0.9), w / 2 + T, y, 0.67, 0.67);     // buttons
      px(g, shade(L.robe, 0.82), 1, 8, 2, 2); px(g, shade(L.robe, 0.7), 1, 8, 2, T);                 // a pocket
    },
    [BACK]: (g, w) => px(g, shade(L.trim, 1), 0, 6, w, 1), [LEFT]: (g, w) => px(g, shade(L.trim, 1), 0, 6, w, 1), [RIGHT]: (g, w) => px(g, shade(L.trim, 1), 0, 6, w, 1),
  });
  const sleeve = bands([[L.robe, 7], [L.trim, 1], [skinC, 3]]);
  const legs = bands([[L.trousers, 7.67], [shade(L.trousers, 0.8), 0.33], ['#3a2618', 3]]);
  const boot = tone('#3a2618', { top: '#4a3020', bottom: '#1e140c' });
  const parts: PartSpec[] = [
    { name: 'legL', size: [3, 11, 3], pivot: [-2, 11, 0], offset: [0, -5.5, 0], paint: legs, extra: [box([3.4, 3, 3.4], [0, -9.6, 0], boot), box([3.4, 1, 4.4], [0, -10.6, -0.5], tone('#1e140c')), box([3.6, 0.8, 3.6], [0, -7.8, 0], tone('#5a3a24'))] },
    { name: 'legR', size: [3, 11, 3], pivot: [2, 11, 0], offset: [0, -5.5, 0], paint: legs, extra: [box([3.4, 3, 3.4], [0, -9.6, 0], boot), box([3.4, 1, 4.4], [0, -10.6, -0.5], tone('#1e140c')), box([3.6, 0.8, 3.6], [0, -7.8, 0], tone('#5a3a24'))] },
    {
      name: 'torso', size: [8, 12, 5], pivot: [0, 11, 0], offset: [0, 6, 0], paint: robe,
      extra: [box([8.6, 1.4, 5.6], [0, 5.5, 0], faces(tone('#4a3020'), { [FRONT]: (g, w) => { px(g, '#c8a048', w / 2 - 0.67, 0.2, 1.33, 1); px(g, '#4a3020', w / 2 - T / 2, 0.53, T, T); } })), box([2, 2.4, 1.4], [-3, 4, -3], tone('#6a4428')), box([8.4, 1.2, 5.4], [0, 11.6, 0], tone(L.trim))],
    },
    { name: 'head', size: [8, 8, 8], pivot: [0, 23, 0], offset: [0, 4, 0], paint: face, parent: 'torso', extra: [box([0.8, 2, 1.4], [-4.3, 4, 0.5], earP), box([0.8, 2, 1.4], [4.3, 4, 0.5], earP)] },
    { name: 'nose', size: [2, 2.33, 1.2], pivot: [0, 26, -4], offset: [0, 0, -0.5], paint: faces(tone(shade(skinC, 0.94)), { [BOTTOM]: (g, w, hh) => { px(g, shade(skinC, 0.6), T, T, T, hh - 2 * T); px(g, shade(skinC, 0.6), w - 2 * T, T, T, hh - 2 * T); } }), parent: 'head' },
    { name: 'lids', size: [2.2, 1.6, 0.4], pivot: [2, 26.8, -4.15], offset: [0, 0, 0], paint: tone(shade(skinC, 0.9)), parent: 'head', extra: [box([2.2, 1.6, 0.4], [-4, 0, 0], tone(shade(skinC, 0.9)))] },
    { name: 'armL', size: [3, 11, 3], pivot: [-5.5, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso', extra: [box([3.6, 1.2, 3.6], [0, -2.5, 0], tone(L.trim)), box([2.6, 2, 2.6], [0, -11.2, 0], skin)] },
    { name: 'armR', size: [3, 11, 3], pivot: [5.5, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso', extra: [box([3.6, 1.2, 3.6], [0, -2.5, 0], tone(L.trim)), box([2.6, 2, 2.6], [0, -11.2, 0], skin)] },
  ];
  if (L.hair) parts.push({ name: 'hair', size: [8.6, 2, 8.6], pivot: [0, 31, 0], offset: [0, -0.4, 0.2], paint: fur(L.hair, { strand: 0.3 }), parent: 'head', extra: [box([8.4, 5, 1], [0, -3.2, 4.1], fur(L.hair, { strand: 0.3 })), box([1, 3, 5], [-4.2, -2, 1.8], fur(L.hair)), box([1, 3, 5], [4.2, -2, 1.8], fur(L.hair)), box([3, 1, 2], [-1.5, 1, -3.2], fur(L.hair), [0, 0.2, 0.2]), box([2.5, 1, 2], [2, 1, -3], fur(L.hair), [0, -0.3, -0.2])] });
  parts.push(...L.extras());
  return build('villager:' + profession, parts, 0.9);
}

// ---------------------------------------------------------------- Stonewarden
// A mossy stone giant: stacked boulders with glowing amber cracks, a mossy beard and wildflowers on
// its chest, boulder shoulders with moss caps, heavy fists with stubby fingers, knee stones, a
// glowing heart, a heavy brow over ember eyes, and a sapling growing from its head.
function stonewarden(): MobModel {
  const stone = spots(tone('#86867e', { top: '#9a9a92', bottom: '#6a6a64' }), '#5e5e58', 0.05, 2);
  const cracked = over(stone, (g, w, h, f, rand, u) => {
    if (f === TOP || f === BOTTOM) return;
    // Cracks that glow faintly from the heart within.
    for (let k = 0; k < 2; k++) {
      let x = Math.floor(rand() * w), y = Math.floor(rand() * h * 0.3);
      for (let s = 0; s < h * 0.7; s++) { px(g, s % 3 ? '#3a3a34' : '#ffb030', x, y, 1, 1); y++; if (rand() < 0.4) x = Math.max(0, Math.min(w - 1, x + (rand() < 0.5 ? -1 : 1))); if (y >= h) break; }
    }
    void u;
  });
  const mossy: Paint = faces(cracked, {
    [TOP]: (g, w, h, rand) => { for (let i = 0; i < w * h * 1.5; i++) px(g, rand() < 0.5 ? '#4f7a2e' : '#6a9a3a', rand() * w, rand() * h, T, T); },
    [FRONT]: (g, w, _h, rand) => { for (let x = 0; x < w; x += T) if (rand() < 0.5) px(g, rand() < 0.5 ? '#4f7a2e' : '#3e6a24', x, 0, T, 0.67 + rand() * 2.5); },
    [BACK]: (g, w, _h, rand) => { for (let x = 0; x < w; x += T) if (rand() < 0.5) px(g, '#4f7a2e', x, 0, T, 0.67 + rand() * 2.5); },
  });
  const face = withFace(stone, (g, w) => {
    px(g, '#3a3a36', 0, 1.67, w, 2.33); px(g, '#5a5a54', 0, 1.33, w, T);
    glow(g, 1, 2.67, 2, '#ffc040', '#fff0b0'); glow(g, w - 3, 2.67, 2, '#ffc040', '#fff0b0'); px(g, 'rgba(255,190,60,0.4)', 0.67, 3, 2.67, T); px(g, 'rgba(255,190,60,0.4)', w - 3.33, 3, 2.67, T);
    px(g, '#4a4a44', 2, 5, w - 4, 1); px(g, '#2a2a26', 2.33, 5.33, w - 4.67, T);
  });
  const vine = (g: CanvasRenderingContext2D, w: number, h: number, rand: () => number) => { let x = rand() * w; for (let y = 0; y < h; y += T) { px(g, '#3f6a2a', x, y, T, T); if (rand() < 0.1) px(g, '#6a9a3a', x + T, y, 0.67, 0.67); if (rand() < 0.3) x = Math.max(0, Math.min(w - T, x + (rand() < 0.5 ? -T : T))); } };
  const arm = faces(cracked, { [LEFT]: vine, [RIGHT]: vine, [FRONT]: vine });
  const moss = fur('#4f7a2e', { top: '#6a9a3a', strand: 0.35 });
  const flower = (c: string): Paint => faces(tone(c), { [TOP]: (g, w, h) => px(g, '#f8e060', w / 2 - T / 2, h / 2 - T / 2, T, T) });
  const fist = (s: number): Detail[] => [box([7, 6, 7], [0, -21.5, 0], cracked), box([1.6, 2.5, 1.8], [-2.2, -25.2, -2.6], stone), box([1.6, 2.5, 1.8], [0, -25.4, -2.8], stone), box([1.6, 2.5, 1.8], [2.2, -25.2, -2.6], stone), box([1.8, 2.5, 1.8], [3.6 * s, -22.5, -1.5], stone, [0, 0, -0.4 * s])];
  return build('stonewarden', [
    { name: 'legL', size: [6, 15, 6], pivot: [-4.5, 15, 0], offset: [0, -7.5, 0], paint: cracked, extra: [box([6.8, 4, 6.8], [0, -7.5, -0.4], stone), box([7, 2.5, 8], [0, -13.8, -0.8], stone)] },
    { name: 'legR', size: [6, 15, 6], pivot: [4.5, 15, 0], offset: [0, -7.5, 0], paint: cracked, extra: [box([6.8, 4, 6.8], [0, -7.5, -0.4], stone), box([7, 2.5, 8], [0, -13.8, -0.8], stone)] },
    {
      name: 'torso', size: [16, 14, 10], pivot: [0, 15, 0], offset: [0, 7, 0], paint: mossy, rot: [-0.08, 0, 0],
      extra: [
        box([14, 3, 8.6], [0, 0.8, 0], stone), box([12, 6, 1.4], [0, 9, -5.2], cracked),
        ...[[-6, 13.5, -3, '#e8d040'], [5, 13.8, -2, '#d86a8a'], [-3, 14, 3, '#f0f0f0'], [1.5, 14, -3.8, '#8ab8f0'], [6, 13.6, 3, '#f0a040']].map(([x, y, z, c]) => box([1.5, 1.5, 1.5], [x as number, y as number, z as number], flower(c as string))),
        box([0.4, 1.2, 0.4], [-6, 12.6, -3], tone('#4f7a2e')), box([0.4, 1.2, 0.4], [5, 12.9, -2], tone('#4f7a2e')),
      ],
    },
    { name: 'heart', size: [4, 4, 1], pivot: [0, 23, -5.9], offset: [0, 0, 0], paint: faces(tone('#ffb030', { top: '#ffe080' }), { [FRONT]: (g) => { px(g, '#fff0a0', 1, 1, 2, 2); px(g, '#ffffff', 1.33, 1.33, 0.67, 0.67); px(g, '#c87010', 0, 0, 4, T); } }), parent: 'torso' },
    { name: 'shoulderL', size: [7, 6, 8], pivot: [-9, 28, 0], offset: [0, 0.5, 0], paint: mossy, parent: 'torso', extra: [box([6, 1.5, 7], [0, 4, 0], moss), box([3, 3, 3], [-2, 2.5, 2], stone)] },
    { name: 'shoulderR', size: [7, 6, 8], pivot: [9, 28, 0], offset: [0, 0.5, 0], paint: mossy, parent: 'torso', extra: [box([6, 1.5, 7], [0, 4, 0], moss), box([3, 3, 3], [2, 2.5, 2], stone)] },
    { name: 'head', size: [8, 7, 7], pivot: [0, 29, -1], offset: [0, 3, -1.5], paint: face, parent: 'torso', extra: [box([9, 1.6, 2.5], [0, 5.2, -4.4], stone), box([6, 3, 1], [0, -1.2, -5.2], moss), box([2, 4, 1], [-2, -3, -5], moss), box([2, 3, 1], [1.5, -2.5, -5.1], moss)] },
    { name: 'sapling', size: [1, 4, 1], pivot: [1, 36, -1], offset: [0, 2, 0], paint: tone('#6a4a2a'), parent: 'head', extra: [box([4, 3, 4], [0, 5, 0], spots(tone('#4f8a2e'), '#3a6a22', 0.2, 1)), box([2.5, 2, 2.5], [0, 7.2, 0], spots(tone('#5a9a36'), '#3a6a22', 0.2, 1)), box([1.5, 0.4, 2], [1.2, 2.5, 0], tone('#5a9a36'), [0, 0, -0.5])] },
    { name: 'armL', size: [6, 21, 6], pivot: [-11, 26, 0], offset: [0, -10, 0], paint: arm, parent: 'torso', extra: fist(-1) },
    { name: 'armR', size: [6, 21, 6], pivot: [11, 26, 0], offset: [0, -10, 0], paint: arm, parent: 'torso', extra: fist(1) },
  ], 2.1);
}

export const PASSIVE_MODELS: Record<string, (variant?: string) => MobModel> = {
  boar, hen, woolback, burrowfox, bogfrog, cavemoth, streamfish, villager, stonewarden, mossback, bee,
};
