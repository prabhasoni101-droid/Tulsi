# Owner Database — Local-First Workspace Architecture

This document describes the local-first spreadsheet workspace that replaced the
old "wholesale Firestore snapshot → React state" data flow in
`src/views/DatabaseManagement.tsx`.

Source-of-truth hierarchy: `docs/PDR/MASTER_PDR.md` > `AI_RULES.md` > current
code.

## Why

The previous Owner Database view loaded all devotees via a single
`onSnapshot(collection(db,'devotees'))` and stored them in one React `useState`
array. That had three problems:

1. **Bulk re-render**: every Firestore snapshot (and every local edit that
   refreshed it) replaced the entire array, forcing the whole spreadsheet onto
   the React diffing path even for a one-cell change.
2. **Firestore-dependent reads**: the sheet could not render before a network
   round-trip.
3. **Scattered writes**: single cells, bulk edits, duplicates, deletes and
   imports each wrote to Firestore through different helpers
   (`cellWriteQueue`, `runBulkOperation`, ad-hoc `writeBatch`/`updateDoc`),
   with no unified local state, retry, or offline safety.

## Architecture

All new code lives under `src/lib/workspace/`. The data flow is layered:

```
         +----------------------+   +--------------------------+   +--------------------+
         |  A. Workspace Store  |<--| C. Command / Transaction |<--|  DatabaseManagement |
         |  (records + metadata)|   |     Layer (inverses)     |   |      (view layer)   |
         +----------------------+   +--------------------------+   +--------------------+
              ^      |                            |
              |      |  B. Local Persistence (IndexedDB)
              |      v                            v
              |   +----------------------+   +---------------------+
              |   |   D. Dirty Tracker   |-->| E. Sync Coordinator |
              |   |  (only changed      |   |  (chunked batches,  |
              |   |   fields)           |   |   retry, pending)   |
              |   +----------------------+   +----------+----------+
              |                                         |
              |  F. Firestore incremental listener      |  writes
              |  (docChanges → store, keeps refs)       v
              +----------------------------- Firestore (same schema)
```

### A. Workspace Store — `workspaceStore.ts`
The single authoritative client-side store. Holds:
- normalized records keyed by **permanent devotee document id**,
- column metadata/order,
- view row order,
- version counter + subscription API.

It is framework-agnostic (no React state per cell). Subscribers receive a
snapshot. **Mutation broadcasts are coalesced onto the microtask queue**: a
burst of edits (typing, paste, bulk fill) notifies subscribers once with a
single `O(N)` materialization instead of once per cell. This is what keeps
7k–20k row bulk operations fast.

### B. Local Persistence — `localPersistence.ts`
Durable IndexedDB storage reusing `src/lib/dbCache.ts` (the same dataset is
never duplicated across React states). Persists normalized records, column
metadata, row order, a sync checkpoint, and the pending-operation queue.
Writes are chunked (≤400 records/transaction) to keep the main thread
responsive at 20k+ records.

### C. Command / Transaction Layer — `commands.ts`
Every spreadsheet mutation is an explicit command producing:
- a local store mutation,
- an inverse (for undo / conflict rollback),
- dirty per-doc patches (only changed fields),
- a history record.

Commands: `editCell`, `pasteRange`, `deleteRows`, `insertRows`,
`duplicateRows`, `deleteColumn`, `duplicateColumn`, `moveRow`, `moveColumn`,
`attendanceColumnChange`, `bulkUpdate`, `importCommit`. Commands never write to
Firestore directly; they hand patches to the dirty tracker + sync coordinator.

### D. Dirty Tracking — `dirtyTracker.ts`
Tracks **only the changed fields** of each locally-edited document. Multiple
edits to the same doc coalesce into one patch; a field is dropped from the dirty
set when the user edits it back to its original (last-known persisted) value.
`takePending()` atomically drains and clears the dirty set for the sync
pipeline.

### E. Sync Coordinator — `syncCoordinator.ts`
One central Firestore write pipeline independent from individual cells:
- drains the dirty set + explicit pending operations,
- groups patches into Firestore `writeBatch`es ≤400 ops (stays under the 500
  limit),
- coalesces (autosave ticks merge newly-dirty fields),
- safe-failure retry (failed patches are re-injected into the dirty tracker,
  never dropped),
- exposes pending / syncing / failed / hydrated state,
- idempotency keys so adds/deletes/attendance toggles are never double-applied,
- never loses unsaved local edits (pending ops are persisted to IndexedDB).

### F. Firestore Incremental Listener — `firestoreListener.ts`
Replaces the wholesale `setDevotees(snapshot.docs.map(...))` pattern with TRUE
incremental synchronization via `docChanges()`: single-record adds/updates/
removes are applied to the store one at a time. The first server sync may be
large, but it hydrates the store once; subsequent changes patch individual
records instead of rebuilding the whole array. Unchanged rows keep their object
references where possible.

Uses the exact same `devotees` collection + `where('templeId','==',…)` query
and the same schema — no rule changes, no permission changes.

