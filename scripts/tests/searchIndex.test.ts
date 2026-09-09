/**
 * Regression + performance tests for the incremental search/filter/sort and
 * duplicate-status index (Prompt 5).
 *
 * Runs with `npx tsx scripts/tests/searchIndex.test.ts` — no vitest/jest needed.
 * Only the pure index/style modules are imported (never Firebase).
 *
 * Covers (Prompt 5 #15):
 *  - same name / different phone      -> partial_name (blue)
 *  - same phone / different name      -> partial_contact (green)
 *  - same name + same phone           -> complete (red)
 *  - normalization differences
 *  - search + duplicate filter combinations (AND)
 *  - ascending / descending sort
 * Plus a 30k synthetic-record performance smoke test.
 */
import assert from 'node:assert/strict';
import {
  DevoteeSearchIndex,
  compareRows,
  matchesFilters,
  getColumnValue,
} from '../../src/lib/devoteeIndex';
import { getDuplicateStyle, getSelectionOverlayClass } from '../../src/lib/duplicateStyles';
import type { Devotee } from '../../src/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
const suite: { name: string; fn: () => void | Promise<void> }[] = [];

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

function mk(id: string, name: string, contact: string, extra: Record<string, any> = {}): Devotee {
  return {
    id,
    name,
    contact,
    mentor: '',
    chanting: '',
    attendanceCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    isDeleted: false,
    isImported: false,
    ...extra,
  } as Devotee;
}

/** Resolve duplicateType for a single row inside a dataset. */
function statusOf(rows: Devotee[], id: string): Devotee['duplicateType'] {
  const idx = new DevoteeSearchIndex();
  const out = idx.sync(rows);
  return out.find((r) => r.id === id)?.duplicateType;
}

// ---------------------------------------------------------------------------
// Duplicate semantics
// ---------------------------------------------------------------------------

test('duplicate: same name + different phone is a name duplicate (blue)', () => {
  const rows = [
    mk('a', 'Radha Shyam', '+919876543210'),
    mk('b', 'Radha Shyam', '+919999999999'),
  ];
  assert.equal(statusOf(rows, 'a'), 'partial_name');
  assert.equal(statusOf(rows, 'b'), 'partial_name');
  assert.equal(getDuplicateStyle('partial_name').row.includes('blue'), true);
});

test('duplicate: same phone + different name is a contact duplicate (green)', () => {
  const rows = [
    mk('a', 'Radha Shyam', '+919876543210'),
    mk('b', 'Krishna Das', '+919876543210'),
  ];
  assert.equal(statusOf(rows, 'a'), 'partial_contact');
  assert.equal(statusOf(rows, 'b'), 'partial_contact');
  assert.equal(getDuplicateStyle('partial_contact').row.includes('green'), true);
});

test('duplicate: same name + same phone is a complete duplicate (red)', () => {
  const rows = [
    mk('a', 'Radha Shyam', '+919876543210'),
    mk('b', 'Radha Shyam', '+919876543210'),
  ];
  assert.equal(statusOf(rows, 'a'), 'complete');
  assert.equal(statusOf(rows, 'b'), 'complete');
  assert.equal(getDuplicateStyle('complete').row.includes('red'), true);
});

test('duplicate: strongest match wins in a compound cluster', () => {
  const rows = [
    mk('a', 'Same Name', '111'),
    mk('b', 'Same Name', '111'),
    mk('c', 'Other Name', '111'),
  ];
  assert.equal(statusOf(rows, 'a'), 'complete');
  assert.equal(statusOf(rows, 'c'), 'partial_contact');
});

