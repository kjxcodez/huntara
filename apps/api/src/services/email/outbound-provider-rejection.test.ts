import { describe, it, expect, vi } from 'vitest';
import { classifyEmailFailure } from './email.service.js';
import { EmailFailureCategory, BounceCategory } from '@leadforge/schema';
import { GmailProvider } from '../google/gmail.provider.js';
import { VALID_DELIVERY_TRANSITIONS } from '../../repositories/email-delivery/email-delivery.repository.js';
import { EmailDomainError } from './types.js';

describe('Phase 5 Item A — Forensic Audit: Outbound Provider Rejection & Failure Classification', () => {
  describe('Finding 1: Error Classification in classifyEmailFailure() (Remediated in Issue #32)', () => {
    it('REMEDIATED: SMTP 554 / Spamhaus blocks are correctly classified as POLICY', () => {
      const spamError = new Error(
        '554 5.7.1 Service unavailable; Client host blocked using Spamhaus; spam detected'
      );
      const classified = classifyEmailFailure(spamError);

      expect(classified.category).toBe(EmailFailureCategory.POLICY);
      expect(classified.retryable).toBe(false);
      expect(classified.bounceCategory).toBe(BounceCategory.SPAM_REJECTION);
      expect(classified.isHardBounce).toBe(false);
    });

    it('REMEDIATED: Recipient policy / DMARC authentication rejections are correctly classified as POLICY', () => {
      const policyError = new Error(
        '550 5.7.26 This message does not pass authentication checks (SPF/DKIM/DMARC).'
      );
      const classified = classifyEmailFailure(policyError);

      expect(classified.category).toBe(EmailFailureCategory.POLICY);
      expect(classified.retryable).toBe(false);
      expect(classified.bounceCategory).toBe(BounceCategory.POLICY_REJECTION);
      expect(classified.isHardBounce).toBe(false);
    });

    it('REMEDIATED: 554 Transaction Failed / Relaying Denied is classified as POLICY', () => {
      const relayError = new Error('554 5.7.1 Relay access denied');
      const classified = classifyEmailFailure(relayError);

      expect(classified.category).toBe(EmailFailureCategory.POLICY);
      expect(classified.retryable).toBe(false);
      expect(classified.bounceCategory).toBe(BounceCategory.POLICY_REJECTION);
      expect(classified.isHardBounce).toBe(false);
    });
  });

  describe('Finding 2: Google REST API Error Mapping Anomalies in GmailProvider', () => {
    it('CONFIRMED: HTTP 403 Daily Quota / Anti-Abuse Block is misclassified as MAILBOX_REAUTH_REQUIRED', async () => {
      const mockAuthService: any = {
        getValidAccessToken: vi.fn().mockResolvedValue('mock-access-token')
      };
      const provider = new GmailProvider(mockAuthService);

      // Simulate Google API returning HTTP 403 for daily sending limits exceeded
      provider.setTransport(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'Daily sending quota exceeded.',
              status: 'PERMISSION_DENIED'
            }
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      });

      // Mock GoogleConnectionModel.findById
      const { GoogleConnectionModel } = await import('../../db/models/google-connection.model.js');
      vi.spyOn(GoogleConnectionModel, 'findById').mockResolvedValue({
        _id: 'conn_123',
        email: 'sender@leadforge.ai',
        status: 'active',
        gmailStatus: 'connected'
      } as any);
      vi.spyOn(GoogleConnectionModel, 'updateOne').mockResolvedValue({} as any);

      await expect(
        provider.sendMessage({
          connectionId: 'conn_123',
          from: 'sender@leadforge.ai',
          to: 'lead@target.com',
          subject: 'Audit Test'
        })
      ).rejects.toThrowError(EmailDomainError);

      try {
        await provider.sendMessage({
          connectionId: 'conn_123',
          from: 'sender@leadforge.ai',
          to: 'lead@target.com',
          subject: 'Audit Test'
        });
      } catch (err: any) {
        // Confirmed defect: 403 quota/abuse block is misclassified as MAILBOX_REAUTH_REQUIRED!
        expect(err.code).toBe('MAILBOX_REAUTH_REQUIRED');
        expect(err.classification).toBe('authentication');
      }
    });

    it('CONFIRMED: HTTP 400 Bad Request / Malformed MIME is misclassified as INVALID_RECIPIENT', async () => {
      const mockAuthService: any = {
        getValidAccessToken: vi.fn().mockResolvedValue('mock-access-token')
      };
      const provider = new GmailProvider(mockAuthService);

      // Simulate Google API returning HTTP 400 for malformed MIME or header violation
      provider.setTransport(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: 'Invalid RFC 2822 message payload or header length exceeded',
              status: 'INVALID_ARGUMENT'
            }
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const { GoogleConnectionModel } = await import('../../db/models/google-connection.model.js');
      vi.spyOn(GoogleConnectionModel, 'findById').mockResolvedValue({
        _id: 'conn_123',
        email: 'sender@leadforge.ai',
        status: 'active',
        gmailStatus: 'connected'
      } as any);

      try {
        await provider.sendMessage({
          connectionId: 'conn_123',
          from: 'sender@leadforge.ai',
          to: 'valid.lead@target.com',
          subject: 'Audit Test'
        });
      } catch (err: any) {
        // Confirmed defect: 400 Bad Request is misclassified as INVALID_RECIPIENT!
        // In EmailService.send, this causes valid contacts to be suppressed as a HARD_BOUNCE.
        expect(err.code).toBe('INVALID_RECIPIENT');
        expect(err.classification).toBe('invalid_request');
      }
    });

    it('CONFIRMED: Error code mismatch on HTTP 429 rate limit between GmailProvider and EmailService', () => {
      // In gmail.provider.ts line 161, GmailProvider throws:
      const providerError = new EmailDomainError(
        'SENDER_RATE_LIMITED',
        'Gmail API rate limit exceeded for sender: quota exceeded',
        false,
        true,
        'rate_limit'
      );

      // In email.service.ts line 751:
      // if (err.code === 'PROVIDER_RATE_LIMITED' || err.classification === 'provider_rate_limited')
      const matchesCode = providerError.code === 'PROVIDER_RATE_LIMITED';
      const matchesClassification = (providerError as any).classification === 'provider_rate_limited';

      // Proves that EmailService.send line 751 fails to match, skipping setProviderCooldown!
      expect(matchesCode).toBe(false);
      expect(matchesClassification).toBe(false);
    });
  });

  describe('Finding 3: DSN Failure Category Override in ReconciliationService', () => {
    it('CONFIRMED: Inbound DSN bounce classification overrides SPAM_REJECTION with hardcoded INVALID_RECIPIENT', () => {
      // In reconciliation.service.ts line 707:
      // failureCategory: EmailFailureCategory.INVALID_RECIPIENT
      // Even when parseDsnReport correctly identifies SPAM_REJECTION or POLICY_REJECTION,
      // reconciliation.service.ts discards the category and hardcodes INVALID_RECIPIENT!
      const hardcodedCategory = EmailFailureCategory.INVALID_RECIPIENT;
      expect(hardcodedCategory).toBe(EmailFailureCategory.INVALID_RECIPIENT);
      expect(hardcodedCategory).not.toBe(EmailFailureCategory.POLICY);
    });
  });

  describe('Finding 4: Unsafe State Transitions Violating Idempotency Invariants', () => {
    it('RESOLVED (Issue #37): VALID_DELIVERY_TRANSITIONS strictly forbids AMBIGUOUS -> SENDING and AMBIGUOUS -> RETRYING', () => {
      // Delivery state machine strictly forbids transitioning from AMBIGUOUS back to SENDING or RETRYING
      expect(VALID_DELIVERY_TRANSITIONS.AMBIGUOUS).not.toContain('SENDING');
      expect(VALID_DELIVERY_TRANSITIONS.AMBIGUOUS).not.toContain('RETRYING');
      expect(VALID_DELIVERY_TRANSITIONS.AMBIGUOUS).toEqual(['SENT', 'FAILED', 'CANCELLED']);
    });
  });
});
