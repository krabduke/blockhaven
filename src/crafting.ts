// Crafting recipes. Shaped recipes are matched after trimming empty rows and
// columns, and also mirrored, so a 2x2 grid can make anything that fits in it.

import { B } from './blocks';
import { ARMOR_MATERIALS, ARMOR_PIECES, I, MATERIALS, type ItemStack } from './items';
import type { Slot } from './inventory';

interface Shaped { pattern: string[]; key: Record<string, number | number[]>; result: [number, number] }
interface Shapeless { ingredients: (number | number[])[]; result: [number, number] }

const shaped: Shaped[] = [];
const shapeless: Shapeless[] = [];

const LOGS = [B.log, B.birch_log, B.spruce_log, B.sunwood_log, B.jungle_log, B.blossom_log];
const PLANKS = B.planks;

function r(pattern: string[], key: Record<string, number | number[]>, result: number, count = 1) {
  shaped.push({ pattern, key, result: [result, count] });
}
function s(ingredients: (number | number[])[], result: number, count = 1) {
  shapeless.push({ ingredients, result: [result, count] });
}

s([LOGS], PLANKS, 4);
r(['P', 'P'], { P: PLANKS }, I.stick, 4);
r(['PP', 'PP'], { P: PLANKS }, B.crafting_table);
r(['CCC', 'C C', 'CCC'], { C: B.cobblestone }, B.furnace);
r(['PPP', 'P P', 'PPP'], { P: PLANKS }, B.chest);
r(['C', 'S'], { C: I.coal, S: I.stick }, B.torch, 4);
r(['PP', 'PP', 'PP'], { P: PLANKS }, B.door, 3);
r(['WWW', 'PPP'], { W: B.wool, P: PLANKS }, B.bed);
r(['S S', 'SSS', 'S S'], { S: I.stick }, B.ladder, 3);
r(['PPP', 'BBB', 'PPP'], { P: PLANKS, B: I.paper }, B.bookshelf);
r(['SSS'], { S: B.sugar_cane }, I.paper, 3);
s([B.sugar_cane], I.sugar);
r(['WWW'], { W: I.wheat_item }, I.bread);
r(['SS', 'SS'], { S: I.string }, B.wool);
r(['CC', 'CC'], { C: B.cobblestone }, B.stone_bricks, 4);
r(['SS', 'SS'], { S: B.sand }, B.sandstone);
r(['CCC'], { C: B.cobblestone }, B.cobble_slab, 6);
r(['PPP'], { P: PLANKS }, B.plank_slab, 6);
r(['I I', ' I '], { I: I.iron_ingot }, I.bucket);
s([I.iron_ingot, I.flint], I.flint_and_steel);
r(['GSG', 'SGS', 'GSG'], { G: I.gunpowder, S: B.sand }, B.tnt);
r(['GG', 'GG'], { G: B.glowstone }, B.lamp);
r(['S', 'C'], { S: I.stick, C: B.cobblestone }, B.lever);
s([B.pumpkin], I.seeds, 4);
r(['P  ', 'PP ', 'PPP'], { P: PLANKS }, B.oak_stairs, 4);
r(['C  ', 'CC ', 'CCC'], { C: B.cobblestone }, B.cobble_stairs, 4);
r(['C  ', 'CC ', 'CCC'], { C: B.stone_bricks }, B.stone_brick_stairs, 4);
r(['PSP', 'PSP'], { P: PLANKS, S: I.stick }, B.fence, 3);
r(['SPS', 'SPS'], { P: PLANKS, S: I.stick }, B.fence_gate);
r([' B ', 'DOD', 'OOO'], { B: I.book, D: I.diamond, O: B.obsidian }, B.enchanting_table);
s([I.paper, I.paper, I.paper, I.leather], I.book);
r([' SX', 'S X', ' SX'], { S: I.stick, X: I.string }, I.bow);
r(['F', 'S', 'E'], { F: I.flint, S: I.stick, E: I.feather }, I.arrow, 4);
r([' I', 'I '], { I: I.iron_ingot }, I.shears);
s([I.bone], I.bone_meal, 3);
r(['SS', 'SS'], { S: I.snowball }, B.snow);
r(['  S', ' SX', 'S X'], { S: I.stick, X: I.string }, I.fishing_rod);
r(['GG', 'GG'], { G: I.glow_dust }, B.glowstone);
// Emberdeep, village and building blocks.
r(['BB', 'BB'], { B: I.cinder_brick }, B.cinder_bricks);
r(['QQ', 'QQ'], { Q: I.emberquartz }, B.emberquartz_block);
r(['AAA', 'AAA', 'AAA'], { A: I.amber }, B.amber_block);
s([B.amber_block], I.amber, 9);
r(['WWW', 'WWW', 'WWW'], { W: I.wheat_item }, B.hay_bale);
s([B.hay_bale], I.wheat_item, 9);
r(['MMM', 'MMM', 'MMM'], { M: I.melon_slice }, B.melon);
r(['TT', 'TT'], { T: B.terracotta }, B.bricks, 4);
s([B.poppy], I.dye_red, 2);
s([B.dandelion], I.dye_yellow, 2);
s([B.blue_flower], I.dye_blue, 2);
s([I.coal, I.bone_meal], I.dye_black, 2);
s([I.dye_red, I.dye_yellow], I.dye_orange, 2);
const WOOL_DYES: [number, number][] = [[I.dye_red, B.wool_red], [I.dye_yellow, B.wool_yellow], [I.dye_green, B.wool_green], [I.dye_blue, B.wool_blue], [I.dye_black, B.wool_black], [I.dye_orange, B.wool_orange]];
for (const [dye, wool] of WOOL_DYES) s([B.wool, dye], wool);
r(['WW'], { W: B.wool }, B.carpet, 3);
r(['GGG', 'GGG'], { G: B.glass }, B.glass_pane, 16);
r(['III', 'III'], { I: I.iron_ingot }, B.iron_bars, 16);
r(['PPP', 'PPP'], { P: PLANKS }, B.trapdoor, 2);
r(['I', 'T'], { I: I.iron_ingot, T: B.torch }, B.lantern);
s([B.stone], B.button);
r(['SS'], { S: B.stone }, B.pressure_plate);
r(['PPP', 'PPP', ' S '], { P: PLANKS, S: I.stick }, B.sign, 3);
r(['WWW', 'SES', 'WWW'], { W: I.wheat_item, S: I.sugar, E: I.egg }, B.cake);
r(['P P', ' P '], { P: PLANKS }, I.bowl, 4);
s([I.bowl, B.red_mushroom, B.brown_mushroom], I.mushroom_stew);
r(['GGG', 'GAG', 'GGG'], { G: I.gold_ingot, A: I.apple }, I.golden_apple);
s([I.gunpowder, I.ember_core, I.coal], I.fire_charge, 3);
r(['SS', 'SS'], { S: B.slate }, B.polished_slate, 4);
r(['MM', 'MM'], { M: B.marble }, B.polished_marble, 4);
s([B.stone_bricks, B.vine], B.mossy_stone_bricks);
s([B.melon], I.melon_slice, 9);

