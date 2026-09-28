// The overworld's newer structures. Each builder works in a turned local frame (u across the
// front, v back from it, dy up from the ground) and writes only what falls in the chunk being
// generated; see builder.ts.
//
//   Raider Outpost      a timber watchtower over a camp of tents, cages and practice dummies
//   Thornwood Manor     a three-storey slate-roofed house in a hedged garden, with a cellar
//   Tidewatch Citadel   a drowned marble castle on the deep sea floor around an amber heart
//   Vinecrown Ziggurat  a stepped jungle pyramid with a rooftop shrine and a trapped vault
//   Frost Keep          a walled castle in the snow, with towers, a throne room and a cold cellar
//   Echo Vault          a buried hall of deepstone far underground, around a great dark arch
//   and the smaller finds: witch huts, igloos, desert wells, ruined Ember Gates, fossils,
//   ocean ruins, travellers' camps, standing stones and hunters' cabins.

import { B, DYE_COLORS, POTTED, type DyeColor } from '../blocks';
import { SEA_LEVEL } from './chunk';
import type { Builder, Frame } from './builder';
import { LOOT, type Structure } from './structure-kinds';

const color = (c: DyeColor) => DYE_COLORS.indexOf(c);
const potted = (id: number) => Math.max(0, POTTED.indexOf(id));
const sea = (y: number) => (y <= SEA_LEVEL ? B.water : 0);
/** Hanging lanterns carry meta 1. */
const HANG = 1;

// ============================================================== Raider Outpost
export function outpost(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const ground = s.ground ?? B.grass;
  const H = 15 + ((s.variant ?? 0) % 3); // the lookout deck
  f.yard(-12, -12, 12, 12, b.mix(1, [ground, 5], [B.coarse_dirt, 2], [B.gravel, 1]), B.dirt, H + 12);
  const cob = b.mix(2, [B.cobblestone, 6], [B.mossy_cobblestone, 2], [B.stone, 1]);
  f.fill(-5, 0, -5, 5, 0, 5, cob);

  // The tower: log corners, a cobbled plinth, plank walls, three floors.
  const floors = new Set([5, 10, H]);
  for (let d = 1; d <= H; d++) for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) {
    const eu = Math.abs(u) === 4, ev = Math.abs(v) === 4;
    if (eu && ev) { f.set(u, d, v, B.spruce_log); continue; }
    if (!eu && !ev) { f.set(u, d, v, floors.has(d) ? B.planks : 0); continue; }
    const mid = eu ? v === 0 : u === 0;
    if (mid && (d === 7 || d === 8 || d === 12 || d === 13)) f.set(u, d, v, 0);
    else if (d <= 3) f.set(u, d, v, cob(...xyz(f, u, d, v)));
    else if (floors.has(d)) f.set(u, d, v, B.spruce_log, f.logMeta(eu ? 'v' : 'u'));
    else f.set(u, d, v, B.planks);
  }
  f.set(0, 1, -4, 0); f.set(0, 2, -4, 0); // doorway
  f.ladder(2, 1, H, 3, 2);
  // Floor one: stores. Floor two: bedrolls. Floor three: the armoury.
  f.set(-3, 1, 3, B.barrel); f.set(-3, 2, 3, B.barrel); f.set(-2, 1, 3, B.crafting_table); f.set(3, 1, -3, B.barrel);
  f.set(-3, 1, -3, B.furnace, f.face(3));
  for (const u of [-3, -1]) { f.set(u, 6, -3, B.carpet, color('gray')); f.set(u, 6, -2, B.carpet, color('gray')); }
  f.set(3, 6, -3, B.lantern);
  f.set(-3, 11, 3, B.anvil); f.chest(-3, 11, -3, 0, LOOT.outpost); f.set(3, 11, -3, B.barrel);
  f.set(0, 9, 0, B.lantern, HANG); f.set(0, 14, 0, B.lantern, HANG);

  // The deck: an overhanging floor with a railing, corner posts and a pyramid roof.
  f.fill(-6, H, -6, 6, H, 6, B.planks);
  f.set(2, H, 3, B.ladder, f.face(2));
  for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) {
    const rim = Math.abs(u) === 6 || Math.abs(v) === 6;
    if (!rim) continue;
    if (Math.abs(u) === 6 && Math.abs(v) === 6) for (let d = H + 1; d <= H + 4; d++) f.set(u, d, v, B.spruce_log);
    else f.set(u, H + 1, v, B.fence);
  }
  for (let k = 0; k <= 4; k++) {
    const r = 7 - k * 2 < 0 ? 0 : 7 - k * 2;
    for (let u = -r; u <= r; u++) for (let v = -r; v <= r; v++) {
      const edge = Math.abs(u) === r || Math.abs(v) === r;
      f.set(u, H + 5 + k, v, k === 0 ? (edge ? B.plank_slab : B.planks) : edge ? B.planks : 0);
    }
    if (r === 0) break;
  }
  for (let d = H + 6; d <= H + 11; d++) f.set(0, d, 0, d === H + 11 ? B.banner : B.fence, d === H + 11 ? 64 | (color('black') << 2) : 0);
  f.chest(-5, H + 1, -5, 3, LOOT.outpost);
  f.set(5, H + 1, 5, B.barrel);
  f.set(0, H + 4, 0, B.lantern, HANG);
  // Banners down each face.
  for (const [u, v, fc] of [[0, 5, 0], [0, -5, 2], [5, 0, 3], [-5, 0, 1]] as const) { f.banner(u, H - 2, v, fc, color('black')); f.banner(u, H - 3, v, fc, color('gray')); }

  // The camp around it.
  for (const tu of [-9, 9]) tent(f, tu, -4, 'v', B.wool_gray, B.carpet, color('black'));
  cage(f, -8, 8); f.spawn('villager', -8, 1, 8, 'farmer');
  cage(f, -4, 9);
  f.spawn('woolback', -4, 1, 9);
  for (const [u, v] of [[8, 7], [10, 9], [7, 10]]) dummy(f, u, v);
  f.set(0, 1, -9, B.campfire);
  f.set(-2, 1, -9, B.spruce_log, f.logMeta('v')); f.set(2, 1, -9, B.spruce_log, f.logMeta('v')); f.set(0, 1, -11, B.spruce_log, f.logMeta('u'));
  for (let u = 7; u <= 9; u++) for (let d = 1; d <= 2; d++) { f.set(u, d, -9, B.spruce_log, f.logMeta('u')); f.set(u, d, -8, B.spruce_log, f.logMeta('u')); }
  f.set(8, 3, -9, B.spruce_log, f.logMeta('u'));
  f.set(10, 1, -6, B.barrel); f.set(10, 1, -5, B.hay_bale);

  for (const [u, d, v] of [[0, 1, -6], [-6, 1, 3], [6, 1, -3], [3, 1, 8], [1, H + 1, 1]] as const) f.spawn('raider', u, d, v);
}

function xyz(f: Frame, u: number, d: number, v: number): [number, number, number] { const [x, z] = f.at(u, v); return [x, f.oy + d, z]; }

/** An A-frame tent, five long, opening at both ends. */
function tent(f: Frame, cu: number, cv: number, along: 'u' | 'v', wool: number, bedroll: number, rollColor: number): void {
  for (let t = 0; t < 5; t++) for (let k = -2; k <= 2; k++) {
    const [u, v] = along === 'v' ? [cu + k, cv + t] : [cu + t, cv + k];
    const d = 3 - Math.abs(k);
    f.set(u, d, v, wool);
    for (let dd = 1; dd < d; dd++) f.set(u, dd, v, 0);
  }
  const [bu, bv] = along === 'v' ? [cu, cv + 1] : [cu + 1, cv];
  f.set(bu, 1, bv, bedroll, rollColor);
  f.set(along === 'v' ? bu : bu + 1, 1, along === 'v' ? bv + 1 : bv, bedroll, rollColor);
}

