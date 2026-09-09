import { Devotee } from '../../types';
import { workspaceStore, WorkspaceColumnMeta } from './workspaceStore';
import { DirtyTracker } from './dirtyTracker';
import { DevoteePatch, CommandResult } from './syncTypes';

/**
 * Command / Transaction Layer
 * ===========================
 * (PDR Section C)
 *
 * Every spreadsheet mutation is an explicit command/transaction. Each command
 * produces:
 *  - a local state mutation (via the workspace store),
 *  - an inverse operation (for undo / conflict rollback),
 *  - dirty operation metadata (only changed fields),
 *  - a synchronization payload,
 *  - a history record.
 *
 * Commands mutate the LOCAL store eagerly and hand dirty patches to the dirty
 * tracker and sync coordinator; they do NOT write to Firestore directly.
 */

export interface ColumnMapping {
  /** Display column name as the user sees it (e.g. "Name"). */
  label: string;
  /** DB field the column maps to (e.g. "name"). */
  dbField: string;
}

export function labelToDbField(label: string): string {
  switch (label) {
    case 'Name': return 'name';
    case 'Age': return 'age';
    case 'Mentor': return 'mentor';
    case 'Chanting': return 'chanting';
    case 'Contact No.': return 'contact';
    case 'Gender': return 'gender';
    case 'Date of Birth': return 'dob';
    case 'Address': return 'address';
    case 'Institute': return 'institute';
    case 'Facilitator': return 'facilitatorName';
    default: return label;
  }
}

export function dbFieldToLabel(field: string): string {
  switch (field) {
    case 'name': return 'Name';
    case 'age': return 'Age';
    case 'mentor': return 'Mentor';
    case 'chanting': return 'Chanting';
    case 'contact': return 'Contact No.';
    case 'gender': return 'Gender';
    case 'dob': return 'Date of Birth';
    case 'address': return 'Address';
    case 'institute': return 'Institute';
    case 'facilitatorName': return 'Facilitator';
    default: return field;
  }
}

export function readCellValue(d: any, label: string): string {
  const f = labelToDbField(label);
  const v = d?.[f];
  if (label === 'Name') return d?.name ?? d?.Name ?? '';
  if (label === 'Age') return (d?.age ?? d?.Age ?? '').toString();
  if (label === 'Mentor') return d?.mentor ?? d?.Mentor ?? '';
  if (label === 'Chanting') return (d?.chanting ?? d?.Chanting ?? '').toString();
  if (label === 'Contact No.') return d?.contact ?? d?.['Contact No.'] ?? '';
  if (label === 'Gender') return d?.gender ?? d?.Gender ?? '';
  if (label === 'Date of Birth') return d?.dob ?? d?.['Date of Birth'] ?? '';
  if (label === 'Address') return d?.address ?? d?.Address ?? '';
  if (label === 'Institute') return d?.institute ?? d?.Institute ?? '';
  if (label === 'Facilitator') return d?.facilitatorName ?? d?.facilitator ?? d?.Facilitator ?? '';
  return v === undefined || v === null ? '' : String(v);
}

/** Columns that are display-only / not editable in a spreadsheet sense. */
export const NON_EDITABLE_COLUMNS = new Set(['Profile', 'Attendance', '#']);

/**
 * editCell — edit a single cell on a single row.
 */
export function editCell(
  dirty: DirtyTracker,
  devotee: Devotee,
  label: string,
  value: string,
  originalOverride?: string
): CommandResult {
  const dbField = labelToDbField(label);
  const original = originalOverride !== undefined ? originalOverride : readCellValue(devotee, label);
  const patch: Record<string, any> = { [dbField]: value };
  dirty.merge(devotee.id!, patch, { [dbField]: original });
  workspaceStore.patchRecord(devotee.id!, patch);
  const history = { type: 'cellEdit', id: devotee.id!, field: dbField, oldValue: original, newValue: value };
  return { applied: true, dirty: toPatchList([{ docId: devotee.id!, fields: patch, original: { [dbField]: original } }]), history };
}

function toPatchList(docs: { docId: string; fields: Record<string, any>; original: Record<string, any> }[]): DevoteePatch[] {
  return docs.map((d) => ({ id: d.docId, fields: { ...d.fields }, inverse: { ...d.original } }));
}

/**
 * pasteRange — paste a rectangular block onto the sheet, aligned to a dest
 * anchor, skipping restricted columns.
 */
