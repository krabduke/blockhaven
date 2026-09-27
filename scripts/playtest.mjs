// Automated in-browser playtest: exercises mining, placing, pickup, water,
// mobs, combat, lighting and save/load through the real game, and reports
// pass/fail for each check.
//
//   node scripts/playtest.mjs [url]

import { chromium } from 'playwright';

// NORENDER=1 runs the game without drawing (for machines without a GPU, like CI): the checks
// exercise game logic, which then runs at full speed even under software rendering.
const url = (process.argv[2] ?? 'http://localhost:5199/') + (process.env.NORENDER ? '?norender' : '');
// Use the real GPU (Metal on macOS); set SOFTWARE_GL=1 to force software rendering.
const browser = await chromium.launch({
  args: process.env.SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
const g = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// Headless Chromium grants pointer lock on some platforms (Linux) and not others (macOS). The
// checks drive input through the game directly, so make it consistent: no real pointer lock.
await page.addInitScript(() => {
  HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.reject(new Error('pointer lock disabled in playtest')); };
});
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
  // Hold right click (re-asserted like a held button, so a focus change can't cancel the draw).
  G.mouse[2] = true; G.use();
  const hold = setInterval(() => { G.mouse[2] = true; }, 50);
  await sleep(1300);
  clearInterval(hold);
  G.mouse[2] = false; G.releaseBow();
  await sleep(1500);
  out.bowArrowsLeft = p.inv.count(284);
  out.diag = { menu: G.menus.current, mode: G.mode, locked: !!document.pointerLockElement, focus: document.hasFocus(), alive: p.alive, ticks: w.tickCount };
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
check('bow shoots an arrow that hurts a mob', feats.bowArrowsLeft === 7 && feats.boarHealth < 10, JSON.stringify({ arrows: feats.bowArrowsLeft, hp: feats.boarHealth, ...feats.diag }));
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
  const itemsNear = () => G.entities.list.filter((e) => e.stack && Math.hypot(e.body.pos[0] - p.body.pos[0], e.body.pos[2] - p.body.pos[2]) < 16).length;
  const nearBefore = itemsNear();
  G.use();
  await sleep(2500);
  // The catch flies toward you; count it whether it has been picked up or is still on its way.
  const after = p.inv.count(291) + p.inv.slots.filter((s) => s && s.id !== 291 && s.id !== 290 && s.id !== 283 && s.id !== 284 && s.id !== 285).length;
  return { state, biting, caught: after - before + Math.max(0, itemsNear() - nearBefore) };
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

// --- Power: lever -> spark dust -> lamp, and a pressure plate opening a door.
const power = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, w = G.world;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const bx = x + 30, by = y + 20, bz = z;
  for (let dx = -2; dx <= 8; dx++) for (let dz = -2; dz <= 2; dz++) { w.setBlock(bx + dx, by - 1, bz + dz, 1); for (let dy = 0; dy <= 3; dy++) w.setBlock(bx + dx, by + dy, bz + dz, 0); }
  w.setBlock(bx, by, bz, 59, 0);            // lever on the floor
  for (let k = 1; k <= 5; k++) w.setBlock(bx + k, by, bz, 94, 0); // wire
  w.setBlock(bx + 6, by, bz, 57);           // lamp
  await sleep(200);
  const before = w.getBlock(bx + 6, by, bz);
  w.toggleLever(bx, by, bz);
  await sleep(300);
  const after = w.getBlock(bx + 6, by, bz);
  const wirePower = w.getMeta(bx + 5, by, bz) & 15;
  w.toggleLever(bx, by, bz);
  await sleep(300);
  const off = w.getBlock(bx + 6, by, bz);
  // Plate next to a door.
  w.setBlock(bx + 2, by, bz + 2, 96, 0);
  w.setBlock(bx + 3, by + 1, bz + 2, 36, 8); w.setBlock(bx + 3, by, bz + 2, 36, 0);
  w.setPlate(bx + 2, by, bz + 2, true);
  await sleep(200);
  const doorOpen = (w.getMeta(bx + 3, by, bz + 2) & 4) !== 0;
  w.setPlate(bx + 2, by, bz + 2, false);
  return { before, after, wirePower, off, doorOpen };
}, setup);
check('lever powers spark dust and lights a lamp', power.before === 57 && power.after === 58 && power.off === 57 && power.wirePower > 0, JSON.stringify(power));
check('pressure plate opens a door', power.doorOpen);

// --- Fire spreads to wood and burns it.
const fire = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, w = G.world;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const bx = x - 30, by = y + 20, bz = z;
  for (let dx = -1; dx <= 5; dx++) for (let dz = -1; dz <= 1; dz++) w.setBlock(bx + dx, by - 1, bz + dz, 1);
  for (let dx = 1; dx <= 4; dx++) w.setBlock(bx + dx, by, bz, 5);
  // Rain puts fire out, and the weather changes on its own timer: keep it clear for this check.
  w.weather = 'clear'; w.weatherTimer = 100000;
  w.setBlock(bx, by, bz, 70, 0);
  // Wait for game time, not wall time: headless rendering can run below 20 ticks/s. Fire can die
  // down before it catches (it's random), so relight it, as a player would, if it goes out early.
  const t0 = w.tickCount;
  let relights = 0;
  while (w.tickCount - t0 < 300) {
    await sleep(500);
    const burning = [0, 1, 2, 3, 4].some((dx) => w.getBlock(bx + dx, by, bz) === 70);
    const intact = [1, 2, 3, 4].every((dx) => w.getBlock(bx + dx, by, bz) === 5);
    if (!burning && intact && relights < 3) { w.setBlock(bx, by, bz, 70, 0); relights++; }
  }
  let planks = 0;
  for (let dx = 1; dx <= 4; dx++) if (w.getBlock(bx + dx, by, bz) === 5) planks++;
  return { planksLeft: planks };
}, setup);
check('fire spreads through and burns wooden planks', fire.planksLeft < 4, JSON.stringify(fire));

// --- New creatures can be spawned and tick without errors.
const zoo = await g(async ({ x, y, z }) => {
  const G = window.blockhaven;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const kinds = ['burrowfox', 'bogfrog', 'dunescuttler', 'frostling', 'cavemoth', 'stonewarden', 'villager', 'zombie', 'skeleton', 'witch', 'blastcap'];
  const ms = kinds.map((k, i) => G.entities.spawnMob(k, x + 0.5 + i, y + 1, z + 3.5, 'smith'));
  await sleep(2000);
  return ms.map((m) => ({ k: m.spec.kind, alive: !m.dead, y: +m.body.pos[1].toFixed(1) }));
}, setup);
check('new creatures spawn and move without errors', zoo.every((m) => m.alive), JSON.stringify(zoo));