test('duplicate: no status when only one row matches', () => {
  const rows = [mk('a', 'Only One', '111'), mk('b', 'Another', '222')];
  assert.equal(statusOf(rows, 'a'), null);
  assert.equal(getDuplicateStyle(null).row, '');
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test('normalization: phone country code / spacing / formatting collapse', () => {
  const rows = [
    mk('a', 'X', '+91 98765 43210', { mobile: '+91 98765 43210' }),
    mk('b', 'Y', '9876543210'),
  ];
  assert.equal(statusOf(rows, 'a'), 'partial_contact');
  assert.equal(statusOf(rows, 'b'), 'partial_contact');
});

test('normalization: name case + internal spacing collapse', () => {
  const rows = [
    mk('a', '  Radha   Shyam ', '111'),
    mk('b', 'radha shyam', '222'),
  ];
  assert.equal(statusOf(rows, 'a'), 'partial_name');
  assert.equal(statusOf(rows, 'b'), 'partial_name');
});

test('normalization: empty vs non-empty phones never collapse', () => {
  // Same name, one empty phone: a name duplicate only (partial_name), NOT a
  // complete duplicate — the empty phone is excluded from the phone bucket.
  const rows = [mk('a', 'X', ''), mk('b', 'X', '222')];
  assert.equal(statusOf(rows, 'a'), 'partial_name');
  assert.equal(statusOf(rows, 'b'), 'partial_name');
  // Two entirely different names with empty phones: no duplicate at all.
  const rows2 = [mk('ca', 'X', ''), mk('cb', 'Y', '')];
  assert.equal(statusOf(rows2, 'ca'), null);
  assert.equal(statusOf(rows2, 'cb'), null);
});

// ---------------------------------------------------------------------------
// Incremental maintenance
// ---------------------------------------------------------------------------

test('incremental: editing one phone updates the affected row + its peer', () => {
  const idx = new DevoteeSearchIndex();
  const a = mk('a', 'Same', '111');
  const b = mk('b', 'Same', '222');
  const c = mk('c', 'Other', '111');

  const out = idx.sync([a, b, c]);
  const a1 = out.find((r) => r.id === 'a');
  const c1 = out.find((r) => r.id === 'c');
  assert.equal(a1?.duplicateType, 'partial_contact');
  assert.equal(c1?.duplicateType, 'partial_contact');

  // Unrelated edit to b (name only) — a's object reference must be preserved.
  const b2 = { ...b, name: 'Same But Edited' };
  const out2 = idx.sync([a, b2, c]);
  assert.equal(out2.find((r) => r.id === 'a'), a1, 'unchanged row keeps object identity');
  assert.equal(out2.find((r) => r.id === 'b')?.duplicateType, null);

  // Now change a's phone -> a no longer duplicates anyone.
  const a2 = { ...a, phone: '333', contact: '333' };
  const out3 = idx.sync([a2, b2, c]);
  assert.equal(out3.find((r) => r.id === 'a')?.duplicateType, null);
});

// ---------------------------------------------------------------------------
// Search (real-time word-by-word) + duplicate filter AND semantics
// ---------------------------------------------------------------------------

test('search: word-by-word AND across the cached search text', () => {
  const idx = new DevoteeSearchIndex();
  const rows = [
    mk('a', 'Radha Shyam', '111', { institute: 'Delhi Temple' }),
    mk('b', 'Krishna Das', '222', { institute: 'Mumbai Temple' }),
    mk('c', 'Radha Raman', '333', { institute: 'Delhi University' }),
  ];
  const out = idx.sync(rows);
  const tokens = 'radha temple'.split(/\s+/);
  const hits = out.filter((d) => matchesFilters(d, { searchTokens: tokens }));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a');
});

test('search + duplicate filter combine with AND semantics', () => {
  const idx = new DevoteeSearchIndex();
  const rows = [
    mk('a', 'Radha Contact', '111'),
    mk('b', 'Krishna Other', '222'),
    mk('c', 'Someone Else', '111'),
    mk('d', 'Radha Unique', '333', {}),
  ];
  const out = idx.sync(rows);
  const dupIds = out
    .filter((d) => matchesFilters(d, { showDuplicatesOnly: true, duplicateFilterType: 'contact' }))
    .map((d) => d.id)
    .sort();
  assert.deepEqual(dupIds, ['a', 'c']);

  const both = out.filter((d) =>
    matchesFilters(d, { searchTokens: ['radha'], showDuplicatesOnly: true, duplicateFilterType: 'contact' })
  );
  assert.equal(both.length, 1);
  assert.equal(both[0].id, 'a');
});

// ---------------------------------------------------------------------------
// Sort (deterministic, view-only, never mutates source)
// ---------------------------------------------------------------------------

test('sort: ascending and descending on text column', () => {
  const rows = [mk('a', 'Charlie', '1'), mk('b', 'Alpha', '2'), mk('c', 'Bravo', '3')];
  const asc = [...rows].sort((x, y) => compareRows(x, y, 'Name', 'asc'));
  assert.deepEqual(asc.map((r) => r.name), ['Alpha', 'Bravo', 'Charlie']);
  const desc = [...rows].sort((x, y) => compareRows(x, y, 'Name', 'desc'));
  assert.deepEqual(desc.map((r) => r.name), ['Charlie', 'Bravo', 'Alpha']);
});

test('sort: numeric column coerces to numbers', () => {
  const rows = [
    mk('a', 'X', '1', { age: '30' }),
    mk('b', 'Y', '2', { age: '12' }),
    mk('c', 'Z', '3', { age: '25' }),
  ];
  const asc = [...rows].sort((x, y) => compareRows(x, y, 'Age', 'asc'));
  assert.deepEqual(asc.map((r) => r.id), ['b', 'c', 'a']);
});

test('sort: never mutates the source rows', () => {
  const rows = [mk('a', 'Charlie', '1'), mk('b', 'Alpha', '2')];
  const orderBefore = [rows[0].name, rows[1].name];
  [...rows].sort((x, y) => compareRows(x, y, 'Name', 'asc'));
  assert.deepEqual([rows[0].name, rows[1].name], orderBefore);
});

test('sort: custom column / date reads directly', () => {
  const rows = [
    mk('a', 'X', '1', { 'Custom Field': 'banana', dob: '2020-01-01' }),
    mk('b', 'Y', '2', { 'Custom Field': 'apple', dob: '2019-06-15' }),
  ];
  const asc = [...rows].sort((x, y) => compareRows(x, y, 'Custom Field', 'asc'));
  assert.deepEqual(asc.map((r) => r.id), ['b', 'a']);
  assert.equal(getColumnValue(rows[0], 'dob'), '2020-01-01');
});

// ---------------------------------------------------------------------------
// Duplicate style mapping consistency
// ---------------------------------------------------------------------------

test('duplicate styles: red/green/blue mapping and distinct selection overlay', () => {
  assert.equal(getDuplicateStyle('complete').row.includes('red'), true);
  assert.equal(getDuplicateStyle('partial_contact').row.includes('green'), true);
  assert.equal(getDuplicateStyle('partial_name').row.includes('blue'), true);
  const sel = getSelectionOverlayClass('complete');
  assert.equal(sel.includes('saffron'), true, 'selection uses distinct saffron tint');
  assert.equal(sel.includes('red'), true, 'selection keeps duplicate edge visible');
});

// ---------------------------------------------------------------------------
// Performance smoke: 30k synthetic records
// ---------------------------------------------------------------------------

test('perf: index+search+filter+sort over 30k synthetic records stays sub-second', async () => {
  const N = 30000;
  const rows: Devotee[] = [];
  const names = ['Radha Shyam', 'Krishna Das', 'Gopal', 'Madhav', 'Raman'];
  for (let i = 0; i < N; i++) {
    rows.push(
      // Names repeat in a small pool (so every row is a name duplicate) while
      // every phone is unique (so there are no complete/contact duplicates).
      mk(`dev-${i}`, names[i % names.length], `+9197${String(i % 100000000).padStart(8, '0')}`, {
        institute: i % 3 === 0 ? 'Delhi Temple' : 'Mumbai Temple',
        age: String(20 + (i % 60)),
        dob: `${2018 + (i % 7)}-01-01`,
      })
    );
  }

  const idx = new DevoteeSearchIndex();
  const t0 = Date.now();
  const processed = idx.sync(rows);
  const indexMs = Date.now() - t0;
  assert.equal(processed.length, N);

  const t1 = Date.now();
  const searched = processed.filter((d) => matchesFilters(d, { searchTokens: ['radha', 'temple'] }));
  const searchMs = Date.now() - t1;
  assert.equal(searched.length > 0, true);

  const t2 = Date.now();
  const dupOnly = processed.filter((d) =>
    matchesFilters(d, { showDuplicatesOnly: true, duplicateFilterType: 'complete' })
  );
  const nameDup = processed.filter((d) =>
    matchesFilters(d, { showDuplicatesOnly: true, duplicateFilterType: 'name' })
  );
  const dupMs = Date.now() - t2;
  assert.equal(dupOnly.length, 0, 'no complete dups because every phone is unique');
  assert.equal(nameDup.length, N, 'every row is a name duplicate');

  const t3 = Date.now();
  const sorted = [...processed].sort((x, y) => compareRows(x, y, 'Age', 'asc'));
  const sortMs = Date.now() - t3;
  assert.equal(sorted.length, N);

  console.log(
    `    perf 30k: index=${indexMs}ms search=${searchMs}ms dupFilter=${dupMs}ms sort=${sortMs}ms`
  );
  const budget = 2500;
  assert.ok(
    indexMs + searchMs + dupMs + sortMs < budget,
    `expected total < ${budget}ms, got ${indexMs + searchMs + dupMs + sortMs}ms`
  );
});

// ---------------------------------------------------------------------------

runAll().then((failed) => {
  console.log(`\nsearchIndex.test.ts: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  X ${f}`));
    process.exit(1);
  }
});