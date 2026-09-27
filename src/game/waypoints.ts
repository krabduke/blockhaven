// Named waypoints and the last death position, saved with the world.

export interface Waypoint { name: string; pos: [number, number, number]; dim: string; death?: boolean }

export class Waypoints {
  private list_: Waypoint[] = [];

  load(data: unknown): void {
    this.list_ = Array.isArray(data) ? (data as Waypoint[]).filter((w) => w && typeof w.name === 'string' && Array.isArray(w.pos)) : [];
  }
  serialize(): Waypoint[] { return this.list_.map((w) => ({ ...w, pos: [...w.pos] as [number, number, number] })); }

  add(name: string, pos: [number, number, number], dim: string, death = false): void {
    this.list_ = this.list_.filter((w) => w.name.toLowerCase() !== name.toLowerCase());
    this.list_.push({ name, pos, dim, death });
  }
  remove(name: string): boolean {
    const n = this.list_.length;
    this.list_ = this.list_.filter((w) => w.name.toLowerCase() !== name.toLowerCase());
    return this.list_.length < n;
  }
  get(name: string): Waypoint | undefined { return this.list_.find((w) => w.name.toLowerCase() === name.toLowerCase()); }
  names(): string[] { return this.list_.map((w) => w.name.replace(/\s/g, '_')); }
  list(dim?: string): Waypoint[] { return dim ? this.list_.filter((w) => w.dim === dim) : this.list_; }

  /** Replace the death marker. */
  setDeath(pos: [number, number, number], dim: string): void {
    this.list_ = this.list_.filter((w) => !w.death);
    this.list_.push({ name: 'Last death', pos, dim, death: true });
  }
}
