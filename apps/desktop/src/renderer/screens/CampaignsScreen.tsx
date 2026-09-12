import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CampaignStatus } from '@leadforge/schema';
import { useWorkspace } from '../hooks/useWorkspace';
import { useProjectionRefresh } from '../hooks/useProjectionRefresh';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../components/ui/table';
import { QueueMonitor } from '../components/crm/QueueMonitor';
import {
  Megaphone,
  Plus,
  Mail,
  FileText,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Eye,
  CheckCircle,
  Clock,
  AlertCircle,
  Search,
  ArrowLeft,
  Users,
  Layers,
  Archive,
  HelpCircle,
  Activity,
  Settings,
  Paperclip,
  Pencil,
  HardDrive,
  ExternalLink,
  X,
  BarChart3,
  Loader2
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '../components/common/PageHeader';
import { MediaPickerDialog } from '../components/media/MediaPickerDialog';
import { EngagementPills } from '../components/email/EmailStatusBadge';
import { SafeEmailPreview } from '../components/email/SafeEmailPreview';
import { CampaignAnalyticsView } from '../components/analytics';
import {
  ProgressiveSequenceEditor,
  type SequenceStepItem
} from '../components/crm/ProgressiveSequenceEditor';

/**
 * CampaignsScreen — outbound sequences dashboard, templates, and SMTP senders.
 *
 * Design updates:
 *   - Squared corners: all buttons, dialog contents, tabs, badges, cards, code tags, select boxes, and table containers use rounded-none.
 *   - Correct Palette: uses semantic design tokens (primary, info, success, warning, danger).
 *   - Pagination: client-side pagination for Campaigns table and Enrolled leads table.
 *   - Stable Callback references to prevent state resets.
 *   - Premium Empty States: gorgeous, styled empty states matching CRM list designs.
 */
export default function CampaignsScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialAudienceId = searchParams.get('audienceId') || '';

  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const queryClient = useQueryClient();
  const { refresh, isRefreshing } = useProjectionRefresh('campaigns');

  const [activeTab, setActiveTab] = useState('campaigns');

  // Navigation: null = list, string = campaign ID for detail view
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Modal Dialog states
  const [accountOpen, setAccountOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(!!initialAudienceId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Selected Enrollment for stepper timeline panel
  const [selectedEnrollment, setSelectedEnrollment] = useState<any | null>(null);

  // Form field states
  const [tplName, setTplName] = useState('');
  const [tplSubj, setTplSubj] = useState('');
  const [tplBody, setTplBody] = useState('');
  const [tplAttachments, setTplAttachments] = useState<any[]>([]);
  const [tplMediaPickerOpen, setTplMediaPickerOpen] = useState(false);

  // Wizard fields for Launching Campaign
  const [campName, setCampName] = useState('');
  const [campDesc, setCampDesc] = useState('');
  const [campSeqId, setCampSeqId] = useState('');
  const [campAccId, setCampAccId] = useState('');
  const [campLimit, setCampLimit] = useState(200);
  const [campTimezone, setCampTimezone] = useState('UTC');
  const [campUseSignature, setCampUseSignature] = useState(true);
  const [campTrackingEnabled, setCampTrackingEnabled] = useState(false);

  const [selectedAudienceId, setSelectedAudienceId] = useState(initialAudienceId);
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStepItem[]>([
    {
      id: 'step_1',
      type: 'SEND_EMAIL',
      config: { subject: '', body: '' }
    }
  ]);

  const [previewTemplateId, setPreviewTemplateId] = useState('');
  const [previewContactId, setPreviewContactId] = useState('');

  // Enrollment filter/search states
  const [enrollmentSearch, setEnrollmentSearch] = useState('');
  const [enrollmentStatusFilter, setEnrollmentStatusFilter] = useState('all');
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<string[]>([]);

  // Pagination states
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignsPerPage] = useState(10);

  const [enrollmentPage, setEnrollmentPage] = useState(1);
  const [enrollmentsPerPage] = useState(10);

  const [activitySubTab, setActivitySubTab] = useState<'leads' | 'deliveries' | 'analytics'>('leads');
  const [deliverySearch, setDeliverySearch] = useState('');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState('all');
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveriesPerPage] = useState(10);

  const handleEnrollmentSearchChange = useCallback((val: string) => {
    setEnrollmentSearch(val);
    setEnrollmentPage(1);
  }, []);

  const handleEnrollmentStatusChange = useCallback((val: string) => {
    setEnrollmentStatusFilter(val);
    setEnrollmentPage(1);
  }, []);

  const handleDeliverySearchChange = useCallback((val: string) => {
    setDeliverySearch(val);
    setDeliveryPage(1);
  }, []);

  const handleDeliveryStatusChange = useCallback((val: string) => {
    setDeliveryStatusFilter(val);
    setDeliveryPage(1);
  }, []);

  // ── Query Hooks ─────────────────────────────────────────────────────────

  const accountsQuery = useQuery({
    queryKey: ['email_accounts', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('email-accounts:list', undefined);
    },
    enabled: !!workspaceId
  });

  const emailDeliveriesQuery = useQuery({
    queryKey: ['email_deliveries', workspaceId, selectedCampaignId, deliveryStatusFilter],
    queryFn: async () => {
      const payload: any = { workspaceId };
      if (selectedCampaignId) payload.campaignId = selectedCampaignId;
      if (deliveryStatusFilter !== 'all') payload.status = deliveryStatusFilter;
      return window.ipc.invoke('email-deliveries:list', payload);
    },
    enabled: !!workspaceId,
    refetchInterval: 5000
  });

  const templatesQuery = useQuery({
    queryKey: ['email_templates', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('templates:list', undefined);
    },
    enabled: !!workspaceId
  });

  const sequencesQuery = useQuery({
    queryKey: ['sequences', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('sequence:list', undefined);
    },
    enabled: !!workspaceId
  });

  const audiencesQuery = useQuery({
    queryKey: ['audiences', 'list', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('audiences:list', { workspaceId });
    },
    enabled: !!workspaceId
  });

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('campaigns:list', { workspaceId });
    },
    enabled: !!workspaceId
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', 'list', workspaceId],
    queryFn: async () => {
      return window.ipc.invoke('contacts:list', { workspaceId });
    },
    enabled: !!workspaceId
  });

  // Query to fetch enrollments for detail page
  const enrollmentsQuery = useQuery({
    queryKey: ['campaign_enrollments', workspaceId, selectedCampaignId],
    queryFn: async () => {
      return window.ipc.invoke('campaigns:enrollments:list', {
        workspaceId,
        campaignId: selectedCampaignId
      });
    },
    enabled: !!workspaceId && !!selectedCampaignId
  });

  const previewQuery = useQuery({
    queryKey: ['template_preview', previewTemplateId, previewContactId],
    queryFn: async () => {
      const payload: { id: string; contactId?: string } = { id: previewTemplateId };
      if (previewContactId) {
        payload.contactId = previewContactId;
      }
      return window.ipc.invoke('templates:preview', payload);
    },
    enabled: !!previewTemplateId
  });

  // ── Mutation Hooks ──────────────────────────────────────────────────────

  const deleteAccountMutation = useMutation({
    mutationFn: async (id: string) => {
      return window.ipc.invoke('email-accounts:delete', id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_accounts', workspaceId] });
    }
  });

  const verifyAccountMutation = useMutation({
    mutationFn: async (payload: { id: string; to: string; useSignature?: boolean }) => {
      return window.ipc.invoke('email-accounts:send-test', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_accounts', workspaceId] });
      alert('Email Connection Verified successfully!');
    },
    onError: (err: any) => {
      alert(`Verification failed: ${err.message}`);
    }
  });

  const connectGmailOAuthMutation = useMutation({
    mutationFn: async () => {
      return window.ipc.invoke('email-accounts:gmail:connect', undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_accounts', workspaceId] });
    },
    onError: (err: any) => {
      alert(`Google authorization failed.\n\n${err.message || 'Please try again.'}`);
    }
  });

  const reconnectGmailMutation = useMutation({
    mutationFn: async (id: string) => {
      return window.ipc.invoke('email-accounts:gmail:reconnect', { id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_accounts', workspaceId] });
    },
    onError: (err: any) => {
      alert(`Google authorization failed.\n\n${err.message || 'Please try again.'}`);
    }
  });

  const disconnectGmailMutation = useMutation({
    mutationFn: async (id: string) => {
      return window.ipc.invoke('email-accounts:gmail:disconnect', { id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_accounts', workspaceId] });
    },
    onError: (err: any) => {
      alert(`Disconnect failed: ${err.message}`);
    }
  });

  const sendTestEmailMutation = useMutation({
    mutationFn: async (payload: { id: string; to: string; useSignature?: boolean }) => {
      return window.ipc.invoke('email-accounts:send-test', payload);
    },
    onSuccess: (data: any) => {
      alert(`Test email sent to ${data?.sentTo || 'mailbox'}.`);
    },
    onError: (err: any) => {
      alert(`Test email failed: ${err.message}`);
    }
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (payload: any) => {
      return window.ipc.invoke('templates:create', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_templates', workspaceId] });
      setTemplateOpen(false);
      setEditingTemplateId(null);
      setTplName('');
      setTplSubj('');
      setTplBody('');
      setTplAttachments([]);
      toast.success('Email template created successfully.');
    }
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => {
      return window.ipc.invoke('templates:update', { id, dto });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_templates', workspaceId] });
      setTemplateOpen(false);
      setEditingTemplateId(null);
      setTplName('');
      setTplSubj('');
      setTplBody('');
      setTplAttachments([]);
      toast.success('Email template updated successfully.');
    },
    onError: (err: any) => {
      toast.error(`Failed to update template: ${err.message || err}`);
    }
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      return window.ipc.invoke('templates:delete', id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_templates', workspaceId] });
    }
  });

  // Campaign Mutations
  const createCampaignMutation = useMutation({
    mutationFn: async (payload: any) => {
      return window.ipc.invoke('campaigns:create', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
      setCampaignOpen(false);
      setCampName('');
      setCampDesc('');
      setCampSeqId('');
      setCampAccId('');
      setCampTrackingEnabled(false);
    }
  });

  const updateCampaignStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return window.ipc.invoke('campaigns:update', { id, dto: { workspaceId, status } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
      queryClient.invalidateQueries({
        queryKey: ['campaign_enrollments', workspaceId, selectedCampaignId]
      });
    }
  });

  const pauseCampaignMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      return window.ipc.invoke('campaigns:pause', campaignId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
      queryClient.invalidateQueries({
        queryKey: ['campaign_enrollments', workspaceId, selectedCampaignId]
      });
      toast.success('Campaign paused.');
    },
    onError: (err: any) => {
      toast.error(`Failed to pause campaign: ${err.message || err}`);
    }
  });

  const resumeCampaignMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      return window.ipc.invoke('campaigns:resume', campaignId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
      queryClient.invalidateQueries({
        queryKey: ['campaign_enrollments', workspaceId, selectedCampaignId]
      });
      toast.success('Campaign resumed.');
    },
    onError: (err: any) => {
      toast.error(`Failed to resume campaign: ${err.message || err}`);
    }
  });

  const stopCampaignMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      return window.ipc.invoke('campaigns:stop', campaignId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
      queryClient.invalidateQueries({
        queryKey: ['campaign_enrollments', workspaceId, selectedCampaignId]
      });
      toast.success('Campaign stopped.');
    },
    onError: (err: any) => {
      toast.error(`Failed to stop campaign: ${err.message || err}`);
    }
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      return window.ipc.invoke('campaigns:delete', { workspaceId, id });
    },
    onSuccess: () => {
      setSelectedCampaignId(null);
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
    }
  });

  // Enrollment Control Mutations
  const bulkPauseMutation = useMutation({
    mutationFn: async (enrollmentIds: string[]) => {
      return window.ipc.invoke('campaigns:bulk-pause-enrollments', {
        campaignId: selectedCampaignId,
        enrollmentIds
      });
    },
    onSuccess: () => {
      setSelectedEnrollmentIds([]);
      queryClient.invalidateQueries({
        queryKey: ['campaign_enrollments', workspaceId, selectedCampaignId]
      });
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
    }
  });

  const bulkResumeMutation = useMutation({
    mutationFn: async (enrollmentIds: string[]) => {
      return window.ipc.invoke('campaigns:bulk-resume-enrollments', {
        campaignId: selectedCampaignId,
        enrollmentIds
      });
    },
    onSuccess: () => {
      setSelectedEnrollmentIds([]);
      queryClient.invalidateQueries({
        queryKey: ['campaign_enrollments', workspaceId, selectedCampaignId]
      });
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
    }
  });

  const bulkRemoveMutation = useMutation({
    mutationFn: async (enrollmentIds: string[]) => {
      return window.ipc.invoke('campaigns:bulk-remove-enrollments', {
        campaignId: selectedCampaignId,
        enrollmentIds
      });
    },
    onSuccess: () => {
      setSelectedEnrollmentIds([]);
      queryClient.invalidateQueries({
        queryKey: ['campaign_enrollments', workspaceId, selectedCampaignId]
      });
      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
    }
  });

  // Handlers
  const handleConnectGmailOAuth = () => {
    connectGmailOAuthMutation.mutate();
  };

  const handleOpenCreateTemplate = () => {
    setEditingTemplateId(null);
    setTplName('');
    setTplSubj('');
    setTplBody('');
    setTplAttachments([]);
    setTemplateOpen(true);
  };

  const handleOpenEditTemplate = (tpl: any) => {
    setEditingTemplateId(tpl.id);
    setTplName(tpl.name || '');
    setTplSubj(tpl.subject || '');
    setTplBody(tpl.body || '');
    let atts: any[] = [];
    if (tpl.attachments) {
      try {
        atts = typeof tpl.attachments === 'string' ? JSON.parse(tpl.attachments) : tpl.attachments;
      } catch {
        atts = [];
      }
    }
    setTplAttachments(Array.isArray(atts) ? atts : []);
    setTemplateOpen(true);
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTemplateId) {
      updateTemplateMutation.mutate({
        id: editingTemplateId,
        dto: {
          name: tplName,
          subject: tplSubj,
          body: tplBody,
          attachments: tplAttachments
        }
      });
    } else {
      createTemplateMutation.mutate({
        name: tplName,
        subject: tplSubj,
        body: tplBody,
        attachments: tplAttachments
      });
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!campName.trim()) {
      toast.error('Please enter a valid Campaign Name before launching.');
      return;
    }
    if (!campAccId) {
      toast.error('Please select a connected Sender Email Account for outreach.');
      return;
    }
    if (!sequenceSteps || sequenceSteps.length === 0) {
      toast.error('Outreach campaign must contain at least 1 sequence step.');
      return;
    }

    // Step validation check (Section 31)
    for (let i = 0; i < sequenceSteps.length; i++) {
      const s = sequenceSteps[i];
      if (!s) continue;
      if (s.type === 'SEND_EMAIL') {
        if (!s.config.subject || !s.config.subject.trim()) {
          toast.error(`Step ${i + 1} (Email) is missing a Subject Line.`);
          return;
        }
        if (!s.config.body || !s.config.body.trim()) {
          toast.error(`Step ${i + 1} (Email) is missing a Message Body.`);
          return;
        }
      }
      if (s.type === 'WAIT' && (!s.config.delaySeconds || s.config.delaySeconds <= 0)) {
        toast.error(`Step ${i + 1} (Wait) must have a valid delay duration.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let targetSeqId = campSeqId;

      // Build sequence dynamically from sequenceSteps if not reusing existing sequence
      if (!targetSeqId) {
        const formattedSteps: any[] = sequenceSteps.map((s, idx) => {
          const stepId = s?.id || `step_${idx + 1}`;
          const stepType = s?.type || 'SEND_EMAIL';
          const stepConfig = s?.config || {};

          if (stepType === 'IF') {
            return {
              id: stepId,
              type: 'IF',
              config: {
                condition: stepConfig.condition || "contact.status == 'REPLIED'",
                thenGoto: `label_yes_${idx}`,
                elseSkip: 1
              }
            };
          }
          return {
            id: stepId,
            type: stepType,
            config: {
              ...stepConfig,
              useGmailSignature: campUseSignature,
              sendingAccountId: stepConfig.sendingAccountId || campAccId
            }
          };
        });

        const seq = await window.ipc.invoke('sequence:create', {
          name: `Sequence: ${campName.trim()}`,
          status: 'ACTIVE',
          trigger: { type: 'MANUAL', config: {} },
          steps: formattedSteps
        });
        targetSeqId = seq.id;
      }

      // 2. Create Campaign (Phase 3: includes client-scoped idempotencyKey)
      const submissionIdempotencyKey = `camp_sub_${workspaceId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const campaign = await window.ipc.invoke('campaigns:create', {
        workspaceId,
        name: campName.trim(),
        description: campDesc.trim() || undefined,
        sequenceId: targetSeqId,
        sendingAccountId: campAccId,
        dailyLimit: campLimit,
        timezone: campTimezone,
        status: 'ACTIVE',
        idempotencyKey: submissionIdempotencyKey,
        trackingEnabled: campTrackingEnabled,
        settings: {
          useSignature: campUseSignature,
          trackingEnabled: campTrackingEnabled
        }
      });

      // 3. Resolve Audience & Enroll Contacts
      let enrolledCount = 0;
      if (selectedAudienceId) {
        const resolved = await window.ipc.invoke('audiences:resolve', {
          workspaceId,
          id: selectedAudienceId
        });
        if (resolved.contactIds && resolved.contactIds.length > 0) {
          await window.ipc.invoke('campaigns:enroll', {
            campaignId: campaign.id,
            contactIds: resolved.contactIds
          });
          enrolledCount = resolved.contactIds.length;
        } else {
          toast.warning('Selected Audience resolved 0 active contacts. Campaign created as empty draft.');
        }
      }

      // 4. Trigger Scheduler
      await window.ipc.invoke('campaigns:schedule', campaign.id);

      queryClient.invalidateQueries({ queryKey: ['campaigns', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['sequences', workspaceId] });
      setCampaignOpen(false);
      setCampName('');
      setCampDesc('');
      setCampSeqId('');
      setCampAccId('');
      setCampUseSignature(true);
      setSelectedAudienceId('');
      setSequenceSteps([
        {
          id: 'step_1',
          type: 'SEND_EMAIL',
          config: { subject: '', body: '' }
        }
      ]);
      toast.success(
        enrolledCount > 0
          ? `Outreach campaign "${campName.trim()}" launched successfully with ${enrolledCount} contacts!`
          : `Outreach campaign "${campName.trim()}" created successfully!`
      );
    } catch (err: any) {
      toast.error(`Failed to launch campaign: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const accounts = accountsQuery.data || [];
  const templates = templatesQuery.data || [];
  const campaigns = campaignsQuery.data || [];
  const contacts = contactsQuery.data || [];
  const sequences = sequencesQuery.data || [];
  const enrollments = enrollmentsQuery.data || [];

  // Filter enrollments by search query and status tab
  const filteredEnrollments = enrollments.filter((enroll: any) => {
    const fullName = `${enroll.firstName || ''} ${enroll.lastName || ''}`.toLowerCase();
    const email = (enroll.email || '').toLowerCase();
    const company = (enroll.companyName || '').toLowerCase();
    const matchSearch =
      fullName.includes(enrollmentSearch.toLowerCase()) ||
      email.includes(enrollmentSearch.toLowerCase()) ||
      company.includes(enrollmentSearch.toLowerCase());

    if (enrollmentStatusFilter === 'all') return matchSearch;
    return matchSearch && enroll.status.toLowerCase() === enrollmentStatusFilter.toLowerCase();
  });

  const getCampaignStatusBadge = (status: string, pauseReason?: string) => {
    const s = (status || '').toUpperCase();
    switch (s) {
      case 'ACTIVE':
        return (
          <Badge className="bg-success-muted text-success border border-success/20 text-[9px] font-bold px-2 rounded-none">
            Active
          </Badge>
        );
      case 'PAUSED':
        if (pauseReason === 'MAILBOX_DISCONNECTED') {
          return (
            <Badge className="bg-danger-muted text-danger border border-danger/20 text-[9px] font-semibold px-2 rounded-none flex items-center gap-1">
              <AlertCircle className="h-2.5 w-2.5" />
              Paused (Mailbox Disconnected)
            </Badge>
          );
        }
        return (
          <Badge className="bg-warning-muted text-warning border border-warning/20 text-[9px] font-semibold px-2 rounded-none">
            Paused
          </Badge>
        );
      case 'STOPPED':
        return (
          <Badge className="bg-danger-muted text-danger border border-danger/20 text-[9px] font-semibold px-2 rounded-none">
            Stopped
          </Badge>
        );
      case 'COMPLETED':
        return (
          <Badge className="bg-info-muted text-info border border-info/20 text-[9px] font-semibold px-2 rounded-none">
            Completed
          </Badge>
        );
      case 'ARCHIVED':
        return (
          <Badge className="bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 text-[9px] font-semibold px-2 rounded-none">
            Archived
          </Badge>
        );
      default:
        return (
          <Badge className="bg-muted-muted text-muted-foreground border border-border-subtle text-[9px] font-semibold px-2 rounded-none">
            Draft
          </Badge>
        );
    }
  };

  const getEnrollmentStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'running':
      case 'queued':
      case 'starting':
        return (
          <Badge className="bg-info-muted text-info border border-info/20 animate-pulse text-[9px] rounded-none">
            Running
          </Badge>
        );
      case 'waiting':
        return (
          <Badge className="bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 text-[9px] rounded-none">
            Waiting
          </Badge>
        );
      case 'paused':
        return (
          <Badge className="bg-warning-muted text-warning border border-warning/20 text-[9px] rounded-none">
            Paused
          </Badge>
        );
      case 'replied':
        return (
          <Badge className="bg-success-muted text-success border border-success/20 text-[9px] font-bold rounded-none">
            Replied
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-danger-muted text-danger border border-danger/20 text-[9px] font-bold rounded-none">
            Failed
          </Badge>
        );
      case 'completed':
        return (
          <Badge className="bg-success-muted text-success border border-success/20 text-[9px] font-bold rounded-none">
            Completed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[9px] rounded-none">
            {status}
          </Badge>
        );
    }
  };

  const getDeliveryStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'SENT':
        return (
          <Badge className="bg-success-muted text-success border border-success/30 font-mono text-[9px] uppercase font-bold rounded-none">
            <CheckCircle className="w-2.5 h-2.5 mr-1 inline" />
            Sent
          </Badge>
        );
      case 'SENDING':
        return (
          <Badge className="bg-info-muted text-info border border-info/30 font-mono text-[9px] uppercase font-bold rounded-none animate-pulse">
            <Clock className="w-2.5 h-2.5 mr-1 inline" />
            Sending
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge className="bg-danger-muted text-danger border border-danger/30 font-mono text-[9px] uppercase font-bold rounded-none">
            <AlertCircle className="w-2.5 h-2.5 mr-1 inline" />
            Failed
          </Badge>
        );
      case 'SUPPRESSED':
        return (
          <Badge className="bg-warning-muted text-warning border border-warning/30 font-mono text-[9px] uppercase font-bold rounded-none">
            <CheckCircle className="w-2.5 h-2.5 mr-1 inline" />
            Suppressed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[9px] rounded-none uppercase">
            {status || 'Pending'}
          </Badge>
        );
    }
  };

  // Pagination calculation: Campaigns list
  const totalCampaigns = campaigns.length;
  const totalCampaignPages = Math.ceil(totalCampaigns / campaignsPerPage);
  const adjustedCampaignPage = Math.min(Math.max(1, campaignPage), totalCampaignPages || 1);
  const campaignStartIndex = (adjustedCampaignPage - 1) * campaignsPerPage;
  const paginatedCampaigns = campaigns.slice(campaignStartIndex, campaignStartIndex + campaignsPerPage);

  // Pagination calculation: Enrollments list
  const totalEnrollments = filteredEnrollments.length;
  const totalEnrollmentPages = Math.ceil(totalEnrollments / enrollmentsPerPage);
  const adjustedEnrollmentPage = Math.min(Math.max(1, enrollmentPage), totalEnrollmentPages || 1);
  const enrollmentStartIndex = (adjustedEnrollmentPage - 1) * enrollmentsPerPage;
  const paginatedEnrollments = filteredEnrollments.slice(enrollmentStartIndex, enrollmentStartIndex + enrollmentsPerPage);

  // Pagination calculation: Deliveries list
  const rawDeliveries = (emailDeliveriesQuery.data || []) as any[];
  const filteredDeliveries = rawDeliveries.filter((d) => {
    if (!deliverySearch.trim()) return true;
    const q = deliverySearch.toLowerCase();
    const matchRecipient = `${d.firstName || ''} ${d.lastName || ''} ${d.recipientEmail || ''} ${d.companyName || ''}`.toLowerCase();
    const matchSubject = (d.subject || '').toLowerCase();
    const matchSender = (d.senderEmail || '').toLowerCase();
    return matchRecipient.includes(q) || matchSubject.includes(q) || matchSender.includes(q);
  });
  const totalDeliveries = filteredDeliveries.length;
  const totalDeliveryPages = Math.ceil(totalDeliveries / deliveriesPerPage);
  const adjustedDeliveryPage = Math.min(Math.max(1, deliveryPage), totalDeliveryPages || 1);
  const deliveryStartIndex = (adjustedDeliveryPage - 1) * deliveriesPerPage;
  const paginatedDeliveries = filteredDeliveries.slice(deliveryStartIndex, deliveryStartIndex + deliveriesPerPage);

  return (
    <div className="space-y-6 text-xs font-sans h-full overflow-y-auto pr-1">
      <PageHeader
        title="Outreach Platform"
        description="Manage Gmail senders, campaign lists, automated schedules, and follow-ups."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isRefreshing}
            className="h-8 text-xs font-semibold gap-1.5 rounded-none border-border-subtle bg-card text-foreground hover:bg-surface-3"
            title="Refresh campaigns and outreach data from server"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <div className="border-b border-border-subtle flex gap-4 w-full relative mb-4">
        {[
          { id: 'campaigns', label: 'Campaigns', Icon: Megaphone },
          { id: 'monitor', label: 'Queue Monitor', Icon: Activity },
          { id: 'templates', label: 'Templates', Icon: FileText }
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative pb-3 px-1 flex items-center gap-1.5 rounded-none text-xs font-semibold select-none outline-none z-10 transition-colors duration-200 ${
                isActive ? 'text-primary font-bold' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              <tab.Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
              {isActive && (
                <motion.div
                  layoutId="campaignActiveTabUnderline"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
                  transition={{ type: 'spring', stiffness: 550, damping: 38 }}
                />
              )}
            </button>
          );
        })}
      </div>

        {/* ── CAMPAIGNS TAB (LIST VIEW OR DETAIL VIEW) ──────────────────────── */}
        <TabsContent value="campaigns" className="mt-4 space-y-4">
          {!selectedCampaignId ? (
            /* ──── LIST OF CAMPAIGNS ──── */
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-foreground text-[11px]">
                  Outbound Campaigns
                </span>
                <Button
                  onClick={() => setCampaignOpen(true)}
                  size="sm"
                  className="flex items-center gap-1 rounded-none"
                >
                  <Plus className="h-3 w-3" />
                  Launch Campaign
                </Button>
              </div>

              {campaigns.length === 0 ? (
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
                      className="w-12 h-12 rounded-none bg-primary/10 flex items-center justify-center text-primary border border-primary/20"
                    >
                      <Megaphone className="h-6 w-6" />
                    </motion.div>
                    <div>
                      <h3 className="text-xs font-semibold text-foreground">No outbound campaigns launched</h3>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Define campaign sequences, connect Gmail senders, and start reaching prospects.
                      </p>
                    </div>
                    <Button onClick={() => setCampaignOpen(true)} size="sm" className="rounded-none">
                      + Launch Campaign
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <div className="bg-card border border-border-subtle rounded-none overflow-hidden shadow-sm flex flex-col justify-between">
                  <Table>
                    <TableHeader className="bg-surface-3/40">
                      <TableRow>
                        <TableHead>Campaign Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sequence</TableHead>
                        <TableHead>Sender Account</TableHead>
                        <TableHead className="text-center">Enrolled</TableHead>
                        <TableHead className="text-center text-info">Running</TableHead>
                        <TableHead className="text-center text-zinc-400">Waiting</TableHead>
                        <TableHead className="text-center text-success">Replies</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <motion.tbody
                      initial="hidden"
                      animate="visible"
                      variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
                    >
                      {paginatedCampaigns.map((camp: any) => {
                        const sequence = sequences.find((s: any) => s.id === camp.sequenceId);
                        const account = accounts.find((a: any) => a.id === camp.sendingAccountId);
                        return (
                          <motion.tr
                            key={camp.id}
                            variants={{
                              hidden: { opacity: 0, y: 8 },
                              visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } }
                            }}
                            className="hover:bg-surface-3/10 cursor-pointer border-b border-border-subtle/50 text-xs"
                            onClick={() => {
                              setSelectedCampaignId(camp.id);
                              setEnrollmentPage(1);
                            }}
                          >
                            <TableCell className="font-semibold text-foreground py-3">
                              {camp.name}
                              <span className="block text-[10px] text-muted-foreground font-normal mt-0.5">
                                {camp.description || 'No description provided.'}
                              </span>
                            </TableCell>
                            <TableCell>
                              {getCampaignStatusBadge(
                                camp.status,
                                typeof camp.settings === 'string'
                                  ? (() => {
                                      try {
                                        return JSON.parse(camp.settings)?.pauseReason;
                                      } catch {
                                        return undefined;
                                      }
                                    })()
                                  : camp.settings?.pauseReason
                              )}
                            </TableCell>
                            <TableCell>{sequence?.name || '—'}</TableCell>
                            <TableCell className="font-mono">{account?.email || '—'}</TableCell>
                            <TableCell className="text-center font-mono font-bold">
                              {camp.contactsCount || 0}
                            </TableCell>
                            <TableCell className="text-center font-mono text-info">
                              {camp.runningCount || 0}
                            </TableCell>
                            <TableCell className="text-center font-mono text-zinc-400">
                              {camp.waitingCount || 0}
                            </TableCell>
                            <TableCell className="text-center font-mono text-success">
                              {camp.repliedCount || 0}
                            </TableCell>
                            <TableCell
                              className="text-right py-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex justify-end gap-1.5">
                                {camp.status?.toUpperCase() === 'PAUSED' || camp.status?.toUpperCase() === 'DRAFT' ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => resumeCampaignMutation.mutate(camp.id)}
                                    disabled={resumeCampaignMutation.isPending}
                                    className="h-7 text-success hover:bg-success-muted gap-0.5 rounded-none"
                                  >
                                    <Play className="h-3 w-3" />
                                    Resume
                                  </Button>
                                ) : camp.status?.toUpperCase() === 'ACTIVE' ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => pauseCampaignMutation.mutate(camp.id)}
                                    disabled={pauseCampaignMutation.isPending}
                                    className="h-7 text-warning hover:bg-warning-muted gap-0.5 rounded-none"
                                  >
                                    <Pause className="h-3 w-3" />
                                    Pause
                                  </Button>
                                ) : null}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        'Are you sure you want to delete this campaign? All enrollments will be deleted.'
                                      )
                                    ) {
                                      deleteCampaignMutation.mutate(camp.id);
                                    }
                                  }}
                                  className="h-7 text-danger hover:bg-danger-muted rounded-none"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </motion.tr>
                        );
                      })}
                    </motion.tbody>
                  </Table>
                </div>
              )}

              {/* Campaigns list pagination controls */}
              {totalCampaignPages > 1 && campaigns.length > 0 && (
                <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-2 select-none">
                  <span className="text-[11px] text-muted-foreground">
                    Showing{' '}
                    <strong className="text-foreground font-mono">{campaignStartIndex + 1}</strong>{' '}
                    to{' '}
                    <strong className="text-foreground font-mono">
                      {Math.min(campaignStartIndex + campaignsPerPage, totalCampaigns)}
                    </strong>{' '}
                    of <strong className="text-foreground font-mono">{totalCampaigns}</strong> campaigns
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCampaignPage((p) => Math.max(1, p - 1));
                      }}
                      disabled={adjustedCampaignPage === 1}
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
                        setCampaignPage((p) => Math.min(totalCampaignPages, p + 1));
                      }}
                      disabled={adjustedCampaignPage === totalCampaignPages}
                      className="h-8 rounded-none px-3 text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ──── CAMPAIGN DETAILS VIEW ──── */
            (() => {
              const campaign = campaigns.find((c: any) => c.id === selectedCampaignId);
              if (!campaign) return null;
              const sequence = sequences.find((s: any) => s.id === campaign.sequenceId);
              const account = accounts.find((a: any) => a.id === campaign.sendingAccountId);

              return (
                <div className="space-y-5">
                  <div className="flex justify-between items-center pb-2 border-b border-border-subtle">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedCampaignId(null);
                        setSelectedEnrollment(null);
                      }}
                      className="gap-1 h-8 text-[11px] rounded-none"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Back to Campaigns
                    </Button>

                    <div className="flex items-center gap-2">
                      {campaign.status?.toUpperCase() === 'ACTIVE' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => pauseCampaignMutation.mutate(campaign.id)}
                          disabled={pauseCampaignMutation.isPending}
                          className="h-8 text-[10px] text-warning border-warning/20 gap-1 hover:bg-warning-muted rounded-none"
                        >
                          <Pause className="h-3.5 w-3.5" />
                          Pause Campaign
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resumeCampaignMutation.mutate(campaign.id)}
                          disabled={resumeCampaignMutation.isPending}
                          className="h-8 text-[10px] text-success border-success/20 gap-1 hover:bg-success-muted rounded-none"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Resume Campaign
                        </Button>
                      )}

                      {campaign.status?.toUpperCase() !== 'STOPPED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (confirm('Permanently stop this campaign? All active and waiting enrollments will be cancelled.')) {
                              stopCampaignMutation.mutate(campaign.id);
                            }
                          }}
                          disabled={stopCampaignMutation.isPending}
                          className="h-8 text-[10px] text-danger border-danger/20 gap-1 hover:bg-danger-muted rounded-none"
                        >
                          <X className="h-3.5 w-3.5" />
                          Stop Campaign
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm('Archive this campaign?')) {
                            updateCampaignStatusMutation.mutate({
                              id: campaign.id,
                              status: CampaignStatus.COMPLETED
                            });
                          }
                        }}
                        className="h-8 text-[10px] text-zinc-400 gap-1 rounded-none"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Archive
                      </Button>
                    </div>
                  </div>

                  {/* Mailbox Disconnected Warning Banner (DISCONNECT-16) */}
                  {campaign.status?.toUpperCase() === 'PAUSED' &&
                    (typeof campaign.settings === 'string'
                      ? (() => {
                          try {
                            return JSON.parse(campaign.settings)?.pauseReason;
                          } catch {
                            return undefined;
                          }
                        })()
                      : campaign.settings?.pauseReason) === 'MAILBOX_DISCONNECTED' && (
                      <div className="bg-danger-muted/30 border border-danger/30 text-danger px-4 py-2.5 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span>
                            <strong>Campaign Paused:</strong> Sending mailbox was disconnected. Reconnecting the mailbox will automatically resume this campaign.
                          </span>
                        </div>
                      </div>
                    )}

                  {/* Campaign Info Cards Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-card border border-border-subtle rounded-none p-3.5 space-y-1">
                      <span className="text-[10px] text-muted-foreground">Campaign Status</span>
                      <div className="flex items-center justify-between">
                        <span className="text-base font-bold text-foreground">{campaign.name}</span>
                        {getCampaignStatusBadge(
                          campaign.status,
                          typeof campaign.settings === 'string'
                            ? (() => {
                                try {
                                  return JSON.parse(campaign.settings)?.pauseReason;
                                } catch {
                                  return undefined;
                                }
                              })()
                            : campaign.settings?.pauseReason
                        )}
                      </div>
                      <span className="block text-[9px] text-muted-foreground mt-0.5">
                        {campaign.description || '—'}
                      </span>
                    </div>

                    <div className="bg-card border border-border-subtle rounded-none p-3.5 space-y-1">
                      <span className="text-[10px] text-muted-foreground">Active Sequence</span>
                      <div className="text-xs font-bold text-foreground truncate flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        {sequence?.name || '—'}
                      </div>
                      <span className="block text-[9px] text-muted-foreground">
                        Steps: {sequence?.steps ? (typeof sequence.steps === 'string' ? JSON.parse(sequence.steps).length : sequence.steps.length) : 0} steps
                      </span>
                    </div>

                    <div className="bg-card border border-border-subtle rounded-none p-3.5 space-y-1">
                      <span className="text-[10px] text-muted-foreground">Sender Account</span>
                      <div className="text-xs font-bold text-foreground truncate flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5 text-primary" />
                        {account?.name || '—'}
                      </div>
                      <span className="block text-[9px] text-muted-foreground truncate font-mono">
                        {account?.email || '—'}
                      </span>
                    </div>

                    <div className="bg-card border border-border-subtle rounded-none p-3.5 space-y-1">
                      <span className="text-[10px] text-muted-foreground">Delivery Limits</span>
                      <div className="text-xs font-bold text-foreground font-mono">
                        {campaign.dailyLimit || 200} daily / {campaign.timezone || 'UTC'}
                      </div>
                      <span className="block text-[9px] text-muted-foreground">
                        Workspace local settings apply
                      </span>
                    </div>
                  </div>

                  {/* Campaign Dashboard Stats */}
                  <div className="grid grid-cols-7 gap-2 bg-surface-3 border border-border-subtle rounded-none p-3.5">
                    <div className="text-center border-r border-border-subtle/50">
                      <span className="block font-mono text-base font-bold text-foreground">
                        {campaign.contactsCount || 0}
                      </span>
                      <span className="text-[9px] text-muted-foreground">Enrolled</span>
                    </div>
                    <div className="text-center border-r border-border-subtle/50">
                      <span className="block font-mono text-base font-bold text-info">
                        {campaign.runningCount || 0}
                      </span>
                      <span className="text-[9px] text-muted-foreground">Running</span>
                    </div>
                    <div className="text-center border-r border-border-subtle/50">
                      <span className="block font-mono text-base font-bold text-zinc-400">
                        {campaign.waitingCount || 0}
                      </span>
                      <span className="text-[9px] text-muted-foreground">Waiting</span>
                    </div>
                    <div className="text-center border-r border-border-subtle/50">
                      <span className="block font-mono text-base font-bold text-success">
                        {campaign.repliedCount || 0}
                      </span>
                      <span className="text-[9px] text-muted-foreground">Replies</span>
                    </div>
                    <div className="text-center border-r border-border-subtle/50">
                      <span className="block font-mono text-base font-bold text-success">
                        {campaign.completedCount || 0}
                      </span>
                      <span className="text-[9px] text-muted-foreground">Completed</span>
                    </div>
                    <div className="text-center border-r border-border-subtle/50">
                      <span className="block font-mono text-base font-bold text-warning">
                        {campaign.pausedCount || 0}
                      </span>
                      <span className="text-[9px] text-muted-foreground">Paused</span>
                    </div>
                    <div className="text-center">
                      <span className="block font-mono text-base font-bold text-danger">
                        {campaign.failedCount || 0}
                      </span>
                      <span className="text-[9px] text-muted-foreground">Failed</span>
                    </div>
                  </div>

                  {/* Activity Sub-Tab Switcher */}
                  <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={activitySubTab === 'leads' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setActivitySubTab('leads')}
                        className="h-7 text-[11px] rounded-none gap-1.5"
                      >
                        <Users className="w-3.5 h-3.5" />
                        Enrolled Leads & Stepper
                      </Button>
                      <Button
                        type="button"
                        variant={activitySubTab === 'deliveries' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setActivitySubTab('deliveries')}
                        className="h-7 text-[11px] rounded-none gap-1.5"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Outbound Delivery Ledger ({rawDeliveries.length})
                      </Button>
                      <Button
                        type="button"
                        variant={activitySubTab === 'analytics' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setActivitySubTab('analytics')}
                        className="h-7 text-[11px] rounded-none gap-1.5"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        Performance Analytics & Attribution
                      </Button>
                    </div>
                  </div>

                  {activitySubTab === 'analytics' ? (
                    <CampaignAnalyticsView
                      workspaceId={workspaceId}
                      campaignId={selectedCampaignId}
                    />
                  ) : activitySubTab === 'leads' ? (
                    /* Main detail workflow section: Left Enrollment Table, Right Timeline Stepper */
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Enrollment Table Column */}
                      <div className="lg:col-span-2 space-y-3 bg-card border border-border-subtle rounded-none p-4 shadow-sm">
                        <div className="flex justify-between items-center gap-2">
                          <h4 className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                            <Users className="h-4 w-4 text-primary" />
                            Enrolled Recipient Leads
                          </h4>

                          {/* Search and filter toolbar */}
                          <div className="flex gap-2">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground opacity-60" />
                              <Input
                                placeholder="Search leads..."
                                value={enrollmentSearch}
                                onChange={(e) => handleEnrollmentSearchChange(e.target.value)}
                                className="pl-8 h-7 text-[10px] w-40 rounded-none border-border-subtle bg-card"
                              />
                            </div>
                            <select
                              value={enrollmentStatusFilter}
                              onChange={(e) => handleEnrollmentStatusChange(e.target.value)}
                              className="h-7 text-[10px] bg-background border border-border-subtle rounded-none px-1.5 focus-visible:outline-none"
                            >
                              <option value="all">All Statuses</option>
                              <option value="running">Running</option>
                              <option value="waiting">Waiting</option>
                              <option value="paused">Paused</option>
                              <option value="replied">Replied</option>
                              <option value="completed">Completed</option>
                              <option value="failed">Failed</option>
                            </select>
                          </div>
                        </div>

                        {/* Bulk Actions Banner on selections */}
                        {selectedEnrollmentIds.length > 0 && (
                          <div className="flex items-center justify-between bg-surface-3 border border-border-subtle rounded-none p-2.5 text-[10px]">
                            <span className="font-semibold text-foreground">
                              {selectedEnrollmentIds.length} lead(s) selected
                            </span>
                            <div className="flex gap-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => bulkResumeMutation.mutate(selectedEnrollmentIds)}
                                className="h-6 text-[9px] px-2 text-success rounded-none hover:bg-success-muted"
                              >
                                Resume
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => bulkPauseMutation.mutate(selectedEnrollmentIds)}
                                className="h-6 text-[9px] px-2 text-warning rounded-none hover:bg-warning-muted"
                              >
                                Pause
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Remove ${selectedEnrollmentIds.length} lead(s) from campaign?`
                                    )
                                  ) {
                                    bulkRemoveMutation.mutate(selectedEnrollmentIds);
                                  }
                                }}
                                className="h-6 text-[9px] px-2 text-danger rounded-none hover:bg-danger-muted"
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Enrolled Leads Table */}
                        <div className="border border-border-subtle rounded-none overflow-hidden flex flex-col justify-between">
                          <Table>
                            <TableHeader className="bg-surface-3/40">
                              <TableRow>
                                <TableHead className="w-8 py-2">
                                  <input
                                    type="checkbox"
                                    checked={
                                      selectedEnrollmentIds.length === paginatedEnrollments.length &&
                                      paginatedEnrollments.length > 0
                                    }
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedEnrollmentIds(
                                          paginatedEnrollments.map((x: any) => x.id)
                                        );
                                      } else {
                                        setSelectedEnrollmentIds([]);
                                      }
                                    }}
                                    className="rounded-none border-border-subtle text-primary focus:ring-ring"
                                  />
                                </TableHead>
                                <TableHead className="py-2">Contact</TableHead>
                                <TableHead className="py-2">Next Run</TableHead>
                                <TableHead className="py-2">Status</TableHead>
                                <TableHead className="py-2 text-center">Sends</TableHead>
                                <TableHead className="py-2 text-right">Action</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {paginatedEnrollments.map((enroll: any) => {
                                const isChecked = selectedEnrollmentIds.includes(enroll.id);
                                const nextRun = enroll.nextExecutionAt
                                  ? formatDistanceToNow(new Date(enroll.nextExecutionAt))
                                  : '—';
                                return (
                                  <TableRow
                                    key={enroll.id}
                                    className={`hover:bg-surface-3/15 cursor-pointer ${
                                      selectedEnrollment?.id === enroll.id ? 'bg-primary/12' : ''
                                    }`}
                                    onClick={() => setSelectedEnrollment(enroll)}
                                  >
                                    <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedEnrollmentIds([
                                              ...selectedEnrollmentIds,
                                              enroll.id
                                            ]);
                                          } else {
                                            setSelectedEnrollmentIds(
                                              selectedEnrollmentIds.filter((x) => x !== enroll.id)
                                            );
                                          }
                                        }}
                                        className="rounded-none border-border-subtle text-primary focus:ring-ring"
                                      />
                                    </TableCell>
                                    <TableCell className="py-2">
                                      <div className="font-semibold text-foreground">
                                        {enroll.firstName} {enroll.lastName || ''}
                                      </div>
                                      <span className="block text-[9px] font-mono text-primary truncate max-w-[120px]">
                                        {enroll.email}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2 font-mono text-[10px] text-muted-foreground">
                                      {nextRun}
                                    </TableCell>
                                    <TableCell className="py-2">
                                      {getEnrollmentStatusBadge(enroll.status)}
                                    </TableCell>
                                    <TableCell className="py-2 text-center font-mono font-bold">
                                      {enroll.emailsSentCount || 0}
                                    </TableCell>
                                    <TableCell
                                      className="py-2 text-right"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          if (confirm('Remove lead from this campaign?')) {
                                            bulkRemoveMutation.mutate([enroll.id]);
                                          }
                                        }}
                                        className="h-6 w-6 p-0 text-danger hover:bg-danger-muted rounded-none"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>

                        {/* Enrollment table pagination controls */}
                        {totalEnrollmentPages > 1 && (
                          <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-2 select-none">
                            <span className="text-[11px] text-muted-foreground">
                              Showing{' '}
                              <strong className="text-foreground font-mono">{enrollmentStartIndex + 1}</strong>{' '}
                              to{' '}
                              <strong className="text-foreground font-mono">
                                {Math.min(enrollmentStartIndex + enrollmentsPerPage, totalEnrollments)}
                              </strong>{' '}
                              of <strong className="text-foreground font-mono">{totalEnrollments}</strong> leads
                            </span>

                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEnrollmentPage((p) => Math.max(1, p - 1));
                                }}
                                disabled={adjustedEnrollmentPage === 1}
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
                                  setEnrollmentPage((p) => Math.min(totalEnrollmentPages, p + 1));
                                }}
                                disabled={adjustedEnrollmentPage === totalEnrollmentPages}
                                className="h-8 rounded-none px-3 text-[11px] font-semibold transition-colors cursor-pointer"
                              >
                                Next
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Stepper Details Column */}
                      <div className="bg-card border border-border-subtle rounded-none p-4 shadow-sm space-y-4">
                        <h4 className="font-semibold text-foreground text-[11px] flex items-center gap-1.5 pb-2 border-b border-border-subtle">
                          <Activity className="h-4 w-4 text-primary" />
                          Execution Telemetry Stream
                        </h4>

                        {selectedEnrollment ? (
                          <div className="space-y-4">
                            <div>
                              <span className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider block">
                                Selected Recipient
                              </span>
                              <div className="font-bold text-foreground text-xs mt-0.5">
                                {selectedEnrollment.firstName} {selectedEnrollment.lastName || ''}
                              </div>
                              <span className="text-[10px] font-mono text-primary block mt-0.5">
                                {selectedEnrollment.email}
                              </span>
                              {selectedEnrollment.companyName && (
                                <span className="text-[10px] text-muted-foreground block mt-0.5 truncate">
                                  Firm: {selectedEnrollment.companyName}
                                </span>
                              )}
                            </div>

                            <div className="space-y-1">
                              <span className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider block">
                                Sequence Progress
                              </span>
                              <div className="text-[11px] font-medium text-foreground flex items-center gap-2">
                                {getEnrollmentStatusBadge(selectedEnrollment.status)}
                                <span className="font-mono">
                                  Step {selectedEnrollment.currentStepIndex || 0} of{' '}
                                  {sequence?.steps ? (typeof sequence.steps === 'string' ? JSON.parse(sequence.steps).length : sequence.steps.length) : 0}
                                </span>
                              </div>
                              {selectedEnrollment.status === 'replied' && (
                                <p className="text-[9px] text-success font-semibold flex items-center gap-0.5 mt-1 bg-success-muted border border-success/15 px-2 py-1">
                                  <CheckCircle className="h-3 w-3" />
                                  Sequence stopped because recipient replied!
                                </p>
                              )}
                              {selectedEnrollment.status === 'failed' && (
                                <p className="text-[9px] text-danger font-semibold flex items-center gap-0.5 mt-1 bg-danger-muted border border-danger/15 px-2 py-1">
                                  <AlertCircle className="h-3 w-3" />
                                  Send failed: check SMTP credentials or connection logs.
                                </p>
                              )}
                            </div>

                            {/* Raw logs output */}
                            <div className="space-y-1.5 pt-3 border-t border-border-subtle">
                              <span className="block font-semibold text-foreground text-[10px]">
                                Technical Audit Logs:
                              </span>
                              <div className="bg-surface-3 border border-border-subtle rounded-none p-2.5 font-mono text-[9px] max-h-40 overflow-y-auto space-y-1 text-muted-foreground">
                                {selectedEnrollment.logs && selectedEnrollment.logs.length > 0 ? (
                                  selectedEnrollment.logs.map((log: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="border-b border-border-subtle/30 pb-1 last:border-0 last:pb-0"
                                    >
                                      <span className="text-zinc-500">
                                        [{new Date(log.timestamp).toLocaleTimeString()}]
                                      </span>{' '}
                                      <span className="text-foreground font-semibold">
                                        {log.action || 'Log'}:
                                      </span>{' '}
                                      {log.message}
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-center py-2 italic text-zinc-500">
                                    No telemetry log entries.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-10 text-muted-foreground italic">
                            Select a contact from the leads table to view their execution timeline
                            stepper.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Outbound Delivery Ledger Table */
                    <div className="space-y-3 bg-card border border-border-subtle rounded-none p-4 shadow-sm">
                      <div className="flex justify-between items-center gap-2">
                        <h4 className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                          <Mail className="h-4 w-4 text-primary" />
                          Outbound Delivery History & Verification Ledger
                        </h4>

                        {/* Search and filter toolbar */}
                        <div className="flex gap-2">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground opacity-60" />
                            <Input
                              placeholder="Search recipient, sender, subject..."
                              value={deliverySearch}
                              onChange={(e) => handleDeliverySearchChange(e.target.value)}
                              className="pl-8 h-7 text-[10px] w-64 rounded-none border-border-subtle bg-card"
                            />
                          </div>
                          <select
                            value={deliveryStatusFilter}
                            onChange={(e) => handleDeliveryStatusChange(e.target.value)}
                            className="h-7 text-[10px] bg-background border border-border-subtle rounded-none px-1.5 focus-visible:outline-none"
                          >
                            <option value="all">All Delivery Statuses</option>
                            <option value="SENT">Sent</option>
                            <option value="SENDING">Sending</option>
                            <option value="FAILED">Failed</option>
                            <option value="SUPPRESSED">Suppressed</option>
                          </select>
                        </div>
                      </div>

                      <div className="border border-border-subtle rounded-none overflow-hidden">
                        <Table>
                          <TableHeader className="bg-surface-3/40">
                            <TableRow>
                              <TableHead className="py-2 w-24">Status</TableHead>
                              <TableHead className="py-2">Recipient</TableHead>
                              <TableHead className="py-2">Step / Subject</TableHead>
                              <TableHead className="py-2">Sender Mailbox</TableHead>
                              <TableHead className="py-2">Sent Time</TableHead>
                              <TableHead className="py-2 text-right">Provider Message ID / Info</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paginatedDeliveries.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground italic">
                                  No outbound delivery attempts recorded for this campaign yet.
                                </TableCell>
                              </TableRow>
                            ) : (
                              paginatedDeliveries.map((deliv: any) => {
                                const sentTime = deliv.sentAt || deliv.createdAt;
                                return (
                                  <TableRow key={deliv.id} className="hover:bg-surface-3/15 text-[11px]">
                                    <TableCell className="py-2">
                                      {getDeliveryStatusBadge(deliv.status)}
                                    </TableCell>
                                    <TableCell className="py-2">
                                      <div className="font-semibold text-foreground">
                                        {deliv.firstName ? `${deliv.firstName} ${deliv.lastName || ''}` : deliv.contactEmail || deliv.recipientEmail}
                                      </div>
                                      <span className="block text-[9px] font-mono text-primary truncate max-w-[160px]">
                                        {deliv.recipientEmail}
                                      </span>
                                      {deliv.companyName && (
                                        <span className="block text-[9px] text-muted-foreground truncate max-w-[160px]">
                                          {deliv.companyName}
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-2 max-w-[220px]">
                                      <div className="text-[10px] font-bold text-foreground truncate">
                                        Step {deliv.stepIndex + 1}: {deliv.subject}
                                      </div>
                                      <span className="block text-[9px] font-mono text-muted-foreground truncate">
                                        Campaign: {deliv.campaignName || campaign.name || 'Outreach'}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2 font-mono text-[10px] text-muted-foreground">
                                      {deliv.senderEmail}
                                    </TableCell>
                                    <TableCell className="py-2 font-mono text-[10px] text-muted-foreground">
                                      {sentTime ? formatDistanceToNow(new Date(sentTime), { addSuffix: true }) : '—'}
                                    </TableCell>
                                    <TableCell className="py-2 text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <EngagementPills
                                          openCount={deliv.openCount}
                                          clickCount={deliv.clickCount}
                                          replyCount={deliv.replyCount}
                                          firstOpenedAt={deliv.firstOpenedAt}
                                          firstClickedAt={deliv.firstClickedAt}
                                          lastRepliedAt={deliv.lastRepliedAt}
                                          size="sm"
                                        />
                                        {deliv.providerMessageId ? (
                                          <span className="font-mono text-[9px] bg-surface-3 border border-border-subtle px-1.5 py-0.5 rounded-none text-foreground hidden sm:inline" title={deliv.providerMessageId}>
                                            ID: {deliv.providerMessageId.slice(0, 10)}...
                                          </span>
                                        ) : deliv.error ? (
                                          <span className="text-danger text-[9px] font-mono truncate max-w-[120px] inline-block" title={deliv.error}>
                                            {deliv.error}
                                          </span>
                                        ) : null}
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-1.5 text-[10px] text-primary hover:text-primary rounded-none"
                                          onClick={() => navigate(`/emails?id=${deliv.id}`)}
                                          title="Inspect full rendered message and lifecycle timeline in Email Logs"
                                        >
                                          Inspect &rarr;
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Delivery table pagination controls */}
                      {totalDeliveryPages > 1 && (
                        <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-2 select-none">
                          <span className="text-[11px] text-muted-foreground">
                            Showing <strong className="text-foreground font-mono">{deliveryStartIndex + 1}</strong> to{' '}
                            <strong className="text-foreground font-mono">
                              {Math.min(deliveryStartIndex + deliveriesPerPage, totalDeliveries)}
                            </strong>{' '}
                            of <strong className="text-foreground font-mono">{totalDeliveries}</strong> deliveries
                          </span>

                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDeliveryPage((p) => Math.max(1, p - 1));
                              }}
                              disabled={adjustedDeliveryPage === 1}
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
                                setDeliveryPage((p) => Math.min(totalDeliveryPages, p + 1));
                              }}
                              disabled={adjustedDeliveryPage === totalDeliveryPages}
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
              );
            })()
          )}
        </TabsContent>

        {/* ── QUEUE MONITOR TAB (INTEGRATED COMPONENT) ───────────────────── */}
        <TabsContent value="monitor" className="mt-4">
          <QueueMonitor />
        </TabsContent>

        {/* ── EMAIL TEMPLATES TAB ─────────────────────────────────────────── */}
        <TabsContent value="templates" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-foreground text-[11px]">Email Copy Templates</span>
            <Button
              onClick={handleOpenCreateTemplate}
              size="sm"
              className="flex items-center gap-1 rounded-none"
            >
              <Plus className="h-3 w-3" />
              Create Template
            </Button>
          </div>

          {templates.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center p-6 bg-card border border-border-subtle border-dashed rounded-none">
              <div className="max-w-md w-full flex flex-col items-center text-center space-y-4">
                <div className="w-12 h-12 rounded-none bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                  <FileText className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-foreground">No email templates found</h3>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Draft merge copy templates with dynamic variables like {`{{firstName}}`} or {`{{company}}`}.
                  </p>
                </div>
                <Button onClick={handleOpenCreateTemplate} size="sm" className="rounded-none">
                  + Create Template
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((tpl: any) => (
                <div
                  key={tpl.id}
                  className="bg-card border border-border-subtle rounded-none p-4 space-y-3 shadow-sm hover:shadow-md transition"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-foreground text-xs">{tpl.name}</h4>
                      <span className="block text-[10px] text-muted-foreground truncate max-w-xs mt-0.5 font-mono">
                        Subject: {tpl.subject}
                      </span>
                      {tpl.attachments && (Array.isArray(tpl.attachments) ? tpl.attachments : JSON.parse(tpl.attachments || '[]')).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(Array.isArray(tpl.attachments) ? tpl.attachments : JSON.parse(tpl.attachments || '[]')).map((att: any, attIdx: number) => (
                            <span
                              key={att.id || attIdx}
                              className="inline-flex items-center gap-1 bg-surface-2 border border-border-subtle px-1.5 py-0.5 text-[9px] text-muted-foreground font-mono"
                            >
                              <Paperclip className="w-2.5 h-2.5" />
                              {att.filename}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPreviewTemplateId(tpl.id);
                          setPreviewOpen(true);
                        }}
                        className="h-7 text-[10px] gap-0.5 rounded-none"
                      >
                        <Eye className="h-3 w-3" />
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenEditTemplate(tpl)}
                        className="h-7 text-[10px] gap-0.5 rounded-none hover:text-primary"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteTemplateMutation.mutate(tpl.id)}
                        className="h-7 w-7 p-0 text-danger hover:bg-danger-muted rounded-none"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="bg-surface-3 border border-border-subtle rounded-none p-2.5 font-mono text-[10px] text-muted-foreground max-h-24 overflow-y-auto whitespace-pre-wrap">
                    {tpl.body}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>



      {/* ── Create / Edit Template Dialog ─────────────────────────────────── */}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-w-md rounded-none bg-background border border-border-subtle shadow-elevation-2 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplateId ? 'Edit Email Template' : 'Create Email Template'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveTemplate} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="tplName">Template Name</Label>
              <Input
                id="tplName"
                placeholder="Cold Pitch v1"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                required
                className="rounded-none bg-card border-border-subtle"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="tplSubj">Subject Line</Label>
                <select
                  className="h-6 text-[10px] bg-surface-3 border border-border-subtle rounded-none px-1 text-foreground focus:outline-none"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      setTplSubj((prev) => (prev ? `${prev} {{${val}}}` : `{{${val}}}`));
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="">+ Insert Variable</option>
                  <optgroup label="Contact">
                    <option value="contact.firstName">Contact First Name</option>
                    <option value="contact.lastName">Contact Last Name</option>
                    <option value="contact.email">Contact Email</option>
                    <option value="contact.title">Contact Job Title</option>
                  </optgroup>
                  <optgroup label="Company">
                    <option value="company.name">Company Name</option>
                    <option value="company.domain">Company Domain</option>
                    <option value="company.industry">Company Industry</option>
                    <option value="company.location">Company Location</option>
                  </optgroup>
                </select>
              </div>
              <Input
                id="tplSubj"
                placeholder="Quick question about {{company.name}}"
                value={tplSubj}
                onChange={(e) => setTplSubj(e.target.value)}
                required
                className="rounded-none bg-card border-border-subtle font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="tplBody">Message Body</Label>
                <select
                  className="h-6 text-[10px] bg-surface-3 border border-border-subtle rounded-none px-1 text-foreground focus:outline-none"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      setTplBody((prev) => (prev ? `${prev} {{${val}}}` : `{{${val}}}`));
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="">+ Insert Variable</option>
                  <optgroup label="Contact">
                    <option value="contact.firstName">Contact First Name</option>
                    <option value="contact.lastName">Contact Last Name</option>
                    <option value="contact.email">Contact Email</option>
                    <option value="contact.title">Contact Job Title</option>
                  </optgroup>
                  <optgroup label="Company">
                    <option value="company.name">Company Name</option>
                    <option value="company.domain">Company Domain</option>
                    <option value="company.industry">Company Industry</option>
                    <option value="company.location">Company Location</option>
                  </optgroup>
                </select>
              </div>
              <Textarea
                id="tplBody"
                rows={5}
                placeholder="Hi {{contact.firstName}}, I noticed {{company.name}} was looking to expand..."
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
                required
                className="rounded-none bg-card border-border-subtle font-mono text-xs"
              />
            </div>

            {/* Template Attachments Section */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                  Attachments ({tplAttachments.length})
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTplMediaPickerOpen(true)}
                  className="h-6 px-1.5 text-[10px] font-medium text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Attach from Media / Drive
                </Button>
              </div>

              {tplAttachments.length > 0 && (
                <div className="space-y-1 max-h-28 overflow-y-auto bg-surface-3 border border-border-subtle p-1.5 rounded-none">
                  {tplAttachments.map((att: any, idx: number) => (
                    <div
                      key={att.id || att.fileId || idx}
                      className="flex items-center justify-between px-2 py-1 bg-card border border-border-subtle text-[10px] font-mono text-foreground"
                    >
                      <span className="truncate max-w-[200px] flex items-center gap-1.5" title={att.filename}>
                        <Paperclip className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{att.filename}</span>
                        {att.size && (
                          <span className="text-muted-foreground text-[9px]">
                            ({Math.round(att.size / 1024)} KB)
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {att.driveUrl && (
                          <a
                            href={att.driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-primary"
                            title="Open in Google Drive"
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setTplAttachments((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-muted-foreground hover:text-danger ml-1"
                          title="Remove Attachment"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <MediaPickerDialog
                open={tplMediaPickerOpen}
                onOpenChange={setTplMediaPickerOpen}
                initialSelected={tplAttachments}
                onSelect={(selected) => setTplAttachments(selected)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <Button type="button" variant="secondary" className="rounded-none" onClick={() => setTemplateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-none"
                disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending}
              >
                {editingTemplateId ? 'Update Template' : 'Save Template'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Launch Campaign Dialog ───────────────────────────────────────── */}
      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
        <DialogContent className="max-w-xl rounded-none bg-card border border-border-subtle shadow-elevation-2 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground font-bold text-sm">
              <Megaphone className="w-4 h-4 text-primary" />
              Launch Outreach Campaign
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateCampaign} className="space-y-4">
            {/* Section 1: Target Audience */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-foreground uppercase tracking-wider font-mono border-b border-border-subtle pb-1 flex items-center justify-between">
                <span>1. Target Audience</span>
                {selectedAudienceId && (
                  <Badge className="bg-primary/10 text-primary border border-primary/20 text-[9px] rounded-none">
                    Audience Selected
                  </Badge>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="campAudience" className="text-xs">Select Target Audience Segment</Label>
                <select
                  id="campAudience"
                  value={selectedAudienceId}
                  onChange={(e) => setSelectedAudienceId(e.target.value)}
                  className="w-full h-8 px-2 bg-surface-3 border border-border-subtle rounded-none text-xs text-foreground focus-visible:outline-none font-sans"
                >
                  <option value="">-- All Active Contacts --</option>
                  {((audiencesQuery.data || []) as any[]).map((aud: any) => (
                    <option key={aud.id} value={aud.id}>
                      {`${aud.name} (${aud.contactCount || 0} contacts • ${aud.mode?.toUpperCase() || 'DYNAMIC'})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Section 2: Campaign Details */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-foreground uppercase tracking-wider font-mono border-b border-border-subtle pb-1">
                2. Campaign Details
              </div>
              <div className="space-y-1">
                <Label htmlFor="campName" className="text-xs">Campaign Name <span className="text-danger">*</span></Label>
                <Input
                  id="campName"
                  placeholder="e.g. Q4 SaaS Leads Outreach"
                  value={campName}
                  onChange={(e) => setCampName(e.target.value)}
                  required
                  className="rounded-none bg-surface-3 border-border-subtle text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="campDesc" className="text-xs">Description</Label>
                <Input
                  id="campDesc"
                  placeholder="Target audience and campaign goals..."
                  value={campDesc}
                  onChange={(e) => setCampDesc(e.target.value)}
                  className="rounded-none bg-surface-3 border-border-subtle text-xs"
                />
              </div>
            </div>

            {/* Section 3: Outreach Sequence Builder */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-foreground uppercase tracking-wider font-mono border-b border-border-subtle pb-1 flex items-center justify-between">
                <span>3. Outreach Sequence</span>
                <span className="text-[10px] text-muted-foreground font-normal">
                  {sequenceSteps.length} step(s) configured
                </span>
              </div>

              <ProgressiveSequenceEditor
                steps={sequenceSteps}
                onChange={setSequenceSteps}
                templates={templates}
              />
            </div>

            {/* Section 4: Sender & Schedule Settings */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-foreground uppercase tracking-wider font-mono border-b border-border-subtle pb-1">
                4. Sender & Schedule Settings
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="campAcc" className="text-xs">Sender Email Account <span className="text-danger">*</span></Label>
                  {accountsQuery.isError && (
                    <button
                      type="button"
                      onClick={() => accountsQuery.refetch()}
                      className="text-[10px] text-danger hover:underline font-mono"
                    >
                      Retry Loading
                    </button>
                  )}
                </div>

                <select
                  id="campAcc"
                  value={campAccId}
                  onChange={(e) => setCampAccId(e.target.value)}
                  className="w-full h-8 px-2 bg-surface-3 border border-border-subtle rounded-none text-xs text-foreground focus-visible:outline-none"
                  required
                  disabled={accountsQuery.isLoading}
                >
                  {accountsQuery.isLoading ? (
                    <option value="">Loading sender accounts...</option>
                  ) : accountsQuery.isError ? (
                    <option value="">Unable to load sender accounts. Retry above.</option>
                  ) : accounts.length === 0 ? (
                    <option value="">No sender accounts connected. Connect Gmail in Settings → Integrations.</option>
                  ) : (
                    <>
                      <option value="">-- Select Sender Account --</option>
                      {accounts.map((acc: any) => (
                        <option key={acc.id} value={acc.id}>
                          {`${acc.name || 'Gmail Account'} (${acc.email || acc.id})`}
                        </option>
                      ))}
                    </>
                  )}
                </select>

                {!accountsQuery.isLoading && accounts.length === 0 && (
                  <p className="text-[10px] text-warning mt-1 flex items-center gap-1 font-mono">
                    ⚠️ No connected senders. Go to Settings → Integrations to link a Gmail account.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="campLimit" className="text-xs">Daily Limit</Label>
                  <Input
                    id="campLimit"
                    type="number"
                    value={campLimit}
                    onChange={(e) => setCampLimit(parseInt(e.target.value) || 200)}
                    required
                    className="rounded-none bg-surface-3 border-border-subtle font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="campTz" className="text-xs">Timezone</Label>
                  <Input
                    id="campTz"
                    value={campTimezone}
                    onChange={(e) => setCampTimezone(e.target.value)}
                    required
                    className="rounded-none bg-surface-3 border-border-subtle text-xs"
                  />
                </div>
              </div>

              {/* Signature Option */}
              <div className="flex items-center space-x-2 pt-1 pb-1">
                <Checkbox
                  id="camp-use-signature"
                  checked={campUseSignature}
                  onCheckedChange={(c) => setCampUseSignature(!!c)}
                />
                <Label htmlFor="camp-use-signature" className="text-xs cursor-pointer select-none font-medium text-foreground">
                  Include Gmail signature on outbound emails
                </Label>
              </div>

              {/* Email Tracking Option */}
              <div className="space-y-1 pt-1 pb-1 border-t border-border-subtle/50">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="camp-tracking-enabled"
                    checked={campTrackingEnabled}
                    onCheckedChange={(c) => setCampTrackingEnabled(!!c)}
                  />
                  <Label htmlFor="camp-tracking-enabled" className="text-xs cursor-pointer select-none font-medium text-foreground">
                    Enable email tracking
                  </Label>
                </div>
                <p className="text-[11px] text-muted-foreground pl-6">
                  Track email opens and link clicks for this campaign.
                </p>
              </div>
            </div>

            {/* Section 5: Review & Safety Summary */}
            <div className="bg-surface-3/60 border border-border-subtle rounded-none p-3 space-y-2">
              <div className="text-[10px] font-bold text-foreground uppercase tracking-wider font-mono flex items-center gap-1 text-primary">
                <CheckCircle className="w-3.5 h-3.5" /> Launch Review Summary
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-muted-foreground">
                <div>
                  <span className="text-foreground font-semibold">Audience:</span>{' '}
                  {selectedAudienceId
                    ? ((audiencesQuery.data || []) as any[]).find((a) => a.id === selectedAudienceId)?.name || 'Selected'
                    : 'All Active Contacts'}
                </div>
                <div>
                  <span className="text-foreground font-semibold">Steps:</span> {sequenceSteps.length} step(s)
                </div>
                <div>
                  <span className="text-foreground font-semibold">Sender:</span>{' '}
                  {accounts.find((a: any) => a.id === campAccId)?.email || 'None selected'}
                </div>
                <div>
                  <span className="text-foreground font-semibold">Daily Limit:</span> {campLimit} emails/day
                </div>
                <div>
                  <span className="text-foreground font-semibold">Signature:</span>{' '}
                  {campUseSignature ? 'Enabled (Gmail)' : 'Disabled'}
                </div>
                <div>
                  <span className="text-foreground font-semibold">Tracking:</span>{' '}
                  {campTrackingEnabled ? 'Enabled (Opens & Clicks)' : 'Disabled'}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
              <Button
                type="button"
                variant="secondary"
                className="rounded-none"
                onClick={() => setCampaignOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-none gap-1.5 font-semibold"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Launching Outreach...
                  </>
                ) : (
                  <>
                    <Megaphone className="w-3.5 h-3.5" />
                    Launch Outreach
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Live Preview Drawer Dialog ────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl rounded-none bg-background border border-border-subtle shadow-elevation-2">
          <DialogHeader>
            <DialogTitle>Template Live Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="previewContact">Preview Recipient Contact</Label>
              <select
                id="previewContact"
                value={previewContactId}
                onChange={(e) => setPreviewContactId(e.target.value)}
                className="w-full h-8 px-2 bg-background border border-border-subtle rounded-none text-xs focus-visible:outline-none"
              >
                <option value="">-- Default Fallback Contact --</option>
                {contacts.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {`${c.firstName} ${c.lastName || ''} (${c.email})`}
                  </option>
                ))}
              </select>
            </div>

            {previewQuery.isLoading ? (
              <div className="text-center py-4 text-muted-foreground animate-pulse">Compiling template...</div>
            ) : previewQuery.data ? (
              <div className="space-y-2">
                <div className="border border-border-subtle p-2.5 bg-surface-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-foreground font-mono">Subject: </span>
                      <span className="font-medium text-foreground">{previewQuery.data.subject}</span>
                    </div>
                    {previewQuery.data.version && (
                      <span className="text-[10px] text-muted-foreground bg-surface-2 px-1.5 py-0.5 border border-border-subtle font-mono">
                        v{previewQuery.data.version}
                      </span>
                    )}
                  </div>
                </div>

                <SafeEmailPreview
                  subject={previewQuery.data.subject}
                  htmlBody={previewQuery.data.html || previewQuery.data.body}
                  textBody={previewQuery.data.text || previewQuery.data.body}
                  className="min-h-[160px]"
                />

                {previewTemplateId && (() => {
                  const currentTpl = (templatesQuery.data || []).find((t: any) => t.id === previewTemplateId);
                  const atts = currentTpl?.attachments
                    ? (Array.isArray(currentTpl.attachments) ? currentTpl.attachments : JSON.parse(currentTpl.attachments || '[]'))
                    : [];
                  if (atts.length === 0) return null;
                  return (
                    <div className="border border-border-subtle p-2 bg-surface-3">
                      <div className="text-[10px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                        <Paperclip className="w-3 h-3" /> Attached Files ({atts.length}):
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {atts.map((att: any, idx: number) => (
                          <span key={att.id || idx} className="inline-flex items-center gap-1 bg-surface-2 border border-border-subtle px-1.5 py-0.5 text-[9px] text-foreground">
                            <Paperclip className="w-2.5 h-2.5 text-muted-foreground" />
                            {att.filename} ({Math.round((att.size || 0) / 1024)} KB)
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : null}

            <div className="flex justify-end pt-2">
              <Button className="rounded-none" onClick={() => setPreviewOpen(false)}>Close Preview</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
