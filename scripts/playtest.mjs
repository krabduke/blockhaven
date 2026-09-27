// Automated in-browser playtest: exercises mining, placing, pickup, water,
// mobs, combat, lighting and save/load through the real game, and reports
// pass/fail for each check.
//
//   node scripts/playtest.mjs [url]

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5199/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
const g = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

await page.goto(url);
await wait(4000);
await g(() => window.blockhaven.createWorld('Playtest', 'playtest-seed', 'survival'));
for (let i = 0; i < 90; i++) { await wait(1000); if (await g(() => window.blockhaven.mode === 'playing')) break; }
check('world loads', await g(() => window.blockhaven.mode === 'playing'));
await g(() => window.blockhaven.menus.show(null));
await wait(3000);

// Stand still at the player's spot; find the block underfoot.
const setup = await g(() => {
  const G = window.blockhaven, p = G.player;
  const x = Math.floor(p.body.pos[0]), z = Math.floor(p.body.pos[2]);
  const y = G.world.groundY(x, z) - 1;
  p.body.pos = [x + 0.5, y + 1, z + 0.5];
  p.body.vel = [0, 0, 0];
  return { x, y, z, id: G.world.getBlock(x, y, z) };
});
console.log('standing on', setup);

// --- Mining: clear a 3x3 area around the player first so nothing blocks the view, then dig the block in front.
const mined = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, w = G.world, p = G.player;
  // Make a flat test pad of dirt with air above.
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    for (let dy = 1; dy <= 4; dy++) w.setBlock(x + dx, y + dy, z + dz, 0);
    w.setBlock(x + dx, y, z + dz, 3 /* dirt */);
  }
  p.body.pos = [x + 0.5, y + 1, z + 0.5];
  p.yaw = 0; p.pitch = -0.9; // look down at the block in front (-z)
  await new Promise((r) => setTimeout(r, 1500));
  const tgt = G.target ? G.target.pos : null;
  G.mouse[0] = true;
  await new Promise((r) => setTimeout(r, 2500));
  G.mouse[0] = false;
  return { tgt, after: tgt ? w.getBlock(tgt[0], tgt[1], tgt[2]) : -1 };
}, setup);
check('targets a block when looking at it', !!mined.tgt, JSON.stringify(mined.tgt));
check('mining removes the block', mined.after === 0);
await wait(2500);
const dirtCount = await g(() => window.blockhaven.player.inv.count(3));
check('broken block drops and is picked up', dirtCount >= 1, `dirt in inventory: ${dirtCount}`);

// --- Placing.
const placed = await g(async () => {
  const G = window.blockhaven, p = G.player;
  const slot = p.inv.slots.findIndex((s) => s && s.id === 3);
  p.selected = slot;
  p.pitch = -0.9;
  await new Promise((r) => setTimeout(r, 800));
  const t = G.target;
  if (!t) return { ok: false, why: 'no target' };
  const pos = [t.pos[0] + t.normal[0], t.pos[1] + t.normal[1], t.pos[2] + t.normal[2]];
  G.use();
  return { ok: G.world.getBlock(pos[0], pos[1], pos[2]) === 3, pos };
});
check('placing puts a block where you aim', placed.ok, JSON.stringify(placed));

// --- Water flows from a source.
const water = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, w = G.world;
  w.setBlock(x + 2, y + 1, z + 2, 12, 0);
  await new Promise((r) => setTimeout(r, 4000));
  let n = 0;
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (w.getBlock(x + dx, y + 1, z + dz) === 12) n++;
  return n;
}, setup);
check('water spreads from a source block', water > 5, `${water} water cells`);

