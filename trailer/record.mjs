// Records the QubeCraft trailer frame by frame. The game runs on a virtual clock (every frame is
// exactly 1/30 s of game time however long it takes to render), a scripted camera replaces the
// player's view, and titles, letterbox bars and flashes are drawn over the canvas in the page.
//
//   npx vite --port 5199          (in another terminal)
//   node trailer/record.mjs       frames go to trailer/out/frames; ONLY=name,name re-records shots
//
// Shots and titles are laid out on the score's bar grid: 100 bpm, 2.4 s a bar, 72 frames a bar.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FPS = 30, BAR = 2.4, FPB = FPS * BAR;
const OUT = new URL('./out/frames/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url)));
const only = process.env.ONLY?.split(',');
const URL_ = process.env.URL ?? 'http://localhost:5199/';

// ------------------------------------------------------------------ maths
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
/** A point on a circle round `c` at angle `a` (radians), `r` out and `h` up. */
const orbit = (c, r, a, h) => [c[0] + Math.cos(a) * r, c[1] + h, c[2] + Math.sin(a) * r];
/** Catmull-Rom through points, t in 0..1. */
const spline = (pts, t) => {
  const n = pts.length - 1, f = Math.min(n - 1e-6, t * n), i = Math.floor(f), u = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u));
};
/** A structure's local (u, v) -> world (x, z), as Frame.at does. */
const at = (s, u, v) => { switch (s.rot & 3) { case 0: return [s.x + u, s.z + v]; case 1: return [s.x - v, s.z + u]; case 2: return [s.x - u, s.z - v]; default: return [s.x + v, s.z - u]; } };
const P = (s, dy = 0) => [s.x + 0.5, s.y + dy, s.z + 0.5];

// ------------------------------------------------------------------ titles and overlay timeline (seconds)
const b2s = (b) => b * BAR;
const CARDS = [
  { text: 'AN ENDLESS WORLD', from: 1.3, to: 4.9 },
  { text: 'BUILT ONE BLOCK AT A TIME', from: b2s(4) + 0.3, to: b2s(6) - 0.3 },
  { text: 'WHEN NIGHT FALLS', from: b2s(14) + 0.5, to: b2s(16) - 0.25 },
  { text: 'DISCOVER WHAT LIES HIDDEN', from: b2s(18) + 0.1, to: b2s(20) - 0.2 },
  { text: 'DESCEND INTO THE EMBERDEEP', from: b2s(24) + 0.35, to: b2s(26) - 0.2 },
  { text: 'RISE TO THE HOLLOW', from: b2s(32) + 0.2, to: b2s(34) - 0.3 },
];
const IMPACTS = [b2s(16), b2s(24), b2s(36), b2s(40)];
const END = b2s(44) + 0.4;
const LOGO = b2s(40);

function overlay(T) {
  // Letterbox bars (2.39:1), pulled away as the logo lands.
  const bars = T < LOGO ? 138 : 138 * (1 - ease(clamp01((T - LOGO) / 1.4)));
  // Fades: up from black, a dip before the drop, a dip before the logo, out to black.
  let fade = 1 - ease(clamp01(T / 2.4));
  const dip = (t0, t1) => { if (T > t0 && T < t1) fade = Math.max(fade, ease(clamp01((T - t0) / (t1 - t0)))); };
  dip(b2s(16) - 0.35, b2s(16));
  dip(LOGO - 0.5, LOGO);
  if (T > END - 1.6) fade = Math.max(fade, ease(clamp01((T - (END - 1.6)) / 1.4)));
  // White flashes on the big hits.
  let flash = 0;
  for (const t of IMPACTS) if (T >= t && T < t + 0.6) flash = Math.max(flash, Math.pow(1 - (T - t) / 0.6, 2) * (t === LOGO ? 1 : 0.75));
  // One title card at a time: fades and spreads out as it goes.
  let card = null;
  for (const c of CARDS) if (T >= c.from && T <= c.to) {
    const u = (T - c.from) / (c.to - c.from);
    card = { text: c.text, o: Math.min(1, (T - c.from) / 0.45, (c.to - T) / 0.45), spacing: 0.28 + u * 0.1, y: (1 - easeOut(clamp01((T - c.from) / 0.8))) * 12 };
  }
  // The logo, then its lines.
  let logo = null;
  if (T >= LOGO) {
    const u = T - LOGO;
    logo = {
      o: Math.min(1, u / 0.08), scale: 1.18 - 0.18 * easeOut(clamp01(u / 0.5)) + 0.012 * u,
      sub: clamp01((u - 2.2) / 0.7), tag: clamp01((u - 3.4) / 0.7),
    };
  }
  // Camera shake after the hits.
  let shake = 0;
  for (const t of IMPACTS) if (T >= t && T < t + 0.7) shake = Math.max(shake, 1 - (T - t) / 0.7);
  return { bars, fade, flash, card, logo, shake };
}

