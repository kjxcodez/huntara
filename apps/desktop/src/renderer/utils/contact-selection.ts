import type { CanonicalContactQuery, BulkContactSelection } from '@huntara/schema';

export type { CanonicalContactQuery, BulkContactSelection };

/**
 * Selection modes supported by the contact selection system:
 * - 'explicit': Selected contact IDs are individually tracked in an explicit list.
 * - 'all-matching': Selection represents all records matching an immutable query snapshot,
 *   with any deselected records tracked as exclusions.
 */
export type SelectionMode = 'explicit' | 'all-matching';

export interface PageSelectionState {
  checked: boolean;
  indeterminate: boolean;
  selectedCountOnPage: number;
}

/**
 * Computes whether the current page is fully selected, partially selected, or empty in explicit mode.
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
 * Computes whether the current page is fully selected, partially selected, or empty in all-matching mode.
 * In all-matching mode, every contact is selected unless its ID is present in excludedIds.
 */
export function computeAllMatchingPageSelectionState(
  currentPageIds: string[],
  excludedIds: Iterable<string>
): PageSelectionState {
  if (currentPageIds.length === 0) {
    return { checked: false, indeterminate: false, selectedCountOnPage: 0 };
  }

  const excludedSet = excludedIds instanceof Set ? excludedIds : new Set(excludedIds);
  let selectedCountOnPage = 0;

  for (const id of currentPageIds) {
    if (!excludedSet.has(id)) {
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
 * Toggles selection for an entire page of contact IDs in explicit mode:
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
 * Toggles selection for an entire page in all-matching mode:
 * - If current page is fully selected (none excluded on this page): adds all page IDs to `excludedIds`.
 * - If current page is partially or wholly excluded: removes all page IDs from `excludedIds`.
 */
export function toggleAllMatchingPage(
  currentPageIds: string[],
  excludedIds: string[]
): string[] {
  if (currentPageIds.length === 0) {
    return [...excludedIds];
  }

  const excludedSet = new Set(excludedIds);
  const isFullySelected = currentPageIds.every((id) => !excludedSet.has(id));

  if (isFullySelected) {
    for (const id of currentPageIds) {
      excludedSet.add(id);
    }
  } else {
    for (const id of currentPageIds) {
      excludedSet.delete(id);
    }
  }

  return Array.from(excludedSet);
}

/**
 * Toggles a single contact's selection status by ID in explicit mode.
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
 * Toggles a single contact's selection status in all-matching mode:
 * - If contact was selected (not in excludedIds): adds it to `excludedIds`.
 * - If contact was excluded (in excludedIds): removes it from `excludedIds`.
 */
export function toggleAllMatchingContact(
  contactId: string,
  excludedIds: string[]
): string[] {
  const excludedSet = new Set(excludedIds);
  if (excludedSet.has(contactId)) {
    excludedSet.delete(contactId);
  } else {
    excludedSet.add(contactId);
  }
  return Array.from(excludedSet);
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
 * Evaluates whether a contact record matches a CanonicalContactQuery filter in-memory.
 */
export function matchesCanonicalQuery(
  contact: any,
  query: CanonicalContactQuery,
  discoveryRunCompanyIds?: Set<string>
): boolean {
  if (!contact) return false;

  if (query.search) {
    const searchLower = query.search.toLowerCase();
    const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.toLowerCase();
    const email = (contact.email || '').toLowerCase();
    const title = (contact.title || '').toLowerCase();
    const companyName = (contact.companyName || '').toLowerCase();
    const companyDomain = (contact.companyDomain || '').toLowerCase();

    const matchesSearch =
      fullName.includes(searchLower) ||
      email.includes(searchLower) ||
      title.includes(searchLower) ||
      companyName.includes(searchLower) ||
      companyDomain.includes(searchLower);

    if (!matchesSearch) return false;
  }

  if (query.status) {
    if (!contact.status || String(contact.status).toUpperCase() !== query.status.toUpperCase()) {
      return false;
    }
  }

  if (query.companyId) {
    if (contact.companyId !== query.companyId) {
      return false;
    }
  }

  if (query.title) {
    if (!contact.title || !contact.title.toLowerCase().includes(query.title.toLowerCase())) {
      return false;
    }
  }

  if (query.source) {
    if (!contact.source || contact.source.toLowerCase() !== query.source.toLowerCase()) {
      return false;
    }
  }

  if (query.discoveryRunId) {
    if (discoveryRunCompanyIds) {
      if (!contact.companyId || !discoveryRunCompanyIds.has(contact.companyId)) {
        return false;
      }
    } else if (contact.discoveryRunId !== query.discoveryRunId) {
      return false;
    }
  }

  if (query.city) {
    const city = (contact.companyCity || contact.city || '').toLowerCase();
    if (!city.includes(query.city.toLowerCase())) {
      return false;
    }
  }

  if (query.state) {
    const state = (contact.companyState || contact.state || '').toLowerCase();
    if (!state.includes(query.state.toLowerCase())) {
      return false;
    }
  }

  if (query.country) {
    const country = (contact.companyCountry || contact.country || '').toLowerCase();
    if (!country.includes(query.country.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if two canonical queries are structurally identical (ignoring undefined/empty string differences).
 */
export function areQueriesEqual(
  q1: CanonicalContactQuery | null | undefined,
  q2: CanonicalContactQuery | null | undefined
): boolean {
  if (!q1 && !q2) return true;
  if (!q1 || !q2) return false;
  const normalize = (v: any) =>
    v === undefined || v === null || v === '' ? undefined : String(v).trim().toLowerCase();
  const keys: (keyof CanonicalContactQuery)[] = [
    'search',
    'status',
    'companyId',
    'title',
    'source',
    'discoveryRunId',
    'city',
    'state',
    'country'
  ];
  for (const k of keys) {
    if (normalize(q1[k]) !== normalize(q2[k])) {
      return false;
    }
  }
  return true;
}

/**
 * Stateful manager encapsulating contact selection set transitions.
 * Supports dual modes: explicit ID list and all-matching query snapshot with exclusions.
 */
export class ContactSelectionManager {
  private mode: SelectionMode = 'explicit';
  private selectedIds: Set<string>;
  private excludedIds: Set<string> = new Set();
  private capturedQuery: CanonicalContactQuery | null = null;
  private matchedCount: number = 0;

  constructor(initialIds: string[] = []) {
    this.selectedIds = new Set(initialIds);
  }

  getMode(): SelectionMode {
    return this.mode;
  }

  isAllMatching(): boolean {
    return this.mode === 'all-matching';
  }

  getSelectedIds(): string[] {
    return Array.from(this.selectedIds);
  }

  getExcludedIds(): string[] {
    return Array.from(this.excludedIds);
  }

  getCapturedQuery(): CanonicalContactQuery | null {
    return this.capturedQuery ? { ...this.capturedQuery } : null;
  }

  getMatchedCount(): number {
    return this.matchedCount;
  }

  getEffectiveCount(): number {
    if (this.mode === 'all-matching') {
      return Math.max(0, this.matchedCount - this.excludedIds.size);
    }
    return this.selectedIds.size;
  }

  getSelectedCount(): number {
    return this.getEffectiveCount();
  }

  selectAllMatching(query: CanonicalContactQuery, totalMatchedCount: number): void {
    this.mode = 'all-matching';
    this.capturedQuery = { ...query };
    this.matchedCount = totalMatchedCount;
    this.excludedIds.clear();
    this.selectedIds.clear();
  }

  switchToExplicit(ids: string[] = []): void {
    this.mode = 'explicit';
    this.capturedQuery = null;
    this.matchedCount = 0;
    this.excludedIds.clear();
    this.selectedIds = new Set(ids);
  }

  isSelected(id: string): boolean {
    if (this.mode === 'all-matching') {
      return !this.excludedIds.has(id);
    }
    return this.selectedIds.has(id);
  }

  toggleContact(id: string): void {
    if (this.mode === 'all-matching') {
      if (this.excludedIds.has(id)) {
        this.excludedIds.delete(id);
      } else {
        this.excludedIds.add(id);
      }
    } else {
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
      } else {
        this.selectedIds.add(id);
      }
    }
  }

  togglePage(currentPageIds: string[]): void {
    if (currentPageIds.length === 0) return;

    if (this.mode === 'all-matching') {
      const isFullySelected = currentPageIds.every((id) => !this.excludedIds.has(id));
      if (isFullySelected) {
        for (const id of currentPageIds) {
          this.excludedIds.add(id);
        }
      } else {
        for (const id of currentPageIds) {
          this.excludedIds.delete(id);
        }
      }
    } else {
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
    }
  }

  getPageSelectionState(currentPageIds: string[]): PageSelectionState {
    if (this.mode === 'all-matching') {
      return computeAllMatchingPageSelectionState(currentPageIds, this.excludedIds);
    }
    return computePageSelectionState(currentPageIds, this.selectedIds);
  }

  getBulkSelection(): BulkContactSelection {
    if (this.mode === 'all-matching' && this.capturedQuery) {
      return {
        mode: 'all-matching',
        query: { ...this.capturedQuery },
        excludedIds: Array.from(this.excludedIds)
      };
    }
    return {
      mode: 'explicit',
      selectedIds: Array.from(this.selectedIds)
    };
  }

  clear(): void {
    this.mode = 'explicit';
    this.selectedIds.clear();
    this.excludedIds.clear();
    this.capturedQuery = null;
    this.matchedCount = 0;
  }

  prune(validIds: string[]): string[] {
    const validSet = new Set(validIds);
    if (this.mode === 'all-matching') {
      for (const id of Array.from(this.excludedIds)) {
        if (!validSet.has(id)) {
          this.excludedIds.delete(id);
        }
      }
      return Array.from(this.excludedIds);
    } else {
      for (const id of Array.from(this.selectedIds)) {
        if (!validSet.has(id)) {
          this.selectedIds.delete(id);
        }
      }
      return Array.from(this.selectedIds);
    }
  }
}
