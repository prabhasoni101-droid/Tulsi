import { db } from '../services/firebase';
import {
  collection,
  doc,
  writeBatch,
  increment
} from 'firebase/firestore';
// NEW
import { Event } from '../types';
import { normalizePhoneNumber } from './utils';
import { getEventVisibilityDefaults } from '../services/eventVisibility';

export type ImportRowStatus = 'OK' | 'SKIPPED_INVALID' | 'CONFLICT';

export interface ImportConflict {
  row: number;
  name: string;
  contact: string;
  reason: string;
}

export interface ImportReport {
  imported: number;
  updated: number;
  skipped: number;
  duplicates: number;
  conflicts: ImportConflict[];
  newDevotees: number;
  eventsCreated: string[];
  attendanceMarked: number;
  presentCount: number;
  absentCount: number;
  totalRows: number;
}

const PRESENT_VALUES = new Set(['p', 'present']);
const ABSENT_VALUES = new Set(['a', 'absent']);

const NAME_ALIASES = ['name', 'devotee name', 'devotee', 'नाम'];
const CONTACT_ALIASES = ['contact', 'contact no.', 'contact no', 'mobile', 'phone', 'ph no.', 'संपर्क', 'फोन', 'मोबाइल'];

export function normalizeAttendanceCell(raw: any): 'PRESENT' | 'ABSENT' | null {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (PRESENT_VALUES.has(v)) return 'PRESENT';
  if (ABSENT_VALUES.has(v)) return 'ABSENT';
  return null;
}

/**
 * Detects Name, Contact and Attendance columns purely from CSV content.
 * Attendance columns are identified by VALUE (P/Present/A/Absent variants),
 * not by header name — any column where at least one non-empty cell
 * resolves to PRESENT/ABSENT via normalizeAttendanceCell is treated as
 * an attendance/event column.
 */
export function detectColumns(rows: any[], headers: string[]) {
  const nameKey = headers.find(h => NAME_ALIASES.includes(h.trim().toLowerCase()));
  const contactKey = headers.find(h => CONTACT_ALIASES.includes(h.trim().toLowerCase()));

  const candidateCols = headers.filter(h => h !== nameKey && h !== contactKey);
  const attendanceCols = candidateCols.filter(col => {
    for (const row of rows) {
      if (normalizeAttendanceCell(row[col]) !== null) return true;
    }
    return false;
  });

  return { nameKey, contactKey, attendanceCols };
}

export interface DevoteeMatchIndexes {
  byNameContact: Map<string, string>;
  byContact: Map<string, string[]>;
  byName: Map<string, string[]>;
}

export function buildDevoteeIndexes(devotees: any[]): DevoteeMatchIndexes {
  const byNameContact = new Map<string, string>();
  const byContact = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  devotees.forEach(d => {
    const n = (d.name || '').trim().toLowerCase();
    const c = normalizePhoneNumber(d.contact || '');
    if (n && c) byNameContact.set(`${n}_${c}`, d.id);
    if (c) byContact.set(c, [...(byContact.get(c) || []), d.id]);
    if (n) byName.set(n, [...(byName.get(n) || []), d.id]);
  });
  return { byNameContact, byContact, byName };
}

export type ResolveResult =
  | { type: 'MATCH'; devoteeId: string }
  | { type: 'CONFLICT'; reason: string }
  | { type: 'NEW' };

/**
 * Person matching engine.
 * Rule 1: Name + Contact both match -> perfect match.
 * Rule 2: Name is ambiguous (shared by many) -> disambiguate via contact.
 * Rule 3: Contact is ambiguous (shared by many) -> disambiguate via name.
 * Rule 4: No unique resolution possible -> report conflict, never guess.
 */
