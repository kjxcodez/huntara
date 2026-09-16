import React from 'react';
import {
  Search,
  RefreshCw,
  Inbox,
  Filter,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle
} from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import { EmailStatusBadge, EngagementPills, DirectionBadge, InboundReconciliationBadge } from './EmailStatusBadge';
import { EmailLogsFilters } from './EmailLogsFilters';

export interface EmailLogsListProps {
  deliveries: any[];
  selectedDeliveryId?: string | null | undefined;
  onSelectDelivery: (delivery: any) => void;
  isLoading?: boolean | undefined;
  page?: number | undefined;
  totalPages?: number | undefined;
  totalItems?: number | undefined;
  onPageChange?: ((page: number) => void) | undefined;
  searchQuery?: string | undefined;
  onSearchChange?: ((query: string) => void) | undefined;
  statusFilter?: string | undefined;
  onStatusChange?: ((status: string) => void) | undefined;
  directionFilter?: string | undefined;
  onDirectionChange?: ((direction: string) => void) | undefined;
  processingStatusFilter?: string | undefined;
  onProcessingStatusChange?: ((status: string) => void) | undefined;
  onResetFilters?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onPollReplies?: (() => void) | undefined;
  isPollingReplies?: boolean | undefined;
  className?: string | undefined;
}

export const EmailLogsList: React.FC<EmailLogsListProps> = ({
  deliveries = [],
  selectedDeliveryId,
  onSelectDelivery,
  isLoading = false,
  page = 1,
  totalPages = 1,
  totalItems = 0,
  onPageChange,
  searchQuery = '',
  onSearchChange,
  statusFilter = 'all',
  onStatusChange,
  directionFilter = 'all',
  onDirectionChange,
  processingStatusFilter = 'all',
  onProcessingStatusChange,
  onResetFilters,
  onRefresh,
  onPollReplies,
  isPollingReplies = false,
  className = ''
}) => {
  return (
    <div className={`flex flex-col h-full min-h-0 min-w-0 bg-background border-r border-border/70 overflow-hidden ${className}`}>
      {/* Top Filter & Action Bar */}
      <div className="p-3 border-b border-border/70 space-y-2 bg-card/40 shrink-0">
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search subject, recipient, sender..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearchChange && onSearchChange(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs bg-background/80"
            />
          </div>

          {/* Refresh Button */}
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 shrink-0"
              onClick={onRefresh}
              title="Refresh logs"
              disabled={isLoading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}

          {/* Inbound Poll Button */}
          {onPollReplies && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs shrink-0 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
              onClick={onPollReplies}
              disabled={isPollingReplies}
              title="Poll connected Gmail accounts for inbound contact replies"
            >
              <Inbox className={`w-3.5 h-3.5 mr-1.5 ${isPollingReplies ? 'animate-spin' : ''}`} />
              {isPollingReplies ? 'Checking...' : 'Check Replies'}
            </Button>
          )}
        </div>

        {/* Responsive, Grouped Filter Section */}
        <EmailLogsFilters
          statusFilter={statusFilter}
          onStatusChange={onStatusChange}
          directionFilter={directionFilter}
          onDirectionChange={onDirectionChange}
          processingStatusFilter={processingStatusFilter}
          onProcessingStatusChange={onProcessingStatusChange}
          onResetFilters={onResetFilters}
          className="p-0 border-0 bg-transparent pt-1"
        />
      </div>

      {/* Deliveries Count and Quick Summary */}
      <div className="px-3 py-1.5 bg-muted/20 border-b border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Showing {deliveries.length} {totalItems ? `of ${totalItems}` : ''} messages
        </span>
        {deliveries.some((d) => d.status === 'AMBIGUOUS') && (
          <span className="flex items-center gap-1 text-amber-400 font-medium">
            <AlertTriangle className="w-3 h-3" />
            Ambiguous sends require reconciliation
          </span>
        )}
      </div>

      {/* Email Items List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/40">
        {isLoading ? (
          <div className="p-3 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="p-2.5 rounded border border-border/40 space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3.5 w-3/4" />
                <div className="flex gap-2">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : deliveries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center h-full space-y-2">
            <Inbox className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No email records found</p>
            <p className="text-xs text-muted-foreground/80 max-w-xs">
              No messages match your active filter criteria. Try adjusting your filters or send a campaign.
            </p>
          </div>
        ) : (
          deliveries.map((delivery) => {
            const isSelected = selectedDeliveryId === delivery.id;
            const isInbound = delivery.direction === 'INBOUND';
            const displayAddress = isInbound ? delivery.senderEmail : delivery.recipientEmail;
            const displayName = delivery.firstName || delivery.lastName
              ? `${delivery.firstName || ''} ${delivery.lastName || ''}`.trim()
              : delivery.companyName || displayAddress;
            const timestamp = delivery.sentAt || delivery.createdAt;

            return (
              <div
                key={delivery.id}
                onClick={() => onSelectDelivery(delivery)}
                className={`p-3 cursor-pointer transition-colors text-left relative hover:bg-muted/40 ${
                  isSelected ? 'bg-muted/80 border-l-4 border-l-primary' : ''
                }`}
              >
                {/* Header: Address / Name + Date */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    {isInbound ? (
                      <ArrowDownLeft className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    ) : (
                      <ArrowUpRight className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                    <span className="font-semibold text-xs text-foreground truncate">
                      {displayName}
                    </span>
                    {displayName !== displayAddress && (
                      <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                        &lt;{displayAddress}&gt;
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[11px] text-muted-foreground/90 shrink-0 font-mono"
                    title={timestamp ? `UTC: ${new Date(timestamp).toISOString()}` : ''}
                  >
                    {timestamp ? new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>

                {/* Subject Line */}
                <p className="text-xs font-medium text-foreground/90 truncate mt-1 min-w-0">
                  {delivery.subject || '(No Subject)'}
                </p>

                {/* Campaign / Step snippet */}
                {delivery.campaignName && (
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5 min-w-0">
                    {delivery.campaignName} • Step {(delivery.stepIndex ?? 0) + 1}
                  </p>
                )}

                {/* Badges Footer */}
                <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-border/30">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <EmailStatusBadge status={delivery.status} size="sm" />
                    {delivery.processingStatus && (
                      <InboundReconciliationBadge
                        processingStatus={delivery.processingStatus}
                        matchConfidence={delivery.matchConfidence}
                        size="sm"
                      />
                    )}
                    {delivery.retryable && (
                      <span className="text-[10px] text-amber-400 font-mono">Retryable</span>
                    )}
                    {delivery.failureCategory && (
                      <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-none text-[9px] font-mono px-1 py-0">
                        {delivery.failureCategory}
                      </Badge>
                    )}
                    {(delivery.retryCount ?? 0) > 0 && (
                      <span className="text-[9px] font-mono text-muted-foreground/80">
                        r:{delivery.retryCount}
                      </span>
                    )}
                  </div>

                  <EngagementPills
                    openCount={delivery.openCount}
                    clickCount={delivery.clickCount}
                    replyCount={delivery.replyCount}
                    firstOpenedAt={delivery.firstOpenedAt}
                    firstClickedAt={delivery.firstClickedAt}
                    lastRepliedAt={delivery.lastRepliedAt}
                    size="sm"
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Controls Footer */}
      {totalPages > 1 && onPageChange && (
        <div className="p-2 border-t border-border/70 flex items-center justify-between text-xs bg-card/40 shrink-0">
          <span className="text-muted-foreground text-[11px]">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || isLoading}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
