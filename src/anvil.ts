// The anvil: repair gear with its own material (each unit mends a quarter), combine two of the
// same item (their durability adds up with a little extra, and their enchantments merge, equal
// levels stepping up one), and rename things. Every change costs experience levels; anything
// over 39 levels is too expensive to do.

import { MAX_LEVEL } from './enchanting';
import { B } from './blocks';
import { I, itemDef, maxDurability, type Enchant, type ItemStack } from './items';

export const ANVIL_MAX_COST = 39;

/** What mends an item of this key, if anything. */
function repairMaterial(key: string): number | undefined {
  if (key.startsWith('wooden_')) return B.planks;
  if (key.startsWith('stone_')) return B.cobblestone;
  if (key.startsWith('iron_')) return I.iron_ingot;
  if (key.startsWith('golden_')) return I.gold_ingot;
  if (key.startsWith('diamond_')) return I.diamond;
  if (key.startsWith('leather_')) return I.leather;
  if (key === 'shield' || key === 'bow' || key === 'crossbow' || key === 'fishing_rod') return B.planks;
  if (key === 'glider') return I.leather;
  return undefined;
}

export interface AnvilResult { out: ItemStack; cost: number; /** How many of the second item it uses up. */ useB: number; tooExpensive?: boolean }

export function anvilResult(a: ItemStack | null, b: ItemStack | null, name: string): AnvilResult | null {
  if (!a) return null;
  const def = itemDef(a.id);
  if (!def) return null;
  const out: ItemStack = { ...a, ench: a.ench?.map((e) => ({ ...e })) };
  let cost = 0, useB = 0;
  const max = maxDurability(a.id);
  if (b) {
    const mat = repairMaterial(def.key);
    if (max && b.id === mat && (a.damage ?? 0) > 0) {
      // Each unit of material mends a quarter of the item.
      const per = Math.ceil(max / 4);
      useB = Math.min(b.count, Math.ceil((a.damage ?? 0) / per));
      out.damage = Math.max(0, (a.damage ?? 0) - per * useB);
      cost += useB;
    } else if (b.id === a.id && (max || b.ench?.length)) {
      useB = 1;
      if (max) {
        const left = (max - (a.damage ?? 0)) + (max - (b.damage ?? 0)) + Math.floor(max * 0.12);
        out.damage = Math.max(0, max - left);
        if (out.damage !== (a.damage ?? 0)) cost += 2;
      }
      // Enchantments: keep the best of each; two equal levels make the next one up.
      const merged = new Map<Enchant['id'], number>((out.ench ?? []).map((e) => [e.id, e.level]));
      for (const e of b.ench ?? []) {
        const cur = merged.get(e.id) ?? 0;
        const lvl = cur === e.level ? Math.min(MAX_LEVEL[e.id], cur + 1) : Math.max(cur, e.level);
        if (lvl !== cur) { merged.set(e.id, lvl); cost += lvl * 2; }
      }
      out.ench = merged.size ? [...merged].map(([id, level]) => ({ id, level })) : undefined;
    } else return null;
  }
  // Renaming.
  const want = name.trim().slice(0, 30);
  const current = a.name ?? '';
  if (want !== current && !(want === def.name && !current)) {
    if (want && want !== def.name) out.name = want; else delete out.name;
    cost += 1;
  }
  if (cost === 0) return null;
  // Work on an item that's been through the anvil before costs a little more each time.
  cost += a.anviled ?? 0;
  out.anviled = (a.anviled ?? 0) + 1;
  return { out, cost, useB, tooExpensive: cost > ANVIL_MAX_COST };
}
