/**
 * duplicateStyles.ts
 * ==================
 * Centralized, accessible duplicate-status-to-style mapping (PDR Section 14 +
 * Prompt 5 requirement #14).
 *
 * Complete duplicate  -> red   (same Name + same Contact)
 * Duplicate contact   -> green (same Contact, different Name)
 * Duplicate name      -> blue  (same Name, different Contact)
 *
 * All duplicate colour logic lives here. No Tailwind colour decisions are
 * scattered across cells. Selection overlays are deliberately rendered in a
 * distinct saffron/amber tint plus a duplicate-coloured edge so a selected
 * row can NEVER hide its duplicate status and selection never reads as a
 * duplicate colour.
 */
import type { DuplicateStatus } from './devoteeIndex';

export interface DuplicateStyle {
  /** Row background tint for the duplicated row. */
  row: string;
  /** Left border accent on the row-index cell. */
  indexBorder: string;
  /** Colour of the row index number. */
  indexText: string;
  /** Small dot indicator at the bottom of the index cell. */
  dot: string;
}

const NON_DUPLICATE: DuplicateStyle = {
  row: '',
  indexBorder: '',
  indexText: '',
  dot: '',
};

/** status -> row-level duplicate presentation. */
const DUPLICATE_STYLES: Record<NonNullable<DuplicateStatus>, DuplicateStyle> = {
  complete: {
    row: 'bg-red-50 text-red-600',
    indexBorder: 'border-l-4 border-red-500',
    indexText: 'text-red-600',
    dot: 'bg-red-500',
  },
  partial_contact: {
    row: 'bg-green-50 text-green-600',
    indexBorder: 'border-l-4 border-green-500',
    indexText: 'text-green-600',
    dot: 'bg-green-500',
  },
  partial_name: {
    row: 'bg-blue-50 text-blue-600',
    indexBorder: 'border-l-4 border-blue-500',
    indexText: 'text-blue-600',
    dot: 'bg-blue-500',
  },
};

/**
 * Row-level presentation for a duplicate status. Always returns a stable
 * object so it can be used directly; unknown/undefined status -> no styling.
 */
export function getDuplicateStyle(status: DuplicateStatus): DuplicateStyle {
  if (!status) return NON_DUPLICATE;
  return DUPLICATE_STYLES[status];
}

/**
 * Selection overlay for body cells. Uses a saffron/amber tint that is visually
 * distinct from every duplicate colour, plus a status-appropriate edge so the
 * duplicate indicator stays visible while a row is selected.
 */
export function getSelectionOverlayClass(status: DuplicateStatus): string {
  if (!status) return 'bg-saffron/30';
  switch (status) {
    case 'complete':
      return 'bg-saffron/30 border-b-2 border-red-600';
    case 'partial_contact':
      return 'bg-saffron/30 border-b-2 border-green-600';
    case 'partial_name':
      return 'bg-saffron/30 border-b-2 border-blue-600';
  }
}

/**
 * Selection overlay for the row-index cell. Same saffron/amber tint, with a
 * status ring so duplicate state is never hidden by selection.
 */
export function getIndexSelectionOverlayClass(status: DuplicateStatus): string {
  if (!status) return 'bg-saffron/30';
  switch (status) {
    case 'complete':
      return 'bg-saffron/30 ring-2 ring-red-400';
    case 'partial_contact':
      return 'bg-saffron/30 ring-2 ring-green-400';
    case 'partial_name':
      return 'bg-saffron/30 ring-2 ring-blue-400';
  }
}