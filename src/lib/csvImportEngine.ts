import { db } from '../services/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { Devotee } from '../types';
import { normalizePhoneNumber } from './utils';

export interface ImportProgress {
  step: string;
  processed: number;
  total: number;
  percent: number;
  etaSeconds: number | null;
}

export interface DbImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  duplicates: number;
  invalid: number;
  totalRows: number;
  processingMs: number;
  errors: { row: number; reason: string }[];
}

export interface DbImportResult {
  report: DbImportReport;
  addedData: Record<string, any>;
  updatedData: { id: string; oldValues: Record<string, any>; newValues: Record<string, any> }[];
  autoDetectedColumns: string[];
}

const NAME_ALIASES = ['name', 'devotee name', 'devotee'];
const CONTACT_ALIASES = ['contact no.', 'contact', 'phoneno', 'mobile', 'phone', 'ph no.'];
const AGE_ALIASES = ['age'];
const MENTOR_ALIASES = ['mentor'];
const FACILITATOR_ALIASES = ['facilitator'];
const CHANTING_ALIASES = ['chanting'];
const ATTENDANCE_ALIASES = ['attendance'];
const GENDER_ALIASES = ['gender'];
const DOB_ALIASES = ['date of birth', 'dob'];
const ADDRESS_ALIASES = ['address'];
const INSTITUTE_ALIASES = ['institute'];

