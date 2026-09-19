import { WorkspaceRole, WorkspacePermission } from '@huntara/schema';

// ---------------------------------------------------------------------------
// Role Permissions Mapping
// ---------------------------------------------------------------------------

const ROLE_PERMISSIONS: Record<WorkspaceRole, WorkspacePermission[]> = {
  [WorkspaceRole.OWNER]: [
    WorkspacePermission.MANAGE_WORKSPACE,
    WorkspacePermission.INVITE_MEMBERS,
    WorkspacePermission.MANAGE_MEMBERS,
    WorkspacePermission.TRANSFER_OWNERSHIP,
    WorkspacePermission.VIEW_SETTINGS,
    WorkspacePermission.CREATE_CAMPAIGNS
  ],
  [WorkspaceRole.ADMIN]: [
    WorkspacePermission.MANAGE_WORKSPACE,
    WorkspacePermission.INVITE_MEMBERS,
    WorkspacePermission.MANAGE_MEMBERS,
    WorkspacePermission.VIEW_SETTINGS,
    WorkspacePermission.CREATE_CAMPAIGNS
  ],
  [WorkspaceRole.MEMBER]: [WorkspacePermission.VIEW_SETTINGS, WorkspacePermission.CREATE_CAMPAIGNS],
  [WorkspaceRole.READ_ONLY]: [WorkspacePermission.VIEW_SETTINGS],
  [WorkspaceRole.BILLING]: [WorkspacePermission.VIEW_SETTINGS]
};

// ---------------------------------------------------------------------------
// Reusable Helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether a specific role is granted the requested permission.
 */
export function hasPermission(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? permissions.includes(permission) : false;
}

/**
 * Helper to check if role can manage workspace settings.
 */
export function canManageWorkspace(role: WorkspaceRole): boolean {
  return hasPermission(role, WorkspacePermission.MANAGE_WORKSPACE);
}

/**
 * Helper to check if role can invite new members.
 */
export function canInviteMembers(role: WorkspaceRole): boolean {
  return hasPermission(role, WorkspacePermission.INVITE_MEMBERS);
}

/**
 * Helper to check if role can update roles or remove members.
 */
export function canManageMembers(role: WorkspaceRole): boolean {
  return hasPermission(role, WorkspacePermission.MANAGE_MEMBERS);
}

/**
 * Helper to check if role can transfer ownership of the workspace.
 */
export function canTransferOwnership(role: WorkspaceRole): boolean {
  return hasPermission(role, WorkspacePermission.TRANSFER_OWNERSHIP);
}

/**
 * Helper to check if role can create outreach campaigns.
 */
export function canCreateCampaigns(role: WorkspaceRole): boolean {
  return hasPermission(role, WorkspacePermission.CREATE_CAMPAIGNS);
}
