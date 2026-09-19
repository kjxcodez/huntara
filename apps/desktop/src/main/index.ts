import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron';
import { join, resolve } from 'path';
import fs from 'fs';
import { is } from '@electron-toolkit/utils';
import { SdkClient } from '@leadforge/sdk';
import { initCacheSchema, ensureCleanCache } from './database/cache-schema';
import { getDatabase, closeDatabase } from './database/connection';
import { registerAllIpc } from './ipc/register';
import { loadSession, clearSession } from './lib/session';
import { AppLogger } from './lib/logger';
import { loadWindowState, trackWindowState } from './lib/window-state';
import { createSplashWindow, updateSplashProgress } from './lib/splash-window';
import { telemetry } from './lib/telemetry';
import { UpdateManager } from './services/updater';
import { LocalCrashReporter } from './lib/crash-reporter';
import { loadConfig } from './lib/config';
import { ensurePlaywrightBrowsers } from './lib/playwright-setup';
import { WorkspaceManager } from './lib/workspace-manager';
import { ConnectivityService } from './services/connectivity-service';
import { setupTray, destroyTray } from './lib/tray';

// Load .env for main process (electron-vite only loads it for renderer)
try {
  const envPath = resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch {
  // .env loading is optional for desktop app
}

// Track and write process crashes locally
LocalCrashReporter.initialize();

// Main window reference
let mainWindow: BrowserWindow | null = null;
let restoredSession: any = null;

// Local config persistence
function getLocalConfigPath() {
  return join(app.getPath('userData'), 'config.json');
}

function getPersistedActiveWorkspace(): string | null {
  try {
    const configPath = getLocalConfigPath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return data.activeWorkspaceId || null;
    }
  } catch (err) {
    console.error('Failed to read local workspace config:', err);
  }
  return null;
}

function persistActiveWorkspace(workspaceId: string | null) {
  try {
    const configPath = getLocalConfigPath();
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    config.activeWorkspaceId = workspaceId;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write local workspace config:', err);
  }
}

// SDK client initialization
const customHeaders: Record<string, string> = {};
let activeToken: string | null = null;
let sdk: SdkClient;

// IPC handlers registry
export const ipcHandlers = new Map<
  string,
  (event: Electron.IpcMainEvent, ...args: unknown[]) => void
>();

