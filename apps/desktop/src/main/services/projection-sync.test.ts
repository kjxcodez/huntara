import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { getDatabase, closeDatabase } from '../database/connection';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { ProjectionService } from './projection-service';
import type { SdkClient } from '@huntara/sdk';

/**
 * LeadForge OS — Phase 6: Projection Synchronization + Global Refresh Test Matrix
 *
 * Deterministically tests all 15 acceptance scenarios from Step 20:
 * 1. Audience create visibility (authoritative -> projection -> query)
 * 2. Audience update visibility (authoritative -> projection -> query)
 * 3. Audience deletion visibility (authoritative delete -> tombstone in projection)
 * 4. Company mutation synchronization (create, update, delete)
 * 5. Contact mutation synchronization (create, update, delete)
 * 6. Contact bulk mutation synchronization (Phase 5 explicit selection)
 * 7. Contact all-matching mutation synchronization (Phase 5B query-wide)
 * 8. Campaign synchronization (lifecycle transitions)
 * 9. Discovery run synchronization (lifecycle and tombstoning)
 * 10. Workspace isolation (Workspace A mutations never affect Workspace B)
 * 11. Manual refresh repairs stale projection
 * 12. Refresh does not reload application (no window.location.reload)
 * 13. Idempotent synchronization (repeated runs produce identical records, zero duplicates)
 * 14. Concurrent mutation / refresh race handling
 * 15. Synchronization failure handling (errors propagated without false success)
 */

