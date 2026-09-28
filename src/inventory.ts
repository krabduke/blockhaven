import { itemDef, maxStack, type ItemStack } from './items';

export type Slot = ItemStack | null;

export class Inventory {
  slots: Slot[];
  constructor(size: number) {
    this.slots = new Array(size).fill(null);
  }

  get size(): number { return this.slots.length; }

  /** Add a stack, merging into existing stacks first. Returns what didn't fit. */
  add(stack: ItemStack, from = 0, to = this.slots.length): ItemStack | null {
    let left = stack.count;
    const max = maxStack(stack.id);
    if (max > 1) {
      for (let i = from; i < to && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === stack.id && s.count < max && !s.ench?.length && !stack.ench?.length && s.name === stack.name) {
          const n = Math.min(left, max - s.count);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = from; i < to && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        // Keep everything about the stack (enchantments, a loaded crossbow), not just what it is.
        this.slots[i] = { ...stack, count: n };
        left -= n;
      }
    }
    return left > 0 ? { ...stack, count: left } : null;
  }

  /**
   * Tidy slots [from, to): merge partial stacks of the same plain item, then order by `rank`
   * (then id), leaving the gaps at the end.
   */
  sort(rank: (id: number) => number, from = 0, to = this.slots.length): void {
    const items = this.slots.slice(from, to).filter((st): st is ItemStack => !!st);
    const merged: ItemStack[] = [];
    for (const st of items) {
      const plain = !st.ench?.length && !st.damage && !st.charged && !st.name;
      const into = plain ? merged.find((m) => m.id === st.id && !m.ench?.length && !m.damage && !m.charged && !m.name && m.count < maxStack(m.id)) : undefined;
      if (!into) { merged.push({ ...st }); continue; }
      const room = maxStack(st.id) - into.count, n = Math.min(room, st.count);
      into.count += n;
      if (st.count > n) merged.push({ ...st, count: st.count - n });
    }
    merged.sort((a, b) => rank(a.id) - rank(b.id) || a.id - b.id || b.count - a.count);
    for (let i = from; i < to; i++) this.slots[i] = merged[i - from] ?? null;
  }

  count(id: number): number {
    return this.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
  }

  removeOne(i: number): void {
    const s = this.slots[i];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[i] = null;
  }

  toJSON(): Slot[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  load(data: Slot[] | undefined): void {
    if (!data) return;
    for (let i = 0; i < this.slots.length; i++) {
      const s = data[i];
      this.slots[i] = s && itemDef(s.id) ? { ...s } : null;
    }
  }
}
