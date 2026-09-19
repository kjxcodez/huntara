import * as fs from 'fs';
import * as path from 'path';

interface ValidationIssue {
  file: string;
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}

const rootDir = path.resolve(__dirname, '..');
const issues: ValidationIssue[] = [];

// Helper to scan files recursively
function scanDir(dir: string, callback: (filePath: string) => void) {
  if (
    dir.includes('node_modules') ||
    dir.includes('dist') ||
    dir.includes('out') ||
    dir.includes('.turbo') ||
    dir.includes('.git') ||
    dir.includes('report') ||
    dir.includes('tests')
  ) {
    return;
  }

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath, callback);
    } else if (stat.isFile() && /\.(ts|tsx|js|jsx|json|yml|yaml|env)$/.test(file)) {
      callback(fullPath);
    }
  }
}

console.log('[Verify Production] Auditing repository settings...');

// 1. Audit Localhost / 127.0.0.1 references (except valid ones like Ollama's local port or pings)
const forbiddenUrls = ['localhost:3000', '127.0.0.1:3000', 'localhost:8080'];
scanDir(path.join(rootDir, 'apps'), (filePath) => {
  if (
    filePath.endsWith('verify-production.ts') ||
    filePath.endsWith('doctor.ts') ||
    filePath.endsWith('release-check.ts') ||
    filePath.endsWith('.env')
  )
    return;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    for (const url of forbiddenUrls) {
      if (line.includes(url)) {
        issues.push({
          file: path.relative(rootDir, filePath).replace(/\\/g, '/'),
          line: index + 1,
          message: `Found development URL reference: "${url}"`,
          severity: 'error'
        });
      }
    }
  });
});

scanDir(path.join(rootDir, 'packages'), (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    for (const url of forbiddenUrls) {
      if (line.includes(url)) {
        issues.push({
          file: path.relative(rootDir, filePath).replace(/\\/g, '/'),
          line: index + 1,
          message: `Found development URL reference: "${url}"`,
          severity: 'error'
        });
      }
    }
  });
});

// 2. Audit electron-builder.yml for production completeness
const builderConfigPath = path.join(rootDir, 'apps/desktop/electron-builder.yml');
if (fs.existsSync(builderConfigPath)) {
  const content = fs.readFileSync(builderConfigPath, 'utf8');
  if (content.includes('publish: null')) {
    issues.push({
      file: 'apps/desktop/electron-builder.yml',
      message: 'Publish setting is null. Release updater updaterUrl might be unconfigured.',
      severity: 'warning'
    });
  }
  if (
    !content.includes('productName: HUNTARA') &&
    !content.includes('productName: "HUNTARA"')
  ) {
    issues.push({
      file: 'apps/desktop/electron-builder.yml',
      message: 'Product name in builder does not match HUNTARA standard.',
      severity: 'warning'
    });
  }
}

// 3. Verify .env environment template exists for production API
const envTemplatePath = path.join(rootDir, 'apps/api/.env');
if (fs.existsSync(envTemplatePath)) {
  const content = fs.readFileSync(envTemplatePath, 'utf8');
  if (content.includes('MONGODB_URI=mongodb://localhost:')) {
    issues.push({
      file: 'apps/api/.env',
      message: 'Dev database connection string MONGODB_URI is declared in api .env.',
      severity: 'warning'
    });
  }
}

// Report results
console.log('\n======================================');
console.log('PRODUCTION CONFIGURATION VALIDATION SUMMARY');
console.log('======================================');

const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');

for (const issue of issues) {
  const prefix = issue.severity === 'error' ? '❌ ERROR' : '⚠️ WARN';
  const lineInfo = issue.line ? `:${issue.line}` : '';
  console.log(`- [${prefix}] ${issue.file}${lineInfo} - ${issue.message}`);
}

console.log('======================================');
console.log(`Validation Complete: ${errors.length} errors, ${warnings.length} warnings.`);
console.log('======================================\n');

if (errors.length > 0) {
  process.exit(1);
} else {
  console.log('🟢 Production validation passed successfully!');
  process.exit(0);
}