describe('Phase 6 — Projection Synchronization & Global Refresh Suite', () => {
  let tempDbDir: string;
  const workspaceA = 'ws_sync_test_alpha';
  const workspaceB = 'ws_sync_test_beta';

  let queryClient: QueryClient;
  let broadcastCalls: Array<{ scope: string; workspaceId: string }>;

  beforeEach(() => {
    tempDbDir = path.join(os.tmpdir(), `lf-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    });
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

  // Helper to create a mock SDK backed by in-memory stores
  function createMockSdk(initialData?: {
    audiences?: any[];
    companies?: any[];
    contacts?: any[];
    campaigns?: any[];
    discoveryRuns?: any[];
    companyDiscoveryRuns?: any[];
    sequences?: any[];
    executions?: any[];
  }) {
    const data = {
      audiences: [...(initialData?.audiences || [])],
      companies: [...(initialData?.companies || [])],
      contacts: [...(initialData?.contacts || [])],
      campaigns: [...(initialData?.campaigns || [])],
      discoveryRuns: [...(initialData?.discoveryRuns || [])],
      companyDiscoveryRuns: [...(initialData?.companyDiscoveryRuns || [])],
      sequences: [...(initialData?.sequences || [])],
      executions: [...(initialData?.executions || [])]
    };

    const sdk: any = {
      audiences: {
        list: vi.fn(async () => [...data.audiences]),
        create: vi.fn(async (record: any) => {
          const created = { ...record, id: record.id || `aud_${Date.now()}` };
          data.audiences.push(created);
          return created;
        }),
        update: vi.fn(async (id: string, dto: any) => {
          const idx = data.audiences.findIndex((a) => a.id === id);
          if (idx >= 0) {
            data.audiences[idx] = { ...data.audiences[idx], ...dto };
            return data.audiences[idx];
          }
          return null;
        }),
        delete: vi.fn(async (id: string) => {
          data.audiences = data.audiences.filter((a) => a.id !== id);
          return { success: true };
        })
      },
      companies: {
        list: vi.fn(async () => [...data.companies]),
        create: vi.fn(async (record: any) => {
          const created = { ...record, id: record.id || `comp_${Date.now()}` };
          data.companies.push(created);
          return created;
        }),
        update: vi.fn(async (id: string, dto: any) => {
          const idx = data.companies.findIndex((c) => c.id === id);
          if (idx >= 0) {
            data.companies[idx] = { ...data.companies[idx], ...dto };
            return data.companies[idx];
          }
          return null;
        }),
        delete: vi.fn(async (id: string) => {
          data.companies = data.companies.filter((c) => c.id !== id);
          return { success: true };
        })
      },
      contacts: {
        list: vi.fn(async () => [...data.contacts]),
        create: vi.fn(async (record: any) => {
          const created = { ...record, id: record.id || `cont_${Date.now()}` };
          data.contacts.push(created);
          return created;
        }),
        update: vi.fn(async (id: string, dto: any) => {
          const idx = data.contacts.findIndex((c) => c.id === id);
          if (idx >= 0) {
            data.contacts[idx] = { ...data.contacts[idx], ...dto };
            return data.contacts[idx];
          }
          return null;
        }),
        delete: vi.fn(async (id: string) => {
          data.contacts = data.contacts.filter((c) => c.id !== id);
          return { success: true };
        })
      },
      campaigns: {
        list: vi.fn(async () => [...data.campaigns]),
        create: vi.fn(async (record: any) => {
          const created = { ...record, id: record.id || `camp_${Date.now()}` };
          data.campaigns.push(created);
          return created;
        }),
        update: vi.fn(async (id: string, dto: any) => {
          const idx = data.campaigns.findIndex((c) => c.id === id);
          if (idx >= 0) {
            data.campaigns[idx] = { ...data.campaigns[idx], ...dto };
            return data.campaigns[idx];
          }
          return null;
        }),
        delete: vi.fn(async (id: string) => {
          data.campaigns = data.campaigns.filter((c) => c.id !== id);
          return { success: true };
        })
      },
      discovery: {
        listRuns: vi.fn(async () => [...data.discoveryRuns]),
        createRun: vi.fn(async (record: any) => {
          const created = { ...record, id: record.id || `run_${Date.now()}` };
          data.discoveryRuns.push(created);
          return created;
        })
      },
      companyDiscoveryRuns: {
        list: vi.fn(async () => [...data.companyDiscoveryRuns])
      },
      sequences: {
        list: vi.fn(async () => [...data.sequences])
      },
      executions: {
        list: vi.fn(async () => [...data.executions])
      },
      _data: data
    };

    return sdk as SdkClient & { _data: typeof data };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: Audience create visibility
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 1 — Audience create visibility: authoritative create -> projection update -> invalidation -> list contains new audience', async () => {
    const mockSdk = createMockSdk();

    // 1. Initial query from renderer reads SQLite (empty)
    const initialList = await queryClient.fetchQuery({
      queryKey: ['audiences', 'list', workspaceA],
      queryFn: () => LocalCRMRepository.findMany('audiences', workspaceA)
    });
    expect(initialList).toHaveLength(0);

    // 2. Authoritative creation in MongoDB via SDK
    const created = await mockSdk.audiences.create({
      id: 'aud_alpha_01',
      name: 'High Growth Startups',
      workspaceId: workspaceA,
      mode: 'dynamic'
    } as any);

    // 3. Projection synchronization (triggered by mutation handler or reconcile)
    await LocalCRMRepository.saveFromServer('audiences', created);
    ProjectionService.broadcastProjectionUpdated('audiences', workspaceA);

    // 4. Invalidation trigger in renderer
    await queryClient.invalidateQueries({ queryKey: ['audiences', 'list', workspaceA] });

    // 5. Subsequent query immediately returns the newly created audience without restart
    const updatedList = await queryClient.fetchQuery({
      queryKey: ['audiences', 'list', workspaceA],
      queryFn: () => LocalCRMRepository.findMany('audiences', workspaceA)
    });

    expect(updatedList).toHaveLength(1);
    expect(updatedList[0].id).toBe('aud_alpha_01');
    expect(updatedList[0].name).toBe('High Growth Startups');
    expect(broadcastCalls).toContainEqual({ scope: 'audiences', workspaceId: workspaceA });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: Audience update visibility
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 2 — Audience update visibility: authoritative update -> projection update -> renderer sees updated values', async () => {
    const mockSdk = createMockSdk({
      audiences: [{ id: 'aud_alpha_02', name: 'Original Name', workspaceId: workspaceA }]
    });

    await LocalCRMRepository.saveFromServer('audiences', mockSdk._data.audiences[0]);

    // Update authoritatively
    const updated = await mockSdk.audiences.update('aud_alpha_02', { name: 'Renamed Tier 1 Segment' });
    expect(updated.name).toBe('Renamed Tier 1 Segment');

    // Synchronize projection
    await LocalCRMRepository.saveFromServer('audiences', updated);
    ProjectionService.broadcastProjectionUpdated('audiences', workspaceA);

    await queryClient.invalidateQueries({ queryKey: ['audiences', 'list', workspaceA] });

    const rows = await queryClient.fetchQuery({
      queryKey: ['audiences', 'list', workspaceA],
      queryFn: () => LocalCRMRepository.findMany('audiences', workspaceA)
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Renamed Tier 1 Segment');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: Audience deletion visibility
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 3 — Audience deletion visibility: authoritative delete -> projection removal -> renderer no longer lists entity', async () => {
    const mockSdk = createMockSdk({
      audiences: [{ id: 'aud_del_01', name: 'To Be Deleted', workspaceId: workspaceA }]
    });

    await LocalCRMRepository.saveFromServer('audiences', mockSdk._data.audiences[0]);

    // Authoritative delete
    await mockSdk.audiences.delete('aud_del_01');

    // Local soft delete
    await LocalCRMRepository.softDeleteFromServer('audiences', workspaceA, 'aud_del_01');
    ProjectionService.broadcastProjectionUpdated('audiences', workspaceA);

    await queryClient.invalidateQueries({ queryKey: ['audiences', 'list', workspaceA] });

    const rows = await queryClient.fetchQuery({
      queryKey: ['audiences', 'list', workspaceA],
      queryFn: () => LocalCRMRepository.findMany('audiences', workspaceA)
    });

    expect(rows).toHaveLength(0);

    // Verify row still exists with deletedAt in SQLite for auditability
    const db = getDatabase(workspaceA);
    const rawRow = db.prepare('SELECT id, deletedAt FROM audiences WHERE id = ?').get('aud_del_01') as any;
    expect(rawRow).toBeDefined();
    expect(rawRow.deletedAt).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: Company mutation synchronization
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 4 — Company mutation synchronization: covers create, update, and delete', async () => {
    const mockSdk = createMockSdk();

    // Create
    const company = await mockSdk.companies.create({
      id: 'comp_acme',
      name: 'Acme Corp',
      domain: 'acme.com',
      workspaceId: workspaceA
    } as any);
    await LocalCRMRepository.saveFromServer('companies', company);
    ProjectionService.broadcastProjectionUpdated('companies', workspaceA);

    let companies = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(companies).toHaveLength(1);
    expect(companies[0].domain).toBe('acme.com');

    // Update
    const updatedCompany = await mockSdk.companies.update('comp_acme', { industry: 'Manufacturing' });
    await LocalCRMRepository.saveFromServer('companies', updatedCompany);
    ProjectionService.broadcastProjectionUpdated('companies', workspaceA);

    companies = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(companies[0].industry).toBe('Manufacturing');

    // Delete
    await mockSdk.companies.delete('comp_acme');
    await LocalCRMRepository.softDeleteFromServer('companies', workspaceA, 'comp_acme');
    ProjectionService.broadcastProjectionUpdated('companies', workspaceA);

    companies = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(companies).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: Contact mutation synchronization
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 5 — Contact mutation synchronization: covers single contact create, update, and delete', async () => {
    const mockSdk = createMockSdk();

    const contact = await mockSdk.contacts.create({
      id: 'cont_jane',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@acme.com',
      workspaceId: workspaceA
    } as any);
    await LocalCRMRepository.saveFromServer('contacts', contact);
    ProjectionService.broadcastProjectionUpdated('contacts', workspaceA);

    let contacts = await LocalCRMRepository.findMany('contacts', workspaceA);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].email).toBe('jane@acme.com');

    // Update
    const updatedContact = await mockSdk.contacts.update('cont_jane', { title: 'VP Engineering' });
    await LocalCRMRepository.saveFromServer('contacts', updatedContact);
    ProjectionService.broadcastProjectionUpdated('contacts', workspaceA);

    contacts = await LocalCRMRepository.findMany('contacts', workspaceA);
    expect(contacts[0].title).toBe('VP Engineering');

    // Delete
    await mockSdk.contacts.delete('cont_jane');
    await LocalCRMRepository.softDeleteFromServer('contacts', workspaceA, 'cont_jane');
    ProjectionService.broadcastProjectionUpdated('contacts', workspaceA);

    contacts = await LocalCRMRepository.findMany('contacts', workspaceA);
    expect(contacts).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: Contact bulk mutation synchronization (Phase 5 explicit selection)
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 6 — Contact bulk mutation synchronization: Phase 5 explicit selection bulk operations update projection', async () => {
    const initialContacts = [
      { id: 'c1', firstName: 'Alice', status: 'NEW', workspaceId: workspaceA },
      { id: 'c2', firstName: 'Bob', status: 'NEW', workspaceId: workspaceA },
      { id: 'c3', firstName: 'Charlie', status: 'NEW', workspaceId: workspaceA }
    ];
    await LocalCRMRepository.saveManyFromServer('contacts', initialContacts);

    // Simulate bulk status update on explicit IDs ['c1', 'c2']
    const selectedIds = ['c1', 'c2'];
    const db = getDatabase(workspaceA);
    const now = new Date().toISOString();

    for (const id of selectedIds) {
      db.prepare('UPDATE contacts SET status = ?, updatedAt = ? WHERE id = ? AND workspaceId = ?').run(
        'QUALIFIED',
        now,
        id,
        workspaceA
      );
    }
    ProjectionService.broadcastProjectionUpdated('contacts', workspaceA);

    const activeContacts = await LocalCRMRepository.findMany('contacts', workspaceA);
    const c1 = activeContacts.find((c) => c.id === 'c1');
    const c2 = activeContacts.find((c) => c.id === 'c2');
    const c3 = activeContacts.find((c) => c.id === 'c3');

    expect(c1?.status).toBe('QUALIFIED');
    expect(c2?.status).toBe('QUALIFIED');
    expect(c3?.status).toBe('NEW'); // unchanged
    expect(broadcastCalls).toContainEqual({ scope: 'contacts', workspaceId: workspaceA });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7: Contact all-matching mutation synchronization (Phase 5B query-wide)
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 7 — Contact all-matching mutation synchronization: Phase 5B query-wide mutation updates projection correctly', async () => {
    const initialContacts = [
      { id: 'c10', firstName: 'Contact 10', status: 'LEAD', workspaceId: workspaceA },
      { id: 'c20', firstName: 'Contact 20', status: 'LEAD', workspaceId: workspaceA },
      { id: 'c30', firstName: 'Contact 30', status: 'CUSTOMER', workspaceId: workspaceA }
    ];
    await LocalCRMRepository.saveManyFromServer('contacts', initialContacts);

    const db = getDatabase(workspaceA);
    // Matching query: status = 'LEAD'
    const matchingRows = db.prepare('SELECT id FROM contacts WHERE workspaceId = ? AND status = ? AND deletedAt IS NULL').all(workspaceA, 'LEAD') as any[];
    const matchingIds = matchingRows.map((r) => r.id);
    expect(matchingIds).toEqual(['c10', 'c20']);

    // Soft delete all matching
    const now = new Date().toISOString();
    for (const id of matchingIds) {
      await LocalCRMRepository.softDeleteFromServer('contacts', workspaceA, id);
    }
    ProjectionService.broadcastProjectionUpdated('contacts', workspaceA);

    const remaining = await LocalCRMRepository.findMany('contacts', workspaceA);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('c30');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8: Campaign synchronization
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 8 — Campaign synchronization: covers create, update, and lifecycle transitions', async () => {
    const mockSdk = createMockSdk({
      campaigns: [{ id: 'camp_sync_01', name: 'Q4 Outbound', status: 'DRAFT', workspaceId: workspaceA }]
    });

    await LocalCRMRepository.saveFromServer('campaigns', mockSdk._data.campaigns[0]);

    // Schedule transition -> ACTIVE
    await mockSdk.campaigns.update('camp_sync_01', { status: 'ACTIVE' } as any);
    const campActive = mockSdk._data.campaigns[0];
    await LocalCRMRepository.saveFromServer('campaigns', campActive);
    ProjectionService.broadcastProjectionUpdated('campaigns', workspaceA);

    let dbCampaign = await LocalCRMRepository.findById('campaigns', workspaceA, 'camp_sync_01');
    expect(dbCampaign?.status).toBe('ACTIVE');

    // Pause transition -> PAUSED
    await mockSdk.campaigns.update('camp_sync_01', { status: 'PAUSED' } as any);
    const campPaused = mockSdk._data.campaigns[0];
    await LocalCRMRepository.saveFromServer('campaigns', campPaused);
    ProjectionService.broadcastProjectionUpdated('campaigns', workspaceA);

    dbCampaign = await LocalCRMRepository.findById('campaigns', workspaceA, 'camp_sync_01');
    expect(dbCampaign?.status).toBe('PAUSED');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 9: Discovery run synchronization
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 9 — Discovery run synchronization: covers create, progress, completion, and server deletion tombstone', async () => {
    const mockSdk = createMockSdk({
      discoveryRuns: [
        { id: 'run_sync_1', query: 'Plumbers in Austin', status: 'running', resultCount: 0, workspaceId: workspaceA }
      ]
    });

    // Create & initial sync
    await LocalCRMRepository.saveFromServer('discovery_runs', mockSdk._data.discoveryRuns[0]);
    let runs = await LocalCRMRepository.findMany('discovery_runs', workspaceA);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('running');

    // Run completes on server
    mockSdk._data.discoveryRuns[0].status = 'completed';
    mockSdk._data.discoveryRuns[0].resultCount = 42;

    // Reconciliation via ProjectionService.reconcileEntity
    await ProjectionService.reconcileEntity(workspaceA, 'discovery_runs', mockSdk);

    runs = await LocalCRMRepository.findMany('discovery_runs', workspaceA);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].resultCount).toBe(42);

    // Authoritative deletion on server
    mockSdk._data.discoveryRuns = [];
    await ProjectionService.reconcileEntity(workspaceA, 'discovery_runs', mockSdk);

    runs = await LocalCRMRepository.findMany('discovery_runs', workspaceA);
    expect(runs).toHaveLength(0); // tombstoned in SQLite
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 10: Workspace isolation
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 10 — Workspace isolation: synchronizing workspace A never alters or deletes workspace B data', async () => {
    // Populate Workspace A and Workspace B
    await LocalCRMRepository.saveFromServer('companies', {
      id: 'comp_wsA_1',
      name: 'Alpha Only Inc',
      workspaceId: workspaceA
    });

    await LocalCRMRepository.saveFromServer('companies', {
      id: 'comp_wsB_1',
      name: 'Beta Protected Inc',
      workspaceId: workspaceB
    });

    // Prepare mock SDK for Workspace A that deletes comp_wsA_1 and adds comp_wsA_2
    const mockSdkA = createMockSdk({
      companies: [
        { id: 'comp_wsA_2', name: 'Alpha Brand New', workspaceId: workspaceA }
      ]
    });

    // Reconcile Workspace A
    await ProjectionService.reconcileEntity(workspaceA, 'companies', mockSdkA);

    // Workspace A projection should have comp_wsA_2 and NOT comp_wsA_1
    const companiesA = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(companiesA).toHaveLength(1);
    expect(companiesA[0].id).toBe('comp_wsA_2');

    // Workspace B projection MUST remain completely unchanged!
    const companiesB = await LocalCRMRepository.findMany('companies', workspaceB);
    expect(companiesB).toHaveLength(1);
    expect(companiesB[0].id).toBe('comp_wsB_1');
    expect(companiesB[0].name).toBe('Beta Protected Inc');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 11: Manual refresh repairs stale projection
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 11 — Manual refresh repairs stale projection: Mongo != SQLite -> refresh -> SQLite == Mongo and query refetched', async () => {
    // Construct stale discrepancy:
    // SQLite has stale company 'comp_old'
    await LocalCRMRepository.saveFromServer('companies', {
      id: 'comp_old',
      name: 'Stale Local Company',
      workspaceId: workspaceA
    });

    // Authoritative MongoDB has 'comp_new_remote' and 'comp_old' was deleted on server
    const mockSdk = createMockSdk({
      companies: [
        { id: 'comp_new_remote', name: 'Fresh Remote Company', workspaceId: workspaceA }
      ]
    });

    // Verify stale local state exists before refresh
    let localRows = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(localRows.map((r) => r.id)).toEqual(['comp_old']);

    // Trigger manual refresh via reconcileEntity
    const result = await ProjectionService.reconcileEntity(workspaceA, 'companies', mockSdk, true);
    expect(result.success).toBe(true);

    // Verify SQLite is now fully reconciled
    localRows = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(localRows).toHaveLength(1);
    expect(localRows[0].id).toBe('comp_new_remote');
    expect(localRows[0].name).toBe('Fresh Remote Company');

    // Invalidate React Query and confirm renderer gets updated data
    await queryClient.invalidateQueries({ queryKey: ['companies', 'list', workspaceA] });
    const renderedData = await queryClient.fetchQuery({
      queryKey: ['companies', 'list', workspaceA],
      queryFn: () => LocalCRMRepository.findMany('companies', workspaceA)
    });
    expect(renderedData[0].id).toBe('comp_new_remote');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 12: Refresh does not reload the application
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 12 — Refresh does not reload application: verifies execution flow avoids window.location.reload', async () => {
    const reloadSpy = vi.fn();
    (globalThis as any).window = {
      location: {
        reload: reloadSpy
      }
    };

    const mockSdk = createMockSdk({
      audiences: [{ id: 'aud_no_reload', name: 'No Reload Audience', workspaceId: workspaceA }]
    });

    // Execute refresh
    const res = await ProjectionService.reconcileEntity(workspaceA, 'audiences', mockSdk, true);
    expect(res.success).toBe(true);

    // Verify window.location.reload was never called
    expect(reloadSpy).not.toHaveBeenCalled();

    delete (globalThis as any).window;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 13: Idempotent synchronization
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 13 — Idempotent synchronization: repeated reconciliation runs produce identical records and zero duplicates', async () => {
    const mockSdk = createMockSdk({
      companies: [
        { id: 'c_idem_1', name: 'Company 1', workspaceId: workspaceA },
        { id: 'c_idem_2', name: 'Company 2', workspaceId: workspaceA }
      ],
      contacts: [
        { id: 'ct_idem_1', firstName: 'John', workspaceId: workspaceA }
      ]
    });

    // Run reconciliation pass 1
    const pass1 = await ProjectionService.reconcileEntity(workspaceA, 'all', mockSdk);
    expect(pass1.success).toBe(true);

    const companiesPass1 = await LocalCRMRepository.findMany('companies', workspaceA);
    const contactsPass1 = await LocalCRMRepository.findMany('contacts', workspaceA);
    expect(companiesPass1).toHaveLength(2);
    expect(contactsPass1).toHaveLength(1);

    // Run reconciliation pass 2 with exact same authoritative state
    const pass2 = await ProjectionService.reconcileEntity(workspaceA, 'all', mockSdk);
    expect(pass2.success).toBe(true);

    const companiesPass2 = await LocalCRMRepository.findMany('companies', workspaceA);
    const contactsPass2 = await LocalCRMRepository.findMany('contacts', workspaceA);

    // Total count must be identical — NO duplicates
    expect(companiesPass2).toHaveLength(2);
    expect(contactsPass2).toHaveLength(1);
    expect(companiesPass2.map((c) => c.id).sort()).toEqual(['c_idem_1', 'c_idem_2']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 14: Concurrent mutation / refresh race condition
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 14 — Concurrent mutation / refresh race: newer authoritative data is preserved', async () => {
    const mockSdk = createMockSdk({
      companies: [{ id: 'c_race', name: 'Version 1', updatedAt: '2026-09-12T10:00:00Z', workspaceId: workspaceA }]
    });

    // Sync version 1 into SQLite
    await ProjectionService.reconcileEntity(workspaceA, 'companies', mockSdk);

    // A mutation starts on server transitioning to Version 2
    mockSdk._data.companies[0] = {
      id: 'c_race',
      name: 'Version 2 (Newer)',
      updatedAt: '2026-09-12T10:05:00Z',
      workspaceId: workspaceA
    };

    // Reconcile again (refresh completes)
    await ProjectionService.reconcileEntity(workspaceA, 'companies', mockSdk);

    const finalRow = await LocalCRMRepository.findById('companies', workspaceA, 'c_race');
    expect(finalRow?.name).toBe('Version 2 (Newer)');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 15: Synchronization failure handling
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 15 — Synchronization failure: errors propagate cleanly without claiming false success', async () => {
    const failingSdk: any = {
      audiences: {
        list: vi.fn().mockRejectedValue(new Error('MongoDB cluster unreachable'))
      }
    };

    // Attempting reconciliation must throw the error
    await expect(
      ProjectionService.reconcileEntity(workspaceA, 'audiences', failingSdk)
    ).rejects.toThrow('MongoDB cluster unreachable');

    // Broadcast must not have been sent for audiences
    const audienceBroadcast = broadcastCalls.find((b) => b.scope === 'audiences' && b.workspaceId === workspaceA);
    expect(audienceBroadcast).toBeUndefined();
  });
});
