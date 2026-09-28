// Models for hostile creatures. Every design here is original to QubeCraft: shapes and colours
// are chosen to read clearly at a distance and to look like nothing but themselves. Textures are
// painted at high resolution; face details are placed in model pixels, down to a third of one.

import { build, eye2, faces, fillTexels, fur, glow, native, over, px, rgb, scales, shade, speckle, spots, tone, withFace, type Detail, type MobModel, type Paint, type PartSpec } from './models';

type V3 = [number, number, number];
const box = (size: V3, offset: V3, paint: Paint, rot?: V3): Detail => ({ size, offset, paint, rot });
const T = 1 / 3;

/**
 * Two-segment legs for many-legged crawlers: the upper segment rises from the hip to a high knee,
 * the lower one angles down to the ground. `splay` fans front legs forward and back legs backward.
 */
function jointedLegs(zs: number[], o: { hipX: number; hipY: number; upper: number; lower: number; up: number; down: number; thick: number; splay: number; paint: Paint; foot?: Paint; knee?: Paint; hairs?: Paint }): PartSpec[] {
  const out: PartSpec[] = [];
  zs.forEach((z, i) => {
    const fan = (i / Math.max(1, zs.length - 1) - 0.5) * 2 * o.splay;
    for (const s of [-1, 1]) {
      const L = s < 0 ? 'L' : 'R';
      const kneeD: Detail[] = o.knee ? [box([o.thick * 1.35, o.thick * 1.35, o.thick * 1.35], [s * o.upper, 0, 0], o.knee)] : [];
      const hairD: Detail[] = o.hairs ? [box([o.upper * 0.6, 0.3, 0.3], [s * o.upper * 0.5, o.thick * 0.55, 0], o.hairs, [0, 0, s * 0.3]), box([o.upper * 0.4, 0.3, 0.3], [s * o.upper * 0.3, -o.thick * 0.55, 0.3], o.hairs, [0, 0, -s * 0.3])] : [];
      out.push({ name: 'leg' + L + i, size: [o.upper, o.thick, o.thick], pivot: [o.hipX * s, o.hipY, z], offset: [s * o.upper / 2, 0, 0], paint: o.paint, rot: [0, -s * fan, s * o.up], extra: [...kneeD, ...hairD] });
      out.push({ name: 'foot' + L + i, size: [o.lower, o.thick * 0.85, o.thick * 0.85], pivot: [s * (o.hipX + o.upper), o.hipY, z], offset: [s * o.lower / 2, 0, 0], paint: o.foot ?? o.paint, parent: 'leg' + L + i, rot: [0, 0, -s * (o.up + o.down)], extra: [box([o.thick * 0.5, o.thick * 0.5, o.thick * 0.5], [s * o.lower, 0, 0], tone('#e0a030'))] });
    }
  });
  return out;
}

/** Paint a base, then draw on selected faces (0 +x, 1 -x, 2 top, 3 bottom, 4 back, 5 front) in model pixels. */
const onFaces = faces;

/** Horizontal stripes of colours from top to bottom (clothing bands), heights in model pixels. */
function bands(rows: [string, number][], dark = 0.8): Paint {
  // Stripes share out the height in proportion, so they always fill the part.
  const cols = rows.map(([c, n]) => [rgb(c), n] as const);
  const total = rows.reduce((a, r) => a + r[1], 0);
  return native((g, w, h, _f, rand) => {
    const which: number[] = [];
    cols.forEach(([, n], i) => { for (let k = 0; k < Math.round((n / total) * h); k++) which.push(i); });
    fillTexels(g, w, h, (_x, y) => { const c = cols[which[y] ?? cols.length - 1][0], k = rand() < 0.2 ? dark : 1; return [c[0] * k, c[1] * k, c[2] * k]; });
  });
}

/** A stretch of tiny single-texel flecks over a paint. */
const flecks = (base: Paint, colors: string[], density = 0.06): Paint => over(base, (g, w, h, _f, rand) => {
  for (let i = 0; i < w * h * density; i++) px(g, colors[i % colors.length], Math.floor(rand() * w), Math.floor(rand() * h));
});

/** Three stubby fingers hanging from a hand at `y`, spread across a hand `w` wide. */
function fingers(w: number, y: number, paint: Paint, z = -0.6, len = 2): Detail[] {
  return [-1, 0, 1].map((k) => box([w / 3.4, len, w / 3.4], [k * w / 3, y - len / 2, z], paint, [0.15, 0, -k * 0.08]));
}

// ---------------------------------------------------------------- Zombie
// A pallid, bandaged shambler: a torn leather vest over a gash showing ribs, rope-belted rags with a
// dangling flap, one bare foot, a sleeve ripped away at the elbow, grasping fingers, a bandage round
// its head trailing a loose end, wisps of hair, one dull yellow eye and one clouded, and a stitched mouth.
function zombie(): MobModel {
  const skinC = '#8f8a9e';
  const skin = flecks(tone(skinC, { top: '#a09ab0', bottom: '#6e6880', noise: 0.09 }), ['rgba(90,120,70,0.35)', 'rgba(60,50,70,0.35)'], 0.05);
  const face = withFace(skin, (g, w) => {
    px(g, '#3a3444', 0.67, 2.67, 2.67, 2.33); px(g, '#3a3444', w - 3.33, 2.67, 2.67, 2.33);   // sunken sockets
    eye2(g, 1, 3.33, 1.67, 1.33, '#d8d06a', { white: '#b8b8a0', look: 0.4 });
    px(g, '#c8c8c8', w - 2.67, 3.33, 1.67, 1.33); px(g, '#e8e8e8', w - 2.33, 3.67, 0.67, 0.67); // clouded eye
    px(g, '#5e5870', 3.33, 4.67, 1.33, 1);                                                     // nose shadow
    px(g, '#2e2836', 1.67, 6, 4.67, 0.67);
    for (let x = 2; x < 6.2; x += 0.67) px(g, '#c8c0a8', x, 5.67, T, 1.33);                   // stitches across the mouth
    px(g, '#d9d2bc', 0, 0.67, w, 1.33); px(g, '#b8b09a', 0, 0.67, 2, 1.33); px(g, '#a89e84', 0, 1.67, w, T); // bandage across the brow
    px(g, 'rgba(160,40,40,0.5)', 5.33, 0.67, 1, 0.67);
  });
  const vest = onFaces(over(bands([[skinC, 2], ['#5a4030', 7], ['#a88a52', 1], ['#5a4030', 2]]), (g, w, h, _f, rand) => { for (let i = 0; i < w * h * 0.03; i++) px(g, 'rgba(20,10,5,0.4)', Math.floor(rand() * w), Math.floor(rand() * h), 1, 2); }), {
    5: (g, w) => {
      // A torn gash in the vest showing ribs.
      px(g, '#2a2230', w / 2 - 1.67, 2, 3.33, 5); for (let y = 2.67; y < 7; y += 1.33) px(g, '#c8c2b0', w / 2 - 1.33, y, 2.67, T);
      px(g, skinC, w / 2 - 2, 2, T, 5); px(g, '#3a2a1e', 1.67, 5, 0.67, 0.67); px(g, '#3a2a1e', w - 2.33, 7, 0.67, 0.67);
    },
  });
  const arm = bands([['#5a4030', 3], [skinC, 4], ['#d9d2bc', 2], [skinC, 3]]);
  const bareArm = bands([['#5a4030', 3], ['#3a2a1e', 0.67], [skinC, 8.33]]);
  const leg = bands([['#6a6660', 8], ['#55514c', 2], [skinC, 2]]);
  const rope = tone('#a88a52', { top: '#c8aa6a' });
  const hair = fur('#3a3040', { strand: 0.35 });
  return build('zombie', [
    { name: 'legL', size: [4, 12, 4], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: leg, extra: [box([4.4, 2, 5.2], [0, -11, -0.6], tone('#3a2a20')), box([3, 2.5, 1], [0.8, -2, -2.4], tone('#6a6660'), [0.2, 0, 0.2])] },
    { name: 'legR', size: [4, 12, 4], pivot: [2, 12, 0], offset: [0, -6, 0], paint: leg, extra: [box([4, 1.4, 5], [0, -11.3, -0.5], skin), ...[-1.3, 0, 1.3].map((x) => box([1, 0.9, 1.2], [x, -11.5, -3], skin))] },
    {
      name: 'torso', size: [8, 12, 4], pivot: [0, 12, 0], offset: [0, 6, 0], paint: vest, rot: [-0.12, 0, 0],
      extra: [box([8.6, 1, 4.6], [0, 1.6, 0], rope), box([1, 3, 0.6], [2.5, -0.2, -2.3], rope, [0, 0, 0.2]), box([3, 4, 0.6], [-2, -1.5, -2.2], tone('#5a4030'), [0.1, 0, -0.1])],
    },
    {
      name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: face, parent: 'torso', rot: [0.1, 0, 0.12],
      extra: [
        box([8.8, 1.6, 8.8], [0, 5.3, 0], tone('#d9d2bc')), box([1.4, 4, 0.6], [3.5, 2.5, 4.6], tone('#d9d2bc'), [0.3, 0, -0.3]),
        box([1.4, 1.6, 1.2], [-2, 8.4, 1], hair, [0, 0, 0.3]), box([1, 2, 1], [1.5, 8.6, -0.5], hair, [0.2, 0, -0.2]), box([1.2, 1.2, 1.2], [0.5, 8.3, 2.5], hair),
        box([0.8, 2, 1.6], [-4.3, 4, 0.5], skin),
      ],
    },
    { name: 'jaw', size: [6, 2, 1.4], pivot: [0, 26, -4], offset: [0, -1, -0.5], paint: withFace(tone('#7e7890'), (g, w) => { for (let x = 0.33; x < w; x += 0.67) px(g, x % 1.34 < 0.6 ? '#d8d0b0' : '#b8b090', x, 0, T, 0.67); px(g, '#2e2836', 0, 1, w, 1); }), parent: 'head' },
    { name: 'armL', size: [4, 12, 4], pivot: [-6, 22, 0], offset: [0, -5, 0], paint: arm, parent: 'torso', extra: fingers(4, -11, skin) },
    { name: 'armR', size: [4, 12, 4], pivot: [6, 22, 0], offset: [0, -5, 0], paint: bareArm, parent: 'torso', extra: [...fingers(4, -11, skin, -0.6, 2.5), box([4.4, 1.4, 4.4], [0, 0.4, 0], tone('#5a4030'))] },
  ]);
}

