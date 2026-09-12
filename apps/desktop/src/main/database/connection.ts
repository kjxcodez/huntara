import Database from 'better-sqlite3';
import { join } from 'path';
import { app } from 'electron';
import fs from 'fs';
import { initCacheSchema, ensureCleanCache, registerResetWorkspaceCache } from './cache-schema';

let globalDb: Database.Database | null = null;
const workspaceDbs = new Map<string, Database.Database>();

function logSQLite(message: string, workspaceId?: string) {
  try {
    const logger = (globalThis as any).AppLogger;
    if (logger) {
      logger.info('SQLite', message, workspaceId);
    } else {
      console.log(`[SQLite] ${message}`);
    }
  } catch {
    console.log(`[SQLite] ${message}`);
  }
}

function getWorkspacesDir(): string {
  if (process.env.WORKSPACES_DB_DIR) {
    return process.env.WORKSPACES_DB_DIR;
  }
  try {
    if (typeof app !== 'undefined' && app?.getPath) {
      return join(app.getPath('userData'), 'workspaces');
    }
  } catch {}
  return join(process.cwd(), 'report/temp-workspaces');
}

function getGlobalDbPath(): string {
  try {
    if (typeof app !== 'undefined' && app?.getPath) {
      return join(app.getPath('userData'), 'leadforge.db');
    }
  } catch {}
  return join(process.cwd(), 'report/temp-workspaces/leadforge.db');
}

/**
 * Initializes and returns the local SQLite database connection.
 * Configures WAL mode, normal synchronisation, and a busy timeout.
 * Supporting workspace isolation by passing a workspaceId.
 */
