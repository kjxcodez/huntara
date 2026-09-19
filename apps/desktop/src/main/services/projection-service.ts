import { SdkClient } from '@huntara/sdk';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { getDatabase } from '../database/connection';
import { initCacheSchema } from '../database/cache-schema';
import { CacheHydrator } from './cache-hydrator';
import { AppLogger } from '../lib/logger';
import { BrowserWindow } from 'electron';

/**
 * ProjectionService — Reconciles authoritative MongoDB state into the local
 * disposable SQLite read projection.
 *
 * Invariants (Phase 2B):
 * 1. MongoDB is the sole authority; SQLite is purely a read-accelerating cache.
 * 2. Workers NEVER write directly to SQLite. Main process reconciles projections.
 * 3. All operations are strictly workspace-scoped.
 * 4. Repeated projections are idempotent (INSERT OR REPLACE).
 * 5. Failures are logged and observable without corrupting durable MongoDB data.
 */
export class ProjectionService {
  /**
   * Projects a single entity record from server into the workspace SQLite cache.
   */
  public static async projectEntity(
    table: string,
    record: any,
    workspaceId: string
  ): Promise<void> {
    if (!record || !workspaceId) return;
    try {
      await LocalCRMRepository.saveFromServer(table, {
        ...record,
        workspaceId
      });
    } catch (err: any) {
      AppLogger.warn(
        'ProjectionService',
        `Failed to project entity into "${table}": ${err?.message || err}`,
        workspaceId,
        { recordId: record.id || record._id }
      );
    }
  }

  /**
   * Projects an array of entity records from server into the workspace SQLite cache.
   */
  public static async projectEntities(
    table: string,
    records: any[],
    workspaceId: string
  ): Promise<void> {
    if (!Array.isArray(records) || records.length === 0 || !workspaceId) return;
    try {
      const scoped = records.map((r) => ({
        ...r,
        workspaceId
      }));
      await LocalCRMRepository.saveManyFromServer(table, scoped);
    } catch (err: any) {
      AppLogger.warn(
        'ProjectionService',
        `Failed to project ${records.length} entities into "${table}": ${err?.message || err}`,
        workspaceId
      );
    }
  }

  /**
   * Reconciles a DiscoveryRun and its associated company relationships.
   * Pulls authoritative companies for the run from MongoDB, updates
   * company_discovery_runs provenance links and discovery_runs result count.
   */
  public static async reconcileDiscoveryRun(
    workspaceId: string,
    runId: string,
    sdk: SdkClient
  ): Promise<any[]> {
    if (!workspaceId || !runId) return [];

    try {
      AppLogger.info('ProjectionService', `Reconciling DiscoveryRun "${runId}"`, workspaceId);

      // 1. Fetch authoritative companies linked to this run from MongoDB
      const serverCompanies = await sdk.discovery.listCompaniesForRun(runId);
      const companiesList = Array.isArray(serverCompanies) ? serverCompanies : [];

      // 2. Project companies into SQLite
      if (companiesList.length > 0) {
        await this.projectEntities('companies', companiesList, workspaceId);

        // 3. Project company_discovery_runs provenance links
        const links = companiesList.map((c: any) => ({
          id: `${runId}_${c.id || c._id}`,
          workspaceId,
          companyId: c.id || c._id,
          discoveryRunId: runId,
          createdAt: c.createdAt || new Date().toISOString()
        }));
        await this.projectEntities('company_discovery_runs', links, workspaceId);
      }

      // 4. Update the discovery run record in SQLite with latest count and status
      const existingRun = await LocalCRMRepository.findById('discovery_runs', workspaceId, runId);
      const runRecord = {
        id: runId,
        workspaceId,
        ...(existingRun || {}),
        resultCount: companiesList.length,
        status: existingRun?.status === 'running' ? 'completed' : (existingRun?.status || 'completed'),
        finishedAt: existingRun?.finishedAt || new Date().toISOString()
      };
      await LocalCRMRepository.saveFromServer('discovery_runs', runRecord);

      // 5. Query and return distinct companies from SQLite projection
      const db = getDatabase(workspaceId);
      const rows = db
        .prepare(
          `SELECT DISTINCT c.* FROM companies c
           INNER JOIN company_discovery_runs cdr ON c.id = cdr.companyId
           WHERE cdr.workspaceId = ? AND cdr.discoveryRunId = ? AND c.deletedAt IS NULL
           ORDER BY c.createdAt DESC`
        )
        .all(workspaceId, runId) as any[];

      this.broadcastProjectionUpdated('discovery_runs', workspaceId);
      return rows || [];
    } catch (err: any) {
      AppLogger.error(
        'ProjectionService',
        `Reconcile DiscoveryRun "${runId}" failed: ${err?.message || err}`,
        workspaceId,
        err
      );
      throw err;
    }
  }

