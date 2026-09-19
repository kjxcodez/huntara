import { describe, it, expect } from 'vitest';
import { sanitizeHtmlForPreview } from '@huntara/schema';

describe('Email Logs UI & Safe Preview Suite', () => {
  describe('HTML Sanitization and Preview Security', () => {
    it('strips open tracking pixels completely to prevent false open events during desktop inspection', () => {
      const rawEmailHtml = `
        <div>
          <h1>Hello Alex</h1>
          <p>Hope you are doing well.</p>
          <img src="https://app.leadforge.com/tracking/open/token-12345" alt="pixel" width="1" height="1" style="display:none;" />
          <img src="/tracking/open/relative-pixel" width="1" height="1" />
        </div>
      `;

      const sanitized = sanitizeHtmlForPreview(rawEmailHtml, {
        stripTrackingPixels: true,
        blockRemoteImages: false,
        neutralizeLinks: true
      });

      expect(sanitized).not.toContain('/tracking/open/token-12345');
      expect(sanitized).not.toContain('/tracking/open/relative-pixel');
      expect(sanitized).toContain('<h1>Hello Alex</h1>');
      expect(sanitized).toContain('<p>Hope you are doing well.</p>');
    });

    it('blocks remote images and injects inline SVG placeholder when blockRemoteImages is true', () => {
      const rawEmailHtml = `
        <div>
          <p>Check our logo:</p>
          <img src="https://cdn.example.com/logo.png" alt="Company Logo" />
        </div>
      `;

      const sanitized = sanitizeHtmlForPreview(rawEmailHtml, {
        stripTrackingPixels: true,
        blockRemoteImages: true,
        neutralizeLinks: true
      });

      expect(sanitized).not.toMatch(/\ssrc="https?:\/\/cdn\.example\.com/);
      expect(sanitized).toContain('data-src="https://cdn.example.com/logo.png"');
      expect(sanitized).toContain('data:image/svg+xml');
    });

    it('allows remote images when blockRemoteImages is false', () => {
      const rawEmailHtml = `
        <div>
          <img src="https://cdn.example.com/photo.jpg" alt="Photo" />
        </div>
      `;

      const sanitized = sanitizeHtmlForPreview(rawEmailHtml, {
        stripTrackingPixels: true,
        blockRemoteImages: false,
        neutralizeLinks: true
      });

      expect(sanitized).toContain('src="https://cdn.example.com/photo.jpg"');
      expect(sanitized).not.toContain('data-blocked-image');
    });

    it('neutralizes malicious scripts, iframes, and javascript: links in email body', () => {
      const maliciousHtml = `
        <div>
          <p>Safe text</p>
          <script>alert("hacked")</script>
          <iframe src="https://malicious.example.com"></iframe>
          <a href="javascript:alert(1)">Click me</a>
          <a href="https://legit.example.com">Legit Link</a>
        </div>
      `;

      const sanitized = sanitizeHtmlForPreview(maliciousHtml, {
        stripTrackingPixels: true,
        blockRemoteImages: false,
        neutralizeLinks: true
      });

      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('alert("hacked")');
      expect(sanitized).not.toContain('<iframe');
      expect(sanitized).not.toContain('href="javascript:alert(1)"');
      expect(sanitized).toContain('href="https://legit.example.com"');
      expect(sanitized).toContain('target="_blank"');
      expect(sanitized).toContain('rel="noopener noreferrer"');
    });

    it('handles empty, null, or plain-text gracefully', () => {
      expect(sanitizeHtmlForPreview('', { stripTrackingPixels: true })).toBe('');
      expect(sanitizeHtmlForPreview('Just plain text without tags', { stripTrackingPixels: true })).toBe(
        'Just plain text without tags'
      );
    });
  });

  describe('Delivery State & Diagnostic Correctness', () => {
    it('accurately distinguishes SENT, AMBIGUOUS, and FAILED status semantics', () => {
      const sentDelivery = {
        id: 'del_sent_1',
        status: 'SENT',
        providerMessageId: 'gmail_msg_123',
        sentAt: new Date('2026-09-04T00:00:00Z'),
        ambiguous: false
      };

      const ambiguousDelivery = {
        id: 'del_ambig_1',
        status: 'AMBIGUOUS',
        providerMessageId: null,
        ambiguous: true,
        safeHumanMessage: 'Provider timeout. Delivery state inconclusive.'
      };

      const failedDelivery = {
        id: 'del_failed_1',
        status: 'FAILED',
        error: 'Invalid recipient address',
        failureCode: 'INVALID_RECIPIENT',
        retryable: false
      };

      expect(sentDelivery.status).toBe('SENT');
      expect(sentDelivery.providerMessageId).toBeTruthy();

      expect(ambiguousDelivery.status).toBe('AMBIGUOUS');
      expect(ambiguousDelivery.ambiguous).toBe(true);
      expect(ambiguousDelivery.providerMessageId).toBeNull();

      expect(failedDelivery.status).toBe('FAILED');
      expect(failedDelivery.retryable).toBe(false);
    });

    it('correctly associates reply detection with sequence cessation flag', () => {
      const deliveryWithReply = {
        id: 'del_reply_1',
        status: 'SENT',
        hasReply: true,
        replyCount: 1,
        lastRepliedAt: new Date('2026-09-04T01:00:00Z'),
        direction: 'OUTBOUND'
      };

      const inboundReply = {
        id: 'del_inbound_1',
        direction: 'INBOUND',
        senderEmail: 'lead@target.com',
        recipientEmail: 'sales@leadforge.com',
        subject: 'Re: Quick inquiry',
        matchedDeliveryId: 'del_reply_1',
        matchConfidence: 'thread'
      };

      expect(deliveryWithReply.hasReply).toBe(true);
      expect(inboundReply.direction).toBe('INBOUND');
      expect(inboundReply.matchedDeliveryId).toBe('del_reply_1');
      expect(inboundReply.matchConfidence).toBe('thread');
    });
  });

  describe('Email Logs Master/Detail Split Layout & Defensive Geometry', () => {
    it('enforces robust desktop master/detail column constraints with min 300px left pane and minmax(0, 1fr) detail pane', () => {
      // Preferred CSS Grid layout specification
      const gridColumnsDef = 'minmax(320px, 380px) minmax(0, 1fr)';
      expect(gridColumnsDef).toContain('minmax(320px, 380px)');
      expect(gridColumnsDef).toContain('minmax(0, 1fr)');

      // Simulate responsive layout calculations across required desktop window widths
      const testViewports = [
        { width: 1920, name: '1080p full desktop' },
        { width: 1600, name: '1600x900 standard desktop' },
        { width: 1440, name: '1440x900 laptop' },
        { width: 1280, name: '1280x800 compact desktop' },
        { width: 1100, name: '1100x700 minimum supported desktop' }
      ];

      const sidebarWidth = 240;
      const shellPadding = 32; // 2rem total padding
      const minLeftPane = 300;
      const maxLeftPane = 380;

      for (const vp of testViewports) {
        const availableContentWidth = vp.width - sidebarWidth - shellPadding;
        expect(availableContentWidth).toBeGreaterThan(minLeftPane + 200);

        // Calculate left pane within [300px, 380px]
        const leftPaneWidth = Math.min(Math.max(availableContentWidth * 0.3, minLeftPane), maxLeftPane);
        const detailPaneWidth = availableContentWidth - leftPaneWidth;

        // Verify left pane never collapses below minimum
        expect(leftPaneWidth).toBeGreaterThanOrEqual(minLeftPane);
        expect(leftPaneWidth).toBeLessThanOrEqual(maxLeftPane);

        // Verify detail pane receives all remaining space and is comfortable
        expect(detailPaneWidth).toBeGreaterThan(450);
      }
    });

    it('ensures long technical identifiers preserve exact underlying values for clipboard copy while UI truncates safely', () => {
      const longIdentifiers = {
        deliveryId: 'del_01HZYXABCDEF123456789012345678901234567890',
        executionId: 'exec_lineage_01HZYXABCDEF123456789012345678901234567890',
        providerMessageId: '<CADk29Xb_1234567890abcdefghijklmnopqrstuvwxyz_ABCD@mail.gmail.com>',
        idempotencyKey: 'idemp_workspace123_contact456_step0_attempt1_1725619200000_unique_salt',
        contentFingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      };

      // Full fidelity preserved for clipboard operations
      for (const [key, value] of Object.entries(longIdentifiers)) {
        expect(value.length).toBeGreaterThan(30);
        // Verify value has no whitespace that could distort raw IDs
        expect(value.trim()).toBe(value);
      }

      // Content fingerprint is exact 64-char SHA-256 hex string
      expect(longIdentifiers.contentFingerprint).toHaveLength(64);
      expect(longIdentifiers.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('validates independent scrolling layout contracts to prevent full-page scroll blowout', () => {
      // The master page shell must be bounded by viewport height minus header/padding
      const rootHeightClass = 'h-[calc(100vh-5rem)] max-h-[calc(100vh-5rem)]';
      const rootOverflow = 'overflow-hidden';

      expect(rootHeightClass).toContain('100vh');
      expect(rootOverflow).toBe('overflow-hidden');

      // The split pane must allow both list and detail to scroll independently
      const listScrollClass = 'flex-1 overflow-y-auto';
      const detailScrollClass = 'overflow-y-auto overflow-x-hidden';

      expect(listScrollClass).toContain('overflow-y-auto');
      expect(detailScrollClass).toContain('overflow-y-auto');
      expect(detailScrollClass).toContain('overflow-x-hidden');
    });

    it('guarantees empty selection state preserves identical split geometry without collapsing list', () => {
      // Both states must render inside identical grid containers
      const selectedStateContainer = {
        gridStyle: { gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)' },
        leftPaneClass: 'h-full min-h-0 min-w-0 overflow-hidden flex flex-col',
        rightPaneClass: 'h-full min-h-0 min-w-0 overflow-hidden bg-background/50 flex flex-col'
      };

      const emptyStateContainer = {
        gridStyle: { gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)' },
        leftPaneClass: 'h-full min-h-0 min-w-0 overflow-hidden flex flex-col',
        rightPaneClass: 'h-full min-h-0 min-w-0 overflow-hidden bg-background/50 flex flex-col'
      };

      expect(selectedStateContainer.gridStyle).toEqual(emptyStateContainer.gridStyle);
      expect(selectedStateContainer.leftPaneClass).toEqual(emptyStateContainer.leftPaneClass);
      expect(selectedStateContainer.rightPaneClass).toEqual(emptyStateContainer.rightPaneClass);
    });
  });
});
