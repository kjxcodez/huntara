import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import crypto from 'crypto';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => path.resolve(__dirname, '../../../../../report/temp-smoke')),
    getVersion: vi.fn(() => '1.0.0-beta.1'),
    isPackaged: false,
    setAppUserModelId: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}));

import { UpdateManager, GitHubUpdateProvider, compareVersions } from './updater';

describe('Auto-Update Infrastructure Suite', () => {
  const originalFetch = globalThis.fetch;

  function mockFetch(responses: Record<string, any>) {
    globalThis.fetch = ((url: any) => {
      const urlStr = String(url);
      for (const [key, val] of Object.entries(responses)) {
        if (urlStr.includes(key)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(typeof val === 'string' ? JSON.parse(val) : val),
            text: () => Promise.resolve(typeof val === 'string' ? val : JSON.stringify(val)),
            body: {
              getReader() {
                let sent = false;
                const buffer = Buffer.from(typeof val === 'string' ? val : JSON.stringify(val));
                return {
                  async read() {
                    if (sent) return { done: true, value: undefined };
                    sent = true;
                    return { done: false, value: new Uint8Array(buffer) };
                  }
                };
              }
            },
            headers: {
              get(name: string) {
                if (name.toLowerCase() === 'content-length') {
                  const buffer = Buffer.from(typeof val === 'string' ? val : JSON.stringify(val));
                  return String(buffer.length);
                }
                return null;
              }
            }
          } as any);
        }
      }
      return Promise.reject(new Error(`Unhandled mock fetch for URL: ${urlStr}`));
    }) as any;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('checks safe coordinator idle conditions', () => {
    const manager = UpdateManager.getInstance();
    const mockScheduler = {
      activeWorkers: new Set<string>()
    };
    manager.registerScheduler(mockScheduler);

    expect(manager.isSafeToInstall()).toBe(true);

    mockScheduler.activeWorkers.add('job-1');
    expect(manager.isSafeToInstall()).toBe(false);
  });

  it('correctly compares prerelease and stable semantic versions', () => {
    expect(compareVersions('0.1.0-beta.2', '0.1.0-beta.1') > 0).toBe(true);
    expect(compareVersions('0.1.0-beta.1', '0.0.1') > 0).toBe(true);
    expect(compareVersions('0.1.0', '0.1.0-beta.1') > 0).toBe(true);
    expect(compareVersions('0.1.0-beta.1', '0.1.0') < 0).toBe(true);
    expect(compareVersions('0.1.0-beta.1', '0.1.0-beta.1') === 0).toBe(true);
  });

  it('filters and sorts releases by channel (stable vs beta)', async () => {
    const provider = new GitHubUpdateProvider('kjxcodez', 'huntara');

    const mockReleases = [
      {
        tag_name: 'v0.1.2',
        draft: false,
        prerelease: false,
        body: 'Old stable release',
        assets: [
          {
            name: 'LeadForge OS-0.1.2-win-x64.exe',
            browser_download_url: 'https://github.com/mock/0.1.2.exe'
          },
          { name: 'latest.yml', browser_download_url: 'https://github.com/mock/latest-old.yml' }
        ]
      },
      {
        tag_name: 'v1.0.0-beta.2',
        draft: false,
        prerelease: true,
        body: 'New pre-release version',
        assets: [
          {
            name: 'LeadForge OS-1.0.0-beta.2-win-x64.exe',
            browser_download_url: 'https://github.com/mock/1.0.0-beta.2.exe'
          },
          { name: 'latest.yml', browser_download_url: 'https://github.com/mock/latest-beta.yml' }
        ]
      },
      {
        tag_name: 'v0.1.3',
        draft: false,
        prerelease: false,
        body: 'Latest stable release',
        assets: [
          {
            name: 'LeadForge OS-0.1.3-win-x64.exe',
            browser_download_url: 'https://github.com/mock/0.1.3.exe'
          },
          { name: 'latest.yml', browser_download_url: 'https://github.com/mock/latest-stable.yml' }
        ]
      }
    ];

    mockFetch({
      '/releases': mockReleases,
      '.sha256': 'mock-hash-value-here',
      'latest-old.yml': 'version: 0.1.2\nsha512: mock-old-sha512',
      'latest-beta.yml': 'version: 1.0.0-beta.2\nsha512: mock-beta-sha512',
      'latest-stable.yml': 'version: 0.1.3\nsha512: mock-stable-sha512'
    });

    // Querying with stable channel, currentVersion = 0.1.2
    let result = await provider.checkForUpdate('0.1.2', 'stable');
    expect(result.updateAvailable).toBe(true);
    expect(result.version).toBe('0.1.3');

    // Querying with stable channel, currentVersion = 0.1.3
    result = await provider.checkForUpdate('0.1.3', 'stable');
    expect(result.updateAvailable).toBe(false);

    // Querying with beta channel, currentVersion = 0.1.3
    result = await provider.checkForUpdate('0.1.3', 'beta');
    expect(result.updateAvailable).toBe(true);
    expect(result.version).toBe('1.0.0-beta.2');
  });

  it('verifies checksum integrity and fallback mechanisms', async () => {
    const provider = new GitHubUpdateProvider('kjxcodez', 'huntara');
    const testPayload = 'leadforge-update-payload';
    const sha256Hash = crypto.createHash('sha256').update(testPayload).digest('hex');
    const sha512HashB64 = crypto.createHash('sha512').update(testPayload).digest('base64');

    // Direct sha256 checksum asset matching
    mockFetch({
      '/releases': [
        {
          tag_name: 'v1.0.0',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'LeadForge OS-1.0.0-win-x64.exe',
              browser_download_url: 'https://github.com/mock/installer.exe'
            },
            {
              name: 'LeadForge OS-1.0.0-win-x64.exe.sha256',
              browser_download_url: 'https://github.com/mock/installer.exe.sha256'
            }
          ]
        }
      ],
      'installer.exe.sha256': sha256Hash,
      'installer.exe': testPayload
    });

    let result = await provider.checkForUpdate('0.9.0', 'stable');
    expect(result.checksum).toBe(sha256Hash);
    expect(result.checksumType).toBe('sha256');

    // Fallback to latest.yml SHA-512 parsing
    mockFetch({
      '/releases': [
        {
          tag_name: 'v1.0.0',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'LeadForge OS-1.0.0-win-x64.exe',
              browser_download_url: 'https://github.com/mock/installer.exe'
            },
            { name: 'latest.yml', browser_download_url: 'https://github.com/mock/latest.yml' }
          ]
        }
      ],
      'latest.yml': `version: 1.0.0\nsha512: ${sha512HashB64}\npath: LeadForge OS-1.0.0-win-x64.exe`,
      'installer.exe': testPayload
    });

    result = await provider.checkForUpdate('0.9.0', 'stable');
    expect(result.checksum).toBe(sha512HashB64);
    expect(result.checksumType).toBe('sha512');

    // Throw exception if no checksum is found
    mockFetch({
      '/releases': [
        {
          tag_name: 'v1.0.0',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'LeadForge OS-1.0.0-win-x64.exe',
              browser_download_url: 'https://github.com/mock/installer.exe'
            }
          ]
        }
      ],
      'installer.exe': testPayload
    });

    await expect(provider.checkForUpdate('0.9.0', 'stable')).rejects.toThrow(/Security Exception/);
  });

  it('validates state machine transitions and checksum matching', async () => {
    const manager = UpdateManager.getInstance();
    const provider = new GitHubUpdateProvider('kjxcodez', 'huntara');
    const testPayload = 'leadforge-update-payload';
    const sha256Hash = crypto.createHash('sha256').update(testPayload).digest('hex');

    mockFetch({
      '/releases': [
        {
          tag_name: 'v1.0.0',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'LeadForge OS-1.0.0-win-x64.exe',
              browser_download_url: 'https://github.com/mock/installer.exe'
            },
            {
              name: 'LeadForge OS-1.0.0-win-x64.exe.sha256',
              browser_download_url: 'https://github.com/mock/installer.exe.sha256'
            }
          ]
        }
      ],
      'installer.exe.sha256': sha256Hash,
      'installer.exe': testPayload
    });

    manager.setProvider(provider);
    manager.setChannel('stable');

    const checkRes = await manager.check();
    expect(checkRes.updateAvailable).toBe(true);
    expect(manager.getStatus().status).toBe('available');

    await manager.download();
    expect(manager.getStatus().status).toBe('ready');

    // Checksum mismatch triggers error
    mockFetch({
      '/releases': [
        {
          tag_name: 'v1.0.0',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'LeadForge OS-1.0.0-win-x64.exe',
              browser_download_url: 'https://github.com/mock/installer.exe'
            },
            {
              name: 'LeadForge OS-1.0.0-win-x64.exe.sha256',
              browser_download_url: 'https://github.com/mock/installer.exe.sha256'
            }
          ]
        }
      ],
      'installer.exe.sha256': 'wrong-hash-value',
      'installer.exe': testPayload
    });

    await manager.check();
    await expect(manager.download()).rejects.toThrow(/Checksum mismatch/);
    expect(manager.getStatus().status).toBe('error');
  });
});
