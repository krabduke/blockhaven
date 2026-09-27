// Villager trades. Amber is the currency: villagers buy common goods for it
// and sell useful things for it.

import { B } from './blocks';
import { I, type ItemStack } from './items';

export interface TradeOffer {
  give: ItemStack[];
  get: ItemStack;
  uses: number;
  maxUses: number;
}

type Row = [give: [number, number][], get: [number, number], maxUses: number, ench?: ItemStack['ench']];

const TABLE: Record<string, Row[]> = {
  farmer: [
    [[[I.wheat_item, 20]], [I.amber, 1], 16], [[[I.carrot, 15]], [I.amber, 1], 16],
    [[[I.amber, 1]], [I.bread, 6], 12], [[[I.amber, 1]], [I.apple, 4], 12],
    [[[I.amber, 1]], [B.cake, 1], 6], [[[I.amber, 8]], [I.golden_apple, 1], 3],
  ],
  shepherd: [
    [[[B.wool, 18]], [I.amber, 1], 16], [[[I.amber, 1]], [I.shears, 1], 4],
    [[[I.amber, 1]], [B.wool_red, 3], 12], [[[I.amber, 1]], [B.wool_blue, 3], 12], [[[I.amber, 2]], [B.bed, 1], 6],
  ],
  fisher: [
    [[[I.raw_fish, 10]], [I.amber, 1], 16], [[[I.amber, 1]], [I.cooked_fish, 6], 12],
    [[[I.amber, 3]], [I.fishing_rod, 1], 3, [{ id: 'unbreaking', level: 2 }]],
  ],
  butcher: [
    [[[I.raw_pork, 7]], [I.amber, 1], 16], [[[I.raw_chicken, 10]], [I.amber, 1], 16],
    [[[I.amber, 1]], [I.cooked_pork, 5], 12], [[[I.amber, 1]], [I.cooked_mutton, 5], 12],
  ],
  cleric: [
    [[[I.rotten_flesh, 30]], [I.amber, 1], 16], [[[I.amber, 1]], [I.glow_dust, 2], 12],
    [[[I.amber, 1]], [I.spark_dust, 4], 12], [[[I.amber, 5]], [I.ember_core, 1], 4], [[[I.amber, 3]], [I.bone_meal, 12], 8],
  ],
  smith: [
    [[[I.coal, 15]], [I.amber, 1], 16], [[[I.iron_ingot, 4]], [I.amber, 1], 12],
    [[[I.amber, 6]], [I.iron_pickaxe, 1], 3], [[[I.amber, 10]], [I.iron_chestplate, 1], 3],
    [[[I.amber, 4]], [I.iron_sword, 1], 3, [{ id: 'sharpness', level: 2 }]], [[[I.amber, 18], [I.diamond, 1]], [I.diamond_pickaxe, 1], 2, [{ id: 'efficiency', level: 3 }]],
  ],
  librarian: [
    [[[I.paper, 24]], [I.amber, 1], 16], [[[I.book, 4]], [I.amber, 1], 12],
    [[[I.amber, 1]], [B.bookshelf, 1], 12], [[[I.amber, 1]], [B.glass, 4], 12],
    [[[I.amber, 2]], [B.lantern, 1], 12], [[[I.amber, 12], [I.book, 1]], [B.enchanting_table, 1], 1],
  ],
};

export function tradesFor(profession: string, rand: () => number): TradeOffer[] {
  const rows = [...(TABLE[profession] ?? TABLE.farmer)];
  // Every villager offers the first two trades plus a few of the rest.
  const picked = rows.slice(0, 2);
  const rest = rows.slice(2);
  while (picked.length < 5 && rest.length) picked.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  return picked.map(([give, get, maxUses, ench]) => ({
    give: give.map(([id, count]) => ({ id, count })),
    get: { id: get[0], count: get[1], ...(ench ? { ench } : {}) },
    uses: 0,
    maxUses,
  }));
}

export const PROFESSION_NAMES: Record<string, string> = {
  farmer: 'Farmer', shepherd: 'Shepherd', fisher: 'Fisher', butcher: 'Butcher', cleric: 'Cleric', smith: 'Smith', librarian: 'Librarian',
};
