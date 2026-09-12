import { getDatabase } from '../connection';
import { initCacheSchema, CACHE_TABLES } from '../cache-schema';

/**
 * Columns that are stored as JSON strings in SQLite (serialized objects/arrays).
 * When reading records from SQLite, these columns are automatically parsed back
 * into their native JS types so consumers receive clean objects.
 */
const JSON_COLUMNS = new Set([
  'tags',
  'notes',
  'steps',
  'variables',
  'attachments',
  'logs',
  'contactsJson',
  'statisticsJson',
  'executionContext',
  'metadata',
  'filterDefinition',
  'filterRules',
  'staticMemberIds',
  'settings',
  'stats',
  'customFields',
  'metrics',
  'triggers'
]);

/**
 * Parses JSON_COLUMNS fields from string back to JS objects/arrays.
 */
function parseJsonFields(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const result = { ...row };
  for (const field of JSON_COLUMNS) {
    if (typeof result[field] === 'string') {
      try {
        result[field] = JSON.parse(result[field]);
      } catch {
        // Value is a plain string, not JSON — leave as-is
      }
    }
  }
  return result;
}

/**
 * Serializes JS objects/arrays into JSON strings for SQLite storage.
 */
function serializeFieldValue(val: any): any {
  if (val === undefined || val === null) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') return JSON.stringify(val);
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

/**
 * CacheRepository (also exported as LocalCRMRepository) implements high-speed,
 * disposable SQLite read/write caching operations for desktop workspace views.
 * 
 * Absolute Invariants:
 *  - SQLite is NEVER authoritative; all writes originate from server/API success.
 *  - Zero writes to sync_queue.
 *  - Zero syncStatus / dirty flags.
 *  - Exactly matches MongoDB string identity (SQLite.id === Mongo._id).
 */
export const LocalCRMRepository = {
  /**
   * Finds records in a table, strictly isolated by workspaceId and optional column filters.
   */
  async findMany(
    tableName: string,
    workspaceId: string,
    filter?: Record<string, any>
  ): Promise<any[]> {
    const db = getDatabase(workspaceId);

    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }

    const tableInfo = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
    const hasDeletedAt = tableInfo.some((col) => col.name === 'deletedAt');

    let query = `SELECT * FROM ${tableName} WHERE workspaceId = ?`;
    if (hasDeletedAt) {
      query += ` AND deletedAt IS NULL`;
    }
    const params: any[] = [workspaceId];

    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        if (value !== undefined && /^[a-zA-Z0-9_]+$/.test(key)) {
          query += ` AND ${key} = ?`;
          params.push(value);
        }
      }
    }

    try {
      return (db.prepare(query).all(...params) as any[]).map(parseJsonFields);
    } catch (err) {
      console.warn(`[CacheRepository] findMany error on ${tableName}:`, err);
      return [];
    }
  },

  /**
   * Finds a single record by ID.
   */
  async findById(tableName: string, workspaceId: string, id: string): Promise<any | null> {
    const db = getDatabase(workspaceId);
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error(`Invalid table: ${tableName}`);

    const tableInfo = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
    const hasDeletedAt = tableInfo.some((col) => col.name === 'deletedAt');

    let query = `SELECT * FROM ${tableName} WHERE id = ?`;
    if (hasDeletedAt) {
      query += ` AND deletedAt IS NULL`;
    }

    try {
      const row = db.prepare(query).get(id);
      return row ? parseJsonFields(row) : null;
    } catch (err) {
      console.warn(`[CacheRepository] findById error on ${tableName} (${id}):`, err);
      return null;
    }
  },

  /**
   * Saves a single authoritative server document directly into SQLite cache.
   * Completely bypasses any sync queue (server is the sole authority).
   */
  async saveFromServer(tableName: string, record: any): Promise<any> {
    if (!record || typeof record !== 'object') return record;

    try {
      const workspaceId = record.workspaceId;
      if (!workspaceId) return record;

      const db = getDatabase(workspaceId);
      if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error(`Invalid table: ${tableName}`);

      const doc = typeof record.toObject === 'function' ? record.toObject() : { ...record };
      if (doc._id && !doc.id) {
        doc.id = typeof doc._id === 'object' ? doc._id.toString() : String(doc._id);
      }
      delete doc._id;
      delete doc.__v;

      const tableInfo = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
      const validColumns = new Set(tableInfo.map((col) => col.name));

      const columns = Object.keys(doc).filter(
        (col) => validColumns.has(col) && /^[a-zA-Z0-9_]+$/.test(col)
      );

      if (columns.length === 0 || !validColumns.has('id')) {
        return record;
      }

      const placeholders = columns.map(() => '?').join(', ');
      const query = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

      const params = columns.map((col) => serializeFieldValue(doc[col]));
      db.prepare(query).run(...params);

      return doc;
    } catch (err) {
      console.warn(
        `[CacheRepository] Warning: Failed to update cache for ${tableName} (${record?.id || record?._id}):`,
        err
      );
      return record;
    }
  },

  /**
   * Bulk updates SQLite cache from an array of authoritative server documents.
   * Executes inside a single SQLite transaction for maximum throughput.
   */
  async saveManyFromServer(tableName: string, records: any[]): Promise<void> {
    if (!records || !Array.isArray(records) || records.length === 0) return;

    try {
      const workspaceId = records[0].workspaceId;
      if (!workspaceId) return;

      const db = getDatabase(workspaceId);
      if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error(`Invalid table: ${tableName}`);

      const tableInfo = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
      const validColumns = new Set(tableInfo.map((col) => col.name));

      if (!validColumns.has('id')) return;

      const normalizedList = records.map((r) => {
        const doc = typeof r.toObject === 'function' ? r.toObject() : { ...r };
        if (doc._id && !doc.id) {
          doc.id = typeof doc._id === 'object' ? doc._id.toString() : String(doc._id);
        }
        delete doc._id;
        delete doc.__v;
        return doc;
      });

      const allKeys = new Set<string>();
      for (const item of normalizedList) {
        for (const k of Object.keys(item)) {
          if (validColumns.has(k) && /^[a-zA-Z0-9_]+$/.test(k)) {
            allKeys.add(k);
          }
        }
      }
      const columns = Array.from(allKeys);

      if (columns.length === 0) return;

      const placeholders = columns.map(() => '?').join(', ');
      const insertOrReplace = db.prepare(
        `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
      );

      const batchTx = db.transaction((items: any[]) => {
        for (const item of items) {
          const params = columns.map((col) => serializeFieldValue(item[col]));
          insertOrReplace.run(...params);
        }
      });

      batchTx(normalizedList);
    } catch (err) {
      console.warn(`[CacheRepository] Warning: Failed to bulk update cache for ${tableName}:`, err);
    }
  },

  /**
   * Soft-deletes a cached record following authoritative server deletion.
   */
  async softDeleteFromServer(tableName: string, workspaceId: string, id: string): Promise<void> {
    try {
      const db = getDatabase(workspaceId);
      if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error(`Invalid table: ${tableName}`);

      const tableInfo = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
      const hasDeletedAt = tableInfo.some((col) => col.name === 'deletedAt');

      if (hasDeletedAt) {
        db.prepare(`UPDATE ${tableName} SET deletedAt = ? WHERE id = ?`).run(
          new Date().toISOString(),
          id
        );
      } else {
        db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
      }
    } catch (err) {
      console.warn(`[CacheRepository] Warning: Failed to soft-delete cached ${tableName} (${id}):`, err);
    }
  },

  /**
   * Hard-deletes a record from SQLite cache.
   */
  async deleteFromServer(tableName: string, workspaceId: string, id: string): Promise<void> {
    try {
      const db = getDatabase(workspaceId);
      if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error(`Invalid table: ${tableName}`);

      db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
    } catch (err) {
      console.warn(`[CacheRepository] Warning: Failed to delete cached ${tableName} (${id}):`, err);
    }
  },

  /**
   * Authoritatively reconciles a local SQLite table against a set of server documents.
   * 1. Upserts all incoming authoritative records into SQLite.
   * 2. Soft-deletes (or hard-deletes if no deletedAt) any active records in SQLite for this workspace
   *    that are absent from authoritativeRecords.
   * 3. Fully idempotent and workspace-scoped.
   * Returns the count of upserted and tombstoned records.
   */
  async reconcileTableFromServer(
    tableName: string,
    workspaceId: string,
    authoritativeRecords: any[]
  ): Promise<{ upserted: number; tombstoned: number }> {
    if (!workspaceId) throw new Error('workspaceId is required for reconciliation');
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error(`Invalid table: ${tableName}`);

    const db = getDatabase(workspaceId);
    const tableInfo = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
    const validColumns = new Set(tableInfo.map((col) => col.name));
    const hasWorkspaceId = validColumns.has('workspaceId');
    const hasDeletedAt = validColumns.has('deletedAt');

    const authoritativeList = Array.isArray(authoritativeRecords) ? authoritativeRecords : [];

    // Ensure all incoming records carry workspaceId
    const scopedAuthoritative = authoritativeList.map((r) => {
      const doc = typeof r?.toObject === 'function' ? r.toObject() : { ...r };
      if (!doc.workspaceId && hasWorkspaceId) {
        doc.workspaceId = workspaceId;
      }
      return doc;
    });

    // 1. Upsert live records
    if (scopedAuthoritative.length > 0) {
      await this.saveManyFromServer(tableName, scopedAuthoritative);
    }

    // 2. Identify active records in SQLite for this workspace
    let activeQuery = `SELECT id FROM ${tableName}`;
    const whereClauses: string[] = [];
    const whereParams: any[] = [];

    if (hasWorkspaceId) {
      whereClauses.push('workspaceId = ?');
      whereParams.push(workspaceId);
    }
    if (hasDeletedAt) {
      whereClauses.push('deletedAt IS NULL');
    }
    if (whereClauses.length > 0) {
      activeQuery += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    const localRows = db.prepare(activeQuery).all(...whereParams) as Array<{ id: string }>;

    // Collect IDs from authoritative list (handling doc._id and doc.id)
    const serverIdSet = new Set<string>();
    for (const r of authoritativeList) {
      const id = r?.id ?? (r?._id ? (typeof r._id === 'object' ? r._id.toString() : String(r._id)) : null);
      if (id) {
        serverIdSet.add(String(id));
      }
    }

    // Determine IDs in SQLite that no longer exist on server
    const idsToTombstone = localRows
      .map((row) => String(row.id))
      .filter((id) => !serverIdSet.has(id));

    let tombstonedCount = 0;
    if (idsToTombstone.length > 0) {
      const now = new Date().toISOString();
      const chunkSize = 500; // Well below SQLite parameter limits

      const tombstoneTx = db.transaction((ids: string[]) => {
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const placeholders = chunk.map(() => '?').join(', ');
          if (hasDeletedAt) {
            db.prepare(`UPDATE ${tableName} SET deletedAt = ? WHERE id IN (${placeholders})`).run(now, ...chunk);
          } else {
            db.prepare(`DELETE FROM ${tableName} WHERE id IN (${placeholders})`).run(...chunk);
          }
          tombstonedCount += chunk.length;
        }
      });

      tombstoneTx(idsToTombstone);
    }

    return {
      upserted: scopedAuthoritative.length,
      tombstoned: tombstonedCount
    };
  },

  /**
   * Clears all cached rows in a specific table for a workspace.
   */
  async clearTable(tableName: string, workspaceId: string): Promise<void> {
    try {
      const db = getDatabase(workspaceId);
      if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error(`Invalid table: ${tableName}`);

      db.prepare(`DELETE FROM ${tableName} WHERE workspaceId = ?`).run(workspaceId);
    } catch (err) {
      console.warn(`[CacheRepository] Warning: Failed to clear cache table ${tableName}:`, err);
    }
  },

  /**
   * Completely resets and re-initializes all cache tables for a workspace.
   */
  async resetCache(workspaceId: string): Promise<void> {
    try {
      const db = getDatabase(workspaceId);
      db.transaction(() => {
        for (const table of CACHE_TABLES) {
          try {
            db.prepare(`DELETE FROM ${table}`).run();
          } catch {}
        }
      })();
      initCacheSchema(db);
      console.log(`[CacheRepository] Cache reset successfully for workspace: ${workspaceId}`);
    } catch (err) {
      console.warn(`[CacheRepository] Warning: Failed to reset cache for workspace ${workspaceId}:`, err);
    }
  },

  /**
   * Compatibility alias for saveFromServer.
   */
  async save(tableName: string, record: any, _skipQueue = true): Promise<any> {
    return this.saveFromServer(tableName, record);
  },

  /**
   * Compatibility alias for saveManyFromServer.
   */
  async saveMany(tableName: string, records: any[], _skipQueue = true): Promise<void> {
    return this.saveManyFromServer(tableName, records);
  },

  /**
   * Compatibility alias for softDeleteFromServer.
   */
  async delete(tableName: string, workspaceId: string, id: string): Promise<void> {
    return this.softDeleteFromServer(tableName, workspaceId, id);
  },

  /**
   * Compatibility alias for softDeleteFromServer.
   */
  async softDelete(tableName: string, workspaceId: string, id: string): Promise<void> {
    return this.softDeleteFromServer(tableName, workspaceId, id);
  },

  /**
   * Compatibility alias for deleteFromServer (hard delete).
   */
  async hardDelete(tableName: string, workspaceId: string, id: string): Promise<void> {
    return this.deleteFromServer(tableName, workspaceId, id);
  }
};

export const CacheRepository = LocalCRMRepository;
