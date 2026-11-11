// Persistence adapters. The store talks to one of these through a tiny interface:
//   load() -> { collections: {name: Record[]}, meta: {key: value} }
//   commit({ put: {name: Record[]}, del: {name: id[]}, meta: {key: value} })  (atomic)
//   clearAll(), getDraft(key), putDraft(key, value), deleteDraft(key)

import { COLLECTIONS, ID_FIELD } from './schema.js';
import { clone } from './utils.js';

const DB_NAME = 'qa-hub';
const DB_VERSION = 1;

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
  });
}

export async function createIndexedDbPersistence() {
  if (!globalThis.indexedDB) throw new Error('IndexedDB is not available in this browser.');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const c of COLLECTIONS) {
        if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: ID_FIELD[c] || 'id' });
      }
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('drafts')) d.createObjectStore('drafts', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('QA Hub storage is blocked by another open tab. Close other QA Hub tabs and reload.'));
  });

  // Let other tabs upgrade or delete the database instead of blocking forever.
  db.onversionchange = () => db.close();

  return {
    kind: 'indexeddb',
    async load() {
      const tx = db.transaction([...COLLECTIONS, 'meta'], 'readonly');
      const collections = {};
      await Promise.all(COLLECTIONS.map(async (c) => { collections[c] = await promisify(tx.objectStore(c).getAll()); }));
      const metaRows = await promisify(tx.objectStore('meta').getAll());
      const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
      return { collections, meta };
    },
    async commit({ put = {}, del = {}, meta = {} }) {
      const stores = new Set([...Object.keys(put), ...Object.keys(del)]);
      if (Object.keys(meta).length) stores.add('meta');
      if (!stores.size) return;
      const tx = db.transaction([...stores], 'readwrite');
      // Deletes run before puts so a single commit can replace a whole collection.
      for (const [c, ids] of Object.entries(del)) for (const id of ids) tx.objectStore(c).delete(id);
      for (const [c, records] of Object.entries(put)) for (const r of records) tx.objectStore(c).put(r);
      for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
      await txDone(tx);
    },
    async clearAll() {
      const tx = db.transaction([...COLLECTIONS, 'meta', 'drafts'], 'readwrite');
      for (const c of [...COLLECTIONS, 'meta', 'drafts']) tx.objectStore(c).clear();
      await txDone(tx);
    },
    async getDraft(key) {
      const row = await promisify(db.transaction('drafts').objectStore('drafts').get(key));
      return row?.value ?? null;
    },
    async putDraft(key, value) {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({ key, value });
      await txDone(tx);
    },
    async deleteDraft(key) {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').delete(key);
      await txDone(tx);
    },
  };
}

/** In-memory adapter used by tests and as a fallback when IndexedDB is unavailable. */
export function createMemoryPersistence(initial = null) {
  const data = { collections: Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])), meta: {}, drafts: new Map() };
  if (initial) {
    for (const c of COLLECTIONS) for (const r of initial.collections?.[c] || []) data.collections[c].set(r[ID_FIELD[c] || 'id'], clone(r));
    Object.assign(data.meta, clone(initial.meta || {}));
  }
  return {
    kind: 'memory',
    async load() {
      return {
        collections: Object.fromEntries(COLLECTIONS.map((c) => [c, [...data.collections[c].values()].map(clone)])),
        meta: clone(data.meta),
      };
    },
    async commit({ put = {}, del = {}, meta = {} }) {
      for (const [c, ids] of Object.entries(del)) for (const id of ids) data.collections[c].delete(id);
      for (const [c, records] of Object.entries(put)) for (const r of records) data.collections[c].set(r[ID_FIELD[c] || 'id'], clone(r));
      Object.assign(data.meta, clone(meta));
    },
    async clearAll() {
      for (const c of COLLECTIONS) data.collections[c].clear();
      data.meta = {};
      data.drafts.clear();
    },
    async getDraft(key) { return clone(data.drafts.get(key) ?? null); },
    async putDraft(key, value) { data.drafts.set(key, clone(value)); },
    async deleteDraft(key) { data.drafts.delete(key); },
  };
}
