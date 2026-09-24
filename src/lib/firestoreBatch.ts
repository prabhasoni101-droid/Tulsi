import {
  writeBatch,
  deleteDoc,
  getDoc,
  type Firestore,
  type DocumentReference,
  type UpdateData,
  type DocumentData,
} from 'firebase/firestore';

/** Firestore hard limit is 500 ops per batch; use 450 for safety margin. */
export const FIRESTORE_BATCH_CHUNK_SIZE = 450;

export interface BatchedDeleteResult {
  /** Confirmed removed from Firestore. */
  deleted: string[];
  /** Still present in Firestore — deletion could not be committed. */
  failed: string[];
}

/**
 * Industry-grade batched DELETE with three layers of safety:
 *  1. Efficient batch commits (<=450 ops) for the common happy path.
 *  2. Per-document retry inside a chunk that failed as a batch, so one
 *     permission/transient error can never block the remaining records.
 *  3. Verification: any doc that still cannot be deleted is re-read before it
 *     is reported as a failure, so the UI reports the TRUE "deleted vs left"
 *     state instead of guessing.
 *
 * Returns per-record outcome so the caller can show exactly how many records
 * were actually removed from Firestore and how many remain.
 */
export async function commitBatchedDeletes(
  db: Firestore,
  refs: DocumentReference<DocumentData, DocumentData>[],
  onProgress?: (processed: number, total: number) => void
): Promise<BatchedDeleteResult> {
  if (!refs || refs.length === 0) return { deleted: [], failed: [] };

  const deleted: string[] = [];
  const failed: string[] = [];
  const idMap = new Map<string, DocumentReference<DocumentData, DocumentData>>();
  let processed = 0;

  const tally = (n: number) => {
    processed += n;
    if (onProgress) onProgress(Math.min(processed, refs.length), refs.length);
  };

  try {
    for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_CHUNK_SIZE) {
      const part = refs.slice(i, i + FIRESTORE_BATCH_CHUNK_SIZE);
      part.forEach((ref) => idMap.set(ref.id, ref));

      try {
        const batch = writeBatch(db);
        part.forEach((ref) => (batch as any).delete(ref));
        await batch.commit();
        part.forEach((ref) => deleted.push(ref.id));
        tally(part.length);
      } catch {
        // Batch commit failed — retry each doc individually so a single bad
        // record can't stop the rest of the chunk from being deleted.
        for (const ref of part) {
          try {
            await deleteDoc(ref);
            deleted.push(ref.id);
          } catch {
            failed.push(ref.id);
          }
          tally(1);
        }
      }
    }

    // Verification pass: re-read only the docs we could NOT delete. One of
    // them may actually be gone by now (e.g. removed by another session), so we
    // move it to `deleted` and only report what is genuinely still present.
    const trulyLeft: string[] = [];
    for (const id of failed) {
      const ref = idMap.get(id);
      if (!ref) {
        trulyLeft.push(id);
        continue;
      }
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          deleted.push(id);
        } else {
          trulyLeft.push(id);
        }
      } catch {
        trulyLeft.push(id);
      }
    }

    return { deleted, failed: trulyLeft };
  } catch (err) {
    console.error('[FirestoreBatch] commitBatchedDeletes unexpected error:', err);
    return {
      deleted,
      failed: refs.map((ref) => ref.id).filter((id) => !deleted.includes(id)),
    };
  }
}

export async function commitBatchedSets<T extends DocumentData>(
  db: Firestore,
  entries: Array<{ ref: DocumentReference<DocumentData, DocumentData>; data: UpdateData<T>; merge?: boolean }>
): Promise<void> {
  for (let i = 0; i < entries.length; i += FIRESTORE_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    entries.slice(i, i + FIRESTORE_BATCH_CHUNK_SIZE).forEach(({ ref, data, merge }) => {
      (batch as any).set(ref, data, merge ? { merge: true } : {});
    });
    await batch.commit();
  }
}

export async function commitBatchedUpdates<T extends DocumentData>(
  db: Firestore,
  entries: Array<{ ref: DocumentReference<DocumentData, DocumentData>; data: UpdateData<T> }>
): Promise<void> {
  for (let i = 0; i < entries.length; i += FIRESTORE_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    entries.slice(i, i + FIRESTORE_BATCH_CHUNK_SIZE).forEach(({ ref, data }) => {
      (batch as any).update(ref, data);
    });
    await batch.commit();
  }
}
