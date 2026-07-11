import { useCallback, useMemo, useState } from 'react';
import { ColumnId, ColumnMeta } from './types';

export interface UseSpreadsheetColumns {
  /** Ordered list of column ids — mirrors the existing `columnOrder` useState. */
  columnOrder: ColumnId[];
  /** Per-column metadata (width/visible/pinned), keyed by column id. */
  columnMeta: Record<ColumnId, ColumnMeta>;
  setColumnOrder: (order: ColumnId[]) => void;
  /** Moves a column to a new index within the order (drag-to-reorder). */
  moveColumn: (columnId: ColumnId, toIndex: number) => void;
  /** Inserts a new column id right after `afterColumnId` (or at the end if omitted). */
  insertColumn: (columnId: ColumnId, afterColumnId?: ColumnId) => void;
  removeColumn: (columnId: ColumnId) => void;
  setColumnWidth: (columnId: ColumnId, width: number) => void;
  setColumnVisible: (columnId: ColumnId, visible: boolean) => void;
  setColumnPinned: (columnId: ColumnId, pinned: boolean) => void;
  getColumnMeta: (columnId: ColumnId) => ColumnMeta;
}

const DEFAULT_META = (id: ColumnId): ColumnMeta => ({ id, visible: true });

/**
 * Column State — ordering, width, visibility and pinning, kept separate
 * from Row State even though both are "structural" concerns, because
 * columns and rows scale independently (infinite columns is a distinct
 * future feature from infinite rows) and are virtualized on separate axes.
 * Mirrors the existing `columnOrder` useState in DatabaseManagement.tsx;
 * `columnMeta` is new capacity (width/visibility/pinning) not yet used by
 * the current table but required for the future formatting/drag engines.
 */
export function useSpreadsheetColumns(initialOrder: ColumnId[] = []): UseSpreadsheetColumns {
  const [columnOrder, setColumnOrderState] = useState<ColumnId[]>(initialOrder);
  const [columnMeta, setColumnMeta] = useState<Record<ColumnId, ColumnMeta>>({});

  const setColumnOrder = useCallback((order: ColumnId[]) => {
    setColumnOrderState(order);
  }, []);

  const moveColumn = useCallback((columnId: ColumnId, toIndex: number) => {
    setColumnOrderState(prev => {
      const fromIndex = prev.indexOf(columnId);
      if (fromIndex === -1) return prev;
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, columnId);
      return next;
    });
  }, []);

  const insertColumn = useCallback((columnId: ColumnId, afterColumnId?: ColumnId) => {
    setColumnOrderState(prev => {
      if (prev.includes(columnId)) return prev;
      if (!afterColumnId) return [...prev, columnId];
      const idx = prev.indexOf(afterColumnId);
      if (idx === -1) return [...prev, columnId];
      const next = [...prev];
      next.splice(idx + 1, 0, columnId);
      return next;
    });
  }, []);

  const removeColumn = useCallback((columnId: ColumnId) => {
    setColumnOrderState(prev => prev.filter(c => c !== columnId));
    setColumnMeta(prev => {
      if (!(columnId in prev)) return prev;
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  }, []);

  const setColumnWidth = useCallback((columnId: ColumnId, width: number) => {
    setColumnMeta(prev => ({ ...prev, [columnId]: { ...(prev[columnId] || DEFAULT_META(columnId)), width } }));
  }, []);

  const setColumnVisible = useCallback((columnId: ColumnId, visible: boolean) => {
    setColumnMeta(prev => ({ ...prev, [columnId]: { ...(prev[columnId] || DEFAULT_META(columnId)), visible } }));
  }, []);

  const setColumnPinned = useCallback((columnId: ColumnId, pinned: boolean) => {
    setColumnMeta(prev => ({ ...prev, [columnId]: { ...(prev[columnId] || DEFAULT_META(columnId)), pinned } }));
  }, []);

  const getColumnMeta = useCallback((columnId: ColumnId): ColumnMeta => {
    return columnMeta[columnId] || DEFAULT_META(columnId);
  }, [columnMeta]);

  return useMemo(() => ({
    columnOrder,
    columnMeta,
    setColumnOrder,
    moveColumn,
    insertColumn,
    removeColumn,
    setColumnWidth,
    setColumnVisible,
    setColumnPinned,
    getColumnMeta
  }), [columnOrder, columnMeta, setColumnOrder, moveColumn, insertColumn, removeColumn, setColumnWidth, setColumnVisible, setColumnPinned, getColumnMeta]);
}