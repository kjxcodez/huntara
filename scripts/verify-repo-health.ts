import * as fs from 'fs';
import * as path from 'path';

// Define structures for repo health checking
interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaceDependencies?: string[];
}

interface Issue {
  category: string;
  message: string;
  file?: string | undefined;
  severity: 'error' | 'warning';
}

interface HealthReport {
  timestamp: string;
  summary: {
    totalPackages: number;
    errorsCount: number;
    warningsCount: number;
  };
  issues: Issue[];
  packages: Array<{
    name: string;
    version: string;
    path: string;
  }>;
}

// Helper to find duplicate JSON keys at the same object depth
function findDuplicateJsonKeys(jsonText: string): string[] {
  const duplicates: string[] = [];
  const stack: Set<string>[] = [];
  let currentSet = new Set<string>();

  let i = 0;
  let inString = false;
  let currentString = '';

  while (i < jsonText.length) {
    const char = jsonText[i];
    if (char === '"' && jsonText[i - 1] !== '\\') {
      inString = !inString;
      if (!inString) {
        // String ended. Look ahead to see if there's a ':' (skipping whitespace)
        let j = i + 1;
        while (j < jsonText.length && /\s/.test(jsonText[j]!)) {
          j++;
        }
        if (jsonText[j] === ':') {
          // It's a key!
          if (currentSet.has(currentString)) {
            duplicates.push(currentString);
          }
          currentSet.add(currentString);
        }
      } else {
        currentString = '';
      }
    } else if (inString) {
      currentString += char;
    } else if (char === '{') {
      stack.push(currentSet);
      currentSet = new Set<string>();
    } else if (char === '}') {
      const parent = stack.pop();
      if (parent) {
        currentSet = parent;
      }
    }
    i++;
  }
  return duplicates;
}

// 1. Find all workspaces (parsing pnpm-workspace.yaml)
function getWorkspaces(rootPath: string): string[] {
  const workspaceFile = path.join(rootPath, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceFile)) {
    return [];
  }
  const content = fs.readFileSync(workspaceFile, 'utf8');
  const packages: string[] = [];
  const lines = content.split('\n');
  let inPackages = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('packages:')) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (trimmed.startsWith('-')) {
        const p = trimmed.replace(/^-/, '').trim().replace(/['"]/g, '');
        packages.push(p);
      } else if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      } else if (!line.startsWith(' ') && !line.startsWith('\t')) {
        inPackages = false;
      }
    }
  }
  return packages;
}

// Resolve glob-like paths (specifically handles direct directories and "dir/*")
function resolveWorkspaceDirs(rootPath: string, patterns: string[]): string[] {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parentDir = path.join(rootPath, pattern.slice(0, -2));
      if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
        const subdirs = fs.readdirSync(parentDir);
        for (const subdir of subdirs) {
          const fullPath = path.join(parentDir, subdir);
          if (
            fs.statSync(fullPath).isDirectory() &&
            fs.existsSync(path.join(fullPath, 'package.json'))
          ) {
            dirs.push(fullPath);
          }
        }
      }
    } else {
      const fullPath = path.join(rootPath, pattern);
      if (
        fs.existsSync(fullPath) &&
        fs.statSync(fullPath).isDirectory() &&
        fs.existsSync(path.join(fullPath, 'package.json'))
      ) {
        dirs.push(fullPath);
      }
    }
  }
  return dirs;
}