r(['GG', 'GG'], { G: B.granite }, B.polished_granite, 4);
r(['LL', 'LL'], { L: B.limestone }, B.polished_limestone, 4);
r(['DD', 'DD'], { D: B.cobbled_deepstone }, B.deepstone_bricks, 4);
r(['MM', 'MM'], { M: B.mud }, B.mud_bricks, 4);
r(['SS', 'SS'], { S: B.red_sand }, B.red_sandstone);
r(['CC', 'CC'], { C: I.crystal_shard }, B.crystal_block);
s([B.cobblestone, B.moss_block], B.mossy_cobblestone);
s([B.stone_bricks, B.moss_block], B.mossy_stone_bricks);
s([B.dirt, B.gravel], B.coarse_dirt, 2);

const ARMOR_MAT: Record<string, number> = { leather: I.leather, golden: I.gold_ingot, iron: I.iron_ingot, diamond: I.diamond };
const ARMOR_PATTERNS = [['MMM', 'M M'], ['M M', 'MMM', 'MMM'], ['MMM', 'M M', 'M M'], ['M M', 'M M']];
for (const m of ARMOR_MATERIALS) ARMOR_PIECES.forEach((pc, i) => r(ARMOR_PATTERNS[i], { M: ARMOR_MAT[m.key] }, I[`${m.key}_${pc.key}`]));
for (const [block, ingot] of [[B.iron_block, I.iron_ingot], [B.gold_block, I.gold_ingot], [B.diamond_block, I.diamond]]) {
  r(['III', 'III', 'III'], { I: ingot }, block);
  s([block], ingot, 9);
}

