import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../hooks/useWorkspace';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Layers,
  Plus,
  Trash2,
  Send,
  Users,
  Sparkles,
  Filter,
  RefreshCw
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { CreateAudienceModal } from '../components/crm/CreateAudienceModal';
import { useProjectionRefresh } from '../hooks/useProjectionRefresh';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04 }
  }
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 280, damping: 24 }
  }
};

export default function AudiencesScreen() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedAudience, setSelectedAudience] = useState<any | null>(null);
  const { refresh, isRefreshing } = useProjectionRefresh('audiences');

  const audiencesQuery = useQuery({
    queryKey: ['audiences', 'list', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      return window.ipc.invoke('audiences:list', { workspaceId });
    },
    enabled: !!workspaceId
  });

  const deleteAudienceMutation = useMutation({
    mutationFn: async (id: string) => {
      return window.ipc.invoke('audiences:delete', { workspaceId, id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audiences', 'list', workspaceId] });
      if (selectedAudience) setSelectedAudience(null);
      toast.success('Audience segment deleted.');
    }
  });

  const handleCreateOutreach = (audience: any) => {
    if (audience.contactCount === 0) {
      toast.warning(`Audience "${audience.name}" currently has 0 contacts.`);
    } else {
      toast.info(`Preparing outreach campaign for audience "${audience.name}" (${audience.contactCount} contacts).`);
    }
    navigate(`/campaigns?audienceId=${audience.id}`);
  };

  const audiences = (audiencesQuery.data || []) as any[];

  const staticCount = audiences.filter((a) => a.mode === 'static').length;
  const dynamicCount = audiences.filter((a) => a.mode !== 'static').length;

  return (
    <div className="flex flex-col gap-5 text-xs font-sans h-full overflow-y-auto pr-1 select-none">
      <PageHeader
        title="Audiences"
        description="Reusable static and dynamic recipient segment definitions over your CRM records."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isRefreshing}
              className="h-8 text-xs font-semibold gap-1.5 rounded-none border-border-subtle bg-card text-foreground hover:bg-surface-3"
              title="Refresh audiences from server"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </Button>
            <Button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              size="sm"
              className="h-8 font-semibold gap-1.5 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 rounded-none"
            >
              <Plus className="w-3.5 h-3.5" />
              New Audience
            </Button>
          </div>
        }
      />

      {/* Stats Cards */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 sm:grid-cols-3 gap-3"
      >
        <motion.div
          variants={cardVariants}
          className="bg-card border border-border-subtle rounded-none p-3 flex items-start gap-2.5 shadow-sm"
        >
          <div className="mt-0.5 text-primary">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground leading-tight font-mono">
              {audiences.length}
            </div>
            <div className="text-[10px] text-muted-foreground font-medium">Saved Audiences</div>
          </div>
        </motion.div>

        <motion.div
          variants={cardVariants}
          className="bg-card border border-border-subtle rounded-none p-3 flex items-start gap-2.5 shadow-sm"
        >
          <div className="mt-0.5 text-info">
            <Users className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground leading-tight font-mono">
              {audiences.reduce((acc, a) => acc + (a.contactCount || 0), 0)}
            </div>
            <div className="text-[10px] text-muted-foreground font-medium">Total Audience Members</div>
          </div>
        </motion.div>

        <motion.div
          variants={cardVariants}
          className="bg-card border border-border-subtle rounded-none p-3 flex items-start gap-2.5 shadow-sm"
        >
          <div className="mt-0.5 text-primary">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground leading-tight font-mono">
              {dynamicCount} Dynamic / {staticCount} Static
            </div>
            <div className="text-[10px] text-muted-foreground font-medium">Segment Types</div>
          </div>
        </motion.div>
      </motion.div>

      {/* Audiences List */}
      <div className="bg-card border border-border-subtle rounded-none shadow-sm flex-1 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
          <h3 className="font-semibold text-foreground text-xs flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-primary" />
            Saved Recipient Segments ({audiences.length})
          </h3>
        </div>

        {audiencesQuery.isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-xs">Loading audiences...</div>
        ) : audiences.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <Layers className="w-8 h-8 stroke-1 text-muted-foreground/40" />
            <p className="font-medium text-foreground text-xs">There are no saved audiences yet.</p>
            <p className="text-[11px] max-w-sm text-muted-foreground">
              Create one from CRM filters or selected contacts.
            </p>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setCreateModalOpen(true)}
              className="mt-2 rounded-none gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Audience
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {audiences.map((audience) => {
              const isStatic = audience.mode === 'static';
              let filterDef = audience.filterDefinition;
              if (typeof filterDef === 'string') {
                try { filterDef = JSON.parse(filterDef); } catch { filterDef = {}; }
              }

              return (
                <div
                  key={audience.id}
                  className="bg-background border border-border-subtle rounded-none p-3.5 flex flex-col justify-between gap-3 hover:border-primary/50 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-none tracking-wider border ${
                              isStatic
                                ? 'bg-surface-3 text-foreground border-border-subtle font-mono'
                                : 'bg-primary/10 text-primary border-primary/30 font-mono'
                            }`}
                          >
                            {isStatic ? 'STATIC' : 'DYNAMIC'}
                          </span>
                          <h4 className="font-bold text-foreground text-sm leading-snug">{audience.name}</h4>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[9px] uppercase font-mono rounded-none border-border-subtle text-foreground shrink-0">
                        {audience.contactCount || 0} Contacts
                      </Badge>
                    </div>

                    {audience.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{audience.description}</p>
                    )}

                    <div className="pt-1 flex flex-wrap gap-1">
                      {isStatic ? (
                        <span className="bg-surface-3 border border-border-subtle text-foreground text-[10px] px-1.5 py-0.5 rounded-none font-mono">
                          {Array.isArray(audience.staticMemberIds) ? audience.staticMemberIds.length : 0} Explicit Member IDs
                        </span>
                      ) : (
                        <>
                          {filterDef.search && (
                            <span className="bg-surface-3 border border-border-subtle text-[10px] px-1.5 py-0.5 rounded-none font-mono text-foreground">
                              Search: "{filterDef.search}"
                            </span>
                          )}
                          {filterDef.status && (
                            <span className="bg-surface-3 border border-border-subtle text-[10px] px-1.5 py-0.5 rounded-none font-mono text-foreground">
                              Status: {filterDef.status}
                            </span>
                          )}
                          {filterDef.industry && (
                            <span className="bg-surface-3 border border-border-subtle text-[10px] px-1.5 py-0.5 rounded-none font-mono text-foreground">
                              Industry: {filterDef.industry}
                            </span>
                          )}
                          {filterDef.location && (
                            <span className="bg-surface-3 border border-border-subtle text-[10px] px-1.5 py-0.5 rounded-none font-mono text-foreground">
                              Location: {filterDef.location}
                            </span>
                          )}
                          {filterDef.discoveryRunId && (
                            <span className="bg-primary/10 border border-primary/30 text-primary text-[10px] px-1.5 py-0.5 rounded-none font-mono">
                              Linked Discovery Run
                            </span>
                          )}
                          {Object.keys(filterDef).length === 0 && (
                            <span className="text-[10px] text-muted-foreground italic">All CRM Records</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
                    <button
                      onClick={() => {
                        if (confirm(`Are you sure you want to delete audience "${audience.name}"?`)) {
                          deleteAudienceMutation.mutate(audience.id);
                        }
                      }}
                      className="text-muted-foreground hover:text-danger p-1 transition-colors"
                      title="Delete audience"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleCreateOutreach(audience)}
                      className="h-7 text-[11px] font-semibold gap-1.5 rounded-none bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Send className="w-3 h-3" />
                      Create Outreach
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CreateAudienceModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['audiences', 'list', workspaceId] });
          toast.success('Audience created successfully!');
        }}
      />
    </div>
  );
}
