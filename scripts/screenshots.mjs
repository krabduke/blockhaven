// Loads the game in headless Chromium, plays through a few scenes and saves
// screenshots. Used for smoke-testing and for the README images.
//
//   npm run dev -- --port 5199   (in another terminal)
//   node scripts/screenshots.mjs [url] [outDir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5199/';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };
const game = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url);
await wait(9000);
await shot('title');

// Create a survival world with a fixed seed and wait for it to load.
await game(() => window.blockhaven.createWorld('Screenshot World', 'blockhaven', 'survival'));
for (let i = 0; i < 90; i++) {
  await wait(1000);
  if (await game(() => window.blockhaven.mode === 'playing')) break;
}
console.log('mode', await game(() => window.blockhaven.mode));

// Hide pause/menus that appear because pointer lock is unavailable headless.
const clearUi = () => game(() => { const g = window.blockhaven; g.menus.show(null); });

const view = async (name, { yaw, pitch, time, pos, settle = 6000, give } = {}) => {
  await game(({ yaw, pitch, time, pos, give }) => {
    const g = window.blockhaven;
    if (pos) { g.player.body.pos = [...pos]; g.player.body.vel = [0, 0, 0]; }
    if (yaw !== undefined) g.player.yaw = yaw;
    if (pitch !== undefined) g.player.pitch = pitch;
    if (time !== undefined) g.world.time = time;
    if (give) g.runCommand(give);
  }, { yaw, pitch, time, pos, give });
  await wait(settle);
  await clearUi();
  await wait(400);
  await shot(name);
};

await clearUi();
await game(() => window.blockhaven.runCommand('/give stone_pickaxe'));
await view('survival-day', { yaw: 0.6, pitch: -0.12, time: 2000, settle: 12000 });
await view('looking-around', { yaw: 2.4, pitch: -0.05, time: 5000 });
await view('sunset', { yaw: -1.57, pitch: 0.05, time: 12200 });
await view('night', { yaw: 1.2, pitch: 0.1, time: 18000 });

// Animals near the player.
await game(() => {
  const g = window.blockhaven, p = g.player, w = g.world;
  const base = p.body.pos;
  const spots = [['boar', 3, -6], ['woolback', -2, -7], ['hen', 1, -4], ['woolback', 5, -9], ['boar', -4, -10]];
  for (const [k, dx, dz] of spots) {
    const x = Math.floor(base[0] + dx), z = Math.floor(base[2] + dz);
    const m = g.entities.spawnMob(k, x + 0.5, w.groundY(x, z), z + 0.5);
    m.yaw = Math.random() * 6; m.wanderTimer = 400;
  }
});
await view('animals', { yaw: 0, pitch: -0.25, time: 3000, settle: 4000 });

// A lit cave: carve a room underground, light it with torches, add ores and a Mirewalker.
await game(() => {
  const g = window.blockhaven, w = g.world, p = g.player;
  const x0 = Math.floor(p.body.pos[0]), z0 = Math.floor(p.body.pos[2]), y0 = 30;
  for (let x = -6; x <= 6; x++) for (let z = -9; z <= 3; z++) for (let y = -1; y <= 5; y++) {
    const edge = x === -6 || x === 6 || z === -9 || z === 3 || y === -1 || y === 5;
    const ore = [14, 15, 16, 17][Math.abs(x * 7 + z * 13 + y * 3) % 23] ?? 1;
    w.setBlock(x0 + x, y0 + y, z0 + z, edge ? ore : (y === 0 && Math.abs(x) === 5 ? 1 : 0));
  }
  w.setBlock(x0 - 5, y0 + 1, z0 - 4, 27, 0);
  w.setBlock(x0 + 5, y0 + 1, z0 - 7, 27, 0);
  w.setBlock(x0, y0 + 1, z0 - 8, 27, 0);
  w.setBlock(x0 + 3, y0, z0 - 6, 13, 0);
  w.setBlock(x0 - 3, y0, z0 - 2, 25, 0);
  w.setBlock(x0 - 2, y0, z0 - 2, 24, 0);
  w.setBlock(x0 - 1, y0, z0 - 2, 35, 0);
  p.body.pos = [x0 + 0.5, y0, z0 + 0.5];
  const m = g.entities.spawnMob('mirewalker', x0 + 1.5, y0, z0 - 6.5);
  m.wanderTimer = 400;
  g.player.creative = true; g.player.flying = true;
  g.player.inv.slots[0] = { id: 27, count: 32 };
  g.player.selected = 0;
});
await view('cave', { yaw: 0, pitch: -0.08, time: 6000, settle: 5000 });