function createWindow() {
  const windowState = loadWindowState();

  const winOptions: any = {
    width: windowState.width,
    height: windowState.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      disableBlinkFeatures: 'Auxclick'
    },
    title: 'HUNTARA',
    titleBarStyle: 'default',
    frame: true,
    trafficLightPosition: { x: 10, y: 10 },
    icon: join(__dirname, '../../resources/HUNTARA-master-app-icon-1024.png')
  };

  if (windowState.x !== undefined && windowState.y !== undefined) {
    winOptions.x = windowState.x;
    winOptions.y = windowState.y;
  }

  mainWindow = new BrowserWindow(winOptions);

  if (windowState.maximized) {
    mainWindow.maximize();
  }

  trackWindowState(mainWindow);

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    LocalCrashReporter.report(
      new Error(`Renderer process gone. Reason: ${details.reason}, Exit code: ${details.exitCode}`),
      'renderer:render-process-gone'
    );
  });

  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[Renderer Console] ${message}`);
  });

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready (NO-OP: Main window visibility is managed dynamically by renderer ready-to-show IPC)
  mainWindow.on('ready-to-show', () => {
    if (is.dev) {
      mainWindow?.webContents.openDevTools({
        mode: 'detach'
      });
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

export function registerIpcHandler() {}

// App lifecycle
app.whenReady().then(async () => {
  telemetry.whenReadyTime = Date.now();

  // Create lightweight native splash window immediately
  createSplashWindow();

  // Set as app user model ID (Windows)
  app.setAppUserModelId('com.huntara.desktop');

  // Restore session from disk
  const sessionStart = Date.now();
  updateSplashProgress('session', 'Restoring user session...');
  try {
    restoredSession = loadSession();
    if (restoredSession) {
      activeToken = restoredSession.accessToken;
      const persistedWorkspace = getPersistedActiveWorkspace();
      const workspaceId = persistedWorkspace || restoredSession.activeWorkspaceId;
      if (workspaceId) {
        customHeaders['x-workspace-id'] = workspaceId;
      }
      AppLogger.info('auth', 'Session restored');
    }
  } catch (err) {
    AppLogger.error('auth', 'Failed to restore session on startup', undefined, err);
  }
  telemetry.sessionRestoreDuration = Date.now() - sessionStart;

  // 1. Initialize clean SQLite cache schema
  try {
    ensureCleanCache(getDatabase());
  } catch (err) {
    console.error('Failed to initialize local SQLite cache schema:', err);
  }

  // Load dynamic configuration
  const config = loadConfig();

  sdk = new SdkClient({
    baseUrl: config.apiUrl,
    headers: customHeaders,
    tokenResolver: () => activeToken,
    onUnauthorized: () => {
      AppLogger.warn('auth', 'Session expired');
      clearSession();
      activeToken = null;
      delete customHeaders['x-workspace-id'];
      persistActiveWorkspace(null);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:unauthorized');
      }
    }
  });

  // 2. Ensure Playwright Chromium browser binaries are installed before any
  //    scraper job can run. On first launch this downloads ~80 MB; on subsequent
  //    launches the installed check takes < 10 ms.
  try {
    updateSplashProgress('browser:setup', 'Setting up browser engine...');
    await ensurePlaywrightBrowsers((line) => {
      // Pipe installation stdout into the splash screen label (truncated to 60 chars)
      updateSplashProgress('browser:setup', line.slice(0, 60));
    });
  } catch (err: any) {
    AppLogger.error('app', 'Playwright browser setup failed during startup', undefined, err);
    updateSplashProgress('browser:setup', 'Browser engine setup incomplete (offline)');
  }

  // 3. Register all IPC handlers exactly once using the coordinator
  registerAllIpc(
    sdk,
    customHeaders,
    (token) => {
      activeToken = token;
    },
    persistActiveWorkspace,
    getPersistedActiveWorkspace
  );

  // 4. API Connectivity & Health Gate
  // Gated startup: verify API reachability before activating workspace runtimes
  updateSplashProgress('connectivity:check', 'Verifying API connectivity...');
  const connState = await ConnectivityService.checkConnectivity(config.apiUrl, 3500);

  if (connState.status === 'ONLINE') {
    updateSplashProgress('connectivity:ready', '✓ API Connected');
    if (restoredSession) {
      const persistedWorkspace = getPersistedActiveWorkspace();
      const wsId = persistedWorkspace || restoredSession.activeWorkspaceId;
      if (wsId) {
        try {
          await WorkspaceManager.setActiveWorkspace(wsId);
          AppLogger.info('workspace', `Workspace runtime eagerly activated on startup: ${wsId}`);
        } catch (wsErr) {
          AppLogger.error('workspace', `Failed to activate restored workspace on startup: ${wsId}`, wsId, wsErr);
        }
      }
    }
  } else if (connState.status === 'AUTHENTICATION_REQUIRED') {
    updateSplashProgress('connectivity:auth', 'Authentication required');
    AppLogger.warn('auth', 'Stored session is invalid or expired. Clearing stale session credentials.');
    clearSession();
    activeToken = null;
    delete customHeaders['x-workspace-id'];
    persistActiveWorkspace(null);
  } else {
    // DEGRADED / OFFLINE
    updateSplashProgress('connectivity:degraded', 'Operating in Offline Mode');
    AppLogger.warn(
      'connectivity',
      `workspace_runtime_start_blocked: API is ${connState.error?.code || 'UNREACHABLE'}. Operating in degraded offline state.`,
      undefined,
      { error: connState.error }
    );
    // Note: Do NOT activate WorkspaceRuntime or start scheduler when offline.
    // Preserved session on disk remains available for reconnection.
  }

  // Synchronous settings getter for theme/sidebar restore on boot
  ipcMain.on('settings:getSync', (event) => {
    try {
      const configPath = getLocalConfigPath();
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        event.returnValue = config.settings || {};
      } else {
        event.returnValue = {};
      }
    } catch (err) {
      console.error('Failed to get sync settings:', err);
      event.returnValue = {};
    }
  });

  // Asynchronous settings setter
  ipcMain.on('settings:set', (_event, settings) => {
    try {
      const configPath = getLocalConfigPath();
      const config = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
        : {};
      config.settings = { ...(config.settings || {}), ...settings };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to set settings:', err);
    }
  });

  // Remove default menu bar
  Menu.setApplicationMenu(null);

  // Optimize for OS
  if (process.platform === 'darwin') {
    // macOS specific menu setup can go here
  }

  createWindow();

  // Setup system tray
  setupTray(() => mainWindow);

  // Initialise UpdateManager
  try {
    UpdateManager.getInstance();
  } catch (err) {
    AppLogger.error('Updater', 'Failed to initialize UpdateManager on start', undefined, err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  destroyTray();
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Graceful exit handler
app.on('will-quit', () => {
  destroyTray();
  closeDatabase();
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});
