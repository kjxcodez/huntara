import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '..');

console.log('Migrating package namespace from @huntara/* to @huntara/*...');

// 1. Update package.json files
const packageJsonPaths = [
  path.join(rootDir, 'package.json'),
  path.join(rootDir, 'apps/desktop/package.json'),
  path.join(rootDir, 'apps/api/package.json'),
  path.join(rootDir, 'apps/marketing/package.json'),
  path.join(rootDir, 'packages/agent-core/package.json'),
  path.join(rootDir, 'packages/agent-runtime/package.json'),
  path.join(rootDir, 'packages/ai/package.json'),
  path.join(rootDir, 'packages/auth/package.json'),
  path.join(rootDir, 'packages/core/package.json'),
  path.join(rootDir, 'packages/logger/package.json'),
  path.join(rootDir, 'packages/schema/package.json'),
  path.join(rootDir, 'packages/sdk/package.json'),
  path.join(rootDir, 'packages/workflow-engine/package.json')
];

for (const pkgPath of packageJsonPaths) {
  if (fs.existsSync(pkgPath)) {
    let content = fs.readFileSync(pkgPath, 'utf8');
    // Replace package name if root
    if (pkgPath === path.join(rootDir, 'package.json')) {
      content = content.replace('"name": "leadforge"', '"name": "huntara"');
    }
    // Replace all @huntara/ with @huntara/
    content = content.replaceAll('@huntara/', '@huntara/');
    fs.writeFileSync(pkgPath, content, 'utf8');
    console.log(`Updated package.json: ${path.relative(rootDir, pkgPath)}`);
  }
}

// 2. Walk directory and update ts, tsx, js, mjs files
function walkDir(dir: string, callback: (filePath: string) => void) {
  if (
    dir.includes('node_modules') ||
    dir.includes('.git') ||
    dir.includes('dist') ||
    dir.includes('out') ||
    dir.includes('.turbo') ||
    dir.includes('.next')
  ) {
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs|yml|yaml|md|mdx)$/.test(entry.name)) {
      callback(fullPath);
    }
  }
}

let modifiedFilesCount = 0;
const targets = [
  path.join(rootDir, 'apps'),
  path.join(rootDir, 'packages'),
  path.join(rootDir, 'scripts'),
  path.join(rootDir, '.github')
];

for (const target of targets) {
  walkDir(target, (filePath) => {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('@huntara/')) {
      content = content.replaceAll('@huntara/', '@huntara/');
      fs.writeFileSync(filePath, content, 'utf8');
      modifiedFilesCount++;
    }
  });
}

console.log(
  `Finished migrating @huntara/ to @huntara/. Total files modified: ${modifiedFilesCount}`
);
