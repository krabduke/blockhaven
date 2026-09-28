// Deterministic terrain generation. Pure: same seed and chunk coordinates
// always give the same blocks. Runs inside the worker.

import { B, isLeaves } from '../blocks';
import { Simplex, hash3, mulberry32 } from '../noise';
import { CH, CS, SEA_LEVEL, idx } from './chunk';
import { buildVillage, villagesNear } from './villages';
import { buildStructure, structuresNear } from './structures';

export const BIOME = { ocean: 0, plains: 1, forest: 2, desert: 3, taiga: 4, mountains: 5, beach: 6, birch_forest: 7, swamp: 8, savanna: 9, emberdeep: 10, river: 11, badlands: 12, jungle: 13, blossom: 14, hollow: 15 } as const;
export const BIOME_NAMES = ['Ocean', 'Plains', 'Forest', 'Desert', 'Snowy Taiga', 'Mountains', 'Beach', 'Birch Forest', 'Swamp', 'Savanna', 'Emberdeep', 'River', 'Badlands', 'Jungle', 'Blossom Grove', 'The Hollow'];

/** Grass / foliage tint per biome (rgb 0-1). */
export const BIOME_TINT: [number, number, number][] = [
  [0.5, 0.7, 0.4], [0.55, 0.73, 0.36], [0.46, 0.65, 0.3], [0.75, 0.7, 0.42],
  [0.42, 0.62, 0.4], [0.52, 0.7, 0.45], [0.6, 0.78, 0.4], [0.55, 0.76, 0.36],
  [0.42, 0.52, 0.3], [0.74, 0.72, 0.38], [0.6, 0.35, 0.25],
  [0.52, 0.72, 0.4], [0.72, 0.64, 0.4], [0.38, 0.6, 0.27], [0.56, 0.74, 0.42],
  [0.6, 0.55, 0.75],
];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface Spawn { kind: string; x: number; y: number; z: number; profession?: string }
export interface GenResult { blocks: Uint8Array; meta: Uint8Array; biomes: Uint8Array; spawns: Spawn[] }

export interface Column {
  height: number;
  biome: number;
}

export class WorldGen {
  private cont: Simplex;
  private erosion: Simplex;
  private detail: Simplex;
  private ridge: Simplex;
  private temp: Simplex;
  private humid: Simplex;
  private cave: Simplex;
  private cave2: Simplex;
  private cheese: Simplex;
  private surf: Simplex;
  private river: Simplex;
  private rock: Simplex;
  private region: Simplex;
  private ravine: Simplex;

  constructor(readonly seed: number) {
    this.river = new Simplex(seed + 10);
    this.rock = new Simplex(seed + 11);
    this.region = new Simplex(seed + 12);
    this.ravine = new Simplex(seed + 13);
    this.cont = new Simplex(seed);
    this.erosion = new Simplex(seed + 1);
    this.detail = new Simplex(seed + 2);
    this.ridge = new Simplex(seed + 3);
    this.temp = new Simplex(seed + 4);
    this.humid = new Simplex(seed + 5);
    this.cave = new Simplex(seed + 6);
    this.cave2 = new Simplex(seed + 7);
    this.cheese = new Simplex(seed + 8);
    this.surf = new Simplex(seed + 9);
  }

  column(x: number, z: number): Column {
    const c = Math.max(-1, Math.min(1, this.cont.fbm2(x / 700, z / 700, 4) * 1.7 + 0.12));
    const e = this.erosion.fbm2(x / 380, z / 380, 3);
    const d = this.detail.fbm2(x / 90, z / 90, 4);
    const r = 1 - Math.abs(this.ridge.fbm2(x / 200, z / 200, 4));
    const mountainness = smoothstep(0.2, 0.6, c) * smoothstep(0.1, -0.4, e);
    let h = SEA_LEVEL + 3 + c * 22 + d * (5 + 8 * smoothstep(-0.1, 0.4, c));
    h += mountainness * (r * r) * 75;
    let height = Math.max(4, Math.min(CH - 20, Math.floor(h)));

    const t = this.temp.fbm2(x / 900 + 100, z / 900, 3);
    const hu = this.humid.fbm2(x / 650 + 300, z / 650, 3);
    let biome: number;
    // Swamps flatten low wet ground to just around sea level.
    const swampness = smoothstep(0.28, 0.4, hu) * smoothstep(-0.15, 0, t) * smoothstep(SEA_LEVEL + 9, SEA_LEVEL + 3, height);
    if (swampness > 0.5 && height >= SEA_LEVEL - 4) {
      height = SEA_LEVEL - 1 + Math.round(d * 2.5);
      return { height, biome: BIOME.swamp };
    }
    // Rivers: a winding band where the river noise crosses zero, cut down below sea level.
    const rn = Math.abs(this.river.fbm2(x / 520, z / 520, 3));
    if (rn < 0.05 && height > SEA_LEVEL - 3 && mountainness < 0.45) {
      const tt = smoothstep(0.05, 0.018, rn);
      height = Math.round(height * (1 - tt) + (SEA_LEVEL - 3) * tt);
      if (height < SEA_LEVEL) return { height, biome: BIOME.river };
    }
    if (height < SEA_LEVEL - 1) biome = BIOME.ocean;
    else if (height <= SEA_LEVEL + 1 && c < 0.1) biome = t < -0.3 ? BIOME.taiga : BIOME.beach;
    else if (mountainness > 0.35 && height > 92) biome = BIOME.mountains;
    else if (t > 0.4 && hu < -0.1) {
      // Badlands: flat-topped terraces.
      const above = Math.max(0, height - SEA_LEVEL);
      height = SEA_LEVEL + 3 + Math.floor((above * 1.7) / 6) * 6 + (d > 0.3 ? 1 : 0);
      biome = BIOME.badlands;
    }
    else if (t > 0.3 && hu < 0.05) biome = BIOME.desert;
    else if (t > 0.2 && hu > 0.33) biome = BIOME.jungle;
    else if (t > -0.12 && t < 0.12 && hu > 0.18 && hu < 0.3 && height > SEA_LEVEL + 5) biome = BIOME.blossom;
    else if (t > 0.18 && hu < 0.28) biome = BIOME.savanna;
    else if (t < -0.28) biome = BIOME.taiga;
    else if (hu > 0.12) biome = t > 0.05 ? BIOME.forest : BIOME.birch_forest;
    else biome = BIOME.plains;
    return { height, biome };
  }

