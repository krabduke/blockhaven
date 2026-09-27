// Models for hostile creatures. Every design here is original to Blockhaven:
// shapes and colours are chosen to read clearly at a distance and to look
// like nothing but themselves.

import { build, shade, speckle, withFace, type MobModel, type Paint } from './models';

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
  const skin = speckle('#8f8a9e', '#77728a', '#a5a0b2', 0.35);
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
    { name: 'armL', size: [4, 12, 4], pivot: [-6, 22, 0], offset: [0, -5, 0], paint: arm, parent: 'torso' },
    { name: 'armR', size: [4, 12, 4], pivot: [6, 22, 0], offset: [0, -5, 0], paint: arm, parent: 'torso' },
  ]);
}

// ---------------------------------------------------------------- Skeleton
// A bone archer wrapped in a ragged, hooded wine-red cloak.
function skeleton(): MobModel {
  const bone = speckle('#ddd6c2', '#bdb49c', '#f0ead8', 0.3);
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
  const cloth = speckle('#6a2430', '#4e1a24', '#7e3040', 0.3);
  const cloak: Paint = (g, w, h, f, rand) => {
    cloth(g, w, h, f, rand);
    // Ragged hem: dark notches along the bottom row.
    for (let x = 0; x < w; x += 2) px(g, '#2a0e14', x, h - 1 - (x % 4 === 0 ? 1 : 0), 1, 2);
  };
  const hood = faces(cloth, { 5: (g, w, h) => { px(g, '#2a0e14', 1, h - 1, w - 2, 1); } });
  const limb = speckle('#ddd6c2', '#bdb49c');
  return build('skeleton', [
    { name: 'legL', size: [2, 12, 2], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: limb },
    { name: 'legR', size: [2, 12, 2], pivot: [2, 12, 0], offset: [0, -6, 0], paint: limb },
    { name: 'torso', size: [8, 12, 4], pivot: [0, 12, 0], offset: [0, 6, 0], paint: ribs },
    { name: 'cloak', size: [10, 13, 1], pivot: [0, 24, 2.5], offset: [0, -6.5, 0], paint: cloak, parent: 'torso', rot: [0.08, 0, 0] },
    { name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: skull, parent: 'torso' },
    { name: 'hood', size: [9, 4, 9], pivot: [0, 30, 0], offset: [0, 0.5, 0.2], paint: hood, parent: 'head' },
    { name: 'armL', size: [2, 12, 2], pivot: [-5, 22, 0], offset: [0, -5, 0], paint: limb, parent: 'torso' },
    { name: 'armR', size: [2, 12, 2], pivot: [5, 22, 0], offset: [0, -5, 0], paint: limb, parent: 'torso' },
    { name: 'bow', size: [1, 12, 1], pivot: [5, 11, -1.5], offset: [0, 0, 0], paint: speckle('#e8e0cc', '#c8bea4'), parent: 'armR' },
    { name: 'bowTip', size: [1, 2, 2], pivot: [5, 17, -1.5], offset: [0, 0, -1], paint: speckle('#e8e0cc', '#c8bea4'), parent: 'bow' },
  ]);
}

