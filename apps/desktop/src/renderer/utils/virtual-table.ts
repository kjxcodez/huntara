/**
 * Virtual Table Window Calculation Utilities
 *
 * Provides deterministic viewport window calculations for table virtualization,
 * ensuring only visible and near-visible overscan rows are mounted in the DOM.
 */

export interface VirtualWindowParams {
  count: number;
  estimateRowHeight: number;
  scrollTop: number;
  clientHeight: number;
  overscan?: number;
}

export interface VirtualWindowResult {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  virtualIndices: number[];
}

/**
 * Computes the virtualized slice of row indices and spacer heights
 * for a given scroll position and viewport size.
 */
export function computeVirtualWindow(params: VirtualWindowParams): VirtualWindowResult {
  const { count, estimateRowHeight, scrollTop, clientHeight, overscan = 5 } = params;

  if (count <= 0 || clientHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      totalHeight: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      virtualIndices: []
    };
  }

  const totalHeight = count * estimateRowHeight;
  const safeScrollTop = Math.max(0, scrollTop);
  const rawStart = Math.floor(safeScrollTop / estimateRowHeight);
  const visibleCount = Math.ceil(clientHeight / estimateRowHeight);

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(count, rawStart + visibleCount + overscan);

  const topSpacerHeight = startIndex * estimateRowHeight;
  const bottomSpacerHeight = Math.max(0, (count - endIndex) * estimateRowHeight);

  const virtualIndices: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    virtualIndices.push(i);
  }

  return {
    startIndex,
    endIndex,
    totalHeight,
    topSpacerHeight,
    bottomSpacerHeight,
    virtualIndices
  };
}
