// Block registry. Every block is a row in one table; the renderer, physics,
// lighting, mining and world generation all read from it.

export type RenderShape = 'none' | 'cube' | 'cross' | 'liquid' | 'torch' | 'door' | 'bed' | 'cactus' | 'ladder' | 'slabBottom' | 'stairs' | 'fence' | 'gate' | 'table';
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
  /** Tile used for the item icon when it differs from a cube render. */
  icon?: string;
}

const defs: BlockDef[] = [];
export const B: Record<string, number> = {};

interface Opts {
  tiles?: string | { top?: string; bottom?: string; side?: string; front?: string };
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
def(27, 'torch', 'Torch', { shape: 'torch', layer: 'cutout', solid: false, opaque: false, emit: 14, hardness: 0, sound: 'wood', needsSupport: true, tiles: 'torch' });
def(28, 'tall_grass', 'Tall Grass', { ...plant, tiles: 'tall_grass', replaceable: true, drop: (r) => r < 0.125 ? [277 /* seeds */, 1] : null });
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
  return id === B.leaves || id === B.birch_leaves || id === B.spruce_leaves;
}
export function isStairs(id: number): boolean {
  return BLOCKS[id].shape === 'stairs';
}
/** Fences and walls connect to these. */
export function connectsFence(id: number): boolean {
  const d = BLOCKS[id];
  return d.shape === 'fence' || d.shape === 'gate' || (d.shape === 'cube' && d.solid && d.layer !== 'cutout');
}
export function isLog(id: number): boolean {
  return id === B.log || id === B.birch_log || id === B.spruce_log;
}
