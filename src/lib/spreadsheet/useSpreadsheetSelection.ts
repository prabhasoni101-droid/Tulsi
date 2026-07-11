import { useCallback, useMemo, useState } from 'react';
import { CellAddress, SelectionState, normalizeRange } from './types';

const EMPTY_SELECTION: SelectionState = {
  anchor: null,
  focus: null,
  range: null,
  isSelecting: false
};

export interface UseSpreadsheetSelection {
  selection: SelectionState;
  /** Starts a new selection at `cell` (e.g. on mousedown). */
  beginSelection: (cell: CellAddress) => void;
  /** Extends the current selection to `cell` (e.g. on mouseenter while dragging, or shift-click). */
  extendSelection: (cell: CellAddress) => void;
  /** Ends the drag/selecting gesture (e.g. on mouseup). Selection itself is preserved. */
  endSelection: () => void;
  /** Clears the selection entirely. */
  clearSelection: () => void;
  /** True if the given cell is inside the current selection range. */
  isCellSelected: (cell: CellAddress) => boolean;
}

/**
 * Selection State — owns anchor/focus/range for range selection, decoupled
 * from Editing State (a cell can be selected without being edited) and from
 * Clipboard State (selection is what you copy FROM; clipboard is what was
 * copied). Mirrors the anchor+drag model already used ad hoc in
 * DatabaseManagement.tsx's `selection` useState, formalized as a reusable hook.
 */
export function useSpreadsheetSelection(): UseSpreadsheetSelection {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);

  const beginSelection = useCallback((cell: CellAddress) => {
    setState({
      anchor: cell,
      focus: cell,
      range: { startRow: cell.row, startCol: cell.col, endRow: cell.row, endCol: cell.col },
      isSelecting: true
    });
  }, []);

  const extendSelection = useCallback((cell: CellAddress) => {
    setState(prev => {
      const anchor = prev.anchor ?? cell;
      return {
        anchor,
        focus: cell,
        range: { startRow: anchor.row, startCol: anchor.col, endRow: cell.row, endCol: cell.col },
        isSelecting: prev.isSelecting
      };
    });
  }, []);

  const endSelection = useCallback(() => {
    setState(prev => ({ ...prev, isSelecting: false }));
  }, []);

  const clearSelection = useCallback(() => {
    setState(EMPTY_SELECTION);
  }, []);

  const isCellSelected = useCallback((cell: CellAddress) => {
    if (!state.range) return false;
    const n = normalizeRange(state.range);
    return cell.row >= n.startRow && cell.row <= n.endRow && cell.col >= n.startCol && cell.col <= n.endCol;
  }, [state.range]);

  return useMemo(() => ({
    selection: state,
    beginSelection,
    extendSelection,
    endSelection,
    clearSelection,
    isCellSelected
  }), [state, beginSelection, extendSelection, endSelection, clearSelection, isCellSelected]);
}