// ------------------------------------------------------------------ the shots
// Each shot: where it sits on the bar grid, which dimension, the time of day, a setup run in the page
// (returning what the camera path needs), and a camera path over u = 0..1.
const house = buildHouse();
const SHOTS = [
  {
    name: 'dawn', bars: [0, 4], dim: 'overworld', time: (u) => lerp(23300, 24550, u),
    setup: { find: [[5], 60] },
    cam: (u, i) => {
      const [x, , z] = i.spot;
      const y = i.top + 16;
      return { pos: [x - 110 + 70 * ease(u), y + 8 * u, z - 10], look: [x + 60, y - 6 + 10 * u, z + 5], fov: 68 };
    },
  },
  {
    name: 'build', bars: [4, 2], dim: 'overworld', time: 7200,
    setup: { find: [[1], 18, 3], level: 11, house },
    frame: 'build',
    cam: (u, i) => { const c = [i.spot[0], i.ground + 1, i.spot[2]]; return { pos: orbit(c, 17, 0.4 + u * 1.2, 7 + u * 2), look: [c[0], c[1] + 3, c[2]], fov: 60 }; },
  },
  { name: 'blossom', bars: [6, 1], dim: 'overworld', time: 5200, setup: { find: [[14], 40, 10] },
    cam: (u, i) => ({ pos: [i.spot[0] - 26 + 14 * u, i.top + 5, i.spot[2] - 26 + 10 * u], look: [i.spot[0] + 12, i.top - 6, i.spot[2] + 8], fov: 62 }) },
  { name: 'jungle', bars: [7, 1], dim: 'overworld', time: 6400, setup: { at: plan.ziggurat, radius: 30 },
    cam: (u) => { const s = plan.ziggurat; return { pos: [s.x - 42 + 10 * u, s.y + 24 + 4 * u, s.z + 20 - 12 * u], look: [s.x, s.y + 10, s.z], fov: 60 }; } },
  { name: 'badlands', bars: [8, 1], dim: 'overworld', time: 9600, setup: { find: [[12], 50] },
    cam: (u, i) => ({ pos: orbit([i.spot[0], i.top, i.spot[2]], 70, 2.4 + 0.25 * u, 22), look: [i.spot[0], i.top - 8, i.spot[2]], fov: 60 }) },
  { name: 'taiga', bars: [9, 1], dim: 'overworld', time: 5400, setup: { at: plan.igloo, radius: 20 },
    cam: (u) => { const s = plan.igloo, k = plan.frostkeep; return { pos: [s.x - 34 + 12 * u, s.y + 32, s.z + 30 - 6 * u], look: [k.x, k.y + 4, k.z], fov: 60 }; } },
  { name: 'temple', bars: [10, 1], dim: 'overworld', time: 8200, setup: { at: plan.temple, radius: 30 },
    cam: (u) => ({ pos: orbit(P(plan.temple), 44, 0.8 + 0.35 * u, 24), look: P(plan.temple, 5), fov: 58 }) },
  { name: 'mountains', bars: [11, 1], dim: 'overworld', time: 4800, setup: { find: [[5], 70] },
    cam: (u, i) => ({ pos: [i.spot[0] - 90 + 30 * u, i.top + 30, i.spot[2] + 60], look: [i.spot[0] + 20, i.top - 10, i.spot[2] - 20], fov: 64 }) },
  { name: 'village', bars: [12, 1], dim: 'overworld', time: 10300, setup: { at: plan.village, radius: 40 },
    cam: (u) => { const v = plan.village; return { pos: orbit([v.x, v.y, v.z], 30, -0.6 + 0.35 * u, 30 - 4 * u), look: [v.x, v.y, v.z], fov: 60 }; } },
  { name: 'meadow', bars: [13, 1], dim: 'overworld', time: 10900, setup: { find: [[1], 16, 2], level: 13, meadow: true },
    cam: (u, i) => { const c = [i.spot[0], i.ground + 1, i.spot[2]]; return { pos: [c[0] + 9 - 5 * u, c[1] + 1.2, c[2] + 7], look: [c[0] - 4, c[1] + 0.6, c[2] - 1], fov: 55 }; } },
  { name: 'dusk', bars: [14, 2], dim: 'overworld', time: (u) => lerp(11600, 14600, u), setup: { at: plan.village, radius: 40 },
    cam: (u) => { const v = plan.village; return { pos: [v.x + 50 - 6 * u, v.y + 26, v.z + 40 - 4 * u], look: [v.x - 20, v.y + 4, v.z - 16], fov: 62 }; } },
  { name: 'monsters', bars: [16, 2], dim: 'overworld', time: 15200, setup: { find: [[1], 16, 2], level: 15, monsters: true },
    cam: (u, i) => { const c = [i.spot[0], i.ground + 1, i.spot[2]]; return { pos: [c[0], c[1] + 1.3 + 0.4 * u, c[2] + 8 + 2 * u], look: [c[0], c[1] + 1.2, c[2] - 4], fov: 58 }; } },
  { name: 'frostkeep', bars: [18, 1], dim: 'overworld', time: 5600, setup: { at: plan.frostkeep, radius: 30 },
    cam: (u) => ({ pos: orbit(P(plan.frostkeep), 40, 0.5 + 0.3 * u, 22), look: P(plan.frostkeep, 6), fov: 58 }) },
  { name: 'manor', bars: [19, 1], dim: 'overworld', time: 9200, setup: { at: plan.manor, radius: 30 },
    cam: (u) => { const s = plan.manor; const [fx, fz] = at(s, 0, -44), [gx, gz] = at(s, -18, -30); return { pos: lerp3([fx, s.y + 16, fz], [gx, s.y + 12, gz], ease(u)), look: P(s, 11), fov: 60 }; } },
  { name: 'outpost', bars: [20, 1], dim: 'overworld', time: 10000, setup: { at: plan.outpost, radius: 25 },
    cam: (u) => ({ pos: orbit(P(plan.outpost), 30, 3.6 + 0.4 * u, 12 + 6 * u), look: P(plan.outpost, 13), fov: 60 }) },
  { name: 'citadel', bars: [21, 1], dim: 'overworld', time: 6000, setup: { at: plan.citadel, radius: 30, nightVision: true },
    cam: (u) => ({ pos: orbit(P(plan.citadel), 11, 0.6 + 0.6 * u, 11.5), look: P(plan.citadel, 1), fov: 78 }) },
  { name: 'vault', bars: [22, 1], dim: 'overworld', time: 6000, setup: { at: plan.vault, radius: 25, nightVision: true },
    cam: (u) => { const s = plan.vault; const [ax, az] = at(s, 0, -16), [bx, bz] = at(s, 0, -4), [lx, lz] = at(s, 0, 8); return { pos: lerp3([ax, s.y + 4.5, az], [bx, s.y + 3.8, bz], ease(u)), look: [lx, s.y + 4.5, lz], fov: 70 }; } },
  { name: 'witchhut', bars: [23, 1], dim: 'overworld', time: 12900, setup: { at: plan.witchhut, radius: 20 },
    cam: (u) => ({ pos: orbit(P(plan.witchhut, 0), 18, 2.2 + 0.4 * u, 10), look: [plan.witchhut.x, 66, plan.witchhut.z], fov: 60 }) },
  // The Emberdeep.
  { name: 'bastion-wide', bars: [24, 1], dim: 'ember', time: 6000, setup: { at: plan.bastion, radius: 30, brightness: 0.75 },
    cam: (u) => { const s = plan.bastion; return { pos: [s.x - 15 + 5 * u, s.y + 17 - 2 * u, s.z - 16 + 4 * u], look: [s.x + 4, s.y + 3, s.z + 6], fov: 72 }; } },
  { name: 'cathedral', bars: [25, 2], dim: 'ember', time: 6000, setup: { at: plan.cathedral, radius: 30, brightness: 0.75 },
    cam: (u) => {
      const s = plan.cathedral;
      const pts = [at(s, 0, -28), at(s, 0, -22.5), at(s, 0, -8), at(s, 0, 6)].map(([x, z], k) => [x, s.y + [7, 3.8, 5.5, 6.5][k], z]);
      const [lx, lz] = at(s, 0, 30);
      return { pos: spline(pts, ease(u)), look: [lx, s.y + 6, lz], fov: 66 };
    } },
  { name: 'bastion', bars: [27, 2], dim: 'ember', time: 6000, setup: { at: plan.bastion, radius: 30, brightness: 0.75 },
    cam: (u) => ({ pos: orbit(P(plan.bastion), 19, 0.9 + 0.9 * u, 14), look: P(plan.bastion, 5), fov: 72 }) },
  { name: 'spire', bars: [29, 2], dim: 'ember', time: 6000, setup: { at: plan.spire, radius: 20, brightness: 0.75 },
    cam: (u) => { const s = plan.spire; return { pos: orbit(P(s), 9.5, 0.3 + 1.2 * u, 8 + 58 * ease(u)), look: P(s, 18 + 58 * ease(u)), fov: 72 }; } },
  { name: 'forge', bars: [31, 1], dim: 'ember', time: 6000, setup: { at: plan.forge, radius: 25, brightness: 0.75 },
    cam: (u) => { const s = plan.forge; const [ax, az] = at(s, -12, -3), [bx, bz] = at(s, 4, -3), [lx, lz] = at(s, 14, 0); return { pos: lerp3([ax, s.y + 4, az], [bx, s.y + 3.5, bz], u), look: [lx, s.y + 3, lz], fov: 70 }; } },
  // The Hollow.
  { name: 'garden', bars: [32, 1], dim: 'hollow', time: 6000, setup: { at: plan.garden, radius: 30, brightness: 0.95 },
    cam: (u) => { const s = plan.garden; return { pos: lerp3([s.x + 32, s.y + 16, s.z + 30], [s.x + 22, s.y + 10, s.z + 20], ease(u)), look: P(s, 5), fov: 62 }; } },
  { name: 'spires', bars: [33, 1], dim: 'hollow', time: 6000, setup: { at: plan.spires, radius: 30, brightness: 0.95 },
    cam: (u) => ({ pos: orbit(P(plan.spires), 40, 0.4 + 0.35 * u, 20), look: P(plan.spires, 18), fov: 60 }) },
  { name: 'observatory', bars: [34, 1], dim: 'hollow', time: 6000, setup: { at: plan.observatory, radius: 25, brightness: 0.95 },
    cam: (u) => ({ pos: orbit(P(plan.observatory), 24, 2.0 + 0.4 * u, 10), look: P(plan.observatory, 9), fov: 60 }) },
  { name: 'starforge', bars: [35, 1], dim: 'hollow', time: 6000, setup: { at: plan.starforge, radius: 25, brightness: 0.95 },
    cam: (u) => ({ pos: orbit(P(plan.starforge), 24, 4.2 + 0.4 * u, 9 + 3 * u), look: P(plan.starforge, 5), fov: 62 }) },
  { name: 'colossus', bars: [36, 2], dim: 'hollow', time: 6000, setup: { at: { x: 0, y: 64, z: 0 }, radius: 40, boss: true, brightness: 0.95 },
    cam: (u) => ({ pos: [0, 0, 0], chase: [-14 + 6 * u, 5 - 2 * u, 16 - 4 * u], look: 'boss', fov: 66 }) },
  { name: 'glide', bars: [38, 2], dim: 'hollow', time: 6000, setup: { at: { x: 40, y: 64, z: 25 }, radius: 40, brightness: 0.95 },
    cam: (u) => {
      const pts = [[170, 104, 110], [95, 96, 60], [35, 90, 22], [-25, 88, -12], [-95, 98, -60]];
      const p = spline(pts, u), q = spline(pts, Math.min(1, u + 0.03)), r = spline(pts, Math.min(1, u + 0.06));
      const h1 = Math.atan2(q[2] - p[2], q[0] - p[0]), h2 = Math.atan2(r[2] - q[2], r[0] - q[0]);
      return { pos: p, look: [q[0] + (q[0] - p[0]) * 4, q[1] - 2, q[2] + (q[2] - p[2]) * 4], roll: Math.max(-0.35, Math.min(0.35, (h2 - h1) * 6)), fov: 80 };
    } },
  // The logo, over a dawn vista.
  { name: 'logo', bars: [40, 4.25], dim: 'overworld', time: (u) => lerp(23500, 24700, u), setup: { find: [[5], 60] },
    cam: (u, i) => ({ pos: [i.spot[0] - 120 + 20 * u, i.top + 34, i.spot[2] + 30], look: [i.spot[0] + 40, i.top + 4, i.spot[2] - 10], fov: 64 }) },
];