// ---------------------------------------------------------------- Witch
// A potion-brewer in a patchwork teal-and-mustard robe, spectacles and a crooked grey hat.
function witch(): MobModel {
  const skin = speckle('#d6b69a', '#c4a286');
  const face = withFace(skin, (g, w) => {
    px(g, '#3a3a40', 1, 3, 3, 3); px(g, '#3a3a40', w - 4, 3, 3, 3);   // spectacle frames
    px(g, '#bfe4ec', 2, 4); px(g, '#bfe4ec', w - 3, 4);             // glass glints
    px(g, '#3a3a40', 4, 4, w - 8, 1);                               // bridge
    px(g, '#a8805e', 3, 6, 2, 1); px(g, '#6a3a3a', 3, 7, 2, 1);      // pointed chin, thin mouth
  });
  const patch: Paint = (g, w, h, _f, rand) => {
    const cols = ['#2e6a6a', '#c8a032', '#2e6a6a', '#8a4a6a'];
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
      const c = cols[Math.floor(rand() * cols.length)];
      px(g, c, x, y, 3, 3);
    }
    for (let y = 0; y < h; y++) if (rand() < 0.5) px(g, '#1e3a3a', Math.floor(rand() * w), y);  // stitches
  };
  const robe = faces(patch, { 5: (g, w) => { px(g, '#6a4a2a', 0, 7, w, 1); px(g, '#c8a032', Math.floor(w / 2) - 1, 7, 2, 1); } });
  const hat = speckle('#5e5e66', '#4a4a52', '#727280', 0.3);
  const hatBand = faces(hat, { 0: (g, w, h) => px(g, '#8a2a3a', 0, h - 1, w, 1), 1: (g, w, h) => px(g, '#8a2a3a', 0, h - 1, w, 1), 4: (g, w, h) => px(g, '#8a2a3a', 0, h - 1, w, 1), 5: (g, w, h) => px(g, '#8a2a3a', 0, h - 1, w, 1) });
  const hair = speckle('#a8a8a8', '#8a8a8a');
  return build('witch', [
    { name: 'legL', size: [3, 7, 3], pivot: [-2, 7, 0], offset: [0, -3.5, 0], paint: speckle('#3a2a22', '#2a1e18') },
    { name: 'legR', size: [3, 7, 3], pivot: [2, 7, 0], offset: [0, -3.5, 0], paint: speckle('#3a2a22', '#2a1e18') },
    { name: 'torso', size: [9, 15, 6], pivot: [0, 7, 0], offset: [0, 7.5, 0], paint: robe },
    { name: 'head', size: [8, 8, 8], pivot: [0, 22, 0], offset: [0, 4, 0], paint: face, parent: 'torso' },
    { name: 'braidL', size: [2, 8, 2], pivot: [-4.5, 26, 2], offset: [0, -4, 0], paint: hair, parent: 'head' },
    { name: 'braidR', size: [2, 8, 2], pivot: [4.5, 26, 2], offset: [0, -4, 0], paint: hair, parent: 'head' },
    { name: 'hatBrim', size: [14, 1, 14], pivot: [0, 30, 0], offset: [0, 0, 0], paint: hat, parent: 'head' },
    { name: 'hatMid', size: [8, 5, 8], pivot: [0, 30.5, 0], offset: [0, 2.5, 0], paint: hatBand, parent: 'head' },
    { name: 'hatTop', size: [5, 5, 5], pivot: [0, 35.5, 0], offset: [0, 2.5, 0], paint: hat, parent: 'hatMid', rot: [0.35, 0, 0] },
    { name: 'hatTip', size: [3, 4, 3], pivot: [0, 40.5, 0], offset: [0, 2, 0], paint: hat, parent: 'hatTop', rot: [0.5, 0, 0.1] },
    { name: 'armL', size: [3, 11, 3], pivot: [-6, 20, 0], offset: [0, -5, 0], paint: faces(patch, { 3: (g, w, h) => px(g, '#d6b69a', 0, 0, w, h) }), parent: 'torso' },
    { name: 'armR', size: [3, 11, 3], pivot: [6, 20, 0], offset: [0, -5, 0], paint: faces(patch, { 3: (g, w, h) => px(g, '#d6b69a', 0, 0, w, h) }), parent: 'torso' },
    { name: 'flask', size: [3, 4, 3], pivot: [6, 9, -1], offset: [0, -2, 0], paint: faces(speckle('#9a4ad8', '#7a2ab8', '#c08af0', 0.3), { 2: (g, w, h) => px(g, '#8a6a3a', 0, 0, w, h) }), parent: 'armR' },
  ]);
}

