// Structures of the Emberdeep. The cavern world has no surface to stand them on, so each one
// hollows out its own space (a dome of air) at a set height and props itself up on piers that
// run down to the rock or the lava sea.
//
//   Cinder Bastion   a walled fortress on piers over the lava, with towers, a keep and a hoard of gold
//   Great Forge      a long smithy hall with a lava channel, rows of anvils and a vast furnace
//   Ashen Spire      an obsidian needle rising from the lava sea, reached by bridges from the walls
//   Ember Cathedral  a nave of cinder brick and emberquartz with burning windows and a bell-towered front
//   and smaller finds: shrines, basalt monoliths, ash camps, lava wells and hanging cages.

import { B, DYE_COLORS } from '../blocks';
import { mulberry32 } from '../noise';
import type { Builder, Frame } from './builder';
import { LOOT, overlaps, square, type Structure, type StructureKind } from './structure-kinds';

export const EMBER_REGION = 144;
const LAVA = 31;
const HANG = 1;
const cache = new Map<string, Structure[]>();

export function emberStructuresInRegion(seed: number, rx: number, rz: number): Structure[] {
  const key = `${seed}:${rx},${rz}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Structure[] = [];
  const rand = mulberry32((seed ^ Math.imul(rx, 0x7feb352d) ^ Math.imul(rz, 0x846ca68b) ^ 0xe3be) >>> 0);
  const sseed = (seed ^ Math.imul(rx, 3571) ^ Math.imul(rz, 7121) ^ 0xe3) >>> 0;
  // One of the great structures in most regions.
  if (rand() < 0.8) {
    const r = rand();
    const kind: StructureKind = r < 0.32 ? 'bastion' : r < 0.56 ? 'forge' : r < 0.78 ? 'spire' : 'cathedral';
    const size = { bastion: 30, forge: 22, spire: 26, cathedral: 28 }[kind as 'bastion'];
    const inset = size + 4;
    const x = rx * EMBER_REGION + inset + Math.floor(rand() * (EMBER_REGION - 2 * inset));
    const z = rz * EMBER_REGION + inset + Math.floor(rand() * (EMBER_REGION - 2 * inset));
    const y = kind === 'spire' ? 28 : kind === 'forge' ? 44 : 46 + Math.floor(rand() * 6);
    out.push({ kind, x, y, z, rot: Math.floor(rand() * 4), seed: sseed, bounds: square(x, z, size), variant: Math.floor(rand() * 1000) });
  }
  // A few smaller finds.
  const smalls: StructureKind[] = ['shrine', 'monoliths', 'ashcamp', 'lavawell', 'cage'];
  for (let k = 0; k < 4; k++) {
    if (rand() > 0.6) continue;
    const kind = smalls[Math.floor(rand() * smalls.length)];
    const x = rx * EMBER_REGION + 14 + Math.floor(rand() * (EMBER_REGION - 28));
    const z = rz * EMBER_REGION + 14 + Math.floor(rand() * (EMBER_REGION - 28));
    const y = kind === 'cage' ? 64 + Math.floor(rand() * 24) : kind === 'lavawell' ? LAVA + 4 : 36 + Math.floor(rand() * 40);
    const bounds = square(x, z, 11);
    if (out.some((o) => overlaps(o.bounds, bounds, 6))) continue;
    out.push({ kind, x, y, z, rot: Math.floor(rand() * 4), seed: sseed + k * 101, bounds, variant: Math.floor(rand() * 1000) });
  }
  cache.set(key, out);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return out;
}

const color = (c: (typeof DYE_COLORS)[number]) => DYE_COLORS.indexOf(c);

/** Hollow out a dome of air: `ru` by `rv` across, reaching `up` above and `down` below the floor. */
function hollow(f: Frame, ru: number, rv: number, up: number, down = 2, keepLava = true): void {
  for (let u = -ru; u <= ru; u++) for (let v = -rv; v <= rv; v++) {
    const t = Math.hypot(u / ru, v / rv);
    if (t > 1) continue;
    const top = Math.round(up * Math.sqrt(1 - t * t) + f.h(u, 0, v, 90) * 2);
    const bot = -Math.round(down * Math.sqrt(1 - t * t));
    for (let d = bot; d <= top; d++) {
      const y = f.oy + d;
      if (y <= 4 || y >= 122) continue;
      const cur = f.get(u, d, v);
      if (cur === B.bedrock || (keepLava && cur === B.lava && y <= LAVA)) continue;
      f.set(u, d, v, 0);
    }
  }
}

/** Piers from a platform down to the rock or the lava, with a round of stone at the top. */
function piers(f: Frame, r0: number, r1: number, every: number, id: number | ((x: number, y: number, z: number) => number)): void {
  for (let u = -r0; u <= r0; u++) for (let v = -r1; v <= r1; v++) {
    const rim = Math.abs(u) === r0 || Math.abs(v) === r1;
    if (rim || (u % every === 0 && v % every === 0)) f.foundation(u, -1, v, id, 60);
  }
}

/** A brazier: a magma block with a flame on it. */
function brazier(f: Frame, u: number, d: number, v: number): void { f.set(u, d, v, B.magma); f.set(u, d + 1, v, B.fire); }

// ============================================================== Cinder Bastion
export function bastion(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const brick = b.mix(100, [B.cinder_bricks, 7], [B.basalt, 1], [B.cinderstone, 1]);
  hollow(f, 30, 30, 30, 3);
  f.fill(-22, -2, -22, 22, 0, 22, brick);
  f.fill(-22, 0, -22, 22, 0, 22, (x, y, z) => ((x ^ z) & 3 ? B.cinder_bricks : B.basalt));
  piers(f, 22, 22, 6, B.cinder_bricks);
  // The curtain wall, with a walk behind the battlements and lamps of magma.
  for (let u = -20; u <= 20; u++) for (let v = -20; v <= 20; v++) {
    const r = Math.max(Math.abs(u), Math.abs(v));
    if (r === 20) {
      const along = Math.abs(v) === 20 ? u : v;
      for (let d = 1; d <= 12; d++) f.set(u, d, v, Math.abs(along) % 4 === 0 ? B.basalt : d === 10 && Math.abs(along) % 4 === 2 ? B.magma : brick(...xyz(f, u, d, v)));
      if (Math.abs(along) % 2 === 0) f.set(u, 13, v, B.cinder_bricks);
    } else if (r === 19) f.set(u, 12, v, B.cinder_bricks);
  }
  // The gate and a bridge out over the drop.
  f.fill(-2, 1, -20, 2, 6, -20, 0);
  f.fill(-2, 7, -20, 2, 7, -20, B.iron_bars);
  for (let v = -30; v <= -21; v++) {
    f.fill(-2, 0, v, 2, 0, v, B.cinder_bricks);
    f.set(-3, 1, v, B.fence); f.set(3, 1, v, B.fence);
    if (v % 3 === 0) f.foundation(0, -1, v, B.cinder_bricks, 60);
  }
  for (const u of [-3, 3]) { f.set(u, 1, -21, B.cinder_bricks); brazier(f, u, 2, -21); }
  // Four towers with ladders and burning crowns.
  const T = 24;
  for (const [cu, cv] of [[-20, -20], [20, -20], [-20, 20], [20, 20]]) {
    for (let du = -3; du <= 3; du++) for (let dv = -3; dv <= 3; dv++) {
      const edge = Math.max(Math.abs(du), Math.abs(dv)) === 3;
      for (let d = 1; d <= T; d++) {
        const window = edge && d % 7 === 4 && (du === 0 || dv === 0);
        f.set(cu + du, d, cv + dv, edge ? (window ? B.iron_bars : brick(...xyz(f, cu + du, d, cv + dv))) : d % 8 === 0 ? B.cinder_bricks : 0);
      }
      if (edge && (du + dv) % 2 === 0) f.set(cu + du, T + 1, cv + dv, B.cinder_bricks);
      f.foundation(cu + du, -1, cv + dv, B.cinder_bricks, 60);
    }
    f.ladder(cu > 0 ? cu + 2 : cu - 2, 1, T, cv, cu > 0 ? 1 : 3);
    for (const d of [T]) f.set(cu, d, cv, B.magma);
    f.set(cu, T + 1, cv, B.fire);
    // Doorways from the courtyard and onto the wall walk.
    for (const [du, dv] of [[cu > 0 ? -3 : 3, 0], [0, cv > 0 ? -3 : 3]]) { f.set(cu + du, 1, cv + dv, 0); f.set(cu + du, 2, cv + dv, 0); f.set(cu + du, 13, cv + dv, 0); f.set(cu + du, 14, cv + dv, 0); }
  }
  f.spawner(20, 17, 20, 'emberwisp'); f.spawner(-20, 17, -20, 'emberwisp');
  // The keep: a squat hall around the hoard.
  for (let d = 1; d <= 14; d++) for (let u = -7; u <= 7; u++) for (let v = -2; v <= 12; v++) {
    const edge = Math.abs(u) === 7 || v === -2 || v === 12;
    if (edge) f.set(u, d, v, (u + v) % 5 === 0 ? B.basalt : brick(...xyz(f, u, d, v)));
    else f.set(u, d, v, d === 14 ? B.cinder_bricks : 0);
  }
  for (let u = -7; u <= 7; u++) for (let v = -2; v <= 12; v++) if ((Math.abs(u) === 7 || v === -2 || v === 12) && (u + v) % 2 === 0) f.set(u, 15, v, B.cinder_bricks);
  f.fill(-1, 1, -2, 1, 4, -2, 0);
  f.fill(-3, 1, 5, 3, 1, 9, B.gold_block); f.fill(-2, 2, 6, 2, 2, 8, B.gold_block); f.set(0, 3, 7, B.gold_block);
  f.set(-1, 1, 5, B.cinder_bricks); f.set(2, 1, 9, B.cinder_bricks); f.set(0, 2, 6, 0);
  f.chest(-5, 1, 10, 2, LOOT.bastion); f.chest(5, 1, 10, 2, LOOT.bastion); f.chest(-5, 1, 1, 3, LOOT.bastion);
  f.spawner(5, 1, 1, 'cinderbrute');
  for (const u of [-4, 4]) f.set(u, 13, 5, B.lantern, HANG);
  // A lava pool and braziers in the courtyard.
  for (let u = -3; u <= 3; u++) for (let v = -12; v <= -8; v++) {
    const r = Math.max(Math.abs(u) / 3, Math.abs(v + 10) / 2);
    if (r >= 1) f.set(u, 1, v, B.cinder_bricks); else f.set(u, 0, v, B.lava);
  }
  for (const [u, v] of [[-12, -12], [12, -12], [-12, 8], [12, 8]]) { f.set(u, 1, v, B.cinder_bricks); brazier(f, u, 2, v); }
  for (const [u, v] of [[-10, -4], [10, -4], [0, -15]]) f.spawn('cinderbrute', u, 1, v);
  f.spawn('emberwisp', 0, 8, -6);
}

function xyz(f: Frame, u: number, d: number, v: number): [number, number, number] { const [x, z] = f.at(u, v); return [x, f.oy + d, z]; }

// ============================================================== Great Forge
export function forge(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const brick = b.mix(110, [B.cinder_bricks, 6], [B.basalt, 1]);
  hollow(f, 24, 18, 26, 3);
  f.fill(-18, -2, -12, 18, 0, 12, brick);
  f.fill(-18, 0, -12, 18, 0, 12, (x, y, z) => (b.h(x, y, z, 111) < 0.08 ? B.magma : B.cinder_bricks));
  piers(f, 18, 12, 6, B.basalt);
  // The hall: walls with basalt buttresses and a stepped roof.
  for (let d = 1; d <= 12; d++) for (let u = -16; u <= 16; u++) for (let v = -10; v <= 10; v++) {
    const edge = Math.abs(u) === 16 || Math.abs(v) === 10;
    if (!edge) { f.set(u, d, v, 0); continue; }
    const butt = Math.abs(v) === 10 ? u % 4 === 0 : v % 4 === 0;
    const window = !butt && d >= 5 && d <= 8 && (Math.abs(v) === 10 ? Math.abs(u % 4) === 2 : Math.abs(v % 4) === 2);
    f.set(u, d, v, butt ? B.basalt : window ? B.iron_bars : brick(...xyz(f, u, d, v)));
  }
  for (let k = 0; k <= 10; k++) for (let u = -17; u <= 17; u++) {
    for (const v of [-11 + k, 11 - k]) f.set(u, 13 + k, v, k % 3 === 2 ? B.basalt : B.cinder_bricks);
    if (Math.abs(u) === 16 || Math.abs(u) === 17) for (let v = -10 + k; v <= 10 - k; v++) f.set(u, 13 + k, v, B.cinder_bricks);
  }
  f.fill(-2, 1, -10, 2, 6, -10, 0);
  // Pillars down the hall, a lava channel along the middle and anvils either side.
  for (let u = -12; u <= 12; u += 6) for (const v of [-6, 6]) for (let d = 1; d <= 12; d++) f.set(u, d, v, d === 12 ? B.magma : B.basalt);
  for (let u = -13; u <= 10; u++) { f.set(u, 0, 0, B.lava); f.set(u, -1, 0, B.cinder_bricks); f.set(u, 1, -1, B.iron_bars); f.set(u, 1, 1, B.iron_bars); }
  for (let u = -12; u <= 8; u += 4) { f.set(u, 1, -3, B.anvil); f.set(u + 2, 1, 3, B.anvil); f.set(u, 1, 3, B.crafting_table); }
  for (let u = -14; u <= 8; u += 2) { f.set(u, 1, 9, B.furnace_lit, f.face(2)); f.set(u, 2, 9, B.furnace, f.face(2)); f.set(u + 1, 1, 9, B.barrel); }
  f.chest(-15, 1, -8, 3, LOOT.forge); f.chest(-15, 1, 8, 3, LOOT.forge); f.chest(8, 1, -9, 0, LOOT.forge);
  for (let u = -12; u <= 12; u += 6) f.set(u, 11, 0, B.lantern, HANG);
  // The great furnace at the far end, its chimney climbing into the dark.
  for (let u = 11; u <= 15; u++) for (let v = -4; v <= 4; v++) for (let d = 1; d <= 10; d++) {
    const shell = u === 11 || u === 15 || Math.abs(v) === 4 || d === 10;
    f.set(u, d, v, shell ? B.cinder_bricks : d <= 2 ? B.lava : 0);
  }
  f.fill(11, 1, -1, 11, 3, 1, B.magma); f.fill(11, 2, 0, 11, 2, 0, B.iron_bars);
  for (let d = 10; d <= 40; d++) for (let u = 12; u <= 14; u++) for (let v = -2; v <= 2; v++) {
    const shell = u === 12 || u === 14 || Math.abs(v) === 2;
    if (shell) f.set(u, d, v, d % 6 === 0 ? B.basalt : B.cinder_bricks); else f.set(u, d, v, 0);
  }
  for (const [u, v] of [[-8, -4], [4, 4], [-2, -7]]) f.spawn('cinderbrute', u, 1, v);
}

// ============================================================== Ashen Spire
export function spire(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const H = 70 + ((s.variant ?? 0) % 8);
  // A shaft of air around the needle, and tunnels for its two bridges.
  for (let u = -11; u <= 11; u++) for (let v = -11; v <= 11; v++) {
    if (Math.hypot(u, v) > 11) continue;
    for (let d = 4; d <= H + 8; d++) if (f.oy + d < 122 && f.get(u, d, v) !== B.bedrock) f.set(u, d, v, 0);
  }
  const BR = 18;
  for (const dir of [-1, 1]) for (let t = 6; t <= 26; t++) for (let w = -2; w <= 2; w++) for (let d = BR; d <= BR + 4; d++) {
    const u = t * dir;
    if (d === BR) { if (Math.abs(w) <= 1) f.set(u, d, w, B.cinder_bricks); continue; }
    if (d === BR + 1 && Math.abs(w) === 2) { if (t < 12) f.set(u, d, w, B.fence); continue; }
    if (t >= 12 && (Math.abs(w) === 2 || d === BR + 4)) f.set(u, d, w, B.cinder_bricks);
    else if (Math.abs(w) <= 1 || t < 12) f.set(u, d, w, 0);
    if (t % 5 === 0 && w === 0 && d === BR + 3 && t >= 12) f.set(u, d, w, B.lantern, HANG);
  }
  // The needle: a ring of obsidian, banded, windowed, floored.
  const top = H - 10;
  for (let d = 0; d <= H; d++) for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) {
    const r = Math.hypot(u, v);
    const R = d > top ? 5.5 - (d - top) * 0.45 : 5.5;
    if (r > R) continue;
    const wall = r > R - 1.2;
    if (d <= 3) { f.set(u, d, v, B.obsidian); if (d === 0) f.foundation(u, -1, v, B.obsidian, 40); continue; }
    if (wall) {
      const window = d % 12 === 0 && (u === 0 || v === 0);
      f.set(u, d, v, window ? B.iron_bars : d % 8 === 0 ? B.cinder_bricks : B.obsidian);
    } else f.set(u, d, v, (d % 12 === 6 || d === top) && !(u === 3 && v === 0) ? B.cinder_bricks : 0);
  }
  f.ladder(3, 4, H - 10, 0, 1);
  for (let d = 4; d <= H - 10; d++) f.set(4, d, 0, B.obsidian);
  for (const dir of [-1, 1]) { f.set(5 * dir, BR + 1, 0, 0); f.set(5 * dir, BR + 2, 0, 0); f.set(4 * dir, BR + 1, 0, 0); f.set(4 * dir, BR + 2, 0, 0); f.set(5 * dir, BR, 0, B.cinder_bricks); f.set(4 * dir, BR, 0, B.cinder_bricks); }
  // Balconies ringing the needle.
  for (const d of [30, 54]) for (let u = -8; u <= 8; u++) for (let v = -8; v <= 8; v++) {
    const r = Math.hypot(u, v);
    if (r > 5.5 && r <= 8) { f.set(u, d, v, B.cinder_bricks); if (r > 7.2) f.set(u, d + 1, v, B.fence); }
  }
  for (const d of [30, 54]) { f.set(0, d + 1, 5, 0); f.set(0, d + 2, 5, 0); f.set(0, d + 1, 4, 0); f.set(0, d + 2, 4, 0); }
  // The crown chamber and its hoard, then the burning tip.
  f.chest(-2, top + 1, 0, 3, LOOT.emberTreasury); f.chest(0, top + 1, -2, 0, LOOT.emberTreasury);
  f.spawner(0, top + 1, 2, 'emberwisp');
  f.set(-2, top + 1, 2, B.lantern);
  for (let d = H + 1; d <= H + 4; d++) f.set(0, d, 0, B.obsidian);
  f.set(0, H + 5, 0, B.magma); f.set(0, H + 6, 0, B.fire);
  for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) brazier(f, u, H + 1, v);
  f.spawn('emberwisp', 0, 40, 8); f.spawn('emberwisp', 0, 58, -8);
}

// ============================================================== Ember Cathedral
export function cathedral(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const brick = b.mix(120, [B.cinder_bricks, 8], [B.basalt, 1]);
  hollow(f, 18, 30, 48, 3);
  f.fill(-13, -2, -25, 13, 0, 24, brick);
  piers(f, 13, 24, 6, B.cinder_bricks);
  f.fill(-8, 0, -21, 8, 0, 21, (x, y, z) => ((x + z) & 1 ? B.cinder_bricks : B.basalt));
  // The nave's walls: emberquartz piers and tall burning windows.
  for (let d = 1; d <= 16; d++) for (const u of [-9, 9]) for (let v = -22; v <= 22; v++) {
    const pier = v % 4 === 0;
    const glass = !pier && d >= 4 && d <= 13;
    f.set(u, d, v, pier ? B.emberquartz_block : glass ? B.stained_glass : brick(...xyz(f, u, d, v)), glass ? (v & 1 ? color('orange') : color('red')) : 0);
  }
  // A pointed vault overhead.
  for (let k = 0; k <= 10; k++) for (let v = -22; v <= 22; v++) {
    const w = 10 - k;
    for (const u of [-w, w]) f.set(u, 17 + k, v, v % 4 === 0 ? B.emberquartz_block : B.cinder_bricks);
    for (let u = -w + 1; u < w; u++) f.set(u, 17 + k, v, 0);
  }
  for (let d = 1; d <= 16; d++) for (let u = -8; u <= 8; u++) for (let v = -21; v <= 21; v++) f.set(u, d, v, 0);
  // The front: a great door, a rose window and two bell towers.
  for (let d = 1; d <= 27; d++) for (let u = -9; u <= 9; u++) {
    const w = d > 16 ? 10 - (d - 17) : 9;
    if (Math.abs(u) > w) continue;
    const door = Math.abs(u) <= 2 && d <= 7;
    const rose = Math.hypot(u, d - 13) <= 3.2;
    for (const v of [-22, 22]) {
      if (v === -22 && door) f.set(u, d, v, 0);
      else if (rose) f.set(u, d, v, B.stained_glass, Math.hypot(u, d - 13) < 1.2 ? color('yellow') : color('red'));
      else f.set(u, d, v, brick(...xyz(f, u, d, v)));
    }
  }
  for (const cu of [-11, 11]) for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) {
    const edge = Math.max(Math.abs(du), Math.abs(dv)) === 2;
    for (let d = 1; d <= 30; d++) f.set(cu + du, d, -22 + dv, edge ? (d % 10 === 5 && (du === 0 || dv === 0) ? B.iron_bars : B.cinder_bricks) : 0);
    for (let k = 0; k <= 2; k++) if (Math.max(Math.abs(du), Math.abs(dv)) === 2 - k) f.set(cu + du, 31 + k, -22 + dv, B.emberquartz_block);
    f.set(cu, 34, -22, B.magma); f.set(cu, 35, -22, B.fire);
    f.set(cu, 28, -22, B.bell);
  }
  // Inside: a red runner, pews, hanging lanterns, and the altar in the apse.
  f.fill(-1, 1, -21, 1, 1, 14, B.carpet, color('red'));
  for (let v = -18; v <= 8; v += 2) for (const side of [-1, 1]) for (let u = 3; u <= 7; u++) f.set(u * side, 1, v, B.cobble_slab);
  for (let v = -18; v <= 18; v += 6) { f.set(-5, 16, v, B.lantern, HANG); f.set(5, 16, v, B.lantern, HANG); f.set(0, 25, v, B.lantern, HANG); }
  f.fill(-7, 1, 14, 7, 1, 21, B.cinder_bricks);
  f.fill(-5, 2, 17, 5, 2, 21, B.cinder_bricks);
  f.fill(-2, 3, 18, 2, 3, 18, B.emberquartz_block);
  f.set(-2, 4, 18, B.ember_cap); f.set(2, 4, 18, B.ember_cap);
  f.chest(-3, 3, 20, 2, LOOT.emberTreasury); f.chest(3, 3, 20, 2, LOOT.emberTreasury);
  f.spawner(0, 3, 20, 'emberwisp');
  for (const u of [-6, 6]) { f.set(u, 2, 20, B.cinder_bricks); brazier(f, u, 3, 20); }
  f.spawn('emberwisp', 0, 6, 0); f.spawn('emberwisp', -4, 6, -12); f.spawn('cinderbrute', 4, 1, 10);
}

// ============================================================== Small finds
export function shrine(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  hollow(f, 9, 9, 10, 2);
  for (let u = -5; u <= 5; u++) for (let v = -5; v <= 5; v++) {
    const r = Math.hypot(u, v);
    if (r > 5.4) continue;
    f.set(u, 0, v, r < 2 ? B.emberquartz_block : B.cinder_bricks);
    f.foundation(u, -1, v, B.cinder_bricks, 50);
  }
  for (const [u, v] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { for (let d = 1; d <= 4; d++) f.set(u, d, v, B.emberquartz_block); brazier(f, u, 5, v); }
  f.set(0, 1, 0, B.emberquartz_block); f.set(0, 2, 0, B.ember_cap);
  f.chest(0, 1, 2, 0, LOOT.emberCache);
  for (const [u, v] of [[-1, -4], [1, 4], [4, 0]]) f.set(u, 1, v, B.ember_cap);
}

export function monoliths(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  hollow(f, 10, 10, 18, 2);
  for (let u = -8; u <= 8; u++) for (let v = -8; v <= 8; v++) {
    const r = Math.hypot(u, v);
    if (r > 8.4) continue;
    f.set(u, 0, v, f.h(u, 0, v, 130) < 0.5 ? B.basalt : B.ashsand);
    f.foundation(u, -1, v, B.basalt, 50);
  }
  const n = 5 + ((s.variant ?? 0) % 3);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const u = Math.round(Math.cos(a) * 5), v = Math.round(Math.sin(a) * 5);
    const h = 6 + Math.floor(f.h(k, 0, 0, 131) * 10);
    const thick = f.h(k, 1, 0, 132) < 0.5;
    for (let d = 1; d <= h; d++) {
      f.set(u, d, v, B.basalt);
      if (thick && d < h - 1) { f.set(u + 1, d, v, B.basalt); f.set(u, d, v + 1, B.basalt); }
    }
    f.set(u - 1, 1, v, B.magma); f.set(u, 1, v - 1, B.magma);
  }
  for (let d = 1; d <= 16; d++) f.set(0, d, 0, d === 16 ? B.magma : B.basalt);
  f.set(0, 17, 0, B.fire);
  f.set(0, 1, 1, 0); f.chest(0, 1, 1, 0, LOOT.emberCache);
}

export function ashcamp(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  hollow(f, 9, 9, 8, 2);
  for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) {
    if (Math.hypot(u, v) > 6.4) continue;
    f.set(u, 0, v, B.ashsand);
    f.foundation(u, -1, v, B.cinderstone, 50);
  }
  f.set(0, 1, 0, B.campfire);
  f.set(-2, 1, 0, B.spruce_log, f.logMeta('v')); f.set(2, 1, 0, B.spruce_log, f.logMeta('v')); f.set(0, 1, -2, B.spruce_log, f.logMeta('u'));
  for (let t = 0; t < 4; t++) for (let k = -2; k <= 2; k++) {
    const d = 3 - Math.abs(k);
    f.set(k, d, 2 + t, B.wool_black);
    for (let dd = 1; dd < d; dd++) f.set(k, dd, 2 + t, 0);
  }
  f.set(0, 1, 3, B.carpet, color('gray'));
  f.set(-4, 1, -2, B.barrel); f.chest(4, 1, -2, 1, LOOT.emberCache);
  f.set(-4, 1, 3, B.fence); f.set(-4, 2, 3, B.fence); f.set(-4, 3, 3, B.lantern);
  f.spawn('skeleton', -3, 1, -3); f.spawn('skeleton', 3, 1, 4);
}

export function lavawell(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  hollow(f, 8, 8, 9, 1);
  for (let u = -5; u <= 5; u++) for (let v = -5; v <= 5; v++) {
    if (Math.hypot(u, v) > 5.4) continue;
    f.set(u, 0, v, B.cinder_bricks);
    f.foundation(u, -1, v, B.cinder_bricks, 50);
  }
  for (let u = -2; u <= 2; u++) for (let v = -2; v <= 2; v++) {
    const r = Math.max(Math.abs(u), Math.abs(v));
    if (r === 2) f.set(u, 1, v, B.cinder_bricks);
    else { for (let d = -4; d <= 0; d++) f.set(u, d, v, B.lava); f.set(u, -5, v, B.cinder_bricks); }
  }
  for (const u of [-2, 2]) for (let d = 2; d <= 5; d++) f.set(u, d, 0, B.basalt);
  f.fill(-2, 6, 0, 2, 6, 0, B.basalt);
  for (let d = 3; d <= 5; d++) f.set(0, d, 0, B.iron_bars);
  f.chest(0, 1, -4, 2, LOOT.emberCache); f.set(3, 1, 3, B.barrel);
}

export function cage(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  hollow(f, 6, 6, 7, 5);
  for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) {
    f.set(u, 0, v, B.cinder_bricks); f.set(u, 4, v, B.cinder_bricks);
    for (let d = 1; d <= 3; d++) f.set(u, d, v, u || v ? B.iron_bars : 0);
  }
  f.chest(0, 1, 0, 0, LOOT.emberCache);
  // The chain, up to whatever holds it.
  for (let d = 5; d < 60; d++) {
    const cur = f.get(0, d, 0);
    if (cur !== 0) break;
    f.set(0, d, 0, B.iron_bars);
  }
  f.spawn('skeleton', 0, 1, -3);
}
