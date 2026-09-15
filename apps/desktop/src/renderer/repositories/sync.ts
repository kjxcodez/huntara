import type { ISyncRepository } from '../../main/database/contracts';
import {
  RemoteCompanyRepository,
  RemoteContactRepository,
  RemoteCampaignRepository,
  RemoteActivityRepository,
  RemoteSequenceRepository,
  RemoteSequenceExecutionRepository,
  RemoteSequenceLogRepository
} from './remote';

// ---------------------------------------------------------------------------
// Base Data Repository Class for Renderer
// ---------------------------------------------------------------------------

const DOMAIN_CHANNELS: Record<
  string,
  { list: string; get: string; create: string; update: string; delete: string }
> = {
  companies: {
    list: 'companies:list',
    get: 'companies:get',
    create: 'companies:create',
    update: 'companies:update',
    delete: 'companies:delete'
  },
  contacts: {
    list: 'contacts:list',
    get: 'contacts:get',
    create: 'contacts:create',
    update: 'contacts:update',
    delete: 'contacts:delete'
  },
  campaigns: {
    list: 'campaigns:list',
    get: 'campaigns:get',
    create: 'campaigns:create',
    update: 'campaigns:update',
    delete: 'campaigns:delete'
  },
  sequences: {
    list: 'sequence:list',
    get: 'sequence:get',
    create: 'sequence:create',
    update: 'sequence:update',
    delete: 'sequence:delete'
  },
  sequence_executions: {
    list: 'execution:list',
    get: 'execution:get',
    create: 'sequence:start',
    update: 'sequence:stop',
    delete: 'sequence:delete' // placeholder
  }
};

class BaseSyncRepository<T> implements ISyncRepository<T> {
  constructor(
    public tableName: string,
    public remoteRepo: any
  ) {}

  async findById(id: string): Promise<T | null> {
    const workspaceId = await window.ipc.invoke('electron:getActiveWorkspace', undefined);
    if (!workspaceId) throw new Error('Active workspace context is required for database queries.');

    const channels = DOMAIN_CHANNELS[this.tableName];
    if (channels) {
      return window.ipc.invoke(channels.get as any, { workspaceId, id });
    }

    // Fallback legacy path
    const cached = await window.ipc.invoke('db:findById', {
      tableName: this.tableName,
      workspaceId,
      id
    });
    return cached as T | null;
  }

  async findMany(filter?: Partial<T> & { workspaceId: string }): Promise<T[]> {
    if (!filter?.workspaceId) {
      throw new Error('workspaceId is required for repository findMany.');
    }

    const channels = DOMAIN_CHANNELS[this.tableName];
    if (channels) {
      return window.ipc.invoke(channels.list as any, { workspaceId: filter.workspaceId, filter });
    }

    // Fallback legacy path
    const cached = await window.ipc.invoke('db:find', {
      tableName: this.tableName,
      workspaceId: filter.workspaceId,
      filter
    });
    return cached as T[];
  }

  async listAndSync(workspaceId: string, filter?: Record<string, any>): Promise<T[]> {
    return this.findMany({ workspaceId, ...filter } as any);
  }

  async create(data: T & { workspaceId: string }): Promise<T> {
    const channels = DOMAIN_CHANNELS[this.tableName];
    if (channels) {
      const id = (data as any).id || crypto.randomUUID();
      const record = { ...data, id };
      return window.ipc.invoke(channels.create as any, record);
    }

    // Fallback path
    const id = (data as any).id || crypto.randomUUID();
    const record = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await window.ipc.invoke('db:save', { tableName: this.tableName, record });
    return record;
  }

  async update(id: string, data: Partial<T> & { workspaceId: string }): Promise<T> {
    const channels = DOMAIN_CHANNELS[this.tableName];
    if (channels) {
      return window.ipc.invoke(channels.update as any, { id, dto: data });
    }

    // Fallback path
    const current = await this.findById(id);
    const updatedRecord = {
      ...current,
      ...data,
      updatedAt: new Date().toISOString()
    };
    await window.ipc.invoke('db:save', { tableName: this.tableName, record: updatedRecord });
    return updatedRecord as T;
  }

  async delete(id: string, options?: { mode?: string }): Promise<any> {
    const workspaceId = await window.ipc.invoke('electron:getActiveWorkspace', undefined);
    if (!workspaceId) throw new Error('Active workspace context is required.');

    const channels = DOMAIN_CHANNELS[this.tableName];
    if (channels) {
      return window.ipc.invoke(channels.delete as any, { workspaceId, id, ...(options || {}) });
    }

    // Fallback path
    await window.ipc.invoke('db:softDelete', { tableName: this.tableName, workspaceId, id });
  }
}

// ---------------------------------------------------------------------------
// Concrete Repositories exports
// ---------------------------------------------------------------------------

export const SyncCompanyRepository = new BaseSyncRepository<any>(
  'companies',
  RemoteCompanyRepository
);
export const SyncContactRepository = new BaseSyncRepository<any>(
  'contacts',
  RemoteContactRepository
);
export const SyncCampaignRepository = new BaseSyncRepository<any>(
  'campaigns',
  RemoteCampaignRepository
);
export const SyncActivityRepository = new BaseSyncRepository<any>(
  'activities',
  RemoteActivityRepository
);
export const SyncSequenceRepository = new BaseSyncRepository<any>(
  'sequences',
  RemoteSequenceRepository
);
export const SyncSequenceExecutionRepository = new BaseSyncRepository<any>(
  'sequence_executions',
  RemoteSequenceExecutionRepository
);
