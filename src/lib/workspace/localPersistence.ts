import { Devotee } from '../../types';
import {
  getDB,
  getCachedDevotees,
  removeCachedDevotee,
  removeCachedDevoteesBatch,
  getMeta,
  setMeta,
  saveCachedDevotees,
} from '../dbCache';
import { PendingOperation, BulkJob } from './syncTypes';

/**
 * Local Persistence Layer
 * ========================
 * Durable IndexedDB storage for the spreadsheet workspace (PDR Section B).
 *
 * Reuses the existing IndexedDB infrastructure (`src/lib/dbCache.ts`) so the
 * same dataset is never duplicated in many independent React states. All local
 * writes are transactional and chunked to keep the main thread responsive even
 * with 25k+ records.
 *
 * Persists:
 *  - normalized devotee records          -> DEVOTEE_STORE (reused)
 *  - custom column metadata / row order  -> META_STORE
 *  - pending local operations            -> PENDING_STORE (additive)
 *  - sync checkpoints / version metadata -> META_STORE
 */

export const PENDING_STORE = 'pendingOps';

export interface SyncCheckpoint {
  /** Firestore snapshot version/hash captured on last full hydration. */
  lastFullSyncAt: number;
  /** Monotonic local revision of the latest applied mutation. */
  localRevision: number;
}

const CHECKPOINT_KEY_PREFIX = 'sync_checkpoint_';

export function checkpointKey(templeId: string): string {
  return `${CHECKPOINT_KEY_PREFIX}${templeId}`;
}

export function columnOrderKey(templeId: string): string {
  return `workspace_columns_${templeId}`;
}

export function rowOrderKey(templeId: string): string {
  return `workspace_roworder_${templeId}`;
}

/**
 * Persists the ordered row id list for a temple. Reuses the existing
 * META_STORE via setMeta (transactional single-write).
 */
export async function persistRowOrder(templeId: string, rowOrder: string[]): Promise<void> {
  await setMeta(rowOrderKey(templeId), rowOrder);
}

export async function loadRowOrder(templeId: string): Promise<string[] | null> {
  return (await getMeta(rowOrderKey(templeId))) ?? null;
}

/** Column metadata keyed by column key -> { orderIndex, meta }; persisted in META_STORE. */
export async function persistColumns(
  templeId: string,
  columns: { key: string; label: string; editable: boolean; persisted: boolean; type?: string }[]
): Promise<void> {
  await setMeta(columnOrderKey(templeId), columns);
}

export async function loadColumns(
  templeId: string
): Promise<{ key: string; label: string; editable: boolean; persisted: boolean; type?: string }[] | null> {
  return (await getMeta(columnOrderKey(templeId))) ?? null;
}

/** Saves/reads the sync checkpoint for a temple. */
export async function saveCheckpoint(templeId: string, checkpoint: SyncCheckpoint): Promise<void> {
  await setMeta(checkpointKey(templeId), checkpoint);
}

export async function loadCheckpoint(templeId: string): Promise<SyncCheckpoint | null> {
  return (await getMeta(checkpointKey(templeId))) ?? null;
}

/** Persists a chunked batch of devotee records (reuses saveCachedDevotees). */
export async function persistRecords(records: Devotee[]): Promise<void> {
  await saveCachedDevotees(records);
}

/** Loads all normalized cached records for a temple (reuses getCachedDevotees). */
export async function loadRecords(templeId: string): Promise<Devotee[]> {
  return getCachedDevotees(templeId);
}

export { removeCachedDevotee, removeCachedDevoteesBatch };

/**
 * Durable bulk-jobs
 * -----------------
 * Persists in-flight bulk operations (deleteRows, permanentDelete, etc.) so a
 * page refresh or temporary network loss never loses track of which records
 * still need work. Stored in META_STORE under a per-temple key.
 */

const BULK_JOBS_KEY_PREFIX = 'bulk_jobs_';

function bulkJobsKey(templeId: string): string {
  return `${BULK_JOBS_KEY_PREFIX}${templeId}`;
}

/** Loads all durable bulk jobs for a temple. */
export async function loadBulkJobs(templeId: string): Promise<BulkJob[]> {
  const jobs = await getMeta(bulkJobsKey(templeId));
  return Array.isArray(jobs) ? jobs : [];
}

