import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from './useWorkspace';
import { toast } from 'sonner';

export type ProjectionScope =
  | 'all'
  | 'audiences'
  | 'companies'
  | 'contacts'
  | 'campaigns'
  | 'discovery_runs';

/**
 * useProjectionRefresh provides authoritative on-demand synchronization
 * and automated query invalidation for the local SQLite projection.
 *
 * It explicitly avoids application reloads (no window.location.reload) and adheres
 * strictly to the architectural hierarchy:
 * MongoDB (authoritative) -> SQLite (disposable projection) -> React Query cache -> Renderer.
 */
export function useProjectionRefresh(scope: ProjectionScope) {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const invalidateScopeQueries = useCallback(
    (targetScope: string) => {
      if (targetScope === 'audiences' || targetScope === 'all') {
        queryClient.invalidateQueries({ queryKey: ['audiences'] });
      }
      if (targetScope === 'companies' || targetScope === 'all') {
        queryClient.invalidateQueries({ queryKey: ['companies'] });
      }
      if (targetScope === 'contacts' || targetScope === 'all') {
        queryClient.invalidateQueries({ queryKey: ['contacts'] });
      }
      if (targetScope === 'campaigns' || targetScope === 'all') {
        queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        queryClient.invalidateQueries({ queryKey: ['campaign_enrollments'] });
      }
      if (targetScope === 'discovery_runs' || targetScope === 'all') {
        queryClient.invalidateQueries({ queryKey: ['discovery_runs'] });
        queryClient.invalidateQueries({ queryKey: ['discovery-runs'] });
      }
    },
    [queryClient]
  );

  // Listen for main process sync broadcasts to automatically invalidate queries
  useEffect(() => {
    if (!window?.ipc?.on) return undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.ipc.on('sync:completed', (payload: any) => {
        const eventScope = payload?.scope || 'all';
        const eventWorkspace = payload?.workspaceId;
        if (!eventWorkspace || !workspaceId || eventWorkspace === workspaceId) {
          invalidateScopeQueries(eventScope);
        }
      });
    } catch {
      // Handle test environments where window.ipc.on may be mocked differently
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [workspaceId, invalidateScopeQueries]);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      toast.error('No active workspace selected.');
      return;
    }

    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      const result = await window.ipc.invoke('sync:reconcile', {
        workspaceId,
        scope
      });

      invalidateScopeQueries(scope);
      toast.success(
        scope === 'all'
          ? 'Workspace data synchronized.'
          : `${scope.charAt(0).toUpperCase() + scope.slice(1).replace('_', ' ')} synchronized.`
      );
      return result;
    } catch (err: any) {
      const message = err?.message || 'Reconciliation failed.';
      toast.error(`Sync error: ${message}`);
      throw err;
    } finally {
      setIsRefreshing(false);
    }
  }, [workspaceId, scope, isRefreshing, invalidateScopeQueries]);

  return {
    refresh,
    isRefreshing
  };
}
