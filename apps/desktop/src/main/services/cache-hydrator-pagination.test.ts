import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Mock electron before importing runtime / IPC modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
    getVersion: vi.fn(() => '1.2.1-beta.1'),
    isPackaged: false,
    setAppUserModelId: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}));

import { getDatabase, closeDatabase } from '../database/connection';
import { CacheHydrator } from './cache-hydrator';
import { LocalCRMRepository } from '../database/repositories/local-crm';

describe('HUNTARA — CompanyDiscoveryRuns Pagination & Hydration Suite', () => {
  let tempDbDir: string;
  const workspaceId = 'ws_pagination_test';

  beforeEach(() => {
    tempDbDir = path.join(os.tmpdir(), `huntara-pagination-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDbDir, { recursive: true });
    process.env.WORKSPACES_DB_DIR = tempDbDir;
  });

  afterEach(() => {
    closeDatabase(workspaceId);
    delete process.env.WORKSPACES_DB_DIR;
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  function createMockSdk(cdrStore: any[], options?: { failOnPage?: number }) {
    return {
      companies: { list: vi.fn(async () => []) },
      contacts: { list: vi.fn(async () => []) },
      campaigns: { list: vi.fn(async () => []) },
      sequences: { list: vi.fn(async () => []) },
      executions: { list: vi.fn(async () => []) },
      outreach: {
        listAccounts: vi.fn(async () => []),
        listTemplates: vi.fn(async () => [])
      },
      audiences: { list: vi.fn(async () => []) },
      discovery: { listRuns: vi.fn(async () => []) },
      companyDiscoveryRuns: {
        list: vi.fn(async (params?: { page?: number; limit?: number }) => {
          const page = params?.page || 1;
          const limit = params?.limit || 100;

          if (options?.failOnPage && page === options.failOnPage) {
            throw new Error(`Simulated API failure on page ${page}`);
          }

          const start = (page - 1) * limit;
          const end = start + limit;
          return cdrStore.slice(start, end);
        })
      },
      emailDeliveries: { list: vi.fn(async () => ({ data: [] })) },
      workspaces: { getSchedulerPolicy: vi.fn(async () => null) },
      jobs: { recover: vi.fn(async () => []) }
    } as any;
  }

  it('1. hydrates 0 associations correctly when dataset is empty', async () => {
    const mockSdk = createMockSdk([]);
    const res = await CacheHydrator.hydrateWorkspaceCache(workspaceId, mockSdk);

    expect(res.success).toBe(true);
    expect(res.recordsHydrated['company_discovery_runs']).toBe(0);

    const inDb = await LocalCRMRepository.findMany('company_discovery_runs', workspaceId);
    expect(inDb).toHaveLength(0);
  });

  it('2. hydrates 1 association correctly', async () => {
    const records = [
      { id: 'cdr_1', workspaceId, companyId: 'comp_1', discoveryRunId: 'run_1' }
    ];
    const mockSdk = createMockSdk(records);
    const res = await CacheHydrator.hydrateWorkspaceCache(workspaceId, mockSdk);

    expect(res.success).toBe(true);
    expect(res.recordsHydrated['company_discovery_runs']).toBe(1);

    const inDb = await LocalCRMRepository.findMany('company_discovery_runs', workspaceId);
    expect(inDb).toHaveLength(1);
    expect(inDb[0].id).toBe('cdr_1');
  });

  it('3. hydrates exactly 100 associations (boundary of single full page)', async () => {
    const records = Array.from({ length: 100 }, (_, i) => ({
      id: `cdr_${i + 1}`,
      workspaceId,
      companyId: `comp_${i + 1}`,
      discoveryRunId: 'run_1'
    }));

    const mockSdk = createMockSdk(records);
    const res = await CacheHydrator.hydrateWorkspaceCache(workspaceId, mockSdk);

    expect(res.success).toBe(true);
    expect(res.recordsHydrated['company_discovery_runs']).toBe(100);

    const inDb = await LocalCRMRepository.findMany('company_discovery_runs', workspaceId);
    expect(inDb).toHaveLength(100);
  });

  it('4. paginates beyond 100 associations: 101 records across 2 pages must all be hydrated', async () => {
    const records = Array.from({ length: 101 }, (_, i) => ({
      id: `cdr_${i + 1}`,
      workspaceId,
      companyId: `comp_${i + 1}`,
      discoveryRunId: i < 50 ? 'run_1' : 'run_2'
    }));

    const mockSdk = createMockSdk(records);
    const res = await CacheHydrator.hydrateWorkspaceCache(workspaceId, mockSdk);

    expect(res.success).toBe(true);
    expect(res.recordsHydrated['company_discovery_runs']).toBe(101);

    // Verify all 101 records reached SQLite
    const inDb = await LocalCRMRepository.findMany('company_discovery_runs', workspaceId);
    expect(inDb).toHaveLength(101);

    // Verify the 101st record on page 2 exists
    const page2Record = inDb.find((r) => r.id === 'cdr_101');
    expect(page2Record).toBeDefined();
    expect(page2Record?.discoveryRunId).toBe('run_2');
  });

  it('5. paginates large dataset: 250 associations across 3 pages and multiple discovery runs', async () => {
    const records = Array.from({ length: 250 }, (_, i) => {
      let discoveryRunId = 'run_alpha';
      if (i >= 100 && i < 200) discoveryRunId = 'run_beta';
      if (i >= 200) discoveryRunId = 'run_gamma';

      return {
        id: `cdr_${i + 1}`,
        workspaceId,
        companyId: `comp_${i + 1}`,
        discoveryRunId
      };
    });

    const mockSdk = createMockSdk(records);
    const res = await CacheHydrator.hydrateWorkspaceCache(workspaceId, mockSdk);

    expect(res.success).toBe(true);
    expect(res.recordsHydrated['company_discovery_runs']).toBe(250);

    const inDb = await LocalCRMRepository.findMany('company_discovery_runs', workspaceId);
    expect(inDb).toHaveLength(250);

    // Run Alpha (page 1): 100 records
    const alphaRows = inDb.filter((r) => r.discoveryRunId === 'run_alpha');
    expect(alphaRows).toHaveLength(100);

    // Run Beta (pages 1 & 2): 100 records
    const betaRows = inDb.filter((r) => r.discoveryRunId === 'run_beta');
    expect(betaRows).toHaveLength(100);

    // Run Gamma (page 3): 50 records
    const gammaRows = inDb.filter((r) => r.discoveryRunId === 'run_gamma');
    expect(gammaRows).toHaveLength(50);
  });

  it('6. mid-pagination API failure logs error gracefully without crashing application', async () => {
    const records = Array.from({ length: 250 }, (_, i) => ({
      id: `cdr_${i + 1}`,
      workspaceId,
      companyId: `comp_${i + 1}`,
      discoveryRunId: 'run_1'
    }));

    // Simulate failure on page 2
    const mockSdk = createMockSdk(records, { failOnPage: 2 });
    const res = await CacheHydrator.hydrateWorkspaceCache(workspaceId, mockSdk);

    expect(res.success).toBe(false);
    expect(res.errors.some((e) => e.table === 'company_discovery_runs')).toBe(true);
    expect(res.recordsHydrated['company_discovery_runs']).toBe(0);
  });
});