/** A little iron cage with a slab roof. */
function cage(f: Frame, cu: number, cv: number): void {
  for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) {
    f.set(cu + du, 0, cv + dv, B.cobblestone);
    for (let d = 1; d <= 2; d++) f.set(cu + du, d, cv + dv, du || dv ? B.iron_bars : 0);
    f.set(cu + du, 3, cv + dv, B.plank_slab);
  }
}

/** A practice dummy: a post with arms and a carved head. */
function dummy(f: Frame, u: number, v: number): void {
  f.set(u, 1, v, B.fence); f.set(u, 2, v, B.fence); f.set(u - 1, 2, v, B.fence); f.set(u + 1, 2, v, B.fence);
  f.set(u, 3, v, B.pumpkin, f.face(2));
}

// ============================================================== Thornwood Manor
export function manor(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const ground = s.ground ?? B.grass;
  f.yard(-20, -20, 20, 14, ground, B.dirt, 32);
  const stone = b.mix(3, [B.cobblestone, 5], [B.mossy_cobblestone, 2], [B.stone_bricks, 2]);
  // The garden: a clipped hedge with a gate, a gravel walk, a fountain and flower beds.
  for (let u = -20; u <= 20; u++) for (let v = -20; v <= 14; v++) {
    const rim = Math.abs(u) === 20 || v === -20 || v === 14;
    if (rim && !(v === -20 && Math.abs(u) <= 1)) { f.set(u, 1, v, B.leaves); f.set(u, 2, v, B.leaves); }
  }
  for (const u of [-2, 2]) for (let d = 1; d <= 3; d++) f.set(u, d, -20, d === 3 ? B.lantern : B.stone_bricks);
  f.fill(-1, 0, -19, 1, 0, -11, B.gravel);
  for (let u = -2; u <= 2; u++) for (let v = -17; v <= -13; v++) {
    const r = Math.max(Math.abs(u), Math.abs(v + 15));
    if (r === 2) f.set(u, 1, v, B.stone_bricks);
    if (r <= 1) { f.set(u, 0, v, B.stone_bricks); f.set(u, 1, v, B.water); }
  }
  f.set(0, 1, -15, B.stone_bricks); f.set(0, 2, -15, B.stone_bricks); f.set(0, 3, -15, B.flower_pot, potted(B.blue_flower));
  const blooms = [B.poppy, B.blue_flower, B.white_flower, B.purple_flower, B.bush];
  for (const side of [-1, 1]) for (let u = 5; u <= 16; u++) for (let v = -18; v <= -12; v++) {
    const uu = u * side;
    if (u === 5 || u === 16 || v === -18 || v === -12) { f.set(uu, 1, v, B.spruce_log, f.logMeta(v === -18 || v === -12 ? 'u' : 'v')); continue; }
    f.set(uu, 0, v, B.dirt);
    f.set(uu, 1, v, blooms[Math.floor(f.h(uu, 1, v, 4) * blooms.length)]);
  }

  // The house.
  const F2 = 6, F3 = 12, TOP = 17;
  f.fill(-15, -6, -10, 15, 0, 10, stone);
  const post = (u: number, v: number) => (Math.abs(v) === 10 && (u + 15) % 5 === 0) || (Math.abs(u) === 15 && (v + 10) % 5 === 0);
  const pane = (u: number, v: number) => (Math.abs(v) === 10 ? [2, 3].includes((u + 15) % 5) : [2, 3].includes((v + 10) % 5));
  for (let d = 1; d <= TOP; d++) for (let u = -15; u <= 15; u++) for (let v = -10; v <= 10; v++) {
    const edge = Math.abs(u) === 15 || Math.abs(v) === 10;
    if (!edge) { f.set(u, d, v, d === F2 || d === F3 || d === TOP ? B.planks : 0); continue; }
    if (post(u, v)) f.set(u, d, v, B.spruce_log);
    else if (d === 1) f.set(u, d, v, stone(...xyz(f, u, d, v)));
    else if (d === F2 || d === F3 || d === TOP) f.set(u, d, v, B.spruce_log, f.logMeta(Math.abs(v) === 10 ? 'u' : 'v'));
    else if (pane(u, v) && (d === 3 || d === 4 || d === 8 || d === 9 || d === 14 || d === 15)) f.set(u, d, v, B.glass_pane);
    else f.set(u, d, v, B.planks);
  }
  // The porch and its balcony over the front door.
  for (const u of [-4, 4]) for (let d = 1; d <= 5; d++) f.set(u, d, -13, B.spruce_log);
  f.fill(-4, 6, -13, 4, 6, -11, B.planks);
  for (let u = -4; u <= 4; u++) f.set(u, 7, -13, B.fence);
  f.set(-4, 7, -12, B.fence); f.set(4, 7, -12, B.fence); f.set(-4, 7, -11, B.fence); f.set(4, 7, -11, B.fence);
  f.fill(-1, 1, -10, 1, 3, -10, 0);
  f.fill(-1, 7, -10, 1, 8, -10, 0);
  f.fill(-3, 0, -13, 3, 0, -11, B.stone_bricks);
  f.set(0, 5, -12, B.lantern, HANG);
  // Inner walls between the hall and the wings, with doorways.
  for (const u of [-5, 5]) for (let d = 1; d <= TOP - 1; d++) for (let v = -9; v <= 9; v++) {
    if (d === F2 || d === F3) continue;
    const door = Math.abs(v) <= 1 && ((d >= 1 && d <= 3) || (d >= 7 && d <= 9) || (d >= 13 && d <= 15));
    f.set(u, d, v, door ? 0 : v === 0 || Math.abs(v) === 9 ? B.spruce_log : B.planks);
  }
  // Red runner up the hall, chandeliers, and a staircase in two flights at the back.
  f.fill(-1, 1, -9, 1, 1, 5, B.carpet, color('red'));
  for (const v of [-6, 0]) { f.set(0, 5, v, B.lantern, HANG); f.set(0, 11, v, B.lantern, HANG); }
  for (let k = 1; k <= 6; k++) {
    f.fill(-4 + k, 1, 7, -4 + k, k, 8, B.planks);
    f.fill(4 - k, F2 + 1, 4, 4 - k, F2 + k, 5, B.planks);
  }
  f.fill(-3, F2, 7, 1, F2, 8, 0);
  f.fill(-1, F3, 4, 3, F3, 5, 0);
  for (let u = -3; u <= 1; u++) f.set(u, F2 + 1, 6, B.fence);
  for (let u = -1; u <= 3; u++) f.set(u, F3 + 1, 3, B.fence);
  // Floor one, west: the dining room.
  f.fill(-13, 1, -1, -7, 1, 1, B.carpet, color('green'));
  for (let u = -12; u <= -8; u++) { f.set(u, 1, 0, B.plank_slab); if (u % 2 === 0) { f.set(u, 1, -2, B.oak_stairs, f.face(0)); f.set(u, 1, 2, B.oak_stairs, f.face(2)); } }
  f.set(-10, 5, 0, B.lantern, HANG); f.set(-14, 1, -9, B.barrel); f.set(-14, 1, 9, B.smoker, f.face(3)); f.set(-13, 1, 9, B.barrel);
  f.set(-14, 1, 5, B.flower_pot, potted(B.poppy));
  // Floor one, east: the library.
  for (let u = 6; u <= 14; u++) for (let v = -9; v <= 9; v++) for (let d = 1; d <= 4; d++) {
    const wall = u === 14 || Math.abs(v) === 9;
    const stack = (v === -4 || v === 4) && u >= 8 && u <= 12;
    if ((wall && !(Math.abs(v) <= 1 && u === 14)) || stack) f.set(u, d, v, B.bookshelf);
  }
  f.set(10, 1, 0, B.enchanting_table); f.set(10, 5, 0, B.lantern, HANG);
  f.fill(8, 1, -1, 12, 1, 1, B.carpet, color('purple'));
  // Floor two, west: two bedrooms.
  for (let u = -14; u <= -6; u++) for (let d = F2 + 1; d <= F3 - 1; d++) f.set(u, d, 0, u === -10 && d <= F2 + 3 ? 0 : B.planks);
  for (const v of [-7, 7]) {
    f.fill(-14, F2 + 1, v - 1, -12, F2 + 1, v + 1, B.wool_red);
    f.set(-14, F2 + 1, v, B.wool); f.set(-14, F2 + 2, v, B.carpet, color('white'));
    f.set(-8, F2 + 1, v, B.barrel); f.set(-10, F3 - 1, v, B.lantern, HANG);
    f.fill(-11, F2 + 1, v - 1, -9, F2 + 1, v + 1, B.carpet, color('brown'));
  }
  // Floor two, east: the study, and a sealed room behind the books.
  for (let v = -9; v <= 9; v++) for (let d = F2 + 1; d <= F3 - 1; d++) f.set(14, d, v, B.bookshelf);
  for (let u = 11; u <= 14; u++) for (let v = 5; v <= 9; v++) for (let d = F2 + 1; d <= F3 - 1; d++) {
    const shell = u === 11 || v === 5;
    f.set(u, d, v, shell ? B.bookshelf : 0);
  }
  f.chest(13, F2 + 1, 8, 2, LOOT.manor); f.set(12, F2 + 1, 8, B.gold_block); f.set(13, F2 + 1, 6, B.flower_pot, potted(B.dead_bush));
  f.set(12, F3 - 1, 7, B.lantern, HANG);
  f.set(8, F2 + 1, -6, B.crafting_table); f.set(9, F2 + 1, -6, B.barrel); f.set(8, F2 + 1, -2, B.anvil);
  f.set(10, F3 - 1, -3, B.lantern, HANG);
  // Floor three: a storeroom, and the witch's workroom.
  for (let u = -14; u <= -6; u++) for (let v = -9; v <= 9; v++) {
    const r = f.h(u, F3 + 1, v, 6);
    if (r < 0.12) f.set(u, F3 + 1, v, B.barrel);
    else if (r < 0.2) f.set(u, F3 + 1, v, B.spruce_log, f.logMeta('u'));
    else if (r < 0.26) f.set(u, TOP - 1, v, B.cobweb);
  }
  f.chest(-14, F3 + 1, 0, 3, LOOT.manor);
  f.set(10, F3 + 1, 0, B.brewing_stand); f.set(8, F3 + 1, 0, B.composter);
  f.set(13, F3 + 1, -6, B.flower_pot, potted(B.red_mushroom)); f.set(13, F3 + 1, -5, B.flower_pot, potted(B.brown_mushroom));
  f.set(11, TOP - 1, 0, B.lantern, HANG); f.set(-10, TOP - 1, 0, B.lantern, HANG);
  f.chest(12, F3 + 1, 3, 2, LOOT.manor);
  // The roof: a steep slate gable along the length, with brick chimneys.
  for (let k = 0; k <= 11; k++) {
    const d = TOP + 1 + k;
    for (let u = -16; u <= 16; u++) {
      for (const v of [-11 + k, 11 - k]) f.set(u, d, v, B.polished_slate);
      if (Math.abs(u) === 15) for (let v = -10 + k; v <= 10 - k; v++) f.set(u, d, v, Math.abs(v) <= 1 && k < 6 ? B.glass_pane : B.planks);
      else if (Math.abs(u) < 15) for (let v = -10 + k; v <= 10 - k; v++) f.set(u, d, v, 0);
    }
  }
  for (const u of [-10, 10]) {
    for (let d = F3; d <= TOP + 11; d++) { f.set(u, d, 5, B.bricks); f.set(u + 1, d, 5, B.bricks); }
    f.set(u, TOP + 12, 5, B.campfire); f.set(u + 1, TOP + 12, 5, B.bricks);
  }
  // The cellar: wine barrels, a cage of bones, and the family silver.
  f.fill(-12, -5, -8, 12, -1, 8, 0);
  f.fill(-12, -6, -8, 12, -6, 8, B.stone_bricks);
  for (let u = -12; u <= 12; u += 6) for (let v = -8; v <= 8; v += 8) for (let d = -5; d <= -1; d++) f.set(u, d, v, B.stone_bricks);
  f.ladder(4, -5, 0, 9, 2);
  f.spawner(0, -5, 0, 'skeleton');
  for (let u = -11; u <= -7; u++) { f.set(u, -5, -7, B.barrel); f.set(u, -4, -7, B.barrel); }
  f.chest(-11, -5, 7, 2, LOOT.manor); f.chest(11, -5, -7, 0, LOOT.manor);
  f.set(-6, -1, 0, B.lantern, HANG); f.set(6, -1, 0, B.lantern, HANG);
  for (let k = 0; k < 20; k++) { const u = -11 + Math.floor(f.h(k, -3, 0, 9) * 23), v = -7 + Math.floor(f.h(k, -2, 1, 9) * 15); if (f.h(u, -1, v, 10) < 0.6) f.set(u, -1, v, B.cobweb); }

  f.spawn('raider', -2, 1, -6); f.spawn('raider', 2, 1, 2);
  f.spawn('witch', 10, F3 + 1, 2); f.spawn('witch', -10, F2 + 1, -3);
}