export function pasteRange(
  dirty: DirtyTracker,
  values: string[][],
  destRowIds: string[],
  columns: WorkspaceColumnMeta[],
  destStartCol: number
): CommandResult {
  let applied = false;
  const allPatch: DevoteePatch[] = [];
  const oldValues: Record<string, Record<string, any>> = {};
  const newValues: Record<string, Record<string, any>> = {};

  values.forEach((rowVals, rOffset) => {
    const id = destRowIds[rOffset];
    const dev = workspaceStore.getRecord(id);
    if (!dev?.id) return;
    rowVals.forEach((val, cOffset) => {
      const col = columns[destStartCol + cOffset];
      if (!col || !col.editable || NON_EDITABLE_COLUMNS.has(col.key)) return;
      const dbField = labelToDbField(col.label);
      const finalVal = col.label === 'Contact No.' ? val : val;
      const oldVal = readCellValue(dev, col.label);
      if (oldVal === finalVal) return;
      dirty.set(dev.id, dbField, finalVal, oldVal);
      workspaceStore.patchRecord(dev.id, { [dbField]: finalVal });
      if (!oldValues[dev.id]) { oldValues[dev.id] = {}; newValues[dev.id] = {}; }
      oldValues[dev.id][dbField] = oldVal;
      newValues[dev.id][dbField] = finalVal;
      applied = true;
    });
  });

  return {
    applied,
    dirty: Object.keys(oldValues).map((id) => ({ id, fields: newValues[id], inverse: oldValues[id] })),
    history: { type: 'pasteRange', oldValues, newValues },
  };
}

/**
 * deleteRows — soft-delete (or hard-delete) the given rows. Produces a
 * synchronization deletion payload via the store removal.
 */
export function deleteRows(dirty: DirtyTracker, ids: string[]): CommandResult {
  if (!ids || ids.length === 0) return { applied: false, dirty: [] };
  workspaceStore.removeRecords(ids);
  const history = { type: 'bulkDeleteDevotees', ids };
  return { applied: true, dirty: [], history };
}

/**
 * insertRows — add one or more new devotee rows locally, generating permanent ids.
 */
export function insertRows(
  dirty: DirtyTracker,
  templeId: string,
  count: number,
  newDocIds: string[],
  baseFields: Partial<Devotee> = {}
): CommandResult {
  const docs: Devotee[] = [];
  for (let i = 0; i < count; i++) {
    const id = newDocIds[i];
    if (!id) continue;
    const doc: Devotee = {
      id,
      name: 'New Devotee',
      contact: '',
      age: '',
      mentor: '',
      chanting: '0',
      attendanceCount: 0,
      templeId,
      isDeleted: false,
      isImported: false,
      createdAt: new Date().toISOString(),
      ...baseFields,
    };
    docs.push(doc);
  }
  workspaceStore.upsertRecords(docs);
  const history = { type: 'addRows', ids: docs.map((d) => d.id!) };
  return { applied: docs.length > 0, dirty: [], history };
}

/**
 * duplicateRows — duplicate selected rows into new docs (deep-copy record, new id).
 */
export function duplicateRows(
  dirty: DirtyTracker,
  sourceIds: string[],
  newDocIds: string[],
  templeId: string
): CommandResult {
  const docs: Devotee[] = [];
  sourceIds.forEach((srcId, i) => {
    const src = workspaceStore.getRecord(srcId);
    if (!src) return;
    const newId = newDocIds[i];
    if (!newId) return;
    const { id, ...rest } = src as any;
    const copy: Devotee = { ...rest, id: newId, isDeleted: false, createdAt: src.createdAt };
    if (copy.searchKey) delete (copy as any).searchKey;
    docs.push(copy);
  });
  workspaceStore.upsertRecords(docs);
  const history = { type: 'addRows', ids: docs.map((d) => d.id!) };
  return { applied: docs.length > 0, dirty: [], history };
}

/**
 * deleteColumn — remove a custom column from all records (structural + per-row
 * field deletion).
 */
export function deleteColumn(dirty: DirtyTracker, columnName: string, affectedIds: string[]): CommandResult {
  const dbField = labelToDbField(columnName);
  const oldValues: Record<string, any> = {};
  affectedIds.forEach((id) => {
    const dev = workspaceStore.getRecord(id);
    if (!dev) return;
    const oldVal = (dev as any)[dbField];
    // Only rows that actually carry a value need the field deleted on the
    // server; an empty string / absent value is a no-op.
    if (oldVal === undefined || oldVal === null || oldVal === '') return;
    oldValues[id] = oldVal;
    dirty.set(id, dbField, undefined, oldVal);
    workspaceStore.patchRecord(id, { [dbField]: undefined });
  });
  const history = { type: 'deleteColumn', name: columnName, oldValues };
  return { applied: affectedIds.length > 0, dirty: toPatchList(Object.keys(oldValues).map((id) => ({ docId: id, fields: { [dbField]: undefined }, original: { [dbField]: oldValues[id] } }))), history };
}

/**
 * duplicateColumn — create a new custom column copying values from an existing
 * one across all records.
 */
