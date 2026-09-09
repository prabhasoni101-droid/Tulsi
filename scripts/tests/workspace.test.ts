/**
 * Self-contained unit tests for the local-first workspace layer
 * (PDR Sections A/B/C/D).
 *
 * Runs with `npx tsx scripts/tests/workspace.test.ts` â€” no vitest/jest needed.
 * Only the pure modules are imported (workspaceStore, syncTypes, dirtyTracker,
 * commands) so the tests never initialize Firebase.
 */
import assert from 'node:assert/strict';
import { workspaceStore } from '../../src/lib/workspace/workspaceStore';
import { DirtyTracker } from '../../src/lib/workspace/dirtyTracker';
import {
  editCell,
  pasteRange,
  bulkUpdate,
  deleteRows,
  insertRows,
  duplicateRows,
  deleteColumn,
  importCommit,
  moveColumn,
  labelToDbField,
  readCellValue,
} from '../../src/lib/workspace/commands';
import type { Devotee } from '../../src/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
/** Deferred test queue so async tests run sequentially after all are declared. */
const suite: { name: string; fn: () => void | Promise<void> }[] = [];

/** Flushes the store's microtask-coalesced snapshot broadcast + any IDB tasks. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function test(name: string, fn: () => void | Promise<void>): void {
  suite.push({ name, fn });
}

async function runAll(): Promise<number> {
  for (const t of suite) {
    try {
      await t.fn();
      passed++;
    } catch (err) {
      failed++;
      failures.push(`${t.name}: ${(err as Error).message}`);
    }
  }
  return failed;
}

function makeDevotee(id: string, overrides: Partial<Devotee> = {}): Devotee {
  return {
    id,
    name: 'Test Devotee',
    contact: '',
    age: '',
    gender: '',
    dob: '',
    address: '',
    institute: '',
    mentor: '',
    chanting: '0',
    attendanceCount: 0,
    templeId: 'temple-a',
    createdAt: new Date().toISOString(),
    isDeleted: false,
    isImported: false,
    ...overrides,
  } as Devotee;
}

const editableColumns = [
  { key: 'name', label: 'Name', editable: true, persisted: true, order: 0 },
  { key: 'contact', label: 'Contact No.', editable: true, persisted: true, order: 1 },
  { key: 'mentor', label: 'Mentor', editable: true, persisted: true, order: 2 },
  { key: 'Profile', label: 'Profile', editable: false, persisted: false, order: 3 },
];

function resetWorkspace(): void {
  workspaceStore.clear();
}

// ---------------------------------------------------------------------------
// DirtyTracker (PDR Section D)
// ---------------------------------------------------------------------------

test('DirtyTracker: set() tracks only changed fields', () => {
  const dirty = new DirtyTracker();
  dirty.set('a', 'name', 'Rama', 'Krishna');
  assert.equal(dirty.size(), 1);
  assert.equal(dirty.isDirty('a'), true);
  const pending = dirty.takePending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].docId, 'a');
  assert.equal(pending[0].fields.name, 'Rama');
  assert.equal(pending[0].original.name, 'Krishna');
});

test('DirtyTracker: reverting to original clears the field', () => {
  const dirty = new DirtyTracker();
  dirty.set('a', 'name', 'Rama', 'Krishna');
  dirty.set('a', 'name', 'Krishna', 'Krishna');
  assert.equal(dirty.isDirty('a'), false);
  assert.equal(dirty.takePending().length, 0);
});

test('DirtyTracker: merge() coalesces multiple fields into one doc', () => {
  const dirty = new DirtyTracker();
  dirty.merge('a', { name: 'Rama', contact: '999' }, { name: 'Krishna', contact: '111' });
  const pending = dirty.takePending();
  assert.equal(pending.length, 1);
  assert.deepEqual(Object.keys(pending[0].fields).sort(), ['contact', 'name']);
});

test('DirtyTracker: empty and null are treated as equal (empty base, null edit is not dirty)', () => {
  const dirty = new DirtyTracker();
  dirty.set('a', 'institute', null as any, '');
  assert.equal(dirty.isDirty('a'), false);
});

test('DirtyTracker: revision counter advances per takePending', () => {
  const dirty = new DirtyTracker();
  dirty.set('a', 'name', 'Rama', '');
  const r1 = dirty.takePending()[0].revision;
  dirty.set('a', 'name', 'Krishna', '');
  const r2 = dirty.takePending()[0].revision;
  assert.ok(r2 > r1);
});

// ---------------------------------------------------------------------------
// WorkspaceStore (PDR Section A)
// ---------------------------------------------------------------------------

test('WorkspaceStore: upsert adds new id and preserves position on re-upsert', () => {
  resetWorkspace();
  workspaceStore.upsertRecord(makeDevotee('a'));
  workspaceStore.upsertRecord(makeDevotee('b'));
  const orderBefore = [...workspaceStore.getSnapshot().rowOrder];
  workspaceStore.upsertRecord(makeDevotee('a', { name: 'Updated' }));
  assert.deepEqual(workspaceStore.getSnapshot().rowOrder, orderBefore);
  assert.equal(workspaceStore.getRecord('a')!.name, 'Updated');
  assert.equal(workspaceStore.size(), 2);
});

test('WorkspaceStore: patchRecord merges fields without replacing the record', () => {
  resetWorkspace();
  workspaceStore.upsertRecord(makeDevotee('a', { name: 'Krishna', mentor: 'Guru' }));
  workspaceStore.patchRecord('a', { contact: '9999999999' });
  const rec = workspaceStore.getRecord('a')!;
  assert.equal(rec.name, 'Krishna');
  assert.equal(rec.mentor, 'Guru');
  assert.equal(rec.contact, '9999999999');
});

test('WorkspaceStore: removeRecords removes from records and rowOrder', () => {
  resetWorkspace();
  workspaceStore.upsertRecords([makeDevotee('a'), makeDevotee('b'), makeDevotee('c')]);
  workspaceStore.removeRecords(['a', 'c']);
  assert.equal(workspaceStore.size(), 1);
  assert.deepEqual(workspaceStore.getSnapshot().rowOrder, ['b']);
});

test('WorkspaceStore: subscribe fires on change and unsubscribes cleanly', async () => {
  resetWorkspace();
  let notified = 0;
  const before = notified;
  const unsub = workspaceStore.subscribe(() => notified++);
  notified = before; // subscribe() delivers the current snapshot once immediately
  workspaceStore.upsertRecord(makeDevotee('z'));
  await flush();
  assert.ok(notified >= before + 1);
  unsub();
  const mark = notified;
  workspaceStore.upsertRecord(makeDevotee('y'));
  await flush();
  assert.equal(notified, mark);
});

test('WorkspaceStore: upsertRecords batch produces a single coalesced notify', async () => {
  resetWorkspace();
  let notified = 0;
  const unsub = workspaceStore.subscribe(() => notified++);
  notified = 0; // subscribe() delivers the current snapshot once immediately
  const batch = Array.from({ length: 100 }, (_, i) => makeDevotee(`id${i}`));
  workspaceStore.upsertRecords(batch);
  await flush();
  assert.equal(notified, 1);
  assert.equal(workspaceStore.size(), 100);
  unsub();
});

// ---------------------------------------------------------------------------
// Commands (PDR Section C)
// ---------------------------------------------------------------------------

test('commands: labelToDbField maps aliases', () => {
  assert.equal(labelToDbField('Name'), 'name');
  assert.equal(labelToDbField('Contact No.'), 'contact');
  assert.equal(labelToDbField('Date of Birth'), 'dob');
  assert.equal(labelToDbField('Facilitator'), 'facilitatorName');
});

test('commands: editCell patches store + dirty with only the changed field', () => {
  resetWorkspace();
  const dirty = new DirtyTracker();
  workspaceStore.upsertRecord(makeDevotee('a', { name: 'Krishna' }));
  const result = editCell(dirty, workspaceStore.getRecord('a')!, 'Name', 'Rama');
  assert.equal(result.applied, true);
  assert.equal(workspaceStore.getRecord('a')!.name, 'Rama');
  assert.equal(result.dirty.length, 1);
  assert.equal(result.dirty[0].id, 'a');
  assert.equal(result.dirty[0].fields.name, 'Rama');
  assert.equal(dirty.isDirty('a'), true);
});

test('commands: editCell clears the dirty field once the store reflects the original again', () => {
  resetWorkspace();
  const dirty = new DirtyTracker();
  workspaceStore.upsertRecord(makeDevotee('a', { name: 'Krishna' }));
  editCell(dirty, workspaceStore.getRecord('a')!, 'Name', 'Rama');
  assert.equal(dirty.isDirty('a'), true);
  // Simulate the record reconciling back to its persisted base (coordinator
  // flush echo / another device): the next identical edit is a no-op.
  workspaceStore.patchRecord('a', { name: 'Krishna' });
  editCell(dirty, workspaceStore.getRecord('a')!, 'Name', 'Krishna');
  assert.equal(dirty.isDirty('a'), false);
});

test('commands: pasteRange writes aligned values and skips non-editable columns', () => {
  resetWorkspace();
  const dirty = new DirtyTracker();
  workspaceStore.upsertRecords([makeDevotee('r0'), makeDevotee('r1')]);
  const result = pasteRange(
    dirty,
    [['Rama', '1111111111'], ['Krishna', '2222222222']],
    ['r0', 'r1'],
    editableColumns,
    0
  );
  assert.equal(result.applied, true);
  assert.equal(workspaceStore.getRecord('r0')!.name, 'Rama');
  assert.equal(workspaceStore.getRecord('r1')!.contact, '2222222222');
  // Patch pairs: 2 rows x 2 editable columns
  assert.equal(result.dirty.length, 2);
});

test('commands: bulkUpdate applies one value across rows', () => {
  resetWorkspace();
  const dirty = new DirtyTracker();
  workspaceStore.upsertRecords([
    makeDevotee('a', { mentor: 'Guru X' }),
    makeDevotee('b', { mentor: 'Guru Y' }),
    makeDevotee('c', { mentor: 'Guru Y' }),
  ]);
  const result = bulkUpdate(dirty, ['a', 'b', 'c'], 'Mentor', 'Guru Z');
  assert.equal(result.dirty.length, 3);
  assert.equal(workspaceStore.getRecord('a')!.mentor, 'Guru Z');
  assert.equal(workspaceStore.getRecord('b')!.mentor, 'Guru Z');
});

test('commands: deleteRows removes rows from the store', () => {
  resetWorkspace();
  const dirty = new DirtyTracker();
  workspaceStore.upsertRecords([makeDevotee('a'), makeDevotee('b')]);
  const result = deleteRows(dirty, ['a']);
  assert.equal(result.applied, true);
  assert.equal(workspaceStore.size(), 1);
  assert.equal(workspaceStore.getRecord('a'), undefined);
});

test('commands: insertRows + duplicateRows produce new permanent ids', () => {
  resetWorkspace();
  const dirty = new DirtyTracker();
  const newIds = ['n1', 'n2'];
  const inserted = insertRows(dirty, 'temple-t', 2, newIds);
  assert.equal(inserted.applied, true);
  assert.equal(workspaceStore.getRecord('n1')!.name, 'New Devotee');
  assert.equal(workspaceStore.getRecord('n1')!.templeId, 'temple-t');

  // Duplicate one of the inserted rows.
  const dupIds = ['d1'];
  const duplicated = duplicateRows(dirty, ['n1'], dupIds, 'temple-t');
  assert.equal(duplicated.applied, true);
  const dup = workspaceStore.getRecord('d1')!;
  assert.equal(dup.name, workspaceStore.getRecord('n1')!.name);
  assert.equal(dup.isDeleted, false);
});

test('commands: deleteColumn clears the field on affected rows', () => {
  resetWorkspace();
  const dirty = new DirtyTracker();
  workspaceStore.upsertRecords([
    makeDevotee('a', { institute: 'SRF' } as any),
    makeDevotee('b', { institute: 'IS' } as any),
    makeDevotee('c', {}),
  ]);
  const result = deleteColumn(dirty, 'Institute', ['a', 'b', 'c']);
  assert.equal(result.applied, true);
  assert.equal((workspaceStore.getRecord('a') as any).institute, undefined);
  assert.equal(result.dirty.length, 2); // 'c' had no value, not included
  assert.equal(result.dirty[0].inverse.institute, 'SRF');
});

test('commands: importCommit upserts added and patches updated records', () => {
  resetWorkspace();
  const dirty = new DirtyTracker();
  workspaceStore.upsertRecord(makeDevotee('u', { name: 'Old' }));
  const result = importCommit(
    { brand_new: { name: 'Newcomer', templeId: 't' } },
    [{ id: 'u', oldValues: { name: 'Old' }, newValues: { name: 'Updated' } }]
  );
  assert.equal(result.applied, true);
  assert.equal(workspaceStore.getRecord('brand_new')!.name, 'Newcomer');
  assert.equal(workspaceStore.getRecord('u')!.name, 'Updated');
  assert.equal(result.dirty.length, 1);
});

test('commands: moveColumn returns the reordered structural view', () => {
  const result = moveColumn(['Name', 'Contact No.', 'Mentor', 'Profile'], 0, 2);
  assert.equal(result.applied, true);
  assert.deepEqual(result.history.newOrder, ['Contact No.', 'Mentor', 'Name', 'Profile']);
});

test('commands: readCellValue handles case variants', () => {
  const d = { name: 'X', 'Contact No.': '123', Mentor: 'G', Chanting: 16 };
  assert.equal(readCellValue(d, 'Name'), 'X');
  assert.equal(readCellValue(d, 'Contact No.'), '123');
  assert.equal(readCellValue(d, 'Mentor'), 'G');
  assert.equal(readCellValue(d, 'Chanting'), '16');
});

// ---------------------------------------------------------------------------

runAll().then((failed) => {
  console.log(`\nworkspace.test.ts: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  X ${f}`));
    process.exit(1);
  }
});
