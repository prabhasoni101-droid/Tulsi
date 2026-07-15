import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { Event } from '../types';

export const DEFAULT_EVENT_VISIBILITY = false as const;

const VISIBILITY_FIELDS = ['isPublic', 'visibilityUpdatedAt', 'visibilityUpdatedBy'] as const;

export function getEventVisibilityDefaults() {
  return {
    isPublic: DEFAULT_EVENT_VISIBILITY,
    visibilityUpdatedAt: serverTimestamp(),
    visibilityUpdatedBy: null as string | null,
  };
}

export function isEventPublic(event: Pick<Event, 'isPublic'> | null | undefined): boolean {
  return event?.isPublic === true;
}

const writeLocks = new Set<string>();

async function writeVisibility(eventId: string, isPublic: boolean, actorUid: string | null) {
  if (!eventId) throw new Error('[EventVisibilityManager] eventId is required');
  if (writeLocks.has(eventId)) return;
  writeLocks.add(eventId);
  try {
    await updateDoc(doc(db, 'events', eventId), {
      isPublic,
      visibilityUpdatedAt: serverTimestamp(),
      visibilityUpdatedBy: actorUid,
    });
  } finally {
    writeLocks.delete(eventId);
  }
}

export async function setEventVisibility(eventId: string, isPublic: boolean, actorUid: string | null = null) {
  await writeVisibility(eventId, isPublic, actorUid);
}

export async function toggleEventVisibility(event: Pick<Event, 'id' | 'isPublic'>, actorUid: string | null = null) {
  if (!event?.id) throw new Error('[EventVisibilityManager] event.id is required');
  await writeVisibility(event.id, !isEventPublic(event), actorUid);
}

export async function revokeEventVisibility(eventId: string, actorUid: string | null = null) {
  await writeVisibility(eventId, false, actorUid);
}

export async function softDeleteEventAndRevokeVisibility(eventId: string, actorUid: string | null = null) {
  if (!eventId) throw new Error('[EventVisibilityManager] eventId is required');
  if (writeLocks.has(eventId)) return;
  writeLocks.add(eventId);
  try {
    await updateDoc(doc(db, 'events', eventId), {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      isAttendanceOpen: false,
      isPublic: false,
      visibilityUpdatedAt: serverTimestamp(),
      visibilityUpdatedBy: actorUid,
    });
  } finally {
    writeLocks.delete(eventId);
  }
}

export async function updateEventFields(eventId: string, fields: Record<string, any>) {
  const offending = VISIBILITY_FIELDS.filter((f) => f in fields);
  if (offending.length > 0) {
    throw new Error(
      `[EventVisibilityManager] Blocked attempt to write visibility field(s) [${offending.join(', ')}] ` +
        `via updateEventFields(). Use setEventVisibility() / toggleEventVisibility() / revokeEventVisibility() ` +
        `/ softDeleteEventAndRevokeVisibility() instead.`
    );
  }
  await updateDoc(doc(db, 'events', eventId), fields);
}

export function subscribeToEvent(eventId: string, callback: (event: Event | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'events', eventId), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Event) : null);
  });
}

export function subscribeToVisibleEvents(templeId: string, callback: (events: Event[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'events'), (snap) => {
    const events = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Event))
      .filter((e) => e.templeId === templeId && !e.isDeleted && e.isPublic === true);
    callback(events);
  });
}

export function subscribeToAllTempleEvents(templeId: string, callback: (events: Event[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'events'), (snap) => {
    const events = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Event))
      .filter((e) => e.templeId === templeId && !e.isDeleted);
    callback(events);
  });
}