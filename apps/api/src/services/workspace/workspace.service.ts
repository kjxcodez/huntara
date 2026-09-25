import crypto from 'crypto';
import { WorkspaceRepository } from '../../repositories/workspace/workspace.repository.js';
import { UserRepository } from '../../repositories/user/user.repository.js';
import type { WorkspaceDocument, WorkspaceMember } from '../../db/models/workspace.model.js';
import { slugify } from '@huntara/core';
import {
  createWorkspaceDtoSchema,
  updateWorkspaceDtoSchema,
  updateSchedulerPolicyDtoSchema,
  DEFAULT_SCHEDULER_POLICY,
  resolveSchedulerPolicy,
  WorkspaceRole,
  WorkspaceMemberStatus,
  type CreateWorkspaceDto,
  type UpdateWorkspaceDto,
  type UpdateSchedulerPolicyDto,
  type SchedulerPolicy,
  type InviteMemberDto
} from '@huntara/schema';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError
} from '../../errors/index.js';
import {
  canInviteMembers,
  canManageMembers,
  canManageWorkspace,
  canTransferOwnership
} from '../../utils/authorization.js';

/**
 * WorkspaceService manages the lifecycle of workspaces, members, and invitations.
 */
export class WorkspaceService {
  private workspaceRepository: WorkspaceRepository;
  private userRepository: UserRepository;

  constructor() {
    this.workspaceRepository = new WorkspaceRepository();
    this.userRepository = new UserRepository();
  }

  public async getWorkspaceById(id: string, callerUserId?: string): Promise<WorkspaceDocument> {
    const workspace = await this.workspaceRepository.findById(id);
    if (!workspace) throw new NotFoundError('Workspace not found.');
    if (callerUserId) {
      const isOwner = workspace.ownerId === callerUserId;
      const isMember = Array.isArray(workspace.members) &&
        workspace.members.some((m) => m.userId === callerUserId && m.status !== WorkspaceMemberStatus.EXPIRED);
      if (!isOwner && !isMember) {
        throw new NotFoundError('Workspace not found.');
      }
    }
    return workspace;
  }

  public async getWorkspaceBySlug(slug: string, callerUserId?: string): Promise<WorkspaceDocument | null> {
    const workspace = await this.workspaceRepository.findBySlug(slug);
    if (!workspace) return null;
    if (callerUserId) {
      const isOwner = workspace.ownerId === callerUserId;
      const isMember = Array.isArray(workspace.members) &&
        workspace.members.some((m) => m.userId === callerUserId && m.status !== WorkspaceMemberStatus.EXPIRED);
      if (!isOwner && !isMember) {
        return null;
      }
    }
    return workspace;
  }

  public async listUserWorkspaces(userId: string): Promise<WorkspaceDocument[]> {
    return this.workspaceRepository.findUserWorkspaces(userId);
  }

  public async createWorkspace(
    dto: CreateWorkspaceDto & { ownerId: string; ownerEmail: string }
  ): Promise<WorkspaceDocument> {
    const validated = createWorkspaceDtoSchema.parse(dto);

    // Idempotency guard: if owner already has an active workspace with the same name, return it
    const existingUserWorkspaces = await this.workspaceRepository.findUserWorkspaces(dto.ownerId);
    const existingMatch = existingUserWorkspaces.find(
      (w) => w.name.trim().toLowerCase() === validated.name.trim().toLowerCase()
    );
    if (existingMatch) {
      return existingMatch;
    }
    
    // Auto-resolve unique slug to prevent 409 database collisions on common names
    let slug = slugify(validated.name);
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 10) {
      const existing = await this.workspaceRepository.findBySlug(slug);
      if (!existing) {
        isUnique = true;
      } else {
        attempts++;
        const suffix = Math.random().toString(36).substring(2, 6);
        slug = `${slugify(validated.name)}-${suffix}`;
      }
    }