  /**
   * Reconciles targeted entities after a background worker job completes successfully.
   * Called by JobScheduler.handleJobSuccess to ensure worker mutations in MongoDB
   * immediately reach the desktop SQLite projection.
   */
  public static async reconcileJobOutcome(
    workspaceId: string,
    jobType: string | undefined,
    payload: any,
    result: any,
    sdk: SdkClient
  ): Promise<void> {
    if (!workspaceId) return;

    try {
      // 1. Scraper Job Outcome -> Reconcile Discovery Run & Companies
      if (jobType === 'scraper:maps' || payload?.discoveryRunId) {
        const runId = payload?.discoveryRunId;
        if (runId) {
          await this.reconcileDiscoveryRun(workspaceId, runId, sdk).catch((err) => {
            AppLogger.warn('ProjectionService', `Auto-reconcile run "${runId}" failed: ${err.message}`, workspaceId);
          });
        }
      }

      // 2. Crawler / Enrichment Job Outcome -> Reconcile Target Company & Contacts
      if (jobType === 'crawler:website' || jobType === 'enrich:intelligence' || jobType === 'enrich:linkedin') {
        const companyId = payload?.companyId;
        if (companyId) {
          try {
            const company = await sdk.companies.get(companyId).catch(() => null);
            if (company) {
              await this.projectEntity('companies', company, workspaceId);
            }
            const contacts = await sdk.contacts.list({ companyId } as any).catch(() => []);
            const contactsList = Array.isArray(contacts) ? contacts : (contacts as any)?.data || [];
            if (contactsList.length > 0) {
              await this.projectEntities('contacts', contactsList, workspaceId);
            }
          } catch (entityErr: any) {
            AppLogger.warn('ProjectionService', `Failed to reconcile company "${companyId}": ${entityErr.message}`, workspaceId);
          }
        }
      }

      // 3. Campaign / Workflow Outreach Outcome -> Reconcile Campaign & Executions
      if (jobType === 'outreach:campaign' || jobType === 'automation:workflow' || payload?.campaignId || result?.campaignId) {
        let campaignId = payload?.campaignId || result?.campaignId;
        const executionId = payload?.executionId || result?.executionId;

        // If the worker yielded WAITING (step delay or mailbox throttle), immediately project into SQLite
        if (executionId && result?.status === 'waiting') {
          try {
            const db = getDatabase(workspaceId);
            const nowIso = new Date().toISOString();
            db.prepare(`
              UPDATE sequence_executions
              SET status = 'WAITING',
                  currentStep = ?,
                  nextExecutionAt = ?,
                  updatedAt = ?
              WHERE id = ? AND workspaceId = ?
            `).run(
              result.currentStep ?? 0,
              result.nextExecutionAt || nowIso,
              nowIso,
              executionId,
              workspaceId
            );
          } catch (updateErr: any) {
            AppLogger.warn('ProjectionService', `Direct SQLite WAITING projection note: ${updateErr.message}`, workspaceId);
          }
        }

        // Phase 15 (PAUSE-07 / DISCONNECT-16): If worker yielded PAUSED, immediately project into SQLite
        if (executionId && result?.status === 'paused') {
          try {
            const db = getDatabase(workspaceId);
            const nowIso = new Date().toISOString();
            db.prepare(`
              UPDATE sequence_executions
              SET status = 'PAUSED',
                  updatedAt = ?
              WHERE id = ? AND workspaceId = ?
            `).run(nowIso, executionId, workspaceId);
          } catch (updateErr: any) {
            AppLogger.warn('ProjectionService', `Direct SQLite PAUSED projection note: ${updateErr.message}`, workspaceId);
          }
        }

        // Phase 15 (DRIFT-STOP-19): If worker yielded CANCELLED, immediately project into SQLite
        if (executionId && (result?.status === 'cancelled' || result?.status === 'failed_terminal')) {
          try {
            const db = getDatabase(workspaceId);
            const nowIso = new Date().toISOString();
            db.prepare(`
              UPDATE sequence_executions
              SET status = 'CANCELLED',
                  updatedAt = ?
              WHERE id = ? AND workspaceId = ?
            `).run(nowIso, executionId, workspaceId);
          } catch (updateErr: any) {
            AppLogger.warn('ProjectionService', `Direct SQLite CANCELLED projection note: ${updateErr.message}`, workspaceId);
          }
        }

        // If executionId is present, project the individual execution
        if (executionId) {
          try {
            const ex = await sdk.executions.get(executionId).catch(() => null);
            if (ex) {
              await this.projectEntity('sequence_executions', ex, workspaceId);
              if (!campaignId && ex.campaignId) {
                campaignId = ex.campaignId;
              }
            }
          } catch {}
        }

        if (campaignId) {
          try {
            const campaign = await sdk.campaigns.get(campaignId).catch(() => null);
            if (campaign) {
              await this.projectEntity('campaigns', campaign, workspaceId);
            }
            const executions = await sdk.executions.list().catch(() => []);
            const exList = Array.isArray(executions) ? executions : (executions as any)?.data || [];
            const campaignExecs = exList.filter((e: any) => e.campaignId === campaignId);
            if (campaignExecs.length > 0) {
              await this.projectEntities('sequence_executions', campaignExecs, workspaceId);

              // Check if all executions for this active campaign are now in terminal states
              const allTerminal = campaignExecs.every((e: any) =>
                ['completed', 'failed', 'replied'].includes(String(e.status || '').toLowerCase())
              );
              if (allTerminal && campaign && String(campaign.status).toUpperCase() === 'ACTIVE') {
                try {
                  const completedCamp = await sdk.campaigns.update(campaignId, { status: 'COMPLETED' as any });
                  if (completedCamp) {
                    await this.projectEntity('campaigns', completedCamp, workspaceId);
                    AppLogger.info('ProjectionService', `Campaign "${campaignId}" transitioned to COMPLETED authoritatively`, workspaceId);
                  }
                } catch (updateErr: any) {
                  AppLogger.warn('ProjectionService', `Authoritative campaign status update error: ${updateErr.message}`, workspaceId);
                }
              }
            }
          } catch (campErr: any) {
            AppLogger.warn('ProjectionService', `Failed to reconcile campaign "${campaignId}": ${campErr.message}`, workspaceId);
          }
        }
      }

      this.broadcastProjectionUpdated(jobType || 'generic', workspaceId);
    } catch (err: any) {
      AppLogger.error(
        'ProjectionService',
        `Error during reconcileJobOutcome (${jobType}): ${err?.message || err}`,
        workspaceId,
        err
      );
    }
  }

