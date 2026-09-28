// Paper maps. Each filled map is a 128 x 128 picture of one patch of the overworld, lined up on a
// 128-block grid. It starts blank and fills in as you walk around with it in your hand. Treasure
// maps are drawn up front from the world's seed (so the coast shows before you've been there) and
// mark a buried chest with an X. Pictures are kept with the world as small PNGs.

import { BIOME, type WorldGen } from '../world/worldgen';
import { SEA_LEVEL, CS } from '../world/chunk';
import type { World } from '../world/world';
import type { WorldMap } from '../ui/map';

export const MAP_SIZE = 128;
const PAPER = '#d8c89c';

export interface PaperMap {
  x0: number;
  z0: number;
  canvas: HTMLCanvasElement;
  /** A treasure map's X. */
  target?: [number, number];
  /** Cached PNG, cleared when the picture changes. */
  png?: string;
}

interface SavedMap { id: number; x0: number; z0: number; png: string; target?: [number, number] }

export class MapStore {
  private maps = new Map<number, PaperMap>();
  private next = 1;

  clear(): void { this.maps.clear(); this.next = 1; }

  load(data: unknown): void {
    this.clear();
    if (!Array.isArray(data)) return;
    for (const d of data as SavedMap[]) {
      if (typeof d?.id !== 'number') continue;
      const m = this.blank(d.x0, d.z0, d.target);
      m.png = d.png;
      const img = new Image();
      img.onload = () => m.canvas.getContext('2d')!.drawImage(img, 0, 0);
      img.src = d.png;
      this.maps.set(d.id, m);
      this.next = Math.max(this.next, d.id + 1);
    }
  }

  serialize(): SavedMap[] {
    return [...this.maps].map(([id, m]) => {
      m.png ??= m.canvas.toDataURL('image/png');
      return { id, x0: m.x0, z0: m.z0, png: m.png, target: m.target };
    });
  }

  get(id: number | undefined): PaperMap | undefined { return id === undefined ? undefined : this.maps.get(id); }

  private blank(x0: number, z0: number, target?: [number, number]): PaperMap {
    const canvas = Object.assign(document.createElement('canvas'), { width: MAP_SIZE, height: MAP_SIZE });
    const g = canvas.getContext('2d')!;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    return { x0, z0, canvas, target };
  }

  /** A new map of the grid square around (x, z). Returns its id. */
  create(x: number, z: number): number {
    const id = this.next++;
    this.maps.set(id, this.blank(Math.floor(x / MAP_SIZE) * MAP_SIZE, Math.floor(z / MAP_SIZE) * MAP_SIZE));
    return id;
  }

  /** A treasure map centred on (x, z), drawn from the seed, with an X on the spot. */
  createTreasure(gen: WorldGen, x: number, z: number): number {
    const id = this.next++;
    const m = this.blank(x - MAP_SIZE / 2, z - MAP_SIZE / 2, [x, z]);
    const g = m.canvas.getContext('2d')!;
    const img = g.createImageData(MAP_SIZE, MAP_SIZE);
    const hs = new Int16Array(MAP_SIZE * MAP_SIZE);
    for (let v = 0; v < MAP_SIZE; v++) for (let u = 0; u < MAP_SIZE; u++) {
      const c = gen.column(m.x0 + u, m.z0 + v);
      hs[u + v * MAP_SIZE] = c.height;
      let col: [number, number, number];
      if (c.height < SEA_LEVEL) { const d = Math.min(1, (SEA_LEVEL - c.height) / 14); col = [110 - d * 40, 150 - d * 40, 190 - d * 30]; }
      else if (c.biome === BIOME.beach || c.biome === BIOME.desert) col = [220, 200, 140];
      else if (c.biome === BIOME.mountains) col = c.height > 118 ? [236, 236, 240] : [150, 150, 150];
      else if (c.biome === BIOME.taiga) col = [210, 222, 220];
      else if (c.biome === BIOME.forest || c.biome === BIOME.jungle || c.biome === BIOME.birch_forest) col = [80, 130, 60];
      else if (c.biome === BIOME.badlands) col = [190, 110, 60];
      else col = [120, 165, 80];
      const o = (u + v * MAP_SIZE) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    // Shade slopes like the world map, then age it toward paper.
    for (let v = 1; v < MAP_SIZE; v++) for (let u = 1; u < MAP_SIZE; u++) {
      const h = hs[u + v * MAP_SIZE], k = Math.max(0.75, Math.min(1.2, 1 + ((h - hs[u + (v - 1) * MAP_SIZE]) + (h - hs[u - 1 + v * MAP_SIZE])) * 0.05));
      const o = (u + v * MAP_SIZE) * 4;
      for (let c = 0; c < 3; c++) img.data[o + c] = img.data[o + c] * k * 0.7 + [216, 200, 156][c] * 0.3;
    }
    g.putImageData(img, 0, 0);
    this.maps.set(id, m);
    return id;
  }

  /** Fill in the part of a map around (px, pz) from what's loaded. Returns true if anything changed. */
  explore(id: number, world: World, wm: WorldMap, px: number, pz: number, radius = 48): boolean {
    const m = this.maps.get(id);
    if (!m || world.dimension !== 'overworld') return false;
    const g = m.canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    let changed = false;
    const c0x = Math.floor((Math.max(m.x0, px - radius)) / CS), c1x = Math.floor((Math.min(m.x0 + MAP_SIZE - 1, px + radius)) / CS);
    const c0z = Math.floor((Math.max(m.z0, pz - radius)) / CS), c1z = Math.floor((Math.min(m.z0 + MAP_SIZE - 1, pz + radius)) / CS);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const ch = world.getChunk(cx, cz);
      if (!ch) continue;
      const cv = wm.chunkCanvas(ch);
      if (!cv) continue;
      g.drawImage(cv, cx * CS - m.x0, cz * CS - m.z0);
      changed = true;
    }
    if (changed) m.png = undefined;
    return changed;
  }
}
