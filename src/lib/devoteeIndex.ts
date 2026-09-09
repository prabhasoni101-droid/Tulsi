import { Devotee } from '../types';

/** Sort direction as used by the Owner database view model. */
export type SortDirection = 'asc' | 'desc';

/** A single-column sort specification for the filtered view. */
export interface SortSpec {
  key: string;
  direction: SortDirection;
}

/**
 * devoteeIndex.ts
 * ================
 * Reusable, incremental, normalized index for the Owner database.
 *
 * Solves the PDR Section 25 / AI_RULES performance problem:
 *   - duplicate grouping,
 *   - object-value scanning (Object.values(d).join(...)),
 *   - search text construction,
 * were previously recomputed over the FULL dataset on every render.
 *
 * This module maintains, per row:
 *   - `normalizedName`   (collapsed + lowercased)
 *   - `normalizedPhone`  (digits-only, country-code normalised)
 *   - `searchText`       (once, cached; reused across every keystroke)
 * and a set of *composite* duplicate buckets that are patched incrementally
 * whenever a row is added / removed / edited (requirement #3, #13).
 *
 * `sync(devotees)` is O(changed) for indexing + O(affected-rows) for duplicate
 * status recomputation. Stable object references are returned for rows whose
 * status hasn't changed, so React memos short-circuit.
 */

export type DuplicateStatus = Devotee['duplicateType'];

/** Internal per-row index record. The `ref` is the *original* devotee object —
 *  we never mutate source data; we only attach status on a shadow copy. */
interface IndexedRow {
  id: string;
  ref: Devotee;
  name: string; // normalizedName
  phone: string; // normalizedPhone
  searchText: string;
}

/** Shadow output row: the source devotee plus derived fields the view layer
 *  consumes (`duplicateType`, `_searchText`). Reused across renders when none
 *  of its derived values changed. */
interface CachedOutput {
  out: Devotee;
  status: DuplicateStatus;
  searchText: string;
}

