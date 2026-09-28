/**
 * Chrome detection for Windows.
 *
 * Checks the Windows registry (primary) and well-known installation paths
 * (fallback). Returns an actionable diagnostic instead of a cryptic error when
 * Chrome is absent.
 *
 * Intentionally Windows-only — HUNTARA only ships on Windows for now.
 * No Electron import; this module runs safely in both the main process and
 * worker processes.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

export interface ChromeDetectionResult {
  found: boolean;
  path?: string;
  /** Human-readable error message suitable for display in the UI. */
  error?: string;
}

const WINDOWS_REGISTRY_KEYS = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'
];

const WINDOWS_FALLBACK_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)'] || ''}\\Google\\Chrome\\Application\\chrome.exe`
];

/**
 * Queries a Windows registry key for a string value and returns it, or null
 * if the key does not exist or the query fails.
 */
function queryRegistry(key: string): string | null {
  try {
    const output = execSync(`reg query "${key}" /ve`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    });
    // Output format: "    (Default)    REG_SZ    C:\Program Files\...\chrome.exe"
    const match = output.match(/REG_SZ\s+(.+\.exe)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch {
    // Key not found or access denied — continue to next key.
  }
  return null;
}

/**
 * Detects Google Chrome on the current Windows system.
 *
 * Resolution order:
 *   1. Windows registry (HKLM, then HKCU)
 *   2. Well-known filesystem paths
 *
 * Returns a structured result so callers can display an actionable error
 * rather than propagating raw exceptions.
 */
export function detectChrome(): ChromeDetectionResult {
  if (process.platform !== 'win32') {
    // Non-Windows: use shell.openExternal which will pick the default browser.
    // No explicit detection needed.
    return { found: true };
  }

  // 1. Registry lookup
  for (const key of WINDOWS_REGISTRY_KEYS) {
    const path = queryRegistry(key);
    if (path && existsSync(path)) {
      return { found: true, path };
    }
  }

  // 2. Filesystem fallback
  for (const candidate of WINDOWS_FALLBACK_PATHS) {
    if (candidate && existsSync(candidate)) {
      return { found: true, path: candidate };
    }
  }

  return {
    found: false,
    error:
      'Google Chrome was not found on this computer.\n\n' +
      'HUNTARA opens Google sign-in in your Chrome browser so you can use ' +
      'your existing Google account without re-entering credentials.\n\n' +
      'Please install Google Chrome from https://www.google.com/chrome and try again.'
  };
}

/**
 * Throws a descriptive Error if Chrome cannot be found.
 * Convenience wrapper for callers that already handle exceptions.
 */
export function requireChrome(): void {
  const result = detectChrome();
  if (!result.found) {
    const err = new Error(result.error);
    (err as any).code = 'CHROME_NOT_FOUND';
    throw err;
  }
}
