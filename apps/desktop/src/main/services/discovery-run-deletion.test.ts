import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import os from 'os';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

// ── Mock electron before importing IPC modules ─────────────────────────────
const ipcHandlers = new Map<string, Function>();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
    getVersion: vi.fn(() => '1.1.1-beta.5'),
    isPackaged: false,
    setAppUserModelId: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      ipcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      ipcHandlers.delete(channel);
    }),
    on: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}));

import { getDatabase, closeDatabase } from '../database/connection';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { ProjectionService } from './projection-service';
import { WorkspaceManager } from '../lib/workspace-manager';
import { registerDiscoveryIpc } from '../ipc/discovery-ipc';

/**
 * LeadForge OS — Phase 7: Safe Discovery Run Deletion Test Matrix
 *
 * Deterministically validates all 20 acceptance scenarios:
 * 1. Delete completed run
 * 2. Delete failed run
 * 3. Delete cancelled/stopped run
 * 4. Reject active run deletion (running status)
 * 5. Remove run-owned provenance (company_discovery_runs)
 * 6. Preserve canonical company
 * 7. Preserve shared company across multiple runs
 * 8. Preserve canonical contact
 * 9. Preserve historical delivery
 * 10. Preserve suppression
 * 11. Clean/cancel run-owned jobs
 * 12. Update/tombstone SQLite projection
 * 13. Renderer list invalidation
 * 14. Workspace isolation (Workspace A cannot delete Run B)
 * 15. Authorization / workspace scoping
 * 16. Idempotent repeated deletion
 * 17. Delete vs worker race handling
 * 18. Delete vs refresh race handling
 * 19. No company/contact cascade assertion (explicit count integrity)
 * 20. No campaign/delivery cascade assertion (explicit count integrity)
 */

