import {
  collection, query, where, onSnapshot, doc, getDoc,
  serverTimestamp, writeBatch, Unsubscribe, QuerySnapshot, DocumentData
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { Devotee } from '../types';
import { normalizePhoneNumber } from './utils';

// How long the owner has to manually pick a facilitator before the earliest
// submission is auto-confirmed and the notification disappears on its own.
export const CONFLICT_AUTO_RESOLVE_MS = 5 * 60 * 1000; // 5 minutes

export interface ConflictCandidate {
  devoteeId: string;
  facilitatorId: string;
  facilitatorName: string;
  createdAt: string; // ISO string, used to find the earliest submission
}

export interface ConflictAssignment {
  id: string; // Firestore doc id, also the stable conflict key
  templeId: string;
  devoteeName: string;
  contact: string;
  candidates: ConflictCandidate[];
  status: 'pending' | 'resolved';
  createdAt: any;
  expiresAtMs: number;
  resolvedFacilitatorId?: string;
  resolvedBy?: 'owner' | 'auto';
  resolvedAt?: any;
}

const CONFLICTS_COLLECTION = 'conflictAssignments';

// A stable, deterministic key per (temple, name, contact) group so repeated
// runs of the grouping logic always upsert the SAME conflict document,
// instead of creating duplicate notification entries for the same pair.
export function buildConflictKey(templeId: string, name: string, contact: string): string {
  const n = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const c = normalizePhoneNumber(contact || '');
  const raw = `${templeId}__${n}__${c}`;
  // Simple, dependency-free hash — good enough for a Firestore doc id (no
  // collisions in practice for this app's scale, and fully deterministic).
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `c_${Math.abs(hash)}`;
}

// Groups all 'complete' duplicate devotees (same name + contact, added by
// different facilitators) that are not yet marked duplicateHandled, and
// writes/updates a conflictAssignments doc for each group so the owner's
// notification bell and the 5-minute auto-resolve timer both have a durable,
// shared source of truth (works even if no owner has the app open yet).
export async function syncConflictsFromDevotees(templeId: string, devotees: Devotee[]): Promise<void> {
  const groups = new Map<string, Devotee[]>();

  devotees.forEach((d) => {
    if (d.isDeleted) return;
    if (d.duplicateType !== 'complete') return;
    if (d.duplicateHandled) return;
    if (!d.facilitatorId) return;
    const key = buildConflictKey(templeId, d.name, d.contact);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  });

  const batch = writeBatch(db);
  let hasWrites = false;

  for (const [key, group] of groups.entries()) {
    // Only a real conflict once 2+ distinct facilitators hold the same
    // devotee — a single facilitator with a stray duplicate flag isn't a
    // cross-user conflict and shouldn't notify the owner.
    const distinctFacilitators = new Set(group.map((d) => d.facilitatorId));
    if (distinctFacilitators.size < 2) continue;

    const ref = doc(db, CONFLICTS_COLLECTION, key);
    const existing = await getDoc(ref);
    if (existing.exists() && (existing.data() as any).status === 'resolved') continue;

    const candidates: ConflictCandidate[] = group.map((d) => ({
      devoteeId: d.id!,
      facilitatorId: d.facilitatorId!,
      facilitatorName: d.facilitatorName || 'Unknown',
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
    }));

    if (!existing.exists()) {
      const nowMs = Date.now();
      batch.set(ref, {
        templeId,
        devoteeName: group[0].name,
        contact: group[0].contact,
        candidates,
        status: 'pending',
        createdAt: serverTimestamp(),
        expiresAtMs: nowMs + CONFLICT_AUTO_RESOLVE_MS,
      } as ConflictAssignment);
      hasWrites = true;
    } else {
      // Keep the candidate list current (e.g. a third facilitator adds the
      // same devotee while the notification is still pending) without
      // resetting the countdown that's already in progress.
      batch.update(ref, { candidates });
      hasWrites = true;
    }
  }

  if (hasWrites) await batch.commit();
}

export function listenToConflicts(
  templeId: string,
  callback: (conflicts: ConflictAssignment[]) => void
): Unsubscribe {
  const q = query(
    collection(db, CONFLICTS_COLLECTION),
    where('templeId', '==', templeId),
    where('status', '==', 'pending')
  );
  return onSnapshot(q, (snap: QuerySnapshot<DocumentData>) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ConflictAssignment)));
  });
}

// Owner explicitly taps "Assign" for one facilitator: that facilitator keeps
// the devotee, every other candidate's devotee record is soft-deleted and
// removed from their facilitation list, and the conflict is closed.
export async function resolveConflict(
  conflict: ConflictAssignment,
  winningFacilitatorId: string,
  resolvedBy: 'owner' | 'auto'
): Promise<void> {
  const conflictRef = doc(db, CONFLICTS_COLLECTION, conflict.id);

  // Guard against a race between the owner clicking "Assign" and the
  // 5-minute auto-resolve timer firing at nearly the same moment — whichever
  // one gets here first wins, and the other becomes a no-op instead of
  // double-writing (which could otherwise flip the outcome or double-delete).
  const latest = await getDoc(conflictRef);
  if (!latest.exists() || (latest.data() as any).status === 'resolved') return;

  const batch = writeBatch(db);

  conflict.candidates.forEach((c) => {
    const devoteeRef = doc(db, 'devotees', c.devoteeId);
    if (c.facilitatorId === winningFacilitatorId) {
      batch.set(devoteeRef, { duplicateHandled: true, isDuplicate: false, duplicateType: null }, { merge: true });
    } else {
      batch.set(devoteeRef, {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        duplicateHandled: true,
        deletionReason: resolvedBy === 'auto'
          ? 'Auto-resolved duplicate facilitation conflict after 5 minutes'
          : 'Removed by owner while resolving a duplicate facilitation conflict',
      }, { merge: true });
    }
  });

  batch.update(conflictRef, {
    status: 'resolved',
    resolvedFacilitatorId: winningFacilitatorId,
    resolvedBy,
    resolvedAt: serverTimestamp(),
  });

  await batch.commit();
}

// Picks the facilitator who added the devotee first (earliest createdAt) —
// used both as the default highlighted choice in the bell dropdown and as
// the automatic winner if the owner never acts within the 5-minute window.
export function earliestCandidate(conflict: ConflictAssignment): ConflictCandidate {
  return [...conflict.candidates].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )[0];
}