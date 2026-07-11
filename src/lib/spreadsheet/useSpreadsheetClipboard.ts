import { useCallback, useMemo, useState } from 'react';
import { CellRange, ClipboardPayload, normalizeRange } from './types';

export interface UseSpreadsheetClipboard {
  clipboard: ClipboardPayload | null;
  /** Stores a copied/cut range as a reusable payload (paste-ready shape). */
  copyRange: (range: CellRange, getCellValue: (row: number, col: number) => string, mode?: 'copy' | 'cut') => ClipboardPayload;
  /** Clears the clipboard (e.g. after a paste of a 'cut' payload, or Escape). */
  clearClipboard: () => void;
  /** True if there is a payload ready to paste. */
  hasClipboardContent: boolean;
}

/**
 * Clipboard State — separate from Selection State because what's selected
 * (the copy source) and what's in the clipboard (the paste payload) are
 * different lifetimes: a selection changes as soon as the user clicks
 * elsewhere, but a clipboard payload should persist until an explicit
 * copy/cut/paste/escape action changes it.
 *
 * This does not replace the existing `navigator.clipboard.writeText` calls
 * in DatabaseManagement.tsx (system clipboard interop for cross-app paste
 * stays as-is); it adds an in-memory structured payload so a future paste
 * engine can reconstruct a rectangular block instead of only ever pasting
 * plain text into a single cell.
 */
export function useSpreadsheetClipboard(): UseSpreadsheetClipboard {
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);

  const copyRange = useCallback((
    range: CellRange,
    getCellValue: (row: number, col: number) => string,
    mode: 'copy' | 'cut' = 'copy'
  ): ClipboardPayload => {
    const n = normalizeRange(range);
    const cells: ClipboardPayload['cells'] = [];
    for (let r = n.startRow; r <= n.endRow; r++) {
      for (let c = n.startCol; c <= n.endCol; c++) {
        cells.push({ rowOffset: r - n.startRow, colOffset: c - n.startCol, value: getCellValue(r, c) });
      }
    }
    const payload: ClipboardPayload = { sourceRange: n, cells, mode };
    setClipboard(payload);
    return payload;
  }, []);

  const clearClipboard = useCallback(() => setClipboard(null), []);

  return useMemo(() => ({
    clipboard,
    copyRange,
    clearClipboard,
    hasClipboardContent: clipboard !== null
  }), [clipboard, copyRange, clearClipboard]);
}