// Inventory and crafting table screens.
await game(() => {
  const g = window.blockhaven, p = g.player;
  p.creative = false; p.flying = true;
  const give = [[323, 1], [319, 1], [9, 24], [5, 40], [256, 12], [27, 20], [4, 64], [258, 9], [260, 3], [264, 7], [262, 4], [24, 1], [25, 1], [35, 2]];
  p.inv.slots.fill(null);
  give.forEach(([id, count], i) => { p.inv.slots[i < 9 ? i : i + 9] = { id, count }; });
  p.inv.slots[1].damage = 700;
  g.containers.show('crafting');
});
await wait(800);
await shot('crafting');
await game(() => window.blockhaven.containers.close());

// A small homestead with stairs, fences and a gate, then rain.
await game(() => {
  const g = window.blockhaven, w = g.world, p = g.player;
  p.creative = true; p.flying = true;
  const x0 = Math.floor(p.body.pos[0]) + 40, z0 = Math.floor(p.body.pos[2]);
  const y0 = w.groundY(x0, z0);
  for (let x = -7; x <= 7; x++) for (let z = -12; z <= 6; z++) {
    for (let y = 0; y <= 8; y++) w.setBlock(x0 + x, y0 + y, z0 + z, 0);
    w.setBlock(x0 + x, y0 - 1, z0 + z, 2);
    for (let y = y0 - 5; y < y0 - 1; y++) w.setBlock(x0 + x, y, z0 + z, 3);
  }
  // Cabin: cobblestone base, plank walls, stair roof.
  for (let x = -3; x <= 3; x++) for (let z = -9; z <= -4; z++) {
    const wall = Math.abs(x) === 3 || z === -9 || z === -4;
    w.setBlock(x0 + x, y0, z0 + z, wall ? 4 : 5);
    if (wall) for (let y = 1; y <= 3; y++) w.setBlock(x0 + x, y0 + y, z0 + z, (Math.abs(x) === 3 && (z === -9 || z === -4)) ? 9 : 5);
  }
  for (let z = -10; z <= -3; z++) {
    for (let k = 0; k <= 3; k++) {
      w.setBlock(x0 - 4 + k, y0 + 4 + k, z0 + z, 61, 3);
      w.setBlock(x0 + 4 - k, y0 + 4 + k, z0 + z, 61, 1);
    }
    w.setBlock(x0, y0 + 7, z0 + z, 54);
  }
  w.setBlock(x0, y0 + 1, z0 - 4, 0); w.setBlock(x0, y0 + 2, z0 - 4, 0);
  w.setBlock(x0, y0 + 2, z0 - 4, 36, 0 | 8); w.setBlock(x0, y0 + 1, z0 - 4, 36, 0);
  w.setBlock(x0 - 2, y0 + 2, z0 - 4, 11); w.setBlock(x0 + 2, y0 + 2, z0 - 4, 11);
  w.setBlock(x0 - 2, y0 + 3, z0 - 3, 27, 1); w.setBlock(x0 + 2, y0 + 3, z0 - 3, 27, 1);
  // Fenced pen with a gate, animals and a small wheat field.
  for (let x = -6; x <= 6; x++) { w.setBlock(x0 + x, y0, z0 + 4, x === 0 ? 64 : 63, 0); w.setBlock(x0 + x, y0, z0 - 1, x === 0 ? 0 : 63); }
  for (let z = -1; z <= 4; z++) { w.setBlock(x0 - 6, y0, z0 + z, 63); w.setBlock(x0 + 6, y0, z0 + z, 63); }
  for (let x = -5; x <= -1; x++) for (let z = 0; z <= 3; z++) { w.setBlock(x0 + x, y0 - 1, z0 + z, 52); w.setBlock(x0 + x, y0, z0 + z, 51, 3 + ((x + z) & 3) + 1); }
  w.setBlock(x0 - 3, y0 - 1, z0 + 2, 12);  w.setBlock(x0 - 3, y0, z0 + 2, 0);
  for (const [k, dx, dz] of [['woolback', 3, 1], ['boar', 4, 3], ['hen', 2, 2]]) { const m = g.entities.spawnMob(k, x0 + dx + 0.5, y0, z0 + dz + 0.5); m.wanderTimer = 5000; m.yaw = 2.6; }
  p.body.pos = [x0 + 7.5, y0 + 4, z0 + 12.5];
  p.armor.slots[0] = { id: 362, count: 1 }; p.armor.slots[1] = { id: 363, count: 1 };
  p.creative = false; p.flying = true;
  p.addXp(160);
  p.inv.slots[0] = { id: 283, count: 1, ench: [{ id: 'power', level: 3 }] };
  p.selected = 0;
});
await view('homestead', { yaw: 0.45, pitch: -0.22, time: 4000, settle: 6000 });
await game(() => window.blockhaven.runCommand('/weather rain'));
await game(() => { window.blockhaven.renderer.rain = 1; });
await view('rain', { yaw: 0.45, pitch: -0.1, time: 5000, settle: 3000 });
await game(() => window.blockhaven.runCommand('/weather clear'));
await game(() => { window.blockhaven.renderer.rain = 0; });