// --- Classic monsters: a Blastcap bursts next to you, a skeleton shoots you, a witch's potion splashes you.
const monsters = await g(async ({ x, z }) => {
  const G = window.blockhaven, p = G.player, w = G.world, E = G.entities;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (const m of E.mobs()) m.dead = true;
  const bx = x + 40, bz = z + 40;
  const by = w.groundY(bx, bz) - 1;
  for (let dx = -8; dx <= 8; dx++) for (let dz = -12; dz <= 4; dz++) { for (let dy = 1; dy <= 5; dy++) w.setBlock(bx + dx, by + dy, bz + dz, 0); w.setBlock(bx + dx, by, bz + dz, 1); }
  const reset = () => { p.creative = false; p.flying = false; p.alive = true; p.health = 20; p.invulnerable = 0; p.armor.slots.fill(null); p.body.pos = [bx + 0.5, by + 1, bz + 0.5]; p.body.vel = [0, 0, 0]; };
  G.world.time = 18000;
  reset();
  const sk = E.spawnMob('skeleton', bx + 0.5, by + 1, bz - 9.5);
  let t1 = w.tickCount;
  while (w.tickCount - t1 < 160 && p.health === 20) await sleep(100);
  out.healthAfterSkeleton = p.health;
  sk.dead = true;
  reset();
  const wi = E.spawnMob('witch', bx + 0.5, by + 1, bz - 7.5);
  t1 = w.tickCount;
  while (w.tickCount - t1 < 200 && p.health === 20) await sleep(100);
  out.healthAfterWitch = p.health;
  wi.dead = true;
  reset();
  const cap = E.spawnMob('blastcap', bx + 0.5, by + 1, bz - 1.5);
  const t0 = w.tickCount;
  while (w.tickCount - t0 < 80 && !cap.dead) await sleep(100);
  out.blastcapExploded = cap.dead;
  out.healthAfterBlast = p.health;
  reset();
  G.world.time = 6000;
  return out;
}, setup);
check('a Blastcap swells up and bursts next to you', monsters.blastcapExploded && monsters.healthAfterBlast < 20, JSON.stringify(monsters));
check('a skeleton shoots you with arrows', monsters.healthAfterSkeleton < 20, `health ${monsters.healthAfterSkeleton}`);
check('a witch hits you with a splash potion', monsters.healthAfterWitch < 20, `health ${monsters.healthAfterWitch}`);

