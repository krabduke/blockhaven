import { B, BLOCKS } from './blocks';

// Item ids 0-255 are the blocks themselves; 256+ are pure items.

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe';

export interface ItemDef {
  id: number;
  key: string;
  name: string;
  /** Atlas tile for flat icons; undefined for blocks rendered as a cube icon. */
  icon?: string;
  maxStack: number;
  food?: { hunger: number; saturation: number };
  tool?: { kind: ToolKind; tier: number; speed: number; durability: number; damage: number };
  /** Using the item on a block places this block. */
  places?: number;
  fuelTicks?: number;
  armor?: { slot: 0 | 1 | 2 | 3; points: number; durability: number };
  /** Right-click-and-hold / throw behaviours. */
  use?: 'bow' | 'throw' | 'shears' | 'bonemeal' | 'rod' | 'ignite' | 'dye' | 'firecharge';
  /** Extra effect when eaten. */
  effect?: 'regen';
  /** Dye colour -> wool block key. */
  dye?: string;
}

export interface Enchant { id: EnchantId; level: number }
export type EnchantId = 'efficiency' | 'sharpness' | 'protection' | 'unbreaking' | 'power' | 'feather_falling';
export const ENCHANT_NAMES: Record<EnchantId, string> = {
  efficiency: 'Efficiency', sharpness: 'Sharpness', protection: 'Protection', unbreaking: 'Unbreaking', power: 'Power', feather_falling: 'Feather Falling',
};

const items: ItemDef[] = [];
export const I: Record<string, number> = {};

function item(id: number, key: string, name: string, o: Partial<ItemDef> = {}): void {
  items[id] = { id, key, name, icon: o.icon ?? key, maxStack: o.maxStack ?? 64, ...o };
  I[key] = id;
}

// Blocks as items.
for (const b of BLOCKS) {
  if (b.id === 0 || b.key.startsWith('unknown_')) continue;
  const flat = b.shape === 'cross' || b.shape === 'torch' || b.shape === 'door' || b.shape === 'bed' || b.shape === 'ladder' || b.fluid;
  items[b.id] = { id: b.id, key: b.key, name: b.name, icon: b.icon ?? (flat ? b.tiles[0] : undefined), maxStack: b.shape === 'bed' ? 1 : 64 };
  I[b.key] = b.id;
}

