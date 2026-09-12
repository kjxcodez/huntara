import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SyncCompanyRepository, SyncContactRepository } from '../repositories/sync';
import {
  useEntityList,
  useCreateEntity,
  useUpdateEntity,
  useDeleteEntity
} from '../hooks/useEntity';
import { EntityToolbar } from '../components/crm/EntityToolbar';
import { CompanyForm } from '../components/crm/CompanyForm';
import { TagSystem } from '../components/crm/TagSystem';
import { NotesSystem } from '../components/crm/NotesSystem';
import LeadIntelligenceDetails from '../components/crm/LeadIntelligenceDetails';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { PageHeader } from '../components/common/PageHeader';
import { Label } from '../components/ui/label';
import { Sheet, SheetContent } from '../components/ui/sheet';
import { toast } from 'sonner';
import {
  Building2,
  X,
  Globe,
  MapPin,
  Briefcase,
  Phone,
  Star,
  ExternalLink,
  Mail,
  Users2,
  Cpu
} from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { CreateAudienceModal, type PreloadedContact } from '../components/crm/CreateAudienceModal';
import { CompanyStatus, ContactStatus } from '@leadforge/schema';
import { useWorkspace } from '../hooks/useWorkspace';
import { useProjectionRefresh } from '../hooks/useProjectionRefresh';
import { motion } from 'framer-motion';

/**
 * CompaniesScreen presents a list of target organizations, a details panel,
 * and handles workspace CRUD.
 */
