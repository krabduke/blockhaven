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
}
for (let i = 0; i <= 7; i++) add('wheat_' + i);
for (let i = 0; i <= 3; i++) add('carrots_' + i);
add('bow_pull');
add('door_top');
add('bed_foot');
add('water_flow');
for (let i = 0; i < 10; i++) add('destroy_' + i);
for (const it of ITEMS) if (it && it.id >= 256 && it.icon) add(it.icon);

export const TILE_NAMES: readonly string[] = names;

export function tileIndex(name: string): number {
  const i = index.get(name);
  if (i === undefined) throw new Error('Unknown tile ' + name);
  return i;
}

/** Tiles multiplied by the biome's grass/foliage colour. */
export const TINTED = new Set(['grass_top', 'leaves', 'tall_grass', 'spruce_leaves', 'sugar_cane']);
