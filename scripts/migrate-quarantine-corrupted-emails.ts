/**
 * LeadForge OS — Corrupted Contact Email Quarantine & Recovery Migration
 *
 * Idempotent, non-destructive migration utility that inspects MongoDB and SQLite
 * contacts, cleanly normalizes unambiguously recoverable corrupted email addresses,
 * and quarantines ambiguous/unrecoverable emails to protect campaign deliverability.
 *
 * Usage:
 *   npx tsx scripts/migrate-quarantine-corrupted-emails.ts [--execute] [--dry-run]
 */

import Database from 'better-sqlite3';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { sanitizeAndValidateEmail } from '../packages/schema/src/utils/email-sanitizer.js';
import { ContactEmailStatus } from '../packages/schema/src/enums/index.js';
import { discoverAllSQLiteDatabases } from './sqlite-discovery.js';

dotenv.config({ path: path.resolve(process.cwd(), 'apps/api/.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/leadforge-os';
const isExecute = process.argv.includes('--execute');
const mode = isExecute ? 'EXECUTE' : 'DRY-RUN';

interface MigrationStats {
  scanned: number;
  valid: number;
  recovered: number;
  quarantined: number;
  invalid: number;
  unchanged: number;
}

async function migrateMongoContacts(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    scanned: 0,
    valid: 0,
    recovered: 0,
    quarantined: 0,
    invalid: 0,
    unchanged: 0
  };

  console.log(`\n--- MongoDB Contact Email Audit & Quarantine (${mode}) ---`);
  let isConnected = false;

  try {
    const conn = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    isConnected = true;
    const db = conn.connection.db;
    if (!db) {
      console.log('Could not connect to MongoDB database. Skipping MongoDB migration.');
      return stats;
    }

    const collection = db.collection('contacts');
    const cursor = collection.find({ email: { $exists: true, $ne: null } });

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc || !doc.email) continue;
      stats.scanned++;

      const rawEmail = String(doc.email);
      const currentStatus = doc.emailStatus;
      const result = sanitizeAndValidateEmail(rawEmail);

      let targetStatus: ContactEmailStatus;
      let targetEmail = rawEmail;
      let needsUpdate = false;

      if (result.status === 'valid') {
        targetStatus = ContactEmailStatus.VALID;
        if (currentStatus !== ContactEmailStatus.VALID) {
          needsUpdate = true;
        }
        stats.valid++;
      } else if (result.status === 'recovered') {
        targetStatus = ContactEmailStatus.VALID;
        targetEmail = result.email;
        needsUpdate = true;
        stats.recovered++;
        console.log(`[MongoDB Recovered] "${rawEmail}" -> "${targetEmail}" (id: ${doc._id})`);
      } else if (result.status === 'quarantine') {
        targetStatus = ContactEmailStatus.QUARANTINED;
        if (currentStatus !== ContactEmailStatus.QUARANTINED) {
          needsUpdate = true;
        }
        stats.quarantined++;
        console.log(
          `[MongoDB Quarantined] "${rawEmail}" -> QUARANTINED (${result.reason}) (id: ${doc._id})`
        );
      } else {
        targetStatus = ContactEmailStatus.INVALID;
        if (currentStatus !== ContactEmailStatus.INVALID) {
          needsUpdate = true;
        }
        stats.invalid++;
        console.log(
          `[MongoDB Invalid] "${rawEmail}" -> INVALID (${result.reason}) (id: ${doc._id})`
        );
      }

      if (needsUpdate) {
        if (isExecute) {
          try {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  email: targetEmail,
                  emailStatus: targetStatus,
                  updatedAt: new Date()
                }
              }
            );
          } catch (updateErr: any) {
            if (updateErr.code === 11000) {
              console.warn(
                `[Duplicate on recovery] "${targetEmail}" already exists in workspace. Setting doc ${doc._id} to QUARANTINED.`
              );
              await collection.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    emailStatus: ContactEmailStatus.QUARANTINED,
                    updatedAt: new Date()
                  }
                }
              );
              stats.quarantined++;
            } else {
              console.error(`Error updating contact ${doc._id}:`, updateErr.message);
            }
          }
        }
      } else {
        stats.unchanged++;
      }
    }
  } catch (err: any) {
    console.warn(`MongoDB migration notice: ${err.message || err}`);
  } finally {
    if (isConnected) {
      await mongoose.disconnect();
    }
  }

  return stats;
}

