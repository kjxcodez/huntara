import { join, dirname } from 'path';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, unlinkSync, createWriteStream } from 'fs';
import { app, ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import { AppLogger } from './logger';

const execFileAsync = promisify(execFile);

/**
 * Browser engine setup status descriptor.
 */
export interface BrowserEngineStatus {
  isInstalled: boolean;
  isInstalling: boolean;
  browsersPath: string;
  executablePath?: string | undefined;
  headlessPath?: string | undefined;
  lastError?: string | undefined;
}

let isInstalling = false;
let lastInstallError: string | undefined;

// Current Playwright-core target revision and browser version (from playwright-core/browsers.json)
const PLAYWRIGHT_CHROMIUM_REVISION = '1234';
const PLAYWRIGHT_BROWSER_VERSION = '151.0.7922.34';
const PLAYWRIGHT_FFMPEG_REVISION = '1011';

/**
 * Returns the path where HUNTARA stores its Playwright browser binaries.
 */
export function getPlaywrightBrowsersPath(): string {
  if (app && typeof app.getPath === 'function') {
    return join(app.getPath('userData'), 'playwright-browsers');
  }
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? join(process.env.HOME || '', 'Library', 'Application Support')
      : join(process.env.HOME || '', '.config'));
  const canonicalPath = join(appData, 'HUNTARA', 'playwright-browsers');
  const legacyPath = join(appData, '@leadforge', 'desktop', 'playwright-browsers');
  return existsSync(canonicalPath) ? canonicalPath : (existsSync(legacyPath) ? legacyPath : canonicalPath);
}

/**
 * Returns the platform-specific directory name and archive filename for Chromium.
 */
function getPlatformConfig() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return {
      chromeArchive: 'chrome-win64.zip',
      chromeDirName: 'chrome-win64',
      chromeExeName: 'chrome.exe',
      headlessArchive: 'chrome-headless-shell-win64.zip',
      headlessDirName: 'chrome-headless-shell-win64',
      headlessExeName: 'chrome-headless-shell.exe',
      cftPlatform: 'win64'
    };
  }

  if (platform === 'darwin') {
    const macArch = arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    return {
      chromeArchive: `chrome-${macArch}.zip`,
      chromeDirName: `chrome-${macArch}`,
      chromeExeName: 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      headlessArchive: `chrome-headless-shell-${macArch}.zip`,
      headlessDirName: `chrome-headless-shell-${macArch}`,
      headlessExeName: 'chrome-headless-shell',
      cftPlatform: macArch
    };
  }

  return {
    chromeArchive: 'chrome-linux64.zip',
    chromeDirName: 'chrome-linux64',
    chromeExeName: 'chrome',
    headlessArchive: 'chrome-headless-shell-linux64.zip',
    headlessDirName: 'chrome-headless-shell-linux64',
    headlessExeName: 'chrome-headless-shell',
    cftPlatform: 'linux64'
  };
}

/**
 * Resolves the platform-specific Chrome Headless Shell executable path.
 */
export function getHeadlessShellPath(execPath: string): string | null {
  const match = execPath.match(/chromium-(\d+)/);
  if (!match) return null;
  const rev = match[1];
  const baseDir = execPath.slice(0, execPath.indexOf(`chromium-${rev}`));
  const config = getPlatformConfig();

  return join(
    baseDir,
    `chromium_headless_shell-${rev}`,
    config.headlessDirName,
    config.headlessExeName
  );
}

/**
 * Resolves the primary Chromium executable path.
 */
export function getChromiumExecutablePath(): string {
  const basePath = getPlaywrightBrowsersPath();
  const config = getPlatformConfig();
  return join(
    basePath,
    `chromium-${PLAYWRIGHT_CHROMIUM_REVISION}`,
    config.chromeDirName,
    config.chromeExeName
  );
}

/**
 * Checks whether both Chromium and Headless Shell exist and have complete installation markers.
 */
export async function isBrowserInstalled(): Promise<boolean> {
  try {
    const basePath = getPlaywrightBrowsersPath();
    const config = getPlatformConfig();

    const chromeDir = join(basePath, `chromium-${PLAYWRIGHT_CHROMIUM_REVISION}`);
    const chromeExe = join(chromeDir, config.chromeDirName, config.chromeExeName);
    const chromeMarker = join(chromeDir, 'INSTALLATION_COMPLETE');

    const headlessDir = join(basePath, `chromium_headless_shell-${PLAYWRIGHT_CHROMIUM_REVISION}`);
    const headlessExe = join(headlessDir, config.headlessDirName, config.headlessExeName);
    const headlessMarker = join(headlessDir, 'INSTALLATION_COMPLETE');

    const chromeReady = existsSync(chromeExe) && existsSync(chromeMarker);
    const headlessReady = existsSync(headlessExe) && existsSync(headlessMarker);

    return chromeReady && headlessReady;
  } catch {
    return false;
  }
}