// --- Villages: find one, go there, meet villagers, trade.
const village = await g(async () => {
  const G = window.blockhaven, p = G.player;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const orig = G.chat.say.bind(G.chat); G.chat.say = (t) => { log.push(t); orig(t); };
  G.runCommand('/locate village');
  const m = /at (-?\d+), (-?\d+)/.exec(log.join(' '));
  if (!m) return { found: false, log };
  const vx = +m[1], vz = +m[2];
  p.creative = true; p.flying = true;
  p.body.pos = [vx + 0.5, 110, vz + 0.5];
  for (let i = 0; i < 60; i++) { await sleep(1000); if (G.world.isLoaded(vx, vz) && G.world.getChunk(vx >> 4, vz >> 4)?.dirty.size === 0) break; }
  await sleep(3000);
  const villagers = G.entities.mobs().filter((mm) => mm.spec.trader);
  const bell = (() => { for (let dy = -3; dy <= 8; dy++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { const gy = G.world.groundY(vx, vz); if (G.world.getBlock(vx + dx, gy + dy, vz + dz) === 115) return true; } return false; })();
  let traded = false;
  if (villagers.length) {
    const v = villagers[0];
    p.creative = false;
    const give = v.offers[0].give;
    p.inv.slots.fill(null);
    give.forEach((gv, i) => { p.inv.slots[i] = { id: gv.id, count: gv.count }; });
    G.containers.show('trade', { villager: v });
    await sleep(300);
    const btn = document.querySelector('#container .trade-opt:not([disabled])');
    if (btn) { btn.click(); await sleep(200); }
    traded = p.inv.count(v.offers[0].get.id) >= v.offers[0].get.count;
    G.containers.close();
  }
  return { found: true, vx, vz, villagers: villagers.length, bell, traded };
});
check('villages exist and have villagers and a bell', village.found && village.villagers > 0 && village.bell, JSON.stringify(village));
check('trading with a villager works', !!village.traded);

// --- Ember Gate: build a frame, light it, travel, arrive through a gate.
const ember = await g(async ({ x, y, z }) => {
  const G = window.blockhaven, w = G.world, p = G.player;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  p.creative = false; p.flying = false;
  // Build next to wherever the player is now (the village test moved them far away).
  const px = Math.floor(p.body.pos[0]), pz = Math.floor(p.body.pos[2]);
  const bx = px + 4, bz = pz + 4, by = w.groundY(bx, bz) + 1;
  void x; void y; void z;
  for (let u = -1; u <= 2; u++) for (let v = -1; v <= 3; v++) w.setBlock(bx + u, by + v, bz, (u === -1 || u === 2 || v === -1 || v === 3) ? 31 : 0);
  const lit = w.tryLightPortal(bx, by, bz);
  const portalBlocks = [0, 1].reduce((n, u) => n + [0, 1, 2].filter((v) => w.getBlock(bx + u, by + v, bz) === 69).length, 0);
  p.body.pos = [bx + 0.5, by, bz + 0.5];
  p.portalCooldown = 0;
  for (let i = 0; i < 90; i++) { await sleep(500); if (G.dimension === 'ember') break; }
  for (let i = 0; i < 90; i++) { await sleep(1000); if (G.mode === 'playing') break; }
  await sleep(2000);
  const W = G.world;
  const pos = p.body.pos.map((v) => Math.floor(v));
  let lava = 0, cinder = 0;
  for (let dx = -16; dx < 16; dx++) for (let dz = -16; dz < 16; dz++) for (let yy = 20; yy < 60; yy += 4) {
    const b = W.getBlock(pos[0] + dx, yy, pos[2] + dz);
    if (b === 13) lava++; if (b === 71) cinder++;
  }
  const standingInGate = W.getBlock(pos[0], pos[1], pos[2]) === 69;
  return { lit, portalBlocks, dim: G.dimension, mode: G.mode, lava, cinder, standingInGate, ceiling: W.getBlock(pos[0], 127, pos[2]) };
}, setup);
check('flint-and-steel lights an obsidian frame into a 2x3 gate', ember.lit && ember.portalBlocks === 6, JSON.stringify({ lit: ember.lit, n: ember.portalBlocks }));
check('standing in a gate takes you to the Emberdeep', ember.dim === 'ember' && ember.mode === 'playing', JSON.stringify({ dim: ember.dim, mode: ember.mode }));
check('the Emberdeep has cinderstone, a lava sea and a bedrock ceiling', ember.cinder > 50 && ember.lava > 50 && ember.ceiling === 6, JSON.stringify(ember));
check('you arrive standing in a gate', ember.standingInGate);

// Emberwisp fireball hurts the player.
const wisp = await g(async () => {
  const G = window.blockhaven, p = G.player;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  p.health = 20; p.invulnerable = 0; p.creative = false;
  const [x, y, z] = p.body.pos;
  const m = G.entities.spawnMob('emberwisp', x + 0.5, y + 4, z - 6);
  await sleep(8000);
  m.dead = true;
  return p.health;
});
check('an Emberwisp shoots fireballs that hurt', wisp < 20, `health ${wisp}`);

// Go back up.
const back = await g(async () => {
  const G = window.blockhaven;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  G.runCommand('/dimension overworld');
  for (let i = 0; i < 90; i++) { await sleep(1000); if (G.dimension === 'overworld' && G.mode === 'playing') break; }
  return { dim: G.dimension, mode: G.mode };
});
check('you can return to the overworld', back.dim === 'overworld' && back.mode === 'playing', JSON.stringify(back));

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

// --- Closing the inventory and the chat bar every way a player might.
// Headless Chromium can't capture the mouse, so a stand-in follows Chrome's rules: capturing needs a
// recent click or key press (Escape doesn't count), and the change fires 'pointerlockchange'.
await g(() => {
  const G = window.blockhaven, cv = G.canvas;
  window.__lock = false;
  const fire = () => document.dispatchEvent(new Event('pointerlockchange'));
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => (window.__lock ? cv : null) });
  cv.requestPointerLock = () => { if (navigator.userActivation.isActive && !window.__lock) { window.__lock = true; setTimeout(fire, 0); return Promise.resolve(); } return Promise.reject(new Error('needs a gesture')); };
  document.exitPointerLock = () => { if (window.__lock) { window.__lock = false; setTimeout(fire, 0); } };
  G.player.creative = true;
});
const ui = () => g(() => { const G = window.blockhaven; return { inv: G.containers.open, chat: G.cmdEl.classList.contains('show'), locked: !!document.pointerLockElement, hint: !!document.querySelector('#resume')?.classList.contains('show') }; });
// A missing button should fail its check, not stop the run.
const tap = async (sel) => { try { await page.click(sel, { timeout: 1500 }); } catch { /* reported by the check below */ } await wait(250); };
const press = async (key) => { await page.keyboard.press(key); await wait(250); };
await page.mouse.click(500, 320); await wait(250);
await press('KeyE');
let u = await ui();
const opened = u.inv && !u.locked;
await press('KeyE');
u = await ui();
check('E opens and closes the inventory', opened && !u.inv && u.locked, JSON.stringify(u));
await press('KeyE');
await tap('input.search'); await page.keyboard.type('stone'); await press('Escape');
u = await ui();
check('Escape closes the creative inventory while typing in its search box', !u.inv, JSON.stringify(u));
await press('KeyW');
await g(() => { window.blockhaven.containers.close(); document.activeElement?.blur(); });
await page.mouse.click(500, 320); await wait(250);
await press('KeyE');
let wasOpen = (await ui()).inv;
await tap('#container .close-x');
check('the close button closes the inventory', wasOpen && !(await ui()).inv);
await g(() => window.blockhaven.containers.close());
await press('KeyE');
wasOpen = (await ui()).inv;
await wait(500); // clicks in the first moments after opening are ignored (see containers.ts)
await page.mouse.click(8, 8); await wait(250);
check('clicking the backdrop closes the inventory', wasOpen && !(await ui()).inv);
await g(() => window.blockhaven.containers.close());
await press('KeyT');
await g(() => document.querySelector('#cmd input').blur());
await press('Escape');
check('Escape closes the chat bar even after its box loses focus', !(await ui()).chat);
await g(() => { const G = window.blockhaven; G.cmdEl.classList.remove('show'); });
await press('KeyT');
wasOpen = (await ui()).chat;
await tap('#cmd .close-x');
check('the chat close button closes the chat bar', wasOpen && !(await ui()).chat);
await g(() => { const G = window.blockhaven; G.cmdEl.classList.remove('show'); });
await page.mouse.click(500, 320); await wait(250);
await press('KeyT'); await page.keyboard.type('/time set day'); await press('Enter');
check('Enter runs a command and closes the chat bar', !(await ui()).chat);
// Escape long after the last gesture can't recapture the mouse: the game says so, and any key resumes.
await press('KeyE'); await wait(6000); await press('Escape');
u = await ui();
const hinted = !u.inv && !u.locked && u.hint;
await press('KeyW');
u = await ui();
check('after Escape without a recent gesture, a hint shows and any key resumes', hinted && u.locked && !u.hint, JSON.stringify(u));
await g(() => {
  const G = window.blockhaven;
  document.exitPointerLock();
  delete document.pointerLockElement; delete document.exitPointerLock; delete G.canvas.requestPointerLock;
  G.player.creative = false;
});
await wait(100);
// Releasing the stand-in lock opened the pause menu (as losing the mouse should); dismiss it.
await g(() => window.blockhaven.menus.show(null));
await wait(300);

