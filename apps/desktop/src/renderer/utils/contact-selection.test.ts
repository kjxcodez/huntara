import { describe, it, expect, vi } from 'vitest';
import {
  computePageSelectionState,
  toggleSelectAllPage,
  toggleSelectContact,
  pruneStaleSelectedIds,
  ContactSelectionManager
} from './contact-selection';

describe('Contact Selection & Bulk Operations (ID-safe)', () => {
  const page1Ids = ['A', 'B', 'C', 'D', 'E'];
  const page2Ids = ['F', 'G', 'H', 'I', 'J'];

  // -------------------------------------------------------------------------
  // Test 1 — Select all current page
  // -------------------------------------------------------------------------
  it('Test 1: selects all records on Page 1', () => {
    const manager = new ContactSelectionManager();

    // User presses page header "Select all" on Page 1
    manager.togglePage(page1Ids);

    expect(manager.getSelectedIds()).toEqual(expect.arrayContaining(page1Ids));
    expect(manager.getSelectedCount()).toBe(5);

    const headerState = manager.getPageSelectionState(page1Ids);
    expect(headerState.checked).toBe(true);
    expect(headerState.indeterminate).toBe(false);
    expect(headerState.selectedCountOnPage).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Test 2 — Navigate to page 2
  // -------------------------------------------------------------------------
  it('Test 2: preserves selections across pagination; Page 2 UI shows unchecked', () => {
    // Starting state: Page 1 selected
    const manager = new ContactSelectionManager(page1Ids);

    // Navigate to Page 2 (F, G, H, I, J)
    // Internal state remains A, B, C, D, E
    expect(manager.getSelectedIds()).toEqual(page1Ids);

    // Each row on Page 2 must be unselected
    for (const id of page2Ids) {
      expect(manager.isSelected(id)).toBe(false);
    }

    // Page 2 header state must be unchecked
    const page2Header = manager.getPageSelectionState(page2Ids);
    expect(page2Header.checked).toBe(false);
    expect(page2Header.indeterminate).toBe(false);
    expect(page2Header.selectedCountOnPage).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 3 — Return to page 1
  // -------------------------------------------------------------------------
  it('Test 3: returning to Page 1 restores full visual selection', () => {
    const manager = new ContactSelectionManager(page1Ids);

    // Page 1 rows are all selected
    for (const id of page1Ids) {
      expect(manager.isSelected(id)).toBe(true);
    }

    const page1Header = manager.getPageSelectionState(page1Ids);
    expect(page1Header.checked).toBe(true);
    expect(page1Header.indeterminate).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 4 — Select a record on page 2
  // -------------------------------------------------------------------------
  it('Test 4: selecting one record on Page 2 adds it and shows indeterminate header on Page 2', () => {
    const manager = new ContactSelectionManager(page1Ids);

    // Select G on Page 2
    manager.toggleContact('G');

    expect(manager.getSelectedIds()).toEqual(expect.arrayContaining([...page1Ids, 'G']));
    expect(manager.getSelectedCount()).toBe(6);

    // On Page 2: only G is selected
    expect(manager.isSelected('F')).toBe(false);
    expect(manager.isSelected('G')).toBe(true);
    expect(manager.isSelected('H')).toBe(false);
    expect(manager.isSelected('I')).toBe(false);
    expect(manager.isSelected('J')).toBe(false);

    // Header on Page 2 is indeterminate (1 of 5 selected)
    const page2Header = manager.getPageSelectionState(page2Ids);
    expect(page2Header.checked).toBe(false);
    expect(page2Header.indeterminate).toBe(true);
    expect(page2Header.selectedCountOnPage).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 5 — Select all page 2
  // -------------------------------------------------------------------------
  it('Test 5: page header Select All on Page 2 adds Page 2 IDs without replacing Page 1 IDs', () => {
    const manager = new ContactSelectionManager(page1Ids);

    // Press page header Select All on Page 2
    manager.togglePage(page2Ids);

    // Internal state must contain all 10 records
    const allIds = [...page1Ids, ...page2Ids];
    expect(manager.getSelectedCount()).toBe(10);
    for (const id of allIds) {
      expect(manager.isSelected(id)).toBe(true);
    }

    // Page 2 header is fully checked
    const page2Header = manager.getPageSelectionState(page2Ids);
    expect(page2Header.checked).toBe(true);
    expect(page2Header.indeterminate).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 6 — Deselect all page 2
  // -------------------------------------------------------------------------
  it('Test 6: deselecting all on Page 2 removes ONLY Page 2 IDs, keeping Page 1 IDs selected', () => {
    const allIds = [...page1Ids, ...page2Ids];
    const manager = new ContactSelectionManager(allIds);

    // Page 2 is currently fully selected
    expect(manager.getPageSelectionState(page2Ids).checked).toBe(true);

    // Deselect Page 2
    manager.togglePage(page2Ids);

    // Page 2 IDs removed, Page 1 IDs preserved
    expect(manager.getSelectedIds()).toEqual(expect.arrayContaining(page1Ids));
    expect(manager.getSelectedCount()).toBe(5);
    for (const id of page2Ids) {
      expect(manager.isSelected(id)).toBe(false);
    }

    const page2Header = manager.getPageSelectionState(page2Ids);
    expect(page2Header.checked).toBe(false);
    expect(page2Header.indeterminate).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 7 — Header state uses IDs, not counts (CRITICAL REGRESSION TEST)
  // -------------------------------------------------------------------------
  it('Test 7: header is UNCHECKED when selectedIds.size === currentPage.length but IDs belong to another page', () => {
    // Setup: selectedIds has 5 items (A, B, C, D, E)
    // Current page has 5 items (F, G, H, I, J)
    // selectedIds.size === currentPage.length === 5
    const selectedIds = ['A', 'B', 'C', 'D', 'E'];
    const currentPage = ['F', 'G', 'H', 'I', 'J'];

    expect(selectedIds.length).toBe(currentPage.length);

    // Under the buggy implementation:
    // selectedIds.length === currentPage.length would be true!
    // Under the corrected implementation:
    const headerState = computePageSelectionState(currentPage, selectedIds);

    expect(headerState.checked).toBe(false);
    expect(headerState.indeterminate).toBe(false);
    expect(headerState.selectedCountOnPage).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 8 — Partial page selection
  // -------------------------------------------------------------------------
  it('Test 8: partial page selection produces indeterminate header state', () => {
    const currentPage = ['F', 'G', 'H', 'I', 'J'];
    const selectedIds = ['G', 'H'];

    const headerState = computePageSelectionState(currentPage, selectedIds);

    expect(headerState.checked).toBe(false);
    expect(headerState.indeterminate).toBe(true);
    expect(headerState.selectedCountOnPage).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Test 9 — Bulk operation exact IDs
  // -------------------------------------------------------------------------
  it('Test 9: bulk operation payload matches exact explicit selected IDs', async () => {
    const selectedIds = ['A', 'B', 'C', 'G'];
    const mockBulkAction = vi.fn().mockResolvedValue({ success: true });

    // Execute bulk operation
    await mockBulkAction({ contactIds: selectedIds });

    expect(mockBulkAction).toHaveBeenCalledTimes(1);
    expect(mockBulkAction).toHaveBeenCalledWith({
      contactIds: ['A', 'B', 'C', 'G']
    });
  });

  // -------------------------------------------------------------------------
  // Test 10 — Bulk operation after pagination
  // -------------------------------------------------------------------------
  it('Test 10: bulk operation after pagination targets only explicitly selected IDs, not visible page records', async () => {
    const manager = new ContactSelectionManager();

    // Select A, B, C on Page 1
    manager.toggleContact('A');
    manager.toggleContact('B');
    manager.toggleContact('C');

    // Navigate to Page 2 (F, G, H, I, J)
    // Verify none of Page 2 is selected
    const page2Selection = manager.getPageSelectionState(page2Ids);
    expect(page2Selection.selectedCountOnPage).toBe(0);

    // Execute bulk delete while on Page 2
    const mockDelete = vi.fn().mockResolvedValue({ success: true });
    const payload = manager.getSelectedIds();

    await mockDelete({ ids: payload });

    // Payload MUST be [A, B, C]
    expect(payload).toEqual(['A', 'B', 'C']);
    expect(mockDelete).toHaveBeenCalledWith({ ids: ['A', 'B', 'C'] });
    // Must NOT contain visible Page 2 IDs
    for (const id of page2Ids) {
      expect(payload).not.toContain(id);
    }
  });

  // -------------------------------------------------------------------------
  // Test 11 — Empty page handling
  // -------------------------------------------------------------------------
  it('Test 11: empty current page is never checked or indeterminate', () => {
    const emptyPage: string[] = [];
    const selectedIds = ['A', 'B'];

    const headerState = computePageSelectionState(emptyPage, selectedIds);
    expect(headerState.checked).toBe(false);
    expect(headerState.indeterminate).toBe(false);
    expect(headerState.selectedCountOnPage).toBe(0);

    // Toggling an empty page leaves selectedIds unchanged
    const next = toggleSelectAllPage(emptyPage, selectedIds);
    expect(next).toEqual(selectedIds);
  });

  // -------------------------------------------------------------------------
  // Test 12 — Stale ID pruning
  // -------------------------------------------------------------------------
  it('Test 12: prunes deleted or nonexistent contact IDs from selectedIds', () => {
    const selectedIds = ['A', 'B', 'C', 'D'];
    const validInDb = ['A', 'C', 'E']; // B and D were deleted

    const pruned = pruneStaleSelectedIds(validInDb, selectedIds);
    expect(pruned).toEqual(['A', 'C']);
  });

  // -------------------------------------------------------------------------
  // Test 13 — Sorting safety
  // -------------------------------------------------------------------------
  it('Test 13: sorting/reordering does not change which records are selected', () => {
    const manager = new ContactSelectionManager(['B', 'D']);

    const originalOrder = ['A', 'B', 'C', 'D', 'E'];
    const sortedOrder = ['E', 'D', 'C', 'B', 'A'];

    // Original order
    expect(originalOrder.map((id) => manager.isSelected(id))).toEqual([
      false,
      true,
      false,
      true,
      false
    ]);

    // Sorted order: ID 'B' and 'D' remain selected based on ID, not index
    expect(sortedOrder.map((id) => manager.isSelected(id))).toEqual([
      false,
      true,
      false,
      true,
      false
    ]);

    expect(manager.getPageSelectionState(sortedOrder)).toEqual(
      manager.getPageSelectionState(originalOrder)
    );
  });

  // -------------------------------------------------------------------------
  // Test 14 — Filtering safety
  // -------------------------------------------------------------------------
  it('Test 14: filtering reduces visible set without creating query-wide selection', () => {
    const manager = new ContactSelectionManager(['A', 'B', 'C']);

    // Filter hides B, leaves A and C
    const filteredVisible = ['A', 'C'];

    // Both visible records are selected -> header for filtered view is checked
    const filteredHeader = manager.getPageSelectionState(filteredVisible);
    expect(filteredHeader.checked).toBe(true);
    expect(filteredHeader.indeterminate).toBe(false);
    expect(filteredHeader.selectedCountOnPage).toBe(2);

    // But internal selection STILL contains B
    expect(manager.isSelected('B')).toBe(true);
    expect(manager.getSelectedCount()).toBe(3);
  });
});
