// Structures of the Hollow. Out past the great central island, each one raises its own island
// of pale stone out of the void and builds on it.
//
//   Astral Spires         three slender towers joined by bridges, their crowns full of treasure
//   Floating Observatory  a domed drum of brick and glass around a great telescope
//   Sky Garden            a glass dome over a meadow of blossom trees, starbloom and bees
//   Star Forge            a ring of obsidian pillars around a crucible, a star core burning above it
//   and smaller finds: crystal shrines, broken bridges, meteor craters, lantern waystones and a
//   fallen statue (the watchtower ruins on the outer islands are hollowgen.ts's own).

import { B, POTTED } from '../blocks';
import { Simplex, mulberry32 } from '../noise';
import type { Builder, Frame } from './builder';
import { LOOT, overlaps, square, type Structure, type StructureKind } from './structure-kinds';

export const HOLLOW_REGION = 192;
/** Keep clear of the great central island and its anchor pillars. */
const CLEAR_OF_CENTRE = 190;
const HANG = 1;
const cache = new Map<string, Structure[]>();

export function hollowStructuresInRegion(seed: number, rx: number, rz: number): Structure[] {
  const key = `${seed}:${rx},${rz}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Structure[] = [];
  const rand = mulberry32((seed ^ Math.imul(rx, 0x9e3779b1) ^ Math.imul(rz, 0x85ebca6b) ^ 0x4011) >>> 0);
  const sseed = (seed ^ Math.imul(rx, 1597) ^ Math.imul(rz, 5381) ^ 0x40) >>> 0;
  const clear = (x: number, z: number, r: number) => Math.hypot(x, z) - r > CLEAR_OF_CENTRE;
  if (rand() < 0.7) {
    const bigs: StructureKind[] = ['spires', 'observatory', 'garden', 'starforge'];
    const kind = bigs[Math.floor(rand() * bigs.length)];
    const x = rx * HOLLOW_REGION + 34 + Math.floor(rand() * (HOLLOW_REGION - 68));
    const z = rz * HOLLOW_REGION + 34 + Math.floor(rand() * (HOLLOW_REGION - 68));
    const y = 54 + Math.floor(rand() * 22);
    if (clear(x, z, 30)) out.push({ kind, x, y, z, rot: Math.floor(rand() * 4), seed: sseed, bounds: square(x, z, 30), variant: Math.floor(rand() * 1000) });
  }
  const smalls: StructureKind[] = ['crystalshrine', 'bridge', 'crater', 'waystones', 'statue'];
  for (let k = 0; k < 3; k++) {
    if (rand() > 0.6) continue;
    const kind = smalls[Math.floor(rand() * smalls.length)];
    const x = rx * HOLLOW_REGION + 24 + Math.floor(rand() * (HOLLOW_REGION - 48));
    const z = rz * HOLLOW_REGION + 24 + Math.floor(rand() * (HOLLOW_REGION - 48));
    const y = 48 + Math.floor(rand() * 34);
    const bounds = square(x, z, 22);
    if (!clear(x, z, 22) || out.some((o) => overlaps(o.bounds, bounds, 6))) continue;
    out.push({ kind, x, y, z, rot: Math.floor(rand() * 4), seed: sseed + k * 977, bounds, variant: Math.floor(rand() * 1000) });
  }
  cache.set(key, out);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return out;
}

const noises = new Map<number, Simplex>();
function noiseFor(seed: number): Simplex {
  let n = noises.get(seed);
  if (!n) { n = new Simplex(seed ^ 0x5717); noises.set(seed, n); if (noises.size > 8) noises.delete(noises.keys().next().value!); }
  return n;
}

/** Raise an island of hollowstone: flat on top at the frame's height, tapering to a jagged point below. */
function island(f: Frame, r: number, depth: number, top = B.hollowstone): void {
  const n = noiseFor(f.b.seed);
  for (let u = -r - 3; u <= r + 3; u++) for (let v = -r - 3; v <= r + 3; v++) {
    const [x, z] = f.at(u, v);
    if (!f.b.inside(x, z)) continue;
    const edge = r * (1 + n.noise2(x / 24, z / 24) * 0.14);
    const d = Math.hypot(u, v);
    if (d > edge) continue;
    const t = d / edge;
    const bottom = -Math.round((1 - t * t) * depth * (0.7 + (n.noise2(x / 9 + 50, z / 9) + 1) * 0.3)) - 1;
    for (let dy = bottom; dy <= 0; dy++) f.set(u, dy, v, dy === 0 ? top : B.hollowstone);
    if (t < 0.9 && f.h(u, 1, v, 200) < 0.02) f.set(u, 1, v, B.starbloom);
  }
}

const potted = (id: number) => Math.max(0, POTTED.indexOf(id));

/** A round tower: walls of hollow bricks, crystal bands, windows, a floor at the bridge level and one at the top. */
function tower(f: Frame, cu: number, cv: number, h: number, bridgeD: number, r = 3.5): void {
  for (let u = -5; u <= 5; u++) for (let v = -5; v <= 5; v++) {
    const d0 = Math.hypot(u, v);
    if (d0 > r) continue;
    const wall = d0 > r - 1.1;
    for (let d = 1; d <= h; d++) {
      if (wall) f.set(cu + u, d, cv + v, d % 7 === 0 ? B.crystal_block : d % 7 === 4 && (u === 0 || v === 0) ? B.glass : B.hollow_bricks);
      else f.set(cu + u, d, cv + v, d === h - 6 || d === bridgeD ? B.hollow_bricks : 0);
    }
  }
  // A spike of brick and a crystal at the tip.
  for (let k = 0; k <= 3; k++) for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) {
    const d0 = Math.hypot(u, v);
    if (d0 <= r - 0.8 * k - 0.5 && d0 > r - 0.8 * k - 1.6) f.set(cu + u, h + 1 + k, cv + v, B.hollow_bricks);
  }
  f.set(cu, h + 4, cv, B.crystal_block); f.set(cu, h + 5, cv, B.crystal_cluster);
  // A doorway and a ladder up the inside of the wall.
  f.set(cu, 1, cv - Math.floor(r), 0); f.set(cu, 2, cv - Math.floor(r), 0);
  f.ladder(cu, 1, h - 6, cv + Math.floor(r) - 1, 2);
}

/** Open the tower wall where a walkway meets it. */
function breach(f: Frame, u: number, v: number, d: number): void {
  for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) {
    const cur = f.get(u + du, d, v + dv);
    if (cur === B.hollow_bricks || cur === B.crystal_block || cur === B.glass) { f.set(u + du, d, v + dv, 0); f.set(u + du, d + 1, v + dv, 0); }
  }
}

/** A three-wide walkway of brick between two points at one height, with low parapets. */
function walkway(f: Frame, u0: number, v0: number, u1: number, v1: number, d: number): void {
  const len = Math.hypot(u1 - u0, v1 - v0);
  for (let t = 0; t <= len; t += 0.4) {
    const u = u0 + ((u1 - u0) * t) / len, v = v0 + ((v1 - v0) * t) / len;
    for (let w = -1.5; w <= 1.5; w += 0.5) {
      const nu = -(v1 - v0) / len, nv = (u1 - u0) / len;
      const pu = Math.round(u + nu * w), pv = Math.round(v + nv * w);
      f.set(pu, d, pv, B.hollow_bricks);
      if (Math.abs(w) === 1.5) f.set(pu, d + 1, pv, B.fence);
    }
  }
}

// ============================================================== Astral Spires
export function spires(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  island(f, 24, 32);
  f.fill(-14, 0, -16, 14, 0, 14, (x, y, z) => (b.h(x, y, z, 201) < 0.6 ? B.hollow_bricks : B.hollowstone));
  f.fill(-14, 1, -16, 14, 40, 14, 0);
  const BD = 18;
  const towers: [number, number, number][] = [[0, -8, 34], [-9, 6, 26], [9, 6, 30]];
  for (const [u, v, h] of towers) tower(f, u, v, h, BD);
  // Walkways from the tallest tower to the other two, meeting each wall.
  for (const [tu, tv] of [towers[1], towers[2]]) {
    const len = Math.hypot(tu, tv + 8), du = tu / len, dv = (tv + 8) / len;
    const a: [number, number] = [Math.round(du * 3.2), Math.round(-8 + dv * 3.2)], z: [number, number] = [Math.round(tu - du * 3.2), Math.round(tv - dv * 3.2)];
    walkway(f, a[0], a[1], z[0], z[1], BD);
    breach(f, a[0], a[1], BD + 1); breach(f, z[0], z[1], BD + 1);
  }
  // Treasure at the top of each tower, and a guard in the tallest.
  towers.forEach(([u, v, h], i) => {
    f.chest(u - 1, h - 5, v, 3, LOOT.spires);
    if (i === 0) f.spawner(u + 1, h - 5, v, 'skeleton');
    f.set(u, h - 5, v - 1, B.lantern);
  });
  // Paths and lamp posts across the island.
  for (let v = -22; v <= -12; v++) f.set(0, 0, v, B.hollow_bricks);
  for (const [u, v] of [[-3, -14], [3, -14], [-12, -4], [12, -4], [0, 12]]) { f.set(u, 1, v, B.fence); f.set(u, 2, v, B.fence); f.set(u, 3, v, B.lantern); }
  for (const [u, v] of [[-5, -12], [6, -11], [-12, 10], [11, 11]]) f.set(u, 1, v, B.starbloom);
}

// ============================================================== Floating Observatory
export function observatory(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  island(f, 18, 26);
  f.fill(-11, 1, -11, 11, 22, 11, 0);
  const R = 8;
  for (let u = -R; u <= R; u++) for (let v = -R; v <= R; v++) {
    const r = Math.hypot(u, v);
    if (r > R + 0.5) continue;
    // A floor of slate set with crystal stars.
    f.set(u, 0, v, f.h(u, 0, v, 210) < 0.06 ? B.crystal_block : Math.abs(Math.abs(u) - Math.abs(v)) === 0 && r < 6 ? B.gold_block : B.polished_slate);
    for (let d = 1; d <= 8; d++) {
      if (r > R - 0.5) f.set(u, d, v, d === 1 ? B.polished_marble : d === 8 ? B.crystal_block : d >= 4 && d <= 6 && (Math.abs(u) <= 1 || Math.abs(v) <= 1) ? B.glass : B.hollow_bricks);
    }
    // The dome: glass with brick ribs.
    for (let d = 9; d <= 9 + R; d++) {
      const rr = Math.hypot(u, v, d - 9);
      if (rr <= R + 0.5 && rr > R - 0.6) f.set(u, d, v, u === 0 || v === 0 || Math.abs(u) === Math.abs(v) ? B.hollow_bricks : B.glass);
    }
  }
  for (let d = 1; d <= 3; d++) { f.set(0, d, -R, 0); f.set(0, d, -R + 1, 0); f.set(1, d, -R, d === 3 ? B.hollow_bricks : 0); f.set(-1, d, -R, d === 3 ? B.hollow_bricks : 0); }
  // The great telescope, angled up through a slot in the dome.
  f.fill(-1, 1, -1, 1, 2, 1, B.polished_marble);
  for (let t = 0; t <= 14; t++) {
    const u = t * 0.4, d = 3 + t * 0.9, v = t * 0.3;
    for (const [du, dv, dd] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const pu = Math.round(u + du), pv = Math.round(v + dv), pd = Math.round(d + dd);
      f.set(pu, pd, pv, t % 5 === 0 ? B.gold_block : B.iron_block);
      for (let k = 1; k <= 2; k++) if (pd + k > 9) { const cur = f.get(pu, pd + k, pv); if (cur === B.glass) f.set(pu, pd + k, pv, 0); }
    }
  }
  f.set(0, 3, 0, B.iron_block);
  // Bookshelves round the walls, desks, charts and chests.
  for (let u = -R; u <= R; u++) for (let v = -R; v <= R; v++) {
    const r = Math.hypot(u, v);
    if (r > R - 1.5 && r <= R - 0.5 && Math.abs(u) > 2 && !(v < 0 && Math.abs(u) <= 2)) for (let d = 1; d <= 3; d++) f.set(u, d, v, B.bookshelf);
  }
  f.set(-4, 1, 4, B.enchanting_table); f.set(4, 1, 4, B.crafting_table); f.set(5, 1, 3, B.item_frame);
  f.chest(-5, 1, -3, 3, LOOT.observatory); f.chest(5, 1, -3, 1, LOOT.observatory);
  f.set(-3, 1, -5, B.flower_pot, potted(B.starbloom)); f.set(3, 1, -5, B.flower_pot, potted(B.starbloom));
  for (const [u, v] of [[-4, 0], [4, 0], [0, 5]]) f.set(u, 7, v, B.lantern, HANG);
  f.spawn('villager', 2, 1, -4, 'librarian');
}

// ============================================================== Sky Garden
export function garden(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  island(f, 20, 28);
  const R = 14;
  for (let u = -R - 1; u <= R + 1; u++) for (let v = -R - 1; v <= R + 1; v++) {
    const r = Math.hypot(u, v);
    if (r > R + 0.5) continue;
    f.set(u, 0, v, B.grass); f.set(u, -1, v, B.dirt); f.set(u, -2, v, B.dirt);
    for (let d = 1; d <= R + 1; d++) {
      const rr = Math.hypot(u, v, d);
      if (rr <= R + 0.5 && rr > R - 0.6) f.set(u, d, v, u === 0 || v === 0 || Math.abs(u) === Math.abs(v) ? B.hollow_bricks : B.glass);
      else if (rr <= R - 0.6) f.set(u, d, v, 0);
    }
    if (r > R - 0.5 && r <= R + 0.5) f.set(u, 1, v, B.hollow_bricks);
  }
  for (const [u, v] of [[0, -R], [0, R], [-R, 0], [R, 0]]) for (let d = 1; d <= 3; d++) { f.set(u, d, v, 0); f.set(u - Math.sign(u), d, v - Math.sign(v), 0); }
  // A pond, stepping-stone paths, beds of flowers and starbloom.
  for (let u = 2; u <= 8; u++) for (let v = 2; v <= 8; v++) {
    const r = Math.hypot(u - 5, v - 5);
    if (r < 2.6) { f.set(u, 0, v, B.water); f.set(u, -1, v, B.dirt); } else if (r < 3.4) f.set(u, 0, v, B.clay);
  }
  f.set(5, 1, 5, B.lily_pad);
  for (let k = -R + 1; k <= R - 1; k++) { f.set(k, 0, 0, B.dirt_path); f.set(0, 0, k, B.dirt_path); }
  const flowers = [B.starbloom, B.poppy, B.blue_flower, B.white_flower, B.purple_flower, B.dandelion, B.fern];
  for (let u = -R; u <= R; u++) for (let v = -R; v <= R; v++) {
    if (Math.hypot(u, v) > R - 1.5 || u === 0 || v === 0) continue;
    if (f.get(u, 0, v) !== B.grass && f.get(u, 0, v) !== -1) continue;
    const r = f.h(u, 1, v, 220);
    if (r < 0.28) f.set(u, 1, v, flowers[Math.floor(f.h(u, 1, v, 221) * flowers.length)]);
    else if (r < 0.4) f.set(u, 1, v, B.tall_grass);
  }
  // Blossom trees and one sunwood.
  const tree = (cu: number, cv: number, log: number, leaves: number, h: number) => {
    for (let d = 1; d <= h; d++) f.set(cu, d, cv, log);
    for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) for (let d = h - 1; d <= h + 2; d++) {
      if (Math.hypot(u, v, (d - h) * 1.3) <= 3.1 && f.get(cu + u, d, cv + v) !== log) f.set(cu + u, d, cv + v, leaves);
    }
  };
  tree(-6, -6, B.blossom_log, B.blossom_leaves, 6);
  tree(-7, 5, B.blossom_log, B.blossom_leaves, 5);
  tree(6, -7, B.sunwood_log, B.sunwood_leaves, 5);
  // A gazebo with the gardener's things, and a hive with its bees.
  for (const [u, v] of [[-10, -1], [-10, -5], [-6, -1]]) for (let d = 1; d <= 3; d++) f.set(u, d, v, B.fence);
  f.fill(-11, 4, -6, -5, 4, 0, B.plank_slab);
  f.chest(-9, 1, -3, 3, LOOT.garden); f.set(-8, 1, -4, B.composter); f.set(-8, 1, -2, B.barrel);
  f.set(8, 1, -2, B.fence); f.set(8, 2, -2, B.beehive, 3);
  for (let i = 0; i < 3; i++) f.spawn('bee', 7 + i, 3, -1);
  f.spawn('hen', -3, 1, 8);
}

// ============================================================== Star Forge
export function starforge(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  island(f, 18, 26);
  f.fill(-15, 1, -15, 15, 18, 15, 0);
  for (let u = -12; u <= 12; u++) for (let v = -12; v <= 12; v++) if (Math.hypot(u, v) <= 12.4) f.set(u, 0, v, B.hollow_bricks);
  // Eight pillars in a ring, each joined to the crucible by a line of crystal in the floor.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const pu = Math.round(Math.cos(a) * 10), pv = Math.round(Math.sin(a) * 10);
    const h = 7 + ((k * 3) % 5);
    for (let d = 1; d <= h; d++) f.set(pu, d, pv, d === h ? B.crystal_block : B.obsidian);
    f.set(pu, h + 1, pv, B.crystal_cluster);
    for (let t = 4; t < 10; t++) f.set(Math.round(Math.cos(a) * t), 0, Math.round(Math.sin(a) * t), B.crystal_block);
  }
  // The crucible: a basin of brick holding molten stone.
  for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) {
    const r = Math.max(Math.abs(u), Math.abs(v));
    f.set(u, 0, v, B.hollow_bricks);
    if (r === 3) { f.set(u, 1, v, B.hollow_bricks); f.set(u, 2, v, (u + v) & 1 ? B.hollow_bricks : B.obsidian); }
    else f.set(u, 1, v, r <= 1 ? B.lava : B.magma);
  }
  // A star core hanging over it.
  for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (let d = 9; d <= 11; d++) f.set(u, d, v, Math.abs(u) + Math.abs(v) + Math.abs(d - 10) <= 1 ? B.glowstone : B.crystal_block);
  for (const [u, v] of [[-6, 0], [6, 0], [0, 6]]) { f.set(u, 1, v, B.anvil); }
  f.set(0, 1, -6, B.crafting_table);
  f.chest(-5, 1, 5, 2, LOOT.starforge); f.chest(5, 1, 5, 2, LOOT.starforge);
  f.spawner(0, 1, 8, 'emberwisp');
}

// ============================================================== Small finds
export function crystalshrine(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  island(f, 9, 14);
  f.fill(-7, 1, -7, 7, 8, 7, 0);
  f.fill(-3, 0, -3, 3, 0, 3, B.hollow_bricks);
  for (let a = 0; a <= 20; a++) {
    const t = (a / 20) * Math.PI;
    f.set(Math.round(Math.cos(t) * 4), 1 + Math.round(Math.sin(t) * 5), 0, B.crystal_block);
  }
  for (let k = 0; k < 18; k++) {
    const u = -6 + Math.floor(f.h(k, 0, 0, 230) * 13), v = -6 + Math.floor(f.h(k, 0, 1, 230) * 13);
    if (f.get(u, 1, v) === 0 || f.get(u, 1, v) === -1) f.set(u, 1, v, B.crystal_cluster);
  }
  f.chest(0, 1, 1, 0, LOOT.hollowCache);
  f.set(0, 1, -1, B.crystal_block);
}

export function bridge(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  const L = 16;
  for (let u = -L; u <= L; u++) {
    const ragged = Math.abs(u) > L - 4 && f.h(u, 0, 0, 240) < (Math.abs(u) - (L - 4)) / 4;
    if (ragged) continue;
    for (let v = -2; v <= 2; v++) {
      f.set(u, 0, v, B.hollow_bricks);
      if (Math.abs(v) === 2 && f.h(u, 1, v, 241) > 0.15) f.set(u, 1, v, B.hollow_bricks);
    }
    // Arches underneath, broken where the bridge is.
    const arch = Math.round(3 * Math.abs(Math.sin((u / 8) * Math.PI)));
    for (let d = -1; d >= -arch; d--) for (let v = -2; v <= 2; v++) f.set(u, d, v, B.hollow_bricks);
    if (u % 6 === 0) { f.set(u, 2, -2, B.fence); f.set(u, 3, -2, B.lantern); f.set(u, 2, 2, B.fence); f.set(u, 3, 2, B.lantern); }
  }
  for (const u of [-L + 2, L - 3]) for (let d = -4; d >= -8; d--) if (f.h(u, d, 0, 242) < 0.6) f.set(u, d, 0, B.hollow_bricks);
  if ((s.variant ?? 0) % 2 === 0) f.chest(0, 1, 0, 0, LOOT.hollowCache);
}

export function crater(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  island(f, 14, 20);
  f.fill(-16, 1, -16, 16, 8, 16, 0);
  // The bowl, scorched round its rim.
  for (let u = -9; u <= 9; u++) for (let v = -9; v <= 9; v++) {
    const r = Math.hypot(u, v);
    if (r > 9) continue;
    const dip = Math.round(4 * (1 - (r / 9) ** 2));
    for (let d = 0; d > -dip; d--) f.set(u, d, v, 0);
    f.set(u, -dip, v, r < 7 && f.h(u, 0, v, 250) < 0.5 ? B.ashsand : B.cinderstone);
    if (r > 5 && r < 8 && f.h(u, 1, v, 251) < 0.05) f.set(u, -dip + 1, v, B.fire);
  }
  // The stone that fell, still glowing.
  const ores = [B.obsidian, B.obsidian, B.magma, B.crystal_block, B.gold_ore, B.diamond_ore, B.iron_ore];
  for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) for (let d = -4; d <= 2; d++) {
    if (Math.hypot(u, v, (d + 1) * 1.1) > 2.9) continue;
    f.set(u, d, v, ores[Math.floor(f.h(u, d, v, 252) * ores.length)]);
  }
  f.chest(4, -2, 0, 3, LOOT.hollowCache);
}

export function waystones(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  for (let k = 0; k < 5; k++) {
    const u = -18 + k * 9, dy = Math.round(Math.sin(k * 1.3) * 3);
    const [x, z] = f.at(u, 0);
    const g = b.frame(x, f.oy + dy, z, s.rot);
    island(g, 3, 6);
    g.fill(-2, 1, -2, 2, 6, 2, 0);
    g.set(0, 0, 0, B.hollow_bricks);
    for (let d = 1; d <= 4; d++) g.set(0, d, 0, d === 4 ? B.crystal_block : B.hollow_bricks);
    g.set(0, 5, 0, B.lantern);
    g.set(1, 1, 0, B.crystal_cluster);
    if (k === 4) g.chest(0, 1, 1, 0, LOOT.hollowCache);
  }
}

export function statue(b: Builder, s: Structure): void {
  const f = b.frame(s.x, s.y, s.z, s.rot);
  island(f, 16, 24);
  f.fill(-18, 1, -12, 18, 12, 12, 0);
  const stone = b.mix(260, [B.polished_marble, 5], [B.marble, 3], [B.cracked_stone_bricks, 1]);
  // The pedestal, and the broken legs still standing on it.
  f.fill(-15, 0, -3, -9, 3, 3, B.hollow_bricks);
  f.chest(-12, 1, 0, 0, LOOT.hollowCache);
  for (const v of [-2, 2]) for (let d = 4; d <= 6 + (v > 0 ? 2 : 0); d++) { f.set(-12, d, v, stone(...xyz(f, -12, d, v))); f.set(-13, d, v, stone(...xyz(f, -13, d, v))); }
  // The body lying where it fell, face to the sky.
  for (let u = -8; u <= 3; u++) for (let v = -3; v <= 3; v++) for (let d = 1; d <= 4; d++) {
    const round = Math.hypot(v / 3.4, (d - 2.5) / 2.2) <= 1;
    if (round) f.set(u, d, v, stone(...xyz(f, u, d, v)));
  }
  for (let u = 4; u <= 10; u++) for (let v = -3; v <= 3; v++) for (let d = 1; d <= 7; d++) {
    const r = Math.hypot((u - 7) / 3.2, v / 3, (d - 3.5) / 3);
    if (r <= 1) f.set(u, d, v, stone(...xyz(f, u, d, v)));
  }
  f.set(8, 7, -1, B.crystal_block); f.set(8, 7, 1, B.crystal_block);
  // An arm flung out across the grass, its hand holding a lantern.
  for (let v = 4; v <= 10; v++) for (let d = 1; d <= 2; d++) f.set(0, d, v, stone(...xyz(f, 0, d, v)));
  f.fill(-1, 1, 10, 1, 2, 12, stone);
  f.set(0, 3, 11, B.lantern);
  for (let k = 0; k < 8; k++) { const u = -6 + Math.floor(f.h(k, 0, 0, 261) * 16), v = -10 + Math.floor(f.h(k, 0, 1, 261) * 6); f.set(u, 1, v, stone(...xyz(f, u, 1, v))); }
}

function xyz(f: Frame, u: number, d: number, v: number): [number, number, number] { const [x, z] = f.at(u, v); return [x, f.oy + d, z]; }