item(256, 'stick', 'Stick', { fuelTicks: 100 });
item(257, 'coal', 'Coal', { fuelTicks: 1600 });
item(258, 'iron_ingot', 'Iron Ingot');
item(259, 'gold_ingot', 'Gold Ingot');
item(260, 'diamond', 'Diamond');
item(261, 'string', 'String');
item(262, 'apple', 'Apple', { food: { hunger: 4, saturation: 2.4 } });
item(263, 'raw_pork', 'Raw Porkchop', { food: { hunger: 3, saturation: 1.8 } });
item(264, 'cooked_pork', 'Cooked Porkchop', { food: { hunger: 8, saturation: 12.8 } });
item(265, 'raw_chicken', 'Raw Chicken', { food: { hunger: 2, saturation: 1.2 } });
item(266, 'cooked_chicken', 'Cooked Chicken', { food: { hunger: 6, saturation: 7.2 } });
item(267, 'raw_mutton', 'Raw Mutton', { food: { hunger: 2, saturation: 1.2 } });
item(268, 'cooked_mutton', 'Cooked Mutton', { food: { hunger: 6, saturation: 9.6 } });
item(269, 'rotten_flesh', 'Rotten Flesh', { food: { hunger: 4, saturation: 0.8 } });
item(270, 'bone', 'Bone');
item(271, 'feather', 'Feather');
item(272, 'flint', 'Flint');
item(273, 'bread', 'Bread', { food: { hunger: 5, saturation: 6 } });
item(274, 'wheat_item', 'Wheat', { icon: 'wheat_item' });
item(275, 'bucket', 'Bucket', { maxStack: 16 });
item(276, 'water_bucket', 'Water Bucket', { maxStack: 1 });
item(277, 'seeds', 'Wheat Seeds', { places: B.wheat });
item(278, 'lava_bucket', 'Lava Bucket', { maxStack: 1, fuelTicks: 20000 });
item(279, 'flint_and_steel', 'Flint and Steel', { maxStack: 1, use: 'ignite', tool: { kind: 'hoe', tier: 0, speed: 1, durability: 64, damage: 1 } });
item(280, 'paper', 'Paper');
item(281, 'sugar', 'Sugar');
item(282, 'leather', 'Leather');
item(283, 'bow', 'Bow', { maxStack: 1, use: 'bow', tool: { kind: 'sword', tier: 0, speed: 1, durability: 384, damage: 1 } });
item(284, 'arrow', 'Arrow');
item(285, 'shears', 'Shears', { maxStack: 1, use: 'shears', tool: { kind: 'hoe', tier: 0, speed: 1, durability: 238, damage: 1 } });
item(286, 'bone_meal', 'Bone Meal', { use: 'bonemeal' });
item(287, 'snowball', 'Snowball', { maxStack: 16, use: 'throw' });
item(288, 'egg', 'Egg', { maxStack: 16, use: 'throw' });
item(289, 'book', 'Book');
item(290, 'fishing_rod', 'Fishing Rod', { maxStack: 1, use: 'rod', tool: { kind: 'hoe', tier: 0, speed: 1, durability: 64, damage: 1 } });
item(291, 'raw_fish', 'Raw Fish', { food: { hunger: 2, saturation: 0.4 } });
item(292, 'cooked_fish', 'Cooked Fish', { food: { hunger: 5, saturation: 6 } });
item(293, 'carrot', 'Carrot', { food: { hunger: 3, saturation: 3.6 }, places: B.carrots });
item(294, 'gunpowder', 'Gunpowder');
item(295, 'glow_dust', 'Glow Dust');
item(400, 'amber', 'Amber');
item(401, 'emberquartz', 'Emberquartz');
item(402, 'cinder_brick', 'Cinder Brick');
item(403, 'ember_core', 'Ember Core', { fuelTicks: 2400 });
item(404, 'dye_red', 'Red Dye', { use: 'dye', dye: 'wool_red' });
item(405, 'dye_yellow', 'Yellow Dye', { use: 'dye', dye: 'wool_yellow' });
item(406, 'dye_green', 'Green Dye', { use: 'dye', dye: 'wool_green' });
item(407, 'dye_blue', 'Blue Dye', { use: 'dye', dye: 'wool_blue' });
item(408, 'dye_black', 'Black Dye', { use: 'dye', dye: 'wool_black' });
item(409, 'dye_orange', 'Orange Dye', { use: 'dye', dye: 'wool_orange' });
item(410, 'bowl', 'Bowl', { fuelTicks: 100 });
item(411, 'mushroom_stew', 'Mushroom Stew', { maxStack: 1, food: { hunger: 6, saturation: 7.2 } });
item(412, 'melon_slice', 'Melon Slice', { food: { hunger: 2, saturation: 1.2 } });
item(413, 'spark_dust', 'Spark Dust', { places: B.wire });
item(414, 'fire_charge', 'Fire Charge', { use: 'firecharge' });
item(415, 'golden_apple', 'Golden Apple', { food: { hunger: 4, saturation: 9.6 }, effect: 'regen' });
item(416, 'red_berries', 'Red Berries', { food: { hunger: 2, saturation: 0.4 } });
item(417, 'crystal_shard', 'Crystal Shard');

// Planks, logs and wooden things burn too.
for (const k of ['planks', 'log', 'birch_log', 'spruce_log', 'crafting_table', 'bookshelf', 'chest', 'plank_slab', 'ladder', 'sapling']) {
  items[B[k]].fuelTicks = k === 'sapling' ? 100 : k === 'plank_slab' ? 150 : 300;
}

export const MATERIALS = [
  { key: 'wooden', name: 'Wooden', tier: 0, speed: 2, durability: 59, dmg: 0 },
  { key: 'stone', name: 'Stone', tier: 1, speed: 4, durability: 131, dmg: 1 },
  { key: 'iron', name: 'Iron', tier: 2, speed: 6, durability: 250, dmg: 2 },
  { key: 'golden', name: 'Golden', tier: 0, speed: 12, durability: 32, dmg: 0 },
  { key: 'diamond', name: 'Diamond', tier: 3, speed: 8, durability: 1561, dmg: 3 },
] as const;
export const TOOL_KINDS: readonly ToolKind[] = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
const BASE_DAMAGE: Record<ToolKind, number> = { sword: 4, axe: 3, pickaxe: 2, shovel: 1.5, hoe: 1 };
const KIND_NAME: Record<ToolKind, string> = { pickaxe: 'Pickaxe', axe: 'Axe', shovel: 'Shovel', sword: 'Sword', hoe: 'Hoe' };

MATERIALS.forEach((m, mi) => {
  TOOL_KINDS.forEach((kind, ki) => {
    const id = 300 + mi * 5 + ki;
    item(id, `${m.key}_${kind}`, `${m.name} ${KIND_NAME[kind]}`, {
      maxStack: 1,
      icon: `${m.key}_${kind}`,
      tool: { kind, tier: m.tier, speed: m.speed, durability: m.durability, damage: BASE_DAMAGE[kind] + m.dmg },
      fuelTicks: m.key === 'wooden' ? 200 : undefined,
    });
  });
});

