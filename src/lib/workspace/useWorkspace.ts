import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { workspaceStore, WorkspaceSnapshot } from './workspaceStore';
import { DirtyTracker } from './dirtyTracker';
import { createSyncCoordinator } from './syncCoordinator';
import { subscribeDevoteesIncremental } from './firestoreListener';
import { SyncState, createEmptySyncState } from './syncTypes';
import {
  loadRecords,
  persistRecords,
  loadRowOrder,
  persistRowOrder,
  loadColumns,
  persistColumns,
} from './localPersistence';
import { Devotee } from '../../types';

/**
 * useWorkspace
 * ============
 * Orchestration hook that gives the Owner Database view a local-first
 * spreadsheet workspace backed by:
 *
 *  A. Workspace Store      — normalized records + subscriptions
 *  B. Local Persistence    — IndexedDB (records, row order, columns, pending)
 *  D. Dirty Tracking       — only-changed-field dirty set
 *  E. Sync Coordinator     — central Firestore write pipeline
 *  F. Incremental listener — docChanges() based hydration/patching
 *  G. Cold start           — cached-then-reconcile boot path
 *
 * Single owner per session. All UI mutations route through commands exposed
 * here rather than writing to Firestore directly.
 */

export interface WorkspaceApi {
  snapshot: WorkspaceSnapshot;
  syncState: SyncState;
  dirty: DirtyTracker;
  /** Number of locally-dirty docs (for a "saving…" UI affordance). */
  dirtyCount: number;
  /** Hydrate cached records immediately, then start incremental listener. */
  bootstrap: (templeId: string, userId: string) => void;
  /** Persist the current normalized records + ordering to IndexedDB. */
  persistNow: () => Promise<void>;
  updateRowOrder: (order: string[]) => Promise<void>;
  updateColumns: (columns: any[]) => Promise<void>;
  flush: () => Promise<void>;
  enqueue: (op: any) => void;
  collect: () => Devotee[];
  /** Registers pending mutation IDs to prevent local-cache resurrection. */
  addPendingMutations: (opts: { deleteIds?: string[]; restoreIds?: string[]; permanentDeleteIds?: string[] }) => Promise<void>;
  /** Confirms pending mutation IDs that Firestore acknowledged. */
  removePendingMutations: (opts: { deleteIds?: string[]; restoreIds?: string[]; permanentDeleteIds?: string[] }) => Promise<void>;
  /** Starts a durable bulk job. Returns jobId. */
  startJob: (opts: { operationType: string; recordIds: string[]; templeId: string }) => Promise<string>;
  /** Advances/finalizes a durable bulk job. */
  updateJob: (jobId: string, patch: any) => Promise<void>;
  finishJob: (jobId: string, status: 'running' | 'completed' | 'failed' | 'needs_attention') => Promise<any>;
  getJobs: () => any[];
}