// ---------------------------------------------------------------- Skeleton
// A bone archer wrapped in a ragged, hooded wine-red cloak: a proper ribcage, spine and pelvis, knobbly
// knees and elbows, bony fingers and toes, a skull with deep sockets lit by ember glints, cheekbones and
// a cracked crown, a quiver of fletched arrows on its back, and a recurve bow.
function skeleton(): MobModel {
  const boneC = '#ddd6c2';
  const bone = flecks(tone(boneC, { top: '#f0ead8', bottom: '#b8ae94', noise: 0.06 }), ['rgba(120,100,70,0.3)'], 0.04);
  const skull = withFace(bone, (g, w) => {
    px(g, '#1c1612', 0.67, 2.67, 2.67, 2.33); px(g, '#1c1612', w - 3.33, 2.67, 2.67, 2.33);   // deep sockets
    px(g, '#0e0a08', 1, 3, 2, 1.67); px(g, '#0e0a08', w - 3, 3, 2, 1.67);
    px(g, '#e8502a', 2, 3.67, 0.67, 0.67); px(g, '#e8502a', w - 2.67, 3.67, 0.67, 0.67);       // ember glints
    px(g, '#ffc080', 2.33, 3.67, T, T); px(g, '#ffc080', w - 2.33, 3.67, T, T);
    px(g, '#3a3028', 3.33, 5, 0.67, 1.33); px(g, '#3a3028', 4, 5, 0.67, 1.33);                 // nasal hole
    px(g, '#c8bea4', 0.33, 5.33, 1.67, 0.67); px(g, '#c8bea4', w - 2, 5.33, 1.67, 0.67);       // cheekbones
    for (let x = 1; x < w - 1; x += 0.67) px(g, '#3a3028', x, 7, T, 1);                         // teeth
    px(g, '#8a7e64', 5, 0.33, T, 1.67); px(g, '#8a7e64', 5.33, 1.67, T, 1);                    // a crack in the crown
  });
  const cage: Paint = native((g, w, h) => px(g, '#1a1412', 0, 0, w, h));
  const cloth = fur('#6a2430', { top: '#7e3040', bottom: '#44141c', strand: 0.2 });
  const cloak = over(cloth, (g, w, h, _f, rand, u) => {
    // Ragged hem, moth holes and a darker fold down the middle.
    for (let x = 0; x < w; x += u) { const len = Math.floor(rand() * u * 2.5); g.clearRect(x, h - len, u, len); }
    for (let i = 0; i < 3; i++) g.clearRect(Math.floor(rand() * (w - u)), Math.floor(rand() * h * 0.7), u, u);
    px(g, 'rgba(0,0,0,0.25)', Math.floor(w / 2), 0, u, h);
  });
  const limb = tone(boneC, { bottom: '#b8ae94' });
  const knob = tone('#e8e2d0', { top: '#f8f2e0' });
  const hoodPaint = onFaces(cloth, { 5: (g, w, h) => px(g, '#2a0e14', 0, 0, w, h) });
  const bowWood = tone('#7a5a3a', { top: '#9a7a52' });
  const leather = tone('#5a3a24', { top: '#6a4a2e' });
  const ribs: Detail[] = [0, 1, 2, 3].map((i) => box([7 - i * 0.4, 0.7, 3.4], [0, 9.5 - i * 1.6, -0.3], bone));
  return build('skeleton', [
    { name: 'legL', size: [2, 12, 2], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: limb, extra: [box([2.6, 1.6, 2.6], [0, -5.6, 0], knob), box([2.4, 1, 3.6], [0, -11.6, -0.8], bone), box([0.6, 0.6, 1], [-0.7, -11.7, -3], bone), box([0.6, 0.6, 1], [0.7, -11.7, -3], bone)] },
    { name: 'legR', size: [2, 12, 2], pivot: [2, 12, 0], offset: [0, -6, 0], paint: limb, extra: [box([2.6, 1.6, 2.6], [0, -5.6, 0], knob), box([2.4, 1, 3.6], [0, -11.6, -0.8], bone), box([0.6, 0.6, 1], [-0.7, -11.7, -3], bone), box([0.6, 0.6, 1], [0.7, -11.7, -3], bone)] },
    {
      name: 'torso', size: [7, 12, 3], pivot: [0, 12, 0], offset: [0, 6, 0], paint: cage,
      extra: [
        ...ribs, box([1.4, 12, 1.4], [0, 6, 1], bone), box([1, 6, 0.8], [0, 7.5, -1.9], bone),
        box([6, 2, 3], [0, 0.5, 0], bone), box([5, 2, 3], [0, 11.5, 0], tone('#c8bea4')),
      ],
    },
    { name: 'mantle', size: [10, 2.5, 6], pivot: [0, 24, 0], offset: [0, -1, 0.3], paint: cloth, parent: 'torso' },
    { name: 'cloak', size: [10, 16, 1], pivot: [0, 24, 2.8], offset: [0, -8, 0], paint: cloak, parent: 'torso', rot: [-0.06, 0, 0] },
    {
      // A quiver slung across the back, bristling with fletched arrows.
      name: 'quiver', size: [2.6, 8, 2.6], pivot: [-1.5, 19, 4.2], offset: [0, -2, 0], paint: onFaces(leather, { 5: (g, w, h) => { px(g, '#8a6a3a', 0, 1, w, T); px(g, '#8a6a3a', 0, h - 1.5, w, T); } }), parent: 'torso', rot: [0.15, 0, 0.45],
      extra: [[-0.6, 0], [0.5, 0.4], [0, -0.6]].flatMap(([x, z]) => [box([0.4, 3, 0.4], [x, 3.5, z], tone('#8a6a3a')), box([0.8, 1.4, 0.3], [x, 5.4, z], tone('#e8e0d0'))]),
    },
    { name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: skull, parent: 'torso' },
    { name: 'jaw', size: [6, 1.5, 1.2], pivot: [0, 25.6, -4], offset: [0, -0.75, -0.4], paint: withFace(bone, (g, w) => { for (let x = 0; x < w; x += 0.67) px(g, '#3a3028', x, 0, T, 0.67); }), parent: 'head', extra: [box([6, 1.6, 4], [0, -0.8, 1.8], bone)] },
    {
      name: 'hood', size: [9.4, 1.4, 9.4], pivot: [0, 32, 0], offset: [0, 0.7, 0], paint: cloth, parent: 'head',
      extra: [
        box([9.4, 8, 1.4], [0, -3.6, 4.3], cloth),
        box([1.4, 8, 8.4], [-4.3, -3.6, 0.3], hoodPaint),
        box([1.4, 8, 8.4], [4.3, -3.6, 0.3], hoodPaint),
        box([3, 3, 3], [0, 0.2, 5.2], cloth, [-0.7, 0, 0]),
        box([2, 2.5, 2], [0, 0.6, 6.8], cloth, [-1.1, 0, 0]),
      ],
    },
    { name: 'armL', size: [2, 12, 2], pivot: [-5, 22, 0], offset: [0, -5, 0], paint: limb, parent: 'torso', extra: [box([2.6, 1.6, 2.6], [0, -4.6, 0], knob), ...fingers(2, -11.2, bone, -0.3, 1.6)] },
    { name: 'armR', size: [2, 12, 2], pivot: [5, 22, 0], offset: [0, -5, 0], paint: limb, parent: 'torso', extra: [box([2.6, 1.6, 2.6], [0, -4.6, 0], knob), ...fingers(2, -11.2, bone, -0.3, 1.6)] },
    {
      // A recurve bow held at the grip: limbs bend back toward the string, with tips curling forward.
      name: 'bow', size: [1.2, 1.6, 1.6], pivot: [5, 11.5, 0], offset: [0, 0, 0], paint: tone('#4a2e1e'), parent: 'armR',
      extra: [
        box([0.9, 0.9, 5.5], [0, 0.7, -3.4], bowWood, [0.38, 0, 0]),
        box([0.9, 0.9, 5.5], [0, 0.7, 3.4], bowWood, [-0.38, 0, 0]),
        box([0.8, 0.8, 1.6], [0, 2.7, -6.4], bowWood, [-0.5, 0, 0]),
        box([0.8, 0.8, 1.6], [0, 2.7, 6.4], bowWood, [0.5, 0, 0]),
        box([0.3, 0.3, 12.4], [0, 1.9, 0], tone('#d8d0c0')),
        box([1.4, 1.2, 1.8], [0, 0, 0], tone('#c8a060')),
      ],
    },
  ]);
}

