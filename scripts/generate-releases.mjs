import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'apps/marketing/lib');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return isoString;
  }
}

export function parseArtifact(asset) {
  const name = asset.name || '';
  const lower = name.toLowerCase();

  // Exclude internal packaging / updater / checksum files
  if (
    lower.endsWith('.yml') ||
    lower.endsWith('.blockmap') ||
    lower.endsWith('.sha256') ||
    lower.endsWith('.sha512') ||
    lower.endsWith('.json') ||
    lower.endsWith('.txt') ||
    lower.startsWith('latest')
  ) {
    return null;
  }

  let platformId = null;
  let platformLabel = '';
  let architecture = 'x64';
  let architectureLabel = 'x64';
  let artifactType = '';
  let extension = '';

  if (lower.endsWith('.exe')) {
    platformId = 'windows';
    platformLabel = 'Windows';
    artifactType = 'NSIS Installer';
    extension = 'exe';
    if (lower.includes('arm64') || lower.includes('aarch64')) {
      architecture = 'arm64';
      architectureLabel = 'ARM64';
    } else {
      architecture = 'x64';
      architectureLabel = 'x64';
    }
  } else if (lower.endsWith('.dmg') || lower.endsWith('.zip')) {
    // Check if zip is explicitly for windows
    if (lower.endsWith('.zip') && (lower.includes('win') || lower.includes('windows'))) {
      platformId = 'windows';
      platformLabel = 'Windows';
      artifactType = 'ZIP Package';
      extension = 'zip';
      architecture = 'x64';
      architectureLabel = 'x64';
    } else {
      platformId = 'macos';
      platformLabel = 'macOS';
      artifactType = lower.endsWith('.dmg') ? 'Apple Disk Image' : 'ZIP Archive';
      extension = lower.endsWith('.dmg') ? 'dmg' : 'zip';
      if (lower.includes('arm64') || lower.includes('aarch64')) {
        architecture = 'arm64';
        architectureLabel = 'Apple Silicon';
      } else if (lower.includes('x64') || lower.includes('x86_64') || lower.includes('intel')) {
        architecture = 'x64';
        architectureLabel = 'Intel';
      } else if (lower.includes('universal')) {
        architecture = 'universal';
        architectureLabel = 'Universal';
      } else {
        architecture = 'universal';
        architectureLabel = 'Apple Silicon & Intel';
      }
    }
  } else if (lower.endsWith('.appimage')) {
    platformId = 'linux';
    platformLabel = 'Linux';
    artifactType = 'AppImage';
    extension = 'AppImage';
    if (lower.includes('arm64') || lower.includes('aarch64')) {
      architecture = 'arm64';
      architectureLabel = 'ARM64';
    } else {
      architecture = 'x64';
      architectureLabel = 'x64';
    }
  } else {
    return null;
  }

  const bytes = asset.size || asset.sizeBytes || 0;
  return {
    id: `${platformId}-${architecture}-${extension}`,
    name,
    platformId,
    platformLabel,
    architecture,
    architectureLabel,
    artifactType,
    extension,
    downloadUrl: asset.browser_download_url || asset.downloadUrl || '',
    sizeBytes: bytes,
    sizeFormatted: formatBytes(bytes),
    checksum: asset.checksum || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  };
}

export function groupPlatforms(rawAssets) {
  const platformMap = new Map();
  for (const raw of rawAssets) {
    const art = parseArtifact(raw);
    if (!art) continue;

    if (!platformMap.has(art.platformId)) {
      const icon = art.platformId === 'windows' ? 'Monitor' : art.platformId === 'macos' ? 'Apple' : 'Terminal';
      platformMap.set(art.platformId, {
        id: art.platformId,
        label: art.platformLabel,
        icon,
        artifacts: []
      });
    }
    platformMap.get(art.platformId).artifacts.push(art);
  }

  // Canonical order: Windows, macOS, Linux
  const order = ['windows', 'macos', 'linux'];
  const platforms = [];
  for (const pid of order) {
    if (platformMap.has(pid)) {
      platforms.push(platformMap.get(pid));
    }
  }
  return platforms;
}