// --- Quality-of-life features: commands, chat, waypoints, map, camera, keys, gamepad, inventory, backups.
{
  // Keep the inventory from the crafting test for the save/reload checks below.
  await g(() => { window.__invSnap = window.blockhaven.player.inv.slots.map((s) => (s ? { ...s } : null)); });
  // /fill, /setblock and /undo.
  const edit = await g(() => {
    const G = window.blockhaven, p = G.player, w = G.world;
    const [x, , z] = p.body.pos.map(Math.floor);
    const y = w.groundY(x + 4, z + 4) + 4;
    G.runCommand(`/fill ${x + 3} ${y} ${z + 3} ${x + 5} ${y + 2} ${z + 5} glass`);
    const filled = w.getBlock(x + 4, y + 1, z + 4);
    G.runCommand(`/setblock ${x + 4} ${y + 3} ${z + 4} gold_block`);
    const set = w.getBlock(x + 4, y + 3, z + 4);
    G.runCommand('/undo');
    const undoneSet = w.getBlock(x + 4, y + 3, z + 4);
    G.runCommand('/undo');
    const undoneFill = w.getBlock(x + 4, y + 1, z + 4);
    const B = G.ids;
    return { filled: filled === B.glass, set: set === B.gold_block, undoneSet, undoneFill };
  });
  check('/fill and /setblock place blocks, /undo reverts them in order', edit.filled && edit.set && edit.undoneSet === 0 && edit.undoneFill === 0, JSON.stringify(edit));

  // Chat: history with Up, Tab completion of commands and arguments.
  await g(() => window.blockhaven.chat.open('/'));
  await wait(150);
  await page.keyboard.type('tim');
  await page.keyboard.press('Tab');
  const completed = await g(() => window.blockhaven.chat.input.value);
  await page.keyboard.type('set no');
  await page.keyboard.press('Tab');
  const completedArg = await g(() => window.blockhaven.chat.input.value);
  await page.keyboard.press('Enter');
  await wait(150);
  await g(() => window.blockhaven.chat.open(''));
  await wait(150);
  await page.keyboard.press('ArrowUp');
  const recalled = await g(() => window.blockhaven.chat.input.value);
  await page.keyboard.press('Escape');
  await wait(100);
  check('Tab completes commands and arguments; Up recalls the last command', completed === '/time ' && completedArg.startsWith('/time set noon') && recalled.startsWith('/time set noon'), JSON.stringify({ completed, completedArg, recalled }));

  // Waypoints, and a death marker where you died.
  const wp = await g(() => {
    const G = window.blockhaven;
    G.runCommand('/waypoint add Home base');
    const added = G.waypoints.get('Home base');
    G.runCommand('/waypoint remove Home base');
    return { added: !!added, removed: !G.waypoints.get('Home base') };
  });
  check('waypoints can be added and removed', wp.added && wp.removed, JSON.stringify(wp));

  // World map opens and closes; minimap is drawn.
  await g(() => { window.blockhaven.settings.minimap = true; window.blockhaven.map.show(); });
  await wait(300);
  const mapOpen = await g(() => window.blockhaven.map.open && getComputedStyle(document.querySelector('#worldmap')).display !== 'none');
  await page.keyboard.press('Escape');
  await wait(200);
  const mapClosed = await g(() => !window.blockhaven.map.open);
  const mini = await g(() => { const c = document.querySelector('#minimap'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] && (d[i] + d[i + 1] + d[i + 2]) > 60) lit++; return lit; });
  check('the world map opens and closes, and the minimap shows terrain', mapOpen && mapClosed && mini > 1000, JSON.stringify({ mapOpen, mapClosed, mini }));

  // Third-person camera shows the avatar and moves the camera off the player's eye.
  const cam = await g(async () => {
    const G = window.blockhaven, p = G.player;
    G.cyclePerspective();
    await new Promise((r) => setTimeout(r, 200));
    const c = G.renderer.camera.position, e = p.eye();
    const dist = Math.hypot(c.x - e[0], c.y - e[1], c.z - e[2]);
    const shown = !!G.avatar?.root.visible;
    G.cyclePerspective(); G.cyclePerspective();
    await new Promise((r) => setTimeout(r, 100));
    return { dist, shown, back: G.perspective, hidden: !G.avatar?.root.visible };
  });
  check('third-person view shows your avatar and pulls the camera back', cam.shown && cam.dist > 0.5 && cam.back === 0 && cam.hidden, JSON.stringify(cam));

  // Screenshot key downloads a PNG.
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), g(() => window.blockhaven.screenshot())]);
  check('the screenshot key saves a PNG', !!dl && dl.suggestedFilename().endsWith('.png'), dl ? dl.suggestedFilename() : 'no download');

  // Rebinding a key, and toggle-sprint.
  const keys = await g(() => {
    const G = window.blockhaven, inp = G.input;
    G.settings.keys = { forward: 'KeyI' };
    const rebound = inp.codes('forward')[0] === 'KeyI';
    G.settings.keys = {};
    G.settings.toggleSprint = true;
    inp.sprintLatch = true;
    const latched = inp.movement().sprint || !inp.controlling;
    G.settings.toggleSprint = false; inp.sprintLatch = false;
    return { rebound, latched };
  });
  check('keys can be rebound, and sprint can be a toggle', keys.rebound && keys.latched, JSON.stringify(keys));

  // A gamepad: left stick walks, A jumps, RB changes the hotbar slot.
  const pad = await g(async () => {
    const G = window.blockhaven, p = G.player;
    p.creative = false; p.flying = false;
    const state = { axes: [0, -1, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, mapping: 'standard', axes: state.axes, buttons: state.buttons }] });
    const x0 = [...p.body.pos], sel = p.selected;
    await new Promise((r) => setTimeout(r, 900));
    const forward = G.input.movement().forward;
    state.buttons[5] = { pressed: true, value: 1 };
    await new Promise((r) => setTimeout(r, 100));
    state.buttons[5] = { pressed: false, value: 0 };
    state.axes[1] = 0;
    await new Promise((r) => setTimeout(r, 100));
    const moved = Math.hypot(p.body.pos[0] - x0[0], p.body.pos[2] - x0[2]);
    const selChanged = p.selected === (sel + 1) % 9;
    const diag = { padActive: G.input.padActive, controlling: G.input.controlling, menu: G.menus.current, chat: G.chat.isOpen, inv: G.containers.open, alive: p.alive };
    delete navigator.getGamepads;
    G.input.padActive = false;
    return { forward, moved, selChanged, ...diag };
  });
  check('a gamepad walks with the left stick and switches slots with the bumpers', pad.forward > 0.9 && pad.moved > 0.1 && pad.selChanged, JSON.stringify(pad));

  // Creative tabs, drag-to-spread and double-click-to-gather in the inventory.
  const inv = await g(async () => {
    const G = window.blockhaven, p = G.player;
    p.creative = true;
    G.containers.close();
    G.openInventory();
    await new Promise((r) => setTimeout(r, 200));
    const tabs = [...document.querySelectorAll('#container .tab')];
    tabs.find((t) => t.textContent === 'All')?.click();
    await new Promise((r) => setTimeout(r, 100));
    const all = document.querySelectorAll('#container .creative-grid .slot').length;
    [...document.querySelectorAll('#container .tab')].find((t) => t.textContent === 'Nature')?.click();
    await new Promise((r) => setTimeout(r, 100));
    const nature = document.querySelectorAll('#container .creative-grid .slot').length;
    G.containers.close();
    return { tabs: tabs.length, all, nature };
  });
  check('the creative inventory has category tabs that filter items', inv.tabs >= 7 && inv.nature > 5 && inv.nature < inv.all, JSON.stringify(inv));
  await g(() => { const G = window.blockhaven, p = G.player; p.creative = false; p.inv.slots.fill(null); p.inv.slots[9] = { id: G.ids.dirt, count: 30 }; G.openInventory(); });
  await wait(300);
  const slots = await page.$$('#container .slot');
  // Player screen layout: 4 armour, 4 craft, 1 result, then 27 main (slot 9 = main index 0), then hotbar.
  const main = (i) => slots[9 + i];
  await main(0).click();                      // pick up 30 dirt
  const b1 = await main(1).boundingBox(), b2 = await main(2).boundingBox(), b3 = await main(3).boundingBox();
  await page.mouse.move(b1.x + 10, b1.y + 10); await page.mouse.down();
  await page.mouse.move(b2.x + 10, b2.y + 10, { steps: 3 }); await page.mouse.move(b3.x + 10, b3.y + 10, { steps: 3 });
  await page.mouse.up();
  await wait(200);
  const spread = await g(() => window.blockhaven.player.inv.slots.slice(10, 13).map((s) => s?.count ?? 0));
  await main(1).dblclick();
  await wait(200);
  const gathered = await g(() => ({ cursor: window.blockhaven.containers.cursor?.count ?? 0, left: window.blockhaven.player.inv.slots.slice(9, 36).filter(Boolean).length }));
  await g(() => { const G = window.blockhaven; if (G.containers.cursor) { G.player.inv.slots[9] = G.containers.cursor; G.containers.cursor = null; } G.containers.close(); });
  check('dragging a stack shares it out evenly; double-click gathers it back', spread.join() === '10,10,10' && gathered.cursor === 30 && gathered.left === 0, JSON.stringify({ spread, gathered }));

  // Backup: export this world to a file and import it back as a new world.
  const round = await g(async () => {
    const G = window.blockhaven;
    await G.save();
    const { blob, name } = await G.storage.exportWorld(G.meta.id);
    const meta = await G.storage.importWorld(blob);
    const worlds = await G.listWorlds();
    const ok = worlds.some((w) => w.id === meta.id && w.seed === G.meta.seed);
    await G.storage.deleteWorld(meta.id);
    return { name, size: blob.size, ok };
  });
  check('a world exports to a file and imports back as a new world', round.ok && round.size > 100 && round.name.endsWith('.blockhaven'), JSON.stringify(round));
  await g(() => { const p = window.blockhaven.player; p.creative = false; window.__invSnap.forEach((s, i) => { p.inv.slots[i] = s; }); });
}