export function resolveDevotee(
  rawName: string,
  normContact: string,
  idx: DevoteeMatchIndexes
): ResolveResult {
  const n = rawName.trim().toLowerCase();
  const c = normContact;
  const compositeKey = `${n}_${c}`;

  if (n && c && idx.byNameContact.has(compositeKey)) {
    return { type: 'MATCH', devoteeId: idx.byNameContact.get(compositeKey)! };
  }

  const nameMatches = n ? (idx.byName.get(n) || []) : [];
  const contactMatches = c ? (idx.byContact.get(c) || []) : [];

  if (nameMatches.length > 1 && c) {
    const overlap = contactMatches.find(id => nameMatches.includes(id));
    if (overlap) return { type: 'MATCH', devoteeId: overlap };
  }

  if (contactMatches.length > 1 && n) {
    const overlap = contactMatches.find(id => nameMatches.includes(id));
    if (overlap) return { type: 'MATCH', devoteeId: overlap };
  }

  if (contactMatches.length === 1 && (nameMatches.length === 0 || nameMatches.includes(contactMatches[0]))) {
    return { type: 'MATCH', devoteeId: contactMatches[0] };
  }
  if (nameMatches.length === 1 && (contactMatches.length === 0 || contactMatches.includes(nameMatches[0]))) {
    return { type: 'MATCH', devoteeId: nameMatches[0] };
  }

  if (nameMatches.length > 1 && contactMatches.length > 1) {
    return { type: 'CONFLICT', reason: 'Multiple devotees share this name and contact; could not uniquely resolve.' };
  }
  if (nameMatches.length > 1) {
    return { type: 'CONFLICT', reason: 'Multiple devotees share this name and no contact was provided to disambiguate.' };
  }
  if (contactMatches.length > 1) {
    return { type: 'CONFLICT', reason: 'Multiple devotees share this contact and no name was provided to disambiguate.' };
  }

  return { type: 'NEW' };
}

export function isValidName(name: string): boolean {
  return !!name && name.trim().length > 0;
}

export function isValidContact(contact: string): boolean {
  return !!contact && contact.trim().length > 0;
}

export function isValidEventTitle(title: string): boolean {
  return !!title && title.trim().length > 0;
}

interface RunImportParams {
  rows: any[];
  nameKey: string;
  contactKey: string;
  attendanceCols: string[];
  existingEvents: Event[];
  devotees: any[];
  templeId: string;
  userId: string;
}

/**
 * Executes the full import: creates missing events, resolves/creates
 * devotees, writes attendance + assignment docs, and returns a complete
 * ImportReport. Never throws away the whole import for one bad row —
 * invalid rows are skipped and counted, not fatal.
 */
