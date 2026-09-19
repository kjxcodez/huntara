import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkspaceInvites, useAcceptInvite, useDeclineInvite } from '../hooks/useWorkspaceQuery';
import { useWorkspace } from '../hooks/useWorkspace';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/common/PageHeader';
import { Skeleton } from '../components/ui/skeleton';
import { Mail, Check, X, Users } from 'lucide-react';
import { toast } from 'sonner';
import logoLight from '../assets/app-icon-light.png';

import type { Workspace, WorkspaceMember } from '@huntara/schema';

/**
 * WorkspaceInvitesScreen — displays pending workspace invitations.
 *
 * Design:
 *  - PageHeader with consistent title block
 *  - Animated skeleton loading state
 *  - Staggered invite card entrance via Framer Motion
 *  - Animated empty state with floating icon
 *  - Toast notifications on accept / decline
 */
export default function WorkspaceInvitesScreen() {
  const invitesQuery = useWorkspaceInvites();
  const acceptMutation = useAcceptInvite();
  const declineMutation = useDeclineInvite();
  const { setActive } = useWorkspace();

  const handleAccept = async (token: string, name: string) => {
    try {
      const workspace = await acceptMutation.mutateAsync(token);
      await setActive(workspace as unknown as any);
      toast.success(`Joined "${name}" workspace`);
    } catch {
      toast.error('Failed to accept invitation. Please try again.');
    }
  };

  const handleDecline = async (token: string, name: string) => {
    try {
      await declineMutation.mutateAsync(token);
      toast.success(`Declined invitation to "${name}"`);
    } catch {
      toast.error('Failed to decline invitation. Please try again.');
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (invitesQuery.isLoading) {
    return (
      <div className="space-y-6 text-xs font-sans h-full">
        <PageHeader
          title="Workspace Invitations"
          description="Pending invitations to join other workspaces."
        />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4 bg-card border border-border-subtle">
              <Skeleton className="w-10 h-10 rounded-none shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
              <Skeleton className="h-7 w-16 rounded-none" />
              <Skeleton className="h-7 w-16 rounded-none" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const invites = (invitesQuery.data || []) as Workspace[];

  // ── Empty state ───────────────────────────────────────────────────────────
  if (invites.length === 0) {
    return (
      <div className="space-y-6 text-xs font-sans h-full">
        <PageHeader
          title="Workspace Invitations"
          description="Pending invitations to join other workspaces."
        />
        <div className="flex flex-col items-center justify-center py-24 space-y-6 text-center">
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
            className="w-14 h-14 bg-surface-3 border border-border-subtle flex items-center justify-center text-muted-foreground"
          >
            <Mail className="w-6 h-6" />
          </motion.div>
          <div className="space-y-1.5 max-w-xs">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
              No pending invitations
            </h3>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              When someone invites you to a workspace, it will appear here for review.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Invitations list ──────────────────────────────────────────────────────
  return (
    <div className="space-y-6 text-xs font-sans h-full overflow-y-auto pr-1">
      <PageHeader
        title="Workspace Invitations"
        description="Review and respond to pending invitations from other workspaces."
      />

      {/* Stats bar */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Users className="w-3.5 h-3.5" />
        <span>
          <span className="font-semibold text-foreground">{invites.length}</span>{' '}
          pending invitation{invites.length !== 1 ? 's' : ''}
        </span>
      </div>

      <motion.div
        className="space-y-3"
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: 0.07 } }
        }}
      >
        <AnimatePresence>
          {invites.map((ws) => {
            const inviteMember = ws.members?.find((m: WorkspaceMember) => m.status === 'PENDING');
            const token = inviteMember?.invitationToken || '';
            const role = inviteMember?.role || 'Member';
            const isPending = declineMutation.isPending || acceptMutation.isPending;

            return (
              <motion.div
                key={ws.id}
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] } }
                }}
                exit={{ opacity: 0, x: -20, transition: { duration: 0.18 } }}
                className="flex items-center justify-between p-4 bg-card border border-border-subtle hover:border-primary/30 transition-colors duration-150"
              >
                {/* Workspace info */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-primary/8 border border-primary/20 flex items-center justify-center shrink-0">
                    <img src={logoLight} className="w-5 h-5 object-contain opacity-70" alt="" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[12px] font-semibold text-foreground leading-tight truncate">
                      {ws.name}
                    </h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Invited as{' '}
                      <span className="font-medium text-foreground capitalize">
                        {role.toLowerCase()}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] gap-1 rounded-none hover:bg-danger/10 hover:text-danger hover:border-danger/30"
                    onClick={() => handleDecline(token, ws.name)}
                    disabled={isPending}
                  >
                    <X className="w-3 h-3" />
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[10px] gap-1 rounded-none"
                    onClick={() => handleAccept(token, ws.name)}
                    disabled={isPending}
                  >
                    <Check className="w-3 h-3" />
                    Accept
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
