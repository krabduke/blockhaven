import { describe, expect, it } from 'vitest';
import { B, BLOCKS } from '../src/blocks';
import { craft } from '../src/crafting';
import { Inventory } from '../src/inventory';
import { I } from '../src/items';
import { Simplex } from '../src/noise';
import { Body, moveBody, raycast, stepBody, type BlockReader } from '../src/physics';
import { rleDecode, rleEncode } from '../src/storage';
import { missingPainters } from '../src/textures';
import { CH, idx } from '../src/world/chunk';
import { computeChunkLight } from '../src/world/light';
import { WorldGen } from '../src/world/worldgen';

/** A tiny in-memory world for physics tests. */
class TestWorld implements BlockReader {
  blocks = new Map<string, number>();
  set(x: number, y: number, z: number, id: number) { this.blocks.set(`${x},${y},${z}`, id); }
  getBlock(x: number, y: number, z: number) { return this.blocks.get(`${x},${y},${z}`) ?? 0; }
  getBlockPhysics(x: number, y: number, z: number) { return this.getBlock(x, y, z); }
  getMeta() { return 0; }
}

function floor(w: TestWorld, y = 0, r = 5) {
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) w.set(x, y, z, B.stone);
}

describe('noise', () => {
  it('is deterministic for a seed and varies between seeds', () => {
    const a = new Simplex(42), b = new Simplex(42), c = new Simplex(43);
    expect(a.noise2(1.5, 2.25)).toBe(b.noise2(1.5, 2.25));
    expect(a.noise3(0.3, 4.1, -2)).toBe(b.noise3(0.3, 4.1, -2));
    expect(a.noise2(1.5, 2.25)).not.toBe(c.noise2(1.5, 2.25));
  });
  it('stays within [-1, 1]', () => {
    const n = new Simplex(1);
    for (let i = 0; i < 2000; i++) {
      const v = n.noise3(i * 0.37, i * 0.11, i * 0.53);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});

describe('world generation', () => {
  it('produces identical chunks for the same seed', () => {
    const a = new WorldGen(1234).generate(3, -2);
    const b = new WorldGen(1234).generate(3, -2);
    expect(a.blocks).toEqual(b.blocks);
  });
  it('has bedrock at the bottom and air at the top', () => {
    const { blocks } = new WorldGen(99).generate(0, 0);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      expect(blocks[idx(x, 0, z)]).toBe(B.bedrock);
      expect(blocks[idx(x, CH - 1, z)]).toBe(0);
    }
  });
  it('generates ores somewhere in a handful of chunks', () => {
    const gen = new WorldGen(7);
    const found = new Set<number>();
    for (let cx = 0; cx < 4; cx++) for (let cz = 0; cz < 4; cz++) {
      const { blocks } = gen.generate(cx, cz);
      for (const id of blocks) if (id === B.coal_ore || id === B.iron_ore) found.add(id);
    }
    expect(found.has(B.coal_ore)).toBe(true);
    expect(found.has(B.iron_ore)).toBe(true);
  });
});

describe('lighting', () => {
  it('lights open sky fully and darkens under a roof', () => {
    const blocks = new Uint8Array(16 * 16 * CH);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[idx(x, 10, z)] = B.stone;
    // A 5x5 roof at y=14 over a cavity.
    for (let z = 4; z <= 8; z++) for (let x = 4; x <= 8; x++) blocks[idx(x, 14, z)] = B.stone;
    const light = computeChunkLight(blocks);
    expect(light[idx(0, 11, 0)] >> 4).toBe(15);
    expect(light[idx(6, 11, 6)] >> 4).toBeLessThan(15);
    expect(light[idx(6, 11, 6)] >> 4).toBeGreaterThan(8);
    expect(light[idx(6, 5, 6)] >> 4).toBe(0);
  });
  it('spreads torch light with falloff of one per block', () => {
    const blocks = new Uint8Array(16 * 16 * CH);
    for (let i = 0; i < blocks.length; i++) blocks[i] = B.stone;
    for (let x = 0; x < 16; x++) blocks[idx(x, 20, 8)] = 0;
    blocks[idx(2, 20, 8)] = B.torch;
    const light = computeChunkLight(blocks);
    expect(light[idx(2, 20, 8)] & 15).toBe(14);
    expect(light[idx(7, 20, 8)] & 15).toBe(9);
  });
});

describe('physics', () => {
  it('falls and lands on the ground', () => {
    const w = new TestWorld();
    floor(w);
    const b = new Body(0.5, 5, 0.5, 0.6, 1.8);
    for (let i = 0; i < 60; i++) stepBody(w, b, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: 0 }, false);
    expect(b.onGround).toBe(true);
    expect(b.pos[1]).toBeCloseTo(1, 5);
  });
  it('jumps about 1.25 blocks high', () => {
    const w = new TestWorld();
    floor(w);
    const b = new Body(0.5, 1, 0.5, 0.6, 1.8);
    for (let i = 0; i < 3; i++) stepBody(w, b, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: 0 }, false);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      stepBody(w, b, { forward: 0, strafe: 0, jump: i === 0, sneak: false, sprint: false, yaw: 0 }, false);
      peak = Math.max(peak, b.pos[1] - 1);
    }
    expect(peak).toBeGreaterThan(1.2);
    expect(peak).toBeLessThan(1.3);
  });
  it('walks at roughly 4.3 blocks per second', () => {
    const w = new TestWorld();
    floor(w, 0, 60);
    const b = new Body(0.5, 1, 0.5, 0.6, 1.8);
    for (let i = 0; i < 5; i++) stepBody(w, b, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: 0 }, false);
    const start = b.pos[2];
    for (let i = 0; i < 40; i++) stepBody(w, b, { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false, yaw: 0 }, false);
    const speed = (start - b.pos[2]) / 2; // 40 ticks = 2 s, walking toward -z
    expect(speed).toBeGreaterThan(3.9);
    expect(speed).toBeLessThan(4.5);
  });
  it('is stopped by walls', () => {
    const w = new TestWorld();
    floor(w);
    w.set(0, 1, -2, B.stone); w.set(0, 2, -2, B.stone);
    const b = new Body(0.5, 1, 0.5, 0.6, 1.8);
    b.onGround = true;
    moveBody(w, b, 0, 0, -3, 0, false);
    expect(b.pos[2]).toBeCloseTo(-1 + 0.3, 5);
  });
  it('steps up a half-slab but not a full block', () => {
    const w = new TestWorld();
    floor(w);
    w.set(0, 1, -1, B.cobble_slab);
    const b = new Body(0.5, 1, 0.5, 0.6, 1.8);
    b.onGround = true;
    moveBody(w, b, 0, -0.08, -0.9, 0.6, false);
    expect(b.pos[1]).toBeCloseTo(1.5, 5);
  });
});

