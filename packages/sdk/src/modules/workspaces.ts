import { HttpClient } from '../http/client.js';
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  InviteMemberDto,
  SchedulerPolicy,
  UpdateSchedulerPolicyDto
} from '@leadforge/schema';

export class WorkspacesModule {
  constructor(private client: HttpClient) {}

  public async get(id: string): Promise<Workspace> {
    return this.client.get<Workspace>(`/workspaces/${id}`);
  }

  public async list(): Promise<Workspace[]> {
    return this.client.get<Workspace[]>('/workspaces');
  }

  public async create(dto: CreateWorkspaceDto): Promise<Workspace> {
    return this.client.post<Workspace>('/workspaces', dto);
  }

  public async update(id: string, dto: UpdateWorkspaceDto): Promise<Workspace> {
    return this.client.patch<Workspace>(`/workspaces/${id}`, dto);
  }

  public async delete(id: string): Promise<void> {
    return this.client.delete<void>(`/workspaces/${id}`);
  }

  public async inviteMember(id: string, dto: InviteMemberDto): Promise<Workspace> {
    return this.client.post<Workspace>(`/workspaces/${id}/invite`, dto);
  }

  public async listMembers(id: string): Promise<WorkspaceMember[]> {
    return this.client.get<WorkspaceMember[]>(`/workspaces/${id}/members`);
  }

  public async updateMemberRole(
    id: string,
    memberId: string,
    role: WorkspaceRole
  ): Promise<Workspace> {
    return this.client.patch<Workspace>(`/workspaces/${id}/members/${memberId}/role`, { role });
  }

  public async removeMember(id: string, memberId: string): Promise<Workspace> {
    return this.client.delete<Workspace>(`/workspaces/${id}/members/${memberId}`);
  }

  public async leave(id: string): Promise<Workspace> {
    return this.client.post<Workspace>(`/workspaces/${id}/leave`, {});
  }

  public async transferOwnership(id: string, newOwnerId: string): Promise<Workspace> {
    return this.client.post<Workspace>(`/workspaces/${id}/transfer-ownership`, { newOwnerId });
  }

  public async listPendingInvites(): Promise<Workspace[]> {
    return this.client.get<Workspace[]>('/workspaces/invites/pending');
  }

  public async acceptInvite(token: string): Promise<Workspace> {
    return this.client.post<Workspace>('/workspaces/invites/accept', { token });
  }

  public async declineInvite(token: string): Promise<Workspace> {
    return this.client.post<Workspace>('/workspaces/invites/decline', { token });
  }

  public async getSchedulerPolicy(id: string): Promise<SchedulerPolicy> {
    return this.client.get<SchedulerPolicy>(`/workspaces/${id}/scheduler-policy`);
  }

  public async updateSchedulerPolicy(
    id: string,
    dto: UpdateSchedulerPolicyDto
  ): Promise<SchedulerPolicy> {
    return this.client.put<SchedulerPolicy>(`/workspaces/${id}/scheduler-policy`, dto);
  }
}
