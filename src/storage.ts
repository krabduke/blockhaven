// World saves in IndexedDB. Only chunks the player changed are stored; the
// rest regenerate from the seed.

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  seedText: string;
  gamemode: 'survival' | 'creative';
  created: number;
  lastPlayed: number;
  time: number;
  player?: unknown;
  blockEntities?: unknown;
  spawn?: [number, number, number];
}

const DB_NAME = 'blockhaven';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function listWorlds(): Promise<WorldMeta[]> {
  return tx<WorldMeta[]>('worlds', 'readonly', (s) => s.getAll()).then((w) => w.sort((a, b) => b.lastPlayed - a.lastPlayed));
}

export function saveWorldMeta(meta: WorldMeta): Promise<void> {
  return tx('worlds', 'readwrite', (s) => { s.put(meta); });
}

export async function deleteWorld(id: string): Promise<void> {
  await tx('worlds', 'readwrite', (s) => { s.delete(id); });
  await tx('chunks', 'readwrite', (s) => { s.delete(IDBKeyRange.bound(id + '|', id + '|￿')); });
}

/** Run-length encode a byte array as (count, value) pairs with 16-bit counts. */
export function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v && n < 65535) n++;
    out.push(n & 255, n >> 8, v);
    i += n;
  }
  return new Uint8Array(out);
}

export function rleDecode(data: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < data.length; i += 3) {
    const n = data[i] | (data[i + 1] << 8);
    out.fill(data[i + 2], o, o + n);
    o += n;
  }
  return out;
}

export function saveChunk(worldId: string, cx: number, cz: number, blocks: Uint8Array, meta: Uint8Array): Promise<void> {
  const rec = { b: rleEncode(blocks), m: rleEncode(meta) };
  return tx('chunks', 'readwrite', (s) => { s.put(rec, `${worldId}|${cx},${cz}`); });
}

export async function loadChunk(worldId: string, cx: number, cz: number, volume: number): Promise<{ blocks: Uint8Array; meta: Uint8Array } | null> {
  const rec = await tx<{ b: Uint8Array; m: Uint8Array } | undefined>('chunks', 'readonly', (s) => s.get(`${worldId}|${cx},${cz}`));
  if (!rec) return null;
  return { blocks: rleDecode(rec.b, volume), meta: rleDecode(rec.m, volume) };
}

export async function savedChunkKeys(worldId: string): Promise<Set<string>> {
  const keys = await tx<IDBValidKey[]>('chunks', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(worldId + '|', worldId + '|￿')));
  return new Set(keys.map((k) => String(k).split('|')[1]));
}