/** A little timber cottage, listed bottom to top, for the building time-lapse (relative to its centre). */
function buildHouse() {
  const B = { cobble: 4, planks: 5, log: 9, glass: 90, slab: 54, stairs: 61, lantern: 93, fence: 63, pot: 199, bricks: 32, gravel: 8 };
  const out = [];
  for (let x = -4; x <= 4; x++) for (let z = -3; z <= 3; z++) out.push([x, 0, z, B.cobble, 0]);
  for (let y = 1; y <= 4; y++) for (let x = -4; x <= 4; x++) for (let z = -3; z <= 3; z++) {
    const ex = Math.abs(x) === 4, ez = Math.abs(z) === 3;
    if (!ex && !ez) { if (y === 4) out.push([x, y, z, B.planks, 0]); continue; }
    if (ex && ez) { out.push([x, y, z, B.log, 0]); continue; }
    if (z === -3 && x === 0 && y <= 2) continue;                  // door
    const win = y === 2 && ((ez && Math.abs(x) === 2) || (ex && z === 0));
    out.push([x, y, z, win ? B.glass : y === 4 ? B.log : B.planks, y === 4 ? (ez ? 1 : 2) : 0]);
  }
  for (let k = 0; k <= 3; k++) for (let x = -5; x <= 5; x++) {
    for (const z of [-4 + k, 4 - k]) out.push([x, 5 + k, z, k === 3 ? B.planks : B.planks, 0]);
    if (Math.abs(x) === 4) for (let z = -3 + k; z <= 3 - k; z++) out.push([x, 5 + k, z, B.planks, 0]);
  }
  for (let y = 1; y <= 10; y++) out.push([3, y, 2, B.bricks, 0]);
  out.push([-1, 3, -4, B.lantern, 0], [1, 3, -4, B.lantern, 0]);
  for (let x = -6; x <= 6; x++) for (const z of [-7, 6]) if (!(z === -7 && Math.abs(x) <= 1)) out.push([x, 1, z, B.fence, 0]);
  for (let z = -6; z <= 5; z++) for (const x of [-6, 6]) out.push([x, 1, z, B.fence, 0]);
  for (let z = -7; z <= -4; z++) out.push([0, 0, z, B.gravel, 0]);
  out.push([-2, 1, -5, B.pot, 1], [2, 1, -5, B.pot, 3]);
  return out;
}

