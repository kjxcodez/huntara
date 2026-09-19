import React from 'react';
import { useAuth } from './useAuth';
import { useWorkspace } from './useWorkspace';
import { WorkspaceRole, WorkspacePermission, WorkspaceMemberStatus } from '@huntara/schema';

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
// usePermissions Hook
// ---------------------------------------------------------------------------

/**
 * usePermissions provides authorization utilities for components to check
 * active user capabilities within the active workspace context.
 */
export function usePermissions() {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();

  // Find user's member object in active workspace
  const member = activeWorkspace?.members?.find(
    (m) =>
      (m.userId && m.userId === user?.id) ||
      (m.email && m.email.toLowerCase() === user?.email?.toLowerCase())
  );

  const role = (member?.role || null) as WorkspaceRole | null;
  const status = member?.status || null;

  /**
   * Evaluates if the current user has a specific permission in the active workspace.
   */
  const can = (permission: WorkspacePermission): boolean => {
    if (!role || status !== WorkspaceMemberStatus.ACTIVE) return false;
    const permissions = ROLE_PERMISSIONS[role];
    return permissions ? permissions.includes(permission) : false;
  };

  /**
   * Evaluates if the current user matches the specified role.
   */
  const hasRole = (checkRole: WorkspaceRole): boolean => {
    return role === checkRole;
  };

  return {
    role,
    status,
    can,
    hasRole,
    isOwner: role === WorkspaceRole.OWNER,
    isAdmin: role === WorkspaceRole.ADMIN || role === WorkspaceRole.OWNER
  };
}

// ---------------------------------------------------------------------------
// PermissionGate Guard Component
// ---------------------------------------------------------------------------

interface PermissionGateProps {
  permission?: WorkspacePermission;
  role?: WorkspaceRole;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * PermissionGate conditionally renders its children based on workspace permissions.
 */
export function PermissionGate({
  permission,
  role,
  fallback = null,
  children
}: PermissionGateProps) {
  const { can, hasRole } = usePermissions();

  if (permission && !can(permission)) {
    return React.createElement(React.Fragment, null, fallback);
  }

  if (role && !hasRole(role)) {
    return React.createElement(React.Fragment, null, fallback);
  }

  return React.createElement(React.Fragment, null, children);
}