// ============================================================== Tidewatch Citadel
export function citadel(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const cap = SEA_LEVEL - 1 - s.y; // the highest dy that stays under water
  const marble = b.mix(5, [B.polished_marble, 5], [B.marble, 3], [B.mossy_stone_bricks, 1]);
  const brick = b.mix(6, [B.stone_bricks, 5], [B.mossy_stone_bricks, 3], [B.cracked_stone_bricks, 2]);
  const ruin = (x: number, y: number, z: number, id: number) => (b.h(x, y, z, 7) < 0.07 ? sea(y) : id);
  const put = (u: number, d: number, v: number, id: number) => { if (d > cap) return; const [x, z] = f.at(u, v); f.set(u, d, v, ruin(x, f.oy + d, z, id)); };
  f.yard(-19, -19, 19, 19, b.mix(8, [B.sand, 4], [B.gravel, 1]), B.sand, cap, (_x, y) => sea(y));
  f.fill(-17, 0, -17, 17, 0, 17, (x, y, z) => ((x + z) & 1 ? B.polished_marble : B.stone_bricks));
  for (let u = -17; u <= 17; u++) for (let v = -17; v <= 17; v++) f.foundation(u, -1, v, brick, 20);

  // The curtain wall with a gate and arched windows.
  for (let u = -16; u <= 16; u++) for (let v = -16; v <= 16; v++) {
    if (Math.max(Math.abs(u), Math.abs(v)) !== 16) continue;
    const along = Math.abs(v) === 16 ? u : v;
    for (let d = 1; d <= 8; d++) {
      const gate = Math.abs(along) <= 2 && d <= 4;
      const window = d === 6 && Math.abs(along) % 4 === 2;
      if (gate || window) continue;
      const [x, z] = f.at(u, v);
      put(u, d, v, d === 8 ? B.polished_marble : d === 3 && Math.abs(along) % 4 === 0 ? B.glowstone : brick(x, f.oy + d, z));
    }
    if (Math.abs(along) % 2 === 0) put(u, 9, v, B.stone_bricks);
  }
  // Corner towers crowned with crystal.
  const TH = Math.min(18, cap);
  for (const [cu, cv] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
    for (let du = -3; du <= 3; du++) for (let dv = -3; dv <= 3; dv++) {
      const edge = Math.max(Math.abs(du), Math.abs(dv)) === 3;
      const corner = Math.abs(du) === 3 && Math.abs(dv) === 3;
      for (let d = 1; d <= TH; d++) {
        if (!edge) { put(cu + du, d, cv + dv, d % 6 === 0 ? B.polished_marble : sea(f.oy + d)); continue; }
        const [x, z] = f.at(cu + du, cv + dv);
        put(cu + du, d, cv + dv, corner ? B.polished_marble : d === TH - 1 ? B.crystal_block : d % 5 === 3 && (du === 0 || dv === 0) ? B.glass : marble(x, f.oy + d, z));
      }
      if (edge && (du + dv) % 2 === 0) put(cu + du, TH + 1, cv + dv, B.polished_marble);
    }
    put(cu, 1, cv, B.glowstone);
    put(cu, 6, cv, B.glowstone);
    put(cu, 12, cv, B.glowstone);
  }
  // Courtyard pillars and sea lamps.
  for (let u = -10; u <= 10; u += 5) for (let v = -10; v <= 10; v += 5) {
    if (Math.max(Math.abs(u), Math.abs(v)) < 9) continue;
    for (let d = 1; d <= 6; d++) put(u, d, v, d === 6 ? B.glowstone : B.mossy_stone_bricks);
  }
  for (let k = 0; k < 40; k++) {
    const u = -15 + Math.floor(f.h(k, 0, 3, 11) * 31), v = -15 + Math.floor(f.h(k, 0, 4, 11) * 31);
    if (Math.max(Math.abs(u), Math.abs(v)) > 7 && Math.max(Math.abs(u), Math.abs(v)) < 15 && f.get(u, 1, v) === B.water) {
      const tall = 1 + Math.floor(f.h(u, 1, v, 12) * 5);
      for (let d = 1; d <= tall; d++) put(u, d, v, d === 1 && tall === 1 ? B.seagrass : B.kelp);
    }
  }
  // The keep: a marble hall rising to a stepped dome, its heart a block of amber.
  const KH = Math.min(12, cap - 4);
  for (let d = 1; d <= KH + 5 && d <= cap; d++) for (let u = -7; u <= 7; u++) for (let v = -7; v <= 7; v++) {
    const r = Math.max(Math.abs(u), Math.abs(v));
    const [x, z] = f.at(u, v);
    if (d <= KH) {
      if (r === 7) {
        const door = Math.abs(u) <= 1 && v === -7 && d <= 3;
        const window = d >= 5 && d <= 8 && (Math.abs(u) === 3 || Math.abs(v) === 3);
        put(u, d, v, door ? sea(f.oy + d) : window ? B.glass : d === KH ? B.crystal_block : d === 2 && (u + v) % 4 === 0 ? B.glowstone : marble(x, f.oy + d, z));
      } else put(u, d, v, sea(f.oy + d));
    } else {
      const rr = 7 - (d - KH) * 1.4;
      const dist = Math.hypot(u, v);
      if (dist <= rr && dist > rr - 1.5) put(u, d, v, B.polished_marble);
      else if (dist <= rr - 1.5) put(u, d, v, sea(f.oy + d));
    }
  }
  for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) { put(u, 1, v, B.polished_marble); for (let d = 2; d <= 4; d++) put(u, d, v, B.amber_block); }
  for (const [u, v] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) for (let d = 1; d <= KH - 1; d++) put(u, d, v, d === KH - 1 ? B.glowstone : B.polished_marble);
  f.chest(-6, 1, 6, 2, LOOT.citadel); f.chest(6, 1, 6, 2, LOOT.citadel); f.chest(0, 1, 6, 2, LOOT.citadel);
  f.spawner(-4, 1, 0, 'zombie'); f.spawner(4, 1, 0, 'zombie');
  for (const [u, v] of [[0, -12], [-10, 0], [10, 3]]) f.spawn('zombie', u, 1, v);
}

