import React, { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../hooks/useWorkspace';
import { SyncCompanyRepository, SyncContactRepository } from '../repositories/sync';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Sheet, SheetContent } from '../components/ui/sheet';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Compass,
  CheckCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Globe,
  Phone,
  Mail,
  ChevronDown,
  ChevronRight,
  Search,
  Layers,
  BarChart3,
  Activity,
  Linkedin,
  UserCheck,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useProjectionRefresh } from '../hooks/useProjectionRefresh';
import {
  normalizeCountryName,
  normalizeStateName
} from '../lib/locations';
import { GeographySelector } from '../components/discovery/GeographySelector';
import { useVirtualTable } from '../hooks/useVirtualTable';
import { DiscoveryResultRow } from '../components/discovery/DiscoveryResultRow';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04
    }
  }
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 280,
      damping: 24
    }
  }
};

/**
 * DiscoveryScreen — lead discovery, job management, and results view.
 *
 * Design updates:
 *   - Squared corners: all buttons, cards, dialogs, badges, and progress rails use rounded-none.
 *   - Design System Colors: synced with primary, info, success, warning, danger.
 *   - Framer Motion: staggered card entries, table row transitions, and modal sliders.
 *   - Pagination: client-side pagination on scraper results table and job queue table.
 */
export default function DiscoveryScreen() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const queryClient = useQueryClient();
  const { refresh, isRefreshing } = useProjectionRefresh('discovery_runs');

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [jobQueueCollapsed, setJobQueueCollapsed] = useState(false);

  const [jobName, setJobName] = useState('');
  const [jobQuery, setJobQuery] = useState('');
  const [country, setCountry] = useState('');
  const [stateName, setStateName] = useState('');
  const [city, setCity] = useState('');
  const [maxResults, setMaxResults] = useState(20);

  // Pagination states
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(25);

  const [jobsPage, setJobsPage] = useState(1);
  const [jobsPerPage] = useState(10);

  // Reset pagination on selection changes
  useEffect(() => {
    setResultsPage(1);
  }, [selectedJobId]);

  const handleResultsPageChange = useCallback((page: number) => {
    setResultsPage(page);
  }, []);

  const handleJobsPageChange = useCallback((page: number) => {
    setJobsPage(page);
  }, []);

  const cachedJobs = (queryClient.getQueryData(['scheduler_jobs', 'list', workspaceId]) || []) as any[];
  const cachedRuns = (queryClient.getQueryData(['discovery_runs', 'list', workspaceId]) || []) as any[];
  const hasActiveWork =
    cachedJobs.some((j: any) =>
      ['running', 'queued', 'retrying', 'starting', 'pending'].includes(String(j.status || '').toLowerCase())
    ) ||
    cachedRuns.some((r: any) =>
      ['running', 'queued', 'retrying', 'starting', 'pending'].includes(String(r.status || '').toLowerCase())
    );

  const jobsQuery = useQuery({
    queryKey: ['scheduler_jobs', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return window.ipc.invoke('scheduler:jobs:list', { workspaceId });
    },
    enabled: !!workspaceId,
    refetchInterval: hasActiveWork ? 4000 : false
  });

  const discoveryRunsQuery = useQuery({
    queryKey: ['discovery_runs', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return window.ipc.invoke('discovery:run:list', { workspaceId });
    },
    enabled: !!workspaceId,
    refetchInterval: hasActiveWork ? 4000 : false
  });

  const companiesQuery = useQuery({
    queryKey: ['companies', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return SyncCompanyRepository.listAndSync(workspaceId);
    },
    enabled: !!workspaceId,
    refetchInterval: hasActiveWork ? 3000 : false
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return SyncContactRepository.listAndSync(workspaceId);
    },
    enabled: !!workspaceId,
    refetchInterval: hasActiveWork ? 3000 : false
  });

  const createRunMutation = useMutation({
    mutationFn: async (payload: { name?: string; query: string; country?: string; state?: string; city?: string; maxResults: number }) => {
      const reqPayload: any = {
        workspaceId,
        query: payload.query,
        maxResults: payload.maxResults
      };
      if (payload.name) reqPayload.name = payload.name;
      if (payload.country) reqPayload.country = payload.country;
      if (payload.state) reqPayload.state = payload.state;
      if (payload.city) reqPayload.city = payload.city;
      return window.ipc.invoke('discovery:run:create', reqPayload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduler_jobs', 'list', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['discovery_runs', 'list', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['companies', 'list', workspaceId] });
      setCreateOpen(false);
      setJobName('');
      setJobQuery('');
      setCountry('');
      setStateName('');
      setCity('');
      setMaxResults(20);
    }
  });

  const enrichCompanyMutation = useMutation({
    mutationFn: async (payload: { companyId: string; website: string }) => {
      return window.ipc.invoke('scheduler:jobs:submit', {
        workspaceId,
        type: 'crawler:website',
        payload: {
          companyId: payload.companyId,
          website: payload.website,
          maxDepth: 2,
          maxPages: 10
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduler_jobs', 'list', workspaceId] });
    }
  });

  const enrichLinkedInMutation = useMutation({
    mutationFn: async (payload: { companyId: string; companyName: string; domain?: string }) => {
      return window.ipc.invoke('scheduler:jobs:submit', {
        workspaceId,
        type: 'enrich:linkedin',
        payload
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduler_jobs', 'list', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['contacts', 'list', workspaceId] });
    }
  });

  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return window.ipc.invoke('scheduler:jobs:cancel', { workspaceId, jobId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduler_jobs', 'list', workspaceId] });
    }
  });

  const [runToDelete, setRunToDelete] = useState<any | null>(null);

  const deleteRunMutation = useMutation({
    mutationFn: async (id: string) => {
      return window.ipc.invoke('discovery:run:delete', { workspaceId, id });
    },
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['discovery_runs', 'list', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['scheduler_jobs', 'list', workspaceId] });
      if (selectedJobId === deletedId) {
        setSelectedJobId(null);
      }
      setRunToDelete(null);
      toast.success('Discovery run deleted.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to delete discovery run');
    }
  });



  const handleCreateJob = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!jobQuery.trim()) {
      toast.error('Please enter a target business keyword or category (e.g. HVAC contractors).');
      return;
    }
    if (!country.trim()) {
      toast.error('Please select a target Country.');
      return;
    }
    if (!stateName.trim()) {
      toast.error('Please select or enter a target State / Region.');
      return;
    }

    const cleanCountryInput = country.replace(/\s*\([A-Z0-9-]+\)$/i, '').trim();
    const canonicalCountry = normalizeCountryName(cleanCountryInput) || cleanCountryInput;
    const cleanStateInput = stateName.replace(/\s*\([A-Z0-9-]+\)$/i, '').trim();
    const canonicalState = normalizeStateName(cleanStateInput, canonicalCountry) || cleanStateInput;
    const canonicalCity = city.trim();

    createRunMutation.mutate({
      name: jobName,
      query: jobQuery,
      country: canonicalCountry,
      state: canonicalState,
      city: canonicalCity,
      maxResults
    });
  }, [jobName, jobQuery, country, stateName, city, maxResults, createRunMutation]);

  const allJobs = (jobsQuery.data || []) as any[];
  const rawDiscoveryRuns = (discoveryRunsQuery.data || []) as any[];
  const existingCompanies = (companiesQuery.data || []) as any[];
  const existingContacts = (contactsQuery.data || []) as any[];

  // Helper to safely parse job payloads regardless of string vs object serialization
  const safeParsePayload = (payload: any) => {
    if (!payload) return {};
    if (typeof payload === 'object') return payload;
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  };

  // Build canonical Discovery Runs array sourced EXCLUSIVELY from discovery_runs domain records
  const discoveryRunsList = React.useMemo(() => {
    return rawDiscoveryRuns.map((run: any) => {
      const linkedJobs = allJobs.filter((j) => {
        const p = safeParsePayload(j.payload);
        return p.discoveryRunId === run.id;
      });

      const mapsJob = linkedJobs.find((j) => j.type === 'scraper:maps') || linkedJobs[0];
      const isJobRunning = mapsJob && ['running', 'queued', 'retrying'].includes(mapsJob.status);
      const status = isJobRunning ? mapsJob.status : (run.status || (mapsJob?.status ?? 'completed'));
      const progress = isJobRunning ? (mapsJob.progress || 0) : (status === 'completed' ? 100 : 0);

      return {
        id: run.id,
        name: run.name || run.query,
        query: run.query,
        location: [run.city, run.state, run.country].filter(Boolean).join(', '),
        status,
        progress,
        resultCount: run.resultCount ?? 0,
        mapsJobId: mapsJob?.id || run.id,
        linkedJobs,
        createdAt: run.createdAt
      };
    }).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [rawDiscoveryRuns, allJobs]);

  const selectedRun = discoveryRunsList.find((r) => r.id === selectedJobId || r.mapsJobId === selectedJobId);
  const isSelectedRunActive = selectedRun
    ? ['running', 'queued', 'retrying', 'starting', 'pending'].includes(String(selectedRun.status || '').toLowerCase())
    : false;

  const selectedRunCompaniesQuery = useQuery({
    queryKey: ['discovery_run_companies', workspaceId, selectedJobId],
    queryFn: async () => {
      if (!workspaceId || !selectedJobId) return [];
      const run = discoveryRunsList.find((r) => r.id === selectedJobId || r.mapsJobId === selectedJobId);
      const targetRunId = run?.id || selectedJobId;
      return window.ipc.invoke('discovery:run:companies', { workspaceId, runId: targetRunId });
    },
    enabled: !!workspaceId && !!selectedJobId,
    refetchInterval: isSelectedRunActive ? 2500 : false
  });

  const crawlerJobs = allJobs.filter((j) => j.type === 'crawler:website');
  const runningCrawlers = crawlerJobs.filter((j) =>
    ['running', 'queued', 'retrying'].includes(j.status)
  ).length;
  const completedCrawlers = crawlerJobs.filter((j) => j.status === 'completed').length;

  const selectedQuery = (selectedRun?.query || '').toLowerCase().trim();

  // Scraper results matching the active query or discovery run
  const runCompanies = (selectedRunCompaniesQuery.data || []) as any[];
  const results = React.useMemo(() => {
    if (selectedJobId) {
      return runCompanies;
    }
    return existingCompanies;
  }, [selectedJobId, runCompanies, existingCompanies]);

  const runningJobs = discoveryRunsList.filter((r) =>
    ['running', 'queued', 'retrying'].includes(r.status)
  ).length;

  const statusColor = (status: string) => {
    if (status === 'completed') return 'bg-success-muted text-success border-success/20';
    if (status === 'running') return 'bg-info-muted text-info border-info/20';
    if (status === 'retrying') return 'bg-warning-muted text-warning border-warning/20';
    if (status === 'cancelled' || status === 'failed')
      return 'bg-danger-muted text-danger border-danger/20';
    return 'bg-muted-muted text-muted-foreground border-border-subtle';
  };

  // Memoized contacts grouping by companyId for O(1) row resolution
  const contactsByCompanyId = React.useMemo(() => {
    const map = new Map<string, any[]>();
    for (const ct of existingContacts) {
      if (ct.companyId) {
        let arr = map.get(ct.companyId);
        if (!arr) {
          arr = [];
          map.set(ct.companyId, arr);
        }
        arr.push(ct);
      }
    }
    return map;
  }, [existingContacts]);

  // Stable row action callbacks
  const handleCrawl = useCallback((companyId: string, website: string) => {
    enrichCompanyMutation.mutate({ companyId, website });
  }, [enrichCompanyMutation]);

  const handleExecs = useCallback((companyId: string, companyName: string, domain?: string | undefined) => {
    enrichLinkedInMutation.mutate(
      domain ? { companyId, companyName, domain } : { companyId, companyName }
    );
  }, [enrichLinkedInMutation]);

  // Pagination calculation: Scraper results
  const totalResults = results.length;
  const isAllResultsPages = resultsPerPage === -1;
  const totalResultsPages = isAllResultsPages ? 1 : Math.ceil(totalResults / resultsPerPage);
  const adjustedResultsPage = isAllResultsPages ? 1 : Math.min(Math.max(1, resultsPage), totalResultsPages || 1);
  const resultsStartIndex = isAllResultsPages ? 0 : (adjustedResultsPage - 1) * resultsPerPage;
  const paginatedResults = isAllResultsPages ? results : results.slice(resultsStartIndex, resultsStartIndex + resultsPerPage);

  const {
    containerRef: resultsContainerRef,
    virtualIndices: resultsVirtualIndices,
    topSpacerHeight: resultsTopSpacerHeight,
    bottomSpacerHeight: resultsBottomSpacerHeight
  } = useVirtualTable({
    count: paginatedResults.length,
    estimateRowHeight: 52,
    overscan: 6
  });

  // Pagination calculation: Discovery Runs list
  const totalParentJobs = discoveryRunsList.length;
  const totalJobsPages = Math.ceil(totalParentJobs / jobsPerPage);
  const adjustedJobsPage = Math.min(Math.max(1, jobsPage), totalJobsPages || 1);
  const jobsStartIndex = (adjustedJobsPage - 1) * jobsPerPage;
  const paginatedJobs = discoveryRunsList.slice(jobsStartIndex, jobsStartIndex + jobsPerPage);

  return (
    <div className="flex flex-col gap-5 text-xs font-sans min-h-full pr-1 select-none pb-8">
      <PageHeader
        title="Discovery Platform"
        description="Scrape Google Maps leads, enrich contacts, and import directly into your CRM."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isRefreshing}
              className="h-8 text-xs font-semibold gap-1.5 rounded-none border-border-subtle bg-card text-foreground hover:bg-surface-3"
              title="Refresh discovery runs from server"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </Button>
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              size="sm"
              className="h-8 font-semibold gap-1.5 shrink-0 rounded-none"
            >
              <Plus className="w-3.5 h-3.5" />
              New Discovery Run
            </Button>
          </div>
        }
      />

      {/* Stats row with Framer Motion entry animations */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        {[
          { label: 'Discovery Runs', value: discoveryRunsList.length, Icon: Search, color: 'text-primary' },
          { label: 'Active Runs', value: runningJobs, Icon: Activity, color: 'text-info' },
          {
            label: 'Companies Found',
            value: existingCompanies.length,
            Icon: Layers,
            color: 'text-success'
          },
          {
            label: 'Site Crawlers',
            value: runningCrawlers > 0 ? `${runningCrawlers} active` : `${completedCrawlers} done`,
            Icon: Globe,
            color: 'text-primary'
          }
        ].map((w, i) => (
          <motion.div
            key={i}
            variants={cardVariants}
            className="bg-card border border-border-subtle rounded-none p-3 flex items-start gap-2.5 shadow-sm"
          >
            <div className={`mt-0.5 ${w.color}`}>
              <w.Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold text-foreground leading-tight font-mono">{w.value}</div>
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide block font-semibold mt-0.5">
                {w.label}
              </span>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* RESULTS PANEL — bottom-sliding sheet overlay */}
      <Sheet open={!!selectedJobId} onOpenChange={(isOpen) => { if (!isOpen) setSelectedJobId(null); }}>
        <SheetContent side="bottom" className="max-h-[70dvh] border-t border-border-subtle bg-card shadow-2xl p-0 flex flex-col rounded-none">
          {selectedJobId && (
            <div className="flex flex-col h-full min-h-0 text-xs font-sans">
              <div className="px-4 py-3 border-b border-border-subtle flex flex-wrap gap-2 justify-between items-center bg-primary/5 sticky top-0 z-10 backdrop-blur-md">
                <h3 className="font-bold text-foreground uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-primary" />
                  Results —{' '}
                  <span className="font-mono text-primary normal-case">
                    {selectedQuery || 'All companies'}
                  </span>
                  <Badge
                    variant="outline"
                    className="ml-1 text-[9px] h-4 px-1.5 border-primary/30 text-primary rounded-none"
                  >
                    {results.length}
                  </Badge>
                </h3>
                <div className="flex items-center gap-2 pr-8">
                  {selectedRun?.status === 'running' && (
                    <span className="text-[9px] text-info flex items-center gap-1 animate-pulse">
                      <Activity className="w-3.5 h-3.5" /> Scraping live...
                    </span>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 pt-0">
                {(companiesQuery.isLoading || (selectedJobId && selectedRunCompaniesQuery.isLoading)) ? (
                  <div className="p-8 text-center text-muted-foreground animate-pulse">Loading scraper database...</div>
                ) : results.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    {selectedRun?.status === 'running'
                      ? 'Scraper is running — results will appear here...'
                      : 'No leads found for this query.'}
                  </div>
                ) : (
                  <div className="flex flex-col justify-between h-full pt-4 space-y-4">
                    <div
                      ref={resultsContainerRef}
                      className="border border-border-subtle rounded-none overflow-y-auto max-h-[calc(100vh-340px)] min-h-[300px]"
                    >
                      <table className="table-fixed w-full text-left border-collapse min-w-[640px]">
                        <thead className="sticky top-0 z-10 bg-surface-3 shadow-sm">
                          <tr className="bg-surface-3 border-b border-border-subtle text-[9px] font-bold text-muted-foreground uppercase tracking-wider select-none h-10">
                            <th className="px-4 py-2.5 w-[24%]">Company</th>
                            <th className="px-4 py-2.5 w-[18%]">Website</th>
                            <th className="px-4 py-2.5 w-[14%]">Phone</th>
                            <th className="px-4 py-2.5 w-[16%]">Location</th>
                            <th className="px-4 py-2.5 w-[18%]">Contacts / Emails</th>
                            <th className="px-4 py-2.5 w-[10%] text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultsTopSpacerHeight > 0 && (
                            <tr
                              style={{ height: `${resultsTopSpacerHeight}px`, maxHeight: `${resultsTopSpacerHeight}px` }}
                              aria-hidden="true"
                              className="p-0 m-0 border-0 pointer-events-none"
                            >
                              <td
                                colSpan={6}
                                style={{ height: `${resultsTopSpacerHeight}px`, maxHeight: `${resultsTopSpacerHeight}px`, padding: 0, border: 'none', lineHeight: 0, fontSize: 0 }}
                                className="p-0 m-0 border-0 pointer-events-none"
                              />
                            </tr>
                          )}
                          {resultsVirtualIndices.map((idx) => {
                            const res = paginatedResults[idx];
                            if (!res) return null;
                            const companyContacts = contactsByCompanyId.get(res.id) || [];

                            return (
                              <DiscoveryResultRow
                                key={res.id}
                                company={res}
                                companyContacts={companyContacts}
                                onCrawl={handleCrawl}
                                onExecs={handleExecs}
                                isCrawlPending={enrichCompanyMutation.isPending}
                                isExecsPending={enrichLinkedInMutation.isPending}
                              />
                            );
                          })}
                          {resultsBottomSpacerHeight > 0 && (
                            <tr
                              style={{ height: `${resultsBottomSpacerHeight}px`, maxHeight: `${resultsBottomSpacerHeight}px` }}
                              aria-hidden="true"
                              className="p-0 m-0 border-0 pointer-events-none"
                            >
                              <td
                                colSpan={6}
                                style={{ height: `${resultsBottomSpacerHeight}px`, maxHeight: `${resultsBottomSpacerHeight}px`, padding: 0, border: 'none', lineHeight: 0, fontSize: 0 }}
                                className="p-0 m-0 border-0 pointer-events-none"
                              />
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Results table pagination controls */}
                    {(totalResultsPages > 1 || totalResults > 10) && (
                      <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-2 select-none px-1">
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-muted-foreground">
                            Showing{' '}
                            <strong className="text-foreground font-mono">{totalResults === 0 ? 0 : resultsStartIndex + 1}</strong>{' '}
                            to{' '}
                            <strong className="text-foreground font-mono">
                              {isAllResultsPages ? totalResults : Math.min(resultsStartIndex + resultsPerPage, totalResults)}
                            </strong>{' '}
                            of <strong className="text-foreground font-mono">{totalResults}</strong> companies
                          </span>

                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span>Show:</span>
                            {[25, 50, 100, 250].map((size) => (
                              <button
                                key={size}
                                type="button"
                                onClick={() => {
                                  setResultsPerPage(size);
                                  handleResultsPageChange(1);
                                }}
                                className={`px-1.5 py-0.5 font-mono text-[10px] rounded-none border ${
                                  resultsPerPage === size
                                    ? 'bg-primary text-primary-foreground border-primary font-bold'
                                    : 'border-border-subtle hover:bg-surface-3'
                                }`}
                              >
                                {size}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setResultsPerPage(-1);
                                handleResultsPageChange(1);
                              }}
                              className={`px-1.5 py-0.5 font-mono text-[10px] rounded-none border ${
                                resultsPerPage === -1
                                  ? 'bg-primary text-primary-foreground border-primary font-bold'
                                  : 'border-border-subtle hover:bg-surface-3'
                              }`}
                            >
                              All
                            </button>
                          </div>
                        </div>

                        {totalResultsPages > 1 && (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleResultsPageChange(Math.max(1, resultsPage - 1));
                              }}
                              disabled={adjustedResultsPage === 1}
                              className="h-8 rounded-none px-3 text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              Previous
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleResultsPageChange(Math.min(totalResultsPages, resultsPage + 1));
                              }}
                              disabled={adjustedResultsPage === totalResultsPages}
                              className="h-8 rounded-none px-3 text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              Next
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* JOB QUEUE — collapsible list */}
      <div className="bg-card border border-border-subtle rounded-none overflow-hidden shadow-sm">
        <div
          className="px-4 py-3 border-b border-border-subtle flex items-center justify-between cursor-pointer hover:bg-surface-3/45 transition-colors"
          onClick={() => setJobQueueCollapsed((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-foreground uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
              Job Queue
            </h3>
            {runningJobs > 0 && (
              <Badge
                variant="outline"
                className="text-[9px] h-4 px-1.5 bg-info-muted text-info border border-info/20 animate-pulse rounded-none"
              >
                {runningJobs} active
              </Badge>
            )}
            {crawlerJobs.length > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-muted-foreground rounded-none">
                +{crawlerJobs.length} crawler{crawlerJobs.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                jobsQuery.refetch();
              }}
              className="w-6 h-6 p-0 text-muted-foreground rounded-none"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
            {jobQueueCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
        </div>

        {!jobQueueCollapsed && (
          <>
            {discoveryRunsList.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No discovery searches launched yet. Click <strong>"New Discovery Run"</strong> to
                begin.
              </div>
            ) : (
              <div className="flex flex-col justify-between">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[560px]">
                    <thead>
                      <tr className="bg-surface-3/40 text-[9px] font-bold text-muted-foreground uppercase border-b border-border-subtle tracking-wider">
                        <th className="px-4 py-2.5">Discovery Run</th>
                        <th className="px-4 py-2.5">Search Query & Location</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 w-40">Progress</th>
                        <th className="px-4 py-2.5">Child Crawlers</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle/50">
                      <AnimatePresence initial={false}>
                        {paginatedJobs.map((run: any) => {
                          const isSelected = selectedJobId === run.id || selectedJobId === run.mapsJobId;
                          const displayName = run.name || run.query;
                          const queryStr = run.location ? `${run.query} (${run.location})` : run.query;
                          const isRunnable = ['queued', 'running', 'retrying'].includes(run.status);

                          return (
                            <motion.tr
                              key={run.id}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              onClick={() => setSelectedJobId(isSelected ? null : run.id)}
                              className={`hover:bg-surface-3/45 cursor-pointer transition-colors ${isSelected ? 'bg-primary/12' : ''}`}
                            >
                              <td className="px-4 py-3 font-semibold text-foreground">
                                {displayName}
                              </td>
                              <td className="px-4 py-3 font-mono text-primary text-[10px]">
                                {queryStr}
                              </td>
                              <td className="px-4 py-3">
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] font-bold uppercase rounded-none ${statusColor(run.status)}`}
                                >
                                  {run.status}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 w-44">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 bg-surface-3 rounded-none h-1.5 overflow-hidden border border-border-subtle">
                                    <div
                                      className="bg-primary h-full transition-all duration-300 rounded-none"
                                      style={{ width: `${run.progress || 0}%` }}
                                    />
                                  </div>
                                  <span className="font-mono text-[10px] text-muted-foreground w-8 shrink-0">
                                    {run.progress || 0}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-muted-foreground text-[10px]">
                                {(() => {
                                  const childCrawlers = crawlerJobs.filter((cj) => {
                                    const p = safeParsePayload(cj.payload);
                                    return p.discoveryRunId === run.id || p.parentJobId === run.id || p.parentJobId === run.mapsJobId;
                                  });
                                  const activeChildCount = childCrawlers.filter((cj) => ['running', 'queued', 'retrying'].includes(cj.status)).length;
                                  const doneChildCount = childCrawlers.filter((cj) => cj.status === 'completed').length;
                                  if (activeChildCount > 0) {
                                    return <span className="text-info animate-pulse">{activeChildCount} active</span>;
                                  }
                                  if (doneChildCount > 0) {
                                    return <span className="text-success font-semibold">{doneChildCount} completed</span>;
                                  }
                                  return <span className="opacity-40">—</span>;
                                })()}
                              </td>
                              <td className="px-4 py-3 text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                                {isRunnable ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      cancelJobMutation.mutate(run.mapsJobId || run.id);
                                    }}
                                    disabled={cancelJobMutation.isPending}
                                    className="h-6 text-[10px] text-danger border-danger/20 hover:bg-danger-muted rounded-none"
                                  >
                                    Cancel
                                  </Button>
                                ) : (
                                  <div className="inline-flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className={`h-6 text-[10px] gap-1 rounded-none ${isSelected ? 'text-primary' : ''}`}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setSelectedJobId(isSelected ? null : run.id);
                                      }}
                                    >
                                      {isSelected ? <CheckCircle className="w-3 h-3 text-primary" /> : null}
                                      {isSelected ? 'Showing' : 'View Results'}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 text-[10px] text-muted-foreground hover:text-danger hover:bg-danger/10 rounded-none px-2"
                                      title="Delete discovery run"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setRunToDelete(run);
                                      }}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </motion.tr>
                          );
                        })}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>

                {/* Job queue table pagination controls */}
                {totalJobsPages > 1 && (
                  <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-2 select-none px-4 pb-4">
                    <span className="text-[11px] text-muted-foreground">
                      Showing{' '}
                      <strong className="text-foreground font-mono">{jobsStartIndex + 1}</strong>{' '}
                      to{' '}
                      <strong className="text-foreground font-mono">
                        {Math.min(jobsStartIndex + jobsPerPage, totalParentJobs)}
                      </strong>{' '}
                      of <strong className="text-foreground font-mono">{totalParentJobs}</strong> jobs
                    </span>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleJobsPageChange(Math.max(1, jobsPage - 1));
                        }}
                        disabled={adjustedJobsPage === 1}
                        className="h-8 rounded-none px-3 text-[11px] font-semibold transition-colors cursor-pointer"
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleJobsPageChange(Math.min(totalJobsPages, jobsPage + 1));
                        }}
                        disabled={adjustedJobsPage === totalJobsPages}
                        className="h-8 rounded-none px-3 text-[11px] font-semibold transition-colors cursor-pointer"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* CREATION MODAL */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md rounded-none bg-background border border-border-subtle shadow-elevation-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-primary" />
              Launch Discovery Run
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateJob} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="jobQuery" className="text-xs font-semibold">
                What are you looking for? <span className="text-danger">*</span>
              </Label>
              <Input
                id="jobQuery"
                placeholder="e.g. HVAC Contractors, Plumbing Companies"
                value={jobQuery}
                onChange={(e) => setJobQuery(e.target.value)}
                required
                className="rounded-none bg-card border-border-subtle font-mono text-xs"
              />
            </div>

            <GeographySelector
              country={country}
              state={stateName}
              city={city}
              onCountryChange={setCountry}
              onStateChange={setStateName}
              onCityChange={setCity}
              required
            />

            <div className="space-y-1">
              <Label htmlFor="jobName" className="text-xs font-semibold">
                Discovery Run Name <span className="text-muted-foreground font-normal">(Optional)</span>
              </Label>
              <Input
                id="jobName"
                placeholder="Auto-derived if empty (e.g. HVAC Contractors in Miami)"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                className="rounded-none bg-card border-border-subtle"
              />
            </div>

            <div className="space-y-2 pt-1">
              <Label
                htmlFor="maxResults"
                className="text-xs font-semibold flex items-center justify-between"
              >
                <span>Max Leads to Scrape</span>
                <span className="font-mono text-primary text-sm font-bold">{maxResults}</span>
              </Label>
              <input
                id="maxResults"
                type="range"
                min={5}
                max={100}
                step={5}
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                className="w-full h-1.5 cursor-pointer bg-surface-3 rounded-none outline-none border border-border-subtle accent-primary"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                <span>5 (fast)</span>
                <span>20 (default)</span>
                <span>100 (deep)</span>
              </div>
            </div>

            <div className="bg-surface-3 border border-border-subtle rounded-none p-3 text-[10px] text-muted-foreground space-y-1">
              <div className="font-semibold text-foreground">What happens next</div>
              <div>
                ① Google Maps is scraped for up to{' '}
                <strong className="text-foreground">{maxResults}</strong> matching businesses
              </div>
              <div>② Each company website is auto-crawled for email contacts</div>
              <div>③ All leads are saved directly to your CRM with provenance linked</div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreateOpen(false)}
                size="sm"
                className="rounded-none"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createRunMutation.isPending}
                size="sm"
                className="gap-1.5 rounded-none"
              >
                <Compass className="w-3.5 h-3.5" />
                {createRunMutation.isPending ? 'Launching...' : 'Start Discovery'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Discovery Run Confirmation Dialog */}
      <Dialog open={!!runToDelete} onOpenChange={(open) => !open && setRunToDelete(null)}>
        <DialogContent className="max-w-md rounded-none bg-background border border-border-subtle shadow-elevation-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-danger">
              <AlertTriangle className="w-5 h-5 text-danger" />
              Delete Discovery Run
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-foreground/80">
            <p>
              Are you sure you want to delete discovery run{' '}
              <strong className="text-foreground">{runToDelete?.name}</strong>?
            </p>
            <div className="p-3 bg-muted/40 border border-border-subtle text-xs space-y-1.5">
              <p className="font-semibold text-foreground">What will happen:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>The discovery run history will be removed.</li>
                <li>Associated run-specific jobs and provenance links will be cleaned up.</li>
                <li>
                  <strong className="text-foreground">Canonical companies and contacts will NOT be deleted</strong> and remain safe in your CRM.
                </li>
              </ul>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-none"
              onClick={() => setRunToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-none gap-1.5"
              disabled={deleteRunMutation.isPending}
              onClick={() => {
                if (runToDelete) {
                  deleteRunMutation.mutate(runToDelete.id);
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleteRunMutation.isPending ? 'Deleting...' : 'Delete Run'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
