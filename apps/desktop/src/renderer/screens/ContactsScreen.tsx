import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../hooks/useWorkspace';
import { motion } from 'framer-motion';
import { SyncContactRepository, SyncCompanyRepository } from '../repositories/sync';
import {
  useEntityList,
  useCreateEntity,
  useUpdateEntity,
  useDeleteEntity
} from '../hooks/useEntity';
import { EntityToolbar } from '../components/crm/EntityToolbar';
import { ContactForm } from '../components/crm/ContactForm';
import { TagSystem } from '../components/crm/TagSystem';
import { NotesSystem } from '../components/crm/NotesSystem';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Users, X, Mail, Phone, Briefcase, Linkedin } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { CreateAudienceModal, type PreloadedContact } from '../components/crm/CreateAudienceModal';
import { ContactStatus } from '@leadforge/schema';
import { useContactSelection } from '../hooks/useContactSelection';
import { areQueriesEqual, type CanonicalContactQuery, type BulkContactSelection } from '../utils/contact-selection';
import { PageHeader } from '../components/common/PageHeader';
import { Sheet, SheetContent } from '../components/ui/sheet';
import { toast } from 'sonner';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { EmailStatusBadge, EngagementPills, DirectionBadge } from '../components/email/EmailStatusBadge';
import { EmailQualityBadge } from '../components/email/EmailQualityBadge';

