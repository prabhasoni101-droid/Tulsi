import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
  Unsubscribe,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Durable bulk-operation alerts for the Owner
 * ===========================================
 * Surfaced through the same real-time bell pattern as DuplicateConflictBell.
 *
 * A failed/partial bulk operation (deleteRows, permanentDeleteRows, ...) writes
 * one alert doc under `temples/{templeId}/bulkAlerts/{jobId}`. Using the durable
 * jobId as the document id gives us:
 *   - deduplication  -> one real failure = one alert (setDoc overwrites on retry),
 *   - durability     -> the doc survives the Owner closing/reopening the app,
 *   - real-time      -> `onSnapshot` shows it the moment it is written.
 */

export const BULK_ALERTS_SUBCOLLECTION = 'bulkAlerts';

export interface BulkJobAlert {
  id: string;
  jobId: string;
  operationType: string;
  templeId: string;
  totalCount: number;
  failedCount: number;
  message: string;
  error?: string;
  createdAt: any;
  dismissed?: boolean;
}

/**
 * Persists (upserts) one alert per durable job. SetDoc on the same jobId means
 * retries / re-renders never create a second alert.
 */
export async function upsertBulkJobAlert(alert: {
  jobId: string;
  operationType: string;
  templeId: string;
  totalCount: number;
  failedCount: number;
  message: string;
  error?: string;
}): Promise<void> {
  const ref = doc(db, 'temples', alert.templeId, BULK_ALERTS_SUBCOLLECTION, alert.jobId);
  await setDoc(
    ref,
    {
      jobId: alert.jobId,
      operationType: alert.operationType,
      templeId: alert.templeId,
      totalCount: alert.totalCount,
      failedCount: alert.failedCount,
      message: alert.message,
      error: alert.error ? String(alert.error).slice(0, 500) : null,
      createdAt: serverTimestamp(),
      dismissed: false,
    },
    { merge: true }
  );
}

/** Marks an alert dismissed (kept for audit, excluded from the bell). */
export async function dismissBulkJobAlert(templeId: string, alertId: string): Promise<void> {
  const ref = doc(db, 'temples', templeId, BULK_ALERTS_SUBCOLLECTION, alertId);
  await setDoc(ref, { dismissed: true }, { merge: true });
}

/** Real-time subscription for undismissed bulk alerts of a temple. */
export function listenToBulkJobAlerts(
  templeId: string,
  callback: (alerts: BulkJobAlert[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'temples', templeId, BULK_ALERTS_SUBCOLLECTION),
    where('dismissed', '==', false)
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as BulkJobAlert))
      );
    },
    (error) => {
      if (error?.code !== 'permission-denied') {
        console.error('[BulkJobAlerts] listener error:', error);
      }
    }
  );
}

export function alertTimestamp(ts: any): Date {
  if (!ts) return new Date();
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts === 'object' && typeof ts.toMillis === 'function') return ts.toMillis ? new Date(ts.toMillis()) : new Date();
  if (typeof ts === 'object' && 'seconds' in ts) return new Date((ts as any).seconds * 1000);
  return new Date(ts);
}