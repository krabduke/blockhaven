// Block registry. Every block is a row in one table; the renderer, physics,
// lighting, mining and world generation all read from it.

export type RenderShape = 'none' | 'cube' | 'cross' | 'liquid' | 'torch' | 'door' | 'bed' | 'cactus' | 'ladder' | 'slabBottom' | 'stairs' | 'fence' | 'gate' | 'table'
  | 'pane' | 'trapdoor' | 'lantern' | 'wire' | 'button' | 'plate' | 'sign' | 'flat' | 'vine' | 'cake' | 'carpet' | 'portal' | 'fire' | 'layer' | 'frame' | 'astralpool' | 'comparator' | 'anvil' | 'campfire' | 'composter' | 'itemframe' | 'pot'
  | 'banner' | 'painting' | 'rail' | 'repeater' | 'piston' | 'piston_head' | 'hopper' | 'facing6';
export type Layer = 'opaque' | 'cutout' | 'translucent';
export type Tool = 'pickaxe' | 'axe' | 'shovel' | 'sword' | null;
export type SoundKind = 'stone' | 'wood' | 'gravel' | 'grass' | 'sand' | 'glass' | 'wool' | 'snow' | 'none';

export interface BlockDef {
  id: number;
  key: string;
  name: string;
  /** Texture tile names: [+x, -x, +y, -y, +z, -z]. */
  tiles: [string, string, string, string, string, string];
  shape: RenderShape;
  layer: Layer;
  solid: boolean;
  /** Fully occludes neighbours' faces and blocks light. */
  opaque: boolean;
  /** Extra light lost when passing through (0 for air/glass, 15 for opaque). */
  lightOpacity: number;
  emit: number;
  hardness: number;
  tool: Tool;
  /** Minimum tool tier needed to get a drop (-1 = any/hand). 0 wood, 1 stone, 2 iron, 3 diamond. */
  harvestTier: number;
  /** What breaking it gives (item id, count), or null for nothing. */
  drop: ((rand: number) => [number, number] | null) | null;
  replaceable: boolean;
  sound: SoundKind;
  /** Plants and torches need a solid block below. */
  needsSupport: boolean;
  fluid: boolean;
  climbable: boolean;
  flammable: boolean;
  /** Movement multiplier while inside (cobweb) or standing on (ashsand). 1 = normal. */
  slow: number;
  /** Underwater plants: the cell also counts as water. */
  waterlogged: boolean;
  /** Tile used for the item icon when it differs from a cube render. */
  icon?: string;
  /** Blocks whose look comes from their metadata (colours, artworks): one tile per value. */
  metaTiles?: string[];
  /** Which bits of the metadata pick from metaTiles: (meta >> metaShift) & 15. */
  metaShift?: number;
}

const defs: BlockDef[] = [];

/** The sixteen dye colours, in the order used for block metadata. */
export const DYE_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'] as const;
export type DyeColor = (typeof DYE_COLORS)[number];
export const COLOR_NAMES: Record<DyeColor, string> = {
  white: 'White', orange: 'Orange', magenta: 'Magenta', light_blue: 'Light Blue', yellow: 'Yellow', lime: 'Lime', pink: 'Pink', gray: 'Gray',
  light_gray: 'Light Gray', cyan: 'Cyan', purple: 'Purple', blue: 'Blue', brown: 'Brown', green: 'Green', red: 'Red', black: 'Black',
};
export const COLOR_HEX: Record<DyeColor, string> = {
  white: '#e9e9e4', orange: '#e8781f', magenta: '#b848b0', light_blue: '#6aa8e0', yellow: '#e8c830', lime: '#7ac83a', pink: '#e890a8', gray: '#4a4a50',
  light_gray: '#9a9a98', cyan: '#2a8a90', purple: '#7a3ab0', blue: '#3a4ab0', brown: '#6a4428', green: '#4a8a2a', red: '#b8302a', black: '#262228',
};
/** Wool block key for each colour (white wool is plain 'wool'). */
export const WOOL_KEY: Record<DyeColor, string> = Object.fromEntries(DYE_COLORS.map((c) => [c, c === 'white' ? 'wool' : 'wool_' + c])) as Record<DyeColor, string>;
const WOOL_TILE = WOOL_KEY;
export const B: Record<string, number> = {};

interface Opts {
  tiles?: string | { top?: string; bottom?: string; side?: string; front?: string };
  metaTiles?: string[];
  metaShift?: number;
  shape?: RenderShape;
  layer?: Layer;
  solid?: boolean;
  opaque?: boolean;
  lightOpacity?: number;
  emit?: number;
  hardness?: number;
  tool?: Tool;
  harvestTier?: number;
  drop?: BlockDef['drop'] | 'self' | 'none';
  replaceable?: boolean;
  sound?: SoundKind;
  needsSupport?: boolean;
  fluid?: boolean;
  climbable?: boolean;
  icon?: string;
  flammable?: boolean;
  slow?: number;
  waterlogged?: boolean;
}

function def(id: number, key: string, name: string, o: Opts = {}): void {
  const shape = o.shape ?? 'cube';
  let tiles: BlockDef['tiles'];
  if (typeof o.tiles === 'object') {
    const side = o.tiles.side ?? key;
    const top = o.tiles.top ?? side;
    const bottom = o.tiles.bottom ?? top;
    // +z is treated as the "front" face for directional blocks.
    tiles = [side, side, top, bottom, o.tiles.front ?? side, side];
  } else {
    const t = o.tiles ?? key;
    tiles = [t, t, t, t, t, t];
  }
  const opaque = o.opaque ?? (shape === 'cube');
  const d: BlockDef = {
    id, key, name, tiles, shape,
    layer: o.layer ?? 'opaque',
    solid: o.solid ?? true,
    opaque,
    lightOpacity: o.lightOpacity ?? (opaque ? 15 : 0),
    emit: o.emit ?? 0,
    hardness: o.hardness ?? 1,
    tool: o.tool ?? null,
    harvestTier: o.harvestTier ?? -1,
    drop: o.drop === 'none' ? null : o.drop === 'self' || o.drop === undefined ? () => [id, 1] : o.drop,
    replaceable: o.replaceable ?? false,
    sound: o.sound ?? 'stone',
    needsSupport: o.needsSupport ?? false,
    fluid: o.fluid ?? false,
    climbable: o.climbable ?? false,
    icon: o.icon,
    flammable: o.flammable ?? (o.sound === 'wood' || o.sound === 'wool' || o.sound === 'grass'),
    slow: o.slow ?? 1,
    waterlogged: o.waterlogged ?? false,
    metaTiles: o.metaTiles,
    metaShift: o.metaShift,
  };
  defs[id] = d;
  B[key] = id;
}