describe('raycast', () => {
  it('hits the first solid block and reports the face', () => {
    const w = new TestWorld();
    w.set(0, 0, -3, B.stone);
    const hit = raycast(w, [0.5, 0.5, 0.5], [0, 0, -1], 5);
    expect(hit?.pos).toEqual([0, 0, -3]);
    expect(hit?.normal).toEqual([0, 0, 1]);
  });
  it('misses beyond reach', () => {
    const w = new TestWorld();
    w.set(0, 0, -8, B.stone);
    expect(raycast(w, [0.5, 0.5, 0.5], [0, 0, -1], 5)).toBeNull();
  });
});

describe('crafting', () => {
  const s = (id: number) => ({ id, count: 1 });
  it('turns a log into four planks anywhere in the grid', () => {
    expect(craft([null, null, null, s(B.log)], 2)).toEqual({ id: B.planks, count: 4 });
    expect(craft([null, null, null, null, s(B.birch_log), null, null, null, null], 3)).toEqual({ id: B.planks, count: 4 });
  });
  it('makes a crafting table from four planks in a 2x2 grid', () => {
    expect(craft([s(B.planks), s(B.planks), s(B.planks), s(B.planks)], 2)).toEqual({ id: B.crafting_table, count: 1 });
  });
  it('makes a stone pickaxe', () => {
    const c = s(B.cobblestone), k = s(I.stick);
    expect(craft([c, c, c, null, k, null, null, k, null], 3)?.id).toBe(I.stone_pickaxe);
  });
  it('accepts mirrored axe recipes', () => {
    const p = s(B.planks), k = s(I.stick);
    expect(craft([p, p, null, p, k, null, null, k, null], 3)?.id).toBe(I.wooden_axe);
    expect(craft([null, p, p, null, k, p, null, k, null], 3)?.id).toBe(I.wooden_axe);
  });
  it('rejects nonsense', () => {
    expect(craft([s(B.dirt), s(B.sand), null, null], 2)).toBeNull();
  });
});

