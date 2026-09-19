import React, { createContext, useCallback, useContext, useReducer } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@huntara/schema';
import { WorkspaceService } from '../services/workspace-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  isLoading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type WorkspaceAction =
  | { type: 'WORKSPACES_LOADING' }
  | { type: 'WORKSPACES_LOADED'; payload: { workspaces: Workspace[]; active: Workspace | null } }
  | { type: 'WORKSPACE_SWITCHED'; payload: Workspace }
  | { type: 'WORKSPACES_ERROR'; payload: string }
  | { type: 'WORKSPACES_RESET' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialState: WorkspaceState = {
  workspaces: [],
  activeWorkspace: null,
  isLoading: false,
  error: null
};

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'WORKSPACES_LOADING':
      return { ...state, isLoading: true, error: null };
    case 'WORKSPACES_LOADED':
      return {
        ...state,
        isLoading: false,
        workspaces: action.payload.workspaces,
        activeWorkspace: action.payload.active
      };
    case 'WORKSPACE_SWITCHED':
      return { ...state, activeWorkspace: action.payload };
    case 'WORKSPACES_ERROR':
      return { ...state, isLoading: false, error: action.payload };
    case 'WORKSPACES_RESET':
      return initialState;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface WorkspaceContextValue {
  state: WorkspaceState;
  setLoading: () => void;
  setWorkspaces: (workspaces: Workspace[], active: Workspace | null) => void;
  switchWorkspace: (workspace: Workspace) => Promise<void>;
  setError: (error: string) => void;
  reset: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * WorkspaceProvider manages the active workspace session and switches workspaces.
 * When switching, it synchronises active state to the Electron main process headers
 * and invalidates all React Query caches to trigger a fresh scoped data reload.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const queryClient = useQueryClient();

  const setLoading = useCallback(() => dispatch({ type: 'WORKSPACES_LOADING' }), []);

  const setWorkspaces = useCallback(
    (workspaces: Workspace[], active: Workspace | null) => {
      dispatch({ type: 'WORKSPACES_LOADED', payload: { workspaces, active } });
    },
    []
  );

  const switchWorkspace = useCallback(
    async (workspace: Workspace) => {
      const workspaceId = workspace.id || null;

      // 1. Cancel in-flight queries before switching workspace
      await queryClient.cancelQueries();

      // 2. Sync token to main process headers and runtime manager
      await WorkspaceService.syncActiveWorkspace(workspaceId);

      // 3. Commit to react state
      dispatch({ type: 'WORKSPACE_SWITCHED', payload: workspace });

      // 4. Clear all cached data across all queries to prevent cross-workspace leakages
      await queryClient.resetQueries();
    },
    [queryClient]
  );

  const setError = useCallback((error: string) => {
    dispatch({ type: 'WORKSPACES_ERROR', payload: error });
  }, []);

  const reset = useCallback(() => {
    WorkspaceService.syncActiveWorkspace(null);
    dispatch({ type: 'WORKSPACES_RESET' });
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{ state, setLoading, setWorkspaces, switchWorkspace, setError, reset }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useWorkspaceStore provides direct access to the workspace reducer state.
 */
export function useWorkspaceStore(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspaceStore must be used within WorkspaceProvider');
  return ctx;
}
