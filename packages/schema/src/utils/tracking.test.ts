/**
 * LeadForge OS — Tracking Utilities Unit Test Suite
 */

import { describe, it, expect } from 'vitest';
import {
  generateTrackingToken,
  injectOpenTrackingPixel,
  rewriteLinksForClickTracking,
  sanitizeHtmlForPreview,
  validateTrackingBaseUrl
} from './tracking.js';

describe('Email Tracking Utilities', () => {
  describe('Token Generation', () => {
    it('generates unique 32-character hex tokens', () => {
      const t1 = generateTrackingToken();
      const t2 = generateTrackingToken();
      expect(typeof t1).toBe('string');
      expect(t1.length).toBe(32);
      expect(/^[0-9a-f]{32}$/.test(t1)).toBe(true);
      expect(t1).not.toBe(t2);
    });
  });

  describe('Open Tracking Pixel Injection', () => {
    it('injects pixel before closing body tag', () => {
      const htmlWithBody = '<html><body><p>Hello World</p></body></html>';
      const injected = injectOpenTrackingPixel(htmlWithBody, 'https://track.leadforge.com', 'tok-123');
      expect(injected).toContain('src="https://track.leadforge.com/t/open/tok-123"');
      expect(injected).toContain('width="1" height="1"');
      expect(injected).toContain('</body>');
    });

    it('handles trailing slash in trackingBaseUrl and fragments without body tag', () => {
      const htmlWithoutBody = '<div><p>Direct Snippet</p></div>';
      const injected = injectOpenTrackingPixel(htmlWithoutBody, 'https://track.leadforge.com/', 'tok-456');
      expect(injected).toContain('src="https://track.leadforge.com/t/open/tok-456"');
      expect(injected.endsWith('/>')).toBe(true);
    });
  });

  describe('Click Tracking Link Rewriting', () => {
    it('rewrites external links while strictly excluding non-http and protected links', () => {
      const originalHtml = `
        <div>
          <p>Please review:</p>
          <a href="https://acme.com/pricing">See Pricing</a>
          <a href="https://acme.com/docs" target="_blank">Documentation</a>
          <a href="mailto:support@acme.com">Contact Support</a>
          <a href="tel:+18005551234">Call Us</a>
          <a href="#section-2">Jump Down</a>
          <a href="https://acme.com/unsubscribe" class="leadforge-unsubscribe">Unsubscribe</a>
          <a href="https://acme.com/privacy" data-no-track="true">Privacy Policy</a>
        </div>
      `;

      let counter = 0;
      const mockTokenGen = () => `mock-token-${++counter}`;
      const result = rewriteLinksForClickTracking(originalHtml, 'https://track.leadforge.com', mockTokenGen);

      expect(result.tokens.length).toBe(2);
      expect(result.tokens[0]?.targetUrl).toBe('https://acme.com/pricing');
      expect(result.tokens[1]?.targetUrl).toBe('https://acme.com/docs');

      expect(result.rewrittenHtml).toContain('href="https://track.leadforge.com/t/click/mock-token-1"');
      expect(result.rewrittenHtml).toContain('href="https://track.leadforge.com/t/click/mock-token-2"');

      // Verify exclusions
      expect(result.rewrittenHtml).toContain('href="mailto:support@acme.com"');
      expect(result.rewrittenHtml).toContain('href="tel:+18005551234"');
      expect(result.rewrittenHtml).toContain('href="#section-2"');
      expect(result.rewrittenHtml).toContain('href="https://acme.com/unsubscribe"');
      expect(result.rewrittenHtml).toContain('href="https://acme.com/privacy"');
    });
  });

  describe('HTML Preview Sanitization (Phase 5E Security)', () => {
    it('strips scripts, iframes, objects, embeds, and event handlers while preserving benign markup', () => {
      const maliciousHtml = `
        <div>
          <h1>Clean Header</h1>
          <script>alert('pwned');</script>
          <iframe src="http://evil.com"></iframe>
          <img src="https://safe.com/pic.png" onload="alert('xss')" />
          <a href="javascript:alert('click-xss')">Click Me</a>
          <object data="evil.swf"></object>
          <embed src="evil.swf" />
        </div>
      `;

      const safe = sanitizeHtmlForPreview(maliciousHtml);
      expect(safe).not.toContain('<script');
      expect(safe).not.toContain('<iframe');
      expect(safe).not.toContain('<object');
      expect(safe).not.toContain('<embed');
      expect(safe).not.toContain('onload=');
      expect(safe).not.toContain('javascript:');
      expect(safe).toContain('<h1>Clean Header</h1>');
      expect(safe).toContain('src="https://safe.com/pic.png"');
    });

    it('strips open tracking pixels to prevent false open events inside desktop preview', () => {
      const htmlWithTracking = `
        <p>Hello John,</p>
        <p>Here is your email content.</p>
        <img src="https://leadforge.app/api/v1/tracking/open/token_abc_123" width="1" height="1" style="display:none" alt="" />
        <img src="https://track.leadforge.com/t/open/token_def_456" width="1" height="1" style="display:none" alt="" />
      `;

      const sanitized = sanitizeHtmlForPreview(htmlWithTracking);
      expect(sanitized).not.toContain('/tracking/open/');
      expect(sanitized).not.toContain('/t/open/');
      expect(sanitized).toContain('<p>Hello John,</p>');
    });

    it('prevents double-wrapping links already rewritten for tracking', () => {
      const alreadyTrackedHtml = '<a href="https://track.leadforge.com/t/click/already-tracked-tok">Click</a>';
      const result = rewriteLinksForClickTracking(alreadyTrackedHtml, 'https://track.leadforge.com');
      expect(result.tokens.length).toBe(0);
      expect(result.rewrittenHtml).toBe(alreadyTrackedHtml);
    });

    it('blocks remote images when privacy protection option is enabled', () => {
      const htmlWithImages = `
        <p>Look at this logo:</p>
        <img src="https://cdn.example.com/logo.png" alt="Logo" />
      `;

      const blocked = sanitizeHtmlForPreview(htmlWithImages, { blockRemoteImages: true });
      expect(blocked).toContain('data-src="https://cdn.example.com/logo.png"');
      expect(blocked).toContain('src="data:image/svg+xml;utf8');

      const allowed = sanitizeHtmlForPreview(htmlWithImages, { blockRemoteImages: false });
      expect(allowed).toContain('src="https://cdn.example.com/logo.png"');
    });

    it('enforces target="_blank" and rel="noopener noreferrer" on links', () => {
      const htmlWithLinks = `
        <a href="https://example.com/pricing">Pricing Page</a>
        <a href="https://example.com/demo" target="_self">Demo</a>
      `;

      const sanitized = sanitizeHtmlForPreview(htmlWithLinks);
      expect(sanitized).toContain('target="_blank"');
      expect(sanitized).toContain('rel="noopener noreferrer"');
    });
  });

  describe('validateTrackingBaseUrl Runtime Safety', () => {
    it('accepts valid absolute HTTPS URLs with public hostnames', () => {
      const res1 = validateTrackingBaseUrl('https://api.leadforge.kapiljangid.pro');
      expect(res1.isValid).toBe(true);
      expect(res1.normalizedUrl).toBe('https://api.leadforge.kapiljangid.pro');

      const res2 = validateTrackingBaseUrl('https://track.leadforge.com/');
      expect(res2.isValid).toBe(true);
      expect(res2.normalizedUrl).toBe('https://track.leadforge.com');

      const res3 = validateTrackingBaseUrl('https://api.leadforge.ai/custom/path/');
      expect(res3.isValid).toBe(true);
      expect(res3.normalizedUrl).toBe('https://api.leadforge.ai/custom/path');
    });

    it('rejects unencrypted HTTP protocol', () => {
      const res = validateTrackingBaseUrl('http://api.leadforge.com');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Only secure HTTPS tracking URLs are permitted');
    });

    it('rejects localhost, loopback, and zero addresses', () => {
      const forbidden = [
        'http://localhost:3000',
        'https://localhost:3000',
        'http://localhost',
        'https://localhost',
        'http://127.0.0.1:3000',
        'https://127.0.0.1:3000',
        'http://127.0.0.1',
        'https://127.0.0.1',
        'http://0.0.0.0:3000',
        'https://0.0.0.0:3000',
        'http://0.0.0.0',
        'https://0.0.0.0',
        'https://app.localhost',
        'https://node.local',
        'https://server.internal'
      ];
      for (const url of forbidden) {
        const res = validateTrackingBaseUrl(url);
        expect(res.isValid).toBe(false);
      }
    });

    it('rejects private IPv4 address subnets (RFC 1918)', () => {
      const privateIps = [
        'https://10.0.0.1/track',
        'https://10.254.1.2',
        'https://192.168.1.1/t',
        'https://172.16.0.1',
        'https://172.25.10.1',
        'https://172.31.255.255',
        'https://169.254.169.254'
      ];
      for (const url of privateIps) {
        const res = validateTrackingBaseUrl(url);
        expect(res.isValid).toBe(false);
        expect(res.error).toContain('Disallowed');
      }
    });

    it('rejects relative paths, file:, and malformed non-URLs', () => {
      const invalid = [
        '',
        '   ',
        null,
        undefined,
        'localhost',
        '127.0.0.1',
        'file:///path/to/script',
        '/relative/tracking/path',
        'not a url at all'
      ];
      for (const val of invalid) {
        const res = validateTrackingBaseUrl(val);
        expect(res.isValid).toBe(false);
      }
    });
  });
});
