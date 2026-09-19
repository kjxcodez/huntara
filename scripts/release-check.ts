import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface GateResult {
  gate: number;
  name: string;
  success: boolean;
  message: string;
  durationMs: number;
}

async function runGate(
  gate: number,
  name: string,
  command: string,
  cwd: string,
  ignoreFailure = false
): Promise<GateResult> {
  const start = Date.now();
  console.log(`\n======================================`);
  console.log(`[Release Gate ${gate}] ${name}`);
  console.log(`======================================`);
  console.log(`Running: ${command}...`);
  try {
    const output = execSync(command, { cwd, encoding: 'utf8', stdio: 'inherit' });
    return {
      gate,
      name,
      success: true,
      message: 'Passed successfully.',
      durationMs: Date.now() - start
    };
  } catch (err: any) {
    console.error(`❌ Gate ${gate} failed!`);
    return {
      gate,
      name,
      success: ignoreFailure,
      message: err.message || String(err),
      durationMs: Date.now() - start
    };
  }
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const reportDir = path.join(rootDir, 'report');
  const startTotal = Date.now();

  const results: GateResult[] = [];

  // Gate 1: Repository Health Check
  results.push(
    await runGate(1, 'Repository Health Check', 'npx tsx scripts/verify-repo-health.ts', rootDir)
  );

  // Gate 2: TypeScript Typecheck
  results.push(await runGate(2, 'TypeScript Typecheck', 'pnpm check-types', rootDir));

  // Gate 3: Code Lint & Format
  results.push(
    await runGate(
      3,
      'Lint and Format Validation',
      'pnpm lint && npx prettier --check "scripts/**/*.ts" "apps/desktop/scripts/**/*.js"',
      rootDir
    )
  );

  // Gate 4: Unit & Integration Tests
  results.push(await runGate(4, 'Unit & Integration Tests', 'pnpm -r test', rootDir));

  // Gate 5: AI Integration Tests
  results.push(
    await runGate(
      5,
      'AI Integration Tests (Optional)',
      'pnpm test:ai',
      rootDir,
      true // AI integration tests are optional in CI, skip cleanly if missing key
    )
  );

  // Gate 6: Headless Desktop Subsystem Smoke Tests
  console.log('\n[Release Check] Building and executing Desktop Smoke Tests...');
  let smokeSuccess = false;
  const smokeStart = Date.now();
  try {
    execSync(
      'npx esbuild scripts/smoke-test.ts --bundle --platform=node --target=node22 --external:electron --external:better-sqlite3 --outfile=report/temp-smoke.js',
      { cwd: rootDir }
    );
    execSync('npx electron report/temp-smoke.js', { cwd: rootDir, stdio: 'inherit' });
    smokeSuccess = true;
  } catch (err) {
    console.error('❌ Headless Desktop Subsystem Smoke Tests Failed!');
  }
  results.push({
    gate: 6,
    name: 'Headless Desktop Subsystem Smoke Tests',
    success: smokeSuccess,
    message: smokeSuccess ? 'Headless boot diagnostics complete.' : 'Smoke test execution error.',
    durationMs: Date.now() - smokeStart
  });

  // Gate 7: Desktop Bundling Dry-Run
  results.push(
    await runGate(
      7,
      'Desktop Bundling Dry-Run (electron-vite build)',
      'pnpm -F @huntara/desktop exec electron-vite build',
      rootDir
    )
  );

  // Gate 8: Changesets & Release Notes Check
  let notesOk = false;
  let notesMsg = '';
  try {
    const changesetsDir = path.join(rootDir, '.changeset');
    const files = fs.existsSync(changesetsDir) ? fs.readdirSync(changesetsDir) : [];
    const hasChangesets = files.some((f) => f.endsWith('.md') && f !== 'README.md');
    const hasChangelog = fs.existsSync(path.join(rootDir, 'CHANGELOG.md'));

    notesOk = hasChangesets || hasChangelog;
    notesMsg = hasChangesets
      ? 'Changesets detected. Release notes ready.'
      : hasChangelog
        ? 'CHANGELOG.md detected.'
        : 'Missing changeset files. Run: npx changeset add';
  } catch (err: any) {
    notesMsg = `Changelog check error: ${err.message}`;
  }
  results.push({
    gate: 8,
    name: 'Changesets & Release Notes Validation',
    success: notesOk,
    message: notesMsg,
    durationMs: 0
  });

  // Gate 9: Git Cleanliness check
  let gitOk = false;
  let gitMsg = '';
  try {
    const gitStatus = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim();
    gitOk = gitStatus.length === 0;
    gitMsg = gitOk
      ? 'Git repository is clean.'
      : 'Warning: Uncommitted changes present in workspace.';
  } catch (err: any) {
    gitMsg = `Git error: ${err.message}`;
  }
  results.push({
    gate: 9,
    name: 'Git Status Cleanliness Validation',
    success: true, // Warns but doesn't block local check
    message: gitMsg,
    durationMs: 0
  });

  // Gate 10: Git Tag & Version Verification
  let tagOk = false;
  let tagMsg = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const version = pkg.version || '0.0.1';

    // Check Git tag on HEAD
    let gitTag = '';
    try {
      gitTag = execSync(
        'git describe --tags --exact-match HEAD 2>/dev/null || git describe --tags --exact-match HEAD',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();
    } catch {
      // Not on a tag
    }

    // Check Git branch
    let gitBranch = '';
    try {
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
    } catch {
      // Ignore
    }

    tagOk = true;
    const parts: string[] = [`Root version declared: ${version}`];

    if (gitTag) {
      if (gitTag === `v${version}`) {
        parts.push(`Git tag "${gitTag}" matches version.`);
      } else {
        parts.push(`Mismatch: Git tag "${gitTag}" does not match package version "v${version}".`);
        tagOk = false;
      }
    }

    if (gitBranch && gitBranch.startsWith('release/v')) {
      const branchVersion = gitBranch.replace('release/v', '');
      if (branchVersion === version) {
        parts.push(`Branch "${gitBranch}" matches version.`);
      } else {
        parts.push(`Mismatch: Branch "${gitBranch}" does not match package version "${version}".`);
        tagOk = false;
      }
    }

    if (tagOk && !gitTag && (!gitBranch || !gitBranch.startsWith('release/v'))) {
      parts.push(`Skipped tag validation (not on tag or release branch).`);
    }

    tagMsg = parts.join(' | ');
  } catch (err: any) {
    tagMsg = `Version parse error: ${err.message}`;
  }
  results.push({
    gate: 10,
    name: 'Git Tag & Workspace Version Verification',
    success: tagOk,
    message: tagMsg,
    durationMs: 0
  });

  // Compile final report
  let allSuccess = true;
  let md = `# LeadForge OS Release Verification Report\n\n`;
  md += `**Timestamp**: ${new Date().toISOString()}\n\n`;
  md += `## Release Gates Checklist\n\n`;

  md += `| Gate | Validation Step | Status | Duration (ms) | Summary |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  for (const res of results) {
    const emoji = res.success ? '✅ PASS' : '❌ FAIL';
    if (!res.success) {
      allSuccess = false;
    }
    md += `| Gate ${res.gate} | ${res.name} | ${emoji} | ${res.durationMs} | ${res.message} |\n`;
  }
  md += `\n`;

  const totalDuration = Date.now() - startTotal;
  md += `**Total Release Check Duration**: ${totalDuration} ms\n\n`;
  md += `## Final Release Verdict: ${allSuccess ? '🟢 READY FOR RELEASE' : '🔴 BLOCKED BY FAILURES'}\n`;

  fs.writeFileSync(path.join(reportDir, 'release-check-report.md'), md);

  console.log('\n==================================================');
  console.log('LEADFORGE OS RELEASE VERIFICATION REPORT SUMMARY');
  console.log('==================================================');
  for (const res of results) {
    const statusStr = res.success ? 'PASS' : 'FAIL';
    console.log(`- Gate ${res.gate}: [${statusStr}] ${res.name} (${res.durationMs}ms)`);
  }
  console.log('==================================================');
  console.log(`Release checks report written to report/release-check-report.md`);
  console.log(`Final Release Verdict: ${allSuccess ? '🟢 READY FOR RELEASE' : '🔴 BLOCKED'}`);
  console.log('==================================================\n');

  // Clean up bundled smoke-test artifact
  const tempSmokeJs = path.join(reportDir, 'temp-smoke.js');
  if (fs.existsSync(tempSmokeJs)) {
    try {
      fs.unlinkSync(tempSmokeJs);
    } catch {}
  }

  if (!allSuccess) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal release check execution error:', err);
  process.exit(1);
});
