import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  memo,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, Trash2, User } from 'lucide-react';
import {
  cn,
  sanitizeMobileInput,
} from '../utils';
import { Devotee } from '../../types';
import {
  SpreadsheetGrid,
} from './SpreadsheetGrid';
import { CellAddress, CellRange } from './types';

/** Conservative vertical overscan (rows) — keeps the DOM small by default but
 *  is configurable. Measured as a multiple of visible rows; never hundreds. */
const DEFAULT_ROW_OVERSCAN = 8;
/** Conservative horizontal overscan (columns). */
const DEFAULT_COL_OVERSCAN = 3;
const DEFAULT_ROW_HEIGHT = 56;
const DEFAULT_COL_WIDTH = 180;
/** Height reserved for the second (data) header row above the letter row. */
const FIXED_HEADER_OFFSET = 0;

/** Pseudo-column key for the trailing per-row Actions column. The parent appends
 *  it to `columns` only when the user may act on rows (owner/mentor), mirroring
 *  the legacy table's trailing Actions `<th>`/`<td>`. */
export const ACTIONS_COLUMN = '__actions__';

export type FullScreenSpreadsheetSelection = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} | null;

interface FullScreenSpreadsheetProps {
  rows: Devotee[];
  columns: string[];
  columnWidths: Record<string, number>;
  rowOverscan?: number;
  columnOverscan?: number;
  rowHeight?: number;
  defaultColumnWidth?: number;
  templeUsers: any[];
  selectedDbEventId: string;
  dbAttendanceMap: Record<string, boolean>;
  totalEvents: number;
  attendanceColumnMeta: Record<string, { eventId: string; eventTitle: string }>;
  attendanceColumnMaps: Record<string, Record<string, boolean>>;
  isOwner: boolean;
  isMentor: boolean;
  selection: FullScreenSpreadsheetSelection;
  offsetY?: number;
  onSelectionChange: (sel: FullScreenSpreadsheetSelection) => void;
  onCellSave: (id: string, field: string, value: string) => void;
  onUpdateFacilitator: (id: string, facilitatorId: string) => void;
  onToggleAttendance: (id: string) => void;
  onDelete: (id: string) => void;
  onAddToFacilitation: (id: string) => void;
  onCellContextMenu: (e: React.MouseEvent, rIdx: number, cIdx: number) => void;
  onDoubleClickCell?: (rIdx: number, cIdx: number) => void;
  onCommitAndMove?: (dir: 'up' | 'down' | 'left' | 'right') => void;
  editSignal?: number;
  editStartValue?: string;
  /** Optional external scroll container. When provided, the grid virtualizes
   *  against this element instead of creating its own, letting the parent's
   *  scroll logic (moveSelection scrolling, infinite scroll) stay authoritative. */
  scrollElementRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * FullScreenSpreadsheet — the production-grade two-axis virtualized renderer
 * used by the Owner Database in Full Screen mode.
 *
 * Unlike the legacy `<table>` path (rows-virtualized, columns forced in full),
 * this component virtualizes BOTH axes via `SpreadsheetGrid`, so the DOM node
 * count is bounded by the viewport + conservative overscan regardless of the
 * total row/column count. It is the Master Version "infinite sheet" rendering
 * path and activates only inside Full Screen mode.
 *
 * Row identity uses the permanent devotee id as the virtualization key (never
 * the array index). Selection is derived from coordinates (row/col indices),
 * never embedded in each row object. Each cell is a memoized component that
 * receives only the minimum props it needs, so editing one cell does not
 * rerender the visible grid.
 */
export function FullScreenSpreadsheet({
  rows,
  columns,
  columnWidths,
  rowOverscan = DEFAULT_ROW_OVERSCAN,
  columnOverscan = DEFAULT_COL_OVERSCAN,
  rowHeight = DEFAULT_ROW_HEIGHT,
  defaultColumnWidth = DEFAULT_COL_WIDTH,
  templeUsers,
  selectedDbEventId,
  dbAttendanceMap,
  totalEvents,
  attendanceColumnMeta,
  attendanceColumnMaps,
  isOwner,
  isMentor,
  selection,
  offsetY = 0,
  onSelectionChange,
  onCellSave,
  onUpdateFacilitator,
  onToggleAttendance,
  onDelete,
  onAddToFacilitation,
  onCellContextMenu,
  onDoubleClickCell,
  onCommitAndMove,
  editSignal,
  editStartValue,
  scrollElementRef,
}: FullScreenSpreadsheetProps) {
  // Stable row ids: permanent devotee id. Two rows never collide; sorting
  // never changes a row's identity (only its virtual index).
  const rowIds = useMemo(() => rows.map((r) => r.id!).filter(Boolean), [rows]);

  const mouseAnchor = useRef<{ row: number; col: number } | null>(null);
  const isSelecting = useRef(false);

  const getRowByIndex = useCallback((idx: number): Devotee | undefined => rows[idx], [rows]);

  // Active cell = the "focus" corner of the current selection (fallback to
  // the whole selected range's top-left). Derived from coordinates only.
  const activeCell: CellAddress | null = useMemo(() => {
    if (!selection) return null;
    const r = selection.endRow;
    const c = selection.endCol === -1 ? 0 : selection.endCol;
    return { row: r, col: c };
  }, [selection]);

  // Selection range for the grid overlay, normalizing start/end.
  const selectionRange: CellRange | null = useMemo(() => {
    if (!selection) return null;
    return {
      startRow: selection.startRow,
      startCol: selection.startCol === -1 ? 0 : selection.startCol,
      endRow: selection.endRow,
      endCol: selection.endCol === -1 ? columns.length - 1 : selection.endCol,
    };
  }, [selection, columns.length]);

  const authorizedMentors = useMemo(() => templeUsers.filter((u: any) => u.role === 'MENTOR'), [templeUsers]);

  const handleCellMouseDown = useCallback((
    _rowId: string,
    _colId: string,
    rIdx: number,
    cIdx: number,
    e: React.MouseEvent,
  ) => {
    if (e.button !== 0) return;
    mouseAnchor.current = { row: rIdx, col: cIdx };
    isSelecting.current = true;
    onSelectionChange({ startRow: rIdx, startCol: cIdx, endRow: rIdx, endCol: cIdx });
  }, [onSelectionChange]);

  const handleCellMouseEnter = useCallback((
    _rowId: string,
    _colId: string,
    rIdx: number,
    cIdx: number,
  ) => {
    if (!isSelecting.current) return;
    // Skip the anchor cell (selection already equals a single cell there).
    const anchor = mouseAnchor.current;
    if (!anchor) return;
    if (anchor.row === rIdx && anchor.col === cIdx) return;
    onSelectionChange({
      startRow: anchor.row,
      startCol: anchor.col,
      endRow: rIdx,
      endCol: cIdx,
    });
  }, [onSelectionChange]);

  const renderCell = useCallback((
    rowId: string,
    colId: string,
    rIdx: number,
    cIdx: number,
  ) => {
    const d = getRowByIndex(rIdx);
    if (!d) return null;
    if (colId === ACTIONS_COLUMN) {
      return (
        <ActionsCell
          id={d.id!}
          active={!!activeCell && activeCell.row === rIdx && activeCell.col === cIdx}
          onMouseDown={(e) => handleCellMouseDown(rowId, colId, rIdx, cIdx, e)}
          onContextMenu={(e) => onCellContextMenu(e, rIdx, cIdx)}
          onDelete={onDelete}
          onAddToFacilitation={onAddToFacilitation}
        />
      );
    }
    return (
      <FullScreenCell
        d={d}
        col={colId}
        rowIdx={rIdx}
        colIdx={cIdx}
        selected={!!selectionRange && rIdx >= selectionRange.startRow && rIdx <= selectionRange.endRow && cIdx >= selectionRange.startCol && cIdx <= selectionRange.endCol}
        isActive={!!activeCell && activeCell.row === rIdx && activeCell.col === cIdx}
        authorizedMentors={authorizedMentors}
        templeUsers={templeUsers}
        selectedDbEventId={selectedDbEventId}
        dbAttendanceMap={dbAttendanceMap}
        totalEvents={totalEvents}
        attendanceColumnMeta={attendanceColumnMeta}
        attendanceColumnMaps={attendanceColumnMaps}
        isOwner={isOwner}
        isMentor={isMentor}
        onCellSave={onCellSave}
        onUpdateFacilitator={onUpdateFacilitator}
        onToggleAttendance={onToggleAttendance}
        onDelete={onDelete}
        onAddToFacilitation={onAddToFacilitation}
        onMouseDown={handleCellMouseDown}
        onMouseEnter={handleCellMouseEnter}
        onContextMenu={onCellContextMenu}
        onDoubleClick={onDoubleClickCell}
        onCommitAndMove={onCommitAndMove}
        editSignal={editSignal}
        editStartValue={editStartValue}
      />
    );
  }, [
    getRowByIndex, selectionRange, activeCell, authorizedMentors, templeUsers,
    selectedDbEventId, dbAttendanceMap, totalEvents, attendanceColumnMeta,
    attendanceColumnMaps, isOwner, isMentor, onCellSave, onUpdateFacilitator,
    onToggleAttendance, onDelete, onAddToFacilitation, handleCellMouseDown,
    handleCellMouseEnter, onCellContextMenu, onDoubleClickCell, onCommitAndMove,
    editSignal, editStartValue,
  ]);

  // Sticky column header shows the column label. Row header shows the number.
  const renderHeaderCell = useCallback((colId: string, colIdx: number) => {
    void colIdx;
    return (
      <div
        className="h-full w-full flex items-center justify-start px-3 bg-stone-50/80 text-[10px] font-black uppercase tracking-widest text-stone-500 border-r border-stone-200 truncate"
        title={colId}
      >
        {colId === ACTIONS_COLUMN ? 'Actions' : colId}
      </div>
    );
  }, []);

  const renderRowHeaderCell = useCallback((_rowId: string, rowIdx: number) => {
    void _rowId;
    return (
      <div className="h-full w-full flex items-center justify-center bg-stone-50/80 text-[11px] font-black font-mono text-stone-400">
        {(rowIdx + 1).toString().padStart(2, '0')}
      </div>
    );
  }, []);

  const renderCornerHeader = useCallback(() => {
    return (
      <div className="h-full w-full flex items-center justify-center bg-stone-100/80 text-[10px] font-black text-stone-400" />
    );
  }, []);

  return (
    <SpreadsheetGrid
      rowIds={rowIds}
      columnIds={columns}
      columnWidths={columnWidths}
      estimateRowHeight={rowHeight}
      rowOverscan={rowOverscan}
      columnOverscan={columnOverscan}
      renderCell={renderCell}
      renderHeaderCell={renderHeaderCell}
      renderRowHeaderCell={renderRowHeaderCell}
      renderCornerHeaderCell={renderCornerHeader}
      stickyColumnCount={0}
      stickyRowCount={0}
      showGridLines
      showColumnLetters={false}
      showRowNumbers
      selectionRange={selectionRange}
      activeCell={activeCell}
      onCellMouseDown={(rowId, colId, rIdx, cIdx, event) => handleCellMouseDown(rowId, colId, rIdx, cIdx, event)}
      onCellMouseEnter={(rowId, colId, rIdx, cIdx) => handleCellMouseEnter(rowId, colId, rIdx, cIdx)}
      onCellContextMenu={(_rowId, _colId, rIdx, cIdx, event) => onCellContextMenu(event, rIdx, cIdx)}
      onCellDoubleClick={(_rowId, _colId, rIdx, cIdx) => onDoubleClickCell?.(rIdx, cIdx)}
      scrollElementRef={scrollElementRef}
      className="h-full w-full custom-scrollbar no-scrollbar"
    />
  );
}

interface FullScreenCellProps {
  d: Devotee;
  col: string;
  rowIdx: number;
  colIdx: number;
  selected: boolean;
  isActive: boolean;
  authorizedMentors: any[];
  templeUsers: any[];
  selectedDbEventId: string;
  dbAttendanceMap: Record<string, boolean>;
  totalEvents: number;
  attendanceColumnMeta: Record<string, { eventId: string; eventTitle: string }>;
  attendanceColumnMaps: Record<string, Record<string, boolean>>;
  onCellSave: (id: string, field: string, value: string) => void;
  onUpdateFacilitator: (id: string, facilitatorId: string) => void;
  onToggleAttendance: (id: string) => void;
  onMouseDown: (rowId: string, colId: string, rIdx: number, cIdx: number, e: React.MouseEvent) => void;
  onMouseEnter: (rowId: string, colId: string, rIdx: number, cIdx: number) => void;
  onContextMenu: (e: React.MouseEvent, rIdx: number, cIdx: number) => void;
  onDoubleClick: (rIdx: number, cIdx: number) => void;
  onCommitAndMove?: (dir: 'up' | 'down' | 'left' | 'right') => void;
  editSignal?: number;
  editStartValue?: string;
}

function readCell(d: Readonly<any>, col: string): string {
  if (col === 'Name') return d.name || d.Name || '';
  if (col === 'Age') return (d.age ?? d.Age ?? '').toString();
  if (col === 'Mentor') return d.mentor || d.Mentor || '';
  if (col === 'Chanting') return (d.chanting ?? d.Chanting ?? '').toString();
  if (col === 'Contact No.') return d.contact || d['Contact No.'] || '';
  if (col === 'Gender') return d.gender || d.Gender || '';
  if (col === 'Date of Birth') return d.dob || d['Date of Birth'] || '';
  if (col === 'Address') return d.address || d.Address || '';
  if (col === 'Institute') return d.institute || d.Institute || '';
  if (col === 'Facilitator') return d.facilitatorName || d.facilitator || d.Facilitator || '';
  if (col === 'Attendance') return d.attendanceCount ?? 0;
  const raw = (d as any)[col];
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object' && raw.seconds !== undefined) return new Date(raw.seconds * 1000).toLocaleString();
  return String(raw);
}

const FullScreenCell = memo(function FullScreenCell({
  d,
  col,
  rowIdx,
  colIdx,
  selected,
  isActive,
  authorizedMentors,
  templeUsers,
  selectedDbEventId,
  dbAttendanceMap,
  totalEvents,
  attendanceColumnMeta,
  attendanceColumnMaps,
  onCellSave,
  onUpdateFacilitator,
  onToggleAttendance,
  onMouseDown,
  onMouseEnter,
  onContextMenu,
  onDoubleClick,
  onCommitAndMove,
  editSignal,
  editStartValue,
}: FullScreenCellProps) {
  const baseClass = cn(
    'h-full w-full relative overflow-hidden',
    'border-r border-b border-[#e5e5e5]',
    selected ? 'bg-blue-50' : 'hover:bg-stone-50',
    'cursor-pointer select-none'
  );

  const onMouseDownHandler = (e: React.MouseEvent) => {
    if (e.button === 0) onMouseDown(d.id!, col, rowIdx, colIdx, e);
  };
  const onMouseEnterHandler = () => onMouseEnter(d.id!, col, rowIdx, colIdx);
  const onContextMenuHandler = (e: React.MouseEvent) => onContextMenu(e, rowIdx, colIdx);
  const onDoubleClickHandler = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick(rowIdx, colIdx);
  };

  // Special column renderers
  if (col === 'Mentor') {
    const mentorVal = d.mentor || (d as any).Mentor || '';
    return (
      <div className={baseClass} onMouseDown={onMouseDownHandler} onMouseEnter={onMouseEnterHandler} onContextMenu={onContextMenuHandler}>
        <select
          value={mentorVal}
          onChange={(e) => onCellSave(d.id!, 'Mentor', e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full h-full bg-transparent border-0 outline-none cursor-pointer text-xs font-bold text-stone-600 px-2"
        >
          <option value="">Add Mentor...</option>
          {mentorVal && !authorizedMentors.find((u: any) => (u.displayName || u.email) === mentorVal) && (
            <option value={mentorVal}>{mentorVal} (Unknown/Deleted)</option>
          )}
          {authorizedMentors.map((u: any) => <option key={u.uid} value={u.displayName || u.email}>{u.displayName || u.email}</option>)}
        </select>
        {isActive && <ActiveCellBorder />}
      </div>
    );
  }

  if (col === 'Facilitator') {
    return (
      <div className={baseClass} onMouseDown={onMouseDownHandler} onMouseEnter={onMouseEnterHandler} onContextMenu={onContextMenuHandler}>
        <select
          value={d.facilitatorId || ''}
          onChange={(e) => onUpdateFacilitator(d.id!, e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full h-full bg-transparent border-0 outline-none cursor-pointer text-xs font-bold text-stone-600 px-2"
        >
          <option value="">Select Facilitator</option>
          {d.facilitatorId && !templeUsers.find((u: any) => u.uid === d.facilitatorId) && (
            <option value={d.facilitatorId}>{d.facilitatorName || 'Unknown/Deleted'}</option>
          )}
          {templeUsers.map((u: any) => <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>)}
        </select>
        {isActive && <ActiveCellBorder />}
      </div>
    );
  }

  if (col === 'Profile') {
    return (
      <div className={cn(baseClass, 'flex items-center justify-center')} onMouseDown={onMouseDownHandler} onMouseEnter={onMouseEnterHandler} onContextMenu={onContextMenuHandler}>
        <Link
          to={`/profile/${d.id}`}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-[10px] font-black uppercase tracking-[0.2em] bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white px-3 py-1.5 rounded-lg transition-all border border-orange-100 hover:border-orange-500 active:scale-95 shadow-sm"
        >
          Profile
        </Link>
        {isActive && <ActiveCellBorder />}
      </div>
    );
  }

  if (col === 'Attendance') {
    const hasLoadedMap = Object.keys(dbAttendanceMap).length > 0;
    const isPresent = dbAttendanceMap[d.id!];
    return (
      <div className={cn(baseClass, 'flex items-center justify-center')} onMouseDown={onMouseDownHandler} onMouseEnter={onMouseEnterHandler} onContextMenu={onContextMenuHandler}>
        <div className="flex flex-col items-center justify-center gap-0.5">
          <span className={cn(
            'w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black uppercase',
            isPresent ? 'bg-green-100 text-green-700' : (hasLoadedMap ? 'bg-red-50 text-red-400' : 'bg-stone-50 text-stone-400')
          )}>
            {isPresent ? 'P' : (hasLoadedMap ? 'A' : '-')}
          </span>
          <span className="text-[8px] font-bold text-stone-400 tabular-nums">{d.attendanceCount || 0}/{totalEvents || 0}</span>
        </div>
        {selectedDbEventId !== 'NONE' && (
          <span className="absolute bottom-0 left-0 right-0 py-0.5 bg-orange-400 text-[8px] text-white opacity-0 group-hover/att:opacity-100 transition-opacity font-black uppercase pointer-events-none" />
        )}
        {isActive && <ActiveCellBorder />}
      </div>
    );
  }

  if (attendanceColumnMeta[col]) {
    const fixedMeta = attendanceColumnMeta[col];
    const fixedMap = (attendanceColumnMaps && attendanceColumnMaps[fixedMeta.eventId]) || {};
    const hasLoaded = Object.keys(fixedMap).length > 0;
    const isPresent = fixedMap[d.id!];
    return (
      <div className={cn(baseClass, 'flex items-center justify-center')} onMouseDown={onMouseDownHandler} onMouseEnter={onMouseEnterHandler} onContextMenu={onContextMenuHandler}>
        <span className={cn(
          'w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black uppercase',
          isPresent ? 'bg-green-100 text-green-700' : (hasLoaded ? 'bg-red-50 text-red-400' : 'bg-stone-50 text-stone-400')
        )}>
          {isPresent ? 'P' : (hasLoaded ? 'A' : '-')}
        </span>
        {isActive && <ActiveCellBorder />}
      </div>
    );
  }

  const val = readCell(d, col);
  const isNumeric = col === 'Age' || col === 'Chanting';

  return (
    <EditableSheetCell
      id={d.id!}
      field={col}
      initialValue={val}
      onSave={onCellSave}
      onMouseDown={onMouseDownHandler}
      onMouseEnter={onMouseEnterHandler}
      onContextMenu={onContextMenuHandler}
      onDoubleClick={onDoubleClickHandler}
      isNumeric={isNumeric}
      isActive={isActive}
      editSignal={editSignal}
      editStartValue={editStartValue}
      onCommitAndMove={onCommitAndMove}
    />
  );
}, (prev, next) => {
  return (
    prev.d === next.d &&
    prev.col === next.col &&
    prev.rowIdx === next.rowIdx &&
    prev.colIdx === next.colIdx &&
    prev.selected === next.selected &&
    prev.isActive === next.isActive &&
    prev.selectedDbEventId === next.selectedDbEventId &&
    prev.dbAttendanceMap[next.d.id!] === next.dbAttendanceMap[next.d.id!] &&
    prev.totalEvents === next.totalEvents &&
    prev.attendanceColumnMeta === next.attendanceColumnMeta &&
    prev.attendanceColumnMaps === next.attendanceColumnMaps &&
    prev.editSignal === next.editSignal &&
    prev.editStartValue === next.editStartValue &&
    prev.templeUsers === next.templeUsers
  );
});

function ActiveCellBorder() {
  return (
    <div
      className="absolute inset-0 pointer-events-none z-[2]"
      style={{
        outline: '2px solid #f97316',
        outlineOffset: '-2px',
        boxShadow: '0 0 0 1px #fff, 0 0 0 3px #f97316',
      }}
    />
  );
}

const ActionsCell = memo(function ActionsCell({
  id,
  active,
  onMouseDown,
  onContextMenu,
  onDelete,
  onAddToFacilitation,
}: {
  id: string;
  active: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  onAddToFacilitation: (id: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="relative h-full w-full flex items-center justify-center gap-1 select-none"
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
    >
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => onAddToFacilitation(id)}
        className="p-1.5 hover:bg-orange-50 rounded-lg text-stone-400 hover:text-orange-500 transition-all"
        title="Add to Facilitation"
      >
        <Heart size={16} />
      </button>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => navigate(`/profile/${id}`)}
        className="p-1.5 hover:bg-stone-50 rounded-lg text-stone-400 hover:text-stone-700 transition-all"
        title="View Profile"
      >
        <User size={16} />
      </button>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => onDelete(id)}
        className="p-1.5 hover:bg-red-50 rounded-lg text-stone-300 hover:text-red-500 transition-all"
        title="Delete row"
      >
        <Trash2 size={16} />
      </button>
      {active && <ActiveCellBorder />}
    </div>
  );
}, (prev, next) =>
  prev.id === next.id &&
  prev.active === next.active &&
  prev.onDelete === next.onDelete &&
  prev.onAddToFacilitation === next.onAddToFacilitation
);

interface EditableSheetCellProps {
  id: string;
  field: string;
  initialValue: string;
  onSave: (id: string, field: string, value: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  isNumeric: boolean;
  isActive: boolean;
  editSignal?: number;
  editStartValue?: string;
  onCommitAndMove?: (dir: 'up' | 'down' | 'left' | 'right') => void;
}

const EditableSheetCell = memo(function EditableSheetCell({
  id,
  field,
  initialValue,
  onSave,
  onMouseDown,
  onMouseEnter,
  onContextMenu,
  onDoubleClick,
  isNumeric,
  isActive,
  editSignal,
  editStartValue,
  onCommitAndMove,
}: EditableSheetCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const lastEditSignal = useRef(editSignal);

  useEffect(() => {
    if (!isEditing) {
      setValue(initialValue);
    }
  }, [initialValue, isEditing]);

  useEffect(() => {
    if (isActive && editSignal !== undefined && editSignal !== lastEditSignal.current) {
      lastEditSignal.current = editSignal;
      setValue(editStartValue !== undefined ? editStartValue : initialValue);
      setIsEditing(true);
    } else {
      lastEditSignal.current = editSignal;
    }
  }, [editSignal, isActive, initialValue, editStartValue]);

  const commitIfChanged = () => {
    if (value !== initialValue) {
      onSave(id, field, value);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  if (isEditing) {
    const isMultiline = field !== 'Contact No.' && field !== 'Age' && field !== 'Chanting';
    const commonProps = {
      autoFocus: true,
      className: 'w-full h-full px-3 py-1.5 border-2 border-orange-500 outline-none font-bold text-stone-700 bg-white resize-none text-sm',
      value,
      onBlur: () => {
        commitIfChanged();
        setIsEditing(false);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && e.altKey) {
          e.preventDefault();
          const target = e.currentTarget as HTMLTextAreaElement | HTMLInputElement;
          const start = target.selectionStart ?? value.length;
          const end = target.selectionEnd ?? value.length;
          setValue(value.slice(0, start) + '\n' + value.slice(end));
          requestAnimationFrame(() => {
            target.selectionStart = target.selectionEnd = start + 1;
          });
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          commitIfChanged();
          setIsEditing(false);
          onCommitAndMove?.(e.shiftKey ? 'up' : 'down');
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          commitIfChanged();
          setIsEditing(false);
          onCommitAndMove?.(e.shiftKey ? 'left' : 'right');
          return;
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          setValue(initialValue);
          setIsEditing(false);
        }
      },
    };
    if (isMultiline) {
      return (
        <textarea
          {...commonProps}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
        />
      );
    }
    return (
      <input
        {...commonProps}
        type={field === 'Contact No.' ? 'tel' : 'text'}
        inputMode={field === 'Contact No.' ? 'numeric' : undefined}
        maxLength={field === 'Contact No.' ? 10 : undefined}
        onChange={(e) => setValue(field === 'Contact No.' ? sanitizeMobileInput(e.target.value) : e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className={cn(
        'h-full w-full px-3 py-1.5 flex items-center cursor-pointer select-none overflow-hidden',
        isActive && 'bg-orange-50/40'
      )}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onContextMenu={onContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <span className={cn('flex w-full text-[13px] font-bold text-stone-700 items-center justify-between truncate', !value && 'text-stone-300 italic text-xs', isNumeric && 'font-mono')}>
        <span className="truncate flex-1">{value || `Add ${field}...`}</span>
      </span>
    </div>
  );
});