// Armor: leather, golden, iron, diamond x helmet, chestplate, leggings, boots.
export const ARMOR_MATERIALS = [
  { key: 'leather', name: 'Leather', points: [1, 3, 2, 1], mul: 5 },
  { key: 'golden', name: 'Golden', points: [2, 5, 3, 1], mul: 7 },
  { key: 'iron', name: 'Iron', points: [2, 6, 5, 2], mul: 15 },
  { key: 'diamond', name: 'Diamond', points: [3, 8, 6, 3], mul: 33 },
] as const;
export const ARMOR_PIECES = [
  { key: 'helmet', name: 'Helmet', base: 11 },
  { key: 'chestplate', name: 'Chestplate', base: 16 },
  { key: 'leggings', name: 'Leggings', base: 15 },
  { key: 'boots', name: 'Boots', base: 13 },
] as const;
ARMOR_MATERIALS.forEach((m, mi) => ARMOR_PIECES.forEach((pc, pi) => {
  item(350 + mi * 4 + pi, `${m.key}_${pc.key}`, `${m.name} ${pc.name}`, {
    maxStack: 1, icon: `${m.key}_${pc.key}`,
    armor: { slot: pi as 0 | 1 | 2 | 3, points: m.points[pi], durability: pc.base * m.mul },
  });
}));

export const ITEMS: readonly ItemDef[] = items;

export function itemDef(id: number): ItemDef | undefined {
  return items[id];
}

export function allItemIds(): number[] {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) if (items[i]) out.push(i);
  return out;
}

/** Items shown in the creative inventory (skips technical blocks). */
export function creativeItems(): number[] {
  const hidden = new Set([B.furnace_lit, B.lamp_on, B.farmland, B.wheat, B.carrots, B.water, B.lava, B.bedrock, B.portal, B.fire, B.wire, B.seagrass, B.kelp]);
  return allItemIds().filter((id) => !hidden.has(id));
}

export type CreativeTab = 'all' | 'building' | 'nature' | 'decor' | 'power' | 'tools' | 'food' | 'misc';

const NATURE = /ore|^stone$|dirt|grass|sand(?!stone)|gravel|log|leaves|sapling|snow|^ice|packed_ice|clay|cactus|flower|dandelion|poppy|cornflower|tulip|mushroom|kelp|moss|vine|fern|bush|cane|bamboo|pumpkin|melon|lily|cattail|deepstone|granite|limestone|chalk|basalt|obsidian|dripstone|glowmoss|mud|ashsand|cinderstone|magma|emberquartz_ore|geode|crystal|berry|bedrock|mycel|coral|sponge/;
const POWER = /lever|button|pressure|lamp|tnt|wire|spark|rail|piston|repeater|hopper|sensor|observer|minecart|comparator/;
const DECOR = /torch|lantern|carpet|wool|bed|door|trapdoor|fence|gate|ladder|sign|bookshelf|chest|furnace|crafting|table|bell|pane|bars|pot|cake|painting|banner|glowstone|beehive|hive|brewing|anvil|barrel/;

/** Which creative-inventory tab an item belongs to. */
export function creativeCategory(id: number): CreativeTab {
  const d = items[id];
  if (!d) return 'misc';
  const k = d.key;
  if (POWER.test(k)) return 'power';
  if (id < 256) return NATURE.test(k) ? 'nature' : DECOR.test(k) ? 'decor' : 'building';
  if (d.tool || d.armor || d.use === 'bow' || d.use === 'rod' || d.use === 'shears' || d.use === 'ignite' || /arrow|shield|crossbow|bolt/.test(k)) return 'tools';
  if (d.food || /seed|wheat|carrot|egg|sugar|milk|honey|bone_meal|potato|beet/.test(k)) return 'food';
  return 'misc';
}

export interface ItemStack {
  id: number;
  count: number;
  /** Durability used up, for tools and armor. */
  damage?: number;
  ench?: Enchant[];
}

export function enchLevel(s: ItemStack | null | undefined, id: EnchantId): number {
  return s?.ench?.find((e) => e.id === id)?.level ?? 0;
}

export function maxDurability(id: number): number {
  const d = items[id];
  return d?.tool?.durability ?? d?.armor?.durability ?? 0;
}

export function stackOf(id: number, count = 1): ItemStack {
  return { id, count };
}

export function maxStack(id: number): number {
  return items[id]?.maxStack ?? 64;
}
