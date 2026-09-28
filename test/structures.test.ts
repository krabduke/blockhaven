import { describe, expect, it } from 'vitest';
import { B } from '../src/blocks';
import { CS } from '../src/world/chunk';
import { EmberGen } from '../src/world/embergen';
import { HollowGen } from '../src/world/hollowgen';
import { STRUCTURES, STRUCTURE_KINDS, type Dim, type StructureKind } from '../src/world/structure-kinds';
import { nearestStructure, structureByName } from '../src/world/structures';
import { chestMeta, lootTableOf } from '../src/world/builder';
import { WorldGen } from '../src/world/worldgen';

const SEED = 12345;
/** These only sometimes carry a chest (an igloo without a basement, a bridge without a cache). */
const OPTIONAL_CHEST = new Set<StructureKind>(['well', 'igloo', 'bridge']);
const gens = { overworld: new WorldGen(SEED), ember: new EmberGen(SEED), hollow: new HollowGen(SEED) };

/** Generate the chunks under a structure and count what it put there. */
function survey(dim: Dim, kind: StructureKind) {
  const s = nearestStructure(gens[dim], kind, 0, 0, 24);
  if (!s) return null;
  const counts = new Map<number, number>();
  let spawns = 0;
  const { x0, z0, x1, z1 } = s.bounds;
  for (let cz = Math.floor(z0 / CS); cz <= Math.floor(z1 / CS); cz++) for (let cx = Math.floor(x0 / CS); cx <= Math.floor(x1 / CS); cx++) {
    const r = gens[dim].generate(cx, cz);
    spawns += r.spawns.length;
    for (let i = 0; i < r.blocks.length; i++) counts.set(r.blocks[i], (counts.get(r.blocks[i]) ?? 0) + 1);
  }
  return { s, counts, spawns };
}

describe('structures', () => {
  it('has at least 8 kinds (4 big) in every dimension, and 12+ in the overworld', () => {
    for (const dim of ['overworld', 'ember', 'hollow'] as Dim[]) {
      const kinds = STRUCTURE_KINDS.filter((k) => STRUCTURES[k].dim === dim);
      // Villages, dungeons, ruined keeps and watchtowers are built elsewhere and add one each.
      expect(kinds.length + 1).toBeGreaterThanOrEqual(dim === 'overworld' ? 12 : 8);
      expect(kinds.filter((k) => STRUCTURES[k].big).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('packs loot tables up to 31 into chest metadata and back', () => {
    for (let t = 0; t < 32; t++) for (let f = 0; f < 4; f++) {
      const m = chestMeta(f, t);
      expect(lootTableOf(m)).toBe(t);
      expect(m & 3).toBe(f);
      expect(m & 16).toBe(16);
      expect(m).toBeLessThan(256);
    }
    // Chests saved before the wider encoding still read the same.
    expect(lootTableOf(1 | 16 | (6 << 5))).toBe(6);
  });

  it('finds structures by name', () => {
    expect(structureByName('frost keep')).toBe('frostkeep');
    expect(structureByName('Cinder_Bastion')).toBe('bastion');
    expect(structureByName('observatory')).toBe('observatory');
    expect(structureByName('nonsense')).toBeNull();
  });

  for (const kind of STRUCTURE_KINDS) {
    const info = STRUCTURES[kind];
    it(`generates a ${info.name} (${info.dim})`, () => {
      const found = survey(info.dim, kind);
      expect(found, `no ${kind} within reach`).not.toBeNull();
      const { counts } = found!;
      if (info.loot >= 0 && !OPTIONAL_CHEST.has(kind)) expect(counts.get(B.chest) ?? 0, `${kind} has no chest`).toBeGreaterThan(0);
    }, 30000);
  }
});
