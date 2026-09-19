import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface SQLiteDatabaseInfo {
  filePath: string;
  fileName: string;
  workspaceId: string;
  fileSizeBytes: number;
  lastModified: Date;
  isAccessible: boolean;
  isCorrupt: boolean;
  integrityCheckResult: string;
  userVersion: number;
  tables: Array<{
    name: string;
    rowCount: number;
  }>;
  pendingSyncCount: number;
  backupPath?: string;
}

export function getDefaultWorkspacesDirs(): string[] {
  const dirs: string[] = [];

  // Environment override
  if (process.env.WORKSPACES_DB_DIR && fs.existsSync(process.env.WORKSPACES_DB_DIR)) {
    dirs.push(path.resolve(process.env.WORKSPACES_DB_DIR));
  }

  // OS standard Electron userData path
  const platform = os.platform();
  const appNames = ['HUNTARA', 'Huntara', 'LeadForge', path.join('@leadforge', 'desktop')];
  for (const appName of appNames) {
    let appDataDir = '';
    if (platform === 'win32') {
      appDataDir = process.env.APPDATA ? path.join(process.env.APPDATA, appName, 'workspaces') : '';
    } else if (platform === 'darwin') {
      appDataDir = path.join(os.homedir(), 'Library', 'Application Support', appName, 'workspaces');
    } else {
      appDataDir = path.join(os.homedir(), '.config', appName, 'workspaces');
    }

    if (appDataDir && fs.existsSync(appDataDir) && !dirs.includes(appDataDir)) {
      dirs.push(appDataDir);
    }
  }

  // Local development workspace directories
  const localDirs = [
    path.resolve(process.cwd(), 'workspaces'),
    path.resolve(process.cwd(), 'report/temp-smoke/workspaces'),
    path.resolve(process.cwd(), 'apps/desktop/workspaces')
  ];

  for (const dir of localDirs) {
    if (fs.existsSync(dir) && !dirs.includes(dir)) {
      dirs.push(dir);
    }
  }

  return dirs;
}

export function extractWorkspaceIdFromFilename(fileName: string): string | null {
  const match = fileName.match(/^(?:leadforge|huntara)_([a-zA-Z0-9_-]+)\.db$/i);
  return match && match[1] ? match[1] : null;
}

export function inspectSQLiteDatabase(dbPath: string): SQLiteDatabaseInfo {
  const stats = fs.statSync(dbPath);
  const fileName = path.basename(dbPath);
  let workspaceId = extractWorkspaceIdFromFilename(fileName) || 'unknown';

  let db: Database.Database | null = null;
  let isAccessible = true;
  let isCorrupt = false;
  let integrityCheckResult = 'OK';
  let userVersion = 0;
  const tables: Array<{ name: string; rowCount: number }> = [];
  let pendingSyncCount = 0;

  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // 1. Integrity check
    try {
      const integrityRow: any = db.prepare('PRAGMA integrity_check').get();
      integrityCheckResult = integrityRow ? (Object.values(integrityRow)[0] as string) : 'UNKNOWN';
      if (integrityCheckResult !== 'ok' && integrityCheckResult !== 'OK') {
        isCorrupt = true;
      }
    } catch (err: any) {
      isCorrupt = true;
      integrityCheckResult = err.message;
    }

    // 2. Schema version
    try {
      const versionRow: any = db.prepare('PRAGMA user_version').get();
      userVersion = versionRow ? Number(Object.values(versionRow)[0]) : 0;
    } catch {
      userVersion = 0;
    }

    // 3. Table inventory & row counts
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;

    for (const table of tableRows) {
      try {
        const countRow: any = db.prepare(`SELECT COUNT(*) as count FROM "${table.name}"`).get();
        tables.push({
          name: table.name,
          rowCount: countRow ? Number(countRow.count) : 0
        });
      } catch {
        tables.push({ name: table.name, rowCount: -1 });
      }
    }

    // 4. Extract workspaceId from workspaces or settings table if filename was generic
    if (workspaceId === 'unknown') {
      try {
        const wsRow: any = db.prepare('SELECT id FROM workspaces LIMIT 1').get();
        if (wsRow && wsRow.id) {
          workspaceId = String(wsRow.id);
        }
      } catch {
        // Table might not exist
      }
    }

    // 5. Inspect pending sync queue
    try {
      const pendingRow: any = db
        .prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'")
        .get();
      if (pendingRow && pendingRow.count !== undefined) {
        pendingSyncCount = Number(pendingRow.count);
      }
    } catch {
      pendingSyncCount = 0;
    }
  } catch (err: any) {
    isAccessible = false;
    isCorrupt = true;
    integrityCheckResult = err.message;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }

  return {
    filePath: dbPath,
    fileName,
    workspaceId,
    fileSizeBytes: stats.size,
    lastModified: stats.mtime,
    isAccessible,
    isCorrupt,
    integrityCheckResult,
    userVersion,
    tables,
    pendingSyncCount
  };
}

export function discoverAllSQLiteDatabases(searchDirs?: string[]): SQLiteDatabaseInfo[] {
  const dirs = searchDirs && searchDirs.length > 0 ? searchDirs : getDefaultWorkspacesDirs();
  const discovered: SQLiteDatabaseInfo[] = [];
  const visitedPaths = new Set<string>();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (
        file.endsWith('.db') &&
        !file.includes('-shm') &&
        !file.includes('-wal') &&
        !file.endsWith('.bak')
      ) {
        const fullPath = path.resolve(dir, file);
        if (!visitedPaths.has(fullPath)) {
          visitedPaths.add(fullPath);
          try {
            const info = inspectSQLiteDatabase(fullPath);
            discovered.push(info);
          } catch (err) {
            console.error(`Error inspecting database at ${fullPath}:`, err);
          }
        }
      }
    }
  }

  return discovered;
}

export function createDatabaseBackup(dbPath: string, backupDir?: string): string {
  const resolvedDbPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDbPath)) {
    throw new Error(`Database file not found: ${resolvedDbPath}`);
  }

  const targetDir = backupDir ? path.resolve(backupDir) : path.dirname(resolvedDbPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = path.basename(resolvedDbPath, '.db');
  const backupFileName = `${baseName}_backup_${timestamp}.bak`;
  const backupFilePath = path.join(targetDir, backupFileName);

  // Safe read-only copy
  fs.copyFileSync(resolvedDbPath, backupFilePath);

  // Also copy WAL and SHM if they exist
  const walPath = `${resolvedDbPath}-wal`;
  const shmPath = `${resolvedDbPath}-shm`;
  if (fs.existsSync(walPath)) {
    fs.copyFileSync(walPath, `${backupFilePath}-wal`);
  }
  if (fs.existsSync(shmPath)) {
    fs.copyFileSync(shmPath, `${backupFilePath}-shm`);
  }

  return backupFilePath;
}
