/**
 * Performance benchmark for the local-first workspace layer.
 *
 * Runs with `npx tsx scripts/benchmark-workspace.ts`.
 * Measures the hot paths that the Owner Database view exercises at scale:
 *  - bulk ingestion (cold-start hydration of 7k / 20k records),
 *  - snapshot materialization (what the React projection + virtualizer consume),
 *  - single-cell edits through the command layer + dirty tracker,
 *  - row reorder, pointer-paste of a block of cells,
 *  - dirty-set coalescing + takePending (sync pipeline input),
 *  - incremental listener-shaped single-record upserts.
 */
import { workspaceStore } from '../src/lib/workspace/workspaceStore';
import { DirtyTracker } from '../src/lib/workspace/dirtyTracker';
import { editCell, pasteRange, bulkUpdate } from '../src/lib/workspace/commands';
import type { Devotee } from '../src/types';

const SIZES = [7_000, 20_000];

function makeDevotee(i: number): Devotee {
  return {
    id: `dev_${i}`,
    name: `Devotee ${i}`,
    contact: `98${String(i % 10000000).padStart(8, '0')}`,
    age: String(18 + (i % 60)),
    gender: i % 2 ? 'Male' : 'Female',
    dob: '',
    address: `Street ${i % 200}`,
    institute: i % 3 ? '' : 'Institute',
    mentor: i % 5 ? '' : 'Mentor',
    chanting: String(i % 32),
    attendanceCount: i % 120,
    templeId: 'bench-temple',
    createdAt: new Date(2020, 0, 1, 0, 0, i % 1000).toISOString(),
    isDeleted: false,
    isImported: false,
  } as Devotee;
}

function time(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  const ms = Math.round((performance.now() - t0) * 100) / 100;
  console.log(`  ${label.padEnd(58)} ${String(ms).padStart(8)} ms`);
  return ms;
}

const baseColumns = [
  { key: 'name', label: 'Name', editable: true, persisted: true, order: 0 },
  { key: 'age', label: 'Age', editable: true, persisted: true, order: 1 },
  { key: 'contact', label: 'Contact No.', editable: true, persisted: true, order: 2 },
  { key: 'mentor', label: 'Mentor', editable: true, persisted: true, order: 3 },
  { key: 'chanting', label: 'Chanting', editable: true, persisted: true, order: 4 },
];

console.log('Workspace layer benchmarks\n');
for (const n of SIZES) {
  const records: Devotee[] = Array.from({ length: n }, (_, i) => makeDevotee(i));
  workspaceStore.clear();

  console.log(`N = ${n.toLocaleString()}`);
  time('workspaceStore.upsertRecords(n) [cold-start ingestion]', () => {
    workspaceStore.upsertRecords(records);
  });

  time('getSnapshot + full record read (React projection collect)', () => {
    const snap = workspaceStore.getSnapshot();
    snap.rowOrder.map((id) => workspaceStore.getRecord(id)!);
  });

  const snap = workspaceStore.getSnapshot();
  time('subscribe listener snapshot materialization', () => {
    let s: any;
    const un = workspaceStore.subscribe((x) => (s = x));
    workspaceStore.patchRecord('dev_1', { age: '25' });
    void s;
    un();
  });

  time('editCell x 50 rows (command + dirty tracker)', () => {
    const dirty = new DirtyTracker();
    for (let i = 0; i < 50; i++) {
      const rec = workspaceStore.getRecord(`dev_${i}`)!;
      editCell(dirty, rec, 'Age', String(30 + i));
    }
  });

  time('pasteRange 50x3 block (500 edits, coalesced)', () => {
    const dirty = new DirtyTracker();
    const rows: string[][] = Array.from({ length: 50 }, () => ['New Name', '99', '12']);
    const ids = Array.from({ length: 50 }, (_, i) => `dev_${i + 100}`);
    pasteRange(dirty, rows, ids, baseColumns, 0);
  });

  time('bulkUpdate 500 rows (one column)', () => {
    const dirty = new DirtyTracker();
    const ids = Array.from({ length: 500 }, (_, i) => `dev_${i + 2000}`);
    bulkUpdate(dirty, ids, 'Mentor', 'Bench Guru');
  });

  time('dirty.takePending() over 550 docs (sync pipeline input)', () => {
    const dirty = new DirtyTracker();
    for (let i = 0; i < 550; i++) {
      dirty.set(`dev_${i}`, 'age', String(99), String(i));
    }
    dirty.takePending();
  });

  time('single-record upsert x 100 (incremental listener path)', () => {
    for (let i = 0; i < 100; i++) {
      workspaceStore.upsertRecord(makeDevotee(n + i));
    }
  });

  console.log('');
}

console.log('done.');