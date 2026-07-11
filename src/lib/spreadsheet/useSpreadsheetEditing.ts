import { useCallback, useMemo, useState } from 'react';
import { CellAddress, ColumnId, EditingState, RowId } from './types';

const EMPTY_EDITING: EditingState = {
  address: null,
  rowId: null,
  columnId: null,
  draftValue: ''
};

export interface UseSpreadsheetEditing {
  editing: EditingState;
  /** True while any cell is being edited. */
  isEditing: boolean;
  /** Opens the editor for a given cell with its starting value. */
  startEditing: (address: CellAddress, rowId: RowId, columnId: ColumnId, initialValue: string) => void;
  /** Updates the in-progress draft value without committing it. */
  setDraftValue: (value: string) => void;
  /** Closes the editor without saving. Caller decides whether to persist first. */
  stopEditing: () => void;
}

/**
 * Editing State — deliberately separate from Selection State. A cell can be
 * selected (highlighted, part of a range, copyable) without being edited,
 * and only one cell can ever be in edit mode at a time. This formalizes the
 * per-cell `isEditing`/`value` useState pair already used inside the
 * `EditableCell` component in DatabaseManagement.tsx, lifted to a shared,
 * spreadsheet-level slice so a future keyboard engine (Enter/Tab/Escape
 * across cells) has one source of truth instead of N independent copies.
 */
export function useSpreadsheetEditing(): UseSpreadsheetEditing {
  const [state, setState] = useState<EditingState>(EMPTY_EDITING);

  const startEditing = useCallback((address: CellAddress, rowId: RowId, columnId: ColumnId, initialValue: string) => {
    setState({ address, rowId, columnId, draftValue: initialValue });
  }, []);

  const setDraftValue = useCallback((value: string) => {
    setState(prev => (prev.address ? { ...prev, draftValue: value } : prev));
  }, []);

  const stopEditing = useCallback(() => {
    setState(EMPTY_EDITING);
  }, []);

  return useMemo(() => ({
    editing: state,
    isEditing: state.address !== null,
    startEditing,
    setDraftValue,
    stopEditing
  }), [state, startEditing, setDraftValue, stopEditing]);
}