import { safeRegister } from './helper';
import { SdkClient } from '@huntara/sdk';
import { LocalWorkspaceRepository } from '../database/repositories/local-workspace';
import { WorkspaceManager } from '../lib/workspace-manager';

/**
 * Registers workspace management and membership/invitations IPC channels.
 */
export function registerWorkspaceIpc(
  sdk: SdkClient,
  setWorkspaceHeader?: (workspaceId: string | null) => void,
  persistActiveWorkspace?: (workspaceId: string | null) => void,
  getPersistedActiveWorkspace?: () => string | null
) {
  safeRegister('workspaces:create', async (_event, payload) => {
    console.log('Main Process: Creating workspace:', payload);
    const ws = await sdk.workspaces.create(payload);
    try {
      await LocalWorkspaceRepository.save(ws);
    } catch (e) {
      console.error('[IPC] Failed to cache created workspace:', e);
    }
    return ws;
  });

  safeRegister('workspaces:list', async () => {
    console.log('Main Process: Listing user workspaces');
    const savedActiveWorkspaceId = getPersistedActiveWorkspace
      ? getPersistedActiveWorkspace()
      : null;
    try {
      // Temporarily clear x-workspace-id header so backend returns ALL workspaces for this user!
      if (setWorkspaceHeader) setWorkspaceHeader(null);
      const workspaces = await sdk.workspaces.list();

      // If active workspace header was set to a stale ID, validate or switch to authentic user workspace
      if (workspaces && workspaces.length > 0) {
        const isValidActive = !!(
          savedActiveWorkspaceId && workspaces.some((w: any) => w.id === savedActiveWorkspaceId)
        );
        const firstWorkspace = workspaces[0] as { id: string };
        const validWorkspaceId = isValidActive
          ? (savedActiveWorkspaceId as string)
          : firstWorkspace.id;
        if (setWorkspaceHeader) setWorkspaceHeader(validWorkspaceId);
        if (persistActiveWorkspace && !isValidActive) persistActiveWorkspace(validWorkspaceId);
      } else if (setWorkspaceHeader && savedActiveWorkspaceId) {
        setWorkspaceHeader(savedActiveWorkspaceId);
      }

      try {
        await LocalWorkspaceRepository.saveMany(workspaces);
      } catch (e) {
        console.error('[IPC] Failed to cache workspaces list:', e);
      }
      return workspaces;
    } catch (err) {
      if (setWorkspaceHeader && savedActiveWorkspaceId) setWorkspaceHeader(savedActiveWorkspaceId);
      console.warn(
        '[IPC] Failed to list workspaces from remote, falling back to local cache:',
        err
      );
      return LocalWorkspaceRepository.findMany();
    }
  });

  safeRegister('workspaces:update', async (_event, payload) => {
    console.log('Main Process: Updating workspace details:', payload);
    const ws = await sdk.workspaces.update(payload.id, payload.dto);
    try {
      await LocalWorkspaceRepository.save(ws);
    } catch (e) {
      console.error('[IPC] Failed to cache updated workspace:', e);
    }
    return ws;
  });

  safeRegister('workspaces:delete', async (_event, payload) => {
    console.log('Main Process: Deleting workspace:', payload);
    const id = workspaceIdOrToken(payload);
    const res = await sdk.workspaces.delete(id);
    try {
      await LocalWorkspaceRepository.delete(id);
    } catch (e) {
      console.error('[IPC] Failed to delete cached workspace:', e);
    }
    return res;
  });

  safeRegister('workspaces:get', async (_event, payload) => {
    console.log('Main Process: Fetching workspace:', payload);
    const id = workspaceIdOrToken(payload);
    try {
      const ws = await sdk.workspaces.get(id);
      try {
        await LocalWorkspaceRepository.save(ws);
      } catch (e) {
        console.error('[IPC] Failed to cache workspace:', e);
      }
      return ws;
    } catch (err) {
      console.warn(
        `[IPC] Failed to fetch workspace ${id} from remote, falling back to cache:`,
        err
      );
      const ws = await LocalWorkspaceRepository.findById(id);
      if (!ws) throw err;
      return ws;
    }
  });

  // Members Management
  safeRegister('workspaces:members:list', async (_event, payload) => {
    console.log('Main Process: Listing members for workspace:', payload);
    return sdk.workspaces.listMembers(workspaceIdOrToken(payload));
  });

  safeRegister('workspaces:members:invite', async (_event, payload) => {
    console.log('Main Process: Inviting user to workspace:', payload);
    const workspaceId = payload.workspaceId || payload.id;
    const email = payload.email || payload.dto?.email;
    const role = payload.role || payload.dto?.role;
    return sdk.workspaces.inviteMember(workspaceId, { email, role });
  });

  safeRegister('workspaces:members:updateRole', async (_event, payload) => {
    console.log('Main Process: Updating workspace member role:', payload);
    const memberId = payload.memberId || payload.userId;
    return sdk.workspaces.updateMemberRole(payload.id, memberId, payload.role);
  });

  safeRegister('workspaces:members:remove', async (_event, payload) => {
    console.log('Main Process: Removing member from workspace:', payload);
    const memberId = payload.memberId || payload.userId;
    return sdk.workspaces.removeMember(payload.id, memberId);
  });

  safeRegister('workspaces:members:leave', async (_event, payload) => {
    console.log('Main Process: Leaving workspace:', payload);
    return sdk.workspaces.leave(workspaceIdOrToken(payload));
  });

  safeRegister('workspaces:members:transferOwnership', async (_event, payload) => {
    console.log('Main Process: Transferring workspace ownership:', payload);
    return sdk.workspaces.transferOwnership(payload.id, payload.newOwnerId);
  });

  // Invitations
  safeRegister('workspaces:invites:list', async () => {
    console.log('Main Process: Listing pending user invites');
    return sdk.workspaces.listPendingInvites();
  });

  safeRegister('workspaces:invites:accept', async (_event, payload) => {
    console.log('Main Process: Accepting invite:', payload);
    return sdk.workspaces.acceptInvite(payload);
  });

  safeRegister('workspaces:invites:decline', async (_event, payload) => {
    console.log('Main Process: Declining invite:', payload);
    return sdk.workspaces.declineInvite(payload);
  });

  safeRegister('projection:rebuild', async (_event, payload?: { workspaceId?: string }) => {
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime(payload?.workspaceId);
    if (!runtime) throw new Error('No active workspace runtime');
    const { ProjectionService } = await import('../services/projection-service');
    return ProjectionService.rebuildWorkspaceProjection(runtime.workspaceId, runtime.sdk);
  });

  safeRegister('sync:reconcile', async (_event, payload: { workspaceId: string; scope?: any }) => {
    const workspaceId = payload?.workspaceId || WorkspaceManager.getActiveRuntime()?.workspaceId;
    if (!workspaceId) throw new Error('workspaceId is required for sync:reconcile');
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime(workspaceId);
    if (!runtime) throw new Error(`No active workspace runtime for ${workspaceId}`);
    const { ProjectionService } = await import('../services/projection-service');
    return ProjectionService.reconcileEntity(runtime.workspaceId, payload.scope || 'all', runtime.sdk, true);
  });
}

/**
 * Handles payload unpacking to resolve workspaceId.
 */
function workspaceIdOrToken(payload: any): string {
  if (typeof payload === 'string') return payload;
  return payload.id || payload.workspaceId || '';
}
