import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollState, ViewportState } from './types';

export interface UseSpreadsheetViewport {
  viewport: ViewportState;
  scroll: ScrollState;
  /** Ref to attach to the scrollable container (same role as the existing
   *  `scrollContainerRef` passed into `@tanstack/react-virtual`'s
   *  `getScrollElement`). Exposed here so Viewport/Scroll state can stay
   *  colocated with the element that produces them. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Call from the container's onScroll handler. Cheap — just records the
   *  raw scroll position; does not itself recompute the visible row/col
   *  window (that stays the virtualizer's job). */
  handleScroll: (scrollTop: number, scrollLeft: number) => void;
  /** Call whenever the virtualizer (or any future windowing logic)
   *  recomputes which rows/cols are actually rendered. */
  setViewport: (viewport: ViewportState) => void;
}

const EMPTY_VIEWPORT: ViewportState = { firstVisibleRow: 0, lastVisibleRow: 0, firstVisibleCol: 0, lastVisibleCol: 0 };
const EMPTY_SCROLL: ScrollState = { scrollTop: 0, scrollLeft: 0 };

/**
 * Viewport State + Scroll State — two closely-related but distinct slices,
 * bundled in one hook because they're always read together by rendering
 * code, but kept as separate fields internally: Scroll State is the raw,
 * continuously-changing physical scroll offset (cheap to update on every
 * scroll event), while Viewport State is the derived, discrete "which
 * rows/columns are actually visible" window that virtualization consumes.
 * This hook does not replace `@tanstack/react-virtual` (already in use in
 * DatabaseManagement.tsx and reused as-is) — it gives the rest of the
 * spreadsheet architecture (future infinite columns, sticky headers, etc.)
 * a single place to read "what's currently on screen" without depending on
 * virtualizer internals directly.
 */
export function useSpreadsheetViewport(): UseSpreadsheetViewport {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState<ScrollState>(EMPTY_SCROLL);
  const [viewport, setViewportState] = useState<ViewportState>(EMPTY_VIEWPORT);

  const handleScroll = useCallback((scrollTop: number, scrollLeft: number) => {
    setScroll({ scrollTop, scrollLeft });
  }, []);

  const setViewport = useCallback((next: ViewportState) => {
    setViewportState(next);
  }, []);

  return useMemo(() => ({
    viewport,
    scroll,
    scrollContainerRef,
    handleScroll,
    setViewport
  }), [viewport, scroll, handleScroll, setViewport]);
}