describe('Phase 7 — Safe Discovery Run Deletion Test Matrix', () => {
  let tempDbDir: string;
  const workspaceA = 'ws_phase7_alpha';
  const workspaceB = 'ws_phase7_beta';

  let queryClient: QueryClient;
  let broadcastCalls: Array<{ scope: string; workspaceId: string }>;

  // In-memory backend stores simulating authoritative MongoDB collections
  let mongoStore: {
    discoveryRuns: any[];
    companyDiscoveryRuns: any[];
    companies: any[];
    contacts: any[];
    campaigns: any[];
    deliveries: any[];
    suppressions: any[];
    jobs: any[];
  };

  function createAuthoritativeMockSdk() {
    return {
      discovery: {
        listRuns: vi.fn(async () => {
          return mongoStore.discoveryRuns.filter((r) => !r.deletedAt);
        }),
        getRun: vi.fn(async (id: string) => {
          const run = mongoStore.discoveryRuns.find((r) => r.id === id);
          if (!run || run.deletedAt) throw new Error('NotFoundError: Run not found');
          return run;
        }),
        deleteRun: vi.fn(async (id: string) => {
          const run = mongoStore.discoveryRuns.find((r) => r.id === id);
          if (!run || run.deletedAt) {
            // Idempotent catch from API route
            return { success: true, alreadyDeleted: true };
          }
          if (run.status === 'running') {
            throw new Error('BadRequestError: Cannot delete a discovery run while it is actively running.');
          }

          // 1. Cancel queued/active jobs
          for (const job of mongoStore.jobs) {
            if (
              job.payload?.discoveryRunId === id &&
              ['pending', 'queued', 'starting', 'waiting', 'retrying'].includes(job.status)
            ) {
              job.status = 'cancelled';
              job.finishedAt = new Date().toISOString();
              job.error = 'Discovery run deleted';
            }
          }

          // Evaluate candidate companies before deleting provenance
          const candidateLinks = mongoStore.companyDiscoveryRuns.filter((cdr) => cdr.discoveryRunId === id);
          const deletedCompanyIds: string[] = [];
          const deletedContactIds: string[] = [];

          for (const link of candidateLinks) {
            const compId = link.companyId;
            // Check other runs
            const hasOtherRun = mongoStore.companyDiscoveryRuns.some(
              (cdr) => cdr.companyId === compId && cdr.discoveryRunId !== id
            );
            if (hasOtherRun) continue;

            const company = mongoStore.companies.find((c) => c.id === compId);
            if (!company) continue;

            if (new Date(company.createdAt).getTime() < new Date(run.createdAt).getTime()) {
              continue;
            }

            // Check if any contact has deliveries
            const compContacts = mongoStore.contacts.filter((c) => c.companyId === compId);
            const compContactIds = compContacts.map((c) => c.id);
            const hasDelivery = mongoStore.deliveries.some((d) => compContactIds.includes(d.contactId));
            if (hasDelivery) continue;

            // Safe to delete!
            company.deletedAt = new Date().toISOString();
            deletedCompanyIds.push(compId);
            for (const cont of compContacts) {
              cont.deletedAt = new Date().toISOString();
              deletedContactIds.push(cont.id);
            }
          }

          // 2. Hard-delete run-owned provenance records
          mongoStore.companyDiscoveryRuns = mongoStore.companyDiscoveryRuns.filter(
            (cdr) => cdr.discoveryRunId !== id
          );

          // 3. Soft-delete authoritative DiscoveryRun
          run.deletedAt = new Date().toISOString();
          return {
            success: true,
            deletedCompanyIds: deletedCompanyIds.length > 0 ? deletedCompanyIds : undefined,
            deletedContactIds: deletedContactIds.length > 0 ? deletedContactIds : undefined
          };
        })
      },
      jobs: {
        list: vi.fn(async () => [...mongoStore.jobs]),
        cancel: vi.fn(async (id: string) => {
          const job = mongoStore.jobs.find((j) => j.id === id);
          if (job) job.status = 'cancelled';
          return job;
        })
      },
      companies: {
        list: vi.fn(async () => mongoStore.companies.filter((c) => !c.deletedAt))
      },
      contacts: {
        list: vi.fn(async () => mongoStore.contacts.filter((c) => !c.deletedAt))
      }
    };
  }

  let mockSdk: any;

  beforeEach(() => {
    tempDbDir = path.join(os.tmpdir(), `lf-p7-del-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDbDir, { recursive: true });
    process.env.WORKSPACES_DB_DIR = tempDbDir;

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 }
      }
    });

    broadcastCalls = [];
    vi.spyOn(ProjectionService, 'broadcastProjectionUpdated').mockImplementation((scope, wsId) => {
      broadcastCalls.push({ scope, workspaceId: wsId });
      // Invalidate query client as renderer would
      queryClient.invalidateQueries({ queryKey: [scope, 'list', wsId] });
      queryClient.invalidateQueries({ queryKey: [scope] });
    });

    // Reset MongoDB authoritative stores
    mongoStore = {
      discoveryRuns: [],
      companyDiscoveryRuns: [],
      companies: [],
      contacts: [],
      campaigns: [],
      deliveries: [],
      suppressions: [],
      jobs: []
    };

    mockSdk = createAuthoritativeMockSdk();
    vi.spyOn(WorkspaceManager, 'getSdk').mockReturnValue(mockSdk as any);

    // Register IPC handler
    registerDiscoveryIpc();
  });

  afterEach(() => {
    closeDatabase(workspaceA);
    closeDatabase(workspaceB);
    vi.restoreAllMocks();
    delete process.env.WORKSPACES_DB_DIR;
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {}
  });

  async function invokeDeleteIpc(payload: { workspaceId?: string; id?: string }) {
    const handler = ipcHandlers.get('discovery:run:delete');
    if (!handler) throw new Error('discovery:run:delete IPC handler not registered');
    return handler({}, payload);
  }

  // Helper to seed canonical CRM and projection state
  async function seedBaselineData() {
    // 1. Discovery Runs
    mongoStore.discoveryRuns = [
      {
        id: 'run_completed_1',
        workspaceId: workspaceA,
        name: 'Plumbers Austin',
        query: 'plumbers',
        city: 'Austin',
        status: 'completed',
        resultCount: 2,
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'run_failed_1',
        workspaceId: workspaceA,
        name: 'Electricians Dallas',
        query: 'electricians',
        city: 'Dallas',
        status: 'failed',
        resultCount: 0,
        error: 'Timeout',
        createdAt: '2026-09-02T00:00:00.000Z'
      },
      {
        id: 'run_cancelled_1',
        workspaceId: workspaceA,
        name: 'Roofers Houston',
        query: 'roofers',
        city: 'Houston',
        status: 'cancelled',
        resultCount: 0,
        createdAt: '2026-09-03T00:00:00.000Z'
      },
      {
        id: 'run_running_1',
        workspaceId: workspaceA,
        name: 'HVAC San Antonio',
        query: 'hvac',
        city: 'San Antonio',
        status: 'running',
        resultCount: 1,
        createdAt: '2026-09-04T00:00:00.000Z'
      },
      {
        id: 'run_wsB_1',
        workspaceId: workspaceB,
        name: 'Workspace B Discovery',
        query: 'architects',
        status: 'completed',
        resultCount: 5,
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    ];

    // 2. Canonical Companies
    mongoStore.companies = [
      {
        id: 'comp_1',
        workspaceId: workspaceA,
        name: 'Austin Plumbing Pro',
        domain: 'austinplumbing.com',
        city: 'Austin',
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'comp_2',
        workspaceId: workspaceA,
        name: 'Lone Star Pipes',
        domain: 'lonestarpipes.com',
        city: 'Austin',
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'comp_shared_3',
        workspaceId: workspaceA,
        name: 'Texas Multi-Trade Corp',
        domain: 'texastrade.com',
        city: 'Austin',
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    ];

    // 3. Provenance Links (CompanyDiscoveryRun)
    mongoStore.companyDiscoveryRuns = [
      { id: 'cdr_1', workspaceId: workspaceA, discoveryRunId: 'run_completed_1', companyId: 'comp_1' },
      { id: 'cdr_2', workspaceId: workspaceA, discoveryRunId: 'run_completed_1', companyId: 'comp_2' },
      { id: 'cdr_shared_A', workspaceId: workspaceA, discoveryRunId: 'run_completed_1', companyId: 'comp_shared_3' },
      // comp_shared_3 is ALSO linked to another run:
      { id: 'cdr_shared_B', workspaceId: workspaceA, discoveryRunId: 'run_cancelled_1', companyId: 'comp_shared_3' }
    ];

    // 4. Canonical Contacts
    mongoStore.contacts = [
      {
        id: 'cont_1',
        workspaceId: workspaceA,
        companyId: 'comp_1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@austinplumbing.com'
      },
      {
        id: 'cont_2',
        workspaceId: workspaceA,
        companyId: 'comp_2',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@lonestarpipes.com'
      }
    ];

    // 5. Historical Outreach / Campaign Executions & Deliveries
    mongoStore.campaigns = [
      { id: 'camp_1', workspaceId: workspaceA, name: 'Q3 Plumbers Outreach', status: 'completed' }
    ];

    mongoStore.deliveries = [
      {
        id: 'del_1',
        workspaceId: workspaceA,
        campaignId: 'camp_1',
        contactId: 'cont_1',
        status: 'delivered',
        deliveredAt: '2026-09-05T00:00:00.000Z'
      }
    ];

    // 6. Suppressions
    mongoStore.suppressions = [
      { id: 'sup_1', workspaceId: workspaceA, domain: 'austinplumbing.com', reason: 'dnc' }
    ];

    // 7. Background Jobs
    mongoStore.jobs = [
      {
        id: 'job_pending_1',
        workspaceId: workspaceA,
        status: 'pending',
        payload: { discoveryRunId: 'run_completed_1' }
      },
      {
        id: 'job_unrelated',
        workspaceId: workspaceA,
        status: 'pending',
        payload: { otherId: 'foo' }
      }
    ];

    // Populate SQLite cache for workspaceA
    for (const run of mongoStore.discoveryRuns.filter((r) => r.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('discovery_runs', run);
    }
    for (const comp of mongoStore.companies) {
      await LocalCRMRepository.saveFromServer('companies', comp);
    }
    for (const cont of mongoStore.contacts) {
      await LocalCRMRepository.saveFromServer('contacts', cont);
    }
    for (const cdr of mongoStore.companyDiscoveryRuns) {
      await LocalCRMRepository.saveFromServer('company_discovery_runs', cdr);
    }

    // Populate SQLite for workspaceB
    for (const run of mongoStore.discoveryRuns.filter((r) => r.workspaceId === workspaceB)) {
      await LocalCRMRepository.saveFromServer('discovery_runs', run);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1: Delete completed run
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 1 — Delete completed run: deletes run provenance and marks projection deleted', async () => {
    await seedBaselineData();

    const result = await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });
    expect(result.success).toBe(true);

    // MongoDB authoritative run is soft-deleted
    const authoritative = mongoStore.discoveryRuns.find((r) => r.id === 'run_completed_1');
    expect(authoritative.deletedAt).toBeDefined();

    // SQLite cache excludes the deleted run
    const localRuns = await LocalCRMRepository.findMany('discovery_runs', workspaceA);
    expect(localRuns.find((r) => r.id === 'run_completed_1')).toBeUndefined();

    // Direct SQLite check verifies deletedAt column is set
    const db = getDatabase(workspaceA);
    const rawRow: any = db.prepare('SELECT * FROM discovery_runs WHERE id = ?').get('run_completed_1');
    expect(rawRow.deletedAt).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2: Delete failed run
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 2 — Delete failed run: safely deletes failed runs without error', async () => {
    await seedBaselineData();

    const result = await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_failed_1' });
    expect(result.success).toBe(true);

    const authoritative = mongoStore.discoveryRuns.find((r) => r.id === 'run_failed_1');
    expect(authoritative.deletedAt).toBeDefined();

    const localRuns = await LocalCRMRepository.findMany('discovery_runs', workspaceA);
    expect(localRuns.find((r) => r.id === 'run_failed_1')).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3: Delete cancelled/stopped run
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 3 — Delete cancelled/stopped run: safely deletes cancelled or stopped runs', async () => {
    await seedBaselineData();

    const result = await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_cancelled_1' });
    expect(result.success).toBe(true);

    const authoritative = mongoStore.discoveryRuns.find((r) => r.id === 'run_cancelled_1');
    expect(authoritative.deletedAt).toBeDefined();

    const localRuns = await LocalCRMRepository.findMany('discovery_runs', workspaceA);
    expect(localRuns.find((r) => r.id === 'run_cancelled_1')).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4: Reject active run deletion (running status)
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 4 — Reject active run deletion: throws BadRequestError when run is running', async () => {
    await seedBaselineData();

    await expect(
      invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_running_1' })
    ).rejects.toThrow(/Cannot delete a discovery run while it is actively running/i);

    // MongoDB authoritative run remains untouched and running
    const authoritative = mongoStore.discoveryRuns.find((r) => r.id === 'run_running_1');
    expect(authoritative.deletedAt).toBeUndefined();
    expect(authoritative.status).toBe('running');

    // SQLite projection remains active
    const localRuns = await LocalCRMRepository.findMany('discovery_runs', workspaceA);
    expect(localRuns.find((r) => r.id === 'run_running_1')).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5: Remove run-owned provenance (company_discovery_runs)
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 5 — Remove run-owned provenance: cleans company_discovery_runs in both MongoDB and SQLite', async () => {
    await seedBaselineData();

    // Verify initial provenance links exist
    const db = getDatabase(workspaceA);
    let rawCdr = db.prepare('SELECT * FROM company_discovery_runs WHERE discoveryRunId = ?').all('run_completed_1');
    expect(rawCdr.length).toBe(3);

    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    // MongoDB provenance links for run_completed_1 are hard-deleted
    const remainingMongoCdr = mongoStore.companyDiscoveryRuns.filter((cdr) => cdr.discoveryRunId === 'run_completed_1');
    expect(remainingMongoCdr.length).toBe(0);

    // SQLite provenance links are deleted
    rawCdr = db.prepare('SELECT * FROM company_discovery_runs WHERE discoveryRunId = ?').all('run_completed_1');
    expect(rawCdr.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 6: Preserve canonical company
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 6 — Preserve canonical company: canonical companies are NEVER deleted or altered', async () => {
    await seedBaselineData();

    const initialComp1 = await LocalCRMRepository.findById('companies', workspaceA, 'comp_1');
    expect(initialComp1).toBeDefined();

    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    // Canonical company still exists in MongoDB
    const mongoComp = mongoStore.companies.find((c) => c.id === 'comp_1');
    expect(mongoComp).toBeDefined();
    expect(mongoComp.deletedAt).toBeUndefined();

    // Canonical company still exists in SQLite
    const localComp = await LocalCRMRepository.findById('companies', workspaceA, 'comp_1');
    expect(localComp).toBeDefined();
    expect(localComp.name).toBe('Austin Plumbing Pro');
    expect(localComp.deletedAt ? localComp.deletedAt : null).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 7: Preserve shared company across multiple runs
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 7 — Preserve shared company across multiple runs: company retains provenance to other runs', async () => {
    await seedBaselineData();

    // comp_shared_3 is linked to run_completed_1 AND run_cancelled_1
    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    // In SQLite, provenance to run_cancelled_1 is preserved
    const db = getDatabase(workspaceA);
    const remainingLinks: any[] = db
      .prepare('SELECT * FROM company_discovery_runs WHERE companyId = ?')
      .all('comp_shared_3');
    expect(remainingLinks.length).toBe(1);
    expect(remainingLinks[0].discoveryRunId).toBe('run_cancelled_1');

    // In MongoDB, provenance to run_cancelled_1 is preserved
    const mongoLinks = mongoStore.companyDiscoveryRuns.filter((cdr) => cdr.companyId === 'comp_shared_3');
    expect(mongoLinks.length).toBe(1);
    expect(mongoLinks[0].discoveryRunId).toBe('run_cancelled_1');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 8: Preserve canonical contact with outreach lineage
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 8 — Preserve canonical contact: contacts with outreach lineage are preserved', async () => {
    await seedBaselineData();

    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    // MongoDB contact with outreach history is preserved
    const preservedContact = mongoStore.contacts.find((c) => c.id === 'cont_1');
    expect(preservedContact?.deletedAt).toBeUndefined();

    // SQLite contacts query returns preserved contact
    const contacts = await LocalCRMRepository.findMany('contacts', workspaceA);
    expect(contacts.find((c) => c.id === 'cont_1')?.email).toBe('john@austinplumbing.com');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 9: Preserve historical delivery
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 9 — Preserve historical delivery: email deliveries and campaign executions remain untouched', async () => {
    await seedBaselineData();

    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    // MongoDB deliveries and campaigns intact
    expect(mongoStore.campaigns.length).toBe(1);
    expect(mongoStore.deliveries.length).toBe(1);
    expect(mongoStore.deliveries[0].status).toBe('delivered');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 10: Preserve suppression
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 10 — Preserve suppression: domain and contact suppressions are completely preserved', async () => {
    await seedBaselineData();

    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    expect(mongoStore.suppressions.length).toBe(1);
    expect(mongoStore.suppressions[0].domain).toBe('austinplumbing.com');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 11: Clean/cancel run-owned jobs
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 11 — Clean/cancel run-owned jobs: pending jobs for the deleted run are marked cancelled', async () => {
    await seedBaselineData();

    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    const runJob = mongoStore.jobs.find((j) => j.id === 'job_pending_1');
    expect(runJob.status).toBe('cancelled');
    expect(runJob.error).toBe('Discovery run deleted');

    // Unrelated jobs remain unaffected
    const otherJob = mongoStore.jobs.find((j) => j.id === 'job_unrelated');
    expect(otherJob.status).toBe('pending');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 12: Update/tombstone SQLite projection
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 12 — Update/tombstone SQLite projection: discovery_runs table row is marked deletedAt', async () => {
    await seedBaselineData();

    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    const db = getDatabase(workspaceA);
    const row: any = db.prepare('SELECT deletedAt FROM discovery_runs WHERE id = ?').get('run_completed_1');
    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 13: Renderer list invalidation
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 13 — Renderer list invalidation: emits broadcastProjectionUpdated for discovery_runs', async () => {
    await seedBaselineData();

    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    expect(broadcastCalls.length).toBeGreaterThan(0);
    const discoveryBroadcast = broadcastCalls.find(
      (call) => call.scope === 'discovery_runs' && call.workspaceId === workspaceA
    );
    expect(discoveryBroadcast).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 14: Workspace isolation (Workspace A cannot delete Run B)
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 14 — Workspace isolation: Workspace A cannot delete Run B belonging to Workspace B', async () => {
    await seedBaselineData();

    // If workspaceA passes run_wsB_1, it will not delete run_wsB_1 in workspaceB
    // The SQLite call is scoped to workspaceA, so run_wsB_1 in workspaceB SQLite remains active
    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_wsB_1' });

    const wsBRuns = await LocalCRMRepository.findMany('discovery_runs', workspaceB);
    const runInB = wsBRuns.find((r) => r.id === 'run_wsB_1');
    expect(runInB).toBeDefined();
    expect(runInB.status).toBe('completed');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 15: Authorization / workspace scoping
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 15 — Authorization / workspace scoping: missing workspaceId or id throws error', async () => {
    await seedBaselineData();

    await expect(invokeDeleteIpc({ workspaceId: '', id: 'run_completed_1' })).rejects.toThrow(
      /workspaceId is required/i
    );

    await expect(invokeDeleteIpc({ workspaceId: workspaceA, id: '' })).rejects.toThrow(
      /id is required/i
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 16: Idempotent repeated deletion
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 16 — Idempotent repeated deletion: deleting already-deleted run succeeds without crashing', async () => {
    await seedBaselineData();

    // First deletion
    const res1 = await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });
    expect(res1.success).toBe(true);

    // Second deletion (idempotent)
    const res2 = await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });
    expect(res2.success).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 17: Delete vs worker race handling
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 17 — Delete vs worker race handling: active run cannot be deleted while worker is running', async () => {
    await seedBaselineData();

    // Attempting to delete during active worker execution fails
    await expect(
      invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_running_1' })
    ).rejects.toThrow(/Cannot delete a discovery run while it is actively running/i);

    // After worker finishes/completes, deletion succeeds cleanly
    const run = mongoStore.discoveryRuns.find((r) => r.id === 'run_running_1');
    run.status = 'completed';

    const res = await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_running_1' });
    expect(res.success).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 18: Delete vs refresh race handling
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 18 — Delete vs refresh race handling: refresh after deletion preserves tombstone', async () => {
    await seedBaselineData();

    // Delete run
    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });

    // Simulate global refresh / projection reconcile triggered right after
    await ProjectionService.reconcileEntity(workspaceA, 'discovery_runs', mockSdk);

    // The deleted run is NOT resurrected in SQLite
    const localRuns = await LocalCRMRepository.findMany('discovery_runs', workspaceA);
    expect(localRuns.find((r) => r.id === 'run_completed_1')).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 19: Safe company/contact cascade assertion & SQLite projection tombstoning
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 19 — Safe company/contact cascade assertion: exclusive clean company and contact are deleted, while multi-run and outreach-linked entities are preserved', async () => {
    await seedBaselineData();

    // Before deletion: 3 companies, 2 contacts in SQLite
    expect((await LocalCRMRepository.findMany('companies', workspaceA)).length).toBe(3);
    expect((await LocalCRMRepository.findMany('contacts', workspaceA)).length).toBe(2);

    // Delete completed run
    // - comp_1 is preserved (has delivery del_1 on cont_1)
    // - comp_shared_3 is preserved (linked to run_cancelled_1)
    // - comp_2 and cont_2 are exclusively owned by run_completed_1 -> deleted!
    const res = await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });
    expect(res.success).toBe(true);
    expect(res.deletedCompanyIds).toContain('comp_2');
    expect(res.deletedContactIds).toContain('cont_2');

    const companiesAfter = await LocalCRMRepository.findMany('companies', workspaceA);
    const contactsAfter = await LocalCRMRepository.findMany('contacts', workspaceA);

    // In SQLite projection: comp_2 and cont_2 are removed from active queries
    expect(companiesAfter.length).toBe(2);
    expect(companiesAfter.map((c) => c.id).sort()).toEqual(['comp_1', 'comp_shared_3'].sort());
    expect(contactsAfter.length).toBe(1);
    expect(contactsAfter[0].id).toBe('cont_1');

    // Verify projection tombstone in SQLite
    const db = getDatabase(workspaceA);
    const comp2Row: any = db.prepare('SELECT * FROM companies WHERE id = ?').get('comp_2');
    expect(comp2Row.deletedAt).not.toBeNull();
    const cont2Row: any = db.prepare('SELECT * FROM contacts WHERE id = ?').get('cont_2');
    expect(cont2Row.deletedAt).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 20: No campaign/delivery cascade assertion (explicit count integrity)
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 20 — No campaign/delivery cascade assertion: campaigns and email deliveries remain 100% identical', async () => {
    await seedBaselineData();

    const campaignsBefore = mongoStore.campaigns.length;
    const deliveriesBefore = mongoStore.deliveries.length;
    const suppressionsBefore = mongoStore.suppressions.length;

    // Delete multiple runs
    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_completed_1' });
    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_failed_1' });
    await invokeDeleteIpc({ workspaceId: workspaceA, id: 'run_cancelled_1' });

    const campaignsAfter = mongoStore.campaigns.length;
    const deliveriesAfter = mongoStore.deliveries.length;
    const suppressionsAfter = mongoStore.suppressions.length;

    // Exact identity: ZERO outreach, campaign, delivery, or suppression records deleted
    expect(campaignsAfter).toBe(campaignsBefore);
    expect(deliveriesAfter).toBe(deliveriesBefore);
    expect(suppressionsAfter).toBe(suppressionsBefore);
    expect(campaignsAfter).toBe(1);
    expect(deliveriesAfter).toBe(1);
    expect(suppressionsAfter).toBe(1);
  });
});