/** Saves the full set of bulk jobs for a temple. */
export async function saveBulkJobs(templeId: string, jobs: BulkJob[]): Promise<void> {
  await setMeta(bulkJobsKey(templeId), jobs ?? []);
}

/**
 * Persists pending mutation IDs (deletes / restores / permanent deletes) to a
 * per-temple key so stale Firestore snapshots or cached IndexedDB data can
 * never resurrect a record that is mid-delete.
 */
const PENDING_MUTATION_KEY_PREFIX = 'pending_mutations_';

function pendingMutationKey(templeId: string): string {
  return `${PENDING_MUTATION_KEY_PREFIX}${templeId}`;
}

export interface PendingMutations {
  deleteIds: string[];
  restoreIds: string[];
  permanentDeleteIds: string[];
}

export async function loadPendingMutations(templeId: string): Promise<PendingMutations> {
  const m = await getMeta(pendingMutationKey(templeId));
  if (m && typeof m === 'object') {
    return {
      deleteIds: Array.isArray(m.deleteIds) ? m.deleteIds : [],
      restoreIds: Array.isArray(m.restoreIds) ? m.restoreIds : [],
      permanentDeleteIds: Array.isArray(m.permanentDeleteIds) ? m.permanentDeleteIds : [],
    };
  }
  return { deleteIds: [], restoreIds: [], permanentDeleteIds: [] };
}

export async function savePendingMutations(templeId: string, m: PendingMutations): Promise<void> {
  await setMeta(pendingMutationKey(templeId), m);
}

/**
 * Pending operation queue
 * -----------------------
 * Persists operations that were created locally but not yet acknowledged by
 * the sync coordinator (e.g. written offline). Stored in an additive
 * PENDING_STORE so existing data and stores are untouched.
 */

export type PendingOperationRecord = PendingOperation & { id: string };

async function openPendingStore(readWrite: boolean): Promise<IDBObjectStore> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, readWrite ? 'readwrite' : 'readonly');
    const store = tx.objectStore(PENDING_STORE);
    // If the store does not exist (upgrade not yet run), surface an error the
    // caller should treat as "no pending ops". The upgrade path is registered
    // in dbCache; see ensurePendingStore().
    resolve(store);
  });
}

/** Reads all pending operations for a temple, oldest first. */
export async function loadPendingOps(templeId: string): Promise<PendingOperationRecord[]> {
  try {
    const db = await getDB();
    const ops: PendingOperationRecord[] = await new Promise((resolve) => {
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(PENDING_STORE, 'readonly');
      const store = tx.objectStore(PENDING_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result || []).filter((r: any) => r.tenantId === templeId || r.templeId === templeId);
        rows.sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0));
        resolve(rows);
      };
      req.onerror = () => resolve([]);
    });
    return ops;
  } catch {
    return [];
  }
}

/** Appends a pending operation to the persistent queue. */
export async function appendPendingOp(templeId: string, op: Omit<PendingOperation, 'id'>): Promise<PendingOperationRecord> {
  const rec: PendingOperationRecord = {
    ...(op as PendingOperation),
    id: op.opId,
    tenantId: templeId,
    createdAt: op.createdAt ?? Date.now(),
    syncStatus: (op.syncStatus as PendingOperationRecord['syncStatus']) ?? 'pending',
  };
  try {
    const db = await getDB();
    if (db.objectStoreNames.contains(PENDING_STORE)) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(PENDING_STORE, 'readwrite');
        const store = tx.objectStore(PENDING_STORE);
        store.put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch {
    /* non-fatal; keep in memory */
  }
  return rec;
}

/** Removes acknowledged pending operations from the persistent queue. */
export async function removePendingOps(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains(PENDING_STORE)) return;
    // Chunked: max 200 deletes per transaction to avoid oversized transactions.
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      await new Promise<void>((resolve) => {
        const tx = db.transaction(PENDING_STORE, 'readwrite');
        const store = tx.objectStore(PENDING_STORE);
        chunk.forEach((id) => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch {
    /* non-fatal */
  }
}

export { getDB };
