import React, { useState, useEffect } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Search, Filter, Plus, Trash2, Tag, Archive, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

interface EntityToolbarProps {
  search: string;
  onSearchChange: (val: string) => void;
  filterStatus?: string;
  onStatusChange?: (val: string) => void;
  statusOptions?: string[];
  createLabel: string;
  onCreateTrigger: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  selectedCount?: number;
  onBulkDelete?: () => void;
  onBulkArchive?: () => void;
  onBulkAddTag?: () => void;
  onBulkStatusChange?: (status: string) => void;
  bulkStatusOptions?: string[];
  onBulkEnroll?: () => void;
  onBulkCreateAudience?: () => void;
  activeFilters?: Array<{ label: string; value: string; onRemove: () => void }>;
  onClearAllFilters?: () => void;
}

/**
 * EntityToolbar renders a unified debounced search, collapsible filtering, and bulk actions toolbar
 * aligned strictly with the HUNTARA design system.
 */
export function EntityToolbar({
  search,
  onSearchChange,
  filterStatus,
  onStatusChange,
  statusOptions = [],
  createLabel,
  onCreateTrigger,
  onRefresh,
  isRefreshing = false,
  selectedCount = 0,
  onBulkDelete,
  onBulkArchive,
  onBulkAddTag,
  onBulkStatusChange,
  bulkStatusOptions = [],
  onBulkEnroll,
  onBulkSaveAudience,
  onBulkCreateAudience,
  activeFilters = [],
  onClearAllFilters,
  children
}: EntityToolbarProps & { onBulkSaveAudience?: () => void; children?: React.ReactNode }) {
  const [localSearch, setLocalSearch] = useState(search);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Synchronize local search if external search changes
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      onSearchChange(localSearch);
    }, 300);

    return () => clearTimeout(handler);
  }, [localSearch, onSearchChange]);

  const handleCreateAudience = onBulkCreateAudience || onBulkSaveAudience;
  const hasExtraFilters = !!children || (onStatusChange && statusOptions.length > 0);

  return (
    <div className="flex flex-col gap-2.5 pb-1 select-none">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground opacity-60" />
            <Input
              placeholder="Search by keyword..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="pl-8 text-xs h-8 bg-card border-border-subtle rounded-none text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {hasExtraFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFiltersOpen((prev) => !prev)}
              className={`h-8 text-xs font-semibold gap-1.5 rounded-none border-border-subtle ${
                filtersOpen || activeFilters.length > 0
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'bg-card text-foreground hover:bg-surface-3'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filters</span>
              {activeFilters.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 bg-primary text-primary-foreground rounded-none text-[10px] font-mono font-bold">
                  {activeFilters.length}
                </span>
              )}
              {filtersOpen ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-8 text-xs font-semibold gap-1.5 rounded-none border-border-subtle bg-card text-foreground hover:bg-surface-3"
              title="Refresh data from server"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </Button>
          )}

          <Button
            onClick={onCreateTrigger}
            size="sm"
            className="h-8 text-xs font-semibold gap-1.5 rounded-none bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-3.5 h-3.5" />
            {createLabel}
          </Button>
        </div>
      </div>

      {/* Collapsible Structured Filters Bar */}
      {filtersOpen && hasExtraFilters && (
        <div className="p-3 bg-card border border-border-subtle rounded-none flex flex-wrap items-center gap-2.5 animate-in slide-in-from-top-1 duration-150">
          {onStatusChange && statusOptions.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
              <select
                value={filterStatus || ''}
                onChange={(e) => onStatusChange(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[120px]"
              >
                <option value="">All Statuses</option>
                {statusOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          )}

          {children}
        </div>
      )}

      {/* Active Filter Chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mr-1 font-mono">
            Active:
          </span>
          {activeFilters.map((chip, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none text-[11px] font-medium bg-surface-3 text-foreground border border-border-subtle"
            >
              <span className="text-muted-foreground">{chip.label}:</span>
              <span className="font-semibold">{chip.value}</span>
              <button
                onClick={chip.onRemove}
                className="ml-1 text-muted-foreground hover:text-danger transition-colors font-bold"
                title="Remove filter"
              >
                ×
              </button>
            </span>
          ))}
          {onClearAllFilters && (
            <button
              onClick={onClearAllFilters}
              className="text-[11px] text-muted-foreground hover:text-foreground underline ml-1.5 transition-colors font-mono"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Bulk actions banner */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between p-2.5 bg-surface-3 border border-border-subtle rounded-none text-xs animate-in slide-in-from-top-1 duration-150 gap-2">
          <span className="font-bold text-foreground font-mono">{selectedCount} items selected</span>

          <div className="flex items-center gap-2">
            {onBulkStatusChange && bulkStatusOptions.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    onBulkStatusChange(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="bg-card border border-border-subtle rounded-none px-2 py-1 text-[11px] outline-none text-foreground focus:ring-1 focus:ring-ring h-7"
              >
                <option value="">Update Status...</option>
                {bulkStatusOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {handleCreateAudience && (
              <Button
                variant="default"
                size="sm"
                onClick={handleCreateAudience}
                className="h-7 text-[11px] gap-1 rounded-none bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Audience
              </Button>
            )}

            {onBulkEnroll && (
              <Button
                variant="outline"
                size="sm"
                onClick={onBulkEnroll}
                className="h-7 text-[11px] gap-1 rounded-none border-border-subtle text-foreground hover:bg-surface-3"
              >
                <Plus className="w-3.5 h-3.5" />
                Enroll in Campaign
              </Button>
            )}

            {onBulkAddTag && (
              <Button
                variant="outline"
                size="sm"
                onClick={onBulkAddTag}
                className="h-7 text-[11px] gap-1 rounded-none border-border-subtle text-foreground hover:bg-surface-3"
              >
                <Tag className="w-3.5 h-3.5 text-primary" />
                Add Tag
              </Button>
            )}

            {onBulkArchive && (
              <Button
                variant="outline"
                size="sm"
                onClick={onBulkArchive}
                className="h-7 text-[11px] gap-1 rounded-none border-border-subtle text-warning hover:bg-warning-muted/20"
              >
                <Archive className="w-3.5 h-3.5" />
                Archive
              </Button>
            )}

            {onBulkDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={onBulkDelete}
                className="h-7 text-[11px] gap-1 rounded-none border-border-subtle text-danger hover:bg-danger-muted/20"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