// ------------------------------------------------------------------ browser
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
// The virtual clock: the game only advances when we step it.
await page.addInitScript(() => {
  let vt = 0; let q = [];
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__vstep = (ms) => { vt += ms; const cbs = q; q = []; for (const cb of cbs) { try { cb(vt); } catch (e) { console.error('frame: ' + (e && e.stack || e)); } } };
});
await page.goto(URL_);
const wait = (ms) => page.waitForTimeout(ms);
const pump = async (n = 1, ms = 33.3, real = 12) => { for (let i = 0; i < n; i++) { await page.evaluate((ms) => window.__vstep(ms), ms); if (real) await wait(real); } };
for (let i = 0; i < 600 && !(await page.evaluate(() => !!window.blockhaven)); i++) await pump(1, 33, 30);

// Settings for the best picture, silence, and a fresh creative world on the chosen seed.
await page.evaluate((seed) => {
  const G = window.blockhaven;
  Object.assign(G.settings, { renderDistance: 16, fov: 70, fancy: true, shadows: true, post: true, autoQuality: false, viewBobbing: false, volume: 0, music: 0, minimap: false, showCoords: false, fpsCap: 0, reduceMotion: true });
  G.applySettings(G.settings);
  G.createWorld('Trailer', String(seed), 'creative');
}, plan.seed);
for (let i = 0; i < 2000 && (await page.evaluate(() => window.blockhaven.mode)) !== 'playing'; i++) await pump(1, 33, 20);

