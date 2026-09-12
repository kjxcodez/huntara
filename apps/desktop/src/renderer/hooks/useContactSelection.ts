import { useState, useCallback, useMemo } from 'react';
import {
  computePageSelectionState,
  computeAllMatchingPageSelectionState,
  toggleSelectAllPage,
  toggleAllMatchingPage,
  toggleSelectContact,
  toggleAllMatchingContact,
  pruneStaleSelectedIds,
  type PageSelectionState,
  type SelectionMode,
  type CanonicalContactQuery,
  type BulkContactSelection
} from '../utils/contact-selection';

export interface UseContactSelectionReturn {
  mode: SelectionMode;
  isAllMatching: boolean;
  selectedIds: string[];
  excludedIds: string[];
  capturedQuery: CanonicalContactQuery | null;
  matchedCount: number;
  selectedCount: number;
  effectiveSelectedCount: number;
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  isSelected: (id: string) => boolean;
  toggleContact: (id: string) => void;
  togglePageSelection: (currentPageIds: string[]) => void;
  getPageSelectionState: (currentPageIds: string[]) => PageSelectionState;
  selectAllMatching: (query: CanonicalContactQuery, totalMatchedCount: number) => void;
  clearSelection: () => void;
  pruneStaleIds: (validIds: string[]) => void;
  getBulkSelectionPayload: () => BulkContactSelection;
}

export function useContactSelection(initialSelectedIds: string[] = []): UseContactSelectionReturn {
  const [mode, setMode] = useState<SelectionMode>('explicit');
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [capturedQuery, setCapturedQuery] = useState<CanonicalContactQuery | null>(null);
  const [matchedCount, setMatchedCount] = useState<number>(0);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds]);

  const isAllMatching = mode === 'all-matching';

  const effectiveSelectedCount = useMemo(() => {
    if (isAllMatching) {
      return Math.max(0, matchedCount - excludedIds.length);
    }
    return selectedIds.length;
  }, [isAllMatching, matchedCount, excludedIds.length, selectedIds.length]);

  const isSelected = useCallback(
    (id: string) => {
      if (mode === 'all-matching') {
        return !excludedSet.has(id);
      }
      return selectedSet.has(id);
    },
    [mode, excludedSet, selectedSet]
  );

  const toggleContact = useCallback(
    (id: string) => {
      if (mode === 'all-matching') {
        setExcludedIds((prev) => toggleAllMatchingContact(id, prev));
      } else {
        setSelectedIds((prev) => toggleSelectContact(id, prev));
      }
    },
    [mode]
  );

  const togglePageSelection = useCallback(
    (currentPageIds: string[]) => {
      if (mode === 'all-matching') {
        setExcludedIds((prev) => toggleAllMatchingPage(currentPageIds, prev));
      } else {
        setSelectedIds((prev) => toggleSelectAllPage(currentPageIds, prev));
      }
    },
    [mode]
  );

  const getPageSelectionState = useCallback(
    (currentPageIds: string[]): PageSelectionState => {
      if (mode === 'all-matching') {
        return computeAllMatchingPageSelectionState(currentPageIds, excludedSet);
      }
      return computePageSelectionState(currentPageIds, selectedSet);
    },
    [mode, excludedSet, selectedSet]
  );

  const selectAllMatching = useCallback(
    (query: CanonicalContactQuery, totalMatchedCount: number) => {
      setMode('all-matching');
      setCapturedQuery({ ...query });
      setMatchedCount(totalMatchedCount);
      setExcludedIds([]);
      setSelectedIds([]);
    },
    []
  );

  const clearSelection = useCallback(() => {
    setMode('explicit');
    setSelectedIds([]);
    setExcludedIds([]);
    setCapturedQuery(null);
    setMatchedCount(0);
  }, []);

  const pruneStaleIds = useCallback(
    (validIds: string[]) => {
      if (mode === 'all-matching') {
        setExcludedIds((prev) => {
          const pruned = pruneStaleSelectedIds(validIds, prev);
          return pruned.length === prev.length ? prev : pruned;
        });
      } else {
        setSelectedIds((prev) => {
          const pruned = pruneStaleSelectedIds(validIds, prev);
          return pruned.length === prev.length ? prev : pruned;
        });
      }
    },
    [mode]
  );

  const getBulkSelectionPayload = useCallback((): BulkContactSelection => {
    if (mode === 'all-matching' && capturedQuery) {
      return {
        mode: 'all-matching',
        query: { ...capturedQuery },
        excludedIds: [...excludedIds]
      };
    }
    return {
      mode: 'explicit',
      selectedIds: [...selectedIds]
    };
  }, [mode, capturedQuery, excludedIds, selectedIds]);

  return {
    mode,
    isAllMatching,
    selectedIds,
    excludedIds,
    capturedQuery,
    matchedCount,
    selectedCount: effectiveSelectedCount,
    effectiveSelectedCount,
    setSelectedIds,
    isSelected,
    toggleContact,
    togglePageSelection,
    getPageSelectionState,
    selectAllMatching,
    clearSelection,
    pruneStaleIds,
    getBulkSelectionPayload
  };
}
