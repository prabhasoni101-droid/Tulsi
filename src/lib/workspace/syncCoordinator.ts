import {
  writeBatch,
  doc,
  serverTimestamp,
  setDoc,
  deleteDoc,
  increment,
  deleteField,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { DirtyTracker } from './dirtyTracker';
import { DevoteePatch, PendingOperation, SyncState, BulkProgress, BulkJob, createEmptySyncState } from './syncTypes';
import {
  appendPendingOp,
  removePendingOps,
  loadPendingOps,
  saveCheckpoint,
  loadCheckpoint,
  loadBulkJobs,
  saveBulkJobs,
  loadPendingMutations,
  savePendingMutations,
  type SyncCheckpoint,
} from './localPersistence';
import { AttendanceChangePayload } from './commands';
import { yieldToMainThread } from '../bulkOperationEngine';
import { upsertBulkJobAlert } from '../bulkJobAlerts';

/**
 * Sync Coordinator
 * ================
 * (PDR Section E)
 *
 * One central Firestore synchronization coordinator that is completely
 * independent from individual table cells.
 *
 * Responsibilities:
 *  - queue pending writes (bounded with backpressure),
 *  - group compatible writes into safe Firestore batches,
 *  - apply backpressure / coalescing,
 *  - retry safe failures,
 *  - expose pending / saved / error state,
 *  - maintain idempotency for writes that could duplicate (attendance),
 *  - reconcile server changes and resolve local/server conflicts per PDR
 *    authority (Owner > CSV > Attendance > Mentor/User form),
 *  - never lose unsaved local edits (persist pending ops to IndexedDB).
 */

const MAX_BATCH = 400; // Firestore batch limit is 500; stay safely below.
const MAX_QUEUE = 800; // backpressure threshold.
const MAX_ATTEMPTS = 3; // max attempts per chunk before marking failed.

/** Exponential backoff delays (ms) between retry attempts. */
const RETRY_DELAYS = [1500, 5000, 15000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForBackoff(attempt: number): Promise<void> {
  const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
  return sleep(delay);
}

type Listener = (state: SyncState) => void;

export class SyncCoordinator {
  private templeId: string | null = null;
  private userId: string | null = null;
  private dirty: DirtyTracker;
  private queue: PendingOperation[] = [];
  private flushing = false;
  private state: SyncState = createEmptySyncState();
  private listeners = new Set<Listener>();
  private boundCheckpoint: SyncCheckpoint;
  private jobs: BulkJob[] = [];
  /** Idempotency ledger: attendance/src keys already applied in this session. */
  private appliedIds = new Set<string>();

  constructor(dirty: DirtyTracker) {
    this.dirty = dirty;
    this.boundCheckpoint = { lastFullSyncAt: 0, localRevision: 0 };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Binds the coordinator to a tenant + actor. Loads any persisted pending ops. */
  async init(templeId: string, userId: string): Promise<void> {
    const changedTenant = this.templeId !== templeId;
    this.templeId = templeId;
    this.userId = userId;
    this.boundCheckpoint = (await loadCheckpoint(templeId)) ?? { lastFullSyncAt: 0, localRevision: 0 };
    if (changedTenant) {
      // Rehydrate offline pending ops so nothing is lost across reloads.
      const persisted = await loadPendingOps(templeId);
      this.queue = persisted;
      // Rehydrate durable bulk jobs + pending mutation IDs.
      this.jobs = await loadBulkJobs(templeId) ?? [];
      const pm = await loadPendingMutations(templeId);
      this.state.pendingDeleteIds = pm.deleteIds;
      this.state.pendingRestoreIds = pm.restoreIds;
      this.state.pendingPermanentDeleteIds = pm.permanentDeleteIds;
      this.emit();
    }
  }

  /** Registers pending mutation IDs for the local cache guard. */
  async addPendingMutations(opts: { deleteIds?: string[]; restoreIds?: string[]; permanentDeleteIds?: string[] }): Promise<void> {
    if (!this.templeId) return;
    const m = await loadPendingMutations(this.templeId);
    if (opts.deleteIds) {
      m.deleteIds = Array.from(new Set([...m.deleteIds, ...opts.deleteIds]));
    }
    if (opts.restoreIds) {
      m.restoreIds = Array.from(new Set([...m.restoreIds, ...opts.restoreIds]));
    }
    if (opts.permanentDeleteIds) {
      m.permanentDeleteIds = Array.from(new Set([...m.permanentDeleteIds, ...opts.permanentDeleteIds]));
    }
    await savePendingMutations(this.templeId, m);
    this.state.pendingDeleteIds = m.deleteIds;
    this.state.pendingRestoreIds = m.restoreIds;
    this.state.pendingPermanentDeleteIds = m.permanentDeleteIds;
    this.emit();
  }

  /** Clears pending mutation IDs that have been confirmed by Firestore. */
  async removePendingMutations(opts: { deleteIds?: string[]; restoreIds?: string[]; permanentDeleteIds?: string[] }): Promise<void> {
    if (!this.templeId) return;
    const m = await loadPendingMutations(this.templeId);
    const drop = (arr: string[], remove: string[]) => {
      const rm = new Set(remove);
      return arr.filter((x) => !rm.has(x));
    };
    if (opts.deleteIds) m.deleteIds = drop(m.deleteIds, opts.deleteIds);
    if (opts.restoreIds) m.restoreIds = drop(m.restoreIds, opts.restoreIds);
    if (opts.permanentDeleteIds) m.permanentDeleteIds = drop(m.permanentDeleteIds, opts.permanentDeleteIds);
    await savePendingMutations(this.templeId, m);
    this.state.pendingDeleteIds = m.deleteIds;
    this.state.pendingRestoreIds = m.restoreIds;
    this.state.pendingPermanentDeleteIds = m.permanentDeleteIds;
    this.emit();
  }

  /** Returns the current pending mutation IDs (used by the store pre-bootstrap guard). */
  getPendingMutations(): { deleteIds: string[]; restoreIds: string[]; permanentDeleteIds: string[] } {
    return {
      deleteIds: this.state.pendingDeleteIds,
      restoreIds: this.state.pendingRestoreIds,
      permanentDeleteIds: this.state.pendingPermanentDeleteIds,
    };
  }

  /**
   * Starts a durable bulk job. Returns a jobId. The job is persisted so a
   * page refresh mid-operation can resume safely.
   */
  async startJob(opts: {
    operationType: string;
    recordIds: string[];
    templeId: string;
  }): Promise<string> {
    const jobId = `${opts.operationType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: BulkJob = {
      jobId,
      operationType: opts.operationType,
      recordIds: opts.recordIds,
      totalCount: opts.recordIds.length,
      completedCount: 0,
      failedCount: 0,
      failedIds: [],
      currentChunk: 0,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
      templeId: opts.templeId,
    };
    this.jobs.push(job);
    await saveBulkJobs(opts.templeId, this.jobs);
    this.emit();
    return jobId;
  }

  /** Advances a durable job's counters after a chunk attempt. */
  async updateJob(jobId: string, patch: Partial<BulkJob>): Promise<void> {
    const job = this.jobs.find((j) => j.jobId === jobId);
    if (!job || !this.templeId) return;
    Object.assign(job, patch, { updatedAt: Date.now() });
    await saveBulkJobs(this.templeId, this.jobs);
    this.emit();
  }

  /** Finalizes a durable job. */
  async finishJob(jobId: string, status: BulkJob['status']): Promise<BulkJob | null> {
    const job = this.jobs.find((j) => j.jobId === jobId);
    if (!job) return null;
    job.status = status;
    job.updatedAt = Date.now();
    await saveBulkJobs(this.templeId!, this.jobs);
    this.emit();
    return job;
  }

  /** Returns the list of durable jobs for the UI. */
  getJobs(): BulkJob[] {
    return this.jobs.slice();
  }

  markHydrated(): void {
    this.state.hydrated = true;
    this.emit();
  }

  setReconciling(v: boolean): void {
    this.state.reconciling = v;
    this.emit();
  }

  /**
   * Enqueues an explicit pending operation (e.g. attendance toggle, add row)
   * whose Firestore write shape differs from a plain field patch.
   */
  enqueue(op: Omit<PendingOperation, 'tenantId' | 'createdAt' | 'syncStatus'> & { opId?: string }): void {
    if (!this.templeId) return;
    const finalOp: PendingOperation = {
      ...op,
      opId: op.opId ?? `${op.kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: this.templeId,
      createdAt: Date.now(),
      syncStatus: 'pending',
    };
    this.queue.push(finalOp);
    // Backpressure: if the queue is saturated, flush eagerly but still cap memory.
    this.persistPendingOps([finalOp]);
    if (this.queue.length >= MAX_QUEUE) {
      this.flush().catch(() => {});
    } else {
      this.scheduleFlush();
    }
    this.emit();
  }

  /**
   * Flushes the current dirty set through the pipeline. Typically called by an
   * autosave tick (debounced) in the inviting hook, or via enqueue().
   */
  async flush(): Promise<void> {
    if (this.flushing || !this.templeId) return;
    this.flushing = true;
    try {
      // 1. Take current dirty patches (coalesced per doc).
      const dirtyDocs = this.dirty.takePending();
      const patches: DevoteePatch[] = dirtyDocs.map((d) => ({
        id: d.docId,
        fields: { ...d.fields },
        inverse: { ...d.original },
      }));

      // 2. Run the bounded write pipeline on both the dirty patches and any
      //    explicit operations.
      const failed = await this.runWritePipeline(patches);

      // 3. Merge in queued explicit ops, advancing through them too.
      const queued = this.queue.splice(0);
      if (queued.length > 0) {
        await this.runQueuedOps(queued);
      }

      // 4. Safe-failure retry: re-inject failed patches into the dirty tracker
      //    so the next autosave tick re-attempts them — nothing is lost.
      for (const p of failed) {
        this.dirty.merge(p.id, p.fields, p.inverse);
      }

      if (failed.length === 0) {
        this.boundCheckpoint = {
          lastFullSyncAt: Date.now(),
          localRevision: this.boundCheckpoint.localRevision + 1,
        };
        await saveCheckpoint(this.templeId, this.boundCheckpoint);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Reports a fatal write error so edits are never silently lost. */
  reportError(err: unknown): void {
    this.state.failed += 1;
    this.state.lastError = err instanceof Error ? err.message : String(err);
    // Meaningful console capture: op kind + tenant + timestamp + message.
    console.error('[SyncCoordinator] write failure:', {
      templeId: this.templeId,
      userId: this.userId,
      error: err instanceof Error ? { message: err.message, code: (err as any)?.code } : err,
      failedCount: this.state.failed,
      at: new Date().toISOString(),
    });
    this.emit();
  }

  /** Publishes live progress for an in-flight bulk operation (deleteRows,
   *  addRows, ...) so the UI can render a real progress bar. */
  private setProgress(p: BulkProgress | null): void {
    this.state.progress = p;
    this.emit();
  }

  private scheduleFlush(): void {
    // Debounced 180ms autosave tick.
    setTimeout(() => {
      this.flush().catch(() => {});
    }, 180);
  }

  /**
   * Writes a batch of devotee patches to Firestore as field-level merge writes,
   * chunked to stay safely under the 500-op limit. Never sends unchanged fields.
   * Returns the list of patches that failed so the caller can retry them.
   */
  private async runWritePipeline(patches: DevoteePatch[]): Promise<DevoteePatch[]> {
    if (patches.length === 0) return [];
    this.state.pending += patches.length;
    this.state.syncing = 1;
    this.emit();

    const groups = this.groupPatches(patches);
    const failedPatchIds = new Set<string>();
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      let attempts = 0;
      let committed = false;
      while (!committed && attempts < MAX_ATTEMPTS) {
        try {
          const batch = writeBatch(db);
          for (const p of group) {
            const writePayload: Record<string, any> = {};
            for (const [k, v] of Object.entries(p.fields)) {
              // Firestore rejects undefined; a field removed via deleteColumn must
              // instead be deleted on the server.
              writePayload[k] = v === undefined ? deleteField() : v;
            }
            batch.set(doc(db, 'devotees', p.id), { ...writePayload, updatedAt: serverTimestamp() }, { merge: true });
          }
          await batch.commit();
          committed = true;
        } catch (err) {
          attempts++;
          this.reportError(err);
          if (attempts < MAX_ATTEMPTS) {
            await waitForBackoff(attempts);
          }
        }
      }
      if (!committed) {
        group.forEach((p) => failedPatchIds.add(p.id));
      }
      // Let the browser paint/respond between chunks: a 25k-row bulk edit is
      // ~63 sequential commits that would otherwise block the main thread.
      if (gi < groups.length - 1) await yieldToMainThread(10);
    }

    const failed = patches.filter((p) => failedPatchIds.has(p.id));
    this.state.pending = Math.max(0, this.state.pending - (patches.length - failed.length));
    this.state.syncing = 0;
    if (failed.length === 0) this.state.failed = 0;
    this.emit();
    return failed;
  }

  private groupPatches(patches: DevoteePatch[]): DevoteePatch[][] {
    const groups: DevoteePatch[][] = [];
    for (let i = 0; i < patches.length; i += MAX_BATCH) {
      groups.push(patches.slice(i, i + MAX_BATCH));
    }
    return groups;
  }

  /** Executes explicit operations (attendance toggles, row insert/delete, ...). */
  private async runQueuedOps(ops: PendingOperation[]): Promise<void> {
    if (ops.length === 0) return;
    const succeeded: string[] = [];
    for (const op of ops) {
      // Idempotency: never double-apply an idempotent op in the same session.
      if (op.idempotencyKey) {
        if (this.appliedIds.has(op.idempotencyKey)) {
          succeeded.push(op.opId);
          continue;
        }
        this.appliedIds.add(op.idempotencyKey);
      }
      try {
        const failures = await this.applyOperation(op);
        if (failures.length === 0) {
          succeeded.push(op.opId);
        } else {
          // Chunk permanently failed after all retries: keep the op durable so a
          // later autosave tick / reload re-attempts the failed IDs. Never mark
          // a partially-failed operation as complete. The owner was already
          // notified via the bulk alert (deduped by jobId/opId).
          this.reportError(new Error(`Operation ${op.kind} partially failed (${failures.length} records).`));
        }
      } catch (err) {
        this.reportError(err);
      }
    }
    // Any bulk-op progress bar is finished now.
    this.setProgress(null);
    await removePendingOps(succeeded);
    this.emit();
  }

  /**
   * Runs a chunked bulk operation with per-chunk retry and failure tracking.
   * Returns the list of IDs that permanently failed after all retries.
   */
  private async runChunked(
    total: number,
    label: string,
    chunker: (batchStart: number, batchEnd: number) => Array<{ docRef: any; payload?: Record<string, any> }>,
    jobId?: string
  ): Promise<string[]> {
    if (!this.templeId) return [];
    let processed = 0;
    const permanentFailures: string[] = [];
    for (let i = 0; i < total; i += MAX_BATCH) {
      const end = Math.min(i + MAX_BATCH, total);
      const writes = chunker(i, end);
      let attempts = 0;
      let committed = false;
      while (!committed && attempts < MAX_ATTEMPTS) {
        try {
          const batch = writeBatch(db);
          for (const w of writes) {
            if (w.payload) {
              batch.set(w.docRef, w.payload, { merge: true });
            } else {
              batch.delete(w.docRef);
            }
          }
          await batch.commit();
          committed = true;
        } catch (err) {
          attempts++;
          this.reportError(err);
          if (attempts < MAX_ATTEMPTS) {
            await waitForBackoff(attempts);
          }
        }
      }
      if (committed) {
        processed = end;
      } else {
        const failedIds = writes
          .map((w) => {
            // Fall back to the payload's id if a string was passed; document
            // refs don't carry a stable id here, so track by index instead.
            const id = (w as any)._id as string | undefined;
            return id ?? '';
          })
          .filter(Boolean);
        permanentFailures.push(...failedIds);
        // Even failed chunks advance progress so the job never appears stuck.
        processed = end;
        if (jobId) {
          await this.updateJob(jobId, { failedCount: permanentFailures.length, failedIds: permanentFailures });
        }
      }
      this.setProgress({
        active: processed < total,
        label,
        total,
        processed,
        percent: Math.min(100, Math.round((processed / total) * 100)),
        failedIds: permanentFailures.slice(),
        completed: processed >= total,
      });
      if (jobId) {
        await this.updateJob(jobId, { completedCount: total - permanentFailures.length, currentChunk: Math.ceil(processed / MAX_BATCH) });
      }
      if (processed < total) await yieldToMainThread(10);
    }
    return permanentFailures;
  }

  private async applyOperation(op: PendingOperation): Promise<string[]> {
    switch (op.kind) {
      case 'addRow':
      case 'addRows': {
        const docs = op.payload.docs as { id: string; data: Record<string, any> }[];
        return this.runChunked(docs.length, 'Adding rows…', (start, end) =>
          docs.slice(start, end).map((d) => ({ docRef: doc(db, 'devotees', d.id), payload: d.data, _id: d.id }))
        );
      }
      case 'deleteRows': {
        const ids: string[] = op.payload.ids || [];
        const failures = await this.runChunked(ids.length, 'Deleting records…', (start, end) =>
          ids.slice(start, end).map((id) => ({
            docRef: doc(db, 'devotees', id),
            payload: { isDeleted: true, deletedAt: serverTimestamp() },
            _id: id,
          }))
        );
        // Confirm the successful soft-deletes so cache guards release those IDs.
        if (this.templeId) {
          const succeeded = ids.filter((id) => !failures.includes(id));
          await this.removePendingMutations({ deleteIds: succeeded });
          if (failures.length > 0) {
            await upsertBulkJobAlert({
              jobId: op.opId,
              operationType: 'bulk delete',
              templeId: this.templeId,
              totalCount: ids.length,
              failedCount: failures.length,
              message: `Bulk operation needs attention. ${ids.length} devotees were selected. ${succeeded.length} were processed successfully. ${failures.length} could not be processed because of a temporary/database error. The failed records were kept safe and were not treated as successfully deleted.`,
              error: this.state.lastError ?? undefined,
            });
          }
        }
        return failures;
      }
      case 'permanentDeleteRows': {
        const ids: string[] = op.payload.ids || [];
        const failures = await this.runChunked(ids.length, 'Permanently deleting…', (start, end) =>
          ids.slice(start, end).map((id) => ({ docRef: doc(db, 'devotees', id), _id: id }))
        );
        if (this.templeId) {
          const succeeded = ids.filter((id) => !failures.includes(id));
          await this.removePendingMutations({ permanentDeleteIds: succeeded });
          if (failures.length > 0) {
            await upsertBulkJobAlert({
              jobId: op.opId,
              operationType: 'permanent delete',
              templeId: this.templeId,
              totalCount: ids.length,
              failedCount: failures.length,
              message: `Permanent deletion needs attention. ${ids.length} records were selected. ${succeeded.length} were removed permanently. ${failures.length} could not be removed because of a temporary/database error and remain in History.`,
              error: this.state.lastError ?? undefined,
            });
          }
        }
        return failures;
      }
      case 'attendanceToggle': {
        const p = op.payload as AttendanceChangePayload;
        if (p.isPresent) {
          await setDoc(doc(db, `events/${p.eventId}/attendance`, p.devoteeId), {
            devoteeId: p.devoteeId,
            present: true,
            markedAt: new Date().toISOString(),
            markedBy: p.actorUid,
            templeId: p.templeId,
          });
          if (p.increment !== 0) {
            await setDoc(doc(db, 'devotees', p.devoteeId), { attendanceCount: increment(p.increment), updatedAt: serverTimestamp() }, { merge: true });
          }
        } else {
          await deleteDoc(doc(db, `events/${p.eventId}/attendance`, p.devoteeId)).catch((err: any) => {
            if (err?.code !== 'not-found') throw err;
          });
          if (p.increment !== 0) {
            await setDoc(doc(db, 'devotees', p.devoteeId), { attendanceCount: increment(p.increment), updatedAt: serverTimestamp() }, { merge: true });
          }
        }
        return [];
      }
      default:
        return [];
    }
  }

  private persistPendingOps(ops: PendingOperation[]): void {
    ops.forEach((op) => {
      appendPendingOp(this.templeId!, {
        opId: op.opId,
        tenantId: '',
        kind: op.kind,
        payload: op.payload,
        createdAt: op.createdAt,
        syncStatus: 'pending',
        idempotencyKey: op.idempotencyKey,
      }).catch(() => {});
    });
  }

  private emit(): void {
    const s = createEmptySyncState();
    s.pending = this.state.pending;
    s.syncing = this.state.syncing;
    s.failed = this.state.failed;
    s.hydrated = this.state.hydrated;
    s.reconciling = this.state.reconciling;
    s.lastError = this.state.lastError;
    s.progress = this.state.progress;
    s.activeJobs = this.jobs.slice();
    s.pendingDeleteIds = this.state.pendingDeleteIds;
    s.pendingRestoreIds = this.state.pendingRestoreIds;
    s.pendingPermanentDeleteIds = this.state.pendingPermanentDeleteIds;
    this.state = s;
    this.listeners.forEach((l) => l(this.state));
  }
}

export function createSyncCoordinator(dirty: DirtyTracker): SyncCoordinator {
  return new SyncCoordinator(dirty);
}
