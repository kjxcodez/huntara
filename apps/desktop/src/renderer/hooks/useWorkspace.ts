import { useWorkspaceStore } from '../stores/workspace-store';
import { WorkspaceService } from '../services/workspace-service';
import type { Workspace, UpdateWorkspaceDto } from '@leadforge/schema';

/**
 * useWorkspace provides the presentation state and action handlers
 * for managing workspace selection and metadata updates.
 */
export function useWorkspace() {
  const { state, switchWorkspace, setWorkspaces, setLoading, setError } = useWorkspaceStore();

  /**
   * Sets the active workspace and updates Electron process headers.
   */
  const setActive = async (workspace: Workspace) => {
    await switchWorkspace(workspace);
  };

  /**
   * Creates a new workspace and sets it as active immediately.
   */
  const createWorkspace = async (name: string) => {
    setLoading();
    try {
      const workspace = await WorkspaceService.createWorkspace(name);

      // Re-fetch all user workspaces list to include the new one
      const list = await WorkspaceService.listWorkspaces();
      setWorkspaces(list, workspace);
      await switchWorkspace(workspace);
      return workspace;
    } catch (err: any) {
      setError(err.message || 'Failed to create workspace.');
      throw err;
    }
  };

  /**
   * Updates workspace metadata.
   */
  const updateWorkspace = async (id: string, dto: UpdateWorkspaceDto) => {
    try {
      const updated = await WorkspaceService.updateWorkspace(id, dto);
      const list = await WorkspaceService.listWorkspaces();

      // Update active workspace if the updated one is active
      const active = state.activeWorkspace?.id === id ? updated : state.activeWorkspace;
      setWorkspaces(list, active);
      return updated;
    } catch (err: any) {
      throw err;
    }
  };

  /**
   * Deletes a workspace and switches to another active one.
   */
  const deleteWorkspace = async (id: string) => {
    try {
      await WorkspaceService.deleteWorkspace(id);
      const list = await WorkspaceService.listWorkspaces();

      const nextActive = list.length > 0 ? (list[0] ?? null) : null;
      setWorkspaces(list, nextActive);
    } catch (err: any) {
      throw err;
    }
  };

  return {
    workspaces: state.workspaces,
    activeWorkspace: state.activeWorkspace,
    isLoading: state.isLoading,
    error: state.error,
    setActive,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace
  };
}