// ---------------------------------------------------------------- Witch
// A hedge-witch: plum dress with stitched patches, a green shawl, striped stockings, a long crooked
// nose with a wart, round brass spectacles, long grey hair, knobbly fingers, a satchel of vials, and a
// tall crooked hat with a feather and a sprig of herbs.
function witch(): MobModel {
  const skinC = '#d4bf9c';
  const skin = tone(skinC, { noise: 0.03 });
  const face = withFace(skin, (g, w) => {
    for (const x of [0, w - 4]) {   // round brass spectacles
      px(g, '#b8943a', x + 0.67, 2, 2.67, 0.67); px(g, '#b8943a', x + 0.67, 5, 2.67, 0.67); px(g, '#b8943a', x, 2.67, 0.67, 2.33); px(g, '#b8943a', x + 3.33, 2.67, 0.67, 2.33);
      px(g, '#cfe8e0', x + 0.67, 2.67, 2.67, 2.33);
      eye2(g, x + 1, 3, 2, 1.67, '#3a5a2a', { white: '#f4ecd8', look: x === 0 ? 0.6 : -0.6 });
      px(g, 'rgba(255,255,255,0.55)', x + 0.67, 2.67, 0.67, T);
    }
    px(g, '#b8943a', 4, 3, w - 8, T);                  // bridge
    px(g, '#6a2e3a', 1.67, 6.33, 4.67, 0.67); px(g, '#6a2e3a', 5.33, 7, 1, 0.67); px(g, '#f4ecd8', 2.33, 6.33, 0.67, T); // crooked grin with a tooth
    px(g, '#5a3a2a', 6, 5.67, 0.67, 0.67);             // mole
    px(g, shade(skinC, 0.88), 0, 1, 2, 0.67); px(g, shade(skinC, 0.88), w - 2, 1, 2, 0.67);
  });
  const plum = '#4e3a5e';
  const dress: Paint = over(fur(plum, { top: '#5e4a6e', bottom: '#3a2a46', strand: 0.12 }), (g, w, h, f, rand, u) => {
    if (f === 2 || f === 3) return;
    for (let i = 0; i < 2; i++) {   // a couple of stitched patches
      const x = Math.floor(rand() * (w - 3 * u)), y = Math.floor(rand() * (h - 3 * u)), c = rand() < 0.5 ? '#5a6a3a' : '#7a5a3a';
      px(g, c, x, y, 3 * u, 3 * u);
      for (let k = 0; k < 3 * u; k += 2) { px(g, '#e8dcc0', x + k, y, 1, 1); px(g, '#e8dcc0', x + k, y + 3 * u - 1, 1, 1); }
    }
  });
  const bodice = over(dress, (g, w, h, f, _r, u) => { if (f !== 2 && f !== 3) { px(g, '#3a2418', 0, h - 3 * u, w, u); if (f === 5) px(g, '#c8a040', Math.floor(w / 2) - u, h - 3 * u, 2 * u, u); } });
  const shawl = over(fur('#5a6a3a', { top: '#6a7a44', strand: 0.2 }), (g, w, h, f, _r, u) => { if (f !== 2) for (let x = 0; x < w; x += 2 * u) px(g, '#3a4a24', x, h - u, u, u); });
  const hatC = '#2e2436';
  const hat = fur(hatC, { top: '#3e3248', strand: 0.12 });
  const hatBand = onFaces(hat, { 0: (g, w, h) => px(g, '#7a2a3a', 0, h - 2, w, 2), 1: (g, w, h) => px(g, '#7a2a3a', 0, h - 2, w, 2), 4: (g, w, h) => px(g, '#7a2a3a', 0, h - 2, w, 2), 5: (g, w, h) => { px(g, '#7a2a3a', 0, h - 2, w, 2); px(g, '#c8a040', w / 2 - 1, h - 2, 2, 2); px(g, hatC, w / 2 - 0.33, h - 1.33, 0.67, 0.67); } });
  const hair = fur('#c8c4bc', { top: '#dcd8d0', strand: 0.3 });
  const stocking = bands([['#3a2a3a', 1], ['#8a7a4a', 1], ['#3a2a3a', 1], ['#8a7a4a', 1], ['#3a2a3a', 1], ['#8a7a4a', 1], ['#3a2a3a', 1]], 0.96);
  const boot = tone('#2a1e1a', { top: '#3a2a22' });
  const sleeve = bands([[plum, 7], ['#5a6a3a', 1], [skinC, 2]]);
  const glass = onFaces(speckle('#9a4ad8', '#7a2ab8', '#c08af0', 0.3), { 2: (g, w, h) => px(g, '#6a3ac0', 0, 0, w, h) });
  const vial = (c: string) => onFaces(tone(c, { top: shade(c, 1.3) }), { 5: (g) => px(g, 'rgba(255,255,255,0.6)', T, T, T, 1) });
  return build('witch', [
    { name: 'legL', size: [3, 7, 3], pivot: [-2, 7, 0], offset: [0, -3.5, 0], paint: stocking, extra: [box([3.4, 1.6, 4.5], [0, -6.3, -0.7], boot), box([2, 1.4, 1.5], [0, -5.6, -3.2], boot, [-0.5, 0, 0]), box([1, 1, 1], [0, -4.8, -4], boot, [-0.9, 0, 0])] },
    { name: 'legR', size: [3, 7, 3], pivot: [2, 7, 0], offset: [0, -3.5, 0], paint: stocking, extra: [box([3.4, 1.6, 4.5], [0, -6.3, -0.7], boot), box([2, 1.4, 1.5], [0, -5.6, -3.2], boot, [-0.5, 0, 0]), box([1, 1, 1], [0, -4.8, -4], boot, [-0.9, 0, 0])] },
    { name: 'skirt', size: [11, 6, 8], pivot: [0, 8, 0], offset: [0, -2.5, 0], paint: dress, extra: [box([12, 1.2, 9], [0, -5, 0], fur('#3a2a46', { strand: 0.2 }))] },
    { name: 'torso', size: [9, 11, 6], pivot: [0, 7, 0], offset: [0, 5.5, 0], paint: bodice, extra: [box([9.6, 1.2, 6.6], [0, 3.2, 0], tone('#3a2418')), box([1.2, 1.6, 1.2], [-3, 2.6, -3.4], vial('#58c878')), box([1.2, 1.6, 1.2], [-1.4, 2.6, -3.4], vial('#d8584a')), box([1.2, 1.6, 1.2], [3, 2.6, -3.4], vial('#5a8ae8'))] },
    { name: 'shawl', size: [11, 3.5, 7.5], pivot: [0, 18, 0], offset: [0, -1.2, 0], paint: shawl, parent: 'torso', extra: [box([5, 4, 1], [0, -3.5, -3.5], shawl), box([1.5, 1.5, 1.2], [0, -1, -4], tone('#c8a040'))] },
    {
      name: 'satchel', size: [2.5, 4, 3.5], pivot: [-5.2, 9, 0], offset: [0, 0, 0], paint: tone('#6a4428'), parent: 'torso',
      extra: [box([1.2, 2, 1.2], [0, 2.8, -0.8], vial('#58c878')), box([1.2, 1.6, 1.2], [0, 2.6, 0.9], vial('#d8584a')), box([0.6, 8, 0.6], [2.5, 4.5, 0], tone('#4a2e1e'), [0, 0, -0.5]), box([2.7, 1, 3.7], [0, 1.6, 0], tone('#5a3420'))],
    },
    { name: 'head', size: [8, 8, 8], pivot: [0, 18, 0], offset: [0, 4, 0], paint: face, parent: 'torso', extra: [box([3, 1.5, 2], [0, -0.2, -3.8], skin, [0.2, 0, 0])] },
    // A long crooked nose, hooked at the end, with a wart.
    { name: 'nose', size: [1.6, 1.6, 2.6], pivot: [0, 22, -4], offset: [0, -0.5, -1.2], paint: tone(shade(skinC, 0.95)), parent: 'head', rot: [0.35, 0, 0.06], extra: [box([1.3, 1.3, 1.6], [0.1, -1.1, -2.4], tone(shade(skinC, 0.92)), [0.7, 0, 0]), box([0.8, 0.8, 0.8], [0.7, -0.4, -1.6], tone('#8a6a4a'))] },
    { name: 'hairBack', size: [8.6, 11, 1.6], pivot: [0, 26, 3.6], offset: [0, -5.5, 0.4], paint: hair, parent: 'head', extra: [box([1.2, 8, 4], [-4.4, -3.5, -1.8], hair), box([1.2, 8, 4], [4.4, -3.5, -1.8], hair), box([2, 4, 1.2], [-3, -12, 0.2], hair, [0.1, 0, 0.2])] },
    { name: 'hatBrim', size: [15, 1, 15], pivot: [0, 26, 0], offset: [0, 0.5, 0], paint: hat, parent: 'head', rot: [0.06, 0, -0.07] },
    { name: 'hatMid', size: [8, 4, 8], pivot: [0, 26.5, 0], offset: [0, 2, 0], paint: hatBand, parent: 'hatBrim', extra: [box([1, 3, 1], [-3.6, 1.6, -3.2], spots(tone('#5a8a3a'), '#e8d848', 0.2, 1), [0.2, 0, 0.3]), box([1.4, 1.4, 1.4], [-3.4, 3.2, -3.4], tone('#e878a8'))] },
    { name: 'feather', size: [0.8, 7, 1.8], pivot: [3.8, 28, 1.5], offset: [0, 3.5, 0], paint: bands([['#e8a040', 2], ['#c8482a', 1], ['#e8a040', 2], ['#3a2418', 1], ['#c8482a', 2]]), parent: 'hatMid', rot: [0.35, 0, -0.45] },
    { name: 'hatTop', size: [6, 4, 6], pivot: [0, 30.5, 0], offset: [0, 2, 0], paint: hat, parent: 'hatMid', rot: [-0.22, 0, 0.08] },
    { name: 'hatTip', size: [3.6, 4, 3.6], pivot: [0, 34.5, 0], offset: [0, 2, 0], paint: hat, parent: 'hatTop', rot: [-0.45, 0, 0.12], extra: [box([2, 3, 2], [0, 4.6, 0.4], hat, [-0.5, 0, 0]), box([1.2, 1.2, 1.2], [0, 6.4, 1.8], tone('#c8a040'))] },
    { name: 'armL', size: [3, 10, 3], pivot: [-6, 17.5, 0], offset: [0, -4.5, 0], paint: sleeve, parent: 'torso', extra: [box([3.8, 2, 3.8], [0, -6.5, 0], tone(plum)), ...fingers(3, -10.2, skin, -0.4, 1.8)] },
    { name: 'armR', size: [3, 10, 3], pivot: [6, 17.5, 0], offset: [0, -4.5, 0], paint: sleeve, parent: 'torso', extra: [box([3.8, 2, 3.8], [0, -6.5, 0], tone(plum)), ...fingers(3, -10.2, skin, -0.4, 1.8)] },
    { name: 'flask', size: [3, 3, 3], pivot: [6, 7.5, -1], offset: [0, -2, 0], paint: glass, parent: 'armR', extra: [box([1.4, 1.5, 1.4], [0, 0.2, 0], tone('#b8a8d8')), box([1.2, 1, 1.2], [0, 1.2, 0], tone('#8a6a3a'))] },
  ]);
}

// ---------------------------------------------------------------- Blastcap
// A squat, spotted mushroom creature: a cap studded with raised warts, pale gills underneath, a ragged
// ring round its stalk, a cross little face, stubby feet, and a smouldering fuse on top that flares as
// it swells to burst.
function blastcap(): MobModel {
  const stalk = tone('#e6dcc6', { top: '#f2ead8', bottom: '#c4b494' });
  const face = withFace(stalk, (g, w) => {
    px(g, '#3a2418', 0.67, 1.33, 2.67, 0.67); px(g, '#3a2418', w - 3.33, 1.33, 2.67, 0.67);  // cross brows
    eye2(g, 1, 2, 2, 2, '#1a1410', { pupil: '#0a0806' }); eye2(g, w - 3, 2, 2, 2, '#1a1410', { pupil: '#0a0806' });
    px(g, '#3a2418', w / 2 - 1, 5, 2, 1.33); px(g, '#8a3a2a', w / 2 - 0.67, 5.67, 1.33, 0.67);   // little round mouth
    px(g, '#e8a898', 0, 4.33, 1.33, 0.67); px(g, '#e8a898', w - 1.33, 4.33, 1.33, 0.67);         // blush
  });
  const spotted = over(tone('#d8582a', { top: '#e8703a', bottom: '#a8381a' }), (g, w, h, f, rand, u) => {
    if (f === 3) { // gills underneath
      px(g, '#b8a888', 0, 0, w, h);
      for (let x = 0; x < w; x += u) px(g, '#8a7a5e', x, 0, 1, h);
      return;
    }
    const n = Math.max(2, Math.floor((w * h) / (14 * u * u)));
    for (let i = 0; i < n; i++) { const x = Math.floor(rand() * (w - u)), y = Math.floor(rand() * (h - u)), s = u * (1 + Math.floor(rand() * 2)); px(g, '#f4ecd8', x, y, s, f === 2 ? s : Math.ceil(s * 0.7)); px(g, '#fffaf0', x, y, Math.ceil(s / 2), 1); }
  });
  const wart = tone('#f4ecd8', { top: '#fffaf0' });
  const foot = tone('#cfc2a6', { bottom: '#a89a7c' });
  return build('blastcap', [
    { name: 'legFL', size: [3, 3, 3], pivot: [-2.5, 3, -2], offset: [0, -1.5, 0], paint: foot, extra: [box([3.3, 1, 3.8], [0, -2.6, -0.3], tone('#b8aa8a'))] },
    { name: 'legFR', size: [3, 3, 3], pivot: [2.5, 3, -2], offset: [0, -1.5, 0], paint: foot, extra: [box([3.3, 1, 3.8], [0, -2.6, -0.3], tone('#b8aa8a'))] },
    { name: 'legBL', size: [3, 3, 3], pivot: [-2.5, 3, 2], offset: [0, -1.5, 0], paint: foot },
    { name: 'legBR', size: [3, 3, 3], pivot: [2.5, 3, 2], offset: [0, -1.5, 0], paint: foot },
    { name: 'torso', size: [8, 8, 7], pivot: [0, 3, 0], offset: [0, 4, 0], paint: face, extra: [box([9.5, 1.2, 8.5], [0, 6.6, 0], faces(tone('#e0d4bc'), { 3: (g, w, h) => px(g, '#c8b898', 0, 0, w, h) })), box([10, 1, 9], [0, 6, 0], tone('#d8ccb0'), [0.05, 0, 0.05])] },
    { name: 'cap', size: [15, 5, 15], pivot: [0, 11, 0], offset: [0, 2, 0], paint: spotted, parent: 'torso', extra: [[-5, 5], [4, -5], [6, 3], [-3, -6], [0, 6]].map(([x, z]) => box([1.6, 0.8, 1.6], [x, 4.8, z], wart)) },
    { name: 'capTop', size: [10, 3, 10], pivot: [0, 15.5, 0], offset: [0, 1, 0], paint: spotted, parent: 'cap', extra: [box([1.6, 0.8, 1.6], [2, 2.8, 1], wart), box([1.6, 0.8, 1.6], [-2.5, 2.8, -2], wart)] },
    { name: 'fuse', size: [0.8, 2.5, 0.8], pivot: [0, 18.5, 0], offset: [0, 1.2, 0], paint: tone('#3a2a1e'), parent: 'capTop', rot: [0.3, 0, 0.2], extra: [box([1.2, 1.2, 1.2], [0, 2.8, 0], faces(tone('#ffb030', { top: '#fff0a0' }), { 2: (g) => px(g, '#ffffff', 0.33, 0.33, 0.67, 0.67) }))] },
  ], 1);
}