    return this.workspaceRepository.create({
      name: validated.name,
      slug,
      ownerId: dto.ownerId,
      plan: 'free',
      settings: validated.settings || { defaultTimezone: 'UTC' },
      members: [
        {
          userId: dto.ownerId,
          email: dto.ownerEmail,
          role: WorkspaceRole.OWNER,
          status: WorkspaceMemberStatus.ACTIVE,
          joinedAt: new Date(),
          invitedAt: new Date()
        }
      ]
    });
  }

  public async updateWorkspace(
    id: string,
    dto: UpdateWorkspaceDto,
    actorId: string
  ): Promise<WorkspaceDocument> {
    const validated = updateWorkspaceDtoSchema.parse(dto);
    const workspace = await this.getWorkspaceById(id);

    // Authorize: actor must be OWNER or ADMIN to update workspace settings
    const member = workspace.members.find(
      (m) => m.userId === actorId && m.status === WorkspaceMemberStatus.ACTIVE
    );
    if (!member || (member.role !== WorkspaceRole.OWNER && member.role !== WorkspaceRole.ADMIN)) {
      throw new ForbiddenError('Only workspace owners and administrators can modify settings.');
    }

    if (validated.name) {
      workspace.name = validated.name;
      let slug = slugify(validated.name);
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 10) {
        const existing = await this.workspaceRepository.findBySlug(slug);
        if (!existing || existing._id.toString() === workspace._id.toString()) {
          isUnique = true;
        } else {
          attempts++;
          const suffix = Math.random().toString(36).substring(2, 6);
          slug = `${slugify(validated.name)}-${suffix}`;
        }
      }
      workspace.slug = slug;
    }
    if (validated.settings?.defaultTimezone) {
      workspace.settings = {
        ...workspace.settings,
        defaultTimezone: validated.settings.defaultTimezone
      };
    }

    return workspace.save();
  }

  public async softDeleteWorkspace(id: string, actorId: string): Promise<WorkspaceDocument> {
    const workspace = await this.getWorkspaceById(id);
    if (workspace.ownerId !== actorId) {
      throw new ForbiddenError('Only the workspace owner can delete the workspace.');
    }

    return (workspace as any).softDelete(actorId);
  }

  public async inviteMember(
    workspaceId: string,
    dto: InviteMemberDto,
    actorId: string
  ): Promise<WorkspaceDocument> {
    const workspace = await this.getWorkspaceById(workspaceId);

    // Authorize
    const actorMember = workspace.members.find(
      (m) => m.userId === actorId && m.status === WorkspaceMemberStatus.ACTIVE
    );
    if (!actorMember || !canInviteMembers(actorMember.role as any)) {
      throw new ForbiddenError('You do not have permission to invite members to this workspace.');
    }

    const inviteEmail = dto.email.toLowerCase().trim();

    // Prevent duplicate active or pending members
    const existing = workspace.members.find((m) => m.email === inviteEmail);
    if (existing) {
      if (existing.status === WorkspaceMemberStatus.ACTIVE) {
        throw new ConflictError('User is already a member of this workspace.');
      }
      if (existing.status === WorkspaceMemberStatus.PENDING) {
        // Re-send / update invitation expiration
        existing.role = dto.role;
        existing.invitationToken = crypto.randomBytes(32).toString('hex');
        existing.invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        existing.invitedBy = actorId;
        existing.invitedAt = new Date();
        return workspace.save();
      }
    }

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const pendingUser = await this.userRepository.findByEmail(inviteEmail);

    const newMember: WorkspaceMember = {
      userId: pendingUser?._id?.toString() || null, // Link user ID immediately if they already exist
      email: inviteEmail,
      role: dto.role,
      status: WorkspaceMemberStatus.PENDING,
      invitedBy: actorId,
      invitedAt: new Date(),
      invitationToken: token,
      invitationExpiresAt: expiresAt
    };

    workspace.members.push(newMember);
    return workspace.save();
  }

  public async acceptInvite(token: string, userId: string): Promise<WorkspaceDocument> {
    const workspace = await this.workspaceRepository.findByInvitationToken(token);
    if (!workspace) throw new NotFoundError('Invitation token is invalid or expired.');

    const memberIndex = workspace.members.findIndex((m) => m.invitationToken === token);
    const member = workspace.members[memberIndex];
    if (!member) throw new ValidationError('Invitation not found.');

    if (member.invitationExpiresAt && member.invitationExpiresAt < new Date()) {
      member.status = WorkspaceMemberStatus.EXPIRED;
      await workspace.save();
      throw new ValidationError('This invitation has expired.');
    }

    // Match verifying user
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found.');

    if (user.email.toLowerCase().trim() !== member.email) {
      throw new ForbiddenError('This invitation was sent to a different email address.');
    }

    member.userId = userId;
    member.status = WorkspaceMemberStatus.ACTIVE;
    member.joinedAt = new Date();
    member.invitationToken = null;
    member.invitationExpiresAt = null;

    // Persist as user's active workspace
    user.activeWorkspaceId = workspace._id.toString();
    await user.save();

    return workspace.save();
  }

  public async declineInvite(token: string, userId: string): Promise<WorkspaceDocument> {
    const workspace = await this.workspaceRepository.findByInvitationToken(token);
    if (!workspace) throw new NotFoundError('Invitation not found.');

    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found.');

    const member = workspace.members.find((m) => m.invitationToken === token);
    if (!member) throw new NotFoundError('Invitation not found.');

    if (user.email.toLowerCase().trim() !== member.email) {
      throw new ForbiddenError('Only the recipient can decline this invitation.');
    }

    member.status = WorkspaceMemberStatus.DECLINED;
    member.invitationToken = null;
    member.invitationExpiresAt = null;

    return workspace.save();
  }

  public async updateMemberRole(
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
    actorId: string
  ): Promise<WorkspaceDocument> {
    const workspace = await this.getWorkspaceById(workspaceId);

    // Authorize actor
    const actorMember = workspace.members.find(
      (m) => m.userId === actorId && m.status === WorkspaceMemberStatus.ACTIVE
    );
    if (!actorMember || !canManageMembers(actorMember.role as any)) {
      throw new ForbiddenError('You do not have permission to update member roles.');
    }

    // Locate member to modify
    const targetMember = workspace.members.find(
      (m) => (m as any).id === memberId || m.userId === memberId
    );
    if (!targetMember) throw new NotFoundError('Member not found in workspace.');

    if (targetMember.role === WorkspaceRole.OWNER) {
      throw new ValidationError(
        'Workspace owner role cannot be changed directly. Please use transfer ownership.'
      );
    }

    if (role === WorkspaceRole.OWNER) {
      throw new ValidationError(
        'To grant Owner access, please use the transfer ownership workflow.'
      );
    }

    targetMember.role = role;
    return workspace.save();
  }

  public async removeMember(
    workspaceId: string,
    memberId: string,
    actorId: string
  ): Promise<WorkspaceDocument> {
    const workspace = await this.getWorkspaceById(workspaceId);

    // Authorize actor
    const actorMember = workspace.members.find(
      (m) => m.userId === actorId && m.status === WorkspaceMemberStatus.ACTIVE
    );
    if (!actorMember || !canManageMembers(actorMember.role as any)) {
      throw new ForbiddenError('You do not have permission to remove members.');
    }

    const targetMember = workspace.members.find(
      (m) => (m as any).id === memberId || m.userId === memberId
    );
    if (!targetMember) throw new NotFoundError('Member not found in workspace.');

    if (targetMember.role === WorkspaceRole.OWNER) {
      throw new ValidationError('Workspace owner cannot be removed. Transfer ownership first.');
    }

    workspace.members = workspace.members.filter(
      (m) => (m as any).id !== (targetMember as any).id && m.userId !== targetMember.userId
    ) as any;
    return workspace.save();
  }

  public async leaveWorkspace(workspaceId: string, userId: string): Promise<WorkspaceDocument> {
    const workspace = await this.getWorkspaceById(workspaceId);

    const targetMember = workspace.members.find(
      (m) => m.userId === userId && m.status === WorkspaceMemberStatus.ACTIVE
    );
    if (!targetMember) throw new NotFoundError('You are not a member of this workspace.');

    if (targetMember.role === WorkspaceRole.OWNER) {
      throw new ValidationError(
        'Workspace owners cannot leave. Please transfer ownership or delete the workspace.'
      );
    }

    workspace.members = workspace.members.filter((m) => m.userId !== userId);
    return workspace.save();
  }

  public async transferOwnership(
    workspaceId: string,
    newOwnerId: string,
    actorId: string
  ): Promise<WorkspaceDocument> {
    const workspace = await this.getWorkspaceById(workspaceId);

    // Only current OWNER can transfer
    if (workspace.ownerId !== actorId) {
      throw new ForbiddenError('Only the current workspace owner can transfer ownership.');
    }

    const currentOwnerMember = workspace.members.find((m) => m.userId === actorId);
    const newOwnerMember = workspace.members.find(
      (m) => m.userId === newOwnerId && m.status === WorkspaceMemberStatus.ACTIVE
    );

    if (!newOwnerMember) {
      throw new ValidationError('The new owner must be an active member of this workspace.');
    }

    // Perform swap
    workspace.ownerId = newOwnerId;
    if (currentOwnerMember) {
      currentOwnerMember.role = WorkspaceRole.ADMIN; // Current owner demoted to admin
    }
    newOwnerMember.role = WorkspaceRole.OWNER; // Target promoted to owner

    return workspace.save();
  }

  public async listWorkspacePendingInvites(
    workspaceId: string,
    actorId: string
  ): Promise<WorkspaceMember[]> {
    const workspace = await this.getWorkspaceById(workspaceId);

    const actor = workspace.members.find(
      (m) => m.userId === actorId && m.status === WorkspaceMemberStatus.ACTIVE
    );
    if (!actor) {
      throw new ForbiddenError('You are not authorized to view invitations in this workspace.');
    }

    return workspace.members.filter((m) => m.status === WorkspaceMemberStatus.PENDING);
  }

  public async listPendingUserInvitesByEmail(email: string): Promise<WorkspaceDocument[]> {
    return this.workspaceRepository.findPendingInvitesByEmail(email);
  }

  /**
   * Retrieves the canonical scheduler concurrency policy for a workspace.
   * If missing (legacy workspace), bootstraps default values deterministically in MongoDB.
   */
  public async getSchedulerPolicy(workspaceId: string): Promise<SchedulerPolicy> {
    const workspace = await this.getWorkspaceById(workspaceId);
    const existingRaw = workspace.settings?.schedulerPolicy;

    if (!existingRaw) {
      // Legacy workspace: bootstrap default policy document in MongoDB
      const defaultPolicy = {
        globalMaxConcurrency: DEFAULT_SCHEDULER_POLICY.globalMaxConcurrency,
        typeLimits: { ...DEFAULT_SCHEDULER_POLICY.typeLimits }
      };

      workspace.settings = {
        ...workspace.settings,
        schedulerPolicy: {
          ...defaultPolicy,
          updatedAt: new Date()
        }
      };

      try {
        await workspace.save();
      } catch {
        // Non-blocking fallback: if save fails, return canonical default deterministically
      }

      return defaultPolicy;
    }

    return resolveSchedulerPolicy(existingRaw);
  }

  /**
   * Updates scheduler concurrency policy with strict integer/range validation
   * and workspace manager role authorization.
   */
  public async updateSchedulerPolicy(
    workspaceId: string,
    dto: UpdateSchedulerPolicyDto,
    actorId: string
  ): Promise<SchedulerPolicy> {
    const validated = updateSchedulerPolicyDtoSchema.parse(dto);
    const workspace = await this.getWorkspaceById(workspaceId);

    // Actor authorization: must be OWNER or ADMIN
    const isOwner = workspace.ownerId === actorId;
    const member = workspace.members.find((m) => m.userId === actorId);
    if (!isOwner && (!member || !canManageWorkspace(member.role as WorkspaceRole))) {
      throw new ForbiddenError('Only workspace owners or administrators can update scheduler policy.');
    }

    const currentPolicy = resolveSchedulerPolicy(workspace.settings?.schedulerPolicy);
    const mergedTypeLimits = {
      ...currentPolicy.typeLimits,
      ...(validated.typeLimits || {})
    };

    const newPolicy: SchedulerPolicy = {
      globalMaxConcurrency:
        validated.globalMaxConcurrency !== undefined
          ? validated.globalMaxConcurrency
          : currentPolicy.globalMaxConcurrency,
      typeLimits: mergedTypeLimits
    };

    workspace.settings = {
      ...workspace.settings,
      schedulerPolicy: {
        ...newPolicy,
        updatedAt: new Date()
      }
    };

    await workspace.save();
    return newPolicy;
  }
}