// --- Brewing, potions and effects; shield and crossbow.
{
  // Held-button actions (drinking, raising a shield, loading a crossbow) only happen while you're in
  // control of the game, which on a desktop means the mouse is captured: stand in for that here.
  await g(() => { Object.defineProperty(window.blockhaven.input, 'locked', { configurable: true, get: () => true }); });
  const brew = await g(async () => {
    const G = window.blockhaven, p = G.player, w = G.world, B = G.ids, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const [x, , z] = p.body.pos.map(Math.floor);
    const y = w.groundY(x + 2, z) ;
    w.setBlock(x + 2, y, z, B.brewing_stand);
    const be = w.getBlockEntity(x + 2, y, z);
    be.inv.slots[0] = { id: It.sugar, count: 1 };
    be.inv.slots[1] = { id: It.glow_dust, count: 1 };
    for (const i of [2, 3, 4]) be.inv.slots[i] = { id: It.water_bottle, count: 1 };
    await sleep(200);
    be.brew = 397;
    await sleep(400);
    const potions = [2, 3, 4].map((i) => be.inv.slots[i]?.id === It.potion_swiftness);
    be.inv.slots[0] = { id: It.gunpowder, count: 1 };
    await sleep(200);
    be.brew = 397;
    await sleep(400);
    const splash = be.inv.slots[2]?.id === It.splash_potion_swiftness;
    return { potions, splash, fuelLeft: be.fuel };
  });
  check('a brewing stand turns water bottles into potions, and gunpowder makes them splash', brew.potions.every(Boolean) && brew.splash, JSON.stringify(brew));

  const drink = await g(async () => {
    const G = window.blockhaven, p = G.player, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.creative = false;
    p.effects.clear();
    p.inv.slots[0] = { id: It.potion_night_vision, count: 1 };
    p.selected = 0;
    G.mouse[2] = true; G.use();
    const hold = setInterval(() => { G.mouse[2] = true; }, 50);
    await sleep(2200);
    clearInterval(hold); G.mouse[2] = false;
    const nv = p.effects.get('night_vision');
    await sleep(100);
    return { effect: !!nv, ticks: nv?.ticks ?? 0, bottle: p.inv.slots[0]?.id === It.glass_bottle, rendererNV: G.renderer.nightVision };
  });
  check('drinking a potion gives its effect, brightens the night, and leaves the bottle', drink.effect && drink.ticks > 3000 && drink.bottle && drink.rendererNV > 0.5, JSON.stringify(drink));

  const splash = await g(async () => {
    const G = window.blockhaven, p = G.player, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.effects.clear();
    p.inv.slots[0] = { id: It.splash_potion_swiftness, count: 1 };
    p.selected = 0;
    p.pitch = -1.5; // throw it at your feet
    G.use();
    await sleep(1500);
    p.pitch = 0;
    return { swift: !!p.effects.get('swiftness'), used: !p.inv.slots[0] };
  });
  check('a splash potion thrown at your feet gives you its effect', splash.swift && splash.used, JSON.stringify(splash));

  const bottle = await g(async () => {
    const G = window.blockhaven, p = G.player, w = G.world, B = G.ids, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // A clean stone platform with one water block two steps ahead.
    const [x, , z] = p.body.pos.map(Math.floor);
    const y = Math.floor(p.body.pos[1]) + 3;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -4; dz <= 2; dz++) { w.setBlock(x + dx, y, z + dz, B.stone); for (let dy = 1; dy <= 3; dy++) w.setBlock(x + dx, y + dy, z + dz, 0); }
    w.setBlock(x, y, z - 2, B.water, 0);
    p.body.pos = [x + 0.5, y + 1, z + 0.5]; p.body.vel = [0, 0, 0];
    p.inv.slots[0] = { id: It.glass_bottle, count: 3 };
    p.selected = 0; p.yaw = 0; p.pitch = -0.7;
    await sleep(150);
    G.use();
    await sleep(100);
    return { filled: p.inv.count(It.water_bottle), left: p.inv.slots[0]?.count };
  });
  check('a glass bottle fills from water', bottle.filled === 1 && bottle.left === 2, JSON.stringify(bottle));

  const shield = await g(async () => {
    const G = window.blockhaven, p = G.player, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.creative = false; p.health = 20; p.invulnerable = 0; p.effects.clear();
    p.inv.slots[0] = { id: It.shield, count: 1 };
    p.selected = 0; p.yaw = 0; p.pitch = 0;
    G.mouse[2] = true;
    const hold = setInterval(() => { G.mouse[2] = true; }, 50);
    await sleep(200);
    // A hit from straight ahead (knock pushes you back, +z), then one from behind.
    const blocking = p.blocking;
    p.damage(6, 'zombie', [0, 1]);
    const afterFront = p.health;
    p.invulnerable = 0;
    p.damage(6, 'zombie', [0, -1]);
    const afterBack = p.health;
    clearInterval(hold); G.mouse[2] = false;
    await sleep(100);
    return { blocking, afterFront, afterBack, wear: p.inv.slots[0]?.damage ?? 0, lowered: !p.blocking };
  });
  check('a raised shield blocks hits from in front (and wears down), not from behind', shield.blocking && shield.afterFront === 20 && shield.afterBack < 20 && shield.wear > 0 && shield.lowered, JSON.stringify(shield));

  const xbow = await g(async () => {
    const G = window.blockhaven, p = G.player, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.inv.slots[0] = { id: It.crossbow, count: 1 };
    p.inv.slots[1] = { id: It.arrow, count: 3 };
    p.selected = 0; p.pitch = 0.2;
    G.mouse[2] = true; G.use();
    const hold = setInterval(() => { G.mouse[2] = true; }, 50);
    await sleep(1800);
    clearInterval(hold); G.mouse[2] = false;
    const loaded = !!p.inv.slots[0]?.charged, arrowsAfterLoad = p.inv.count(It.arrow);
    const before = G.entities.list.filter((e) => e.kind === 'arrow').length;
    G.use();
    await sleep(50);
    const flying = G.entities.list.filter((e) => e.kind === 'arrow').length - before;
    return { loaded, arrowsAfterLoad, flying, unloaded: !p.inv.slots[0]?.charged };
  });
  // Holding a bow with the mouse captured (as when really playing) draws it all the way.
  const bow = await g(async () => {
    const G = window.blockhaven, p = G.player, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.inv.slots[0] = { id: It.bow, count: 1 }; p.inv.slots[1] = { id: It.arrow, count: 3 };
    p.selected = 0; p.pitch = 0.1;
    G.mouse[2] = true; G.use();
    const hold = setInterval(() => { G.mouse[2] = true; }, 50);
    await sleep(1400);
    clearInterval(hold);
    const charge = G.actions.bowCharge;
    G.mouse[2] = false; G.releaseBow();
    await sleep(30);
    const arrow = G.entities.list.filter((e) => e.kind === 'arrow' && e.owner === 'player').pop();
    return { charge, speed: arrow ? Math.hypot(...arrow.body.vel) : 0 };
  });
  check('holding a bow draws it fully and looses a full-power arrow', bow.charge > 20 && bow.speed > 2.5, JSON.stringify(bow));
  check('a crossbow loads an arrow while held, then fires it', xbow.loaded && xbow.arrowsAfterLoad === 2 && xbow.flying === 1 && xbow.unloaded, JSON.stringify(xbow));
  await g(() => { const G = window.blockhaven, p = G.player; delete G.input.locked; p.effects.clear(); p.health = 20; window.__invSnap.forEach((s, i) => { p.inv.slots[i] = s; }); });
}

