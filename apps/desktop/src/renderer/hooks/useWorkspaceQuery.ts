import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { WorkspaceService } from '../services/workspace-service';
import { toast } from 'sonner';
import type { InviteMemberDto, WorkspaceRole } from '@huntara/schema';

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const workspaceQueryKeys = {
  members: (workspaceId: string) => ['workspace', workspaceId, 'members'] as const,
  invites: () => ['user', 'invites', 'pending'] as const
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * useWorkspaceMembers fetches the list of members for a workspace.
 */
export function useWorkspaceMembers(workspaceId: string) {
  return useQuery({
    queryKey: workspaceQueryKeys.members(workspaceId),
    queryFn: () => WorkspaceService.listMembers(workspaceId),
    enabled: !!workspaceId
  });
}

/**
 * useWorkspaceInvites fetches pending workspace invitations for the current user.
 */
export function useWorkspaceInvites() {
  return useQuery({
    queryKey: workspaceQueryKeys.invites(),
    queryFn: () => WorkspaceService.listPendingInvites()
  });
}

/**
 * Hook to invite a new member to the workspace.
 */
export function useInviteMember(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: InviteMemberDto) => WorkspaceService.inviteMember(workspaceId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.members(workspaceId) });
      toast.success('Invitation sent successfully.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to send invitation.');
    }
  });
}

/**
 * Hook to update a member's role.
 */
export function useUpdateMemberRole(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WorkspaceRole }) =>
      WorkspaceService.updateMemberRole(workspaceId, memberId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.members(workspaceId) });
      toast.success('Member role updated successfully.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update member role.');
    }
  });
}

/**
 * Hook to remove a member from a workspace.
 */
export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => WorkspaceService.removeMember(workspaceId, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.members(workspaceId) });
      toast.success('Member removed from workspace.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to remove member.');
    }
  });
}

/**
 * Hook to leave a workspace.
 */
export function useLeaveWorkspace(workspaceId: string) {
  return useMutation({
    mutationFn: () => WorkspaceService.leaveWorkspace(workspaceId),
    onSuccess: () => {
      toast.success('You have left the workspace.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to leave workspace.');
    }
  });
}

/**
 * Hook to transfer ownership of a workspace.
 */
export function useTransferOwnership(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (newOwnerId: string) => WorkspaceService.transferOwnership(workspaceId, newOwnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.members(workspaceId) });
      toast.success('Workspace ownership transferred successfully.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to transfer workspace ownership.');
    }
  });
}

/**
 * Hook to accept a pending invitation.
 */
export function useAcceptInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => WorkspaceService.acceptInvite(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.invites() });
      toast.success('Invitation accepted.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to accept invitation.');
    }
  });
}

/**
 * Hook to decline a pending invitation.
 */
export function useDeclineInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => WorkspaceService.declineInvite(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.invites() });
      toast.success('Invitation declined.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to decline invitation.');
    }
  });
}
