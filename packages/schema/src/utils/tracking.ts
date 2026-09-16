/**
 * LeadForge OS — Email Tracking, Link Rewriting & Preview Security Utilities
 *
 * Provides:
 * 1. Opaque tracking token generation (cryptographically secure, zero PII)
 * 2. 1x1 transparent open tracking pixel injection
 * 3. Safe outbound link rewriting for click tracking with strict exclusions
 * 4. Lightweight HTML sanitization for safe desktop preview
 */

import crypto from 'crypto';

/**
 * Generates an opaque, non-guessable tracking token (32 hex characters / 128 bits entropy).
 * Contains no PII, user IDs, or database identifiers.
 */
export function generateTrackingToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Injects a 1x1 transparent open-tracking pixel into an outbound HTML message.
 * Places the pixel right before </body> if present, or appends to the HTML.
 */
export function injectOpenTrackingPixel(
  html: string,
  trackingBaseUrl: string,
  openToken: string
): string {
  if (!html || !openToken) return html;

  if (html.includes('/t/open/') || html.includes('/tracking/open/')) {
    return html;
  }

  const normalizedBase = trackingBaseUrl.replace(/\/+$/, '');
  const pixelUrl = `${normalizedBase}/t/open/${openToken}`;
  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;border:0;" />`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixelTag}</body>`);
  }
  return `${html}\n${pixelTag}`;
}

export interface ClickTrackingRewriteResult {
  rewrittenHtml: string;
  tokens: Array<{ token: string; targetUrl: string }>;
}

/**
 * Rewrites outbound HTML links for click tracking.
 * Strictly excludes:
 * - mailto: URIs
 * - tel: URIs
 * - Fragment/anchor links (#...)
 * - Explicit no-track tags (data-no-track="true" or class="leadforge-no-track")
 * - Unsubscribe placeholders or links containing unsubscribe
 */