// ---------------------------------------------------------------- Mirewalker
// A hunched bog-dweller: long dangling arms ending in muddy claws, a hood of dripping moss hiding two
// glowing eyes, reeds and a lily pad growing from its back, mud drips, and a cluster of pale glowing
// bog mushrooms on one shoulder.
function mirewalker(): MobModel {
  const mud = flecks(fur('#3e4630', { top: '#4e5a3a', bottom: '#262c1a', strand: 0.22 }), ['rgba(20,24,12,0.5)', 'rgba(110,120,70,0.35)'], 0.05);
  const face = withFace(speckle('#262c1c', '#1c2014'), (g, w) => {
    glow(g, 1, 3, 2, '#d8e050', '#fffcc0'); glow(g, w - 3, 3, 2, '#d8e050', '#fffcc0');
    px(g, 'rgba(216,224,80,0.35)', 0.67, 2.67, 2.67, 1); px(g, 'rgba(216,224,80,0.35)', w - 3.33, 2.67, 2.67, 1);
    px(g, '#101408', 2, 5, w - 4, 0.67); for (let x = 2.33; x < w - 2; x += 1) px(g, '#b8b890', x, 5, T, 0.67);
  });
  const moss: Paint = over(fur('#5a7a32', { top: '#78963e', strand: 0.3 }), (g, w, h, f, rand, u) => { if (f !== 2) for (let x = 0; x < w; x++) if (rand() < 0.4) px(g, '#2c3a18', x, h - 1 - Math.floor(rand() * u * 2), 1, u * 2); });
  const reed = onFaces(speckle('#6a7a3a', '#56662e'), { 2: (g, w, h) => px(g, '#6a4028', 0, 0, w, h) });
  const strand = fur('#4e6a2a', { strand: 0.3 });
  const drip = tone('#2a2a1a', { top: '#3a3a22' });
  const drapes = (s: number): Detail[] => [box([1, 5, 1], [s * 0.8, -12, 1.2], strand), box([1, 3, 1], [-s * 0.6, -13, -1.2], strand), box([1, 4, 1], [s * 1.6, -4, 0], strand), box([0.6, 2, 0.6], [-s * 1.2, -8, 1.6], drip)];
  const claws = (s: number): Detail[] => [-1, 0, 1].map((k) => box([0.8, 3, 0.8], [k * 1, -15, -0.8], tone('#1a1a10', { top: '#3a3a22' }), [0.35, 0, k * 0.15 * s]));
  const glowCap = onFaces(tone('#8ad8e0', { top: '#b8f0f0' }), { 2: (g, w, h) => { px(g, '#e0ffff', w / 2 - T, h / 2 - T, 0.67, 0.67); px(g, '#6ab8c8', 0, 0, w, T); } });
  const lily = onFaces(tone('#4a8a3a', { top: '#5a9a44' }), { 2: (g, w, h) => { px(g, '#3a6a2a', w / 2 - T / 2, 0, T, h / 2); px(g, '#e8a8c8', w / 2 - 0.5, h / 2 - 0.5, 1, 1); } });
  return build('mirewalker', [
    { name: 'legL', size: [4, 10, 4], pivot: [-2.5, 10, 1], offset: [0, -5, 0], paint: speckle('#2c3320', '#1f2717'), extra: [box([4.6, 1.5, 5.4], [0, -9.4, -0.6], tone('#1f2717')), box([0.8, 1.6, 0.8], [1.4, -4, -2.2], drip)] },
    { name: 'legR', size: [4, 10, 4], pivot: [2.5, 10, 1], offset: [0, -5, 0], paint: speckle('#2c3320', '#1f2717'), extra: [box([4.6, 1.5, 5.4], [0, -9.4, -0.6], tone('#1f2717'))] },
    { name: 'torso', size: [10, 11, 6], pivot: [0, 10, 1], offset: [0, 5.5, 0], paint: mud, rot: [-0.38, 0, 0], extra: [box([8, 4, 3], [0, 9, 3.4], mud), box([0.8, 2.5, 0.8], [-3, -0.8, -3.2], drip), box([0.8, 1.8, 0.8], [2.4, -0.4, -3.2], drip)] },
    { name: 'head', size: [8, 7, 7], pivot: [0, 21, 0], offset: [0, 3, -1.5], paint: face, parent: 'torso', rot: [0.3, 0, 0] },
    { name: 'hood', size: [10, 4, 9], pivot: [0, 26, 0], offset: [0, 0, -1], paint: moss, parent: 'head', extra: [box([1, 4, 1], [-4.5, -3.5, -4.5], strand), box([1, 3, 1], [4.5, -3, -4], strand), box([1, 5, 1], [-2, -4, 3.5], strand), box([1, 4, 1], [3, -3.5, 3.5], strand), box([10.4, 1.4, 1.6], [0, -1.4, -5.2], moss), box([0.7, 2.4, 0.7], [-1, -3.4, -5.4], strand), box([0.7, 3, 0.7], [2.2, -3.6, -5.4], strand)] },
    { name: 'armL', size: [3, 15, 3], pivot: [-6.5, 20, 1], offset: [0, -6.5, 0], paint: mud, parent: 'torso', rot: [0.3, 0, 0.08], extra: [...drapes(-1), ...claws(-1)] },
    { name: 'armR', size: [3, 15, 3], pivot: [6.5, 20, 1], offset: [0, -6.5, 0], paint: mud, parent: 'torso', rot: [0.3, 0, -0.08], extra: [...drapes(1), ...claws(1)] },
    {
      // A cluster of pale glowing bog mushrooms on one shoulder.
      name: 'shrooms', size: [1, 2, 1], pivot: [4, 21, 1], offset: [0, 1, 0], paint: tone('#d8e0d0'), parent: 'torso',
      extra: [box([3, 1, 3], [0, 2.3, 0], glowCap), box([1, 1.5, 1], [-1.8, 0.5, 1], tone('#d8e0d0')), box([2, 1, 2], [-1.8, 1.6, 1], glowCap), box([0.8, 2.5, 0.8], [1, 1, -1.2], tone('#d8e0d0')), box([1.6, 0.8, 1.6], [1, 2.6, -1.2], glowCap)],
    },
    { name: 'lily', size: [4, 0.4, 4], pivot: [-3, 22, 2], offset: [0, 0, 0], paint: lily, parent: 'torso', rot: [0.2, 0.4, 0.1] },
    { name: 'reed1', size: [1, 8, 1], pivot: [2, 20, 4], offset: [0, 4, 0], paint: reed, parent: 'torso', rot: [0.25, 0, -0.2], extra: [box([1.4, 2.5, 1.4], [0, 8.4, 0], tone('#6a4028'))] },
    { name: 'reed2', size: [1, 6, 1], pivot: [-2, 19, 4], offset: [0, 3, 0], paint: reed, parent: 'torso', rot: [0.15, 0, 0.3], extra: [box([2.5, 0.3, 1], [0.8, 4, 0], tone('#6a8a3a'), [0, 0, -0.6])] },
  ]);
}

// ---------------------------------------------------------------- Brambler
// A walking thorn-rose: a body of twisted green stems bristling with thorns, leaves and rosebuds on
// its shoulders, root feet with little toes, a crimson bloom head with sepals below it and glowing
// eyes in the calyx, and petals that flare open when it spits barbs.
function brambler(): MobModel {
  const stem: Paint = over(tone('#3a5a28', { top: '#4a6e32', bottom: '#2a4220', noise: 0.05 }), (g, w, h, f, rand, u) => {
    if (f === 2 || f === 3) return;
    for (let x = 0; x < w; x++) {
      if (rand() < 0.45) { let xx = x; for (let y = 0; y < h; y++) { px(g, rand() < 0.5 ? '#4f7a34' : '#2a4220', xx, y); if (rand() < 0.2) xx = Math.max(0, Math.min(w - 1, xx + (rand() < 0.5 ? -1 : 1))); } }
    }
    for (let i = 0; i < Math.max(1, (w * h) / (18 * u)); i++) { const x = Math.floor(rand() * w), y = Math.floor(rand() * (h - u)); px(g, '#e0d0a8', x, y, 1, u); px(g, '#6a2a1a', x, y + u, 1, 1); }
  });
  const calyx = withFace(scales('#3f6a2a', { edge: '#2a4a1a' }), (g, w) => {
    px(g, '#140c06', 1, 2, w - 2, 2);
    glow(g, 1.67, 2.67, 1.67, '#ffb030', '#ffe080'); glow(g, w - 3.33, 2.67, 1.67, '#ffb030', '#ffe080');
    px(g, 'rgba(255,176,48,0.3)', 1.33, 2.33, 2.33, 1); px(g, 'rgba(255,176,48,0.3)', w - 3.67, 2.33, 2.33, 1);
  });
  const bloom: Paint = over(tone('#b8283a', { top: '#d8384a', bottom: '#7a1624' }), (g, w, h, f, _r, u) => {
    if (f === 2) for (let i = 0; i < w; i += 2 * u) px(g, '#8a1a2a', i, 0, 1, h);      // petal folds
    else for (let x = 0; x < w; x += 3 * u) px(g, '#e85a6a', x, 0, u, 1);
  });
  const petal: Paint = over(tone('#c8303e', { top: '#e04a58', bottom: '#8a1a28' }), (g, w, h, f, _r, u) => { if (f === 2) { px(g, '#f07080', 0, 0, w, u); px(g, 'rgba(120,20,30,0.5)', Math.floor(w / 2), u, 1, h - u); } });
  const thorn = tone('#e0d0a8', { bottom: '#a89878' });
  const thorns = (list: [number, number, number, number, number][]): Detail[] => list.map(([x, y, z, rx, rz]) => box([1, 2.5, 1], [x, y, z], thorn, [rx, 0, rz]));
  const leaf = over(spots(tone('#4f8a2e', { top: '#5a9a38' }), '#3a6a22', 0.15, 1), (g, w, h, f) => { if (f === 2) px(g, '#3a6a22', 0, Math.floor(h / 2), w, 1); });
  const root = tone('#4a3a24', { top: '#5e4a2e' });
  const bud = (s: number): Detail[] => [box([0.6, 2, 0.6], [3.2 * s, 10.5, 0], tone('#3a5a28')), box([1.6, 1.8, 1.6], [3.2 * s, 12.2, 0], tone('#c8303e', { top: '#e04a58' })), box([1.8, 0.8, 1.8], [3.2 * s, 11.3, 0], tone('#3f6a2a'))];
  const toes = (s: number): Detail[] => [box([1.5, 1, 3.5], [-0.6 * s, -9.5, -2], root, [0, 0.4 * s, 0]), box([1.5, 1, 3], [-1.2 * s, -9.5, 1.5], root, [0, -0.5 * s, 0]), box([1, 0.8, 2.5], [0.9 * s, -9.6, -2.2], root, [0, -0.3 * s, 0])];
  return build('brambler', [
    { name: 'legL', size: [3, 10, 3], pivot: [-2, 10, 0], offset: [0, -5, 0], paint: stem, extra: [...toes(1), box([2.5, 0.8, 1.5], [-1.8, -3, 0], leaf, [0, 0, 0.5])] },
    { name: 'legR', size: [3, 10, 3], pivot: [2, 10, 0], offset: [0, -5, 0], paint: stem, extra: toes(-1) },
    {
      name: 'torso', size: [6, 11, 5], pivot: [0, 10, 0], offset: [0, 5.5, 0], paint: stem,
      extra: [...thorns([[-3.3, 8, -1, 0, 1.2], [3.3, 5, 0, 0, -1.2], [-3.3, 3, 1, 0, 1.3], [3.3, 9, 1.5, 0, -1.2], [0, 7, -2.8, -1.3, 0], [1, 2.5, 2.8, 1.3, 0], [-1.5, 9.5, 2.8, 1.2, 0], [2, 4.5, -2.8, -1.2, 0]]), ...bud(-1), ...bud(1), box([2, 0.6, 3], [2.4, 6, -2], leaf, [0.3, 0.4, -0.4])],
    },
    { name: 'leafCollar', size: [9, 1, 8], pivot: [0, 21, 0], offset: [0, 0, 0], paint: leaf, parent: 'torso', extra: [box([4, 1, 3], [-4.5, -0.5, -3], leaf, [0, 0.4, 0.3]), box([4, 1, 3], [4.5, -0.5, 3], leaf, [0, 0.4, -0.3]), box([3, 1, 4], [-3.5, -0.4, 3.5], leaf, [0.3, 0, 0.2])] },
    { name: 'head', size: [8, 7, 8], pivot: [0, 21, 0], offset: [0, 3.5, 0], paint: calyx, parent: 'torso', extra: [[0, -4.2], [0, 4.2], [-4.2, 0], [4.2, 0]].map(([x, z]) => box([2, 3, 2], [x, 6.4, z], tone('#3f6a2a'), [z ? (z < 0 ? 0.5 : -0.5) : 0, 0, x ? (x < 0 ? -0.5 : 0.5) : 0])) },
    { name: 'bloom', size: [7, 3, 7], pivot: [0, 28, 0], offset: [0, 1.5, 0], paint: bloom, parent: 'head', extra: [box([5, 1.5, 5], [0, 3.6, 0], bloom)] },
    { name: 'stamen', size: [2, 2, 2], pivot: [0, 31, 0], offset: [0, 1, 0], paint: onFaces(tone('#f0c040'), { 2: (g) => { px(g, '#fff0a0', 0.33, 0.33, 0.67, 0.67); px(g, '#c89020', 1.33, 1.33, T, T); } }), parent: 'head', extra: [box([0.4, 1.5, 0.4], [-0.6, 1.2, -0.6], tone('#f8e080')), box([0.4, 1.5, 0.4], [0.6, 1.2, 0.6], tone('#f8e080'))] },
    { name: 'petalN', size: [7, 1, 5], pivot: [0, 29, -3.5], offset: [0, 0, -2], paint: petal, parent: 'head', rot: [0.75, 0, 0] },
    { name: 'petalS', size: [7, 1, 5], pivot: [0, 29, 3.5], offset: [0, 0, 2], paint: petal, parent: 'head', rot: [-0.75, 0, 0] },
    { name: 'petalW', size: [5, 1, 7], pivot: [-3.5, 29, 0], offset: [-2, 0, 0], paint: petal, parent: 'head', rot: [0, 0, -0.75] },
    { name: 'petalE', size: [5, 1, 7], pivot: [3.5, 29, 0], offset: [2, 0, 0], paint: petal, parent: 'head', rot: [0, 0, 0.75] },
    { name: 'armL', size: [2, 13, 2], pivot: [-4, 20, 0], offset: [0, -6, 0], paint: stem, parent: 'torso', rot: [0, 0, 0.12], extra: [...thorns([[-1.3, -3, 0, 0, 1.2], [-1.3, -8, 0.5, 0, 1.2], [0, -11, -1.3, -1.2, 0]]), box([3, 1, 4], [-2, -6, 0], leaf, [0, 0, 0.5]), box([1, 3, 1], [-0.4, -13.5, -0.4], stem, [0.4, 0, 0.3]), box([1, 3, 1], [0.4, -13.5, -0.4], stem, [0.4, 0, -0.3])] },
    { name: 'armR', size: [2, 13, 2], pivot: [4, 20, 0], offset: [0, -6, 0], paint: stem, parent: 'torso', rot: [0, 0, -0.12], extra: [...thorns([[1.3, -4, 0, 0, -1.2], [1.3, -9, -0.5, 0, -1.2], [0, -11, -1.3, -1.2, 0]]), box([1, 3, 1], [-0.4, -13.5, -0.4], stem, [0.4, 0, 0.3]), box([1, 3, 1], [0.4, -13.5, -0.4], stem, [0.4, 0, -0.3])] },
  ]);
}

