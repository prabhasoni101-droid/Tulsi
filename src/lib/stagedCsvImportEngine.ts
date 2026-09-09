import { executeStagedImportWorker, StagedImportPlan } from '../workers/csvImportWorker';
import { db } from '../services/firebase';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { workspaceStore } from './workspace/workspaceStore';
import { persistRecords } from './workspace/localPersistence';

export type { StagedImportPlan, StagedRowDiff } from '../workers/csvImportWorker';

export interface StageImportOptions {
  csvText: string;
  existingRecords: any[];
  templeUsers: any[];
  customColumns: string[];
  templeId: string;
  userId?: string;
  isAttendanceCsv?: boolean;
  onProgress?: (step: string, percent: number) => void;
}

/**
 * Phase 1-6: Runs the staging pipeline off the main thread using a Web Worker
 * (or async fallback if worker creation is restricted by browser context).
 * NO DATA MUTATIONS occur during this function call.
 */
export async function stageCsvImport(options: StageImportOptions): Promise<StagedImportPlan> {
  const { csvText, existingRecords, templeUsers, customColumns, templeId, userId, isAttendanceCsv, onProgress } = options;

  onProgress?.('Parsing CSV & Indexing...', 10);

  return new Promise<StagedImportPlan>((resolve, reject) => {
    let worker: Worker | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };

    try {
      worker = new Worker(new URL('../workers/csvImportWorker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = (e: MessageEvent) => {
        const { type, payload, error } = e.data || {};
        if (type === 'STAGE_COMPLETE') {
          cleanup();
          onProgress?.('Staging complete', 100);
          resolve(payload as StagedImportPlan);
        } else if (type === 'STAGE_ERROR') {
          cleanup();
          reject(new Error(error || 'Worker staging failed'));
        }
      };

      worker.onerror = (err) => {
        cleanup();
        // Web Worker fallback: execute staging asynchronously on main thread with microtask yields
        try {
          onProgress?.('Processing staging (fallback)...', 50);
          const plan = executeStagedImportWorker({
            csvText,
            existingRecords,
            templeUsers,
            customColumns,
            templeId,
            userId,
            isAttendanceCsv,
          });
          onProgress?.('Staging complete', 100);
          resolve(plan);
        } catch (fErr) {
          reject(fErr);
        }
      };

      worker.postMessage({
        type: 'STAGE_IMPORT',
        payload: {
          csvText,
          existingRecords,
          templeUsers,
          customColumns,
          templeId,
          userId,
          isAttendanceCsv,
        },
      });
    } catch (e) {
      // Direct async fallback
      try {
        onProgress?.('Processing staging (direct)...', 50);
        setTimeout(() => {
          try {
            const plan = executeStagedImportWorker({
              csvText,
              existingRecords,
              templeUsers,
              customColumns,
              templeId,
              userId,
              isAttendanceCsv,
            });
            onProgress?.('Staging complete', 100);
            resolve(plan);
          } catch (err) {
            reject(err);
          }
        }, 10);
      } catch (err) {
        reject(err);
      }
    }
  });
}

/**
 * Phase 7 & 8: Local Commit -> Firestore Sync
 * Triggered ONLY when the user clicks "Commit Import" in the Preview Modal.
 *
 * Phase 7: Applies changes locally to workspaceStore + IndexedDB first.
 * Phase 8: Syncs changed/new records to Firestore in safe MAX 400 chunks.
 * ZERO writes are generated for unchanged records.
 */
export async function commitStagedImport(
  plan: StagedImportPlan,
  templeId: string,
  onCommitProgress?: (step: string, percent: number) => void
): Promise<{ successCount: number; failCount: number }> {
  onCommitProgress?.('Local commit in progress...', 10);

  // Phase 7: Local Commit (Local First)
  const localUpserts: any[] = [];

  plan.insertedRecords.forEach((item) => {
    localUpserts.push(item.data);
  });

  plan.updatedRecords.forEach((item) => {
    const existing = workspaceStore.getRecord(item.id);
    if (existing) {
      const merged = { ...existing, ...item.patch, updatedAt: new Date().toISOString() };
      localUpserts.push(merged);
    }
  });

  if (localUpserts.length > 0) {
    workspaceStore.upsertRecords(localUpserts);
    for (let i = 0; i < localUpserts.length; i += 400) {
      await persistRecords(localUpserts.slice(i, i + 400)).catch(() => {});
    }
  }

  onCommitProgress?.('Syncing to Firestore...', 40);

  // Phase 8: Chunked Firestore Sync (MAX 400 per batch)
  const MAX_BATCH = 400;
  let successCount = 0;
  let failCount = 0;

  // Inserted records
  for (let i = 0; i < plan.insertedRecords.length; i += MAX_BATCH) {
    const chunk = plan.insertedRecords.slice(i, i + MAX_BATCH);
    let attempts = 0;
    let committed = false;
    while (!committed && attempts < 3) {
      try {
        const batch = writeBatch(db);
        chunk.forEach((item) => {
          batch.set(doc(db, 'devotees', item.id), {
            ...item.data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
        committed = true;
        successCount += chunk.length;
      } catch (err) {
        attempts++;
        if (attempts >= 3) {
          failCount += chunk.length;
          console.error('[StagedImportEngine] Firestore chunk insert failed after retries:', err);
        } else {
          await new Promise((r) => setTimeout(r, 1000 * attempts));
        }
      }
    }
    const percent = Math.min(90, 40 + Math.round((i / Math.max(1, plan.insertedRecords.length + plan.updatedRecords.length)) * 50));
    onCommitProgress?.('Syncing new records...', percent);
  }

  // Updated records (field-level merge diffs ONLY)
  for (let i = 0; i < plan.updatedRecords.length; i += MAX_BATCH) {
    const chunk = plan.updatedRecords.slice(i, i + MAX_BATCH);
    let attempts = 0;
    let committed = false;
    while (!committed && attempts < 3) {
      try {
        const batch = writeBatch(db);
        chunk.forEach((item) => {
          batch.set(
            doc(db, 'devotees', item.id),
            {
              ...item.patch,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        });
        await batch.commit();
        committed = true;
        successCount += chunk.length;
      } catch (err) {
        attempts++;
        if (attempts >= 3) {
          failCount += chunk.length;
          console.error('[StagedImportEngine] Firestore chunk update failed after retries:', err);
        } else {
          await new Promise((r) => setTimeout(r, 1000 * attempts));
        }
      }
    }
    const percent = Math.min(99, 50 + Math.round((i / Math.max(1, plan.updatedRecords.length)) * 45));
    onCommitProgress?.('Syncing updated records...', percent);
  }

  onCommitProgress?.('Commit complete', 100);
  return { successCount, failCount };
}
