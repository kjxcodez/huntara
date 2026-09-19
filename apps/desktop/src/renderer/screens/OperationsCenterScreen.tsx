import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  Server,
  RefreshCw,
  Mail,
  Clock,
  ExternalLink,
  Search,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Database,
  Cpu,
  Layers,
  Inbox,
  ArrowRight,
  X,
  Play,
  FileText,
  ShieldCheck,
  Terminal,
  Zap,
  Info
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { motion, AnimatePresence } from 'framer-motion';
import type {
  OperationRecord,
  OperationsHealthSummary,
  OperationTimelineEvent,
  SubsystemHealthStatus,
  FailureClass
} from '@huntara/schema';

export function OperationsCenterScreen() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'active' | 'failures' | 'deadletters' | 'mailboxes' | 'watchdog' | 'all' | 'logs'>('active');

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 25;

  // Selected operation for inspection drawer
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);

  // 1. Fetch Authoritative Operations Health Summary (polls every 4s)
  const healthQuery = useQuery<OperationsHealthSummary>({
    queryKey: ['operations_health', workspaceId],
    queryFn: async () => {
      if (!workspaceId) throw new Error('No workspace selected');
      return window.ipc.invoke('operations:health', { workspaceId });
    },
    enabled: !!workspaceId,
    refetchInterval: 4000
  });

  // 2. Fetch Operations List (polls every 3s)
  const operationsQuery = useQuery<{
    items: OperationRecord[];
    total: number;
    page: number;
    isCached?: boolean;
  }>({
    queryKey: ['operations_list', workspaceId, activeTab, statusFilter, typeFilter, searchQuery, page],
    queryFn: async () => {
      if (!workspaceId) return { items: [], total: 0, page: 1 };

      const params: any = {
        workspaceId,
        page,
        limit,
        search: searchQuery.trim() || undefined
      };

      if (activeTab === 'active') {
        params.status = 'running';
      } else if (activeTab === 'failures') {
        // Fetch operations in failure or ambiguous states
        params.status = undefined; // We'll filter in-memory if needed or pass failureClass
      } else {
        if (statusFilter !== 'all') params.status = statusFilter;
      }

      if (typeFilter !== 'all') params.type = typeFilter;

      return window.ipc.invoke('operations:list', params);
    },
    enabled: !!workspaceId,
    refetchInterval: 3000
  });

  // 3. Fetch Selected Operation Detail
  const operationDetailQuery = useQuery<OperationRecord | null>({
    queryKey: ['operation_detail', workspaceId, selectedOperationId],
    queryFn: async () => {
      if (!workspaceId || !selectedOperationId) return null;
      return window.ipc.invoke('operations:get', { workspaceId, id: selectedOperationId });
    },
    enabled: !!workspaceId && !!selectedOperationId
  });

  // 4. Fetch Operation Events Timeline
  const operationEventsQuery = useQuery<OperationTimelineEvent[]>({
    queryKey: ['operation_events', workspaceId, selectedOperationId],
    queryFn: async () => {
      if (!workspaceId || !selectedOperationId) return [];
      return window.ipc.invoke('operations:events', { workspaceId, id: selectedOperationId });
    },
    enabled: !!workspaceId && !!selectedOperationId
  });

  // 5. Fetch System Logs for Logs Tab
  const logsQuery = useQuery({
    queryKey: ['system_logs', workspaceId, searchQuery],
    queryFn: async () => {
      if (!workspaceId) return [];
      return window.ipc.invoke('system-logs:query', {
        workspaceId,
        query: searchQuery,
        limit: 100
      });
    },
    enabled: !!workspaceId && activeTab === 'logs',
    refetchInterval: 5000
  });

  // 6. Fetch Email Accounts & Mailbox Health
  const mailboxesQuery = useQuery({
    queryKey: ['email_accounts_health', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return window.ipc.invoke('email-accounts:list', undefined);
    },
    enabled: !!workspaceId && (activeTab === 'mailboxes' || activeTab === 'active'),
    refetchInterval: 5000
  });

  // 7. Fetch Worker Watchdog Telemetry
  const watchdogQuery = useQuery({
    queryKey: ['worker_watchdog_health', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return { workers: [], systemStatus: 'HEALTHY' };
      return window.ipc.invoke('scheduler:workers:health', { workspaceId });
    },
    enabled: !!workspaceId && (activeTab === 'watchdog' || activeTab === 'active'),
    refetchInterval: 4000
  });

  // 8. Fetch Dead-Letter Queue
  const deadLettersQuery = useQuery({
    queryKey: ['dead_letters_list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return { data: [], total: 0, limit: 50, offset: 0 };
      return window.ipc.invoke('scheduler:dead-letters:list', { workspaceId, limit: 50 });
    },
    enabled: !!workspaceId && (activeTab === 'deadletters' || activeTab === 'failures'),
    refetchInterval: 5000
  });

  // Quick Action Mutations
  const pollRepliesMutation = useMutation({
    mutationFn: async () => {
      return (window as any).ipc.invoke('email-deliveries:poll-replies');
    },
    onSuccess: (res: any) => {
      toast.success('Inbound reply polling initiated.');
      queryClient.invalidateQueries({ queryKey: ['operations_health'] });
      queryClient.invalidateQueries({ queryKey: ['operations_list'] });
    },
    onError: (err: any) => {
      toast.error(`Inbound poll failed: ${err.message || err}`);
    }
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      return (window as any).ipc.invoke('recovery:execute', { workspaceId, action: 'reconcile-ambiguous' });
    },
    onSuccess: () => {
      toast.success('Ambiguous delivery reconciliation run initiated.');
      queryClient.invalidateQueries({ queryKey: ['operations_health'] });
      queryClient.invalidateQueries({ queryKey: ['operations_list'] });
    },
    onError: (err: any) => {
      toast.error(`Reconciliation failed: ${err.message || err}`);
    }
  });

  const cleanStaleMutation = useMutation({
    mutationFn: async () => {
      return (window as any).ipc.invoke('recovery:execute', { workspaceId, action: 'clean-orphaned' });
    },
    onSuccess: () => {
      toast.success('Stale worker processes and expired leases cleaned.');
      queryClient.invalidateQueries({ queryKey: ['operations_health'] });
      queryClient.invalidateQueries({ queryKey: ['operations_list'] });
    },
    onError: (err: any) => {
      toast.error(`Recovery execution failed: ${err.message || err}`);
    }
  });

  const reindexInboundMutation = useMutation({
    mutationFn: async () => {
      return (window as any).ipc.invoke('email-deliveries:reindex-inbound', { limit: 50 });
    },
    onSuccess: (res: any) => {
      toast.success(`Inbound re-indexing finished: ${res?.matchedCount ?? 0} matched, ${res?.suppressedExecutionsCount ?? 0} halted.`);
      queryClient.invalidateQueries({ queryKey: ['operations_health'] });
      queryClient.invalidateQueries({ queryKey: ['operations_list'] });
    },
    onError: (err: any) => {
      toast.error(`Inbound re-index failed: ${err.message || err}`);
    }
  });

  const rebuildProjectionMutation = useMutation({
    mutationFn: async () => {
      return window.ipc.invoke('projection:rebuild', { workspaceId });
    },
    onSuccess: () => {
      toast.success('Authoritative projection rebuilt from MongoDB.');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => {
      toast.error(`Projection rebuild failed: ${err.message || err}`);
    }
  });

  const resetHealthMutation = useMutation({
    mutationFn: async (accountId: string) => {
      return (window as any).ipc.invoke('email-accounts:reset-health', accountId);
    },
    onSuccess: () => {
      toast.success('Mailbox health state reset to HEALTHY.');
      queryClient.invalidateQueries({ queryKey: ['email_accounts_health'] });
    },
    onError: (err: any) => {
      toast.error(`Reset health failed: ${err.message || err}`);
    }
  });

  const requeueDeadLetterMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return window.ipc.invoke('scheduler:dead-letters:requeue', { workspaceId, jobId });
    },
    onSuccess: () => {
      toast.success('Dead-letter job successfully requeued.');
      queryClient.invalidateQueries({ queryKey: ['dead_letters_list'] });
      queryClient.invalidateQueries({ queryKey: ['operations_list'] });
    },
    onError: (err: any) => {
      toast.error(`Requeue failed: ${err.message || err}`);
    }
  });

  // Retry Operation Mutation
  const retryOperationMutation = useMutation({
    mutationFn: async ({ id, force }: { id: string; force?: boolean }) => {
      return (window as any).ipc.invoke('operations:retry', {
        workspaceId,
        id,
        ...(force !== undefined ? { force } : {})
      });
    },
    onSuccess: (res: any) => {
      toast.success(res.message || 'Operation queued for retry.');
      queryClient.invalidateQueries({ queryKey: ['operations_list'] });
      queryClient.invalidateQueries({ queryKey: ['operation_detail', workspaceId, selectedOperationId] });
      queryClient.invalidateQueries({ queryKey: ['operations_health'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to retry operation.');
    }
  });

  // Reconcile Single Operation Mutation
  const reconcileOperationMutation = useMutation({
    mutationFn: async (id: string) => {
      return window.ipc.invoke('operations:reconcile', { workspaceId, id });
    },
    onSuccess: (res: any) => {
      toast.success(res.message || 'Operation reconciled.');
      queryClient.invalidateQueries({ queryKey: ['operations_list'] });
      queryClient.invalidateQueries({ queryKey: ['operation_detail', workspaceId, selectedOperationId] });
      queryClient.invalidateQueries({ queryKey: ['operations_health'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Reconciliation failed.');
    }
  });

  // Compute filtered items for the current tab
  const rawItems = operationsQuery.data?.items || [];
  const displayItems = useMemo(() => {
    if (activeTab === 'failures') {
      return rawItems.filter(
        (op) =>
          op.status === 'failed' ||
          op.status === 'ambiguous' ||
          op.status === 'stale' ||
          op.failureClass === 'requires_reconciliation' ||
          op.failureClass === 'requires_manual_intervention'
      );
    }
    return rawItems;
  }, [rawItems, activeTab]);

  const health = healthQuery.data;
  const isOfflineCached = operationsQuery.data?.isCached || healthQuery.data?.overallStatus === 'degraded' && healthQuery.data?.subsystems?.api?.status === 'not_connected';

  const getStatusBadge = (status: string, isStale?: boolean) => {
    if (isStale) {
      return <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/30 rounded-none text-[10px] font-mono">STALE</Badge>;
    }
    switch (status?.toLowerCase()) {
      case 'running':
      case 'starting':
        return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-none text-[10px] font-mono animate-pulse">RUNNING</Badge>;
      case 'completed':
      case 'sent':
        return <Badge className="bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-none text-[10px] font-mono">COMPLETED</Badge>;
      case 'ambiguous':
        return <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-none text-[10px] font-mono">AMBIGUOUS</Badge>;
      case 'retrying':
        return <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded-none text-[10px] font-mono">RETRYING</Badge>;
      case 'failed':
        return <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-none text-[10px] font-mono">FAILED</Badge>;
      case 'cancelled':
        return <Badge className="bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 rounded-none text-[10px] font-mono">CANCELLED</Badge>;
      default:
        return <Badge className="bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 rounded-none text-[10px] font-mono">{status?.toUpperCase() || 'QUEUED'}</Badge>;
    }
  };

  const getMailboxHealthBadge = (healthData: any) => {
    const state = healthData?.state || 'HEALTHY';
    switch (state) {
      case 'HEALTHY':
        return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-none text-[10px] font-mono">HEALTHY</Badge>;
      case 'COOLDOWN':
        return <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-none text-[10px] font-mono animate-pulse">COOLDOWN</Badge>;
      case 'AUTH_REQUIRED':
        return <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-none text-[10px] font-mono">AUTH REQUIRED</Badge>;
      case 'BLOCKED':
        return <Badge className="bg-red-500/20 text-red-500 border border-red-500/40 rounded-none text-[10px] font-mono">BLOCKED</Badge>;
      case 'DEGRADED':
        return <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/30 rounded-none text-[10px] font-mono">DEGRADED</Badge>;
      case 'DISCONNECTED':
      default:
        return <Badge className="bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 rounded-none text-[10px] font-mono">{state}</Badge>;
    }
  };

  const getFailureClassBadge = (fc?: FailureClass | null) => {
    switch (fc) {
      case 'requires_reconciliation':
        return <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-none text-[10px]">Requires Reconciliation</Badge>;
      case 'retry_scheduled':
        return <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded-none text-[10px]">Retry Scheduled</Badge>;
      case 'auto_recovering':
        return <Badge className="bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-none text-[10px]">Auto Recovering</Badge>;
      case 'requires_manual_intervention':
        return <Badge className="bg-orange-500/10 text-orange-400 border border-orange-500/30 rounded-none text-[10px]">Manual Intervention</Badge>;
      case 'permanent_failure':
        return <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-none text-[10px]">Permanent Failure</Badge>;
      default:
        return null;
    }
  };

  const getSubsystemIcon = (key: string) => {
    switch (key) {
      case 'api':
        return <Server className="h-4 w-4" />;
      case 'mongodb':
        return <Database className="h-4 w-4" />;
      case 'sqlite':
        return <Layers className="h-4 w-4" />;
      case 'gmail':
        return <Mail className="h-4 w-4" />;
      case 'scheduler':
        return <Clock className="h-4 w-4" />;
      case 'workers':
        return <Cpu className="h-4 w-4" />;
      case 'inboundPolling':
        return <Inbox className="h-4 w-4" />;
      case 'reconciliation':
        return <RefreshCw className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getHealthBadge = (status: SubsystemHealthStatus) => {
    switch (status) {
      case 'healthy':
        return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Healthy</span>;
      case 'degraded':
        return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400"><AlertTriangle className="h-3 w-3" /> Degraded</span>;
      case 'failed':
        return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400"><XCircle className="h-3 w-3" /> Failed</span>;
      case 'not_connected':
        return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400"><AlertCircle className="h-3 w-3" /> Not Connected</span>;
      default:
        return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400"><Info className="h-3 w-3" /> Unknown</span>;
    }
  };

  const formatElapsed = (startedAt?: string | null) => {
    if (!startedAt) return '—';
    const ms = Date.now() - new Date(startedAt).getTime();
    if (ms < 0) return '0s';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m ${sec % 60}s`;
  };

  if (!workspaceId) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full text-muted-foreground font-sans">
        <Server className="h-10 w-10 mb-2 opacity-40 text-primary" />
        <p className="text-sm font-medium">Select an active workspace to enter Operations Center.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-xs font-sans h-full overflow-y-auto pr-1 pb-10 select-none">
      {/* 1. Header with Controls & Authoritative Status */}
      <PageHeader
        title="Operations Center"
        description="Subsystem health, background job reliability, failure queue, and operational traceability."
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            {/* Live vs Offline Cache Tag */}
            <Badge
              className={`rounded-none font-mono text-[10px] px-2 py-0.5 border ${
                isOfflineCached
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}
            >
              {isOfflineCached ? 'OFFLINE CACHE' : 'LIVE TELEMETRY'}
            </Badge>

            {/* Overall System Health Status */}
            <Badge
              className={`rounded-none font-semibold text-[11px] px-2.5 py-0.5 border ${
                health?.overallStatus === 'healthy'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : health?.overallStatus === 'degraded'
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
              }`}
            >
              SYSTEM: {health?.overallStatus?.toUpperCase() || 'CHECKING'}
            </Badge>

            {/* Quick Actions */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pollRepliesMutation.isPending}
              className="h-7 text-[11px] rounded-none border-border-subtle hover:border-primary"
              onClick={() => pollRepliesMutation.mutate()}
            >
              <Inbox className={`h-3 w-3 mr-1 ${pollRepliesMutation.isPending ? 'animate-spin' : ''}`} />
              Poll Replies
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reconcileMutation.isPending}
              className="h-7 text-[11px] rounded-none border-border-subtle hover:border-primary"
              onClick={() => reconcileMutation.mutate()}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${reconcileMutation.isPending ? 'animate-spin' : ''}`} />
              Reconcile
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={cleanStaleMutation.isPending}
              className="h-7 text-[11px] rounded-none border-border-subtle hover:border-primary"
              onClick={() => cleanStaleMutation.mutate()}
            >
              <Zap className={`h-3 w-3 mr-1 ${cleanStaleMutation.isPending ? 'animate-spin' : ''}`} />
              Clean Leases
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reindexInboundMutation.isPending}
              className="h-7 text-[11px] rounded-none border-border-subtle hover:border-primary"
              onClick={() => reindexInboundMutation.mutate()}
            >
              <ArrowRight className={`h-3 w-3 mr-1 ${reindexInboundMutation.isPending ? 'animate-spin' : ''}`} />
              Re-index Inbound
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rebuildProjectionMutation.isPending}
              className="h-7 text-[11px] rounded-none border-border-subtle hover:border-primary"
              onClick={() => rebuildProjectionMutation.mutate()}
            >
              <Database className={`h-3 w-3 mr-1 ${rebuildProjectionMutation.isPending ? 'animate-spin' : ''}`} />
              Rebuild Projection
            </Button>
          </div>
        }
      />

      {/* 2. Subsystem Health Grid (8 Core Subsystems) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {[
          { key: 'api', label: 'API Gateway' },
          { key: 'mongodb', label: 'MongoDB' },
          { key: 'sqlite', label: 'Local SQLite' },
          { key: 'gmail', label: 'Gmail OAuth' },
          { key: 'scheduler', label: 'Scheduler' },
          { key: 'workers', label: 'Worker Pool' },
          { key: 'inboundPolling', label: 'Inbound Poll' },
          { key: 'reconciliation', label: 'Reconcile' }
        ].map(({ key, label }) => {
          const sub = (health?.subsystems as any)?.[key];
          return (
            <div
              key={key}
              className="bg-card border border-border-subtle p-2.5 rounded-none flex flex-col justify-between h-20 relative overflow-hidden"
            >
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
                {getSubsystemIcon(key)}
              </div>
              <div>
                <div className="mt-1">{getHealthBadge(sub?.status || 'unknown')}</div>
                <p className="text-[9px] text-muted-foreground truncate mt-0.5" title={sub?.message}>
                  {sub?.message || 'Awaiting telemetry...'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Summary Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div
          onClick={() => setActiveTab('active')}
          className="bg-card border border-border-subtle hover:border-primary/50 cursor-pointer p-3.5 rounded-none transition-colors"
        >
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Active Operations</span>
            <Play className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">
            {health?.metrics?.activeOperationsCount ?? 0}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Currently executing tasks</p>
        </div>

        <div
          onClick={() => setActiveTab('failures')}
          className="bg-card border border-border-subtle hover:border-rose-500/50 cursor-pointer p-3.5 rounded-none transition-colors"
        >
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Failed Operations</span>
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">
            {health?.metrics?.failedOperationsCount ?? 0}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Requiring review or recovery</p>
        </div>

        <div
          onClick={() => setActiveTab('failures')}
          className="bg-card border border-border-subtle hover:border-amber-500/50 cursor-pointer p-3.5 rounded-none transition-colors"
        >
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Stale Operations</span>
            <Clock className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">
            {health?.metrics?.staleOperationsCount ?? 0}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Expired lease or stalled heartbeat</p>
        </div>

        <div
          onClick={() => setActiveTab('all')}
          className="bg-card border border-border-subtle hover:border-indigo-500/50 cursor-pointer p-3.5 rounded-none transition-colors"
        >
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Retry Scheduled</span>
            <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-indigo-400">
            {health?.metrics?.retryingCount ?? 0}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Exponential backoff active</p>
        </div>
      </div>

      {/* 4. Sliding Tab Navigation */}
      <div className="border-b border-border-subtle flex gap-4 w-full relative pt-1">
        {[
          { id: 'active', label: `Active (${health?.metrics?.activeOperationsCount || 0})`, icon: Play },
          { id: 'failures', label: `Failure Queue (${health?.metrics?.failedOperationsCount || 0})`, icon: AlertTriangle },
          { id: 'deadletters', label: `Dead Letters (${deadLettersQuery.data?.total || deadLettersQuery.data?.data?.length || 0})`, icon: XCircle },
          { id: 'mailboxes', label: `Mailbox Health (${mailboxesQuery.data?.length || 0})`, icon: Mail },
          { id: 'watchdog', label: `Watchdog (${watchdogQuery.data?.systemStatus || 'OK'})`, icon: Cpu },
          { id: 'all', label: 'All Operations', icon: Layers },
          { id: 'logs', label: 'System Logs', icon: FileText }
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id as any);
                setPage(1);
              }}
              className={`relative pb-2.5 px-1 flex items-center gap-1.5 rounded-none text-xs font-semibold select-none outline-none transition-colors ${
                isActive ? 'text-primary font-bold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
              {isActive && (
                <motion.div
                  layoutId="operationsTabUnderline"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Filters & Search Toolbar (shown for operational tables) */}
      {(activeTab === 'active' || activeTab === 'failures' || activeTab === 'all') && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by ID, recipient, message, error..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="h-8 pl-8 text-xs rounded-none bg-card border-border-subtle"
              />
            </div>

            {activeTab === 'all' && (
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="h-8 px-2 text-xs rounded-none bg-card border border-border-subtle text-foreground outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="running">Running</option>
                <option value="queued">Queued</option>
                <option value="retrying">Retrying</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="ambiguous">Ambiguous</option>
                <option value="stale">Stale</option>
              </select>
            )}

            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="h-8 px-2 text-xs rounded-none bg-card border border-border-subtle text-foreground outline-none"
            >
              <option value="all">All Types</option>
              <option value="email:send">email:send</option>
              <option value="scraper:maps">scraper:maps</option>
              <option value="crawler:website">crawler:website</option>
              <option value="enrich:intelligence">enrich:intelligence</option>
              <option value="automation:workflow">automation:workflow</option>
            </select>
          </div>

          <div className="text-[11px] text-muted-foreground">
            Total Records: <span className="font-mono font-bold text-foreground">{operationsQuery.data?.total || displayItems.length}</span>
          </div>
        </div>
      )}

      {/* 5. Main Table Views */}
      {activeTab === 'active' && (
        <div className="border border-border-subtle bg-card rounded-none overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border-subtle bg-muted/30 text-[10px] text-muted-foreground uppercase font-semibold">
                <th className="py-2.5 px-3">Operation ID</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Context / Recipient</th>
                <th className="py-2.5 px-3">Elapsed</th>
                <th className="py-2.5 px-3">Attempt</th>
                <th className="py-2.5 px-3">Last Heartbeat</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {displayItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground text-xs">
                    No active operations currently running.
                  </td>
                </tr>
              ) : (
                displayItems.map((op) => (
                  <tr
                    key={op.id}
                    onClick={() => setSelectedOperationId(op.id)}
                    className="hover:bg-muted/20 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-3 font-mono text-[11px] text-foreground font-semibold">
                      {op.id.substring(0, 12)}...
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-primary">{op.type}</td>
                    <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[200px]">
                      {op.contactEmail || op.campaignName || op.correlationId || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-foreground">
                      {formatElapsed(op.startedAt)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {op.attempt} / {op.maxAttempts}
                    </td>
                    <td className="py-2.5 px-3 text-[10px] text-muted-foreground font-mono">
                      {op.lastHeartbeatAt ? new Date(op.lastHeartbeatAt).toLocaleTimeString() : '—'}
                    </td>
                    <td className="py-2.5 px-3">{getStatusBadge(op.status, op.isStale)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] rounded-none px-2 text-primary hover:text-primary-foreground hover:bg-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOperationId(op.id);
                        }}
                      >
                        Inspect
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'failures' && (
        <div className="border border-border-subtle bg-card rounded-none overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border-subtle bg-muted/30 text-[10px] text-muted-foreground uppercase font-semibold">
                <th className="py-2.5 px-3">Operation ID</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Failure Classification</th>
                <th className="py-2.5 px-3">Diagnostic Message</th>
                <th className="py-2.5 px-3">Attempts</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {displayItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-emerald-400 text-xs">
                    <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-emerald-400 opacity-80" />
                    Failure Queue is clear. All operations healthy.
                  </td>
                </tr>
              ) : (
                displayItems.map((op) => (
                  <tr
                    key={op.id}
                    onClick={() => setSelectedOperationId(op.id)}
                    className="hover:bg-muted/20 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-3 font-mono text-[11px] text-foreground font-semibold">
                      {op.id.substring(0, 12)}...
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-foreground">{op.type}</td>
                    <td className="py-2.5 px-3">{getFailureClassBadge(op.failureClass)}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-[11px] max-w-[280px] truncate" title={op.safeHumanMessage || op.lastError || ''}>
                      {op.safeHumanMessage || op.lastError || 'Unspecified failure'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {op.attempt} / {op.maxAttempts}
                    </td>
                    <td className="py-2.5 px-3">{getStatusBadge(op.status, op.isStale)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex gap-1 justify-end items-center" onClick={(e) => e.stopPropagation()}>
                        {/* Safe Retry Button */}
                        {op.retryable && op.status !== 'ambiguous' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] rounded-none border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                            onClick={() => retryOperationMutation.mutate({ id: op.id })}
                            disabled={retryOperationMutation.isPending}
                          >
                            Retry
                          </Button>
                        )}

                        {/* Reconcile Button for Ambiguous */}
                        {op.status === 'ambiguous' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] rounded-none border-amber-500 text-amber-400 hover:bg-amber-500 hover:text-black"
                            onClick={() => reconcileOperationMutation.mutate(op.id)}
                            disabled={reconcileOperationMutation.isPending}
                          >
                            Reconcile
                          </Button>
                        )}

                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] rounded-none px-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() => setSelectedOperationId(op.id)}
                        >
                          Details
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'all' && (
        <div className="border border-border-subtle bg-card rounded-none overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border-subtle bg-muted/30 text-[10px] text-muted-foreground uppercase font-semibold">
                <th className="py-2.5 px-3">ID</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Created</th>
                <th className="py-2.5 px-3">Context</th>
                <th className="py-2.5 px-3">Attempts</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {displayItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground text-xs">
                    No operations found matching criteria.
                  </td>
                </tr>
              ) : (
                displayItems.map((op) => (
                  <tr
                    key={op.id}
                    onClick={() => setSelectedOperationId(op.id)}
                    className="hover:bg-muted/20 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-3 font-mono text-[11px] text-foreground font-semibold">
                      {op.id.substring(0, 10)}...
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-primary">{op.type}</td>
                    <td className="py-2.5 px-3 text-[10px] text-muted-foreground font-mono">
                      {new Date(op.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[200px]">
                      {op.contactEmail || op.campaignName || op.correlationId || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {op.attempt} / {op.maxAttempts}
                    </td>
                    <td className="py-2.5 px-3">{getStatusBadge(op.status, op.isStale)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] rounded-none px-2 text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOperationId(op.id);
                        }}
                      >
                        Inspect
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 5b. Dead-Letter Queue Tab */}
      {activeTab === 'deadletters' && (
        <div className="space-y-3">
          <div className="border border-border-subtle bg-card rounded-none p-3.5 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <XCircle className="h-4 w-4 text-rose-400" />
                Dead-Letter Queue & Incident Lineage
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Stuck or exhausted jobs retained with immutable execution lineage for inspection and recovery.
              </p>
            </div>
            <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-none text-xs font-mono">
              {deadLettersQuery.data?.total || deadLettersQuery.data?.data?.length || 0} DEAD-LETTER JOBS
            </Badge>
          </div>

          <div className="border border-border-subtle bg-card rounded-none overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-muted/30 text-[10px] text-muted-foreground uppercase font-semibold">
                  <th className="py-2.5 px-3">Job ID</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Dead-Letter Reason</th>
                  <th className="py-2.5 px-3">Lineage Context</th>
                  <th className="py-2.5 px-3">Retries</th>
                  <th className="py-2.5 px-3">Dead-Lettered At</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {(!deadLettersQuery.data?.data || deadLettersQuery.data.data.length === 0) ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-emerald-400 text-xs">
                      <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-emerald-400 opacity-80" />
                      Dead-Letter queue is empty. Zero abandoned jobs.
                    </td>
                  </tr>
                ) : (
                  deadLettersQuery.data.data.map((job: any) => {
                    const lineage = job.lineageReferences || {};
                    return (
                      <tr key={job.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[11px] text-foreground font-semibold">
                          {job.id}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-primary">{job.type}</td>
                        <td className="py-2.5 px-3 text-rose-400 text-[11px] max-w-[240px] truncate" title={job.deadLetterReason || lineage.lastError || ''}>
                          {job.deadLetterReason || lineage.lastError || 'Exhausted retries'}
                        </td>
                        <td className="py-2.5 px-3 text-[10px] font-mono text-muted-foreground max-w-[220px]">
                          {lineage.campaignId && <div className="truncate">camp: {lineage.campaignId}</div>}
                          {lineage.contactId && <div className="truncate">contact: {lineage.contactId}</div>}
                          {lineage.mailbox && <div className="truncate text-foreground/80">mb: {lineage.mailbox}</div>}
                          {!lineage.campaignId && !lineage.contactId && !lineage.mailbox && '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {job.retryCount ?? job.retries ?? 0} / {job.maxRetries ?? 3}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[10px] text-muted-foreground">
                          {job.deadLetteredAt ? new Date(job.deadLetteredAt).toLocaleTimeString() : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] rounded-none border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                            disabled={requeueDeadLetterMutation.isPending}
                            onClick={() => requeueDeadLetterMutation.mutate(job.id)}
                          >
                            Requeue
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5c. Mailbox Health Tab */}
      {activeTab === 'mailboxes' && (
        <div className="space-y-3">
          <div className="border border-border-subtle bg-card rounded-none p-3.5 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Mail className="h-4 w-4 text-primary" />
                Sending Mailbox Health & Dispatch Eligibility
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Stateful dispatch eligibility model enforcing safe cooldown periods without corrupting campaign pause status.
              </p>
            </div>
            <Badge className="bg-primary/10 text-primary border border-primary/30 rounded-none text-xs font-mono">
              {mailboxesQuery.data?.length || 0} MAILBOXES
            </Badge>
          </div>

          <div className="border border-border-subtle bg-card rounded-none overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-muted/30 text-[10px] text-muted-foreground uppercase font-semibold">
                  <th className="py-2.5 px-3">Account Address</th>
                  <th className="py-2.5 px-3">Connection</th>
                  <th className="py-2.5 px-3">Health State</th>
                  <th className="py-2.5 px-3">Consecutive Failures</th>
                  <th className="py-2.5 px-3">Cooldown Status</th>
                  <th className="py-2.5 px-3">Last Failure Code</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {(!mailboxesQuery.data || mailboxesQuery.data.length === 0) ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground text-xs">
                      No email accounts configured in this workspace.
                    </td>
                  </tr>
                ) : (
                  mailboxesQuery.data.map((acc: any) => {
                    const healthData = acc.health || {};
                    const isCooldown = healthData.state === 'COOLDOWN';
                    const cooldownRemaining = isCooldown && healthData.cooldownUntil
                      ? Math.max(0, Math.round((new Date(healthData.cooldownUntil).getTime() - Date.now()) / 1000))
                      : 0;
                    return (
                      <tr key={acc.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[11px] text-foreground font-semibold">
                          {acc.email}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] capitalize text-muted-foreground">
                          {acc.status || 'connected'}
                        </td>
                        <td className="py-2.5 px-3">
                          {getMailboxHealthBadge(healthData)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {healthData.consecutiveSendFailures ?? 0}
                        </td>
                        <td className="py-2.5 px-3 text-[11px]">
                          {isCooldown ? (
                            <span className="text-amber-400 font-mono text-[10px]">
                              Active ({cooldownRemaining}s rem) • Cycle #{healthData.cooldownCount || 1}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-[10px]">None active</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[10px] font-mono text-muted-foreground">
                          {healthData.lastFailureCode || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] rounded-none border-border-subtle hover:border-primary"
                            disabled={resetHealthMutation.isPending}
                            onClick={() => resetHealthMutation.mutate(acc.id)}
                          >
                            Reset Health
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5d. Worker Watchdog Tab */}
      {activeTab === 'watchdog' && (
        <div className="space-y-3">
          <div className="border border-border-subtle bg-card rounded-none p-3.5 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Cpu className="h-4 w-4 text-emerald-400" />
                Scheduler Worker Watchdog Telemetry
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Active worker monitoring with bounded crash limits (max 5) and stale lease cleanups.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-muted text-muted-foreground rounded-none text-xs font-mono">
                SYSTEM: {watchdogQuery.data?.systemStatus || 'HEALTHY'}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 text-[10px] rounded-none border-border-subtle"
                onClick={() => cleanStaleMutation.mutate()}
                disabled={cleanStaleMutation.isPending}
              >
                Clean Leases
              </Button>
            </div>
          </div>

          <div className="border border-border-subtle bg-card rounded-none overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-muted/30 text-[10px] text-muted-foreground uppercase font-semibold">
                  <th className="py-2.5 px-3">Worker Plugin</th>
                  <th className="py-2.5 px-3">State</th>
                  <th className="py-2.5 px-3">Crash Count</th>
                  <th className="py-2.5 px-3">Heartbeat</th>
                  <th className="py-2.5 px-3">Last Crash</th>
                  <th className="py-2.5 px-3">Diagnostic Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {(!watchdogQuery.data?.workers || watchdogQuery.data.workers.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground text-xs">
                      Zero registered workers in active pool.
                    </td>
                  </tr>
                ) : (
                  watchdogQuery.data.workers.map((w: any) => (
                    <tr key={w.type} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-[11px] text-foreground font-semibold">
                        {w.type}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          className={`rounded-none text-[10px] font-mono ${
                            w.status === 'RUNNING'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse'
                              : w.status === 'CRASHED'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                                : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/30'
                          }`}
                        >
                          {w.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {w.crashCount} / {w.maxConsecutiveCrashes || 5}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[10px] text-muted-foreground">
                        {formatElapsed(w.lastHeartbeat)} ago
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[10px] text-muted-foreground">
                        {w.lastCrashAt ? `${formatElapsed(w.lastCrashAt)} ago` : 'None'}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-muted-foreground truncate max-w-[260px]" title={w.lastError || ''}>
                        {w.lastError || 'None'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="border border-border-subtle bg-card rounded-none p-3 space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
            <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-primary" />
              Machine-Readable Structured Logs
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {logsQuery.data?.length || 0} events
            </span>
          </div>

          <div className="font-mono text-[11px] space-y-1.5 max-h-[500px] overflow-y-auto">
            {logsQuery.data?.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center">No system log events recorded.</p>
            ) : (
              logsQuery.data?.map((log: any, idx: number) => (
                <div
                  key={log.id || idx}
                  className="p-2 border border-border-subtle/50 bg-background/50 rounded-none flex items-start gap-2"
                >
                  <span
                    className={`px-1 text-[9px] uppercase font-bold rounded-none ${
                      log.severity === 'error'
                        ? 'bg-rose-500/20 text-rose-400'
                        : log.severity === 'warn'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {log.severity}
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-primary font-semibold">[{log.task}]</span>
                  <span className="text-foreground flex-1 break-words">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 6. Operation Detail & Timeline Inspection Drawer */}
      <AnimatePresence>
        {selectedOperationId && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className="w-full max-w-xl bg-card border-l border-border-subtle h-full flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Drawer Header */}
              <div className="p-4 border-b border-border-subtle flex items-center justify-between bg-muted/20">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">Operation Inspection</span>
                    {operationDetailQuery.data &&
                      getStatusBadge(operationDetailQuery.data.status, operationDetailQuery.data.isStale)}
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground select-all">
                    {selectedOperationId}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 rounded-none text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedOperationId(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {operationDetailQuery.isLoading ? (
                  <p className="text-muted-foreground text-center py-10">Loading operation telemetry...</p>
                ) : !operationDetailQuery.data ? (
                  <p className="text-muted-foreground text-center py-10">Operation not found.</p>
                ) : (
                  <>
                    {/* Key Attributes Grid */}
                    <div className="grid grid-cols-2 gap-2 bg-background/60 p-3 border border-border-subtle">
                      <div>
                        <span className="text-[10px] text-muted-foreground block">Type</span>
                        <span className="font-mono font-bold text-primary">{operationDetailQuery.data.type}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block">Attempts</span>
                        <span className="font-mono text-foreground font-bold">
                          {operationDetailQuery.data.attempt} / {operationDetailQuery.data.maxAttempts}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block">Created</span>
                        <span className="font-mono text-foreground">
                          {new Date(operationDetailQuery.data.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block">Elapsed / Duration</span>
                        <span className="font-mono text-foreground">
                          {operationDetailQuery.data.durationMs
                            ? `${operationDetailQuery.data.durationMs}ms`
                            : formatElapsed(operationDetailQuery.data.startedAt)}
                        </span>
                      </div>
                      {operationDetailQuery.data.correlationId && (
                        <div className="col-span-2">
                          <span className="text-[10px] text-muted-foreground block">Correlation ID</span>
                          <span className="font-mono text-[10px] text-foreground select-all break-all">
                            {operationDetailQuery.data.correlationId}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Business Context & Deep Links */}
                    <div className="border border-border-subtle p-3 bg-muted/10 space-y-2">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                        Associated Business Context
                      </span>
                      <div className="space-y-1 text-xs">
                        {operationDetailQuery.data.campaignId && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Campaign:</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[11px] rounded-none px-1.5 text-primary flex items-center gap-1"
                              onClick={() => {
                                setSelectedOperationId(null);
                                navigate('/campaigns');
                              }}
                            >
                              <span>{operationDetailQuery.data.campaignName || operationDetailQuery.data.campaignId}</span>
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </div>
                        )}

                        {operationDetailQuery.data.contactEmail && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Recipient / Contact:</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[11px] rounded-none px-1.5 text-primary flex items-center gap-1"
                              onClick={() => {
                                setSelectedOperationId(null);
                                navigate('/crm');
                              }}
                            >
                              <span>{operationDetailQuery.data.contactEmail}</span>
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </div>
                        )}

                        {operationDetailQuery.data.deliveryId && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Email Delivery Record:</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[11px] rounded-none px-1.5 text-primary flex items-center gap-1"
                              onClick={() => {
                                setSelectedOperationId(null);
                                navigate(`/email-logs?deliveryId=${operationDetailQuery.data?.deliveryId}`);
                              }}
                            >
                              <span>View in Email Logs</span>
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Diagnostic Messages */}
                    {(operationDetailQuery.data.safeHumanMessage || operationDetailQuery.data.technicalMessage) && (
                      <div className="border border-rose-500/30 bg-rose-500/5 p-3 space-y-1.5">
                        <span className="text-[10px] uppercase font-bold text-rose-400 tracking-wider flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> Diagnostic Error Analysis
                        </span>
                        {operationDetailQuery.data.safeHumanMessage && (
                          <p className="text-xs text-foreground font-medium">
                            {operationDetailQuery.data.safeHumanMessage}
                          </p>
                        )}
                        {operationDetailQuery.data.technicalMessage && (
                          <pre className="font-mono text-[10px] text-muted-foreground bg-black/40 p-2 border border-border-subtle/40 overflow-x-auto whitespace-pre-wrap">
                            {operationDetailQuery.data.technicalMessage}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Operational Event Timeline */}
                    <div className="space-y-2 pt-2">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                        Lifecycle Event Timeline
                      </span>
                      <div className="border-l-2 border-border-subtle ml-2 pl-4 space-y-3">
                        {operationEventsQuery.data?.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">No events recorded yet.</p>
                        ) : (
                          operationEventsQuery.data?.map((ev) => (
                            <div key={ev.id} className="relative space-y-0.5">
                              {/* Timeline bullet dot */}
                              <div
                                className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card ${
                                  ev.severity === 'error'
                                    ? 'bg-rose-500'
                                    : ev.severity === 'warn'
                                      ? 'bg-amber-500'
                                      : 'bg-primary'
                                }`}
                              />
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-bold text-[11px] text-foreground">
                                  {ev.eventName}
                                </span>
                                <span className="font-mono text-[9px] text-muted-foreground">
                                  {new Date(ev.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground">{ev.message}</p>
                              {ev.details && Object.keys(ev.details).length > 0 && (
                                <pre className="font-mono text-[9px] text-muted-foreground bg-black/30 p-1.5 mt-1 border border-border-subtle/30 overflow-x-auto">
                                  {JSON.stringify(ev.details, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Drawer Footer Actions */}
              {operationDetailQuery.data && (
                <div className="p-3 border-t border-border-subtle bg-muted/20 flex items-center justify-between">
                  <div className="flex gap-2">
                    {operationDetailQuery.data.retryable && operationDetailQuery.data.status !== 'ambiguous' && (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-none h-7 text-[11px]"
                        onClick={() => retryOperationMutation.mutate({ id: operationDetailQuery.data!.id })}
                        disabled={retryOperationMutation.isPending}
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${retryOperationMutation.isPending ? 'animate-spin' : ''}`} />
                        Retry Operation
                      </Button>
                    )}

                    {operationDetailQuery.data.status === 'ambiguous' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-none h-7 text-[11px] border-amber-500 text-amber-400 hover:bg-amber-500 hover:text-black"
                        onClick={() => reconcileOperationMutation.mutate(operationDetailQuery.data!.id)}
                        disabled={reconcileOperationMutation.isPending}
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${reconcileOperationMutation.isPending ? 'animate-spin' : ''}`} />
                        Reconcile with Gmail
                      </Button>
                    )}
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-none h-7 text-[11px]"
                    onClick={() => setSelectedOperationId(null)}
                  >
                    Close
                  </Button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default OperationsCenterScreen;
