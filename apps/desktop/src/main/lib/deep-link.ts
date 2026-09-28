import { app } from 'electron';
import { AppLogger } from './logger.js';

/**
 * Supported desktop protocol schemes.
 * 'huntara:' is canonical; 'leadforge:' is retained for migration compatibility.
 */
export const SUPPORTED_SCHEMES = ['huntara:', 'leadforge:'] as const;
export type SupportedScheme = 'huntara' | 'leadforge';

export interface ParsedDeepLink {
  valid: boolean;
  scheme: SupportedScheme | 'unknown';
  action: string;
  path: string;
  params: Record<string, string>;
  error?: string;
  rawUrl?: string;
}

/**
 * Checks whether a protocol string is one of the supported desktop schemes.
 */
export function isValidProtocolScheme(scheme: string): boolean {
  if (!scheme || typeof scheme !== 'string') return false;
  const normalized = scheme.endsWith(':') ? scheme.toLowerCase() : `${scheme.toLowerCase()}:`;
  return (SUPPORTED_SCHEMES as readonly string[]).includes(normalized);
}

const ALLOWED_PARAM_PATTERNS: Record<string, { regex: RegExp; maxLength: number }> = {
  token: { regex: /^[a-zA-Z0-9_\-.]+$/, maxLength: 1024 },
  workspaceId: { regex: /^[a-zA-Z0-9_\-]+$/, maxLength: 128 },
  code: { regex: /^[a-zA-Z0-9_\-./]+$/, maxLength: 512 },
  state: { regex: /^[a-zA-Z0-9_\-.]+$/, maxLength: 256 },
  error: { regex: /^[a-zA-Z0-9_\-\s.]+$/, maxLength: 256 },
  error_description: { regex: /^[^<>{}\\]+$/, maxLength: 512 }
};

/**
 * Sanitizes a single query parameter from a deep-link URI against strict security boundaries.
 */
export function sanitizeDeepLinkParam(key: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Protect against prototype pollution
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    return null;
  }

  const rule = ALLOWED_PARAM_PATTERNS[key];
  if (rule) {
    if (trimmed.length > rule.maxLength) {
      return null;
    }
    if (!rule.regex.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  // Generic fallback for any other safe alphanumeric parameter
  if (trimmed.length > 256) return null;
  if (!/^[a-zA-Z0-9_\-.]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Parses and validates an incoming deep-link URI.
 * Rejects arbitrary protocols, traversal characters, and dangerous parameters.
 */
export function parseDeepLink(rawUrl: string): ParsedDeepLink {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      valid: false,
      scheme: 'unknown',
      action: '',
      path: '',
      params: {},
      error: 'Invalid or empty URL input'
    };
  }

  const trimmed = rawUrl.trim();
  // Validate raw input against directory traversal or escape characters
  if (trimmed.includes('..') || trimmed.includes('\\')) {
    return {
      valid: false,
      scheme: 'unknown',
      action: '',
      path: '',
      params: Object.create(null),
      error: 'Invalid action or path: traversal characters detected'
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      scheme: 'unknown',
      action: '',
      path: '',
      params: Object.create(null),
      error: 'Malformed URL format'
    };
  }

  if (!isValidProtocolScheme(parsed.protocol)) {
    return {
      valid: false,
      scheme: 'unknown',
      action: '',
      path: '',
      params: Object.create(null),
      error: `Unsupported scheme: "${parsed.protocol}". Expected huntara: or leadforge:.`
    };
  }

  const scheme: SupportedScheme = parsed.protocol.startsWith('leadforge') ? 'leadforge' : 'huntara';

  // Extract action (host) and path
  const action = (parsed.hostname || '').toLowerCase().trim();
  const pathname = (parsed.pathname || '').trim();

  // Extract and sanitize query parameters with null prototype dictionary to prevent pollution
  const params: Record<string, string> = Object.create(null);
  parsed.searchParams.forEach((val, key) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return;
    }
    const sanitized = sanitizeDeepLinkParam(key, val);
    if (sanitized !== null) {
      params[key] = sanitized;
    }
  });

  return {
    valid: true,
    scheme,
    action,
    path: pathname,
    params,
    rawUrl
  };
}

/**
 * Registers OS protocol handlers for Electron app.
 * Registers both canonical 'huntara' and legacy 'leadforge' for compatibility.
 */
export function registerProtocolHandlers(): void {
  try {
    // 1. Canonical protocol
    if (!app.isDefaultProtocolClient('huntara')) {
      app.setAsDefaultProtocolClient('huntara');
      AppLogger.info('app', 'Registered canonical desktop protocol: huntara://');
    }
    // 2. Legacy compatibility protocol
    if (!app.isDefaultProtocolClient('leadforge')) {
      app.setAsDefaultProtocolClient('leadforge');
      AppLogger.info('app', 'Registered legacy desktop protocol: leadforge://');
    }
  } catch (err) {
    AppLogger.warn('app', 'Could not register desktop protocol handlers', undefined, err as Error);
  }
}

/**
 * Sets up listeners for incoming deep-link events across platforms (macOS open-url and Windows/Linux second-instance).
 */
export function setupDeepLinkHandler(
  onDeepLink: (link: ParsedDeepLink) => void
): void {
  // macOS protocol invocation
  app.on('open-url', (event, url) => {
    event.preventDefault();
    AppLogger.info('app', `Received macOS open-url event: ${url}`);
    const parsed = parseDeepLink(url);
    if (parsed.valid) {
      onDeepLink(parsed);
    } else {
      AppLogger.warn('app', `Rejected invalid deep link: ${parsed.error}`);
    }
  });

  // Windows / Linux single instance lock and protocol pass-through
  const gotTheLock = app.requestSingleInstanceLock();
  if (gotTheLock) {
    app.on('second-instance', (_event, commandLine) => {
      // Look for a protocol URL in the second-instance command line arguments
      const rawUrl = commandLine.find((arg) =>
        SUPPORTED_SCHEMES.some((scheme) => arg.toLowerCase().startsWith(scheme))
      );
      if (rawUrl) {
        AppLogger.info('app', `Received Windows/Linux second-instance deep link: ${rawUrl}`);
        const parsed = parseDeepLink(rawUrl);
        if (parsed.valid) {
          onDeepLink(parsed);
        } else {
          AppLogger.warn('app', `Rejected invalid second-instance deep link: ${parsed.error}`);
        }
      }
    });
  }
}