// ============================================================== Vinecrown Ziggurat
export function ziggurat(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const ground = s.ground ?? B.grass;
  const rock = b.mix(13, [B.mossy_cobblestone, 4], [B.cobblestone, 3], [B.mossy_stone_bricks, 3], [B.stone_bricks, 2]);
  f.yard(-16, -22, 16, 16, b.mix(14, [ground, 3], [B.moss_block, 1]), B.dirt, 24);
  f.fill(-14, -1, -14, 14, 0, 14, rock);
  // Five tiers, three high, each stepping in two.
  for (let t = 0; t < 5; t++) {
    const half = 13 - 2 * t;
    f.fill(-half, 1 + 3 * t, -half, half, 3 + 3 * t, half, rock);
    // A band of carved stone round the top of each tier.
    for (let u = -half; u <= half; u++) for (let v = -half; v <= half; v++) if (Math.max(Math.abs(u), Math.abs(v)) === half && (u + v) % 3 === 0) f.set(u, 2 + 3 * t, v, B.polished_granite);
    // Vines trailing down each face.
    for (let k = -half + 1; k < half; k++) for (const [u, v, fc] of [[k, -half - 1, 2], [k, half + 1, 0], [-half - 1, k, 1], [half + 1, k, 3]] as const) {
      if (f.h(u, t, v, 15) > 0.3) continue;
      const len = 1 + Math.floor(f.h(u, t, v, 16) * 3);
      for (let d = 3 + 3 * t; d > 3 + 3 * t - len && d >= 1; d--) f.set(u, d, v, B.vine, f.face(fc));
    }
  }
  // The great stair up the front, cut into the tiers.
  for (let k = 1; k <= 15; k++) {
    const v = -21 + k;
    f.fill(-2, 1, v, 2, k - 1, v, rock);
    f.fill(-1, k, v, 1, k, v, B.stone_bricks);
    f.set(-2, k, v, B.mossy_stone_bricks); f.set(2, k, v, B.mossy_stone_bricks);
    f.fill(-1, k + 1, v, 1, k + 4, v, 0);
    if (k % 4 === 0) { f.set(-2, k + 1, v, B.torch); f.set(2, k + 1, v, B.torch); }
  }
  // The rooftop shrine.
  for (const [u, v] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) for (let d = 16; d <= 19; d++) f.set(u, d, v, d === 19 ? B.polished_granite : B.mossy_stone_bricks);
  f.fill(-4, 20, -4, 4, 20, 4, rock);
  f.fill(-2, 21, -2, 2, 21, 2, B.mossy_stone_bricks);
  f.set(0, 22, 0, B.gold_block);
  f.set(0, 16, 1, B.polished_granite); f.chest(0, 17, 1, 2, LOOT.ziggurat);
  for (const u of [-1, 1]) f.set(u, 16, 1, B.flower_pot, potted(B.bamboo));
  f.set(0, 19, 0, B.lantern, HANG);
  for (let k = -4; k <= 4; k++) for (const [u, v, fc] of [[k, -5, 2], [k, 5, 0], [-5, k, 1], [5, k, 3]] as const) if (f.h(u, 20, v, 17) < 0.5) f.set(u, 20, v, B.vine, f.face(fc));

  // The vault inside the bottom tiers, reached by a narrow passage behind the vines at the back.
  f.fill(-7, 1, -7, 7, 5, 7, 0);
  for (let u = -7; u <= 7; u++) for (let v = -7; v <= 7; v++) f.set(u, 0, v, (u + v) & 1 ? B.mossy_stone_bricks : B.polished_granite);
  for (const [u, v] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) for (let d = 1; d <= 5; d++) f.set(u, d, v, B.polished_granite);
  f.fill(0, 1, 8, 0, 2, 14, 0);
  f.set(0, 1, 11, B.pressure_plate); f.set(0, 0, 11, B.tnt); f.set(0, -1, 11, B.tnt); f.set(1, -1, 11, B.tnt); f.set(-1, -1, 11, B.tnt);
  f.set(0, 1, 14, B.vine, f.face(0)); f.set(0, 2, 14, B.vine, f.face(0));
  f.spawner(0, 1, 0, 'brambler');
  f.chest(-6, 1, 6, 2, LOOT.ziggurat); f.chest(6, 1, -6, 0, LOOT.ziggurat);
  for (let k = 0; k < 30; k++) {
    const u = -6 + Math.floor(f.h(k, 5, 0, 18) * 13), v = -6 + Math.floor(f.h(k, 5, 1, 18) * 13);
    const r = f.h(u, 5, v, 19);
    if (u === 0 && v === 0) continue;
    if (r < 0.4) f.set(u, 5, v, B.glowmoss); else if (r < 0.7) f.set(u, 1, v, B.cobweb); else f.set(u, 4, v, B.cobweb);
  }
  f.spawn('brambler', 6, 1, -10); f.spawn('brambler', -9, 1, 12);
}

