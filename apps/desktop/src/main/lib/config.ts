import { join } from 'path';
import fs from 'fs';

export const DEFAULT_PRODUCTION_API_URL = 'https://api.leadforge.kapiljangid.pro/api/v1';
export const DEFAULT_DEVELOPMENT_API_URL = 'http://localhost:3001/api/v1';

/**
 * Normalizes an API base URL ensuring proper protocol and /api/v1 suffix.
 */
export function normalizeApiUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

function getAppVersion(): string {
  try {
    // Dynamically require electron to allow safe execution in Node.js test environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    const electronApp = electron.app || electron.default?.app;
    if (electronApp && typeof electronApp.getVersion === 'function') {
      return electronApp.getVersion();
    }
  } catch {
    // not in Electron runtime
  }
  return '1.1.1-beta.1';
}

export function isDevEnvironment(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    const electronApp = electron.app || electron.default?.app;
    if (electronApp && typeof electronApp.isPackaged === 'boolean') {
      return !electronApp.isPackaged;
    }
  } catch {
    // not in Electron runtime
  }
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

export interface AppConfig {
  // Build-time
  appName: string;
  version: string;
  packageIdentifier: string;
  releaseChannel: string;
  updaterUrl: string;

  // Runtime
  apiUrl: string;
  openRouterKey?: string;
  aiProvider?: string;

  // User Settings
  settings: {
    modelSelection?: string;
    providerSelection?: string;
    loggingLevel?: string;
    telemetryEnabled?: boolean;
    updateChannel?: string;
  };
}

let cachedConfig: AppConfig | null = null;

export function getLocalConfigPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    const electronApp = electron.app || electron.default?.app;
    if (electronApp && typeof electronApp.getPath === 'function') {
      return join(electronApp.getPath('userData'), 'config.json');
    }
  } catch {
    // not in Electron runtime
  }
  return join(process.cwd(), 'config.json');
}

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const pkgVersion = getAppVersion();
  const buildConfig = {
    appName: 'HUNTARA',
    version: pkgVersion,
    packageIdentifier: 'com.huntara.app',
    releaseChannel: 'beta',
    updaterUrl: 'https://api.github.com/repos/kjxcodez/huntara/releases/latest'
  };

  let localData: any = {};
  try {
    const configPath = getLocalConfigPath();
    if (fs.existsSync(configPath)) {
      localData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read config.json:', err);
  }

  const isDevMode = isDevEnvironment();
  const defaultFallback = isDevMode ? DEFAULT_DEVELOPMENT_API_URL : DEFAULT_PRODUCTION_API_URL;

  // Precedence: process.env.API_URL > config.json's apiUrl > Environment Default
  const rawApiUrl = process.env.API_URL || localData.apiUrl || defaultFallback;
  const apiUrl = normalizeApiUrl(rawApiUrl);

  if (!apiUrl) {
    throw new Error('HUNTARA could not determine the API server URL for this environment.');
  }

  cachedConfig = {
    ...buildConfig,
    apiUrl,
    openRouterKey: process.env.OPENROUTER_API_KEY || localData.openRouterKey,
    aiProvider: process.env.AI_PROVIDER || localData.aiProvider || 'mock',
    settings: {
      modelSelection: localData.settings?.modelSelection || 'llama3.1',
      providerSelection: localData.settings?.providerSelection || 'ollama',
      loggingLevel: localData.settings?.loggingLevel || 'info',
      telemetryEnabled: localData.settings?.telemetryEnabled !== false,
      updateChannel: localData.settings?.updateChannel || 'beta'
    }
  };

  return cachedConfig;
}

export function saveConfig(updates: Partial<AppConfig>): void {
  const current = loadConfig();
  const updated = {
    ...current,
    ...updates,
    settings: {
      ...current.settings,
      ...updates.settings
    }
  };

  cachedConfig = updated;

  try {
    const configPath = getLocalConfigPath();
    const toSave = {
      apiUrl: updated.apiUrl,
      aiProvider: updated.aiProvider,
      settings: updated.settings
    };
    fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config.json:', err);
  }
}