/** Collapse whitespace and lowercase. */
function normalizeName(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Phone normalization used *only* for duplicate-grouping/identity keys.
 * Strips everything except digits so "+91 98765 43210", "9876543210" and
 * "+919876543210" all resolve to the same signature. Empty/unknown phones map
 * to '' and are excluded from the phone bucket entirely, so a blank phone is
 * never treated as a duplicate contact of another blank (or any) phone.
 */
function normalizePhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export class DevoteeSearchIndex {
  private byId = new Map<string, IndexedRow>();
  /** phone -> name -> set<id>  (used for complete + duplicate-contact) */
  private byPhone = new Map<string, Map<string, Set<string>>>();
  /** name -> phone -> set<id>  (used for duplicate-name) */
  private byName = new Map<string, Map<string, Set<string>>>();
  /** id -> cached shadow output for the current status/searchText. */
  private output = new Map<string, CachedOutput>();
  /** ids requiring duplicate-status recomputation this cycle. */
  private affected = new Set<string>();

  /** Returns the number of indexed rows (used by tests/perf). */
  size(): number {
    return this.byId.size;
  }

  /**
   * Incrementally reconcile the index with the supplied dataset.
   * Rows whose searchable fields haven't changed keep their cached `_searchText`
   * and (when their duplicate status is unchanged) the exact same output object
   * reference. Returns a brand-new array reflecting the input order.
   */
  sync(devotees: Devotee[]): Devotee[] {
    const seen = new Set<string>();
    for (const d of devotees) {
      if (!d?.id) continue;
      seen.add(d.id);
      this.upsert(d);
    }
    // Drop ids that disappeared from the dataset.
    if (this.byId.size !== seen.size) {
      for (const id of Array.from(this.byId.keys())) {
        if (!seen.has(id)) this.removeIndex(id);
      }
    }
    // Recompute duplicate status only for rows whose buckets changed.
    if (this.affected.size > 0) {
      for (const id of this.affected) this.recompute(id);
      this.affected.clear();
    }
    // Materialize in the caller's order, reusing cached shadow objects.
    const out = new Array<Devotee>(devotees.length);
    for (let i = 0; i < devotees.length; i++) {
      const d = devotees[i];
      if (!d?.id) {
        out[i] = d;
        continue;
      }
      out[i] = this.output.get(d.id)?.out ?? this.ensureOutput(this.byId.get(d.id));
    }
    return out;
  }

  private upsert(d: Devotee): void {
    const id = d.id!;
    const name = normalizeName(d.name);
    const phone = normalizePhone(d.contact);
    const searchText = this.buildSearchText(d);
    const existing = this.byId.get(id);

    if (existing) {
      const unchanged =
        existing.ref === d ||
        (existing.name === name && existing.phone === phone && existing.searchText === searchText);
      if (unchanged) {
        // Same object reference -> no data change at all; keep the cached shadow
        // object so React memos retain their identity. Only rebuild the shadow
        // copy when a NEW object arrived with identical derived values.
        if (existing.ref !== d) {
          existing.ref = d;
          this.refreshDataOnly(id);
        }
        return;
      }
      this.removeIndex(id); // records old-group peers as affected
    }
    const row: IndexedRow = { id, ref: d, name, phone, searchText };
    this.byId.set(id, row);
    this.addIndex(row);
    this.affected.add(id);
  }

  /** When only non-searchable data changed but derived values are stable,
   *  rebuild the shadow from the new ref while keeping status/searchText. */
  private refreshDataOnly(id: string): void {
    const row = this.byId.get(id);
    const cached = this.output.get(id);
    if (!row || !cached) return;
    cached.out = { ...row.ref, duplicateType: cached.status, _searchText: row.searchText };
  }

  /**
   * Insert into the composite buckets, marking peers ONLY on the transitions
   * that can actually change an existing peer's status. Duplicate status of a
   * row depends on (a) its (name,phone) bucket size, (b) how many distinct
   * names share its phone, (c) how many distinct phones share its name. Each of
   * those only changes when its count crosses 1 -> 2 on insert, so we never
   * iterate a whole large duplicate group. This keeps a 30k-row build O(N)
   * instead of O(N^2) for wide duplicate clusters.
   */
  private addIndex(row: IndexedRow): void {
    // (a)+(b) phone -> name -> set
    const pp = this.byPhone.get(row.phone);
    if (row.phone) {
      if (pp) {
        const completeSet = pp.get(row.name);
        if (completeSet && completeSet.size === 1) {
          // (a) (name,phone) bucket 1 -> 2: the lone complete peer changes.
          completeSet.forEach((peer) => this.affected.add(peer));
        } else if (!completeSet && pp.size === 1) {
          // (b) a NEW distinct name for this phone: the lone contact peer changes.
          for (const set of pp.values()) for (const peer of set) this.affected.add(peer);
        }
      }
    }
    // (c) name -> phone -> set
    const nn = this.byName.get(row.name);
    if (nn) {
      const phoneSet = nn.get(row.phone);
      if (!phoneSet && nn.size === 1) {
        // (c) a NEW distinct phone for this name: the lone name peer changes.
        for (const set of nn.values()) for (const peer of set) this.affected.add(peer);
      }
    }

    // Insert into the phone bucket (skip blank phones -> never contact-complete dup).
    if (row.phone) {
      let pb = this.byPhone.get(row.phone);
      if (!pb) {
        pb = new Map();
        this.byPhone.set(row.phone, pb);
      }
      let nameSet = pb.get(row.name);
      if (!nameSet) {
        nameSet = new Set();
        pb.set(row.name, nameSet);
      }
      nameSet.add(row.id);
    }

    // Insert into the name bucket.
    let nbm = this.byName.get(row.name);
    if (!nbm) {
      nbm = new Map();
      this.byName.set(row.name, nbm);
    }
    let pset = nbm.get(row.phone);
    if (!pset) {
      pset = new Set();
      nbm.set(row.phone, pset);
    }
    pset.add(row.id);
  }

  private removeIndex(id: string): void {
    const row = this.byId.get(id);
    if (!row) return;

    if (row.phone) {
      const pp = this.byPhone.get(row.phone);
      if (pp) {
        for (const set of pp.values()) for (const other of set) if (other !== id) this.affected.add(other);
        const nameSet = pp.get(row.name);
        nameSet?.delete(id);
        if (nameSet && nameSet.size === 0) pp.delete(row.name);
        if (pp.size === 0) this.byPhone.delete(row.phone);
      }
    }

    const nn = this.byName.get(row.name);
    if (nn) {
      for (const set of nn.values()) for (const other of set) if (other !== id) this.affected.add(other);
      const phoneSet = nn.get(row.phone);
      phoneSet?.delete(id);
      if (phoneSet && phoneSet.size === 0) nn.delete(row.phone);
      if (nn.size === 0) this.byName.delete(row.name);
    }
    this.byId.delete(id);
    this.affected.add(id);
  }

  /**
   * O(1) status lookup from the pre-built composite buckets.
   * PDR Section 14: strongest match first.
   *   complete        (same name + same phone) -> red
   *   partial_contact (same phone, diff name)  -> green
   *   partial_name    (same name,  diff phone) -> blue
   */
  private computeStatus(row: IndexedRow): DuplicateStatus {
    const phoneBucket = this.byPhone.get(row.phone);
    if ((phoneBucket?.get(row.name)?.size ?? 0) > 1) return 'complete';
    if ((phoneBucket?.size ?? 0) > 1) return 'partial_contact';
    if ((this.byName.get(row.name)?.size ?? 0) > 1) return 'partial_name';
    return null;
  }

  private recompute(id: string): void {
    const row = this.byId.get(id);
    if (!row) {
      this.output.delete(id);
      return;
    }
    const status = this.computeStatus(row);
    const cached = this.output.get(id);
    if (cached && cached.status === status && cached.searchText === row.searchText) {
      cached.out.duplicateType = status;
      if (cached.out === row.ref) {
        cached.out = { ...row.ref, duplicateType: status, _searchText: row.searchText };
      }
      return;
    }
    this.output.set(id, {
      out: { ...row.ref, duplicateType: status, _searchText: row.searchText },
      status,
      searchText: row.searchText,
    });
  }

  private ensureOutput(row: IndexedRow | undefined): Devotee {
    if (!row) return undefined as unknown as Devotee;
    const cached = this.output.get(row.id);
    if (cached) return cached.out;
    const status = this.computeStatus(row);
    const out: Devotee = { ...row.ref, duplicateType: status, _searchText: row.searchText };
    this.output.set(row.id, { out, status, searchText: row.searchText });
    return out;
  }

  /**
   * Build the searchable text ONCE per row (cached on the shadow output as
   * `_searchText`). When a row changes we only recompute that row's string —
   * never `Object.values(d).join(...)` for every row on every search.
   */
  private buildSearchText(d: Devotee): string {
    const parts: string[] = [];
    for (const key of Object.keys(d)) {
      if (key === 'id' || key === '_searchText' || key === 'duplicateType') continue;
      const val = (d as any)[key];
      if (val === null || val === undefined) continue;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        parts.push(String(val).toLowerCase());
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /** Convenience for tests: search a term against the cached search text. */
  query(records: Devotee[], term: string): Devotee[] {
    const tokens = term.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return records;
    return records.filter((d) => tokens.every((t) => String((d as any)._searchText ?? '').includes(t)));
  }
}

/**
 * Column-value normalization for sorting (text / number / date / phone /
 * custom columns). Mirrors the spreadsheet view semantics: numeric columns
 * coerce to numbers, everything else compares as text. Never mutates the
 * source record — reads only.
 */
export function getColumnValue(d: Devotee, key: string): number | string {
  switch (key) {
    case 'Name':
      return d.name || '';
    case 'Age':
      return d.age !== undefined && d.age !== null && d.age !== ''
        ? Number(d.age)
        : -1;
    case 'Gender':
      return d.gender || '';
    case 'Date of Birth':
      return d.dob || '';
    case 'Address':
      return d.address || '';
    case 'Institute':
      return d.institute || '';
    case 'Mentor':
      return d.mentor || '';
    case 'Facilitator':
      return d.facilitatorName || d.facilitator || '';
    case 'Chanting':
      return d.chanting !== undefined && d.chanting !== null && d.chanting !== ''
        ? Number(d.chanting)
        : -1;
    case 'Contact No.':
      return d.contact || '';
    case 'Attendance':
      return d.attendanceCount ?? 0;
    default:
      // Custom columns / date strings: read directly, default text compare.
      return (d as any)[key] ?? '';
  }
}

/**
 * Deterministic two-row comparator for a single sort column. Numeric values
 * compare arithmetically, everything else uses localeCompare. Returns the
 * source data untouched (view-only operation, AI_RULES #13 / PDR Section 25).
 */
export function compareRows(a: Devotee, b: Devotee, key: string, direction: SortDirection): number {
  const aVal = getColumnValue(a, key);
  const bVal = getColumnValue(b, key);
  if (typeof aVal === 'number' && typeof bVal === 'number') {
    return direction === 'asc' ? aVal - bVal : bVal - aVal;
  }
  return direction === 'asc'
    ? String(aVal).localeCompare(String(bVal))
    : String(bVal).localeCompare(String(aVal));
}

/**
 * Stable, deterministic multi-filter + search predicate over a pre-normalized
 * record (which already carries `_searchText` and `duplicateType`).
 * Search is real-time/word-by-word (every token must be present, PDR Section
 * 25), and the optional duplicate filter uses AND semantics when combined with
 * search (Prompt 5 requirement #10).
 */
export function matchesFilters(
  d: Devotee,
  opts: {
    searchTokens?: string[];
    showDuplicatesOnly?: boolean;
    duplicateFilterType?: 'contact' | 'name' | 'complete' | null;
  }
): boolean {
  const { searchTokens, showDuplicatesOnly, duplicateFilterType } = opts;
  if (searchTokens && searchTokens.length > 0) {
    const text = String((d as any)._searchText ?? '');
    if (!searchTokens.every((t) => text.includes(t))) return false;
  }
  if (showDuplicatesOnly) {
    if (duplicateFilterType === 'contact') {
      if (d.duplicateType !== 'partial_contact' && d.duplicateType !== 'complete') return false;
    } else if (duplicateFilterType === 'name') {
      if (d.duplicateType !== 'partial_name' && d.duplicateType !== 'complete') return false;
    } else if (duplicateFilterType === 'complete') {
      if (d.duplicateType !== 'complete') return false;
    } else if (!d.duplicateType) {
      return false;
    }
  }
  return true;
}