// Models for hostile creatures. Every design here is original to Blockhaven:
// shapes and colours are chosen to read clearly at a distance and to look
// like nothing but themselves.

import { build, fur, scales, shade, speckle, spots, tone, withFace, type Detail, type MobModel, type Paint, type PartSpec } from './models';

type V3 = [number, number, number];
const box = (size: V3, offset: V3, paint: Paint, rot?: V3): Detail => ({ size, offset, paint, rot });

/**
 * Two-segment legs for many-legged crawlers: the upper segment rises from the hip to a high knee,
 * the lower one angles down to the ground. `splay` fans front legs forward and back legs backward.
 */
function jointedLegs(zs: number[], o: { hipX: number; hipY: number; upper: number; lower: number; up: number; down: number; thick: number; splay: number; paint: Paint; foot?: Paint }): PartSpec[] {
  const out: PartSpec[] = [];
  zs.forEach((z, i) => {
    const fan = (i / Math.max(1, zs.length - 1) - 0.5) * 2 * o.splay;
    for (const s of [-1, 1]) {
      const L = s < 0 ? 'L' : 'R';
      out.push({ name: 'leg' + L + i, size: [o.upper, o.thick, o.thick], pivot: [o.hipX * s, o.hipY, z], offset: [s * o.upper / 2, 0, 0], paint: o.paint, rot: [0, -s * fan, s * o.up] });
      out.push({ name: 'foot' + L + i, size: [o.lower, o.thick * 0.85, o.thick * 0.85], pivot: [s * (o.hipX + o.upper), o.hipY, z], offset: [s * o.lower / 2, 0, 0], paint: o.foot ?? o.paint, parent: 'leg' + L + i, rot: [0, 0, -s * (o.up + o.down)] });
    }
  });
  return out;
}

/** Paint a base, then draw on selected faces (0 +x, 1 -x, 2 top, 3 bottom, 4 back, 5 front). */
function faces(base: Paint, draw: Partial<Record<number, (g: CanvasRenderingContext2D, w: number, h: number) => void>>): Paint {
  return (g, w, h, f, rand) => { base(g, w, h, f, rand); draw[f]?.(g, w, h); };
}

/** Horizontal stripes of colours from top to bottom (clothing bands). */
function bands(rows: [string, number][], dark = 0.8): Paint {
  return (g, w, h, _f, rand) => {
    let y = 0;
    for (const [c, n] of rows) {
      for (let k = 0; k < n && y < h; k++, y++) for (let x = 0; x < w; x++) {
        g.fillStyle = rand() < 0.2 ? shade(c, dark) : c;
        g.fillRect(x, y, 1, 1);
      }
    }
    while (y < h) { g.fillStyle = rows[rows.length - 1][0]; g.fillRect(0, y++, w, 1); }
  };
}

