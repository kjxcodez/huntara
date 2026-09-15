import React from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  SlidersHorizontal,
  Check
} from 'lucide-react';
import { cn } from '../../../shared/utils/cn';

export interface FilterOption {
  label: string;
  shortLabel: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }> | undefined;
}

export interface EmailLogsFiltersProps {
  statusFilter?: string | undefined;
  onStatusChange?: ((status: string) => void) | undefined;
  directionFilter?: string | undefined;
  onDirectionChange?: ((direction: string) => void) | undefined;
  processingStatusFilter?: string | undefined;
  onProcessingStatusChange?: ((status: string) => void) | undefined;
  onResetFilters?: (() => void) | undefined;
  className?: string | undefined;
}

export const STATUS_OPTIONS: readonly FilterOption[] = [
  { label: 'All Statuses', shortLabel: 'All', value: 'all' },
  { label: 'Sent (Accepted)', shortLabel: 'Sent', value: 'SENT' },
  { label: 'Received', shortLabel: 'Received', value: 'RECEIVED' },
  { label: 'Ambiguous', shortLabel: 'Ambiguous', value: 'AMBIGUOUS' },
  { label: 'Failed', shortLabel: 'Failed', value: 'FAILED' },
  { label: 'Sending / Retrying', shortLabel: 'Sending', value: 'SENDING' },
  { label: 'Queued', shortLabel: 'Queued', value: 'QUEUED' }
];

export const DIRECTION_OPTIONS: readonly FilterOption[] = [
  { label: 'All Directions', shortLabel: 'All', value: 'all' },
  { label: 'Outbound', shortLabel: 'Outbound', value: 'OUTBOUND', icon: ArrowUpRight },
  { label: 'Inbound Replies', shortLabel: 'Inbound', value: 'INBOUND', icon: ArrowDownLeft }
];

export const RECONCILIATION_OPTIONS: readonly FilterOption[] = [
  { label: 'All Reconciliation', shortLabel: 'All', value: 'all' },
  { label: 'Awaiting Correlation', shortLabel: 'Awaiting', value: 'CORRELATION_PENDING' },
  { label: 'Matched', shortLabel: 'Matched', value: 'MATCHED' },
  { label: 'Unmatched', shortLabel: 'Unmatched', value: 'UNMATCHED' }
];

export const EmailLogsFilters: React.FC<EmailLogsFiltersProps> = ({
  statusFilter = 'all',
  onStatusChange,
  directionFilter = 'all',
  onDirectionChange,
  processingStatusFilter = 'all',
  onProcessingStatusChange,
  onResetFilters,
  className = ''
}) => {
  // Compute active filters count
  const activeCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (directionFilter !== 'all' ? 1 : 0) +
    (processingStatusFilter !== 'all' ? 1 : 0);

  const hasActiveFilters = activeCount > 0;

  const showReconciliation = directionFilter === 'INBOUND' || processingStatusFilter !== 'all';

  return (
    <div
      data-testid="email-logs-filters"
      className={cn('flex flex-col gap-2 p-2.5 bg-card/40 border-b border-border/70 text-xs select-none', className)}
    >
      {/* Section Header: Filter Group Label + Active Summary + Reset Action */}
      <div className="flex items-center justify-between min-w-0">
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Filters
          </span>
          {hasActiveFilters && (
            <span
              data-testid="active-filter-badge"
              className="text-[9px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-none"
            >
              {`${activeCount} active`}
            </span>
          )}
        </div>

        {hasActiveFilters && onResetFilters && (
          <button
            type="button"
            data-testid="reset-filters-btn"
            onClick={onResetFilters}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer transition-colors"
            title="Reset all filters to default"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset filters</span>
          </button>
        )}
      </div>

      {/* 1. Direction Filter Group */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Direction
        </span>
        <div
          data-testid="direction-filter-group"
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Filter by email direction"
        >
          {DIRECTION_OPTIONS.map((opt) => {
            const isSelected = directionFilter === opt.value;
            const Icon = opt.icon;

            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`direction-pill-${opt.value}`}
                aria-pressed={isSelected}
                onClick={() => onDirectionChange?.(opt.value)}
                className={cn(
                  'h-6 px-2 text-[11px] font-medium transition-colors cursor-pointer rounded-none border flex items-center gap-1 whitespace-nowrap',
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary font-semibold shadow-xs'
                    : 'bg-card border-border-subtle text-muted-foreground hover:bg-surface-3 hover:text-foreground'
                )}
                title={opt.label}
              >
                {Icon && <Icon className="w-3 h-3 shrink-0" />}
                <span>{opt.label}</span>
                {isSelected && opt.value !== 'all' && <Check className="w-2.5 h-2.5 shrink-0 ml-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Status Filter Group */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Status
        </span>
        <div
          data-testid="status-filter-group"
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Filter by delivery status"
        >
          {STATUS_OPTIONS.map((opt) => {
            const isSelected = statusFilter === opt.value;

            // Highlight specific statuses with semantic tones when active
            let activeColorClass = 'bg-primary text-primary-foreground border-primary font-semibold';
            if (isSelected) {
              if (opt.value === 'FAILED') activeColorClass = 'bg-rose-600 text-white border-rose-600 font-semibold';
              else if (opt.value === 'AMBIGUOUS') activeColorClass = 'bg-amber-500 text-black border-amber-500 font-bold';
              else if (opt.value === 'SENT') activeColorClass = 'bg-emerald-600 text-white border-emerald-600 font-semibold';
              else if (opt.value === 'RECEIVED') activeColorClass = 'bg-sky-600 text-white border-sky-600 font-semibold';
            }

            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`status-pill-${opt.value}`}
                aria-pressed={isSelected}
                onClick={() => onStatusChange?.(opt.value)}
                className={cn(
                  'h-6 px-2 text-[11px] font-medium transition-colors cursor-pointer rounded-none border flex items-center gap-1 whitespace-nowrap',
                  isSelected
                    ? `${activeColorClass} shadow-xs`
                    : 'bg-card border-border-subtle text-muted-foreground hover:bg-surface-3 hover:text-foreground'
                )}
                title={opt.label}
              >
                <span>{opt.label}</span>
                {isSelected && opt.value !== 'all' && <Check className="w-2.5 h-2.5 shrink-0 ml-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Inbound Reconciliation Group (visible when Inbound or active) */}
      {showReconciliation && (
        <div className="flex flex-col gap-1 pt-1 border-t border-border/40">
          <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">
            Inbound Reconciliation
          </span>
          <div
            data-testid="reconciliation-filter-group"
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Filter by inbound reply reconciliation status"
          >
            {RECONCILIATION_OPTIONS.map((opt) => {
              const isSelected = processingStatusFilter === opt.value;

              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={`reconciliation-pill-${opt.value}`}
                  aria-pressed={isSelected}
                  onClick={() => onProcessingStatusChange?.(opt.value)}
                  className={cn(
                    'h-6 px-2 text-[11px] font-medium transition-colors cursor-pointer rounded-none border flex items-center gap-1 whitespace-nowrap',
                    isSelected
                      ? 'bg-cyan-600 text-white border-cyan-600 font-semibold shadow-xs'
                      : 'bg-card border-border-subtle text-muted-foreground hover:bg-surface-3 hover:text-foreground'
                  )}
                  title={opt.label}
                >
                  <span>{opt.label}</span>
                  {isSelected && opt.value !== 'all' && <Check className="w-2.5 h-2.5 shrink-0 ml-0.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailLogsFilters;
