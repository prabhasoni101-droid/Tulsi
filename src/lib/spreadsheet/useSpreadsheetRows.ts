import { useCallback, useMemo, useState } from 'react';
import { RowId, RowMeta } from './types';

export interface RowDragState {
  active: boolean;
  startIndex: number;
  currentIndex: number;
  draggedId?: RowId;
}

const IDLE_DRAG: RowDragState = { active: false, startIndex: -1, currentIndex: -1 };

export interface UseSpreadsheetRows {
  rowOrder: RowId[];
  rowMeta: Record<RowId, RowMeta>;
  dragState: RowDragState;
  setRowOrder: (order: RowId[]) => void;
  startRowDrag: (startIndex: number, draggedId: RowId) => void;
  updateRowDrag: (currentIndex: number) => void;
  endRowDrag: () => void;
  setRowHeight: (rowId: RowId, height: number) => void;
  getRowMeta: (rowId: RowId) => RowMeta;
}

/**
 * Row State — ordering and drag-reorder gesture, kept separate from
 * Selection State (dragging a row to reorder it is a different gesture
 * from dragging to select a cell range) and from Viewport State (row
 * order is a data concern; viewport is purely "what's currently visible").
 * Formalizes the existing `rowDragConfig` useState in
 * DatabaseManagement.tsx into a reusable hook with the same field names
 * (`active`, `startIndex`, `currentIndex`, `draggedId`) so adopting it
 * later is a drop-in rename rather than a logic change.
 */
export function useSpreadsheetRows(initialOrder: RowId[] = []): UseSpreadsheetRows {
  const [rowOrder, setRowOrderState] = useState<RowId[]>(initialOrder);
  const [rowMeta, setRowMeta] = useState<Record<RowId, RowMeta>>({});
  const [dragState, setDragState] = useState<RowDragState>(IDLE_DRAG);

  const setRowOrder = useCallback((order: RowId[]) => setRowOrderState(order), []);

  const startRowDrag = useCallback((startIndex: number, draggedId: RowId) => {
    setDragState({ active: true, startIndex, currentIndex: startIndex, draggedId });
  }, []);

  const updateRowDrag = useCallback((currentIndex: number) => {
    setDragState(prev => (prev.active ? { ...prev, currentIndex } : prev));
  }, []);

  const endRowDrag = useCallback(() => {
    setDragState(IDLE_DRAG);
  }, []);

  const setRowHeight = useCallback((rowId: RowId, height: number) => {
    setRowMeta(prev => ({ ...prev, [rowId]: { id: rowId, height } }));
  }, []);

  const getRowMeta = useCallback((rowId: RowId): RowMeta => {
    return rowMeta[rowId] || { id: rowId };
  }, [rowMeta]);

  return useMemo(() => ({
    rowOrder,
    rowMeta,
    dragState,
    setRowOrder,
    startRowDrag,
    updateRowDrag,
    endRowDrag,
    setRowHeight,
    getRowMeta
  }), [rowOrder, rowMeta, dragState, setRowOrder, startRowDrag, updateRowDrag, endRowDrag, setRowHeight, getRowMeta]);
}