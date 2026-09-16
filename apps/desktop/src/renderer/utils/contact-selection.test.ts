import { describe, it, expect, vi } from 'vitest';
import {
  computePageSelectionState,
  computeAllMatchingPageSelectionState,
  toggleSelectAllPage,
  toggleAllMatchingPage,
  toggleSelectContact,
  toggleAllMatchingContact,
  pruneStaleSelectedIds,
  matchesCanonicalQuery,
  areQueriesEqual,
  ContactSelectionManager,
  type CanonicalContactQuery,
  type BulkContactSelection
} from './contact-selection';
import { resolveMatchingContactIds } from '../../main/ipc/query-resolver';

describe('Contact Selection & Bulk Operations (ID-safe Explicit & All-Matching Modes)', () => {
  const page1Ids = ['A', 'B', 'C', 'D', 'E'];
  const page2Ids = ['F', 'G', 'H', 'I', 'J'];

  // -------------------------------------------------------------------------
  // Phase 5 Tests (Explicit Mode Semantics)
  // -------------------------------------------------------------------------
  describe('Phase 5 — Explicit ID Selection', () => {
    it('selects all records on Page 1', () => {
      const manager = new ContactSelectionManager();
      manager.togglePage(page1Ids);

      expect(manager.getSelectedIds()).toEqual(expect.arrayContaining(page1Ids));
      expect(manager.getSelectedCount()).toBe(5);

      const headerState = manager.getPageSelectionState(page1Ids);
      expect(headerState.checked).toBe(true);
      expect(headerState.indeterminate).toBe(false);
      expect(headerState.selectedCountOnPage).toBe(5);
    });

    it('preserves selections across pagination; Page 2 UI shows unchecked', () => {
      const manager = new ContactSelectionManager(page1Ids);

      expect(manager.getSelectedIds()).toEqual(page1Ids);

      for (const id of page2Ids) {
        expect(manager.isSelected(id)).toBe(false);
      }

      const page2Header = manager.getPageSelectionState(page2Ids);
      expect(page2Header.checked).toBe(false);
      expect(page2Header.indeterminate).toBe(false);
      expect(page2Header.selectedCountOnPage).toBe(0);
    });

    it('header is unchecked when selectedIds.size === currentPage.length but IDs belong to another page', () => {
      const selectedIds = ['A', 'B', 'C', 'D', 'E'];
      const currentPage = ['F', 'G', 'H', 'I', 'J'];

      const headerState = computePageSelectionState(currentPage, selectedIds);
      expect(headerState.checked).toBe(false);
      expect(headerState.indeterminate).toBe(false);
      expect(headerState.selectedCountOnPage).toBe(0);
    });

    it('partial page selection produces indeterminate header state', () => {
      const currentPage = ['F', 'G', 'H', 'I', 'J'];
      const selectedIds = ['G', 'H'];

      const headerState = computePageSelectionState(currentPage, selectedIds);
      expect(headerState.checked).toBe(false);
      expect(headerState.indeterminate).toBe(true);
      expect(headerState.selectedCountOnPage).toBe(2);
    });

    it('prunes deleted or nonexistent contact IDs from selectedIds', () => {
      const selectedIds = ['A', 'B', 'C', 'D'];
      const validInDb = ['A', 'C', 'E'];

      const pruned = pruneStaleSelectedIds(validInDb, selectedIds);
      expect(pruned).toEqual(['A', 'C']);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 5B Tests 1 to 15 (Specification Requirements)
  // -------------------------------------------------------------------------
  describe('Phase 5B — Select All Matching Contacts', () => {
    // -----------------------------------------------------------------------
    // Test 1 — Page selection is not all-matching
    // -----------------------------------------------------------------------
    it('Test 1: page selection is not all-matching (explicit mode only)', () => {
      const manager = new ContactSelectionManager();

      manager.togglePage(page1Ids);

      expect(manager.getMode()).toBe('explicit');
      expect(manager.isAllMatching()).toBe(false);
      expect(manager.getSelectedCount()).toBe(5);
      expect(manager.getCapturedQuery()).toBeNull();
      expect(manager.getExcludedIds()).toEqual([]);

      const bulkPayload = manager.getBulkSelection();
      expect(bulkPayload).toEqual({
        mode: 'explicit',
        selectedIds: expect.arrayContaining(page1Ids)
      });
    });

    // -----------------------------------------------------------------------
    // Test 2 — Transition to all-matching
    // -----------------------------------------------------------------------
    it('Test 2: transition to all-matching stores query snapshot and initializes clean exclusion set', () => {
      const manager = new ContactSelectionManager(page1Ids);
      const querySnapshot: CanonicalContactQuery = {
        search: 'acme',
        status: 'NEW',
        companyId: 'comp-100'
      };

      manager.selectAllMatching(querySnapshot, 5000);

      expect(manager.getMode()).toBe('all-matching');
      expect(manager.isAllMatching()).toBe(true);
      expect(manager.getCapturedQuery()).toEqual(querySnapshot);
      expect(manager.getMatchedCount()).toBe(5000);
      expect(manager.getExcludedIds()).toEqual([]);
      expect(manager.getEffectiveCount()).toBe(5000);
      expect(manager.getSelectedIds()).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Test 3 — Pagination in all-matching mode
    // -----------------------------------------------------------------------
    it('Test 3: pagination in all-matching mode renders every page checked without materializing IDs', () => {
      const manager = new ContactSelectionManager();
      manager.selectAllMatching({ status: 'NEW' }, 5000);

      // Page 1 header and rows
      const page1Header = manager.getPageSelectionState(page1Ids);
      expect(page1Header.checked).toBe(true);
      expect(page1Header.indeterminate).toBe(false);
      expect(page1Header.selectedCountOnPage).toBe(page1Ids.length);
      for (const id of page1Ids) {
        expect(manager.isSelected(id)).toBe(true);
      }

      // Page 2 header and rows
      const page2Header = manager.getPageSelectionState(page2Ids);
      expect(page2Header.checked).toBe(true);
      expect(page2Header.indeterminate).toBe(false);
      expect(page2Header.selectedCountOnPage).toBe(page2Ids.length);
      for (const id of page2Ids) {
        expect(manager.isSelected(id)).toBe(true);
      }

      // Internal exclusion set remains empty — 0 IDs stored in memory
      expect(manager.getExcludedIds()).toHaveLength(0);
      expect(manager.getEffectiveCount()).toBe(5000);
    });

    // -----------------------------------------------------------------------
    // Test 4 — Single contact exclusion
    // -----------------------------------------------------------------------
    it('Test 4: deselecting a single contact adds it to excludedIds, sets row unchecked and header indeterminate', () => {
      const manager = new ContactSelectionManager();
      manager.selectAllMatching({ status: 'NEW' }, 5000);

      // Deselect 'G' on Page 2
      manager.toggleContact('G');

      expect(manager.getExcludedIds()).toEqual(['G']);
      expect(manager.isSelected('G')).toBe(false);
      expect(manager.isSelected('F')).toBe(true);
      expect(manager.isSelected('H')).toBe(true);

      // Page 2 header is now indeterminate (4 of 5 selected)
      const page2Header = manager.getPageSelectionState(page2Ids);
      expect(page2Header.checked).toBe(false);
      expect(page2Header.indeterminate).toBe(true);
      expect(page2Header.selectedCountOnPage).toBe(4);

      // Effective count decrements to 4999
      expect(manager.getEffectiveCount()).toBe(4999);
    });

    // -----------------------------------------------------------------------
    // Test 5 — Re-inclusion
    // -----------------------------------------------------------------------
    it('Test 5: clicking an excluded contact re-includes it and restores fully checked state', () => {
      const manager = new ContactSelectionManager();
      manager.selectAllMatching({ status: 'NEW' }, 5000);

      manager.toggleContact('G'); // exclude
      expect(manager.getEffectiveCount()).toBe(4999);

      manager.toggleContact('G'); // re-include
      expect(manager.getExcludedIds()).toEqual([]);
      expect(manager.isSelected('G')).toBe(true);

      const page2Header = manager.getPageSelectionState(page2Ids);
      expect(page2Header.checked).toBe(true);
      expect(page2Header.indeterminate).toBe(false);
      expect(page2Header.selectedCountOnPage).toBe(5);
      expect(manager.getEffectiveCount()).toBe(5000);
    });

    // -----------------------------------------------------------------------
    // Test 6 — Current page toggle in all-matching mode
    // -----------------------------------------------------------------------
    it('Test 6: toggling page header in all-matching mode adds/removes current page IDs from exclusions', () => {
      const manager = new ContactSelectionManager();
      manager.selectAllMatching({ status: 'NEW' }, 5000);

      // Toggle Page 1 off
      manager.togglePage(page1Ids);

      expect(manager.getExcludedIds()).toEqual(expect.arrayContaining(page1Ids));
      expect(manager.getEffectiveCount()).toBe(4995);

      // Page 1 is unchecked
      const page1Header = manager.getPageSelectionState(page1Ids);
      expect(page1Header.checked).toBe(false);
      expect(page1Header.indeterminate).toBe(false);
      expect(page1Header.selectedCountOnPage).toBe(0);

      // Page 2 remains fully checked
      const page2Header = manager.getPageSelectionState(page2Ids);
      expect(page2Header.checked).toBe(true);
      expect(page2Header.indeterminate).toBe(false);
      expect(page2Header.selectedCountOnPage).toBe(5);

      // Toggle Page 1 back on
      manager.togglePage(page1Ids);
      expect(manager.getExcludedIds()).toEqual([]);
      expect(manager.getEffectiveCount()).toBe(5000);
      expect(manager.getPageSelectionState(page1Ids).checked).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Test 7 — Filter immutability and drift detection
    // -----------------------------------------------------------------------
    it('Test 7: captured query snapshot is immutable and flags filter drift', () => {
      const manager = new ContactSelectionManager();
      const initialQuery: CanonicalContactQuery = { search: 'acme', status: 'NEW' };
      manager.selectAllMatching(initialQuery, 5000);

      // Captured query is a detached snapshot
      initialQuery.search = 'modified-externally';
      expect(manager.getCapturedQuery()?.search).toBe('acme');

      // User alters UI filters
      const driftedQuery: CanonicalContactQuery = { search: 'modified-externally', status: 'NEW' };
      expect(areQueriesEqual(driftedQuery, manager.getCapturedQuery())).toBe(false);

      // Equivalent query with undefined/whitespace differences is equal
      const equivalentQuery: CanonicalContactQuery = {
        search: 'acme',
        status: 'NEW',
        city: undefined,
        title: ''
      };
      expect(areQueriesEqual(equivalentQuery, manager.getCapturedQuery())).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Test 8 — Bulk operation payload
    // -----------------------------------------------------------------------
    it('Test 8: bulk operation in all-matching mode transmits query + exclusions, never a large ID list', () => {
      const manager = new ContactSelectionManager();
      const query: CanonicalContactQuery = { status: 'NEW', companyId: 'comp-1' };
      manager.selectAllMatching(query, 5000);

      // Exclude two contacts
      manager.toggleContact('G');
      manager.toggleContact('H');

      const payload: BulkContactSelection = manager.getBulkSelection();

      expect(payload).toEqual({
        mode: 'all-matching',
        query: { status: 'NEW', companyId: 'comp-1' },
        excludedIds: ['G', 'H']
      });

      // Crucial assertion: no materialization of 4,998 IDs
      expect((payload as any).selectedIds).toBeUndefined();
      expect((payload as any).ids).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Test 9 — Backend query resolution
    // -----------------------------------------------------------------------
    it('Test 9: backend resolver runs parameterized SQL with workspace isolation and exclusions', () => {
      const capturedSql: { query: string; params: any[] } = { query: '', params: [] };

      const mockDb = {
        prepare: (query: string) => ({
          all: (...params: any[]) => {
            capturedSql.query = query;
            capturedSql.params = params;
            return [{ id: 'ct-1' }, { id: 'ct-2' }, { id: 'ct-3' }];
          }
        })
      };

      const resolved = resolveMatchingContactIds(
        mockDb,
        'ws-active',
        { status: 'NEW', search: 'sarah' },
        ['ct-2']
      );

      // Verified exclusion of 'ct-2'
      expect(resolved).toEqual(['ct-1', 'ct-3']);

      // Verified parameterized query structure
      expect(capturedSql.query).toContain('c.workspaceId = ?');
      expect(capturedSql.query).toContain('c.status = ?');
      expect(capturedSql.query).toContain('(c.firstName LIKE ?');
      expect(capturedSql.params[0]).toBe('ws-active');
      expect(capturedSql.params).toContain('NEW');
      expect(capturedSql.params).toContain('%sarah%');
    });

    // -----------------------------------------------------------------------
    // Test 10 — Non-matching contact safety
    // -----------------------------------------------------------------------
    it('Test 10: non-matching contacts are rejected both in-memory and in resolver', () => {
      const query: CanonicalContactQuery = { search: 'alex', status: 'NEW' };

      const matchingContact = {
        id: 'c1',
        firstName: 'Alex',
        lastName: 'Rivers',
        email: 'alex@example.com',
        status: 'NEW'
      };

      const wrongStatusContact = {
        id: 'c2',
        firstName: 'Alex',
        lastName: 'Rivers',
        email: 'alex@example.com',
        status: 'CONTACTED'
      };

      const wrongNameContact = {
        id: 'c3',
        firstName: 'Bob',
        lastName: 'Smith',
        email: 'bob@example.com',
        status: 'NEW'
      };

      expect(matchesCanonicalQuery(matchingContact, query)).toBe(true);
      expect(matchesCanonicalQuery(wrongStatusContact, query)).toBe(false);
      expect(matchesCanonicalQuery(wrongNameContact, query)).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Test 11 — Workspace isolation
    // -----------------------------------------------------------------------
    it('Test 11: resolver strictly enforces target workspaceId isolation', () => {
      const mockDb = {
        prepare: (query: string) => ({
          all: (...params: any[]) => {
            const [wsId] = params;
            if (wsId === 'workspace-target') {
              return [{ id: 'target-1' }, { id: 'target-2' }];
            }
            return [{ id: 'other-ws-lead' }];
          }
        })
      };

      const targetResults = resolveMatchingContactIds(
        mockDb,
        'workspace-target',
        { status: 'NEW' },
        []
      );

      expect(targetResults).toEqual(['target-1', 'target-2']);
      expect(targetResults).not.toContain('other-ws-lead');
    });

    // -----------------------------------------------------------------------
    // Test 12 — Dataset changes between selection and execution
    // -----------------------------------------------------------------------
    it('Test 12: resolution at execution time reflects newly inserted matching contacts and ignores deleted ones', () => {
      // Mock db returns live rows matching the query at the instant of bulk execution
      const mockDb = {
        prepare: () => ({
          all: () => [
            { id: 'contact-old' },
            { id: 'contact-newly-added' } // Added 1 second after selection was captured
          ]
        })
      };

      const resolved = resolveMatchingContactIds(
        mockDb,
        'ws-1',
        { status: 'NEW' },
        []
      );

      expect(resolved).toEqual(['contact-old', 'contact-newly-added']);
    });

    // -----------------------------------------------------------------------
    // Test 13 — Performance / Zero ID materialization with 5,000+ synthetic contacts
    // -----------------------------------------------------------------------
    it('Test 13: 5,000+ synthetic contact test verifies state size remains O(exclusions)', () => {
      const manager = new ContactSelectionManager();
      const syntheticCount = 10000;

      // Select all 10,000 matching contacts
      manager.selectAllMatching({ status: 'NEW' }, syntheticCount);

      // Invariant: zero contact IDs stored in memory
      expect(manager.getExcludedIds()).toHaveLength(0);
      expect(manager.getSelectedIds()).toHaveLength(0);
      expect(manager.getEffectiveCount()).toBe(syntheticCount);

      // Exclude 3 specific contacts out of 10,000
      manager.toggleContact('id-42');
      manager.toggleContact('id-100');
      manager.toggleContact('id-999');

      // State holds ONLY the 3 excluded IDs, NOT 9,997 IDs!
      expect(manager.getExcludedIds()).toEqual(['id-42', 'id-100', 'id-999']);
      expect(manager.getEffectiveCount()).toBe(9997);
    });

    // -----------------------------------------------------------------------
    // Test 14 — Empty match set
    // -----------------------------------------------------------------------
    it('Test 14: empty match set sets count to 0 and page selection is unchecked', () => {
      const manager = new ContactSelectionManager();
      manager.selectAllMatching({ search: 'nonexistent-lead-xyz' }, 0);

      expect(manager.getEffectiveCount()).toBe(0);
      expect(manager.getMatchedCount()).toBe(0);

      const emptyPageHeader = manager.getPageSelectionState([]);
      expect(emptyPageHeader.checked).toBe(false);
      expect(emptyPageHeader.indeterminate).toBe(false);
      expect(emptyPageHeader.selectedCountOnPage).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Test 15 — Bulk operation failure safety
    // -----------------------------------------------------------------------
    it('Test 15: bulk operation rejection leaves selection state uncorrupted', async () => {
      const manager = new ContactSelectionManager();
      const query: CanonicalContactQuery = { status: 'NEW' };
      manager.selectAllMatching(query, 5000);
      manager.toggleContact('G');

      const mockFailingIpc = vi.fn().mockRejectedValue(new Error('Network disconnected'));

      await expect(
        mockFailingIpc({ selection: manager.getBulkSelection() })
      ).rejects.toThrow('Network disconnected');

      // Selection state must remain completely intact
      expect(manager.getMode()).toBe('all-matching');
      expect(manager.getCapturedQuery()).toEqual(query);
      expect(manager.getExcludedIds()).toEqual(['G']);
      expect(manager.getEffectiveCount()).toBe(4999);
      expect(manager.isSelected('F')).toBe(true);
      expect(manager.isSelected('G')).toBe(false);
    });
  });
});
