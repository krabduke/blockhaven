// Two players in one world: a host and a guest in separate browser profiles, connected the way
// real players connect (by swapping an invite code and a reply code), then checked for every
// kind of sync. Run against a dev or preview server:  node scripts/multiplayer-test.mjs [url]
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:5199/') + '?norender';
const browser = await chromium.launch({
  // Both players are on this machine: let them see each other's real local address.
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const open = async (label) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  await page.addInitScript(() => { Element.prototype.requestPointerLock = function () {}; });
  await page.goto(url);
  await page.waitForFunction(() => !!window.blockhaven, null, { timeout: 30000 });
  return page;
};
const until = async (page, fn, ms = 60000) => { await page.waitForFunction(fn, null, { timeout: ms, polling: 500 }); };

const host = await open('host'), guest = await open('guest');
await host.evaluate(() => { const G = window.blockhaven; G.settings.name = 'Hosty'; return G.createWorld('Shared', 'playtest-seed', 'survival'); });
await until(host, () => window.blockhaven.mode === 'playing');
await host.waitForTimeout(2000);

// A change made before the guest arrives, in a chunk they'll load: it has to come from the host.
const mark = await host.evaluate(() => { const G = window.blockhaven, p = G.player; const x = Math.floor(p.body.pos[0]) + 4, z = Math.floor(p.body.pos[2]) + 4; const y = G.world.groundY(x, z); G.world.setBlock(x, y, z, G.ids.glowstone); return [x, y, z]; });

// Connect through the real screens on the guest's side.
const invite = await host.evaluate(async () => { const inv = await window.blockhaven.inviteFriend(); window.__accept = inv.accept; return inv.code; });
await guest.click('text=Join a friend');
await guest.fill('#join-name', 'Guesty');
await guest.fill('#join-invite', invite);
await guest.click('text=Make my reply code');
await guest.waitForSelector('#join .code-box:not([hidden]) textarea', { timeout: 30000 });
const reply = await guest.inputValue('#join .code-box textarea');
const accepted = await host.evaluate(async (r) => { try { return await window.__accept(r); } catch (e) { return 'ERR ' + e.message; } }, reply);
check('a friend joins by swapping an invite code and a reply code', accepted === 'Guesty' && invite.startsWith('BH1:') && reply.startsWith('BH2:'), `invite ${invite.length} chars, reply ${reply.length} chars, host saw "${accepted}"`);
await until(guest, () => window.blockhaven.mode === 'playing');
await guest.waitForTimeout(3000);

const seen = await guest.evaluate((m) => { const G = window.blockhaven; return { seed: G.world.seed, simulating: G.world.simulate, mark: G.world.getBlock(...m) === G.ids.glowstone, figures: [...G.net.figures.keys()] }; }, mark);
const hostSees = await host.evaluate(() => { const G = window.blockhaven; const q = [...G.net.guests.values()][0]; return { guests: G.net.guestNames, figure: !!q?.figure }; });
check('the guest gets the same world, with the host\'s earlier changes, and each sees the other', seen.mark && !seen.simulating && seen.figures.includes('Hosty') && hostSees.guests[0] === 'Guesty' && hostSees.figure, JSON.stringify({ seen, hostSees }));

const spot = await guest.evaluate(() => { const p = window.blockhaven.player.body.pos; return [Math.floor(p[0]) + 2, Math.floor(p[1]) + 1, Math.floor(p[2])]; });
await host.evaluate((s) => window.blockhaven.world.setBlock(s[0], s[1], s[2], window.blockhaven.ids.bricks), spot);
await guest.waitForTimeout(800);
const toGuest = await guest.evaluate((s) => window.blockhaven.world.getBlock(...s) === window.blockhaven.ids.bricks, spot);
await guest.evaluate((s) => window.blockhaven.world.setBlock(s[0], s[1] + 1, s[2], window.blockhaven.ids.glass), spot);
await host.waitForTimeout(800);
const toHost = await host.evaluate((s) => window.blockhaven.world.getBlock(s[0], s[1] + 1, s[2]) === window.blockhaven.ids.glass, spot);
check('block changes travel both ways', toGuest && toHost, JSON.stringify({ toGuest, toHost }));

await host.evaluate((s) => { const m = window.blockhaven.entities.spawnMob('boar', s[0] + 0.5, s[1], s[2] + 2.5); m.wanderTimer = 99999; window.__boar = m; }, spot);
await guest.waitForTimeout(1000);
const puppet = await guest.evaluate(() => { const E = window.blockhaven.entities; const m = E.list.find((e) => e.netId && e.spec?.kind === 'boar'); if (!m) return false; m.hurt(E, 4, window.blockhaven.player.body.pos, 0.4, true); return true; });
await host.waitForTimeout(600);
const boarHp = await host.evaluate(() => window.__boar.health);
check('the guest sees the host\'s creatures and can hurt them', puppet && boarHp < 10, `boar health ${boarHp}`);

const before = await guest.evaluate(() => window.blockhaven.player.inv.count(window.blockhaven.items.diamond));
await host.evaluate(() => { const G = window.blockhaven; const q = [...G.net.guests.values()][0]; const p = q.proxy.body.pos; G.entities.dropItem(p[0], p[1] + 0.5, p[2], { id: G.items.diamond, count: 3 }, 5); });
await guest.waitForTimeout(1500);
const after = await guest.evaluate(() => window.blockhaven.player.inv.count(window.blockhaven.items.diamond));
check('items near the guest end up in their inventory', after - before === 3, `${before} -> ${after}`);

await host.evaluate(() => { const G = window.blockhaven; G.world.time = 18000; G.player.creative = true; const q = [...G.net.guests.values()][0]; const p = q.proxy.body.pos; G.entities.spawnMob('zombie', p[0] + 1.2, p[1], p[2]); });
const hp0 = await guest.evaluate(() => window.blockhaven.player.health);
await guest.waitForTimeout(3000);
const hp1 = await guest.evaluate(() => window.blockhaven.player.health);
check('monsters go after the guest too', hp1 < hp0, `${hp0} -> ${hp1}`);

for (const page of [host, guest]) await page.evaluate(() => { const G = window.blockhaven; window.__log = []; const o = G.chat.say.bind(G.chat); G.chat.say = (t) => { window.__log.push(t); o(t); }; });
await guest.evaluate(() => window.blockhaven.net.say('hello from the guest'));
await host.evaluate(() => window.blockhaven.net.say('hi back'));
await host.waitForTimeout(800);
const hostLog = await host.evaluate(() => window.__log), guestLog = await guest.evaluate(() => window.__log);
check('chat reaches everyone, and nobody gets their own lines back', hostLog.includes('<Guesty> hello from the guest') && guestLog.includes('<Hosty> hi back') && !guestLog.some((t) => t.includes('hello from the guest')), JSON.stringify({ hostLog, guestLog }));

const blocked = await guest.evaluate(() => { const G = window.blockhaven; window.__log = []; G.runCommand('/give diamond 64'); return window.__log.join(' '); });
check('guests can\'t use commands that change the host\'s world', /Only the host/.test(blocked), blocked);

await guest.evaluate(() => window.blockhaven.quitToTitle());
await host.waitForTimeout(2500);
const left = await host.evaluate(() => ({ guests: window.blockhaven.net.guestNames, others: window.blockhaven.entities.others.length, log: window.__log }));
check('when the guest leaves, the host is told and their figure goes', left.guests.length === 0 && left.others === 0 && left.log.some((t) => /Guesty left/.test(t)), JSON.stringify(left));

console.log('\nerrors:', errors.length ? errors.join('\n') : '(none)');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