// ---------------------------------------------------------------- Shellcrawler
// A six-legged cave crawler raised on angled, bristly legs under a ridged teal shell with spiked
// segments, a cluster of glowing amber eyes, feelers, and serrated mandibles.
function shellcrawler(): MobModel {
  const shell: Paint = over(scales('#2f6f6a', { edge: '#1a4a46' }), (g, w, h, f, _r, u) => { if (f === 2) for (let x = u; x < w; x += 3 * u) px(g, '#1a3a38', x, 0, 1, h); px(g, 'rgba(140,220,210,0.12)', 0, 0, w, Math.max(1, Math.floor(h / 4))); });
  const head = withFace(speckle('#244a47', '#1a3634'), (g, w) => {
    for (const [x, y, s] of [[1, 1, 1], [w - 2, 1, 1], [2.33, 2, 0.67], [w - 3, 2, 0.67], [3.33, 1, 0.67], [w - 4, 1, 0.67], [2, 3.33, 0.67], [w - 2.67, 3.33, 0.67]]) { px(g, '#8a4a10', x, y, s, s); px(g, '#f0a030', x, y, s * 0.67 || T, s * 0.67 || T); px(g, '#fff0c0', x, y, T, T); }
  });
  const leg = tone('#1e3a38', { top: '#2a4e4a', bottom: '#10221f' });
  const spike = tone('#9ad8d0', { top: '#c8f0e8', bottom: '#4a8a84' });
  const serrated = over(speckle('#d8c8a0', '#b8a880'), (g, w, h, f, _r, u) => { if (f === 0 || f === 1) for (let x = 0; x < w; x += u) px(g, '#6a5a3a', x, h - 1, Math.max(1, Math.floor(u / 2)), 1); });
  const parts: PartSpec[] = [
    { name: 'torso', size: [10, 5, 12], pivot: [0, 6, 2], offset: [0, 0, 0], paint: shell, extra: [box([11, 2, 3], [0, 0.5, -4.5], shell), box([11, 2, 3], [0, 0.5, 0], shell), box([11, 2, 3], [0, 0.5, 4.5], shell)] },
    { name: 'dome', size: [8, 3, 9], pivot: [0, 8.5, 2], offset: [0, 1.5, 0], paint: shell, parent: 'torso', extra: [[-3, -3], [3, -3], [-3, 2], [3, 2], [0, 5], [0, -1]].map(([x, z]) => box([1.2, 2.2, 1.2], [x, 3.8, z], spike, [z > 2 ? 0.4 : 0, 0, x < 0 ? 0.3 : x > 0 ? -0.3 : 0])) },
    { name: 'head', size: [7, 5, 5], pivot: [0, 6, -4], offset: [0, 0, -2.5], paint: head, extra: [box([0.4, 0.4, 5], [-2, 2.4, -6.5], leg, [-0.5, 0.4, 0]), box([0.4, 0.4, 5], [2, 2.4, -6.5], leg, [-0.5, -0.4, 0])] },
    { name: 'mandL', size: [1.2, 1.2, 3.5], pivot: [-2, 4, -9], offset: [0, 0, -1.2], paint: serrated, parent: 'head', rot: [0, 0.4, 0], extra: [box([1, 1, 1.4], [0.5, 0, -3], serrated, [0, 0.9, 0])] },
    { name: 'mandR', size: [1.2, 1.2, 3.5], pivot: [2, 4, -9], offset: [0, 0, -1.2], paint: serrated, parent: 'head', rot: [0, -0.4, 0], extra: [box([1, 1, 1.4], [-0.5, 0, -3], serrated, [0, -0.9, 0])] },
  ];
  const claw = onFaces(tone('#10221f'), { 3: (g, w, h) => px(g, '#e0a030', 0, 0, w, h) });
  parts.push(...jointedLegs([-2, 2, 6], { hipX: 5, hipY: 7, upper: 7, lower: 11, up: 0.55, down: 1.15, thick: 2, splay: 0.45, paint: leg, foot: claw, knee: tone('#2f6f6a'), hairs: tone('#4a8a84') }));
  return build('shellcrawler', parts, 1.5);
}

// ---------------------------------------------------------------- Dune Scuttler
// A sand-coloured scorpion-thing: an armoured body of overlapping plates, a cluster of eyes, broad
// two-part pincers, and a segmented tail curling up to a bulbous red sting with a barb.
function dunescuttler(): MobModel {
  const chitin = tone('#c8a868', { top: '#e0c888', bottom: '#9a7a40' });
  const plates: Paint = over(chitin, (g, w, h, _f, _r, u) => { for (let y = u; y < h; y += 2 * u) { px(g, '#8a6a34', 0, y, w, 1); px(g, '#f0d898', 0, y + 1, w, 1); } });
  const legs = jointedLegs([-2, 0.5, 3], { hipX: 3, hipY: 3, upper: 3.5, lower: 5.5, up: 0.6, down: 1.0, thick: 1, splay: 0.4, paint: chitin, foot: tone('#9a7a40'), knee: tone('#b89858') });
  const eyes = withFace(chitin, (g, w) => { for (const [x, y] of [[1, 1], [w - 1.67, 1], [1.67, 0.33], [w - 2.33, 0.33], [2.33, 1.33]]) { px(g, '#1a1208', x, y, 0.67, 0.67); px(g, '#8a6a34', x + T, y, T, T); } });
  const sting = over(speckle('#b8302a', '#8a2018'), (g, w, h) => px(g, 'rgba(255,200,180,0.4)', 0, 0, w, Math.max(1, Math.floor(h / 4))));
  return build('dunescuttler', [
    { name: 'torso', size: [7, 3, 10], pivot: [0, 3, 0], offset: [0, 1, 0], paint: plates, extra: [box([7.6, 1.2, 2.6], [0, 2.4, -3.2], plates), box([7.8, 1.2, 2.6], [0, 2.4, -0.4], plates), box([7.6, 1.2, 2.6], [0, 2.4, 2.4], plates), box([7, 1.2, 2.4], [0, 2.4, 4.8], plates)] },
    { name: 'head', size: [5, 3, 3], pivot: [0, 4, -5], offset: [0, 0, -1.5], paint: eyes, extra: [box([0.8, 0.8, 1.2], [-1, -1.2, -3.2], tone('#9a7a40'), [0, 0.3, 0]), box([0.8, 0.8, 1.2], [1, -1.2, -3.2], tone('#9a7a40'), [0, -0.3, 0])] },
    { name: 'clawL', size: [3, 2, 4], pivot: [-3.5, 4, -6], offset: [-1, 0, -2], paint: plates, rot: [0, 0.35, 0], extra: [box([3.4, 2.4, 2], [-1, 0, -3.6], chitin)] },
    { name: 'clawR', size: [3, 2, 4], pivot: [3.5, 4, -6], offset: [1, 0, -2], paint: plates, rot: [0, -0.35, 0], extra: [box([3.4, 2.4, 2], [1, 0, -3.6], chitin)] },
    { name: 'tail', size: [2, 2, 5], pivot: [0, 4, 5], offset: [0, 0, 2.5], paint: plates, rot: [-0.9, 0, 0], extra: [box([2.4, 2.4, 1.4], [0, 0, 1], plates), box([2.4, 2.4, 1.4], [0, 0, 3.6], plates)] },
    { name: 'tail2', size: [2, 2, 5], pivot: [0, 4, 10], offset: [0, 0, 2.5], paint: plates, parent: 'tail', rot: [-0.9, 0, 0], extra: [box([2.2, 2.2, 1.4], [0, 0, 1.4], plates), box([2.2, 2.2, 1.4], [0, 0, 3.8], plates)] },
    { name: 'sting', size: [2.4, 2.4, 3], pivot: [0, 4, 15], offset: [0, 0, 1.5], paint: sting, parent: 'tail2', rot: [-0.9, 0, 0], extra: [box([0.8, 0.8, 2.4], [0, -0.6, 3.6], tone('#3a1a14'), [0.9, 0, 0]), box([0.5, 0.5, 1], [0, -1.8, 4.2], tone('#1a0a08'), [1.6, 0, 0])] },
    ...legs,
    { name: 'pincerL', size: [1.5, 1.5, 3], pivot: [-4.5, 4, -9.5], offset: [0, 0, -1], paint: chitin, parent: 'clawL', rot: [0, 0.5, 0], extra: [box([0.8, 0.8, 1.2], [0, 0, -3], tone('#8a6a34'), [0, -0.5, 0])] },
    { name: 'pincerR', size: [1.5, 1.5, 3], pivot: [4.5, 4, -9.5], offset: [0, 0, -1], paint: chitin, parent: 'clawR', rot: [0, -0.5, 0], extra: [box([0.8, 0.8, 1.2], [0, 0, -3], tone('#8a6a34'), [0, 0.5, 0])] },
  ], 0.9);
}

