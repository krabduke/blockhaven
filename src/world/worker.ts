/// <reference lib="webworker" />
// Background worker: terrain generation, chunk-local lighting and meshing.

import { computeChunkLight } from './light';
import { meshSubchunk, type LayerMesh } from './mesher';
import { WorldGen } from './worldgen';

export type WorkerRequest =
  | { type: 'init'; seed: number }
  | { type: 'gen'; id: number; cx: number; cz: number; saved?: { blocks: Uint8Array; meta: Uint8Array } }
  | { type: 'mesh'; id: number; blocks: Uint8Array; meta: Uint8Array; light: Uint8Array; biomes: Uint8Array };

let gen: WorldGen | null = null;
const ctx = self as unknown as DedicatedWorkerGlobalScope;

function buffers(m: LayerMesh | null): ArrayBuffer[] {
  if (!m) return [];
  return [m.pos.buffer, m.uv.buffer, m.light.buffer, m.tint.buffer, m.index.buffer] as ArrayBuffer[];
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = new WorldGen(msg.seed);
    return;
  }
  if (msg.type === 'gen') {
    let blocks: Uint8Array, meta: Uint8Array, biomes: Uint8Array;
    const g = gen!.generate(msg.cx, msg.cz);
    if (msg.saved) {
      blocks = msg.saved.blocks;
      meta = msg.saved.meta;
    } else {
      blocks = g.blocks;
      meta = g.meta;
    }
    biomes = g.biomes;
    const light = computeChunkLight(blocks);
    ctx.postMessage({ type: 'gen', id: msg.id, cx: msg.cx, cz: msg.cz, blocks, meta, biomes, light }, [blocks.buffer, meta.buffer, biomes.buffer, light.buffer] as ArrayBuffer[]);
    return;
  }
  if (msg.type === 'mesh') {
    const mesh = meshSubchunk(msg);
    ctx.postMessage({ type: 'mesh', id: msg.id, mesh }, [...buffers(mesh.opaque), ...buffers(mesh.cutout), ...buffers(mesh.translucent)]);
  }
};