export function useWorkspace(tenantId: string | undefined): WorkspaceApi {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => workspaceStore.getSnapshot());
  const [syncState, setSyncState] = useState<SyncState>(createEmptySyncState());
  const [, setTick] = useState(0);

  const dirtyRef = useRef<DirtyTracker>(new DirtyTracker());
  const coordinatorRef = useRef(createSyncCoordinator(dirtyRef.current));
  const tenantRef = useRef<string | undefined>(tenantId);
  const unsubRef = useRef<(() => void) | null>(null);

  // Subscribe to store changes.
  useEffect(() => {
    const unsub = workspaceStore.subscribe(setSnapshot);
    return () => unsub();
  }, []);

  // Subscribe to sync coordinator state.
  useEffect(() => {
    const unsub = coordinatorRef.current.subscribe(setSyncState);
    return () => unsub();
  }, []);

  // Dirty count ticker + autosave: every 900ms coalesce newly-dirty fields into
  // the sync coordinator's write pipeline (which itself is chunked + retried).
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      coordinatorRef.current.flush().catch(() => {});
    }, 900);
    return () => clearInterval(id);
  }, []);

  const bootstrap = useCallback((templeId: string, userId: string) => {
    tenantRef.current = templeId;

    coordinatorRef.current.init(templeId, userId).then(() => {
      coordinatorRef.current.setReconciling(true);
      // After init loads pending mutations, filter any cached records that are
      // mid-delete so they never flash back into the active database.
      const pending = coordinatorRef.current.getPendingMutations();
      const pendingDelete = new Set([...pending.deleteIds, ...pending.permanentDeleteIds]);

      loadRecords(templeId).then(async (cached) => {
        const activeCached = (cached || []).filter(r => !r.isDeleted && !pendingDelete.has(r.id!));
        if (activeCached.length > 0) {
          workspaceStore.upsertRecords(activeCached);
          const saved = await loadRowOrder(templeId);
          if (saved && saved.length > 0) workspaceStore.setRowOrder(saved);
        }
        coordinatorRef.current.markHydrated();

        // 3/4) reconcile in background, patch incrementally via docChanges().
        unsubRef.current?.();
        unsubRef.current = subscribeDevoteesIncremental(templeId, {
          onUpsert: (records) => {
            const pendingNow = coordinatorRef.current.getPendingMutations();
            const stillPending = new Set([...pendingNow.deleteIds, ...pendingNow.permanentDeleteIds]);
            const active = records.filter(r => !r.isDeleted && !stillPending.has(r.id!));
            if (active.length === 0) return;
            // Persist newly-synced records to the local cache, chunked so a cold
            // start snapshot (potentially 20k+ docs) never creates one oversized
            // IndexedDB transaction.
            for (let i = 0; i < active.length; i += 400) {
              persistRecords(active.slice(i, i + 400)).catch(() => {});
            }
          },
        });
        coordinatorRef.current.setReconciling(false);
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      unsubRef.current?.();
    };
  }, []);

  const persistNow = useCallback(async () => {
    const t = tenantRef.current;
    if (!t) return;
    const records = workspaceStore.getSnapshot();
    const all: Devotee[] = [];
    for (const id of records.rowIds) {
      const r = workspaceStore.getRecord(id);
      if (r) all.push(r);
    }
    // Chunked persist to keep the main thread responsive.
    for (let i = 0; i < all.length; i += 400) {
      await persistRecords(all.slice(i, i + 400));
    }
    await persistRowOrder(t, workspaceStore.getSnapshot().rowOrder);
  }, []);

  const updateRowOrder = useCallback(async (order: string[]) => {
    workspaceStore.setRowOrder(order);
    const t = tenantRef.current;
    if (t) await persistRowOrder(t, order);
  }, []);

  const updateColumns = useCallback(async (columns: any[]) => {
    await persistColumns(tenantRef.current!, columns);
  }, []);

  const flush = useCallback(async () => {
    await coordinatorRef.current.flush();
    await persistNow();
  }, [persistNow]);

  const enqueue = useCallback((op: any) => {
    coordinatorRef.current.enqueue(op);
  }, []);

  const addPendingMutations = useCallback((opts: { deleteIds?: string[]; restoreIds?: string[]; permanentDeleteIds?: string[] }) => {
    return coordinatorRef.current.addPendingMutations(opts);
  }, []);

  const removePendingMutations = useCallback((opts: { deleteIds?: string[]; restoreIds?: string[]; permanentDeleteIds?: string[] }) => {
    return coordinatorRef.current.removePendingMutations(opts);
  }, []);

  const startJob = useCallback((opts: { operationType: string; recordIds: string[]; templeId: string }) => {
    return coordinatorRef.current.startJob(opts);
  }, []);

  const updateJob = useCallback((jobId: string, patch: any) => {
    return coordinatorRef.current.updateJob(jobId, patch);
  }, []);

  const finishJob = useCallback((jobId: string, status: 'running' | 'completed' | 'failed' | 'needs_attention') => {
    return coordinatorRef.current.finishJob(jobId, status);
  }, []);

  const getJobs = useCallback(() => {
    return coordinatorRef.current.getJobs();
  }, []);

  const collect = useCallback((): Devotee[] => {
    return workspaceStore.getRecords();
  }, []);

  return useMemo(
    () => ({
      snapshot,
      syncState,
      dirty: dirtyRef.current,
      dirtyCount: dirtyRef.current.size(),
      bootstrap,
      persistNow,
      updateRowOrder,
      updateColumns,
      flush,
      enqueue,
      collect,
      addPendingMutations,
      removePendingMutations,
      startJob,
      updateJob,
      finishJob,
      getJobs,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, syncState, bootstrap, persistNow, updateRowOrder, updateColumns, flush, enqueue, collect, addPendingMutations, removePendingMutations, startJob, updateJob, finishJob, getJobs]
  );
}