// ---------------------------------------------------------------- Blastcap
// A squat, spotted mushroom creature that swells up and bursts when it gets close.
function blastcap(): MobModel {
  const stalk = speckle('#e6dcc6', '#cfc2a6', '#f2ead8', 0.3);
  const face = withFace(stalk, (g, w) => {
    px(g, '#1a1410', 1, 2, 2, 2); px(g, '#1a1410', w - 3, 2, 2, 2);
    px(g, '#f2ead8', 1, 2); px(g, '#f2ead8', w - 3, 2);
    px(g, '#3a2418', Math.floor(w / 2) - 1, 5, 2, 2);                   // little round mouth
    px(g, '#d8b0a0', 0, 4); px(g, '#d8b0a0', w - 1, 4);                 // blush
  });
  const spotted: Paint = (g, w, h, f, rand) => {
    speckle('#d8582a', '#b8401e', '#e8703a', 0.25)(g, w, h, f, rand);
    if (f === 3) { // gills underneath
      px(g, '#b8a888', 0, 0, w, h);
      for (let x = 0; x < w; x += 2) px(g, '#8a7a5e', x, 0, 1, h);
      return;
    }
    const n = Math.max(2, Math.floor((w * h) / 14));
    for (let i = 0; i < n; i++) { const x = Math.floor(rand() * (w - 1)), y = Math.floor(rand() * (h - 1)); px(g, '#f4ecd8', x, y, 2, f === 2 ? 2 : 1); }
  };
  const foot = speckle('#cfc2a6', '#b8aa8c');
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
  const mud = speckle('#3e4630', '#2c3320', '#556040', 0.4);
  const face = withFace(speckle('#262c1c', '#1c2014'), (g, w) => {
    px(g, '#d8e050', 1, 3, 2, 1); px(g, '#d8e050', w - 3, 3, 2, 1);
    px(g, '#101408', 2, 5, w - 4, 1);
  });
  const moss: Paint = (g, w, h, f, rand) => {
    speckle('#5a7a32', '#40602a', '#78963e', 0.35)(g, w, h, f, rand);
    if (f !== 2) for (let x = 0; x < w; x++) if (rand() < 0.4) px(g, '#2c3a18', x, h - 1);
  };
  const reed = faces(speckle('#6a7a3a', '#56662e'), { 2: (g, w, h) => px(g, '#6a4028', 0, 0, w, h) });
  return build('mirewalker', [
    { name: 'legL', size: [4, 10, 4], pivot: [-2.5, 10, 1], offset: [0, -5, 0], paint: speckle('#2c3320', '#1f2717') },
    { name: 'legR', size: [4, 10, 4], pivot: [2.5, 10, 1], offset: [0, -5, 0], paint: speckle('#2c3320', '#1f2717') },
    { name: 'torso', size: [10, 11, 6], pivot: [0, 10, 1], offset: [0, 5.5, 0], paint: mud, rot: [-0.38, 0, 0] },
    { name: 'head', size: [8, 7, 7], pivot: [0, 21, 0], offset: [0, 3, -1.5], paint: face, parent: 'torso', rot: [0.3, 0, 0] },
    { name: 'hood', size: [10, 4, 9], pivot: [0, 26, 0], offset: [0, 0, -1], paint: moss, parent: 'head' },
    { name: 'armL', size: [3, 15, 3], pivot: [-6.5, 20, 1], offset: [0, -6.5, 0], paint: mud, parent: 'torso', rot: [0.3, 0, 0.08] },
    { name: 'armR', size: [3, 15, 3], pivot: [6.5, 20, 1], offset: [0, -6.5, 0], paint: mud, parent: 'torso', rot: [0.3, 0, -0.08] },
    { name: 'reed1', size: [1, 8, 1], pivot: [2, 20, 4], offset: [0, 4, 0], paint: reed, parent: 'torso', rot: [0.25, 0, -0.2] },
    { name: 'reed2', size: [1, 6, 1], pivot: [-2, 19, 4], offset: [0, 3, 0], paint: reed, parent: 'torso', rot: [0.15, 0, 0.3] },
  ]);
}