// ============================================================== Frost Keep
export function frostkeep(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const wall = b.mix(20, [B.stone_bricks, 6], [B.cracked_stone_bricks, 1], [B.packed_ice, 2], [B.mossy_stone_bricks, 1]);
  f.yard(-16, -16, 16, 16, b.mix(21, [B.snow, 3], [B.packed_ice, 1], [B.snowy_grass, 2]), B.dirt, 26);
  f.fill(-13, 0, -13, 13, 0, 13, b.mix(22, [B.snow, 2], [B.packed_ice, 2], [B.stone_bricks, 1]));
  // Curtain walls with battlements and a walk.
  for (let u = -13; u <= 13; u++) for (let v = -13; v <= 13; v++) {
    const r = Math.max(Math.abs(u), Math.abs(v));
    if (r === 13) {
      for (let d = 1; d <= 8; d++) f.set(u, d, v, wall(...xyz(f, u, d, v)));
      if ((u + v) % 2 === 0) f.set(u, 9, v, B.stone_bricks);
      f.foundation(u, 0, v, B.stone_bricks, 12);
    } else if (r === 12) { f.set(u, 8, v, B.stone_bricks); f.set(u, 9, v, B.snow_layer); }
  }
  // The gatehouse: an arch with a raised portcullis and blue banners.
  f.fill(-1, 1, -13, 1, 4, -12, 0);
  f.fill(-1, 4, -13, 1, 4, -13, B.iron_bars);
  for (const u of [-3, 3]) { f.banner(u, 6, -14, 2, color('light_blue')); f.banner(u, 5, -14, 2, color('white')); }
  f.set(-2, 3, -14, B.lantern); f.set(2, 3, -14, B.lantern);
  f.ladder(-12, 1, 8, -8, 3);
  // Corner towers with ice spires.
  for (const [cu, cv] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) {
    for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) {
      const edge = Math.max(Math.abs(du), Math.abs(dv)) === 2;
      for (let d = 1; d <= 13; d++) f.set(cu + du, d, cv + dv, edge ? (d === 11 && (du === 0 || dv === 0) ? B.ice : wall(...xyz(f, cu + du, d, cv + dv))) : d === 8 ? B.planks : 0);
      f.foundation(cu + du, 0, cv + dv, B.stone_bricks, 12);
    }
    for (let k = 0; k <= 3; k++) for (let du = -3 + k; du <= 3 - k; du++) for (let dv = -3 + k; dv <= 3 - k; dv++) {
      if (Math.max(Math.abs(du), Math.abs(dv)) === 3 - k) f.set(cu + du, 14 + k, cv + dv, k === 3 ? B.ice : B.packed_ice);
    }
    f.set(cu, 12, cv, B.lantern, HANG);
    f.set(cu, 9, cv, B.barrel);
  }
  // The keep at the back.
  const K = { u0: -7, u1: 7, v0: 2, v1: 12 }, KH = 14;
  for (let d = 1; d <= KH; d++) for (let u = K.u0; u <= K.u1; u++) for (let v = K.v0; v <= K.v1; v++) {
    const edge = u === K.u0 || u === K.u1 || v === K.v0 || v === K.v1;
    if (!edge) { f.set(u, d, v, d === 7 || d === KH ? B.polished_marble : 0); continue; }
    const corner = (u === K.u0 || u === K.u1) && (v === K.v0 || v === K.v1);
    const window = !corner && (d === 3 || d === 4 || d === 10 || d === 11) && (Math.abs(u) === 4 || v === 7);
    f.set(u, d, v, corner ? B.polished_marble : window ? B.ice : wall(...xyz(f, u, d, v)));
  }
  for (let u = K.u0; u <= K.u1; u++) for (let v = K.v0; v <= K.v1; v++) if ((u === K.u0 || u === K.u1 || v === K.v0 || v === K.v1) && (u + v) % 2 === 0) f.set(u, KH + 1, v, B.stone_bricks);
  f.fill(-1, 1, 2, 1, 3, 2, 0);
  for (const u of [-2, 2]) f.banner(u, 5, 1, 2, color('blue'));
  // The throne room.
  f.fill(-6, 0, 3, 6, 0, 11, B.polished_marble);
  f.fill(-1, 1, 3, 1, 1, 9, B.carpet, color('blue'));
  f.fill(-1, 1, 10, 1, 1, 11, B.polished_marble);
  f.set(0, 2, 10, B.oak_stairs, f.face(2)); f.set(0, 2, 11, B.packed_ice); f.set(0, 3, 11, B.packed_ice); f.set(0, 4, 11, B.gold_block);
  f.set(-1, 2, 11, B.ice); f.set(1, 2, 11, B.ice);
  f.chest(-5, 1, 11, 2, LOOT.frostkeep); f.chest(5, 1, 11, 2, LOOT.frostkeep);
  for (const u of [-5, 5]) for (const v of [4, 8]) for (let d = 1; d <= 6; d++) f.set(u, d, v, d === 6 ? B.lantern : B.polished_marble);
  f.set(0, 6, 6, B.lantern, HANG);
  f.ladder(6, 1, 7, 3, 1);
  // Upstairs: barracks.
  for (const u of [-5, -3, 3]) { f.set(u, 8, 11, B.wool_light_blue); f.set(u, 8, 10, B.wool_light_blue); f.set(u, 9, 11, B.carpet, color('white')); }
  f.set(-6, 8, 4, B.barrel); f.set(-5, 8, 4, B.crafting_table); f.set(0, 13, 7, B.lantern, HANG);
  // The cold cellar.
  f.fill(-5, -5, 4, 5, -1, 10, 0);
  f.fill(-6, -6, 3, 6, -6, 11, B.stone_bricks);
  f.ladder(-6, -5, 0, 7, 3);
  f.spawner(0, -5, 7, 'frostling');
  f.chest(4, -5, 10, 2, LOOT.frostkeep);
  f.fill(-5, -5, 10, -3, -4, 10, B.packed_ice);
  f.set(0, -1, 7, B.lantern, HANG);
  // A frozen well in the courtyard.
  for (let u = -2; u <= 2; u++) for (let v = -8; v <= -4; v++) {
    const r = Math.max(Math.abs(u), Math.abs(v + 6));
    if (r === 2) f.set(u, 1, v, B.stone_bricks); else if (r <= 1) f.set(u, 0, v, B.ice);
  }
  for (const [u, v] of [[-8, -6], [8, -8], [-6, 0], [7, 0]]) f.spawn('frostling', u, 1, v);
}

