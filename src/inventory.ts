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
        if (s && s.id === stack.id && s.count < max) {
          const n = Math.min(left, max - s.count);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = from; i < to && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { id: stack.id, count: n, damage: stack.damage };
        left -= n;
      }
    }
    return left > 0 ? { id: stack.id, count: left, damage: stack.damage } : null;
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