// ---------------------------------------------------------------- Brambler
// A walking thorn-bud on root legs, with a slit that glows before it spits barbs.
function brambler(): MobModel {
  const bark: Paint = (g, w, h, f, rand) => {
    speckle('#4a3a24', '#34281a', '#5e4a2e', 0.35)(g, w, h, f, rand);
    for (let y = 0; y < h; y += 3) px(g, '#3f6a2a', 0, y + (f % 2), w, 1); // vine wraps
    for (let i = 0; i < 3; i++) px(g, '#c8402a', Math.floor(rand() * w), Math.floor(rand() * h));
  };
  const bud = withFace(speckle('#4a7a2e', '#36601f', '#5e9038', 0.35), (g, w) => {
    px(g, '#1a1008', 1, 3, w - 2, 2);
    px(g, '#ffb030', 2, 4, w - 4, 1);
  });
  const petal = speckle('#b8302a', '#8a2018', '#d8483a', 0.3);
  const thorn = speckle('#d8c8a0', '#b8a880');
  return build('brambler', [
    { name: 'legL', size: [3, 10, 3], pivot: [-2, 10, 0], offset: [0, -5, 0], paint: bark },
    { name: 'legR', size: [3, 10, 3], pivot: [2, 10, 0], offset: [0, -5, 0], paint: bark },
    { name: 'torso', size: [6, 11, 5], pivot: [0, 10, 0], offset: [0, 5.5, 0], paint: bark },
    { name: 'head', size: [8, 8, 8], pivot: [0, 21, 0], offset: [0, 4, 0], paint: bud, parent: 'torso' },
    { name: 'petalN', size: [6, 1, 4], pivot: [0, 29, -3], offset: [0, 0, -1], paint: petal, parent: 'head', rot: [-0.6, 0, 0] },
    { name: 'petalS', size: [6, 1, 4], pivot: [0, 29, 3], offset: [0, 0, 1], paint: petal, parent: 'head', rot: [0.6, 0, 0] },
    { name: 'petalW', size: [4, 1, 6], pivot: [-3, 29, 0], offset: [-1, 0, 0], paint: petal, parent: 'head', rot: [0, 0, 0.6] },
    { name: 'petalE', size: [4, 1, 6], pivot: [3, 29, 0], offset: [1, 0, 0], paint: petal, parent: 'head', rot: [0, 0, -0.6] },
    { name: 'spike1', size: [1, 4, 1], pivot: [-3, 18, 2], offset: [0, 2, 0], paint: thorn, parent: 'torso', rot: [0.5, 0, 0.5] },
    { name: 'spike2', size: [1, 4, 1], pivot: [3, 17, 2], offset: [0, 2, 0], paint: thorn, parent: 'torso', rot: [0.5, 0, -0.5] },
    { name: 'spike3', size: [1, 3, 1], pivot: [0, 14, 2.5], offset: [0, 1.5, 0], paint: thorn, parent: 'torso', rot: [0.9, 0, 0] },
    { name: 'armL', size: [2, 13, 2], pivot: [-4, 20, 0], offset: [0, -6, 0], paint: bark, parent: 'torso', rot: [0, 0, 0.12] },
    { name: 'armR', size: [2, 13, 2], pivot: [4, 20, 0], offset: [0, -6, 0], paint: bark, parent: 'torso', rot: [0, 0, -0.12] },
    { name: 'leafL', size: [3, 1, 3], pivot: [-4, 14, 0], offset: [-1.5, 0, 0], paint: speckle('#4f8a2e', '#3a6a22'), parent: 'armL', rot: [0, 0, 0.4] },
  ]);
}

// ---------------------------------------------------------------- Shellcrawler
// A six-legged cave crawler raised on angled legs under a ridged teal shell.
function shellcrawler(): MobModel {
  const shell: Paint = (g, w, h, f, rand) => {
    speckle('#2f6f6a', '#1f4f4b', '#4a948c', 0.35)(g, w, h, f, rand);
    if (f === 2) for (let x = 1; x < w; x += 3) px(g, '#1a3a38', x, 0, 1, h); // ridges
  };
  const head = withFace(speckle('#244a47', '#1a3634'), (g, w) => {
    for (const [x, y] of [[1, 1], [w - 2, 1], [2, 2], [w - 3, 2], [3, 1], [w - 4, 1]]) px(g, '#f0a030', x, y);
  });
  const leg = speckle('#1a3634', '#10221f', '#264a46', 0.3);
  const parts = [
    { name: 'torso', size: [10, 5, 12] as [number, number, number], pivot: [0, 6, 2] as [number, number, number], offset: [0, 0, 0] as [number, number, number], paint: shell },
    { name: 'dome', size: [8, 3, 9] as [number, number, number], pivot: [0, 8.5, 2] as [number, number, number], offset: [0, 1.5, 0] as [number, number, number], paint: shell, parent: 'torso' },
    { name: 'head', size: [7, 5, 5] as [number, number, number], pivot: [0, 6, -4] as [number, number, number], offset: [0, 0, -2.5] as [number, number, number], paint: head },
    { name: 'mandL', size: [1, 1, 3] as [number, number, number], pivot: [-2, 4, -9] as [number, number, number], offset: [0, 0, -1] as [number, number, number], paint: speckle('#d8c8a0', '#b8a880'), parent: 'head', rot: [0, 0.4, 0] as [number, number, number] },
    { name: 'mandR', size: [1, 1, 3] as [number, number, number], pivot: [2, 4, -9] as [number, number, number], offset: [0, 0, -1] as [number, number, number], paint: speckle('#d8c8a0', '#b8a880'), parent: 'head', rot: [0, -0.4, 0] as [number, number, number] },
  ];
  for (let i = 0; i < 3; i++) {
    const z = -2 + i * 4;
    parts.push({ name: 'legL' + i, size: [11, 2, 2], pivot: [-5, 7, z], offset: [-5.5, 0, 0], paint: leg, rot: [0, 0, 0.55] } as never);
    parts.push({ name: 'legR' + i, size: [11, 2, 2], pivot: [5, 7, z], offset: [5.5, 0, 0], paint: leg, rot: [0, 0, -0.55] } as never);
  }
  return build('shellcrawler', parts);
}