// Check for all requested issues
async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const issues: Issue[] = [];

  // 1. Workspace directories
  const workspacePatterns = getWorkspaces(rootDir);
  const workspaceDirs = resolveWorkspaceDirs(rootDir, workspacePatterns);

  const packagesMap = new Map<string, { pkgJson: PackageJson; dir: string }>();
  const allDepsVersionsMap = new Map<string, Map<string, string[]>>(); // depName -> version -> packageNames[]

  // Read all package.json files
  for (const dir of workspaceDirs) {
    const pkgJsonPath = path.join(dir, 'package.json');
    try {
      const content = fs.readFileSync(pkgJsonPath, 'utf8');
      const pkgJson = JSON.parse(content) as PackageJson;
      packagesMap.set(pkgJson.name, { pkgJson, dir });

      // Check duplicate dependency keys inside the same file using our robust depth-aware scanner
      const duplicateKeys = findDuplicateJsonKeys(content);
      for (const dKey of duplicateKeys) {
        issues.push({
          category: 'duplicate_dependency_key',
          message: `Duplicate key "${dKey}" found in package.json at same object depth.`,
          file: pkgJsonPath,
          severity: 'error'
        });
      }

      // Track dependencies for duplicates across packages
      const trackDeps = (depsRecord: Record<string, string> | undefined) => {
        if (!depsRecord) return;
        for (const [name, version] of Object.entries(depsRecord)) {
          if (!allDepsVersionsMap.has(name)) {
            allDepsVersionsMap.set(name, new Map());
          }
          const versionsMap = allDepsVersionsMap.get(name)!;
          if (!versionsMap.has(version)) {
            versionsMap.set(version, []);
          }
          versionsMap.get(version)!.push(pkgJson.name || 'unnamed');
        }
      };

      trackDeps(pkgJson.dependencies);
      trackDeps(pkgJson.devDependencies);
      trackDeps(pkgJson.peerDependencies);
    } catch (err: any) {
      issues.push({
        category: 'package_json_parse',
        message: `Failed to parse package.json: ${err.message}`,
        file: pkgJsonPath,
        severity: 'error'
      });
    }
  }

  // 2. Validate duplicate dependency versions across monorepo
  for (const [depName, versionsMap] of allDepsVersionsMap.entries()) {
    if (versionsMap.size > 1) {
      const versionsList = Array.from(versionsMap.keys());
      const details = versionsList
        .map((v) => `${v} in (${versionsMap.get(v)!.join(', ')})`)
        .join('; ');
      issues.push({
        category: 'duplicate_package_versions',
        message: `Dependency "${depName}" has multiple versions: ${details}`,
        severity: 'warning'
      });
    }
  }

  // 3. Check for invalid package references
  for (const [pkgName, { pkgJson, dir }] of packagesMap.entries()) {
    const checkRefs = (depsRecord: Record<string, string> | undefined) => {
      if (!depsRecord) return;
      for (const [depName, version] of Object.entries(depsRecord)) {
        if (version.startsWith('workspace:')) {
          const targetPkg = packagesMap.get(depName);
          if (!targetPkg) {
            issues.push({
              category: 'invalid_package_reference',
              message: `Workspace package "${depName}" is referenced but does not exist in the workspace.`,
              file: path.join(dir, 'package.json'),
              severity: 'error'
            });
          } else {
            if (version !== 'workspace:*' && version !== `workspace:${targetPkg.pkgJson.version}`) {
              issues.push({
                category: 'invalid_workspace_version',
                message: `Workspace reference mismatch for "${depName}": expects "${version}" but actual version is "${targetPkg.pkgJson.version}".`,
                file: path.join(dir, 'package.json'),
                severity: 'error'
              });
            }
          }
        }
      }
    };
    checkRefs(pkgJson.dependencies);
    checkRefs(pkgJson.devDependencies);
  }

  // 4. Check for orphaned packages (workspace packages that are NOT imported by any other packages/apps)
  const allWorkspacePackageNames = Array.from(packagesMap.keys());
  const importOccurrences = new Map<string, number>();
  for (const name of allWorkspacePackageNames) {
    importOccurrences.set(name, 0);
  }

  // Recursively search all files for imports matching workspace packages
  function scanImportsInDir(currentDir: string) {
    if (
      currentDir.includes('node_modules') ||
      currentDir.includes('dist') ||
      currentDir.includes('out') ||
      currentDir.includes('.turbo') ||
      currentDir.includes('.git') ||
      currentDir.includes('report')
    ) {
      return;
    }
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
      const fullPath = path.join(currentDir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanImportsInDir(fullPath);
      } else if (stat.isFile() && /\.(ts|tsx|js|jsx)$/.test(file)) {
        const code = fs.readFileSync(fullPath, 'utf8');
        for (const name of allWorkspacePackageNames) {
          const importRegex = new RegExp(
            `from\\s+['"]${name}['"]|import\\s+['"]${name}['"]|require\\s*\\(\\s*['"]${name}['"]\\s*\\)`,
            'g'
          );
          if (importRegex.test(code)) {
            importOccurrences.set(name, importOccurrences.get(name)! + 1);
          }
        }
      }
    }
  }

  // Scan root directory
  for (const dir of workspaceDirs) {
    scanImportsInDir(dir);
  }

  for (const [name, count] of importOccurrences.entries()) {
    const targetPkg = packagesMap.get(name)!;
    const relativeDir = path.relative(rootDir, targetPkg.dir).replace(/\\/g, '/');
    const isApp = relativeDir.startsWith('apps/');
    if (count === 0 && !isApp && name !== 'leadforge') {
      issues.push({
        category: 'orphaned_package',
        message: `Workspace package "${name}" is not imported anywhere in the monorepo.`,
        file: path.join(targetPkg.dir, 'package.json'),
        severity: 'warning'
      });
    }
  }

  // 5. Check for duplicate tsconfig.json or duplicate eslint configurations
  for (const dir of workspaceDirs) {
    const tsconfigFiles = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('tsconfig') && f.endsWith('.json'));
    if (tsconfigFiles.length > 2) {
      issues.push({
        category: 'duplicate_tsconfigs',
        message: `Multiple tsconfig files found in directory: ${tsconfigFiles.join(', ')}`,
        file: dir,
        severity: 'warning'
      });
    }
    const eslintFiles = fs
      .readdirSync(dir)
      .filter((f) => f.includes('eslint') || f.includes('.eslintrc'));
    if (eslintFiles.length > 1) {
      issues.push({
        category: 'duplicate_eslint_configs',
        message: `Multiple ESLint configuration files found in directory: ${eslintFiles.join(', ')}`,
        file: dir,
        severity: 'warning'
      });
    }
  }

  // 6. Check for dead scripts (scripts referencing non-existent files/commands)
  for (const [pkgName, { pkgJson, dir }] of packagesMap.entries()) {
    if (!pkgJson.scripts) continue;
    for (const [scriptName, scriptVal] of Object.entries(pkgJson.scripts)) {
      const nodeRunMatch = scriptVal.match(/(?:node|tsx|ts-node)\s+([^&\s|]+)/);
      if (nodeRunMatch && nodeRunMatch[1]) {
        const scriptPath = nodeRunMatch[1];
        if (scriptPath.endsWith('.js') || scriptPath.endsWith('.ts')) {
          const absoluteScriptPath = path.resolve(dir, scriptPath);
          if (!fs.existsSync(absoluteScriptPath)) {
            issues.push({
              category: 'dead_script',
              message: `Script "${scriptName}" references a non-existent file: "${scriptPath}"`,
              file: path.join(dir, 'package.json'),
              severity: 'warning'
            });
          }
        }
      }
    }
  }

  // 7. Check for dead tsconfig references
  for (const [pkgName, { dir }] of packagesMap.entries()) {
    const tsconfigPath = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      try {
        const content = fs.readFileSync(tsconfigPath, 'utf8');
        const cleanJson = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
        const tsconfig = JSON.parse(cleanJson);
        if (tsconfig.references && Array.isArray(tsconfig.references)) {
          for (const ref of tsconfig.references) {
            if (ref.path) {
              const absoluteRefPath = path.resolve(dir, ref.path);
              if (!fs.existsSync(absoluteRefPath)) {
                issues.push({
                  category: 'dead_tsconfig_reference',
                  message: `tsconfig.json references a non-existent path: "${ref.path}"`,
                  file: tsconfigPath,
                  severity: 'error'
                });
              }
            }
          }
        }
      } catch (err: any) {
        // Skip parsing errors
      }
    }
  }

  // 8. Find orphan exports
  for (const [pkgName, { pkgJson, dir }] of packagesMap.entries()) {
    const entryPoints = ['src/index.ts', 'src/main.ts', 'index.ts'].map((p) => path.join(dir, p));
    for (const entry of entryPoints) {
      if (fs.existsSync(entry)) {
        const content = fs.readFileSync(entry, 'utf8');
        const exportedNames: string[] = [];
        const lines = content.split('\n');
        for (const line of lines) {
          const bracedMatch = line.match(/export\s+\{\s*([^}]+)\s*\}/);
          if (bracedMatch && bracedMatch[1]) {
            const names = bracedMatch[1].split(',').map((n) => {
              const parts = n.trim().split(/\s+as\s+/);
              return parts[parts.length - 1]!.trim();
            });
            exportedNames.push(...names);
          }
          const directMatch = line.match(
            /export\s+(?:const|class|function|type|interface|enum)\s+(\w+)/
          );
          if (directMatch && directMatch[1]) {
            exportedNames.push(directMatch[1]);
          }
        }

        for (const name of exportedNames) {
          if (['default'].includes(name)) continue;
          let isImported = false;

          for (const [otherPkgName, otherPkg] of packagesMap.entries()) {
            if (otherPkgName === pkgName) continue;

            const scanForRef = (currentDir: string): boolean => {
              if (!fs.existsSync(currentDir)) return false;
              const files = fs.readdirSync(currentDir);
              for (const file of files) {
                const fullPath = path.join(currentDir, file);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                  if (scanForRef(fullPath)) return true;
                } else if (stat.isFile() && /\.(ts|tsx|js|jsx)$/.test(file)) {
                  const otherCode = fs.readFileSync(fullPath, 'utf8');
                  const importRefRegex = new RegExp(
                    `import\\s+[^]*\\b${name}\\b[^]*from\\s+['"]${pkgName}['"]|import\\s+[^]*from\\s+['"]${pkgName}['"]`
                  );
                  if (importRefRegex.test(otherCode) && otherCode.includes(name)) {
                    return true;
                  }
                }
              }
              return false;
            };

            if (scanForRef(path.join(otherPkg.dir, 'src'))) {
              isImported = true;
              break;
            }
          }

          if (!isImported && !pkgJson.private && pkgName !== '@huntara/sdk') {
            issues.push({
              category: 'orphan_export',
              message: `Exported symbol "${name}" in "${pkgJson.name}" is never imported by any other packages.`,
              file: entry,
              severity: 'warning'
            });
          }
        }
      }
    }
  }

  // 9. Build Report structure
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalPackages: packagesMap.size,
      errorsCount: errors.length,
      warningsCount: warnings.length
    },
    packages: Array.from(packagesMap.entries()).map(([name, val]) => ({
      name,
      version: val.pkgJson.version || '0.0.0',
      path: path.relative(rootDir, val.dir).replace(/\\/g, '/')
    })),
    issues: issues.map((i) => ({
      ...i,
      file: i.file ? path.relative(rootDir, i.file).replace(/\\/g, '/') : undefined
    }))
  };

  // Write JSON output
  const reportDir = path.join(rootDir, 'report');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }
  fs.writeFileSync(path.join(reportDir, 'health-report.json'), JSON.stringify(report, null, 2));

  // Write Markdown output
  let md = `# LeadForge OS Repository Health Report\n\n`;
  md += `**Timestamp**: ${report.timestamp}\n\n`;
  md += `## Summary\n\n`;
  md += `- **Total Workspace Packages**: ${report.summary.totalPackages}\n`;
  md += `- **Errors**: ${report.summary.errorsCount} ❌\n`;
  md += `- **Warnings**: ${report.summary.warningsCount} ⚠️\n\n`;

  md += `## Workspace Packages Inventory\n\n`;
  md += `| Package Name | Version | Directory Path |\n`;
  md += `| :--- | :--- | :--- |\n`;
  for (const pkg of report.packages) {
    md += `| \`${pkg.name}\` | \`${pkg.version}\` | \`${pkg.path}\` |\n`;
  }
  md += `\n`;

  md += `## Identified Issues\n\n`;
  if (report.issues.length === 0) {
    md += `✅ No health issues found. Clean repository!\n`;
  } else {
    md += `| Severity | Category | Issue Description | File Path |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const issue of report.issues) {
      const emoji = issue.severity === 'error' ? '❌ ERROR' : '⚠️ WARN';
      md += `| ${emoji} | \`${issue.category}\` | ${issue.message} | ${issue.file ? `\`${issue.file}\`` : 'N/A'} |\n`;
    }
  }

  fs.writeFileSync(path.join(reportDir, 'health-report.md'), md);

  console.log(`Repository Health Report generated:`);
  console.log(`- JSON: report/health-report.json`);
  console.log(`- Markdown: report/health-report.md`);
  console.log(
    `Summary: ${report.summary.errorsCount} errors, ${report.summary.warningsCount} warnings.`
  );

  if (errors.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error during repository health verification:', err);
  process.exit(1);
});
