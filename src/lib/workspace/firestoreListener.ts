import {
  collection,
  onSnapshot,
  query,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { workspaceStore } from './workspaceStore';
import { normalizeDevoteeDoc } from '../dataNormalizer';
import { Devotee } from '../../types';

/**
 * Firestore Listener Integration
 * ==============================
 * (PDR Section F)
 *
 * Replaces the wholesale `setDevotees(snapshot.docs...)` pattern with TRUE
 * incremental synchronization. We consume `docChanges()` so that:
 *  - single-record adds/updates/removes are applied one at a time,
 *  - unchanged rows keep their object references where possible,
 *  - a one-row change never triggers a whole-spreadsheet re-render.
 *
 * The first server sync may be large (cold start), but it HYDRATES the local
 * store instead of continuously rebuilding huge React arrays. Incremental
 * changes afterwards patch the store.
 */

export interface DevoteeListenerControls {
  /** Per-row insert/update/remove callbacks (optional). */
  onUpsert?: (records: Devotee[]) => void;
  onRemove?: (ids: string[]) => void;
}

/**
 * Subscribes to the devotees collection for a tenant and applies changes to the
 * workspace store incrementally via `docChanges()`.
 *
 * Returns an unsubscribe function.
 */
export function subscribeDevoteesIncremental(
  templeId: string,
  controls: DevoteeListenerControls = {}
): Unsubscribe {
  const q = query(collection(db, 'devotees'), where('templeId', '==', templeId));

  return onSnapshot(
    q,
    (snapshot) => {
      let upserted: Devotee[] = [];
      let removed: string[] = [];

      snapshot.docChanges().forEach((change) => {
        const doc = change.doc;
        const data = doc.data();
        const isDeleted = data?.isDeleted === true;
        const id = doc.id;

        if (change.type === 'removed') {
          removed.push(id);
          return;
        }

        if (isDeleted) {
          removed.push(id);
          return;
        }

        const normalized = normalizeDevoteeDoc({ id, ...data }) as Devotee;
        // Preserve existing object references where the record is unchanged:
        // the store's upsert path only triggers a notify when the record or
        // membership actually changes (see workspaceStore.upsertRecord/set).
        upserted.push(normalized);
      });

      if (upserted.length > 0) {
        workspaceStore.upsertRecords(upserted);
        controls.onUpsert?.(upserted);
      }
      if (removed.length > 0) {
        workspaceStore.removeRecords(removed);
        controls.onRemove?.(removed);
      }
    },
    (error) => {
      // The JS SDK reports code 'permission-denied' with a human message of
      // "Missing or insufficient permissions." — checking `.code` (not
      // `message.includes`) is what actually matches the error.
      if (error?.code !== 'permission-denied') {
        console.error('[WorkspaceListener] devotees subscription error:', error);
      }
    }
  );
}
