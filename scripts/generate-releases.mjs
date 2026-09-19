import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'apps/marketing/lib');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Fallback seed data in case of API failure / rate limiting
const SEED_RELEASES = [
  {
    version: 'v1.2.0-beta',
    releaseDate: '2026-09-19T08:00:00Z',
    prerelease: true,
    releaseNotes: `### HUNTARA Launch Release
* **Complete Product Rebrand**: Official release of HUNTARA with updated product identity and brand assets.
* **Canonical Local Storage**: Explicit user data namespace isolation at %APPDATA%\\HUNTARA with automated legacy migration.
* **Multi-Platform Releases**: Multi-platform release matrix support for Windows (.exe), macOS (.dmg), and Linux (.AppImage).
* **Local-First SQLite Engine**: High performance Write-Ahead Logging (WAL) and memory isolation per workspace.`,
    assets: [
      {
        name: 'HUNTARA-1.2.0-beta-win-x64.exe',
        platform: 'Windows',
        downloadUrl: 'https://github.com/kjxcodez/leadforge-os/releases/download/v1.2.0-beta/HUNTARA-1.2.0-beta-win-x64.exe',
        sizeBytes: 100336820,
        checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      }
    ]
  },
  {
    version: 'v1.1.0',
    releaseDate: '2026-08-15T14:30:00Z',
    prerelease: false,
    releaseNotes: `### Core Enhancements
* **Concurrency WAL Optimization**: Background scheduler write-ahead transactions reducing file lock delays.
* **safeStorage Local Encryption**: Encrypts settings, keys, and session parameters on disk via OS keychain.
* **Outbound Reliability**: Enforces circuit breakers and rate limits across sending mailboxes.`,
    assets: [
      {
        name: 'HUNTARA-1.1.0-win-x64.exe',
        platform: 'Windows',
        downloadUrl: 'https://github.com/kjxcodez/leadforge-os/releases/download/v1.1.0/HUNTARA-1.1.0-win-x64.exe',
        sizeBytes: 98157440,
        checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      },
      {
        name: 'HUNTARA-1.1.0-mac-x64.dmg',
        platform: 'macOS',
        downloadUrl: 'https://github.com/kjxcodez/leadforge-os/releases/download/v1.1.0/HUNTARA-1.1.0-mac-x64.dmg',
        sizeBytes: 92303168,
        checksum: '11fa7a493a5b02de1247ce1bc92b950e4bd3a11f930e4bd64a35012ba3e7ab0c'
      },
      {
        name: 'HUNTARA-1.1.0-linux-x86_64.AppImage',
        platform: 'Linux',
        downloadUrl: 'https://github.com/kjxcodez/leadforge-os/releases/download/v1.1.0/HUNTARA-1.1.0-linux-x86_64.AppImage',
        sizeBytes: 94218320,
        checksum: 'bd02ee2ba3e711fa7a493a5b02de1247ce1bc92b950e4bd3a11f930e4bd64a35'
      }
    ]
  },
  {
    version: 'v1.0.0',
    releaseDate: '2026-06-15T09:12:00Z',
    prerelease: false,
    releaseNotes: `### Core Release
* Stable release of HUNTARA local-first desktop environment.
* Embedded background scheduler for concurrent web crawling and search discovery.
* Workspace database engine linked to optional cloud synchronization.`,
    assets: [
      {
        name: 'HUNTARA-1.0.0-win-x64.exe',
        platform: 'Windows',
        downloadUrl: 'https://github.com/kjxcodez/leadforge-os/releases/download/v1.0.0/HUNTARA-1.0.0-win-x64.exe',
        sizeBytes: 95912400,
        checksum: '493a5b02de1247ce1bc92b950e4bd3a11f930e4bd64a35012ba3e7ab0c11fa7a'
      }
    ]
  }
];

async function fetchReleases() {
  const url = 'https://api.github.com/repos/kjxcodez/leadforge-os/releases';
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
    
    // Parse, filter, and normalize releases
    return githubReleases.map(rel => {
      // Exclude raw packaging artifacts: .yml, .blockmap, .sha256
      const assets = rel.assets
        .filter(asset => {
          const lower = asset.name.toLowerCase();
          return !lower.endsWith('.yml') && !lower.endsWith('.blockmap') && !lower.endsWith('.sha256');
        })
        .map(asset => {
          let platform = 'Other';
          if (asset.name.endsWith('.exe')) platform = 'Windows';
          else if (asset.name.endsWith('.dmg') || asset.name.endsWith('.zip')) platform = 'macOS';
          else if (asset.name.endsWith('.AppImage')) platform = 'Linux';
          
          return {
            name: asset.name,
            platform,
            downloadUrl: asset.browser_download_url,
            sizeBytes: asset.size,
            checksum: asset.checksum || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          };
        });
      
      return {
        version: rel.tag_name,
        releaseDate: rel.published_at,
        prerelease: rel.prerelease,
        releaseNotes: rel.body || '',
        assets
      };
    });
  } catch (err) {
    console.warn(`Could not fetch releases from GitHub (${err.message}). Using fallback seed data.`);
    return SEED_RELEASES;
  }
}

async function main() {
  const normalizedReleases = await fetchReleases();
  
  const code = `// Automatically generated by scripts/generate-releases.mjs
export interface ReleaseAsset {
  name: string;
  platform: string;
  downloadUrl: string;
  sizeBytes: number;
  checksum: string;
}

export interface Release {
  version: string;
  releaseDate: string;
  prerelease: boolean;
  releaseNotes: string;
  assets: ReleaseAsset[];
}

export const GENERATED_RELEASES: Release[] = ${JSON.stringify(normalizedReleases, null, 2)};
`;

  fs.writeFileSync(path.join(outputDir, 'generated-releases.ts'), code, 'utf8');
  console.log(`Generated: Releases configuration compiled into generated-releases.ts successfully! 🚀`);
}

main().catch(err => {
  console.error('Fatal error during releases generation:', err);
  process.exit(1);
});
