import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface StorageMigrationResult {
  canonicalUserData: string;
  isMigrated: boolean;
  legacySourcePath: string | null;
  migratedDatabases: string[];
}

const MIGRATION_MARKER_FILE = '.huntara-migrated.json';

/**
 * Discovers any legacy LeadForge application data directories.
 */
function getLegacyCandidatePaths(appDataDir: string): string[] {
  return [
    path.join(appDataDir, '@leadforge', 'desktop'),
    path.join(appDataDir, 'LeadForge'),
    path.join(appDataDir, 'leadforge'),
    path.join(appDataDir, 'LeadForge OS'),
    path.join(appDataDir, 'leadforge-os'),
    path.join(appDataDir, '@leadforge')
  ];
}

/**
 * Initializes canonical HUNTARA storage paths and runs a one-time
 * zero-loss migration from existing LeadForge installations if detected.
 */
export function initializeStorageAndMigrate(): StorageMigrationResult {
  // Always set the canonical application name first if Electron app is available
  if (typeof app !== 'undefined' && app?.setName) {
    try {
      app.setName('HUNTARA');
    } catch {}
  }

  let appDataDir: string;
  try {
    appDataDir = app.getPath('appData');
  } catch {
    // Fallback if accessed before app ready or in testing runtime
    if (process.platform === 'win32') {
      appDataDir = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    } else if (process.platform === 'darwin') {
      appDataDir = path.join(process.env.HOME || '', 'Library', 'Application Support');
    } else {
      appDataDir = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config');
    }
  }

  // Canonical HUNTARA data directory
  const canonicalUserData = path.join(appDataDir, 'HUNTARA');

  // Explicitly set Electron's paths so no package-manager scope controls userData
  try {
    if (typeof app !== 'undefined' && app?.setPath) {
      app.setPath('userData', canonicalUserData);
      app.setPath('logs', path.join(canonicalUserData, 'logs'));
      app.setPath('crashDumps', path.join(canonicalUserData, 'crashes'));
    }
  } catch (err) {
    console.warn('[Storage] Warning setting custom electron paths:', err);
  }

  // Ensure canonical directories exist
  try {
    if (!fs.existsSync(canonicalUserData)) {
      fs.mkdirSync(canonicalUserData, { recursive: true });
    }
    const workspacesDir = path.join(canonicalUserData, 'workspaces');
    if (!fs.existsSync(workspacesDir)) {
      fs.mkdirSync(workspacesDir, { recursive: true });
    }
    const logsDir = path.join(canonicalUserData, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (err) {
    console.error('[Storage] Failed to initialize canonical directories:', err);
  }

  const markerPath = path.join(canonicalUserData, MIGRATION_MARKER_FILE);

  // If already migrated, return quickly
  if (fs.existsSync(markerPath)) {
    return {
      canonicalUserData,
      isMigrated: true,
      legacySourcePath: null,
      migratedDatabases: []
    };
  }

  const migratedDatabases: string[] = [];
  let detectedLegacyPath: string | null = null;

  // Search candidate legacy paths
  const legacyCandidates = getLegacyCandidatePaths(appDataDir);
  for (const candidate of legacyCandidates) {
    if (fs.existsSync(candidate) && candidate !== canonicalUserData) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isDirectory()) {
          const contents = fs.readdirSync(candidate);
          // Only consider valid if it has files
          if (contents.length > 0) {
            detectedLegacyPath = candidate;
            break;
          }
        }
      } catch {}
    }
  }

  // Perform migration if legacy data is found
  if (detectedLegacyPath) {
    console.info(`[Storage] Discovered legacy LeadForge data at: ${detectedLegacyPath}. Initiating migration...`);

    try {
      // 1. Copy config, session, and other root files
      const rootItems = fs.readdirSync(detectedLegacyPath);
      for (const item of rootItems) {
        if (item === 'workspaces') continue; // Handled separately with DB renaming
        const srcItem = path.join(detectedLegacyPath, item);
        const destItem = path.join(canonicalUserData, item);

        try {
          if (!fs.existsSync(destItem)) {
            const stat = fs.statSync(srcItem);
            if (stat.isDirectory()) {
              fs.cpSync(srcItem, destItem, { recursive: true, errorOnExist: false });
            } else {
              fs.copyFileSync(srcItem, destItem);
            }
          }
        } catch (err) {
          console.warn(`[Storage] Failed to copy legacy item ${item}:`, err);
        }
      }

      // 2. Migrate global database: leadforge.db -> huntara.db
      const legacyGlobalDb = path.join(detectedLegacyPath, 'leadforge.db');
      const canonicalGlobalDb = path.join(canonicalUserData, 'huntara.db');
      if (fs.existsSync(legacyGlobalDb) && !fs.existsSync(canonicalGlobalDb)) {
        try {
          fs.copyFileSync(legacyGlobalDb, canonicalGlobalDb);
          if (fs.existsSync(`${legacyGlobalDb}-wal`)) {
            fs.copyFileSync(`${legacyGlobalDb}-wal`, `${canonicalGlobalDb}-wal`);
          }
          if (fs.existsSync(`${legacyGlobalDb}-shm`)) {
            fs.copyFileSync(`${legacyGlobalDb}-shm`, `${canonicalGlobalDb}-shm`);
          }
          migratedDatabases.push('huntara.db');
        } catch (err) {
          console.warn('[Storage] Failed to migrate global database:', err);
        }
      }

      // 3. Migrate workspaces and workspace databases
      const legacyWorkspacesDir = path.join(detectedLegacyPath, 'workspaces');
      const canonicalWorkspacesDir = path.join(canonicalUserData, 'workspaces');

      if (fs.existsSync(legacyWorkspacesDir)) {
        const wsFiles = fs.readdirSync(legacyWorkspacesDir);
        for (const file of wsFiles) {
          const srcFile = path.join(legacyWorkspacesDir, file);
          const destFile = path.join(canonicalWorkspacesDir, file);

          // Copy original file if not present in destination
          if (!fs.existsSync(destFile)) {
            try {
              fs.copyFileSync(srcFile, destFile);
            } catch (err) {
              console.warn(`[Storage] Failed to copy workspace file ${file}:`, err);
            }
          }

          // Check if it's a legacy workspace database: leadforge_<workspaceId>.db
          const dbMatch = file.match(/^leadforge_([a-zA-Z0-9_-]+)\.db$/i);
          if (dbMatch && dbMatch[1]) {
            const wsId = dbMatch[1];
            const canonicalDbName = `huntara_${wsId}.db`;
            const canonicalDbPath = path.join(canonicalWorkspacesDir, canonicalDbName);

            if (!fs.existsSync(canonicalDbPath)) {
              try {
                fs.copyFileSync(srcFile, canonicalDbPath);
                if (fs.existsSync(`${srcFile}-wal`)) {
                  fs.copyFileSync(`${srcFile}-wal`, `${canonicalDbPath}-wal`);
                }
                if (fs.existsSync(`${srcFile}-shm`)) {
                  fs.copyFileSync(`${srcFile}-shm`, `${canonicalDbPath}-shm`);
                }
                migratedDatabases.push(canonicalDbName);
                console.info(`[Storage] Successfully migrated workspace DB to ${canonicalDbName}`);
              } catch (err) {
                console.warn(`[Storage] Failed to migrate workspace DB ${file} to ${canonicalDbName}:`, err);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[Storage] Error during legacy LeadForge data migration:', err);
    }
  }

  // Also check within the canonical directory itself if legacy files were copied or created earlier
  try {
    const canonicalWorkspacesDir = path.join(canonicalUserData, 'workspaces');
    if (fs.existsSync(canonicalWorkspacesDir)) {
      const files = fs.readdirSync(canonicalWorkspacesDir);
      for (const file of files) {
        const dbMatch = file.match(/^leadforge_([a-zA-Z0-9_-]+)\.db$/i);
        if (dbMatch && dbMatch[1]) {
          const wsId = dbMatch[1];
          const canonicalDbPath = path.join(canonicalWorkspacesDir, `huntara_${wsId}.db`);
          const legacyDbPath = path.join(canonicalWorkspacesDir, file);
          if (!fs.existsSync(canonicalDbPath) && fs.existsSync(legacyDbPath)) {
            try {
              fs.copyFileSync(legacyDbPath, canonicalDbPath);
              if (fs.existsSync(`${legacyDbPath}-wal`)) {
                fs.copyFileSync(`${legacyDbPath}-wal`, `${canonicalDbPath}-wal`);
              }
              if (fs.existsSync(`${legacyDbPath}-shm`)) {
                fs.copyFileSync(`${legacyDbPath}-shm`, `${canonicalDbPath}-shm`);
              }
              migratedDatabases.push(`huntara_${wsId}.db`);
            } catch {}
          }
        }
      }
    }
  } catch {}

  // Write migration marker to prevent repeated migration runs
  try {
    const markerData = {
      migratedAt: new Date().toISOString(),
      canonicalPath: canonicalUserData,
      sourcePath: detectedLegacyPath,
      migratedDatabases,
      version: '1.2.0'
    };
    fs.writeFileSync(markerPath, JSON.stringify(markerData, null, 2), 'utf8');
    console.info(`[Storage] Migration marker recorded at: ${markerPath}`);
  } catch (err) {
    console.warn('[Storage] Failed to record migration marker:', err);
  }

  return {
    canonicalUserData,
    isMigrated: !!detectedLegacyPath,
    legacySourcePath: detectedLegacyPath,
    migratedDatabases
  };
}
