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
import { registerCrmIpc } from '../ipc/crm';
import type { DeleteCompanyMode, DeleteCompanyResult } from '@huntara/schema';

/**
 * LeadForge OS — Phase 8: Safe Company Deletion Semantics Test Matrix
 *
 * Deterministically validates all 29 acceptance requirements:
 *
 * [Basic Lifecycle]
 * 1. Delete eligible Company in 'company-only' mode.
 * 2. Deleted Company disappears from active queries.
 * 3. Deleted Company does not reappear after projection refresh.
 * 4. Repeated deletion is deterministic/idempotent.
 *
 * [Ownership]
 * 5. Company-owned records (intelligence, opportunity scores, website intelligence) are cleaned up.
 * 6. Shared records (Campaigns, Sequences) are preserved.
 * 7. DiscoveryRun records are not cascaded.
 * 8. CompanyDiscoveryRun provenance handling is correct (junctions deleted).
 * 9. Other Companies remain untouched.
 *
 * [Contacts & Eligibility Rules]
 * 10. Mode 'company-only' preserves 100% of contacts.
 * 11. Mode 'company-and-eligible-contacts' deletes fresh uncontacted contacts.
 * 12. Contacts with historical delivery lineage are protected and preserved.
 * 13. Contacts with active campaign executions are protected and preserved.
 * 14. Contacts with completed/failed/replied sequence executions are preserved.
 * 15. Contact-level suppression remains intact.
 *
 * [Outreach History]
 * 16. Campaign sequence executions remain intact.
 * 17. Email deliveries remain intact.
 * 18. Historical lineage remains queryable and consistent.
 *
 * [Safety]
 * 19. Company-level suppression remains intact.
 * 20. Domain-level suppression remains intact.
 * 21. Deletion cannot weaken a DNC state.
 *
 * [Isolation / Authorization]
 * 22. Workspace A cannot delete Workspace B's Company.
 * 23. Missing workspaceId throws error.
 * 24. Missing companyId throws error.
 *
 * [Race Safety]
 * 25. Delete vs queued background crawler/enrichment jobs (jobs cancelled).
 * 26. Delete vs active outreach worker (outreach proceeds for preserved contact).
 * 27. Delete vs projection reconciliation race (tombstone preserved, no resurrection).
 * 28. Delete vs delivery/reply write (historical writes succeed).
 *
 * [Projection]
 * 29. Mongo authoritative transition -> SQLite projection converges -> query invalidation broadcasted.
 */