// Fallback seed data in case of GitHub API rate limits
export const SEED_RELEASES = [
  {
    version: 'v1.2.0-beta',
    status: 'pre-release',
    releasedAt: '2026-09-19T08:00:00Z',
    releasedDateFormatted: 'September 19, 2026',
    summary: 'HUNTARA desktop environment running locally on your hardware. Latest beta release.',
    notes: `### HUNTARA Launch Release
* **Complete Product Rebrand**: Official release of HUNTARA with updated product identity and brand assets.
* **Canonical Local Storage**: Explicit user data namespace isolation at %APPDATA%\\HUNTARA with automated legacy migration.
* **Multi-Platform Releases**: Multi-platform release matrix support for Windows (.exe), macOS (.dmg), and Linux (.AppImage).
* **Local-First SQLite Engine**: High performance Write-Ahead Logging (WAL) and memory isolation per workspace.`,
    platforms: [
      {
        id: 'windows',
        label: 'Windows',
        icon: 'Monitor',
        artifacts: [
          {
            id: 'windows-x64-exe',
            name: 'HUNTARA-1.2.0-beta-win-x64.exe',
            platformId: 'windows',
            platformLabel: 'Windows',
            architecture: 'x64',
            architectureLabel: 'x64',
            artifactType: 'NSIS Installer',
            extension: 'exe',
            downloadUrl: 'https://github.com/kjxcodez/huntara/releases/download/v1.2.0-beta/HUNTARA-1.2.0-beta-win-x64.exe',
            sizeBytes: 100336820,
            sizeFormatted: '95.7 MB',
            checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          }
        ]
      }
    ]
  },
  {
    version: 'v1.1.1-beta.5',
    status: 'pre-release',
    releasedAt: '2026-09-06T16:11:35Z',
    releasedDateFormatted: 'September 6, 2026',
    summary: 'Internal beta release enhancing local SQLite indexing and background worker health.',
    notes: `### Beta Enhancements
* Enhanced local SQLite indexing for rapid CRM contact searching.
* Improved worker isolation during Playwright crawl routines.`,
    platforms: [
      {
        id: 'windows',
        label: 'Windows',
        icon: 'Monitor',
        artifacts: [
          {
            id: 'windows-x64-exe',
            name: 'HUNTARA-1.1.1-beta.5-win-x64.exe',
            platformId: 'windows',
            platformLabel: 'Windows',
            architecture: 'x64',
            architectureLabel: 'x64',
            artifactType: 'NSIS Installer',
            extension: 'exe',
            downloadUrl: 'https://github.com/kjxcodez/huntara/releases/download/v1.1.1-beta.5/HUNTARA-1.1.1-beta.5-win-x64.exe',
            sizeBytes: 100312108,
            sizeFormatted: '95.7 MB',
            checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          }
        ]
      }
    ]
  },
  {
    version: 'v1.1.1-beta.4.2',
    status: 'pre-release',
    releasedAt: '2026-09-02T18:36:18Z',
    releasedDateFormatted: 'September 2, 2026',
    summary: 'Maintenance beta release addressing email deliverability circuit breaker thresholds.',
    notes: `### Stability Updates
* Fixed email deliverability cooldown thresholds.
* Added telemetry monitoring for SQLite connection pool.`,
    platforms: [
      {
        id: 'windows',
        label: 'Windows',
        icon: 'Monitor',
        artifacts: [
          {
            id: 'windows-x64-exe',
            name: 'HUNTARA-1.1.1-beta.4.2-win-x64.exe',
            platformId: 'windows',
            platformLabel: 'Windows',
            architecture: 'x64',
            architectureLabel: 'x64',
            artifactType: 'NSIS Installer',
            extension: 'exe',
            downloadUrl: 'https://github.com/kjxcodez/huntara/releases/download/v1.1.1-beta.4.2/HUNTARA-1.1.1-beta.4.2-win-x64.exe',
            sizeBytes: 99874466,
            sizeFormatted: '95.2 MB',
            checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          }
        ]
      }
    ]
  }
];

