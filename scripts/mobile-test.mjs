// Phone playtest: loads the game in an emulated landscape phone with touch and
// checks the touch controls (walking, looking, mining, placing, jumping, the
// inventory and command buttons, closing screens by tap).
//
//   node scripts/mobile-test.mjs [url]     (screenshots go to $OUT or ./test-results)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const dir = process.env.OUT ?? 'test-results';
mkdirSync(dir, { recursive: true });
const out = dir + '/mobile';
// Use the real GPU (Metal on macOS); set SOFTWARE_GL=1 to force software rendering.
const b = await chromium.launch({
  args: process.env.SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const g = (fn, a) => p.evaluate(fn, a);
const wait = (ms) => p.waitForTimeout(ms);
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const cdp = await ctx.newCDPSession(p);
// Drag with a real touch pointer via CDP.
const touchDrag = async (x0, y0, x1, y1, steps = 8, holdMs = 0) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }] });
    await wait(16);
  }
  if (holdMs) await wait(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const tapHold = async (sel, ms) => {
  const box = await (await p.$(sel)).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 2 }] });
  await wait(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

await p.goto((process.argv[2] ?? 'http://localhost:5199/') + (process.env.NORENDER ? '?norender' : ''));
await wait(4000);
await p.screenshot({ path: out + '-title.png' });
check('title screen shows on a phone', await g(() => window.blockhaven.mode === 'title' && window.blockhaven.touchMode));
// Start a survival world through the menus with taps.
await p.tap('#title button.primary');
await wait(500);
await p.tap('#worlds >> text=Create new world');
await wait(300);
await p.tap('#create >> text=Create world');
for (let i = 0; i < 40; i++) { await wait(1000); if (await g(() => window.blockhaven.mode === 'playing')) break; }
await wait(1500);
check('world loads without pointer lock', await g(() => window.blockhaven.mode === 'playing' && !window.blockhaven.menus.current));
check('touch controls are visible', await g(() => document.querySelector('#touch').classList.contains('show')));
await p.screenshot({ path: out + '-play.png' });

// Look: drag on the right side.
const yaw0 = await g(() => window.blockhaven.player.yaw);
await touchDrag(600, 180, 480, 180);
await wait(200);
const yaw1 = await g(() => window.blockhaven.player.yaw);
check('dragging on the right turns the camera', Math.abs(yaw1 - yaw0) > 0.2, `${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);

// Walk: push the stick forward for a second on a cleared, flat patch.
const pos0 = await g(() => {
  const G = window.blockhaven, w = G.world, pl = G.player;
  const [x, , z] = pl.body.pos.map(Math.floor);
  const y = w.groundY(x, z) - 1;
  for (let dx = -3; dx <= 3; dx++) for (let dz = -8; dz <= 2; dz++) { for (let dy = 1; dy <= 4; dy++) w.setBlock(x + dx, y + dy, z + dz, 0); w.setBlock(x + dx, y, z + dz, 3); }
  pl.body.pos = [x + 0.5, y + 1, z + 0.5]; pl.body.vel = [0, 0, 0]; pl.yaw = 0;
  return pl.body.pos.slice();
});
await wait(500);
await touchDrag(110, 300, 110, 240, 6, 1200);
const pos1 = await g(() => window.blockhaven.player.body.pos.slice());
const moved = Math.hypot(pos1[0] - pos0[0], pos1[2] - pos0[2]);
check('the stick walks the player', moved > 1.5, `${moved.toFixed(2)} blocks`);

// Mine: look at the ground block in front, hold Mine.
await g(() => {
  const G = window.blockhaven, w = G.world, pl = G.player;
  const [x, , z] = pl.body.pos.map(Math.floor);
  const y = w.groundY(x, z) - 1;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -3; dz <= 1; dz++) { for (let dy = 1; dy <= 3; dy++) w.setBlock(x + dx, y + dy, z + dz, 0); w.setBlock(x + dx, y, z + dz, 3); }
  pl.body.pos = [x + 0.5, y + 1, z + 0.5]; pl.body.vel = [0, 0, 0]; pl.yaw = 0; pl.pitch = -0.9;
  pl.inv.slots[0] = null; pl.selected = 0;
});
await wait(600);
const tgt = await g(() => window.blockhaven.target?.pos ?? null);
await tapHold('[data-a=mine]', 1500);
await wait(300);
const mined = await g((t) => t && window.blockhaven.world.getBlock(t[0], t[1], t[2]) === 0, tgt);
check('holding Mine breaks the block', !!mined, JSON.stringify(tgt));
await wait(1500);
const dirt = await g(() => window.blockhaven.player.inv.count(3));
check('the broken block is picked up', dirt >= 1, `dirt ${dirt}`);

// Hotbar tap selects slot 3.
const slotBox = await (await p.$$('#hud .hotbar .hslot'))[3].boundingBox();
await p.touchscreen.tap(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2);
await wait(200);
check('tapping a hotbar slot selects it', await g(() => window.blockhaven.player.selected === 3));

// Use: place the dirt back.
await g(() => { const pl = window.blockhaven.player; pl.selected = pl.inv.slots.findIndex((s) => s && s.id === 3); pl.pitch = -0.9; });
await wait(300);
const place = await g(() => { const t = window.blockhaven.target; return t ? [t.pos[0] + t.normal[0], t.pos[1] + t.normal[1], t.pos[2] + t.normal[2]] : null; });
await tapHold('[data-a=use]', 120);
await wait(300);
check('tapping Use places a block', await g((q) => q && window.blockhaven.world.getBlock(q[0], q[1], q[2]) === 3, place), JSON.stringify(place));

// Jump.
const y0 = await g(() => window.blockhaven.player.body.pos[1]);
await tapHold('[data-a=jump]', 250);
const y1 = await g(() => window.blockhaven.player.body.pos[1]);
check('Jump jumps', y1 > y0 + 0.3, `${y0.toFixed(2)} -> ${y1.toFixed(2)}`);

// Inventory opens, controls hide, and it closes again.
await tapHold('[data-a=inventory]', 80);
await wait(400);
await p.screenshot({ path: out + '-inventory.png' });
const invOpen = await g(() => window.blockhaven.containers.open && !document.querySelector('#touch').classList.contains('show'));
check('inventory opens and hides the controls', invOpen);
const fits = await g(() => { const r = document.querySelector('#container .panel').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; });
check('inventory fits the phone screen', fits);
await p.tap('#container .close-x');
await wait(300);
check('tapping the close button closes the inventory', await g(() => !window.blockhaven.containers.open));
check('controls return after closing', await g(() => document.querySelector('#touch').classList.contains('show')));
await tapHold('[data-a=chat]', 80);
await wait(300);
await p.tap('#cmd .close-x', { timeout: 3000 });
await wait(300);
check('tapping the close button closes the chat bar', await g(() => !window.blockhaven.cmdEl.classList.contains('show') && document.querySelector('#touch').classList.contains('show')));

// Pause button.
await tapHold('[data-a=pause]', 80);
await wait(300);
check('pause button opens the pause menu', await g(() => window.blockhaven.menus.current === 'pause'));
await p.tap('#pause >> text=Back to game');
await wait(300);
check('resume returns to the game without pointer lock', await g(() => window.blockhaven.menus.current === null && document.querySelector('#touch').classList.contains('show')));

// Commands button and /speed.
await tapHold('[data-a=chat]', 80);
await wait(300);
await p.fill('#cmd input', '/speed 3');
await p.press('#cmd input', 'Enter');
await wait(300);
check('commands work from the phone', await g(() => window.blockhaven.player.speed === 3));

await p.screenshot({ path: out + '-end.png' });
console.log('errors:', errs.length ? errs : '(none)');
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await b.close();
process.exit(results.every(Boolean) && !errs.length ? 0 : 1);
