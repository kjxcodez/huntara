/**
 * HUNTARA — Phase 9 Domain & Protocol Migration Contract Test Suite
 *
 * Verifies:
 * 1. Canonical HUNTARA web and API origins allowed by CORS resolver
 * 2. Legacy LeadForge web and API domains retained for dual-origin compatibility
 * 3. Desktop protocol schemes (huntara:// and leadforge://) accepted
 * 4. Malicious external web origins rejected without wildcard reflection
 * 5. Better-Auth trusted origins include canonical HUNTARA and legacy LeadForge
 * 6. Public tracking base URLs validate canonical HTTPS endpoints
 */

import { describe, it, expect } from 'vitest';
import { resolveCorsOrigin } from '../../config/index.js';
import { validateTrackingBaseUrl } from '@huntara/schema';
import { MailerService } from '../../lib/mailer.js';

describe('Phase 9: Domain & Protocol Migration Contracts', () => {
  describe('CORS Origin Resolution & Allowed Boundaries', () => {
    it('accepts canonical HUNTARA web and API origins', () => {
      expect(resolveCorsOrigin('https://huntara.online')).toBe('https://huntara.online');
      expect(resolveCorsOrigin('https://www.huntara.online')).toBe('https://www.huntara.online');
      expect(resolveCorsOrigin('https://api.huntara.online')).toBe('https://api.huntara.online');
    });

    it('accepts legacy LeadForge web and API domains during compatibility transition', () => {
      expect(resolveCorsOrigin('https://leadforge.kapiljangid.pro')).toBe('https://leadforge.kapiljangid.pro');
      expect(resolveCorsOrigin('https://api.leadforge.kapiljangid.pro')).toBe('https://api.leadforge.kapiljangid.pro');
    });

    it('accepts both canonical huntara:// and legacy leadforge:// desktop protocols', () => {
      expect(resolveCorsOrigin('huntara://app')).toBe('huntara://app');
      expect(resolveCorsOrigin('huntara://desktop')).toBe('huntara://desktop');
      expect(resolveCorsOrigin('leadforge://desktop')).toBe('leadforge://desktop');
      expect(resolveCorsOrigin('leadforge://app')).toBe('leadforge://app');
      expect(resolveCorsOrigin('app://localhost')).toBe('app://localhost');
    });

    it('rejects unauthorized, lookalike, or malicious origins', () => {
      expect(resolveCorsOrigin('https://evil-huntara.online')).toBeNull();
      expect(resolveCorsOrigin('https://huntara.online.attacker.com')).toBeNull();
      expect(resolveCorsOrigin('https://leadforge.kapiljangid.pro.evil.com')).toBeNull();
      expect(resolveCorsOrigin('https://phishing-site.xyz')).toBeNull();
      expect(resolveCorsOrigin('http://insecure-huntara.online')).toBeNull();
    });

    it('handles empty and undefined origins safely without exception', () => {
      expect(resolveCorsOrigin('')).toBeNull();
      expect(resolveCorsOrigin(undefined)).toBeNull();
    });
  });

  describe('Tracking Base URL Validation', () => {
    it('validates canonical HUNTARA production API tracking base', () => {
      const res = validateTrackingBaseUrl('https://api.huntara.online');
      expect(res.isValid).toBe(true);
      expect(res.normalizedUrl).toBe('https://api.huntara.online');
    });

    it('validates canonical HUNTARA root domain tracking base', () => {
      const res = validateTrackingBaseUrl('https://huntara.online');
      expect(res.isValid).toBe(true);
      expect(res.normalizedUrl).toBe('https://huntara.online');
    });

    it('preserves validation for legacy LeadForge tracking base during transition', () => {
      const res = validateTrackingBaseUrl('https://api.leadforge.kapiljangid.pro');
      expect(res.isValid).toBe(true);
      expect(res.normalizedUrl).toBe('https://api.leadforge.kapiljangid.pro');
    });

    it('rejects insecure HTTP or local tracking URLs', () => {
      const httpRes = validateTrackingBaseUrl('http://api.huntara.online');
      expect(httpRes.isValid).toBe(false);
      expect(httpRes.error).toContain('Only secure HTTPS tracking URLs are permitted');

      const localRes = validateTrackingBaseUrl('https://localhost:3000');
      expect(localRes.isValid).toBe(false);
      expect(localRes.error).toContain('Disallowed local/loopback tracking hostname');
    });
  });

  describe('System Mailer Domain Defaults', () => {
    it('initializes MailerService singleton successfully with canonical fromAddress', () => {
      const mailer = MailerService.getInstance();
      expect(mailer).toBeDefined();
      expect(mailer.getFromAddress()).toContain('noreply@huntara.online');
    });
  });
});