// --- Torch lights the area.
const torch = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, w = G.world;
  // Test in a sealed stone box so water and sky light don't interfere.
  const bx = x + 20, by = y + 30, bz = z;
  for (let dx = -1; dx <= 5; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) w.setBlock(bx + dx, by + dy, bz + dz, 1);
  for (let dx = 0; dx <= 4; dx++) w.setBlock(bx + dx, by, bz, 0);
  w.setBlock(bx, by, bz, 27, 0);
  await new Promise((r) => setTimeout(r, 300));
  return { at: w.getBlockLight(bx, by, bz), near: w.getBlockLight(bx + 3, by, bz) };
}, setup);
check('torch emits block light 14 and falls off', torch.at === 14 && torch.near === 11, JSON.stringify(torch));

// --- Mobs and combat.
const combat = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, p = G.player;
  p.body.pos = [x + 0.5, y + 1, z + 0.5];
  p.yaw = 0; p.pitch = -0.25;
  G.runCommand('/give diamond_sword');
  p.selected = p.inv.slots.findIndex((s) => s && s.id === 323);
  const mob = G.entities.spawnMob('boar', x + 0.5, y + 1, z - 1.5);
  await new Promise((r) => setTimeout(r, 600));
  const before = mob.health;
  const aim = () => {
    const e = p.eye(), m = mob.body.pos;
    const dx = m[0] - e[0], dy = m[1] + 0.45 - e[1], dz = m[2] - e[2];
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  for (let i = 0; i < 4 && mob.deathTime === 0; i++) {
    // Walk up to it if it ran off, then swing.
    const m = mob.body.pos;
    p.body.pos = [m[0], m[1], m[2] + 1.8];
    aim();
    G.attack();
    await new Promise((r) => setTimeout(r, 700));
  }
  await new Promise((r) => setTimeout(r, 2500));
  return { before, after: mob.health, dead: mob.dead || mob.deathTime > 0, drops: G.entities.list.filter((e) => e.stack && e.stack.id === 263).length + p.inv.count(263) };
}, setup);
check('attacking a mob damages and kills it', combat.dead, JSON.stringify(combat));
check('killed boar drops raw pork', combat.drops >= 1);

// --- Hostile mob hurts the player.
const hurt = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, p = G.player;
  p.health = 20; p.body.pos = [x + 0.5, y + 1, z + 0.5];
  G.world.time = 18000;
  const m = G.entities.spawnMob('mirewalker', x + 0.5, y + 1, z + 2.5);
  await new Promise((r) => setTimeout(r, 4000));
  m.dead = true;
  G.world.time = 6000;
  return p.health;
}, setup);
check('a Mirewalker attacks the player at night', hurt < 20, `health ${hurt}`);

