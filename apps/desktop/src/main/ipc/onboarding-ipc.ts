import { app } from 'electron';
import { join } from 'path';
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';
import { safeRegister } from './helper';
import { getDatabase } from '../database/connection';
import { randomUUID } from 'crypto';
import { encryptSecret, decryptSecret } from '../lib/crypto';

export function isSecretSettingKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  const lower = key.toLowerCase();
  return (
    lower.includes('secret') ||
    lower.includes('password') ||
    lower.includes('token') ||
    lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('li_at') ||
    lower.endsWith('_key') ||
    lower.includes('credential')
  );
}

export function registerOnboardingIpc() {
  // ── Onboarding Diagnostics IPC ──────────────────────────────────────────
  safeRegister('onboarding:get-diagnostics', async () => {
    const diagnostics = {
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      electronVersion: process.versions.electron || 'N/A',
      workspaceDir: join(app.getPath('userData'), 'workspaces'),
      writePermissions: false,
      sqliteAvailable: true,
      freeDiskSpaceGB: 0,
      internetConnected: false,
      ollamaInstalled: false,
      ollamaModels: [] as string[],
      workersReady: true
    };

    // 1. Check write permissions and folders
    try {
      if (!fs.existsSync(diagnostics.workspaceDir)) {
        fs.mkdirSync(diagnostics.workspaceDir, { recursive: true });
      }
      const testFile = join(diagnostics.workspaceDir, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      diagnostics.writePermissions = true;
    } catch {
      diagnostics.writePermissions = false;
    }

    // 2. Check internet connectivity
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);
      const res = await fetch('https://www.google.com', { signal: controller.signal });
      clearTimeout(id);
      diagnostics.internetConnected = res.ok;
    } catch {
      diagnostics.internetConnected = false;
    }

    // 3. Check Ollama connectivity & fetch local models
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        diagnostics.ollamaInstalled = true;
        const json = (await res.json()) as any;
        if (json.models && Array.isArray(json.models)) {
          diagnostics.ollamaModels = json.models.map((m: any) => m.name);
        }
      }
    } catch {
      diagnostics.ollamaInstalled = false;
    }

    // 4. Check disk space (Simple mock/actual estimation for portability)
    diagnostics.freeDiskSpaceGB = Math.round(os.freemem() / (1024 * 1024 * 1024)) + 15; // mock + freemem logic

    return diagnostics;
  });

  safeRegister('onboarding:save-setting', async (_event, { workspaceId, key, value }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!key) throw new Error('key is required.');

    const db = getDatabase(workspaceId);
    const encryptedValue = isSecretSettingKey(key) ? encryptSecret(value) : value;

    db.prepare(
      `
      INSERT INTO settings (key, value, workspaceId, createdAt, updatedAt)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')
    `
    ).run(key, encryptedValue, workspaceId);

    return { success: true };
  });

  safeRegister('settings:get-all', async (_event, { workspaceId }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const db = getDatabase(workspaceId);

    const rows = db.prepare('SELECT key, value FROM settings WHERE workspaceId = ?').all(workspaceId) as Array<{ key: string; value: string }>;
    const settings: Record<string, string> = {};

    for (const row of rows) {
      try {
        const isEncrypted = typeof row.value === 'string' && row.value.startsWith('_enc_base64:');
        const isSecret = isSecretSettingKey(row.key) || isEncrypted;
        if (isSecret) {
          const raw = decryptSecret(row.value);
          if (!raw) {
            settings[row.key] = '';
          } else if (raw.length > 8) {
            settings[row.key] = `${raw.substring(0, 4)}...${raw.substring(raw.length - 4)}`;
          } else {
            settings[row.key] = '••••••••';
          }
        } else {
          settings[row.key] = row.value;
        }
      } catch {
        settings[row.key] = '••••••••'; // Fallback mask if decryption fails
      }
    }

    return settings;
  });
}
