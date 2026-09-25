import { describe, it, expect } from 'vitest';
import { computeVirtualWindow } from './virtual-table';

describe('HUNTARA Phase 5.1 — Virtual Table Scroll Instability Reproduction & Geometry Diagnostics', () => {
  const ROW_HEIGHT = 52;
  const CLIENT_HEIGHT = 500;
  const OVERSCAN = 6;

  describe('1. Same-Scroll-Position Determinism & Window Composition', () => {
    it('produces identical virtual window and spacer geometry at identical scroll positions', () => {
      const count = 1000;
      const testPositions = [0, 500, 1000, 1500, 2500, 5000, 10000];

      for (const scrollTop of testPositions) {
        // Run pass 1
        const pass1 = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        // Run pass 2 (simulating next render cycle with unchanged data)
        const pass2 = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        expect(pass1.startIndex).toBe(pass2.startIndex);
        expect(pass1.endIndex).toBe(pass2.endIndex);
        expect(pass1.topSpacerHeight).toBe(pass2.topSpacerHeight);
        expect(pass1.bottomSpacerHeight).toBe(pass2.bottomSpacerHeight);
        expect(pass1.virtualIndices).toEqual(pass2.virtualIndices);
      }
    });

    it('demonstrates that clientHeight fluctuation changes the virtual window at the same scrollTop', () => {
      const count = 500;
      const scrollTop = 1000;

      // Render A: with initial fallback clientHeight (550px)
      const renderA = computeVirtualWindow({
        count,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop,
        clientHeight: 550,
        overscan: OVERSCAN
      });

      // Render B: after ResizeObserver measures actual clientHeight (420px)
      const renderB = computeVirtualWindow({
        count,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop,
        clientHeight: 420,
        overscan: OVERSCAN
      });

      // Confirm that clientHeight variation alters window composition at identical scrollTop
      expect(renderA.endIndex).not.toBe(renderB.endIndex);
      expect(renderA.virtualIndices.length).toBeGreaterThan(renderB.virtualIndices.length);
    });
  });

  describe('2. Fixed vs Variable Row Height Displacement Jitter Diagnostics', () => {
    it('proves that fixed row height produces 0px visual displacement jitter', () => {
      const count = 200;
      let maxJitter = 0;
      let prevRowPositions: Map<number, number> | null = null;

      // Simulate smooth scroll downwards in 10px increments
      for (let st = 0; st <= 2000; st += 10) {
        const win = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        const currentPositions = new Map<number, number>();
        let currentY = win.topSpacerHeight - st;
        for (let i = win.startIndex; i < win.endIndex; i++) {
          currentPositions.set(i, currentY);
          currentY += ROW_HEIGHT;
        }

        if (prevRowPositions) {
          for (const [rowIdx, prevY] of prevRowPositions.entries()) {
            if (currentPositions.has(rowIdx)) {
              const currY = currentPositions.get(rowIdx)!;
              // Scrolling down 10px should shift the row exactly -10px relative to the viewport
              const actualDiff = currY - prevY;
              const jitter = Math.abs(actualDiff - (-10));
              if (jitter > maxJitter) {
                maxJitter = jitter;
              }
            }
          }
        }
        prevRowPositions = currentPositions;
      }

      // Invariant: When row height is strictly fixed and matches estimate, jitter is 0
      expect(maxJitter).toBe(0);
    });

    it('reproduces severe visual jitter when actual row heights deviate from estimate', () => {
      const count = 200;
      const estimate = 49;
      // Some rows wrap text or badges, expanding to 64px or 76px
      const variableHeights = Array.from({ length: count }, (_, i) =>
        i % 3 === 0 ? 76 : (i % 2 === 0 ? 64 : 52)
      );

      let maxJitter = 0;
      let prevRowPositions: Map<number, number> | null = null;

      for (let st = 0; st <= 2000; st += 10) {
        const win = computeVirtualWindow({
          count,
          estimateRowHeight: estimate,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        const currentPositions = new Map<number, number>();
        let currentY = win.topSpacerHeight - st;
        for (let i = win.startIndex; i < win.endIndex; i++) {
          currentPositions.set(i, currentY);
          currentY += variableHeights[i]!;
        }

        if (prevRowPositions) {
          for (const [rowIdx, prevY] of prevRowPositions.entries()) {
            if (currentPositions.has(rowIdx)) {
              const currY = currentPositions.get(rowIdx)!;
              const actualDiff = currY - prevY;
              const jitter = Math.abs(actualDiff - (-10));
              if (jitter > maxJitter) {
                maxJitter = jitter;
              }
            }
          }
        }
        prevRowPositions = currentPositions;
      }

      // Diagnostic: Variable row heights cause up to 27px+ of sudden visual jumps
      expect(maxJitter).toBeGreaterThanOrEqual(20);
    });
  });

  describe('3. Spacer Math Invariants across Normal Scroll Range', () => {
    it('maintains exact total height across all valid scroll positions', () => {
      const count = 500;
      const totalHeight = count * ROW_HEIGHT;
      const maxScroll = totalHeight - CLIENT_HEIGHT;

      for (let st = 0; st <= maxScroll; st += 150) {
        const win = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        const renderedHeight = win.virtualIndices.length * ROW_HEIGHT;
        const totalCalculated = win.topSpacerHeight + renderedHeight + win.bottomSpacerHeight;

        expect(totalCalculated).toBe(totalHeight);
        expect(win.startIndex).toBeLessThanOrEqual(win.endIndex);
        expect(win.virtualIndices.length).toBeGreaterThan(0);
      }
    });

    it('safely clamps negative scrollTop values', () => {
      const res = computeVirtualWindow({
        count: 100,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: -250,
        clientHeight: CLIENT_HEIGHT,
        overscan: OVERSCAN
      });

      expect(res.startIndex).toBe(0);
      expect(res.topSpacerHeight).toBe(0);
      expect(res.virtualIndices.length).toBeGreaterThan(0);
    });
  });
});