  /**
   * Reconciles a targeted entity or all entities for a workspace from authoritative MongoDB state.
   * Pulls authoritative state via sdk, reconciles local SQLite projection (upserting live + tombstoning deleted),
   * and broadcasts sync:completed.
   */
  public static async reconcileEntity(
    workspaceId: string,
    scope: 'all' | 'audiences' | 'companies' | 'contacts' | 'campaigns' | 'discovery_runs',
    sdk: SdkClient,
    broadcast = true
  ): Promise<{ success: boolean; scope: string; recordsReconciled: Record<string, number> }> {
    if (!workspaceId) throw new Error('workspaceId is required for reconciliation');

    AppLogger.info('ProjectionService', `Reconciling entity scope "${scope}"`, workspaceId);
    const recordsReconciled: Record<string, number> = {};

    const reconcileAudiences = async () => {
      const res = await sdk.audiences.list();
      const items = Array.isArray(res) ? res : (res as any)?.data || [];
      const result = await LocalCRMRepository.reconcileTableFromServer('audiences', workspaceId, items);
      recordsReconciled['audiences'] = result.upserted;
    };

    const reconcileCompanies = async () => {
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
      const result = await LocalCRMRepository.reconcileTableFromServer('companies', workspaceId, all);
      recordsReconciled['companies'] = result.upserted;
    };

    const reconcileContacts = async () => {
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
      const result = await LocalCRMRepository.reconcileTableFromServer('contacts', workspaceId, all);
      recordsReconciled['contacts'] = result.upserted;
    };

    const reconcileCampaigns = async () => {
      const res = await sdk.campaigns.list();
      const items = Array.isArray(res) ? res : (res as any)?.data || [];
      const transformed = items.map((c: any) => ({
        ...c,
        status: c.status ? String(c.status).toUpperCase() : 'DRAFT'
      }));
      const result = await LocalCRMRepository.reconcileTableFromServer('campaigns', workspaceId, transformed);
      recordsReconciled['campaigns'] = result.upserted;

      try {
        const seqRes = await sdk.sequences.list();
        const seqItems = Array.isArray(seqRes) ? seqRes : (seqRes as any)?.data || [];
        if (seqItems.length > 0) {
          await LocalCRMRepository.reconcileTableFromServer('sequences', workspaceId, seqItems);
        }
      } catch {}

      try {
        const exRes = await sdk.executions.list();
        const exItems = Array.isArray(exRes) ? exRes : (exRes as any)?.data || [];
        const exTransformed = exItems.map((ex: any) => ({
          ...ex,
          status: ex.status ? String(ex.status).toUpperCase() : 'PENDING'
        }));
        if (exTransformed.length > 0) {
          await LocalCRMRepository.reconcileTableFromServer('sequence_executions', workspaceId, exTransformed);
        }
      } catch {}
    };

    const reconcileDiscoveryRuns = async () => {
      const res = await sdk.discovery.listRuns();
      const items = Array.isArray(res) ? res : (res as any)?.data || [];
      const result = await LocalCRMRepository.reconcileTableFromServer('discovery_runs', workspaceId, items);
      recordsReconciled['discovery_runs'] = result.upserted;

      try {
        const cdr = await sdk.companyDiscoveryRuns.list().catch(() => []);
        const cdrList = Array.isArray(cdr) ? cdr : (cdr as any)?.data || [];
        if (cdrList.length > 0) {
          await LocalCRMRepository.reconcileTableFromServer('company_discovery_runs', workspaceId, cdrList);
        }
      } catch {}
    };

    if (scope === 'audiences') {
      await reconcileAudiences();
    } else if (scope === 'companies') {
      await reconcileCompanies();
    } else if (scope === 'contacts') {
      await reconcileContacts();
    } else if (scope === 'campaigns') {
      await reconcileCampaigns();
    } else if (scope === 'discovery_runs') {
      await reconcileDiscoveryRuns();
    } else if (scope === 'all') {
      await reconcileAudiences();
      await reconcileCompanies();
      await reconcileContacts();
      await reconcileCampaigns();
      await reconcileDiscoveryRuns();
    }

    if (broadcast) {
      this.broadcastProjectionUpdated(scope, workspaceId);
    }

    return {
      success: true,
      scope,
      recordsReconciled
    };
  }

