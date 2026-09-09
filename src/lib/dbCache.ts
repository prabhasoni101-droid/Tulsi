import { Devotee } from '../types';
import { normalizeDevoteeList } from './dataNormalizer';

const DB_NAME = 'ISKCON_Devotee_LocalDB';
// v2: additively adds the PENDING_STORE for the local-first workspace
// pending-operation queue. Existing DEVOTEE_STORE/META_STORE are untouched, so
// all previously cached data remains readable (additive migration, PDR J).
const DB_VERSION = 2;
const DEVOTEE_STORE = 'devotees';
const META_STORE = 'metadata';
/** Pending local operations not yet acknowledged by the sync coordinator. */
const PENDING_STORE = 'pendingOps';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(DEVOTEE_STORE)) {
        const store = db.createObjectStore(DEVOTEE_STORE, { keyPath: 'id' });
        store.createIndex('templeId', 'templeId', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('[IndexedDB] Failed to open database:', (event.target as IDBOpenDBRequest).error);
      dbPromise = null;
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

/**
 * Retrieves all cached devotees for a given temple ID from IndexedDB.
 */
export async function getCachedDevotees(templeId: string): Promise<Devotee[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DEVOTEE_STORE, 'readonly');
      const store = tx.objectStore(DEVOTEE_STORE);
      const index = store.index('templeId');
      const request = index.getAll(templeId);

      request.onsuccess = () => {
        const normalized = normalizeDevoteeList(request.result || []);
        resolve(normalized);
      };

      request.onerror = () => {
        console.error('[IndexedDB] Error fetching devotees from cache:', request.error);
        resolve([]); // Fallback gracefully to empty array
      };
    });
  } catch (err) {
    console.error('[IndexedDB] Failed to read from cache:', err);
    return [];
  }
}

/**
 * Bulk saves or updates devotees in IndexedDB for a given temple ID.
 */
export async function saveCachedDevotees(devotees: Devotee[]): Promise<void> {
  if (!devotees || devotees.length === 0) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DEVOTEE_STORE, 'readwrite');
      const store = tx.objectStore(DEVOTEE_STORE);

      devotees.forEach((devotee) => {
        if (devotee.id) {
          store.put(devotee);
        }
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.error('[IndexedDB] Bulk save transaction failed:', tx.error);
        reject(tx.error);
      };
    });
  } catch (err) {
    console.error('[IndexedDB] Failed to bulk save to cache:', err);
  }
}

/**
 * Removes a single devotee from IndexedDB cache by ID.
 */
export async function removeCachedDevotee(id: string): Promise<void> {
  if (!id) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DEVOTEE_STORE, 'readwrite');
      const store = tx.objectStore(DEVOTEE_STORE);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[IndexedDB] Failed to delete item from cache:', err);
  }
}

/**
 * Gets a key-value pair from metadata store (e.g., sync timestamps).
 */
export async function getMeta(key: string): Promise<any> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const store = tx.objectStore(META_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result ? request.result.value : null);
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (err) {
    return null;
  }
}

/**
 * Sets a key-value pair in metadata store.
 */
export async function setMeta(key: string, value: any): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      store.put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[IndexedDB] Failed to set meta:', err);
  }
}

/**
 * Clears all cached devotee data from IndexedDB.
 */
export async function clearDbCache(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([DEVOTEE_STORE, META_STORE], 'readwrite');
      tx.objectStore(DEVOTEE_STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[IndexedDB] Failed to clear cache:', err);
  }
}

/**
 * Removes multiple devotees from IndexedDB cache by ID array in a single transaction.
 */
export async function removeCachedDevoteesBatch(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DEVOTEE_STORE, 'readwrite');
      const store = tx.objectStore(DEVOTEE_STORE);
      ids.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[IndexedDB] Batch delete from cache failed:', err);
  }
}

export { getDB };
export { DEVOTEE_STORE, PENDING_STORE, DB_NAME, DB_VERSION };
