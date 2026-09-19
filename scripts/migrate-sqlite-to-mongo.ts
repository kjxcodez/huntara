import Database from 'better-sqlite3';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  MIGRATION_TABLE_ORDER,
  IGNORED_SQLITE_TABLES,
  TableMigrationConfig
} from './migration-manifest.js';
import {
  discoverAllSQLiteDatabases,
  inspectSQLiteDatabase,
  createDatabaseBackup,
  SQLiteDatabaseInfo
} from './sqlite-discovery.js';

dotenv.config({ path: path.resolve(process.cwd(), 'apps/api/.env') });

const rawUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/leadforge-os';

function maskUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return uri.replace(/:([^@]+)@/, ':****@');
  }
}

export interface MigrationOptions {
  mode: 'dry-run' | 'execute';
  workspaceId?: string;
  databasePath?: string;
  allDatabases?: boolean;
  limit?: number;
  verbose?: boolean;
  backupConfirmed?: boolean;
  resume?: boolean;
  outputDir?: string;
}

export interface QuarantinedRecord {
  workspaceId: string;
  sourceTable: string;
  sourceId: string;
  targetCollection: string;
  reason: string;
  details?: any;
  rowSample?: any;
}

export interface TableMigrationStats {
  table: string;
  collection: string;
  sqliteSourceCount: number;
  mongoBeforeCount: number;
  inserted: number;
  updated: number;
  preservedMongo: number;
  quarantined: number;
  errors: number;
}

export interface WorkspaceMigrationResult {
  workspaceId: string;
  dbPath: string;
  backupPath?: string;
  tables: Record<string, TableMigrationStats>;
  totalExtracted: number;
  totalInserted: number;
  totalUpdated: number;
  totalPreserved: number;
  totalQuarantined: number;
  pendingSyncProcessed: number;
  durationMs: number;
}

export class SQLiteToMongoMigrator {
  private options: MigrationOptions;
  private quarantined: QuarantinedRecord[] = [];

  constructor(options: MigrationOptions) {
    this.options = options;
  }

  public async run(): Promise<{
    results: WorkspaceMigrationResult[];
    diagnosticsPath: string;
    quarantinePath?: string;
  }> {
    const startTime = Date.now();
    const isExecute = this.options.mode === 'execute';

    console.log(`\n===============================================================`);
    console.log(`LEADFORGE OS — SQLITE TO MONGODB DATA MIGRATION`);
    console.log(`===============================================================`);
    console.log(
      `  Mode:               ${isExecute ? 'EXECUTE (MUTATING)' : 'DRY RUN (READ-ONLY)'}`
    );
    console.log(`  Target Database:    ${maskUri(rawUri)}`);
    console.log(`  Timestamp:          ${new Date().toISOString()}`);
    console.log(`---------------------------------------------------------------\n`);

    if (isExecute && !this.options.backupConfirmed) {
      throw new Error(
        'Migration execution requires explicit confirmation flag: --backup-confirmed'
      );
    }

    // Connect to MongoDB
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(rawUri);
    }
    const db = mongoose.connection.db!;