// The overlay, the camera hook and a few helpers, installed in the page.
await page.evaluate(() => {
  const G = window.blockhaven;
  G.hudHidden = true; G.hud.setVisible(false);
  const css = document.createElement('style');
  css.textContent = `
    #chatlog, #toast, #resume, #debug, #rotate-hint, #bossbar, .boss-bar, #achievement { display: none !important; }
    #tr { position: fixed; inset: 0; pointer-events: none; z-index: 9999; font-family: 'Pixelify Sans', system-ui, sans-serif; }
    #tr .bar { position: absolute; left: 0; right: 0; background: #000; }
    #tr .top { top: 0; } #tr .bot { bottom: 0; }
    #tr .fade { position: absolute; inset: 0; background: #000; }
    #tr .flash { position: absolute; inset: 0; background: #fff8ec; mix-blend-mode: screen; }
    #tr .card { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center; color: #f6eedb; font-size: 58px; font-weight: 600;
      text-shadow: 0 0 28px rgba(255, 186, 110, 0.55), 0 0 6px rgba(255, 220, 170, 0.5), 0 4px 0 rgba(0, 0, 0, 0.65); }
    #tr .logo { position: absolute; left: 0; right: 0; top: 50%; text-align: center; }
    #tr .logo .word { font-size: 210px; font-weight: 700; line-height: 1; color: #f4ead2; letter-spacing: 0.03em;
      text-shadow: 0 9px 0 #7a5334, 0 18px 0 #3d2819, 0 26px 30px rgba(0,0,0,0.6), 0 0 90px rgba(255, 170, 80, 0.55); }
    #tr .logo .sub { margin-top: 38px; font-size: 36px; letter-spacing: 0.5em; color: #ffcf7a; text-shadow: 0 3px 0 #000, 0 0 20px rgba(255,170,80,0.6); }
    #tr .logo .tag { margin-top: 26px; font-size: 26px; letter-spacing: 0.18em; color: #efe6d2; text-shadow: 0 3px 0 #000; }
    #tr .dim { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0.25), rgba(0,0,0,0.75)); }
  `;
  document.head.appendChild(css);
  const tr = document.createElement('div');
  tr.id = 'tr';
  tr.innerHTML = `<div class="dim"></div><div class="card"></div><div class="logo"><div class="word">QubeCraft</div><div class="sub">EXPLORE · BUILD · SURVIVE</div><div class="tag">Free to play in your browser &nbsp;—&nbsp; krabduke.github.io/qubecraft</div></div>
    <div class="bar top"></div><div class="bar bot"></div><div class="flash"></div><div class="fade"></div>`;
  document.body.appendChild(tr);
  const q = (s) => tr.querySelector(s);
  window.__overlay = (o) => {
    q('.top').style.height = q('.bot').style.height = o.bars + 'px';
    q('.fade').style.opacity = o.fade;
    q('.flash').style.opacity = o.flash;
    const c = q('.card');
    if (o.card) { c.textContent = o.card.text; c.style.opacity = o.card.o; c.style.letterSpacing = o.card.spacing + 'em'; c.style.marginTop = o.card.y + 'px'; } else c.style.opacity = 0;
    const l = q('.logo');
    q('.dim').style.opacity = o.logo ? Math.min(1, o.logo.o) * 0.9 : 0;
    if (o.logo) {
      l.style.opacity = o.logo.o; l.style.transform = `translateY(-58%) scale(${o.logo.scale})`;
      q('.sub').style.opacity = o.logo.sub; q('.tag').style.opacity = o.logo.tag;
    } else l.style.opacity = 0;
  };
  // The scripted camera replaces the player's view after the game places it.
  const orig = G.placeCamera.bind(G);
  let smoothBoss = null;
  G.placeCamera = (a) => {
    orig(a);
    const c = window.__cam;
    if (!c) return;
    const cam = G.renderer.camera;
    let look = c.look, pos = c.pos;
    if (look === 'boss') {
      const boss = G.entities.mobs().find((m) => m.spec.boss);
      const bp = boss ? [boss.body.pos[0], boss.body.pos[1] + 2, boss.body.pos[2]] : [0, 70, 0];
      smoothBoss = smoothBoss ? smoothBoss.map((v, i) => v + (bp[i] - v) * 0.12) : bp;
      look = smoothBoss;
      if (c.chase) { pos = [smoothBoss[0] + c.chase[0], smoothBoss[1] + c.chase[1], smoothBoss[2] + c.chase[2]]; window.__chasePos = pos; }
    }
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.up.set(0, 1, 0);
    cam.lookAt(look[0], look[1], look[2]);
    if (c.roll) cam.rotateZ(c.roll);
    if (Math.abs(cam.fov - c.fov) > 0.01) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  };
  /** Put the player (who drives chunk loading and the sky) where the camera is. */
  window.__follow = (pos) => {
    const p = G.player;
    p.creative = true; p.flying = true; p.health = 20;
    p.body.pos = [pos[0], pos[1] - 1.62, pos[2]]; p.body.vel = [0, 0, 0];
    G.prevPos = [...p.body.pos];
  };
  window.__ready = (r) => {
    const w = G.world, [px, , pz] = G.player.body.pos;
    const cx = Math.floor(px) >> 4, cz = Math.floor(pz) >> 4;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const ch = w.getChunk(cx + dx, cz + dz);
      if (!ch || ch.dirty.size) return false;
    }
    return w.pendingWork === 0;
  };
  window.__top = (x, z, r) => { const w = G.world; let t = 0; for (let dx = -r; dx <= r; dx += 4) for (let dz = -r; dz <= r; dz += 4) t = Math.max(t, w.groundY(Math.floor(x + dx), Math.floor(z + dz))); return t; };
});