// ---------------------------------------------------------------- Dune Scuttler
// A sand-coloured scorpion-thing with pincers and a curled, red-tipped tail.
function dunescuttler(): MobModel {
  const chitin = speckle('#c8a868', '#a88848', '#e0c888', 0.35);
  const plates: Paint = (g, w, h, f, rand) => { chitin(g, w, h, f, rand); for (let y = 1; y < h; y += 2) px(g, '#8a6a34', 0, y, w, 1); };
  const legs: never[] = [];
  for (let i = 0; i < 3; i++) {
    const z = -2 + i * 2.5;
    legs.push({ name: 'legL' + i, size: [6, 1, 1], pivot: [-3, 3, z], offset: [-3, 0, 0], paint: chitin, rot: [0, 0, 0.5] } as never);
    legs.push({ name: 'legR' + i, size: [6, 1, 1], pivot: [3, 3, z], offset: [3, 0, 0], paint: chitin, rot: [0, 0, -0.5] } as never);
  }
  return build('dunescuttler', [
    { name: 'torso', size: [7, 3, 10], pivot: [0, 3, 0], offset: [0, 1, 0], paint: plates },
    { name: 'head', size: [5, 3, 3], pivot: [0, 4, -5], offset: [0, 0, -1.5], paint: withFace(chitin, (g) => { px(g, '#1a1208', 1, 1); px(g, '#1a1208', 3, 1); }) },
    { name: 'clawL', size: [3, 2, 4], pivot: [-3.5, 4, -6], offset: [-1, 0, -2], paint: chitin, rot: [0, 0.35, 0] },
    { name: 'clawR', size: [3, 2, 4], pivot: [3.5, 4, -6], offset: [1, 0, -2], paint: chitin, rot: [0, -0.35, 0] },
    { name: 'tail', size: [2, 2, 5], pivot: [0, 4, 5], offset: [0, 0, 2.5], paint: plates, rot: [-0.9, 0, 0] },
    { name: 'tail2', size: [2, 2, 5], pivot: [0, 4, 10], offset: [0, 0, 2.5], paint: plates, parent: 'tail', rot: [-0.9, 0, 0] },
    { name: 'sting', size: [2, 2, 3], pivot: [0, 4, 15], offset: [0, 0, 1.5], paint: speckle('#b8302a', '#8a2018'), parent: 'tail2', rot: [-0.9, 0, 0] },
    ...legs,
  ]);
}

// ---------------------------------------------------------------- Frostling
// A small ice imp with crystal horns and shards jutting from its back.
function frostling(): MobModel {
  const ice = speckle('#b8d8f0', '#98bcd8', '#e0f0ff', 0.35);
  const crystal = speckle('#e8f6ff', '#a8d4f0', '#ffffff', 0.3);
  const face = withFace(ice, (g, w) => { px(g, '#2a6ad8', 1, 3, 2, 1); px(g, '#2a6ad8', w - 3, 3, 2, 1); px(g, '#6a9ac8', 2, 5, w - 4, 1); });
  return build('frostling', [
    { name: 'legL', size: [2, 7, 2], pivot: [-1.5, 7, 0], offset: [0, -3.5, 0], paint: ice },
    { name: 'legR', size: [2, 7, 2], pivot: [1.5, 7, 0], offset: [0, -3.5, 0], paint: ice },
    { name: 'torso', size: [6, 7, 4], pivot: [0, 7, 0], offset: [0, 3.5, 0], paint: ice, rot: [-0.15, 0, 0] },
    { name: 'head', size: [7, 6, 6], pivot: [0, 14, 0], offset: [0, 3, 0], paint: face, parent: 'torso' },
    { name: 'hornL', size: [2, 4, 2], pivot: [-3, 19, 1], offset: [0, 2, 0], paint: crystal, parent: 'head', rot: [0.9, 0, 0.7] },
    { name: 'hornR', size: [2, 4, 2], pivot: [3, 19, 1], offset: [0, 2, 0], paint: crystal, parent: 'head', rot: [0.9, 0, -0.7] },
    { name: 'crest', size: [2, 5, 2], pivot: [0, 20, 1], offset: [0, 2.5, 0], paint: crystal, parent: 'head', rot: [0.75, 0, 0] },
    { name: 'shard1', size: [2, 5, 2], pivot: [-1, 13, 2], offset: [0, 2.5, 0], paint: crystal, parent: 'torso', rot: [0.7, 0, 0.3] },
    { name: 'shard2', size: [2, 4, 2], pivot: [1.5, 11, 2], offset: [0, 2, 0], paint: crystal, parent: 'torso', rot: [0.8, 0, -0.35] },
    { name: 'armL', size: [2, 8, 2], pivot: [-4, 13, 0], offset: [0, -4, 0], paint: ice, parent: 'torso' },
    { name: 'armR', size: [2, 8, 2], pivot: [4, 13, 0], offset: [0, -4, 0], paint: ice, parent: 'torso' },
  ]);
}