// --- Batch 2 features.
const feats = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, p = G.player, w = G.world, E = G.entities;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  // Clear an arena.
  for (let dx = -8; dx <= 8; dx++) for (let dz = -12; dz <= 4; dz++) {
    for (let dy = 1; dy <= 5; dy++) w.setBlock(x + dx, y + dy, z + dz, 0);
    w.setBlock(x + dx, y, z + dz, 2);
  }
  await sleep(500);
  p.body.pos = [x + 0.5, y + 1, z + 0.5];
  // Bow: shoot a boar 8 blocks away.
  p.inv.slots.fill(null);
  p.inv.slots[0] = { id: 283, count: 1 };
  p.inv.slots[1] = { id: 284, count: 8 };
  p.selected = 0;
  const target = E.spawnMob('boar', x + 0.5, y + 1, z - 7.5);
  target.wanderTimer = 1000; target.target = null;
  await sleep(400);
  const e = p.eye(), m = target.body.pos;
  p.yaw = Math.atan2(-(m[0] - e[0]), -(m[2] - e[2]));
  p.pitch = Math.atan2(m[1] + 0.4 - e[1], Math.hypot(m[0] - e[0], m[2] - e[2])) + 0.03;
  G.mouse[2] = true; G.use();
  await sleep(1300);
  G.mouse[2] = false; G.releaseBow();
  await sleep(1500);
  out.bowArrowsLeft = p.inv.count(284);
  out.boarHealth = target.health;
  target.dead = true;
  // Shearing.
  const sheep = E.spawnMob('woolback', x + 0.5, y + 1, z - 2);
  sheep.wanderTimer = 1000;
  p.inv.slots[2] = { id: 285, count: 1 }; p.selected = 2;
  const res = sheep.interact(E, p.held);
  out.sheared = res === 'sheared' && sheep.sheared;
  // Breeding.
  const a1 = E.spawnMob('boar', x + 2.5, y + 1, z - 3.5), a2 = E.spawnMob('boar', x + 3.5, y + 1, z - 3.5);
  a1.interact(E, { id: 293, count: 1 }); a2.interact(E, { id: 293, count: 1 });
  await sleep(3000);
  out.babies = E.mobs().filter((mm) => mm.spec.kind === 'boar' && mm.baby).length;
  // Bone meal on wheat.
  w.setBlock(x - 3, y, z - 3, 52); w.setBlock(x - 3, y + 1, z - 3, 51, 0);
  w.boneMeal(x - 3, y + 1, z - 3); w.boneMeal(x - 3, y + 1, z - 3); w.boneMeal(x - 3, y + 1, z - 3); w.boneMeal(x - 3, y + 1, z - 3);
  out.wheatStage = w.getMeta(x - 3, y + 1, z - 3);
  // Armor.
  p.armor.slots[1] = { id: 363, count: 1 };
  p.health = 20; p.invulnerable = 0;
  p.damage(10, 'mirewalker');
  out.healthAfterArmoredHit = p.health;
  // Weather.
  G.runCommand('/weather rain');
  out.weather = w.weather;
  // Enchanting: give levels and enchant a pickaxe through the screen.
  p.addXp(500);
  out.level = p.xpLevel;
  // Dungeon chest loot fills on first open.
  w.setBlock(x + 4, y + 1, z + 2, 35, 16);
  const be = w.getBlockEntity(x + 4, y + 1, z + 2);
  out.lootItems = be.inv.slots.filter(Boolean).length;
  G.runCommand('/weather clear');
  return out;
}, setup);
check('bow shoots an arrow that hurts a mob', feats.bowArrowsLeft === 7 && feats.boarHealth < 10, JSON.stringify({ arrows: feats.bowArrowsLeft, hp: feats.boarHealth }));
check('shears shear a woolback', feats.sheared);
check('feeding two boars makes a baby', feats.babies >= 1, `babies: ${feats.babies}`);
check('bone meal grows wheat', feats.wheatStage >= 7, `stage ${feats.wheatStage}`);
check('diamond chestplate reduces damage', Math.abs(feats.healthAfterArmoredHit - 13.2) < 0.01, `health ${feats.healthAfterArmoredHit}`);
check('weather command starts rain', feats.weather === 'rain');
check('dungeon chests fill with loot', feats.lootItems >= 3, `${feats.lootItems} stacks`);

// Fishing: cast into a pond, force a bite, reel in.
const fished = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, p = G.player, w = G.world;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let dx = -2; dx <= 2; dx++) for (let dz = -7; dz <= -3; dz++) { w.setBlock(x + dx, y, z + dz, 12, 0); w.setBlock(x + dx, y - 1, z + dz, 1); }
  p.body.pos = [x + 0.5, y + 1, z + 0.5];
  p.inv.slots[3] = { id: 290, count: 1 }; p.selected = 3;
  p.yaw = 0; p.pitch = -0.3;
  const before = p.inv.count(291) + p.inv.slots.filter((s) => s && s.id !== 291 && s.id !== 290 && s.id !== 283 && s.id !== 284 && s.id !== 285).length;
  G.use();
  await sleep(2500);
  const b = G.bobber;
  const state = b ? b.state : 'none';
  if (b) { b.waitTicks = 1; }
  await sleep(300);
  const biting = b ? b.biteTicks > 0 : false;
  G.use();
  await sleep(2500);
  const after = p.inv.count(291) + p.inv.slots.filter((s) => s && s.id !== 291 && s.id !== 290 && s.id !== 283 && s.id !== 284 && s.id !== 285).length;
  return { state, biting, caught: after - before };
}, setup);
check('fishing: bobber floats, bites, and reeling in catches something', fished.state === 'floating' && fished.biting && fished.caught >= 1, JSON.stringify(fished));

