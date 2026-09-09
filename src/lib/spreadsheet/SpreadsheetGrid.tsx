import React, { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { useVirtualizer, Virtualizer } from '@tanstack/react-virtual';
import { ColumnId, RowId, CellAddress, CellRange } from './types';

export interface SpreadsheetGridProps {
  rowIds: RowId[];
  columnIds: ColumnId[];
  columnWidths: Record<ColumnId, number>;
  estimateRowHeight?: number;
  rowOverscan?: number;
  columnOverscan?: number;
  renderCell: (rowId: RowId, columnId: ColumnId, rowIndex: number, colIndex: number) => React.ReactNode;
  renderHeaderCell?: (columnId: ColumnId, colIndex: number) => React.ReactNode;
  renderRowHeaderCell?: (rowId: RowId, rowIndex: number) => React.ReactNode;
  renderCornerHeaderCell?: () => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  stickyColumnCount?: number;
  stickyRowCount?: number;
  showGridLines?: boolean;
  showColumnLetters?: boolean;
  showRowNumbers?: boolean;
  selectionRange?: CellRange | null;
  activeCell?: CellAddress | null;
  onCellMouseDown?: (rowId: RowId, columnId: ColumnId, rowIndex: number, colIndex: number, event: React.MouseEvent) => void;
  onCellMouseEnter?: (rowId: RowId, columnId: ColumnId, rowIndex: number, colIndex: number) => void;
  onCellContextMenu?: (rowId: RowId, columnId: ColumnId, rowIndex: number, colIndex: number, event: React.MouseEvent) => void;
  onCellDoubleClick?: (rowId: RowId, columnId: ColumnId, rowIndex: number, colIndex: number, event: React.MouseEvent) => void;
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
  onSelectionChange?: (range: CellRange | null) => void;
  onActiveCellChange?: (cell: CellAddress | null) => void;
  /** When provided, the grid renders into this externally-owned scroll container
   *  instead of creating its own. Use to share a single scroll element with a
   *  parent view (keeps the parent's scroll logic authoritative). The grid is
   *  then a non-scrolling, full-size inner layout with sticky headers. */
  scrollElementRef?: React.RefObject<HTMLDivElement | null>;
}

interface VirtualItem {
  index: number;
  start: number;
  end: number;
  size: number;
}

function useStableVirtualizer(
  count: number,
  getScrollElement: () => HTMLDivElement | null,
  estimateSize: (index: number) => number,
  overscan: number,
  horizontal: boolean
) {
  return useVirtualizer({
    count,
    getScrollElement,
    estimateSize,
    overscan,
    horizontal,
    measureElement: undefined,
    getItemKey: (index) => index,
  });
}

export function SpreadsheetGrid({
  rowIds,
  columnIds,
  columnWidths,
  estimateRowHeight = 56,
  rowOverscan = 10,
  columnOverscan = 4,
  renderCell,
  renderHeaderCell,
  renderRowHeaderCell,
  renderCornerHeaderCell,
  className = '',
  style = {},
  stickyColumnCount = 1,
  stickyRowCount = 1,
  showGridLines = true,
  showColumnLetters = true,
  showRowNumbers = true,
  selectionRange,
  activeCell,
  onCellMouseDown,
  onCellMouseEnter,
  onCellContextMenu,
  onCellDoubleClick,
  onScroll,
  onSelectionChange,
  onActiveCellChange,
  scrollElementRef,
}: SpreadsheetGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const getScrollElement = useCallback(
    (): HTMLDivElement | null => scrollElementRef?.current ?? scrollRef.current,
    [scrollElementRef]
  );

  const getRowHeight = useCallback((index: number) => estimateRowHeight, [estimateRowHeight]);
  const getColumnWidth = useCallback((index: number) => columnWidths[columnIds[index]] ?? 180, [columnWidths, columnIds]);

  const rowVirtualizer = useStableVirtualizer(
    rowIds.length,
    getScrollElement,
    getRowHeight,
    rowOverscan,
    false
  );

  const columnVirtualizer = useStableVirtualizer(
    columnIds.length,
    getScrollElement,
    getColumnWidth,
    columnOverscan,
    true
  );

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = columnVirtualizer.getVirtualItems();

  const totalHeight = rowVirtualizer.getTotalSize();
  const totalWidth = columnVirtualizer.getTotalSize();

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget;
    setScrollTop(scrollTop);
    setScrollLeft(scrollLeft);
    onScroll?.(scrollTop, scrollLeft);
  }, [onScroll]);

  const isCellSelected = useCallback((rowIndex: number, colIndex: number) => {
    if (!selectionRange) return false;
    const { startRow, endRow, startCol, endCol } = selectionRange;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    return rowIndex >= minRow && rowIndex <= maxRow && colIndex >= minCol && colIndex <= maxCol;
  }, [selectionRange]);

  const isCellActive = useCallback((rowIndex: number, colIndex: number) => {
    if (!activeCell) return false;
    return activeCell.row === rowIndex && activeCell.col === colIndex;
  }, [activeCell]);

  const getCellStyle = useCallback((
    virtualRow: VirtualItem,
    virtualCol: VirtualItem,
    isStickyCol: boolean,
    isStickyRow: boolean
  ) => {
    const styles: React.CSSProperties = {
      position: 'absolute',
      left: virtualCol.start,
      top: virtualRow.start,
      width: virtualCol.size,
      height: virtualRow.size,
    };

    if (isStickyCol && isStickyRow) {
      styles.zIndex = 30;
      styles.left = virtualCol.start;
      styles.top = virtualRow.start;
    } else if (isStickyCol) {
      styles.zIndex = 20;
      styles.left = virtualCol.start;
      styles.position = 'sticky';
    } else if (isStickyRow) {
      styles.zIndex = 10;
      styles.top = virtualRow.start;
      styles.position = 'sticky';
    }

    if (showGridLines) {
      styles.borderRight = '1px solid #e5e5e5';
      styles.borderBottom = '1px solid #e5e5e5';
    }

    return styles;
  }, [showGridLines]);

  const getHeaderStyle = useCallback((
    virtualCol: VirtualItem,
    isStickyCol: boolean
  ) => {
    const styles: React.CSSProperties = {
      position: 'absolute',
      left: virtualCol.start,
      top: 0,
      width: virtualCol.size,
      height: estimateRowHeight,
      zIndex: isStickyCol ? 25 : 5,
    };

    if (isStickyCol) {
      styles.left = virtualCol.start;
      styles.position = 'sticky';
    }

    if (showGridLines) {
      styles.borderRight = '1px solid #e5e5e5';
      styles.borderBottom = '1px solid #d4d4d4';
    }

    return styles;
  }, [estimateRowHeight, showGridLines]);

  const getRowHeaderStyle = useCallback((
    virtualRow: VirtualItem,
    isStickyRow: boolean
  ) => {
    const styles: React.CSSProperties = {
      position: 'absolute',
      left: 0,
      top: virtualRow.start,
      width: 60,
      height: virtualRow.size,
      zIndex: isStickyRow ? 25 : 5,
    };

    if (isStickyRow) {
      styles.top = virtualRow.start;
      styles.position = 'sticky';
    }

    if (showGridLines) {
      styles.borderRight = '1px solid #d4d4d4';
      styles.borderBottom = '1px solid #e5e5e5';
    }

    return styles;
  }, [showGridLines]);

  const getCornerStyle = useCallback(() => ({
    position: 'sticky',
    top: 0,
    left: 0,
    width: 60,
    height: estimateRowHeight,
    zIndex: 35,
    background: '#fafafa',
    borderRight: showGridLines ? '1px solid #d4d4d4' : 'none',
    borderBottom: showGridLines ? '1px solid #d4d4d4' : 'none',
  }), [estimateRowHeight, showGridLines]);

  const rowHeaderWidth = 60;
  const colHeaderHeight = estimateRowHeight;

  const stickyColEndIndex = Math.min(stickyColumnCount, columnIds.length) - 1;
  const stickyRowEndIndex = Math.min(stickyRowCount, rowIds.length) - 1;

  const isStickyCol = useCallback((colIndex: number) => colIndex <= stickyColEndIndex, [stickyColEndIndex]);
  const isStickyRow = useCallback((rowIndex: number) => rowIndex <= stickyRowEndIndex, [stickyRowEndIndex]);

  const findVirtual = (items: VirtualItem[], index: number): VirtualItem | undefined =>
    items.find((it) => it.index === index);

  const selectionOverlayStyle = useMemo(() => {
    if (!selectionRange) return null;
    const { startRow, endRow, startCol, endCol } = selectionRange;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    const allRows = rowVirtualizer.getVirtualItems();
    const allCols = columnVirtualizer.getVirtualItems();
    const startRowItem = findVirtual(allRows, minRow);
    const endRowItem = findVirtual(allRows, maxRow);
    const startColItem = findVirtual(allCols, minCol);
    const endColItem = findVirtual(allCols, maxCol);
    if (!startRowItem || !endRowItem || !startColItem || !endColItem) return null;

    const top = startRowItem.start;
    const left = startColItem.start;
    const height = (endRowItem.end ?? endRowItem.start + endRowItem.size) - startRowItem.start;
    const width = (endColItem.end ?? endColItem.start + endColItem.size) - startColItem.start;

    return { top, left, height, width };
  }, [selectionRange, rowVirtualizer, columnVirtualizer]);

  const activeCellOverlayStyle = useMemo(() => {
    if (!activeCell) return null;
    const allRows = rowVirtualizer.getVirtualItems();
    const allCols = columnVirtualizer.getVirtualItems();
    const rowItem = findVirtual(allRows, activeCell.row);
    const colItem = findVirtual(allCols, activeCell.col);
    if (!rowItem || !colItem) return null;
    return {
      top: rowItem.start,
      left: colItem.start,
      height: rowItem.size,
      width: colItem.size,
    };
  }, [activeCell, rowVirtualizer, columnVirtualizer]);

  return (
    <div
      ref={scrollRef}
      className={className}
      style={{
        overflow: scrollElementRef?.current ? 'visible' : 'auto',
        position: 'relative',
        height: '100%',
        width: '100%',
        contain: 'layout paint',
        ...style,
      }}
      onScroll={scrollElementRef?.current ? undefined : handleScroll}
    >
      <div
        style={{
          height: totalHeight,
          width: totalWidth,
          position: 'relative',
        }}
      >
        {renderCornerHeaderCell && (
          <div
            key="corner-header"
            style={getCornerStyle()}
          >
            {renderCornerHeaderCell()}
          </div>
        )}

        {(showColumnLetters || renderHeaderCell) && (
          <div
            style={{
              position: 'sticky',
              top: 0,
              left: rowHeaderWidth,
              zIndex: 5,
              height: colHeaderHeight,
              width: totalWidth,
              overflow: 'hidden',
              background: '#fafafa',
              borderBottom: showGridLines ? '1px solid #d4d4d4' : 'none',
            }}
          >
            {virtualCols.map((virtualCol) => {
              const colIndex = virtualCol.index;
              const columnId = columnIds[colIndex];
              const isSticky = isStickyCol(colIndex);
              return (
                <div
                  key={columnId}
                  style={getHeaderStyle(virtualCol, isSticky)}
                >
                  {showColumnLetters && stickyColumnCount > 0 && colIndex < stickyColumnCount ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      {columnIndexToLetters(colIndex)}
                    </div>
                  ) : renderHeaderCell ? (
                    renderHeaderCell(columnId, colIndex)
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {(showRowNumbers || renderRowHeaderCell) && (
          <div
            style={{
              position: 'sticky',
              left: 0,
              top: colHeaderHeight,
              zIndex: 5,
              width: rowHeaderWidth,
              height: totalHeight,
              overflow: 'hidden',
              background: '#fafafa',
              borderRight: showGridLines ? '1px solid #d4d4d4' : 'none',
            }}
          >
            {virtualRows.map((virtualRow) => {
              const rowIndex = virtualRow.index;
              const rowId = rowIds[rowIndex];
              const isSticky = isStickyRow(rowIndex);
              return (
                <div
                  key={rowId}
                  style={getRowHeaderStyle(virtualRow, isSticky)}
                >
                  {renderRowHeaderCell ? (
                    renderRowHeaderCell(rowId, rowIndex)
                  ) : showRowNumbers ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#9ca3af', fontFamily: 'monospace' }}>
                      {(rowIndex + 1).toString().padStart(2, '0')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ position: 'relative', top: colHeaderHeight, left: rowHeaderWidth }}>
          {virtualRows.map((virtualRow) => {
            const rowIndex = virtualRow.index;
            const rowId = rowIds[rowIndex];
            const rowIsSticky = isStickyRow(rowIndex);

            return virtualCols.map((virtualCol) => {
              const colIndex = virtualCol.index;
              const columnId = columnIds[colIndex];
              const colIsSticky = isStickyCol(colIndex);

              const selected = isCellSelected(rowIndex, colIndex);
              const active = isCellActive(rowIndex, colIndex);

              return (
                <div
                  key={`${rowId}-${columnId}`}
                  style={getCellStyle(virtualRow, virtualCol, colIsSticky, rowIsSticky)}
                >
                  {renderCell(rowId, columnId, rowIndex, colIndex)}
                  {selected && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        border: '2px solid #3b82f6',
                        background: 'rgba(59, 130, 246, 0.1)',
                        pointerEvents: 'none',
                        zIndex: 1,
                      }}
                    />
                  )}
                  {active && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        border: '2px solid #f97316',
                        boxShadow: '0 0 0 1px #fff, 0 0 0 3px #f97316',
                        pointerEvents: 'none',
                        zIndex: 2,
                      }}
                    />
                  )}
                </div>
              );
            });
          })}
        </div>

        {selectionOverlayStyle && (
          <div
            style={{
              position: 'absolute',
              top: selectionOverlayStyle.top + colHeaderHeight,
              left: selectionOverlayStyle.left + rowHeaderWidth,
              height: selectionOverlayStyle.height,
              width: selectionOverlayStyle.width,
              border: '2px solid #3b82f6',
              background: 'rgba(59, 130, 246, 0.05)',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
        )}

        {activeCellOverlayStyle && (
          <div
            style={{
              position: 'absolute',
              top: activeCellOverlayStyle.top + colHeaderHeight,
              left: activeCellOverlayStyle.left + rowHeaderWidth,
              height: activeCellOverlayStyle.height,
              width: activeCellOverlayStyle.width,
              border: '2px solid #f97316',
              boxShadow: '0 0 0 1px #fff, 0 0 0 3px #f97316',
              pointerEvents: 'none',
              zIndex: 4,
            }}
          />
        )}
      </div>
    </div>
  );
}

function columnIndexToLetters(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}