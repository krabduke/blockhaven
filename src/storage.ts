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
  difficulty?: 'peaceful' | 'easy' | 'normal' | 'hard';
  /** Keep your inventory and experience when you die. */
  keepInventory?: boolean;
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

// ---------- Backups: export, import, duplicate, rename ----------
const FORMAT = 'blockhaven-world';

/** Chunk records belonging to a world, in every dimension (ids like "w1a2b" and "w1a2b~ember"). */
async function worldChunks(id: string): Promise<[string, unknown][]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out: [string, unknown][] = [];
    const t = db.transaction('chunks', 'readonly');
    const req = t.objectStore('chunks').openCursor(IDBKeyRange.bound(id, id + '￿'));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      const key = String(c.key), owner = key.split('|')[0];
      if (owner === id || owner.startsWith(id + '~')) out.push([key, c.value]);
      c.continue();
    };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(text: string): Promise<Blob> {
  const blob = new Blob([text], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined') return blob;
  return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
async function gunzipText(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return file.text();
}

/** Pack a world into a single downloadable file. */
export async function exportWorld(id: string): Promise<{ blob: Blob; name: string }> {
  const meta = (await tx<WorldMeta | undefined>('worlds', 'readonly', (s) => s.get(id)));
  if (!meta) throw new Error('World not found');
  const chunks: Record<string, [string, string]> = {};
  for (const [key, rec] of await worldChunks(id)) {
    const r = rec as { b: Uint8Array; m: Uint8Array };
    chunks[key.slice(id.length)] = [b64(r.b), b64(r.m)];
  }
  const blob = await gzip(JSON.stringify({ format: FORMAT, version: 1, meta, chunks }));
  const safe = meta.name.replace(/[^\w\- ]+/g, '').trim() || 'world';
  return { blob, name: `${safe}.blockhaven` };
}

/** Read a world file made by exportWorld; it becomes a new world in the list. */
export async function importWorld(file: Blob): Promise<WorldMeta> {
  let data: { format?: string; meta?: WorldMeta; chunks?: Record<string, [string, string]> };
  try { data = JSON.parse(await gunzipText(file)); } catch { throw new Error('That file isn’t a Blockhaven world.'); }
  if (data.format !== FORMAT || !data.meta || !data.chunks) throw new Error('That file isn’t a Blockhaven world.');
  const id = 'w' + Date.now().toString(36);
  const existing = await listWorlds().catch(() => [] as WorldMeta[]);
  let name = data.meta.name;
  if (existing.some((w) => w.name === name)) name += ' (imported)';
  const meta: WorldMeta = { ...data.meta, id, name, lastPlayed: Date.now() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('chunks', 'readwrite');
    const s = t.objectStore('chunks');
    for (const [suffix, [b, m]] of Object.entries(data.chunks!)) s.put({ b: unb64(b), m: unb64(m) }, id + suffix);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  await saveWorldMeta(meta);
  return meta;
}

export async function duplicateWorld(id: string): Promise<WorldMeta> {
  const meta = await tx<WorldMeta | undefined>('worlds', 'readonly', (s) => s.get(id));
  if (!meta) throw new Error('World not found');
  const nid = 'w' + Date.now().toString(36);
  const chunks = await worldChunks(id);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('chunks', 'readwrite');
    const s = t.objectStore('chunks');
    for (const [key, rec] of chunks) s.put(rec, nid + key.slice(id.length));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  const copy: WorldMeta = { ...meta, id: nid, name: meta.name + ' (copy)', lastPlayed: Date.now() };
  await saveWorldMeta(copy);
  return copy;
}

export async function renameWorld(id: string, name: string): Promise<void> {
  const meta = await tx<WorldMeta | undefined>('worlds', 'readonly', (s) => s.get(id));
  if (!meta) return;
  await saveWorldMeta({ ...meta, name });
}

/** Offer a blob as a download. */
export function download(blob: Blob, name: string): void {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
