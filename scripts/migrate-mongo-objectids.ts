import { MongoClient, ObjectId, type Db } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), 'apps/api/.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/leadforge-os';

export const LEADFORGE_COLLECTIONS = [
  'workspaces',
  'companies',
  'contacts',
  'campaigns',
  'emailaccounts',
  'emailtemplates',
  'sequences',
  'sequenceexecutions',
  'sequencelogs',
  'discoveryruns',
  'companydiscoveryruns',
  'audiences',
  'outreaches',
  'betaapplicants',
  'oauthtransactions',
  'usertestrecipients',
  'jobs',
  'systemlogs',
  'automationlocks',
  'companyintelligences',
  'websiteintelligences',
  'contactintelligences',
  'opportunityscores',
  'auditlogs',
  'workspacememories',
  'pagecrawls',
  'intelligencesources',
  'intelligenceevidences',
  'intelligenceclaims',
  'intelligenceinferences',
  'emaildeliveries'
];

export const EXCLUDED_AUTH_COLLECTIONS = ['user', 'users', 'session', 'account', 'verification'];

export interface ReferenceDefinition {
  collection: string;
  field: string;
  isArray?: boolean;
}

export const TARGET_REFERENCES: Record<string, ReferenceDefinition[]> = {
  workspaces: [
    { collection: 'companies', field: 'workspaceId' },
    { collection: 'contacts', field: 'workspaceId' },
    { collection: 'campaigns', field: 'workspaceId' },
    { collection: 'emailaccounts', field: 'workspaceId' },
    { collection: 'emailtemplates', field: 'workspaceId' },
    { collection: 'sequences', field: 'workspaceId' },
    { collection: 'sequenceexecutions', field: 'workspaceId' },
    { collection: 'sequencelogs', field: 'workspaceId' },
    { collection: 'discoveryruns', field: 'workspaceId' },
    { collection: 'companydiscoveryruns', field: 'workspaceId' },
    { collection: 'audiences', field: 'workspaceId' },
    { collection: 'outreaches', field: 'workspaceId' },
    { collection: 'oauthtransactions', field: 'workspaceId' },
    { collection: 'jobs', field: 'workspaceId' },
    { collection: 'systemlogs', field: 'workspaceId' },
    { collection: 'automationlocks', field: 'workspaceId' },
    { collection: 'companyintelligences', field: 'workspaceId' },
    { collection: 'websiteintelligences', field: 'workspaceId' },
    { collection: 'contactintelligences', field: 'workspaceId' },
    { collection: 'opportunityscores', field: 'workspaceId' },
    { collection: 'auditlogs', field: 'workspaceId' },
    { collection: 'workspacememories', field: 'workspaceId' },
    { collection: 'pagecrawls', field: 'workspaceId' },
    { collection: 'intelligencesources', field: 'workspaceId' },
    { collection: 'intelligenceevidences', field: 'workspaceId' },
    { collection: 'intelligenceclaims', field: 'workspaceId' },
    { collection: 'intelligenceinferences', field: 'workspaceId' },
    { collection: 'emaildeliveries', field: 'workspaceId' }
  ],
  companies: [
    { collection: 'contacts', field: 'companyId' },
    { collection: 'companydiscoveryruns', field: 'companyId' },
    { collection: 'sequenceexecutions', field: 'companyId' },
    { collection: 'outreaches', field: 'companyId' },
    { collection: 'companyintelligences', field: 'companyId' },
    { collection: 'websiteintelligences', field: 'companyId' },
    { collection: 'opportunityscores', field: 'companyId' },
    { collection: 'pagecrawls', field: 'companyId' },
    { collection: 'intelligencesources', field: 'companyId' },
    { collection: 'intelligenceevidences', field: 'companyId' },
    { collection: 'intelligenceclaims', field: 'companyId' },
    { collection: 'intelligenceinferences', field: 'companyId' },
    { collection: 'emaildeliveries', field: 'companyId' }
  ],
  contacts: [
    { collection: 'sequenceexecutions', field: 'contactId' },
    { collection: 'outreaches', field: 'contactId' },
    { collection: 'contactintelligences', field: 'contactId' },
    { collection: 'emaildeliveries', field: 'contactId' },
    { collection: 'audiences', field: 'staticMemberIds', isArray: true }
  ],
  campaigns: [
    { collection: 'sequenceexecutions', field: 'campaignId' },
    { collection: 'outreaches', field: 'campaignId' },
    { collection: 'emaildeliveries', field: 'campaignId' }
  ],
  sequences: [
    { collection: 'campaigns', field: 'sequenceId' },
    { collection: 'sequenceexecutions', field: 'sequenceId' },
    { collection: 'automationlocks', field: 'sequenceId' },
    { collection: 'emaildeliveries', field: 'sequenceId' }
  ],
  sequenceexecutions: [
    { collection: 'sequencelogs', field: 'executionId' },
    { collection: 'emaildeliveries', field: 'executionId' }
  ],
  discoveryruns: [{ collection: 'companydiscoveryruns', field: 'discoveryRunId' }],
  emailaccounts: [
    { collection: 'campaigns', field: 'sendingAccountId' },
    { collection: 'emaildeliveries', field: 'accountId' }
  ],
  jobs: [{ collection: 'sequenceexecutions', field: 'parentJobId' }],
  intelligencesources: [{ collection: 'intelligenceevidences', field: 'sourceId' }],
  intelligenceevidences: [
    { collection: 'intelligenceclaims', field: 'evidenceIds', isArray: true }
  ],
  intelligenceclaims: [
    { collection: 'intelligenceinferences', field: 'supportingClaimIds', isArray: true }
  ]
};