// ------------------------------------------------------------------ per-shot setup in the page
async function toDimension(dim) {
  if ((await page.evaluate(() => window.blockhaven.world.dimension)) === dim) return;
  await page.evaluate((d) => window.blockhaven.runCommand('/dimension ' + d), dim);
  for (let i = 0; i < 3000; i++) {
    await pump(1, 33, 20);
    if (await page.evaluate((d) => window.blockhaven.world?.dimension === d && window.blockhaven.mode === 'playing', dim)) break;
  }
  await page.evaluate(() => { const G = window.blockhaven; G.hudHidden = true; G.hud.setVisible(false); });
}

async function settle(pos, r = 11, max = 60000) {
  const t0 = Date.now();
  await page.evaluate((p) => window.__follow(p), pos);
  while (Date.now() - t0 < max) {
    await pump(3, 16, 40);
    if (await page.evaluate((r) => window.__ready(r), r)) break;
  }
  await pump(20, 16, 20);
}

async function setup(shot) {
  await toDimension(shot.dim);
  const s = shot.setup ?? {};
  let spot;
  if (s.find) {
    spot = await page.evaluate(([b, r, slope]) => window.blockhaven.findBiomeArea(b, r, slope ?? Infinity), s.find);
    if (!spot) throw new Error('no biome for ' + shot.name);
  } else spot = [s.at.x, s.at.y, s.at.z];
  await settle([spot[0], spot[1] + 40, spot[2]]);
  // Flatten and dress a patch of ground where the shot needs one.
  const info = await page.evaluate(({ spot, s }) => {
    const G = window.blockhaven, w = G.world, E = G.entities;
    const [x, , z] = spot.map(Math.floor);
    const ground = w.groundY(x, z) - 1;
    if (s.level) {
      const r = s.level;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.hypot(dx, dz) > r + 0.5) continue;
        for (let dy = 1; dy <= 14; dy++) w.setBlock(x + dx, ground + dy, z + dz, 0);
        w.setBlock(x + dx, ground, z + dz, 2);
        for (let dy = 1; dy <= 3; dy++) if (w.getBlock(x + dx, ground - dy, z + dz) === 0) w.setBlock(x + dx, ground - dy, z + dz, 3);
      }
    }
    for (const m of E.mobs()) if (Math.hypot(m.body.pos[0] - x, m.body.pos[2] - z) < 40 && (s.meadow || s.monsters || s.house)) m.dead = true;
    const tame = (m) => { m.spec = { ...m.spec, hostile: false, ranged: false, burnsInDay: false, exploder: false }; m.target = null; m.wanderTimer = 99999; return m; };
    if (s.meadow) {
      for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
        const r = Math.abs((dx * 73 + dz * 151) % 17);
        if (r === 0 || r === 5) w.setBlock(x + dx, ground + 1, z + dz, 28);
        else if (r === 9) w.setBlock(x + dx, ground + 1, z + dz, [29, 30, 112, 154, 155][Math.abs(dx + dz) % 5]);
      }
      const herd = [['boar', 2, 1], ['woolback', -3, -2], ['hen', 1, 3], ['woolback', 5, -3], ['boar', -2, -5], ['burrowfox', 4, 2], ['hen', -5, 2], ['mossback', -7, -4], ['woolback', 7, 1]];
      for (const [k, dx, dz] of herd) { const m = E.spawnMob(k, x + dx + 0.5, ground + 1, z + dz + 0.5); m.yaw = Math.random() * 6.28; }
    }
    if (s.monsters) {
      // Torches and a campfire to light the line, and the creatures marching on it.
      for (const [dx, dz] of [[-6, 4], [6, 4], [-9, -4], [9, -4]]) { w.setBlock(x + dx, ground + 1, z + dz, 63); w.setBlock(x + dx, ground + 2, z + dz, 93); }
      w.setBlock(x + 5, ground + 1, z + 2, 193);
      const kinds = ['zombie', 'skeleton', 'raider', 'witch', 'brambler', 'frostling', 'mirewalker', 'blastcap', 'shellcrawler'];
      kinds.forEach((k, i) => {
        const off = i - (kinds.length - 1) / 2;
        const m = tame(E.spawnMob(k, x + off * 1.9 + 0.5, ground + 1, z - 9 - Math.abs(off) * 1.1 + 0.5));
        m.rally = [x + off * 1.4 + 0.5, z + 14];
        m.yaw = 0;
      });
    }
    if (s.house) {
      window.__house = s.house.map(([dx, dy, dz, id, m]) => [x + dx, ground + dy, z + dz, id, m]);
      window.__placed = 0;
    }
    if (s.boss) {
      if (!E.mobs().some((m) => m.spec.boss)) E.spawnMob('colossus', 0.5, 92, 0.5);
    }
    G.settings.brightness = s.brightness ?? 0.55; G.applySettings(G.settings);
    G.player.effects.delete('night_vision');
    if (s.nightVision) G.player.addEffect('night_vision', 999999);
    return { spot, ground, top: window.__top(x, z, 40) };
  }, { spot, s });
  return info;
}

