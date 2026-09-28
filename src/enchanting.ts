// Enchanting: three offers per item, costing 1-3 levels, with level
// requirements that scale with the number of bookshelves around the table.

import { itemDef, type Enchant, type EnchantId, type ItemStack } from './items';
import { mulberry32 } from './noise';

export interface Offer {
  /** Minimum experience level to take this offer. */
  required: number;
  /** Levels actually spent. */
  cost: number;
  enchant: Enchant;
}

export const MAX_LEVEL: Record<EnchantId, number> = { efficiency: 5, sharpness: 5, protection: 4, unbreaking: 3, power: 5, feather_falling: 4 };

export function applicable(stack: ItemStack): EnchantId[] {
  const d = itemDef(stack.id);
  if (!d || stack.count !== 1) return [];
  if (d.id === 283) return ['power', 'unbreaking'];
  if (d.armor) return d.armor.slot === 3 ? ['protection', 'feather_falling', 'unbreaking'] : ['protection', 'unbreaking'];
  if (d.tool) {
    if (d.tool.kind === 'sword') return ['sharpness', 'unbreaking'];
    if (d.tool.kind === 'axe') return ['efficiency', 'sharpness', 'unbreaking'];
    if (d.use === 'shears' || d.use === 'rod') return ['unbreaking'];
    return ['efficiency', 'unbreaking'];
  }
  return [];
}

export function offers(stack: ItemStack | null, bookshelves: number, seed: number): Offer[] {
  if (!stack || stack.ench?.length) return [];
  const kinds = applicable(stack);
  if (!kinds.length) return [];
  const rand = mulberry32(seed ^ (stack.id * 7919));
  const shelves = Math.min(15, bookshelves);
  const base = 1 + Math.floor(rand() * 8) + Math.floor(shelves / 2) + Math.floor(rand() * (shelves + 1));
  const reqs = [Math.max(1, Math.floor(base / 3)), Math.floor((base * 2) / 3) + 1, Math.max(base, shelves * 2)];
  const start = Math.floor(rand() * kinds.length);
  return reqs.map((required, i) => {
    const id = kinds[(start + i) % kinds.length];
    const level = Math.max(1, Math.min(MAX_LEVEL[id], Math.round((required / 30) * MAX_LEVEL[id] + rand() * 0.8)));
    return { required, cost: i + 1, enchant: { id, level } };
  });
}

export function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V'][n] ?? String(n);
}
