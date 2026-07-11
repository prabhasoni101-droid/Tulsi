/**
 * Spreadsheet Engine — Core Types
 * ================================
 * Foundational type definitions shared by every spreadsheet state slice
 * and hook. This module has zero runtime logic — it exists purely to
 * give every other module in `src/lib/spreadsheet` a single, consistent
 * vocabulary (cell address, range, selection shape, etc).
 *
 * Nothing in this package is wired into DatabaseManagement.tsx yet.
 * It is architecture only, additive and side-effect free, designed to be
 * adopted incrementally without touching existing Firestore/CRUD logic.
 */

/** A single cell address, identified by row/column index (0-based). */
export interface CellAddress {
  row: number;
  col: number;
}

/** A rectangular range of cells, inclusive on both ends. */
export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/** Normalizes a range so start <= end on both axes, regardless of drag direction. */
export function normalizeRange(range: CellRange): CellRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    endRow: Math.max(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endCol: Math.max(range.startCol, range.endCol)
  };
}

/** Whether a cell address falls inside a (possibly un-normalized) range. */
export function isCellInRange(cell: CellAddress, range: CellRange): boolean {
  const n = normalizeRange(range);
  return cell.row >= n.startRow && cell.row <= n.endRow && cell.col >= n.startCol && cell.col <= n.endCol;
}

export function rangeRowCount(range: CellRange): number {
  const n = normalizeRange(range);
  return n.endRow - n.startRow + 1;
}

export function rangeColCount(range: CellRange): number {
  const n = normalizeRange(range);
  return n.endCol - n.startCol + 1;
}

/** A generic identifier for a row — matches Firestore doc id today. */
export type RowId = string;

/** A generic identifier for a column — matches the column label today (e.g. "Name", "Contact No."). */
export type ColumnId = string;

/** Direction used by keyboard/selection navigation (future keyboard engine). */
export type NavigationDirection = 'up' | 'down' | 'left' | 'right';

/** Describes a single clipboard cell entry: value plus its originating address, for paste-shape reconstruction. */
export interface ClipboardCell {
  rowOffset: number;
  colOffset: number;
  value: string;
}

/** The shape of a clipboard payload — a rectangular grid of cell values plus its source range. */
export interface ClipboardPayload {
  sourceRange: CellRange;
  cells: ClipboardCell[];
  mode: 'copy' | 'cut';
}

/** A single undoable/redoable action. Intentionally generic (`payload: any`)
 *  so it stays compatible with the existing `recordActivity`-style actions
 *  already used in DatabaseManagement.tsx (import, cell edit, row delete, etc). */
export interface HistoryEntry<T = any> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
}

/** Column sizing/ordering/visibility metadata — the Column State slice. */
export interface ColumnMeta {
  id: ColumnId;
  width?: number;
  visible: boolean;
  pinned?: boolean;
}

/** Row sizing/ordering metadata — the Row State slice. */
export interface RowMeta {
  id: RowId;
  height?: number;
}

/** The visible window into the grid — the Viewport State slice. Consumed by
 *  virtualization (e.g. @tanstack/react-virtual) without owning it. */
export interface ViewportState {
  firstVisibleRow: number;
  lastVisibleRow: number;
  firstVisibleCol: number;
  lastVisibleCol: number;
}

/** Raw scroll position — the Scroll State slice. Kept separate from
 *  Viewport State because scroll is a continuous physical quantity while
 *  viewport is the derived discrete row/col window. */
export interface ScrollState {
  scrollTop: number;
  scrollLeft: number;
}

/** Editing State slice — which single cell (if any) is currently being edited. */
export interface EditingState {
  address: CellAddress | null;
  rowId: RowId | null;
  columnId: ColumnId | null;
  draftValue: string;
}

/** Selection State slice — the active range plus the anchor/focus cells
 *  needed for shift-click and keyboard-driven range extension. */
export interface SelectionState {
  anchor: CellAddress | null;
  focus: CellAddress | null;
  range: CellRange | null;
  isSelecting: boolean;
}