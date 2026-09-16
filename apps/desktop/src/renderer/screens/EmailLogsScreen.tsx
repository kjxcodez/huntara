import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Mail,
  Send,
  Inbox,
  Eye,
  MousePointerClick,
  Reply,
  AlertTriangle,
  RefreshCw,
  Clock,
  Layers,
  Sparkles
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { PageHeader } from '../components/common/PageHeader';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmailLogsList } from '../components/email/EmailLogsList';
import { MessageDetailView } from '../components/email/MessageDetailView';
import { toast } from 'sonner';

export default function EmailLogsScreen() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlDeliveryId = searchParams.get('id');

  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(urlDeliveryId);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [directionFilter, setDirectionFilter] = useState('all');
  const [processingStatusFilter, setProcessingStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 50;

  const handleStatusChange = useCallback((status: string) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const handleDirectionChange = useCallback((direction: string) => {
    setDirectionFilter(direction);
    setPage(1);
  }, []);

  const handleProcessingStatusChange = useCallback((status: string) => {
    setProcessingStatusFilter(status);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setPage(1);
  }, []);

  const handleResetFilters = useCallback(() => {
    setStatusFilter('all');
    setDirectionFilter('all');
    setProcessingStatusFilter('all');
    setSearchQuery('');
    setPage(1);
  }, []);

  // Deliveries List Query
  const deliveriesQuery = useQuery({
    queryKey: ['email_deliveries', workspaceId, statusFilter, directionFilter, processingStatusFilter, searchQuery, page],
    queryFn: async () => {
      const payload: any = {
        workspaceId,
        page,
        limit
      };
      if (statusFilter !== 'all') payload.status = statusFilter;
      if (directionFilter !== 'all') payload.direction = directionFilter;
      if (processingStatusFilter !== 'all') payload.processingStatus = processingStatusFilter;
      if (searchQuery.trim()) payload.search = searchQuery.trim();

      const res = await (window as any).ipc.invoke('email-deliveries:list', payload);
      return res;
    },
    enabled: !!workspaceId,
    refetchInterval: 10000
  });

  const deliveries: any[] = useMemo(() => {
    const data = deliveriesQuery.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }, [deliveriesQuery.data]);

  // Aggregate high-level stats from current view/dataset
  const stats = useMemo(() => {
    let sent = 0;
    let ambiguous = 0;
    let failed = 0;
    let opens = 0;
    let clicks = 0;
    let replies = 0;

    for (const d of deliveries) {
      if (d.status === 'SENT') sent++;
      if (d.status === 'AMBIGUOUS') ambiguous++;
      if (d.status === 'FAILED') failed++;
      if (d.openCount > 0 || d.firstOpenedAt) opens++;
      if (d.clickCount > 0 || d.firstClickedAt) clicks++;
      if (d.hasReply || d.replyCount > 0 || d.direction === 'INBOUND') replies++;
    }

    return {
      total: deliveries.length,
      sent,
      ambiguous,
      failed,
      opens,
      clicks,
      replies
    };
  }, [deliveries]);

  // If a delivery ID was specified in URL and no selection made, set it
  React.useEffect(() => {
    if (urlDeliveryId) {
      setSelectedDeliveryId(urlDeliveryId);
    } else if (!selectedDeliveryId && deliveries.length > 0) {
      // Auto-select first message for pleasant split view experience
      setSelectedDeliveryId(deliveries[0].id);
    }
  }, [urlDeliveryId, deliveries, selectedDeliveryId]);

  const handleSelectDelivery = useCallback((delivery: any) => {
    setSelectedDeliveryId(delivery.id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('id', delivery.id);
      return next;
    });
  }, [setSearchParams]);

  // Poll Replies Mutation
  const pollRepliesMutation = useMutation({
    mutationFn: async () => {
      return (window as any).ipc.invoke('email-deliveries:poll-replies', { workspaceId });
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['email_deliveries'] });
      const matched = res?.matched ?? 0;
      const polled = res?.polled ?? 0;
      toast.success('Inbound reply sync complete', {
        description: `Checked connected mailboxes. Found ${matched} new reply correlations across ${polled} messages.`
      });
    },
    onError: (err: any) => {
      toast.error('Failed to poll inbound replies', {
        description: err?.message || 'Check connected email accounts.'
      });
    }
  });

  // Reconcile Ambiguous Mutation
  const reconcileAllMutation = useMutation({
    mutationFn: async () => {
      return (window as any).ipc.invoke('email-deliveries:reconcile', { workspaceId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_deliveries'] });
      toast.success('Ambiguous sends reconciliation complete');
    },
    onError: (err: any) => {
      toast.error('Reconciliation failed', {
        description: err?.message || 'Error checking Gmail provider.'
      });
    }
  });

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-h-[calc(100vh-5rem)] space-y-3 overflow-hidden">
      {/* Header with Title and Global Actions */}
      <PageHeader
        title="Email Logs & Delivery Ledger"
        description="Inspect full outbound transmissions, inbound replies, observed open/click tracking, and provider diagnostics."
        actions={
          <div className="flex items-center gap-2">
            {stats.ambiguous > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20"
                onClick={() => reconcileAllMutation.mutate()}
                disabled={reconcileAllMutation.isPending}
              >
                <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                {reconcileAllMutation.isPending ? 'Reconciling...' : `Reconcile Ambiguous (${stats.ambiguous})`}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs bg-indigo-500/10 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/20"
              onClick={() => pollRepliesMutation.mutate()}
              disabled={pollRepliesMutation.isPending}
            >
              <Inbox className={`w-3.5 h-3.5 mr-1.5 ${pollRepliesMutation.isPending ? 'animate-spin' : ''}`} />
              {pollRepliesMutation.isPending ? 'Polling...' : 'Poll Inbound Replies'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['email_deliveries'] })}
              title="Refresh ledger"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${deliveriesQuery.isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        }
      />

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Card className="bg-card/40 border-border/60">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-medium" title="Messages accepted by provider for transmission">Sent (Accepted)</span>
              <Send className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.sent}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-border/60">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-medium">Observed Opens</span>
              <Eye className="w-3.5 h-3.5 text-sky-400" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.opens}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-border/60">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-medium">Observed Clicks</span>
              <MousePointerClick className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.clicks}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-border/60">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-medium">Replies Correlated</span>
              <Reply className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.replies}</div>
          </CardContent>
        </Card>

        <Card className={`border-border/60 ${stats.ambiguous > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-card/40'}`}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className={`text-[11px] font-medium ${stats.ambiguous > 0 ? 'text-amber-300' : ''}`}>
                Ambiguous
              </span>
              <AlertTriangle className={`w-3.5 h-3.5 ${stats.ambiguous > 0 ? 'text-amber-400' : 'text-muted-foreground'}`} />
            </div>
            <div className={`text-lg font-bold ${stats.ambiguous > 0 ? 'text-amber-300' : 'text-foreground'}`}>
              {stats.ambiguous}
            </div>
          </CardContent>
        </Card>

        <Card className={`border-border/60 ${stats.failed > 0 ? 'bg-rose-500/10 border-rose-500/30' : 'bg-card/40'}`}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className={`text-[11px] font-medium ${stats.failed > 0 ? 'text-rose-300' : ''}`}>
                Failed
              </span>
              <AlertTriangle className={`w-3.5 h-3.5 ${stats.failed > 0 ? 'text-rose-400' : 'text-muted-foreground'}`} />
            </div>
            <div className={`text-lg font-bold ${stats.failed > 0 ? 'text-rose-300' : 'text-foreground'}`}>
              {stats.failed}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Split Pane Layout (Desktop Master/Detail) */}
      <div
        className="flex-1 min-h-0 border border-border/70 rounded-lg overflow-hidden bg-card/20 shadow-sm grid"
        style={{ gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)' }}
      >
        {/* Left Pane: Email Deliveries List */}
        <div className="h-full min-h-0 min-w-0 overflow-hidden flex flex-col">
          <EmailLogsList
            deliveries={deliveries}
            selectedDeliveryId={selectedDeliveryId}
            onSelectDelivery={handleSelectDelivery}
            isLoading={deliveriesQuery.isLoading}
            page={page}
            totalPages={(deliveriesQuery.data as any)?.totalPages || 1}
            totalItems={(deliveriesQuery.data as any)?.total || deliveries.length}
            onPageChange={setPage}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            statusFilter={statusFilter}
            onStatusChange={handleStatusChange}
            directionFilter={directionFilter}
            onDirectionChange={handleDirectionChange}
            processingStatusFilter={processingStatusFilter}
            onProcessingStatusChange={handleProcessingStatusChange}
            onResetFilters={handleResetFilters}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['email_deliveries'] })}
            onPollReplies={() => pollRepliesMutation.mutate()}
            isPollingReplies={pollRepliesMutation.isPending}
            className="h-full"
          />
        </div>

        {/* Right Pane: Selected Delivery / Message Detail */}
        <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background/50 flex flex-col">
          {selectedDeliveryId ? (
            <MessageDetailView
              deliveryId={selectedDeliveryId}
              onClose={() => setSelectedDeliveryId(null)}
              onNavigateToContact={(contactId) => navigate(`/contacts?id=${contactId}`)}
              onNavigateToCampaign={(campaignId) => navigate(`/campaigns?id=${campaignId}`)}
              className="h-full"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground space-y-3">
              <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center border border-border/60">
                <Mail className="w-6 h-6 text-muted-foreground/40" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h3 className="text-sm font-semibold text-foreground">Select a message</h3>
                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                  Choose an email from the list on the left to inspect its delivery status, provider diagnostics, rendered preview, and engagement timelines.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
