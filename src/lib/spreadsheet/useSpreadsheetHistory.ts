import { useCallback, useMemo, useState } from 'react';
import { HistoryEntry } from './types';

export interface UseSpreadsheetHistory<T = any> {
  /** Past actions, most recent last. Same shape/order as the existing
   *  `history` useState array in DatabaseManagement.tsx. */
  past: HistoryEntry<T>[];
  /** Actions available to redo, most recent last. Mirrors `redoStack`. */
  future: HistoryEntry<T>[];
  canUndo: boolean;
  canRedo: boolean;
  /** Pushes a new action onto history and clears the redo stack, exactly
   *  like the existing pattern (`setHistory(h => [...h, action]); setRedoStack([])`). */
  push: (type: string, payload: T) => void;
  /** Pops the most recent entry off `past` and moves it onto `future`.
   *  Returns the popped entry so the caller can perform the actual
   *  Firestore-side undo (unchanged from current behavior). */
  undo: () => HistoryEntry<T> | undefined;
  /** Pops the most recent entry off `future` and moves it back onto `past`. */
  redo: () => HistoryEntry<T> | undefined;
  /** Clears both stacks (e.g. on sheet switch). */
  reset: () => void;
}

let historyIdCounter = 0;
function nextHistoryId(): string {
  historyIdCounter += 1;
  return `hist_${Date.now()}_${historyIdCounter}`;
}

/**
 * History State — undo/redo, kept independent from every other slice so
 * that, for example, clearing a selection or closing a cell editor never
 * accidentally touches the undo stack. Formalizes the existing
 * `history`/`redoStack` useState pair in DatabaseManagement.tsx as a
 * reusable hook without changing the entry shape those call sites rely on
 * (`{ type, payload... }` stays a plain object the caller controls).
 */
export function useSpreadsheetHistory<T = any>(): UseSpreadsheetHistory<T> {
  const [past, setPast] = useState<HistoryEntry<T>[]>([]);
  const [future, setFuture] = useState<HistoryEntry<T>[]>([]);

  const push = useCallback((type: string, payload: T) => {
    const entry: HistoryEntry<T> = { id: nextHistoryId(), type, payload, timestamp: Date.now() };
    setPast(prev => [...prev, entry]);
    setFuture([]);
  }, []);

  const undo = useCallback((): HistoryEntry<T> | undefined => {
    let popped: HistoryEntry<T> | undefined;
    setPast(prev => {
      if (prev.length === 0) return prev;
      popped = prev[prev.length - 1];
      return prev.slice(0, -1);
    });
    if (popped) {
      setFuture(prev => [...prev, popped!]);
    }
    return popped;
  }, []);

  const redo = useCallback((): HistoryEntry<T> | undefined => {
    let popped: HistoryEntry<T> | undefined;
    setFuture(prev => {
      if (prev.length === 0) return prev;
      popped = prev[prev.length - 1];
      return prev.slice(0, -1);
    });
    if (popped) {
      setPast(prev => [...prev, popped!]);
    }
    return popped;
  }, []);

  const reset = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  return useMemo(() => ({
    past,
    future,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    push,
    undo,
    redo,
    reset
  }), [past, future, push, undo, redo, reset]);
}