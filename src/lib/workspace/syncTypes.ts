import { Devotee } from '../../types';

/**
 * Shared types for the workspace synchronization layer
 * (dirty tracking, command layer, sync coordinator).
 */

/** A single dirty-field patch for one devotee document. */
export interface DirtyDoc {
  docId: string;
  /** Only the changed fields, keyed by DB field name. */
  fields: Record<string, any>;
  /** Original snapshot of the fields before local edit, keyed by field name
   *  (used to detect revert-to-original and to build inverse operations). */
  original: Record<string, any>;
  /** Last local revision that mutated this doc. */
  revision: number;
}

export type SyncStatus = 'pending' | 'syncing' | 'saved' | 'error';

export interface PendingOperation {
  opId: string;
  tenantId: string;
  /** Command kind, mirrors the command layer names (editCell, pasteRange, ...). */
  kind: string;
  /** Full payload for the sync phase. */
  payload: any;
  createdAt: number;
  syncStatus: SyncStatus;
  /** Number of attempts made by the sync coordinator. */
  attempts?: number;
  /** Set when this op is an idempotency guard (see coordinator). */
  idempotencyKey?: string;
}

/** A devotee-level sync payload: only changed fields. */
export interface DevoteePatch {
  id: string;
  fields: Record<string, any>;
  /** Inverse patch used for local undo / conflict rollback. */
  inverse: Record<string, any>;
}

/** Coalesced batch of devotee patches destined for Firestore. */
export interface SyncWriteBatch {
  updates: DevoteePatch[];
  deletions: { id: string }[];
  creations: { id: string; data: Record<string, any> }[];
}

/** Progress for a large bulk Firestore operation (e.g. deleting 10k rows),
 *  reported chunk-by-chunk so the UI can show a progress bar without
 *  freezing the tab. */
export interface BulkProgress {
  active: boolean;
  /** Human label, e.g. "Deleting records…". */
  label: string;
  total: number;
  processed: number;
  percent: number;
  /** IDs that failed in completed chunks (for partial-failure reporting). */
  failedIds?: string[];
  /** Whether the operation finished (all chunks attempted). */
  completed?: boolean;
}

/** Durable job record for a bulk operation that must survive page refresh. */
export interface BulkJob {
  jobId: string;
  operationType: string;
  recordIds: string[];
  totalCount: number;
  completedCount: number;
  failedCount: number;
  /** IDs that failed Firestore writes (retryable). */
  failedIds: string[];
  currentChunk: number;
  status: 'running' | 'completed' | 'failed' | 'needs_attention';
  createdAt: number;
  updatedAt: number;
  retryCount: number;
  templeId: string;
}

export interface SyncState {
  /** Number of local ops queued but not yet acknowledged. */
  pending: number;
  /** Number currently being pushed to Firestore. */
  syncing: number;
  /** Number that completely failed and need attention. */
  failed: number;
  /** True when the store is fully hydrated and listener is active. */
  hydrated: boolean;
  /** True while a cold-start / server reconcile is in progress. */
  reconciling: boolean;
  lastError: string | null;
  /** Live progress of an in-flight bulk operation, or null when idle. */
  progress: BulkProgress | null;
  /** Active bulk jobs with durable state (for UI notification / retry). */
  activeJobs: BulkJob[];
  /** Pending delete IDs (to prevent local-cache resurrection). */
  pendingDeleteIds: string[];
  /** Pending restore IDs (to prevent local-cache resurrection on restore). */
  pendingRestoreIds: string[];
  /** Pending permanent delete IDs from history. */
  pendingPermanentDeleteIds: string[];
}

export function createEmptySyncState(): SyncState {
  return { pending: 0, syncing: 0, failed: 0, hydrated: false, reconciling: false, lastError: null, progress: null, activeJobs: [], pendingDeleteIds: [], pendingRestoreIds: [], pendingPermanentDeleteIds: [] };
}

/** Mapping from edited-row context to a Devotee merge patch. */
export interface CommandResult {
  /** Local mutation performed on the workspace store. */
  applied: boolean;
  /** Dirty per-doc patches produced by this command. */
  dirty: DevoteePatch[];
  /** History record to push (may be a no-op for view-only commands). */
  history?: any;
  /** Optional structural change (column/row ordering) for the persistence layer. */
  structural?: {
    rowOrder?: string[];
    columns?: any[];
  };
}
