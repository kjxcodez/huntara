import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from './useWorkspace';

/**
 * useEntityList fetches and synchronizes a list of cached local/remote entities.
 */
export function useEntityList(repo: any, filter?: any) {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';

  return useQuery({
    queryKey: [repo.tableName, 'list', workspaceId, filter],
    queryFn: async () => {
      if (!workspaceId) return [];
      return repo.listAndSync(workspaceId, filter);
    },
    enabled: !!workspaceId
  });
}

/**
 * useEntity fetches a single cached entity by ID.
 */
export function useEntity(repo: any, id: string) {
  return useQuery({
    queryKey: [repo.tableName, 'detail', id],
    queryFn: async () => {
      if (!id) return null;
      return repo.findById(id);
    },
    enabled: !!id
  });
}

/**
 * useCreateEntity inserts a new entity inside the active workspace.
 */
export function useCreateEntity(repo: any) {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';

  return useMutation({
    mutationFn: async (data: any) => {
      if (!workspaceId) throw new Error('No active workspace selection found.');
      return repo.create({ ...data, workspaceId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [repo.tableName, 'list', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['activities', 'list', workspaceId] }); // refresh logs
    }
  });
}

/**
 * useUpdateEntity updates metadata on a cached entity.
 */
export function useUpdateEntity(repo: any) {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return repo.update(id, { ...data, workspaceId });
    },
    onSuccess: (updatedRecord) => {
      queryClient.invalidateQueries({ queryKey: [repo.tableName, 'list', workspaceId] });
      queryClient.invalidateQueries({ queryKey: [repo.tableName, 'detail', updatedRecord.id] });
      queryClient.invalidateQueries({ queryKey: ['activities', 'list', workspaceId] });
    }
  });
}

/**
 * useDeleteEntity deletes/soft-deletes an entity from local/remote stores.
 */
export function useDeleteEntity(repo: any) {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id || '';

  return useMutation({
    mutationFn: async (args: string | { id: string; options?: any }) => {
      const id = typeof args === 'string' ? args : args.id;
      const options = typeof args === 'string' ? undefined : args.options;
      return repo.delete(id, options);
    },
    onSuccess: (_, args) => {
      const id = typeof args === 'string' ? args : args.id;
      queryClient.invalidateQueries({ queryKey: [repo.tableName, 'list', workspaceId] });
      queryClient.invalidateQueries({ queryKey: [repo.tableName, 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['activities', 'list', workspaceId] });
      if (repo.tableName === 'companies') {
        queryClient.invalidateQueries({ queryKey: ['contacts', 'list', workspaceId] });
      }
    }
  });
}