// ---------------------------------------------------------------- Frostling
// A small ice imp: translucent frost panels over a glowing blue core, crystal horns crowning its head,
// an icicle beard, a frost-scarf, icy claws, and shards jutting from its back.
function frostling(): MobModel {
  const ice = over(tone('#b8d8f0', { top: '#e0f0ff', bottom: '#88acd0', noise: 0.08 }), (g, w, h, f, rand, u) => {
    if (f === 3) return;
    // Frost ferns and pale facets.
    for (let k = 0; k < 2; k++) { let x = Math.floor(rand() * w), y = h - 1; for (let s = 0; s < h * 0.6; s++) { px(g, '#f4faff', x, y, 1, 1); if (s % u === 0) { px(g, '#dceeff', x - 1, y, 1, 1); px(g, '#dceeff', x + 1, y, 1, 1); } y--; if (rand() < 0.35) x += rand() < 0.5 ? -1 : 1; } }
  });
  const crystal = speckle('#e8f6ff', '#a8d4f0', '#ffffff', 0.3);
  const face = withFace(ice, (g, w) => {
    px(g, '#1a3a8a', 0.67, 1.67, 2.67, 2.33); px(g, '#1a3a8a', w - 3.33, 1.67, 2.67, 2.33);
    px(g, '#6ac8ff', 1, 2.33, 2, 1.33); px(g, '#6ac8ff', w - 3, 2.33, 2, 1.33); px(g, '#e8faff', 1.33, 2.67, 0.67, 0.67); px(g, '#e8faff', w - 2.67, 2.67, 0.67, 0.67);
    px(g, '#4a7ab8', 2, 5, w - 4, 0.67); for (let x = 2.33; x < w - 2; x += 0.67) px(g, '#e0f4ff', x, 5, T, 0.67);
  });
  const scarf = fur('#4a8ac8', { top: '#6aaae8', strand: 0.15 });
  const core = onFaces(tone('#6ac8ff', { top: '#b8f0ff' }), { 5: (g, w, h) => { px(g, '#e8ffff', w / 2 - 0.5, h / 2 - 0.5, 1, 1); } });
  const claw = tone('#e8f6ff', { top: '#ffffff' });
  return build('frostling', [
    { name: 'legL', size: [2, 7, 2], pivot: [-1.5, 7, 0], offset: [0, -3.5, 0], paint: ice, extra: [box([2.4, 1, 3.2], [0, -6.6, -0.5], crystal)] },
    { name: 'legR', size: [2, 7, 2], pivot: [1.5, 7, 0], offset: [0, -3.5, 0], paint: ice, extra: [box([2.4, 1, 3.2], [0, -6.6, -0.5], crystal)] },
    { name: 'torso', size: [6, 7, 4], pivot: [0, 7, 0], offset: [0, 3.5, 0], paint: ice, rot: [-0.15, 0, 0], extra: [box([2.4, 2.4, 0.6], [0, 3.6, -2.1], core), box([6.6, 1.6, 4.6], [0, 6.2, 0], scarf), box([1.6, 3.5, 0.6], [1.6, 4, -2.4], scarf, [0.2, 0, 0.2])] },
    { name: 'head', size: [7, 6, 6], pivot: [0, 14, 0], offset: [0, 3, 0], paint: face, parent: 'torso' },
    {
      // A ring of ice shards crowning the head, tallest at the front.
      name: 'crown', size: [1.5, 6, 1.5], pivot: [0, 20, -2], offset: [0, 2.5, 0], paint: crystal, parent: 'head', rot: [-0.2, 0, 0],
      extra: [
        box([1.4, 4, 1.4], [-2.3, 1.2, 0.3], crystal, [-0.1, 0, 0.45]), box([1.4, 4, 1.4], [2.3, 1.2, 0.3], crystal, [-0.1, 0, -0.45]),
        box([1.2, 3, 1.2], [-3, 0.6, 2.8], crystal, [0.3, 0, 0.6]), box([1.2, 3, 1.2], [3, 0.6, 2.8], crystal, [0.3, 0, -0.6]),
        box([1.3, 3.5, 1.3], [0, 0.8, 4.2], crystal, [0.5, 0, 0]),
        box([0.8, 2, 0.8], [-1.2, 0, 1.4], crystal, [0.2, 0, 0.3]), box([0.8, 2, 0.8], [1.2, 0, 1.4], crystal, [0.2, 0, -0.3]),
      ],
    },
    { name: 'icicles', size: [1, 2.5, 1], pivot: [0, 14, -3], offset: [0, -1.2, 0], paint: crystal, parent: 'head', extra: [box([1, 1.8, 1], [-2, -0.9, 0], crystal), box([1, 2, 1], [2, -1, 0], crystal), box([0.7, 1.5, 0.7], [-1, -0.7, 0.2], crystal), box([0.7, 2.6, 0.7], [1, -1.3, 0.2], crystal)] },
    { name: 'shard1', size: [2, 6, 2], pivot: [-1.2, 13, 2], offset: [0, 3, 0], paint: crystal, parent: 'torso', rot: [0.6, 0, 0.35] },
    { name: 'shard2', size: [2, 5, 2], pivot: [1.5, 11, 2], offset: [0, 2.5, 0], paint: crystal, parent: 'torso', rot: [0.75, 0, -0.4] },
    { name: 'shard3', size: [1.5, 3.5, 1.5], pivot: [0, 9, 2], offset: [0, 1.7, 0], paint: crystal, parent: 'torso', rot: [1, 0, 0] },
    { name: 'armL', size: [2, 8, 2], pivot: [-4, 13, 0], offset: [0, -4, 0], paint: ice, parent: 'torso', extra: fingers(2, -8, claw, -0.3, 1.8) },
    { name: 'armR', size: [2, 8, 2], pivot: [4, 13, 0], offset: [0, -4, 0], paint: ice, parent: 'torso', extra: fingers(2, -8, claw, -0.3, 1.8) },
  ]);
}

// ---------------------------------------------------------------- Cinderbrute
// A hulking basalt ape: glowing magma veins, a molten crack across its belly, two curved horns, a
// jutting jaw of ember teeth, knuckle spikes and shoulder plates, knuckles near the ground, and a small
// head sunk between its shoulders.
function cinderbrute(): MobModel {
  const basalt: Paint = over(tone('#2e2a2c', { top: '#3e383a', bottom: '#1a1618', noise: 0.12 }), (g, w, h, f, rand, u) => {
    if (f === 3) return;
    for (let k = 0; k < 2; k++) {
      let x = Math.floor(rand() * w);
      for (let y = 0; y < h; y++) { if (rand() < 0.75) { px(g, '#ff7a1a', x, y, 1, 1); if (u > 1 && rand() < 0.3) px(g, '#ffd060', x, y, 1, 1); px(g, 'rgba(255,120,30,0.35)', x - 1, y, 3, 1); } x = Math.max(0, Math.min(w - 1, x + (rand() < 0.5 ? -1 : 1))); }
    }
  });
  const face = withFace(basalt, (g, w) => {
    px(g, '#140e0e', 0, 1, w, 2); glow(g, 1, 1.67, 2, '#ffd060', '#fff0a0'); glow(g, w - 3, 1.67, 2, '#ffd060', '#fff0a0');
    px(g, 'rgba(255,208,96,0.4)', 0.67, 1.33, 2.67, T); px(g, 'rgba(255,208,96,0.4)', w - 3.33, 1.33, 2.67, T);
    px(g, '#140e0e', 1, 4, w - 2, 2); for (let x = 1; x < w - 1; x += 0.67) px(g, (x * 3) % 2 < 1 ? '#ff7a1a' : '#ffb030', x, 4 + ((x * 3) % 2) * 0.67, T, 0.67);
  });
  const spineTip: Paint = over(tone('#2e2a2c', { top: '#ff9a3a', noise: 0.1 }), (g, w, _h, f, _r, u) => { if (f !== 2 && f !== 3) { px(g, '#ff7a1a', 0, 0, w, u); px(g, '#ffd060', 0, 0, u, u); } });
  const horn = over(tone('#1a1618', { top: '#3a3032' }), (g, w, h, _f, _r, u) => { px(g, '#ff9a3a', 0, 0, w, u); for (let y = 2 * u; y < h; y += 2 * u) px(g, '#0e0a0a', 0, y, w, 1); });
  const molten = onFaces(tone('#ff8a2a', { top: '#ffd060' }), { 5: (g, w, h) => { px(g, '#fff0a0', 0.67, h / 2 - 0.33, w - 1.33, 0.67); } });
  const spike = tone('#1a1618', { top: '#ff7a1a' });
  const knuckles = (): Detail[] => [-1.8, 0, 1.8].map((x) => box([1, 1.6, 1], [x, 0.8, -3.2], spike, [-0.6, 0, 0]));
  return build('cinderbrute', [
    { name: 'legL', size: [5, 8, 5], pivot: [-4, 8, 2], offset: [0, -4, 0], paint: basalt, extra: [box([5.6, 2, 6.6], [0, -7.2, -0.6], basalt)] },
    { name: 'legR', size: [5, 8, 5], pivot: [4, 8, 2], offset: [0, -4, 0], paint: basalt, extra: [box([5.6, 2, 6.6], [0, -7.2, -0.6], basalt)] },
    { name: 'torso', size: [14, 11, 9], pivot: [0, 8, 2], offset: [0, 5.5, 0], paint: basalt, rot: [-0.45, 0, 0], extra: [box([6, 2, 0.8], [0, 4, -4.8], molten, [0, 0, 0.1]), box([15, 3, 10], [0, 9.6, 0], basalt), box([4, 3, 8], [-7.5, 10, 0], basalt, [0, 0, 0.3]), box([4, 3, 8], [7.5, 10, 0], basalt, [0, 0, -0.3])] },
    {
      name: 'head', size: [7, 6, 6], pivot: [0, 16, -2], offset: [0, 1, -3], paint: face, parent: 'torso', rot: [0.4, 0, 0],
      extra: [
        box([1.6, 3, 1.6], [-3.4, 4.5, -3], horn, [0.3, 0, 0.6]), box([1.2, 2.5, 1.2], [-4.8, 6.4, -2.4], horn, [0.8, 0, 0.3]),
        box([1.6, 3, 1.6], [3.4, 4.5, -3], horn, [0.3, 0, -0.6]), box([1.2, 2.5, 1.2], [4.8, 6.4, -2.4], horn, [0.8, 0, -0.3]),
        box([6, 2, 3], [0, -2.4, -4.6], face),
      ],
    },
    {
      // A ridge of basalt spines down the back, their tips glowing.
      name: 'spine1', size: [2, 5, 2], pivot: [0, 19, 3], offset: [0, 2.5, 0], paint: spineTip, parent: 'torso', rot: [0.75, 0, 0],
      extra: [{ size: [2, 6, 2], offset: [0, 2, 4], paint: spineTip, rot: [0.2, 0, 0] }, { size: [1.5, 4, 1.5], offset: [0, 0.5, 7.5], paint: spineTip, rot: [0.4, 0, 0] }],
    },
    { name: 'spine2', size: [1.5, 4, 1.5], pivot: [-4, 18, 4], offset: [0, 2, 0], paint: spineTip, parent: 'torso', rot: [0.8, 0, 0.5], extra: [{ size: [1.5, 4, 1.5], offset: [8, 0, 0], paint: spineTip, rot: [0, 0, -1] }] },
    { name: 'armL', size: [5, 16, 5], pivot: [-9.5, 17, 1], offset: [0, -7, 0], paint: basalt, parent: 'torso', rot: [0.4, 0, 0.1], extra: [box([6, 5, 6], [0, -1, 0], basalt)] },
    { name: 'armR', size: [5, 16, 5], pivot: [9.5, 17, 1], offset: [0, -7, 0], paint: basalt, parent: 'torso', rot: [0.4, 0, -0.1], extra: [box([6, 5, 6], [0, -1, 0], basalt)] },
    { name: 'fistL', size: [6, 5, 6], pivot: [-9.5, 2, 1], offset: [0, -1.5, 0], paint: basalt, parent: 'armL', extra: knuckles() },
    { name: 'fistR', size: [6, 5, 6], pivot: [9.5, 2, 1], offset: [0, -1.5, 0], paint: basalt, parent: 'armR', extra: knuckles() },
  ]);
}