describe('inventory', () => {
  it('stacks up to 64 and spills over', () => {
    const inv = new Inventory(3);
    expect(inv.add({ id: B.dirt, count: 100 })).toBeNull();
    expect(inv.slots[0]?.count).toBe(64);
    expect(inv.slots[1]?.count).toBe(36);
    expect(inv.add({ id: B.dirt, count: 100 })).toMatchObject({ id: B.dirt, count: 8 });
  });
  it('does not stack tools', () => {
    const inv = new Inventory(2);
    inv.add({ id: I.iron_pickaxe, count: 1 });
    inv.add({ id: I.iron_pickaxe, count: 1 });
    expect(inv.slots[0]?.count).toBe(1);
    expect(inv.slots[1]?.count).toBe(1);
  });
});

describe('saves', () => {
  it('round-trips run-length encoding', () => {
    const data = new Uint8Array(70000);
    for (let i = 0; i < data.length; i++) data[i] = i % 1000 < 900 ? 0 : (i * 7) & 255;
    expect(rleDecode(rleEncode(data), data.length)).toEqual(data);
  });
});

describe('content', () => {
  it('has a painter for every texture tile', () => {
    expect(missingPainters()).toEqual([]);
  });
  it('gives every real block a name', () => {
    for (const b of BLOCKS) if (!b.key.startsWith('unknown_')) expect(b.name.length).toBeGreaterThan(0);
  });
});

import { offers } from '../src/enchanting';
import { Player } from '../src/player';

describe('new blocks', () => {
  it('lets you walk up stairs and blocks you on a fence', () => {
    const w = new TestWorld();
    floor(w);
    w.set(0, 1, -1, B.oak_stairs); // meta 0: tall half toward -z
    const b = new Body(0.5, 1, 0.5, 0.6, 1.8);
    b.onGround = true;
    moveBody(w, b, 0, -0.08, -0.6, 0.6, false);
    expect(b.pos[1]).toBeCloseTo(1.5, 5);

    const w2 = new TestWorld();
    floor(w2);
    w2.set(0, 1, -1, B.fence);
    const c = new Body(0.5, 1, 0.5, 0.6, 1.8);
    c.onGround = true;
    moveBody(w2, c, 0, -0.08, -1.5, 0.6, false);
    // Fence collision is 1.5 tall: too high to step onto.
    expect(c.pos[1]).toBeCloseTo(1, 5);
    expect(c.pos[2]).toBeGreaterThan(-0.2);
  });
});

describe('armor and experience', () => {
  it('reduces damage with armor points', () => {
    const p = new Player(0, 64, 0);
    p.armor.slots[1] = { id: I.diamond_chestplate, count: 1 };
    p.damage(10, 'mirewalker');
    // 8 armor points: 10 * (1 - 8/25) = 6.8
    expect(p.health).toBeCloseTo(20 - 6.8, 5);
  });
  it('levels up with the classic curve', () => {
    const p = new Player(0, 64, 0);
    p.addXp(7);
    expect(p.xpLevel).toBe(1);
    p.addXp(9 + 11 + 13);
    expect(p.xpLevel).toBe(4);
  });
});

describe('enchanting', () => {
  it('offers three enchantments for a pickaxe and none for dirt', () => {
    const o = offers({ id: I.iron_pickaxe, count: 1 }, 15, 42);
    expect(o).toHaveLength(3);
    expect(o.map((x) => x.cost)).toEqual([1, 2, 3]);
    expect(o.every((x) => ['efficiency', 'unbreaking'].includes(x.enchant.id))).toBe(true);
    expect(offers({ id: B.dirt, count: 1 }, 15, 42)).toEqual([]);
  });
});

