// A small pool of chunk workers. Requests are routed to the least busy worker
// and resolved by id.

import type { SubMesh } from './mesher';
import type { WorkerRequest } from './worker';

import type { Spawn } from './worldgen';

export interface GenResult { cx: number; cz: number; blocks: Uint8Array; meta: Uint8Array; biomes: Uint8Array; light: Uint8Array; spawns: Spawn[] }

type Pending = { resolve: (v: any) => void; worker: number };

export class WorkerPool {
  private workers: Worker[] = [];
  private busy: number[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  /** Set when a worker fails to load or crashes; the world can't generate without them. */
  failed: string | null = null;

  constructor(seed: number, dimension: 'overworld' | 'ember' = 'overworld', size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        this.busy[p.worker]--;
        p.resolve(e.data);
      };
      w.onerror = (e) => {
        // A worker script that 404s (stale tab after an update) or throws lands here.
        this.failed = e.message || 'The terrain worker could not be loaded.';
        console.error('Chunk worker error', this.failed);
      };
      w.onmessageerror = () => { this.failed = 'The terrain worker sent data the game could not read.'; };
      w.postMessage({ type: 'init', seed, dimension } satisfies WorkerRequest);
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  get size(): number { return this.workers.length; }
  get inFlight(): number { return this.pending.size; }

  private send<T>(msg: WorkerRequest & { id: number }, transfer: Transferable[]): Promise<T> {
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.busy[i] < this.busy[best]) best = i;
    this.busy[best]++;
    return new Promise<T>((resolve) => {
      this.pending.set(msg.id, { resolve, worker: best });
      this.workers[best].postMessage(msg, transfer);
    });
  }

  generate(cx: number, cz: number, saved?: { blocks: Uint8Array; meta: Uint8Array }): Promise<GenResult> {
    const id = this.nextId++;
    const transfer = saved ? [saved.blocks.buffer, saved.meta.buffer] : [];
    return this.send<GenResult>({ type: 'gen', id, cx, cz, saved }, transfer as Transferable[]);
  }

  mesh(blocks: Uint8Array, meta: Uint8Array, light: Uint8Array, biomes: Uint8Array, origin: [number, number, number]): Promise<{ mesh: SubMesh }> {
    const id = this.nextId++;
    return this.send({ type: 'mesh', id, blocks, meta, light, biomes, ox: origin[0], oy: origin[1], oz: origin[2] }, [blocks.buffer, meta.buffer, light.buffer, biomes.buffer] as Transferable[]);
  }

  dispose(): void {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
  }
}
