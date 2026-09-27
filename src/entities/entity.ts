// The base for everything that moves in the world: creatures, items, projectiles, vehicles.
// Kept apart from entities.ts so vehicles can extend it without an import cycle.

import type * as THREE from 'three';
import type { Body } from '../physics';
import type { EntityManager } from './entities';

export abstract class Entity {
  dead = false;
  age = 0;
  prev: [number, number, number];
  object: THREE.Object3D;
  constructor(readonly body: Body, object: THREE.Object3D) {
    this.prev = [...body.pos];
    this.object = object;
  }
  abstract tick(m: EntityManager): void;
  render(alpha: number, m: EntityManager): void {
    const p = this.body.pos;
    this.object.position.set(this.prev[0] + (p[0] - this.prev[0]) * alpha, this.prev[1] + (p[1] - this.prev[1]) * alpha, this.prev[2] + (p[2] - this.prev[2]) * alpha);
    const l = m.lightAt(p[0], p[1] + this.body.height / 2, p[2]);
    this.object.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat) return;
      for (const mm of Array.isArray(mat) ? mat : [mat]) {
        const bm = mm as THREE.MeshBasicMaterial;
        const shade = (bm.userData.shade as number | undefined) ?? 1;
        const hurt = ((this as { hurtTime?: number }).hurtTime ?? 0) > 0;
        bm.color.setRGB(l * shade, l * shade * (hurt ? 0.5 : 1), l * shade * (hurt ? 0.5 : 1));
      }
    });
  }
}

export function dist(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
