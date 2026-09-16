const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * LeadForge OS — Desktop Electron SQLite Integration Test Runner
 *
 * Runs native SQLite integration test suites using the Electron Node runtime
 * (which matches better-sqlite3 NODE_MODULE_VERSION 130).
 *
 * Guaranteed Invariants:
 * 1. Zero silent skipping: tests must fail fast if assertion or runtime fails.
 * 2. Exit code 0 only when ALL integration suites pass.
 */

const integrationTests = [
  'src/main/services/audiences.test.ts',
  'src/main/services/campaign-lifecycle-safety-sqlite.test.ts',
  'src/main/services/campaign.test.ts',
  'src/main/services/campaign-analytics.test.ts',
  'src/main/services/email-quality-intelligence.test.ts',
  'src/main/services/fresh-database.test.ts',
  'src/main/services/fresh-database-all-queries.test.ts',
  'src/main/services/operations-cache.test.ts',
  'src/main/services/outreach-lineage.test.ts',
  'src/main/services/inbound-suppression.test.ts',
  'src/main/services/operational-reliability.test.ts',
  'src/main/services/production-qualification-e2e.test.ts',
  'src/main/services/crash-matrix-qualification.test.ts',
  'src/main/services/adversarial-cross-race-qualification.test.ts',
  'src/main/services/post-release-stabilization.test.ts',
  'src/main/services/release-qualification.test.ts',
  'src/main/services/scheduler-execution-hardening.test.ts'
];

let electronPath = null;
const candidateElectronPaths = [
  path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
  path.join(__dirname, '..', '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
  path.join(__dirname, '..', 'node_modules', '.bin', 'electron.cmd'),
  path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'electron.cmd')
];

for (const p of candidateElectronPaths) {
  if (fs.existsSync(p)) {
    electronPath = p;
    break;
  }
}

if (!electronPath) {
  console.error('[Integration Runner] ERROR: Electron binary not found. Cannot run native SQLite tests without Electron.');
  process.exit(1);
}

console.log(`[Integration Runner] Using Electron binary: ${electronPath}`);
console.log(`[Integration Runner] Running ${integrationTests.length} native SQLite integration test suites...\n`);

let failedCount = 0;

for (const test of integrationTests) {
  const testPath = path.join(__dirname, '..', test);
  console.log(`[Integration Runner] ──▶ Running ${test}...`);
  try {
    execSync(`"${electronPath}" --import tsx "${testPath}"`, {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    console.log(`[Integration Runner] ✅ PASS: ${test}\n`);
  } catch (err) {
    console.error(`\n[Integration Runner] ❌ FAIL: ${test}`);
    failedCount++;
  }
}

if (failedCount > 0) {
  console.error(`\n[Integration Runner] ${failedCount} integration suite(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n[Integration Runner] ✅ All ${integrationTests.length} native SQLite integration suites passed cleanly.`);
  process.exit(0);
}