  generate(cx: number, cz: number): GenResult {
    const blocks = new Uint8Array(CS * CS * CH);
    const meta = new Uint8Array(CS * CS * CH);
    const biomes = new Uint8Array(CS * CS);
    const heights = new Int16Array(CS * CS);
    const x0 = cx * CS, z0 = cz * CS;
    const seed = this.seed;

    // 1. Terrain columns.
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        const { height, biome } = this.column(wx, wz);
        const t = this.temp.fbm2(wx / 900 + 100, wz / 900, 3);
        heights[x + z * CS] = height;
        biomes[x + z * CS] = biome;
        const sn = this.surf.noise2(wx / 12, wz / 12);
        const depth = 3 + Math.floor((sn + 1) * 1.5);
        const deepLine = 8 + Math.floor(hash3(seed + 3, wx, 0, wz) * 3 + (this.rock.noise2(wx / 30, wz / 30) + 1) * 5);
        for (let y = 0; y <= height; y++) {
          let id: number = y < deepLine ? B.deepstone : this.stoneAt(wx, y, wz);
          if (y === 0 || (y <= 4 && hash3(seed, wx, y, wz) < 1 - y / 5)) id = B.bedrock;
          else if (biome === BIOME.badlands && y > height - 30 && y > SEA_LEVEL - 6) {
            // Colour bands across the whole cliff, with red sand on top.
            const bands = [B.terracotta_orange, B.terracotta, B.terracotta_yellow, B.terracotta_white, B.terracotta_brown, B.terracotta_red, B.terracotta_orange, B.terracotta];
            id = y > height - 2 ? B.red_sand : bands[Math.floor(hash3(seed + 5, 0, y, 0) * bands.length)];
          }
          else if (y > height - depth) {
            const top = y === height;
            switch (biome) {
              case BIOME.river: id = sn > 0.3 ? B.gravel : sn < -0.3 ? B.clay : B.sand; break;
              case BIOME.swamp: id = top && height < SEA_LEVEL ? B.mud : top ? B.grass : B.dirt; break;
              case BIOME.savanna: id = top ? (sn > 0.45 ? B.coarse_dirt : B.grass) : B.dirt; break;
              case BIOME.forest: case BIOME.birch_forest: case BIOME.jungle:
                id = top ? (height >= SEA_LEVEL ? (sn > 0.35 && biome !== BIOME.jungle ? B.loam : B.grass) : B.dirt) : B.dirt; break;
              case BIOME.desert: id = y > height - depth + 2 ? B.sand : B.sandstone; break;
              case BIOME.beach: id = y > height - 3 ? B.sand : B.sandstone; break;
              case BIOME.ocean: id = sn > 0.35 ? B.gravel : sn < -0.4 && y > height - 2 ? B.clay : B.sand; break;
              case BIOME.mountains:
                if (height > 132 + sn * 5 && t < 0) id = top ? B.packed_ice : B.snow;
                else if (height > 118 + sn * 6) id = top ? B.snow : this.stoneAt(wx, y, wz);
                else if (height > 100 + sn * 8) id = top && sn > 0.4 ? B.mossy_stone : this.stoneAt(wx, y, wz);
                else id = top ? B.grass : B.dirt;
                break;
              case BIOME.taiga: id = top ? (height >= SEA_LEVEL ? (sn > 0.5 ? B.loam : B.snowy_grass) : B.dirt) : B.dirt; break;
              default: id = top ? (height >= SEA_LEVEL ? B.grass : B.dirt) : B.dirt;
            }
          }
          blocks[idx(x, y, z)] = id;
        }
        for (let y = height + 1; y <= SEA_LEVEL; y++) {
          blocks[idx(x, y, z)] = y === SEA_LEVEL && biome === BIOME.taiga ? B.ice : B.water;
        }
      }
    }

    // 2. Caves, sampled on a coarse 4x4x4 grid and interpolated.
    this.carveCaves(blocks, heights, x0, z0);

    // 3. Ores.
    const rand = mulberry32((seed ^ Math.imul(cx, 341873128) ^ Math.imul(cz, 132897987)) >>> 0);
    const ore = (id: number, veins: number, size: number, minY: number, maxY: number) => {
      for (let v = 0; v < veins; v++) {
        let x = rand() * CS, y = minY + rand() * (maxY - minY), z = rand() * CS;
        for (let s = 0; s < size; s++) {
          const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
          if (bx >= 0 && bx < CS && bz >= 0 && bz < CS && by > 0 && by < CH) {
            const i = idx(bx, by, bz);
            if (blocks[i] === B.stone) blocks[i] = id;
          }
          x += rand() * 2 - 1; y += rand() * 2 - 1; z += rand() * 2 - 1;
        }
      }
    };
    ore(B.coal_ore, 20, 12, 5, 128);
    ore(B.iron_ore, 18, 8, 5, 64);
    ore(B.gravel, 6, 20, 5, 100);
    ore(B.dirt, 6, 20, 5, 100);
    ore(B.gold_ore, 2, 8, 5, 32);
    ore(B.diamond_ore, 1, 7, 5, 16);
    ore(B.spark_ore, 7, 7, 5, 16);
    ore(B.slate, 3, 32, 5, 60);
    ore(B.marble, 2, 32, 20, 90);
    if (biomes[8 + 8 * CS] === BIOME.mountains) ore(B.amber_ore, 3 + Math.floor(rand() * 5), 1, 4, 32);
    // Mushrooms and cobwebs in dark caves.
    for (let k = 0; k < 10; k++) {
      const x = Math.floor(rand() * CS), z = Math.floor(rand() * CS), y = 8 + Math.floor(rand() * 45);
      const i = idx(x, y, z);
      if (blocks[i] !== 0 || y + 1 >= heights[x + z * CS] - 4) continue;
      const below = blocks[idx(x, y - 1, z)];
      if (below === B.stone || below === B.dirt || below === B.gravel) blocks[i] = rand() < 0.5 ? B.brown_mushroom : B.red_mushroom;
      else if (below === 0 && rand() < 0.3 && blocks[idx(x, y + 1, z)] === B.stone) blocks[i] = B.cobweb;
    }

    this.decorateCaves(blocks, heights, x0, z0, rand);
    if (rand() < 0.035) this.geode(blocks, heights, rand);

    // Dungeons: a small mossy room with a monster cage and loot chests.
    if (rand() < 0.14) this.dungeon(blocks, meta, heights, rand);

    // 4. Trees, including ones rooted in neighbouring chunks whose canopies reach in.
    this.placeTrees(blocks, cx, cz, meta);

    // 5. Ground cover.
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const h = heights[x + z * CS];
        if (h + 1 >= CH) continue;
        const ground = blocks[idx(x, h, z)];
        const above = idx(x, h + 1, z);
        const wx = x0 + x, wz = z0 + z;
        const r = hash3(seed + 77, wx, 0, wz);
        const r2 = hash3(seed + 78, wx, 0, wz);
        const biome = biomes[x + z * CS];
        // Underwater: seagrass and kelp on the floor.
        if (blocks[above] === B.water && (ground === B.sand || ground === B.gravel || ground === B.clay || ground === B.dirt || ground === B.mud)) {
          let depth = 0;
          while (h + 1 + depth < CH && blocks[idx(x, h + 1 + depth, z)] === B.water) depth++;
          if (depth >= 5 && r < 0.07 && biome === BIOME.ocean) {
            const len = 2 + Math.floor(r2 * (depth - 3));
            for (let k = 0; k < len; k++) blocks[idx(x, h + 1 + k, z)] = B.kelp;
          } else if (depth >= 2 && r < 0.3) blocks[above] = B.seagrass;
          continue;
        }
        if (blocks[above] !== 0) continue;
        if (ground === B.grass || ground === B.loam) {
          const flowers = biome === BIOME.blossom ? [B.white_flower, B.purple_flower, B.poppy] : biome === BIOME.plains ? [B.poppy, B.dandelion, B.blue_flower, B.white_flower] : biome === BIOME.swamp ? [B.brown_mushroom, B.red_mushroom] : [B.poppy, B.dandelion, B.blue_flower];
          const grassChance = biome === BIOME.plains ? 0.28 : biome === BIOME.savanna ? 0.35 : biome === BIOME.jungle ? 0.2 : biome === BIOME.blossom ? 0.22 : 0.14;
          const flowerChance = biome === BIOME.blossom ? 0.1 : biome === BIOME.plains ? 0.035 : 0.02;
          if (biome === BIOME.jungle && r < 0.012 && x > 0 && x < CS - 1 && z > 0 && z < CS - 1) {
            const tall = 4 + Math.floor(r2 * 8);
            for (let k = 1; k <= tall && h + k < CH; k++) blocks[idx(x, h + k, z)] = B.bamboo;
          } else if (r < grassChance) {
            blocks[above] = biome === BIOME.savanna && r2 < 0.5 ? B.dry_grass : (biome === BIOME.jungle || biome === BIOME.forest || biome === BIOME.taiga) && r2 < 0.35 ? B.fern : B.tall_grass;
          } else if (r < grassChance + flowerChance) blocks[above] = flowers[Math.floor(r2 * flowers.length)];
          else if (r < grassChance + flowerChance + (biome === BIOME.jungle ? 0.08 : biome === BIOME.forest || biome === BIOME.birch_forest ? 0.02 : 0.006)) blocks[above] = B.bush;
          else if (r < grassChance + flowerChance + 0.03 && (biome === BIOME.forest || biome === BIOME.taiga) && r2 < 0.15) blocks[above] = B.berry_bush;
          else if (r < grassChance + flowerChance + 0.03 && biome === BIOME.plains && r2 < 0.05) blocks[above] = B.pumpkin;
          else if (r < grassChance + flowerChance + 0.04 && (biome === BIOME.savanna || biome === BIOME.swamp || biome === BIOME.jungle) && r2 < 0.1) blocks[above] = B.melon;
          else if (r > 0.94 && nextToWater(blocks, x, h, z)) {
            if (biome === BIOME.swamp || biome === BIOME.river || r2 < 0.5) blocks[above] = B.cattail;
            else this.cane(blocks, x, h + 1, z, r);
          }
        } else if ((ground === B.sand || ground === B.red_sand) && h >= SEA_LEVEL) {
          if (biome === BIOME.desert || biome === BIOME.badlands) {
            if (r < 0.006 && x > 0 && x < CS - 1 && z > 0 && z < CS - 1) {
              const tall = 1 + Math.floor(hash3(seed, wx, 1, wz) * 3);
              for (let i = 1; i <= tall && h + i < CH; i++) blocks[idx(x, h + i, z)] = B.cactus;
            } else if (r < 0.02) blocks[above] = B.dead_bush;
            else if (r < 0.04 && biome === BIOME.badlands) blocks[above] = B.dry_grass;
          } else if (r > 0.9 && h === SEA_LEVEL && nextToWater(blocks, x, h, z)) this.cane(blocks, x, h + 1, z, r);
        } else if (ground === B.snowy_grass || ground === B.snow || (ground === B.stone && biome === BIOME.mountains && h > 118)) {
          if (r < 0.05 && ground === B.snowy_grass) blocks[above] = B.fern;
          else if (r2 < 0.75) blocks[above] = B.snow_layer;
        } else if (ground === B.coarse_dirt && r < 0.2) blocks[above] = B.dry_grass;
        else if (ground === B.mud && r < 0.2) blocks[above] = B.cattail;
      }
    }

    // Boulders and fallen logs.
    const rb = mulberry32((seed ^ Math.imul(cx, 668265263) ^ Math.imul(cz, 374761393)) >>> 0);
    const mid = biomes[8 + 8 * CS];
    if ((mid === BIOME.taiga || mid === BIOME.mountains || mid === BIOME.forest || mid === BIOME.plains) && rb() < (mid === BIOME.plains ? 0.08 : 0.3)) {
      const bx = 3 + Math.floor(rb() * 10), bz = 3 + Math.floor(rb() * 10), by = heights[bx + bz * CS];
      const rad = 1.2 + rb() * 1.3;
      if (blocks[idx(bx, by, bz)] !== B.water && by > SEA_LEVEL) {
        for (let dz = -3; dz <= 3; dz++) for (let dy = -1; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          if (Math.hypot(dx, dy * 1.2, dz) > rad + rb() * 0.4) continue;
          const i = idx(bx + dx, by + dy, bz + dz);
          blocks[i] = rb() < 0.45 ? B.mossy_cobblestone : rb() < 0.5 ? B.cobblestone : this.stoneAt(bx + dx, by + dy, bz + dz);
          meta[i] = 0;
        }
      }
    }
    if ((mid === BIOME.forest || mid === BIOME.birch_forest || mid === BIOME.taiga || mid === BIOME.jungle) && rb() < 0.25) {
      const alongX = rb() < 0.5, len = 3 + Math.floor(rb() * 3);
      const lx = 2 + Math.floor(rb() * (alongX ? 16 - len - 4 : 12)), lz = 2 + Math.floor(rb() * (alongX ? 12 : 16 - len - 4));
      const log = mid === BIOME.birch_forest ? B.birch_log : mid === BIOME.taiga ? B.spruce_log : mid === BIOME.jungle ? B.jungle_log : B.log;
      const gy = heights[lx + lz * CS];
      let ok = gy > SEA_LEVEL;
      for (let k = 0; k < len && ok; k++) {
        const x = alongX ? lx + k : lx, z = alongX ? lz : lz + k;
        if (Math.abs(heights[x + z * CS] - gy) > 1 || blocks[idx(x, gy + 1, z)] !== 0 && !BLOCK_REPLACEABLE(blocks[idx(x, gy + 1, z)])) ok = false;
      }
      if (ok) for (let k = 0; k < len; k++) {
        const x = alongX ? lx + k : lx, z = alongX ? lz : lz + k;
        const i = idx(x, gy + 1, z);
        blocks[i] = log;
        meta[i] = alongX ? 1 : 2; // lying along x or z
        if (rb() < 0.3 && blocks[idx(x, gy + 2, z)] === 0) blocks[idx(x, gy + 2, z)] = rb() < 0.6 ? B.brown_mushroom : B.red_mushroom;
      }
    }

    // Lily pads on swamp water.
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      if (biomes[x + z * CS] !== BIOME.swamp) continue;
      const i = idx(x, SEA_LEVEL, z);
      if (blocks[i] === B.water && blocks[idx(x, SEA_LEVEL + 1, z)] === 0 && hash3(seed + 91, x0 + x, 0, z0 + z) < 0.05) blocks[idx(x, SEA_LEVEL + 1, z)] = B.lily_pad;
    }

    // Structures, then villages last so they clear trees and flowers in their way.
    const spawns: Spawn[] = this.nestBees.splice(0);
    for (const st of structuresNear(this, cx, cz)) spawns.push(...buildStructure(this, st, blocks, meta, cx, cz));
    for (const v of villagesNear(this, cx, cz)) spawns.push(...buildVillage(this, v, blocks, meta, cx, cz));

    return { blocks, meta, biomes, spawns };
  }

  private dungeon(blocks: Uint8Array, meta: Uint8Array, heights: Int16Array, rand: () => number): void {
    const cx = 4 + Math.floor(rand() * 8), cz = 4 + Math.floor(rand() * 8);
    const y0 = 12 + Math.floor(rand() * 36);
    const rx = 2 + Math.floor(rand() * 2), rz = 2 + Math.floor(rand() * 2);
    // Must be fully underground.
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let z = cz - rz - 1; z <= cz + rz + 1; z++) {
      if (heights[x + z * CS] < y0 + 9) return;
    }
    for (let y = y0 - 1; y <= y0 + 4; y++) for (let z = cz - rz - 1; z <= cz + rz + 1; z++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      const wall = x === cx - rx - 1 || x === cx + rx + 1 || z === cz - rz - 1 || z === cz + rz + 1 || y === y0 - 1 || y === y0 + 4;
      const i = idx(x, y, z);
      if (wall) blocks[i] = rand() < 0.4 ? B.mossy_cobblestone : B.cobblestone;
      else blocks[i] = 0;
    }
    blocks[idx(cx, y0, cz)] = B.spawner;
    // Chests against the walls; meta bit 4 marks "fill with loot when first opened".
    const spots: [number, number, number][] = [[cx - rx, cz, 3], [cx + rx, cz, 1], [cx, cz - rz, 0], [cx, cz + rz, 2]];
    const n = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) {
      const [x, z, f] = spots[Math.floor(rand() * spots.length)];
      blocks[idx(x, y0, z)] = B.chest;
      meta[idx(x, y0, z)] = f | 16; // loot table 0: dungeon
    }
  }

  /** Dripstone and mossy cave regions, chosen by large-scale noise. */
  private decorateCaves(blocks: Uint8Array, heights: Int16Array, x0: number, z0: number, rand: () => number): void {
    const drip = this.region.noise2(x0 / 260 + 50, z0 / 260) > 0.35;
    const lush = !drip && this.region.noise2(x0 / 280 - 80, z0 / 280 + 20) > 0.4;
    if (!drip && !lush) return;
    const stoneish = (b: number) => b === B.stone || b === B.granite || b === B.limestone || b === B.deepstone || b === B.chalk || b === B.dirt;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = heights[x + z * CS];
      for (let y = 6; y < Math.min(60, h - 6); y++) {
        const i = idx(x, y, z);
        if (blocks[i] !== 0) continue;
        const above = blocks[idx(x, y + 1, z)], below = blocks[idx(x, y - 1, z)];
        if (drip) {
          if (stoneish(above)) {
            blocks[idx(x, y + 1, z)] = B.dripstone;
            if (rand() < 0.14) blocks[i] = B.pointed_dripstone;
          } else if (stoneish(below)) {
            blocks[idx(x, y - 1, z)] = B.dripstone;
            if (rand() < 0.08) blocks[i] = B.pointed_dripstone;
          }
        } else {
          if (stoneish(below)) {
            blocks[idx(x, y - 1, z)] = B.moss_block;
            const r = rand();
            if (r < 0.12) blocks[i] = B.fern;
            else if (r < 0.2) blocks[i] = B.bush;
          } else if (stoneish(above)) {
            blocks[idx(x, y + 1, z)] = B.moss_block;
            if (rand() < 0.1) {
              const len = 1 + Math.floor(rand() * 4);
              for (let k = 0; k < len && y - k > 4 && blocks[idx(x, y - k, z)] === 0; k++) blocks[idx(x, y - k, z)] = B.glowmoss;
            }
          }
        }
      }
    }
  }

  /** A hollow ball of stone lined with crystal. */
  private geode(blocks: Uint8Array, heights: Int16Array, rand: () => number): void {
    const cx = 6 + Math.floor(rand() * 4), cz = 6 + Math.floor(rand() * 4), cy = 12 + Math.floor(rand() * 26);
    if (heights[cx + cz * CS] < cy + 10) return;
    for (let z = cz - 5; z <= cz + 5; z++) for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) {
      if (x < 0 || x >= CS || z < 0 || z >= CS) continue;
      const d = Math.hypot(x - cx, y - cy, z - cz) + (rand() - 0.5) * 0.4;
      const i = idx(x, y, z);
      if (d > 4.6) continue;
      if (d > 3.8) blocks[i] = B.geode_shell;
      else if (d > 3.1) blocks[i] = B.chalk;
      else if (d > 2.4) blocks[i] = B.crystal_block;
      else blocks[i] = 0;
    }
    // Clusters growing from the crystal lining.
    for (let z = cz - 3; z <= cz + 3; z++) for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
      const i = idx(x, y, z);
      if (blocks[i] !== 0 || rand() > 0.3) continue;
      if ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => blocks[idx(x + dx, y + dy, z + dz)] === B.crystal_block)) blocks[i] = B.crystal_cluster;
    }
  }

  /** The kind of rock at a point: mostly stone, with veins of granite, limestone, chalk and basalt. */
  stoneAt(x: number, y: number, z: number): number {
    const a = this.rock.noise3(x / 38, y / 26, z / 38);
    if (a > 0.58) return B.granite;
    if (a < -0.58) return B.limestone;
    const b = this.rock.noise3(x / 24 + 100, y / 18, z / 24);
    if (b > 0.7) return y < 30 ? B.basalt : B.chalk;
    return B.stone;
  }

  private cane(blocks: Uint8Array, x: number, y: number, z: number, r: number): void {
    const tall = 1 + Math.floor(((r * 1000) % 1) * 3);
    for (let i = 0; i < tall && y + i < CH; i++) blocks[idx(x, y + i, z)] = B.sugar_cane;
  }

  private carveCaves(blocks: Uint8Array, heights: Int16Array, x0: number, z0: number): void {
    const GX = 5, GY = 33, GZ = 5; // samples at x,z = 0,4,..16 and y = 0,4,..128
    const tube = new Float32Array(GX * GY * GZ);
    const cheese = new Float32Array(GX * GY * GZ);
    for (let gy = 0; gy < GY; gy++) {
      for (let gz = 0; gz < GZ; gz++) {
        for (let gx = 0; gx < GX; gx++) {
          const wx = x0 + gx * 4, wy = gy * 4, wz = z0 + gz * 4;
          const a = this.cave.noise3(wx / 48, wy / 30, wz / 48);
          const b = this.cave2.noise3(wx / 48, wy / 30, wz / 48);
          const i = gx + gz * GX + gy * GX * GZ;
          tube[i] = a * a + b * b;
          cheese[i] = this.cheese.noise3(wx / 80, wy / 36, wz / 80);
        }
      }
    }
    const sample = (arr: Float32Array, x: number, y: number, z: number) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const ix = Math.min(GX - 2, Math.floor(fx)), iy = Math.min(GY - 2, Math.floor(fy)), iz = Math.min(GZ - 2, Math.floor(fz));
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const at = (a: number, b: number, c: number) => arr[(ix + a) + (iz + c) * GX + (iy + b) * GX * GZ];
      const c00 = at(0, 0, 0) * (1 - tx) + at(1, 0, 0) * tx;
      const c10 = at(0, 1, 0) * (1 - tx) + at(1, 1, 0) * tx;
      const c01 = at(0, 0, 1) * (1 - tx) + at(1, 0, 1) * tx;
      const c11 = at(0, 1, 1) * (1 - tx) + at(1, 1, 1) * tx;
      const c0 = c00 * (1 - ty) + c10 * ty;
      const c1 = c01 * (1 - ty) + c11 * ty;
      return c0 * (1 - tz) + c1 * tz;
    };
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const h = heights[x + z * CS];
        const wet = h <= SEA_LEVEL + 1;
        const top = Math.min(h, 127);
        // Ravines: narrow, deep canyons where the ravine noise crosses zero.
        const wx = x0 + x, wz = z0 + z;
        const rv = Math.abs(this.ravine.fbm2(wx / 340, wz / 340, 2));
        if (!wet && rv < 0.014 && this.ravine.noise2(wx / 900 + 40, wz / 900) > 0.2) {
          const depth = (0.014 - rv) / 0.014;
          const floorY = Math.round(22 + (1 - depth) * 30);
          for (let y = floorY; y <= h; y++) {
            const i = idx(x, y, z);
            if (blocks[i] === B.bedrock || blocks[i] === B.water) continue;
            blocks[i] = y <= 10 ? B.lava : 0;
          }
          continue;
        }
        for (let y = 5; y <= top; y++) {
          // Keep a solid lid under oceans and near the surface except for tunnels.
          if (wet && y > h - 5) continue;
          const t = sample(tube, x, y, z);
          const nearSurface = y > h - 6;
          let carve = t < 0.0045;
          if (!carve && !nearSurface && y < 56) {
            const ch = sample(cheese, x, y, z);
            carve = ch > 0.58 - (56 - y) * 0.002;
          }
          if (!carve) continue;
          const i = idx(x, y, z);
          const id = blocks[i];
          if (id === B.bedrock || id === B.water || id === B.ice) continue;
          // Don't expose the underside of water.
          if (y + 1 < CH && blocks[idx(x, y + 1, z)] === B.water) continue;
          blocks[i] = y <= 10 ? B.lava : 0;
        }
      }
    }
  }

  private placeTrees(blocks: Uint8Array, cx: number, cz: number, meta?: Uint8Array): void {
    const x0 = cx * CS, z0 = cz * CS;
    const R = 3;
    for (let wz = z0 - R; wz < z0 + CS + R; wz++) {
      for (let wx = x0 - R; wx < x0 + CS + R; wx++) {
        const r = hash3(this.seed + 31, wx, 0, wz);
        if (r > 0.06) continue; // cheap reject before evaluating the column
        const { height, biome } = this.column(wx, wz);
        if (height < SEA_LEVEL) continue;
        let density = 0;
        let kind: TreeKind = 'oak';
        switch (biome) {
          case BIOME.forest: density = 0.05; kind = r < 0.012 ? 'birch' : r < 0.018 ? 'bigoak' : 'oak'; break;
          case BIOME.birch_forest: density = 0.045; kind = r < 0.036 ? 'birch' : 'oak'; break;
          case BIOME.taiga: density = 0.035; kind = 'spruce'; break;
          case BIOME.plains: density = 0.0025; kind = r < 0.0008 ? 'bigoak' : 'oak'; break;
          case BIOME.mountains: density = height < 105 ? 0.01 : 0; kind = 'spruce'; break;
          case BIOME.swamp: density = 0.012; kind = 'swamp'; break;
          case BIOME.savanna: density = 0.004; kind = 'sunwood'; break;
          case BIOME.jungle: density = 0.055; kind = r < 0.02 ? 'jungle' : r < 0.04 ? 'bigoak' : 'jungle'; break;
          case BIOME.blossom: density = 0.014; kind = 'blossom'; break;
          default: density = 0;
        }
        if (r >= density) continue;
        // Surface must be grass-like: check using the column function (the actual
        // block may be in another chunk).
        const h2 = hash3(this.seed + 32, wx, 0, wz);
        this.tree(blocks, x0, z0, wx, height + 1, wz, kind, h2, meta);
        if (this.pendingNest) {
          const [lx, ny, lz] = this.pendingNest;
          this.pendingNest = null;
          if (blocks[idx(lx, ny, lz)] === 0 || isLeaves(blocks[idx(lx, ny, lz)])) { blocks[idx(lx, ny, lz)] = B.bee_nest; if (meta) meta[idx(lx, ny, lz)] = 2; }
        }
      }
    }
  }

  /** Bees for nests placed while building the current chunk. */
  private nestBees: Spawn[] = [];
  private pendingNest: [number, number, number] | null = null;

  private tree(blocks: Uint8Array, x0: number, z0: number, wx: number, by: number, wz: number, kind: TreeKind, r: number, meta?: Uint8Array): void {
    // Now and then an oak, birch or blossom tree carries a bee nest on its trunk, with its bees.
    if ((kind === 'oak' || kind === 'birch' || kind === 'blossom') && hash3(this.seed + 77, wx, by, wz) < 0.09) {
      const nx = wx, ny = by + 2, nz = wz + 1;
      const lx = nx - x0, lz = nz - z0;
      if (lx >= 0 && lx < CS && lz >= 0 && lz < CS && ny < CH) {
        this.pendingNest = [lx, ny, lz];
        for (let i = 0; i < 3; i++) this.nestBees.push({ kind: 'bee', x: nx + 0.5, y: ny + 0.2, z: nz + 1.5 });
      }
    }
    const set = (x: number, y: number, z: number, id: number, overwrite: boolean) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= CH) return;
      const i = idx(lx, y, lz);
      const cur = blocks[i];
      if (overwrite || cur === 0 || cur === B.tall_grass) blocks[i] = id;
    };
    // Only root the tree on grass/dirt/snowy grass that is actually in this chunk;
    // otherwise trust the column function.
    const lx = wx - x0, lz = wz - z0;
    if (lx >= 0 && lx < CS && lz >= 0 && lz < CS) {
      const ground = blocks[idx(lx, by - 1, lz)];
      if (ground !== B.grass && ground !== B.dirt && ground !== B.snowy_grass) return;
      blocks[idx(lx, by - 1, lz)] = B.dirt;
    }
    const blob = (cx: number, cy: number, cz: number, rad: number, leaf: number) => {
      const R = Math.ceil(rad);
      for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (Math.hypot(dx, dy * 1.4, dz) <= rad + hash3(this.seed, cx + dx, cy + dy, cz + dz) * 0.6 - 0.3) set(cx + dx, cy + dy, cz + dz, leaf, false);
      }
    };
    if (kind === 'bigoak') {
      // A broad oak with a few angled branches, each ending in a leaf cluster.
      const trunk = 6 + Math.floor(r * 4);
      for (let y = by; y < by + trunk; y++) set(wx, y, wz, B.log, true);
      blob(wx, by + trunk, wz, 2.6, B.leaves);
      const branches = 2 + Math.floor(r * 30) % 3;
      for (let b = 0; b < branches; b++) {
        const a = (b / branches) * Math.PI * 2 + r * 10;
        const len = 2 + (b % 2);
        let bx = wx, bz = wz;
        const sy = by + trunk - 3 + (b % 2);
        for (let k = 1; k <= len; k++) {
          bx = wx + Math.round(Math.cos(a) * k); bz = wz + Math.round(Math.sin(a) * k);
          set(bx, sy + k - 1, bz, B.log, true);
        }
        blob(bx, sy + len, bz, 2.1, B.leaves);
      }
      return;
    }
    if (kind === 'jungle') {
      const trunk = 8 + Math.floor(r * 7);
      for (let y = by; y < by + trunk; y++) set(wx, y, wz, B.jungle_log, true);
      blob(wx, by + trunk, wz, 3, B.jungle_leaves);
      blob(wx, by + trunk - 3, wz, 2.2, B.jungle_leaves);
      // Vines down the canopy's edges.
      if (meta) for (let k = 0; k < 8; k++) {
        const side = k % 4, off = (k >> 2) - 1;
        const [dx, dz, face] = side === 0 ? [off, -4, 2] : side === 1 ? [off, 4, 0] : side === 2 ? [-4, off, 1] : [4, off, 3];
        const len = 2 + Math.floor(hash3(this.seed, wx + k, by, wz) * 6);
        for (let i = 0; i < len; i++) {
          const lx = wx + dx - x0, lz = wz + dz - z0, yy = by + trunk - 2 - i;
          if (lx < 0 || lx >= CS || lz < 0 || lz >= CS) break;
          const ii = idx(lx, yy, lz);
          if (blocks[ii] !== 0) break;
          blocks[ii] = B.vine; meta[ii] = face;
        }
      }
      return;
    }
    if (kind === 'blossom') {
      // Short trunk that splits into two leaning limbs under a wide pink canopy.
      const trunk = 3 + Math.floor(r * 2);
      for (let y = by; y < by + trunk; y++) set(wx, y, wz, B.blossom_log, true);
      const dir = Math.floor(r * 97) % 4;
      const [ddx, ddz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][dir];
      set(wx + ddx, by + trunk, wz + ddz, B.blossom_log, true);
      set(wx - ddz, by + trunk, wz + ddx, B.blossom_log, true);
      set(wx + ddx * 2, by + trunk + 1, wz + ddz * 2, B.blossom_log, true);
      blob(wx + ddx * 2, by + trunk + 3, wz + ddz * 2, 3, B.blossom_leaves);
      blob(wx - ddz, by + trunk + 2, wz + ddx, 2.4, B.blossom_leaves);
      return;
    }
    if (kind === 'sunwood') {
      // A leaning trunk with a wide, flat canopy.
      const trunk = 4 + Math.floor(r * 2);
      const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(r * 97) % 4];
      let tx = wx, tz = wz;
      for (let i = 0; i < trunk; i++) {
        if (i >= trunk - 2) { tx += dir[0]; tz += dir[1]; }
        set(tx, by + i, tz, B.sunwood_log, true);
      }
      const top = by + trunk;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
        set(tx + dx, top, tz + dz, B.sunwood_leaves, false);
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) set(tx + dx, top + 1, tz + dz, B.sunwood_leaves, false);
      }
      set(tx, top, tz, B.sunwood_log, true);
      return;
    }
    if (kind === 'swamp') {
      const trunk = 4 + Math.floor(r * 3);
      const top = by + trunk;
      for (let y = top - 2; y <= top; y++) {
        const radius = y === top ? 2 : 3;
        for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
          set(wx + dx, y, wz + dz, B.leaves, false);
        }
      }
      for (let y = by; y < top; y++) set(wx, y, wz, B.log, true);
      // Vines hanging from the canopy edge.
      if (meta) {
        for (let k = 0; k < 10; k++) {
          const side = Math.floor(hash3(this.seed, wx + k, top, wz) * 4);
          const along = Math.floor(hash3(this.seed, wx, top + k, wz) * 5) - 2;
          const [dx, dz, face] = side === 0 ? [along, -4, 2] : side === 1 ? [along, 4, 0] : side === 2 ? [-4, along, 1] : [4, along, 3];
          const len = 1 + Math.floor(hash3(this.seed + 5, wx + k, top, wz) * 4);
          for (let i = 0; i < len; i++) {
            const lx = wx + dx - x0, lz = wz + dz - z0, yy = top - 1 - i;
            if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || yy < 1) break;
            const ii = idx(lx, yy, lz);
            if (blocks[ii] !== 0) break;
            blocks[ii] = B.vine;
            meta[ii] = face;
          }
        }
      }
      return;
    }
    if (kind === 'spruce') {
      const trunk = 6 + Math.floor(r * 4);
      const top = by + trunk;
      let radius = 0;
      for (let y = top; y >= by + 2; y--) {
        for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
          set(wx + dx, y, wz + dz, B.spruce_leaves, false);
        }
        radius = radius >= 3 ? 1 : radius + 1;
        if ((top - y) % 2 === 0 && radius > 1) radius--;
      }
      set(wx, top + 1, wz, B.spruce_leaves, false);
      for (let y = by; y < top; y++) set(wx, y, wz, B.spruce_log, true);
      return;
    }
    const log = kind === 'birch' ? B.birch_log : B.log;
    const leaves = kind === 'birch' ? B.birch_leaves : B.leaves;
    const trunk = (kind === 'birch' ? 5 : 4) + Math.floor(r * 3);
    const top = by + trunk;
    for (let y = top - 3; y <= top; y++) {
      const radius = y >= top - 1 ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && (y === top || hash3(this.seed, wx + dx, y, wz + dz) < 0.5)) continue;
        set(wx + dx, y, wz + dz, leaves, false);
      }
    }
    for (let y = by; y < top; y++) set(wx, y, wz, log, true);
  }
}

type TreeKind = 'oak' | 'birch' | 'spruce' | 'swamp' | 'sunwood' | 'bigoak' | 'jungle' | 'blossom';

function BLOCK_REPLACEABLE(id: number): boolean {
  return id === 0 || id === B.tall_grass || id === B.fern || id === B.snow_layer || id === B.dry_grass || id === B.bush;
}

function nextToWater(blocks: Uint8Array, x: number, y: number, z: number): boolean {
  const n = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of n) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nx >= CS || nz < 0 || nz >= CS) continue;
    if (blocks[idx(nx, y, nz)] === B.water) return true;
  }
  return false;
}
