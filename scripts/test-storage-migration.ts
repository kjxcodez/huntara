import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';

console.log('=== TESTING HUNTARA STORAGE NAMESPACE & MIGRATION ===\n');

// 1. Create a clean temporary test sandbox
const testSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'huntara-storage-test-'));
const mockAppData = path.join(testSandbox, 'mock-appdata');
fs.mkdirSync(mockAppData, { recursive: true });

console.log(`[Test] Isolated mock AppData: ${mockAppData}`);

// Set process.env.APPDATA so storage migration uses our sandbox
process.env.APPDATA = mockAppData;

// 2. Setup mock legacy LeadForge directory: mock-appData/@leadforge/desktop
const legacyLeadForgeDir = path.join(mockAppData, '@leadforge', 'desktop');
fs.mkdirSync(path.join(legacyLeadForgeDir, 'workspaces'), { recursive: true });
fs.mkdirSync(path.join(legacyLeadForgeDir, 'logs'), { recursive: true });

fs.writeFileSync(
  path.join(legacyLeadForgeDir, 'config.json'),
  JSON.stringify({ activeWorkspaceId: 'ws_legacy_101', theme: 'dark' }, null, 2),
  'utf8'
);

fs.writeFileSync(
  path.join(legacyLeadForgeDir, 'session.dat'),
  'encrypted-test-session-data-xyz',
  'utf8'
);

fs.writeFileSync(
  path.join(legacyLeadForgeDir, 'leadforge.db'),
  'sqlite-binary-mock-global-data',
  'utf8'
);

fs.writeFileSync(
  path.join(legacyLeadForgeDir, 'workspaces', 'leadforge_ws_legacy_101.db'),
  'sqlite-binary-mock-workspace-data',
  'utf8'
);

fs.writeFileSync(
  path.join(legacyLeadForgeDir, 'logs', 'leadforge_ws_legacy_101_2026-09-18.jsonl'),
  '{"level":"info","msg":"legacy log"}\n',
  'utf8'
);

console.log('[Test] Mock legacy LeadForge installation created:');
console.log(`  - ${legacyLeadForgeDir}/config.json`);
console.log(`  - ${legacyLeadForgeDir}/session.dat`);
console.log(`  - ${legacyLeadForgeDir}/leadforge.db`);
console.log(`  - ${legacyLeadForgeDir}/workspaces/leadforge_ws_legacy_101.db`);

async function runTest() {
  let initializeStorageAndMigrate: any;
  try {
    const mod = await import('../apps/desktop/src/main/lib/storage-migration');
    initializeStorageAndMigrate = mod.initializeStorageAndMigrate;
  } catch (err: any) {
    console.log('[Test] Note:', err.message);
  }

  if (!initializeStorageAndMigrate) {
    console.error('Could not import storage-migration module');
    process.exit(1);
  }

  const result = initializeStorageAndMigrate();
  console.log('\n[Test] Migration executed with result:', result);

  // 4. Verify assertions
  const canonicalHUNTARADir = path.join(mockAppData, 'HUNTARA');

  // A. Canonical folder is %APPDATA%\HUNTARA
  assert.strictEqual(
    result.canonicalUserData,
    canonicalHUNTARADir,
    `Expected canonical userData to be ${canonicalHUNTARADir}, got ${result.canonicalUserData}`
  );
  assert.ok(fs.existsSync(canonicalHUNTARADir), 'HUNTARA directory must exist');

  // B. Config was migrated
  const migratedConfigPath = path.join(canonicalHUNTARADir, 'config.json');
  assert.ok(fs.existsSync(migratedConfigPath), 'config.json must exist in HUNTARA');
  const configData = JSON.parse(fs.readFileSync(migratedConfigPath, 'utf8'));
  assert.strictEqual(
    configData.activeWorkspaceId,
    'ws_legacy_101',
    'activeWorkspaceId must be preserved'
  );

  // C. Session was migrated
  const migratedSessionPath = path.join(canonicalHUNTARADir, 'session.dat');
  assert.ok(fs.existsSync(migratedSessionPath), 'session.dat must exist in HUNTARA');
  assert.strictEqual(
    fs.readFileSync(migratedSessionPath, 'utf8'),
    'encrypted-test-session-data-xyz',
    'session content must match'
  );

  // D. Global DB migrated: leadforge.db -> huntara.db
  const migratedGlobalDbPath = path.join(canonicalHUNTARADir, 'huntara.db');
  assert.ok(fs.existsSync(migratedGlobalDbPath), 'huntara.db must exist in HUNTARA');

  // E. Workspace DB migrated: leadforge_ws_legacy_101.db -> huntara_ws_legacy_101.db
  const migratedWsDbPath = path.join(canonicalHUNTARADir, 'workspaces', 'huntara_ws_legacy_101.db');
  assert.ok(
    fs.existsSync(migratedWsDbPath),
    'huntara_ws_legacy_101.db must exist in HUNTARA/workspaces'
  );

  // F. Old legacy files were NOT deleted (non-destructive guarantee)
  assert.ok(
    fs.existsSync(path.join(legacyLeadForgeDir, 'config.json')),
    'Legacy config.json must remain intact'
  );
  assert.ok(
    fs.existsSync(path.join(legacyLeadForgeDir, 'workspaces', 'leadforge_ws_legacy_101.db')),
    'Legacy database must remain intact'
  );

  // G. Marker file exists
  const markerPath = path.join(canonicalHUNTARADir, '.huntara-migrated.json');
  assert.ok(fs.existsSync(markerPath), '.huntara-migrated.json marker must exist');
  const markerData = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  console.log('\n[Test] Marker recorded:', markerData);
  assert.ok(markerData.migratedAt, 'Marker must have migratedAt');

  // H. Idempotency check: Running again must NOT re-duplicate or fail
  const secondResult = initializeStorageAndMigrate();
  console.log('\n[Test] Second run result (idempotency):', secondResult);
  assert.strictEqual(secondResult.isMigrated, true, 'Second run must report migrated');

  console.log('\n✅ ALL STORAGE NAMESPACE AND MIGRATION TESTS PASSED!\n');

  // Clean up sandbox
  try {
    fs.rmSync(testSandbox, { recursive: true, force: true });
  } catch {}
}

runTest().catch((err) => {
  console.error('Fatal error during storage migration test:', err);
  process.exit(1);
});