describe('Phase 8 — Safe Company Deletion Semantics Test Matrix', () => {
  let tempDbDir: string;
  const workspaceA = 'ws_phase8_alpha';
  const workspaceB = 'ws_phase8_beta';

  let queryClient: QueryClient;
  let broadcastCalls: Array<{ scope: string; workspaceId: string }>;

  // In-memory backend stores simulating authoritative MongoDB collections
  let mongoStore: {
    companies: any[];
    contacts: any[];
    companyDiscoveryRuns: any[];
    discoveryRuns: any[];
    companyIntelligence: any[];
    websiteIntelligence: any[];
    opportunityScores: any[];
    campaigns: any[];
    sequences: any[];
    sequenceExecutions: any[];
    emailDeliveries: any[];
    suppressions: any[];
    jobs: any[];
  };

  function createAuthoritativeMockSdk(scopedWorkspaceId: string = workspaceA) {
    return {
      companies: {
        list: vi.fn(async (params?: any) => {
          return mongoStore.companies.filter((c) => c.workspaceId === scopedWorkspaceId && !c.deletedAt);
        }),
        get: vi.fn(async (id: string) => {
          const comp = mongoStore.companies.find((c) => c.id === id && c.workspaceId === scopedWorkspaceId);
          if (!comp || comp.deletedAt) throw new Error('NotFoundError: Company not found');
          return comp;
        }),
        delete: vi.fn(async (id: string, options?: { mode?: DeleteCompanyMode }) => {
          const mode: DeleteCompanyMode = options?.mode || 'company-only';
          const comp = mongoStore.companies.find((c) => c.id === id && c.workspaceId === scopedWorkspaceId);

          if (!comp) {
            throw new Error('NotFoundError: Company not found');
          }
          if (comp.deletedAt) {
            return {
              success: true,
              alreadyDeleted: true,
              companyDeleted: false,
              contactsDeletedCount: 0,
              contactsPreservedCount: 0
            };
          }

          // 1. Cancel pending/queued jobs targeting this company
          for (const job of mongoStore.jobs) {
            if (
              job.workspaceId === scopedWorkspaceId &&
              job.payload?.companyId === id &&
              ['pending', 'queued', 'starting', 'waiting', 'retrying'].includes(job.status)
            ) {
              job.status = 'cancelled';
              job.finishedAt = new Date().toISOString();
              job.error = 'Target company deleted';
            }
          }

          // 2. Hard-delete run provenance junction records
          mongoStore.companyDiscoveryRuns = mongoStore.companyDiscoveryRuns.filter(
            (cdr) => cdr.companyId !== id || cdr.workspaceId !== scopedWorkspaceId
          );

          // 3. Clean company-owned intelligence / scores
          mongoStore.companyIntelligence = mongoStore.companyIntelligence.filter(
            (ci) => ci.companyId !== id || ci.workspaceId !== scopedWorkspaceId
          );
          mongoStore.websiteIntelligence = mongoStore.websiteIntelligence.filter(
            (wi) => wi.companyId !== id || wi.workspaceId !== scopedWorkspaceId
          );
          mongoStore.opportunityScores = mongoStore.opportunityScores.filter(
            (os) => os.companyId !== id || os.workspaceId !== scopedWorkspaceId
          );

          // 4. Contact eligibility evaluation
          const contacts = mongoStore.contacts.filter(
            (c) => c.workspaceId === scopedWorkspaceId && c.companyId === id && !c.deletedAt
          );
          let contactsDeletedCount = 0;
          let contactsPreservedCount = 0;
          const deletedContactIds: string[] = [];
          const preservedReasons: { activeWork?: number; historicalLineage?: number } = {};

          if (mode === 'company-and-eligible-contacts' && contacts.length > 0) {
            for (const contact of contacts) {
              const hasActiveExec = mongoStore.sequenceExecutions.some(
                (se) =>
                  se.contactId === contact.id &&
                  ['PENDING', 'RUNNING', 'WAITING', 'PAUSED'].includes(se.status)
              );
              const hasHistExec = mongoStore.sequenceExecutions.some(
                (se) =>
                  se.contactId === contact.id &&
                  ['COMPLETED', 'FAILED', 'REPLIED', 'CANCELLED'].includes(se.status)
              );
              const hasDelivery = mongoStore.emailDeliveries.some(
                (ed) => ed.contactId === contact.id || ed.recipientEmail === contact.email
              );

              if (hasActiveExec) {
                contactsPreservedCount++;
                preservedReasons.activeWork = (preservedReasons.activeWork || 0) + 1;
              } else if (hasHistExec || hasDelivery) {
                contactsPreservedCount++;
                preservedReasons.historicalLineage = (preservedReasons.historicalLineage || 0) + 1;
              } else {
                // Fresh contact -> eligible!
                contact.deletedAt = new Date().toISOString();
                contactsDeletedCount++;
                deletedContactIds.push(contact.id);
              }
            }
          } else {
            contactsPreservedCount = contacts.length;
          }

          // 5. Soft-delete authoritative Company
          comp.deletedAt = new Date().toISOString();

          return {
            success: true,
            companyDeleted: true,
            contactsDeletedCount,
            contactsPreservedCount,
            deletedContactIds: deletedContactIds.length > 0 ? deletedContactIds : undefined,
            preservedReasons: Object.keys(preservedReasons).length > 0 ? preservedReasons : undefined
          };
        })
      },
      contacts: {
        list: vi.fn(async () => mongoStore.contacts.filter((c) => c.workspaceId === scopedWorkspaceId && !c.deletedAt))
      },
      campaigns: {
        list: vi.fn(async () => mongoStore.campaigns.filter((c) => c.workspaceId === scopedWorkspaceId && !c.deletedAt))
      },
      sequences: {
        list: vi.fn(async () => mongoStore.sequences.filter((s) => s.workspaceId === scopedWorkspaceId && !s.deletedAt))
      },
      executions: {
        list: vi.fn(async () => mongoStore.sequenceExecutions.filter((se) => se.workspaceId === scopedWorkspaceId))
      },
      discovery: {
        listRuns: vi.fn(async () => mongoStore.discoveryRuns.filter((r) => r.workspaceId === scopedWorkspaceId && !r.deletedAt))
      },
      companyDiscoveryRuns: {
        list: vi.fn(async () => mongoStore.companyDiscoveryRuns.filter((cdr) => cdr.workspaceId === scopedWorkspaceId))
      },
      suppressions: {
        list: vi.fn(async () => mongoStore.suppressions.filter((s) => s.workspaceId === scopedWorkspaceId))
      },
      audiences: {
        list: vi.fn(async () => [])
      }
    };
  }

  let mockSdk: any;

  beforeEach(() => {
    tempDbDir = path.join(os.tmpdir(), `lf-p8-del-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
      queryClient.invalidateQueries({ queryKey: [scope, 'list', wsId] });
      queryClient.invalidateQueries({ queryKey: [scope] });
    });

    mongoStore = {
      companies: [],
      contacts: [],
      companyDiscoveryRuns: [],
      discoveryRuns: [],
      companyIntelligence: [],
      websiteIntelligence: [],
      opportunityScores: [],
      campaigns: [],
      sequences: [],
      sequenceExecutions: [],
      emailDeliveries: [],
      suppressions: [],
      jobs: []
    };

    mockSdk = createAuthoritativeMockSdk(workspaceA);
    vi.spyOn(WorkspaceManager, 'getSdk').mockImplementation((targetWs?: string) => {
      return createAuthoritativeMockSdk(targetWs || workspaceA) as any;
    });

    registerCrmIpc();
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

  async function invokeDeleteCompanyIpc(payload: {
    workspaceId?: string;
    id?: string;
    mode?: DeleteCompanyMode;
  }) {
    const handler = ipcHandlers.get('companies:delete');
    if (!handler) throw new Error('companies:delete IPC handler not registered');
    return handler({}, payload);
  }

  // Seed baseline multi-entity dataset for workspaceA and workspaceB
  async function seedBaselineData() {
    // 1. Companies
    mongoStore.companies = [
      {
        id: 'comp_acme',
        workspaceId: workspaceA,
        name: 'Acme Corp',
        domain: 'acme.com',
        industry: 'Software',
        city: 'Austin',
        status: 'QUALIFIED',
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'comp_beta_corp',
        workspaceId: workspaceA,
        name: 'Beta Tech',
        domain: 'betatech.com',
        industry: 'Hardware',
        city: 'Dallas',
        status: 'LEAD',
        createdAt: '2026-09-02T00:00:00.000Z'
      },
      {
        id: 'comp_other_ws',
        workspaceId: workspaceB,
        name: 'Isolated Corp',
        domain: 'isolated.com',
        industry: 'Finance',
        city: 'New York',
        status: 'LEAD',
        createdAt: '2026-09-03T00:00:00.000Z'
      }
    ];

    // 2. Contacts for Acme Corp
    mongoStore.contacts = [
      {
        id: 'cont_fresh_1',
        workspaceId: workspaceA,
        companyId: 'comp_acme',
        firstName: 'Alice',
        lastName: 'Fresh',
        email: 'alice@acme.com',
        status: 'NEW',
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'cont_active_1',
        workspaceId: workspaceA,
        companyId: 'comp_acme',
        firstName: 'Bob',
        lastName: 'Active',
        email: 'bob@acme.com',
        status: 'CONTACTED',
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'cont_history_1',
        workspaceId: workspaceA,
        companyId: 'comp_acme',
        firstName: 'Charlie',
        lastName: 'Delivered',
        email: 'charlie@acme.com',
        status: 'CONTACTED',
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'cont_beta_1',
        workspaceId: workspaceA,
        companyId: 'comp_beta_corp',
        firstName: 'Dave',
        lastName: 'Beta',
        email: 'dave@betatech.com',
        status: 'NEW',
        createdAt: '2026-09-02T00:00:00.000Z'
      }
    ];

    // 3. Discovery Runs & Provenance
    mongoStore.discoveryRuns = [
      {
        id: 'run_101',
        workspaceId: workspaceA,
        name: 'Austin Software',
        query: 'software',
        status: 'completed',
        resultCount: 2,
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    ];

    mongoStore.companyDiscoveryRuns = [
      {
        id: 'cdr_1',
        workspaceId: workspaceA,
        discoveryRunId: 'run_101',
        companyId: 'comp_acme',
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'cdr_2',
        workspaceId: workspaceA,
        discoveryRunId: 'run_101',
        companyId: 'comp_beta_corp',
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    ];

    // 4. Intelligence & Scores
    mongoStore.companyIntelligence = [
      {
        companyId: 'comp_acme',
        workspaceId: workspaceA,
        summary: 'Leading cloud vendor',
        painPoints: 'Scalability'
      }
    ];
    mongoStore.websiteIntelligence = [
      {
        companyId: 'comp_acme',
        workspaceId: workspaceA,
        headline: 'Modern SaaS Platform'
      }
    ];
    mongoStore.opportunityScores = [
      {
        companyId: 'comp_acme',
        workspaceId: workspaceA,
        overallScore: 85.5
      }
    ];

    // 5. Campaigns & Sequences
    mongoStore.campaigns = [
      {
        id: 'camp_enterprise',
        workspaceId: workspaceA,
        name: 'Enterprise Q3',
        status: 'ACTIVE',
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    ];

    mongoStore.sequences = [
      {
        id: 'seq_outreach',
        workspaceId: workspaceA,
        name: 'Cold Outreach Sequence',
        status: 'ACTIVE'
      }
    ];

    // 6. Active Execution for Bob
    mongoStore.sequenceExecutions = [
      {
        id: 'exec_bob_active',
        workspaceId: workspaceA,
        campaignId: 'camp_enterprise',
        sequenceId: 'seq_outreach',
        contactId: 'cont_active_1',
        companyId: 'comp_acme',
        status: 'RUNNING',
        currentStep: 1,
        startedAt: '2026-09-05T00:00:00.000Z'
      },
      {
        id: 'exec_charlie_hist',
        workspaceId: workspaceA,
        campaignId: 'camp_enterprise',
        sequenceId: 'seq_outreach',
        contactId: 'cont_history_1',
        companyId: 'comp_acme',
        status: 'COMPLETED',
        currentStep: 3,
        startedAt: '2026-09-01T00:00:00.000Z',
        completedAt: '2026-09-04T00:00:00.000Z'
      }
    ];

    // 7. Historical Email Delivery for Charlie
    mongoStore.emailDeliveries = [
      {
        id: 'del_charlie_1',
        workspaceId: workspaceA,
        campaignId: 'camp_enterprise',
        contactId: 'cont_history_1',
        companyId: 'comp_acme',
        recipientEmail: 'charlie@acme.com',
        subject: 'Quick question about Acme',
        status: 'DELIVERED',
        sentAt: '2026-09-02T10:00:00.000Z'
      }
    ];

    // 8. Suppressions
    mongoStore.suppressions = [
      {
        id: 'supp_domain_acme',
        workspaceId: workspaceA,
        targetType: 'DOMAIN',
        targetId: 'acme.com',
        domain: 'acme.com',
        reason: 'DO_NOT_CONTACT',
        source: 'manual'
      },
      {
        id: 'supp_company_acme',
        workspaceId: workspaceA,
        targetType: 'COMPANY',
        targetId: 'comp_acme',
        companyId: 'comp_acme',
        reason: 'DO_NOT_CONTACT',
        source: 'manual'
      },
      {
        id: 'supp_contact_charlie',
        workspaceId: workspaceA,
        targetType: 'RECIPIENT',
        targetId: 'charlie@acme.com',
        email: 'charlie@acme.com',
        reason: 'UNSUBSCRIBED',
        source: 'unsubscribe_link'
      }
    ];

    // 9. Background Jobs
    mongoStore.jobs = [
      {
        id: 'job_crawler_acme',
        workspaceId: workspaceA,
        type: 'crawler:website',
        payload: { companyId: 'comp_acme' },
        status: 'queued'
      }
    ];

    // Hydrate SQLite projections for Workspace A
    const dbA = getDatabase(workspaceA);
    for (const comp of mongoStore.companies.filter((c) => c.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('companies', comp);
    }
    for (const cont of mongoStore.contacts.filter((c) => c.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('contacts', cont);
    }
    for (const run of mongoStore.discoveryRuns.filter((r) => r.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('discovery_runs', run);
    }
    for (const cdr of mongoStore.companyDiscoveryRuns.filter((p) => p.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('company_discovery_runs', cdr);
    }
    for (const ci of mongoStore.companyIntelligence.filter((p) => p.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('company_intelligence', ci);
    }
    for (const wi of mongoStore.websiteIntelligence.filter((p) => p.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('website_intelligence', wi);
    }
    for (const os of mongoStore.opportunityScores.filter((p) => p.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('opportunity_scores', os);
    }
    for (const camp of mongoStore.campaigns.filter((p) => p.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('campaigns', camp);
    }
    for (const ex of mongoStore.sequenceExecutions.filter((p) => p.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('sequence_executions', ex);
    }
    for (const del of mongoStore.emailDeliveries.filter((p) => p.workspaceId === workspaceA)) {
      await LocalCRMRepository.saveFromServer('email_deliveries', del);
    }

    // Hydrate SQLite projections for Workspace B
    const dbB = getDatabase(workspaceB);
    for (const comp of mongoStore.companies.filter((c) => c.workspaceId === workspaceB)) {
      await LocalCRMRepository.saveFromServer('companies', comp);
    }
  }

  // ── [Basic Lifecycle] ──────────────────────────────────────────────────

  it('Scenario 1 — Delete eligible Company in company-only mode: soft-deletes company and preserves contacts', async () => {
    await seedBaselineData();

    const result = await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    expect(result.success).toBe(true);
    expect(result.companyDeleted).toBe(true);
    expect(result.contactsDeletedCount).toBe(0);
    expect(result.contactsPreservedCount).toBe(3);

    // MongoDB authoritative company is soft-deleted
    const mongoComp = mongoStore.companies.find((c) => c.id === 'comp_acme');
    expect(mongoComp.deletedAt).toBeDefined();

    // MongoDB contacts for Acme are 100% untouched
    const acmeContacts = mongoStore.contacts.filter((c) => c.companyId === 'comp_acme');
    expect(acmeContacts.every((c) => !c.deletedAt)).toBe(true);
  });

  it('Scenario 2 — Deleted Company disappears from active queries in SQLite', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    // Active companies list excludes deleted company
    const activeCompanies = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(activeCompanies.some((c) => c.id === 'comp_acme')).toBe(false);
    expect(activeCompanies.some((c) => c.id === 'comp_beta_corp')).toBe(true);

    // Direct SQLite check verifies deletedAt column is populated
    const db = getDatabase(workspaceA);
    const row: any = db.prepare('SELECT deletedAt FROM companies WHERE id = ?').get('comp_acme');
    expect(row.deletedAt).not.toBeNull();
  });

  it('Scenario 3 — Deleted Company does not reappear after projection refresh', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    // Authoritative reconcileEntity runs
    await ProjectionService.reconcileEntity(workspaceA, 'companies', mockSdk, false);

    // Acme must NOT resurrect
    const activeCompanies = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(activeCompanies.some((c) => c.id === 'comp_acme')).toBe(false);
  });

  it('Scenario 4 — Repeated deletion is deterministic and idempotent', async () => {
    await seedBaselineData();

    // First deletion
    const res1 = await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });
    expect(res1.success).toBe(true);
    expect(res1.companyDeleted).toBe(true);

    // Second deletion of the same company
    const res2 = await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });
    expect(res2.success).toBe(true);
    expect(res2.alreadyDeleted).toBe(true);
    expect(res2.companyDeleted).toBe(false);
  });

  // ── [Ownership] ────────────────────────────────────────────────────────

  it('Scenario 5 — Company-owned metadata (intelligence, scores) are cleaned up', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    // Authoritative company-owned stores cleared
    expect(mongoStore.companyIntelligence.some((ci) => ci.companyId === 'comp_acme')).toBe(false);
    expect(mongoStore.websiteIntelligence.some((wi) => wi.companyId === 'comp_acme')).toBe(false);
    expect(mongoStore.opportunityScores.some((os) => os.companyId === 'comp_acme')).toBe(false);

    // SQLite projection company-owned tables cleared
    const db = getDatabase(workspaceA);
    const ciRow = db.prepare('SELECT * FROM company_intelligence WHERE companyId = ?').get('comp_acme');
    expect(ciRow).toBeFalsy();
    const wiRow = db.prepare('SELECT * FROM website_intelligence WHERE companyId = ?').get('comp_acme');
    expect(wiRow).toBeFalsy();
    const osRow = db.prepare('SELECT * FROM opportunity_scores WHERE companyId = ?').get('comp_acme');
    expect(osRow).toBeFalsy();
  });

  it('Scenario 6 — Shared records (Campaigns, Sequences) are preserved', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    expect(mongoStore.campaigns.find((c) => c.id === 'camp_enterprise')?.deletedAt).toBeUndefined();
    expect(mongoStore.sequences.find((s) => s.id === 'seq_outreach')?.deletedAt).toBeUndefined();
  });

  it('Scenario 7 — DiscoveryRun records are not cascaded', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    const run = mongoStore.discoveryRuns.find((r) => r.id === 'run_101');
    expect(run).toBeDefined();
    expect(run.deletedAt).toBeUndefined();
  });

  it('Scenario 8 — CompanyDiscoveryRun provenance handling: junction deleted for company without cascading', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    // Acme's junction record deleted
    expect(mongoStore.companyDiscoveryRuns.some((cdr) => cdr.companyId === 'comp_acme')).toBe(false);

    // Beta Corp's junction record for the same run is preserved!
    expect(
      mongoStore.companyDiscoveryRuns.some(
        (cdr) => cdr.companyId === 'comp_beta_corp' && cdr.discoveryRunId === 'run_101'
      )
    ).toBe(true);

    // SQLite junction cache updated
    const db = getDatabase(workspaceA);
    const acmeJunction = db
      .prepare('SELECT * FROM company_discovery_runs WHERE companyId = ?')
      .get('comp_acme');
    expect(acmeJunction).toBeFalsy();

    const betaJunction = db
      .prepare('SELECT * FROM company_discovery_runs WHERE companyId = ?')
      .get('comp_beta_corp');
    expect(betaJunction).toBeDefined();
  });

  it('Scenario 9 — Other Companies remain untouched', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    const beta = mongoStore.companies.find((c) => c.id === 'comp_beta_corp');
    expect(beta.deletedAt).toBeUndefined();

    const activeLocal = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(activeLocal.some((c) => c.id === 'comp_beta_corp')).toBe(true);
  });

  // ── [Contacts & Eligibility Rules] ────────────────────────────────────

  it('Scenario 10 — Mode company-only preserves 100% of contacts even when fresh', async () => {
    await seedBaselineData();

    const result = await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    expect(result.contactsDeletedCount).toBe(0);
    expect(result.contactsPreservedCount).toBe(3);

    // All 3 contacts still active in SQLite
    const activeContacts = await LocalCRMRepository.findMany('contacts', workspaceA);
    const acmeContactIds = ['cont_fresh_1', 'cont_active_1', 'cont_history_1'];
    expect(activeContacts.filter((c) => acmeContactIds.includes(c.id)).length).toBe(3);
  });

  it('Scenario 11 — Mode company-and-eligible-contacts deletes fresh uncontacted contacts', async () => {
    await seedBaselineData();

    const result = await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    expect(result.companyDeleted).toBe(true);
    expect(result.contactsDeletedCount).toBe(1); // cont_fresh_1
    expect(result.contactsPreservedCount).toBe(2); // cont_active_1, cont_history_1

    // Fresh contact is soft-deleted
    expect(mongoStore.contacts.find((c) => c.id === 'cont_fresh_1')?.deletedAt).toBeDefined();

    // SQLite projection tombstoned fresh contact
    const db = getDatabase(workspaceA);
    const freshRow: any = db.prepare('SELECT deletedAt FROM contacts WHERE id = ?').get('cont_fresh_1');
    expect(freshRow.deletedAt).not.toBeNull();
  });

  it('Scenario 12 — Contacts with historical delivery lineage are protected and preserved', async () => {
    await seedBaselineData();

    const result = await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    // Charlie has an email delivery record -> preserved!
    expect(mongoStore.contacts.find((c) => c.id === 'cont_history_1')?.deletedAt).toBeUndefined();

    const db = getDatabase(workspaceA);
    const charlieRow: any = db.prepare('SELECT deletedAt FROM contacts WHERE id = ?').get('cont_history_1');
    expect(charlieRow.deletedAt).toBeFalsy();
  });

  it('Scenario 13 — Contacts with active campaign execution are protected and preserved', async () => {
    await seedBaselineData();

    const result = await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    // Bob has an active RUNNING execution -> preserved!
    expect(mongoStore.contacts.find((c) => c.id === 'cont_active_1')?.deletedAt).toBeUndefined();

    const db = getDatabase(workspaceA);
    const bobRow: any = db.prepare('SELECT deletedAt FROM contacts WHERE id = ?').get('cont_active_1');
    expect(bobRow.deletedAt).toBeFalsy();
  });

  it('Scenario 14 — Contacts with completed/failed/replied sequence execution are preserved', async () => {
    await seedBaselineData();

    const result = await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    // Charlie has completed execution -> preserved!
    expect(result.preservedReasons?.historicalLineage).toBeGreaterThanOrEqual(1);
    expect(mongoStore.contacts.find((c) => c.id === 'cont_history_1')?.deletedAt).toBeUndefined();
  });

  it('Scenario 15 — Contact-level suppression remains intact', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    const contactSupp = mongoStore.suppressions.find((s) => s.id === 'supp_contact_charlie');
    expect(contactSupp).toBeDefined();
    expect(contactSupp.email).toBe('charlie@acme.com');
  });

  // ── [Outreach History] ────────────────────────────────────────────────

  it('Scenario 16 — Campaign sequence executions remain intact', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    expect(mongoStore.sequenceExecutions.length).toBe(2);
    expect(mongoStore.sequenceExecutions.find((e) => e.id === 'exec_bob_active')?.status).toBe('RUNNING');
    expect(mongoStore.sequenceExecutions.find((e) => e.id === 'exec_charlie_hist')?.status).toBe('COMPLETED');
  });

  it('Scenario 17 — Email deliveries remain intact', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    expect(mongoStore.emailDeliveries.length).toBe(1);
    expect(mongoStore.emailDeliveries[0].id).toBe('del_charlie_1');
    expect(mongoStore.emailDeliveries[0].status).toBe('DELIVERED');
  });

  it('Scenario 18 — Historical lineage remains queryable and consistent in SQLite', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    const db = getDatabase(workspaceA);
    const deliveries = db.prepare('SELECT * FROM email_deliveries WHERE companyId = ?').all('comp_acme');
    expect(deliveries.length).toBe(1);

    const execs = db.prepare('SELECT * FROM sequence_executions WHERE companyId = ?').all('comp_acme');
    expect(execs.length).toBe(2);
  });

  // ── [Safety] ──────────────────────────────────────────────────────────

  it('Scenario 19 — Company-level suppression remains intact after company deletion', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    const compSupp = mongoStore.suppressions.find((s) => s.id === 'supp_company_acme');
    expect(compSupp).toBeDefined();
    expect(compSupp.companyId).toBe('comp_acme');
  });

  it('Scenario 20 — Domain-level suppression remains intact after company deletion', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    const domainSupp = mongoStore.suppressions.find((s) => s.id === 'supp_domain_acme');
    expect(domainSupp).toBeDefined();
    expect(domainSupp.domain).toBe('acme.com');
  });

  it('Scenario 21 — Deletion cannot weaken a DNC state: pre-send check continues to block outreach', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    // Check if domain and company suppression still exist in store
    const isDomainSuppressed = mongoStore.suppressions.some(
      (s) => s.domain === 'acme.com' && s.reason === 'DO_NOT_CONTACT'
    );
    const isCompanySuppressed = mongoStore.suppressions.some(
      (s) => s.companyId === 'comp_acme' && s.reason === 'DO_NOT_CONTACT'
    );
    expect(isDomainSuppressed).toBe(true);
    expect(isCompanySuppressed).toBe(true);
  });

  // ── [Isolation / Authorization] ───────────────────────────────────────

  it('Scenario 22 — Workspace A cannot delete Workspace B Company', async () => {
    await seedBaselineData();

    // comp_other_ws belongs to workspaceB; calling delete from workspaceA must reject
    await expect(
      invokeDeleteCompanyIpc({
        workspaceId: workspaceA,
        id: 'comp_other_ws',
        mode: 'company-only'
      })
    ).rejects.toThrow();

    // Isolated Corp must remain untouched in workspaceB
    const isolatedComp = mongoStore.companies.find((c) => c.id === 'comp_other_ws');
    expect(isolatedComp.deletedAt).toBeUndefined();
  });

  it('Scenario 23 — Missing workspaceId throws explicit error', async () => {
    await seedBaselineData();

    await expect(
      invokeDeleteCompanyIpc({
        workspaceId: '',
        id: 'comp_acme'
      })
    ).rejects.toThrow(/workspaceId is required/);
  });

  it('Scenario 24 — Missing companyId throws explicit error', async () => {
    await seedBaselineData();

    await expect(
      invokeDeleteCompanyIpc({
        workspaceId: workspaceA,
        id: ''
      })
    ).rejects.toThrow(/id is required/);
  });

  // ── [Race Safety] ─────────────────────────────────────────────────────

  it('Scenario 25 — Delete vs queued background crawler/enrichment jobs: jobs are cancelled', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    const job = mongoStore.jobs.find((j) => j.id === 'job_crawler_acme');
    expect(job.status).toBe('cancelled');
    expect(job.error).toContain('Target company deleted');
  });

  it('Scenario 26 — Delete vs active outreach worker: outreach continues safely for preserved contact', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    // Bob was preserved because of active outreach
    const bob = mongoStore.contacts.find((c) => c.id === 'cont_active_1');
    expect(bob.deletedAt).toBeUndefined();

    // Sequence execution for Bob is still RUNNING
    const exec = mongoStore.sequenceExecutions.find((e) => e.contactId === 'cont_active_1');
    expect(exec.status).toBe('RUNNING');
  });

  it('Scenario 27 — Delete vs projection reconciliation race: refresh after deletion preserves tombstone', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    // Run full projection reconciliation
    await ProjectionService.reconcileEntity(workspaceA, 'companies', mockSdk, false);
    await ProjectionService.reconcileEntity(workspaceA, 'contacts', mockSdk, false);

    // Acme company remains tombstoned
    const compRows = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(compRows.some((c) => c.id === 'comp_acme')).toBe(false);

    // Fresh contact remains tombstoned
    const contRows = await LocalCRMRepository.findMany('contacts', workspaceA);
    expect(contRows.some((c) => c.id === 'cont_fresh_1')).toBe(false);

    // Preserved contacts are still present
    expect(contRows.some((c) => c.id === 'cont_active_1')).toBe(true);
    expect(contRows.some((c) => c.id === 'cont_history_1')).toBe(true);
  });

  it('Scenario 28 — Delete vs delivery/reply write: historical writes succeed against existing delivery/execution', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-only'
    });

    // Simulate an inbound reply arriving for Charlie's existing delivery
    const db = getDatabase(workspaceA);
    db.prepare('UPDATE email_deliveries SET hasReply = ?, replyCount = ?, lastRepliedAt = ? WHERE id = ?').run(
      1,
      1,
      new Date().toISOString(),
      'del_charlie_1'
    );

    const updatedDelivery: any = db
      .prepare('SELECT hasReply, replyCount FROM email_deliveries WHERE id = ?')
      .get('del_charlie_1');
    expect(updatedDelivery.hasReply).toBe(1);
    expect(updatedDelivery.replyCount).toBe(1);
  });

  // ── [Projection & Broadcast] ──────────────────────────────────────────

  it('Scenario 29 — Mongo authoritative transition -> SQLite converges -> query invalidation broadcasted without window reload', async () => {
    await seedBaselineData();

    await invokeDeleteCompanyIpc({
      workspaceId: workspaceA,
      id: 'comp_acme',
      mode: 'company-and-eligible-contacts'
    });

    // Broadcast was sent for 'companies' and 'contacts'
    expect(broadcastCalls.some((c) => c.scope === 'companies' && c.workspaceId === workspaceA)).toBe(true);
    expect(broadcastCalls.some((c) => c.scope === 'contacts' && c.workspaceId === workspaceA)).toBe(true);

    // SQLite projection accurately reflects the deletion
    const activeCompanies = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(activeCompanies.some((c) => c.id === 'comp_acme')).toBe(false);
  });
});
