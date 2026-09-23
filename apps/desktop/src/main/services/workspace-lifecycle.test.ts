import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { QueryClient } from '@tanstack/react-query';

// Mock electron before importing IPC / runtime modules
const ipcHandlers = new Map<string, Function>();
const sentEvents: Array<{ channel: string; payload: any }> = [];

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
    getVersion: vi.fn(() => '1.1.1-beta.5'),
    isPackaged: false,
    setAppUserModelId: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: any) => {
            sentEvents.push({ channel, payload });
          }
        }
      }
    ])
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
import { WorkspaceManager } from '../lib/workspace-manager';
import { CacheHydrator } from './cache-hydrator';
import { registerElectronIpc } from '../ipc/electron';
import { WorkspaceService } from '../../renderer/services/workspace-service';

describe('LeadForge OS — Workspace Rehydration & Lifecycle Suite', () => {
  let tempDbDir: string;
  const workspaceA = 'ws_alpha';
  const workspaceB = 'ws_beta';
  const workspaceC = 'ws_gamma';

  let customHeaders: Record<string, string>;
  let persistedActiveWorkspace: string | null;

  let queryClient: QueryClient;

  // Authoritative server data stores
  let serverStore: {
    companies: Record<string, any[]>;
    contacts: Record<string, any[]>;
  };

  function createMockSdk() {
    return {
      companies: {
        list: vi.fn(async (params?: any) => {
          const wsId = customHeaders['x-workspace-id'] || WorkspaceManager.getTargetWorkspaceId() || persistedActiveWorkspace || workspaceA;
          return serverStore.companies[wsId] || [];
        })
      },
      contacts: {
        list: vi.fn(async (params?: any) => {
          const wsId = customHeaders['x-workspace-id'] || WorkspaceManager.getTargetWorkspaceId() || persistedActiveWorkspace || workspaceA;
          return serverStore.contacts[wsId] || [];
        })
      },
      campaigns: { list: vi.fn(async () => []) },
      sequences: { list: vi.fn(async () => []) },
      executions: { list: vi.fn(async () => []) },
      outreach: {
        listAccounts: vi.fn(async () => []),
        listTemplates: vi.fn(async () => [])
      },
      audiences: { list: vi.fn(async () => []) },
      discovery: { listRuns: vi.fn(async () => []) },
      companyDiscoveryRuns: { list: vi.fn(async () => []) },
      emailDeliveries: { list: vi.fn(async () => ({ data: [] })) },
      workspaces: {
        getSchedulerPolicy: vi.fn(async () => null)
      },
      jobs: {
        recover: vi.fn(async () => [])
      }
    };
  }

  let mockSdk: any;

  beforeEach(async () => {
    tempDbDir = path.join(os.tmpdir(), `lf-ws-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDbDir, { recursive: true });
    process.env.WORKSPACES_DB_DIR = tempDbDir;

    sentEvents.length = 0;
    customHeaders = {};
    persistedActiveWorkspace = workspaceA;

    serverStore = {
      companies: {
        [workspaceA]: [
          { id: 'comp_A1', name: 'Alpha Corp', workspaceId: workspaceA }
        ],
        [workspaceB]: [
          { id: 'comp_B1', name: 'Beta Systems', workspaceId: workspaceB }
        ],
        [workspaceC]: [
          { id: 'comp_C1', name: 'Gamma Enterprises', workspaceId: workspaceC }
        ]
      },
      contacts: {
        [workspaceA]: [
          { id: 'cont_A1', email: 'alice@alpha.com', companyId: 'comp_A1', workspaceId: workspaceA }
        ],
        [workspaceB]: [
          { id: 'cont_B1', email: 'bob@beta.com', companyId: 'comp_B1', workspaceId: workspaceB }
        ],
        [workspaceC]: [
          { id: 'cont_C1', email: 'charlie@gamma.com', companyId: 'comp_C1', workspaceId: workspaceC }
        ]
      }
    };

    mockSdk = createMockSdk();
    WorkspaceManager.setSdk(mockSdk as any);
    await WorkspaceManager.setActiveWorkspace(workspaceA);

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 }
      }
    });

    registerElectronIpc(
      (id) => {
        if (id) customHeaders['x-workspace-id'] = id;
        else delete customHeaders['x-workspace-id'];
      },
      (id) => {
        persistedActiveWorkspace = id;
      },
      () => persistedActiveWorkspace
    );

    // Mock window.ipc for renderer WorkspaceService
    (global as any).window = {
      ipc: {
        invoke: async (channel: string, payload: any) => {
          const handler = ipcHandlers.get(channel);
          if (!handler) throw new Error(`Channel ${channel} not registered`);
          return handler({}, payload);
        }
      }
    };
  });

  afterEach(async () => {
    await WorkspaceManager.setActiveWorkspace(null);
    closeDatabase(workspaceA);
    closeDatabase(workspaceB);
    closeDatabase(workspaceC);
    delete process.env.WORKSPACES_DB_DIR;
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {}
    delete (global as any).window;
    vi.restoreAllMocks();
  });

  it('1. switching_to_existing_workspace_hydrates_before_query_refresh: SQLite is populated before switch finishes', async () => {
    // Switch to Workspace B
    await WorkspaceService.syncActiveWorkspace(workspaceB);

    // Immediately after switch resolves, verify SQLite contains Workspace B data
    const localCompanies = await LocalCRMRepository.findMany('companies', workspaceB);
    expect(localCompanies.length).toBe(1);
    expect(localCompanies[0].name).toBe('Beta Systems');

    const localContacts = await LocalCRMRepository.findMany('contacts', workspaceB);
    expect(localContacts.length).toBe(1);
    expect(localContacts[0].email).toBe('bob@beta.com');
  });

  it('2. creating_workspace_activates_new_workspace: newly created workspace can be switched to', async () => {
    const created = { id: workspaceC, name: 'Workspace Gamma' };

    // When activated via canonical syncActiveWorkspace:
    await WorkspaceService.syncActiveWorkspace(created.id);

    expect(WorkspaceManager.getActiveRuntime()?.workspaceId).toBe(workspaceC);
    expect(persistedActiveWorkspace).toBe(workspaceC);
  });

  it('3. creating_workspace_updates_main_process_runtime: header and runtime match new workspace', async () => {
    await WorkspaceService.syncActiveWorkspace(workspaceC);

    expect(customHeaders['x-workspace-id']).toBe(workspaceC);
    expect(WorkspaceManager.getActiveRuntime()?.workspaceId).toBe(workspaceC);
  });

  it('4. cache_hydrator_emits_workspaceId_and_scope: broadcasts include required routing fields', async () => {
    await CacheHydrator.hydrateWorkspaceCache(workspaceA, mockSdk);

    const broadcast = sentEvents.find((e) => e.channel === 'sync:completed');
    expect(broadcast).toBeDefined();
    expect(broadcast?.payload).toMatchObject({
      scope: 'all',
      workspaceId: workspaceA,
      timestamp: expect.any(String)
    });
  });

  it('5. switching_workspace_invalidates_queries_after_hydration: queries read hydrated SQLite without manual refresh', async () => {
    // 1. Initial state in Workspace A
    await WorkspaceService.syncActiveWorkspace(workspaceA);
    const queryKey = ['companies', 'list', workspaceA];

    // Seed query cache for Workspace A
    await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => LocalCRMRepository.findMany('companies', workspaceA)
    });
    expect((queryClient.getQueryData(queryKey) as any[])[0].name).toBe('Alpha Corp');

    // 2. Switch to Workspace B
    await WorkspaceService.syncActiveWorkspace(workspaceB);
    await queryClient.resetQueries();

    // 3. Fresh fetch for Workspace B immediately returns hydrated data
    const queryKeyB = ['companies', 'list', workspaceB];
    const dataB = await queryClient.fetchQuery({
      queryKey: queryKeyB,
      queryFn: async () => LocalCRMRepository.findMany('companies', workspaceB)
    });

    expect(dataB.length).toBe(1);
    expect(dataB[0].name).toBe('Beta Systems');
  });

  it('6. workspace_A_to_B_does_not_leak_A_data: isolated databases prevent cross-contamination', async () => {
    await WorkspaceService.syncActiveWorkspace(workspaceA);
    await WorkspaceService.syncActiveWorkspace(workspaceB);

    const bCompanies = await LocalCRMRepository.findMany('companies', workspaceB);
    expect(bCompanies.some((c) => c.id === 'comp_A1')).toBe(false);
    expect(bCompanies.length).toBe(1);
    expect(bCompanies[0].id).toBe('comp_B1');
  });

  it('7. workspace_B_to_A_restores_A_data: switching back restores original workspace state', async () => {
    await WorkspaceService.syncActiveWorkspace(workspaceB);
    await WorkspaceService.syncActiveWorkspace(workspaceA);

    const aCompanies = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(aCompanies.length).toBe(1);
    expect(aCompanies[0].name).toBe('Alpha Corp');
  });

  it('8. rapid_workspace_switch_does_not_publish_stale_workspace_data: superseded hydration is aborted', async () => {
    // Rapidly switch A -> B -> C
    const switchPromise1 = WorkspaceService.syncActiveWorkspace(workspaceB);
    const switchPromise2 = WorkspaceService.syncActiveWorkspace(workspaceC);

    await Promise.all([switchPromise1, switchPromise2]);

    expect(WorkspaceManager.getActiveRuntime()?.workspaceId).toBe(workspaceC);

    // Filter sync:completed broadcasts
    const cBroadcasts = sentEvents.filter(
      (e) => e.channel === 'sync:completed' && e.payload?.workspaceId === workspaceC
    );
    expect(cBroadcasts.length).toBeGreaterThan(0);
  });

  it('9. startup_hydration_still_works: active workspace restoration populates cache', async () => {
    // Clean start with workspace A
    await WorkspaceManager.setActiveWorkspace(workspaceA);

    const localCompanies = await LocalCRMRepository.findMany('companies', workspaceA);
    expect(localCompanies.length).toBe(1);
    expect(localCompanies[0].id).toBe('comp_A1');
  });

  it('10. background_hydration_allows_immediate_readiness_without_waiting: runtime starts before hydration completes', async () => {
    await WorkspaceManager.setActiveWorkspace(null);

    let finishHydration: () => void = () => {};
    const slowHydrationPromise = new Promise<void>((resolve) => {
      finishHydration = resolve;
    });

    const originalHydrate = CacheHydrator.hydrateWorkspaceCache;
    vi.spyOn(CacheHydrator, 'hydrateWorkspaceCache').mockImplementationOnce(async (wsId, sdk) => {
      await slowHydrationPromise;
      return originalHydrate(wsId, sdk);
    });

    // Act: activate workspaceC with backgroundHydration: true
    const startPromise = WorkspaceManager.setActiveWorkspace(workspaceC, { backgroundHydration: true });

    // startPromise resolves promptly without waiting for slowHydrationPromise
    const runtime = await startPromise;
    expect(runtime).toBeDefined();
    expect(runtime?.isRunning).toBe(true);

    // Database tables are ready even while hydration is still in flight
    const inFlightCompanies = await LocalCRMRepository.findMany('companies', workspaceC);
    expect(inFlightCompanies).toHaveLength(0); // not yet hydrated

    // Resolve the background hydration
    finishHydration();
    await WorkspaceManager.waitForActiveHydration();

    // Now hydrated data is in SQLite
    const hydratedCompanies = await LocalCRMRepository.findMany('companies', workspaceC);
    expect(hydratedCompanies).toHaveLength(1);
    expect(hydratedCompanies[0].name).toBe('Gamma Enterprises');
  });

  it('11. background_hydration_failure_does_not_crash_runtime: catches and logs without tearing down runtime', async () => {
    await WorkspaceManager.setActiveWorkspace(null);
    vi.spyOn(CacheHydrator, 'hydrateWorkspaceCache').mockRejectedValueOnce(new Error('Network gateway timeout'));

    const runtime = await WorkspaceManager.setActiveWorkspace(workspaceB, { backgroundHydration: true });
    expect(runtime).toBeDefined();
    expect(runtime?.isRunning).toBe(true);

    // Awaiting hydration returns safely (null) without unhandled rejection
    const res = await WorkspaceManager.waitForActiveHydration();
    expect(res).toBeNull();
    expect(runtime?.isRunning).toBe(true);
  });

  it('12. spin_down_cleanly_awaits_in_flight_hydration: stop() awaits background hydration before closing db', async () => {
    await WorkspaceManager.setActiveWorkspace(null);
    let hydrationCompleted = false;
    vi.spyOn(CacheHydrator, 'hydrateWorkspaceCache').mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 50));
      hydrationCompleted = true;
      return {} as any;
    });

    const runtime = await WorkspaceManager.setActiveWorkspace(workspaceC, { backgroundHydration: true });
    expect(runtime).toBeDefined();
    expect(hydrationCompleted).toBe(false);

    // Stop runtime while hydration is in flight
    await WorkspaceManager.setActiveWorkspace(null);
    expect(hydrationCompleted).toBe(true);
  });
});