export function rewriteLinksForClickTracking(
  html: string,
  trackingBaseUrl: string,
  customTokenGenerator?: () => string
): ClickTrackingRewriteResult {
  if (!html) {
    return { rewrittenHtml: html, tokens: [] };
  }

  const normalizedBase = trackingBaseUrl.replace(/\/+$/, '');
  const tokens: Array<{ token: string; targetUrl: string }> = [];
  const tokenGen = customTokenGenerator || generateTrackingToken;

  // Regex matching <a ... href="..." ...>
  const linkRegex = /<a\b([^>]*?)href=(["'])(.*?)\2([^>]*?)>/gi;

  const rewrittenHtml = html.replace(linkRegex, (fullMatch, beforeHref, quote, rawHref, afterHref) => {
    const trimmedHref = rawHref.trim();

    // 1. Exclusion: mailto: or tel:
    if (/^(mailto:|tel:)/i.test(trimmedHref)) {
      return fullMatch;
    }

    // 2. Exclusion: fragment-only anchor links
    if (trimmedHref.startsWith('#') || trimmedHref === '') {
      return fullMatch;
    }

    // 3. Exclusion: non-http(s) schemes (e.g. javascript:, data:, file:)
    if (!/^https?:\/\//i.test(trimmedHref)) {
      return fullMatch;
    }

    // 4. Exclusion: data-no-track or unsubscribe links
    const combinedAttrs = `${beforeHref} ${afterHref}`.toLowerCase();
    if (
      combinedAttrs.includes('data-no-track') ||
      combinedAttrs.includes('leadforge-no-track') ||
      combinedAttrs.includes('leadforge-unsubscribe') ||
      trimmedHref.includes('unsubscribe')
    ) {
      return fullMatch;
    }

    // 4b. Exclusion: already a LeadForge tracking link (prevent double-wrapping on retry)
    if (trimmedHref.includes('/t/click/') || trimmedHref.includes('/tracking/click/')) {
      return fullMatch;
    }

    // 5. Generate opaque token and construct tracking URL
    const token = tokenGen();
    tokens.push({ token, targetUrl: trimmedHref });
    const trackingUrl = `${normalizedBase}/t/click/${token}`;

    return `<a${beforeHref}href=${quote}${trackingUrl}${quote}${afterHref}>`;
  });

  return { rewrittenHtml, tokens };
}

export interface SanitizePreviewOptions {
  /** When true (default), strips tracking pixels matching /t/open/ or /tracking/open/ */
  stripTrackingPixels?: boolean;
  /** When true, rewrites remote image src to data-src and placeholder to protect privacy */
  blockRemoteImages?: boolean;
  /** When true (default), ensures links open in new tab and neutralizes script links */
  neutralizeLinks?: boolean;
}

/**
 * Sanitizes stored email HTML for secure desktop rendering in an isolated preview container.
 * Strips script tags, objects, embeds, iframes, inline on* event handlers, and open tracking pixels.
 */
export function sanitizeHtmlForPreview(
  rawHtml: string,
  options: SanitizePreviewOptions = {}
): string {
  if (!rawHtml) return '';

  const {
    stripTrackingPixels = true,
    blockRemoteImages = false,
    neutralizeLinks = true
  } = options;

  let sanitized = rawHtml;

  // 1. Strip <script>...</script>
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // 2. Strip <object>, <embed>, <applet>
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^>]*>/gi, '');
  sanitized = sanitized.replace(/<applet\b[^<]*(?:(?!<\/applet>)<[^<]*)*<\/applet>/gi, '');

  // 3. Strip <iframe>
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

  // 4. Strip inline on* event handlers (e.g. onload, onerror, onclick)
  sanitized = sanitized.replace(/\s+on[a-z]+\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '');

  // 5. Neutralize javascript: and vbscript: URIs
  sanitized = sanitized.replace(/href\s*=\s*(["'])\s*(javascript|vbscript):/gi, 'href=$1#blocked-');
  sanitized = sanitized.replace(/src\s*=\s*(["'])\s*(javascript|vbscript):/gi, 'src=$1#blocked-');

  // 6. Strip LeadForge open tracking pixels to prevent false open events inside preview
  if (stripTrackingPixels) {
    sanitized = sanitized.replace(/<img\b[^>]*\/(?:t|tracking)\/open\/[^>]*>/gi, '');
  }

  // 7. Neutralize remote images if privacy protection is enabled
  if (blockRemoteImages) {
    sanitized = sanitized.replace(
      /<img\b([^>]*)src=(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi,
      '<img$1data-src=$2$3$2 src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'><rect width=\'100%\' height=\'100%\' fill=\'%23333\'/></svg>"$4>'
    );
  }

  // 8. Ensure links have target="_blank" and rel="noopener noreferrer" for safe interception
  if (neutralizeLinks) {
    sanitized = sanitized.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
      let updated = attrs;
      if (!/target\s*=/i.test(updated)) {
        updated += ' target="_blank"';
      } else {
        updated = updated.replace(/target\s*=\s*["'][^"']*["']/i, 'target="_blank"');
      }
      if (!/rel\s*=/i.test(updated)) {
        updated += ' rel="noopener noreferrer"';
      }
      return `<a${updated}>`;
    });
  }

  return sanitized;
}

export interface TrackingBaseUrlValidationResult {
  isValid: boolean;
  error?: string;
  normalizedUrl?: string;
}

/**
 * Validates tracking base URL at runtime.
 * Guarantees that:
 * 1. Must be a valid absolute URL with HTTPS protocol.
 * 2. Rejects insecure HTTP, file:, relative paths, and non-URL formats.
 * 3. Rejects localhost, loopback, zero IPs, and local domain suffixes.
 * 4. Rejects private IPv4 subnets (RFC 1918).
 * 5. Returns normalized URL without trailing slash.
 */
export function validateTrackingBaseUrl(url: unknown): TrackingBaseUrlValidationResult {
  if (typeof url !== 'string' || !url.trim()) {
    return {
      isValid: false,
      error: 'Tracking base URL is required when email tracking is enabled.'
    };
  }

  const trimmed = url.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      error: `Invalid tracking base URL format: "${trimmed}". Must be a valid absolute HTTPS URL.`
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Disallowed tracking URL protocol "${parsed.protocol}". Only secure HTTPS tracking URLs are permitted.`
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject localhost, loopback, zero IP, and internal names
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return {
      isValid: false,
      error: `Disallowed local/loopback tracking hostname "${hostname}". Must use a public HTTPS domain.`
    };
  }

  // Reject private and reserved IPv4 address ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match && ipv4Match[1] && ipv4Match[2]) {
    const octet1 = parseInt(ipv4Match[1], 10);
    const octet2 = parseInt(ipv4Match[2], 10);

    if (
      octet1 === 0 ||
      octet1 === 10 ||
      octet1 === 127 ||
      (octet1 === 169 && octet2 === 254) ||
      (octet1 === 172 && octet2 >= 16 && octet2 <= 31) ||
      (octet1 === 192 && octet2 === 168)
    ) {
      return {
        isValid: false,
        error: `Disallowed private/internal IP address in tracking URL: "${hostname}".`
      };
    }
  }

  const normalizedUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')}`;
  return {
    isValid: true,
    normalizedUrl
  };
}