export function duplicateColumn(
  dirty: DirtyTracker,
  sourceLabel: string,
  newColumnKey: string,
  affectedIds: string[]
): CommandResult {
  const srcField = labelToDbField(sourceLabel);
  const dstField = labelToDbField(newColumnKey);
  const patches: DevoteePatch[] = [];
  for (const id of affectedIds) {
    const dev = workspaceStore.getRecord(id);
    if (!dev) continue;
    const val = (dev as any)[srcField];
    if (val === undefined) continue;
    dirty.set(id, dstField, val, undefined);
    workspaceStore.patchRecord(id, { [dstField]: val });
    patches.push({ id, fields: { [dstField]: val }, inverse: { [dstField]: (dev as any)[dstField] } });
  }
  const history = { type: 'addColumn', name: newColumnKey };
  return { applied: patches.length > 0, dirty: patches, history };
}

/**
 * moveRow — reorder a row within the workspace. Persists customOrder locally;
 * the sync coordinator writes it to Firestore.
 */
export function moveRow(dirty: DirtyTracker, devotee: Devotee, newOrder: number): CommandResult {
  if (!devotee?.id) return { applied: false, dirty: [] };
  const oldOrder = (devotee as any).customOrder;
  dirty.set(devotee.id, 'customOrder', newOrder, oldOrder);
  workspaceStore.patchRecord(devotee.id, { customOrder: newOrder });
  const history = { type: 'moveRow', id: devotee.id, oldOrder, newOrder };
  return { applied: true, dirty: [{ id: devotee.id, fields: { customOrder: newOrder }, inverse: { customOrder: oldOrder } }], history };
}

/**
 * moveColumn — change the display order of columns (view-level, not persisted to
 * each record). Returns structural update for the view/persistence layers.
 */
export function moveColumn(oldOrder: string[], fromIndex: number, toIndex: number): CommandResult {
  const next = [...oldOrder];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return {
    applied: fromIndex !== toIndex,
    dirty: [],
    history: { type: 'moveColumn', oldOrder, newOrder: next },
    structural: { columns: next.map((label, i) => ({ key: label, label, editable: !NON_EDITABLE_COLUMNS.has(label), persisted: !NON_EDITABLE_COLUMNS.has(label), order: i })) },
  };
}

/**
 * attendanceColumnChange — toggle an attendance record for a devotee/event.
 * NOTE: attendance is governed by its own engine + business rules (PDR 22); this
 * command records an attendance sync payload (set/delete) rather than a devotee
 * field write, because attendanceCount is derived on the server side.
 */
export interface AttendanceChangePayload {
  kind: 'attendanceToggle';
  devoteeId: string;
  eventId: string;
  isPresent: boolean | null;
  actorUid: string;
  templeId: string;
  increment: -1 | 0 | 1;
}

export function attendanceColumnChange(
  devoteeId: string,
  eventId: string,
  isPresent: boolean | null,
  actorUid: string,
  templeId: string,
  increment: -1 | 0 | 1
): CommandResult & { attendancePayload?: AttendanceChangePayload } {
  const history = { type: 'attendanceToggle', devoteeId, eventId, isPresent, actorUid, templeId };
  return {
    applied: true,
    dirty: [],
    history,
    attendancePayload: { kind: 'attendanceToggle', devoteeId, eventId, isPresent, actorUid, templeId, increment },
  };
}

/**
 * bulkUpdate — apply a single value to a column across many rows.
 */
export function bulkUpdate(
  dirty: DirtyTracker,
  rowIds: string[],
  label: string,
  value: string
): CommandResult {
  const dbField = labelToDbField(label);
  let applied = false;
  const patches: DevoteePatch[] = [];
  for (const id of rowIds) {
    const dev = workspaceStore.getRecord(id);
    if (!dev?.id) continue;
    const oldVal = readCellValue(dev, label);
    if (oldVal === value) continue;
    const finalVal = label === 'Contact No.' ? value : value;
    dirty.set(id, dbField, finalVal, oldVal);
    workspaceStore.patchRecord(id, { [dbField]: finalVal });
    patches.push({ id, fields: { [dbField]: finalVal }, inverse: { [dbField]: oldVal } });
    applied = true;
  }
  const history = { type: 'bulkUpdate', field: dbField, value };
  return { applied, dirty: patches, history };
}

/**
 * importCommit — apply the result of a completed import (new records + updated
 * fields) to the local store so the UI updates instantly and the sync
 * coordinator can push the rest.
 */
export function importCommit(
  addedData: Record<string, any>,
  updatedData: { id: string; oldValues: Record<string, any>; newValues: Record<string, any> }[]
): CommandResult {
  const addedDocs: Devotee[] = Object.keys(addedData).map((id) => ({ id, ...addedData[id] }) as Devotee);
  workspaceStore.upsertRecords(addedDocs);
  for (const u of updatedData) {
    workspaceStore.patchRecord(u.id, { ...u.newValues });
  }
  const dirty = toPatchList(
    updatedData.map((u) => ({ docId: u.id, fields: { ...u.newValues }, original: { ...u.oldValues } }))
  );
  const history = { type: 'import', addedData, updatedData };
  return { applied: addedDocs.length > 0 || updatedData.length > 0, dirty, history };
}