// --- Decoration: sixteen colours, carpets, stained glass, banners, paintings.
{
  const ids = await g(() => ({ ...window.blockhaven.items }));
  const deco = await g(async () => {
    const G = window.blockhaven, p = G.player, w = G.world, B = G.ids, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    // Recipes: mixing dyes, stained glass, carpets.
    const grid = (ids) => ids.map((id) => (id ? { id, count: 1 } : null));
    out.cyan = G.craft(grid([It.dye_blue, It.dye_green, 0, 0]), 2);
    out.glass = G.craft(grid([B.glass, B.glass, B.glass, B.glass, It.dye_red, B.glass, B.glass, B.glass, B.glass]), 3);
    out.carpet = G.craft(grid([B.wool_purple, B.wool_purple, 0, 0]), 2);
    // A clean wall to work on.
    const [x, , z] = p.body.pos.map(Math.floor);
    const y = Math.floor(p.body.pos[1]) + 6;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -4; dz <= 2; dz++) for (let dy = -1; dy <= 3; dy++) w.setBlock(x + dx, y + dy, z + dz, dy === -1 || dz === -4 ? B.stone : 0);
    p.creative = false; p.flying = false;
    p.body.pos = [x + 0.5, y, z + 0.5]; p.body.vel = [0, 0, 0]; p.yaw = 0; p.pitch = 0;
    await sleep(200);
    // Dye a wool block, then a carpet.
    w.setBlock(x, y, z - 2, B.wool);
    p.inv.slots[0] = { id: It.dye_cyan, count: 4 }; p.selected = 0; p.pitch = -0.35;
    await sleep(120); G.use();
    out.dyedWool = w.getBlock(x, y, z - 2) === B.wool_cyan;
    // Place a lime banner on the wall and a painting next to it.
    w.setBlock(x, y, z - 2, 0);
    p.inv.slots[0] = { id: It.banner_lime, count: 1 }; p.pitch = 0.3;
    await sleep(120); G.use();
    const find = (id) => { for (let dy = 0; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) if (w.getBlock(x + dx, y + dy, z - 3) === id) return [x + dx, y + dy, z - 3]; return null; };
    const bp = find(B.banner);
    out.banner = !!bp && ((w.getMeta(...bp) >> 2) & 15) === 5 && (w.getMeta(...bp) & 64) === 0;
    // Breaking it gives the lime banner back.
    const before = G.entities.list.filter((e) => e.stack?.id === It.banner_lime).length;
    if (bp) w.breakBlock(...bp, true);
    await sleep(50);
    out.bannerDrop = G.entities.list.filter((e) => e.stack?.id === It.banner_lime).length === before + 1;
    p.inv.slots[0] = { id: B.painting, count: 1 }; p.pitch = 0.3;
    await sleep(120); G.use();
    out.painting = !!find(B.painting);
    return out;
  });
  check('dyes mix, and stained glass and carpets craft in every colour', deco.cyan?.id === ids.dye_cyan && deco.glass?.id === ids.stained_glass_red && deco.glass?.count === 8 && deco.carpet?.id === ids.carpet_purple && deco.carpet?.count === 3, JSON.stringify({ cyan: deco.cyan, glass: deco.glass, carpet: deco.carpet }));
  check('dye recolours wool; banners hang in their colour and drop back as themselves; paintings hang on walls', deco.dyedWool && deco.banner && deco.bannerDrop && deco.painting, JSON.stringify(deco));
}