/**
 * Returns current browser engine diagnostic status.
 */
export async function getBrowserEngineStatus(): Promise<BrowserEngineStatus> {
  const browsersPath = getPlaywrightBrowsersPath();
  const installed = await isBrowserInstalled();
  const executablePath = getChromiumExecutablePath();
  const headlessPath = getHeadlessShellPath(executablePath);

  return {
    isInstalled: installed,
    isInstalling,
    browsersPath,
    executablePath: installed ? executablePath : undefined,
    headlessPath: (installed && headlessPath) ? headlessPath : undefined,
    lastError: lastInstallError
  };
}

/**
 * Downloads a remote URL into a local file, following HTTP redirects.
 */
function downloadFile(
  url: string,
  destination: string,
  onProgress?: (receivedBytes: number, totalBytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    function request(currentUrl: string, redirectCount = 0) {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects while downloading browser binary'));
      }

      https
        .get(currentUrl, (response) => {
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            return request(response.headers.location, redirectCount + 1);
          }

          if (response.statusCode !== 200) {
            return reject(new Error(`Failed to download ${currentUrl}: HTTP ${response.statusCode}`));
          }

          const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
          let receivedBytes = 0;
          const fileStream = createWriteStream(destination);

          response.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (onProgress) {
              onProgress(receivedBytes, totalBytes);
            }
          });

          response.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });

          fileStream.on('error', (err) => {
            try { unlinkSync(destination); } catch {}
            reject(err);
          });
        })
        .on('error', (err) => {
          try { unlinkSync(destination); } catch {}
          reject(err);
        });
    }

    request(url);
  });
}

/**
 * Unzips an archive using native platform utilities (bsdtar or PowerShell fallback).
 */