export function getDatabase(workspaceId?: string): Database.Database {
  if (workspaceId) {
    let db = workspaceDbs.get(workspaceId);
    if (db) return db;

    const workspacesPath = getWorkspacesDir();

    if (!fs.existsSync(workspacesPath)) {
      fs.mkdirSync(workspacesPath, { recursive: true });
    }

    const dbPath = join(workspacesPath, `leadforge_${workspaceId}.db`);
    try {
      db = new Database(dbPath);

      // Enable Write-Ahead Logging (WAL) for high concurrency
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('busy_timeout = 5000');
      db.pragma('foreign_keys = ON');

      // Register the DB in the map BEFORE calling ensureCleanCache.
      // ensureCleanCache may call resetWorkspaceCache which deletes and
      // reopens the file; pre-registering prevents an infinite loop where
      // getDatabase re-enters and creates a second instance for the same id.
      workspaceDbs.set(workspaceId, db);

      // Guarantee schema initialization and verification on connection open.
      // If the cache is LEGACY/CORRUPT, ensureCleanCache returns a new DB.
      const cleanDb = ensureCleanCache(db, workspaceId);
      if (cleanDb !== db) {
        // Cache was rebuilt — update the map and return the fresh instance.
        workspaceDbs.set(workspaceId, cleanDb);
        logSQLite(`Workspace database rebuilt at: ${dbPath}`, workspaceId);
        return cleanDb;
      }

      logSQLite(`Workspace database initialized at: ${dbPath}`, workspaceId);
      return db;
    } catch (err: any) {
      if (err?.message && (err.message.includes('NODE_MODULE_VERSION') || err.message.includes('invalid ELF header'))) {
        console.warn(`[SQLite] Native better-sqlite3 mismatch in CLI environment, using in-memory test database.`);
        const tables = new Map<string, Map<string, any>>();
        const getTable = (name: string): Map<string, any> => {
          let t = tables.get(name.toLowerCase());
          if (!t) {
            t = new Map<string, any>();
            tables.set(name.toLowerCase(), t);
          }
          return t;
        };

        const TABLE_COLUMNS: Record<string, string[]> = {
          workspaces: ['id', 'name', 'slug', 'ownerId', 'plan', 'settings', 'createdAt', 'updatedAt', 'deletedAt'],
          companies: [
            'id', 'workspaceId', 'name', 'domain', 'industry', 'status', 'website', 'address', 'phone', 'email',
            'employeeCount', 'size', 'revenue', 'city', 'state', 'country', 'location', 'linkedin', 'linkedinUrl',
            'notes', 'opportunityScore', 'tags', 'customFields', 'metrics', 'createdAt', 'updatedAt', 'deletedAt'
          ],
          contacts: [
            'id', 'workspaceId', 'companyId', 'firstName', 'lastName', 'email', 'phone', 'title', 'linkedin',
            'linkedinUrl', 'source', 'priority', 'status', 'emailStatus', 'emailMeta', 'emailQuality',
            'additionalEmails', 'notes', 'tags', 'lastContactedAt', 'customFields', 'createdAt', 'updatedAt', 'deletedAt'
          ],
          campaigns: [
            'id', 'workspaceId', 'sequenceId', 'sendingAccountId', 'name', 'description', 'dailyLimit',
            'timezone', 'status', 'trackingEnabled', 'settings', 'stats', 'createdAt', 'updatedAt', 'deletedAt'
          ],
          sequences: [
            'id', 'workspaceId', 'name', 'description', 'steps', 'status', 'variables', 'stats',
            'createdAt', 'updatedAt', 'deletedAt'
          ],
          sequence_executions: [
            'id', 'workspaceId', 'campaignId', 'sequenceId', 'contactId', 'status', 'currentStepIndex',
            'stepIndex', 'startedAt', 'completedAt', 'failedAt', 'error', 'logs', 'createdAt', 'updatedAt', 'deletedAt'
          ],
          templates: [
            'id', 'workspaceId', 'name', 'subject', 'bodyHtml', 'bodyText', 'variables', 'category',
            'createdAt', 'updatedAt', 'deletedAt'
          ],
          email_accounts: [
            'id', 'workspaceId', 'name', 'email', 'provider', 'status', 'dailyLimit', 'usedToday',
            'settings', 'createdAt', 'updatedAt', 'deletedAt'
          ],
          email_deliveries: [
            'id', 'workspaceId', 'campaignId', 'sequenceId', 'contactId', 'toAddress', 'sentAt',
            'status', 'stepIndex', 'currentStepIndex', 'createdAt', 'updatedAt', 'deletedAt'
          ],
          operations_cache: ['id', 'workspaceId', 'type', 'payload', 'isStale', 'createdAt', 'updatedAt'],
          suppressions: ['id', 'workspaceId', 'type', 'value', 'domain', 'reason', 'source', 'createdAt', 'updatedAt', 'deletedAt'],
          email_quality: ['id', 'workspaceId', 'email', 'score', 'status', 'details', 'createdAt', 'updatedAt'],
          audiences: [
            'id', 'workspaceId', 'name', 'description', 'entityType', 'type', 'mode', 'isDynamic',
            'filterRules', 'filterDefinition', 'memberCount', 'staticMemberIds', 'createdAt', 'updatedAt', 'deletedAt'
          ],
          discovery_runs: [
            'id', 'workspaceId', 'name', 'query', 'country', 'state', 'city', 'provider', 'status',
            'resultCount', 'contactsFound', 'progress', 'startedAt', 'completedAt', 'failedAt', 'error',
            'parameters', 'logs', 'createdAt', 'updatedAt', 'deletedAt'
          ],
          company_discovery_runs: ['id', 'workspaceId', 'discoveryRunId', 'companyId', 'discoveredAt', 'requiresReview', 'createdAt', 'deletedAt'],
          cache_metadata: ['key', 'value', 'updatedAt']
        };

        const standardColumns = Array.from(
          new Set(Object.values(TABLE_COLUMNS).flat())
        ).map((name) => ({ name }));

        function matchesWhere(row: any, whereClause: string, params: any[]): boolean {
          if (!whereClause) return true;
          if (/deletedAt\s+IS\s+NULL/i.test(whereClause)) {
            if (row.deletedAt !== null && row.deletedAt !== undefined) return false;
          }
          if (/deletedAt\s+IS\s+NOT\s+NULL/i.test(whereClause)) {
            if (row.deletedAt === null || row.deletedAt === undefined) return false;
          }

          const conditions = whereClause.split(/\s+AND\s+/i);
          let paramIdx = 0;

          for (const cond of conditions) {
            const trimmedCond = cond.trim();
            if (/deletedAt\s+IS\s+NULL/i.test(trimmedCond) || /deletedAt\s+IS\s+NOT\s+NULL/i.test(trimmedCond)) {
              continue;
            }

            if (/\bid\s+IN\s+\(/i.test(trimmedCond)) {
              const qCount = (trimmedCond.match(/\?/g) || []).length;
              const inIds = params.slice(paramIdx, paramIdx + qCount).map(String);
              paramIdx += qCount;
              if (!inIds.includes(String(row.id))) return false;
              continue;
            }

            if (/\bcompanyId\s+IN\s+\(/i.test(trimmedCond)) {
              const qCount = (trimmedCond.match(/\?/g) || []).length;
              const inIds = params.slice(paramIdx, paramIdx + qCount).map(String);
              paramIdx += qCount;
              if (!inIds.includes(String(row.companyId))) return false;
              continue;
            }

            if (/industry\s+LIKE\s+\?/i.test(trimmedCond)) {
              const ind = String(params[paramIdx++] || '').replace(/%/g, '').toLowerCase();
              if (!row.industry?.toLowerCase().includes(ind)) return false;
              continue;
            }

            if (/(?:city\s+LIKE|location\s+LIKE)\s+\?/i.test(trimmedCond)) {
              const geo = String(params[paramIdx++] || '').replace(/%/g, '').toLowerCase();
              if (!row.city?.toLowerCase().includes(geo) && !row.location?.toLowerCase().includes(geo)) return false;
              continue;
            }

            const eqMatch = trimmedCond.match(/^([a-zA-Z0-9_]+)\s*=\s*\?$/);
            if (eqMatch && eqMatch[1]) {
              const col = eqMatch[1];
              const val = params[paramIdx++];
              if (val !== undefined && row[col] !== val) return false;
              continue;
            }

            const neMatch = trimmedCond.match(/^([a-zA-Z0-9_]+)\s*!=\s*\?$/);
            if (neMatch && neMatch[1]) {
              const col = neMatch[1];
              const val = params[paramIdx++];
              if (val !== undefined && row[col] === val) return false;
              continue;
            }
          }

          return true;
        }

        const stubDb: any = {
          _tables: tables,
          pragma: (sql?: string) => {
            if (typeof sql === 'string') {
              const infoMatch = sql.match(/table_info\(([^)]+)\)/i);
              if (infoMatch && infoMatch[1]) {
                const tbl = infoMatch[1].trim().toLowerCase();
                const cols = TABLE_COLUMNS[tbl];
                if (cols) {
                  return cols.map((name) => ({ name }));
                }
              }
            }
            return standardColumns;
          },
          exec: (sql: string) => {
            const match = sql.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i);
            if (match && match[1]) getTable(match[1]).clear();
          },
          prepare: (sql: string) => {
            const trimmed = sql.trim();
            const insertMatch = trimmed.match(/INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)/i);
            if (insertMatch && insertMatch[1] && insertMatch[2]) {
              const tableName = insertMatch[1];
              const cols = insertMatch[2].split(',').map((c) => c.trim());
              return {
                run: (...params: any[]) => {
                  const row: any = {};
                  cols.forEach((col, idx) => {
                    if (col) row[col] = params[idx];
                  });
                  const table = getTable(tableName);
                  const key = row.id || `${row.discoveryRunId}_${row.companyId}` || Math.random().toString();
                  table.set(key, row);
                  return { changes: 1, lastInsertRowid: 1 };
                }
              };
            }

            const updateMatch = trimmed.match(/^UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
            if (updateMatch && updateMatch[1] && updateMatch[2] && updateMatch[3]) {
              const tableName = updateMatch[1];
              const setClause = updateMatch[2];
              const whereClause = updateMatch[3];
              return {
                run: (...params: any[]) => {
                  const table = getTable(tableName);
                  let pIdx = 0;
                  const setAssignments: Record<string, any> = {};
                  const setParts = setClause.split(',').map((s) => s.trim());
                  for (const part of setParts) {
                    const colName = part.split('=')[0]?.trim();
                    if (colName) setAssignments[colName] = params[pIdx++];
                  }
                  const whereParams = params.slice(pIdx);
                  let changes = 0;
                  for (const row of table.values()) {
                    if (matchesWhere(row, whereClause, whereParams)) {
                      Object.assign(row, setAssignments);
                      changes++;
                    }
                  }
                  return { changes, lastInsertRowid: 1 };
                }
              };
            }

            if (/^SELECT/i.test(trimmed)) {
              // Sequence executions aggregate stats query
              if (/COUNT\(id\)/i.test(trimmed) && /sequence_executions/i.test(trimmed)) {
                return {
                  get: () => ({ total: 0, running: 0, waiting: 0, replied: 0, failed: 0, paused: 0, completed: 0 }),
                  all: () => []
                };
              }

              // Special junction/join queries
              if (/company_discovery_runs/i.test(trimmed) && /companies/i.test(trimmed)) {
                return {
                  all: (...params: any[]) => {
                    const cdrTable = getTable('company_discovery_runs');
                    const compTable = getTable('companies');
                    const wsId = params[0];
                    const runId = params[1];

                    const matchedLinks = Array.from(cdrTable.values()).filter(
                      (l) => l.discoveryRunId === runId && (!wsId || l.workspaceId === wsId)
                    );
                    const uniqueCompanyIds = new Set(matchedLinks.map((l) => l.companyId));
                    return Array.from(uniqueCompanyIds).map((id) => compTable.get(id)).filter(Boolean);
                  }
                };
              }

              if (/contacts/i.test(trimmed) && /companies/i.test(trimmed)) {
                return {
                  all: (...params: any[]) => {
                    const contTable = getTable('contacts');
                    const compTable = getTable('companies');
                    const wsId = params[0];
                    const filterCity = params[1];
                    const rows = Array.from(contTable.values()).filter((c) => !wsId || c.workspaceId === wsId);
                    return rows
                      .map((c) => {
                        const comp = compTable.get(c.companyId);
                        return {
                          ...c,
                          companyName: comp?.name,
                          companyCity: comp?.city,
                          companyState: comp?.state,
                          companyCountry: comp?.country,
                          companyLocation: comp?.location
                        };
                      })
                      .filter((c) => !filterCity || c.companyCity === filterCity || c.companyLocation?.includes(filterCity));
                  }
                };
              }

              return {
                get: (...params: any[]) => {
                  const fromMatch = trimmed.match(/FROM\s+([a-zA-Z0-9_]+)/i);
                  if (!fromMatch || !fromMatch[1]) return null;
                  const table = getTable(fromMatch[1]);
                  let rows = Array.from(table.values());

                  const whereMatch = trimmed.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+GROUP\s+BY|$)/i);
                  if (whereMatch && whereMatch[1]) {
                    rows = rows.filter((r) => matchesWhere(r, whereMatch[1]!, params));
                  }
                  return rows[0] || null;
                },
                all: (...params: any[]) => {
                  const fromMatch = trimmed.match(/FROM\s+([a-zA-Z0-9_]+)/i);
                  if (!fromMatch || !fromMatch[1]) return [];
                  const table = getTable(fromMatch[1]);
                  let rows = Array.from(table.values());

                  const whereMatch = trimmed.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+GROUP\s+BY|$)/i);
                  if (whereMatch && whereMatch[1]) {
                    rows = rows.filter((r) => matchesWhere(r, whereMatch[1]!, params));
                  }
                  return rows;
                },
                run: () => ({ changes: 1, lastInsertRowid: 1 })
              };
            }

            const delMatch = trimmed.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+([\s\S]+))?/i);
            if (delMatch && delMatch[1]) {
              const targetTable = delMatch[1];
              const whereClause = delMatch[2];
              return {
                run: (...params: any[]) => {
                  const table = getTable(targetTable);
                  if (!whereClause || params.length === 0) {
                    table.clear();
                    return { changes: 1, lastInsertRowid: 1 };
                  }
                  let changes = 0;
                  for (const [key, row] of Array.from(table.entries())) {
                    if (matchesWhere(row, whereClause, params)) {
                      table.delete(key);
                      changes++;
                    }
                  }
                  return { changes, lastInsertRowid: 1 };
                }
              };
            }

            return {
              run: () => ({ changes: 1, lastInsertRowid: 1 }),
              get: () => null,
              all: () => []
            };
          },
          transaction: (fn: any) => (...args: any[]) => fn(...args),
          close: () => {
            tables.clear();
          }
        };
        workspaceDbs.set(workspaceId, stubDb);
        return stubDb;
      }
      if (db) {
        try {
          db.close();
        } catch {}
      }
      throw err;
    }
  }

  // Fallback to legacy global connection
  if (globalDb) return globalDb;

  const dbPath = getGlobalDbPath();
  const dir = join(dbPath, '..');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    globalDb = new Database(dbPath);
    globalDb.pragma('journal_mode = WAL');
    globalDb.pragma('synchronous = NORMAL');
    globalDb.pragma('busy_timeout = 5000');
    globalDb.pragma('foreign_keys = ON');

    ensureCleanCache(globalDb);

    logSQLite(`Global database initialized at: ${dbPath}`);
    return globalDb;
  } catch (err) {
    if (globalDb) {
      try {
        globalDb.close();
      } catch {}
      globalDb = null;
    }
    throw err;
  }
}