// Tools.
const HEAD_MATERIAL: Record<string, number | number[]> = {
  wooden: PLANKS,
  stone: B.cobblestone,
  iron: I.iron_ingot,
  golden: I.gold_ingot,
  diamond: I.diamond,
};
for (const m of MATERIALS) {
  const M = HEAD_MATERIAL[m.key];
  r(['MMM', ' S ', ' S '], { M, S: I.stick }, I[`${m.key}_pickaxe`]);
  r(['MM', 'MS', ' S'], { M, S: I.stick }, I[`${m.key}_axe`]);
  r(['M', 'S', 'S'], { M, S: I.stick }, I[`${m.key}_shovel`]);
  r(['M', 'M', 'S'], { M, S: I.stick }, I[`${m.key}_sword`]);
  r(['MM', ' S', ' S'], { M, S: I.stick }, I[`${m.key}_hoe`]);
}

function matches(want: number | number[] | undefined, have: Slot): boolean {
  if (want === undefined) return have === null;
  if (!have) return false;
  return Array.isArray(want) ? want.includes(have.id) : want === have.id;
}

/** Trim a grid (row-major, size w x h) to the bounding box of its non-empty slots. */
function trim(grid: Slot[], w: number): { cells: Slot[]; w: number; h: number } | null {
  const h = grid.length / w;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[x + y * w]) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return null;
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const cells: Slot[] = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) cells.push(grid[x + y * w]);
  return { cells, w: tw, h: th };
}

/** Find the result of a crafting grid of width `w` (2 or 3). */
export function craft(grid: Slot[], w: number): ItemStack | null {
  const t = trim(grid, w);
  if (!t) return null;
  for (const rec of shaped) {
    const ph = rec.pattern.length, pw = Math.max(...rec.pattern.map((p) => p.length));
    if (ph !== t.h || pw !== t.w) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++) for (let x = 0; x < pw && ok; x++) {
        const ch = rec.pattern[y][mirror ? pw - 1 - x : x] ?? ' ';
        ok = matches(ch === ' ' ? undefined : rec.key[ch], t.cells[x + y * t.w]);
      }
      if (ok) return { id: rec.result[0], count: rec.result[1] };
    }
  }
  const items = grid.filter((g): g is ItemStack => g !== null);
  for (const rec of shapeless) {
    if (rec.ingredients.length !== items.length) continue;
    const used = new Array(items.length).fill(false);
    const ok = rec.ingredients.every((ing) => {
      const k = items.findIndex((it, i) => !used[i] && matches(ing, it));
      if (k < 0) return false;
      used[k] = true;
      return true;
    });
    if (ok) return { id: rec.result[0], count: rec.result[1] };
  }
  return null;
}

// Furnace recipes: input -> output.
export const SMELTING: Record<number, number> = {
  [B.iron_ore]: I.iron_ingot,
  [B.gold_ore]: I.gold_ingot,
  [B.sand]: B.glass,
  [B.cobblestone]: B.stone,
  [B.clay]: B.terracotta,
  [B.red_sand]: B.glass,
  [B.cobbled_deepstone]: B.deepstone,
  [B.cinderstone]: I.cinder_brick,
  [B.cactus]: I.dye_green,
  [B.stone_bricks]: B.cracked_stone_bricks,
  [B.emberquartz_ore]: I.emberquartz,
  [B.amber_ore]: I.amber,
  [B.spark_ore]: I.spark_dust,
  [I.raw_pork]: I.cooked_pork,
  [I.raw_chicken]: I.cooked_chicken,
  [I.raw_mutton]: I.cooked_mutton,
  [I.raw_fish]: I.cooked_fish,
  [B.log]: I.coal,
  [B.birch_log]: I.coal,
  [B.spruce_log]: I.coal,
};

export function recipeCount(): number {
  return shaped.length + shapeless.length;
}