// ---------------------------------------------------------------- Cinderbrute
// A hulking basalt ape with glowing seams, knuckles near the ground, and a small head sunk between its shoulders.
function cinderbrute(): MobModel {
  const basalt: Paint = (g, w, h, f, rand) => {
    speckle('#2e2a2c', '#1e1a1c', '#3e383a', 0.35)(g, w, h, f, rand);
    let x = Math.floor(rand() * w);
    for (let y = 0; y < h; y++) { if (rand() < 0.7) px(g, '#ff7a1a', x, y); x = Math.max(0, Math.min(w - 1, x + (rand() < 0.5 ? -1 : 1))); }
  };
  const face = withFace(basalt, (g, w) => { px(g, '#ffd060', 1, 2, 2, 1); px(g, '#ffd060', w - 3, 2, 2, 1); px(g, '#ff7a1a', 2, 4, w - 4, 1); });
  return build('cinderbrute', [
    { name: 'legL', size: [5, 8, 5], pivot: [-4, 8, 2], offset: [0, -4, 0], paint: basalt },
    { name: 'legR', size: [5, 8, 5], pivot: [4, 8, 2], offset: [0, -4, 0], paint: basalt },
    { name: 'torso', size: [14, 11, 9], pivot: [0, 8, 2], offset: [0, 5.5, 0], paint: basalt, rot: [-0.45, 0, 0] },
    { name: 'head', size: [7, 6, 6], pivot: [0, 16, -2], offset: [0, 1, -3], paint: face, parent: 'torso', rot: [0.4, 0, 0] },
    { name: 'spine1', size: [3, 4, 3], pivot: [-3, 19, 5], offset: [0, 2, 0], paint: basalt, parent: 'torso', rot: [0.4, 0, 0.2] },
    { name: 'spine2', size: [3, 5, 3], pivot: [3, 19, 5], offset: [0, 2.5, 0], paint: basalt, parent: 'torso', rot: [0.4, 0, -0.2] },
    { name: 'armL', size: [5, 16, 5], pivot: [-9.5, 17, 1], offset: [0, -7, 0], paint: basalt, parent: 'torso', rot: [0.4, 0, 0.1] },
    { name: 'armR', size: [5, 16, 5], pivot: [9.5, 17, 1], offset: [0, -7, 0], paint: basalt, parent: 'torso', rot: [0.4, 0, -0.1] },
    { name: 'fistL', size: [6, 5, 6], pivot: [-9.5, 2, 1], offset: [0, -1.5, 0], paint: basalt, parent: 'armL' },
    { name: 'fistR', size: [6, 5, 6], pivot: [9.5, 2, 1], offset: [0, -1.5, 0], paint: basalt, parent: 'armR' },
  ]);
}

// ---------------------------------------------------------------- Emberwisp
// A floating soot-black lantern skull with a glowing face, flame crown and tattered wings.
function emberwisp(): MobModel {
  const soot = speckle('#2a2020', '#1a1414', '#3a2e2a', 0.3);
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
    { name: 'core', size: [4, 4, 4], pivot: [0, 6, 0], offset: [0, 0, 0], paint: flame },
  ]);
}

export const HOSTILE_MODELS: Record<string, () => MobModel> = {
  zombie, skeleton, witch, blastcap, mirewalker, brambler, shellcrawler, dunescuttler, frostling, cinderbrute, emberwisp,
};

