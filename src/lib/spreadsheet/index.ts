/**
 * Spreadsheet Engine — Public API
 * ================================
 * Single import surface for the spreadsheet architecture foundation.
 *
 *   import { useSpreadsheetState, SpreadsheetGrid } from '@/lib/spreadsheet';
 *
 * This package is additive scaffolding: types, state hooks, pure utilities
 * and a virtualization-ready rendering primitive. It is not yet wired into
 * DatabaseManagement.tsx or any other view — existing Owner Portal
 * behavior, Firestore reads/writes, and CRUD flows are completely
 * untouched by adding this package. It exists so future work (formulas,
 * formatting, drag-fill, keyboard navigation, infinite rows/columns) has
 * a clean, testable foundation to build on incrementally.
 */

export * from './types';
export * from './utils';

export { useSpreadsheetSelection } from './useSpreadsheetSelection';
export type { UseSpreadsheetSelection } from './useSpreadsheetSelection';

export { useSpreadsheetEditing } from './useSpreadsheetEditing';
export type { UseSpreadsheetEditing } from './useSpreadsheetEditing';

export { useSpreadsheetClipboard } from './useSpreadsheetClipboard';
export type { UseSpreadsheetClipboard } from './useSpreadsheetClipboard';

export { useSpreadsheetHistory } from './useSpreadsheetHistory';
export type { UseSpreadsheetHistory } from './useSpreadsheetHistory';

export { useSpreadsheetColumns } from './useSpreadsheetColumns';
export type { UseSpreadsheetColumns } from './useSpreadsheetColumns';

export { useSpreadsheetRows } from './useSpreadsheetRows';
export type { UseSpreadsheetRows, RowDragState } from './useSpreadsheetRows';

export { useSpreadsheetViewport } from './useSpreadsheetViewport';
export type { UseSpreadsheetViewport } from './useSpreadsheetViewport';

export { useSpreadsheetState } from './useSpreadsheetState';
export type { SpreadsheetStateManager } from './useSpreadsheetState';

export { SpreadsheetGrid } from './SpreadsheetGrid';
export type { SpreadsheetGridProps } from './SpreadsheetGrid';