export default function CompaniesScreen() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const queryClient = useQueryClient();
  const { refresh, isRefreshing } = useProjectionRefresh('companies');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [discoveryRunFilter, setDiscoveryRunFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<any | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'intelligence'>('overview');

  // Create Audience Modal state
  const [audienceModalOpen, setAudienceModalOpen] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  // Distinct values query for dropdowns
  const distinctQuery = useQuery({
    queryKey: ['companies', 'distinct-values', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('companies:distinct-values', { workspaceId });
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
    mutationFn: async (payload: { campaignId: string; contactIds: string[] }) => {
      return window.ipc.invoke('campaigns:enroll', payload);
    },
    onSuccess: () => {
      setEnrollOpen(false);
      setEnrollCampaignId('');
      setSelectedIds([]);
      toast.success('Successfully enrolled contacts from selected companies into campaign!');
    },
    onError: (err: any) => {
      toast.error(`Enrollment failed: ${err.message}`);
    }
  });

  // Dialog controls
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // TanStack Entity Query hooks
  const companiesQuery = useEntityList(SyncCompanyRepository);
  const contactsQuery = useEntityList(SyncContactRepository);
  const createMutation = useCreateEntity(SyncCompanyRepository);
  const updateMutation = useUpdateEntity(SyncCompanyRepository);
  const updateContactMutation = useUpdateEntity(SyncContactRepository);
  const deleteMutation = useDeleteEntity(SyncCompanyRepository);

  const companies = companiesQuery.data || [];
  const contacts = contactsQuery.data || [];

  const distinctValues = (distinctQuery.data || { industries: [], locations: [], cities: [], states: [], countries: [] }) as { industries: string[]; locations: string[]; cities: string[]; states: string[]; countries: string[] };
  const discoveryRuns = discoveryRunsQuery.data || [];

  // Filter & Search logic
  const filtered = companies.filter((c: any) => {
    const nameStr = c.name || '';
    const domainStr = c.domain || '';
    const tagsStr = Array.isArray(c.tags) ? c.tags.join(' ') : '';
    let notesStr = '';
    if (c.notes) {
      if (Array.isArray(c.notes)) {
        notesStr = c.notes.map((n: any) => n.content || '').join(' ');
      } else {
        notesStr = String(c.notes);
      }
    }
    const searchLower = search.toLowerCase();
    const matchesSearch =
      !search ||
      nameStr.toLowerCase().includes(searchLower) ||
      domainStr.toLowerCase().includes(searchLower) ||
      tagsStr.toLowerCase().includes(searchLower) ||
      notesStr.toLowerCase().includes(searchLower);
    const matchesStatus = !statusFilter || (c.status && String(c.status).toUpperCase() === statusFilter.toUpperCase());
    const matchesIndustry = !industryFilter || (c.industry && c.industry.toLowerCase().includes(industryFilter.toLowerCase()));
    const matchesLocation = !locationFilter || (c.location && c.location.toLowerCase().includes(locationFilter.toLowerCase()));
    const matchesCity = !cityFilter || (c.city && c.city.toLowerCase() === cityFilter.toLowerCase()) || (c.location && c.location.toLowerCase().includes(cityFilter.toLowerCase()));
    const matchesState = !stateFilter || (c.state && c.state.toLowerCase() === stateFilter.toLowerCase()) || (c.location && c.location.toLowerCase().includes(stateFilter.toLowerCase()));
    const matchesCountry = !countryFilter || (c.country && c.country.toLowerCase() === countryFilter.toLowerCase()) || (c.location && c.location.toLowerCase().includes(countryFilter.toLowerCase()));
    const matchesDiscoveryRun = !discoveryRunFilter || discoveryRunCompanyIds.has(c.id);

    return matchesSearch && matchesStatus && matchesIndustry && matchesLocation && matchesCity && matchesState && matchesCountry && matchesDiscoveryRun;
  });

  // Build active filter chips
  const activeFilterChips = [
    statusFilter ? { label: 'Status', value: statusFilter, onRemove: () => setStatusFilter('') } : null,
    industryFilter ? { label: 'Industry', value: industryFilter, onRemove: () => setIndustryFilter('') } : null,
    cityFilter ? { label: 'City', value: cityFilter, onRemove: () => setCityFilter('') } : null,
    stateFilter ? { label: 'State', value: stateFilter, onRemove: () => setStateFilter('') } : null,
    countryFilter ? { label: 'Country', value: countryFilter, onRemove: () => setCountryFilter('') } : null,
    locationFilter ? { label: 'Location', value: locationFilter, onRemove: () => setLocationFilter('') } : null,
    discoveryRunFilter ? {
      label: 'Discovery',
      value: discoveryRuns.find((r: any) => r.id === discoveryRunFilter)?.name || 'Run',
      onRemove: () => setDiscoveryRunFilter('')
    } : null
  ].filter(Boolean) as Array<{ label: string; value: string; onRemove: () => void }>;

  const handleClearAllFilters = () => {
    setSearch('');
    setStatusFilter('');
    setIndustryFilter('');
    setLocationFilter('');
    setCityFilter('');
    setStateFilter('');
    setCountryFilter('');
    setDiscoveryRunFilter('');
  };

  // Selected Contacts for Static Audience creation (all contacts belonging to selected companies)
  const selectedContactsForAudience: PreloadedContact[] = React.useMemo(() => {
    if (selectedIds.length === 0) return [];
    const matchedContacts = contacts.filter((ct: any) => selectedIds.includes(ct.companyId));
    return matchedContacts.map((ct: any) => ({
      id: ct.id,
      firstName: ct.firstName,
      lastName: ct.lastName,
      email: ct.email,
      title: ct.title,
      companyName: companies.find((comp: any) => comp.id === ct.companyId)?.name
    }));
  }, [selectedIds, contacts, companies]);

  // Pagination calculation
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const adjustedPage = Math.min(Math.max(1, currentPage), totalPages || 1);
  const startIndex = (adjustedPage - 1) * itemsPerPage;
  const paginatedCompanies = filtered.slice(startIndex, startIndex + itemsPerPage);

  const handleCreate = async (data: any) => {
    await createMutation.mutateAsync(data);
    setCreateOpen(false);
  };

  const handleUpdate = async (data: any) => {
    if (selectedCompany) {
      const updated = await updateMutation.mutateAsync({ id: selectedCompany.id, data });
      setSelectedCompany(updated);
      setEditOpen(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this company?')) {
      await deleteMutation.mutateAsync(id);
      if (selectedCompany?.id === id) {
        setSelectedCompany(null);
      }
    }
  };

  const handleBulkDelete = async () => {
    if (confirm(`Are you sure you want to delete the ${selectedIds.length} selected companies?`)) {
      await Promise.all(selectedIds.map((id) => deleteMutation.mutateAsync(id)));
      setSelectedIds([]);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === paginatedCompanies.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedCompanies.map((c: any) => c.id));
    }
  };

  return (
    <div className="flex h-full gap-4 text-xs font-sans">
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        <PageHeader
          title="Companies"
          description="Manage accounts, details, notes, and activity pipelines."
        />

        <EntityToolbar
          search={search}
          onSearchChange={handleSearchChange}
          filterStatus={statusFilter}
          onStatusChange={handleStatusFilterChange}
          statusOptions={Object.values(CompanyStatus)}
          createLabel="Add Company"
          onCreateTrigger={() => setCreateOpen(true)}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
          selectedCount={selectedIds.length}
          onBulkDelete={handleBulkDelete}
          onBulkCreateAudience={() => setAudienceModalOpen(true)}
          onBulkEnroll={() => setEnrollOpen(true)}
          activeFilters={activeFilterChips}
          onClearAllFilters={handleClearAllFilters}
        >
          {distinctValues.industries.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">Industry</span>
              <select
                value={industryFilter}
                onChange={(e) => setIndustryFilter(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[120px]"
              >
                <option value="">All Industries</option>
                {distinctValues.industries.map((ind: string) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </select>
            </div>
          )}

          {distinctValues.cities.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">City</span>
              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[110px]"
              >
                <option value="">All Cities</option>
                {distinctValues.cities.map((c: string) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {distinctValues.states.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">State / Region</span>
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[110px]"
              >
                <option value="">All States</option>
                {distinctValues.states.map((st: string) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          )}

          {distinctValues.countries.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">Country</span>
              <select
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[110px]"
              >
                <option value="">All Countries</option>
                {distinctValues.countries.map((cnt: string) => (
                  <option key={cnt} value={cnt}>
                    {cnt}
                  </option>
                ))}
              </select>
            </div>
          )}

          {distinctValues.locations.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">Address</span>
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="bg-surface-3 border border-border-subtle rounded-none px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring h-8 min-w-[120px]"
              >
                <option value="">All Addresses</option>
                {distinctValues.locations.map((loc: string) => {
                  const label = loc.length > 35 ? loc.slice(0, 32) + '...' : loc;
                  return (
                    <option key={loc} value={loc} title={loc}>
                      {label}
                    </option>
                  );
                })}
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
        </EntityToolbar>


        {companiesQuery.isLoading ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Loading companies...
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
                <Building2 className="h-6 w-6" />
              </motion.div>
              <div>
                <h3 className="text-xs font-semibold text-foreground">No companies found</h3>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Try adding a new company or adjusting search filters.
                </p>
              </div>
              <Button onClick={() => setCreateOpen(true)} size="sm" className="rounded-none">
                + Add Company
              </Button>
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col justify-between">
            <div className="bg-card border border-border-subtle overflow-hidden shadow-sm rounded-none">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-3 border-b border-border-subtle text-[10px] font-semibold text-muted-foreground uppercase tracking-wider select-none">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === paginatedCompanies.length && paginatedCompanies.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded-none border-border-subtle text-primary focus:ring-ring"
                      />
                    </th>
                    <th className="px-4 py-3">Company Name</th>
                    <th className="px-4 py-3">Domain</th>
                    <th className="px-4 py-3">Industry</th>
                    <th className="px-4 py-3">Size</th>
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
                  {paginatedCompanies.map((item: any) => {
                    const isSelected = selectedIds.includes(item.id);
                    const isPanelSelected = selectedCompany?.id === item.id;

                    return (
                      <motion.tr
                        key={item.id}
                        variants={{
                          hidden: { opacity: 0, y: 8 },
                          visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } }
                        }}
                        onClick={() => setSelectedCompany(item)}
                        className={`hover:bg-surface-3/45 cursor-pointer transition-colors ${
                          isPanelSelected ? 'bg-primary/12' : ''
                        }`}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(item.id)}
                            className="rounded-none border-border-subtle text-primary focus:ring-ring"
                          />
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">{item.name}</td>
                        <td className="px-4 py-3 font-mono text-primary">{item.domain || 'N/A'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.industry || 'N/A'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.size || 'N/A'}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-bold rounded-none ${
                              item.status === 'CUSTOMER'
                                ? 'bg-success-muted text-success border-success/20'
                                : item.status === 'QUALIFIED'
                                ? 'bg-info-muted text-info border-info/20'
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
                              setSelectedCompany(item);
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

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-4 select-none">
                <span className="text-[11px] text-muted-foreground">
                  Showing{' '}
                  <strong className="text-foreground font-mono">{startIndex + 1}</strong>{' '}
                  to{' '}
                  <strong className="text-foreground font-mono">
                    {Math.min(startIndex + itemsPerPage, totalItems)}
                  </strong>{' '}
                  of <strong className="text-foreground font-mono">{totalItems}</strong> companies
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
      <Sheet open={!!selectedCompany} onOpenChange={(open) => !open && setSelectedCompany(null)}>
        <SheetContent side="right" showCloseButton={false} className="w-[420px] sm:max-w-[420px] bg-card border-l border-border-subtle rounded-none p-4 space-y-5 flex flex-col h-full shadow-elevation-2 select-none outline-none">
          {selectedCompany && (
            <>
              <div className="flex items-center justify-between border-b border-border-subtle pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-none bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-xs leading-none">
                  {selectedCompany.name}
                </h3>
                <span className="text-[10px] text-muted-foreground mt-1 block font-mono">
                  {selectedCompany.domain}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedCompany(null)}
              className="h-6 w-6 p-0 rounded-none hover:bg-surface-3"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Tab switcher */}
          <div className="border-b border-border-subtle flex gap-4 w-full relative">
            <button
              onClick={() => setDetailTab('overview')}
              className={`flex-1 pb-2 flex items-center justify-center gap-1.5 rounded-none text-[11px] font-bold relative z-10 transition-colors duration-200 ${
                detailTab === 'overview' ? 'text-primary font-bold' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              CRM
              {detailTab === 'overview' && (
                <motion.div
                  layoutId="companyDetailActiveTab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
                  transition={{ type: 'spring', stiffness: 550, damping: 38 }}
                />
              )}
            </button>
            <button
              onClick={() => setDetailTab('intelligence')}
              className={`flex-1 pb-2 flex items-center justify-center gap-1.5 rounded-none text-[11px] font-bold relative z-10 transition-colors duration-200 ${
                detailTab === 'intelligence' ? 'text-primary font-bold' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              Intelligence
              {detailTab === 'intelligence' && (
                <motion.div
                  layoutId="companyDetailActiveTab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
                  transition={{ type: 'spring', stiffness: 550, damping: 38 }}
                />
              )}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-5 pr-1">
            {/* Intelligence tab */}
            {detailTab === 'intelligence' && (
              <LeadIntelligenceDetails companyId={selectedCompany.id} />
            )}

            {/* CRM Overview tab */}
            {detailTab === 'overview' && (
              <>
                {/* Overview / Metadata */}
                <div className="space-y-2.5">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Overview
                  </h4>
                  <div className="bg-surface-3 border border-border-subtle rounded-none p-2.5 space-y-2">
                    {selectedCompany.website && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" />
                        <a
                          href={selectedCompany.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary truncate hover:underline font-mono"
                        >
                          {selectedCompany.website}
                        </a>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Globe className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      <span className="text-foreground font-mono truncate">
                        {selectedCompany.domain || <span className="opacity-40">—</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Briefcase className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      <span className="text-foreground">
                        {selectedCompany.industry || <span className="opacity-40">—</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      <span className="text-foreground">
                        {selectedCompany.location || <span className="opacity-40">—</span>}
                      </span>
                    </div>
                    {selectedCompany.phone && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Phone className="w-3.5 h-3.5 shrink-0 opacity-70" />
                        <span className="text-foreground font-mono">{selectedCompany.phone}</span>
                      </div>
                    )}
                    {selectedCompany.rating != null && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Star className="w-3.5 h-3.5 shrink-0 opacity-70" />
                        <span className="text-foreground">{selectedCompany.rating} / 5</span>
                      </div>
                    )}
                    {selectedCompany.crawlStatus && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="opacity-60">Crawl:</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 rounded-none border-border-subtle bg-surface-3">
                          {selectedCompany.crawlStatus}
                        </Badge>
                        {selectedCompany.contactCount != null && (
                          <span className="text-foreground font-mono">
                            {selectedCompany.contactCount} contacts
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Pipeline Stage */}
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Company Status
                  </h4>
                  <div className="flex flex-wrap gap-1 bg-surface-3 border border-border-subtle rounded-none p-2">
                    {Object.values(CompanyStatus).map((status) => {
                      const isActive = selectedCompany.status === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          onClick={async () => {
                            const updated = await updateMutation.mutateAsync({
                              id: selectedCompany.id,
                              data: { status }
                            });
                            setSelectedCompany(updated);
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

                {/* Linked Contacts */}
                {(() => {
                  const linkedContacts = contacts.filter(
                    (c: any) => c.companyId === selectedCompany.id
                  );
                  return linkedContacts.length > 0 ? (
                    <div className="space-y-2.5">
                      <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Users2 className="w-3 h-3" /> Contacts ({linkedContacts.length})
                      </h4>
                      <div className="space-y-1.5">
                        {linkedContacts.map((c: any) => (
                          <div
                            key={c.id}
                            className="bg-surface-3 border border-border-subtle rounded-none p-2.5 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-[10px] font-semibold text-foreground">
                                {c.firstName ? (
                                  `${c.firstName} ${c.lastName || ''}`.trim()
                                ) : (
                                  <span className="opacity-40">Unnamed Contact</span>
                                )}
                              </p>
                              {c.type === 'executive' && (
                                <Badge
                                  variant="outline"
                                  className="bg-primary/10 text-primary border-primary/20 rounded-none text-[8px] h-3.5 px-1 font-bold"
                                >
                                  Executive
                                </Badge>
                              )}
                            </div>
                            {(c.title || c.headline) && (
                              <p className="text-[9px] text-primary font-medium leading-snug">
                                {c.title || c.headline}
                              </p>
                            )}
                            {c.email && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <Mail className="w-3 h-3 shrink-0 opacity-60" />
                                <span className="truncate font-mono">{c.email}</span>
                              </div>
                            )}
                            {c.phone && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <Phone className="w-3 h-3 shrink-0 opacity-60" />
                                <span className="font-mono">{c.phone}</span>
                              </div>
                            )}
                            {c.linkedinUrl && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <a
                                  href={c.linkedinUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-info hover:underline flex items-center gap-1"
                                >
                                  LinkedIn Profile
                                </a>
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-1 mt-2 pt-1.5 border-t border-border-subtle/40">
                              <span className="text-[9px] text-muted-foreground">Stage:</span>
                              <select
                                value={c.status || 'NEW'}
                                onChange={async (e) => {
                                  await updateContactMutation.mutateAsync({
                                    id: c.id,
                                    data: { status: e.target.value }
                                  });
                                }}
                                className="bg-card border border-border-subtle rounded-none text-[9px] font-semibold px-1 py-0.5 text-foreground focus-visible:outline-none"
                              >
                                {Object.values(ContactStatus).map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Tags System */}
                <div className="space-y-2.5">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Tags
                  </h4>
                  <TagSystem
                    tags={selectedCompany.tags || []}
                    onChange={async (newTags) => {
                      const updated = await updateMutation.mutateAsync({
                        id: selectedCompany.id,
                        data: { tags: newTags }
                      });
                      setSelectedCompany(updated);
                    }}
                  />
                </div>

                {/* Notes System */}
                <div className="space-y-2.5">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Notes
                  </h4>
                  <NotesSystem
                    notesJson={selectedCompany.notes}
                    onUpdate={async (json) => {
                      const updated = await updateMutation.mutateAsync({
                        id: selectedCompany.id,
                        data: { notes: json }
                      });
                      setSelectedCompany(updated);
                    }}
                  />
                </div>
              </>
            )}
          </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Create / Edit Dialogs ────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md rounded-none bg-background border border-border-subtle shadow-elevation-2">
          <DialogHeader>
            <DialogTitle>Add New Company</DialogTitle>
          </DialogHeader>
          <CompanyForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md rounded-none bg-background border border-border-subtle shadow-elevation-2">
          <DialogHeader>
            <DialogTitle>Edit Company Details</DialogTitle>
          </DialogHeader>
          {selectedCompany && (
            <CompanyForm
              initialValues={selectedCompany}
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
            <DialogTitle>Enroll Company Leads in Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-[11px] text-muted-foreground">
              You are enrolling all contacts belonging to the {selectedIds.length} selected
              company/companies.
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
                  const companyContacts = contacts.filter((c: any) =>
                    selectedIds.includes(c.companyId)
                  );
                  const contactIds = companyContacts.map((c: any) => c.id);
                  if (contactIds.length === 0) {
                    toast.error('No contacts found belonging to the selected companies.');
                    return;
                  }
                  enrollMutation.mutate({ campaignId: enrollCampaignId, contactIds });
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
          setSelectedIds([]);
          companiesQuery.refetch();
        }}
        initialMode={selectedIds.length > 0 ? 'static' : 'dynamic'}
        initialSelectedContacts={selectedContactsForAudience}
        initialFilters={{
          search: search || undefined,
          status: statusFilter || undefined,
          industry: industryFilter || undefined,
          location: locationFilter || undefined,
          discoveryRunId: discoveryRunFilter || undefined
        }}
      />
    </div>
  );
}