function migrateSQLiteContacts(): MigrationStats {
  const stats: MigrationStats = {
    scanned: 0,
    valid: 0,
    recovered: 0,
    quarantined: 0,
    invalid: 0,
    unchanged: 0
  };

  console.log(`\n--- SQLite Contact Email Audit & Quarantine (${mode}) ---`);

  let dbInfos: any[] = [];
  try {
    dbInfos = discoverAllSQLiteDatabases();
  } catch (err: any) {
    console.warn(`SQLite discovery notice: ${err.message}`);
    return stats;
  }

  for (const info of dbInfos) {
    if (!fs.existsSync(info.filePath)) continue;

    let db: Database.Database | null = null;
    try {
      db = new Database(info.filePath);
      db.pragma('journal_mode = WAL');

      // Check if contacts table exists
      const tableCheck = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'`)
        .get();
      if (!tableCheck) continue;

      // Ensure emailStatus column exists
      const columns = db.prepare(`PRAGMA table_info(contacts)`).all() as any[];
      const hasEmailStatus = columns.some((c) => c.name === 'emailStatus');
      if (!hasEmailStatus && isExecute) {
        db.prepare(`ALTER TABLE contacts ADD COLUMN emailStatus TEXT DEFAULT 'UNVERIFIED'`).run();
      }

      const rows = db
        .prepare(
          `SELECT id, email, emailStatus FROM contacts WHERE email IS NOT NULL AND email != ''`
        )
        .all() as any[];

      for (const row of rows) {
        stats.scanned++;
        const rawEmail = String(row.email);
        const currentStatus = row.emailStatus;
        const result = sanitizeAndValidateEmail(rawEmail);

        let targetStatus: ContactEmailStatus;
        let targetEmail = rawEmail;
        let needsUpdate = false;

        if (result.status === 'valid') {
          targetStatus = ContactEmailStatus.VALID;
          if (currentStatus !== ContactEmailStatus.VALID) {
            needsUpdate = true;
          }
          stats.valid++;
        } else if (result.status === 'recovered') {
          targetStatus = ContactEmailStatus.VALID;
          targetEmail = result.email;
          needsUpdate = true;
          stats.recovered++;
          console.log(
            `[SQLite Recovered] "${rawEmail}" -> "${targetEmail}" (db: ${path.basename(info.filePath)}, id: ${row.id})`
          );
        } else if (result.status === 'quarantine') {
          targetStatus = ContactEmailStatus.QUARANTINED;
          if (currentStatus !== ContactEmailStatus.QUARANTINED) {
            needsUpdate = true;
          }
          stats.quarantined++;
          console.log(
            `[SQLite Quarantined] "${rawEmail}" -> QUARANTINED (${result.reason}) (db: ${path.basename(info.filePath)}, id: ${row.id})`
          );
        } else {
          targetStatus = ContactEmailStatus.INVALID;
          if (currentStatus !== ContactEmailStatus.INVALID) {
            needsUpdate = true;
          }
          stats.invalid++;
          console.log(
            `[SQLite Invalid] "${rawEmail}" -> INVALID (${result.reason}) (db: ${path.basename(info.filePath)}, id: ${row.id})`
          );
        }

        if (needsUpdate && isExecute) {
          db.prepare(
            `UPDATE contacts SET email = ?, emailStatus = ?, updatedAt = datetime('now') WHERE id = ?`
          ).run(targetEmail, targetStatus, row.id);
        } else if (!needsUpdate) {
          stats.unchanged++;
        }
      }
    } catch (dbErr: any) {
      console.warn(`Error processing SQLite DB ${info.filePath}: ${dbErr.message}`);
    } finally {
      if (db) db.close();
    }
  }

  return stats;
}

async function main() {
  console.log(`=============================================================`);
  console.log(` LeadForge OS — Contact Email Quarantine Migration`);
  console.log(` Mode: ${mode}`);
  console.log(`=============================================================`);

  const mongoStats = await migrateMongoContacts();
  const sqliteStats = migrateSQLiteContacts();

  console.log(`\n=============================================================`);
  console.log(` MIGRATION SUMMARY (${mode})`);
  console.log(`=============================================================`);
  console.log(
    `MongoDB: Scanned=${mongoStats.scanned}, Valid=${mongoStats.valid}, Recovered=${mongoStats.recovered}, Quarantined=${mongoStats.quarantined}, Invalid=${mongoStats.invalid}`
  );
  console.log(
    `SQLite:  Scanned=${sqliteStats.scanned}, Valid=${sqliteStats.valid}, Recovered=${sqliteStats.recovered}, Quarantined=${sqliteStats.quarantined}, Invalid=${sqliteStats.invalid}`
  );
  if (!isExecute) {
    console.log(`\nRun with --execute to commit changes to database.`);
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