// --- Getting around: rails and minecarts, boats, taming and riding.
{
  await g(() => { Object.defineProperty(window.blockhaven.input, 'locked', { configurable: true, get: () => true }); });
  const cart = await g(async () => {
    const G = window.blockhaven, p = G.player, w = G.world, B = G.ids, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const [x, , z] = p.body.pos.map(Math.floor);
    const y = Math.floor(p.body.pos[1]) + 8;
    // A straight track 14 long that turns a corner, on a stone bed in the air.
    for (let dx = -2; dx <= 16; dx++) for (let dz = -2; dz <= 8; dz++) { w.setBlock(x + dx, y - 1, z + dz, B.stone); for (let dy = 0; dy <= 3; dy++) w.setBlock(x + dx, y + dy, z + dz, 0); }
    for (let i = 0; i <= 12; i++) { w.setBlock(x + i, y, z, B.rail); w.fitRail(x + i, y, z); }
    for (let j = 1; j <= 6; j++) { w.setBlock(x + 12, y, z + j, B.rail); w.fitRail(x + 12, y, z + j); }
    const shapes = { straight: w.railShape(x + 5, y, z), corner: w.railShape(x + 12, y, z), down: w.railShape(x + 12, y, z + 4) };
    // Place a cart with the item, get in, and push off along the track.
    p.creative = false; p.flying = false;
    p.body.pos = [x + 0.5, y + 1, z + 1.8]; p.body.vel = [0, 0, 0]; p.yaw = 0; p.pitch = -1.0;
    p.inv.slots[0] = { id: It.minecart, count: 1 }; p.selected = 0;
    await sleep(150);
    G.use();
    const v = G.entities.vehicles().find((e) => e.kind === 'minecart');
    if (!v) return { shapes, placed: false };
    G.use();
    const riding = G.riding === v;
    // Push it east by giving it a shove (as the powered rails or a slope would).
    v.body.vel = [0.4, 0, 0];
    await sleep(2500);
    const cartPos = [...v.body.pos], playerPos = [...p.body.pos];
    // Sneak to get out.
    G.keys.add('ShiftLeft'); await sleep(150); G.keys.delete('ShiftLeft'); await sleep(100);
    return { shapes, placed: true, riding, cartPos, x, z, turned: cartPos[2] > z + 1.5, seated: Math.hypot(playerPos[0] - cartPos[0], playerPos[2] - cartPos[2]) < 0.5, off: G.riding === null };
  });
  check('rails join into straights and corners; a minecart rides the track around a corner with you in it', cart.placed && cart.shapes.straight === 1 && cart.shapes.corner >= 6 && cart.shapes.down === 0 && cart.riding && cart.turned && cart.seated && cart.off, JSON.stringify(cart));

  const boat = await g(async () => {
    const G = window.blockhaven, p = G.player, w = G.world, B = G.ids;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const [x, , z] = p.body.pos.map(Math.floor);
    const y = Math.floor(p.body.pos[1]) + 10;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -14; dz <= 4; dz++) { w.setBlock(x + dx, y - 2, z + dz, B.stone); w.setBlock(x + dx, y - 1, z + dz, B.water, 0); for (let dy = 0; dy <= 3; dy++) w.setBlock(x + dx, y + dy, z + dz, 0); }
    await sleep(200);
    const boat = new (await import('/src/entities/vehicles.ts')).Boat(x + 0.5, y - 0.2, z + 0.5, 0);
    G.entities.add(boat);
    G.mount(boat);
    p.yaw = 0;
    G.keys.add('KeyW'); await sleep(1500); G.keys.delete('KeyW');
    const moved = z + 0.5 - boat.body.pos[2];
    const floating = Math.abs(boat.body.pos[1] - (y - 0.2)) < 0.4;
    G.dismount();
    return { moved, floating, off: G.riding === null };
  });
  check('a boat floats, rows forward and lets you off', boat.moved > 3 && boat.floating && boat.off, JSON.stringify(boat));

  const tame = await g(async () => {
    const G = window.blockhaven, p = G.player, w = G.world, B = G.ids, It = G.items, E = G.entities;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const [x, , z] = p.body.pos.map(Math.floor);
    const y = Math.floor(p.body.pos[1]) + 14;
    for (let dx = -8; dx <= 8; dx++) for (let dz = -24; dz <= 6; dz++) { w.setBlock(x + dx, y - 1, z + dz, B.grass); for (let dy = 0; dy <= 5; dy++) w.setBlock(x + dx, y + dy, z + dz, 0); }
    p.body.pos = [x + 0.5, y, z + 0.5]; p.body.vel = [0, 0, 0]; p.yaw = 0; p.pitch = -0.2;
    const mb = E.spawnMob('mossback', x + 0.5, y, z - 2.2); mb.wanderTimer = 99999; mb.target = null; mb.yaw = 0;
    await sleep(300);
    // Feed it until it's tamed (each feeding raises the chance).
    let feeds = 0;
    while (!mb.tamed && feeds < 20) { p.inv.slots[0] = { id: It.apple, count: 1 }; p.selected = 0; mb.body.pos = [x + 0.5, y, z - 2.2]; mb.panic = 0; mb.love = 0; mb.breedCooldown = 100; G.use(); feeds++; await sleep(30); }
    p.inv.slots[0] = { id: It.saddle, count: 1 };
    G.use();
    const saddled = mb.saddled;
    p.inv.slots[0] = null;
    G.use();
    const riding = G.riding === mb;
    p.yaw = 0;
    G.keys.add('KeyW'); await sleep(1500); G.keys.delete('KeyW');
    const moved = z - 2.2 - mb.body.pos[2];
    G.dismount();
    // A fox: tame it with apples, tell it to sit, then it follows when told to stand.
    const fox = E.spawnMob('burrowfox', x + 0.5, y, z - 2);
    fox.wanderTimer = 99999; mb.body.pos = [x + 6, y, z - 20];
    p.body.pos = [x + 0.5, y, z + 0.5]; p.yaw = 0; p.pitch = -0.4;
    let fFeeds = 0;
    while (!fox.tamed && fFeeds < 20) { p.inv.slots[0] = { id: It.apple, count: 1 }; fox.body.pos = [x + 0.5, y, z - 1.6]; fox.panic = 0; G.use(); fFeeds++; await sleep(30); }
    p.inv.slots[0] = null;
    G.use();
    const sat = fox.sitting;
    G.use();
    const stood = !fox.sitting;
    p.body.pos = [x + 0.5, y, z - 14];
    await sleep(2500);
    const follow = Math.hypot(fox.body.pos[0] - p.body.pos[0], fox.body.pos[2] - p.body.pos[2]);
    return { mbTamed: mb.tamed, feeds, saddled, riding, moved, foxTamed: fox.tamed, sat, stood, follow };
  });
  check('a mossback tames with food, takes a saddle, and can be ridden', tame.mbTamed && tame.saddled && tame.riding && tame.moved > 3, JSON.stringify(tame));
  check('a tamed fox sits when told and follows you when it stands', tame.foxTamed && tame.sat && tame.stood && tame.follow < 5, JSON.stringify(tame));
  await g(() => { const G = window.blockhaven; delete G.input.locked; G.riding = null; const p = G.player; window.__invSnap.forEach((s, i) => { p.inv.slots[i] = s; }); });
}

