// Plays through a set of scenes in Chromium (real GPU) and saves screenshots
// for the README. Every shot uses render distance 16 and waits until the
// terrain around the camera has finished loading.
//
//   npm run build && npx vite preview --port 5198   (in another terminal)
//   node scripts/screenshots.mjs [url] [outDir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5198/';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });

// Use the real GPU (Metal on macOS); set SOFTWARE_GL=1 to force software rendering.
const browser = await chromium.launch({
  args: process.env.SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const wait = (ms) => page.waitForTimeout(ms);
const game = (fn, arg) => page.evaluate(fn, arg);
// ONLY=name1,name2 saves just those shots (the scenes still play in order).
const only = process.env.ONLY?.split(',');
const shot = async (name) => {
  if (only && !only.includes(name)) { console.log('skipped', name); return; }
  await game(() => window.blockhaven.menus.show(null));
  await wait(500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
};

/** Wait until every chunk within the render distance is generated and meshed (or give up after `max` ms). */
const settle = async (max = 90000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    await wait(1000);
    const done = await game(() => {
      const g = window.blockhaven, w = g.world, p = g.player.body.pos;
      if (!w) return false;
      const rd = g.settings.renderDistance, pcx = Math.floor(p[0]) >> 4, pcz = Math.floor(p[2]) >> 4;
      for (let dz = -rd; dz <= rd; dz++) for (let dx = -rd; dx <= rd; dx++) {
        if (dx * dx + dz * dz > rd * rd) continue;
        const c = w.getChunk(pcx + dx, pcz + dz);
        if (!c || c.dirty.size) return false;
      }
      return w.pendingWork === 0;
    });
    if (done) break;
  }
  await wait(1500);
};

/** Show or hide the HUD and hand. Landscape shots hide them. */
const hud = (show) => game((show) => { const g = window.blockhaven; g.hudHidden = !show; g.hud.setVisible(show); }, show);

const setTime = (t) => game((t) => { window.blockhaven.world.time = t; }, t);

/**
 * Aerial view of a target: the camera sits `dist` blocks away in the direction `yaw` points away from,
 * high enough to clear any ground between it and the target, and looks down at the target.
 */
const aerial = async (name, target, { dist = 60, height = 30, yaw = 0, time = 5000, aim = 0, capture = true } = {}) => {
  const [tx, tz] = target;
  // Go above the target first so its chunks load.
  await game(([tx, tz]) => { const g = window.blockhaven; g.player.creative = true; g.player.flying = true; g.player.body.pos = [tx + 0.5, 180, tz + 0.5]; g.player.body.vel = [0, 0, 0]; }, [tx, tz]);
  await settle();
  await game(([tx, tz, dist, height, yaw, aim]) => {
    const g = window.blockhaven, w = g.world;
    const cx = tx + Math.sin(yaw) * dist, cz = tz + Math.cos(yaw) * dist;
    let top = 0;
    for (let k = 0; k <= 20; k++) {
      const x = Math.floor(cx + (tx - cx) * k / 20), z = Math.floor(cz + (tz - cz) * k / 20);
      top = Math.max(top, w.groundY(x, z));
    }
    const ty = w.groundY(Math.floor(tx), Math.floor(tz)) + aim;
    const cy = Math.max(top, ty) + height;
    g.player.body.pos = [cx, cy, cz];
    g.player.yaw = Math.atan2(-(tx - cx), -(tz - cz));
    g.player.pitch = Math.atan2(ty - (cy + 1.6), Math.hypot(tx - cx, tz - cz));
  }, [tx, tz, dist, height, yaw, aim]);
  await setTime(time);
  await settle(40000);
  if (capture) await shot(name);
};

/** Fly to a spot and wait for its chunks, so edits made there actually land. */
const visit = async ([x, z]) => {
  await game(([x, z]) => { const g = window.blockhaven; g.player.creative = true; g.player.flying = true; g.player.body.pos = [x + 0.5, 150, z + 0.5]; g.player.body.vel = [0, 0, 0]; }, [x, z]);
  await settle();
};

await page.goto(url);
await wait(14000);
// The title shot keeps the menu (shot() would hide it).
if (!only || only.includes('title')) { await page.screenshot({ path: `${out}/title.png` }); console.log('saved title'); }

// A creative world with a fixed seed, render distance 16.
await game(() => {
  const g = window.blockhaven;
  g.settings.renderDistance = 16;
  g.applySettings(g.settings);
  g.createWorld('Screenshots', 'blockhaven', 'creative');
});
for (let i = 0; i < 120; i++) { await wait(1000); if (await game(() => window.blockhaven.mode === 'playing')) break; }
await hud(false);

// Village at golden hour, then down in the street.
const vloc = await game(() => {
  const g = window.blockhaven, log = [];
  const say = g.chat.say.bind(g.chat); g.chat.say = (t) => { log.push(t); say(t); };
  g.runCommand('/locate village');
  g.chat.say = say;
  const m = /at (-?\d+), (-?\d+)/.exec(log.join(' '));
  return m ? [+m[1], +m[2]] : null;
});
if (vloc) {
  await aerial('village', vloc, { dist: 46, height: 24, yaw: 0.6, time: 10400 });
  await game(([x, z]) => { const g = window.blockhaven; const y = g.world.groundY(x + 7, z + 7); g.player.body.pos = [x + 7.5, y + 0.6, z + 7.5]; g.player.yaw = 0.8; g.player.pitch = -0.05; }, vloc);
  await setTime(10800);
  await settle(20000);
  await shot('village-street');
}

// Biomes from the air, each aimed at the middle of the biome.
const biome = (ids, slope = Infinity) => game(([ids, slope]) => window.blockhaven.findBiomeArea(ids, 40, slope), [ids, slope]);
const sites = {
  blossom: await biome([14], 10), jungle: await biome([13], 12), badlands: await biome([12]),
  mountains: await biome([5]), taiga: await biome([4]), desert: await biome([3]),
};
console.log('sites', JSON.stringify(sites));
if (sites.blossom) await aerial('blossom', [sites.blossom[0], sites.blossom[2]], { dist: 40, height: 20, yaw: 0.9, time: 4500 });
if (sites.jungle) await aerial('jungle', [sites.jungle[0], sites.jungle[2]], { dist: 50, height: 22, yaw: 2.2, time: 5000 });
if (sites.badlands) await aerial('badlands', [sites.badlands[0], sites.badlands[2]], { dist: 70, height: 26, yaw: 1.2, time: 9800 });
if (sites.mountains) await aerial('mountains', [sites.mountains[0], sites.mountains[2]], { dist: 110, height: 10, yaw: 0.3, time: 4200, aim: 20 });
if (sites.taiga) await aerial('snowy-taiga', [sites.taiga[0], sites.taiga[2]], { dist: 50, height: 20, yaw: 1.8, time: 5500 });
if (sites.desert) await aerial('desert', [sites.desert[0], sites.desert[2]], { dist: 60, height: 22, yaw: 0.4, time: 7000 });

// Sunset and a moonlit night over open country.
const plains = await biome([1, 2], 8);
if (plains) {
  // In the evening the sun sits toward -x; a camera on the +x side of the target faces it.
  await aerial('sunset', [plains[0], plains[2]], { dist: 70, height: 26, yaw: Math.PI / 2, time: 11400, capture: false });
  await game(() => { window.blockhaven.player.pitch = -0.05; });
  await settle(5000);
  await shot('sunset');
  // Early in the night the moon rises toward +x.
  await setTime(14600);
  await game(() => { const g = window.blockhaven; g.player.yaw = -Math.PI / 2; g.player.pitch = 0.18; });
  await settle(5000);
  await shot('night');
}

// Animals grazing.
if (plains) {
  await visit([plains[0], plains[2]]);
  await game(([x, z]) => {
    const g = window.blockhaven, w = g.world;
    // Level a small meadow so nothing blocks the view, then scatter animals facing the camera.
    const y = w.groundY(x, z) - 1;
    for (let dx = -9; dx <= 9; dx++) for (let dz = -16; dz <= 12; dz++) {
      for (let dy = 1; dy <= 8; dy++) w.setBlock(x + dx, y + dy, z + dz, 0);
      w.setBlock(x + dx, y, z + dz, 2);
      if ((dx * 7 + dz * 13) % 5 === 0) w.setBlock(x + dx, y + 1, z + dz, 28);
      else if ((dx * 11 + dz * 3) % 23 === 0) w.setBlock(x + dx, y + 1, z + dz, [29, 30, 112, 154][Math.abs(dx + dz) % 4]);
    }
    g.player.body.pos = [x + 0.5, y + 2.4, z + 9.5];
    g.player.yaw = 0; g.player.pitch = -0.2;
    const spots = [['boar', 2, 2], ['woolback', -3, -1], ['hen', 0, 4], ['woolback', 4, -4], ['boar', -2, -6], ['burrowfox', 5, 1], ['hen', -4, 3]];
    for (const [k, dx, dz] of spots) {
      const m = g.entities.spawnMob(k, x + dx + 0.5, y + 1, z + dz + 0.5);
      m.yaw = Math.PI + (Math.random() - 0.5) * 1.6; m.wanderTimer = 4000; m.target = null;
    }
  }, [plains[0], plains[2]]);
  await setTime(5500);
  await settle(10000);
  await shot('animals');
}

// Line-ups: the monsters by day (tamed for the photo), then villagers of every trade.
const lineup = async (name, kinds, dist, height) => {
  await visit([plains[0], plains[2]]);
  await game(([x, z, kinds, dist, height]) => {
    const g = window.blockhaven, w = g.world;
    for (const e of g.entities.list) if (e.spec) e.dead = true;
    const y = w.groundY(x, z) - 1;
    for (let dx = -12; dx <= 12; dx++) for (let dz = -16; dz <= 12; dz++) {
      for (let dy = 1; dy <= 8; dy++) w.setBlock(x + dx, y + dy, z + dz, 0);
      w.setBlock(x + dx, y, z + dz, 2);
      if ((dx * 7 + dz * 13) % 7 === 0 && Math.abs(dz + 3) > 2) w.setBlock(x + dx, y + 1, z + dz, 28);
    }
    const gap = 2.3;
    kinds.forEach((k, i) => {
      const [kind, prof] = k.split(':');
      const off = i - (kinds.length - 1) / 2;
      const m = g.entities.spawnMob(kind, x + 0.5 + off * gap, y + 1, z - 3 + 0.5 + Math.abs(off) * 0.5, prof);
      m.spec = { ...m.spec, hostile: false, ranged: false, burnsInDay: false, exploder: false };
      m.yaw = Math.PI - off * 0.12; m.wanderTimer = 99999; m.target = null;
    });
    g.player.flying = true;
    g.player.body.pos = [x + 0.5, y + 1 + height, z - 3 + dist];
    g.player.yaw = 0; g.player.pitch = -0.16;
  }, [plains[0], plains[2], kinds, dist, height]);
  await setTime(4200);
  await settle(8000);
  await wait(1500);
  await shot(name);
};
if (plains) {
  await lineup('creatures', ['frostling', 'zombie', 'brambler', 'witch', 'skeleton', 'blastcap', 'mirewalker', 'shellcrawler'], 11.5, 0.6);
  await lineup('villagers', ['villager:farmer', 'villager:fisher', 'villager:librarian', 'stonewarden', 'villager:cleric', 'villager:smith', 'villager:butcher'], 10, 0.5);
}

// Gameplay shots keep the HUD: a torch-lit cave with ore, crafting and enchanting screens, a night raid.
await hud(true);
await visit([0, 0]);
await game(() => {
  const g = window.blockhaven, w = g.world, p = g.player;
  const x0 = Math.floor(p.body.pos[0]), z0 = Math.floor(p.body.pos[2]), y0 = 30;
  // An irregular cavern: an ellipsoid with noise, stone walls with scattered ore, dripstone,
  // glowmoss, a lava pool, and a small mining camp.
  const h = (a, b, c) => { let n = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return n - Math.floor(n); };
  for (let x = -12; x <= 12; x++) for (let z = -16; z <= 6; z++) for (let y = -4; y <= 9; y++) {
    const d = Math.hypot(x / 11, (z + 5) / 11, (y - 2) / 6) + (h(x, y, z) - 0.5) * 0.12;
    const wx = x0 + x, wy = y0 + y, wz = z0 + z;
    if (d < 1) { w.setBlock(wx, wy, wz, y <= -2 ? 1 : 0); continue; }
    if (d < 1.25) {
      const r = h(x + 3, y + 7, z + 1);
      w.setBlock(wx, wy, wz, r < 0.02 ? 17 : r < 0.06 ? 15 : r < 0.11 ? 14 : r < 0.13 ? 16 : r < 0.35 ? 120 : r < 0.5 ? 116 : 1);
    }
  }
  // Floor dressing, ceiling dripstone and glowmoss.
  for (let x = -10; x <= 10; x++) for (let z = -14; z <= 4; z++) {
    let floor = -1, ceil = -1;
    for (let y = -3; y <= 8; y++) { if (w.getBlock(x0 + x, y0 + y, z0 + z) === 0) { if (floor < 0) floor = y; ceil = y; } }
    if (floor < 0) continue;
    const r = h(x, 1, z);
    if (r < 0.08) w.setBlock(x0 + x, y0 + ceil, z0 + z, 137);
    else if (r < 0.13) { for (let k = 0; k < 3; k++) w.setBlock(x0 + x, y0 + ceil - k, z0 + z, 138); }
    if (r > 0.97) w.setBlock(x0 + x, y0 + floor, z0 + z, 102 + (x & 1));
  }
  for (let x = 3; x <= 6; x++) for (let z = -11; z <= -8; z++) w.setBlock(x0 + x, y0 - 2, z0 + z, 13, 0);
  w.setBlock(x0 - 3, y0 - 1, z0 - 1, 25, 3); w.setBlock(x0 - 2, y0 - 1, z0 - 1, 24, 3); w.setBlock(x0 - 4, y0 - 1, z0 - 1, 35, 3);
  for (const [dx, dz] of [[-5, -6], [2, -13], [-1, 0], [7, -3]]) w.setBlock(x0 + dx, y0 - 1, z0 + dz, 27, 0);
  p.body.pos = [x0 + 0.5, y0 - 1, z0 + 3.5]; p.yaw = 0.15; p.pitch = -0.12;
  p.creative = true; p.flying = false;
  p.inv.slots[0] = { id: 320, count: 1 }; p.inv.slots[1] = { id: 27, count: 32 }; p.selected = 0;
  const m = g.entities.spawnMob('mirewalker', x0 - 2.5, y0 - 1, z0 - 10.5);
  m.wanderTimer = 4000; m.yaw = 0.3;
});
await settle(15000);
await shot('cave');

await game(() => {
  const g = window.blockhaven, p = g.player;
  const give = [[323, 1], [319, 1], [9, 24], [5, 40], [256, 12], [27, 20], [4, 64], [258, 9], [260, 3], [264, 7], [262, 4], [24, 1], [25, 1], [35, 2]];
  p.inv.slots.fill(null);
  give.forEach(([id, count], i) => { p.inv.slots[i < 9 ? i : i + 9] = { id, count }; });
  p.inv.slots[1].damage = 700;
  g.containers.show('crafting');
});
await wait(800);
await page.mouse.move(5, 5);
if (!only || only.includes('crafting')) { await page.screenshot({ path: `${out}/crafting.png` }); console.log('saved crafting'); }
await game(() => window.blockhaven.containers.close());
await game(() => { const g = window.blockhaven; g.player.addXp(160); g.player.inv.slots[1] = { id: 320, count: 1 }; g.containers.show('enchant', { bookshelves: 12 }); });
await wait(500);
{
  const slots = await page.$$('#container .slot');
  await slots[29].click(); await wait(100); await slots[0].click(); await wait(400);
}
await page.mouse.move(5, 5);
if (!only || only.includes('enchanting')) { await page.screenshot({ path: `${out}/enchanting.png` }); console.log('saved enchanting'); }
await game(() => window.blockhaven.containers.close());

// Night raid: a torch-lit clearing on the plains with monsters closing in.
if (plains) {
  await visit([plains[0], plains[2]]);
  await game(([x, z]) => {
    const g = window.blockhaven, w = g.world, p = g.player;
    const y = w.groundY(x, z) - 1;
    for (let dx = -10; dx <= 10; dx++) for (let dz = -18; dz <= 8; dz++) {
      for (let dy = 1; dy <= 8; dy++) w.setBlock(x + dx, y + dy, z + dz, 0);
      w.setBlock(x + dx, y, z + dz, 2);
      if ((dx * 7 + dz * 13) % 6 === 0) w.setBlock(x + dx, y + 1, z + dz, 28);
    }
    for (const e of g.entities.list) if (e.spec) e.dead = true;
    for (const [dx, dz] of [[-3, -2], [3, -5], [-5, -10], [4, -12]]) { w.setBlock(x + dx, y + 1, z + dz, 63); w.setBlock(x + dx, y + 2, z + dz, 93); }
    p.creative = true; p.flying = false;
    p.body.pos = [x + 0.5, y + 1, z + 6.5]; p.yaw = 0; p.pitch = -0.08;
    p.inv.slots[0] = { id: 323, count: 1 }; p.selected = 0;
    for (const [k, dx, dz] of [['zombie', -2, -4], ['skeleton', 3, -8], ['shellcrawler', 0, -1], ['witch', 5, -4], ['blastcap', -6, -5], ['mirewalker', -1, -12]]) {
      const m = g.entities.spawnMob(k, x + dx + 0.5, y + 1, z + dz + 0.5);
      m.wanderTimer = 4000; m.yaw = Math.PI; m.target = null;
    }
  }, [plains[0], plains[2]]);
  await setTime(15500);
  // They were spawned in daylight; put out any that caught fire before night fell.
  await game(() => { for (const e of window.blockhaven.entities.list) if (e.spec) e.burning = 0; });
  await settle(8000);
  await shot('night-raid');
}

// The Emberdeep.
await hud(false);
await game(() => window.blockhaven.runCommand('/dimension ember'));
for (let i = 0; i < 120; i++) { await wait(1000); if (await game(() => window.blockhaven.dimension === 'ember' && window.blockhaven.mode === 'playing')) break; }
await game(() => { const g = window.blockhaven; g.player.creative = true; g.player.flying = true; const [x, y, z] = g.player.body.pos; g.player.body.pos = [x + 3, y + 3, z + 3]; g.player.yaw = 2.6; g.player.pitch = -0.05; g.entities.spawnMob('emberwisp', x - 6, y + 6, z - 10); });
await settle(30000);
await shot('emberdeep');

console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : '(none)');
await browser.close();