function ContactEmailHistory({ contactId, workspaceId }: { contactId: string; workspaceId: string }) {
  const navigate = useNavigate();
  const deliveriesQuery = useQuery({
    queryKey: ['contact_deliveries', workspaceId, contactId],
    queryFn: async () => {
      const res = await (window as any).ipc.invoke('email-deliveries:list', {
        workspaceId,
        contactId,
        limit: 10
      });
      return res;
    },
    enabled: !!workspaceId && !!contactId
  });

  const deliveries: any[] = React.useMemo(() => {
    const data = deliveriesQuery.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }, [deliveriesQuery.data]);

  if (deliveriesQuery.isLoading) {
    return <div className="text-[10px] text-muted-foreground p-2">Loading email activity...</div>;
  }

  if (deliveries.length === 0) {
    return (
      <div className="bg-surface-3 border border-border-subtle p-3 text-[11px] text-muted-foreground italic text-center">
        No email activity recorded for this contact yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {deliveries.map((delivery) => (
        <div
          key={delivery.id}
          onClick={() => navigate(`/emails?id=${delivery.id}`)}
          className="p-2.5 bg-surface-3 hover:bg-surface-3/80 border border-border-subtle rounded-none cursor-pointer transition-colors space-y-1.5"
        >
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 font-medium text-foreground truncate">
              <DirectionBadge direction={delivery.direction || 'OUTBOUND'} size="sm" />
              <span className="truncate">{delivery.subject || '(No Subject)'}</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">
              {delivery.sentAt ? new Date(delivery.sentAt).toLocaleDateString() : ''}
            </span>
          </div>

          <div className="flex items-center justify-between gap-1 text-[10px]">
            <EmailStatusBadge status={delivery.status} size="sm" />
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
      ))}
    </div>
  );
}

/**
 * ContactsScreen handles contact directory listing, side profile drawer,
 * and CRUD actions.
 */
export default function ContactsScreen() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [discoveryRunFilter, setDiscoveryRunFilter] = useState('');
  const {
    isAllMatching,
    selectedIds,
    excludedIds,
    capturedQuery,
    matchedCount,
    selectedCount,
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
  } = useContactSelection();
  const [selectedContact, setSelectedContact] = useState<any | null>(null);

  // Audience Modal State
  const [audienceModalOpen, setAudienceModalOpen] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    setCurrentPage(1);
  }, []);

  const handleStatusFilterChange = useCallback((val: string) => {
    setStatusFilter(val);
    setCurrentPage(1);
  }, []);

  // Campaign enrollment states
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollCampaignId, setEnrollCampaignId] = useState('');

  // Fetch campaigns for enrollment selector
  const campaignsQuery = useQuery({
    queryKey: ['campaigns', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('campaigns:list', { workspaceId });
    },
    enabled: !!workspaceId
  });

  // Enrollment mutation
  const enrollMutation = useMutation({
    mutationFn: async (payload: { campaignId: string; contactIds: string[]; selection?: BulkContactSelection }) => {
      return window.ipc.invoke('campaigns:enroll', payload);
    },
    onSuccess: () => {
      setEnrollOpen(false);
      setEnrollCampaignId('');
      clearSelection();
      toast.success('Successfully enrolled selected contact(s) into campaign!');
    },
    onError: (err: any) => {
      toast.error(`Enrollment failed: ${err.message}`);
    }
  });

  // Dialog controls
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // TanStack Entity Query hooks
  const contactsQuery = useEntityList(SyncContactRepository);
  const companiesQuery = useEntityList(SyncCompanyRepository);

  const createMutation = useCreateEntity(SyncContactRepository);
  const updateMutation = useUpdateEntity(SyncContactRepository);
  const deleteMutation = useDeleteEntity(SyncContactRepository);

  const contacts = contactsQuery.data || [];
  const companies = companiesQuery.data || [];

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlContactId = searchParams.get('id');

  React.useEffect(() => {
    if (urlContactId && contacts.length > 0) {
      const match = contacts.find((c: any) => c.id === urlContactId);
      if (match) {
        setSelectedContact(match);
      }
    }
  }, [urlContactId, contacts]);

  // Distinct values query for contact dropdowns
  const distinctQuery = useQuery({
    queryKey: ['contacts', 'distinct-values', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('contacts:distinct-values', { workspaceId });
    },
    enabled: !!workspaceId
  });

  // Discovery runs query for filter
  const discoveryRunsQuery = useQuery({
    queryKey: ['discovery-runs', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('discovery:run:list', { workspaceId });
    },
    enabled: !!workspaceId
  });

  // Query linked companies when discoveryRunFilter is active
  const discoveryRunCompaniesQuery = useQuery({
    queryKey: ['companies', 'discovery-run', workspaceId, discoveryRunFilter],
    queryFn: async () => {
      if (!discoveryRunFilter || !workspaceId) return [];
      return window.ipc.invoke('companies:query', { workspaceId, discoveryRunId: discoveryRunFilter });
    },
    enabled: !!workspaceId && !!discoveryRunFilter
  });

  const discoveryRunCompanyIds = React.useMemo(() => {
    return new Set((discoveryRunCompaniesQuery.data || []).map((c: any) => c.id));
  }, [discoveryRunCompaniesQuery.data]);

  const distinctValues = distinctQuery.data || { titles: [], sources: [] };
  const discoveryRuns = discoveryRunsQuery.data || [];

  // Filter & Search logic
  const filtered = contacts.filter((c: any) => {
    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
    const emailStr = (c.email || '').toLowerCase();
    const titleStr = (c.title || '').toLowerCase();
    const searchLower = search.toLowerCase();

    const matchesSearch =
      !search ||
      fullName.includes(searchLower) ||
      emailStr.includes(searchLower) ||
      titleStr.includes(searchLower);
    const matchesStatus = !statusFilter || (c.status && String(c.status).toUpperCase() === statusFilter.toUpperCase());
    const matchesCompany = !companyFilter || c.companyId === companyFilter;
    const matchesTitle = !titleFilter || (c.title && c.title.toLowerCase().includes(titleFilter.toLowerCase()));
    const matchesSource = !sourceFilter || (c.source && c.source.toLowerCase() === sourceFilter.toLowerCase());
    const matchesDiscoveryRun = !discoveryRunFilter || (c.companyId && discoveryRunCompanyIds.has(c.companyId));

    return matchesSearch && matchesStatus && matchesCompany && matchesTitle && matchesSource && matchesDiscoveryRun;
  });

  // Build active filter chips
  const activeFilterChips = [
    statusFilter ? { label: 'Status', value: statusFilter, onRemove: () => setStatusFilter('') } : null,
    companyFilter ? {
      label: 'Company',
      value: companies.find((comp: any) => comp.id === companyFilter)?.name || 'Company',
      onRemove: () => setCompanyFilter('')
    } : null,
    titleFilter ? { label: 'Title', value: titleFilter, onRemove: () => setTitleFilter('') } : null,
    sourceFilter ? { label: 'Source', value: sourceFilter, onRemove: () => setSourceFilter('') } : null,
    discoveryRunFilter ? {
      label: 'Discovery',
      value: discoveryRuns.find((r: any) => r.id === discoveryRunFilter)?.name || 'Run',
      onRemove: () => setDiscoveryRunFilter('')
    } : null
  ].filter(Boolean) as Array<{ label: string; value: string; onRemove: () => void }>;

  const handleClearAllFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCompanyFilter('');
    setTitleFilter('');
    setSourceFilter('');
    setDiscoveryRunFilter('');
  };

  const currentQuery: CanonicalContactQuery = React.useMemo(() => ({
    search: search.trim() || undefined,
    status: statusFilter || undefined,
    companyId: companyFilter || undefined,
    title: titleFilter || undefined,
    source: sourceFilter || undefined,
    discoveryRunId: discoveryRunFilter || undefined
  }), [search, statusFilter, companyFilter, titleFilter, sourceFilter, discoveryRunFilter]);

  const filtersDifferFromCaptured = React.useMemo(() => {
    if (!isAllMatching || !capturedQuery) return false;
    return !areQueriesEqual(currentQuery, capturedQuery);
  }, [isAllMatching, capturedQuery, currentQuery]);

  // Selected Contacts for Static Audience creation
  const selectedContactsForAudience: PreloadedContact[] = React.useMemo(() => {
    if (effectiveSelectedCount === 0) return [];
    if (isAllMatching) {
      const excludedSet = new Set(excludedIds);
      return contacts
        .filter((ct: any) => !excludedSet.has(ct.id))
        .map((ct: any) => ({
          id: ct.id,
          firstName: ct.firstName,
          lastName: ct.lastName,
          email: ct.email,
          title: ct.title,
          companyName: companies.find((comp: any) => comp.id === ct.companyId)?.name
        }));
    }
    const idSet = new Set(selectedIds);
    return contacts
      .filter((ct: any) => idSet.has(ct.id))
      .map((ct: any) => ({
        id: ct.id,
        firstName: ct.firstName,
        lastName: ct.lastName,
        email: ct.email,
        title: ct.title,
        companyName: companies.find((comp: any) => comp.id === ct.companyId)?.name
      }));
  }, [effectiveSelectedCount, isAllMatching, excludedIds, selectedIds, contacts, companies]);

  // Pagination calculation
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const adjustedPage = Math.min(Math.max(1, currentPage), totalPages || 1);
  const startIndex = (adjustedPage - 1) * itemsPerPage;
  const paginatedContacts = filtered.slice(startIndex, startIndex + itemsPerPage);

  const currentPageIds = React.useMemo(
    () => paginatedContacts.map((c: any) => c.id),
    [paginatedContacts]
  );

  const headerCheckboxRef = React.useRef<HTMLInputElement>(null);

  const headerState = React.useMemo(
    () => getPageSelectionState(currentPageIds),
    [getPageSelectionState, currentPageIds]
  );

  React.useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = headerState.indeterminate;
    }
  }, [headerState.indeterminate]);

  // Prune any selected IDs that no longer exist in contacts (e.g. after sync / deletion)
  React.useEffect(() => {
    if (contactsQuery.isSuccess && contacts.length > 0 && (selectedIds.length > 0 || excludedIds.length > 0)) {
      pruneStaleIds(contacts.map((c: any) => c.id));
    } else if (contactsQuery.isSuccess && contacts.length === 0 && effectiveSelectedCount > 0) {
      clearSelection();
    }
  }, [contactsQuery.isSuccess, contacts, pruneStaleIds, clearSelection, selectedIds.length, excludedIds.length, effectiveSelectedCount]);

  const handleCreate = async (data: any) => {
    await createMutation.mutateAsync(data);
    setCreateOpen(false);
  };

  const handleUpdate = async (data: any) => {
    if (selectedContact) {
      const updated = await updateMutation.mutateAsync({ id: selectedContact.id, data });
      setSelectedContact(updated);
      setEditOpen(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      await deleteMutation.mutateAsync(id);
      if (selectedContact?.id === id) {
        setSelectedContact(null);
      }
      if (isAllMatching) {
        toggleContact(id);
      } else {
        setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
      }
    }
  };

  const handleBulkDelete = async () => {
    if (effectiveSelectedCount === 0) return;
    const confirmMsg = isAllMatching
      ? `Are you sure you want to delete all ${effectiveSelectedCount.toLocaleString()} matching contacts? This cannot be undone.`
      : `Are you sure you want to delete the ${effectiveSelectedCount.toLocaleString()} selected contacts?`;
    if (confirm(confirmMsg)) {
      try {
        const result = await window.ipc.invoke('contacts:bulk:delete', {
          workspaceId,
          selection: getBulkSelectionPayload()
        });
        toast.success(`Successfully deleted ${result.count.toLocaleString()} contact(s).`);
        queryClient.invalidateQueries({ queryKey: ['contacts'] });
        contactsQuery.refetch();
        clearSelection();
      } catch (err: any) {
        toast.error(`Bulk delete failed: ${err.message}`);
      }
    }
  };

  const handleBulkStatusChange = async (status: string) => {
    if (effectiveSelectedCount === 0) return;
    const confirmMsg = isAllMatching
      ? `Are you sure you want to update the status of all ${effectiveSelectedCount.toLocaleString()} matching contacts to "${status}"?`
      : `Are you sure you want to update the status of ${effectiveSelectedCount.toLocaleString()} contacts to "${status}"?`;
    if (confirm(confirmMsg)) {
      try {
        const result = await window.ipc.invoke('contacts:bulk:update-status', {
          workspaceId,
          status,
          selection: getBulkSelectionPayload()
        });
        toast.success(`Successfully updated ${result.count.toLocaleString()} contact(s) to "${status}".`);
        queryClient.invalidateQueries({ queryKey: ['contacts'] });
        contactsQuery.refetch();
        clearSelection();
      } catch (err: any) {
        toast.error(`Bulk update failed: ${err.message}`);
      }
    }
  };

  const handleSaveAudience = async () => {
    const defaultName = search || statusFilter ? `Contacts (${search || statusFilter})` : 'Selected Contacts Segment';
    const audName = prompt('Enter a name for this Audience segment:', defaultName);
    if (!audName || !audName.trim()) return;

    await window.ipc.invoke('audiences:create', {
      workspaceId,
      name: audName.trim(),
      entityType: 'contacts',
      filterDefinition: {
        search: search || undefined,
        status: statusFilter || undefined
      }
    });

    queryClient.invalidateQueries({ queryKey: ['audiences', 'list', workspaceId] });
    toast.success(`Saved audience segment "${audName.trim()}"!`);
    clearSelection();
  };

  return (
    <div className="flex h-full gap-4 text-xs font-sans">
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        <PageHeader
          title="Contacts"
          description="Manage personal leads, communication history, and company bindings."
        />

        <EntityToolbar
          search={search}
          onSearchChange={handleSearchChange}
          filterStatus={statusFilter}
          onStatusChange={handleStatusFilterChange}
          statusOptions={Object.values(ContactStatus)}
          createLabel="Add Contact"
          onCreateTrigger={() => setCreateOpen(true)}
          selectedCount={selectedCount}
          onBulkDelete={handleBulkDelete}
          onBulkStatusChange={handleBulkStatusChange}
          bulkStatusOptions={Object.values(ContactStatus)}
          onBulkCreateAudience={() => setAudienceModalOpen(true)}
          onBulkEnroll={() => setEnrollOpen(true)}
          activeFilters={activeFilterChips}
          onClearAllFilters={handleClearAllFilters}
        >
          {companies.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">Company</span>
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[130px]"
              >
                <option value="">All Companies</option>
                {companies.map((comp: any) => (
                  <option key={comp.id} value={comp.id}>
                    {comp.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {distinctValues.titles.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">Job Title</span>
              <select
                value={titleFilter}
                onChange={(e) => setTitleFilter(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[120px]"
              >
                <option value="">All Job Titles</option>
                {distinctValues.titles.map((t: string) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          {discoveryRuns.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">Discovery Run</span>
              <select
                value={discoveryRunFilter}
                onChange={(e) => setDiscoveryRunFilter(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[130px]"
              >
                <option value="">All Discovery Runs</option>
                {discoveryRuns.map((run: any) => (
                  <option key={run.id} value={run.id}>
                    {run.name || run.query}
                  </option>
                ))}
              </select>
            </div>
          )}

          {distinctValues.sources.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">Source</span>
              <select
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[120px]"
              >
                <option value="">All Sources</option>
                {distinctValues.sources.map((s: string) => (
                  <option key={s} value={s}>
                    {s === 'google_maps' ? 'Google Maps' : s === 'linkedin' ? 'LinkedIn' : s === 'crawler' ? 'Web Crawler' : s === 'manual' ? 'Manual' : s}
                  </option>
                ))}
              </select>
            </div>
          )}
        </EntityToolbar>

        {contactsQuery.isLoading ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Loading contacts...
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="h-[280px] flex items-center justify-center p-6 bg-card border border-border-subtle border-dashed rounded-none"
          >
            <div className="max-w-md w-full flex flex-col items-center text-center space-y-4">
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                className="w-12 h-12 rounded-none bg-primary/10 border border-primary/20 flex items-center justify-center text-primary"
              >
                <Users className="h-6 w-6" />
              </motion.div>
              <div>
                <h3 className="text-xs font-semibold text-foreground">No contacts found</h3>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Try adding a new contact or adjusting filters.
                </p>
              </div>
              <Button onClick={() => setCreateOpen(true)} size="sm" className="rounded-none">
                + Add Contact
              </Button>
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col justify-between gap-2.5">
            {/* Selection Affordance Banner for Page Selection */}
            {headerState.checked && !isAllMatching && totalItems > paginatedContacts.length && (
              <div className="bg-primary/10 border border-primary/20 text-foreground px-4 py-2 text-xs flex items-center justify-between rounded-none animate-in fade-in duration-150">
                <span>
                  All {paginatedContacts.length} contacts on this page are selected.
                </span>
                <Button
                  variant="link"
                  size="sm"
                  className="text-primary font-bold hover:underline p-0 h-auto cursor-pointer"
                  onClick={() => selectAllMatching(currentQuery, totalItems)}
                >
                  Select all {totalItems.toLocaleString()} matching contacts
                </Button>
              </div>
            )}

            {/* Active All-Matching Selection Banner */}
            {isAllMatching && (
              <div className="bg-primary/15 border border-primary/30 text-foreground px-4 py-2 text-xs flex items-center justify-between rounded-none animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    All {matchedCount.toLocaleString()} matching contacts are selected.
                  </span>
                  {excludedIds.length > 0 && (
                    <span className="text-muted-foreground font-mono text-[11px]">
                      ({excludedIds.length.toLocaleString()} excluded &mdash; {effectiveSelectedCount.toLocaleString()} targeted)
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2 text-muted-foreground hover:text-foreground underline cursor-pointer"
                  onClick={clearSelection}
                >
                  Clear selection
                </Button>
              </div>
            )}

            {/* Filter Drift Warning Banner */}
            {isAllMatching && capturedQuery && filtersDifferFromCaptured && (
              <div className="bg-amber-500/15 border border-amber-500/30 text-foreground px-4 py-2 text-xs flex items-center justify-between rounded-none animate-in fade-in duration-150">
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  Active filters have changed since selection was captured. Bulk operations will apply to the captured query ({effectiveSelectedCount.toLocaleString()} contacts).
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2 text-amber-600 dark:text-amber-400 underline hover:bg-amber-500/20 cursor-pointer"
                  onClick={clearSelection}
                >
                  Reset selection
                </Button>
              </div>
            )}

            <div className="bg-card border border-border-subtle overflow-hidden shadow-sm rounded-none">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-3 border-b border-border-subtle text-[10px] font-semibold text-muted-foreground uppercase tracking-wider select-none">
                    <th className="px-4 py-3 w-10">
                      <input
                        ref={headerCheckboxRef}
                        type="checkbox"
                        checked={headerState.checked}
                        onChange={() => togglePageSelection(currentPageIds)}
                        className="rounded-none border-border-subtle text-primary focus:ring-ring"
                      />
                    </th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Job Title</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <motion.tbody
                  className="divide-y divide-border-subtle/50"
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
                >
                  {paginatedContacts.map((item: any) => {
                    const rowSelected = isSelected(item.id);
                    const isPanelSelected = selectedContact?.id === item.id;

                    return (
                      <motion.tr
                        key={item.id}
                        variants={{
                          hidden: { opacity: 0, y: 8 },
                          visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } }
                        }}
                        onClick={() => setSelectedContact(item)}
                        className={`hover:bg-surface-3/45 cursor-pointer transition-colors ${
                          isPanelSelected ? 'bg-primary/12' : ''
                        }`}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={rowSelected}
                            onChange={() => toggleContact(item.id)}
                            className="rounded-none border-border-subtle text-primary focus:ring-ring"
                          />
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">
                          {item.firstName} {item.lastName || ''}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {companies.find((c: any) => c.id === item.companyId)?.name || (
                            <span className="opacity-40">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-primary">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{item.email || '—'}</span>
                            {item.email && (
                              <EmailQualityBadge
                                status={item.emailQuality?.status || (item.status === 'BOUNCED' ? 'INVALID' : item.emailStatus)}
                                size="sm"
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-mono">{item.phone || '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.title || '—'}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-bold rounded-none ${
                              item.status === 'REPLIED'
                                ? 'bg-success-muted text-success border-success/20'
                                : item.status === 'CONTACTED'
                                ? 'bg-info-muted text-info border-info/20'
                                : item.status === 'BOUNCED'
                                ? 'bg-danger-muted text-danger border-danger/20'
                                : 'bg-muted-muted text-muted-foreground border-border-subtle'
                            }`}
                          >
                            {item.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedContact(item);
                              setEditOpen(true);
                            }}
                            className="h-7 text-[10px] rounded-none hover:bg-surface-3"
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(item.id)}
                            className="h-7 text-[10px] text-danger hover:bg-danger-muted hover:text-danger rounded-none"
                          >
                            Delete
                          </Button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </motion.tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-4 select-none">
                <span className="text-[11px] text-muted-foreground">
                  Showing{' '}
                  <strong className="text-foreground font-mono">{startIndex + 1}</strong>{' '}
                  to{' '}
                  <strong className="text-foreground font-mono">
                    {Math.min(startIndex + itemsPerPage, totalItems)}
                  </strong>{' '}
                  of <strong className="text-foreground font-mono">{totalItems}</strong> contacts
                </span>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCurrentPage((p) => Math.max(1, p - 1));
                    }}
                    disabled={adjustedPage === 1}
                    className="h-8 rounded-none px-3 text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    Previous
                  </Button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => {
                      return p === 1 || p === totalPages || Math.abs(p - adjustedPage) <= 1;
                    })
                    .map((p, idx, arr) => {
                      const prev = arr[idx - 1];
                      const showEllipsis = prev && p - prev > 1;

                      return (
                        <React.Fragment key={p}>
                          {showEllipsis && (
                            <span className="px-2 text-muted-foreground font-mono text-xs select-none">
                              ...
                            </span>
                          )}
                          <Button
                            type="button"
                            variant={p === adjustedPage ? 'default' : 'secondary'}
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setCurrentPage(p);
                            }}
                            className={[
                              'h-8 w-8 rounded-none text-[11px] font-semibold transition-colors cursor-pointer',
                              p === adjustedPage
                                ? 'bg-primary text-primary-foreground border-primary font-bold'
                                : 'hover:bg-surface-3'
                            ].join(' ')}
                          >
                            {p}
                          </Button>
                        </React.Fragment>
                      );
                    })}

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCurrentPage((p) => Math.min(totalPages, p + 1));
                    }}
                    disabled={adjustedPage === totalPages}
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

      {/* ── Slide-over Side Panel (Details) ───────────────────────────────── */}
      <Sheet open={!!selectedContact} onOpenChange={(open) => !open && setSelectedContact(null)}>
        <SheetContent side="right" showCloseButton={false} className="w-[420px] sm:max-w-[420px] bg-card border-l border-border-subtle rounded-none p-4 space-y-5 flex flex-col h-full shadow-elevation-2 select-none outline-none">
          {selectedContact && (
            <>
              <div className="flex items-center justify-between border-b border-border-subtle pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-none bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-xs leading-none">
                  {selectedContact.firstName} {selectedContact.lastName || ''}
                </h3>
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  {selectedContact.title || 'Lead Profile'}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedContact(null)}
              className="h-6 w-6 p-0 rounded-none hover:bg-surface-3"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-5 pr-1">
            {/* Overview / Metadata */}
            <div className="space-y-2.5">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Overview
              </h4>
              <div className="bg-surface-3 border border-border-subtle rounded-none p-2.5 space-y-2">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Mail className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  {selectedContact.email ? (
                    <a
                      href={`mailto:${selectedContact.email}`}
                      className="text-primary truncate hover:underline font-mono"
                    >
                      {selectedContact.email}
                    </a>
                  ) : (
                    <span className="opacity-40 font-mono">—</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Phone className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  <span className="text-foreground font-mono">{selectedContact.phone || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Briefcase className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  <span className="text-foreground truncate">
                    {companies.find((c: any) => c.id === selectedContact.companyId)?.name ||
                      'No associated company'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Linkedin className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  <span className="text-foreground truncate font-mono">
                    {selectedContact.linkedin || 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Email Deliverability & Quality */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Deliverability & Quality
                </h4>
                <EmailQualityBadge
                  status={selectedContact.emailQuality?.status || (selectedContact.status === 'BOUNCED' ? 'INVALID' : selectedContact.emailStatus)}
                  size="sm"
                />
              </div>

              <div className="bg-surface-3 border border-border-subtle rounded-none p-2.5 space-y-2 text-[11px]">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">Outreach Gating:</span>
                  <span
                    className={`font-bold ${
                      ['BOUNCED', 'UNSUBSCRIBED', 'DO_NOT_CONTACT'].includes(selectedContact.status) ||
                      selectedContact.emailStatus === 'INVALID' ||
                      selectedContact.emailQuality?.sendable === false
                        ? 'text-danger'
                        : 'text-success'
                    }`}
                  >
                    {['BOUNCED', 'UNSUBSCRIBED', 'DO_NOT_CONTACT'].includes(selectedContact.status) ||
                    selectedContact.emailStatus === 'INVALID' ||
                    selectedContact.emailQuality?.sendable === false
                      ? 'Prohibited / Blocked'
                      : 'Send-Eligible'}
                  </span>
                </div>

                {selectedContact.emailMeta && (
                  <div className="pt-1 border-t border-border-subtle/50 space-y-1 text-[10px] text-muted-foreground">
                    {selectedContact.emailMeta.confidenceTier && (
                      <div className="flex justify-between">
                        <span>Scrape Tier:</span>
                        <span className="font-mono text-foreground">{selectedContact.emailMeta.confidenceTier}</span>
                      </div>
                    )}
                    {selectedContact.emailMeta.isRoleAccount && (
                      <div className="flex justify-between">
                        <span>Role Account:</span>
                        <span className="font-mono text-amber-500">Yes (info/support/sales)</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Suppression actions */}
                <div className="pt-2 border-t border-border-subtle flex gap-1.5">
                  {['BOUNCED', 'UNSUBSCRIBED', 'DO_NOT_CONTACT'].includes(selectedContact.status) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[9px] rounded-none text-success hover:bg-success/10 w-full"
                      onClick={async () => {
                        try {
                          await (window as any).ipc.invoke('suppressions:unsuppress', {
                            workspaceId: selectedContact.workspaceId,
                            email: selectedContact.email
                          });
                          const updated = await updateMutation.mutateAsync({
                            id: selectedContact.id,
                            data: { status: ContactStatus.NEW }
                          });
                          setSelectedContact(updated);
                          toast.success(`Unsuppressed ${selectedContact.email}`);
                        } catch (err: any) {
                          toast.error(err.message || 'Failed to unsuppress');
                        }
                      }}
                    >
                      Remove Suppression
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[9px] rounded-none text-danger hover:bg-danger/10 w-full"
                      onClick={async () => {
                        try {
                          await (window as any).ipc.invoke('suppressions:suppress', {
                            workspaceId: selectedContact.workspaceId,
                            email: selectedContact.email,
                            reason: 'MANUAL_SUPPRESSION',
                            notes: 'Manually suppressed from Contact Drawer'
                          });
                          const updated = await updateMutation.mutateAsync({
                            id: selectedContact.id,
                            data: { status: ContactStatus.DO_NOT_CONTACT }
                          });
                          setSelectedContact(updated);
                          toast.success(`Suppressed ${selectedContact.email}`);
                        } catch (err: any) {
                          toast.error(err.message || 'Failed to suppress');
                        }
                      }}
                    >
                      Suppress Address
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Pipeline Stage */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Contact Stage
              </h4>
              <div className="flex flex-wrap gap-1 bg-surface-3 border border-border-subtle rounded-none p-2">
                {Object.values(ContactStatus).map((status) => {
                  const isActive = selectedContact.status === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={async () => {
                        const updated = await updateMutation.mutateAsync({
                          id: selectedContact.id,
                          data: { status }
                        });
                        setSelectedContact(updated);
                      }}
                      className={`px-2 py-1 rounded-none text-[10px] font-semibold border transition-all ${
                        isActive
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border-subtle hover:bg-surface-3'
                      }`}
                    >
                      {status}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tags System */}
            <div className="space-y-2.5">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Tags
              </h4>
              <TagSystem
                tags={selectedContact.tags || []}
                onChange={async (newTags) => {
                  const updated = await updateMutation.mutateAsync({
                    id: selectedContact.id,
                    data: { tags: newTags }
                  });
                  setSelectedContact(updated);
                }}
              />
            </div>

            {/* Notes System */}
            <div className="space-y-2.5">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Notes
              </h4>
              <NotesSystem
                notesJson={selectedContact.notes}
                onUpdate={async (json) => {
                  const updated = await updateMutation.mutateAsync({
                    id: selectedContact.id,
                    data: { notes: json }
                  });
                  setSelectedContact(updated);
                }}
              />
            </div>

            {/* Email Activity & History */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Email Activity
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-primary hover:text-primary"
                  onClick={() => navigate(`/emails?search=${encodeURIComponent(selectedContact.email || '')}`)}
                >
                  View in Ledger &rarr;
                </Button>
              </div>
              <ContactEmailHistory contactId={selectedContact.id} workspaceId={workspaceId} />
            </div>
          </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Create / Edit Dialogs ────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md rounded-none bg-background border border-border-subtle shadow-elevation-2">
          <DialogHeader>
            <DialogTitle>Add New Contact</DialogTitle>
          </DialogHeader>
          <ContactForm
            companies={companies}
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md rounded-none bg-background border border-border-subtle shadow-elevation-2">
          <DialogHeader>
            <DialogTitle>Edit Contact Details</DialogTitle>
          </DialogHeader>
          {selectedContact && (
            <ContactForm
              initialValues={selectedContact}
              companies={companies}
              onSubmit={handleUpdate}
              onCancel={() => setEditOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Campaign Enrollment Dialog ────────────────────────────────────── */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="max-w-md rounded-none bg-background border border-border-subtle shadow-elevation-2">
          <DialogHeader>
            <DialogTitle>Enroll Leads in Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-[11px] text-muted-foreground">
              You are enrolling {effectiveSelectedCount.toLocaleString()} contact(s) into an outreach campaign.
            </p>
            <div className="space-y-1">
              <Label htmlFor="enrollCampSelect">Outreach Campaign</Label>
              <select
                id="enrollCampSelect"
                value={enrollCampaignId}
                onChange={(e) => setEnrollCampaignId(e.target.value)}
                className="w-full h-8 px-2 bg-background border border-border-subtle rounded-none text-xs focus-visible:outline-none"
              >
                <option value="">-- Select Campaign --</option>
                {(campaignsQuery.data || []).map((camp: any) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name} ({camp.status})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <Button type="button" variant="secondary" className="rounded-none" onClick={() => setEnrollOpen(false)}>
                Cancel
              </Button>
              <Button
                className="rounded-none"
                onClick={() => {
                  if (!enrollCampaignId) {
                    toast.error('Please select a campaign.');
                    return;
                  }
                  enrollMutation.mutate({
                    campaignId: enrollCampaignId,
                    contactIds: selectedIds,
                    selection: getBulkSelectionPayload()
                  });
                }}
                disabled={enrollMutation.isPending}
              >
                {enrollMutation.isPending ? 'Enrolling...' : 'Confirm Enrollment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Audience Modal ────────────────────────────────────────── */}
      <CreateAudienceModal
        isOpen={audienceModalOpen}
        onClose={() => setAudienceModalOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['audiences', 'list', workspaceId] });
          toast.success('Audience saved successfully!');
          clearSelection();
          contactsQuery.refetch();
        }}
        initialMode={effectiveSelectedCount > 0 ? (isAllMatching ? 'dynamic' : 'static') : 'dynamic'}
        initialSelectedContacts={selectedContactsForAudience}
        initialFilters={{
          search: search || undefined,
          status: statusFilter || undefined,
          companyId: companyFilter || undefined,
          title: titleFilter || undefined,
          source: sourceFilter || undefined,
          discoveryRunId: discoveryRunFilter || undefined
        }}
      />
    </div>
  );
}