// Night raid: hostile mobs near the homestead.
await game(() => {
  const g = window.blockhaven, p = g.player, w = g.world;
  const [px, , pz] = p.body.pos;
  for (const [k, dx, dz] of [['mirewalker', -3, -7], ['brambler', 2, -9], ['shellcrawler', -1, -5]]) {
    const x = Math.floor(px + dx), z = Math.floor(pz + dz);
    const m = g.entities.spawnMob(k, x + 0.5, w.groundY(x, z), z + 0.5);
    m.yaw = Math.PI * 0; m.wanderTimer = 5000;
  }
  g.player.creative = true;
  p.body.pos[1] = w.groundY(Math.floor(px), Math.floor(pz)) + 1;
  w.setBlock(Math.floor(px) - 2, Math.floor(p.body.pos[1]), Math.floor(pz) - 3, 27, 0);
});
await view('night-raid', { yaw: 0, pitch: -0.12, time: 17500, settle: 2500 });

// Enchanting screen.
await game(() => {
  const g = window.blockhaven, p = g.player;
  p.creative = false;
  p.inv.slots[1] = { id: 320, count: 1 };
  g.containers.show('enchant', { bookshelves: 12 });
});
await wait(500);
await page.mouse.move(10, 10);
{
  const slots = await page.$$('#container .slot');
  await slots[29].click();
  await wait(100);
  await slots[0].click();
  await wait(400);
}
await shot('enchanting');
await game(() => { window.blockhaven.containers.close(); window.blockhaven.player.creative = true; });

// Mountains and a desert from the air.
const flyTo = async (name, biomeIds, yaw, lift = 14, back = 20, pitch = -0.3) => {
  const found = await game((biomes) => window.blockhaven.findBiome(biomes), biomeIds);
  if (!found) { console.log('no biome for', name); return; }
  await game(([x, h, z, lift, back]) => { const g = window.blockhaven; g.player.creative = true; g.player.flying = true; g.player.body.pos = [x + 0.5, h + lift, z + back + 0.5]; }, [...found, lift, back]);
  await view(name, { yaw, pitch, time: 4500, settle: 25000 });
};
await flyTo('mountains', [5], 0, 45, 60, -0.28);
await flyTo('desert', [3], 0);
await flyTo('snowy-taiga', [4], 0);

// A village from above, then the Emberdeep.
const vloc = await game(() => {
  const g = window.blockhaven;
  const log = [];
  const orig = g.say.bind(g); g.say = (t) => { log.push(t); orig(t); };
  g.runCommand('/locate village');
  g.say = orig;
  const m = /at (-?\d+), (-?\d+)/.exec(log.join(' '));
  return m ? [+m[1], +m[2]] : null;
});
if (vloc) {
  await game(([x, z]) => { const g = window.blockhaven; g.player.creative = true; g.player.flying = true; g.player.body.pos = [x + 22.5, 110, z + 22.5]; }, vloc);
  await wait(20000);
  await game(([x, z]) => { const g = window.blockhaven; g.player.body.pos[1] = g.world.groundY(x, z) + 14; }, vloc);
  await view('village', { yaw: Math.PI * 0.25, pitch: -0.45, time: 4500, settle: 8000 });
  await game(([x, z]) => { const g = window.blockhaven; const y = g.world.groundY(x + 6, z + 6); g.player.body.pos = [x + 6.5, y + 1.5, z + 6.5]; }, vloc);
  await view('village-street', { yaw: Math.PI * 0.25, pitch: -0.08, time: 5000, settle: 5000 });
}
await game(() => window.blockhaven.runCommand('/dimension ember'));
for (let i = 0; i < 90; i++) { await wait(1000); if (await game(() => window.blockhaven.dimension === 'ember' && window.blockhaven.mode === 'playing')) break; }
await game(() => { const g = window.blockhaven; g.player.creative = true; g.player.flying = true; const [x, y, z] = g.player.body.pos; g.player.body.pos = [x + 3, y + 2, z + 3]; g.entities.spawnMob('emberwisp', x + 4, y + 5, z - 8); g.entities.spawnMob('cinderbrute', x + 1, y, z - 6); });
await view('emberdeep-2', { yaw: 2.6, pitch: 0.05, settle: 4000 });

// Debug stats for the log.
console.log(await game(() => {
  const g = window.blockhaven;
  return JSON.stringify({ fps: g.fps, chunks: g.world.chunks.size, meshes: g.renderer.meshCount, pos: g.player.body.pos.map((v) => v.toFixed(1)), calls: g.renderer.gl.info.render.calls });
}));

console.log('--- console errors/warnings ---');
console.log(errors.slice(0, 40).join('\n') || '(none)');
await browser.close();
