import { safeRegister, REGISTERED_IPC_CHANNELS } from './helper';
import { app, shell, Notification, BrowserWindow } from 'electron';
import { WorkspaceManager } from '../lib/workspace-manager';
import fs from 'fs';
import { join } from 'path';
import { getDatabase } from '../database/connection';
import { telemetry } from '../lib/telemetry';
import { destroySplashWindow } from '../lib/splash-window';

/**
 * Registers native Electron window, platform, utility, and notification channels.
 */
export function registerElectronIpc(
  setWorkspaceHeader: (workspaceId: string | null) => void,
  persistActiveWorkspace: (workspaceId: string | null) => void,
  getPersistedActiveWorkspace: () => string | null
) {
  safeRegister('electron:setActiveWorkspace', async (_event, workspaceId) => {
    console.log('Main Process: Setting active workspace headers:', workspaceId);
    setWorkspaceHeader(workspaceId);
    persistActiveWorkspace(workspaceId);
    try {
      await WorkspaceManager.setActiveWorkspace(workspaceId);
    } catch (err) {
      console.error('[IPC] Failed to switch workspace in runtime manager:', err);
      throw err;
    }
  });

  safeRegister('electron:getActiveWorkspace', () => {
    return getPersistedActiveWorkspace();
  });

  safeRegister('electron:version', () => {
    return app.getVersion();
  });

  safeRegister('electron:platform', () => {
    return process.platform;
  });

  safeRegister('electron:openUrl', async (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
    }
  });

  safeRegister('electron:notify', (_event, payload: { title: string; body: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title: payload.title, body: payload.body }).show();
    }
  });

  safeRegister('system:diagnostics', async (_event, payload) => {
    const workspaceId = payload?.workspaceId;
    if (!workspaceId) throw new Error('workspaceId is required for diagnostics.');

    const db = getDatabase(workspaceId);
    const result: any = {};

    // 1. Storage Usage
    try {
      const userDataPath = app.getPath('userData');
      const canonicalGlobalDb = join(userDataPath, 'huntara.db');
      const legacyGlobalDb = join(userDataPath, 'leadforge.db');
      const globalDbPath = fs.existsSync(canonicalGlobalDb) ? canonicalGlobalDb : legacyGlobalDb;

      const canonicalWsDb = join(userDataPath, 'workspaces', `huntara_${workspaceId}.db`);
      const legacyWsDb = join(userDataPath, 'workspaces', `leadforge_${workspaceId}.db`);
      const workspaceDbPath = fs.existsSync(canonicalWsDb) ? canonicalWsDb : legacyWsDb;

      result.storage = {
        globalDbSize: fs.existsSync(globalDbPath) ? fs.statSync(globalDbPath).size : 0,
        workspaceDbSize: fs.existsSync(workspaceDbPath) ? fs.statSync(workspaceDbPath).size : 0
      };
    } catch (e) {
      result.storage = { error: String(e) };
    }

    // 2. Cache metadata info
    try {
      result.migrations = db.prepare('SELECT * FROM cache_metadata').all();
    } catch (e) {
      result.migrations = [];
    }

    // 3. SQLite Tables info (row counts)
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      const tableCounts: Record<string, number> = {};
      for (const t of tables) {
        try {
          const row = db.prepare(`SELECT COUNT(1) as count FROM ${t.name}`).get() as {
            count: number;
          };
          tableCounts[t.name] = row.count;
        } catch {
          tableCounts[t.name] = -1;
        }
      }
      result.tables = tableCounts;
    } catch (e) {
      result.tables = { error: String(e) };
    }

    // 4. Jobs Statuses
    try {
      const sdk = WorkspaceManager.getSdk();
      const jobRes = await sdk.jobs.list({ limit: 50 }).catch(() => ({ data: [] }));
      result.jobs = jobRes.data;
    } catch (e) {
      result.jobs = [];
    }

    // 5. Sync Queue list (obsolete — always empty in MongoDB-first architecture)
    result.syncQueue = [];

    // 6. Database Health
    try {
      const check = db.prepare('PRAGMA integrity_check').get() as any;
      result.dbHealth = check ? Object.values(check)[0] : 'ok';
    } catch (e) {
      result.dbHealth = 'error: ' + String(e);
    }

    // 7. System Logs (recent 100)
    try {
      const sdk = WorkspaceManager.getSdk();
      result.logs = await sdk.systemLogs.listRecent(100).catch(() => []);
    } catch (e) {
      result.logs = [];
    }

    // 8. Worker Status
    const activeRuntime = WorkspaceManager.getActiveRuntime();
    result.workerStatus = {
      isRuntimeActive: !!activeRuntime,
      activeWorkersCount: activeRuntime
        ? (activeRuntime as any).scheduler?.activeWorkers?.size || 0
        : 0,
      activeWorkersList: activeRuntime
        ? Array.from((activeRuntime as any).scheduler?.activeWorkers?.keys() || [])
        : []
    };

    // 9. Registered IPC Channels
    result.ipcChannels = Array.from(REGISTERED_IPC_CHANNELS);

    // 10. Startup and Lifecycle Telemetry (PRD-002)

    result.startupMetrics = telemetry.getMetrics(workspaceId);
    result.workspaceLifecycle = WorkspaceManager.getLifecycleMetrics();

    return result;
  });

  safeRegister('electron:ready-to-show', async (_event, payload: any) => {
    if (payload) {
      if (payload.rendererInitStart !== undefined)
        telemetry.rendererInitStart = payload.rendererInitStart;
      if (payload.reactMountTime !== undefined) telemetry.reactMountTime = payload.reactMountTime;
      if (payload.dashboardReadyTime !== undefined)
        telemetry.dashboardReadyTime = payload.dashboardReadyTime;
    }

    console.log('[IPC] Renderer reported ready-to-show. Revealing main window.');

    // Find main window and show/focus it
    BrowserWindow.getAllWindows().forEach((win: BrowserWindow) => {
      if (!win.isDestroyed() && win.isResizable()) {
        win.show();
        win.focus();
      }
    });

    // Cleanly close splash window
    destroySplashWindow();
  });
}