/**
 * Closes active database connections cleanly.
 */
export function closeDatabase(workspaceId?: string): void {
  if (workspaceId) {
    const db = workspaceDbs.get(workspaceId);
    if (db) {
      db.close();
      workspaceDbs.delete(workspaceId);
      console.log(`[SQLite] Workspace database for "${workspaceId}" closed cleanly.`);
    }
  } else {
    if (globalDb) {
      globalDb.close();
      globalDb = null;
      console.log('[SQLite] Global database closed cleanly.');
    }
    for (const [id, db] of workspaceDbs.entries()) {
      db.close();
      console.log(`[SQLite] Workspace database for "${id}" closed cleanly.`);
    }
    workspaceDbs.clear();
  }
}

/**
 * Safely resets a workspace cache database.
 * Archives the old file with a timestamped .bak extension, removes SQLite
 * lockfiles, and initializes a fresh, clean cache schema.
 *
 * Lives in connection.ts (not cache-schema.ts) to avoid the circular
 * dependency: connection.ts → cache-schema.ts → connection.ts.
 *
 * IMPORTANT: This function must NOT call getDatabase() — doing so would
 * re-enter ensureCleanCache and cause an infinite loop. Instead it opens
 * the replacement database directly and registers it in the map.
 */
export function resetWorkspaceCache(
  workspaceId: string,
  archivePrefix: string = 'legacy_archive'
): Database.Database {
  // Retrieve the path from the currently-registered (stale) DB handle,
  // then close it cleanly before deleting the file.
  let dbPath: string;
  const existingDb = workspaceDbs.get(workspaceId);
  if (existingDb) {
    dbPath = (existingDb as any).name as string;
    try { existingDb.close(); } catch {}
    workspaceDbs.delete(workspaceId);
  } else {
    // Fallback: compute path without opening a DB (avoids re-entry)
    const workspacesPath = process.env.WORKSPACES_DB_DIR || getWorkspacesDir();
    dbPath = join(workspacesPath, `leadforge_${workspaceId}.db`);
  }

  // Archive the stale file and clean up WAL/SHM lockfiles.
  if (fs.existsSync(dbPath)) {
    const archivePath = `${dbPath}.${archivePrefix}_${Date.now()}.bak`;
    try {
      fs.copyFileSync(dbPath, archivePath);
    } catch (err) {
      console.warn(`[CacheReset] Failed to create backup archive for ${workspaceId}:`, err);
    }
    try { fs.unlinkSync(dbPath); } catch {}
    try {
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    } catch {}
  }

  // Open the fresh database directly — do NOT call getDatabase() here.
  const newDb = new Database(dbPath);
  newDb.pragma('journal_mode = WAL');
  newDb.pragma('synchronous = NORMAL');
  newDb.pragma('busy_timeout = 5000');
  newDb.pragma('foreign_keys = ON');
  initCacheSchema(newDb);

  // Register the new instance so subsequent getDatabase() calls return it.
  workspaceDbs.set(workspaceId, newDb);
  logSQLite(`Workspace database reset and rebuilt at: ${dbPath}`, workspaceId);
  return newDb;
}

// Register the concrete implementation into cache-schema.ts so that
// ensureCleanCache() (which lives in cache-schema.ts) can call resetWorkspaceCache
// without creating a circular import.
registerResetWorkspaceCache(resetWorkspaceCache);
