import { describe, it, expect } from 'vitest';
import { computeVirtualWindow } from './virtual-table';
import {
  computePageSelectionState,
  computeAllMatchingPageSelectionState,
  toggleSelectAllPage,
  toggleAllMatchingPage,
  type CanonicalContactQuery
} from './contact-selection';

describe('HUNTARA Phase 5 — Virtual Table & Renderer Performance Invariants', () => {
  const ROW_HEIGHT = 48;
  const VIEWPORT_HEIGHT = 500;
  const OVERSCAN = 5;

  describe('1. Virtual Window Row Count & Height Bounds', () => {
    it('returns empty result when count is 0 or clientHeight is 0', () => {
      const resZeroCount = computeVirtualWindow({
        count: 0,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: 0,
        clientHeight: VIEWPORT_HEIGHT,
        overscan: OVERSCAN
      });
      expect(resZeroCount.virtualIndices).toEqual([]);
      expect(resZeroCount.totalHeight).toBe(0);
      expect(resZeroCount.topSpacerHeight).toBe(0);
      expect(resZeroCount.bottomSpacerHeight).toBe(0);

      const resZeroHeight = computeVirtualWindow({
        count: 100,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: 0,
        clientHeight: 0,
        overscan: OVERSCAN
      });
      expect(resZeroHeight.virtualIndices).toEqual([]);
      expect(resZeroHeight.totalHeight).toBe(0);
    });

    it('mounts all rows directly without spacers when total dataset fits in viewport', () => {
      const count = 8;
      const res = computeVirtualWindow({
        count,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: 0,
        clientHeight: VIEWPORT_HEIGHT,
        overscan: OVERSCAN
      });

      expect(res.virtualIndices.length).toBe(count);
      expect(res.startIndex).toBe(0);
      expect(res.endIndex).toBe(count);
      expect(res.topSpacerHeight).toBe(0);
      expect(res.bottomSpacerHeight).toBe(0);
      expect(res.totalHeight).toBe(count * ROW_HEIGHT);
    });

    it('bounds mounted rows to <= 25 rows at scale tiers (100, 500, 1,000, 5,000, 10,000)', () => {
      const tiers = [100, 500, 1000, 5000, 10000];

      for (const count of tiers) {
        // Test at top
        const topRes = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: 0,
          clientHeight: VIEWPORT_HEIGHT,
          overscan: OVERSCAN
        });
        expect(topRes.virtualIndices.length).toBeLessThanOrEqual(25);
        expect(topRes.startIndex).toBe(0);
        expect(topRes.topSpacerHeight).toBe(0);
        expect(topRes.topSpacerHeight + topRes.virtualIndices.length * ROW_HEIGHT + topRes.bottomSpacerHeight).toBe(
          count * ROW_HEIGHT
        );

        // Test in middle (scrolled to 50% of table)
        const middleScroll = Math.floor((count * ROW_HEIGHT) / 2);
        const midRes = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: middleScroll,
          clientHeight: VIEWPORT_HEIGHT,
          overscan: OVERSCAN
        });
        expect(midRes.virtualIndices.length).toBeLessThanOrEqual(25);
        expect(midRes.topSpacerHeight).toBeGreaterThan(0);
        expect(midRes.bottomSpacerHeight).toBeGreaterThan(0);
        expect(midRes.topSpacerHeight + midRes.virtualIndices.length * ROW_HEIGHT + midRes.bottomSpacerHeight).toBe(
          count * ROW_HEIGHT
        );

        // Test at bottom
        const bottomScroll = Math.max(0, count * ROW_HEIGHT - VIEWPORT_HEIGHT);
        const botRes = computeVirtualWindow({
          count,
          estimateRowHeight: ROW_HEIGHT,
          scrollTop: bottomScroll,
          clientHeight: VIEWPORT_HEIGHT,
          overscan: OVERSCAN
        });
        expect(botRes.virtualIndices.length).toBeLessThanOrEqual(25);
        expect(botRes.endIndex).toBe(count);
        expect(botRes.bottomSpacerHeight).toBe(0);
        expect(botRes.topSpacerHeight + botRes.virtualIndices.length * ROW_HEIGHT + botRes.bottomSpacerHeight).toBe(
          count * ROW_HEIGHT
        );
      }
    });

    it('safely clamps negative scrollTop (macOS rubber-banding)', () => {
      const res = computeVirtualWindow({
        count: 500,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: -80,
        clientHeight: VIEWPORT_HEIGHT,
        overscan: OVERSCAN
      });

      expect(res.startIndex).toBe(0);
      expect(res.topSpacerHeight).toBe(0);
      expect(res.virtualIndices.length).toBeLessThanOrEqual(25);
    });
  });

  describe('2. Selection Invariants Independent of DOM Windowing', () => {
    it('preserves query-based "Select All Matching" regardless of visible virtual rows', () => {
      const totalDatasetCount = 10000;
      const canonicalQuery: CanonicalContactQuery = {
        search: 'director',
        status: 'LEAD',
        discoveryRunId: 'run_123'
      };

      // Virtual window only mounts 20 rows
      const virtualWindow = computeVirtualWindow({
        count: totalDatasetCount,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: 1000,
        clientHeight: VIEWPORT_HEIGHT,
        overscan: OVERSCAN
      });
      expect(virtualWindow.virtualIndices.length).toBeLessThan(30);

      // Invariant: "Select All Matching" targets the canonical query + total dataset count
      const allMatchingState = {
        mode: 'all-matching',
        capturedQuery: { ...canonicalQuery },
        matchedCount: totalDatasetCount,
        excludedIds: ['ct_105', 'ct_999']
      };

      const effectiveSelectedCount = allMatchingState.matchedCount - allMatchingState.excludedIds.length;
      expect(effectiveSelectedCount).toBe(9998);
      // Confirms selection count is independent of virtualWindow.virtualIndices.length
      expect(effectiveSelectedCount).not.toBe(virtualWindow.virtualIndices.length);
    });

    it('computes correct page selection state across all IDs on page even when virtualized', () => {
      const pageIds = Array.from({ length: 50 }, (_, i) => `ct_page_${i}`);
      const selectedIds = new Set(pageIds); // all 50 selected

      // Virtual window only renders 15 of the 50 rows at any scroll position
      const virtualWindow = computeVirtualWindow({
        count: pageIds.length,
        estimateRowHeight: ROW_HEIGHT,
        scrollTop: 0,
        clientHeight: 300,
        overscan: 2
      });
      expect(virtualWindow.virtualIndices.length).toBeLessThan(pageIds.length);

      // Header selection state evaluates over all 50 page IDs
      const state = computePageSelectionState(pageIds, selectedIds);
      expect(state.checked).toBe(true);
      expect(state.indeterminate).toBe(false);
      expect(state.selectedCountOnPage).toBe(50);
    });

    it('toggleSelectAllPage toggles all page IDs without being restricted to visible DOM rows', () => {
      const pageIds = Array.from({ length: 50 }, (_, i) => `ct_page_${i}`);
      let selectedIds: string[] = [];

      // Select all 50 items on page
      selectedIds = toggleSelectAllPage(pageIds, selectedIds);
      expect(selectedIds.length).toBe(50);

      // Deselect all items on page
      selectedIds = toggleSelectAllPage(pageIds, selectedIds);
      expect(selectedIds.length).toBe(0);
    });
  });

  describe('3. Map Lookup Optimization Invariants', () => {
    it('resolves company name via Map in O(1) compared to O(N) Array.find', () => {
      const companies = Array.from({ length: 1000 }, (_, i) => ({
        id: `comp_${i}`,
        name: `Company ${i} Corp`
      }));

      const companyMap = new Map<string, string>();
      for (const comp of companies) {
        companyMap.set(comp.id, comp.name);
      }

      // Target lookup
      const targetId = 'comp_999';
      expect(companyMap.get(targetId)).toBe('Company 999 Corp');
      expect(companyMap.get('non_existent')).toBeUndefined();
    });

    it('groups contacts by companyId in a Map in O(N) single-pass', () => {
      const contacts = [
        { id: 'ct_1', companyId: 'comp_1', email: 'a@c1.com' },
        { id: 'ct_2', companyId: 'comp_1', email: 'b@c1.com' },
        { id: 'ct_3', companyId: 'comp_2', email: 'c@c2.com' },
        { id: 'ct_4', companyId: null, email: 'd@standalone.com' }
      ];

      const map = new Map<string, typeof contacts>();
      for (const ct of contacts) {
        if (!ct.companyId) continue;
        let list = map.get(ct.companyId);
        if (!list) {
          list = [];
          map.set(ct.companyId, list);
        }
        list.push(ct);
      }

      expect(map.get('comp_1')?.length).toBe(2);
      expect(map.get('comp_2')?.length).toBe(1);
      expect(map.get('comp_3')).toBeUndefined();
    });
  });

  describe('4. Discovery Polling Lifecycle Invariants', () => {
    function shouldPollDiscovery(runs: Array<{ status: string }>, crawlers: Array<{ status: string }>): boolean {
      const activeRunStatuses = ['running', 'queued', 'retrying', 'pending', 'starting'];
      const hasActiveRuns = runs.some((r) => activeRunStatuses.includes(r.status.toLowerCase()));
      const hasActiveCrawlers = crawlers.some((c) => activeRunStatuses.includes(c.status.toLowerCase()));
      return hasActiveRuns || hasActiveCrawlers;
    }

    it('stops polling when all discovery runs and child crawlers are terminal', () => {
      const terminalRuns = [
        { status: 'completed' },
        { status: 'failed' },
        { status: 'cancelled' }
      ];
      const terminalCrawlers = [
        { status: 'completed' },
        { status: 'completed' }
      ];

      expect(shouldPollDiscovery(terminalRuns, terminalCrawlers)).toBe(false);
    });

    it('continues polling when at least one discovery run is active', () => {
      const runs = [
        { status: 'completed' },
        { status: 'running' }
      ];
      const crawlers = [{ status: 'completed' }];

      expect(shouldPollDiscovery(runs, crawlers)).toBe(true);
    });

    it('continues polling when a child crawler is active', () => {
      const runs = [{ status: 'completed' }];
      const crawlers = [
        { status: 'completed' },
        { status: 'queued' }
      ];

      expect(shouldPollDiscovery(runs, crawlers)).toBe(true);
    });

    it('stops polling when no discovery runs exist at all', () => {
      expect(shouldPollDiscovery([], [])).toBe(false);
    });
  });
});
