import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  computeAttachmentChecksums,
  computeMessageFingerprint,
  composeOutboundMessage,
  type MessageFingerprintInput
} from './variable-resolver.js';

describe('Phase 16 - Composition Parity & Determinism (FINGERPRINT-06)', () => {
  const baseFingerprintInput: MessageFingerprintInput = {
    workspaceId: 'ws_prod_01',
    senderEmail: 'Alex@Leadforge.ai',
    recipientEmail: 'Sarah.Connor@Enterprise.Com ',
    subject: ' Exclusive Opportunity for {{company.name}} ',
    textBody: 'Hi Sarah, exciting news for Acme Corp.',
    htmlBody: '<p>Hi Sarah, exciting news for <strong>Acme Corp</strong>.</p>',
    templateId: 'tpl_imm_001',
    templateVersion: 3,
    attachmentChecksums: []
  };

  it('normalizes sender, recipient, and whitespace deterministically', () => {
    const fp1 = computeMessageFingerprint(baseFingerprintInput);

    const fp2 = computeMessageFingerprint({
      ...baseFingerprintInput,
      senderEmail: 'alex@leadforge.ai', // lowercase
      recipientEmail: 'sarah.connor@enterprise.com', // trimmed & lowercased
      subject: 'Exclusive Opportunity for {{company.name}}' // trimmed
    });

    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64);
  });

  it('computes deterministic attachment checksums with order invariance', () => {
    const att1 = {
      filename: 'report.pdf',
      data: Buffer.from('Quarterly Financial Report Q3 2026')
    };
    const att2 = {
      filename: 'deck.pptx',
      contentBase64: Buffer.from('Presentation Slide Deck Bytes').toString('base64')
    };
    const att3 = {
      filename: 'whitepaper.pdf',
      fileId: 'gdrive_file_987654',
      size: 1048576
    };

    // Checksums for list in order [att1, att2, att3]
    const checksumsA = computeAttachmentChecksums([att1, att2, att3]);
    // Checksums for list in reverse order [att3, att2, att1]
    const checksumsB = computeAttachmentChecksums([att3, att2, att1]);

    expect(checksumsA).toEqual(checksumsB);
    expect(checksumsA).toHaveLength(3);

    // Fingerprints computed with attachments in different order must match
    const fpA = computeMessageFingerprint({
      ...baseFingerprintInput,
      attachmentChecksums: checksumsA
    });
    const fpB = computeMessageFingerprint({
      ...baseFingerprintInput,
      attachmentChecksums: checksumsB
    });
    expect(fpA).toBe(fpB);
  });

  it('alters fingerprint when attachment bytes are modified', () => {
    const originalAtt = {
      filename: 'contract.pdf',
      data: Buffer.from('Original Contract Agreement v1.0')
    };
    const modifiedAtt = {
      filename: 'contract.pdf',
      data: Buffer.from('Tampered Contract Agreement v1.1')
    };

    const checksumsOrig = computeAttachmentChecksums([originalAtt]);
    const checksumsMod = computeAttachmentChecksums([modifiedAtt]);

    expect(checksumsOrig).not.toEqual(checksumsMod);

    const fpOrig = computeMessageFingerprint({
      ...baseFingerprintInput,
      attachmentChecksums: checksumsOrig
    });
    const fpMod = computeMessageFingerprint({
      ...baseFingerprintInput,
      attachmentChecksums: checksumsMod
    });

    expect(fpOrig).not.toBe(fpMod);
  });

  it('guarantees preview composition and delivery composition yield the exact same fingerprint', () => {
    const composePayload = {
      workspaceId: 'ws_prod_01',
      sender: {
        email: 'alex@leadforge.ai',
        name: 'Alex Rivera',
        signatureHtml: '<div>Best regards,<br/>Alex</div>'
      },
      recipient: {
        email: 'sarah.connor@enterprise.com',
        firstName: 'Sarah',
        lastName: 'Connor'
      },
      template: {
        id: 'tpl_imm_001',
        version: 3,
        subject: 'Partnership with {{company.name}}',
        body: '<p>Hello {{contact.firstName}}, let us collaborate.</p>'
      },
      context: {
        company: { name: 'Cyberdyne Systems' }
      },
      trackingBaseUrl: 'https://track.leadforge.ai'
    };

    // 1. Simulate Preview Composition (tracking pixels/tokens are generated freshly)
    const previewResult = composeOutboundMessage(composePayload);

    // 2. Simulate Actual Delivery Composition (different tracking execution)
    const sendResult = composeOutboundMessage(composePayload);

    // Both must yield the EXACT same canonical messageFingerprint
    expect(previewResult.messageFingerprint).toBe(sendResult.messageFingerprint);
    expect(previewResult.messageFingerprint).toHaveLength(64);

    // However, the tracking tokens differ per execution
    expect(previewResult.openTrackingToken).not.toBe(sendResult.openTrackingToken);
    expect(previewResult.htmlBody).not.toBe(sendResult.htmlBody); // tracking pixel token differs
  });

  it('detects template version mutation in fingerprint', () => {
    const fpV1 = computeMessageFingerprint({
      ...baseFingerprintInput,
      templateVersion: 1
    });
    const fpV2 = computeMessageFingerprint({
      ...baseFingerprintInput,
      templateVersion: 2
    });

    expect(fpV1).not.toBe(fpV2);
  });
});
