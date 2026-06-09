import { writeBatch, type Firestore, type DocumentReference, type UpdateData, type DocumentData } from 'firebase/firestore';

/** Firestore hard limit is 500 ops per batch; use 450 for safety margin. */
export const FIRESTORE_BATCH_CHUNK_SIZE = 450;

export async function commitBatchedDeletes(
  db: Firestore,
  refs: DocumentReference[]
): Promise<void> {
  for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    refs.slice(i, i + FIRESTORE_BATCH_CHUNK_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export async function commitBatchedSets<T extends DocumentData>(
  db: Firestore,
  entries: Array<{ ref: DocumentReference; data: UpdateData<T>; merge?: boolean }>
): Promise<void> {
  for (let i = 0; i < entries.length; i += FIRESTORE_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    entries.slice(i, i + FIRESTORE_BATCH_CHUNK_SIZE).forEach(({ ref, data, merge }) => {
      batch.set(ref, data, merge ? { merge: true } : {});
    });
    await batch.commit();
  }
}

export async function commitBatchedUpdates<T extends DocumentData>(
  db: Firestore,
  entries: Array<{ ref: DocumentReference; data: UpdateData<T> }>
): Promise<void> {
  for (let i = 0; i < entries.length; i += FIRESTORE_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    entries.slice(i, i + FIRESTORE_BATCH_CHUNK_SIZE).forEach(({ ref, data }) => {
      batch.update(ref, data);
    });
    await batch.commit();
  }
}
