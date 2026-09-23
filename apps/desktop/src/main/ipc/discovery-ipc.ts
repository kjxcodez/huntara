import { safeRegister } from './helper';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { getDatabase } from '../database/connection';
import { WorkspaceManager } from '../lib/workspace-manager';
import { ProjectionService } from '../services/projection-service';
import { ConnectivityService } from '../services/connectivity-service';

export function registerDiscoveryIpc() {
  safeRegister('discovery:run:create', async (_event, payload) => {
    const { workspaceId, name, query, country, state, city, maxResults = 20, provider = 'google_maps' } = payload;
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!query || !query.trim()) throw new Error('Query is required.');
    if (!country || !country.trim()) throw new Error('Country is required.');
    if (!state || !state.trim()) throw new Error('State / Region is required.');

    const runName = name && name.trim() ? name.trim() : `${query} in ${city || state || country || 'Global'}`.trim();
    const sdk = WorkspaceManager.getSdk();

    const created = await sdk.discovery.createRun({
      workspaceId,
      name: runName,
      query,
      country: country || null,
      state: state || null,
      city: city || null,
      provider,
      status: 'running',
      resultCount: 0,
      startedAt: new Date().toISOString()
    });

    // Save discovery run record directly into SQLite cache
    await LocalCRMRepository.saveFromServer('discovery_runs', created);
    ProjectionService.broadcastProjectionUpdated('discovery_runs', workspaceId);

    // Submit scraper job to scheduler via MongoDB SDK
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : require('crypto').randomUUID();

    try {
      await sdk.jobs.create({
        id: jobId,
        type: 'scraper:maps',
        priority: 1,
        payload: {
          discoveryRunId: created.id,
          query,
          country,
          state,
          city,
          maxResults
        },
        maxRetries: 3
      });
    } catch (err) {
      console.warn('[IPC] Scraper job queueing note:', err);
    }

    return created;
  });

  safeRegister('discovery:run:list', async (_event, { workspaceId }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    
    // Sync latest discovery runs from MongoDB to keep statuses and counts up to date
    const connState = ConnectivityService.getState();
    if (connState.status === 'ONLINE') {
      try {
        const sdk = WorkspaceManager.getSdk();
        await ProjectionService.reconcileEntity(workspaceId, 'discovery_runs', sdk, false);
      } catch {
        // Fallback to existing SQLite cache if network/API is temporarily unavailable
      }
    }

    return LocalCRMRepository.findMany('discovery_runs', workspaceId);
  });

  safeRegister('discovery:run:get', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    return LocalCRMRepository.findById('discovery_runs', workspaceId, id);
  });

  safeRegister('discovery:run:companies', async (_event, { workspaceId, runId, forceSync }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!runId) throw new Error('runId is required.');

    const connState = ConnectivityService.getState();
    const isOnline = connState.status === 'ONLINE';

    // Only do a full MongoDB reconcile when explicitly requested (e.g. after a job completes).
    // Regular polling reads from the local SQLite projection to avoid a reconcile→broadcast→refetch loop.
    if (isOnline && forceSync) {
      const sdk = WorkspaceManager.getSdk();
      return await ProjectionService.reconcileDiscoveryRun(workspaceId, runId, sdk);
    }

    // Default: serve from the existing SQLite projection (fast, no broadcast side-effect)
    const db = getDatabase(workspaceId);
    const rows = db
      .prepare(
        `SELECT DISTINCT c.* FROM companies c
         INNER JOIN company_discovery_runs cdr ON c.id = cdr.companyId
         WHERE c.workspaceId = ? AND cdr.workspaceId = ? AND cdr.discoveryRunId = ? AND c.deletedAt IS NULL
         ORDER BY c.createdAt DESC`
      )
      .all(workspaceId, workspaceId, runId) as any[];

    return rows || [];
  });

  safeRegister('discovery:run:delete', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');

    const sdk = WorkspaceManager.getSdk();

    // 1. Authoritative deletion via MongoDB API
    const result = await sdk.discovery.deleteRun(id);

    // 2. Projection cleanup in SQLite:
    // Soft-delete the discovery run in SQLite cache
    await LocalCRMRepository.softDeleteFromServer('discovery_runs', workspaceId, id);

    // Hard-delete run-specific company_discovery_runs links from SQLite
    try {
      const db = getDatabase(workspaceId);
      db.prepare('DELETE FROM company_discovery_runs WHERE workspaceId = ? AND discoveryRunId = ?').run(
        workspaceId,
        id
      );
    } catch (err) {
      console.warn('[DiscoveryIPC] Note cleaning company_discovery_runs cache:', err);
    }

    // Soft-delete cascaded companies in SQLite projection
    if (result?.deletedCompanyIds && Array.isArray(result.deletedCompanyIds)) {
      for (const compId of result.deletedCompanyIds) {
        await LocalCRMRepository.softDeleteFromServer('companies', workspaceId, compId);
      }
    }

    // Soft-delete cascaded contacts in SQLite projection
    if (result?.deletedContactIds && Array.isArray(result.deletedContactIds)) {
      for (const contId of result.deletedContactIds) {
        await LocalCRMRepository.softDeleteFromServer('contacts', workspaceId, contId);
      }
    }

    // 3. Broadcast projection update to renderer
    ProjectionService.broadcastProjectionUpdated('discovery_runs', workspaceId);
    if (result?.deletedCompanyIds?.length) {
      ProjectionService.broadcastProjectionUpdated('companies', workspaceId);
    }
    if (result?.deletedContactIds?.length) {
      ProjectionService.broadcastProjectionUpdated('contacts', workspaceId);
    }

    return result ?? { success: true };
  });
}