export async function runAttendanceImport(params: RunImportParams): Promise<ImportReport> {
  const { rows, nameKey, contactKey, attendanceCols, existingEvents, devotees, templeId, userId } = params;

  const report: ImportReport = {
    imported: 0,
    updated: 0,
    skipped: 0,
    duplicates: 0,
    conflicts: [],
    newDevotees: 0,
    eventsCreated: [],
    attendanceMarked: 0,
    presentCount: 0,
    absentCount: 0,
    totalRows: rows.length
  };

  // Resolve or create an event for every detected attendance column.
  const eventTitleToId = new Map<string, string>();
  existingEvents.forEach(ev => { if (ev.title) eventTitleToId.set(ev.title.trim().toLowerCase(), ev.id!); });

  const validEventCols = attendanceCols.filter(col => isValidEventTitle(col));

  let eventBatch = writeBatch(db);
  let eventOps = 0;
  for (const col of validEventCols) {
    const key = col.trim().toLowerCase();
    if (!eventTitleToId.has(key)) {
      const evRef = doc(collection(db, 'events'));
      eventBatch.set(evRef, {
        title: col.trim(),
        date: new Date().toISOString(),
        description: 'Imported from attendance CSV upload.',
        mediaUrl: '',
        ...getEventVisibilityDefaults(),
        createdBy: userId,
        templeId,
        createdAt: new Date().toISOString(),
        isAttendanceOpen: false,
        isDeleted: false,
        importedFromCsv: true
      });
      eventTitleToId.set(key, evRef.id);
      report.eventsCreated.push(col.trim());
      eventOps++;
      if (eventOps >= 400) {
        await eventBatch.commit();
        eventBatch = writeBatch(db);
        eventOps = 0;
      }
    }
  }
  if (eventOps > 0) await eventBatch.commit();

  const idx = buildDevoteeIndexes(devotees);
  const seenCompositeKeys = new Set<string>();

  let batch = writeBatch(db);
  let opCount = 0;
  const flush = async () => {
    if (opCount > 0) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    try {
      const rawName = (row[nameKey] || '').toString().trim();
      const rawContact = (row[contactKey] || '').toString().trim();

      if (!isValidName(rawName) && !isValidContact(rawContact)) {
        report.skipped++;
        continue;
      }

      const normContact = normalizePhoneNumber(rawContact);
      const compositeKey = `${rawName.toLowerCase()}_${normContact}`;

      const presentCols: string[] = [];
      const absentCols: string[] = [];
      validEventCols.forEach(col => {
        const status = normalizeAttendanceCell(row[col]);
        if (status === 'PRESENT') presentCols.push(col);
        else if (status === 'ABSENT') absentCols.push(col);
      });

      if (presentCols.length === 0 && absentCols.length === 0) {
        report.skipped++;
        continue;
      }

      const resolution = resolveDevotee(rawName, normContact, idx);

      if (resolution.type === 'CONFLICT') {
        report.conflicts.push({
          row: rowIndex + 2,
          name: rawName,
          contact: rawContact,
          reason: resolution.reason
        });
        continue;
      }

      let devoteeId: string;
      const isDuplicateRow = seenCompositeKeys.has(compositeKey);
      if (isDuplicateRow) report.duplicates++;
      seenCompositeKeys.add(compositeKey);

      if (resolution.type === 'NEW') {
        devoteeId = doc(collection(db, 'devotees')).id;
        batch.set(doc(db, 'devotees', devoteeId), {
          name: rawName || 'Unknown',
          contact: normContact,
          mentor: '',
          chanting: '0',
          attendanceCount: presentCols.length,
          templeId,
          isDeleted: false,
          isImported: true,
          createdAt: new Date().toISOString()
        });
        opCount++;
        const n = rawName.trim().toLowerCase();
        if (normContact) idx.byContact.set(normContact, [...(idx.byContact.get(normContact) || []), devoteeId]);
        if (n) idx.byName.set(n, [...(idx.byName.get(n) || []), devoteeId]);
        idx.byNameContact.set(compositeKey, devoteeId);
        report.newDevotees++;
      } else {
        devoteeId = resolution.devoteeId;
        if (presentCols.length > 0) {
          batch.update(doc(db, 'devotees', devoteeId), { attendanceCount: increment(presentCols.length) });
          opCount++;
        }
        report.updated++;
      }

      presentCols.forEach(col => {
        const eventId = eventTitleToId.get(col.trim().toLowerCase())!;
        batch.set(doc(db, `events/${eventId}/assignments`, devoteeId), {
          eventId, devoteeId, userId,
          devoteeName: rawName, devoteeContact: normContact,
          status: 'COMPLETED', response: 'COMING', updatedAt: new Date().toISOString()
        });
        batch.set(doc(db, `events/${eventId}/attendance`, devoteeId), {
          devoteeId, name: rawName, contact: normContact, present: true,
          markedAt: new Date().toISOString(), markedBy: userId, templeId
        });
        opCount += 2;
        report.presentCount++;
        report.attendanceMarked++;
      });

      absentCols.forEach(col => {
        const eventId = eventTitleToId.get(col.trim().toLowerCase())!;
        batch.set(doc(db, `events/${eventId}/assignments`, devoteeId), {
          eventId, devoteeId, userId,
          devoteeName: rawName, devoteeContact: normContact,
          status: 'COMPLETED', response: 'NOT_COMING', updatedAt: new Date().toISOString()
        });
        batch.set(doc(db, `events/${eventId}/attendance`, devoteeId), {
          devoteeId, name: rawName, contact: normContact, present: false,
          markedAt: new Date().toISOString(), markedBy: userId, templeId
        });
        opCount += 2;
        report.absentCount++;
        report.attendanceMarked++;
      });

      report.imported++;

      if (opCount >= 400) await flush();
    } catch (rowErr) {
      console.error(`Attendance import: row ${rowIndex + 2} failed`, rowErr);
      report.skipped++;
    }
  }

  await flush();
  return report;
}