// ---------------------------------------------------------------- Emberwisp
// A floating soot-black lantern skull: a ribbed iron cage round a glowing face, a crown of five
// flames, tattered wings on bony struts, embers drifting round it, and a length of chain hanging
// below its burning core.
function emberwisp(): MobModel {
  const soot = tone('#2a2020', { top: '#3a2e2a', bottom: '#140e0e', noise: 0.12 });
  const face = withFace(soot, (g, w) => {
    px(g, '#ffb030', 1, 2, 3, 3); px(g, '#ffb030', w - 4, 2, 3, 3);
    px(g, '#fff0a0', 1.67, 2.67, 1.67, 1.67); px(g, '#fff0a0', w - 3.33, 2.67, 1.67, 1.67); px(g, '#ffffff', 2.33, 3, 0.67, 0.67); px(g, '#ffffff', w - 2.67, 3, 0.67, 0.67);
    px(g, '#ff6a1a', 2, 6, w - 4, 2); for (let x = 2.33; x < w - 2; x += 1) px(g, '#2a2020', x, 6, T, 0.67);
    for (let x = 0; x < w; x += 2) px(g, '#4a3a34', x, 0, T, 9);               // cage bars
  });
  const flame = over(speckle('#ffb030', '#ff7a1a', '#fff0a0', 0.4), (g, w, h) => { px(g, '#fff8d0', Math.floor(w / 3), 0, Math.max(1, Math.floor(w / 3)), Math.floor(h / 3)); });
  const wing: Paint = over(speckle('#4a1e14', '#2a100a'), (g, w, h, _f, rand, u) => { for (let x = 0; x < w; x += 2 * u) g.clearRect(x, h - u - Math.floor(rand() * u * 2), u, h); for (let i = 0; i < 2; i++) g.clearRect(Math.floor(rand() * w), Math.floor(rand() * h * 0.7), u, u); });
  const strut = tone('#d8ccb0', { top: '#f0e8d0' });
  const iron = tone('#4a3a34', { top: '#6a5a50' });
  const ember = tone('#ffd060', { top: '#fff0a0' });
  return build('emberwisp', [
    { name: 'torso', size: [10, 9, 9], pivot: [0, 13, 0], offset: [0, 0, 0], paint: face, extra: [box([10.6, 1, 9.6], [0, 4.6, 0], iron), box([10.6, 1, 9.6], [0, -4.6, 0], iron), box([1, 9, 1], [-5, 0, -4.6], iron), box([1, 9, 1], [5, 0, -4.6], iron), box([1, 9, 1], [-5, 0, 4.6], iron), box([1, 9, 1], [5, 0, 4.6], iron)] },
    { name: 'flame1', size: [2, 5, 2], pivot: [-2.5, 17.5, 0], offset: [0, 2.5, 0], paint: flame, parent: 'torso', rot: [0, 0, 0.2] },
    { name: 'flame2', size: [3, 7, 3], pivot: [0, 17.5, 0.5], offset: [0, 3.5, 0], paint: flame, parent: 'torso', extra: [box([1.4, 3, 1.4], [0, 7.5, 0], ember)] },
    { name: 'flame3', size: [2, 4, 2], pivot: [2.5, 17.5, 0], offset: [0, 2, 0], paint: flame, parent: 'torso', rot: [0, 0, -0.25] },
    { name: 'flame4', size: [1.6, 3.5, 1.6], pivot: [-1, 17.5, 3], offset: [0, 1.8, 0], paint: flame, parent: 'torso', rot: [0.2, 0, 0.1] },
    { name: 'flame5', size: [1.6, 3, 1.6], pivot: [1.5, 17.5, -2.5], offset: [0, 1.5, 0], paint: flame, parent: 'torso', rot: [-0.2, 0, -0.1] },
    { name: 'wingL', size: [1, 7, 10], pivot: [-5.5, 15, 1], offset: [-1, -1, 1], paint: wing, extra: [box([1.2, 1.2, 10], [-0.2, 2.6, 1], strut), box([1, 7, 1], [-0.2, -1, 6], strut, [0.3, 0, 0])] },
    { name: 'wingR', size: [1, 7, 10], pivot: [5.5, 15, 1], offset: [1, -1, 1], paint: wing, extra: [box([1.2, 1.2, 10], [0.2, 2.6, 1], strut), box([1, 7, 1], [0.2, -1, 6], strut, [0.3, 0, 0])] },
    { name: 'jaw', size: [8, 2, 7], pivot: [0, 8.5, 3], offset: [0, -1, -3], paint: withFace(soot, (g, w) => { for (let x = 1; x < w - 1; x += 1.33) px(g, '#ffb030', x, 0, 0.67, 0.67); }), parent: 'torso' },
    { name: 'core', size: [4, 4, 4], pivot: [0, 5, 0], offset: [0, 0, 0], paint: flame, extra: [box([1, 1.4, 0.6], [0, -2.8, 0], iron), box([0.6, 1.4, 1], [0, -4, 0], iron), box([1, 1.4, 0.6], [0, -5.2, 0], iron), box([1.6, 1.6, 1.6], [0, -6.6, 0], iron)] },
    { name: 'embers', size: [1, 1, 1], pivot: [0, 13, 0], offset: [0, 0, 0], paint: ember, extra: [box([0.8, 0.8, 0.8], [6, 3, -3], ember), box([0.6, 0.6, 0.6], [-6.5, 1, 2], ember), box([0.8, 0.8, 0.8], [3, 7, 5], ember), box([0.6, 0.6, 0.6], [-4, 8, -5], ember)] },
  ]);
}

