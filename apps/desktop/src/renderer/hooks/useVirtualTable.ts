import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { computeVirtualWindow, type VirtualWindowResult } from '../utils/virtual-table';

export interface UseVirtualTableOptions {
  count: number;
  estimateRowHeight?: number;
  overscan?: number;
  enabled?: boolean;
}

export interface UseVirtualTableReturn extends VirtualWindowResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isVirtualized: boolean;
  scrollToIndex: (index: number) => void;
}

/**
 * useVirtualTable — lightweight, zero-dependency virtualizer hook for HTML tables.
 *
 * Attaches to a scrollable table container, calculates visible rows based on
 * scrollTop and container height, and provides top/bottom spacer heights to
 * maintain accurate native scrollbars while mounting only ~15-25 rows in the DOM.
 */
export function useVirtualTable({
  count,
  estimateRowHeight = 49,
  overscan = 5,
  enabled = true
}: UseVirtualTableOptions): UseVirtualTableReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState<{ scrollTop: number; clientHeight: number }>({
    scrollTop: 0,
    clientHeight: 0
  });

  const updateScrollState = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollState((prev) => {
      if (prev.scrollTop === el.scrollTop && prev.clientHeight === el.clientHeight) {
        return prev;
      }
      return {
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight
      };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    // Measure initial layout
    updateScrollState();

    const handleScroll = () => {
      updateScrollState();
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateScrollState();
      });
      resizeObserver.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [enabled, updateScrollState]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = containerRef.current;
      if (!el) return;
      const targetScroll = Math.max(0, index * estimateRowHeight);
      el.scrollTo({ top: targetScroll, behavior: 'smooth' });
    },
    [estimateRowHeight]
  );

  const windowResult = useMemo(() => {
    // If virtualization is disabled or count is small, render all items directly
    if (!enabled || count <= 0) {
      const indices: number[] = [];
      for (let i = 0; i < count; i++) indices.push(i);
      return {
        startIndex: 0,
        endIndex: count,
        totalHeight: count * estimateRowHeight,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        virtualIndices: indices
      };
    }

    return computeVirtualWindow({
      count,
      estimateRowHeight,
      scrollTop: scrollState.scrollTop,
      clientHeight: scrollState.clientHeight || 550,
      overscan
    });
  }, [enabled, count, estimateRowHeight, scrollState.scrollTop, scrollState.clientHeight, overscan]);

  return {
    ...windowResult,
    containerRef,
    isVirtualized: enabled && count > (windowResult.virtualIndices.length || 0),
    scrollToIndex
  };
}
