import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyEmailFailure, EmailService } from './email.service.js';
import { EmailFailureCategory, BounceCategory, SuppressionReason, ContactStatus } from '@huntara/schema';
import { EmailDomainError } from './types.js';

describe('fix(email): unified provider failure classification with canonical bounce categories', () => {
  describe('classifyEmailFailure unit tests', () => {
    it('classifies SMTP 554 5.7.1 Spamhaus block as POLICY (not PROVIDER/NETWORK)', () => {
      const err = new Error('554 5.7.1 Service unavailable; Client host blocked using Spamhaus; spam detected');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.POLICY);
      expect(result.retryable).toBe(false);
      expect(result.ambiguous).toBe(false);
      expect(result.bounceCategory).toBe(BounceCategory.SPAM_REJECTION);
      expect(result.isHardBounce).toBe(false);
      expect(result.safeHumanMessage).toContain('spam filtering or IP reputation');
    });

    it('classifies SMTP 550 5.7.26 SPF/DKIM/DMARC rejection as POLICY (not INVALID_RECIPIENT)', () => {
      const err = new Error('550 5.7.26 This message does not pass authentication checks (SPF/DKIM/DMARC).');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.POLICY);
      expect(result.retryable).toBe(false);
      expect(result.ambiguous).toBe(false);
      expect(result.bounceCategory).toBe(BounceCategory.POLICY_REJECTION);
      expect(result.isHardBounce).toBe(false);
      expect(result.safeHumanMessage).toContain('security or authentication policy');
    });

    it('classifies SMTP 554 5.7.1 Relay access denied as POLICY', () => {
      const err = new Error('554 5.7.1 Relay access denied');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.POLICY);
      expect(result.retryable).toBe(false);
      expect(result.isHardBounce).toBe(false);
      expect(result.bounceCategory).toBe(BounceCategory.POLICY_REJECTION);
    });

    it('classifies SMTP 550 5.1.1 User Unknown as INVALID_RECIPIENT with isHardBounce: true', () => {
      const err = new Error('550 5.1.1 <nobody@example.com>: Recipient address rejected: User unknown in virtual mailbox table');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.INVALID_RECIPIENT);
      expect(result.retryable).toBe(false);
      expect(result.ambiguous).toBe(false);
      expect(result.bounceCategory).toBe(BounceCategory.MAILBOX_UNAVAILABLE);
      expect(result.isHardBounce).toBe(true);
      expect(result.safeHumanMessage).toContain('Recipient mailbox does not exist');
    });

    it('classifies SMTP 550 5.1.2 Host or domain not found as INVALID_RECIPIENT with isHardBounce: true', () => {
      const err = new Error('550 5.1.2 <test@bad-nonexistent-domain.com>: Host or domain name not found.');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.INVALID_RECIPIENT);
      expect(result.retryable).toBe(false);
      expect(result.bounceCategory).toBe(BounceCategory.DOMAIN_UNAVAILABLE);
      expect(result.isHardBounce).toBe(true);
      expect(result.safeHumanMessage).toContain('Destination domain does not exist');
    });

    it('classifies SMTP 421 4.7.0 Rate limit exceeded as RATE_LIMIT and retryable', () => {
      const err = new Error('421 4.7.0 Try again later, closing connection. (Rate limit exceeded)');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.RATE_LIMIT);
      expect(result.retryable).toBe(true);
      expect(result.isHardBounce).toBe(false);
      expect(result.bounceCategory).toBe(BounceCategory.RATE_LIMIT);
    });

    it('classifies SMTP 452 4.2.2 Mailbox full as PROVIDER soft bounce and retryable', () => {
      const err = new Error('452 4.2.2 Mailbox full, unable to accept message.');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.PROVIDER);
      expect(result.retryable).toBe(true);
      expect(result.isHardBounce).toBe(false);
      expect(result.bounceCategory).toBe(BounceCategory.SOFT_BOUNCE);
      expect(result.safeHumanMessage).toContain('Recipient mailbox is full');
    });

    it('classifies transient network errors (ECONNRESET, ETIMEDOUT) as NETWORK', () => {
      const err = new Error('read ECONNRESET');
      (err as any).code = 'ECONNRESET';
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.NETWORK);
      expect(result.retryable).toBe(true);
      expect(result.ambiguous).toBe(false);
    });

    it('classifies AMBIGUOUS_SEND_TIMEOUT as AMBIGUOUS and non-retryable', () => {
      const err = new Error('Network timeout during Google API transmission');
      (err as any).code = 'AMBIGUOUS_SEND_TIMEOUT';
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.AMBIGUOUS);
      expect(result.retryable).toBe(false);
      expect(result.ambiguous).toBe(true);
    });

    it('classifies OAuth token revocation as AUTH and non-retryable', () => {
      const err = new Error('invalid_grant: token has been expired or revoked');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.AUTH);
      expect(result.retryable).toBe(false);
      expect(result.ambiguous).toBe(false);
    });
  });

  describe('Mailbox Health & Suppression Governance Integration', () => {
    it('records POLICY failure against mailbox health and degrades/blocks without marking as NETWORK', async () => {
      const { EmailAccountRepository } = await import('../../repositories/email-account/email-account.repository.js');
      const repo = new EmailAccountRepository('ws_test');

      const mockAccount: any = {
        _id: 'acc_100',
        workspaceId: 'ws_test',
        health: {
          state: 'HEALTHY',
          consecutiveFailures: 0,
          operatorActionRequired: false
        }
      };

      vi.spyOn(repo, 'findOne').mockResolvedValue(mockAccount);
      const updateSpy = vi.spyOn(repo, 'atomicFindOneAndUpdate').mockResolvedValue({
        ...mockAccount,
        health: { state: 'DEGRADED' }
      });

      const outcome = await repo.recordSendFailure('acc_100', {
        category: 'POLICY',
        message: 'Spamhaus blocklist rejection'
      });

      expect(outcome.state).toBe('DEGRADED');
      expect(outcome.cooldownUntil).not.toBeNull();

      expect(updateSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({
            'health.state': 'DEGRADED',
            'health.lastFailureCategory': 'POLICY',
            'health.consecutiveFailures': 1
          })
        })
      );
    });

    it('escalates mailbox health to BLOCKED after 3 consecutive POLICY failures', async () => {
      const { EmailAccountRepository } = await import('../../repositories/email-account/email-account.repository.js');
      const repo = new EmailAccountRepository('ws_test');

      const mockAccount: any = {
        _id: 'acc_101',
        workspaceId: 'ws_test',
        health: {
          state: 'DEGRADED',
          consecutiveFailures: 2,
          operatorActionRequired: false
        }
      };

      vi.spyOn(repo, 'findOne').mockResolvedValue(mockAccount);
      vi.spyOn(repo, 'atomicFindOneAndUpdate').mockResolvedValue({
        ...mockAccount,
        health: { state: 'BLOCKED' }
      });

      const outcome = await repo.recordSendFailure('acc_101', {
        category: 'POLICY',
        message: 'Spamhaus blocklist rejection'
      });

      expect(outcome.state).toBe('BLOCKED');
      expect(outcome.operatorActionRequired).toBe(true);
    });
  });
});
