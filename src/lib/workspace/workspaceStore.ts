import { Devotee } from '../../types';

/**
 * Workspace Store
 * ================
 * The single authoritative client-side state/store for the Owner spreadsheet
 * workspace.
 *
 * Responsibilities (PDR Section A):
 *  - Store normalized row data keyed by permanent document ID.
 *  - Keep column metadata/order/type separate from row data.
 *  - Keep view state (row order, selection, viewport) separate from source data.
 *  - Not depend on React component state for every row/cell.
 *
 * The store is intentionally tiny and framework-agnostic: it owns the DATA
 * (records + derived metadata). React components subscribe to snapshots via
 * `subscribe()` and re-render only when the derived data they care about
 * actually changes.
 *
 * Source-of-truth rule (PDR H):
 *  - Workspace Store = interaction source of truth for the Owner session.
 *  - Firestore = distributed persistence/synchronization source of truth.
 *  - React = rendering layer.
 */

/** Metadata describing a single editable column in the sheet. */
export interface WorkspaceColumnMeta {
  /** Stable column key. For db-backed columns this is the DB field name; for
   *  display-only columns (Profile, row number) it is a synthetic key. */
  key: string;
  /** Human-facing header label (e.g. "Name", "Contact No."). */
  label: string;
  /** Whether this column can be edited by the owner. */
  editable: boolean;
  /** Whether this column value is persisted to the devotee document. */
  persisted: boolean;
  /** Optional type hint used for cell input/copy handling. */
  type?: string;
}

export interface WorkspaceSnapshot {
  /** Ordered row ids reflecting the current view order (after sort/filter).
   *  This is the VIEW layer, distinct from `records`. */
  rowOrder: string[];
  /** Normalized records keyed by permanent devotee id. */
  records: Readonly<Record<string, Devotee>>;
  /** Row ids present in the workspace in arbitrary (set) order. */
  rowIds: string[];
  /** Column metadata + order for the current sheet. */
  columns: WorkspaceColumnMeta[];
  /** Version counter bumped on every mutation the view layer should observe. */
  version: number;
  /** Stable array of records in `rowOrder`. Cached across notifies: when a sync produces
   *  no actual change the SAME array reference is handed out, so React memos that depend on
   *  it (duplicate detection, filtering, sorting) short-circuit instead of re-scanning 25k rows. */
  recordsList: Readonly<Devotee[]>;
}

type Listener = (snapshot: WorkspaceSnapshot) => void;

class WorkspaceStore {
  private records = new Map<string, Devotee>();
  private columns: WorkspaceColumnMeta[] = [];
  private rowOrder: string[] = [];
  private version = 0;
  private listeners = new Set<Listener>();
  private bumpPending = false;
  private bumpScheduled = false;
  /** JSON digest of the last known record value per id. Two identical server
   *  snapshots of the same doc produce the same digest, so unchanged rows never
   *  trigger a notify (and therefore never re-scan a 25k-row spreadsheet). */
  private digests = new Map<string, string>();
  /** Cached order-preserved record array; invalidated on any mutation. */
  private recordsList: Devotee[] | null = null;

  private invalidateList(): void {
    this.recordsList = null;
  }

  /** Records in `rowOrder`, built lazily and reused across serializes. */
  getRecords(): Devotee[] {
    if (this.recordsList === null) {
      this.recordsList = this.rowOrder
        .map((id) => this.records.get(id))
        .filter((r): r is Devotee => Boolean(r));
    }
    return this.recordsList;
  }

  private serialize = (): WorkspaceSnapshot => ({
    rowOrder: this.rowOrder.slice(),
    records: Object.freeze(Object.fromEntries(this.records)),
    rowIds: Array.from(this.records.keys()),
    columns: this.columns,
    version: this.version,
    recordsList: this.getRecords(),
  });

  /** Subscribes to store changes. Returns an unsubscribe function. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WorkspaceSnapshot => this.serialize();

  /** Replaces the ordered row list (view order). Does not touch record data. */
  setRowOrder(order: string[]): void {
    this.rowOrder = order.slice();
    this.invalidateList();
    this.bump();
  }

  setColumns(columns: WorkspaceColumnMeta[]): void {
    if (columns.length === this.columns.length && this.columns.every((c, i) => c.key === columns[i].key && c.label === columns[i].label)) {
      return;
    }
    this.columns = columns.slice();
    this.bump();
  }

