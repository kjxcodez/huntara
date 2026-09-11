/**
 * Utility functions and data structures for ID-safe contact selection.
 *
 * Enforces explicit ID-based selection semantics across paginated tables:
 * - Current-page selection state is derived strictly from `currentPageIds` vs `selectedIds`.
 * - Selected IDs persist across pagination changes.
 * - Header checkbox select-all adds current-page IDs without clearing other pages.
 * - Header checkbox deselect-all removes ONLY current-page IDs without clearing other pages.
 * - Header indeterminate state reflects partial selection of the current page.
 */

export interface PageSelectionState {
  checked: boolean;
  indeterminate: boolean;
  selectedCountOnPage: number;
}

/**
 * Computes whether the current page is fully selected, partially selected, or empty.
 * Never relies on global selected count or page size.
 */
export function computePageSelectionState(
  currentPageIds: string[],
  selectedIds: Iterable<string>
): PageSelectionState {
  if (currentPageIds.length === 0) {
    return { checked: false, indeterminate: false, selectedCountOnPage: 0 };
  }

  const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  let selectedCountOnPage = 0;

  for (const id of currentPageIds) {
    if (selectedSet.has(id)) {
      selectedCountOnPage++;
    }
  }

  const checked = selectedCountOnPage === currentPageIds.length;
  const indeterminate = selectedCountOnPage > 0 && !checked;

  return {
    checked,
    indeterminate,
    selectedCountOnPage
  };
}

/**
 * Toggles selection for an entire page of contact IDs:
 * - If current page is fully selected: removes ONLY current page IDs from `selectedIds`.
 * - If current page is partially or not selected: adds all current page IDs to `selectedIds`.
 *
 * Selections from other pages are strictly preserved in both cases.
 */
export function toggleSelectAllPage(
  currentPageIds: string[],
  selectedIds: string[]
): string[] {
  if (currentPageIds.length === 0) {
    return [...selectedIds];
  }

  const selectedSet = new Set(selectedIds);
  const isFullySelected = currentPageIds.every((id) => selectedSet.has(id));

  if (isFullySelected) {
    const pageIdSet = new Set(currentPageIds);
    return selectedIds.filter((id) => !pageIdSet.has(id));
  } else {
    for (const id of currentPageIds) {
      selectedSet.add(id);
    }
    return Array.from(selectedSet);
  }
}

/**
 * Toggles a single contact's selection status by ID.
 */
export function toggleSelectContact(
  contactId: string,
  selectedIds: string[]
): string[] {
  const selectedSet = new Set(selectedIds);
  if (selectedSet.has(contactId)) {
    selectedSet.delete(contactId);
  } else {
    selectedSet.add(contactId);
  }
  return Array.from(selectedSet);
}

/**
 * Prunes selected IDs that no longer exist in the provided list of valid IDs
 * (e.g. after remote sync, deletion, or external mutation).
 */
export function pruneStaleSelectedIds(
  validContactIds: string[],
  selectedIds: string[]
): string[] {
  const validSet = new Set(validContactIds);
  return selectedIds.filter((id) => validSet.has(id));
}

/**
 * Stateful manager encapsulating contact selection set transitions.
 * Useful for deterministic testing, state simulation, and headless pipelines.
 */
export class ContactSelectionManager {
  private selectedIds: Set<string>;

  constructor(initialIds: string[] = []) {
    this.selectedIds = new Set(initialIds);
  }

  getSelectedIds(): string[] {
    return Array.from(this.selectedIds);
  }

  getSelectedCount(): number {
    return this.selectedIds.size;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  toggleContact(id: string): string[] {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    return this.getSelectedIds();
  }

  togglePage(currentPageIds: string[]): string[] {
    if (currentPageIds.length === 0) return this.getSelectedIds();

    const isFullySelected = currentPageIds.every((id) => this.selectedIds.has(id));
    if (isFullySelected) {
      for (const id of currentPageIds) {
        this.selectedIds.delete(id);
      }
    } else {
      for (const id of currentPageIds) {
        this.selectedIds.add(id);
      }
    }
    return this.getSelectedIds();
  }

  getPageSelectionState(currentPageIds: string[]): PageSelectionState {
    return computePageSelectionState(currentPageIds, this.selectedIds);
  }

  clear(): void {
    this.selectedIds.clear();
  }

  prune(validIds: string[]): string[] {
    const validSet = new Set(validIds);
    for (const id of Array.from(this.selectedIds)) {
      if (!validSet.has(id)) {
        this.selectedIds.delete(id);
      }
    }
    return this.getSelectedIds();
  }
}