// --- Power components: repeater, pistons, hopper, watcher.
{
  const pw = await g(async () => {
    const G = window.blockhaven, p = G.player, w = G.world, B = G.ids, It = G.items;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const [x0, , z0] = p.body.pos.map(Math.floor);
    const y = Math.floor(p.body.pos[1]) + 20;
    for (let dx = -2; dx <= 20; dx++) for (let dz = -2; dz <= 10; dz++) { w.setBlock(x0 + dx, y - 1, z0 + dz, B.stone); for (let dy = 0; dy <= 5; dy++) w.setBlock(x0 + dx, y + dy, z0 + dz, 0); }
    await sleep(100);
    // Repeater: lever -> wire -> repeater (facing east, delay 4 = 8 ticks) -> lamp.
    const x = x0, z = z0;
    w.setBlock(x, y, z, B.lever, 0);
    w.setBlock(x + 1, y, z, B.wire);
    w.setBlock(x + 2, y, z, B.repeater, 3 | (3 << 2));
    w.setBlock(x + 3, y, z, B.lamp);
    await sleep(100);
    w.toggleLever(x, y, z);
    await sleep(150);
    out.repeaterWaits = w.getBlock(x + 3, y, z) === B.lamp;
    await sleep(700);
    out.repeaterLit = w.getBlock(x + 3, y, z) === B.lamp_on;
    // Piston (facing east) pushes three stone blocks; the lever beside it drives it.
    const px = x0 + 6, pz = z0 + 3;
    w.setBlock(px, y, pz, B.piston, 5);
    for (let i = 1; i <= 3; i++) w.setBlock(px + i, y, pz, B.cobblestone);
    w.setBlock(px, y, pz - 1, B.lever, 0);
    await sleep(100);
    w.toggleLever(px, y, pz - 1);
    await sleep(300);
    out.pushed = w.getBlock(px + 1, y, pz) === B.piston_head && [2, 3, 4].every((i) => w.getBlock(px + i, y, pz) === B.cobblestone) && (w.getMeta(px, y, pz) & 8) !== 0;
    w.toggleLever(px, y, pz - 1);
    await sleep(300);
    out.retracted = w.getBlock(px + 1, y, pz) === 0 && (w.getMeta(px, y, pz) & 8) === 0;
    // Sticky piston pulls the block back.
    const sx = x0 + 6, sz = z0 + 7;
    w.setBlock(sx, y, sz, B.sticky_piston, 5);
    w.setBlock(sx + 1, y, sz, B.gold_block);
    w.setBlock(sx, y, sz - 1, B.lever, 0);
    await sleep(100);
    w.toggleLever(sx, y, sz - 1); await sleep(300);
    const outward = w.getBlock(sx + 2, y, sz) === B.gold_block;
    w.toggleLever(sx, y, sz - 1); await sleep(300);
    out.sticky = outward && w.getBlock(sx + 1, y, sz) === B.gold_block && w.getBlock(sx + 2, y, sz) === 0;
    // Hopper: a chest above feeds it, it feeds the chest below; an item dropped on top is collected.
    const hx = x0 + 14, hz = z0 + 3;
    w.setBlock(hx, y, hz, B.chest);
    w.setBlock(hx, y + 1, hz, B.hopper, 0);
    w.setBlock(hx, y + 2, hz, B.chest);
    const top = w.getBlockEntity(hx, y + 2, hz), bottom = w.getBlockEntity(hx, y, hz);
    w.getBlockEntity(hx, y + 1, hz);
    top.inv.slots[0] = { id: It.coal, count: 3 };
    await sleep(2200);
    out.hopperMoved = bottom.inv.count(It.coal);
    w.setBlock(hx, y + 2, hz, 0);
    G.entities.dropItem(hx + 0.5, y + 2.1, hz + 0.5, { id: It.diamond, count: 1 }, 0, [0, 0, 0]);
    await sleep(2200);
    out.hopperCollected = bottom.inv.count(It.diamond) + (w.getBlockEntity(hx, y + 1, hz)?.inv.count(It.diamond) ?? 0);
    // Watcher (looking north at a block) pulses the lamp behind it when the block changes.
    const wx = x0 + 17, wz = z0 + 5;
    w.setBlock(wx, y, wz - 1, B.dirt);
    w.setBlock(wx, y, wz, B.watcher, 2);
    w.setBlock(wx, y, wz + 1, B.lamp);
    await sleep(300);
    const before = w.getBlock(wx, y, wz + 1);
    let lit = false;
    w.setBlock(wx, y, wz - 1, B.stone);
    for (let i = 0; i < 20 && !lit; i++) { await sleep(15); lit = w.getBlock(wx, y, wz + 1) === B.lamp_on; }
    await sleep(600);
    out.watcher = before === B.lamp && lit && w.getBlock(wx, y, wz + 1) === B.lamp;
    return out;
  });
  check('a repeater passes power on after its delay', pw.repeaterWaits && pw.repeaterLit, JSON.stringify(pw));
  check('a piston pushes a row of blocks and pulls its head back; a sticky one brings the block back', pw.pushed && pw.retracted && pw.sticky, JSON.stringify(pw));
  check('a hopper carries items from a chest above to one below and picks up dropped items', pw.hopperMoved === 3 && pw.hopperCollected === 1, JSON.stringify(pw));
  check('a watcher pulses when the block it looks at changes', pw.watcher, JSON.stringify(pw));
}

// --- Save, quit, reload, and check a block change persisted.
const marker = await g(async () => {
  const G = window.blockhaven;
  const [px, , pz] = G.player.body.pos.map(Math.floor);
  const m = [px + 3, G.world.groundY(px + 3, pz + 3), pz + 3];
  G.world.setBlock(m[0], m[1], m[2], 33 /* glowstone */);
  await G.save();
  return m;
});
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
