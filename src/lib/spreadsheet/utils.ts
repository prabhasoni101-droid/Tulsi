import { CellAddress, CellRange, ColumnId, RowId, normalizeRange } from './types';

/**
 * Spreadsheet Utilities
 * =====================
 * Pure, dependency-free helper functions used across the spreadsheet hooks
 * and (eventually) rendering layer. Nothing here touches React state or
 * Firestore — every function is a straightforward, testable transform.
 */

/** Converts a 0-based column index to a spreadsheet-style label (A, B, ..., Z, AA, AB, ...). */
export function columnIndexToLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/** Converts a spreadsheet-style column label (A, B, ..., AA, ...) back to a 0-based index. */
export function columnLabelToIndex(label: string): number {
  let n = 0;
  for (let i = 0; i < label.length; i++) {
    n = n * 26 + (label.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Formats a cell address as an A1-style reference string, e.g. {row:0,col:0} -> "A1". */
export function addressToA1(address: CellAddress): string {
  return `${columnIndexToLabel(address.col)}${address.row + 1}`;
}

/** Parses an A1-style reference string back into a cell address. Returns null if malformed. */
export function a1ToAddress(a1: string): CellAddress | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(a1.trim());
  if (!match) return null;
  const col = columnLabelToIndex(match[1].toUpperCase());
  const row = parseInt(match[2], 10) - 1;
  if (isNaN(row) || col < 0) return null;
  return { row, col };
}

/** Total cell count in a range, accounting for un-normalized (dragged backwards) ranges. */
export function rangeCellCount(range: CellRange): number {
  const n = normalizeRange(range);
  return (n.endRow - n.startRow + 1) * (n.endCol - n.startCol + 1);
}

/** True if two ranges overlap at all. */
export function rangesOverlap(a: CellRange, b: CellRange): boolean {
  const na = normalizeRange(a);
  const nb = normalizeRange(b);
  return na.startRow <= nb.endRow && na.endRow >= nb.startRow && na.startCol <= nb.endCol && na.endCol >= nb.startCol;
}

/** Builds a plain-text, tab/newline-delimited grid for a range — the same
 *  shape already produced ad hoc for `navigator.clipboard.writeText` calls
 *  in DatabaseManagement.tsx, extracted here as a reusable, testable helper. */
export function rangeToTsv(range: CellRange, getCellValue: (row: number, col: number) => string): string {
  const n = normalizeRange(range);
  const lines: string[] = [];
  for (let r = n.startRow; r <= n.endRow; r++) {
    const cells: string[] = [];
    for (let c = n.startCol; c <= n.endCol; c++) {
      cells.push(getCellValue(r, c) ?? '');
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

/** Parses a tab/newline-delimited string (e.g. pasted from Excel/Sheets) into a 2D grid of strings. */
export function tsvToGrid(tsv: string): string[][] {
  return tsv
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.split('\t'));
}

/** Clamps a row/col index into `[0, max]`, used when navigation would otherwise run off the grid. */
export function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(index, max));
}

/** Reorders a list by moving the item at `fromIndex` to `toIndex`, returning a new array. */
export function reorderList<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clampIndex(toIndex, next.length), 0, moved);
  return next;
}

/** Builds a lookup index (id -> position) for O(1) row/column order lookups,
 *  avoiding repeated `.indexOf()` scans as row/column counts grow. */
export function buildOrderIndex(ids: (RowId | ColumnId)[]): Map<RowId | ColumnId, number> {
  const map = new Map<RowId | ColumnId, number>();
  ids.forEach((id, idx) => map.set(id, idx));
  return map;
}