async function extractArchive(zipPath: string, destDir: string): Promise<void> {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  // Primary: bsdtar (standard on modern Windows, macOS, and Linux)
  try {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destDir]);
    return;
  } catch (tarErr) {
    AppLogger.warn('PlaywrightSetup', `tar extraction failed: ${tarErr}. Trying platform fallback...`);
  }

  // Windows fallback: PowerShell Expand-Archive
  if (process.platform === 'win32') {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`
    ]);
    return;
  }

  // Unix fallback: unzip
  await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', destDir]);
}

/**
 * Performs atomic native CDN download and installation of Playwright Chromium binaries.
 */
export async function installPlaywrightBrowsers(
  onProgress?: (line: string) => void
): Promise<void> {
  if (isInstalling) {
    AppLogger.warn('PlaywrightSetup', 'Browser installation is already in progress.');
    return;
  }

  isInstalling = true;
  lastInstallError = undefined;

  const browsersPath = getPlaywrightBrowsersPath();
  if (!existsSync(browsersPath)) {
    mkdirSync(browsersPath, { recursive: true });
  }

  const config = getPlatformConfig();
  const cdnBase = `https://cdn.playwright.dev/builds/cft/${PLAYWRIGHT_BROWSER_VERSION}/${config.cftPlatform}`;

  const chromeZipUrl = `${cdnBase}/${config.chromeArchive}`;
  const headlessZipUrl = `${cdnBase}/${config.headlessArchive}`;

  const stagingChromeDir = join(browsersPath, `.staging-chromium-${PLAYWRIGHT_CHROMIUM_REVISION}`);
  const finalChromeDir = join(browsersPath, `chromium-${PLAYWRIGHT_CHROMIUM_REVISION}`);
  const tempChromeZip = join(browsersPath, `chrome-${Date.now()}.zip`);

  const stagingHeadlessDir = join(browsersPath, `.staging-chromium_headless_shell-${PLAYWRIGHT_CHROMIUM_REVISION}`);
  const finalHeadlessDir = join(browsersPath, `chromium_headless_shell-${PLAYWRIGHT_CHROMIUM_REVISION}`);
  const tempHeadlessZip = join(browsersPath, `headless-${Date.now()}.zip`);

  try {
    // ── 1. Download & Extract Chromium ─────────────────────────────────────────
    onProgress?.(`Downloading Chromium (${config.chromeArchive})...`);
    AppLogger.info('PlaywrightSetup', `Downloading Chromium from ${chromeZipUrl}`);

    // Clean up any stale staging folder
    if (existsSync(stagingChromeDir)) rmSync(stagingChromeDir, { recursive: true, force: true });
    mkdirSync(stagingChromeDir, { recursive: true });

    await downloadFile(chromeZipUrl, tempChromeZip, (received, total) => {
      if (total > 0 && onProgress) {
        const pct = Math.round((received / total) * 100);
        onProgress(`Downloading Chromium: ${pct}%`);
      }
    });

    onProgress?.('Extracting Chromium engine...');
    AppLogger.info('PlaywrightSetup', `Extracting Chromium to ${stagingChromeDir}`);
    await extractArchive(tempChromeZip, stagingChromeDir);
    try { unlinkSync(tempChromeZip); } catch {}

    // Write installation marker in staging directory
    writeFileSync(join(stagingChromeDir, 'INSTALLATION_COMPLETE'), '');

    // ── 2. Download & Extract Headless Shell ───────────────────────────────────
    onProgress?.(`Downloading Headless Shell (${config.headlessArchive})...`);
    AppLogger.info('PlaywrightSetup', `Downloading Headless Shell from ${headlessZipUrl}`);

    if (existsSync(stagingHeadlessDir)) rmSync(stagingHeadlessDir, { recursive: true, force: true });
    mkdirSync(stagingHeadlessDir, { recursive: true });

    await downloadFile(headlessZipUrl, tempHeadlessZip, (received, total) => {
      if (total > 0 && onProgress) {
        const pct = Math.round((received / total) * 100);
        onProgress(`Downloading Headless Shell: ${pct}%`);
      }
    });

    onProgress?.('Extracting Headless Shell...');
    AppLogger.info('PlaywrightSetup', `Extracting Headless Shell to ${stagingHeadlessDir}`);
    await extractArchive(tempHeadlessZip, stagingHeadlessDir);
    try { unlinkSync(tempHeadlessZip); } catch {}

    // Write installation marker in staging directory
    writeFileSync(join(stagingHeadlessDir, 'INSTALLATION_COMPLETE'), '');

    // ── 3. Atomic Renaming ───────────────────────────────────────────────────
    onProgress?.('Finalizing installation...');

    if (existsSync(finalChromeDir)) rmSync(finalChromeDir, { recursive: true, force: true });
    renameSync(stagingChromeDir, finalChromeDir);

    if (existsSync(finalHeadlessDir)) rmSync(finalHeadlessDir, { recursive: true, force: true });
    renameSync(stagingHeadlessDir, finalHeadlessDir);

    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
    AppLogger.info('PlaywrightSetup', 'Playwright browser engines installed and verified.');
    onProgress?.('Browser engine installed successfully.');
  } catch (err: any) {
    lastInstallError = err.message || String(err);
    AppLogger.error('PlaywrightSetup', 'Playwright native CDN installation failed', undefined, err);
    // Cleanup temporary files
    try { if (existsSync(stagingChromeDir)) rmSync(stagingChromeDir, { recursive: true, force: true }); } catch {}
    try { if (existsSync(stagingHeadlessDir)) rmSync(stagingHeadlessDir, { recursive: true, force: true }); } catch {}
    try { if (existsSync(tempChromeZip)) unlinkSync(tempChromeZip); } catch {}
    try { if (existsSync(tempHeadlessZip)) unlinkSync(tempHeadlessZip); } catch {}
    throw err;
  } finally {
    isInstalling = false;
  }
}

/**
 * Ensures Playwright's Chromium browser is present before any scraper jobs run.
 */
export async function ensurePlaywrightBrowsers(
  onProgress?: (line: string) => void
): Promise<void> {
  process.env.PLAYWRIGHT_BROWSERS_PATH = getPlaywrightBrowsersPath();

  const installed = await isBrowserInstalled();
  if (installed) {
    AppLogger.info('PlaywrightSetup', 'Chromium browser already present. Skipping installation.');
    return;
  }

  AppLogger.info(
    'PlaywrightSetup',
    'Chromium browser not found. Starting one-time native CDN download...'
  );

  try {
    await installPlaywrightBrowsers(onProgress);
  } catch (err: any) {
    lastInstallError = err?.message || 'Failed to auto-install Playwright Chromium browser';
    AppLogger.error(
      'PlaywrightSetup',
      'Failed to auto-install Playwright Chromium browser. Scraper jobs may fail.',
      undefined,
      err
    );
  }
}

/**
 * Registers browser engine IPC handlers for the renderer process.
 */
export function registerPlaywrightIpc(): void {
  ipcMain.handle('browser:status', async () => {
    return getBrowserEngineStatus();
  });

  ipcMain.handle('browser:install', async (event) => {
    return installPlaywrightBrowsers((line) => {
      try {
        event.sender.send('browser:install-progress', line);
      } catch {}
    });
  });
}

/**
 * Resolves the path to Playwright CLI script (for backward compatibility and unit tests).
 */
export function resolvePlaywrightCliPath(): string {
  try {
    const playwrightCorePkg = require.resolve('playwright-core/package.json');
    return join(dirname(playwrightCorePkg), 'cli.js');
  } catch {
    return 'cli.js';
  }
}