// Every built-in (non-custom) database column and the exact Devotee field
// it must be written to. Kept in sync with the display/edit mapping used
// elsewhere in DatabaseManagement.tsx (Name/Contact/Age/Mentor/Facilitator/
// Chanting/Attendance are handled separately above with their own logic).
const BASE_FIELD_ALIASES: { field: string; aliases: string[] }[] = [
  { field: 'gender', aliases: GENDER_ALIASES },
  { field: 'dob', aliases: DOB_ALIASES },
  { field: 'address', aliases: ADDRESS_ALIASES },
  { field: 'institute', aliases: INSTITUTE_ALIASES }
];
const BATCH_LIMIT = 450;
// Yield back to the browser after this many rows of pure JS mapping work,
// so a 15k-row import never blocks the main thread long enough to freeze
// scrolling/typing/animations.
const YIELD_EVERY_ROWS = 200;

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => {
    if (typeof (window as any).requestIdleCallback === 'function') {
      (window as any).requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function buildHeaderIndex(headers: string[]) {
  const map = new Map<string, string>();
  headers.forEach(h => map.set(h.trim().toLowerCase(), h));
  return map;
}

function getValFast(row: any, headerIndex: Map<string, string>, aliases: string[]): any {
  for (const alias of aliases) {
    const key = headerIndex.get(alias);
    if (key !== undefined && row[key] !== undefined) return row[key];
  }
  return undefined;
}

interface UserLookup {
  byEmail: Map<string, any>;
  byDisplayName: Map<string, any>;
  byUid: Map<string, any>;
}

function buildUserLookup(templeUsers: any[]): UserLookup {
  const byEmail = new Map<string, any>();
  const byDisplayName = new Map<string, any>();
  const byUid = new Map<string, any>();
  templeUsers.forEach(u => {
    const email = (u.email || '').trim().toLowerCase();
    const name = (u.displayName || '').trim().toLowerCase();
    if (email) byEmail.set(email, u);
    if (name) byDisplayName.set(name, u);
    if (u.uid) byUid.set(u.uid, u);
  });
  return { byEmail, byDisplayName, byUid };
}

/**
 * Matches a CSV Facilitator/Mentor value against known app users.
 * If no exact match is found, returns undefined — the caller must NOT
 * guess or auto-select anything in that case.
 */
function matchUserByIdentifier(val: string, lookup: UserLookup): any | undefined {
  const v = val.trim().toLowerCase();
  if (!v) return undefined;
  if (lookup.byEmail.has(v)) return lookup.byEmail.get(v);
  const asEmail = v.includes('@') ? v : `${v}@iskcon.app`;
  if (lookup.byEmail.has(asEmail)) return lookup.byEmail.get(asEmail);
  if (lookup.byDisplayName.has(v)) return lookup.byDisplayName.get(v);
  if (lookup.byUid.has(val.trim())) return lookup.byUid.get(val.trim());
  return undefined;
}

function normalizeForCompare(val: any): string {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

interface RunDbImportParams {
  rows: any[];
  devotees: Devotee[];
  templeUsers: any[];
  customColumns: string[];
  templeId: string;
  onProgress?: (progress: ImportProgress) => void;
}

/**
 * Production-grade CSV -> Database import engine.
 * - O(1) lookups via precomputed Maps (no per-row linear scans).
 * - Chunked async processing with UI-thread yields (no freezing on 15k+ rows).
 * - True field-level diff: only changed fields are written; identical rows
 *   are skipped entirely (no wasted Firestore writes).
 * - Never guesses a Facilitator/Mentor match — leaves the field untouched
 *   if the CSV value doesn't match an existing app user.
 * - One bad row never aborts the import; it is counted as invalid and
 *   processing continues.
 */
export async function runDatabaseImport(params: RunDbImportParams): Promise<DbImportResult> {
  const { rows, devotees, templeUsers, customColumns, templeId, onProgress } = params;
  const startTime = performance.now();

  const report: DbImportReport = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    duplicates: 0,
    invalid: 0,
    totalRows: rows.length,
    processingMs: 0,
    errors: []
  };
  const addedData: Record<string, any> = {};
  const updatedData: { id: string; oldValues: Record<string, any>; newValues: Record<string, any> }[] = [];

  const report_ = () => {
    report.processingMs = Math.round(performance.now() - startTime);
    return report;
  };

  if (rows.length === 0) {
    return { report: report_(), addedData, updatedData, autoDetectedColumns: [] };
  }

  onProgress?.({ step: 'Indexing existing records', processed: 0, total: rows.length, percent: 0, etaSeconds: null });
  await yieldToBrowser();

  // O(1) existing-record lookup instead of a linear scan per row.
  const existingMap = new Map<string, Devotee>();
  devotees.forEach(d => {
    const name = (d.name || '').trim().toLowerCase();
    const contact = normalizePhoneNumber(d.contact || '');
    if (name || contact) existingMap.set(`${name}_${contact}`, d);
  });

  const userLookup = buildUserLookup(templeUsers);
  const headers = Object.keys(rows[0] || {});
  const headerIndex = buildHeaderIndex(headers);
  const customColumnKeys = customColumns.map(cc => ({ cc, hKey: headerIndex.get(cc.trim().toLowerCase()) }));

  // Any CSV header that isn't Name/Contact, isn't a known base field, and
  // isn't already a registered custom column is a brand-new column the
  // user just added to their file. Auto-detect it so its values still get
  // written on this very import (instead of silently dropping the data
  // until someone manually registers the column in the app first).
  const recognizedKeys = new Set<string>([
    ...NAME_ALIASES, ...CONTACT_ALIASES, ...AGE_ALIASES, ...MENTOR_ALIASES,
    ...FACILITATOR_ALIASES, ...CHANTING_ALIASES, ...ATTENDANCE_ALIASES,
    ...BASE_FIELD_ALIASES.flatMap(b => b.aliases),
    ...customColumns.map(cc => cc.trim().toLowerCase())
  ]);
  const autoDetectedColumns = headers.filter(h => !recognizedKeys.has(h.trim().toLowerCase()));
  const allCustomColumnKeys = [
    ...customColumnKeys,
    ...autoDetectedColumns.map(h => ({ cc: h.trim(), hKey: h }))
  ];

  const seenInImportLocally = new Set<string>();
  let batch = writeBatch(db);
  let opCount = 0;
  const flush = async () => {
    if (opCount > 0) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  };

  const startProcessing = performance.now();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];

    try {
      const rawName = getValFast(row, headerIndex, NAME_ALIASES);
      const name = rawName ? rawName.toString().trim() : '';
      const rawContact = getValFast(row, headerIndex, CONTACT_ALIASES) || '';
      const contact = normalizePhoneNumber(rawContact.toString());

      // Validation: a row needs at least a name to be usable.
      if (!name) {
        report.invalid++;
        report.errors.push({ row: rowIndex + 2, reason: 'Missing required Name field.' });
        continue;
      }

      const key = `${name.toLowerCase()}_${contact}`;

      const mappedData: any = {
        name,
        contact,
        templeId,
        isDeleted: false
      };

      const age = getValFast(row, headerIndex, AGE_ALIASES);
      const mentorRaw = getValFast(row, headerIndex, MENTOR_ALIASES);
      const facilitatorRaw = getValFast(row, headerIndex, FACILITATOR_ALIASES);
      const chanting = getValFast(row, headerIndex, CHANTING_ALIASES);
      const attendanceRaw = getValFast(row, headerIndex, ATTENDANCE_ALIASES);

      if (age !== undefined) mappedData.age = age;
      if (chanting !== undefined) mappedData.chanting = chanting;

      BASE_FIELD_ALIASES.forEach(({ field, aliases }) => {
        const val = getValFast(row, headerIndex, aliases);
        if (val !== undefined) mappedData[field] = val;
      });

      if (attendanceRaw !== undefined && attendanceRaw !== '') {
        const match = attendanceRaw.toString().match(/-?\d+(\.\d+)?/);
        const parsed = match ? parseFloat(match[0]) : NaN;
        if (!isNaN(parsed)) mappedData.attendanceCount = parsed;
      }

      // Facilitator/Mentor: match against known app users only. If the CSV
      // value doesn't correspond to any existing user, the field is left
      // exactly as typed for mentor (free text is allowed there today) but
      // the facilitatorId is NEVER guessed — it stays unset so the UI shows
      // it blank rather than silently picking someone.
      if (mentorRaw !== undefined && mentorRaw !== '') {
        const mentorUser = matchUserByIdentifier(mentorRaw.toString(), userLookup);
        mappedData.mentor = mentorUser ? (mentorUser.displayName || mentorUser.email) : mentorRaw;
      }

      if (facilitatorRaw !== undefined && facilitatorRaw !== '') {
        const facilitatorUser = matchUserByIdentifier(facilitatorRaw.toString(), userLookup);
        if (facilitatorUser) {
          mappedData.facilitatorId = facilitatorUser.uid;
          mappedData.facilitatorName = facilitatorUser.displayName || facilitatorUser.email;
          mappedData.facilitator = facilitatorUser.displayName || facilitatorUser.email;
        }
        // No match -> intentionally leave facilitator fields untouched
        // (do not guess, do not blank out an existing valid assignment).
      }

      allCustomColumnKeys.forEach(({ cc, hKey }) => {
        if (hKey !== undefined && row[hKey] !== undefined) mappedData[cc] = row[hKey];
      });

      const existingDb = existingMap.get(key);

      if (existingDb) {
        // Smart diff: only write fields that actually changed. Fields with
        // no incoming value are left alone; fields whose incoming value
        // equals the current value are skipped (no wasted write).
        const updateObj: any = {};
        const oldValues: Record<string, any> = {};
        let hasChange = false;

        Object.keys(mappedData).forEach(field => {
          if (field === 'templeId' || field === 'isDeleted') return;
          const incoming = mappedData[field];
          if (incoming === undefined || incoming === null || incoming === '') return;

          const current = (existingDb as any)[field];
          if (normalizeForCompare(current) === normalizeForCompare(incoming)) return;

          updateObj[field] = incoming;
          oldValues[field] = current ?? '';
          hasChange = true;
        });

        if (hasChange) {
          batch.update(doc(db, 'devotees', existingDb.id!), updateObj);
          opCount++;
          report.updated++;
          updatedData.push({ id: existingDb.id!, oldValues, newValues: updateObj });
        } else {
          report.skipped++;
        }
      } else if (seenInImportLocally.has(key)) {
        report.duplicates++;
      } else {
        const ref = doc(collection(db, 'devotees'));
        const newDoc = { ...mappedData, isImported: true, createdAt: Date.now() };
        batch.set(ref, newDoc);
        opCount++;
        report.inserted++;
        seenInImportLocally.add(key);
        addedData[ref.id] = newDoc;
      }

      if (opCount >= BATCH_LIMIT) {
        await flush();
      }
    } catch (rowErr: any) {
      report.invalid++;
      report.errors.push({ row: rowIndex + 2, reason: rowErr?.message || 'Unknown error while processing row.' });
    }

    if ((rowIndex + 1) % YIELD_EVERY_ROWS === 0 || rowIndex === rows.length - 1) {
      const processed = rowIndex + 1;
      const elapsed = (performance.now() - startProcessing) / 1000;
      const rate = processed / Math.max(elapsed, 0.001);
      const remaining = rows.length - processed;
      const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;

      onProgress?.({
        step: 'Processing rows',
        processed,
        total: rows.length,
        percent: Math.round((processed / rows.length) * 100),
        etaSeconds
      });

      await yieldToBrowser();
    }
  }

  onProgress?.({ step: 'Saving to database', processed: rows.length, total: rows.length, percent: 100, etaSeconds: 0 });
  await flush();

  return { report: report_(), addedData, updatedData, autoDetectedColumns };
}