// Enchanting through the UI.
const ench = await g(async () => {
  const G = window.blockhaven, p = G.player;
  p.inv.slots[5] = { id: 310, count: 1 }; // iron pickaxe
  G.containers.show('enchant', { bookshelves: 15 });
  return p.xpLevel;
});
{
  const encSlots = await page.$$('#container .slot');
  // Layout: enchant slot first, then 27 main, 9 hotbar. Hotbar slot 5 = 1 + 27 + 5.
  await encSlots[33].click();
  await wait(100);
  await encSlots[0].click();
  await wait(200);
  const opt = await page.$$('#container .enchant-opt:not([disabled])');
  if (opt.length) await opt[opt.length - 1].click();
  await wait(200);
  await encSlots[0].click();
  await wait(100);
  await encSlots[33].click();
  await wait(100);
}
const enchRes = await g((lv) => {
  const G = window.blockhaven, p = G.player;
  const s = p.inv.slots[5];
  G.containers.close();
  return { ench: s?.ench ?? null, spent: lv - p.xpLevel };
}, ench);
check('enchanting table enchants a pickaxe and spends levels', !!enchRes.ench?.length && enchRes.spent > 0, JSON.stringify(enchRes));

// --- Crafting through the inventory screen.
const crafted = await g(async () => {
  const G = window.blockhaven, p = G.player;
  p.inv.slots.fill(null);
  p.inv.slots[0] = { id: 9, count: 2 };
  G.containers.show('player');
  await new Promise((r) => setTimeout(r, 300));
  return true;
});
await wait(300);
// Pick up logs from hotbar slot 0 (last grid in the panel), put one in the craft grid, take the result.
const slots = await page.$$('#container .slot');
// Layout: 4 armor, 4 craft slots, 1 result, 27 main, 9 hotbar.
await slots[36].click(); // hotbar slot 0 = 4 armor + 4 craft + 1 result + 27 main
await wait(100);
await slots[4].click({ button: 'right' });
await wait(100);
await slots[36].click();
await wait(100);
await slots[8].click({ modifiers: ['Shift'] });
await wait(200);
const planks = await g(() => { const G = window.blockhaven; const n = G.player.inv.count(5); G.containers.close(); return n; });
check('crafting a log into planks via the inventory screen', crafted && planks === 4, `planks: ${planks}`);

// --- Save, quit, reload, and check a block change persisted.
const marker = await g(async ({ x, y, z }) => {
  const G = window.blockhaven;
  G.world.setBlock(x + 3, y + 1, z + 3, 33 /* glowstone */);
  await G.save();
  return [x + 3, y + 1, z + 3];
}, setup);
await g(() => window.blockhaven.quitToTitle());
await wait(3000);
const worldMeta = await g(async () => (await window.blockhaven.listWorlds()).find((w) => w.name === 'Playtest'));
await g((m) => window.blockhaven.play(m), worldMeta);
for (let i = 0; i < 90; i++) { await wait(1000); if (await g(() => window.blockhaven.mode === 'playing')) break; }
await wait(2000);
const persisted = await g((m) => window.blockhaven.world.getBlock(m[0], m[1], m[2]), marker);
check('block edits survive save and reload', persisted === 33, `block id ${persisted}`);
const invAfter = await g(() => window.blockhaven.player.inv.count(5));
check('inventory survives save and reload', invAfter === 4, `planks: ${invAfter}`);

console.log('\nerrors:', errors.length ? errors.join('\n') : '(none)');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