const px = (g: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

// ---------------------------------------------------------------- Zombie
// A pallid, bandaged shambler in a torn leather vest and rope-belted rags.
function zombie(): MobModel {
  const skin = tone('#8f8a9e', { top: '#a09ab0', bottom: '#6e6880', noise: 0.09 });
  const face = withFace(skin, (g, w) => {
    px(g, '#3a3444', 1, 3, 2, 2); px(g, '#3a3444', w - 3, 3, 2, 2);          // sunken sockets
    px(g, '#d8d06a', 1, 4); px(g, '#d8d06a', w - 2, 4);                       // dull yellow pupils
    px(g, '#5e5870', 3, 5, 2, 1);                                            // nose shadow
    px(g, '#2e2836', 2, 6, 4, 1); px(g, '#8f8a9e', 3, 6); px(g, '#8f8a9e', 5, 6); // stitched mouth
    px(g, '#d9d2bc', 0, 1, w, 1); px(g, '#b8b09a', 0, 1, 2, 1);               // bandage across the brow
  });
  const vest = faces(bands([['#8f8a9e', 2], ['#5a4030', 7], ['#a88a52', 1], ['#5a4030', 2]]), {
    5: (g, w) => { px(g, '#8f8a9e', Math.floor(w / 2) - 1, 2, 2, 5); px(g, '#3a2a1e', 2, 5); px(g, '#3a2a1e', w - 3, 7); },
  });
  const arm = faces(bands([['#5a4030', 3], ['#8f8a9e', 4], ['#d9d2bc', 2], ['#8f8a9e', 3]]), {});
  const leg = bands([['#6a6660', 8], ['#55514c', 2], ['#8f8a9e', 2]]);
  return build('zombie', [
    { name: 'legL', size: [4, 12, 4], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: leg },
    { name: 'legR', size: [4, 12, 4], pivot: [2, 12, 0], offset: [0, -6, 0], paint: leg },
    { name: 'torso', size: [8, 12, 4], pivot: [0, 12, 0], offset: [0, 6, 0], paint: vest, rot: [-0.12, 0, 0] },
    { name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: face, parent: 'torso', rot: [0.1, 0, 0.12] },
    { name: 'jaw', size: [6, 2, 1.4], pivot: [0, 26, -4], offset: [0, -1, -0.5], paint: withFace(tone('#7e7890'), (g, w) => { for (let x = 0; x < w; x += 2) px(g, '#d8d0b0', x, 0); px(g, '#2e2836', 0, 1, w, 1); }), parent: 'head' },
    { name: 'armL', size: [4, 12, 4], pivot: [-6, 22, 0], offset: [0, -5, 0], paint: arm, parent: 'torso' },
    { name: 'armR', size: [4, 12, 4], pivot: [6, 22, 0], offset: [0, -5, 0], paint: arm, parent: 'torso' },
  ]);
}

// ---------------------------------------------------------------- Skeleton
// A bone archer wrapped in a ragged, hooded wine-red cloak.
function skeleton(): MobModel {
  const bone = tone('#ddd6c2', { top: '#f0ead8', bottom: '#b8ae94', noise: 0.06 });
  const skull = withFace(bone, (g, w) => {
    px(g, '#1c1612', 1, 3, 2, 2); px(g, '#1c1612', w - 3, 3, 2, 2);
    px(g, '#c8402a', 2, 4); px(g, '#c8402a', w - 2, 4);        // ember glints in the sockets
    px(g, '#3a3028', 3, 5, 2, 1);                              // nasal hole
    for (let x = 1; x < w - 1; x += 2) px(g, '#3a3028', x, 7); // teeth
  });
  const ribs: Paint = (g, w, h, f, rand) => {
    px(g, '#241c18', 0, 0, w, h);
    if (f === 5 || f === 4) { for (let y = 1; y < h - 1; y += 2) px(g, '#ddd6c2', 1, y, w - 2, 1); px(g, '#ddd6c2', Math.floor(w / 2) - 1, 0, 2, h); }
    else bone(g, w, h, f, rand);
  };
  const cloth = fur('#6a2430', { top: '#7e3040', bottom: '#44141c', strand: 0.2 });
  const cloak: Paint = (g, w, h, f, rand) => {
    cloth(g, w, h, f, rand);
    // Ragged hem: dark notches along the bottom row.
    for (let x = 0; x < w; x += 2) px(g, '#2a0e14', x, h - 1 - (x % 4 === 0 ? 1 : 0), 1, 2);
  };
  const limb = tone('#ddd6c2', { bottom: '#b8ae94' });
  const hoodPaint = faces(cloth, { 5: (g, w, h) => px(g, '#2a0e14', 0, 0, w, h) });
  const bowWood = tone('#7a5a3a', { top: '#9a7a52' });
  return build('skeleton', [
    { name: 'legL', size: [2, 12, 2], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: limb },
    { name: 'legR', size: [2, 12, 2], pivot: [2, 12, 0], offset: [0, -6, 0], paint: limb },
    { name: 'torso', size: [8, 12, 4], pivot: [0, 12, 0], offset: [0, 6, 0], paint: ribs, extra: [box([5, 2, 3], [0, 0.5, 0], tone('#c8bea4'))] },
    { name: 'mantle', size: [10, 2.5, 6], pivot: [0, 24, 0], offset: [0, -1, 0.3], paint: cloth, parent: 'torso' },
    { name: 'cloak', size: [10, 16, 1], pivot: [0, 24, 2.8], offset: [0, -8, 0], paint: cloak, parent: 'torso', rot: [-0.06, 0, 0] },
    { name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: skull, parent: 'torso' },
    { name: 'jaw', size: [6, 1.5, 1.2], pivot: [0, 25.6, -4], offset: [0, -0.75, -0.4], paint: withFace(bone, (g, w) => { for (let x = 0; x < w; x += 2) px(g, '#3a3028', x, 0); }), parent: 'head' },
    {
      name: 'hood', size: [9.4, 1.4, 9.4], pivot: [0, 32, 0], offset: [0, 0.7, 0], paint: cloth, parent: 'head',
      extra: [
        box([9.4, 8, 1.4], [0, -3.6, 4.3], cloth),
        box([1.4, 8, 8.4], [-4.3, -3.6, 0.3], hoodPaint),
        box([1.4, 8, 8.4], [4.3, -3.6, 0.3], hoodPaint),
        box([3, 3, 3], [0, 0.2, 5.2], cloth, [-0.7, 0, 0]),
      ],
    },
    { name: 'armL', size: [2, 12, 2], pivot: [-5, 22, 0], offset: [0, -5, 0], paint: limb, parent: 'torso' },
    { name: 'armR', size: [2, 12, 2], pivot: [5, 22, 0], offset: [0, -5, 0], paint: limb, parent: 'torso' },
    {
      // A recurve bow held at the grip: limbs bend back toward the string.
      name: 'bow', size: [1.2, 1.6, 1.6], pivot: [5, 11.5, 0], offset: [0, 0, 0], paint: tone('#4a2e1e'), parent: 'armR',
      extra: [
        box([0.9, 0.9, 5.5], [0, 0.7, -3.4], bowWood, [0.38, 0, 0]),
        box([0.9, 0.9, 5.5], [0, 0.7, 3.4], bowWood, [-0.38, 0, 0]),
        box([0.3, 0.3, 11.4], [0, 1.9, 0], tone('#d8d0c0')),
      ],
    },
  ]);
}

// ---------------------------------------------------------------- Witch
// A hedge-witch: plum dress with mossy patches, a green shawl, striped stockings, round brass spectacles,
// long grey hair and a tall crooked hat with a feather and a sprig of herbs.
function witch(): MobModel {
  const skinC = '#d4bf9c';
  const skin = tone(skinC, { noise: 0.03 });
  const face = withFace(skin, (g, w) => {
    for (const x of [0, w - 4]) {   // round brass spectacles
      px(g, '#b8943a', x + 1, 2, 2, 1); px(g, '#b8943a', x + 1, 5, 2, 1); px(g, '#b8943a', x, 3, 1, 2); px(g, '#b8943a', x + 3, 3, 1, 2);
      px(g, '#cfe8e0', x + 1, 3, 2, 2); px(g, '#2a4a2a', x + (x === 0 ? 2 : 1), 4); px(g, '#ffffff', x + (x === 0 ? 1 : 2), 3);
    }
    px(g, '#b8943a', 4, 3, w - 8, 1);                 // bridge
    px(g, shade(skinC, 0.85), 3, 5, 2, 1);            // nose shadow
    px(g, '#6a2e3a', 2, 6, 3, 1); px(g, '#6a2e3a', 5, 7); // crooked grin
    px(g, '#5a3a2a', 6, 6);                           // mole
    px(g, shade(skinC, 0.9), 0, 1, 2, 1); px(g, shade(skinC, 0.9), w - 2, 1, 2, 1);
  });
  const plum = '#4e3a5e';
  const dress: Paint = (g, w, h, f, rand) => {
    fur(plum, { top: '#5e4a6e', bottom: '#3a2a46', strand: 0.12 })(g, w, h, f, rand);
    if (f === 2 || f === 3) return;
    for (let i = 0; i < 2; i++) {   // a couple of stitched patches
      const x = Math.floor(rand() * (w - 3)), y = Math.floor(rand() * (h - 3)), c = rand() < 0.5 ? '#5a6a3a' : '#7a5a3a';
      px(g, c, x, y, 3, 3); px(g, '#2a1e2e', x, y, 3, 1); px(g, 'rgba(255,240,200,0.4)', x + 1, y + 1);
    }
  };
  const bodice = (() => {
    const d = dress;
    return ((g, w, h, f, rand) => { d(g, w, h, f, rand); if (f !== 2 && f !== 3) { px(g, '#3a2418', 0, h - 3, w, 1); if (f === 5) px(g, '#c8a040', Math.floor(w / 2) - 1, h - 3, 2, 1); } }) as Paint;
  })();
  const shawl: Paint = (g, w, h, f, rand) => { fur('#5a6a3a', { top: '#6a7a44', strand: 0.2 })(g, w, h, f, rand); if (f !== 2) for (let x = 0; x < w; x += 2) px(g, '#3a4a24', x, h - 1); };
  const hatC = '#2e2436';
  const hat = fur(hatC, { top: '#3e3248', strand: 0.12 });
  const hatBand = faces(hat, { 0: (g, w, h) => px(g, '#7a2a3a', 0, h - 2, w, 2), 1: (g, w, h) => px(g, '#7a2a3a', 0, h - 2, w, 2), 4: (g, w, h) => px(g, '#7a2a3a', 0, h - 2, w, 2), 5: (g, w, h) => { px(g, '#7a2a3a', 0, h - 2, w, 2); px(g, '#c8a040', Math.floor(w / 2) - 1, h - 2, 2, 2); px(g, hatC, Math.floor(w / 2) - 1 + 0, h - 1); } });
  const hair = fur('#c8c4bc', { top: '#dcd8d0', strand: 0.3 });
  const stocking = bands([['#3a2a3a', 1], ['#8a7a4a', 1]], 0.04);
  const boot = tone('#2a1e1a', { top: '#3a2a22' });
  const sleeve = bands([[plum, 7], ['#5a6a3a', 1], [skinC, 2]]);
  const glass = faces(speckle('#9a4ad8', '#7a2ab8', '#c08af0', 0.3), { 2: (g, w, h) => px(g, '#6a3ac0', 0, 0, w, h) });
  return build('witch', [
    { name: 'legL', size: [3, 7, 3], pivot: [-2, 7, 0], offset: [0, -3.5, 0], paint: stocking, extra: [box([3.4, 1.6, 4.5], [0, -6.3, -0.7], boot), box([2, 1.4, 1.5], [0, -5.6, -3.2], boot, [-0.5, 0, 0])] },
    { name: 'legR', size: [3, 7, 3], pivot: [2, 7, 0], offset: [0, -3.5, 0], paint: stocking, extra: [box([3.4, 1.6, 4.5], [0, -6.3, -0.7], boot), box([2, 1.4, 1.5], [0, -5.6, -3.2], boot, [-0.5, 0, 0])] },
    { name: 'skirt', size: [11, 6, 8], pivot: [0, 8, 0], offset: [0, -2.5, 0], paint: dress },
    { name: 'torso', size: [9, 11, 6], pivot: [0, 7, 0], offset: [0, 5.5, 0], paint: bodice },
    { name: 'shawl', size: [11, 3.5, 7.5], pivot: [0, 18, 0], offset: [0, -1.2, 0], paint: shawl, parent: 'torso', extra: [box([5, 4, 1], [0, -3.5, -3.5], shawl)] },
    {
      name: 'satchel', size: [2.5, 4, 3.5], pivot: [-5.2, 9, 0], offset: [0, 0, 0], paint: tone('#6a4428'), parent: 'torso',
      extra: [box([1.2, 2, 1.2], [0, 2.8, -0.8], tone('#58c878')), box([1.2, 1.6, 1.2], [0, 2.6, 0.9], tone('#d8584a')), box([0.6, 8, 0.6], [2.5, 4.5, 0], tone('#4a2e1e'), [0, 0, -0.5])],
    },
    { name: 'head', size: [8, 8, 8], pivot: [0, 18, 0], offset: [0, 4, 0], paint: face, parent: 'torso' },
    { name: 'hairBack', size: [8.6, 11, 1.6], pivot: [0, 26, 3.6], offset: [0, -5.5, 0.4], paint: hair, parent: 'head', extra: [box([1.2, 8, 4], [-4.4, -3.5, -1.8], hair), box([1.2, 8, 4], [4.4, -3.5, -1.8], hair)] },
    { name: 'hatBrim', size: [15, 1, 15], pivot: [0, 26, 0], offset: [0, 0.5, 0], paint: hat, parent: 'head', rot: [0.06, 0, -0.07] },
    { name: 'hatMid', size: [8, 4, 8], pivot: [0, 26.5, 0], offset: [0, 2, 0], paint: hatBand, parent: 'hatBrim', extra: [box([1, 3, 1], [-3.6, 1.6, -3.2], spots(tone('#5a8a3a'), '#e8d848', 0.2, 1), [0.2, 0, 0.3])] },
    { name: 'feather', size: [0.8, 7, 1.8], pivot: [3.8, 28, 1.5], offset: [0, 3.5, 0], paint: bands([['#e8a040', 2], ['#c8482a', 1], ['#e8a040', 2], ['#3a2418', 1], ['#c8482a', 2]]), parent: 'hatMid', rot: [0.35, 0, -0.45] },
    { name: 'hatTop', size: [6, 4, 6], pivot: [0, 30.5, 0], offset: [0, 2, 0], paint: hat, parent: 'hatMid', rot: [-0.22, 0, 0.08] },
    { name: 'hatTip', size: [3.6, 4, 3.6], pivot: [0, 34.5, 0], offset: [0, 2, 0], paint: hat, parent: 'hatTop', rot: [-0.45, 0, 0.12], extra: [box([2, 3, 2], [0, 4.6, 0.4], hat, [-0.5, 0, 0])] },
    { name: 'armL', size: [3, 10, 3], pivot: [-6, 17.5, 0], offset: [0, -4.5, 0], paint: sleeve, parent: 'torso', extra: [box([3.8, 2, 3.8], [0, -6.5, 0], tone(plum))] },
    { name: 'armR', size: [3, 10, 3], pivot: [6, 17.5, 0], offset: [0, -4.5, 0], paint: sleeve, parent: 'torso', extra: [box([3.8, 2, 3.8], [0, -6.5, 0], tone(plum))] },
    { name: 'flask', size: [3, 3, 3], pivot: [6, 7.5, -1], offset: [0, -2, 0], paint: glass, parent: 'armR', extra: [box([1.4, 1.5, 1.4], [0, 0.2, 0], tone('#b8a8d8')), box([1.2, 1, 1.2], [0, 1.2, 0], tone('#8a6a3a'))] },
  ]);
}

// ---------------------------------------------------------------- Blastcap
// A squat, spotted mushroom creature that swells up and bursts when it gets close.
function blastcap(): MobModel {
  const stalk = tone('#e6dcc6', { top: '#f2ead8', bottom: '#c4b494' });
  const face = withFace(stalk, (g, w) => {
    px(g, '#1a1410', 1, 2, 2, 2); px(g, '#1a1410', w - 3, 2, 2, 2);
    px(g, '#f2ead8', 1, 2); px(g, '#f2ead8', w - 3, 2);
    px(g, '#3a2418', Math.floor(w / 2) - 1, 5, 2, 2);                   // little round mouth
    px(g, '#d8b0a0', 0, 4); px(g, '#d8b0a0', w - 1, 4);                 // blush
  });
  const spotted: Paint = (g, w, h, f, rand) => {
    tone('#d8582a', { top: '#e8703a', bottom: '#a8381a' })(g, w, h, f, rand);
    if (f === 3) { // gills underneath
      px(g, '#b8a888', 0, 0, w, h);
      for (let x = 0; x < w; x += 2) px(g, '#8a7a5e', x, 0, 1, h);
      return;
    }
    const n = Math.max(2, Math.floor((w * h) / 14));
    for (let i = 0; i < n; i++) { const x = Math.floor(rand() * (w - 1)), y = Math.floor(rand() * (h - 1)); px(g, '#f4ecd8', x, y, 2, f === 2 ? 2 : 1); }
  };
  const foot = tone('#cfc2a6', { bottom: '#a89a7c' });
  return build('blastcap', [
    { name: 'legFL', size: [3, 3, 3], pivot: [-2.5, 3, -2], offset: [0, -1.5, 0], paint: foot },
    { name: 'legFR', size: [3, 3, 3], pivot: [2.5, 3, -2], offset: [0, -1.5, 0], paint: foot },
    { name: 'legBL', size: [3, 3, 3], pivot: [-2.5, 3, 2], offset: [0, -1.5, 0], paint: foot },
    { name: 'legBR', size: [3, 3, 3], pivot: [2.5, 3, 2], offset: [0, -1.5, 0], paint: foot },
    { name: 'torso', size: [8, 8, 7], pivot: [0, 3, 0], offset: [0, 4, 0], paint: face },
    { name: 'cap', size: [15, 5, 15], pivot: [0, 11, 0], offset: [0, 2, 0], paint: spotted, parent: 'torso' },
    { name: 'capTop', size: [10, 3, 10], pivot: [0, 15.5, 0], offset: [0, 1, 0], paint: spotted, parent: 'cap' },
  ]);
}

// ---------------------------------------------------------------- Mirewalker
// A hunched bog-dweller: long dangling arms, a hood of dripping moss, reeds growing from its back.
function mirewalker(): MobModel {
  const mud = fur('#3e4630', { top: '#4e5a3a', bottom: '#262c1a', strand: 0.22 });
  const face = withFace(speckle('#262c1c', '#1c2014'), (g, w) => {
    px(g, '#d8e050', 1, 3, 2, 1); px(g, '#d8e050', w - 3, 3, 2, 1);
    px(g, '#101408', 2, 5, w - 4, 1);
  });
  const moss: Paint = (g, w, h, f, rand) => {
    fur('#5a7a32', { top: '#78963e', strand: 0.25 })(g, w, h, f, rand);
    if (f !== 2) for (let x = 0; x < w; x++) if (rand() < 0.4) px(g, '#2c3a18', x, h - 1);
  };
  const reed = faces(speckle('#6a7a3a', '#56662e'), { 2: (g, w, h) => px(g, '#6a4028', 0, 0, w, h) });
  const strand = fur('#4e6a2a', { strand: 0.3 });
  const drapes = (s: number): Detail[] => [box([1, 5, 1], [s * 0.8, -12, 1.2], strand), box([1, 3, 1], [-s * 0.6, -13, -1.2], strand), box([1, 4, 1], [s * 1.6, -4, 0], strand)];
  const glowCap = faces(tone('#8ad8e0', { top: '#b8f0f0' }), { 2: (g, w, h) => px(g, '#e0ffff', Math.floor(w / 2), Math.floor(h / 2)) });
  return build('mirewalker', [
    { name: 'legL', size: [4, 10, 4], pivot: [-2.5, 10, 1], offset: [0, -5, 0], paint: speckle('#2c3320', '#1f2717') },
    { name: 'legR', size: [4, 10, 4], pivot: [2.5, 10, 1], offset: [0, -5, 0], paint: speckle('#2c3320', '#1f2717') },
    { name: 'torso', size: [10, 11, 6], pivot: [0, 10, 1], offset: [0, 5.5, 0], paint: mud, rot: [-0.38, 0, 0] },
    { name: 'head', size: [8, 7, 7], pivot: [0, 21, 0], offset: [0, 3, -1.5], paint: face, parent: 'torso', rot: [0.3, 0, 0] },
    { name: 'hood', size: [10, 4, 9], pivot: [0, 26, 0], offset: [0, 0, -1], paint: moss, parent: 'head', extra: [box([1, 4, 1], [-4.5, -3.5, -4.5], strand), box([1, 3, 1], [4.5, -3, -4], strand), box([1, 5, 1], [-2, -4, 3.5], strand), box([1, 4, 1], [3, -3.5, 3.5], strand)] },
    { name: 'armL', size: [3, 15, 3], pivot: [-6.5, 20, 1], offset: [0, -6.5, 0], paint: mud, parent: 'torso', rot: [0.3, 0, 0.08], extra: drapes(-1) },
    { name: 'armR', size: [3, 15, 3], pivot: [6.5, 20, 1], offset: [0, -6.5, 0], paint: mud, parent: 'torso', rot: [0.3, 0, -0.08], extra: drapes(1) },
    {
      // A cluster of pale glowing bog mushrooms on one shoulder.
      name: 'shrooms', size: [1, 2, 1], pivot: [4, 21, 1], offset: [0, 1, 0], paint: tone('#d8e0d0'), parent: 'torso',
      extra: [box([3, 1, 3], [0, 2.3, 0], glowCap), box([1, 1.5, 1], [-1.8, 0.5, 1], tone('#d8e0d0')), box([2, 1, 2], [-1.8, 1.6, 1], glowCap)],
    },
    { name: 'reed1', size: [1, 8, 1], pivot: [2, 20, 4], offset: [0, 4, 0], paint: reed, parent: 'torso', rot: [0.25, 0, -0.2] },
    { name: 'reed2', size: [1, 6, 1], pivot: [-2, 19, 4], offset: [0, 3, 0], paint: reed, parent: 'torso', rot: [0.15, 0, 0.3] },
  ]);
}

// ---------------------------------------------------------------- Brambler
// A walking thorn-rose: a body of twisted green stems bristling with thorns, root feet, and a
// crimson bloom for a head whose petals flare open when it spits barbs.
function brambler(): MobModel {
  const stem: Paint = (g, w, h, f, rand) => {
    tone('#3a5a28', { top: '#4a6e32', bottom: '#2a4220', noise: 0.05 })(g, w, h, f, rand);
    if (f === 2 || f === 3) return;
    for (let x = 0; x < w; x++) {
      if (rand() < 0.45) { let xx = x; for (let y = 0; y < h; y++) { px(g, rand() < 0.5 ? '#4f7a34' : '#2a4220', xx, y); if (rand() < 0.2) xx = Math.max(0, Math.min(w - 1, xx + (rand() < 0.5 ? -1 : 1))); } }
    }
    for (let i = 0; i < Math.max(1, (w * h) / 18); i++) { const x = Math.floor(rand() * w), y = Math.floor(rand() * (h - 1)); px(g, '#e0d0a8', x, y); px(g, '#6a2a1a', x, y + 1); }
  };
  const calyx = withFace(scales('#3f6a2a', { edge: '#2a4a1a' }), (g, w) => {
    px(g, '#140c06', 1, 2, w - 2, 2);
    px(g, '#ffb030', 2, 3, 1, 1); px(g, '#ffb030', w - 3, 3, 1, 1); px(g, '#ffe080', 2, 2); px(g, '#ffe080', w - 3, 2);
  });
  const bloom: Paint = (g, w, h, f, rand) => {
    tone('#b8283a', { top: '#d8384a', bottom: '#7a1624' })(g, w, h, f, rand);
    if (f === 2) for (let i = 0; i < w; i += 2) px(g, '#8a1a2a', i, 0, 1, h);      // petal folds
    else for (let x = 0; x < w; x += 3) px(g, '#e85a6a', x, 0);
  };
  const petal: Paint = (g, w, h, f, rand) => { tone('#c8303e', { top: '#e04a58', bottom: '#8a1a28' })(g, w, h, f, rand); if (f === 2) px(g, '#f07080', 0, 0, w, 1); };
  const thorn = tone('#e0d0a8', { bottom: '#a89878' });
  const thorns = (list: [number, number, number, number, number][]): Detail[] => list.map(([x, y, z, rx, rz]) => box([1, 2.5, 1], [x, y, z], thorn, [rx, 0, rz]));
  const leaf = spots(tone('#4f8a2e', { top: '#5a9a38' }), '#3a6a22', 0.15, 1);
  const root = tone('#4a3a24', { top: '#5e4a2e' });
  return build('brambler', [
    { name: 'legL', size: [3, 10, 3], pivot: [-2, 10, 0], offset: [0, -5, 0], paint: stem, extra: [box([1.5, 1, 3.5], [-0.6, -9.5, -2], root, [0, 0.4, 0]), box([1.5, 1, 3], [-1.2, -9.5, 1.5], root, [0, -0.5, 0])] },
    { name: 'legR', size: [3, 10, 3], pivot: [2, 10, 0], offset: [0, -5, 0], paint: stem, extra: [box([1.5, 1, 3.5], [0.6, -9.5, -2], root, [0, -0.4, 0]), box([1.5, 1, 3], [1.2, -9.5, 1.5], root, [0, 0.5, 0])] },
    {
      name: 'torso', size: [6, 11, 5], pivot: [0, 10, 0], offset: [0, 5.5, 0], paint: stem,
      extra: thorns([[-3.3, 8, -1, 0, 1.2], [3.3, 5, 0, 0, -1.2], [-3.3, 3, 1, 0, 1.3], [3.3, 9, 1.5, 0, -1.2], [0, 7, -2.8, -1.3, 0], [1, 2.5, 2.8, 1.3, 0], [-1.5, 9.5, 2.8, 1.2, 0]]),
    },
    { name: 'leafCollar', size: [9, 1, 8], pivot: [0, 21, 0], offset: [0, 0, 0], paint: leaf, parent: 'torso', extra: [box([4, 1, 3], [-4.5, -0.5, -3], leaf, [0, 0.4, 0.3]), box([4, 1, 3], [4.5, -0.5, 3], leaf, [0, 0.4, -0.3])] },
    { name: 'head', size: [8, 7, 8], pivot: [0, 21, 0], offset: [0, 3.5, 0], paint: calyx, parent: 'torso' },
    { name: 'bloom', size: [7, 3, 7], pivot: [0, 28, 0], offset: [0, 1.5, 0], paint: bloom, parent: 'head' },
    { name: 'stamen', size: [2, 2, 2], pivot: [0, 31, 0], offset: [0, 1, 0], paint: faces(tone('#f0c040'), { 2: (g) => px(g, '#fff0a0', 0, 0) }), parent: 'head' },
    { name: 'petalN', size: [7, 1, 5], pivot: [0, 29, -3.5], offset: [0, 0, -2], paint: petal, parent: 'head', rot: [0.75, 0, 0] },
    { name: 'petalS', size: [7, 1, 5], pivot: [0, 29, 3.5], offset: [0, 0, 2], paint: petal, parent: 'head', rot: [-0.75, 0, 0] },
    { name: 'petalW', size: [5, 1, 7], pivot: [-3.5, 29, 0], offset: [-2, 0, 0], paint: petal, parent: 'head', rot: [0, 0, -0.75] },
    { name: 'petalE', size: [5, 1, 7], pivot: [3.5, 29, 0], offset: [2, 0, 0], paint: petal, parent: 'head', rot: [0, 0, 0.75] },
    { name: 'armL', size: [2, 13, 2], pivot: [-4, 20, 0], offset: [0, -6, 0], paint: stem, parent: 'torso', rot: [0, 0, 0.12], extra: [...thorns([[-1.3, -3, 0, 0, 1.2], [-1.3, -8, 0.5, 0, 1.2], [0, -11, -1.3, -1.2, 0]]), box([3, 1, 4], [-2, -6, 0], leaf, [0, 0, 0.5])] },
    { name: 'armR', size: [2, 13, 2], pivot: [4, 20, 0], offset: [0, -6, 0], paint: stem, parent: 'torso', rot: [0, 0, -0.12], extra: thorns([[1.3, -4, 0, 0, -1.2], [1.3, -9, -0.5, 0, -1.2], [0, -11, -1.3, -1.2, 0]]) },
  ]);
}

// ---------------------------------------------------------------- Shellcrawler
// A six-legged cave crawler raised on angled legs under a ridged teal shell.
function shellcrawler(): MobModel {
  const shell: Paint = (g, w, h, f, rand) => {
    scales('#2f6f6a', { edge: '#1a4a46' })(g, w, h, f, rand);
    if (f === 2) for (let x = 1; x < w; x += 3) px(g, '#1a3a38', x, 0, 1, h); // ridges
  };
  const head = withFace(speckle('#244a47', '#1a3634'), (g, w) => {
    for (const [x, y] of [[1, 1], [w - 2, 1], [2, 2], [w - 3, 2], [3, 1], [w - 4, 1]]) px(g, '#f0a030', x, y);
  });
  const leg = tone('#1e3a38', { top: '#2a4e4a', bottom: '#10221f' });
  const parts = [
    { name: 'torso', size: [10, 5, 12] as [number, number, number], pivot: [0, 6, 2] as [number, number, number], offset: [0, 0, 0] as [number, number, number], paint: shell },
    { name: 'dome', size: [8, 3, 9] as [number, number, number], pivot: [0, 8.5, 2] as [number, number, number], offset: [0, 1.5, 0] as [number, number, number], paint: shell, parent: 'torso' },
    { name: 'head', size: [7, 5, 5] as [number, number, number], pivot: [0, 6, -4] as [number, number, number], offset: [0, 0, -2.5] as [number, number, number], paint: head },
    { name: 'mandL', size: [1, 1, 3] as [number, number, number], pivot: [-2, 4, -9] as [number, number, number], offset: [0, 0, -1] as [number, number, number], paint: speckle('#d8c8a0', '#b8a880'), parent: 'head', rot: [0, 0.4, 0] as [number, number, number] },
    { name: 'mandR', size: [1, 1, 3] as [number, number, number], pivot: [2, 4, -9] as [number, number, number], offset: [0, 0, -1] as [number, number, number], paint: speckle('#d8c8a0', '#b8a880'), parent: 'head', rot: [0, -0.4, 0] as [number, number, number] },
  ];
  const claw = faces(tone('#10221f'), { 3: (g, w, h) => px(g, '#e0a030', 0, 0, w, h) });
  parts.push(...jointedLegs([-2, 2, 6], { hipX: 5, hipY: 7, upper: 7, lower: 11, up: 0.55, down: 1.15, thick: 2, splay: 0.45, paint: leg, foot: claw }) as never[]);
  return build('shellcrawler', parts, 1.5);
}

// ---------------------------------------------------------------- Dune Scuttler
// A sand-coloured scorpion-thing with pincers and a curled, red-tipped tail.
function dunescuttler(): MobModel {
  const chitin = tone('#c8a868', { top: '#e0c888', bottom: '#9a7a40' });
  const plates: Paint = (g, w, h, f, rand) => { chitin(g, w, h, f, rand); for (let y = 1; y < h; y += 2) px(g, '#8a6a34', 0, y, w, 1); };
  const legs = jointedLegs([-2, 0.5, 3], { hipX: 3, hipY: 3, upper: 3.5, lower: 5.5, up: 0.6, down: 1.0, thick: 1, splay: 0.4, paint: chitin, foot: tone('#9a7a40') });
  return build('dunescuttler', [
    { name: 'torso', size: [7, 3, 10], pivot: [0, 3, 0], offset: [0, 1, 0], paint: plates },
    { name: 'head', size: [5, 3, 3], pivot: [0, 4, -5], offset: [0, 0, -1.5], paint: withFace(chitin, (g) => { px(g, '#1a1208', 1, 1); px(g, '#1a1208', 3, 1); }) },
    { name: 'clawL', size: [3, 2, 4], pivot: [-3.5, 4, -6], offset: [-1, 0, -2], paint: chitin, rot: [0, 0.35, 0] },
    { name: 'clawR', size: [3, 2, 4], pivot: [3.5, 4, -6], offset: [1, 0, -2], paint: chitin, rot: [0, -0.35, 0] },
    { name: 'tail', size: [2, 2, 5], pivot: [0, 4, 5], offset: [0, 0, 2.5], paint: plates, rot: [-0.9, 0, 0] },
    { name: 'tail2', size: [2, 2, 5], pivot: [0, 4, 10], offset: [0, 0, 2.5], paint: plates, parent: 'tail', rot: [-0.9, 0, 0] },
    { name: 'sting', size: [2, 2, 3], pivot: [0, 4, 15], offset: [0, 0, 1.5], paint: speckle('#b8302a', '#8a2018'), parent: 'tail2', rot: [-0.9, 0, 0] },
    ...legs,
    { name: 'pincerL', size: [1.5, 1.5, 3], pivot: [-4.5, 4, -9.5], offset: [0, 0, -1], paint: chitin, parent: 'clawL', rot: [0, 0.5, 0] },
    { name: 'pincerR', size: [1.5, 1.5, 3], pivot: [4.5, 4, -9.5], offset: [0, 0, -1], paint: chitin, parent: 'clawR', rot: [0, -0.5, 0] },
  ], 0.9);
}

// ---------------------------------------------------------------- Frostling
// A small ice imp with crystal horns and shards jutting from its back.
function frostling(): MobModel {
  const ice = tone('#b8d8f0', { top: '#e0f0ff', bottom: '#88acd0', noise: 0.08 });
  const crystal = speckle('#e8f6ff', '#a8d4f0', '#ffffff', 0.3);
  const face = withFace(ice, (g, w) => {
    px(g, '#1a3a8a', 1, 2, 2, 2); px(g, '#1a3a8a', w - 3, 2, 2, 2);
    px(g, '#6ac8ff', 1, 3, 2, 1); px(g, '#6ac8ff', w - 3, 3, 2, 1); px(g, '#ffffff', 2, 2); px(g, '#ffffff', w - 2, 2);
    px(g, '#4a7ab8', 2, 5, w - 4, 1); px(g, '#e0f4ff', 3, 5); px(g, '#e0f4ff', w - 4, 5);
  });
  return build('frostling', [
    { name: 'legL', size: [2, 7, 2], pivot: [-1.5, 7, 0], offset: [0, -3.5, 0], paint: ice },
    { name: 'legR', size: [2, 7, 2], pivot: [1.5, 7, 0], offset: [0, -3.5, 0], paint: ice },
    { name: 'torso', size: [6, 7, 4], pivot: [0, 7, 0], offset: [0, 3.5, 0], paint: ice, rot: [-0.15, 0, 0] },
    { name: 'head', size: [7, 6, 6], pivot: [0, 14, 0], offset: [0, 3, 0], paint: face, parent: 'torso' },
    {
      // A ring of ice shards crowning the head, tallest at the front.
      name: 'crown', size: [1.5, 6, 1.5], pivot: [0, 20, -2], offset: [0, 2.5, 0], paint: crystal, parent: 'head', rot: [-0.2, 0, 0],
      extra: [
        box([1.4, 4, 1.4], [-2.3, 1.2, 0.3], crystal, [-0.1, 0, 0.45]), box([1.4, 4, 1.4], [2.3, 1.2, 0.3], crystal, [-0.1, 0, -0.45]),
        box([1.2, 3, 1.2], [-3, 0.6, 2.8], crystal, [0.3, 0, 0.6]), box([1.2, 3, 1.2], [3, 0.6, 2.8], crystal, [0.3, 0, -0.6]),
        box([1.3, 3.5, 1.3], [0, 0.8, 4.2], crystal, [0.5, 0, 0]),
      ],
    },
    { name: 'icicles', size: [1, 2.5, 1], pivot: [0, 14, -3], offset: [0, -1.2, 0], paint: crystal, parent: 'head', extra: [box([1, 1.8, 1], [-2, -0.9, 0], crystal), box([1, 2, 1], [2, -1, 0], crystal)] },
    { name: 'shard1', size: [2, 6, 2], pivot: [-1.2, 13, 2], offset: [0, 3, 0], paint: crystal, parent: 'torso', rot: [0.6, 0, 0.35] },
    { name: 'shard2', size: [2, 5, 2], pivot: [1.5, 11, 2], offset: [0, 2.5, 0], paint: crystal, parent: 'torso', rot: [0.75, 0, -0.4] },
    { name: 'shard3', size: [1.5, 3.5, 1.5], pivot: [0, 9, 2], offset: [0, 1.7, 0], paint: crystal, parent: 'torso', rot: [1, 0, 0] },
    { name: 'armL', size: [2, 8, 2], pivot: [-4, 13, 0], offset: [0, -4, 0], paint: ice, parent: 'torso' },
    { name: 'armR', size: [2, 8, 2], pivot: [4, 13, 0], offset: [0, -4, 0], paint: ice, parent: 'torso' },
  ]);
}

// ---------------------------------------------------------------- Cinderbrute
// A hulking basalt ape with glowing seams, knuckles near the ground, and a small head sunk between its shoulders.
function cinderbrute(): MobModel {
  const basalt: Paint = (g, w, h, f, rand) => {
    tone('#2e2a2c', { top: '#3e383a', bottom: '#1a1618', noise: 0.12 })(g, w, h, f, rand);
    let x = Math.floor(rand() * w);
    for (let y = 0; y < h; y++) { if (rand() < 0.7) px(g, '#ff7a1a', x, y); x = Math.max(0, Math.min(w - 1, x + (rand() < 0.5 ? -1 : 1))); }
  };
  const face = withFace(basalt, (g, w) => {
    px(g, '#140e0e', 0, 1, w, 2); px(g, '#ffd060', 1, 2, 2, 1); px(g, '#ffd060', w - 3, 2, 2, 1); px(g, '#fff0a0', 1, 2); px(g, '#fff0a0', w - 2, 2);
    px(g, '#140e0e', 1, 4, w - 2, 2); for (let x = 1; x < w - 1; x++) px(g, x % 2 ? '#ff7a1a' : '#ffb030', x, 4 + (x % 2));
  });
  const spineTip: Paint = (g, w, h, f, rand) => { tone('#2e2a2c', { top: '#ff9a3a', noise: 0.1 })(g, w, h, f, rand); if (f !== 2 && f !== 3) { px(g, '#ff7a1a', 0, 0, w, 1); px(g, '#ffd060', 0, 0); } };
  return build('cinderbrute', [
    { name: 'legL', size: [5, 8, 5], pivot: [-4, 8, 2], offset: [0, -4, 0], paint: basalt },
    { name: 'legR', size: [5, 8, 5], pivot: [4, 8, 2], offset: [0, -4, 0], paint: basalt },
    { name: 'torso', size: [14, 11, 9], pivot: [0, 8, 2], offset: [0, 5.5, 0], paint: basalt, rot: [-0.45, 0, 0] },
    { name: 'head', size: [7, 6, 6], pivot: [0, 16, -2], offset: [0, 1, -3], paint: face, parent: 'torso', rot: [0.4, 0, 0] },
    {
      // A ridge of basalt spines down the back, their tips glowing.
      name: 'spine1', size: [2, 5, 2], pivot: [0, 19, 3], offset: [0, 2.5, 0], paint: spineTip, parent: 'torso', rot: [0.75, 0, 0],
      extra: [{ size: [2, 6, 2], offset: [0, 2, 4], paint: spineTip, rot: [0.2, 0, 0] }, { size: [1.5, 4, 1.5], offset: [0, 0.5, 7.5], paint: spineTip, rot: [0.4, 0, 0] }],
    },
    { name: 'spine2', size: [1.5, 4, 1.5], pivot: [-4, 18, 4], offset: [0, 2, 0], paint: spineTip, parent: 'torso', rot: [0.8, 0, 0.5], extra: [{ size: [1.5, 4, 1.5], offset: [8, 0, 0], paint: spineTip, rot: [0, 0, -1] }] },
    { name: 'armL', size: [5, 16, 5], pivot: [-9.5, 17, 1], offset: [0, -7, 0], paint: basalt, parent: 'torso', rot: [0.4, 0, 0.1] },
    { name: 'armR', size: [5, 16, 5], pivot: [9.5, 17, 1], offset: [0, -7, 0], paint: basalt, parent: 'torso', rot: [0.4, 0, -0.1] },
    { name: 'fistL', size: [6, 5, 6], pivot: [-9.5, 2, 1], offset: [0, -1.5, 0], paint: basalt, parent: 'armL' },
    { name: 'fistR', size: [6, 5, 6], pivot: [9.5, 2, 1], offset: [0, -1.5, 0], paint: basalt, parent: 'armR' },
  ]);
}

// ---------------------------------------------------------------- Emberwisp
// A floating soot-black lantern skull with a glowing face, flame crown and tattered wings.
function emberwisp(): MobModel {
  const soot = tone('#2a2020', { top: '#3a2e2a', bottom: '#140e0e', noise: 0.12 });
  const face = withFace(soot, (g, w) => {
    px(g, '#ffb030', 1, 2, 3, 3); px(g, '#ffb030', w - 4, 2, 3, 3);
    px(g, '#fff0a0', 2, 3); px(g, '#fff0a0', w - 3, 3);
    px(g, '#ff6a1a', 2, 6, w - 4, 2); px(g, '#2a2020', 3, 6); px(g, '#2a2020', w - 4, 7);
  });
  const flame = speckle('#ffb030', '#ff7a1a', '#fff0a0', 0.4);
  const wing: Paint = (g, w, h, f, rand) => { speckle('#4a1e14', '#2a100a')(g, w, h, f, rand); for (let x = 0; x < w; x += 2) px(g, '#1a0a06', x, h - 1 - (x % 3)); };
  return build('emberwisp', [
    { name: 'torso', size: [10, 9, 9], pivot: [0, 13, 0], offset: [0, 0, 0], paint: face },
    { name: 'flame1', size: [2, 5, 2], pivot: [-2.5, 17.5, 0], offset: [0, 2.5, 0], paint: flame, parent: 'torso', rot: [0, 0, 0.2] },
    { name: 'flame2', size: [3, 7, 3], pivot: [0, 17.5, 0.5], offset: [0, 3.5, 0], paint: flame, parent: 'torso' },
    { name: 'flame3', size: [2, 4, 2], pivot: [2.5, 17.5, 0], offset: [0, 2, 0], paint: flame, parent: 'torso', rot: [0, 0, -0.25] },
    { name: 'wingL', size: [1, 7, 10], pivot: [-5.5, 15, 1], offset: [-1, -1, 1], paint: wing },
    { name: 'wingR', size: [1, 7, 10], pivot: [5.5, 15, 1], offset: [1, -1, 1], paint: wing },
    { name: 'jaw', size: [8, 2, 7], pivot: [0, 8.5, 3], offset: [0, -1, -3], paint: withFace(soot, (g, w) => { for (let x = 1; x < w - 1; x += 2) px(g, '#ffb030', x, 0); }), parent: 'torso' },
    { name: 'core', size: [4, 4, 4], pivot: [0, 5, 0], offset: [0, 0, 0], paint: flame },
  ]);
}

// ---------------------------------------------------------------- Raider
// A road-worn marauder in a quilted slate gambeson with rust stitching, an iron kettle helm and a
// grilled half-mask, a long rust scarf, a bandolier of bolts, and a heavy crossbow. Captains carry
// a tall pennant on their back.
function raider(): MobModel {
  const skinC = '#b89878';
  const face = withFace(tone(skinC, { noise: 0.04 }), (g, w, h) => {
    px(g, '#2a2420', 1, 2, w - 2, 1);                                   // brow shadow under the helm
    px(g, '#f0e0b0', 1, 3, 2, 1); px(g, '#f0e0b0', w - 3, 3, 2, 1);     // pale eyes
    px(g, '#c87830', 2, 3); px(g, '#c87830', w - 3, 3);
    px(g, '#6a6e72', 0, 4, w, h - 4);                                   // iron half-mask
    px(g, '#8a8e92', 0, 4, w, 1);
    for (let x = 1; x < w - 1; x += 2) px(g, '#2a2c30', x, 5, 1, 2);     // breathing grille
  });
  const quilt: Paint = (g, w, h, f, rand) => {
    tone('#3e5a5e', { top: '#4a686c', bottom: '#2e4448', noise: 0.06 })(g, w, h, f, rand);
    if (f === 2 || f === 3) return;
    for (let y = 1; y < h; y += 3) for (let x = (y % 2) ; x < w; x += 3) px(g, '#9a4a2a', x, y);   // rust stitch diamonds
  };
  const belt: Paint = (g, w, h, f, rand) => { quilt(g, w, h, f, rand); if (f !== 2 && f !== 3) { px(g, '#3a2418', 0, h - 3, w, 2); if (f === 5) px(g, '#b89040', Math.floor(w / 2) - 1, h - 3, 2, 2); } };
  const sleeve = bands([['#3e5a5e', 7], ['#9a4a2a', 1], ['#4a3424', 4]]);
  const leg = bands([['#3a3430', 5], ['#8a7a60', 1], ['#3a3430', 1], ['#8a7a60', 1], ['#3a3430', 1], ['#2a1e18', 3]]);
  const iron = tone('#6a6e72', { top: '#8a8e92', bottom: '#4a4e52', noise: 0.05 });
  const scarf = fur('#9a4a2a', { top: '#b05a34', bottom: '#7a3a20', strand: 0.2 });
  const strap = tone('#4a3020', { top: '#5a3a28' });
  const wood = tone('#6a4a2e', { top: '#8a6a44', bottom: '#4a3020' });
  const bolt = tone('#c8c0a8');
  const flag: Paint = (g, w, h, f, rand) => {
    fur('#8a2e22', { top: '#a03a2a', strand: 0.12 })(g, w, h, f, rand);
    if (f === 4 || f === 5) {
      // An original raider sigil: a pale broken ring pierced by a bolt.
      const cx = Math.floor(w / 2), cy = Math.floor(h / 3);
      for (let a = 0; a < 12; a++) { if (a === 2 || a === 3) continue; const t = a / 12 * Math.PI * 2; px(g, '#e8dcc0', cx + Math.round(Math.cos(t) * 2.4), cy + Math.round(Math.sin(t) * 2.4)); }
      for (let y = cy - 4; y <= cy + 4; y++) px(g, '#e8dcc0', cx, y);
      for (let x = 0; x < w; x += 2) px(g, '#5a1a14', x, h - 1 - (x % 4 === 0 ? 1 : 0), 1, 2);
    }
  };
  return build('raider', [
    { name: 'legL', size: [4, 12, 4], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: leg },
    { name: 'legR', size: [4, 12, 4], pivot: [2, 12, 0], offset: [0, -6, 0], paint: leg },
    {
      name: 'torso', size: [8, 12, 4.6], pivot: [0, 12, 0], offset: [0, 6, 0], paint: belt,
      extra: [
        box([1.4, 15, 0.8], [0, 6.5, -2.6], strap, [0, 0, 0.62]),                       // bandolier across the chest
        ...[-2.5, -0.8, 0.9, 2.6].map((d): Detail => box([0.6, 2.2, 0.6], [d * 0.8, 6.5 + d * 0.95, -3.1], bolt, [0, 0, 0.62])),
        box([2.6, 3, 1.6], [3.2, 1.5, -1.8], tone('#5a3a24')),                           // belt pouch
      ],
    },
    { name: 'scarf', size: [9, 2.2, 5.6], pivot: [0, 24, 0], offset: [0, -1.1, 0], paint: scarf, parent: 'torso' },
    { name: 'scarfTail', size: [2.4, 8, 0.8], pivot: [-2, 23, 2.9], offset: [0, -4, 0.4], paint: scarf, parent: 'torso', rot: [-0.2, 0, 0.1] },
    { name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: face, parent: 'torso' },
    {
      name: 'helm', size: [8.8, 3, 8.8], pivot: [0, 30, 0], offset: [0, 1.5, 0], paint: iron, parent: 'head',
      extra: [box([12, 0.8, 12], [0, -1.2, 0], iron), box([1.2, 1.4, 7], [0, 3.2, 0], tone('#9a4a2a'))],
    },
    { name: 'armL', size: [4, 12, 4], pivot: [-6, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso' },
    { name: 'armR', size: [4, 12, 4], pivot: [6, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso' },
    {
      // Heavy crossbow gripped at the stock; the prod sits out in front.
      name: 'crossbow', size: [1.6, 1.8, 9], pivot: [6, 11, 0], offset: [0, 0, -2.5], paint: wood, parent: 'armR',
      extra: [
        box([11, 1, 1.2], [0, 0.6, -6.6], iron),                        // prod
        box([0.3, 0.3, 4.2], [-4.2, 0.6, -4.6], tone('#d8d0c0'), [0, 0.95, 0]),
        box([0.3, 0.3, 4.2], [4.2, 0.6, -4.6], tone('#d8d0c0'), [0, -0.95, 0]),
        box([0.6, 0.6, 5], [0, 1.2, -4], bolt),                         // loaded bolt
        box([1.2, 2.4, 1.2], [0, -1.6, 1.6], wood, [0.3, 0, 0]),        // grip
      ],
    },
    {
      name: 'pennant', size: [0.9, 30, 0.9], pivot: [2.4, 14, 3.2], offset: [0, 15, 0], paint: wood, parent: 'torso', rot: [0.12, 0, -0.08],
      extra: [box([8, 9, 0.4], [-4.4, 24.5, 0], flag), box([1.6, 1.6, 1.6], [0, 30.6, 0], iron)],
    },
  ]);
}

export const HOSTILE_MODELS: Record<string, () => MobModel> = {
  zombie, skeleton, witch, raider, blastcap, mirewalker, brambler, shellcrawler, dunescuttler, frostling, cinderbrute, emberwisp,
};

