import { DirtyDoc, DevoteePatch } from './syncTypes';

/**
 * Dirty Tracking
 * ==============
 * (PDR Section D)
 *
 * Tracks ONLY the changed fields of each locally-edited devotee document so we
 * never write an unchanged field — nor a whole document when only one field
 * changed — to Firestore.
 *
 * Rules:
 *  - Only changed fields are retained.
 *  - Multiple edits to the same doc are merged into one patch (coalescing).
 *  - A field is removed from the dirty set when restored to its original value
 *    (i.e. the edit no longer differs from the last-known server value).
 *  - Rapid edits coalesce into one backend payload via `takePending()`.
 */

interface InternalDirtyDoc {
  docId: string;
  fields: Record<string, any>;
  original: Record<string, any>;
}

export class DirtyTracker {
  private byDoc = new Map<string, InternalDirtyDoc>();
  private nextRevision = 1;

  /**
   * Records a field edit. `originalValue` is the last-known persisted value
   * (the base we compare against); capturing it per-field lets us drop a field
   * from the dirty set if the user edits it back to its original value.
   */
  set(id: string, field: string, value: any, originalValue: any): void {
    let doc = this.byDoc.get(id);
    if (!doc) {
      doc = { docId: id, fields: {}, original: {} };
      this.byDoc.set(id, doc);
    }

    const original = originalValue === undefined ? (id in doc.original ? doc.original[field] : undefined) : originalValue;
    doc.original[field] = original;

    if (normalizeEqual(value, original)) {
      // Edit reverted to original: drop the field from the dirty set entirely.
      delete doc.fields[field];
    } else {
      doc.fields[field] = value;
    }

    if (Object.keys(doc.fields).length === 0 && Object.keys(doc.original).length === 0) {
      this.byDoc.delete(id);
    }
  }

  /** Merges a whole patch onto a doc's dirty fields (coalesce). */
  merge(id: string, patch: Record<string, any>, originalBase: Record<string, any>): void {
    let doc = this.byDoc.get(id);
    if (!doc) {
      doc = { docId: id, fields: {}, original: {} };
      this.byDoc.set(id, doc);
    }
    Object.keys(patch).forEach((field) => {
      const original = field in originalBase ? originalBase[field] : (field in doc.original ? doc.original[field] : undefined);
      doc.original[field] = original;
      if (normalizeEqual(patch[field], original)) {
        delete doc.fields[field];
      } else {
        doc.fields[field] = patch[field];
      }
    });
    if (Object.keys(doc.fields).length === 0) this.byDoc.delete(id);
  }

  /** True when the given doc has at least one dirty field. */
  isDirty(id: string): boolean {
    const doc = this.byDoc.get(id);
    return !!doc && Object.keys(doc.fields).length > 0;
  }

  /** Builds inverse patches for every dirty doc (used to roll back on failure). */
  private originalFor(id: string): Record<string, any> {
    return this.byDoc.get(id)?.original ?? {};
  }

  /**
   * Atomically returns and clears all currently-dirty docs as devotee patches,
   * advancing the revision. Each returned patch carries only the changed fields
   * plus a full inverse (original values) for rollback/undo.
   */
  takePending(): DirtyDoc[] {
    const result: DirtyDoc[] = [];
    const revision = this.nextRevision++;
    for (const doc of this.byDoc.values()) {
      if (Object.keys(doc.fields).length === 0) continue;
      const inverse: Record<string, any> = {};
      Object.keys(doc.fields).forEach((f) => {
        inverse[f] = f in doc.original ? doc.original[f] : undefined;
      });
      result.push({ docId: doc.docId, fields: { ...doc.fields }, original: { ...doc.original }, revision });
    }
    this.byDoc.clear();
    return result;
  }

  /** Number of docs currently dirty. */
  size(): number {
    return this.byDoc.size;
  }
}

export function toDevoteePatches(dirtyDocs: DirtyDoc[]): DevoteePatch[] {
  return dirtyDocs.map((d) => ({
    id: d.docId,
    fields: { ...d.fields },
    inverse: { ...d.original },
  }));
}

/** Loose-equality for value comparison, treating '' / null / undefined equally. */
function normalizeEqual(a: any, b: any): boolean {
  const na = a === undefined || a === null ? '' : a;
  const nb = b === undefined || b === null ? '' : b;
  return String(na).trim() === String(nb).trim();
}
