import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface StepResult {
  name: string;
  success: boolean;
  durationMs: number;
  output: string;
  error?: string;
}

async function runStep(name: string, command: string, cwd: string): Promise<StepResult> {
  const start = Date.now();
  console.log(`[Doctor] Running: ${name}...`);
  try {
    const output = execSync(command, { cwd, encoding: 'utf8', stdio: 'pipe' });
    return {
      name,
      success: true,
      durationMs: Date.now() - start,
      output
    };
  } catch (err: any) {
    return {
      name,
      success: false,
      durationMs: Date.now() - start,
      output: err.stdout || '',
      error: err.stderr || err.message || 'Unknown error'
    };
  }
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const reportDir = path.join(rootDir, 'report');

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }

  const results: StepResult[] = [];

  // --- Environment Diagnostics ---
  console.log('[Doctor] Verifying Environment Versions...');

  // 1. Node Version Check
  const nodeVer = process.version || '';
  const nodeVerOk = parseInt(nodeVer.substring(1).split('.')[0] || '0') >= 18;
  results.push({
    name: 'Node Version Check',
    success: nodeVerOk,
    durationMs: 0,
    output: `Node Version: ${nodeVer} (Satisfies >= 18: ${nodeVerOk ? 'Yes' : 'No'})`
  });

  // 2. pnpm Version Check
  let pnpmVer = 'unknown';
  let pnpmOk = false;
  try {
    pnpmVer = execSync('pnpm -v', { encoding: 'utf8' }).trim();
    pnpmOk = true;
  } catch {}
  results.push({
    name: 'pnpm Version Check',
    success: pnpmOk,
    durationMs: 0,
    output: `pnpm Version: ${pnpmVer}`
  });

  // 3. Electron Version Check
  let electronVer = 'unknown';
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'apps/desktop/package.json'), 'utf8')
    );
    electronVer = pkg.devDependencies?.electron || 'N/A';
  } catch {}
  results.push({
    name: 'Electron Version Check',
    success: true,
    durationMs: 0,
    output: `Electron version declared: ${electronVer}`
  });

  // 4. Git Status Cleanliness
  let gitClean = false;
  let gitStatusText = '';
  try {
    const out = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim();
    gitClean = out.length === 0;
    gitStatusText = out.length === 0 ? 'Git directory clean.' : out;
  } catch (err: any) {
    gitStatusText = `Git command failed: ${err.message}`;
  }
  results.push({
    name: 'Git Status Cleanliness Check',
    success: true, // We report cleanliness status but don't fail doctor purely on uncommitted files during dev.
    durationMs: 0,
    output: gitStatusText
  });

  // --- Quality & Compilation Checks ---

  // 5. Repository Health Check
  results.push(
    await runStep(
      'Repository Health Check (verify-repo-health.ts)',
      'npx tsx scripts/verify-repo-health.ts',
      rootDir
    )
  );

  // 6. Prettier Format Validation
  results.push(
    await runStep(
      'Prettier Formatting Check',
      'npx prettier --check "scripts/**/*.ts" "apps/desktop/scripts/**/*.js"',
      rootDir
    )
  );

  // 7. ESLint Static Code Analysis
  results.push(await runStep('Code Linting (ESLint Flat Config)', 'pnpm lint', rootDir));

  // 8. TypeScript Compilation & Typecheck
  results.push(await runStep('TypeScript Typecheck (check-types)', 'pnpm check-types', rootDir));

  // 9. Dependency Cruiser Boundaries Check
  const cruiserConfig = path.join(rootDir, '.dependency-cruiser.cjs');
  if (fs.existsSync(cruiserConfig)) {
    results.push(
      await runStep(
        'Dependency Cruiser Architectural Boundaries',
        'npx depcruise --validate .dependency-cruiser.cjs packages apps',
        rootDir
      )
    );
  } else {
    results.push({
      name: 'Dependency Cruiser Architectural Boundaries',
      success: false,
      durationMs: 0,
      output: 'Skipped: .dependency-cruiser.cjs config not found.'
    });
  }

  // 10. Existing Unit & Integration Tests Execution
  results.push(
    await runStep('Recursive Package Test Suite (pnpm -r test)', 'pnpm -r test', rootDir)
  );

  // 11. Artifact Verification
  const artifactsExist =
    fs.existsSync(path.join(reportDir, 'health-report.md')) &&
    fs.existsSync(path.join(reportDir, 'dependency-graph.html'));
  results.push({
    name: 'Generated Artifacts Verification',
    success: artifactsExist,
    durationMs: 0,
    output: artifactsExist
      ? `Verified. Outputs located in: ${reportDir}`
      : `Missing generated artifacts. Please run verify-repo-health and dependency-cruiser output generation.`
  });

  // Compile final unified report
  let allSuccess = true;
  let md = `# HUNTARA Doctor Diagnostics Report\n\n`;
  md += `**Timestamp**: ${new Date().toISOString()}\n\n`;
  md += `## Diagnostics Summary\n\n`;

  md += `| Diagnostics verification | Status | Duration (ms) | Log Summary |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;

  for (const res of results) {
    const emoji = res.success ? '✅ PASS' : '❌ FAIL';
    if (!res.success) {
      allSuccess = false;
    }
    const logExcerpt = res.output ? (res.output.trim().split('\n')[0] || '').substring(0, 80) : '';
    md += `| ${res.name} | ${emoji} | ${res.durationMs} | ${logExcerpt || 'N/A'} |\n`;
  }
  md += `\n`;

  md += `## Detailed Step Logs\n\n`;
  for (const res of results) {
    md += `### ${res.name}\n\n`;
    md += `**Status**: ${res.success ? '✅ PASS' : '❌ FAIL'} | **Duration**: ${res.durationMs} ms\n\n`;

    if (res.output && res.output.trim()) {
      md += `#### Output:\n\`\`\`text\n${res.output.trim()}\n\`\`\`\n\n`;
    }
    if (res.error && res.error.trim()) {
      md += `#### Error Log:\n\`\`\`text\n${res.error.trim()}\n\`\`\`\n\n`;
    }
    md += `---\n\n`;
  }

  fs.writeFileSync(path.join(reportDir, 'doctor-report.md'), md);

  console.log('\n======================================');
  console.log('HUNTARA DOCTOR DIAGNOSTICS REPORT SUMMARY');
  console.log('======================================');
  for (const res of results) {
    const statusStr = res.success ? 'PASS' : 'FAIL';
    console.log(`- [${statusStr}] ${res.name} (${res.durationMs}ms)`);
  }
  console.log('======================================\n');
  console.log(`Diagnostics report written to report/doctor-report.md`);

  if (!allSuccess) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal doctor execution error:', err);
  process.exit(1);
});
