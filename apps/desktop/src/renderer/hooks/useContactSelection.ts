import { useState, useCallback, useMemo } from 'react';
import {
  computePageSelectionState,
  toggleSelectAllPage,
  toggleSelectContact,
  pruneStaleSelectedIds,
  type PageSelectionState
} from '../utils/contact-selection';

export function useContactSelection(initialSelectedIds: string[] = []) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const isSelected = useCallback(
    (id: string) => selectedSet.has(id),
    [selectedSet]
  );

  const toggleContact = useCallback((id: string) => {
    setSelectedIds((prev) => toggleSelectContact(id, prev));
  }, []);

  const togglePageSelection = useCallback((currentPageIds: string[]) => {
    setSelectedIds((prev) => toggleSelectAllPage(currentPageIds, prev));
  }, []);

  const getPageSelectionState = useCallback(
    (currentPageIds: string[]): PageSelectionState => {
      return computePageSelectionState(currentPageIds, selectedSet);
    },
    [selectedSet]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const pruneStaleIds = useCallback((validIds: string[]) => {
    setSelectedIds((prev) => {
      const pruned = pruneStaleSelectedIds(validIds, prev);
      return pruned.length === prev.length ? prev : pruned;
    });
  }, []);

  return {
    selectedIds,
    selectedCount: selectedIds.length,
    setSelectedIds,
    isSelected,
    toggleContact,
    togglePageSelection,
    getPageSelectionState,
    clearSelection,
    pruneStaleIds
  };
}