const plant: Opts = { shape: 'cross', layer: 'cutout', solid: false, opaque: false, hardness: 0, replaceable: false, sound: 'grass', needsSupport: true };

def(0, 'air', 'Air', { shape: 'none', solid: false, opaque: false, hardness: 0, drop: 'none', replaceable: true, sound: 'none' });
def(1, 'stone', 'Stone', { hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: () => [B.cobblestone, 1] });
def(2, 'grass', 'Grass Block', { tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', sound: 'grass', drop: () => [B.dirt, 1] });
def(3, 'dirt', 'Dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
def(4, 'cobblestone', 'Cobblestone', { hardness: 2, tool: 'pickaxe', harvestTier: 0 });
def(5, 'planks', 'Oak Planks', { hardness: 2, tool: 'axe', sound: 'wood' });
def(6, 'bedrock', 'Bedrock', { hardness: -1, drop: 'none' });
def(7, 'sand', 'Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand' });
def(8, 'gravel', 'Gravel', { hardness: 0.6, tool: 'shovel', sound: 'gravel', drop: (r) => [r < 0.1 ? 272 /* flint */ : B.gravel, 1] });
def(9, 'log', 'Oak Log', { tiles: { top: 'log_top', side: 'log_side' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(10, 'leaves', 'Oak Leaves', { layer: 'cutout', opaque: false, lightOpacity: 1, hardness: 0.2, sound: 'grass', drop: (r) => r < 0.05 ? [B.sapling, 1] : r < 0.06 ? [262 /* apple */, 1] : r < 0.08 ? [256 /* stick */, 1] : null });
def(11, 'glass', 'Glass', { layer: 'cutout', opaque: false, hardness: 0.3, sound: 'glass', drop: 'none' });
def(12, 'water', 'Water', { shape: 'liquid', layer: 'translucent', solid: false, opaque: false, lightOpacity: 2, hardness: -1, drop: 'none', replaceable: true, fluid: true, sound: 'none', tiles: 'water' });
def(13, 'lava', 'Lava', { shape: 'liquid', layer: 'opaque', solid: false, opaque: false, lightOpacity: 0, emit: 15, hardness: -1, drop: 'none', replaceable: true, fluid: true, sound: 'none', tiles: 'lava' });
def(14, 'coal_ore', 'Coal Ore', { hardness: 3, tool: 'pickaxe', harvestTier: 0, drop: () => [257, 1] });
def(15, 'iron_ore', 'Iron Ore', { hardness: 3, tool: 'pickaxe', harvestTier: 1 });
def(16, 'gold_ore', 'Gold Ore', { hardness: 3, tool: 'pickaxe', harvestTier: 2 });
def(17, 'diamond_ore', 'Diamond Ore', { hardness: 3, tool: 'pickaxe', harvestTier: 2, drop: () => [260, 1] });
def(18, 'snowy_grass', 'Snowy Grass Block', { tiles: { top: 'snow', bottom: 'dirt', side: 'snowy_grass_side' }, hardness: 0.6, tool: 'shovel', sound: 'snow', drop: () => [B.dirt, 1] });
def(19, 'snow', 'Snow Block', { hardness: 0.2, tool: 'shovel', sound: 'snow', drop: () => [287 /* snowball */, 4] });
def(20, 'ice', 'Ice', { layer: 'translucent', opaque: false, lightOpacity: 2, hardness: 0.5, tool: 'pickaxe', sound: 'glass', drop: 'none' });
def(21, 'cactus', 'Cactus', { shape: 'cactus', layer: 'cutout', opaque: false, tiles: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, hardness: 0.4, sound: 'wool', needsSupport: true });
def(22, 'sandstone', 'Sandstone', { tiles: { top: 'sandstone_top', side: 'sandstone' }, hardness: 0.8, tool: 'pickaxe', harvestTier: 0 });
def(23, 'clay', 'Clay', { hardness: 0.6, tool: 'shovel', sound: 'gravel' });
def(24, 'crafting_table', 'Crafting Table', { tiles: { top: 'crafting_top', bottom: 'planks', side: 'crafting_side', front: 'crafting_front' }, hardness: 2.5, tool: 'axe', sound: 'wood' });
def(25, 'furnace', 'Furnace', { tiles: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, hardness: 3.5, tool: 'pickaxe', harvestTier: 0 });
def(26, 'furnace_lit', 'Furnace', { tiles: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit' }, emit: 13, hardness: 3.5, tool: 'pickaxe', harvestTier: 0, drop: () => [B.furnace, 1] });
def(27, 'torch', 'Torch', { shape: 'torch', layer: 'cutout', solid: false, opaque: false, emit: 14, hardness: 0, sound: 'wood', needsSupport: true, tiles: 'torch', flammable: false });
def(28, 'tall_grass', 'Tall Grass', { ...plant, tiles: 'tall_grass', replaceable: true, drop: (r) => r < 0.125 ? [277 /* seeds */, 1] : r < 0.15 ? [507 /* redroot seeds */, 1] : null });
def(29, 'poppy', 'Red Flower', { ...plant, tiles: 'poppy' });
def(30, 'dandelion', 'Yellow Flower', { ...plant, tiles: 'dandelion' });
def(31, 'obsidian', 'Obsidian', { hardness: 50, tool: 'pickaxe', harvestTier: 3 });
def(32, 'bricks', 'Bricks', { hardness: 2, tool: 'pickaxe', harvestTier: 0 });
def(33, 'glowstone', 'Glowstone', { layer: 'opaque', emit: 15, hardness: 0.3, sound: 'glass', drop: (r) => [295 /* glow dust */, 2 + Math.floor(r * 3)] });
def(34, 'wool', 'White Wool', { hardness: 0.8, sound: 'wool' });
def(35, 'chest', 'Chest', { tiles: { top: 'chest_top', side: 'chest_side', front: 'chest_front' }, opaque: false, lightOpacity: 0, hardness: 2.5, tool: 'axe', sound: 'wood' });
def(36, 'door', 'Oak Door', { shape: 'door', layer: 'cutout', opaque: false, hardness: 3, tool: 'axe', sound: 'wood', tiles: 'door_bottom', icon: 'door_item', needsSupport: true });
def(37, 'bed', 'Bed', { shape: 'bed', layer: 'cutout', opaque: false, hardness: 0.2, sound: 'wool', tiles: { top: 'bed_top', side: 'bed_side', bottom: 'planks' }, icon: 'bed_item', needsSupport: true });
def(38, 'birch_log', 'Birch Log', { tiles: { top: 'birch_log_top', side: 'birch_log_side' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(39, 'birch_leaves', 'Birch Leaves', { layer: 'cutout', opaque: false, lightOpacity: 1, hardness: 0.2, sound: 'grass', drop: (r) => r < 0.05 ? [B.sapling, 1] : null });
def(40, 'spruce_log', 'Spruce Log', { tiles: { top: 'spruce_log_top', side: 'spruce_log_side' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(41, 'spruce_leaves', 'Spruce Leaves', { layer: 'cutout', opaque: false, lightOpacity: 1, hardness: 0.2, sound: 'grass', drop: (r) => r < 0.05 ? [B.sapling, 1] : null });
def(42, 'mossy_cobblestone', 'Mossy Cobblestone', { hardness: 2, tool: 'pickaxe', harvestTier: 0 });
def(43, 'bookshelf', 'Bookshelf', { tiles: { top: 'planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood', drop: () => [B.planks, 3] });
def(44, 'dead_bush', 'Dead Bush', { ...plant, tiles: 'dead_bush', replaceable: true, drop: () => [256 /* stick */, 1] });
def(45, 'iron_block', 'Block of Iron', { hardness: 5, tool: 'pickaxe', harvestTier: 1 });
def(46, 'gold_block', 'Block of Gold', { hardness: 3, tool: 'pickaxe', harvestTier: 2 });
def(47, 'diamond_block', 'Block of Diamond', { hardness: 5, tool: 'pickaxe', harvestTier: 2 });
def(48, 'stone_bricks', 'Stone Bricks', { hardness: 1.5, tool: 'pickaxe', harvestTier: 0 });
def(49, 'ladder', 'Ladder', { shape: 'ladder', layer: 'cutout', solid: false, opaque: false, hardness: 0.4, tool: 'axe', sound: 'wood', climbable: true, tiles: 'ladder' });
def(50, 'sapling', 'Oak Sapling', { ...plant, tiles: 'sapling' });
def(51, 'wheat', 'Wheat Crops', { ...plant, tiles: 'wheat_7', drop: 'none' });
def(52, 'farmland', 'Farmland', { tiles: { top: 'farmland', side: 'dirt', bottom: 'dirt' }, opaque: false, lightOpacity: 15, hardness: 0.6, tool: 'shovel', sound: 'gravel', drop: () => [B.dirt, 1] });
def(53, 'cobble_slab', 'Cobblestone Slab', { shape: 'slabBottom', opaque: false, lightOpacity: 0, tiles: 'cobblestone', hardness: 2, tool: 'pickaxe', harvestTier: 0 });
def(54, 'plank_slab', 'Oak Slab', { shape: 'slabBottom', opaque: false, lightOpacity: 0, tiles: 'planks', hardness: 2, tool: 'axe', sound: 'wood' });
def(55, 'tnt', 'TNT', { tiles: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, sound: 'grass' });
def(56, 'pumpkin', 'Pumpkin', { tiles: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_side' }, hardness: 1, tool: 'axe', sound: 'wood' });
def(57, 'lamp', 'Lamp', { tiles: 'lamp_off', hardness: 0.3, sound: 'glass' });
def(58, 'lamp_on', 'Lamp', { tiles: 'lamp_on', emit: 15, hardness: 0.3, sound: 'glass', drop: () => [B.lamp, 1] });
def(59, 'lever', 'Lever', { shape: 'torch', layer: 'cutout', solid: false, opaque: false, hardness: 0.5, sound: 'wood', needsSupport: true, tiles: 'lever' });
def(60, 'sugar_cane', 'Sugar Cane', { ...plant, tiles: 'sugar_cane' });
def(61, 'oak_stairs', 'Oak Stairs', { shape: 'stairs', opaque: false, lightOpacity: 0, tiles: 'planks', hardness: 2, tool: 'axe', sound: 'wood' });
def(62, 'cobble_stairs', 'Cobblestone Stairs', { shape: 'stairs', opaque: false, lightOpacity: 0, tiles: 'cobblestone', hardness: 2, tool: 'pickaxe', harvestTier: 0 });
def(63, 'fence', 'Oak Fence', { shape: 'fence', layer: 'cutout', opaque: false, tiles: 'planks', hardness: 2, tool: 'axe', sound: 'wood', icon: 'fence_item' });
def(64, 'fence_gate', 'Oak Fence Gate', { shape: 'gate', layer: 'cutout', opaque: false, tiles: 'planks', hardness: 2, tool: 'axe', sound: 'wood', icon: 'gate_item' });
def(65, 'spawner', 'Monster Cage', { layer: 'cutout', opaque: false, lightOpacity: 1, tiles: 'spawner', hardness: 5, tool: 'pickaxe', harvestTier: 0, drop: 'none' });
def(66, 'enchanting_table', 'Enchanting Table', { shape: 'table', opaque: false, lightOpacity: 0, emit: 7, tiles: { top: 'enchant_top', side: 'enchant_side', bottom: 'obsidian' }, hardness: 5, tool: 'pickaxe', harvestTier: 0 });
def(67, 'stone_brick_stairs', 'Stone Brick Stairs', { shape: 'stairs', opaque: false, lightOpacity: 0, tiles: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', harvestTier: 0 });
def(68, 'carrots', 'Carrots', { ...plant, tiles: 'carrots_3', drop: 'none' });

// ---- The Emberdeep ----
def(69, 'portal', 'Ember Gate', { shape: 'portal', layer: 'translucent', solid: false, opaque: false, emit: 11, hardness: -1, drop: 'none', tiles: 'portal', sound: 'glass', flammable: false });
def(70, 'fire', 'Fire', { shape: 'fire', layer: 'cutout', solid: false, opaque: false, emit: 15, hardness: 0, drop: 'none', replaceable: true, tiles: 'fire', sound: 'none', flammable: false });
def(71, 'cinderstone', 'Cinderstone', { hardness: 0.4, tool: 'pickaxe', harvestTier: 0 });
def(72, 'ashsand', 'Ashsand', { hardness: 0.5, tool: 'shovel', sound: 'sand', slow: 0.4 });
def(73, 'emberquartz_ore', 'Emberquartz Ore', { hardness: 3, tool: 'pickaxe', harvestTier: 0, drop: () => [401, 1] });
def(74, 'emberquartz_block', 'Block of Emberquartz', { hardness: 0.8, tool: 'pickaxe', harvestTier: 0 });
def(75, 'cinder_bricks', 'Cinder Bricks', { hardness: 2, tool: 'pickaxe', harvestTier: 0 });
def(76, 'magma', 'Magma Rock', { emit: 3, hardness: 0.5, tool: 'pickaxe', harvestTier: 0 });
def(77, 'ember_cap', 'Ember Cap', { ...plant, tiles: 'ember_cap', emit: 6 });

// ---- Villages and trading ----
def(78, 'amber_ore', 'Amber Ore', { hardness: 3, tool: 'pickaxe', harvestTier: 2, drop: () => [400, 1] });
def(79, 'amber_block', 'Block of Amber', { hardness: 5, tool: 'pickaxe', harvestTier: 2 });
def(80, 'dirt_path', 'Dirt Path', { shape: 'slabBottom', opaque: false, lightOpacity: 0, tiles: { top: 'path_top', side: 'path_side', bottom: 'dirt' }, hardness: 0.65, tool: 'shovel', sound: 'gravel', drop: () => [B.dirt, 1] });
def(81, 'hay_bale', 'Hay Bale', { tiles: { top: 'hay_top', side: 'hay_side' }, hardness: 0.5, sound: 'grass' });
def(82, 'melon', 'Melon', { tiles: { top: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', sound: 'wood', drop: (r) => [412, 3 + Math.floor(r * 5)] });
def(83, 'terracotta', 'Terracotta', { hardness: 1.25, tool: 'pickaxe', harvestTier: 0 });
def(84, 'wool_red', 'Red Wool', { hardness: 0.8, sound: 'wool' });
def(85, 'wool_yellow', 'Yellow Wool', { hardness: 0.8, sound: 'wool' });
def(86, 'wool_green', 'Green Wool', { hardness: 0.8, sound: 'wool' });
def(87, 'wool_blue', 'Blue Wool', { hardness: 0.8, sound: 'wool' });
def(88, 'wool_black', 'Black Wool', { hardness: 0.8, sound: 'wool' });
def(89, 'wool_orange', 'Orange Wool', { hardness: 0.8, sound: 'wool' });
def(90, 'glass_pane', 'Glass Pane', { shape: 'pane', layer: 'cutout', opaque: false, tiles: 'glass', hardness: 0.3, sound: 'glass', drop: 'none', icon: 'glass' });
def(91, 'iron_bars', 'Iron Bars', { shape: 'pane', layer: 'cutout', opaque: false, tiles: 'iron_bars', hardness: 5, tool: 'pickaxe', harvestTier: 0, icon: 'iron_bars' });
def(92, 'trapdoor', 'Oak Trapdoor', { shape: 'trapdoor', layer: 'cutout', opaque: false, tiles: 'trapdoor', hardness: 3, tool: 'axe', sound: 'wood' });
def(93, 'lantern', 'Lantern', { shape: 'lantern', layer: 'cutout', solid: true, opaque: false, emit: 15, tiles: 'lantern', hardness: 3.5, tool: 'pickaxe', harvestTier: 0, icon: 'lantern_item', needsSupport: true });
def(94, 'wire', 'Spark Dust', { shape: 'wire', layer: 'cutout', solid: false, opaque: false, hardness: 0, tiles: 'wire', drop: () => [413, 1], needsSupport: true, sound: 'none', icon: 'spark_dust' });
def(95, 'button', 'Stone Button', { shape: 'button', layer: 'cutout', solid: false, opaque: false, hardness: 0.5, tiles: 'stone', needsSupport: true, icon: 'button_item' });
def(96, 'pressure_plate', 'Pressure Plate', { shape: 'plate', layer: 'cutout', solid: false, opaque: false, hardness: 0.5, tool: 'pickaxe', tiles: 'stone', needsSupport: true, icon: 'plate_item' });
def(97, 'sign', 'Sign', { shape: 'sign', layer: 'cutout', solid: false, opaque: false, hardness: 1, tool: 'axe', sound: 'wood', tiles: 'planks', icon: 'sign_item', needsSupport: true });
def(98, 'lily_pad', 'Lily Pad', { shape: 'flat', layer: 'cutout', solid: true, opaque: false, hardness: 0, tiles: 'lily_pad', sound: 'grass', needsSupport: true });
def(99, 'vine', 'Vines', { shape: 'vine', layer: 'cutout', solid: false, opaque: false, hardness: 0.2, tiles: 'vine', sound: 'grass', climbable: true, replaceable: true, drop: 'none' });
def(100, 'cake', 'Cake', { shape: 'cake', layer: 'cutout', opaque: false, hardness: 0.5, tiles: { top: 'cake_top', side: 'cake_side', bottom: 'cake_bottom' }, sound: 'wool', drop: 'none', icon: 'cake_item', needsSupport: true });
def(101, 'carpet', 'White Carpet', { shape: 'carpet', layer: 'cutout', opaque: false, hardness: 0.1, tiles: 'wool', sound: 'wool', needsSupport: true, metaTiles: DYE_COLORS.map((c) => WOOL_TILE[c]) });
def(102, 'red_mushroom', 'Red Mushroom', { ...plant, tiles: 'red_mushroom' });
def(103, 'brown_mushroom', 'Brown Mushroom', { ...plant, tiles: 'brown_mushroom', emit: 1 });
def(104, 'cobweb', 'Cobweb', { shape: 'cross', layer: 'cutout', solid: false, opaque: false, hardness: 4, tool: 'sword', tiles: 'cobweb', drop: () => [261, 1], slow: 0.25, sound: 'wool' });
def(105, 'slate', 'Slate', { hardness: 1.5, tool: 'pickaxe', harvestTier: 0 });
def(106, 'polished_slate', 'Polished Slate', { hardness: 1.5, tool: 'pickaxe', harvestTier: 0 });
def(107, 'marble', 'Marble', { hardness: 1.5, tool: 'pickaxe', harvestTier: 0 });
def(108, 'polished_marble', 'Polished Marble', { hardness: 1.5, tool: 'pickaxe', harvestTier: 0 });
def(109, 'mossy_stone_bricks', 'Mossy Stone Bricks', { hardness: 1.5, tool: 'pickaxe', harvestTier: 0 });
def(110, 'cracked_stone_bricks', 'Cracked Stone Bricks', { hardness: 1.5, tool: 'pickaxe', harvestTier: 0 });
def(111, 'spark_ore', 'Sparkstone Ore', { hardness: 3, tool: 'pickaxe', harvestTier: 2, emit: 0, drop: (r) => [413, 4 + Math.floor(r * 2)] });
def(112, 'blue_flower', 'Blue Flower', { ...plant, tiles: 'blue_flower' });
def(113, 'sunwood_log', 'Sunwood Log', { tiles: { top: 'sunwood_top', side: 'sunwood_side' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(114, 'sunwood_leaves', 'Sunwood Leaves', { layer: 'cutout', opaque: false, lightOpacity: 1, hardness: 0.2, sound: 'grass', drop: (r) => r < 0.05 ? [B.sapling, 1] : null });
// ---- Natural variety ----
const rock = (extra: Opts = {}): Opts => ({ hardness: 1.5, tool: 'pickaxe', harvestTier: 0, ...extra });
def(116, 'granite', 'Granite', rock());
def(117, 'polished_granite', 'Polished Granite', rock());
def(118, 'limestone', 'Limestone', rock({ hardness: 1.2 }));
def(119, 'basalt', 'Basalt', rock({ tiles: { top: 'basalt_top', side: 'basalt_side' }, hardness: 1.25 }));
def(120, 'deepstone', 'Deepstone', rock({ hardness: 3, drop: () => [121, 1] }));
def(121, 'cobbled_deepstone', 'Cobbled Deepstone', rock({ hardness: 3.5 }));
def(122, 'chalk', 'Chalk', rock({ hardness: 0.75 }));
def(123, 'mud', 'Mud', { hardness: 0.5, tool: 'shovel', sound: 'gravel', slow: 0.8 });
def(124, 'moss_block', 'Moss Block', { hardness: 0.1, tool: 'hoe' as Tool, sound: 'grass' });
def(125, 'coarse_dirt', 'Coarse Dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
def(126, 'loam', 'Forest Floor', { tiles: { top: 'loam_top', side: 'loam_side', bottom: 'dirt' }, hardness: 0.5, tool: 'shovel', sound: 'gravel', drop: () => [B.dirt, 1] });
def(127, 'red_sand', 'Red Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand' });
def(128, 'red_sandstone', 'Red Sandstone', rock({ tiles: { top: 'red_sandstone_top', side: 'red_sandstone' }, hardness: 0.8 }));
def(129, 'terracotta_orange', 'Orange Terracotta', rock({ hardness: 1.25 }));
def(130, 'terracotta_yellow', 'Yellow Terracotta', rock({ hardness: 1.25 }));
def(131, 'terracotta_white', 'White Terracotta', rock({ hardness: 1.25 }));
def(132, 'terracotta_brown', 'Brown Terracotta', rock({ hardness: 1.25 }));
def(133, 'terracotta_red', 'Red Terracotta', rock({ hardness: 1.25 }));
def(134, 'packed_ice', 'Packed Ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', drop: 'none' });
def(135, 'snow_layer', 'Snow', { shape: 'layer', layer: 'cutout', opaque: false, lightOpacity: 0, tiles: 'snow', hardness: 0.1, tool: 'shovel', sound: 'snow', needsSupport: true, replaceable: true, drop: () => [287, 1] });
def(136, 'dripstone', 'Dripstone', rock({ hardness: 1.5 }));
def(137, 'pointed_dripstone', 'Pointed Dripstone', { shape: 'cross', layer: 'cutout', solid: false, opaque: false, tiles: 'pointed_dripstone', hardness: 1.5, tool: 'pickaxe', sound: 'stone' });
def(138, 'glowmoss', 'Glowmoss', { shape: 'cross', layer: 'cutout', solid: false, opaque: false, emit: 10, tiles: 'glowmoss', hardness: 0.2, sound: 'grass', climbable: true });
def(139, 'crystal_block', 'Crystal Block', { emit: 4, hardness: 1.5, tool: 'pickaxe', sound: 'glass', drop: () => [417, 4] });
def(140, 'crystal_cluster', 'Crystal Cluster', { shape: 'cross', layer: 'cutout', solid: false, opaque: false, emit: 6, tiles: 'crystal_cluster', hardness: 1.5, tool: 'pickaxe', sound: 'glass', drop: () => [417, 2] });
def(141, 'fern', 'Fern', { ...plant, tiles: 'fern', replaceable: true, drop: (r) => r < 0.125 ? [277, 1] : null });
def(142, 'bush', 'Bush', { ...plant, tiles: 'bush', replaceable: true, drop: (r) => r < 0.1 ? [256, 1] : null });
def(143, 'berry_bush', 'Berry Bush', { ...plant, tiles: 'berry_bush', drop: (r) => [416, 1 + Math.floor(r * 2)] });
def(144, 'cattail', 'Cattail', { ...plant, tiles: 'cattail' });
def(145, 'seagrass', 'Seagrass', { shape: 'cross', layer: 'cutout', solid: false, opaque: false, lightOpacity: 2, tiles: 'seagrass', hardness: 0, sound: 'grass', waterlogged: true, drop: 'none' });
def(146, 'kelp', 'Kelp', { shape: 'cross', layer: 'cutout', solid: false, opaque: false, lightOpacity: 2, tiles: 'kelp', hardness: 0, sound: 'grass', waterlogged: true });
def(147, 'blossom_log', 'Blossom Log', { tiles: { top: 'blossom_log_top', side: 'blossom_log_side' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(148, 'blossom_leaves', 'Blossom Leaves', { layer: 'cutout', opaque: false, lightOpacity: 1, hardness: 0.2, sound: 'grass', drop: (r) => r < 0.05 ? [B.sapling, 1] : null });
def(149, 'jungle_log', 'Jungle Log', { tiles: { top: 'jungle_log_top', side: 'jungle_log_side' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(150, 'jungle_leaves', 'Jungle Leaves', { layer: 'cutout', opaque: false, lightOpacity: 1, hardness: 0.2, sound: 'grass', drop: (r) => r < 0.03 ? [B.sapling, 1] : null });
def(151, 'bamboo', 'Bamboo', { ...plant, tiles: 'bamboo', hardness: 0.5, drop: () => [256, 1] });
def(152, 'dry_grass', 'Dry Grass', { ...plant, tiles: 'dry_grass', replaceable: true, drop: 'none' });
def(153, 'mossy_stone', 'Mossy Stone', rock({ tiles: { top: 'mossy_stone_top', side: 'mossy_stone_side', bottom: 'stone' }, drop: () => [B.cobblestone, 1] }));
def(154, 'white_flower', 'Daisy', { ...plant, tiles: 'white_flower' });
def(155, 'purple_flower', 'Lavender', { ...plant, tiles: 'purple_flower' });
def(156, 'geode_shell', 'Geode Shell', rock({ hardness: 2.5 }));
def(157, 'mud_bricks', 'Mud Bricks', rock({ hardness: 1.5 }));
def(158, 'polished_limestone', 'Polished Limestone', rock({ hardness: 1.2 }));
def(159, 'deepstone_bricks', 'Deepstone Bricks', rock({ hardness: 3.5 }));
// The rest of the sixteen wool colours.
([['magenta', 161], ['light_blue', 162], ['lime', 163], ['pink', 164], ['gray', 165], ['light_gray', 166], ['cyan', 167], ['purple', 168], ['brown', 169]] as const).forEach(([c, id]) => {
  def(id, 'wool_' + c, COLOR_NAMES[c] + ' Wool', { hardness: 0.8, sound: 'wool' });
});
def(170, 'stained_glass', 'White Stained Glass', { layer: 'translucent', opaque: false, lightOpacity: 0, hardness: 0.3, sound: 'glass', drop: 'none', tiles: 'stained_glass_white', metaTiles: DYE_COLORS.map((c) => 'stained_glass_' + c) });
// Banners hang on walls (meta: facing | colour << 2) or stand on the ground (+64).
def(171, 'banner', 'White Banner', { shape: 'banner', layer: 'cutout', solid: false, opaque: false, hardness: 1, tool: 'axe', sound: 'wool', tiles: 'banner_white', icon: 'banner_white', metaTiles: DYE_COLORS.map((c) => 'banner_' + c), metaShift: 2 });
// Paintings hang on walls (meta: facing | artwork << 2).
def(172, 'painting', 'Painting', { shape: 'painting', layer: 'cutout', solid: false, opaque: false, hardness: 0.2, sound: 'wood', tiles: 'painting_0', icon: 'painting_item', metaTiles: Array.from({ length: 16 }, (_, i) => 'painting_' + i), metaShift: 2 });
// Rails: meta is the track shape (see RAIL_EXITS); powered rails add 8 when powered.
def(173, 'rail', 'Rail', { shape: 'rail', layer: 'cutout', solid: false, opaque: false, hardness: 0.7, tool: 'pickaxe', sound: 'stone', needsSupport: true, tiles: 'rail', icon: 'rail', metaTiles: ['rail', 'rail', 'rail', 'rail', 'rail', 'rail', 'rail_curve', 'rail_curve', 'rail_curve', 'rail_curve', 'rail', 'rail', 'rail', 'rail', 'rail', 'rail'] });
def(174, 'powered_rail', 'Powered Rail', { shape: 'rail', layer: 'cutout', solid: false, opaque: false, hardness: 0.7, tool: 'pickaxe', sound: 'stone', needsSupport: true, tiles: 'powered_rail', icon: 'powered_rail', metaTiles: ['powered_rail', 'powered_rail', 'powered_rail', 'powered_rail', 'powered_rail', 'powered_rail', 'powered_rail', 'powered_rail', 'powered_rail_on', 'powered_rail_on', 'powered_rail_on', 'powered_rail_on', 'powered_rail_on', 'powered_rail_on', 'powered_rail_on', 'powered_rail_on'] });
// Power components. Six-way facing (DIR6): 0 down, 1 up, 2 north, 3 south, 4 west, 5 east.
// Repeater meta: facing (0-3 horizontal as for furnaces) | delay-1 << 2 | on << 4.
def(175, 'repeater', 'Repeater', { shape: 'repeater', layer: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'stone', needsSupport: true, tiles: 'repeater', icon: 'repeater_item', metaTiles: ['repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater', 'repeater'] });
// Pistons: facing (DIR6) | extended << 3.
def(176, 'piston', 'Piston', { shape: 'piston', opaque: false, lightOpacity: 15, hardness: 1.5, tool: 'pickaxe', tiles: { top: 'piston_top', side: 'piston_side', bottom: 'piston_bottom' } });
def(177, 'sticky_piston', 'Sticky Piston', { shape: 'piston', opaque: false, lightOpacity: 15, hardness: 1.5, tool: 'pickaxe', tiles: { top: 'piston_top_sticky', side: 'piston_side', bottom: 'piston_bottom' } });
// The moving head: facing | sticky << 3.
def(178, 'piston_head', 'Piston Head', { shape: 'piston_head', opaque: false, lightOpacity: 0, hardness: 1.5, tool: 'pickaxe', drop: 'none', tiles: { top: 'piston_top', side: 'piston_side' } });
// Hopper: output facing (DIR6, never up) | disabled (powered) << 3.
def(179, 'hopper', 'Hopper', { shape: 'hopper', opaque: false, lightOpacity: 0, hardness: 3, tool: 'pickaxe', harvestTier: 0, tiles: { top: 'hopper_top', side: 'hopper_side', bottom: 'hopper_side' }, icon: 'hopper_item' });
// Watcher: facing (DIR6, the face that watches) | pulsing << 3.
def(180, 'watcher', 'Watcher', { shape: 'facing6', hardness: 3, tool: 'pickaxe', harvestTier: 0, tiles: { top: 'watcher_face', side: 'watcher_side', bottom: 'watcher_back' } });
def(181, 'potatoes', 'Potatoes', { ...plant, tiles: 'potatoes_3', drop: 'none' });
def(182, 'redroot', 'Redroot', { ...plant, tiles: 'redroot_3', drop: 'none' });
// Bee nests (in trees) and beehives (crafted): meta is the honey level 0-5.
const hive = (full: string, base: string) => [base, base, base, base, base, full, full, full, full, full, full, full, full, full, full, full];
def(183, 'bee_nest', 'Bee Nest', { hardness: 0.3, tool: 'axe', sound: 'wood', tiles: 'nest_side', metaTiles: hive('nest_honey', 'nest_side') });
def(184, 'beehive', 'Beehive', { hardness: 0.6, tool: 'axe', sound: 'wood', tiles: 'hive_side', metaTiles: hive('hive_honey', 'hive_side') });
// The Astral Gate in a sanctum: twelve frame stones around a 3x3 well. Meta bit 4 = a Starseeker is set in it.
def(185, 'astral_frame', 'Astral Frame', { shape: 'frame', opaque: false, lightOpacity: 0, emit: 3, hardness: -1, drop: 'none', sound: 'stone', tiles: { top: 'astral_frame_top', side: 'astral_frame_side', bottom: 'hollow_bricks' } });
def(186, 'astral_portal', 'Astral Gate', { shape: 'astralpool', layer: 'cutout', solid: false, opaque: false, lightOpacity: 0, emit: 15, hardness: -1, drop: 'none', sound: 'glass', flammable: false, tiles: 'astral_portal' });
// The Hollow: pale islands adrift in a starry void.
def(187, 'hollowstone', 'Hollowstone', { hardness: 3, tool: 'pickaxe', harvestTier: 0, tiles: 'hollowstone' });
def(188, 'hollow_bricks', 'Hollow Bricks', { hardness: 3, tool: 'pickaxe', harvestTier: 0, tiles: 'hollow_bricks' });
def(189, 'anchor_stone', 'Anchor Stone', { emit: 15, hardness: 1, drop: 'none', sound: 'glass', tiles: 'anchor_stone' });
def(190, 'starbloom', 'Starbloom', { ...plant, emit: 7, tiles: 'starbloom' });
// Comparator: meta = facing (bits 0-1) | subtract mode (bit 2) | output level << 3.
def(191, 'comparator', 'Comparator', { shape: 'comparator', layer: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'stone', needsSupport: true, tiles: 'comparator', icon: 'comparator_item' });
def(192, 'anvil', 'Anvil', { shape: 'anvil', opaque: false, lightOpacity: 0, hardness: 5, tool: 'pickaxe', harvestTier: 0, sound: 'stone', tiles: { top: 'anvil_top', side: 'anvil_side', bottom: 'anvil_side' }, icon: 'anvil_item' });
def(193, 'campfire', 'Campfire', { shape: 'campfire', layer: 'cutout', opaque: false, lightOpacity: 0, emit: 15, hardness: 2, tool: 'axe', sound: 'wood', tiles: 'campfire_log', icon: 'campfire_item', drop: () => [257 /* coal */, 2] });
def(194, 'smoker', 'Smoker', { tiles: { top: 'smoker_top', side: 'smoker_side', front: 'smoker_front' }, hardness: 3.5, tool: 'pickaxe', harvestTier: 0 });
def(195, 'smoker_lit', 'Smoker', { tiles: { top: 'smoker_top', side: 'smoker_side', front: 'smoker_front_lit' }, emit: 13, hardness: 3.5, tool: 'pickaxe', harvestTier: 0, drop: () => [194, 1] });
def(196, 'barrel', 'Barrel', { tiles: { top: 'barrel_top', side: 'barrel_side', bottom: 'barrel_bottom' }, hardness: 2.5, tool: 'axe', sound: 'wood' });
// Composter: meta is how full it is (0-7), 8 = ready to empty.
def(197, 'composter', 'Composter', { shape: 'composter', opaque: false, lightOpacity: 0, hardness: 0.6, tool: 'axe', sound: 'wood', tiles: { top: 'composter_top', side: 'composter_side', bottom: 'composter_bottom' }, icon: 'composter_item' });
def(198, 'item_frame', 'Item Frame', { shape: 'itemframe', layer: 'cutout', solid: false, opaque: false, hardness: 0.3, sound: 'wood', needsSupport: true, tiles: 'item_frame', icon: 'item_frame_item' });
// Flower pot: meta picks the plant in it (see POTTED).
def(199, 'flower_pot', 'Flower Pot', { shape: 'pot', layer: 'cutout', opaque: false, lightOpacity: 0, hardness: 0, sound: 'stone', tiles: 'flower_pot', icon: 'flower_pot_item' });
def(160, 'brewing_stand', 'Brewing Stand', { shape: 'table', opaque: false, lightOpacity: 0, emit: 3, tiles: { top: 'brewing_top', side: 'brewing_side', bottom: 'cobblestone' }, hardness: 0.5, tool: 'pickaxe', harvestTier: 0, icon: 'brewing_item' });
def(115, 'bell', 'Village Bell', { shape: 'lantern', layer: 'cutout', opaque: false, hardness: 5, tool: 'pickaxe', tiles: 'bell', icon: 'bell_item', sound: 'stone' });

/** What a flower pot can hold, by meta (0 = empty). */
export const POTTED = [0, B.poppy, B.dandelion, B.blue_flower, B.white_flower, B.purple_flower, B.sapling, B.red_mushroom, B.brown_mushroom, B.fern, B.dead_bush, B.cactus, B.bush, B.starbloom, B.bamboo, B.berry_bush];

/** Spawner meta picks its creature (0 = chosen by position, as in dungeons). */
export const SPAWNER_KINDS = ['', 'zombie', 'skeleton', 'shellcrawler', 'mirewalker', 'brambler', 'cinderbrute', 'emberwisp', 'raider', 'witch', 'frostling', 'dunescuttler'];

// Fill gaps so lookups never return undefined.
for (let i = 0; i < 256; i++) if (!defs[i]) defs[i] = { ...defs[0], id: i, key: 'unknown_' + i };

export const BLOCKS: readonly BlockDef[] = defs;

// Flat lookup tables for hot loops (meshing, lighting, physics).
export const OPAQUE = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const LIGHT_OPACITY = new Uint8Array(256);
export const EMIT = new Uint8Array(256);
export const SHAPE_CUBE = new Uint8Array(256);
for (const d of defs) {
  OPAQUE[d.id] = d.opaque ? 1 : 0;
  SOLID[d.id] = d.solid ? 1 : 0;
  LIGHT_OPACITY[d.id] = d.lightOpacity;
  EMIT[d.id] = d.emit;
  SHAPE_CUBE[d.id] = d.shape === 'cube' ? 1 : 0;
}

export function isLeaves(id: number): boolean {
  return id === B.leaves || id === B.birch_leaves || id === B.spruce_leaves || id === B.sunwood_leaves || id === B.blossom_leaves || id === B.jungle_leaves;
}
/** Water plus underwater plants that sit in water. */
export function isWaterlike(id: number): boolean {
  return id === B.water || BLOCKS[id].waterlogged;
}
export function isStairs(id: number): boolean {
  return BLOCKS[id].shape === 'stairs';
}
/** Fences and walls connect to these. */
export function connectsFence(id: number): boolean {
  const d = BLOCKS[id];
  return d.shape === 'fence' || d.shape === 'gate' || d.shape === 'pane' || (d.shape === 'cube' && d.solid && d.layer !== 'cutout');
}
export function isLog(id: number): boolean {
  return id === B.log || id === B.birch_log || id === B.spruce_log || id === B.sunwood_log || id === B.blossom_log || id === B.jungle_log;
}
export const WOOL_COLORS = ['wool', 'wool_red', 'wool_orange', 'wool_yellow', 'wool_green', 'wool_blue', 'wool_black'] as const;

// ---------- Rails ----------
/** Unit steps north (-z), south (+z), east (+x), west (-x). */
export const RAIL_DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] } as const;
export type RailDir = keyof typeof RAIL_DIRS;
/**
 * The two ends of each track shape, and which end (if any) climbs one block:
 * 0 north-south, 1 east-west, 2-5 slopes rising east/west/north/south, 6-9 curves.
 */
export const RAIL_EXITS: { a: RailDir; b: RailDir; up?: RailDir }[] = [
  { a: 'n', b: 's' }, { a: 'w', b: 'e' },
  { a: 'w', b: 'e', up: 'e' }, { a: 'e', b: 'w', up: 'w' }, { a: 's', b: 'n', up: 'n' }, { a: 'n', b: 's', up: 's' },
  { a: 's', b: 'e' }, { a: 's', b: 'w' }, { a: 'n', b: 'w' }, { a: 'n', b: 'e' },
];
export function isRail(id: number): boolean {
  return id === B.rail || id === B.powered_rail;
}

// ---------- Six-way facing ----------
/** Unit vectors for DIR6 facings: down, up, north, south, west, east. */
export const DIR6: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
/** Mesh face index (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z) for each DIR6 facing. */
export const DIR6_FACE = [3, 2, 5, 4, 1, 0];
export function isPiston(id: number): boolean {
  return id === B.piston || id === B.sticky_piston;
}
