// Undo for building: /fill, /setblock, and blocks placed or broken in Creative.
// Each action is one group; /undo restores the group's previous blocks.

import type { Game } from '../game';

interface Change { x: number; y: number; z: number; id: number; meta: number }

const MAX_GROUPS = 50;
const MAX_CHANGES = 200_000;

export class EditHistory {
  private groups: Change[][] = [];
  private total = 0;

  constructor(private g: Game) {}

  /** Start a new undo step; changes recorded until the next begin() undo together. */
  begin(): void {
    this.groups.push([]);
    while (this.groups.length > MAX_GROUPS || (this.total > MAX_CHANGES && this.groups.length > 1)) this.total -= this.groups.shift()!.length;
  }

  /** Remember a block's current state before it changes. */
  record(x: number, y: number, z: number): void {
    const w = this.g.world;
    if (!w) return;
    if (!this.groups.length) this.begin();
    this.groups[this.groups.length - 1].push({ x, y, z, id: w.getBlock(x, y, z), meta: w.getMeta(x, y, z) });
    this.total++;
  }

  /** Record, then set. */
  set(x: number, y: number, z: number, id: number, meta = 0): void {
    this.record(x, y, z);
    this.g.world?.setBlock(x, y, z, id, meta);
  }

  /** Revert the latest group; returns how many blocks changed. */
  undo(): number {
    const w = this.g.world;
    let grp = this.groups.pop();
    while (grp && !grp.length) grp = this.groups.pop();
    if (!w || !grp) return 0;
    this.total -= grp.length;
    // Restore in reverse so a block changed twice ends at its original state.
    for (let i = grp.length - 1; i >= 0; i--) { const c = grp[i]; w.setBlock(c.x, c.y, c.z, c.id, c.meta); }
    return grp.length;
  }

  clear(): void { this.groups = []; this.total = 0; }
}
