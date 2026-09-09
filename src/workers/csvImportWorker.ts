import Papa from 'papaparse';

export interface StagedRowDiff {
  rowNumber: number;
  type: 'INSERT' | 'UPDATE' | 'UNCHANGED' | 'DUPLICATE' | 'INVALID' | 'CONFLICT';
  id?: string;
  name: string;
  contact: string;
  reason?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  mappedData?: Record<string, any>;
}

export interface StagedImportPlan {
  totalRows: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
  conflictCount: number;
  invalidCount: number;
  autoDetectedColumns: string[];
  detectedAttendanceCols: string[];
  diffs: StagedRowDiff[];
  insertedRecords: Array<{ id: string; data: Record<string, any> }>;
  updatedRecords: Array<{ id: string; oldValues: Record<string, any>; patch: Record<string, any> }>;
  conflicts: Array<{ row: number; name: string; contact: string; reason: string }>;
  errors: Array<{ row: number; reason: string }>;
  processingMs: number;
}

const NAME_ALIASES = ['name', 'devotee name', 'devotee', 'नाम'];
const CONTACT_ALIASES = ['contact no.', 'contact', 'phoneno', 'mobile', 'phone', 'ph no.', 'संपर्क', 'फोन', 'मोबाइल'];
const AGE_ALIASES = ['age'];
const MENTOR_ALIASES = ['mentor'];
const FACILITATOR_ALIASES = ['facilitator'];
const CHANTING_ALIASES = ['chanting'];
const ATTENDANCE_ALIASES = ['attendance'];
const GENDER_ALIASES = ['gender'];
const DOB_ALIASES = ['date of birth', 'dob'];
const ADDRESS_ALIASES = ['address'];
const INSTITUTE_ALIASES = ['institute'];

const BASE_FIELD_ALIASES: { field: string; aliases: string[] }[] = [
  { field: 'gender', aliases: GENDER_ALIASES },
  { field: 'dob', aliases: DOB_ALIASES },
  { field: 'address', aliases: ADDRESS_ALIASES },
  { field: 'institute', aliases: INSTITUTE_ALIASES },
];

const PRESENT_VALUES = new Set(['p', 'present', 'yes', 'y', '1', 'true']);
const ABSENT_VALUES = new Set(['a', 'absent', 'no', 'n', '0', 'false']);