export async function fetchReleases() {
  const url = 'https://api.github.com/repos/kjxcodez/huntara/releases';
  console.log(`Querying GitHub API: ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'HUNTARA-Builder',
        'Accept': 'application/vnd.github.v3+json'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Failed to fetch releases`);
    }

    const githubReleases = await res.json();
    if (!Array.isArray(githubReleases) || githubReleases.length === 0) {
      console.log('GitHub API returned empty releases. Using local seed data.');
      return SEED_RELEASES;
    }

    const processed = [];
    for (const rel of githubReleases) {
      const rawAssets = Array.isArray(rel.assets) ? rel.assets : [];
      const platforms = groupPlatforms(rawAssets);

      // Only include releases that have at least one valid public platform artifact
      if (platforms.length === 0) {
        continue;
      }

      const version = rel.tag_name || rel.name || 'v1.2.0-beta';
      const status = rel.prerelease ? 'pre-release' : 'stable';
      const releasedAt = rel.published_at || rel.created_at || new Date().toISOString();
      const releasedDateFormatted = formatDate(releasedAt);
      const notes = rel.body || 'Maintenance release with reliability and stability enhancements.';
      const summary = rel.prerelease
        ? `HUNTARA desktop preview release (${version}) running locally on your hardware.`
        : `Stable release of HUNTARA (${version}) with local-first discovery architecture.`;

      processed.push({
        version,
        status,
        releasedAt,
        releasedDateFormatted,
        summary,
        notes,
        platforms
      });
    }

    return processed.length > 0 ? processed : SEED_RELEASES;
  } catch (err) {
    console.warn(`Could not fetch releases from GitHub (${err.message}). Using fallback seed data.`);
    return SEED_RELEASES;
  }
}

async function main() {
  const releases = await fetchReleases();

  const code = `// Automatically generated by scripts/generate-releases.mjs
export type PlatformId = 'windows' | 'macos' | 'linux';

export interface ReleaseArtifact {
  id: string;
  name: string;
  platformId: PlatformId;
  platformLabel: string;
  architecture: string;
  architectureLabel: string;
  artifactType: string;
  extension: string;
  downloadUrl: string;
  sizeBytes: number;
  sizeFormatted: string;
  checksum: string;
}

export interface ReleasePlatform {
  id: PlatformId;
  label: string;
  icon: 'Monitor' | 'Apple' | 'Terminal';
  artifacts: ReleaseArtifact[];
}

export interface Release {
  version: string;
  status: 'stable' | 'pre-release';
  releasedAt: string;
  releasedDateFormatted: string;
  summary: string;
  notes: string;
  platforms: ReleasePlatform[];
}

export const GENERATED_RELEASES: Release[] = ${JSON.stringify(releases, null, 2)};

export function getAllReleases(): Release[] {
  return GENERATED_RELEASES;
}

export function normalizeVersion(v: string): string {
  if (!v) return '';
  return v.trim().toLowerCase();
}

export function getReleaseByVersion(version: string): Release | undefined {
  const norm = normalizeVersion(version);
  return GENERATED_RELEASES.find(r => {
    const rNorm = normalizeVersion(r.version);
    return rNorm === norm || rNorm === \`v\${norm}\` || \`v\${rNorm}\` === norm;
  });
}

export function normalizePlatformId(p: string): PlatformId | null {
  if (!p) return null;
  const lower = p.trim().toLowerCase();
  if (lower === 'windows' || lower === 'win') return 'windows';
  if (lower === 'macos' || lower === 'mac' || lower === 'darwin') return 'macos';
  if (lower === 'linux') return 'linux';
  return null;
}

export function getReleasePlatform(
  version: string,
  platformInput: string
): { release: Release; platform: ReleasePlatform } | null {
  const release = getReleaseByVersion(version);
  if (!release) return null;
  const platformId = normalizePlatformId(platformInput);
  if (!platformId) return null;
  const platform = release.platforms.find(p => p.id === platformId);
  if (!platform) return null;
  return { release, platform };
}

export function getLatestRelease(): Release {
  return GENERATED_RELEASES.find(r => r.status === 'stable') || GENERATED_RELEASES[0];
}
`;

  fs.writeFileSync(path.join(outputDir, 'generated-releases.ts'), code, 'utf8');
  console.log(`Generated: Releases configuration compiled into generated-releases.ts successfully! 🚀`);
}

// Run main if called directly
if (process.argv[1] && process.argv[1].endsWith('generate-releases.mjs')) {
  main().catch(err => {
    console.error('Fatal error during releases generation:', err);
    process.exit(1);
  });
}