    // 1. Discover databases
    let databases: SQLiteDatabaseInfo[] = [];
    if (this.options.databasePath) {
      const resolved = path.resolve(this.options.databasePath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Specified SQLite database does not exist: ${resolved}`);
      }
      databases = [inspectSQLiteDatabase(resolved)];
    } else {
      databases = discoverAllSQLiteDatabases();
    }

    if (this.options.workspaceId) {
      databases = databases.filter((d) => d.workspaceId === this.options.workspaceId);
    }

    if (databases.length === 0) {
      console.log('⚠️ No eligible SQLite databases found for migration.');
      return { results: [], diagnosticsPath: '' };
    }

    console.log(`Found ${databases.length} SQLite database(s) for migration:`);
    for (const d of databases) {
      console.log(
        `  • [${d.workspaceId}] at ${d.filePath} (${(d.fileSizeBytes / 1024).toFixed(1)} KB, ${d.tables.length} tables, ${d.pendingSyncCount} pending syncs)`
      );
    }
    console.log('');

    const results: WorkspaceMigrationResult[] = [];

    // 2. Process each workspace database
    for (const dbInfo of databases) {
      if (dbInfo.isCorrupt) {
        console.error(
          `❌ Skipping corrupt database at ${dbInfo.filePath} (${dbInfo.integrityCheckResult})`
        );
        this.quarantined.push({
          workspaceId: dbInfo.workspaceId,
          sourceTable: '*',
          sourceId: '*',
          targetCollection: '*',
          reason: `Corrupt SQLite database: ${dbInfo.integrityCheckResult}`,
          details: { filePath: dbInfo.filePath }
        });
        continue;
      }

      const wsResult = await this.migrateWorkspaceDatabase(dbInfo, isExecute, db);
      results.push(wsResult);
    }

    // 3. Write diagnostic and quarantine outputs
    const outputDir = this.options.outputDir || process.cwd();
    const timestamp = Date.now();
    const diagnosticsPath = path.join(outputDir, `migration-diagnostics-${timestamp}.json`);
    const quarantinePath = path.join(outputDir, `migration-quarantine-${timestamp}.json`);

    const diagnosticsData = {
      timestamp: new Date().toISOString(),
      mode: this.options.mode,
      durationMs: Date.now() - startTime,
      databasesDiscovered: databases.length,
      databasesProcessed: results.length,
      quarantinedCount: this.quarantined.length,
      results
    };

    fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnosticsData, null, 2), 'utf-8');
    console.log(`\nDiagnostics written to: ${diagnosticsPath}`);

    if (this.quarantined.length > 0) {
      fs.writeFileSync(quarantinePath, JSON.stringify(this.quarantined, null, 2), 'utf-8');
      console.log(`Quarantine report written to: ${quarantinePath}`);
    }

    // Summary output
    console.log(`\n===============================================================`);
    console.log(`MIGRATION SUMMARY (${isExecute ? 'EXECUTE' : 'DRY RUN'})`);
    console.log(`===============================================================`);
    let totalExtracted = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalPreserved = 0;
    let totalQuarantined = this.quarantined.length;

    for (const r of results) {
      totalExtracted += r.totalExtracted;
      totalInserted += r.totalInserted;
      totalUpdated += r.totalUpdated;
      totalPreserved += r.totalPreserved;
    }

    console.log(`  Databases Processed:  ${results.length}`);
    console.log(`  Records Extracted:    ${totalExtracted}`);
    console.log(`  Records Inserted:     ${totalInserted}`);
    console.log(`  Records Updated:      ${totalUpdated}`);
    console.log(`  Records Preserved:    ${totalPreserved}`);
    console.log(`  Records Quarantined:  ${totalQuarantined}`);
    console.log(`  Duration:             ${Date.now() - startTime}ms`);
    console.log(`===============================================================\n`);

    return {
      results,
      diagnosticsPath,
      quarantinePath: this.quarantined.length > 0 ? quarantinePath : undefined
    };
  }

  private async migrateWorkspaceDatabase(
    dbInfo: SQLiteDatabaseInfo,
    isExecute: boolean,
    mongoDb: mongoose.mongo.Db
  ): Promise<WorkspaceMigrationResult> {
    const wsStartTime = Date.now();
    const wsId = dbInfo.workspaceId;
    console.log(`▶ Processing Workspace [${wsId}] from ${path.basename(dbInfo.filePath)}...`);

    // Create safe snapshot backup if in execute mode
    let backupPath: string | undefined;
    if (isExecute) {
      backupPath = createDatabaseBackup(dbInfo.filePath);
      console.log(`  ✓ Safe snapshot backup created: ${path.basename(backupPath)}`);
    }

    // Open read-only SQLite connection
    const sqlite = new Database(dbInfo.filePath, { readonly: true });
    const existingSqliteTables = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r: any) => r.name)
    );

    // Read pending sync queue item IDs
    const pendingSyncIds = new Set<string>();
    if (existingSqliteTables.has('sync_queue')) {
      try {
        const pendingRows = sqlite
          .prepare("SELECT entityId FROM sync_queue WHERE status = 'pending'")
          .all() as any[];
        for (const row of pendingRows) {
          if (row.entityId) pendingSyncIds.add(String(row.entityId));
        }
      } catch {}
    }

    const tableStats: Record<string, TableMigrationStats> = {};
    let totalExtracted = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalPreserved = 0;
    let totalQuarantined = 0;

    // Track successfully migrated IDs in this workspace for progressive foreign-key resolution
    const migratedIdsByTable = new Map<string, Set<string>>();

    for (const config of MIGRATION_TABLE_ORDER) {
      if (!existingSqliteTables.has(config.sqliteTable)) {
        continue;
      }

      const collectionName = config.mongoCollection;
      const mongoCol = mongoDb.collection(collectionName);
      const mongoBeforeCount = await mongoCol.countDocuments({ workspaceId: wsId });

      let countQuery = `SELECT COUNT(*) as count FROM "${config.sqliteTable}"`;
      let sourceCount = 0;
      try {
        const countRow: any = sqlite.prepare(countQuery).get();
        sourceCount = countRow ? Number(countRow.count) : 0;
      } catch {
        continue;
      }

      const stats: TableMigrationStats = {
        table: config.sqliteTable,
        collection: collectionName,
        sqliteSourceCount: sourceCount,
        mongoBeforeCount,
        inserted: 0,
        updated: 0,
        preservedMongo: 0,
        quarantined: 0,
        errors: 0
      };

      if (sourceCount === 0) {
        tableStats[config.sqliteTable] = stats;
        continue;
      }

      // Stream / paginate rows from SQLite in chunks of 500
      const chunkSize = 500;
      let offset = 0;
      const limit = this.options.limit ? Math.min(this.options.limit, sourceCount) : sourceCount;

      const currentTableMigratedIds = new Set<string>();
      migratedIdsByTable.set(config.sqliteTable, currentTableMigratedIds);

      while (offset < limit) {
        const currentBatchLimit = Math.min(chunkSize, limit - offset);
        const rows = sqlite
          .prepare(
            `SELECT * FROM "${config.sqliteTable}" LIMIT ${currentBatchLimit} OFFSET ${offset}`
          )
          .all() as Array<Record<string, any>>;

        for (const row of rows) {
          totalExtracted++;
          const sourceId = String(row[config.idField] || row.id || row._id);

          if (!sourceId || sourceId === 'undefined' || sourceId === 'null') {
            this.quarantined.push({
              workspaceId: wsId,
              sourceTable: config.sqliteTable,
              sourceId: 'MISSING_ID',
              targetCollection: collectionName,
              reason: 'Source row missing valid primary identifier',
              rowSample: row
            });
            stats.quarantined++;
            totalQuarantined++;
            continue;
          }

          // 1. Transform row to Mongo document shape
          let doc: Record<string, any>;
          try {
            doc = config.transform(row, wsId);
          } catch (err: any) {
            this.quarantined.push({
              workspaceId: wsId,
              sourceTable: config.sqliteTable,
              sourceId,
              targetCollection: collectionName,
              reason: `Transformation failed: ${err.message}`,
              rowSample: row
            });
            stats.quarantined++;
            totalQuarantined++;
            continue;
          }

          // 2. Validate Foreign Keys
          let fkBroken = false;
          for (const fk of config.foreignKeys) {
            const val = doc[fk.field];
            if (val === null || val === undefined || val === '') {
              if (fk.nullable) continue;
              // Required FK is empty
              this.quarantined.push({
                workspaceId: wsId,
                sourceTable: config.sqliteTable,
                sourceId,
                targetCollection: collectionName,
                reason: `Missing required foreign key [${fk.field}]`,
                rowSample: row
              });
              fkBroken = true;
              break;
            }

            // If it's an array of FKs (e.g. staticMemberIds)
            if (fk.isArray && Array.isArray(val)) {
              // Validated downstream
              continue;
            }

            // Check if referenced ID exists in previously migrated IDs or in MongoDB
            const parentMigratedSet = migratedIdsByTable.get(fk.targetTable);
            if (parentMigratedSet && parentMigratedSet.has(String(val))) {
              continue;
            }

            // Check MongoDB directly for parent reference
            const parentExists = await mongoDb.collection(fk.targetCollection).countDocuments({
              _id: String(val)
            });

            if (parentExists === 0) {
              if (fk.nullable) {
                // Set nullable foreign key to null to prevent invalid reference
                doc[fk.field] = null;
              } else {
                this.quarantined.push({
                  workspaceId: wsId,
                  sourceTable: config.sqliteTable,
                  sourceId,
                  targetCollection: collectionName,
                  reason: `Broken foreign key: [${fk.field}] referencing [${val}] not found in [${fk.targetCollection}]`,
                  rowSample: row
                });
                fkBroken = true;
                break;
              }
            }
          }

          if (fkBroken) {
            stats.quarantined++;
            totalQuarantined++;
            continue;
          }

          // 3. Reconcile with existing MongoDB document (Scenarios A, B, C, E)
          const existingDoc = await mongoCol.findOne({ _id: doc._id });

          if (!existingDoc) {
            // Scenario A: SQLite exists, Mongo missing -> Insert
            if (isExecute) {
              await mongoCol.insertOne(doc as any);
            }
            stats.inserted++;
            totalInserted++;
            currentTableMigratedIds.add(doc._id);
          } else {
            // Scenario C: Both exist with same ID -> Reconcile
            const isPendingSync = pendingSyncIds.has(sourceId);
            const sqliteUpdatedAt = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0;
            const mongoUpdatedAt = existingDoc.updatedAt
              ? new Date(existingDoc.updatedAt).getTime()
              : 0;

            if (isPendingSync || sqliteUpdatedAt > mongoUpdatedAt) {
              // Local edit is newer or pending sync -> Update Mongo
              if (isExecute) {
                const { _id, ...updatePayload } = doc;
                await mongoCol.updateOne({ _id: doc._id }, { $set: updatePayload });
              }
              stats.updated++;
              totalUpdated++;
              currentTableMigratedIds.add(doc._id);
            } else {
              // Mongo is newer or identical -> Preserve Mongo
              stats.preservedMongo++;
              totalPreserved++;
              currentTableMigratedIds.add(doc._id);
            }
          }
        }

        offset += currentBatchLimit;
      }

      tableStats[config.sqliteTable] = stats;
      if (
        this.options.verbose ||
        stats.inserted > 0 ||
        stats.updated > 0 ||
        stats.quarantined > 0
      ) {
        console.log(
          `  • ${config.sqliteTable.padEnd(24)} -> ${collectionName.padEnd(24)} | Extracted: ${sourceCount} | Inserted: ${stats.inserted} | Updated: ${stats.updated} | Preserved: ${stats.preservedMongo} | Quarantined: ${stats.quarantined}`
        );
      }
    }

    sqlite.close();

    const durationMs = Date.now() - wsStartTime;
    return {
      workspaceId: wsId,
      dbPath: dbInfo.filePath,
      backupPath,
      tables: tableStats,
      totalExtracted,
      totalInserted,
      totalUpdated,
      totalPreserved,
      totalQuarantined,
      pendingSyncProcessed: pendingSyncIds.size,
      durationMs
    };
  }
}

// Direct CLI Execution Entrypoint
async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const backupConfirmed = args.includes('--backup-confirmed');
  const verbose = args.includes('--verbose');
  const resume = args.includes('--resume');

  let workspaceId: string | undefined;
  const wsIdx = args.indexOf('--workspace');
  if (wsIdx !== -1 && args[wsIdx + 1]) {
    workspaceId = args[wsIdx + 1];
  }

  let databasePath: string | undefined;
  const dbIdx = args.indexOf('--database');
  if (dbIdx !== -1 && args[dbIdx + 1]) {
    databasePath = args[dbIdx + 1];
  }

  let limit: number | undefined;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1]!, 10);
  }

  const migrator = new SQLiteToMongoMigrator({
    mode: isExecute ? 'execute' : 'dry-run',
    workspaceId,
    databasePath,
    backupConfirmed,
    verbose,
    resume,
    limit
  });

  try {
    await migrator.run();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch (err: any) {
    console.error('\n❌ Migration Failed:', err.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
