import { app, ipcMain, shell } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'fs';
import crypto from 'crypto';
import { AppLogger } from '../lib/logger';
import { loadConfig } from '../lib/config';

export interface UpdateCheckResult {
  updateAvailable: boolean;
  version: string;
  releaseNotes?: string;
  downloadUrl?: string;
  checksum?: string | undefined;
  checksumType?: 'sha256' | 'sha512' | undefined;
}

export interface UpdateProvider {
  checkForUpdate(currentVersion: string, channel: string): Promise<UpdateCheckResult>;
}

export function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) => {
    const clean = v.replace(/^v/, '');
    const [main = '', prerelease = ''] = clean.split('-');
    const parts = main.split('.').map(Number);
    return { parts, prerelease };
  };

  const p1 = parse(v1);
  const p2 = parse(v2);

  for (let i = 0; i < Math.max(p1.parts.length, p2.parts.length); i++) {
    const nv1 = p1.parts[i] || 0;
    const nv2 = p2.parts[i] || 0;
    if (nv1 > nv2) return 1;
    if (nv1 < nv2) return -1;
  }

  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  return 0;
}

// Initial GitHub Release Provider implementation
export class GitHubUpdateProvider implements UpdateProvider {
  constructor(
    private owner: string,
    private repo: string
  ) {}

