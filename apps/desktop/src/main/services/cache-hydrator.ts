import { SdkClient } from '@huntara/sdk';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { getDatabase } from '../database/connection';
import { initCacheSchema } from '../database/cache-schema';
import { AppLogger } from '../lib/logger';
import { BrowserWindow } from 'electron';
import { WorkspaceManager } from '../lib/workspace-manager';

export interface HydrationResult {
  success: boolean;
  workspaceId: string;
  durationMs: number;
  recordsHydrated: Record<string, number>;
  errors: Array<{ table: string; error: string }>;
}

/**
 * CacheHydrator pulls canonical business data from MongoDB (via SdkClient / Hono API)
 * and populates the local SQLite disposable read cache for a workspace.
 * 
 * Invariants:
 *  - MongoDB is the sole authority; SQLite is purely a read-accelerating cache.
 *  - CacheHydrator uses bounded batching and atomic SQLite transactions per dataset.
 *  - Exact ID parity: API.id === MongoDB._id === SQLite.id.
 */
export type HydrationState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'READY' | 'FAILED';

export class CacheHydrator {
  private static hydrationStates = new Map<string, HydrationState>();

  public static getWorkspaceHydrationState(workspaceId: string): HydrationState {
    return CacheHydrator.hydrationStates.get(workspaceId) || 'STOPPED';
  }

  /**
   * Hydrates all durable business entities for a workspace from MongoDB into SQLite.
   */
  public static async hydrateWorkspaceCache(
    workspaceId: string,
    sdk: SdkClient
  ): Promise<HydrationResult> {
    CacheHydrator.hydrationStates.set(workspaceId, 'RUNNING');
    const startTime = Date.now();
    AppLogger.info('CacheHydrator', `Starting workspace cache hydration for ${workspaceId}`, workspaceId);

    // Ensure database and cache schema exist before hydrating
    const db = getDatabase(workspaceId);
    initCacheSchema(db);

    const recordsHydrated: Record<string, number> = {};
    const errors: Array<{ table: string; error: string }> = [];

    const datasets: Array<{
      table: string;
      fetch: () => Promise<any[]>;
      transform?: (item: any) => any;
    }> = [
      {
        table: 'companies',
        fetch: async () => {
          let all: any[] = [];
          let page = 1;
          const limit = 100;
          while (true) {
            const res = await sdk.companies.list({ page, limit } as any);
            const items = Array.isArray(res) ? res : (res as any)?.data || [];
            if (!items || items.length === 0) break;
            all = all.concat(items);
            if (items.length < limit) break;
            page++;
          }
          return all;
        }
      },
      {
        table: 'contacts',
        fetch: async () => {
          let all: any[] = [];
          let page = 1;
          const limit = 100;
          while (true) {
            const res = await sdk.contacts.list({ page, limit } as any);
            const items = Array.isArray(res) ? res : (res as any)?.data || [];
            if (!items || items.length === 0) break;
            all = all.concat(items);
            if (items.length < limit) break;
            page++;
          }
          return all;
        }
      },
      {
        table: 'campaigns',
        fetch: async () => {
          const res = await sdk.campaigns.list();
          return Array.isArray(res) ? res : (res as any)?.data || [];
        },
        transform: (c) => ({
          ...c,
          status: c.status ? String(c.status).toUpperCase() : 'DRAFT'
        })
      },
      {
        table: 'sequences',
        fetch: async () => {
          const res = await sdk.sequences.list();
          return Array.isArray(res) ? res : (res as any)?.data || [];
        }
      },
      {
        table: 'sequence_executions',
        fetch: async () => {
          const res = await sdk.executions.list();
          return Array.isArray(res) ? res : (res as any)?.data || [];
        },
        transform: (ex) => ({
          ...ex,
          status: ex.status ? String(ex.status).toUpperCase() : 'PENDING'
        })
      },
      {
        table: 'email_accounts',
        fetch: async () => {
          const res = await sdk.outreach.listAccounts();
          return Array.isArray(res) ? res : (res as any)?.data || [];
        }
      },
      {
        table: 'templates',
        fetch: async () => {
          const res = await sdk.outreach.listTemplates();
          return Array.isArray(res) ? res : (res as any)?.data || [];
        }
      },
      {
        table: 'audiences',
        fetch: async () => {
          const res = await sdk.audiences.list();
          return Array.isArray(res) ? res : (res as any)?.data || [];
        }
      },
      {
        table: 'discovery_runs',
        fetch: async () => {
          const res = await sdk.discovery.listRuns();
          return Array.isArray(res) ? res : (res as any)?.data || [];
        }
      },
      {
        table: 'company_discovery_runs',
        fetch: async () => {
          const res = await sdk.companyDiscoveryRuns.list();
          return Array.isArray(res) ? res : (res as any)?.data || [];
        }
      },
      {
        table: 'email_deliveries',
        fetch: async () => {
          const res = await sdk.emailDeliveries.list({ limit: 200 }).catch(() => ({ data: [] }));
          return Array.isArray((res as any)?.data) ? (res as any).data : (Array.isArray(res) ? res : []);
        }
      }
    ];

    // Hydrate each dataset in dependency order
    for (const { table, fetch, transform } of datasets) {
      // Check if this workspace has been superseded by a subsequent workspace switch
      try {
        const targetWs = WorkspaceManager.getTargetWorkspaceId();
        if (targetWs && targetWs !== workspaceId) {
          AppLogger.info(
            'CacheHydrator',
            `Aborting hydration for superseded workspace: ${workspaceId} (target is now ${targetWs})`,
            workspaceId
          );
          CacheHydrator.hydrationStates.set(workspaceId, 'STOPPED');
          return {
            success: false,
            workspaceId,
            durationMs: Date.now() - startTime,
            recordsHydrated,
            errors: [{ table: 'all', error: 'Hydration superseded by another workspace switch' }]
          };
        }
      } catch {
        // WorkspaceManager may not have an active runtime in unit test contexts
      }

      try {
        const rawItems = await fetch();
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          // Process in bounded batches of 100 to prevent memory spikes
          const BATCH_SIZE = 100;
          let count = 0;

          for (let i = 0; i < rawItems.length; i += BATCH_SIZE) {
            const chunk = rawItems.slice(i, i + BATCH_SIZE).map((item: any) => {
              const base = transform ? transform(item) : item;
              return {
                ...base,
                workspaceId
              };
            });
            await LocalCRMRepository.saveManyFromServer(table, chunk);
            count += chunk.length;
          }

          recordsHydrated[table] = count;
        } else {
          recordsHydrated[table] = 0;
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        AppLogger.warn('CacheHydrator', `Failed to hydrate cache table "${table}": ${errMsg}`, workspaceId);
        errors.push({ table, error: errMsg });
        recordsHydrated[table] = 0;
      }
    }

    const durationMs = Date.now() - startTime;
    const success = errors.length === 0;
    CacheHydrator.hydrationStates.set(workspaceId, success ? 'READY' : 'FAILED');

    AppLogger.info(
      'CacheHydrator',
      `Completed workspace cache hydration in ${durationMs}ms with ${errors.length} errors`,
      workspaceId
    );

    this.broadcastCacheUpdated(workspaceId);

    return {
      success,
      workspaceId,
      durationMs,
      recordsHydrated,
      errors
    };
  }

