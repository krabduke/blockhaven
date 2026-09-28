// The catalogue of structures found in the wild, in every dimension: what each is called, where
// it's found, whether it's one of the big landmarks, and which loot table its chests use.
// Placement and building live in structures.ts and the per-dimension files beside it.

export type Dim = 'overworld' | 'ember' | 'hollow';

export interface StructureInfo {
  name: string;
  dim: Dim;
  big: boolean;
  /** Loot table for its chests (see LOOT in world.ts), or -1 when it has none of its own. */
  loot: number;
}

const info = (name: string, dim: Dim, big: boolean, loot: number): StructureInfo => ({ name, dim, big, loot });

/** Loot tables, by number (chest metadata carries the number). */
export const LOOT = {
  dungeon: 0, temple: 1, shipwreck: 2, mine: 3, sanctum: 4, hollowRuin: 5, treasure: 6,
  outpost: 7, manor: 8, citadel: 9, ziggurat: 10, frostkeep: 11, vault: 12, witchhut: 13, igloo: 14, camp: 15, oceanruin: 16,
  bastion: 17, forge: 18, emberTreasury: 19, emberCache: 20,
  spires: 21, observatory: 22, garden: 23, starforge: 24, hollowCache: 25,
} as const;

export const STRUCTURES = {
  // ---- The overworld: big landmarks ----
  temple: info('Sun Temple', 'overworld', true, LOOT.temple),
  mine: info('Abandoned Mine', 'overworld', true, LOOT.mine),
  sanctum: info('Sanctum', 'overworld', true, LOOT.sanctum),
  outpost: info('Raider Outpost', 'overworld', true, LOOT.outpost),
  manor: info('Thornwood Manor', 'overworld', true, LOOT.manor),
  citadel: info('Tidewatch Citadel', 'overworld', true, LOOT.citadel),
  ziggurat: info('Vinecrown Ziggurat', 'overworld', true, LOOT.ziggurat),
  frostkeep: info('Frost Keep', 'overworld', true, LOOT.frostkeep),
  vault: info('Echo Vault', 'overworld', true, LOOT.vault),
  // ---- The overworld: smaller finds ----
  shipwreck: info('Shipwreck', 'overworld', false, LOOT.shipwreck),
  treasure: info('Buried Treasure', 'overworld', false, LOOT.treasure),
  witchhut: info('Witch Hut', 'overworld', false, LOOT.witchhut),
  igloo: info('Igloo', 'overworld', false, LOOT.igloo),
  well: info('Desert Well', 'overworld', false, LOOT.temple),
  ruinedgate: info('Ruined Ember Gate', 'overworld', false, LOOT.emberCache),
  fossil: info('Fossil', 'overworld', false, -1),
  oceanruin: info('Ocean Ruin', 'overworld', false, LOOT.oceanruin),
  campsite: info("Traveller's Camp", 'overworld', false, LOOT.camp),
  stones: info('Standing Stones', 'overworld', false, LOOT.camp),
  cabin: info("Hunter's Cabin", 'overworld', false, LOOT.camp),
  // ---- The Emberdeep ----
  bastion: info('Cinder Bastion', 'ember', true, LOOT.bastion),
  forge: info('Great Forge', 'ember', true, LOOT.forge),
  spire: info('Ashen Spire', 'ember', true, LOOT.emberTreasury),
  cathedral: info('Ember Cathedral', 'ember', true, LOOT.emberTreasury),
  shrine: info('Ember Shrine', 'ember', false, LOOT.emberCache),
  monoliths: info('Basalt Monoliths', 'ember', false, LOOT.emberCache),
  ashcamp: info('Ash Camp', 'ember', false, LOOT.emberCache),
  lavawell: info('Lava Well', 'ember', false, LOOT.emberCache),
  cage: info('Hanging Cage', 'ember', false, LOOT.emberCache),
  // ---- The Hollow ----
  spires: info('Astral Spires', 'hollow', true, LOOT.spires),
  observatory: info('Floating Observatory', 'hollow', true, LOOT.observatory),
  garden: info('Sky Garden', 'hollow', true, LOOT.garden),
  starforge: info('Star Forge', 'hollow', true, LOOT.starforge),
  crystalshrine: info('Crystal Shrine', 'hollow', false, LOOT.hollowCache),
  bridge: info('Broken Bridge', 'hollow', false, LOOT.hollowCache),
  crater: info('Meteor Crater', 'hollow', false, LOOT.hollowCache),
  waystones: info('Lantern Waystones', 'hollow', false, LOOT.hollowCache),
  statue: info('Fallen Statue', 'hollow', false, LOOT.hollowCache),
} satisfies Record<string, StructureInfo>;

export type StructureKind = keyof typeof STRUCTURES;
export const STRUCTURE_KINDS = Object.keys(STRUCTURES) as StructureKind[];

/**
 * Structures built by their own systems rather than the catalogue's placement: they're still
 * counted (and listed in the README), but /locate finds them elsewhere or not at all.
 */
export const OTHER_STRUCTURES: { name: string; dim: Dim; big: boolean }[] = [
  { name: 'Village', dim: 'overworld', big: true },
  { name: 'Dungeon', dim: 'overworld', big: false },
  { name: 'Ruined Keep', dim: 'ember', big: false },
  { name: 'Watchtower Ruin', dim: 'hollow', big: false },
];

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Tunnel extends Rect { axis: 'x' | 'z' }
export interface Structure {
  kind: StructureKind;
  x: number; y: number; z: number;
  rot: number;
  seed: number;
  bounds: Rect;
  /** The natural ground block where it stands (for levelling its yard). */
  ground?: number;
  /** A per-structure variation (tower heights, sizes). */
  variant?: number;
  tunnels?: Tunnel[];
  /** Mine dead ends: [x, z, direction the tunnel ran]. */
  ends?: [number, number, number][];
}

export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.z0 - pad <= b.z1 && a.z1 + pad >= b.z0;
}

export function square(x: number, z: number, r: number): Rect {
  return { x0: x - r, z0: z - r, x1: x + r, z1: z + r };
}