// ============================================================== Echo Vault
export function vault(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const brick = b.mix(30, [B.deepstone_bricks, 6], [B.cobbled_deepstone, 2], [B.polished_slate, 1]);
  const R = 20, CEIL = 10;
  // The hall: a great box carved out of the deep rock.
  for (let u = -R - 1; u <= R + 1; u++) for (let v = -R - 1; v <= R + 1; v++) for (let d = -1; d <= CEIL; d++) {
    const shell = Math.abs(u) === R + 1 || Math.abs(v) === R + 1 || d === -1 || d === CEIL;
    const [x, z] = f.at(u, v);
    if (shell) f.set(u, d, v, brick(x, f.oy + d, z));
    else if (d === 0) f.set(u, d, v, u === 0 || v === 0 ? B.polished_slate : (u + v) % 4 === 0 ? B.deepstone : B.deepstone_bricks);
    else f.set(u, d, v, 0);
  }
  // Pillars in a grid, hung with glowmoss and crystal.
  for (let u = -16; u <= 16; u += 8) for (let v = -16; v <= 16; v += 8) {
    if (Math.abs(u) <= 8 && Math.abs(v) <= 8) continue;
    for (let d = 1; d < CEIL; d++) f.set(u, d, v, d === 1 || d === CEIL - 1 ? B.polished_slate : B.deepstone_bricks);
    for (const [du, dv, fc] of [[1, 0, 3], [-1, 0, 1], [0, 1, 0], [0, -1, 2]] as const) {
      if (f.h(u + du, 3, v + dv, 31) < 0.5) f.set(u + du, 2 + Math.floor(f.h(u, 2, v, 32) * 5), v + dv, B.crystal_cluster);
      if (f.h(u + du, 8, v + dv, 33) < 0.4) f.set(u + du, CEIL - 1, v + dv, B.vine, f.face(fc));
    }
  }
  for (let k = 0; k < 60; k++) {
    const u = -R + Math.floor(f.h(k, 0, 0, 34) * (2 * R + 1)), v = -R + Math.floor(f.h(k, 0, 1, 34) * (2 * R + 1));
    const len = 1 + Math.floor(f.h(u, 0, v, 35) * 4);
    for (let d = CEIL - 1; d > CEIL - 1 - len; d--) if (f.get(u, d, v) === 0) f.set(u, d, v, B.glowmoss);
  }
  for (let u = -12; u <= 12; u += 6) for (const v of [-12, 12]) f.set(u, CEIL - 1, v, B.lantern, HANG);
  // The great arch at the back, and the altar before it.
  for (let u = -5; u <= 5; u++) for (let d = 1; d <= 9; d++) {
    const leg = Math.abs(u) >= 4, lintel = d >= 8;
    if (!(leg || lintel)) { f.set(u, d, 8, B.obsidian); continue; }
    f.set(u, d, 8, leg && lintel ? B.polished_slate : B.deepstone_bricks);
    f.set(u, d, 9, B.deepstone_bricks);
  }
  for (let u = -3; u <= 3; u++) for (let d = 1; d <= 7; d++) if (f.h(u, d, 7, 36) < 0.15) f.set(u, d, 7, B.crystal_cluster);
  f.fill(-4, 1, 1, 4, 1, 6, B.polished_slate); f.fill(-3, 2, 2, 3, 2, 6, B.polished_slate); f.fill(-2, 3, 3, 2, 3, 6, B.polished_slate);
  f.set(0, 4, 5, B.crystal_block); f.chest(-1, 4, 5, 2, LOOT.vault); f.chest(1, 4, 5, 2, LOOT.vault);
  // Ruined houses in the corners.
  const houses: [number, number][] = [[-14, -14], [14, -14], [-14, 14], [14, 14]];
  houses.forEach(([cu, cv], i) => {
    for (let du = -3; du <= 3; du++) for (let dv = -3; dv <= 3; dv++) for (let d = 1; d <= 5; d++) {
      const edge = Math.max(Math.abs(du), Math.abs(dv)) === 3;
      const broken = d >= 3 && f.h(cu + du, d, cv + dv, 37) < 0.35;
      const door = du === 0 && dv === (cv > 0 ? -3 : 3) && d <= 3;
      if ((edge && !broken && !door) || (d === 5 && !broken)) f.set(cu + du, d, cv + dv, brick(...xyz(f, cu + du, d, cv + dv)));
    }
    f.set(cu, 4, cv, B.lantern, HANG);
    if (i % 2 === 0) f.spawner(cu, 1, cv, i === 0 ? 'skeleton' : 'zombie');
    else f.chest(cu + 2, 1, cv, 1, LOOT.vault);
    f.set(cu - 2, 1, cv + (cv > 0 ? 2 : -2), B.barrel);
  });
  // A long stair up toward the caves from the front of the hall.
  for (let k = 0; k <= 30; k++) {
    const v = -R - 1 - k;
    f.fill(-1, k, v, 1, k + 3, v, 0);
    f.fill(-1, k, v, 1, k, v, B.deepstone_bricks);
    f.fill(-2, k, v, -2, k + 3, v, brick);
    f.fill(2, k, v, 2, k + 3, v, brick);
    f.fill(-1, k + 4, v, 1, k + 4, v, brick);
    if (k % 6 === 3) f.set(-1, k + 3, v, B.lantern, HANG);
  }
  f.fill(-1, 1, -R - 1, 1, 3, -R - 1, 0);
}

// ============================================================== Witch Hut
export function witchhut(b: Builder, s: Structure): void {
  const y0 = Math.max(s.y, SEA_LEVEL) + 2;
  const f = b.frame(s.x, y0, s.z, s.rot);
  f.fill(-4, 1, -7, 4, 7, 5, 0);
  for (const [u, v] of [[-3, -4], [3, -4], [-3, 4], [3, 4], [-3, -6], [3, -6]]) f.foundation(u, 0, v, B.spruce_log, 14);
  f.fill(-3, 0, -6, 3, 0, 4, B.planks);
  for (let d = 1; d <= 3; d++) for (let u = -3; u <= 3; u++) for (let v = -4; v <= 4; v++) {
    const eu = Math.abs(u) === 3, ev = Math.abs(v) === 4;
    if (!(eu || ev)) continue;
    const window = d === 2 && ((eu && v === 0) || (ev && u === 0 && v > 0));
    f.set(u, d, v, eu && ev ? B.spruce_log : window ? B.fence : B.planks);
  }
  f.set(0, 1, -4, 0); f.set(0, 2, -4, 0);
  for (let u = -3; u <= 3; u++) f.set(u, 1, -6, B.fence);
  f.set(-3, 1, -5, B.fence); f.set(3, 1, -5, B.fence);
  for (let v = -7; v <= 5; v++) for (let u = -4; u <= 4; u++) {
    f.set(u, 4, v, Math.abs(u) === 4 ? B.plank_slab : B.spruce_log, Math.abs(u) === 4 ? 0 : f.logMeta('v'));
    if (Math.abs(u) <= 2 && v >= -5 && v <= 4) f.set(u, 5, v, Math.abs(u) === 2 ? B.plank_slab : B.planks);
  }
  f.set(1, 6, 0, B.brown_mushroom); f.set(-1, 6, 2, B.red_mushroom);
  f.set(-2, 1, 3, B.crafting_table); f.set(2, 1, 3, B.brewing_stand); f.set(2, 1, -2, B.composter);
  f.set(-2, 1, -3, B.flower_pot, potted(B.red_mushroom)); f.set(-2, 2, 3, B.flower_pot, potted(B.brown_mushroom));
  f.chest(-2, 1, 1, 3, LOOT.witchhut);
  f.set(0, 3, 0, B.lantern, HANG);
  for (const [u, v, fc] of [[-4, 0, 1], [4, 2, 3], [4, -2, 3]] as const) for (let d = 3; d >= 1; d--) f.set(u, d, v, B.vine, f.face(fc));
  f.spawn('witch', 0, 1, 1);
}