  /**
   * Resets the entire local SQLite cache and rehydrates all datasets from MongoDB.
   * This is a zero-data-loss operation since MongoDB is the authoritative truth.
   */
  public static async resetAndRehydrateWorkspaceCache(
    workspaceId: string,
    sdk: SdkClient
  ): Promise<HydrationResult> {
    AppLogger.info('CacheHydrator', `Resetting and rehydrating cache for workspace: ${workspaceId}`);
    await LocalCRMRepository.resetCache(workspaceId);
    return await this.hydrateWorkspaceCache(workspaceId, sdk);
  }

  /**
   * Hydrates a single entity table on-demand from MongoDB into SQLite.
   */
  public static async hydrateEntityTable(
    table: string,
    workspaceId: string,
    sdk: SdkClient
  ): Promise<any[]> {
    try {
      let list: any[] = [];
      if (table === 'companies') list = await sdk.companies.list();
      else if (table === 'contacts') list = await sdk.contacts.list();
      else if (table === 'campaigns') list = await sdk.campaigns.list();
      else if (table === 'sequences') list = await sdk.sequences.list();
      else if (table === 'sequence_executions') list = await sdk.executions.list();
      else if (table === 'templates') list = await sdk.outreach.listTemplates();
      else if (table === 'email_accounts') list = await sdk.outreach.listAccounts();
      else if (table === 'audiences') list = await sdk.audiences.list();
      else if (table === 'discovery_runs') list = await sdk.discovery.listRuns();
      else if (table === 'company_discovery_runs') list = await sdk.companyDiscoveryRuns.list();

      if (Array.isArray(list) && list.length > 0) {
        const records = list.map((item: any) => ({
          ...item,
          workspaceId
        }));
        await LocalCRMRepository.saveManyFromServer(table, records);
      }
      return list;
    } catch (err) {
      AppLogger.warn('CacheHydrator', `Single table hydration failed for "${table}": ${err}`, workspaceId);
      return LocalCRMRepository.findMany(table, workspaceId);
    }
  }

  /**
   * Broadcasts a cache-updated event to all active renderer windows.
   */
  private static broadcastCacheUpdated(workspaceId: string): void {
    // Only broadcast if the workspace is still the currently active or target workspace
    try {
      const targetWs = WorkspaceManager.getTargetWorkspaceId();
      if (targetWs && targetWs !== workspaceId) {
        return;
      }
    } catch {
      // Ignore in environments without active runtime
    }

    try {
      if (typeof BrowserWindow !== 'undefined' && BrowserWindow.getAllWindows) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('sync:completed', {
              scope: 'all',
              workspaceId,
              timestamp: new Date().toISOString()
            });
          }
        });
      }
    } catch {
      // IPC window context not yet active in test or headless environments
    }
  }
}