describe('dungeons', () => {
  it('generates monster cages with loot chests in some chunks', () => {
    const gen = new WorldGen(2024);
    let cages = 0, loot = 0;
    for (let cx = 0; cx < 10; cx++) for (let cz = 0; cz < 10; cz++) {
      const { blocks, meta } = gen.generate(cx, cz);
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i] === B.spawner) cages++;
        if (blocks[i] === B.chest && meta[i] & 16) loot++;
      }
    }
    expect(cages).toBeGreaterThan(0);
    expect(loot).toBeGreaterThanOrEqual(cages);
  });
});

describe('more recipes', () => {
  const s = (id: number) => ({ id, count: 1 });
  it('crafts a bow, stairs and iron armor', () => {
    expect(craft([null, s(I.stick), s(I.string), s(I.stick), null, s(I.string), null, s(I.stick), s(I.string)], 3)?.id).toBe(I.bow);
    const p = s(B.planks);
    expect(craft([p, null, null, p, p, null, p, p, p], 3)).toEqual({ id: B.oak_stairs, count: 4 });
    const n = s(I.iron_ingot);
    expect(craft([n, n, n, n, null, n, null, null, null], 3)?.id).toBe(I.iron_helmet);
  });
});

import { EmberGen } from '../src/world/embergen';
import { nearestVillage, villagesNear } from '../src/world/villages';
import { tradesFor } from '../src/trading';

describe('the Emberdeep', () => {
  it('is sealed by bedrock with a lava sea and cinderstone', () => {
    const { blocks } = new EmberGen(5).generate(2, 3);
    let lava = 0, cinder = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      expect(blocks[idx(x, 0, z)]).toBe(B.bedrock);
      expect(blocks[idx(x, 127, z)]).toBe(B.bedrock);
      for (let y = 5; y < 31; y++) if (blocks[idx(x, y, z)] === B.lava) lava++;
      for (let y = 5; y < 120; y++) if (blocks[idx(x, y, z)] === B.cinderstone) cinder++;
    }
    expect(lava).toBeGreaterThan(0);
    expect(cinder).toBeGreaterThan(1000);
  });
});

describe('villages', () => {
  it('are laid out deterministically with houses, roads and villagers', () => {
    const gen = new WorldGen(1234);
    const v = nearestVillage(gen, 0, 0)!;
    expect(v).toBeTruthy();
    expect(v.pieces.some((p) => p.type === 'well')).toBe(true);
    expect(v.pieces.length).toBeGreaterThan(3);
    expect(v.roads.length).toBeGreaterThan(0);
    // Chunks under the village contain village blocks and report villagers.
    let bells = 0, spawns = 0;
    for (let cx = (v.bounds.x0 >> 4); cx <= (v.bounds.x1 >> 4); cx++) for (let cz = (v.bounds.z0 >> 4); cz <= (v.bounds.z1 >> 4); cz++) {
      const r = gen.generate(cx, cz);
      spawns += r.spawns.filter((s) => s.kind === 'villager').length;
      for (const b of r.blocks) if (b === B.bell) bells++;
    }
    expect(bells).toBe(1);
    expect(spawns).toBeGreaterThan(0);
    expect(villagesNear(gen, v.cx >> 4, v.cz >> 4)).toContain(v);
  });
});

describe('trading', () => {
  it('gives every profession amber-based trades', () => {
    for (const prof of ['farmer', 'shepherd', 'fisher', 'butcher', 'cleric', 'smith', 'librarian']) {
      const t = tradesFor(prof, () => 0.5);
      expect(t.length).toBeGreaterThanOrEqual(3);
      expect(t.some((o) => o.get.id === I.amber || o.give.some((g) => g.id === I.amber))).toBe(true);
    }
  });
});

describe('batch 3 recipes', () => {
  const s = (id: number) => ({ id, count: 1 });
  it('dyes wool, makes panes and a golden apple', () => {
    expect(craft([s(B.wool), s(I.dye_blue), null, null], 2)?.id).toBe(B.wool_blue);
    const g = s(B.glass);
    expect(craft([g, g, g, g, g, g, null, null, null], 3)).toEqual({ id: B.glass_pane, count: 16 });
    const au = s(I.gold_ingot);
    expect(craft([au, au, au, au, s(I.apple), au, au, au, au], 3)?.id).toBe(I.golden_apple);
  });
});
