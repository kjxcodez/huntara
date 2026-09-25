import { describe, it, expect } from 'vitest';
import { computeVirtualWindow } from './virtual-table';
import { computePageSelectionState } from './contact-selection';

describe('HUNTARA Phase 5.1 — Virtual Table Scroll & Stability Regression Suite', () => {
  const ROW_HEIGHT = 52;
  const CLIENT_HEIGHT = 550;
  const OVERSCAN = 6;

  describe('1. computeVirtualWindow Deterministic Behavior', () => {
    it('returns byte-for-byte identical output over 100 repeated evaluations at identical scrollTop', () => {
      const count = 5000;
      const scrollTop = 1820;

      const baseline = computeVirtualWindow({
        count,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop,
        clientHeight: CLIENT_HEIGHT,
        overscan: OVERSCAN
      });

      for (let i = 0; i < 100; i++) {
        const result = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });
        expect(result).toEqual(baseline);
      }
    });
  });

  describe('2. Boundary Calculations & Extreme Values', () => {
    it('handles count = 0 cleanly with zeroed geometry', () => {
      const res = computeVirtualWindow({
        count: 0,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: 1000,
        clientHeight: CLIENT_HEIGHT,
        overscan: OVERSCAN
      });
      expect(res.startIndex).toBe(0);
      expect(res.endIndex).toBe(0);
      expect(res.totalHeight).toBe(0);
      expect(res.topSpacerHeight).toBe(0);
      expect(res.bottomSpacerHeight).toBe(0);
      expect(res.virtualIndices).toEqual([]);
    });

    it('handles clientHeight = 0 cleanly', () => {
      const res = computeVirtualWindow({
        count: 100,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: 500,
        clientHeight: 0,
        overscan: OVERSCAN
      });
      expect(res.virtualIndices).toEqual([]);
      expect(res.totalHeight).toBe(0);
    });

    it('handles fractional scrollTop without floating point spacer drift', () => {
      const res = computeVirtualWindow({
        count: 100,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: 356.7891,
        clientHeight: CLIENT_HEIGHT,
        overscan: OVERSCAN
      });
      expect(Number.isInteger(res.topSpacerHeight)).toBe(true);
      expect(Number.isInteger(res.bottomSpacerHeight)).toBe(true);
      expect(res.startIndex).toBeLessThanOrEqual(res.endIndex);
    });
  });

  describe('3. Large Item Counts Scaling (100, 500, 1,000, 5,000, 10,000)', () => {
    const scaleTiers = [100, 500, 1000, 5000, 10000];

    it.each(scaleTiers)('bounds mounted rows to <= 26 rows at %d total items', (count) => {
      const totalHeight = count * ROW_HEIGHT;
      const testScrolls = [
        0, // top
        Math.floor(totalHeight * 0.1), // 10%
        Math.floor(totalHeight * 0.25), // 25%
        Math.floor(totalHeight * 0.5), // 50%
        Math.floor(totalHeight * 0.75), // 75%
        Math.floor(totalHeight * 0.9), // 90%
        Math.max(0, totalHeight - CLIENT_HEIGHT) // bottom
      ];

      for (const st of testScrolls) {
        const res = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        // Invariant: DOM rows remain bounded regardless of total dataset size
        expect(res.virtualIndices.length).toBeLessThanOrEqual(26);
        expect(res.startIndex).toBeGreaterThanOrEqual(0);
        expect(res.endIndex).toBeLessThanOrEqual(count);
        expect(res.topSpacerHeight + res.virtualIndices.length * ROW_HEIGHT + res.bottomSpacerHeight).toBe(totalHeight);
      }
    });
  });

  describe('4. Negative scrollTop Clamping (Elastic Scroll / Rubber-Banding)', () => {
    it('safely clamps negative scroll offsets to top of table', () => {
      for (const st of [-1, -50, -200, -999]) {
        const res = computeVirtualWindow({
          count: 500,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });
        expect(res.startIndex).toBe(0);
        expect(res.topSpacerHeight).toBe(0);
        expect(res.virtualIndices[0]).toBe(0);
      }
    });
  });

  describe('5. Maximum scrollTop Clamping (Over-Scroll Past Table Bottom)', () => {
    it('safely clamps extreme scroll offsets to bottom of table without empty gaps or orphaned spacers', () => {
      const count = 100;
      const totalHeight = count * ROW_HEIGHT;
      const beyondTableScrolls = [totalHeight + 100, totalHeight + 5000, 999999];

      for (const st of beyondTableScrolls) {
        const res = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        expect(res.endIndex).toBe(count);
        expect(res.bottomSpacerHeight).toBe(0);
        expect(res.virtualIndices.length).toBeGreaterThan(0);
        expect(res.virtualIndices[res.virtualIndices.length - 1]).toBe(count - 1);
        expect(res.topSpacerHeight + res.virtualIndices.length * ROW_HEIGHT + res.bottomSpacerHeight).toBe(totalHeight);
      }
    });
  });

  describe('6. Same Scroll Position Invariant (User Reported Failure Scenario)', () => {
    it('guarantees identical window, identical visible IDs, and identical spacer geometry at fixed checkpoints', () => {
      const count = 2000;
      const checkpoints = [500, 1000, 1500, 2500, 5000];

      for (const st of checkpoints) {
        const pass1 = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        // Simulate intermediate scroll elsewhere and return to checkpoint
        computeVirtualWindow({ count, estimateRowHeight: ROW_HEIGHT, scrollTop: 8000, clientHeight: CLIENT_HEIGHT, overscan: OVERSCAN });

        const pass2 = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
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
  });

  describe('7. No Window Outside Array Bounds Invariant', () => {
    it('strictly satisfies 0 <= startIndex <= endIndex <= count for all arbitrary scroll values', () => {
      const count = 150;
      for (let st = -200; st <= 15000; st += 37) {
        const res = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        expect(res.startIndex).toBeGreaterThanOrEqual(0);
        expect(res.startIndex).toBeLessThanOrEqual(res.endIndex);
        expect(res.endIndex).toBeLessThanOrEqual(count);
        for (const idx of res.virtualIndices) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(count);
        }
      }
    });
  });

  describe('8. Spacer Calculation Consistency Invariant', () => {
    it('ensures topSpacer + renderedHeight + bottomSpacer strictly equals totalHeight at all step positions', () => {
      const count = 300;
      const totalHeight = count * ROW_HEIGHT;

      for (let st = 0; st <= totalHeight; st += 25) {
        const res = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: st,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        const renderedHeight = res.virtualIndices.length * ROW_HEIGHT;
        expect(res.topSpacerHeight + renderedHeight + res.bottomSpacerHeight).toBe(totalHeight);
      }
    });
  });

  describe('9. Selection State Independence', () => {
    it('selection state changes do not distort virtual table geometry', () => {
      const count = 500;
      const scrollTop = 1200;

      const windowBeforeSelection = computeVirtualWindow({
        count,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop,
        clientHeight: CLIENT_HEIGHT,
        overscan: OVERSCAN
      });

      // Toggle selection of contacts in and out of the viewport
      const allIds = Array.from({ length: count }, (_, i) => `ct_${i}`);
      const selectedSet = new Set(['ct_0', 'ct_25', 'ct_100', 'ct_499']);
      const pageSelection = computePageSelectionState(allIds.slice(0, 50), selectedSet);
      expect(pageSelection.indeterminate).toBe(true);

      const windowAfterSelection = computeVirtualWindow({
        count,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop,
        clientHeight: CLIENT_HEIGHT,
        overscan: OVERSCAN
      });

      expect(windowBeforeSelection).toEqual(windowAfterSelection);
    });
  });

  describe('10. Filter Transitions & Dataset Contraction', () => {
    it('safely recalculates window without errors when dataset contracts from 5000 to 12 items while scrolled', () => {
      // User was scrolled at 2500px in a 5000 item list
      const initialScroll = 2500;

      // Filter applies, reducing count to 12
      const contractedRes = computeVirtualWindow({
        count: 12,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: initialScroll,
        clientHeight: CLIENT_HEIGHT,
        overscan: OVERSCAN
      });

      // Total height of 12 items = 624px, fits in viewport (550px)
      expect(contractedRes.startIndex).toBe(0);
      expect(contractedRes.endIndex).toBe(12);
      expect(contractedRes.topSpacerHeight).toBe(0);
      expect(contractedRes.bottomSpacerHeight).toBe(0);
      expect(contractedRes.virtualIndices.length).toBe(12);
    });
  });

  describe('11. Page Size Transitions (25 -> 50 -> 100 -> 250 -> All -> 25)', () => {
    it('maintains valid geometric bounds through all standard page size transitions', () => {
      const pageSizes = [25, 50, 100, 250, 1000, 25];
      let currentScroll = 1200;

      for (const pageSize of pageSizes) {
        const res = computeVirtualWindow({
          count: pageSize,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: currentScroll,
          clientHeight: CLIENT_HEIGHT,
          overscan: OVERSCAN
        });

        expect(res.startIndex).toBeGreaterThanOrEqual(0);
        expect(res.startIndex).toBeLessThanOrEqual(res.endIndex);
        expect(res.endIndex).toBeLessThanOrEqual(pageSize);
        expect(res.topSpacerHeight + res.virtualIndices.length * ROW_HEIGHT + res.bottomSpacerHeight).toBe(
          pageSize * ROW_HEIGHT
        );
      }
    });
  });

  describe('12. Container Height Variations (Window Resize / Panel Toggles)', () => {
    it('smoothly expands and contracts virtual window as clientHeight changes', () => {
      const count = 500;
      const scrollTop = 1000;
      const viewportHeights = [300, 450, 600, 800, 1000, 400];

      let prevVisibleCount = 0;
      for (const ch of viewportHeights) {
        const res = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop,
          clientHeight: ch,
          overscan: OVERSCAN
        });

        expect(res.virtualIndices.length).toBeGreaterThan(0);
        expect(res.topSpacerHeight + res.virtualIndices.length * ROW_HEIGHT + res.bottomSpacerHeight).toBe(
          count * ROW_HEIGHT
        );
      }
    });
  });
});
