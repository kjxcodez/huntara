/**
 * Phase 9R — Runtime Hardening & Secret Redaction Unit Test Suite
 */

import { describe, it, expect } from 'vitest';
import { sanitizeUrl } from '../../middleware/logger.js';
import { EmailDomainError } from './types.js';

describe('API Security & Runtime Hardening Suite', () => {
  it('redacts sensitive OAuth authorization codes and state params from URLs', () => {
    const sensitiveUrl = 'http://localhost:3000/api/v1/email/accounts/gmail/oauth/callback?code=4/0AX4XfW12345SECRET&state=abc123state&scope=gmail';
    const sanitized = sanitizeUrl(sensitiveUrl);

    expect(sanitized).not.toContain('4/0AX4XfW12345SECRET');
    expect(sanitized).not.toContain('abc123state');
    expect(sanitized.includes('code=%5BREDACTED%5D') || sanitized.includes('code=[REDACTED]')).toBe(true);
    expect(sanitized.includes('state=%5BREDACTED%5D') || sanitized.includes('state=[REDACTED]')).toBe(true);
  });

  it('redacts token query parameters from log URLs', () => {
    const tokenUrl = 'http://localhost:3000/api/v1/email/send?token=xyz987&access_token=secret_at&refresh_token=secret_rt';
    const sanitizedTokens = sanitizeUrl(tokenUrl);

    expect(sanitizedTokens).not.toContain('xyz987');
    expect(sanitizedTokens).not.toContain('secret_at');
    expect(sanitizedTokens).not.toContain('secret_rt');
  });

  it('preserves domain error codes and informative context', () => {
    const err = new EmailDomainError(
      'ATTACHMENT_UNREADABLE',
      'Unable to read attachment "proposal.pdf". Please remove and attach the file again.'
    );
    expect(err.code).toBe('ATTACHMENT_UNREADABLE');
    expect(err.message).toContain('proposal.pdf');
  });
});
