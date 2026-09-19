import { SendTestModal } from '../components/email/SendTestModal';
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import {
  useWorkspaceMembers,
  useUpdateMemberRole,
  useRemoveMember
} from '../hooks/useWorkspaceQuery';
import { usePermissions } from '../hooks/usePermissions';
import { UserAvatar } from '../components/ui/UserAvatar';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { RenameWorkspaceDialog, DeleteWorkspaceDialog } from '../components/ui/WorkspaceDialogs';
import {
  InviteMemberDialog,
  LeaveWorkspaceDialog,
  TransferOwnershipDialog
} from '../components/ui/MemberDialogs';
import { WorkspaceRole, WorkspaceMemberStatus, type WorkspaceMember } from '@leadforge/schema';
import {
  ShieldAlert,
  Trash2,
  UserPlus,
  LogOut,
  ArrowLeftRight,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Linkedin,
  Sparkles,
  Mail,
  Building2,
  Users,
  Plug,
  BookOpen,
  HardDrive
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/common/PageHeader';
import { WhatsNewDialog } from '../components/common/WhatsNewDialog';

export default function WorkspaceSettingsScreen() {
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const activeSection = searchParams.get('section') || 'general';

  const { role, isOwner, isAdmin } = usePermissions();

  const membersQuery = useWorkspaceMembers(activeWorkspace?.id || '');
  const updateRoleMutation = useUpdateMemberRole(activeWorkspace?.id || '');
  const removeMemberMutation = useRemoveMember(activeWorkspace?.id || '');

  // Dialog states
  const [inviteOpen, setInviteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  // Ownership Transfer state
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<{ id: string; name: string } | null>(null);

  if (!activeWorkspace) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-xs font-sans">
        No active workspace selected.
      </div>
    );
  }

  const setSection = (section: string) => {
    navigate(`/settings?section=${section}`, { replace: true });
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      await updateRoleMutation.mutateAsync({ memberId, role: newRole as WorkspaceRole });
      toast.success('Role updated successfully.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update role.');
    }
  };

  const handleRemove = async (memberId: string) => {
    if (confirm('Are you sure you want to remove this member from the workspace?')) {
      try {
        await removeMemberMutation.mutateAsync(memberId);
        toast.success('Member removed.');
      } catch (err: any) {
        toast.error(err.message || 'Failed to remove member.');
      }
    }
  };

  const startTransfer = (memberId: string, name: string) => {
    setTransferTarget({ id: memberId, name });
    setTransferOpen(true);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6 font-sans text-xs h-full overflow-y-auto pr-1 select-none">
      <PageHeader
        title="Workspace Settings"
        description="Manage your workspace details, integrations, team permissions, and updates."
      />

      {/* ── Sub-Navigation Section Tabs ─────────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-b border-border-subtle pb-3 overflow-x-auto shrink-0">
        <button
          onClick={() => setSection('general')}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold text-xs transition-colors cursor-pointer border rounded-none ${
            activeSection === 'general'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-surface-3 text-muted-foreground border-border-subtle hover:text-foreground'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>General</span>
        </button>

        <button
          onClick={() => setSection('team')}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold text-xs transition-colors cursor-pointer border rounded-none ${
            activeSection === 'team'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-surface-3 text-muted-foreground border-border-subtle hover:text-foreground'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Team & Workspace</span>
        </button>

        <button
          onClick={() => setSection('integrations')}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold text-xs transition-colors cursor-pointer border rounded-none ${
            activeSection === 'integrations'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-surface-3 text-muted-foreground border-border-subtle hover:text-foreground'
          }`}
        >
          <Plug className="w-3.5 h-3.5" />
          <span>Integrations</span>
        </button>

        <button
          onClick={() => setSection('updates')}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold text-xs transition-colors cursor-pointer border rounded-none ${
            activeSection === 'updates'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-surface-3 text-muted-foreground border-border-subtle hover:text-foreground'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Updates</span>
        </button>

        <button
          onClick={() => setSection('onboarding')}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold text-xs transition-colors cursor-pointer border rounded-none ${
            activeSection === 'onboarding'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-surface-3 text-muted-foreground border-border-subtle hover:text-foreground'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Onboarding</span>
        </button>

        <button
          onClick={() => setSection('danger')}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold text-xs transition-colors cursor-pointer border rounded-none ${
            activeSection === 'danger'
              ? 'bg-danger text-danger-foreground border-danger'
              : 'bg-surface-3 text-muted-foreground border-border-subtle hover:text-danger'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Danger Zone</span>
        </button>
      </div>

      {/* ── SECTION 1: General Details ──────────────────────────────────── */}
      {activeSection === 'general' && (
        <div className="bg-card border border-border-subtle rounded-none p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">General</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Basic details for this workspace.
              </p>
            </div>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)} className="rounded-none h-8 text-[11px] font-semibold">
                Rename
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Workspace Name
              </span>
              <p className="text-xs font-semibold text-foreground">{activeWorkspace.name}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Unique URL Slug
              </span>
              <p className="text-xs font-mono text-muted-foreground">/{activeWorkspace.slug}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 2: Workspace Members ──────────────────────────────── */}
      {activeSection === 'team' && (
        <div className="bg-card border border-border-subtle rounded-none p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Workspace Members</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Collaborators in this workspace.</p>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1 rounded-none h-8 text-[11px] font-semibold">
                <UserPlus className="w-3.5 h-3.5" />
                <span>Invite Member</span>
              </Button>
            )}
          </div>

          {/* Member list */}
          {membersQuery.isLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground">Loading members...</div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {((membersQuery.data as WorkspaceMember[]) || []).map((m) => {
                const emailStr = m.email || '';
                const memberName = emailStr.split('@')[0] || 'User';

                return (
                  <div
                    key={m.id || m.userId || m.email}
                    className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar initials={memberName.substring(0, 2).toUpperCase()} size="sm" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">{m.email}</span>
                          {m.status === WorkspaceMemberStatus.PENDING && (
                            <Badge className="bg-warning-muted text-warning border border-warning/20 text-[9px] font-bold rounded-none">
                              Pending
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-0.5 block font-mono">
                          Joined {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Role selector */}
                      {isAdmin && m.role !== WorkspaceRole.OWNER ? (
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.userId || m.id || '', e.target.value)}
                          className="bg-surface-3 border border-border-subtle rounded-none px-2 py-1 h-8 text-[11px] text-foreground focus-visible:outline-none font-semibold"
                        >
                          <option value={WorkspaceRole.MEMBER}>Member</option>
                          <option value={WorkspaceRole.ADMIN}>Admin</option>
                          <option value={WorkspaceRole.READ_ONLY}>Read Only</option>
                          <option value={WorkspaceRole.BILLING}>Billing</option>
                        </select>
                      ) : (
                        <span className="text-[10px] font-bold text-muted-foreground px-2.5 py-1 border border-border-subtle rounded-none bg-surface-3 font-mono">
                          {m.role}
                        </span>
                      )}

                      {/* Ownership transfer */}
                      {isOwner &&
                        m.role !== WorkspaceRole.OWNER &&
                        m.status === WorkspaceMemberStatus.ACTIVE && (
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 w-8 p-0 rounded-none text-muted-foreground hover:text-foreground"
                            title="Transfer Ownership"
                            onClick={() => startTransfer(m.userId || '', m.email)}
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </Button>
                        )}

                      {/* Remove member button */}
                      {isAdmin && m.role !== WorkspaceRole.OWNER && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 w-8 p-0 rounded-none text-danger hover:bg-danger-muted"
                          onClick={() => handleRemove(m.userId || m.id || '')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SECTION 3: Integrations (Email/Gmail, Google Drive & LinkedIn) ───────────── */}
      {activeSection === 'integrations' && (
        <div className="space-y-6">
          <EmailAccountsSection />
          <GoogleDriveIntegrationCard workspaceId={activeWorkspace.id || ''} />
          <LinkedInIntegrationCard workspaceId={activeWorkspace.id || ''} />
        </div>
      )}

      {/* ── SECTION 4: Application Updates ─────────────────────────────── */}
      {activeSection === 'updates' && <AutoUpdateSection />}

      {/* ── SECTION 5: Onboarding & Interactive Guides ──────────────── */}
      {activeSection === 'onboarding' && (
        <div className="bg-card border border-border-subtle rounded-none p-5 space-y-4 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>Interactive Guides & Onboarding</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Replay app tours or reset workspace initialization configuration.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="flex items-center justify-between border border-border-subtle rounded-none p-3 bg-surface-3/30">
              <div>
                <p className="text-xs font-semibold text-foreground">Interactive Product Tour</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Highlights discovery, CRM, and campaigns navigation.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-none text-[10px] h-8 font-semibold"
                onClick={() => {
                  localStorage.setItem('product_tour_active', 'true');
                  navigate('/');
                }}
              >
                Start Tour
              </Button>
            </div>

            <div className="flex items-center justify-between border border-border-subtle rounded-none p-3 bg-surface-3/30">
              <div>
                <p className="text-xs font-semibold text-foreground">Workspace Setup Wizard</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Rerun the health check diagnostics and setup steps.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-none text-[10px] h-8 font-semibold"
                onClick={() => {
                  localStorage.removeItem('onboarding_completed');
                  navigate('/onboarding');
                }}
              >
                Reset Setup
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 6: Danger Zone ────────────────────────────────────── */}
      {activeSection === 'danger' && (
        <div className="bg-card border border-danger/20 rounded-none p-5 space-y-4 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold text-danger flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-danger animate-pulse" />
              <span>Danger Zone</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Irreversible workspace settings.</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-between">
            {!isOwner && (
              <div className="flex items-center justify-between w-full border border-border-subtle rounded-none p-3 bg-surface-3/45">
                <div>
                  <p className="text-xs font-semibold text-foreground">Leave Workspace</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    You will lose access to all campaigns in this workspace.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setLeaveOpen(true)}
                  className="gap-1 rounded-none h-8 text-[11px]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Leave</span>
                </Button>
              </div>
            )}

            {isOwner && (
              <div className="flex items-center justify-between w-full border border-danger/25 rounded-none p-3 bg-danger/[0.02]">
                <div>
                  <p className="text-xs font-semibold text-danger">Delete Workspace</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-medium leading-normal">
                    Permanently delete this workspace and all associated CRM data.
                  </p>
                </div>
                <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} className="rounded-none h-8 text-[11px]">
                  Delete Workspace
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dialogs */}
      {isAdmin && (
        <>
          <RenameWorkspaceDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            workspaceId={activeWorkspace.id || ''}
            currentName={activeWorkspace.name}
          />
          <InviteMemberDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            workspaceId={activeWorkspace.id || ''}
          />
        </>
      )}

      {isOwner && (
        <DeleteWorkspaceDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          workspaceId={activeWorkspace.id || ''}
          workspaceName={activeWorkspace.name}
        />
      )}

      {!isOwner && (
        <LeaveWorkspaceDialog
          open={leaveOpen}
          onOpenChange={setLeaveOpen}
          workspaceId={activeWorkspace.id || ''}
          workspaceName={activeWorkspace.name}
        />
      )}

      {transferTarget && (
        <TransferOwnershipDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          workspaceId={activeWorkspace.id || ''}
          newOwnerId={transferTarget.id}
          newOwnerName={transferTarget.name}
          onSuccess={() => setTransferTarget(null)}
        />
      )}
    </div>
  );
}

function LinkedInIntegrationCard({ workspaceId }: { workspaceId: string }) {
  const [cookie, setCookie] = React.useState('');
  const [status, setStatus] = React.useState<{ configured: boolean; preview: string }>({
    configured: false,
    preview: ''
  });
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ valid: boolean; message: string } | null>(
    null
  );
  const [saving, setSaving] = React.useState(false);

  const fetchStatus = React.useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await window.ipc.invoke('linkedin:get-cookie-status', { workspaceId });
      setStatus(res);
    } catch {
      // Ignore
    }
  }, [workspaceId]);

  React.useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookie.trim()) return;
    setSaving(true);
    try {
      await window.ipc.invoke('linkedin:save-cookie', { workspaceId, cookie: cookie.trim() });
      setCookie('');
      setTestResult(null);
      await fetchStatus();
      toast.success('LinkedIn cookie saved successfully.');
    } catch (err: any) {
      toast.error(`Failed to save cookie: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = cookie.trim() ? { cookie: cookie.trim() } : {};
      const res = await window.ipc.invoke('linkedin:validate', payload);
      setTestResult(res);
      if (res.valid) {
        toast.success('Session connection validated successfully!');
      } else {
        toast.error('LinkedIn session validation failed.');
      }
    } catch (err: any) {
      setTestResult({ valid: false, message: `Test error: ${err.message || err}` });
      toast.error(`Test failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-card border border-border-subtle rounded-none p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Linkedin className="w-4 h-4 text-[#0077b5]" />
            <span>LinkedIn Executive Enrichment</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Store your LinkedIn session cookie (
            <code className="font-mono text-[10px] bg-surface-3 px-1.5 py-0.5 rounded-none border border-border-subtle/40">li_at</code>) to
            automatically scrape executive decision-makers (CEOs, VPs, Directors).
          </p>
        </div>
        <div>
          {status.configured ? (
            <span className="px-2 py-0.5 rounded-none bg-success-muted text-success border border-success/20 text-[10px] font-bold flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Configured ({status.preview})
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-none bg-warning-muted text-warning border border-warning/20 text-[10px] font-bold">
              Not Configured
            </span>
          )}
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-3 pt-1">
        <div className="space-y-1">
          <label
            htmlFor="liCookieInput"
            className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block"
          >
            LinkedIn Session Cookie (li_at)
          </label>
          <div className="flex gap-2">
            <input
              id="liCookieInput"
              type="password"
              placeholder={
                status.configured
                  ? 'Paste new li_at cookie to update...'
                  : 'AQED... (paste li_at cookie value from DevTools)'
              }
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              className="flex-1 bg-surface-3 border border-border-subtle rounded-none px-3 py-1.5 text-xs font-mono text-foreground focus-visible:outline-none focus:border-primary"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-none h-8 font-semibold text-[11px]"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Test Cookie'}
            </Button>
            <Button type="submit" size="sm" className="rounded-none h-8 font-semibold text-[11px]" disabled={saving || !cookie.trim()}>
              {saving ? 'Saving...' : 'Save Cookie'}
            </Button>
          </div>
        </div>

        {testResult && (
          <div
            className={`p-3 rounded-none border text-xs flex items-start gap-2 ${
              testResult.valid
                ? 'bg-success-muted text-success border-success/20'
                : 'bg-danger-muted text-danger border-danger/20'
            }`}
          >
            {testResult.valid ? (
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-bold">
                {testResult.valid ? 'Session Active' : 'Validation Failed'}
              </div>
              <div className="text-[11px] opacity-90 leading-relaxed font-mono">{testResult.message}</div>
            </div>
          </div>
        )}

        <div className="bg-surface-3/45 border border-border-subtle rounded-none p-3 text-[10px] text-muted-foreground space-y-1">
          <div className="font-bold text-foreground flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-primary animate-pulse" />
            How to get your li_at cookie:
          </div>
          <div>1. Log into LinkedIn in Google Chrome or Edge</div>
          <div>
            2. Press <code className="font-mono bg-surface-3 px-1.5 py-0.5 text-foreground rounded-none border border-border-subtle/50">F12</code> →
            Open <strong>Application</strong> tab → <strong>Cookies</strong> →{' '}
            <code className="font-mono text-foreground font-semibold">https://www.linkedin.com</code>
          </div>
          <div>
            3. Find <code className="font-mono bg-surface-3 px-1.5 py-0.5 text-foreground rounded-none border border-border-subtle/50">li_at</code>{' '}
            → Copy the Cookie Value → Paste here
          </div>
        </div>
      </form>
    </div>
  );
}

function GoogleDriveIntegrationCard({ workspaceId }: { workspaceId: string }) {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchConnections = React.useCallback(async () => {
    if (!workspaceId) return;
    try {
      const list = await window.ipc.invoke('drive:connections:list', { workspaceId });
      setConnections(list || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  React.useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const pollTransaction = (transactionId: string) => {
    setConnecting(true);
    const interval = setInterval(async () => {
      try {
        const res = await window.ipc.invoke('drive:status', { transactionId });
        if (res.status === 'completed') {
          clearInterval(interval);
          setConnecting(false);
          toast.success('Google Drive authorized successfully!');
          fetchConnections();
        } else if (res.status === 'failed') {
          clearInterval(interval);
          setConnecting(false);
          toast.error(`Google Drive authorization failed: ${res.error || 'Unknown error'}`);
        }
      } catch {
        // continue polling
      }
    }, 2000);

    setTimeout(() => {
      clearInterval(interval);
      setConnecting(false);
    }, 180000);
  };

  const handleConnect = async () => {
    try {
      const res = await window.ipc.invoke('drive:connect', undefined);
      if (res.transactionId) {
        toast.info('Google authorization opened in Chrome. Please approve Drive permissions...');
        pollTransaction(res.transactionId);
      }
    } catch (err: any) {
      toast.error(`Could not start Google Drive connection: ${err.message || err}`);
    }
  };

  const handleReconnect = async (id: string) => {
    try {
      const res = await window.ipc.invoke('drive:reconnect', { id });
      if (res.transactionId) {
        toast.info('Google re-authorization opened in Chrome. Please approve Drive permissions...');
        pollTransaction(res.transactionId);
      }
    } catch (err: any) {
      toast.error(`Could not start Google Drive reconnect: ${err.message || err}`);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Are you sure you want to disconnect Google Drive for this workspace?')) return;
    setActionId(id);
    try {
      await window.ipc.invoke('drive:disconnect', { id });
      toast.success('Google Drive connection removed.');
      fetchConnections();
    } catch (err: any) {
      toast.error(`Failed to disconnect: ${err.message || err}`);
    } finally {
      setActionId(null);
    }
  };

  const driveConnection = connections.find(
    (c: any) =>
      c.driveStatus === 'authorized' ||
      (Array.isArray(c.scopes) && c.scopes.some((s: string) => typeof s === 'string' && s.includes('drive')))
  ) || connections[0];

  const isDriveAuthorized =
    driveConnection &&
    (driveConnection.driveStatus === 'authorized' ||
      (Array.isArray(driveConnection.scopes) &&
        driveConnection.scopes.some((s: string) => typeof s === 'string' && s.includes('drive'))));

  return (
    <div className="bg-card border border-border-subtle rounded-none p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[#34A853]" />
            <span>Google Drive Workspace Integration</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Authorize Google Drive to browse, attach, and deliver PDF case studies, one-pagers, and sales decks with campaign emails.
          </p>
        </div>
        <div>
          {isDriveAuthorized ? (
            <span className="px-2 py-0.5 rounded-none bg-success-muted text-success border border-success/20 text-[10px] font-bold flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Connected ({driveConnection.email})
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-none bg-warning-muted text-warning border border-warning/20 text-[10px] font-bold">
              Not Connected
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-muted-foreground">Checking Google Drive connection...</div>
      ) : isDriveAuthorized ? (
        <div className="border border-border-subtle rounded-none p-3 bg-surface-3/30 flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">{driveConnection.email}</span>
              <Badge className="bg-success-muted text-success border border-success/20 text-[9px] font-bold rounded-none">
                Drive Scope Authorized
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              Granted Scopes: drive.file, gmail.send, openid, email
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-none h-8 font-semibold text-[11px]"
              onClick={() => handleReconnect(driveConnection.id || driveConnection._id)}
              disabled={connecting}
            >
              {connecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Re-authorize'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-none h-8 text-[11px] text-danger hover:bg-danger-muted"
              onClick={() => handleDisconnect(driveConnection.id || driveConnection._id)}
              disabled={actionId === (driveConnection.id || driveConnection._id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-4 border border-dashed border-border-subtle rounded-none bg-surface-3/30 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Connect Google Drive to Enable File Attachments</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Secure OAuth authorization allows HUNTARA to access selected files in your Google Drive.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleConnect}
            disabled={connecting}
            className="rounded-none h-8 font-semibold text-[11px] shrink-0 gap-1.5"
          >
            {connecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <HardDrive className="w-3.5 h-3.5" />}
            <span>{connecting ? 'Waiting for Google...' : 'Connect Google Drive'}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

function AutoUpdateSection() {
  const [status, setStatus] = useState<any>({
    status: 'idle',
    progress: 0,
    currentVersion: '0.0.1',
    availableVersion: '',
    releaseNotes: '',
    channel: 'stable'
  });
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await window.ipc.invoke('updater:get-status', undefined);
      setStatus(res);
    } catch {}
  };

  React.useEffect(() => {
    fetchStatus();

    const unsubscribe = window.ipc.on('updater:status-changed' as any, (newStatus: any) => {
      setStatus(newStatus);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await window.ipc.invoke('updater:check', undefined);
      if (res.updateAvailable) {
        toast.success(`Update v${res.version} is available!`);
      } else {
        toast.info('You are already running the latest version.');
      }
      await fetchStatus();
    } catch (err: any) {
      toast.error(`Check failed: ${err.message || err}`);
    } finally {
      setChecking(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await window.ipc.invoke('updater:download', undefined);
      await fetchStatus();
      toast.success('Downloading update...');
    } catch (err: any) {
      toast.error(`Download failed: ${err.message || err}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleInstall = async () => {
    try {
      await window.ipc.invoke('updater:install', undefined);
    } catch (err: any) {
      toast.error(`Installation failed: ${err.message || err}`);
    }
  };

  return (
    <div className="bg-card border border-border-subtle rounded-none p-5 space-y-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-primary" />
          <span>Application Updates</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Verify and install latest features, patches, and security updates for HUNTARA.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
            Current Version
          </span>
          <p className="text-xs font-semibold text-foreground font-mono">v{status.currentVersion}</p>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
            Release Channel
          </span>
          <p className="text-xs font-mono text-muted-foreground capitalize">{status.channel}</p>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
            Updater Status
          </span>
          <p className="text-xs font-semibold text-foreground capitalize font-mono">{status.status}</p>
        </div>
      </div>

      {status.status === 'available' && (
        <div className="bg-primary/[0.02] border border-primary/20 rounded-none p-3 text-xs flex items-center justify-between shadow-inner">
          <div>
            <div className="font-bold text-foreground">
              New Version Available: v{status.availableVersion}
            </div>
            {status.releaseNotes && (
              <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                {status.releaseNotes}
              </div>
            )}
          </div>
          <Button size="sm" className="rounded-none text-[10px]" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Downloading...' : 'Download Update'}
          </Button>
        </div>
      )}

      {status.status === 'downloading' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs font-bold text-muted-foreground">
            <span>Downloading Update...</span>
            <span className="font-mono">{status.progress}%</span>
          </div>
          <div className="w-full bg-surface-3 rounded-none h-1.5 overflow-hidden">
            <div
              className="bg-primary h-1.5 transition-all duration-300"
              style={{ width: `${status.progress}%` }}
            ></div>
          </div>
        </div>
      )}

      {status.status === 'ready' && (
        <div className="bg-success-muted border border-success/20 rounded-none p-3 text-xs flex items-center justify-between shadow-inner">
          <div>
            <div className="font-bold text-success">Update Downloaded & Verified</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Ready to install on restart.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleInstall}
            className="bg-success hover:bg-success/80 text-white rounded-none border-none text-[10px] h-8 font-semibold"
          >
            Restart & Install
          </Button>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" size="sm" className="rounded-none h-8 font-semibold text-[11px]" onClick={handleCheck} disabled={checking}>
          {checking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Check for Updates'}
        </Button>
        <Button type="button" variant="outline" size="sm" className="rounded-none h-8 font-semibold text-[11px] gap-1.5" onClick={() => setWhatsNewOpen(true)}>
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span>View Release Notes</span>
        </Button>
      </div>
      <WhatsNewDialog isOpen={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
    </div>
  );
}

function EmailAccountsSection() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchAccounts = React.useCallback(async () => {
    try {
      const list = await window.ipc.invoke('email-accounts:list', undefined);
      setAccounts(list || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const pollTransaction = (transactionId: string) => {
    setConnecting(true);
    const interval = setInterval(async () => {
      try {
        const res = await window.ipc.invoke('email-accounts:gmail:status', { transactionId });
        if (res.status === 'completed') {
          clearInterval(interval);
          setConnecting(false);
          toast.success('Gmail account connected successfully!');
          fetchAccounts();
        } else if (res.status === 'failed') {
          clearInterval(interval);
          setConnecting(false);
          toast.error(`Gmail connection failed: ${res.error || 'Unknown error'}`);
        }
      } catch {
        // continue polling
      }
    }, 2000);

    setTimeout(() => {
      clearInterval(interval);
      setConnecting(false);
    }, 180000);
  };

  const handleConnect = async () => {
    try {
      const res = await window.ipc.invoke('email-accounts:gmail:connect', undefined);
      if (res.transactionId) {
        toast.info('Google sign-in opened in Chrome. Waiting for authorization...');
        pollTransaction(res.transactionId);
      }
    } catch (err: any) {
      toast.error(`Could not start Gmail sign-in: ${err.message || err}`);
    }
  };

  const handleReconnect = async (id: string) => {
    try {
      const res = await window.ipc.invoke('email-accounts:gmail:reconnect', { id });
      if (res.transactionId) {
        toast.info('Google sign-in opened in Chrome. Waiting for re-authorization...');
        pollTransaction(res.transactionId);
      }
    } catch (err: any) {
      toast.error(`Could not start Gmail reconnect: ${err.message || err}`);
    }
  };

  const [testModalAccount, setTestModalAccount] = useState<any | null>(null);
  const [syncingSigId, setSyncingSigId] = useState<string | null>(null);

  const handleSyncSignature = async (id: string) => {
    setSyncingSigId(id);
    try {
      const res = await window.ipc.invoke('email-accounts:sync-signature', { id });
      if (res.synced && res.signature) {
        toast.success('Gmail web signature synced successfully!');
      } else {
        toast.info('No signature found in your Gmail web settings.');
      }
      fetchAccounts();
    } catch (err: any) {
      toast.error(`Failed to sync signature: ${err.message || err}`);
    } finally {
      setSyncingSigId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Are you sure you want to disconnect this Gmail account?')) return;
    setActionId(id);
    try {
      await window.ipc.invoke('email-accounts:gmail:disconnect', { id });
      toast.success('Gmail account disconnected.');
      fetchAccounts();
    } catch (err: any) {
      toast.error(`Failed to disconnect: ${err.message || err}`);
    } finally {
      setActionId(null);
    }
  };

  const handleSendTest = (account: any) => {
    setTestModalAccount(account);
  };

  return (
    <div className="bg-card border border-border-subtle rounded-none p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            <span>Email Accounts & Mailboxes</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect your Gmail mailbox to send outreach campaigns securely via Google APIs.
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleConnect}
          disabled={connecting}
          className="gap-1.5 rounded-none h-8 text-[11px] font-semibold"
        >
          {connecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
          <span>{connecting ? 'Waiting for Google...' : 'Connect Gmail'}</span>
        </Button>
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-muted-foreground">Loading email accounts...</div>
      ) : accounts.length === 0 ? (
        <div className="p-6 text-center border border-dashed border-border-subtle rounded-none bg-surface-3/30 space-y-2">
          <p className="text-xs font-semibold text-foreground">No Gmail Accounts Connected</p>
          <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
            Click <strong>Connect Gmail</strong> to authorize your mailbox in Chrome. HUNTARA never sees your password.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">{acc.email}</span>
                  {acc.status === 'connected' && (
                    <Badge className="bg-success-muted text-success border border-success/20 text-[9px] font-bold rounded-none">
                      Healthy
                    </Badge>
                  )}
                  {acc.status === 'reauth_required' && (
                    <Badge className="bg-warning-muted text-warning border border-warning/20 text-[9px] font-bold rounded-none">
                      Re-auth Required
                    </Badge>
                  )}
                  {acc.status === 'disconnected' && (
                    <Badge className="bg-muted text-muted-foreground border border-border-subtle text-[9px] font-bold rounded-none">
                      Disconnected
                    </Badge>
                  )}
                  {acc.signature ? (
                    <Badge className="bg-primary/10 text-primary border border-primary/20 text-[9px] font-mono rounded-none">
                      Signature: Active
                    </Badge>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground border border-border-subtle text-[9px] font-mono rounded-none">
                      Signature: None
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-3">
                  <span>Name: {acc.name}</span>
                  <span>Daily limit: {acc.dailyLimit || 200}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {acc.status === 'reauth_required' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReconnect(acc.id)}
                    className="rounded-none h-7 text-[10px] font-semibold text-warning border-warning/30"
                  >
                    Reconnect Gmail
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSyncSignature(acc.id)}
                      disabled={syncingSigId === acc.id || acc.status !== 'connected'}
                      className="rounded-none h-7 text-[10px] font-semibold gap-1"
                      title="Refresh web signature from Gmail settings"
                    >
                      <RefreshCw className={`w-3 h-3 ${syncingSigId === acc.id ? 'animate-spin' : ''}`} />
                      <span>Sync Sig</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSendTest(acc)}
                      disabled={actionId === acc.id || acc.status !== 'connected'}
                      className="rounded-none h-7 text-[10px] font-semibold"
                    >
                      Send Test
                    </Button>
                  </>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDisconnect(acc.id)}
                  disabled={actionId === acc.id}
                  className="rounded-none h-7 text-[10px] text-danger hover:bg-danger-muted"
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {testModalAccount && (
        <SendTestModal
          isOpen={!!testModalAccount}
          onClose={() => {
            setTestModalAccount(null);
            fetchAccounts();
          }}
          account={testModalAccount}
        />
      )}
    </div>
  );
}

