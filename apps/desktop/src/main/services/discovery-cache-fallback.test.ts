import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

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
import { ConnectivityService } from './connectivity-service';
import { registerDiscoveryIpc } from '../ipc/discovery-ipc';
import { registerCrmIpc } from '../ipc/crm';
import { resolveMatchingContactIds } from '../ipc/query-resolver';
import type { SdkClient } from '@huntara/sdk';

/**
 * HUNTARA Phase 3: Discovery Run Historical Cache-Miss & Read-Through Fallback Tests
 */
describe('Phase 3 — Discovery Run Historical Cache-Miss Suite', () => {
  let tempDbDir: string;
  const workspaceA = 'ws_p3_alpha';
  const workspaceB = 'ws_p3_beta';

  let mockSdk: any;

  beforeEach(() => {
    tempDbDir = path.join(os.tmpdir(), `huntara-p3-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDbDir, { recursive: true });
    process.env.WORKSPACES_DB_DIR = tempDbDir;

    // Reset connectivity to ONLINE
    ConnectivityService.setState({ status: 'ONLINE', error: null });

    // Setup mock SDK backed by cloud store
    mockSdk = {
      discovery: {
        listRuns: vi.fn(async () => []),
        getRun: vi.fn(async (id: string) => {
          const run = mockSdk._cloudRuns.find((r: any) => r.id === id);
          if (!run) {
            const error: any = new Error(`Resource with id ${id} not found.`);
            error.status = 404;
            throw error;
          }
          return run;
        }),
        listCompaniesForRun: vi.fn(async (id: string, options?: { page?: number; limit?: number }) => {
          const run = mockSdk._cloudRuns.find((r: any) => r.id === id);
          if (!run) {
            const error: any = new Error(`Resource with id ${id} not found.`);
            error.status = 404;
            throw error;
          }
          const links = mockSdk._cloudLinks.filter((l: any) => l.discoveryRunId === id);
          const compIds = links.map((l: any) => l.companyId);
          let comps = mockSdk._cloudCompanies.filter((c: any) => compIds.includes(c.id) && !c.deletedAt);
          if (options?.page && options?.limit) {
            const start = (options.page - 1) * options.limit;
            comps = comps.slice(start, start + options.limit);
          }
          return comps;
        }),
        deleteRun: vi.fn(async () => ({ success: true }))
      },
      companies: {
        list: vi.fn(async () => mockSdk._cloudCompanies)
      },
      contacts: {
        list: vi.fn(async () => mockSdk._cloudContacts)
      },
      companyDiscoveryRuns: {
        list: vi.fn(async () => mockSdk._cloudLinks)
      },
      _cloudRuns: [] as any[],
      _cloudCompanies: [] as any[],
      _cloudLinks: [] as any[],
      _cloudContacts: [] as any[]
    };

    WorkspaceManager.setSdk(mockSdk as unknown as SdkClient);

    // Register IPC channels
    registerDiscoveryIpc();
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

  // ── Helper to invoke IPC handlers ──
  const invokeIpc = (channel: string, payload: any) => {
    const handler = ipcHandlers.get(channel);
    if (!handler) throw new Error(`Handler for ${channel} not registered`);
    return handler({} as any, payload);
  };

  // --------------------------------------------------------------------------
  // SCENARIO 1: Cache Hit (Run & relationships present locally)
  // --------------------------------------------------------------------------
  it('1. Cache Hit — returns local SQLite records without invoking authoritative API fallback', async () => {
    const db = getDatabase(workspaceA);
    const runId = 'run_cached_100';

    // Populate SQLite cache
    db.prepare(`
      INSERT INTO discovery_runs (id, workspaceId, name, query, status, resultCount, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, workspaceA, 'Austin Plumbers', 'plumbers austin', 'completed', 2, new Date().toISOString());

    const insertComp = db.prepare(`
      INSERT INTO companies (id, workspaceId, name, domain, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertComp.run('c_1', workspaceA, 'Apex Plumbing', 'apexplumbing.com', new Date().toISOString());
    insertComp.run('c_2', workspaceA, 'Blue Star Plumbing', 'bluestar.com', new Date().toISOString());

    const insertLink = db.prepare(`
      INSERT INTO company_discovery_runs (id, workspaceId, discoveryRunId, companyId, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertLink.run('link_1', workspaceA, runId, 'c_1', new Date().toISOString());
    insertLink.run('link_2', workspaceA, runId, 'c_2', new Date().toISOString());

    const result = await invokeIpc('discovery:run:companies', {
      workspaceId: workspaceA,
      runId
    });

    expect(result).toHaveLength(2);
    expect(result.map((r: any) => r.id).sort()).toEqual(['c_1', 'c_2']);
    // Verified: No SDK call made on clean cache hit
    expect(mockSdk.discovery.listCompaniesForRun).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // SCENARIO 2: Cache Miss (Valid run missing entirely from SQLite)
  // --------------------------------------------------------------------------
  it('2. Cache Miss — fetches missing run and companies from authoritative API and persists to SQLite', async () => {
    const runId = 'run_remote_200';

    // Seed authoritative cloud data
    mockSdk._cloudRuns.push({
      id: runId,
      workspaceId: workspaceA,
      name: 'Dentists Chicago',
      query: 'dentists chicago',
      status: 'completed',
      resultCount: 2,
      createdAt: '2026-09-20T10:00:00.000Z'
    });
    mockSdk._cloudCompanies.push(
      { id: 'c_remote_1', workspaceId: workspaceA, name: 'Smile Dental', domain: 'smiledental.com' },
      { id: 'c_remote_2', workspaceId: workspaceA, name: 'Loop Teeth', domain: 'loopteeth.com' }
    );
    mockSdk._cloudLinks.push(
      { id: 'l_1', workspaceId: workspaceA, discoveryRunId: runId, companyId: 'c_remote_1' },
      { id: 'l_2', workspaceId: workspaceA, discoveryRunId: runId, companyId: 'c_remote_2' }
    );

    // Call IPC when SQLite cache is empty
    const result = await invokeIpc('discovery:run:companies', {
      workspaceId: workspaceA,
      runId
    });

    // Must return the 2 authoritative companies
    expect(result).toHaveLength(2);
    expect(result.map((c: any) => c.name).sort()).toEqual(['Loop Teeth', 'Smile Dental']);
    expect(mockSdk.discovery.listCompaniesForRun).toHaveBeenCalledWith(runId, expect.anything());

    // Verify persisted into local SQLite projection
    const db = getDatabase(workspaceA);
    const cachedComps = db.prepare('SELECT * FROM companies WHERE workspaceId = ?').all(workspaceA) as any[];
    expect(cachedComps).toHaveLength(2);

    const cachedLinks = db.prepare('SELECT * FROM company_discovery_runs WHERE workspaceId = ? AND discoveryRunId = ?').all(workspaceA, runId) as any[];
    expect(cachedLinks).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // SCENARIO 3: Partial Cache (100 cached locally, 250 in cloud)
  // --------------------------------------------------------------------------
  it('3. Partial Cache — detects incomplete local relationships and reconciles all remote records', async () => {
    const runId = 'run_partial_300';
    const totalCompanies = 250;
    const cachedCount = 100;

    const db = getDatabase(workspaceA);

    // 1. Seed cloud with 250 companies
    for (let i = 1; i <= totalCompanies; i++) {
      const cId = `comp_p_${i}`;
      mockSdk._cloudCompanies.push({
        id: cId,
        workspaceId: workspaceA,
        name: `Company ${i}`,
        domain: `company${i}.com`
      });
      mockSdk._cloudLinks.push({
        id: `link_p_${i}`,
        workspaceId: workspaceA,
        discoveryRunId: runId,
        companyId: cId
      });
    }

    mockSdk._cloudRuns.push({
      id: runId,
      workspaceId: workspaceA,
      name: 'Large Run',
      query: 'large run query',
      status: 'completed',
      resultCount: totalCompanies
    });

    // 2. Pre-seed local cache with only the first 100 companies (partial cache)
    db.prepare(`
      INSERT INTO discovery_runs (id, workspaceId, name, query, status, resultCount, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, workspaceA, 'Large Run', 'large run query', 'completed', totalCompanies, new Date().toISOString());

    for (let i = 1; i <= cachedCount; i++) {
      const cId = `comp_p_${i}`;
      db.prepare(`
        INSERT INTO companies (id, workspaceId, name, domain, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `).run(cId, workspaceA, `Company ${i}`, `company${i}.com`, new Date().toISOString());

      db.prepare(`
        INSERT INTO company_discovery_runs (id, workspaceId, discoveryRunId, companyId, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `).run(`${runId}_${cId}`, workspaceA, runId, cId, new Date().toISOString());
    }

    // Verify SQLite currently only has 100
    const localBefore = db.prepare('SELECT count(*) as count FROM company_discovery_runs WHERE discoveryRunId = ?').get(runId) as any;
    expect(localBefore.count).toBe(100);

    // 3. Request companies for this run
    const result = await invokeIpc('discovery:run:companies', {
      workspaceId: workspaceA,
      runId
    });

    // Must return all 250 companies, having detected that 100 < 250
    expect(result).toHaveLength(totalCompanies);
    expect(mockSdk.discovery.listCompaniesForRun).toHaveBeenCalled();

    // Verify SQLite now has all 250 records
    const localAfter = db.prepare('SELECT count(*) as count FROM company_discovery_runs WHERE discoveryRunId = ?').get(runId) as any;
    expect(localAfter.count).toBe(totalCompanies);
  });

  // --------------------------------------------------------------------------
  // SCENARIO 4: Legitimate Empty Run (0 results by design, no infinite loop)
  // --------------------------------------------------------------------------
  it('4. Legitimate Empty Run — returns empty array and does not repeatedly query API on subsequent access', async () => {
    const runId = 'run_empty_400';

    mockSdk._cloudRuns.push({
      id: runId,
      workspaceId: workspaceA,
      name: 'Niche Query Zero Leads',
      query: 'quantum accountants in smalltown',
      status: 'completed',
      resultCount: 0,
      createdAt: '2026-09-21T08:00:00.000Z'
    });

    // First access: Cache miss / unconfirmed -> queries API once
    const firstResult = await invokeIpc('discovery:run:companies', {
      workspaceId: workspaceA,
      runId
    });
    expect(firstResult).toEqual([]);
    expect(mockSdk.discovery.listCompaniesForRun).toHaveBeenCalledTimes(1);

    // Second access: Confirmed empty -> must use cache, NO additional API call!
    const secondResult = await invokeIpc('discovery:run:companies', {
      workspaceId: workspaceA,
      runId
    });
    expect(secondResult).toEqual([]);
    expect(mockSdk.discovery.listCompaniesForRun).toHaveBeenCalledTimes(1);

    // Third access: Still 1 call
    const thirdResult = await invokeIpc('discovery:run:companies', {
      workspaceId: workspaceA,
      runId
    });
    expect(thirdResult).toEqual([]);
    expect(mockSdk.discovery.listCompaniesForRun).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // SCENARIO 5: Repeated Access Idempotency (Zero duplicate rows)
  // --------------------------------------------------------------------------
  it('5. Repeated Access — opening the same run multiple times produces zero duplicates in SQLite', async () => {
    const runId = 'run_repeat_500';

    mockSdk._cloudRuns.push({
      id: runId,
      workspaceId: workspaceA,
      name: 'HVAC Dallas',
      query: 'hvac dallas',
      status: 'completed',
      resultCount: 2
    });
    mockSdk._cloudCompanies.push(
      { id: 'c_hvac_1', workspaceId: workspaceA, name: 'Dallas Air', domain: 'dallasair.com' },
      { id: 'c_hvac_2', workspaceId: workspaceA, name: 'Lone Star Cool', domain: 'lonestarcool.com' }
    );
    mockSdk._cloudLinks.push(
      { id: 'l_h1', workspaceId: workspaceA, discoveryRunId: runId, companyId: 'c_hvac_1' },
      { id: 'l_h2', workspaceId: workspaceA, discoveryRunId: runId, companyId: 'c_hvac_2' }
    );

    // Access 1
    await invokeIpc('discovery:run:companies', { workspaceId: workspaceA, runId });
    // Access 2 (forceSync to test upsert idempotency)
    await invokeIpc('discovery:run:companies', { workspaceId: workspaceA, runId, forceSync: true });
    // Access 3
    const finalResult = await invokeIpc('discovery:run:companies', { workspaceId: workspaceA, runId });

    expect(finalResult).toHaveLength(2);

    const db = getDatabase(workspaceA);
    const compRows = db.prepare('SELECT * FROM companies WHERE workspaceId = ?').all(workspaceA) as any[];
    expect(compRows).toHaveLength(2);

    const linkRows = db.prepare('SELECT * FROM company_discovery_runs WHERE workspaceId = ? AND discoveryRunId = ?').all(workspaceA, runId) as any[];
    expect(linkRows).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // SCENARIO 6: Concurrency / In-Flight Deduplication
  // --------------------------------------------------------------------------
  it('6. Concurrency — two simultaneous requests for the same uncached run trigger only ONE authoritative API call', async () => {
    const runId = 'run_concurrent_600';

    mockSdk._cloudRuns.push({
      id: runId,
      workspaceId: workspaceA,
      name: 'Concurrent Run',
      query: 'concurrent query',
      status: 'completed',
      resultCount: 1
    });
    mockSdk._cloudCompanies.push(
      { id: 'c_conc_1', workspaceId: workspaceA, name: 'Speedy Co', domain: 'speedy.com' }
    );
    mockSdk._cloudLinks.push(
      { id: 'l_conc_1', workspaceId: workspaceA, discoveryRunId: runId, companyId: 'c_conc_1' }
    );

    // Fire two requests simultaneously
    const [res1, res2] = await Promise.all([
      invokeIpc('discovery:run:companies', { workspaceId: workspaceA, runId }),
      invokeIpc('discovery:run:companies', { workspaceId: workspaceA, runId })
    ]);

    expect(res1).toHaveLength(1);
    expect(res2).toHaveLength(1);
    expect(res1[0].id).toBe('c_conc_1');
    expect(res2[0].id).toBe('c_conc_1');

    // Crucial: In-flight deduplication prevented duplicate network calls
    expect(mockSdk.discovery.listCompaniesForRun).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // SCENARIO 7: Invalid / Unauthorized Cross-Workspace Run
  // --------------------------------------------------------------------------
  it('7. Unauthorized Cross-Workspace Run — rejects access and prevents cross-tenant data leakage', async () => {
    const foreignRunId = 'run_foreign_700';

    // Seed run into Workspace B
    mockSdk._cloudRuns.push({
      id: foreignRunId,
      workspaceId: workspaceB,
      name: 'Secret Workspace B Run',
      query: 'secret',
      status: 'completed',
      resultCount: 1
    });
    mockSdk._cloudCompanies.push(
      { id: 'c_foreign_1', workspaceId: workspaceB, name: 'Secret Corp', domain: 'secret.com' }
    );

    // Mock API error when querying foreign run from workspaceA
    mockSdk.discovery.listCompaniesForRun.mockImplementation(async (id: string) => {
      if (id === foreignRunId) {
        const err: any = new Error('Resource not found or unauthorized');
        err.status = 404;
        throw err;
      }
      return [];
    });

    // Workspace A attempts to access Workspace B run
    const result = await invokeIpc('discovery:run:companies', {
      workspaceId: workspaceA,
      runId: foreignRunId
    });

    expect(result).toEqual([]);

    // Verify nothing inserted into workspaceA's SQLite
    const dbA = getDatabase(workspaceA);
    const compsA = dbA.prepare('SELECT * FROM companies WHERE workspaceId = ?').all(workspaceA) as any[];
    expect(compsA).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // SCENARIO 8: API Failure Resiliency
  // --------------------------------------------------------------------------
  it('8. API Failure Resiliency — falls back cleanly to local state without corrupting cache', async () => {
    const runId = 'run_fail_800';

    // Pre-seed local cache with 1 company
    const db = getDatabase(workspaceA);
    db.prepare(`
      INSERT INTO discovery_runs (id, workspaceId, name, query, status, resultCount, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, workspaceA, 'Flaky Run', 'flaky', 'completed', 5, new Date().toISOString());

    const insertCompFb = db.prepare(`
      INSERT INTO companies (id, workspaceId, name, domain, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertCompFb.run('c_fallback_1', workspaceA, 'Cached Fallback Co', 'fallback.com', new Date().toISOString());

    const insertLinkFb = db.prepare(`
      INSERT INTO company_discovery_runs (id, workspaceId, discoveryRunId, companyId, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertLinkFb.run(`${runId}_c_fallback_1`, workspaceA, runId, 'c_fallback_1', new Date().toISOString());

    // API simulates network failure
    mockSdk.discovery.listCompaniesForRun.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    const result = await invokeIpc('discovery:run:companies', {
      workspaceId: workspaceA,
      runId
    });

    // Should gracefully return existing local rows without crashing
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c_fallback_1');
  });

  // --------------------------------------------------------------------------
  // SCENARIO 9: Contacts Filtering after Run Fallback
  // --------------------------------------------------------------------------
  it('9. Contacts Filtering — after run fallback, ContactsScreen queries find the correct contacts', async () => {
    const runId = 'run_contacts_900';

    // Seed cloud run and companies
    mockSdk._cloudRuns.push({
      id: runId,
      workspaceId: workspaceA,
      name: 'Roofers Miami',
      query: 'roofers miami',
      status: 'completed',
      resultCount: 1
    });
    mockSdk._cloudCompanies.push({
      id: 'c_roofer_1',
      workspaceId: workspaceA,
      name: 'Miami Top Roofs',
      domain: 'toproofs.com'
    });
    mockSdk._cloudLinks.push({
      id: 'l_rf_1',
      workspaceId: workspaceA,
      discoveryRunId: runId,
      companyId: 'c_roofer_1'
    });

    // Seed contacts in local SQLite
    const db = getDatabase(workspaceA);
    const insertCont = db.prepare(`
      INSERT INTO contacts (id, workspaceId, companyId, firstName, lastName, email, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertCont.run('cont_1', workspaceA, 'c_roofer_1', 'John', 'Roofer', 'john@toproofs.com', new Date().toISOString());
    insertCont.run('cont_2', workspaceA, 'c_unrelated_99', 'Jane', 'Other', 'jane@other.com', new Date().toISOString());

    // Trigger run fallback via companies:query or discovery:run:companies
    await invokeIpc('discovery:run:companies', { workspaceId: workspaceA, runId });

    // Contacts query with discoveryRunId filter
    const matchingIds = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runId });
    expect(matchingIds).toEqual(['cont_1']);

    // companies:query with discoveryRunId
    const matchingCompanies = await invokeIpc('companies:query', {
      workspaceId: workspaceA,
      discoveryRunId: runId
    });
    expect(matchingCompanies).toHaveLength(1);
    expect(matchingCompanies[0].id).toBe('c_roofer_1');
  });
});
