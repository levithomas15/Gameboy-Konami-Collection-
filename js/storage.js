/**
 * Local persistence.
 *
 * ROM bytes, battery saves and save states all live in IndexedDB in the
 * user's own browser. Nothing here talks to a network, and there is no code
 * path anywhere in this project that uploads a ROM.
 *
 * Bytes are stored as ArrayBuffers via structured clone rather than base64:
 * base64 would cost a third more space and a copy in each direction.
 */

const DB_NAME = 'cartridge-collection';
const DB_VERSION = 1;

const STORE_ROMS = 'roms';     // key: romId
const STORE_SAVES = 'saves';   // key: romId       battery-backed save RAM
const STORE_STATES = 'states'; // key: [romId, n]  save states
const STORE_SLOTS = 'slots';   // key: slotId      which ROM sits in which slot
const STORE_PREFS = 'prefs';   // key: name

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ROMS)) db.createObjectStore(STORE_ROMS);
      if (!db.objectStoreNames.contains(STORE_SAVES)) db.createObjectStore(STORE_SAVES);
      if (!db.objectStoreNames.contains(STORE_STATES)) db.createObjectStore(STORE_STATES);
      if (!db.objectStoreNames.contains(STORE_SLOTS)) db.createObjectStore(STORE_SLOTS);
      if (!db.objectStoreNames.contains(STORE_PREFS)) db.createObjectStore(STORE_PREFS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(storeName, mode, work) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/**
 * Ask the browser not to evict this data. Safari in particular clears
 * IndexedDB after about a week of not visiting a site, which would quietly
 * lose someone's save files.
 */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* not supported; nothing we can do */ }
  return false;
}

export async function estimateUsage() {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

// -- ROMs ----------------------------------------------------------------

export function putRom(romId, record) {
  return run(STORE_ROMS, 'readwrite', (store) => store.put(record, romId));
}

export function getRom(romId) {
  return run(STORE_ROMS, 'readonly', (store) => store.get(romId));
}

export function deleteRom(romId) {
  return run(STORE_ROMS, 'readwrite', (store) => store.delete(romId));
}

// -- battery saves -------------------------------------------------------

export function putSave(romId, bytes) {
  return run(STORE_SAVES, 'readwrite', (store) =>
    store.put({ bytes: toBuffer(bytes), updatedAt: Date.now() }, romId));
}

export async function getSave(romId) {
  const record = await run(STORE_SAVES, 'readonly', (store) => store.get(romId));
  return record ? new Uint8Array(record.bytes) : null;
}

// -- save states ---------------------------------------------------------

export function putState(romId, index, bytes) {
  return run(STORE_STATES, 'readwrite', (store) =>
    store.put({ bytes: toBuffer(bytes), createdAt: Date.now() }, `${romId}:${index}`));
}

export async function getState(romId, index) {
  const record = await run(STORE_STATES, 'readonly',
    (store) => store.get(`${romId}:${index}`));
  return record ? new Uint8Array(record.bytes) : null;
}

// -- slot bindings -------------------------------------------------------

export function bindSlot(slotId, romId) {
  return run(STORE_SLOTS, 'readwrite', (store) => store.put({ romId }, slotId));
}

export function unbindSlot(slotId) {
  return run(STORE_SLOTS, 'readwrite', (store) => store.delete(slotId));
}

export async function allSlotBindings() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SLOTS, 'readonly');
    const store = tx.objectStore(STORE_SLOTS);
    const out = new Map();
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        out.set(cursor.key, cursor.value.romId);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// -- preferences ---------------------------------------------------------

export function putPref(key, value) {
  return run(STORE_PREFS, 'readwrite', (store) => store.put(value, key));
}

export function getPref(key) {
  return run(STORE_PREFS, 'readonly', (store) => store.get(key));
}

/** Structured clone needs a plain ArrayBuffer, not a view onto wasm memory. */
function toBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