export interface MigrationOptions {
  execute?: boolean;
  backupConfirmed?: boolean;
  collectionFilter?: string;
  workspaceFilter?: string;
  limit?: number;
  verbose?: boolean;
}

export async function runMigration(customDb?: Db, options: MigrationOptions = {}) {
  const isExecute = options.execute === true;
  const isDryRun = !isExecute;

  let client: MongoClient | null = null;
  let db: Db;

  if (customDb) {
    db = customDb;
  } else {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db();
  }

  const maskedHost = uri.replace(/\/\/.*@/, '//***:***@').split('/')[2] || 'localhost:27017';
  const dbName = db.databaseName;
  const timestamp = Date.now();

  console.log(`\n===============================================================`);
  console.log(`LEADFORGE OS — MONGODB OBJECTID TO STRING IDENTITY MIGRATION`);
  console.log(`===============================================================`);
  console.log(
    `  Mode:               ${isExecute ? 'EXECUTE (MUTATING)' : 'DRY RUN (SAFE / NO MUTATIONS)'}`
  );
  console.log(`  Target Host:        ${maskedHost}`);
  console.log(`  Database Name:      ${dbName}`);
  console.log(`  Environment:        ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Timestamp:          ${new Date(timestamp).toISOString()}`);
  if (options.collectionFilter) console.log(`  Collection Filter:  ${options.collectionFilter}`);
  if (options.workspaceFilter) console.log(`  Workspace Filter:   ${options.workspaceFilter}`);
  if (options.limit) console.log(`  Limit per Coll:     ${options.limit}`);
  console.log(`---------------------------------------------------------------\n`);

  if (isExecute && !options.backupConfirmed) {
    throw new Error(
      'CRITICAL SAFETY STOP: Execution mode requires explicit --backup-confirmed flag.'
    );
  }

  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);
  const targetCollections = LEADFORGE_COLLECTIONS.filter((c) => {
    if (options.collectionFilter && c !== options.collectionFilter) return false;
    return existingCollections.includes(c);
  });

  const report: any = {
    mode: isExecute ? 'EXECUTE' : 'DRY_RUN',
    timestamp: new Date().toISOString(),
    database: dbName,
    collectionsInspected: targetCollections.length,
    affectedCollections: [] as string[],
    documentsInspected: 0,
    objectIdDocumentsFound: 0,
    stringDocumentsFound: 0,
    documentsConverted: 0,
    referencesRewritten: 0,
    collisionsDetected: 0,
    errors: [] as string[],
    details: {} as Record<string, any>
  };

  // Pre-Scan & Dry-Run Verification
  for (const collName of targetCollections) {
    const coll = db.collection(collName);
    const query: any = { _id: { $type: 'objectId' } };
    if (options.workspaceFilter) query.workspaceId = options.workspaceFilter;

    const objIdCount = await coll.countDocuments(query);
    const strIdCount = await coll.countDocuments({ _id: { $type: 'string' } });
    report.documentsInspected += objIdCount + strIdCount;
    report.objectIdDocumentsFound += objIdCount;
    report.stringDocumentsFound += strIdCount;

    if (objIdCount > 0) {
      report.affectedCollections.push(collName);
    }

    report.details[collName] = {
      objectIdCount: objIdCount,
      stringIdCount: strIdCount,
      converted: 0,
      referencesUpdated: 0,
      collisions: [] as string[]
    };

    // Check collisions
    if (objIdCount > 0) {
      const objDocs = await coll.find(query, { projection: { _id: 1 } }).toArray();
      const stringHexes = objDocs.map((d) => d._id.toHexString());
      const collisions = await coll.find({ _id: { $in: stringHexes } }).toArray();
      for (const col of collisions) {
        report.details[collName].collisions.push(String(col._id));
        report.collisionsDetected++;
      }
    }
  }

  // Safety Gate: If any collisions detected, ABORT!
  if (report.collisionsDetected > 0) {
    const err = `CRITICAL STOP: Detected ${report.collisionsDetected} identity collisions between existing String _ids and ObjectIds. Migration aborted for safety.`;
    report.errors.push(err);
    console.error(`\n❌ ${err}`);
    if (client) await client.close();
    throw new Error(err);
  }

  // Execution Phase (or Dry Run Simulation)
  for (const collName of report.affectedCollections) {
    const coll = db.collection(collName);
    const query: any = { _id: { $type: 'objectId' } };
    if (options.workspaceFilter) query.workspaceId = options.workspaceFilter;

    let cursor = coll.find(query);
    if (options.limit && options.limit > 0) {
      cursor = cursor.limit(options.limit);
    }

    const docsToMigrate = await cursor.toArray();
    console.log(
      `Processing collection [${collName}]: ${docsToMigrate.length} documents requiring conversion...`
    );

    for (const oldDoc of docsToMigrate) {
      const oldId: ObjectId = oldDoc._id;
      const newId: string = oldId.toHexString();

      if (isDryRun) {
        if (options.verbose) {
          console.log(
            `  [DRY RUN] Would clone-and-swap [${collName}] ObjectId("${oldId}") -> String("${newId}")`
          );
        }
        report.details[collName].converted++;
        report.documentsConverted++;
      } else {
        // Controlled Clone-and-Swap
        // 1. Construct new document with string _id
        const newDoc = { ...oldDoc, _id: newId };

        // 2. Insert new document
        await coll.insertOne(newDoc);

        // 3. Verify new document exists
        const inserted = await coll.findOne({ _id: newId });
        if (!inserted || typeof inserted._id !== 'string') {
          throw new Error(`Verification failed after inserting new doc ${newId} in ${collName}`);
        }

        // 4. Rewrite references
        const refDefs = TARGET_REFERENCES[collName] || [];
        for (const refDef of refDefs) {
          const targetColl = db.collection(refDef.collection);
          if (refDef.isArray) {
            // Update array containing old ObjectId
            const updateRes = await targetColl.updateMany({ [refDef.field]: oldId }, {
              $set: { [`${refDef.field}.$`]: newId }
            } as any);
            report.details[collName].referencesUpdated += updateRes.modifiedCount;
            report.referencesRewritten += updateRes.modifiedCount;
          } else {
            // Update scalar field containing old ObjectId
            const updateRes = await targetColl.updateMany(
              { [refDef.field]: oldId },
              { $set: { [refDef.field]: newId } }
            );
            report.details[collName].referencesUpdated += updateRes.modifiedCount;
            report.referencesRewritten += updateRes.modifiedCount;
          }
        }

        // 5. Delete old document with ObjectId
        const deleteRes = await coll.deleteOne({ _id: oldId });
        if (deleteRes.deletedCount !== 1) {
          throw new Error(`Failed to delete legacy ObjectId document ${oldId} in ${collName}`);
        }

        report.details[collName].converted++;
        report.documentsConverted++;
      }
    }
  }

  // Also check for orphaned foreign-key ObjectIds in reference fields across collections
  // (e.g. if a child collection has companyId: ObjectId(...) even if companies collection is already converted)
  for (const [targetName, refDefs] of Object.entries(TARGET_REFERENCES)) {
    for (const refDef of refDefs) {
      if (!existingCollections.includes(refDef.collection)) continue;
      const childColl = db.collection(refDef.collection);
      const query: any = { [refDef.field]: { $type: 'objectId' } };
      const count = await childColl.countDocuments(query);
      if (count > 0) {
        console.log(
          `Found ${count} ObjectId references in [${refDef.collection}.${refDef.field}] pointing to [${targetName}]`
        );
        if (isExecute) {
          const orphanDocs = await childColl.find(query).toArray();
          for (const oDoc of orphanDocs) {
            const rawVal = oDoc[refDef.field];
            if (rawVal instanceof ObjectId) {
              const strVal = rawVal.toHexString();
              await childColl.updateOne({ _id: oDoc._id }, { $set: { [refDef.field]: strVal } });
              report.referencesRewritten++;
            } else if (Array.isArray(rawVal)) {
              const convertedArr = rawVal.map((item: any) =>
                item instanceof ObjectId ? item.toHexString() : item
              );
              await childColl.updateOne(
                { _id: oDoc._id },
                { $set: { [refDef.field]: convertedArr } }
              );
              report.referencesRewritten++;
            }
          }
        } else {
          report.referencesRewritten += count;
        }
      }
    }
  }

  // Summary output
  console.log(`\n===============================================================`);
  console.log(`MIGRATION SUMMARY (${report.mode})`);
  console.log(`===============================================================`);
  console.log(`  Collections Inspected:    ${report.collectionsInspected}`);
  console.log(`  Affected Collections:     ${report.affectedCollections.length}`);
  console.log(`  ObjectId Documents Found: ${report.objectIdDocumentsFound}`);
  console.log(`  String Documents Found:   ${report.stringDocumentsFound}`);
  console.log(`  Documents Converted:      ${report.documentsConverted}`);
  console.log(`  References Rewritten:     ${report.referencesRewritten}`);
  console.log(`  Collisions Detected:      ${report.collisionsDetected}`);
  console.log(`  Errors / Blockers:        ${report.errors.length}`);
  console.log(`===============================================================\n`);

  const reportFileName = isExecute
    ? `migration-objectid-execution-${timestamp}.json`
    : `migration-objectid-dry-run-${timestamp}.json`;

  const reportPath = path.resolve(process.cwd(), reportFileName);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Diagnostic report saved to: ${reportPath}\n`);

  if (client) {
    await client.close();
  }

  return report;
}

// CLI entry point
import { fileURLToPath } from 'url';

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    execute: args.includes('--execute'),
    backupConfirmed: args.includes('--backup-confirmed'),
    verbose: args.includes('--verbose')
  };

  const collIdx = args.indexOf('--collection');
  if (collIdx !== -1 && args[collIdx + 1]) {
    options.collectionFilter = args[collIdx + 1];
  }

  const wsIdx = args.indexOf('--workspace');
  if (wsIdx !== -1 && args[wsIdx + 1]) {
    options.workspaceFilter = args[wsIdx + 1];
  }

  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    options.limit = parseInt(args[limitIdx + 1], 10);
  }

  runMigration(undefined, options).catch((err) => {
    console.error('Fatal Migration Error:', err);
    process.exit(1);
  });
}