// ============================================================== Igloo
export function igloo(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  f.yard(-6, -7, 6, 6, B.snow, B.dirt, 7);
  for (let u = -5; u <= 5; u++) for (let v = -5; v <= 5; v++) for (let d = 1; d <= 5; d++) {
    const r = Math.hypot(u, v, (d - 1) * 1.15);
    if (r <= 4.6 && r > 3.6) f.set(u, d, v, B.snow);
    else if (r <= 3.6) f.set(u, d, v, 0);
  }
  for (let v = -6; v <= -4; v++) { f.set(0, 1, v, 0); f.set(0, 2, v, 0); f.set(-1, 1, v, B.snow); f.set(1, 1, v, B.snow); f.set(-1, 2, v, B.snow); f.set(1, 2, v, B.snow); f.set(0, 3, v, B.snow); }
  f.set(-4, 2, 0, B.ice); f.set(4, 2, 0, B.ice);
  f.fill(-2, 0, -2, 2, 0, 2, B.snow);
  f.set(-2, 1, 1, B.wool_red); f.set(-2, 1, 2, B.wool_red); f.set(-1, 1, 2, B.carpet, color('red'));
  f.set(2, 1, 1, B.furnace, f.face(1)); f.set(2, 1, 0, B.crafting_table); f.set(0, 3, 0, B.lantern, HANG);
  if ((s.variant ?? 0) % 2 === 1) return;
  // The basement: a hidden laboratory far under the snow.
  f.room(-4, -13, 3, 4, -8, 11, B.stone_bricks);
  for (let d = -13; d <= -1; d++) {
    for (const [u, v] of [[-1, 1], [1, 1], [-1, 2], [1, 2], [-1, 3], [0, 3], [1, 3], [0, 1]]) if (d > -8 || v < 3) f.set(u, d, v, B.stone_bricks);
    f.set(0, d, 2, d === -13 ? B.stone_bricks : B.ladder, f.face(0));
  }
  f.set(0, 0, 2, B.trapdoor);
  f.set(0, -12, 3, 0); f.set(0, -11, 3, 0);
  f.fill(-3, -12, 4, 3, -12, 6, B.carpet, color('red'));
  f.set(-3, -12, 5, B.brewing_stand); f.set(-3, -12, 6, B.crafting_table); f.chest(3, -12, 5, 1, LOOT.igloo);
  f.set(3, -12, 6, B.flower_pot, potted(B.cactus));
  // Two cells behind bars at the back.
  f.fill(-3, -12, 8, 3, -10, 8, B.iron_bars);
  f.fill(0, -12, 9, 0, -10, 10, B.iron_bars);
  f.set(0, -9, 6, B.lantern, HANG);
  f.spawn('villager', -2, -12, 10, 'cleric');
  f.spawn('zombie', 2, -12, 10);
}

// ============================================================== Desert Well
export function well(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  f.yard(-3, -3, 3, 3, B.sand, B.sandstone, 7);
  f.fill(-2, 0, -2, 2, 0, 2, B.sandstone);
  for (let d = -8; d <= 0; d++) {
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) if (u || v) f.set(u, d, v, B.sandstone);
    f.set(0, d, 0, B.water);
  }
  for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) if (u || v) f.set(u, 1, v, B.sandstone);
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let d = 2; d <= 3; d++) f.set(u, d, v, B.sandstone);
  f.fill(-2, 4, -2, 2, 4, 2, (x, y, z) => (b.h(x, y, z, 40) < 0.1 ? 0 : B.sandstone));
  f.set(-2, 4, -2, 0); f.set(2, 4, -2, 0); f.set(-2, 4, 2, 0); f.set(2, 4, 2, 0);
  f.set(0, 5, 0, B.red_sandstone);
  f.set(0, 3, 0, B.lantern, HANG);
  if ((s.variant ?? 0) % 3 === 0) f.chest(2, -2, 2, 0, LOOT.temple);
}

// ============================================================== Ruined Ember Gate
export function ruinedgate(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  f.fill(-6, 1, -6, 6, 7, 6, 0);
  // Scorched ground spreading from the gate.
  for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) {
    const r = Math.hypot(u, v) + f.h(u, 0, v, 41) * 2.5;
    if (r > 6.5) continue;
    f.set(u, 0, v, r < 2.5 ? B.magma : f.h(u, 0, v, 42) < 0.5 ? B.cinderstone : B.ashsand);
    f.foundation(u, -1, v, B.cinderstone, 4);
    if (r > 2.5 && f.h(u, 1, v, 43) < 0.08) f.set(u, 1, v, B.fire);
  }
  // The frame, half fallen.
  for (let u = -1; u <= 2; u++) for (let d = 1; d <= 5; d++) {
    const edge = u === -1 || u === 2 || d === 1 || d === 5;
    if (!edge) continue;
    const lost = d >= 3 && f.h(u, d, 0, 44) < 0.4;
    f.set(u, d, 0, lost ? 0 : f.h(u, d, 0, 45) < 0.15 ? B.cinder_bricks : B.obsidian);
  }
  for (const [u, v] of [[3, 2], [-2, -2], [4, -1]]) f.set(u, 1, v, B.obsidian);
  f.set(-3, 1, 1, B.gold_block);
  f.set(1, 0, 2, B.lava); f.set(2, 0, 2, B.lava);
  f.chest(3, 1, -3, 2, LOOT.emberCache);
}

// ============================================================== Fossil
export function fossil(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const bone = (u: number, d: number, v: number) => f.set(u, d, v, f.h(u, d, v, 50) < 0.12 ? B.coal_ore : B.chalk);
  // Spine and tail.
  for (let u = -9; u <= 9; u++) bone(u, 5, 0);
  for (let k = 1; k <= 5; k++) bone(-9 - k, 5 - Math.ceil(k / 2), 0);
  // Ribs curving down both sides.
  for (let u = -6; u <= 6; u += 2) for (let a = 0; a <= 12; a++) {
    const t = (a / 12) * Math.PI;
    const r = 4.2 - Math.abs(u) * 0.15;
    const v = Math.round(Math.cos(t) * r), d = 5 - Math.round(Math.sin(t) * r * 0.9);
    if (Math.abs(v) >= 1) bone(u, d, v);
  }
  // Legs and the skull.
  for (const [u, v] of [[-5, -2], [-5, 2], [5, -2], [5, 2]]) for (let d = 0; d <= 4; d++) bone(u, d, v);
  for (let u = 10; u <= 13; u++) for (let v = -1; v <= 1; v++) for (let d = 4; d <= 6; d++) {
    const eye = u === 12 && Math.abs(v) === 1 && d === 5;
    if (!eye) bone(u, d, v);
  }
  for (let u = 14; u <= 15; u++) bone(u, 4, 0);
}

