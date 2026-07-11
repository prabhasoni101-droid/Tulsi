import React, { useRef } from 'react';
import { useVirtualizer, Virtualizer } from '@tanstack/react-virtual';
import { ColumnId, RowId } from './types';

export interface SpreadsheetGridProps {
  rowIds: RowId[];
  columnIds: ColumnId[];
  estimateRowHeight?: number;
  estimateColumnWidth?: number;
  rowOverscan?: number;
  columnOverscan?: number;
  /** Renders a single cell given its row/column id and virtualized position. */
  renderCell: (rowId: RowId, columnId: ColumnId, rowIndex: number, colIndex: number) => React.ReactNode;
  /** Renders the sticky header for a column. Optional — omit for a header-less grid. */
  renderHeaderCell?: (columnId: ColumnId, colIndex: number) => React.ReactNode;
  className?: string;
}

/**
 * Spreadsheet Grid — scalable rendering primitive.
 * =================================================
 * Virtualizes BOTH axes (rows via `rowVirtualizer`, columns via
 * `columnVirtualizer`), unlike the current DatabaseManagement.tsx table
 * which only virtualizes rows and renders every column of every visible
 * row. This is what makes "infinite columns" viable later: with column
 * virtualization already in place, adding more columns only grows the
 * scrollable width, not the per-row render cost.
 *
 * This component is additive — it does not replace the existing
 * `<table>` markup in DatabaseManagement.tsx. It is the reusable rendering
 * foundation future spreadsheet views (or a later migration of the Owner
 * Portal table) can adopt once the accompanying feature work
 * (formulas, formatting, drag, keyboard nav) is ready to land.
 */
export function SpreadsheetGrid({
  rowIds,
  columnIds,
  estimateRowHeight = 56,
  estimateColumnWidth = 180,
  rowOverscan = 10,
  columnOverscan = 4,
  renderCell,
  renderHeaderCell,
  className
}: SpreadsheetGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer: Virtualizer<HTMLDivElement, Element> = useVirtualizer({
    count: rowIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: rowOverscan
  });

  const columnVirtualizer: Virtualizer<HTMLDivElement, Element> = useVirtualizer({
    horizontal: true,
    count: columnIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateColumnWidth,
    overscan: columnOverscan
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = columnVirtualizer.getVirtualItems();

  return (
    <div ref={scrollRef} className={className} style={{ overflow: 'auto', position: 'relative', height: '100%', width: '100%' }}>
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          width: columnVirtualizer.getTotalSize(),
          position: 'relative'
        }}
      >
        {renderHeaderCell && (
          <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', height: estimateRowHeight }}>
            {virtualCols.map(virtualCol => (
              <div
                key={columnIds[virtualCol.index]}
                style={{
                  position: 'absolute',
                  left: virtualCol.start,
                  width: virtualCol.size,
                  height: '100%'
                }}
              >
                {renderHeaderCell(columnIds[virtualCol.index], virtualCol.index)}
              </div>
            ))}
          </div>
        )}

        {virtualRows.map(virtualRow => (
          <div
            key={rowIds[virtualRow.index]}
            style={{
              position: 'absolute',
              top: virtualRow.start,
              height: virtualRow.size,
              width: '100%'
            }}
          >
            {virtualCols.map(virtualCol => (
              <div
                key={columnIds[virtualCol.index]}
                style={{
                  position: 'absolute',
                  left: virtualCol.start,
                  width: virtualCol.size,
                  height: '100%'
                }}
              >
                {renderCell(rowIds[virtualRow.index], columnIds[virtualCol.index], virtualRow.index, virtualCol.index)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}