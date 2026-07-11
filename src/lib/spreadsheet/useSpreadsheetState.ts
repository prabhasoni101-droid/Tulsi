import { useMemo } from 'react';
import { UseSpreadsheetSelection, useSpreadsheetSelection } from './useSpreadsheetSelection';
import { UseSpreadsheetEditing, useSpreadsheetEditing } from './useSpreadsheetEditing';
import { UseSpreadsheetClipboard, useSpreadsheetClipboard } from './useSpreadsheetClipboard';
import { UseSpreadsheetHistory, useSpreadsheetHistory } from './useSpreadsheetHistory';
import { UseSpreadsheetColumns, useSpreadsheetColumns } from './useSpreadsheetColumns';
import { UseSpreadsheetRows, useSpreadsheetRows } from './useSpreadsheetRows';
import { UseSpreadsheetViewport, useSpreadsheetViewport } from './useSpreadsheetViewport';
import { ColumnId, RowId } from './types';

export interface SpreadsheetStateManager<HistoryPayload = any> {
  selection: UseSpreadsheetSelection;
  editing: UseSpreadsheetEditing;
  clipboard: UseSpreadsheetClipboard;
  history: UseSpreadsheetHistory<HistoryPayload>;
  columns: UseSpreadsheetColumns;
  rows: UseSpreadsheetRows;
  viewport: UseSpreadsheetViewport;
}

/**
 * Spreadsheet State Manager
 * =========================
 * The single composition root for every spreadsheet state slice:
 * Selection, Editing, Clipboard, History, Column, Row, and
 * Viewport/Scroll state. Each slice is implemented as its own independent
 * hook (see the sibling files in this folder) — this hook only wires them
 * together and returns one object, so a component can either:
 *
 *   const sheet = useSpreadsheetState({ initialColumnOrder, initialRowOrder });
 *   // sheet.selection.beginSelection(...)
 *   // sheet.editing.startEditing(...)
 *   // sheet.history.push(...)
 *
 * ...or destructure only the slices it needs. No slice depends on another
 * slice's internals — Selection doesn't know about Editing, Clipboard
 * doesn't know about History, etc. This keeps every future feature
 * (formulas, formatting, drag, keyboard navigation) able to consume
 * exactly the state it needs without a monolithic reducer.
 *
 * IMPORTANT: this is architecture only. It is not yet wired into
 * DatabaseManagement.tsx — the existing table, its Firestore reads/writes,
 * and all current CRUD behavior are untouched. Adopting this manager is a
 * separate, incremental migration to be done slice-by-slice later.
 */
export function useSpreadsheetState<HistoryPayload = any>(options?: {
  initialColumnOrder?: ColumnId[];
  initialRowOrder?: RowId[];
}): SpreadsheetStateManager<HistoryPayload> {
  const selection = useSpreadsheetSelection();
  const editing = useSpreadsheetEditing();
  const clipboard = useSpreadsheetClipboard();
  const history = useSpreadsheetHistory<HistoryPayload>();
  const columns = useSpreadsheetColumns(options?.initialColumnOrder ?? []);
  const rows = useSpreadsheetRows(options?.initialRowOrder ?? []);
  const viewport = useSpreadsheetViewport();

  return useMemo(() => ({
    selection,
    editing,
    clipboard,
    history,
    columns,
    rows,
    viewport
  }), [selection, editing, clipboard, history, columns, rows, viewport]);
}