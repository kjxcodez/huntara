import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { computeVirtualWindow, type VirtualWindowResult } from '../utils/virtual-table';

export interface UseVirtualTableOptions {
  count: number;
  estimateRowHeight?: number;
  overscan?: number;
  enabled?: boolean;
}

export type VirtualContainerRef = {
  (node: HTMLDivElement | null): void;
  current: HTMLDivElement | null;
};

export interface UseVirtualTableReturn extends VirtualWindowResult {
  containerRef: VirtualContainerRef;
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
  estimateRowHeight = 52,
  overscan = 6,
  enabled = true
}: UseVirtualTableOptions): UseVirtualTableReturn {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);

  const containerRefCallback = useCallback((node: HTMLDivElement | null) => {
    internalRef.current = node;
    setContainerNode(node);
  }, []);

  const containerRef = useMemo(() => {
    const fn = (node: HTMLDivElement | null) => {
      containerRefCallback(node);
    };
    Object.defineProperty(fn, 'current', {
      get: () => internalRef.current,
      set: (val: HTMLDivElement | null) => {
        internalRef.current = val;
        setContainerNode(val);
      }
    });
    return fn as VirtualContainerRef;
  }, [containerRefCallback]);

  const [scrollState, setScrollState] = useState<{ scrollTop: number; clientHeight: number }>({
    scrollTop: 0,
    clientHeight: 0
  });

  useEffect(() => {
    if (!containerNode || !enabled) return;

    let rafId: number | null = null;
    let lastScrollTop = containerNode.scrollTop;
    let lastClientHeight = containerNode.clientHeight;

    // Immediately record initial layout on mount
    setScrollState((prev) => {
      if (prev.scrollTop === lastScrollTop && prev.clientHeight === lastClientHeight) {
        return prev;
      }
      return {
        scrollTop: lastScrollTop,
        clientHeight: lastClientHeight
      };
    });

    // Coalesce high-frequency scroll events using requestAnimationFrame to prevent render frame thrashing
    const handleScroll = () => {
      const currentScrollTop = containerNode.scrollTop;
      const currentClientHeight = containerNode.clientHeight;

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (
            lastScrollTop !== currentScrollTop ||
            lastClientHeight !== currentClientHeight
          ) {
            lastScrollTop = currentScrollTop;
            lastClientHeight = currentClientHeight;
            setScrollState({
              scrollTop: currentScrollTop,
              clientHeight: currentClientHeight
            });
          }
        });
      }
    };

    containerNode.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const newHeight = Math.round(
          entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        );
        if (newHeight > 0 && Math.abs(newHeight - lastClientHeight) >= 2) {
          lastClientHeight = newHeight;
          setScrollState((prev) => ({
            ...prev,
            clientHeight: newHeight
          }));
        }
      });
      resizeObserver.observe(containerNode);
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      containerNode.removeEventListener('scroll', handleScroll);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [containerNode, enabled]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = internalRef.current;
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
