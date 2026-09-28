/**
 * HUNTARA — Phase 9 Desktop Protocol & Deep-Link Qualification Suite
 *
 * Verifies:
 * 1. Canonical huntara:// protocol parsing and route resolution
 * 2. Legacy leadforge:// protocol parsing for backward compatibility
 * 3. Sanitization of query parameters (tokens, codes, state, workspace IDs)
 * 4. Rejection of unsupported schemes, malicious payloads, and path traversals
 * 5. Rejection of prototype pollution and toxic keys
 */

import { describe, it, expect } from 'vitest';
import { parseDeepLink, isValidProtocolScheme, sanitizeDeepLinkParam } from './deep-link.js';

describe('Phase 9: Desktop Protocol & Deep-Link Qualification', () => {
  describe('Protocol Scheme Verification', () => {
    it('accepts canonical huntara: protocol scheme', () => {
      expect(isValidProtocolScheme('huntara:')).toBe(true);
      expect(isValidProtocolScheme('huntara')).toBe(true);
    });

    it('accepts legacy leadforge: protocol scheme for migration compatibility', () => {
      expect(isValidProtocolScheme('leadforge:')).toBe(true);
      expect(isValidProtocolScheme('leadforge')).toBe(true);
    });

    it('rejects external or dangerous protocol schemes', () => {
      expect(isValidProtocolScheme('http:')).toBe(false);
      expect(isValidProtocolScheme('https:')).toBe(false);
      expect(isValidProtocolScheme('javascript:')).toBe(false);
      expect(isValidProtocolScheme('file:')).toBe(false);
      expect(isValidProtocolScheme('data:')).toBe(false);
    });
  });

  describe('Deep-Link URI Parsing & Parameter Extraction', () => {
    it('parses canonical huntara://auth/callback with token and workspaceId', () => {
      const uri = 'huntara://auth/callback?token=canonical_tok_123&workspaceId=ws_canonical_99';
      const result = parseDeepLink(uri);

      expect(result.valid).toBe(true);
      expect(result.scheme).toBe('huntara');
      expect(result.action).toBe('auth');
      expect(result.path).toBe('/callback');
      expect(result.params.token).toBe('canonical_tok_123');
      expect(result.params.workspaceId).toBe('ws_canonical_99');
    });

    it('parses legacy leadforge://auth/callback seamlessly during transition', () => {
      const uri = 'leadforge://auth/callback?token=legacy_tok_456&workspaceId=ws_legacy_88';
      const result = parseDeepLink(uri);

      expect(result.valid).toBe(true);
      expect(result.scheme).toBe('leadforge');
      expect(result.action).toBe('auth');
      expect(result.path).toBe('/callback');
      expect(result.params.token).toBe('legacy_tok_456');
      expect(result.params.workspaceId).toBe('ws_legacy_88');
    });

    it('parses OAuth authorization code and state parameters safely', () => {
      const uri = 'huntara://auth/callback?code=oauth_code_789&state=oauth_state_xyz';
      const result = parseDeepLink(uri);

      expect(result.valid).toBe(true);
      expect(result.params.code).toBe('oauth_code_789');
      expect(result.params.state).toBe('oauth_state_xyz');
    });

    it('parses workspace invitation deep links', () => {
      const uri = 'huntara://invite/accept?token=invitation_tok_abc';
      const result = parseDeepLink(uri);

      expect(result.valid).toBe(true);
      expect(result.action).toBe('invite');
      expect(result.path).toBe('/accept');
      expect(result.params.token).toBe('invitation_tok_abc');
    });
  });

  describe('Deep-Link Security Boundary & Malicious Input Rejection', () => {
    it('rejects malformed, empty, or non-string inputs', () => {
      expect(parseDeepLink('').valid).toBe(false);
      expect(parseDeepLink('not_a_valid_url').valid).toBe(false);
      expect(parseDeepLink(null as any).valid).toBe(false);
    });

    it('rejects unauthorized protocols disguised as links', () => {
      expect(parseDeepLink('https://evil.com/auth/callback').valid).toBe(false);
      expect(parseDeepLink('javascript:alert(1)').valid).toBe(false);
      expect(parseDeepLink('file:///etc/passwd').valid).toBe(false);
    });

    it('rejects path traversal attempts in deep links', () => {
      const traversalUri = 'huntara://auth/../../sensitive/path?token=tok123';
      const result = parseDeepLink(traversalUri);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid action or path');
    });

    it('ignores prototype pollution keys in query parameters', () => {
      const pollutionUri = 'huntara://auth/callback?__proto__[polluted]=true&constructor[name]=evil&token=valid_tok';
      const result = parseDeepLink(pollutionUri);

      expect(result.valid).toBe(true);
      expect((result.params as any).polluted).toBeUndefined();
      expect(result.params.__proto__).toBeUndefined();
      expect(result.params.constructor).toBeUndefined();
      expect(result.params.token).toBe('valid_tok');
    });

    it('sanitizes parameters with excessive length or invalid characters', () => {
      expect(sanitizeDeepLinkParam('token', 'valid_tok-123.abc')).toBe('valid_tok-123.abc');
      expect(sanitizeDeepLinkParam('token', '<script>alert(1)</script>')).toBeNull();
      expect(sanitizeDeepLinkParam('workspaceId', 'ws_1; DROP TABLE users;--')).toBeNull();
      expect(sanitizeDeepLinkParam('token', 'a'.repeat(2000))).toBeNull(); // exceeds max length
    });
  });
});