  /** Inserts (upserts) one devotee by permanent id, preserving existing row
   *  position if the id is already known. No-ops (no notify) when the incoming
   *  record is identical to what is already stored. */
  upsertRecord(devotee: Devotee): void {
    if (!devotee?.id) return;
    const sig = JSON.stringify(devotee);
    if (this.digests.get(devotee.id) === sig) return;
    const existed = this.records.has(devotee.id);
    this.records.set(devotee.id, devotee);
    this.digests.set(devotee.id, sig);
    if (!existed) {
      this.rowOrder.push(devotee.id);
    }
    this.invalidateList();
    this.bump();
  }

  /** Upserts a batch of records in a single notify (coalesced). Records whose
   *  value is byte-identical to the cached copy are skipped entirely, so an
   *  unchanged background sync never forces a full-row re-scan. */
  upsertRecords(devotees: Devotee[]): void {
    let changed = false;
    for (const d of devotees) {
      if (!d?.id) continue;
      const sig = JSON.stringify(d);
      if (this.digests.get(d.id) === sig) continue;
      const existed = this.records.has(d.id);
      this.records.set(d.id, d);
      this.digests.set(d.id, sig);
      if (!existed) {
        this.rowOrder.push(d.id);
      }
      changed = true;
    }
    if (changed) {
      this.invalidateList();
      this.bump();
    }
  }

  /** Patches specific fields of an existing record without replacing it. */
  patchRecord(id: string, patch: Partial<Devotee>): void {
    const current = this.records.get(id);
    if (!current) return;
    const next = { ...current, ...patch };
    this.records.set(id, next);
    this.digests.set(id, JSON.stringify(next));
    this.invalidateList();
    this.bump();
  }

  /** Removes a record and its row id. */
  removeRecord(id: string): void {
    if (!this.records.delete(id)) return;
    this.digests.delete(id);
    const idx = this.rowOrder.indexOf(id);
    if (idx !== -1) this.rowOrder.splice(idx, 1);
    this.invalidateList();
    this.bump();
  }

  /** Removes many records at once (coalesced notify). */
  removeRecords(ids: string[]): void {
    if (!ids || ids.length === 0) return;
    let changed = false;
    for (const id of ids) {
      if (this.records.delete(id)) changed = true;
      this.digests.delete(id);
    }
    if (!changed) return;
    const removeSet = new Set(ids);
    this.rowOrder = this.rowOrder.filter((id) => !removeSet.has(id));
    this.invalidateList();
    this.bump();
  }

  /** Clears the entire workspace (e.g. tenant switch). */
  clear(): void {
    this.records.clear();
    this.digests.clear();
    this.rowOrder = [];
    this.columns = [];
    this.invalidateList();
    this.bump();
  }

  /** Applies an explicit row order (permanent custom order) without the
   *  filter/sort view consideration. Used after a row move command. */
  applyRowReorder(newOrder: string[]): void {
    this.rowOrder = newOrder.slice();
    this.invalidateList();
    this.bump();
  }

  getRecord(id: string): Devotee | undefined {
    return this.records.get(id);
  }

  size(): number {
    return this.records.size;
  }

  /**
   * Marks a mutation as needing to be broadcast. Individual mutations update
   * `records`/`rowOrder` synchronously (so `getRecord`/`getSnapshot` always
   * observe the latest data), but the snapshot broadcast is coalesced onto the
   * microtask queue: a burst of rapid edits (typing, paste, bulk fill) notifies
   * subscribers once with a single O(N) materialization instead of once per
   * cell, which is what keeps 7k-20k-row bulk operations fast.
   */
  private bump(): void {
    this.version += 1;
    this.bumpPending = true;
    if (this.bumpScheduled) return;
    this.bumpScheduled = true;
    queueMicrotask(() => {
      this.bumpScheduled = false;
      if (!this.bumpPending) return;
      this.bumpPending = false;
      const snapshot = this.serialize();
      this.listeners.forEach((l) => l(snapshot));
    });
  }
}

/** Singleton instance shared across the Owner session. */
export const workspaceStore = new WorkspaceStore();

/** Convenience wrapper: create a React-style subscription over the store. */
export function subscribeWorkspace(listener: Listener): () => void {
  return workspaceStore.subscribe(listener);
}
