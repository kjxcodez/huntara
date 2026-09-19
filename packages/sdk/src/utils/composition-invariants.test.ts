/**
 * LeadForge OS — Phase 13 Canonical Composition Invariants (T-001 through T-015)
 *
 * Verifies the mathematical guarantees, security boundaries, determinism,
 * and immutability invariants of the email composition pipeline.
 */

import { describe, it, expect } from 'vitest';
import {
  emailTemplateSchema,
  templateVersionSchema,
  emailDeliverySchema,
  generateTrackingToken,
  injectOpenTrackingPixel,
  rewriteLinksForClickTracking,
  sanitizeHtmlForPreview
} from '@huntara/schema';
import {
  renderCanonicalVariables,
  captureVariablesSnapshot,
  sanitizeSubject,
  htmlToPlainText,
  computeMessageFingerprint,
  composeOutboundMessage,
  wrapHtmlWithDefaultTypography,
  plainTextToHtml,
  normalizeEmailSignature,
  type CanonicalVariableContext
} from './variable-resolver.js';

describe('Phase 13 Canonical Composition Invariants (T-001 to T-015)', () => {
  const sampleCtx: CanonicalVariableContext = {
    contact: {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@enterprise.com',
      title: 'VP Engineering',
      phone: '+1-555-0199'
    },
    company: {
      name: 'Acme Corp',
      domain: 'acme.com',
      industry: 'Technology',
      location: 'San Francisco'
    },
    sender: {
      name: 'Alex Rivera',
      email: 'alex@leadforge.ai'
    },
    sequence: {
      id: 'seq_123',
      name: 'Q3 Enterprise Outbound'
    },
    execution: {
      id: 'exec_456',
      currentStep: 1,
      startedAt: '2026-09-01T00:00:00.000Z'
    },
    workspace: {
      id: 'ws_789',
      name: 'Main Workspace'
    },
    variables: {
      customScore: 95,
      tier: 'Tier-1'
    }
  };

  // ── T-001: Template Identity & Immutable Versioning ───────────────────────
  it('T-001: Template Identity & Immutable Versioning', () => {
    const validTpl = emailTemplateSchema.parse({
      id: 'tpl_001',
      workspaceId: 'ws_789',
      name: 'Intro Pitch',
      subject: 'Hello {{contact.firstName}}',
      body: 'Hi {{contact.firstName}}, welcome to {{company.name}}.',
      variables: ['contact.firstName', 'company.name'],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    expect(validTpl.version).toBe(1);

    // Negative version or zero is rejected
    expect(() =>
      emailTemplateSchema.parse({
        ...validTpl,
        version: 0
      })
    ).toThrow();

    // TemplateVersion schema requires immutable archive structure
    const archive = templateVersionSchema.parse({
      id: 'tpl_ver_001',
      workspaceId: 'ws_789',
      templateId: 'tpl_001',
      version: 1,
      name: 'Intro Pitch',
      subject: 'Hello {{contact.firstName}}',
      body: 'Hi {{contact.firstName}}, welcome to {{company.name}}.',
      variables: ['contact.firstName', 'company.name'],
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });
    expect(archive.version).toBe(1);
    expect(archive.templateId).toBe('tpl_001');
  });

  // ── T-002: Pure Deterministic Variable Resolution ─────────────────────────
  it('T-002: Pure Deterministic Variable Resolution', () => {
    const template = 'Hi {{contact.firstName}}, saw your role as {{contact.title}} at {{company.name}} with score {{variables.customScore}}. Missing: {{contact.missingField}}!';
    
    // Identical inputs produce bit-for-bit identical outputs
    const run1 = renderCanonicalVariables(template, sampleCtx);
    const run2 = renderCanonicalVariables(template, sampleCtx);
    expect(run1).toBe(run2);
    expect(run1).toBe('Hi Jane, saw your role as VP Engineering at Acme Corp with score 95. Missing: !');

    // Missing/undefined variables resolve to empty string without throwing
    const emptyCtx: CanonicalVariableContext = { contact: {}, company: null, sender: {} };
    const renderedMissing = renderCanonicalVariables('Hello {{contact.firstName}} at {{company.name}}', emptyCtx);
    expect(renderedMissing).toBe('Hello  at ');
  });

  // ── T-003: HTML-Context Variable Escaping ──────────────────────────────────
  it('T-003: HTML-Context Variable Escaping', () => {
    const maliciousCtx: CanonicalVariableContext = {
      contact: {
        firstName: '<script>alert("XSS")</script>',
        lastName: 'O\'Connor',
        title: '"><img src=x onerror=alert(1)>'
      },
      company: {
        name: 'Ben & Jerry\'s "Special"'
      },
      sender: { name: 'Admin' }
    };

    const htmlTemplate = '<div class="greeting">Hello {{contact.firstName}} {{contact.lastName}}, title: {{contact.title}} at {{company.name}}</div>';
    const safeRenderedHtml = renderCanonicalVariables(htmlTemplate, maliciousCtx, { isHtml: true });

    // HTML entities in substituted variables are escaped
    expect(safeRenderedHtml).not.toContain('<script>');
    expect(safeRenderedHtml).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    expect(safeRenderedHtml).toContain('O&#39;Connor');
    expect(safeRenderedHtml).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(safeRenderedHtml).toContain('Ben &amp; Jerry&#39;s &quot;Special&quot;');
    
    // Existing template markup is preserved
    expect(safeRenderedHtml).toContain('<div class="greeting">');
    expect(safeRenderedHtml).toContain('</div>');
  });

  // ── T-004: Subject Line Header-Safety Sanitization ─────────────────────────
  it('T-004: Subject Line Header-Safety Sanitization', () => {
    // CRLF injection attempt
    const crlfAttempt = 'Exclusive Invite\r\nBcc: victim@target.com\n\rSubject: Injected';
    const sanitized = sanitizeSubject(crlfAttempt);

    expect(sanitized.isValid).toBe(true);
    expect(sanitized.sanitized).not.toContain('\r');
    expect(sanitized.sanitized).not.toContain('\n');
    expect(sanitized.sanitized).toBe('Exclusive Invite Bcc: victim@target.com Subject: Injected');

    // Empty or whitespace only is rejected
    expect(sanitizeSubject('').isValid).toBe(false);
    expect(sanitizeSubject('   \t\r\n  ').isValid).toBe(false);

    // Enforce max 998 RFC 5322 characters
    const overlong = 'A'.repeat(1005);
    const overlongResult = sanitizeSubject(overlong);
    expect(overlongResult.isValid).toBe(true);
    expect(overlongResult.sanitized.length).toBe(998);
  });

  // ── T-005: Automatic Multi-Part Generation ─────────────────────────────────
  it('T-005: Automatic Multi-Part Generation', () => {
    const rawHtml = '<p>Hello <b>Jane</b>,</p><p>Check this out <a href="https://acme.com">link</a>.</p>';
    const generatedText = htmlToPlainText(rawHtml);

    expect(generatedText).toContain('Hello Jane,');
    expect(generatedText).toContain('Check this out link.');
    expect(generatedText).not.toContain('<p>');
    expect(generatedText).not.toContain('<b>');

    const rawText = 'Hello Jane,\n\nWe are excited to connect.';
    const generatedHtml = plainTextToHtml(rawText);

    expect(generatedHtml).toContain('Hello Jane,');
    expect(generatedHtml).toContain('We are excited to connect.');
    expect(generatedHtml).toContain('font-family:sans-serif');
  });

  // ── T-006: Default Typography Enclosure ───────────────────────────────────
  it('T-006: Default Typography Enclosure', () => {
    const unadorned = '<p>Quick update on our project.</p>';
    const wrapped = wrapHtmlWithDefaultTypography(unadorned);

    expect(wrapped.startsWith('<div style="font-family:sans-serif;line-height:107%;">')).toBe(true);
    expect(wrapped.endsWith('</div>')).toBe(true);
    expect(wrapped).toContain('<p>Quick update on our project.</p>');

    // Idempotent: already wrapped content is not re-wrapped
    const twice = wrapHtmlWithDefaultTypography(wrapped);
    expect(twice).toBe(wrapped);
  });

  // ── T-007: Gmail Signature Normalization ──────────────────────────────────
  it('T-007: Gmail Signature Normalization', () => {
    const rawEscapedSig = '<div dir="ltr"><pre><code>&lt;td style=&quot;padding-left:18px;&quot;&gt;&lt;div&gt;&lt;strong&gt;Alex Rivera&lt;/strong&gt;&lt;/div&gt;&lt;/td&gt;</code></pre></div>';
    const normalized = normalizeEmailSignature(rawEscapedSig);

    expect(normalized).toContain('<table');
    expect(normalized).toContain('<strong>Alex Rivera</strong>');
    expect(normalized).not.toContain('<pre>');

    // In composition, signature is enclosed in gmail_signature container with prefix
    const composed = composeOutboundMessage({
      workspaceId: 'ws_789',
      subject: 'Test',
      body: '<p>Message content</p>',
      sender: { name: 'Alex', email: 'alex@leadforge.ai', signatureHtml: 'Alex Rivera' },
      recipient: { email: 'jane@enterprise.com' },
      context: sampleCtx
    });
    expect(composed.htmlBody).toContain('class="gmail_signature"');
    expect(composed.htmlBody).toContain('Alex Rivera');
    expect(composed.htmlBody).toContain('-- ');
  });

  // ── T-008: Opaque Tracking Tokens ─────────────────────────────────────────
  it('T-008: Opaque Tracking Tokens', () => {
    const token1 = generateTrackingToken();
    const token2 = generateTrackingToken();

    expect(token1).toHaveLength(32);
    expect(token2).toHaveLength(32);
    expect(token1).not.toBe(token2);
    expect(/^[a-f0-9]{32}$/.test(token1)).toBe(true);

    // Contains zero PII or identifiers
    expect(token1).not.toContain('ws_');
    expect(token1).not.toContain('contact');
    expect(token1).not.toContain('user');
  });

  // ── T-009: Link Rewriting & Pixel Injection Idempotency ────────────────────
  it('T-009: Link Rewriting & Pixel Injection Idempotency', () => {
    const originalHtml = '<p>Check <a href="https://acme.com/demo">demo</a> and <a href="https://acme.com/pricing">pricing</a>.</p>';
    const baseUrl = 'https://track.leadforge.ai';

    const rewrite1 = rewriteLinksForClickTracking(originalHtml, baseUrl);
    expect(rewrite1.tokens).toHaveLength(2);
    expect(rewrite1.rewrittenHtml).toContain('https://track.leadforge.ai/t/click/');

    // Retry idempotency: rewriting an already rewritten HTML must not double-wrap URLs
    const rewrite2 = rewriteLinksForClickTracking(rewrite1.rewrittenHtml, baseUrl);
    expect(rewrite2.rewrittenHtml).toBe(rewrite1.rewrittenHtml);

    // Pixel injection idempotency
    const token = generateTrackingToken();
    const pixelHtml1 = injectOpenTrackingPixel(rewrite1.rewrittenHtml, baseUrl, token);
    expect(pixelHtml1).toContain('/t/open/' + token);

    const pixelHtml2 = injectOpenTrackingPixel(pixelHtml1, baseUrl, token);
    expect(pixelHtml2).toBe(pixelHtml1);
  });

  // ── T-010: Strict Tracking Exclusion Invariants ───────────────────────────
  it('T-010: Strict Tracking Exclusion Invariants', () => {
    const htmlWithExclusions = `
      <p>
        <a href="mailto:support@leadforge.ai">Email Support</a>
        <a href="tel:+15550199">Call Us</a>
        <a href="#section-top">Back to top</a>
        <a href="https://acme.com/privacy" data-no-track="true">Privacy Policy</a>
        <a href="https://acme.com/unsubscribe?user=123">Unsubscribe</a>
        <a href="https://acme.com/features">Features</a>
      </p>
    `;
    const res = rewriteLinksForClickTracking(htmlWithExclusions, 'https://track.leadforge.ai');

    // Only https://acme.com/features should be tracked
    expect(res.tokens).toHaveLength(1);
    expect(res.tokens[0]!.targetUrl).toBe('https://acme.com/features');

    expect(res.rewrittenHtml).toContain('href="mailto:support@leadforge.ai"');
    expect(res.rewrittenHtml).toContain('href="tel:+15550199"');
    expect(res.rewrittenHtml).toContain('href="#section-top"');
    expect(res.rewrittenHtml).toContain('href="https://acme.com/privacy"');
    expect(res.rewrittenHtml).toContain('href="https://acme.com/unsubscribe?user=123"');
  });

  // ── T-011: Safe Desktop Preview Sandbox Invariants ─────────────────────────
  it('T-011: Safe Desktop Preview Sandbox Invariants', () => {
    const outboundWithTracking = `
      <div>
        <p>Hello <a href="https://track.leadforge.ai/t/click/tok123">Click here</a></p>
        <img src="https://external-cdn.com/banner.png" alt="Banner" />
        <img src="https://track.leadforge.ai/t/open/pixel123" width="1" height="1" />
      </div>
    `;

    const sanitized = sanitizeHtmlForPreview(outboundWithTracking, {
      stripTrackingPixels: true,
      blockRemoteImages: true,
      neutralizeLinks: true
    });

    // Tracking pixel removed
    expect(sanitized).not.toContain('/t/open/pixel123');
    // Remote images have src neutralized with safe SVG data placeholder and original URL moved to data-src
    expect(sanitized).toContain('data-src="https://external-cdn.com/banner.png"');
    expect(sanitized).toContain('src="data:image/svg+xml');
    expect(sanitized).not.toMatch(/\ssrc=["']https:\/\/external-cdn\.com/);
    // Links neutralized with target="_blank" and rel="noopener noreferrer"
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
  });

  // ── T-012: Deterministic Content Fingerprint ──────────────────────────────
  it('T-012: Deterministic Content Fingerprint', () => {
    const input1 = {
      workspaceId: 'ws_789',
      senderEmail: 'alex@leadforge.ai',
      recipientEmail: 'jane@enterprise.com',
      subject: 'Partnership Inquiry',
      htmlBody: '<p>Hello Jane</p>',
      textBody: 'Hello Jane',
      templateId: 'tpl_001',
      templateVersion: 2,
      attachmentChecksums: ['sha256_hash1', 'sha256_hash2']
    };

    const fp1 = computeMessageFingerprint(input1);
    const fp2 = computeMessageFingerprint(input1);
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // SHA-256 hex string

    // Modifying any parameter alters the fingerprint
    const fpSubjectMutated = computeMessageFingerprint({ ...input1, subject: 'Partnership Inquiry!' });
    expect(fpSubjectMutated).not.toBe(fp1);

    const fpVersionMutated = computeMessageFingerprint({ ...input1, templateVersion: 3 });
    expect(fpVersionMutated).not.toBe(fp1);

    const fpRecipientMutated = computeMessageFingerprint({ ...input1, recipientEmail: 'other@enterprise.com' });
    expect(fpRecipientMutated).not.toBe(fp1);
  });

  // ── T-013: Variable Snapshot Completeness ──────────────────────────────────
  it('T-013: Variable Snapshot Completeness', () => {
    const templateSubject = 'Intro to {{company.name}} from {{sender.name}}';
    const templateBody = 'Hi {{contact.firstName}} {{contact.lastName}}, I see you are at {{company.name}}.';

    const snapshot = captureVariablesSnapshot(templateSubject + ' ' + templateBody, sampleCtx);

    expect(snapshot).toEqual({
      'company.name': 'Acme Corp',
      'sender.name': 'Alex Rivera',
      'contact.firstName': 'Jane',
      'contact.lastName': 'Doe'
    });
    // Does not capture variables not referenced in template
    expect(snapshot['contact.phone']).toBeUndefined();
    expect(snapshot['variables.tier']).toBeUndefined();
  });

  // ── T-014: Authoritative Delivery Ledger Lineage ──────────────────────────
  it('T-014: Authoritative Delivery Ledger Lineage', () => {
    const validDelivery = emailDeliverySchema.parse({
      id: 'del_001',
      workspaceId: 'ws_789',
      sequenceId: 'seq_123',
      executionId: 'exec_456',
      stepIndex: 1,
      contactId: 'cnt_001',
      accountId: 'acc_001',
      senderEmail: 'alex@leadforge.ai',
      recipientEmail: 'jane@enterprise.com',
      subject: 'Hello Jane',
      status: 'QUEUED',
      idempotencyKey: 'email_ws_789_exec_456_1_cnt_001',
      templateId: 'tpl_001',
      templateVersion: 2,
      variablesSnapshot: { 'contact.firstName': 'Jane' },
      messageFingerprint: 'a'.repeat(64),
      attempt: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(validDelivery.templateId).toBe('tpl_001');
    expect(validDelivery.templateVersion).toBe(2);
    expect(validDelivery.variablesSnapshot).toEqual({ 'contact.firstName': 'Jane' });
    expect(validDelivery.messageFingerprint).toHaveLength(64);
  });

  // ── T-015: Historical Send Immutability ────────────────────────────────────
  it('T-015: Historical Send Immutability via Unified Composition Engine', () => {
    const composeInput = {
      workspaceId: 'ws_789',
      template: {
        id: 'tpl_001',
        version: 1,
        subject: 'Special Offer for {{company.name}}',
        body: '<p>Hello {{contact.firstName}}, we love {{company.name}}!</p>'
      },
      sender: {
        name: 'Alex Rivera',
        email: 'alex@leadforge.ai',
        signatureHtml: 'Best,<br/>Alex'
      },
      recipient: {
        email: 'jane@enterprise.com',
        firstName: 'Jane',
        lastName: 'Doe'
      },
      context: sampleCtx,
      trackingBaseUrl: 'https://track.leadforge.ai',
      enableClickTracking: true,
      enableOpenTracking: true
    };

    const resultV1 = composeOutboundMessage(composeInput);

    expect(resultV1.templateId).toBe('tpl_001');
    expect(resultV1.templateVersion).toBe(1);
    expect(resultV1.subject).toBe('Special Offer for Acme Corp');
    expect(resultV1.htmlBody).toContain('Hello Jane');
    expect(resultV1.messageFingerprint).toBeTruthy();

    // Updating template to V2 produces new fingerprint and does not mutate V1 snapshot
    const resultV2 = composeOutboundMessage({
      ...composeInput,
      template: {
        id: 'tpl_001',
        version: 2,
        subject: 'NEW Exclusive Offer for {{company.name}}',
        body: '<p>Updated greeting {{contact.firstName}}.</p>'
      }
    });

    expect(resultV2.templateVersion).toBe(2);
    expect(resultV2.subject).toBe('NEW Exclusive Offer for Acme Corp');
    expect(resultV2.messageFingerprint).not.toBe(resultV1.messageFingerprint);

    // V1 record remains completely untouched
    expect(resultV1.templateVersion).toBe(1);
    expect(resultV1.subject).toBe('Special Offer for Acme Corp');
  });
});
