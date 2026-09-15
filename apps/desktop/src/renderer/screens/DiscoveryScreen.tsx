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
  COUNTRIES,
  getStatesForCountry,
  getCitiesForState,
  normalizeCountryName,
  normalizeStateName
} from '../lib/locations';

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
  const [resultsPerPage] = useState(10);

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

  const jobsQuery = useQuery({
    queryKey: ['scheduler_jobs', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return window.ipc.invoke('scheduler:jobs:list', { workspaceId });
    },
    enabled: !!workspaceId,
    refetchInterval: 5000
  });

  const discoveryRunsQuery = useQuery({
    queryKey: ['discovery_runs', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return window.ipc.invoke('discovery:run:list', { workspaceId });
    },
    enabled: !!workspaceId,
    refetchInterval: 5000
  });

  const companiesQuery = useQuery({
    queryKey: ['companies', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return SyncCompanyRepository.listAndSync(workspaceId);
    },
    enabled: !!workspaceId,
    refetchInterval: 2000
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return SyncContactRepository.listAndSync(workspaceId);
    },
    enabled: !!workspaceId,
    refetchInterval: 2000
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

  const availableStates = React.useMemo(() => {
    return getStatesForCountry(country);
  }, [country]);

  const availableCities = React.useMemo(() => {
    return getCitiesForState(country, stateName);
  }, [country, stateName]);

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

  const selectedRunCompaniesQuery = useQuery({
    queryKey: ['discovery_run_companies', workspaceId, selectedJobId],
    queryFn: async () => {
      if (!workspaceId || !selectedJobId) return [];
      const run = discoveryRunsList.find((r) => r.id === selectedJobId || r.mapsJobId === selectedJobId);
      const targetRunId = run?.id || selectedJobId;
      return window.ipc.invoke('discovery:run:companies', { workspaceId, runId: targetRunId });
    },
    enabled: !!workspaceId && !!selectedJobId,
    refetchInterval: 2500
  });

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

  const crawlerJobs = allJobs.filter((j) => j.type === 'crawler:website');
  const runningCrawlers = crawlerJobs.filter((j) =>
    ['running', 'queued', 'retrying'].includes(j.status)
  ).length;
  const completedCrawlers = crawlerJobs.filter((j) => j.status === 'completed').length;

  const selectedRun = discoveryRunsList.find((r) => r.id === selectedJobId || r.mapsJobId === selectedJobId);
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

  // Pagination calculation: Scraper results
  const totalResults = results.length;
  const totalResultsPages = Math.ceil(totalResults / resultsPerPage);
  const adjustedResultsPage = Math.min(Math.max(1, resultsPage), totalResultsPages || 1);
  const resultsStartIndex = (adjustedResultsPage - 1) * resultsPerPage;
  const paginatedResults = results.slice(resultsStartIndex, resultsStartIndex + resultsPerPage);

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
                {companiesQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground animate-pulse">Loading scraper database...</div>
                ) : results.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    {selectedRun?.status === 'running'
                      ? 'Scraper is running — results will appear here...'
                      : 'No leads found for this query.'}
                  </div>
                ) : (
                  <div className="flex flex-col justify-between h-full pt-4 space-y-4">
                    <div className="border border-border-subtle rounded-none overflow-hidden">
                      <table className="w-full text-left border-collapse min-w-[640px]">
                        <thead>
                          <tr className="bg-surface-3 border-b border-border-subtle text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                            <th className="px-4 py-2.5">Company</th>
                            <th className="px-4 py-2.5">Website</th>
                            <th className="px-4 py-2.5">Phone</th>
                            <th className="px-4 py-2.5">Location</th>
                            <th className="px-4 py-2.5">Contacts / Emails</th>
                            <th className="px-4 py-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <motion.tbody
                          className="divide-y divide-border-subtle/50"
                          initial="hidden"
                          animate="visible"
                          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
                        >
                          <AnimatePresence initial={false}>
                            {paginatedResults.map((res) => {
                              const companyContacts = existingContacts.filter(
                                (ct) => ct.companyId === res.id
                              );
                              const emailContacts = companyContacts.filter((ct) => ct.email);
                              const primaryEmail = emailContacts[0]?.email;

                              return (
                                <motion.tr
                                  key={res.id}
                                  initial={{ opacity: 0, y: 4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0 }}
                                  className="hover:bg-surface-3/45 transition-colors"
                                >
                                  <td className="px-4 py-3">
                                    <div className="font-semibold text-foreground leading-snug">
                                      {res.name}
                                    </div>
                                    {res.rating != null && (
                                      <span className="text-[9px] text-warning font-mono">★ {res.rating}</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 max-w-[160px]">
                                    {res.website ? (
                                      <a
                                        href={res.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-mono text-primary hover:underline truncate block text-[10px]"
                                      >
                                        {res.domain || res.website}
                                      </a>
                                    ) : (
                                      <span className="opacity-40">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-muted-foreground font-mono whitespace-nowrap">
                                    {res.phone || <span className="opacity-40">—</span>}
                                  </td>
                                  <td className="px-4 py-3 text-muted-foreground max-w-[180px]">
                                    <span className="truncate block">
                                      {res.location || <span className="opacity-40">—</span>}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    {(() => {
                                      const execContacts = companyContacts.filter(
                                        (ct) => ct.type === 'executive' || ct.source === 'linkedin' || !!ct.linkedinUrl
                                      );
                                      return (
                                        <div className="flex flex-col gap-1 items-start">
                                          {emailContacts.length > 0 && (
                                            <Badge
                                              variant="outline"
                                              className="bg-info-muted text-info border border-info/20 font-bold text-[9px] rounded-none"
                                            >
                                              <Mail className="w-2.5 h-2.5 mr-1" />
                                              {emailContacts.length} email
                                              {emailContacts.length > 1 ? 's' : ''} · {primaryEmail}
                                            </Badge>
                                          )}
                                          {execContacts.length > 0 && (
                                            <Badge
                                              variant="outline"
                                              className="bg-primary/10 text-primary border border-primary/20 font-bold text-[9px] rounded-none"
                                            >
                                              <UserCheck className="w-2.5 h-2.5 mr-1" />
                                              {execContacts.length} Exec{execContacts.length > 1 ? 's' : ''} (
                                              {execContacts[0].firstName} {execContacts[0].lastName || ''})
                                            </Badge>
                                          )}
                                          {emailContacts.length === 0 &&
                                            execContacts.length === 0 &&
                                            companyContacts.length > 0 && (
                                              <Badge
                                                variant="outline"
                                                className="bg-success-muted text-success border border-success/20 font-bold text-[9px] rounded-none"
                                              >
                                                <Phone className="w-2.5 h-2.5 mr-1" />
                                                Phone saved
                                              </Badge>
                                            )}
                                          {companyContacts.length === 0 && (
                                            <span className="opacity-40 text-[10px]">No contacts found</span>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-1.5">
                                      {res.website && (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          onClick={() =>
                                            enrichCompanyMutation.mutate({
                                              companyId: res.id,
                                              website: res.website
                                            })
                                          }
                                          disabled={enrichCompanyMutation.isPending}
                                          title="Crawl website for email addresses"
                                          className="h-6 text-[10px] gap-1 font-semibold border-primary/20 text-primary hover:bg-primary/10 rounded-none"
                                        >
                                          <Sparkles className="w-3 h-3" />
                                          Crawl
                                        </Button>
                                      )}
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          enrichLinkedInMutation.mutate({
                                            companyId: res.id,
                                            companyName: res.name,
                                            domain: res.domain
                                          })
                                        }
                                        disabled={enrichLinkedInMutation.isPending}
                                        title="Scrape executive decision makers"
                                        className="h-6 text-[10px] gap-1 font-semibold border-info/20 text-info hover:bg-info/10 rounded-none"
                                      >
                                        <Linkedin className="w-3 h-3" />
                                        Execs
                                      </Button>
                                    </div>
                                  </td>
                                </motion.tr>
                              );
                            })}
                          </AnimatePresence>
                        </motion.tbody>
                      </table>
                    </div>

                    {/* Results table pagination controls */}
                    {totalResultsPages > 1 && (
                      <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-2 select-none px-1">
                        <span className="text-[11px] text-muted-foreground">
                          Showing{' '}
                          <strong className="text-foreground font-mono">{resultsStartIndex + 1}</strong>{' '}
                          to{' '}
                          <strong className="text-foreground font-mono">
                            {Math.min(resultsStartIndex + resultsPerPage, totalResults)}
                          </strong>{' '}
                          of <strong className="text-foreground font-mono">{totalResults}</strong> companies
                        </span>

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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="country" className="text-xs font-semibold">
                  Country <span className="text-danger">*</span>
                </Label>
                <Input
                  id="country"
                  list="countries-datalist"
                  placeholder="e.g. United States"
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    setStateName('');
                    setCity('');
                  }}
                  required
                  className="rounded-none bg-card border-border-subtle text-xs"
                />
                <datalist id="countries-datalist">
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.name}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <Label htmlFor="stateName" className="text-xs font-semibold">
                  State / Region <span className="text-danger">*</span>
                </Label>
                <Input
                  id="stateName"
                  list="states-datalist"
                  placeholder={country ? "e.g. Florida" : "Select Country first"}
                  value={stateName}
                  disabled={!country}
                  onChange={(e) => {
                    setStateName(e.target.value);
                    setCity('');
                  }}
                  required
                  className="rounded-none bg-card border-border-subtle text-xs disabled:opacity-50"
                />
                <datalist id="states-datalist">
                  {availableStates.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <Label htmlFor="city" className="text-xs font-semibold">
                  City <span className="text-muted-foreground font-normal">(Optional)</span>
                </Label>
                <Input
                  id="city"
                  list="cities-datalist"
                  placeholder={stateName ? "e.g. Miami" : "Select State first"}
                  value={city}
                  disabled={!stateName}
                  onChange={(e) => setCity(e.target.value)}
                  className="rounded-none bg-card border-border-subtle text-xs disabled:opacity-50"
                />
                <datalist id="cities-datalist">
                  {availableCities.map((cityName) => (
                    <option key={cityName} value={cityName}>
                      {cityName}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>

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