function normalizePhone(raw: any): string {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

function normalizeAttendanceCell(raw: any): 'PRESENT' | 'ABSENT' | null {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (PRESENT_VALUES.has(v)) return 'PRESENT';
  if (ABSENT_VALUES.has(v)) return 'ABSENT';
  return null;
}

function normalizeForCompare(val: any): string {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

function buildHeaderIndex(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  headers.forEach((h) => map.set(h.trim().toLowerCase(), h));
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
  (templeUsers || []).forEach((u) => {
    const email = (u.email || '').trim().toLowerCase();
    const name = (u.displayName || '').trim().toLowerCase();
    if (email) byEmail.set(email, u);
    if (name) byDisplayName.set(name, u);
    if (u.uid) byUid.set(u.uid, u);
  });
  return { byEmail, byDisplayName, byUid };
}

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

/**
 * Core Staged Import Pipeline running inside Web Worker:
 * Phase 1: Parse
 * Phase 2: Normalize
 * Phase 3: Validate
 * Phase 4: Identity Match ($O(1)$)
 * Phase 5: Diff
 * Phase 6: Preview payload construction
 */
export function executeStagedImportWorker(data: {
  csvText: string;
  existingRecords: any[];
  templeUsers: any[];
  customColumns: string[];
  templeId: string;
  userId?: string;
  isAttendanceCsv?: boolean;
}): StagedImportPlan {
  const startTime = performance.now();
  const { csvText, existingRecords, templeUsers, customColumns, templeId, isAttendanceCsv } = data;

  // Phase 1: Parse
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const rows = (parsed.data as any[]) || [];
  const totalRows = rows.length;

  if (totalRows === 0) {
    return {
      totalRows: 0,
      insertedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      duplicateCount: 0,
      conflictCount: 0,
      invalidCount: 0,
      autoDetectedColumns: [],
      detectedAttendanceCols: [],
      diffs: [],
      insertedRecords: [],
      updatedRecords: [],
      conflicts: [],
      errors: [],
      processingMs: Math.round(performance.now() - startTime),
    };
  }

  const headers = Object.keys(rows[0] || {});
  const headerIndex = buildHeaderIndex(headers);

  // Phase 2: Normalize & Index
  const userLookup = buildUserLookup(templeUsers || []);

  // Detect attendance columns
  const nameKey = headers.find((h) => NAME_ALIASES.includes(h.trim().toLowerCase()));
  const contactKey = headers.find((h) => CONTACT_ALIASES.includes(h.trim().toLowerCase()));
  const candidateCols = headers.filter((h) => h !== nameKey && h !== contactKey);

  const detectedAttendanceCols = candidateCols.filter((col) => {
    for (let r = 0; r < Math.min(rows.length, 100); r++) {
      if (normalizeAttendanceCell(rows[r][col]) !== null) return true;
    }
    return false;
  });

  // Auto-detect custom columns
  const recognizedKeys = new Set<string>([
    ...NAME_ALIASES,
    ...CONTACT_ALIASES,
    ...AGE_ALIASES,
    ...MENTOR_ALIASES,
    ...FACILITATOR_ALIASES,
    ...CHANTING_ALIASES,
    ...ATTENDANCE_ALIASES,
    ...BASE_FIELD_ALIASES.flatMap((b) => b.aliases),
    ...detectedAttendanceCols.map((c) => c.trim().toLowerCase()),
    ...(customColumns || []).map((cc) => cc.trim().toLowerCase()),
  ]);

  const autoDetectedColumns = headers.filter((h) => !recognizedKeys.has(h.trim().toLowerCase()));
  const allCustomColumnKeys = [
    ...(customColumns || []).map((cc) => ({ cc: cc.trim(), hKey: headerIndex.get(cc.trim().toLowerCase()) })),
    ...autoDetectedColumns.map((h) => ({ cc: h.trim(), hKey: h })),
  ];

  // Phase 4: Build $O(1)$ Identity Lookup Maps
  const byNameContact = new Map<string, any>();
  const byContact = new Map<string, any[]>();
  const byName = new Map<string, any[]>();

  (existingRecords || []).forEach((rec) => {
    const n = (rec.name || rec.Name || '').trim().toLowerCase();
    const c = normalizePhone(rec.contact || rec['Contact No.'] || '');
    if (n && c) byNameContact.set(`${n}_${c}`, rec);
    if (c) {
      if (!byContact.has(c)) byContact.set(c, []);
      byContact.get(c)!.push(rec);
    }
    if (n) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n)!.push(rec);
    }
  });

  const diffs: StagedRowDiff[] = [];
  const insertedRecords: Array<{ id: string; data: Record<string, any> }> = [];
  const updatedRecords: Array<{ id: string; oldValues: Record<string, any>; patch: Record<string, any> }> = [];
  const conflicts: Array<{ row: number; name: string; contact: string; reason: string }> = [];
  const errors: Array<{ row: number; reason: string }> = [];

  const seenInImport = new Set<string>();

  // Phase 3, 4, 5: Validate, Identity Match, Diff for each row
  for (let i = 0; i < totalRows; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-based index including header

    const rawName = getValFast(row, headerIndex, NAME_ALIASES);
    const name = rawName ? String(rawName).trim() : '';
    const rawContact = getValFast(row, headerIndex, CONTACT_ALIASES) || '';
    const contact = normalizePhone(rawContact);

    // Phase 3: Validate
    if (!name && !contact) {
      errors.push({ row: rowNum, reason: 'Row missing required Name and Contact fields.' });
      diffs.push({ rowNumber: rowNum, type: 'INVALID', name: 'N/A', contact: 'N/A', reason: 'Missing Name & Contact' });
      continue;
    }

    if (!name) {
      errors.push({ row: rowNum, reason: 'Row missing required Name field.' });
      diffs.push({ rowNumber: rowNum, type: 'INVALID', name: 'N/A', contact: contact || 'N/A', reason: 'Missing Name' });
      continue;
    }

    const compositeKey = `${name.toLowerCase()}_${contact}`;

    // Phase 4: Identity Resolution ($O(1)$)
    let existingDb = byNameContact.get(compositeKey);
    let matchType: 'EXACT' | 'CONFLICT' | 'NEW' = existingDb ? 'EXACT' : 'NEW';

    if (!existingDb) {
      const nameMatches = name ? byName.get(name.toLowerCase()) || [] : [];
      const contactMatches = contact ? byContact.get(contact) || [] : [];

      if (nameMatches.length > 1 && contactMatches.length > 1) {
        matchType = 'CONFLICT';
      } else if (nameMatches.length === 1 && contactMatches.length === 0) {
        existingDb = nameMatches[0];
        matchType = 'EXACT';
      } else if (contactMatches.length === 1 && nameMatches.length === 0) {
        existingDb = contactMatches[0];
        matchType = 'EXACT';
      } else if (nameMatches.length > 1 || contactMatches.length > 1) {
        matchType = 'CONFLICT';
      }
    }

    if (matchType === 'CONFLICT') {
      const reason = 'Ambiguous identity match — multiple existing devotees share this name/contact.';
      conflicts.push({ row: rowNum, name, contact, reason });
      diffs.push({ rowNumber: rowNum, type: 'CONFLICT', name, contact, reason });
      continue;
    }

    // Map incoming fields
    const mappedData: Record<string, any> = {
      name,
      contact,
      templeId,
      isDeleted: false,
    };

    const age = getValFast(row, headerIndex, AGE_ALIASES);
    const mentorRaw = getValFast(row, headerIndex, MENTOR_ALIASES);
    const facilitatorRaw = getValFast(row, headerIndex, FACILITATOR_ALIASES);
    const chanting = getValFast(row, headerIndex, CHANTING_ALIASES);
    const attendanceRaw = getValFast(row, headerIndex, ATTENDANCE_ALIASES);

    if (age !== undefined && age !== '') mappedData.age = age;
    if (chanting !== undefined && chanting !== '') mappedData.chanting = chanting;

    BASE_FIELD_ALIASES.forEach(({ field, aliases }) => {
      const val = getValFast(row, headerIndex, aliases);
      if (val !== undefined && val !== '') mappedData[field] = val;
    });

    if (attendanceRaw !== undefined && attendanceRaw !== '') {
      const m = String(attendanceRaw).match(/-?\d+(\.\d+)?/);
      const parsedNum = m ? parseFloat(m[0]) : NaN;
      if (!isNaN(parsedNum)) mappedData.attendanceCount = parsedNum;
    }

    if (mentorRaw !== undefined && mentorRaw !== '') {
      const mentorUser = matchUserByIdentifier(String(mentorRaw), userLookup);
      mappedData.mentor = mentorUser ? mentorUser.displayName || mentorUser.email : String(mentorRaw);
    }

    if (facilitatorRaw !== undefined && facilitatorRaw !== '') {
      const facilitatorUser = matchUserByIdentifier(String(facilitatorRaw), userLookup);
      if (facilitatorUser) {
        mappedData.facilitatorId = facilitatorUser.uid;
        mappedData.facilitatorName = facilitatorUser.displayName || facilitatorUser.email;
        mappedData.facilitator = facilitatorUser.displayName || facilitatorUser.email;
      }
    }

    allCustomColumnKeys.forEach(({ cc, hKey }) => {
      if (hKey !== undefined && row[hKey] !== undefined) mappedData[cc] = row[hKey];
    });

    // Check duplicate within the same import file
    if (seenInImport.has(compositeKey)) {
      diffs.push({ rowNumber: rowNum, type: 'DUPLICATE', name, contact, reason: 'Duplicate row in import file' });
      continue;
    }
    seenInImport.add(compositeKey);

    // Phase 5: Field-level Diff
    if (existingDb) {
      const patch: Record<string, any> = {};
      const oldValues: Record<string, any> = {};
      let hasFieldChanges = false;

      Object.keys(mappedData).forEach((field) => {
        if (field === 'templeId' || field === 'isDeleted') return;
        const incomingVal = mappedData[field];
        if (incomingVal === undefined || incomingVal === null || incomingVal === '') return;

        const currentVal = existingDb[field];
        if (normalizeForCompare(currentVal) === normalizeForCompare(incomingVal)) return;

        patch[field] = incomingVal;
        oldValues[field] = currentVal ?? '';
        hasFieldChanges = true;
      });

      if (hasFieldChanges) {
        updatedRecords.push({ id: existingDb.id, oldValues, patch });
        diffs.push({
          rowNumber: rowNum,
          type: 'UPDATE',
          id: existingDb.id,
          name,
          contact,
          oldValues,
          newValues: patch,
        });
      } else {
        diffs.push({
          rowNumber: rowNum,
          type: 'UNCHANGED',
          id: existingDb.id,
          name,
          contact,
        });
      }
    } else {
      // New record insertion — generate deterministic ID
      const newId = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${i}`;
      const newDoc = {
        ...mappedData,
        id: newId,
        isImported: true,
        createdAt: new Date().toISOString(),
      };
      insertedRecords.push({ id: newId, data: newDoc });
      diffs.push({
        rowNumber: rowNum,
        type: 'INSERT',
        id: newId,
        name,
        contact,
        mappedData: newDoc,
      });
    }
  }

  const processingMs = Math.round(performance.now() - startTime);

  return {
    totalRows,
    insertedCount: insertedRecords.length,
    updatedCount: updatedRecords.length,
    unchangedCount: diffs.filter((d) => d.type === 'UNCHANGED').length,
    duplicateCount: diffs.filter((d) => d.type === 'DUPLICATE').length,
    conflictCount: conflicts.length,
    invalidCount: errors.length,
    autoDetectedColumns,
    detectedAttendanceCols,
    diffs,
    insertedRecords,
    updatedRecords,
    conflicts,
    errors,
    processingMs,
  };
}

// Web Worker message listener context
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data || {};
    if (type === 'STAGE_IMPORT') {
      try {
        const plan = executeStagedImportWorker(payload);
        self.postMessage({ type: 'STAGE_COMPLETE', payload: plan });
      } catch (err: any) {
        self.postMessage({ type: 'STAGE_ERROR', error: err?.message || String(err) });
      }
    }
  };
}
