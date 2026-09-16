import { describe, it, expect } from 'vitest';
import { classifyBounce, parseDsnReport, mapBounceCategoryToFailureCategory } from './bounce-classifier.js';
import { BounceCategory, EmailFailureCategory } from '../enums/index.js';

describe('Phase 10: Bounce & Rejection Classifier', () => {
  it('classifies 550 User Unknown as permanent MAILBOX_UNAVAILABLE', () => {
    const result = classifyBounce({
      code: 550,
      message: '550 5.1.1 <nobody@example.com>: Recipient address rejected: User unknown in virtual mailbox table'
    });

    expect(result.category).toBe(BounceCategory.MAILBOX_UNAVAILABLE);
    expect(result.isPermanent).toBe(true);
    expect(result.isHardBounce).toBe(true);
    expect(result.statusCode).toBe(550);
    expect(result.enhancedStatusCode).toBe('5.1.1');
  });

  it('classifies INVALID_RECIPIENT error string as permanent MAILBOX_UNAVAILABLE', () => {
    const result = classifyBounce({
      code: 'INVALID_RECIPIENT',
      message: 'Invalid recipient email address: user does not exist.'
    });

    expect(result.category).toBe(BounceCategory.MAILBOX_UNAVAILABLE);
    expect(result.isHardBounce).toBe(true);
  });

  it('classifies 5.1.2 unroutable domain as DOMAIN_UNAVAILABLE', () => {
    const result = classifyBounce({
      message: '550 5.1.2 <test@bad-nonexistent-domain.com>: Host or domain name not found.'
    });

    expect(result.category).toBe(BounceCategory.DOMAIN_UNAVAILABLE);
    expect(result.isPermanent).toBe(true);
    expect(result.isHardBounce).toBe(true);
  });

  it('classifies 421 rate limit as non-permanent RATE_LIMIT', () => {
    const result = classifyBounce({
      code: 421,
      message: '421 4.7.0 Try again later, closing connection. (Rate limit exceeded)'
    });

    expect(result.category).toBe(BounceCategory.RATE_LIMIT);
    expect(result.isPermanent).toBe(false);
    expect(result.isHardBounce).toBe(false);
  });

  it('classifies 5.7.1 spam rejection as SPAM_REJECTION', () => {
    const result = classifyBounce({
      message: '554 5.7.1 Service unavailable; Client host blocked using Spamhaus; spam detected'
    });

    expect(result.category).toBe(BounceCategory.SPAM_REJECTION);
    expect(result.isPermanent).toBe(true);
    expect(result.isHardBounce).toBe(false);
  });

  it('classifies 550 5.7.26 SPF/DKIM/DMARC rejection as POLICY_REJECTION (not MAILBOX_UNAVAILABLE)', () => {
    const result = classifyBounce({
      message: '550 5.7.26 This message does not pass authentication checks (SPF/DKIM/DMARC).'
    });

    expect(result.category).toBe(BounceCategory.POLICY_REJECTION);
    expect(result.isPermanent).toBe(true);
    expect(result.isHardBounce).toBe(false);
  });

  it('classifies 554 5.7.1 Relay access denied as POLICY_REJECTION', () => {
    const result = classifyBounce({
      code: 554,
      message: '554 5.7.1 Relay access denied'
    });

    expect(result.category).toBe(BounceCategory.POLICY_REJECTION);
    expect(result.isPermanent).toBe(true);
    expect(result.isHardBounce).toBe(false);
  });

  it('classifies 452 mailbox full as non-permanent SOFT_BOUNCE', () => {
    const result = classifyBounce({
      code: 452,
      message: '452 4.2.2 Mailbox full, unable to accept message.'
    });

    expect(result.category).toBe(BounceCategory.SOFT_BOUNCE);
    expect(result.isPermanent).toBe(false);
    expect(result.isHardBounce).toBe(false);
  });

  describe('parseDsnReport', () => {
    it('returns null for standard non-DSN messages', () => {
      const parsed = parseDsnReport('Hello, thanks for your email!', {
        from: 'john@example.com',
        subject: 'Re: Project proposal'
      });
      expect(parsed).toBeNull();
    });

    it('identifies DSN from mailer-daemon and extracts failed recipient', () => {
      const dsnBody = `
From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
Subject: Delivery Status Notification (Failure)

** Address not found **
Your message wasn't delivered to non-existent-lead@targetco.com because the address couldn't be found, or is unable to receive mail.

Final-Recipient: rfc822; non-existent-lead@targetco.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.
      `;

      const parsed = parseDsnReport(dsnBody, {
        from: 'mailer-daemon@googlemail.com',
        subject: 'Delivery Status Notification (Failure)'
      });

      expect(parsed).not.toBeNull();
      expect(parsed?.isDsn).toBe(true);
      expect(parsed?.failedRecipient).toBe('non-existent-lead@targetco.com');
      expect(parsed?.classification.category).toBe(BounceCategory.MAILBOX_UNAVAILABLE);
      expect(parsed?.classification.isHardBounce).toBe(true);
    });
  });

  describe('mapBounceCategoryToFailureCategory', () => {
    it('maps spam and reputation rejections to POLICY', () => {
      expect(mapBounceCategoryToFailureCategory(BounceCategory.SPAM_REJECTION)).toBe(EmailFailureCategory.POLICY);
    });

    it('maps policy and authentication rejections to POLICY', () => {
      expect(mapBounceCategoryToFailureCategory(BounceCategory.POLICY_REJECTION)).toBe(EmailFailureCategory.POLICY);
      expect(mapBounceCategoryToFailureCategory(BounceCategory.AUTHENTICATION_REJECTION)).toBe(EmailFailureCategory.POLICY);
    });

    it('maps hard recipient address failures to INVALID_RECIPIENT', () => {
      expect(mapBounceCategoryToFailureCategory(BounceCategory.MAILBOX_UNAVAILABLE)).toBe(EmailFailureCategory.INVALID_RECIPIENT);
      expect(mapBounceCategoryToFailureCategory(BounceCategory.DOMAIN_UNAVAILABLE)).toBe(EmailFailureCategory.INVALID_RECIPIENT);
      expect(mapBounceCategoryToFailureCategory(BounceCategory.HARD_BOUNCE)).toBe(EmailFailureCategory.INVALID_RECIPIENT);
    });

    it('maps rate limits to RATE_LIMIT', () => {
      expect(mapBounceCategoryToFailureCategory(BounceCategory.RATE_LIMIT)).toBe(EmailFailureCategory.RATE_LIMIT);
    });

    it('maps soft bounces and unknown categories to PROVIDER', () => {
      expect(mapBounceCategoryToFailureCategory(BounceCategory.SOFT_BOUNCE)).toBe(EmailFailureCategory.PROVIDER);
      expect(mapBounceCategoryToFailureCategory(BounceCategory.UNKNOWN)).toBe(EmailFailureCategory.PROVIDER);
      expect(mapBounceCategoryToFailureCategory('SOME_NEW_CATEGORY' as any)).toBe(EmailFailureCategory.PROVIDER);
    });
  });
});