### G. Cold Start — `useWorkspace.ts` → `bootstrap()`
1. Render the locally cached workspace **immediately** (0 Firestore reads).
2. Show a sync/hydration status.
3. Reconcile in the background by starting the incremental listener.
4. Patch the store incrementally as server snapshots arrive.

`useWorkspace` also owns the orchestration: it subscribes the view to the store
and sync state, drives an autosave tick, and exposes commands + selectors.

### Source-of-truth rule (PDR H) after this refactor
- **Workspace Store** = interaction source of truth for the Owner session.
- **Firestore** = distributed persistence/synchronization source of truth.
- **React `useState`** in DatabaseManagement is now a *rendering projection*
  of the store (`setDevotees(collect())` inside a store subscription), not the
  authoritative data.

## Migrations (IndexedDB)

Storage is **additive only**; previous cached data remains readable (PDR J).

- `DB_VERSION` 1 → 2 in `src/lib/dbCache.ts` adds a new `pendingOps` object
  store. `devotees` and `metadata` stores are untouched.
- Pending writes persist to `pendingOps` now, not only to the in-memory
  `cellWriteQueue`, so offline edits survive reloads.

## Files changed

New modules (`src/lib/workspace/`):
- `workspaceStore.ts` — store + subscriptions (coalesced broadcast).
- `syncTypes.ts` — shared types (`DirtyDoc`, `PendingOperation`, `SyncState`,
  `CommandResult`, …).
- `localPersistence.ts` — IndexedDB persistence + pending queue.
- `dirtyTracker.ts` — changed-field dirty set.
- `commands.ts` — command/transaction layer.
- `syncCoordinator.ts` — central write pipeline.
- `firestoreListener.ts` — incremental `docChanges()` hydration.
- `useWorkspace.ts` — orchestration/cold-start hook.
- `index.ts` — public exports.

Touched existing files:
- `src/lib/dbCache.ts` — DB version 1→2 (additive `pendingOps` store), added
  exports (`getDB`, `PENDING_STORE`, …).
- `src/views/DatabaseManagement.tsx` — data layer rewired to the workspace:
  - `useWorkspace` bootstrap replaces the wholesale devotees snapshot; the
    `devotees` state is now a store projection.
  - custom-column detection reads the store instead of the snapshot.
  - single-cell edits (`handleUpdateCell`), clipboard fill/paste/cut, and
    row-drag reorder now go through `dirty.set` + `workspaceStore.patchRecord`
    (route through the sync coordinator instead of `cellWriteQueue`).
  - add-rows, duplicate-selection, and bulk-delete now insert/remove locally and
    enqueue idempotent sync operations instead of direct `addDoc`/`writeBatch`.
  - import results are mirrored into the store for instant UI (the import
    engine still commits to Firestore; the incremental listener keeps it
    consistent). No dirty tracking for imports to avoid duplicate writes.
  - removed the now-dead `cellWriteQueue` / edit-queue machinery.

## Performance

Benchmark runnable with `npx tsx scripts/benchmark-workspace.ts` (7k and 20k
synthetic records). Numbers below are from a mid-range laptop:

| Operation                          | 7k rows | 20k rows |
|------------------------------------|---------|----------|
| Cold-start ingestion (upsert n)    | 1.3 ms  | 3.9 ms   |
| Full snapshot + record read        | 7.6 ms  | 11.0 ms  |
| Single listener materialization    | 1.4 ms  | 3.2 ms   |
| 50 single-cell edits (coalesced)   | 0.5 ms  | 0.1 ms   |
| Paste 50×3 block (500 edits)       | 0.5 ms  | 0.2 ms   |
| Bulk update 500 rows               | 1.5 ms  | 0.7 ms   |
| Dirty drain (takePending, 550 docs)| 0.7 ms  | 0.3 ms   |
| 100 incremental single upserts     | 0.4 ms  | 0.2 ms   |

Key point: **bulk-edit cost no longer scales per cell with a synchronous
re-render**. Coalescing notification onto the microtask queue dropped a 500-row
bulk update at 20k rows from ~1.7s (before) to ~0.7ms (after) of *store* work;
the React layer re-renders once per burst instead of once per edit.

The Firestore network footprint is unchanged on writes (coalesced, ≤400/batch)
but reads are far lighter for single-row changes thanks to incremental
`docChanges()` upserts instead of whole-collection array replacement.

## Tests

Self-contained unit tests (no vitest/jest installed):

```
npx tsx scripts/tests/workspace.test.ts     # 21 tests, all passing
```

Covers the workspace store (upsert/patch/remove/subscribe/coalesced notify),
dirty tracker (changed-only fields, revert-to-original, empty/null equality),
and commands (editCell, pasteRange, bulkUpdate, deleteRows, insertRows,
duplicateRows, deleteColumn, importCommit, moveColumn, label mapping,
readCellValue). Type-check with `npm run lint` (`tsc --noEmit`).

`testsprite_tests/` is a separate Python E2E suite and is unchanged.