// ------------------------------------------------------------------ stills for the README
// STILLS=name,name saves one clean frame (no bars or titles) from each named shot to docs/screenshots.
if (process.env.STILLS) {
  const want = process.env.STILLS.split(',');
  const docs = new URL('../docs/screenshots/', import.meta.url).pathname;
  for (const shot of SHOTS) {
    if (!want.includes(shot.name)) continue;
    const info = await setup(shot);
    const u = shot.still ?? 0.6;
    const c = shot.cam(u, info);
    await page.evaluate((c) => { window.__cam = c; window.__follow(c.pos); }, c);
    await settle(c.pos, 11, 40000);
    const time = typeof shot.time === 'function' ? shot.time(u) : shot.time;
    for (let i = 0; i < 45; i++) await page.evaluate(({ c, time }) => { window.__cam = c; window.__follow(c.pos); window.blockhaven.world.time = time; window.__overlay({ bars: 0, fade: 0, flash: 0, card: null, logo: null }); window.__vstep(33.33); }, { c, time });
    await page.screenshot({ path: `${docs}${shot.name}.jpg`, type: 'jpeg', quality: 86 });
    console.log('still', shot.name);
  }
  await browser.close();
  process.exit(0);
}

// ------------------------------------------------------------------ recording
const frameFile = (f) => `${OUT}${String(f).padStart(5, '0')}.jpg`;
const t0 = Date.now();
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  const f0 = Math.round(shot.bars[0] * FPB), f1 = Math.round((shot.bars[0] + shot.bars[1]) * FPB);
  if (!only && existsSync(frameFile(f1 - 1))) { console.log('skip', shot.name); continue; }
  const info = await setup(shot);
  // Put the camera at its first frame and let the view there load too.
  const c0 = shot.cam(0, info);
  await page.evaluate((c) => { window.__cam = c; window.__follow(c.pos); }, c0);
  await settle(c0.pos, 9, 30000);
  // Warm up a second of game time so creatures and water are moving when the shot opens.
  for (let i = 0; i < 30; i++) await page.evaluate((t) => { window.blockhaven.world.time = t; window.__vstep(33.33); }, typeof shot.time === 'function' ? shot.time(0) : shot.time);
  for (let f = f0; f < f1; f++) {
    const u = (f - f0) / (f1 - f0 - 1);
    const T = f / FPS;
    const o = overlay(T);
    const c = shot.cam(u, info);
    if (o.shake > 0) { const k = o.shake * 0.35; c.pos = [c.pos[0] + Math.sin(f * 12.9) * k, c.pos[1] + Math.cos(f * 17.3) * k, c.pos[2] + Math.sin(f * 7.1) * k]; }
    const time = typeof shot.time === 'function' ? shot.time(u) : shot.time;
    await page.evaluate(({ c, o, time, build, u }) => {
      const G = window.blockhaven;
      window.__cam = c; window.__follow(c.pos);
      G.world.time = ((time % 24000) + 24000) % 24000;
      if (build && window.__house) {
        const want = Math.floor(window.__house.length * Math.min(1, u * 1.15));
        while (window.__placed < want) { const [x, y, z, id, m] = window.__house[window.__placed++]; G.world.setBlock(x, y, z, id); if (m) G.world.setMeta?.(x, y, z, m); }
      }
      window.__overlay(o);
      window.__vstep(1000 / 30);
    }, { c, o, time, build: shot.frame === 'build', u });
    // Give the workers a moment so meshes keep up with the camera.
    if (f % 6 === 0) await wait(8);
    await page.screenshot({ path: frameFile(f), type: 'jpeg', quality: 94 });
  }
  console.log(`shot ${shot.name} frames ${f0}-${f1 - 1} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
}
// Black frames to the end of the music.
const last = Math.round(END * FPS);
for (let f = Math.round(44.25 * FPB); f < last; f++) if (!existsSync(frameFile(f))) {
  await page.evaluate((o) => window.__overlay(o), overlay(f / FPS));
  await page.screenshot({ path: frameFile(f), type: 'jpeg', quality: 94 });
}
writeFileSync(`${OUT}../errors.json`, JSON.stringify(errors.slice(0, 50), null, 1));
console.log('done', ((Date.now() - t0) / 60000).toFixed(1), 'min;', errors.length, 'page errors');
await browser.close();
