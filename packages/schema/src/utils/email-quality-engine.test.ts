import { describe, it, expect } from 'vitest';
import {
  evaluateEmailQuality,
  compareSuppressionPrecedence,
  getSuppressionWeight,
  isEvidenceFresh
} from './email-quality-engine.js';
import { EmailQualityStatus, SuppressionReason } from '../enums/index.js';
import type { EmailQualityEvidence } from '../entities/email-quality.js';

describe('Phase 10: Email Quality Decision Engine', () => {
  it('rejects malformed syntax addresses', () => {
    const res = evaluateEmailQuality({ email: 'bad..syntax@nowhere' });
    expect(res.sendable).toBe(false);
    expect(res.status).toBe(EmailQualityStatus.INVALID);
    expect(res.riskLevel).toBe('prohibited');
    expect(res.recommendedAction).toBe('do_not_send');
  });

  it('rejects disposable and temporary burner domains', () => {
    const res = evaluateEmailQuality({ email: 'john.doe@mailinator.com' });
    expect(res.sendable).toBe(false);
    expect(res.status).toBe(EmailQualityStatus.DISPOSABLE);
    expect(res.riskLevel).toBe('high');
    expect(res.recommendedAction).toBe('do_not_send');
  });

  it('classifies role accounts as sendable but moderate risk', () => {
    const res = evaluateEmailQuality({ email: 'support@acme-corp.com' });
    expect(res.sendable).toBe(true);
    expect(res.status).toBe(EmailQualityStatus.ROLE_ACCOUNT);
    expect(res.riskLevel).toBe('moderate');
    expect(res.recommendedAction).toBe('caution');
  });

  it('never claims verified merely because MX records exist', () => {
    const mxEvidence: EmailQualityEvidence = {
      id: 'ev-mx-1',
      source: 'mx',
      observedAt: new Date().toISOString(),
      result: 'pass',
      confidence: 0.9,
      details: { primaryMx: 'mail.acme-corp.com' }
    };

    const res = evaluateEmailQuality({
      email: 'alex@acme-corp.com',
      evidence: [mxEvidence]
    });

    expect(res.sendable).toBe(true);
    // Invariant: MUST NOT be VERIFIED!
    expect(res.status).toBe(EmailQualityStatus.MX_VALID);
    expect(res.status).not.toBe(EmailQualityStatus.VERIFIED);
  });

  it('claims VERIFIED only when direct mailbox verification evidence is present and positive', () => {
    const verifEvidence: EmailQualityEvidence = {
      id: 'ev-verif-1',
      source: 'verification_provider',
      observedAt: new Date().toISOString(),
      result: 'pass',
      confidence: 0.99,
      details: { provider: 'test-provider' }
    };

    const res = evaluateEmailQuality({
      email: 'alex@acme-corp.com',
      evidence: [verifEvidence]
    });

    expect(res.sendable).toBe(true);
    expect(res.status).toBe(EmailQualityStatus.VERIFIED);
    expect(res.riskLevel).toBe('low');
    expect(res.recommendedAction).toBe('send');
  });

  it('rejects email if direct mailbox verification evidence is fail', () => {
    const verifEvidence: EmailQualityEvidence = {
      id: 'ev-verif-2',
      source: 'verification_provider',
      observedAt: new Date().toISOString(),
      result: 'fail',
      confidence: 0.99
    };

    const res = evaluateEmailQuality({
      email: 'nonexistent@acme-corp.com',
      evidence: [verifEvidence]
    });

    expect(res.sendable).toBe(false);
    expect(res.status).toBe(EmailQualityStatus.INVALID);
    expect(res.riskLevel).toBe('prohibited');
    expect(res.recommendedAction).toBe('do_not_send');
  });

  describe('Suppression Precedence', () => {
    it('enforces DO_NOT_CONTACT > COMPANY_DNC > DOMAIN_SUPPRESSION > UNSUBSCRIBED > HARD_BOUNCE > INVALID', () => {
      expect(
        compareSuppressionPrecedence(
          SuppressionReason.DO_NOT_CONTACT,
          SuppressionReason.COMPANY_DNC
        )
      ).toBeGreaterThan(0);

      expect(
        compareSuppressionPrecedence(
          SuppressionReason.COMPANY_DNC,
          SuppressionReason.DOMAIN_SUPPRESSION
        )
      ).toBeGreaterThan(0);

      expect(
        compareSuppressionPrecedence(
          SuppressionReason.DOMAIN_SUPPRESSION,
          SuppressionReason.UNSUBSCRIBED
        )
      ).toBeGreaterThan(0);

      expect(
        compareSuppressionPrecedence(
          SuppressionReason.UNSUBSCRIBED,
          SuppressionReason.HARD_BOUNCE
        )
      ).toBeGreaterThan(0);

      expect(
        compareSuppressionPrecedence(
          SuppressionReason.HARD_BOUNCE,
          SuppressionReason.INVALID_EMAIL
        )
      ).toBeGreaterThan(0);
    });

    it('suppression strictly overrides positive verification evidence', () => {
      const verifEvidence: EmailQualityEvidence = {
        id: 'ev-verif-1',
        source: 'verification_provider',
        observedAt: new Date().toISOString(),
        result: 'pass',
        confidence: 0.99
      };

      const res = evaluateEmailQuality({
        email: 'dnc-user@acme-corp.com',
        evidence: [verifEvidence],
        suppression: {
          reason: SuppressionReason.DO_NOT_CONTACT,
          suppressedAt: new Date().toISOString()
        }
      });

      expect(res.sendable).toBe(false);
      expect(res.status).toBe(EmailQualityStatus.SUPPRESSED);
      expect(res.riskLevel).toBe('prohibited');
      expect(res.recommendedAction).toBe('do_not_send');
      expect(res.reasons).toContain('Contact is suppressed: DO_NOT_CONTACT');
    });

    it('suppression strictly overrides prior historical reply', () => {
      const res = evaluateEmailQuality({
        email: 'unsub-user@acme-corp.com',
        historicalDeliveries: [{ status: 'SENT', hasReply: true }],
        suppression: {
          reason: SuppressionReason.UNSUBSCRIBED,
          suppressedAt: new Date().toISOString()
        }
      });

      expect(res.sendable).toBe(false);
      expect(res.status).toBe(EmailQualityStatus.SUPPRESSED);
    });
  });

  describe('Historical Delivery Evidence', () => {
    it('classifies address as invalid if historical delivery recorded a hard bounce', () => {
      const res = evaluateEmailQuality({
        email: 'bounced@acme-corp.com',
        historicalDeliveries: [
          { status: 'FAILED', failureCategory: 'INVALID_RECIPIENT' }
        ]
      });

      expect(res.sendable).toBe(false);
      expect(res.status).toBe(EmailQualityStatus.INVALID);
      expect(res.riskLevel).toBe('prohibited');
    });
  });

  describe('Evidence Freshness & TTL', () => {
    it('correctly detects fresh vs expired evidence', () => {
      const now = new Date('2026-09-04T12:00:00Z');
      const freshEv: EmailQualityEvidence = {
        id: 'e1',
        source: 'mx',
        observedAt: '2026-09-04T10:00:00Z',
        result: 'pass',
        confidence: 0.9,
        expiresAt: '2026-09-18T10:00:00Z'
      };
      const expiredEv: EmailQualityEvidence = {
        id: 'e2',
        source: 'mx',
        observedAt: '2026-08-01T10:00:00Z',
        result: 'pass',
        confidence: 0.9,
        expiresAt: '2026-08-15T10:00:00Z'
      };

      expect(isEvidenceFresh(freshEv, now)).toBe(true);
      expect(isEvidenceFresh(expiredEv, now)).toBe(false);
    });
  });
});
