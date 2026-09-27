// Chunk storage: 16 x 256 x 16 columns of blocks, with a parallel metadata
// array (door state, fluid level, facing, ...) and packed light
// (sky light in the high nibble, block light in the low nibble).

export const CS = 16; // chunk size in x/z
export const CH = 256; // world height
export const SUB = 16; // subchunk height used for meshing
export const SUBS = CH / SUB;
export const SEA_LEVEL = 62;
export const VOLUME = CS * CS * CH;

export function idx(x: number, y: number, z: number): number {
  return x | (z << 4) | (y << 8);
}

export function chunkKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

export class Chunk {
  readonly blocks: Uint8Array;
  readonly meta: Uint8Array;
  readonly light = new Uint8Array(VOLUME);
  /** Biome id per column, used for tinting. */
  readonly biomes: Uint8Array;
  /** Subchunks whose mesh is out of date. */
  dirty = new Set<number>();
  /** Bumped on every block change (lets the map redraw only what changed). */
  version = 0;
  /** Edited by the player since generation (needs saving). */
  modified = false;
  /** Initial light has been computed. */
  lit = false;
  /** Terrain meshes exist for at least one pass. */
  meshed = false;

  constructor(readonly cx: number, readonly cz: number, blocks?: Uint8Array, meta?: Uint8Array, biomes?: Uint8Array) {
    this.blocks = blocks ?? new Uint8Array(VOLUME);
    this.meta = meta ?? new Uint8Array(VOLUME);
    this.biomes = biomes ?? new Uint8Array(CS * CS);
  }

  get(x: number, y: number, z: number): number {
    return this.blocks[idx(x, y, z)];
  }

  /** Highest y with a non-air block, or -1. */
  topY(x: number, z: number): number {
    for (let y = CH - 1; y >= 0; y--) if (this.blocks[idx(x, y, z)] !== 0) return y;
    return -1;
  }

  markAllDirty(): void {
    for (let s = 0; s < SUBS; s++) this.dirty.add(s);
  }
}
