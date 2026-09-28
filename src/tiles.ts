// Deterministic list of texture tiles. Both the main thread (which paints the
// textures) and the mesh worker (which only needs indices) derive the same
// name -> layer mapping from this file.

import { BLOCKS } from './blocks';
import { ITEMS } from './items';

const names: string[] = [];
const index = new Map<string, number>();

function add(n: string): void {
  if (!index.has(n)) {
    index.set(n, names.length);
    names.push(n);
  }
}

for (const b of BLOCKS) {
  if (b.id === 0 || b.key.startsWith('unknown_')) continue;
  b.tiles.forEach(add);
  if (b.icon) add(b.icon);
  b.metaTiles?.forEach(add);
}
for (let i = 0; i <= 7; i++) add('wheat_' + i);
for (let i = 0; i <= 3; i++) add('carrots_' + i);
for (let i = 0; i <= 3; i++) { add('potatoes_' + i); add('redroot_' + i); }
add('bow_pull');
add('crossbow_loaded');
for (const t of ['piston_inner', 'watcher_back_on', 'repeater_on', 'repeater_torch', 'repeater_torch_on']) add(t);
add('door_top');
add('astral_frame_top_full'); add('astral_eye');
add('bed_foot');
add('water_flow');
for (let i = 0; i < 10; i++) add('destroy_' + i);
for (const it of ITEMS) if (it && it.id >= 256 && it.icon) add(it.icon);

/** Natural tiles that get extra randomised versions, so large areas don't tile visibly. */
export const VARIANT_COUNTS: Record<string, number> = {
  grass_top: 4, grass_side: 3, dirt: 3, stone: 4, sand: 3, gravel: 2, cobblestone: 3, snow: 2, leaves: 3,
  spruce_leaves: 2, log_side: 2, granite: 2, limestone: 2, deepstone: 3, red_sand: 2, coarse_dirt: 2,
  loam_top: 2, mud: 2, moss_block: 2, packed_ice: 2, tall_grass: 3, fern: 2, dripstone: 2, basalt_side: 2, hollowstone: 3,
};
for (const [base, n] of Object.entries(VARIANT_COUNTS)) {
  if (!index.has(base)) continue;
  for (let i = 1; i < n; i++) add(`${base}~${i}`);
}

export const TILE_NAMES: readonly string[] = names;

/** For a base tile's layer, all layers it can use (itself first). */
export const VARIANT_LAYERS: (number[] | undefined)[] = [];
for (const [base, n] of Object.entries(VARIANT_COUNTS)) {
  const b = index.get(base);
  if (b === undefined || n < 2) continue;
  VARIANT_LAYERS[b] = [b, ...Array.from({ length: n - 1 }, (_, i) => index.get(`${base}~${i + 1}`)!)];
}

/** Natural tops whose texture can be rotated per block. */
export const ROTATABLE = new Set(['grass_top', 'dirt', 'sand', 'stone', 'gravel', 'snow', 'red_sand', 'moss_block', 'coarse_dirt', 'loam_top', 'mud', 'packed_ice', 'deepstone', 'granite', 'limestone', 'chalk', 'cobblestone', 'hollowstone']);

export function tileIndex(name: string): number {
  const i = index.get(name);
  if (i === undefined) throw new Error('Unknown tile ' + name);
  return i;
}

/** Tiles multiplied by the biome's grass/foliage colour. */
/** Base tile name for a variant ("grass_top~2" -> "grass_top"). */
export function baseTile(name: string): string {
  const i = name.indexOf('~');
  return i < 0 ? name : name.slice(0, i);
}

export const TINTED_BASE = new Set(['grass_top', 'leaves', 'tall_grass', 'spruce_leaves', 'sugar_cane', 'sunwood_leaves', 'vine', 'lily_pad', 'fern', 'bush', 'jungle_leaves', 'moss_block', 'mossy_stone_top']);
export const TINTED = new Set(names.filter((n) => TINTED_BASE.has(baseTile(n))));