  async checkForUpdate(currentVersion: string, channel: string): Promise<UpdateCheckResult> {
    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases`;
      AppLogger.info('Updater', `Querying GitHub API: ${url}`, undefined);

      const res = await fetch(url, { headers: { 'User-Agent': 'HUNTARA-Desktop' } });
      if (res.status === 404) {
        AppLogger.info('Updater', 'No releases found on GitHub for this repository.', undefined);
        return { updateAvailable: false, version: currentVersion };
      }
      if (!res.ok) {
        throw new Error(`GitHub releases API returned HTTP ${res.status}`);
      }

      const releases = (await res.json()) as any[];
      if (!Array.isArray(releases) || releases.length === 0) {
        AppLogger.info(
          'Updater',
          'No releases published yet on GitHub for this repository.',
          undefined
        );
        return { updateAvailable: false, version: currentVersion };
      }

      // Filter releases based on active channel
      const filteredReleases = releases.filter((r: any) => {
        if (r.draft) return false;

        // Check if version or flag indicates a pre-release
        const isPre = r.prerelease || r.tag_name.includes('-');
        if (channel === 'stable' && isPre) {
          return false; // stable channel ignores prereleases
        }
        return true;
      });

      if (filteredReleases.length === 0) {
        AppLogger.info('Updater', `No releases matching channel "${channel}".`, undefined);
        return { updateAvailable: false, version: currentVersion };
      }

      // Sort descending (latest version first)
      filteredReleases.sort((a: any, b: any) => compareVersions(b.tag_name, a.tag_name));

      const latestRelease = filteredReleases[0];
      const tag = latestRelease.tag_name || '';
      const version = tag.replace(/^v/, '');

      if (compareVersions(version, currentVersion) > 0) {
        const platform = process.platform;
        let ext = '.exe';
        if (platform === 'darwin') ext = '.dmg';
        if (platform === 'linux') ext = '.AppImage';

        const asset = latestRelease.assets?.find((a: any) => a.name.endsWith(ext));
        if (!asset) {
          AppLogger.warn(
            'Updater',
            `New version ${version} found, but no asset matching extension "${ext}" is available.`,
            undefined
          );
          return { updateAvailable: false, version: currentVersion };
        }

        let checksum: string | undefined = undefined;
        let checksumType: 'sha256' | 'sha512' | undefined = undefined;

        // Try to find direct checksum asset (*.sha256)
        const checksumAsset = latestRelease.assets?.find((a: any) =>
          a.name.endsWith(`${ext}.sha256`)
        );
        if (checksumAsset) {
          checksum = await this.fetchChecksum(checksumAsset.browser_download_url);
          checksumType = 'sha256';
        } else {
          // Fall back to latest.yml / latest-mac.yml
          const latestYmlName = platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
          const latestYmlAsset = latestRelease.assets?.find((a: any) => a.name === latestYmlName);
          if (latestYmlAsset) {
            const ymlText = await this.fetchText(latestYmlAsset.browser_download_url);
            if (ymlText) {
              const match = ymlText.match(/^sha512:\s*([^\r\n]+)/m);
              if (match && match[1]) {
                checksum = match[1].trim();
                checksumType = 'sha512';
              }
            }
          }
        }

        if (!checksum) {
          throw new Error(
            `Security Exception: Verification checksum not found for version ${version}. Aborting update.`
          );
        }

        AppLogger.info(
          'Updater',
          `Found update candidate: version ${version} on channel ${channel}`,
          undefined
        );

        return {
          updateAvailable: true,
          version,
          releaseNotes: latestRelease.body || '',
          downloadUrl: asset.browser_download_url,
          checksum,
          checksumType
        };
      } else {
        AppLogger.info(
          'Updater',
          `App is up-to-date. Current: ${currentVersion}, Latest: ${version} (${channel})`,
          undefined
        );
      }
    } catch (err: any) {
      AppLogger.error('Updater', `Update check failed: ${err.message}`, undefined);
      throw err;
    }
    return { updateAvailable: false, version: currentVersion };
  }

  private async fetchChecksum(url: string): Promise<string | undefined> {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        return text.trim().split(/\s+/)[0];
      }
    } catch (err: any) {
      AppLogger.warn('Updater', `Failed to fetch checksum file: ${err.message}`, undefined);
    }
    return undefined;
  }

  private async fetchText(url: string): Promise<string | undefined> {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.text();
      }
    } catch (err: any) {
      AppLogger.warn('Updater', `Failed to fetch file text: ${err.message}`, undefined);
    }
    return undefined;
  }
}

// Background Update Manager and Safe Installation Coordinator
export class UpdateManager {
  private static instance: UpdateManager;
  private provider: UpdateProvider;
  private channel = 'stable';
  private status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' = 'idle';
  private progress = 0;
  private availableVersion = '';
  private releaseNotes = '';
  private downloadUrl = '';
  private expectedChecksum = '';
  private expectedChecksumType: 'sha256' | 'sha512' = 'sha256';
  private downloadedFilePath = '';
  private activeSchedulers: any[] = []; // List of active JobSchedulers to verify idle state

  private constructor() {
    // Initialise with GitHub Releases provider
    this.provider = new GitHubUpdateProvider('kjxcodez', 'leadforge-os');
    this.registerIpcHandlers();
  }

  public static getInstance(): UpdateManager {
    if (!UpdateManager.instance) {
      UpdateManager.instance = new UpdateManager();
    }
    return UpdateManager.instance;
  }

  public registerScheduler(scheduler: any): void {
    this.activeSchedulers.push(scheduler);
  }

  public setProvider(provider: UpdateProvider): void {
    this.provider = provider;
  }

  public setChannel(channel: string): void {
    this.channel = channel;
  }

  public getStatus() {
    return {
      status: this.status,
      progress: this.progress,
      currentVersion: app.getVersion(),
      availableVersion: this.availableVersion,
      releaseNotes: this.releaseNotes,
      channel: this.channel
    };
  }

  public async check(): Promise<UpdateCheckResult> {
    if (this.status === 'checking' || this.status === 'downloading') {
      return { updateAvailable: false, version: this.availableVersion };
    }

    this.status = 'checking';
    this.progress = 0;
    this.notifyRenderer();

    try {
      // Synchronize channel config dynamically on every check
      try {
        const config = loadConfig();
        if (config?.settings?.updateChannel) {
          this.channel = config.settings.updateChannel;
        }
      } catch (configErr: any) {
        AppLogger.warn(
          'Updater',
          `Could not synchronize channel configuration: ${configErr.message}`,
          undefined
        );
      }

      const res = await this.provider.checkForUpdate(app.getVersion(), this.channel);
      if (res.updateAvailable) {
        this.status = 'available';
        this.availableVersion = res.version;
        this.releaseNotes = res.releaseNotes || '';
        this.downloadUrl = res.downloadUrl || '';
        this.expectedChecksum = res.checksum || '';
        this.expectedChecksumType = res.checksumType || 'sha256';
        AppLogger.info(
          'Updater',
          `New version ${res.version} is available for download.`,
          undefined
        );
      } else {
        this.status = 'idle';
      }
      this.notifyRenderer();
      return res;
    } catch (err: any) {
      this.status = 'error';
      this.notifyRenderer();
      throw err;
    }
  }

  public async download(): Promise<void> {
    if (this.status === 'downloading') {
      AppLogger.warn('Updater', 'Download already in progress.', undefined);
      return;
    }
    if (this.status !== 'available' || !this.downloadUrl) return;

    this.status = 'downloading';
    this.progress = 0;
    this.notifyRenderer();

    const tempDir = join(app.getPath('temp'), 'huntara-updates');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const fileName = `huntara-update-${this.availableVersion}${process.platform === 'win32' ? '.exe' : '.dmg'}`;
    const targetPath = join(tempDir, fileName);
    this.downloadedFilePath = targetPath;

    try {
      const response = await fetch(this.downloadUrl);
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      const contentLength = Number(response.headers.get('content-length') || 0);

      const fileStream = createWriteStream(targetPath);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported.');

      let receivedBytes = 0;
      let lastProgress = -1;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fileStream.write(value);
        receivedBytes += value.length;
        if (contentLength > 0) {
          const currentProgress = Math.round((receivedBytes / contentLength) * 100);
          if (currentProgress !== lastProgress) {
            lastProgress = currentProgress;
            this.progress = currentProgress;
            this.notifyRenderer();
          }
        }
      }
      fileStream.end();

      // Wait for the file stream to completely write and close
      await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', () => resolve());
        fileStream.on('error', (err) => reject(err));
      });

      // Verify checksum
      if (this.expectedChecksum) {
        const hashType = this.expectedChecksumType;
        const fileHash = await this.calculateFileHash(targetPath, hashType);

        let verified = false;
        if (hashType === 'sha512') {
          // In latest.yml, sha512 checksum is in base64. Let's compare case-insensitively or directly.
          if (
            fileHash === this.expectedChecksum ||
            fileHash.toLowerCase() === this.expectedChecksum.toLowerCase()
          ) {
            verified = true;
          }
        } else {
          if (fileHash.toLowerCase() === this.expectedChecksum.toLowerCase()) {
            verified = true;
          }
        }

        if (!verified) {
          unlinkSync(targetPath);
          throw new Error(
            `Checksum mismatch. Expected: ${this.expectedChecksum}, Got: ${fileHash}`
          );
        }
        AppLogger.info('Updater', 'Package checksum verified successfully.', undefined);
      }

      this.status = 'ready';
      this.notifyRenderer();
      AppLogger.info(
        'Updater',
        `Version ${this.availableVersion} downloaded and ready for installation.`,
        undefined
      );
    } catch (err: any) {
      this.status = 'error';
      this.notifyRenderer();
      AppLogger.error('Updater', `Download failed: ${err.message}`, undefined);
      if (existsSync(targetPath)) {
        try {
          unlinkSync(targetPath);
        } catch {}
      }
      throw err;
    }
  }

  // Safe Coordinator checks before installing
  public isSafeToInstall(): boolean {
    for (const scheduler of this.activeSchedulers) {
      if (scheduler.activeWorkers && scheduler.activeWorkers.size > 0) {
        return false;
      }
    }
    return true;
  }

  public install(): void {
    if (this.status !== 'ready' || !this.downloadedFilePath) return;

    if (!this.isSafeToInstall()) {
      AppLogger.warn(
        'Updater',
        'Install deferred: campaigns or background scheduler jobs are currently active.',
        undefined
      );
      return;
    }

    AppLogger.info(
      'Updater',
      'Shutting down active schedulers and installing update...',
      undefined
    );

    const platform = process.platform;
    if (platform === 'win32') {
      shell.openPath(this.downloadedFilePath).then((err) => {
        if (err) {
          AppLogger.error('Updater', `Failed to open installer path: ${err}`, undefined);
        } else {
          app.quit();
        }
      });
    } else {
      AppLogger.warn(
        'Updater',
        `Platform ${platform} auto-installer not implemented. Please install manually: ${this.downloadedFilePath}`,
        undefined
      );
    }
  }

  private calculateFileHash(
    filePath: string,
    algo: 'sha256' | 'sha512' = 'sha256'
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algo);
      const stream = require('fs').createReadStream(filePath);
      stream.on('data', (data: any) => hash.update(data));
      stream.on('end', () => {
        if (algo === 'sha512') {
          resolve(hash.digest('base64'));
        } else {
          resolve(hash.digest('hex'));
        }
      });
      stream.on('error', (err: any) => reject(err));
    });
  }

  private notifyRenderer(): void {
    try {
      const wins = require('electron').BrowserWindow.getAllWindows();
      for (const w of wins) {
        w.webContents.send('updater:status-changed', this.getStatus());
      }
    } catch {}
  }

  private registerIpcHandlers(): void {
    if (typeof ipcMain === 'undefined' || !ipcMain) return;
    ipcMain.handle('updater:get-status', () => this.getStatus());
    ipcMain.handle('updater:check', () => this.check());
    ipcMain.handle('updater:download', () => this.download());
    ipcMain.handle('updater:install', () => this.install());
  }
}
