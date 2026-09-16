import { z } from 'zod';
import { nameField, emailField } from '../fields/common.js';
import { workspaceSettingsSchema } from '../entities/workspace.js';
import { WorkspaceRole } from '../enums/index.js';

export const createWorkspaceDtoSchema = z.object({
  name: nameField,
  settings: workspaceSettingsSchema.partial().optional()
});
export type CreateWorkspaceDto = z.infer<typeof createWorkspaceDtoSchema>;

export const updateWorkspaceDtoSchema = createWorkspaceDtoSchema.partial();
export type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceDtoSchema>;

export const updateSchedulerPolicyDtoSchema = z.object({
  globalMaxConcurrency: z.number().int().min(1).optional(),
  typeLimits: z.record(z.string(), z.number().int().min(0)).optional()
});
export type UpdateSchedulerPolicyDto = z.infer<typeof updateSchedulerPolicyDtoSchema>;

export const inviteMemberDtoSchema = z.object({
  email: emailField,
  role: z.nativeEnum(WorkspaceRole)
});
export type InviteMemberDto = z.infer<typeof inviteMemberDtoSchema>;

export const updateMemberRoleDtoSchema = z.object({
  role: z.nativeEnum(WorkspaceRole)
});
export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleDtoSchema>;

export const acceptInviteDtoSchema = z.object({
  token: z.string().min(1)
});
export type AcceptInviteDto = z.infer<typeof acceptInviteDtoSchema>;
