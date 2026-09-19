import type {
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  InviteMemberDto
} from '@huntara/schema';

/**
 * WorkspaceService isolates the IPC channel invocation logic from the presenter/hooks layer.
 */
export const WorkspaceService = {
  /**
   * Lists all workspaces for the current user session.
   */
  async listWorkspaces(): Promise<Workspace[]> {
    try {
      const res = await window.ipc.invoke('workspaces:list', undefined);
      return (res as unknown as Workspace[]) ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Creates a new workspace.
   */
  async createWorkspace(name: string): Promise<Workspace> {
    const res = await window.ipc.invoke('workspaces:create', { name } as any);
    if (!res) throw new Error('Failed to create workspace.');
    return res as unknown as Workspace;
  },

  /**
   * Updates an existing workspace name or settings.
   */
  async updateWorkspace(id: string, dto: UpdateWorkspaceDto): Promise<Workspace> {
    const res = await window.ipc.invoke('workspaces:update', { id, dto });
    if (!res) throw new Error('Failed to update workspace.');
    return res as unknown as Workspace;
  },

  /**
   * Soft deletes a workspace.
   */
  async deleteWorkspace(id: string): Promise<void> {
    await window.ipc.invoke('workspaces:delete', id);
  },

  /**
   * Fetches single workspace details by ID.
   */
  async getWorkspace(id: string): Promise<Workspace> {
    return window.ipc.invoke('workspaces:get', id);
  },

  /**
   * Lists all members of a workspace.
   */
  async listMembers(id: string): Promise<WorkspaceMember[]> {
    try {
      const res = await window.ipc.invoke('workspaces:members:list', id);
      return (res as unknown as WorkspaceMember[]) ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Invites a new user email to a workspace.
   */
  async inviteMember(id: string, dto: InviteMemberDto): Promise<Workspace> {
    return window.ipc.invoke('workspaces:members:invite', { id, dto });
  },

  /**
   * Updates workspace membership role.
   */
  async updateMemberRole(id: string, memberId: string, role: WorkspaceRole): Promise<Workspace> {
    return window.ipc.invoke('workspaces:members:updateRole', { id, memberId, role });
  },

  /**
   * Removes a member from a workspace.
   */
  async removeMember(id: string, memberId: string): Promise<Workspace> {
    return window.ipc.invoke('workspaces:members:remove', { id, memberId });
  },

  /**
   * Leaves a workspace.
   */
  async leaveWorkspace(id: string): Promise<Workspace> {
    return window.ipc.invoke('workspaces:members:leave', id);
  },

  /**
   * Transfers workspace ownership to another member.
   */
  async transferOwnership(id: string, newOwnerId: string): Promise<Workspace> {
    return window.ipc.invoke('workspaces:members:transferOwnership', { id, newOwnerId });
  },

  /**
   * Lists pending user invites.
   */
  async listPendingInvites(): Promise<Workspace[]> {
    try {
      const res = await window.ipc.invoke('workspaces:invites:list', undefined);
      return (res as unknown as Workspace[]) ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Accepts workspace invitation.
   */
  async acceptInvite(token: string): Promise<Workspace> {
    return window.ipc.invoke('workspaces:invites:accept', token);
  },

  /**
   * Declines workspace invitation.
   */
  async declineInvite(token: string): Promise<Workspace> {
    return window.ipc.invoke('workspaces:invites:decline', token);
  },

  /**
   * Gets the locally persisted active workspace ID.
   */
  async getActiveWorkspaceId(): Promise<string | null> {
    try {
      const res = await window.ipc.invoke('electron:getActiveWorkspace', undefined);
      return res as string | null;
    } catch {
      return null;
    }
  },

  /**
   * Syncs active workspace to Electron state headers and persist storage.
   */
  async syncActiveWorkspace(workspaceId: string | null): Promise<void> {
    await window.ipc.invoke('electron:setActiveWorkspace', workspaceId);
  },

  /**
   * Resolves the active workspace from a list given the preferred activeWorkspaceId.
   */
  resolveActiveWorkspace(
    workspaces: Workspace[],
    activeWorkspaceId?: string | null
  ): Workspace | null {
    if (!workspaces.length) return null;
    if (!activeWorkspaceId) return workspaces[0] ?? null;
    return (workspaces.find((w) => w.id === activeWorkspaceId) ??
      workspaces[0] ??
      null) as Workspace | null;
  }
};