// ---------------------------------------------------------------- Raider
// A road-worn marauder in a quilted slate gambeson with rust stitching, an iron kettle helm and a
// grilled half-mask, a long rust scarf, a bandolier of bolts, leather gloves and boots, and a heavy
// crossbow. Captains carry a tall pennant on their back.
function raider(): MobModel {
  const skinC = '#b89878';
  const face = withFace(tone(skinC, { noise: 0.04 }), (g, w, h) => {
    px(g, '#2a2420', 0.67, 2, w - 1.33, 0.67);                                  // brow shadow under the helm
    eye2(g, 1, 2.67, 2, 1.33, '#c87830', { white: '#f0e0b0', look: 0.3 }); eye2(g, w - 3, 2.67, 2, 1.33, '#c87830', { white: '#f0e0b0', look: -0.3 });
    px(g, '#9a6a4a', w - 2.33, 1.67, T, 2.33);                                   // a scar through one brow
    px(g, '#6a6e72', 0, 4, w, h - 4);                                           // iron half-mask
    px(g, '#8a8e92', 0, 4, w, 0.67); px(g, '#4a4e52', 0, h - 0.67, w, 0.67);
    for (let x = 1; x < w - 1; x += 1) { px(g, '#2a2c30', x, 5, 0.67, 2); px(g, '#9a9ea2', x + 0.67, 5, T, 2); } // breathing grille
    px(g, '#a8acb0', 0.67, 4.67, 0.67, 0.67); px(g, '#a8acb0', w - 1.33, 4.67, 0.67, 0.67);  // rivets
  });
  const quilt: Paint = over(tone('#3e5a5e', { top: '#4a686c', bottom: '#2e4448', noise: 0.06 }), (g, w, h, f, _r, u) => {
    if (f === 2 || f === 3) return;
    for (let y = u; y < h; y += 3 * u) for (let x = ((y / u) % 2) * u; x < w; x += 3 * u) { px(g, '#9a4a2a', x, y, 1, 1); px(g, 'rgba(0,0,0,0.25)', x + 1, y + 1, u, 1); }   // rust stitch diamonds
  });
  const belt: Paint = over(quilt, (g, w, h, f, _r, u) => { if (f !== 2 && f !== 3) { px(g, '#3a2418', 0, h - 3 * u, w, 2 * u); if (f === 5) { px(g, '#b89040', Math.floor(w / 2) - u, h - 3 * u, 2 * u, 2 * u); px(g, '#3a2418', Math.floor(w / 2) - 1, h - 2.5 * u, 2, u); } } });
  const sleeve = bands([['#3e5a5e', 7], ['#9a4a2a', 1], ['#4a3424', 4]]);
  const leg = bands([['#3a3430', 5], ['#8a7a60', 1], ['#3a3430', 1], ['#8a7a60', 1], ['#3a3430', 1], ['#2a1e18', 3]]);
  const iron = tone('#6a6e72', { top: '#8a8e92', bottom: '#4a4e52', noise: 0.05 });
  const scarf = fur('#9a4a2a', { top: '#b05a34', bottom: '#7a3a20', strand: 0.2 });
  const strap = tone('#4a3020', { top: '#5a3a28' });
  const wood = tone('#6a4a2e', { top: '#8a6a44', bottom: '#4a3020' });
  const bolt = tone('#c8c0a8');
  const glove = tone('#4a3020', { top: '#5a3a28' });
  const flag: Paint = over(fur('#8a2e22', { top: '#a03a2a', strand: 0.12 }), (g, w, h, f, _r, u) => {
    if (f === 4 || f === 5) {
      // An original raider sigil: a pale broken ring pierced by a bolt.
      const cx = Math.floor(w / 2), cy = Math.floor(h / 3);
      for (let a = 0; a < 36; a++) { if (a >= 6 && a <= 10) continue; const t = a / 36 * Math.PI * 2; px(g, '#e8dcc0', cx + Math.round(Math.cos(t) * 2.4 * u), cy + Math.round(Math.sin(t) * 2.4 * u), u, u); }
      px(g, '#e8dcc0', cx, cy - 4 * u, u, 9 * u); px(g, '#e8dcc0', cx - u, cy - 4 * u, 3 * u, u);
      for (let x = 0; x < w; x += 2 * u) g.clearRect(x, h - (x % (4 * u) === 0 ? 2 * u : u), u, 2 * u);
    }
  });
  return build('raider', [
    { name: 'legL', size: [4, 12, 4], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: leg, extra: [box([4.6, 4, 4.6], [0, -9.5, 0], glove), box([4.6, 1, 5.6], [0, -11.5, -0.5], tone('#2a1e18')), box([4.8, 0.8, 4.8], [0, -7.2, 0], iron)] },
    { name: 'legR', size: [4, 12, 4], pivot: [2, 12, 0], offset: [0, -6, 0], paint: leg, extra: [box([4.6, 4, 4.6], [0, -9.5, 0], glove), box([4.6, 1, 5.6], [0, -11.5, -0.5], tone('#2a1e18')), box([4.8, 0.8, 4.8], [0, -7.2, 0], iron)] },
    {
      name: 'torso', size: [8, 12, 4.6], pivot: [0, 12, 0], offset: [0, 6, 0], paint: belt,
      extra: [
        box([1.4, 15, 0.8], [0, 6.5, -2.6], strap, [0, 0, 0.62]),                       // bandolier across the chest
        ...[-2.5, -0.8, 0.9, 2.6].map((d): Detail => box([0.6, 2.2, 0.6], [d * 0.8, 6.5 + d * 0.95, -3.1], bolt, [0, 0, 0.62])),
        box([2.6, 3, 1.6], [3.2, 1.5, -1.8], tone('#5a3a24')),                           // belt pouch
        box([9, 2.6, 5.6], [0, 11, 0], iron),                                            // gorget
      ],
    },
    { name: 'scarf', size: [9, 2.2, 5.6], pivot: [0, 24, 0], offset: [0, -1.1, 0], paint: scarf, parent: 'torso' },
    { name: 'scarfTail', size: [2.4, 8, 0.8], pivot: [-2, 23, 2.9], offset: [0, -4, 0.4], paint: scarf, parent: 'torso', rot: [-0.2, 0, 0.1], extra: [box([2.8, 1, 1], [0, -8.2, 0], tone('#6a2a14'))] },
    { name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: face, parent: 'torso' },
    {
      name: 'helm', size: [8.8, 3, 8.8], pivot: [0, 30, 0], offset: [0, 1.5, 0], paint: iron, parent: 'head',
      extra: [box([12, 0.8, 12], [0, -1.2, 0], iron), box([1.2, 1.4, 7], [0, 3.2, 0], tone('#9a4a2a')), box([1.6, 3, 0.6], [0, -2.5, -4.6], iron)],
    },
    { name: 'armL', size: [4, 12, 4], pivot: [-6, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso', extra: [box([4.6, 3, 4.6], [0, -10.4, 0], glove), box([5, 2.4, 5], [0, 1.5, 0], iron)] },
    { name: 'armR', size: [4, 12, 4], pivot: [6, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso', extra: [box([4.6, 3, 4.6], [0, -10.4, 0], glove), box([5, 2.4, 5], [0, 1.5, 0], iron)] },
    {
      // Heavy crossbow gripped at the stock; the prod sits out in front.
      name: 'crossbow', size: [1.6, 1.8, 9], pivot: [6, 11, 0], offset: [0, 0, -2.5], paint: wood, parent: 'armR',
      extra: [
        box([11, 1, 1.2], [0, 0.6, -6.6], iron),                        // prod
        box([0.3, 0.3, 4.2], [-4.2, 0.6, -4.6], tone('#d8d0c0'), [0, 0.95, 0]),
        box([0.3, 0.3, 4.2], [4.2, 0.6, -4.6], tone('#d8d0c0'), [0, -0.95, 0]),
        box([0.6, 0.6, 5], [0, 1.2, -4], bolt),                         // loaded bolt
        box([1.2, 2.4, 1.2], [0, -1.6, 1.6], wood, [0.3, 0, 0]),        // grip
        box([1.8, 1, 1.4], [0, 1, -7.8], iron),                         // stirrup
      ],
    },
    {
      name: 'pennant', size: [0.9, 30, 0.9], pivot: [2.4, 14, 3.2], offset: [0, 15, 0], paint: wood, parent: 'torso', rot: [0.12, 0, -0.08],
      extra: [box([8, 9, 0.4], [-4.4, 24.5, 0], flag), box([1.6, 1.6, 1.6], [0, 30.6, 0], iron)],
    },
  ]);
}

// ---------------------------------------------------------------- Hollow Colossus
// A hovering giant of pale Hollow stone held together by starlight: slab shoulders etched with gold
// constellations, a violet core burning in its chest, a crowned head with one long eye, great fists
// that float free of its forearms, a trail of drifting rubble for legs, and a slowly turning halo of
// shards behind its head.
function colossus(): MobModel {
  const stoneP: Paint = over(tone('#b8aecb', { top: '#d0c8de', bottom: '#8a7ea2', noise: 0.08 }), (g, w, h, f, rand, u) => {
    if (f === 2 || f === 3) return;
    // Seams between slabs, and constellations picked out in gold and joined by fine lines.
    for (let y = 3 * u; y < h; y += 5 * u) { px(g, '#7a6e92', 0, y, w, 1); px(g, '#d8d0e4', 0, y + 1, w, 1); }
    const n = Math.max(2, Math.floor((w * h) / (40 * u * u)));
    let lx = -1, ly = -1;
    for (let i = 0; i < n; i++) {
      const x = u + Math.floor(rand() * (w - 2 * u)), y = u + Math.floor(rand() * (h - 2 * u));
      if (lx >= 0 && Math.hypot(lx - x, ly - y) < 8 * u) { const steps = Math.max(Math.abs(x - lx), Math.abs(y - ly)); for (let k = 1; k < steps; k++) px(g, '#b89a50', Math.round(lx + ((x - lx) * k) / steps), Math.round(ly + ((y - ly) * k) / steps), 1, 1); }
      px(g, '#f0d070', x - 1, y - 1, 3, 3); px(g, '#fff8d0', x, y, 1, 1);
      lx = x; ly = y;
    }
  });
  const dark = tone('#5a4e72', { top: '#6a5e82', bottom: '#40365a' });
  const chest: Paint = over(stoneP, (g, w, h, f) => {
    if (f === 5) {
      // The core, seen through a diamond-shaped opening.
      const cx = w / 2, cy = h * 0.42, s = w / 20;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = (Math.abs(x + 0.5 - cx) + Math.abs(y + 0.5 - cy)) / s;
        if (d < 2) px(g, '#fff0ff', x, y); else if (d < 4) px(g, d < 3 ? '#f0b8ff' : '#d88aff', x, y); else if (d < 5) px(g, '#3a2a5a', x, y);
      }
    }
  });
  const face = withFace(stoneP, (g, w, h) => {
    px(g, '#2a2040', 1, 3, w - 2, 3);               // brow shadow
    px(g, '#5ac8e0', 2, 4, w - 4, 1); px(g, '#8af0ff', 2.33, 4.33, w - 4.67, T);   // the long eye
    px(g, '#e8ffff', w / 2 - 1, 4, 2, 1);
    px(g, '#7a6e92', 3, h - 3, w - 6, 0.67);        // a grim seam of a mouth
    for (let x = 3.33; x < w - 3; x += 1.33) px(g, '#5a4e72', x, h - 2.33, T, 0.67);
  });
  const glowP = tone('#d88aff', { top: '#f4d8ff', bottom: '#a05ad8', noise: 0.03 });
  const gold = tone('#e0b850', { top: '#f0d070', bottom: '#a8842e' });
  const shard = tone('#c8f0ff', { top: '#f0ffff', bottom: '#7ac8e8', noise: 0.03 });
  return build('colossus', [
    {
      name: 'torso', size: [20, 22, 13], pivot: [0, 40, 0], offset: [0, 11, 0], paint: chest,
      extra: [box([22, 4, 15], [0, 2, 0], dark), box([6, 6, 1.5], [0, 12, -7], glowP), box([21, 2, 14], [0, 20.5, 0], gold), box([3, 16, 2], [-7, 11, -6.8], stoneP), box([3, 16, 2], [7, 11, -6.8], stoneP)],
    },
    { name: 'rubble1', size: [13, 7, 10], pivot: [0, 40, 0], offset: [0, -5, 0.5], paint: stoneP, parent: 'torso', extra: [box([4, 4, 4], [6.5, -5, 2], dark, [0.3, 0.4, 0.2])] },
    { name: 'rubble2', size: [9, 6, 7], pivot: [0, 32, 1], offset: [0, -4, 0], paint: stoneP, parent: 'rubble1', extra: [box([3, 3, 3], [-5, -3, -1], stoneP, [0.5, 0.2, 0.4])] },
    { name: 'rubble3', size: [5, 5, 5], pivot: [0, 24, 1.5], offset: [0, -3.5, 0], paint: dark, parent: 'rubble2', extra: [box([2, 2, 2], [2, -4.5, 1], shard, [0.6, 0.6, 0])] },
    {
      name: 'head', size: [12, 11, 11], pivot: [0, 62, -1], offset: [0, 5.5, -0.5], paint: face, parent: 'torso',
      extra: [
        box([13, 1.6, 12], [0, 10.6, -0.5], gold),
        ...[-5, -2.5, 0, 2.5, 5].map((x, i): Detail => box([1.6, i === 2 ? 6 : 4, 1.6], [x, 13 + (i === 2 ? 1 : 0), -5.5], gold)),
        box([1.2, 1.2, 1.2], [0, 17.2, -5.5], shard, [0.78, 0.78, 0]),
        box([13, 3, 1], [0, 1.5, -6.4], stoneP),
      ],
    },
    {
      // The halo: a square of shards turning slowly behind the head.
      name: 'halo', size: [1, 1, 1], pivot: [0, 68, 8], offset: [0, 0, 0], paint: glowP, parent: 'torso',
      extra: [box([22, 1.4, 1], [0, 10, 0], shard), box([22, 1.4, 1], [0, -10, 0], shard), box([1.4, 22, 1], [10, 0, 0], shard), box([1.4, 22, 1], [-10, 0, 0], shard),
        box([3, 3, 1.2], [10, 10, 0], glowP, [0, 0, 0.78]), box([3, 3, 1.2], [-10, 10, 0], glowP, [0, 0, 0.78]), box([3, 3, 1.2], [10, -10, 0], glowP, [0, 0, 0.78]), box([3, 3, 1.2], [-10, -10, 0], glowP, [0, 0, 0.78]),
        box([2, 2, 1], [0, 10, 0], gold, [0, 0, 0.78]), box([2, 2, 1], [0, -10, 0], gold, [0, 0, 0.78]), box([2, 2, 1], [10, 0, 0], gold, [0, 0, 0.78]), box([2, 2, 1], [-10, 0, 0], gold, [0, 0, 0.78])],
    },
    { name: 'shoulderL', size: [11, 7, 14], pivot: [-15, 58, 0], offset: [0, 1, 0], paint: stoneP, parent: 'torso', rot: [0, 0, 0.18], extra: [box([3, 3, 3], [-3, 5, 0], shard, [0.5, 0.5, 0]), box([11.6, 1.2, 14.6], [0, -2.2, 0], gold)] },
    { name: 'shoulderR', size: [11, 7, 14], pivot: [15, 58, 0], offset: [0, 1, 0], paint: stoneP, parent: 'torso', rot: [0, 0, -0.18], extra: [box([3, 3, 3], [3, 5, 0], shard, [0.5, 0.5, 0]), box([11.6, 1.2, 14.6], [0, -2.2, 0], gold)] },
    { name: 'armL', size: [7, 15, 7], pivot: [-15, 56, 0], offset: [0, -8, 0], paint: stoneP, parent: 'torso', extra: [box([7.6, 1.2, 7.6], [0, -12, 0], gold)] },
    { name: 'armR', size: [7, 15, 7], pivot: [15, 56, 0], offset: [0, -8, 0], paint: stoneP, parent: 'torso', extra: [box([7.6, 1.2, 7.6], [0, -12, 0], gold)] },
    { name: 'fistL', size: [11, 11, 11], pivot: [-15, 36, 0], offset: [0, -6, 0], paint: stoneP, parent: 'armL', extra: [box([12, 2, 12], [0, -0.5, 0], gold), ...[-3.6, 0, 3.6].map((x) => box([3, 3, 2], [x, -10, -5.5], stoneP))] },
    { name: 'fistR', size: [11, 11, 11], pivot: [15, 36, 0], offset: [0, -6, 0], paint: stoneP, parent: 'armR', extra: [box([12, 2, 12], [0, -0.5, 0], gold), ...[-3.6, 0, 3.6].map((x) => box([3, 3, 2], [x, -10, -5.5], stoneP))] },
  ], 3);
}

export const HOSTILE_MODELS: Record<string, () => MobModel> = {
  zombie, skeleton, witch, raider, colossus, blastcap, mirewalker, brambler, shellcrawler, dunescuttler, frostling, cinderbrute, emberwisp,
};