  /**
   * Rebuilds the disposable local SQLite projection for a workspace from authoritative MongoDB state.
   * Atomically clears local projection tables for the workspace and runs full hydration.
   */
  public static async rebuildWorkspaceProjection(
    workspaceId: string,
    sdk: SdkClient
  ): Promise<{ success: boolean; stats: Record<string, number> }> {
    if (!workspaceId) throw new Error('workspaceId is required to rebuild projection.');

    AppLogger.info('ProjectionService', `Initiating authoritative projection rebuild for workspace ${workspaceId}`, workspaceId);

    const db = getDatabase(workspaceId);
    initCacheSchema(db);

    const tablesToClear = [
      'companies',
      'contacts',
      'campaigns',
      'sequences',
      'sequence_executions',
      'templates',
      'email_accounts',
      'email_deliveries',
      'audiences',
      'discovery_runs',
      'company_discovery_runs',
      'suppressions'
    ];

    const clearTransaction = db.transaction(() => {
      for (const table of tablesToClear) {
        try {
          db.prepare(`DELETE FROM ${table} WHERE workspaceId = ?`).run(workspaceId);
        } catch (tableErr: any) {
          AppLogger.warn('ProjectionService', `Table "${table}" clear notice: ${tableErr.message}`, workspaceId);
        }
      }
    });

    clearTransaction();

    const result = await CacheHydrator.hydrateWorkspaceCache(workspaceId, sdk);

    this.broadcastProjectionUpdated('rebuild', workspaceId);

    return {
      success: result.success,
      stats: result.recordsHydrated
    };
  }

  /**
   * Broadcasts a sync notification to all active renderer windows.
   */
  public static broadcastProjectionUpdated(scope: string, workspaceId: string): void {
    try {
      if (typeof BrowserWindow !== 'undefined' && BrowserWindow.getAllWindows) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('sync:completed', {
              scope,
              workspaceId,
              timestamp: new Date().toISOString()
            });
          }
        });
      }
    } catch {
      // Safe fallback in headless / test environments
    }
  }
}