// ============================================================== Ocean Ruin
export function oceanruin(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const brick = b.mix(51, [B.stone_bricks, 3], [B.mossy_stone_bricks, 3], [B.cracked_stone_bricks, 2], [B.sandstone, 1]);
  const huts: [number, number, number][] = [[0, 0, 4], [7, 3, 3], [-6, 4, 3], [2, -7, 2]];
  const n = 2 + ((s.variant ?? 0) % 3);
  huts.slice(0, n).forEach(([cu, cv, h], i) => {
    for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) {
      f.foundation(cu + du, 0, cv + dv, B.sand, 8);
      f.set(cu + du, 0, cv + dv, brick(...xyz(f, cu + du, 0, cv + dv)));
      const edge = Math.max(Math.abs(du), Math.abs(dv)) === 2;
      for (let d = 1; d <= h + 1; d++) {
        const [x, z] = f.at(cu + du, cv + dv);
        const y = f.oy + d;
        const keep = edge ? d <= h && b.h(x, y, z, 52) > 0.3 + d * 0.08 : d === h + 1 && b.h(x, y, z, 53) > 0.55;
        f.set(cu + du, d, cv + dv, keep ? brick(x, y, z) : sea(y));
      }
    }
    f.set(cu, 1, cv - 2, sea(f.oy + 1)); f.set(cu, 2, cv - 2, sea(f.oy + 2));
    f.set(cu - 1, 0, cv - 1, B.glowstone);
    if (i === 0) f.chest(cu + 1, 1, cv + 1, 2, LOOT.oceanruin);
    else if (f.h(cu, 1, cv, 54) < 0.4) f.chest(cu - 1, 1, cv + 1, 2, LOOT.oceanruin);
    f.set(cu, 1, cv, i === 0 ? B.magma : B.seagrass);
  });
  for (let k = 0; k < 14; k++) {
    const u = -10 + Math.floor(f.h(k, 0, 5, 55) * 21), v = -10 + Math.floor(f.h(k, 0, 6, 55) * 21);
    f.set(u, 1, v, f.h(u, 1, v, 56) < 0.5 ? B.gravel : brick(...xyz(f, u, 1, v)));
  }
  f.spawn('zombie', 0, 1, -4);
}

// ============================================================== Traveller's Camp
export function campsite(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const ground = s.ground ?? B.grass;
  f.yard(-6, -6, 6, 6, b.mix(60, [ground, 3], [B.coarse_dirt, 1]), B.dirt, 6);
  const tents = [B.wool_green, B.wool_orange, B.wool_blue, B.wool_brown, B.wool_red];
  const wool = tents[(s.variant ?? 0) % tents.length];
  tent(f, 0, 1, 'v', wool, B.carpet, color('white'));
  f.set(0, 1, -3, B.campfire);
  f.set(-2, 1, -3, B.spruce_log, f.logMeta('v')); f.set(2, 1, -3, B.spruce_log, f.logMeta('v'));
  f.set(0, 1, -5, B.log, f.logMeta('u'));
  f.set(-4, 1, -1, B.barrel); f.chest(-4, 1, 0, 3, LOOT.camp); f.set(4, 1, 0, B.crafting_table);
  f.set(4, 1, -4, B.fence); f.set(4, 2, -4, B.fence); f.set(4, 3, -4, B.lantern);
  f.set(-3, 1, 5, B.hay_bale);
}

// ============================================================== Standing Stones
export function stones(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const rock = b.mix(70, [B.stone, 3], [B.mossy_stone, 3], [B.mossy_cobblestone, 1], [B.granite, 1]);
  for (let u = -9; u <= 9; u++) for (let v = -9; v <= 9; v++) {
    if (Math.hypot(u, v) > 9.3) continue;
    f.fill(u, 1, v, u, 8, v, 0);
    f.foundation(u, -1, v, B.dirt, 8);
    if (Math.hypot(u, v) < 8 && f.h(u, 0, v, 71) < 0.3) f.set(u, 0, v, f.h(u, 0, v, 72) < 0.5 ? B.moss_block : B.coarse_dirt);
  }
  // Five trilithons: two uprights and a lintel, some of them fallen.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + (s.variant ?? 0);
    const ca = Math.cos(a), sa = Math.sin(a);
    const at = (t: number): [number, number] => [Math.round(ca * 7 - sa * t), Math.round(sa * 7 + ca * t)];
    const [u1, v1] = at(-1.6), [u2, v2] = at(1.6);
    const h = 4 + Math.floor(f.h(k, 0, 0, 73) * 3);
    const fallen = f.h(k, 1, 0, 74) < 0.35;
    for (const [u, v] of [[u1, v1], [u2, v2]]) { f.foundation(u, 0, v, rock, 6); for (let d = 1; d <= h; d++) f.set(u, d, v, rock(...xyz(f, u, d, v))); }
    for (let t = -2; t <= 2; t++) {
      const [u, v] = at(t * 0.8);
      if (fallen) { const [ou, ov] = [Math.round(ca * 9.2 - sa * t * 0.8), Math.round(sa * 9.2 + ca * t * 0.8)]; f.set(ou, 1, ov, rock(...xyz(f, ou, 1, ov))); }
      else f.set(u, h + 1, v, rock(...xyz(f, u, h + 1, v)));
    }
  }
  // The altar at the centre, with an offering buried beneath it.
  f.fill(-1, 1, -1, 1, 1, 1, B.polished_granite);
  f.set(0, 2, 0, B.flower_pot, potted(B.blue_flower));
  f.chest(0, -1, 0, 0, LOOT.camp);
  for (const [u, v] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) f.set(u, 1, v, B.white_flower);
}

// ============================================================== Hunter's Cabin
export function cabin(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const ground = s.ground ?? B.grass;
  f.yard(-9, -8, 9, 8, ground, B.dirt, 12);
  f.fill(-3, 0, -4, 3, 0, 4, B.planks);
  for (let d = 1; d <= 4; d++) for (let u = -3; u <= 3; u++) for (let v = -4; v <= 4; v++) {
    const eu = Math.abs(u) === 3, ev = Math.abs(v) === 4;
    if (!(eu || ev)) continue;
    const window = (d === 2 || d === 3) && ((eu && Math.abs(v) === 1) || (ev && Math.abs(u) === 2 && v < 0));
    if (eu && ev) f.set(u, d, v, B.spruce_log);
    else f.set(u, d, v, window ? B.glass_pane : B.spruce_log, f.logMeta(eu ? 'v' : 'u'));
  }
  f.set(0, 1, -4, 0); f.set(0, 2, -4, 0);
  // A log roof along the length, gable ends of planks.
  for (let k = 0; k <= 4; k++) for (let v = -5; v <= 5; v++) {
    for (const u of [-4 + k, 4 - k]) f.set(u, 5 + k, v, B.spruce_log, f.logMeta('v'));
    if (Math.abs(v) === 4) for (let u = -3 + k; u <= 3 - k; u++) f.set(u, 5 + k, v, B.planks);
  }
  // The hearth and chimney on the back wall.
  for (let d = 1; d <= 11; d++) for (let u = -1; u <= 1; u++) if (d > 3 || u !== 0) f.set(u, d, 4, B.cobblestone);
  f.fill(-1, 1, 3, 1, 1, 3, B.cobblestone); f.set(0, 1, 3, B.campfire);
  f.fill(-1, 1, 5, 1, 11, 5, B.cobblestone);
  f.set(0, 3, 4, B.cobblestone);
  f.set(-2, 1, -3, B.crafting_table); f.set(2, 1, -3, B.barrel); f.chest(2, 1, 1, 1, LOOT.camp);
  f.set(-2, 1, 2, B.wool_brown); f.set(-2, 1, 1, B.wool_brown);
  f.fill(-1, 1, -2, 1, 1, 0, B.carpet, color('brown'));
  f.set(0, 4, 0, B.lantern, HANG);
  // Outside: a chopping block, a woodpile and a pen for the hens.
  f.set(-5, 1, -3, B.log); f.set(-5, 1, -1, B.spruce_log, f.logMeta('v')); f.set(-5, 2, -1, B.spruce_log, f.logMeta('v')); f.set(-5, 1, 0, B.spruce_log, f.logMeta('v'));
  for (let u = 5; u <= 9; u++) for (let v = -2; v <= 2; v++) if (u === 5 || u === 9 || Math.abs(v) === 2) f.set(u, 1, v, u === 5 && v === 0 ? B.fence_gate : B.fence);
  f.set(7, 1, 0, B.hay_bale);
  f.spawn('hen', 7, 1, -1); f.spawn('hen', 8, 1, 1);
}
