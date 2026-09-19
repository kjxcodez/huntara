import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MimeBuilder } from '../google/mime-builder.js';
import {
  EmailService,
  generateRfcMessageId,
  isValidRfcMessageId,
  formatRfcMessageId
} from './email.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { ContactStatus } from '@huntara/schema';

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockQuery(result: any) {
  return {
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(Array.isArray(result) ? result : (result ? [result] : [])),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(result).catch(reject)
    }),
    limit: vi.fn().mockResolvedValue(Array.isArray(result) ? result : (result ? [result] : [])),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(result).catch(reject)
  };
}

function decodeBase64UrlMime(raw: string): string {
  let base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

// ── Mocks ───────────────────────────────────────────────────────────────────

let mockDeliveries: Map<string, any> = new Map();
let mockSendSlotSuccess = true;
let mockBuiltProviderSend: any = null;

vi.mock('../../db/models/email-delivery.model.js', () => ({
  EmailDeliveryModel: {
    findOne: vi.fn().mockImplementation(() => mockQuery(null)),
    find: vi.fn().mockImplementation(() => mockQuery([])),
    create: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn()
  }
}));

vi.mock('../../db/models/contact.model.js', () => ({
  ContactModel: {
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 })
  }
}));

vi.mock('../../db/models/email-account.model.js', () => ({
  EmailAccountModel: {
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 })
  }
}));

vi.mock('../../db/models/campaign.model.js', () => ({
  CampaignModel: {
    findOne: vi.fn().mockResolvedValue(null),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 })
  }
}));

vi.mock('../../db/models/user-test-recipient.model.js', () => ({
  UserTestRecipientModel: {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([])
      })
    })
  }
}));

vi.mock('../../repositories/suppression/suppression.repository.js', () => ({
  SuppressionRepository: class {
    isSuppressed = vi.fn().mockResolvedValue(false);
    isCompanySuppressed = vi.fn().mockResolvedValue(false);
    isDomainSuppressed = vi.fn().mockResolvedValue(false);
    evaluateEffectiveSuppression = vi.fn().mockResolvedValue({ isSuppressed: false });
  }
}));

vi.mock('../outreach/domain-pacing.service.js', () => ({
  DomainPacingService: class {
    checkAndReservePacing = vi.fn().mockResolvedValue({
      allowed: true,
      releaseDomainLease: vi.fn().mockResolvedValue(undefined)
    });
  }
}));

vi.mock('../../repositories/email-account/email-account.repository.js', () => ({
  EmailAccountRepository: class {
    resolveEffectiveLimits = vi.fn().mockResolvedValue({ dailyLimit: 500, hourlyLimit: 50 });
    reserveSendSlot = vi.fn().mockImplementation(async () => ({ success: mockSendSlotSuccess }));
    releaseSendSlot = vi.fn().mockResolvedValue(undefined);
    clearSendLease = vi.fn().mockResolvedValue(undefined);
    recordSendSuccess = vi.fn().mockResolvedValue(undefined);
    recordSendFailure = vi.fn().mockResolvedValue(undefined);
  }
}));

vi.mock('../../repositories/email-delivery/email-delivery.repository.js', () => ({
  EmailDeliveryRepository: class {
    reserveDelivery = vi.fn().mockImplementation(async (dto: any) => {
      const id = dto.id || `del_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const doc = {
        _id: id,
        ...dto,
        status: 'SENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      mockDeliveries.set(id, doc);
      return { delivery: doc, isAlreadySent: false };
    });

    finalizeDelivery = vi.fn().mockImplementation(async (id: string, update: any) => {
      const doc = mockDeliveries.get(id) || { _id: id };
      Object.assign(doc, update, { status: update.status || 'SENT' });
      mockDeliveries.set(id, doc);
      return doc;
    });

    failDelivery = vi.fn().mockImplementation(async (id: string, error: string) => {
      const doc = mockDeliveries.get(id) || { _id: id };
      Object.assign(doc, { status: 'FAILED', error });
      mockDeliveries.set(id, doc);
      return doc;
    });
  }
}));

vi.mock('./email-account.service.js', () => ({
  EmailAccountService: class {
    buildProvider = vi.fn().mockImplementation(async () => ({
      send: mockBuiltProviderSend
    }));
  }
}));

describe('Phase 10 — Email Threading & Message Semantics Acceptance Matrix', () => {
  const workspaceA = 'ws_tenant_alpha';
  const workspaceB = 'ws_tenant_beta';
  const accountId = 'acc_outreach_1';
  const senderEmail = 'outreach@growth.acme.com';
  const contactEmail = 'prospect@target.com';
  const contactId = 'cont_prospect_1';
  const executionId = 'exec_seq_camp1_contact1';
  const campaignId = 'camp_101';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeliveries = new Map();
    mockSendSlotSuccess = true;

    // Default account doc
    (EmailAccountModel.findOne as any).mockResolvedValue({
      _id: accountId,
      workspaceId: workspaceA,
      email: senderEmail,
      status: 'connected',
      provider: 'gmail'
    });

    // Default contact doc
    (ContactModel.findOne as any).mockResolvedValue({
      _id: contactId,
      workspaceId: workspaceA,
      email: contactEmail,
      status: ContactStatus.NEW
    });

    // Default provider mock returning Gmail REST API shape
    mockBuiltProviderSend = vi.fn(async (opts: any) => ({
      messageId: `gmail_msg_${Date.now()}`,
      threadId: opts.threadId || `gmail_th_${Date.now()}`,
      accepted: [opts.to],
      sentAt: new Date()
    }));

    (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
      if (query?.status === 'SENDING') {
        return mockQuery(null);
      }
      return mockQuery(null);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. RFC Message-ID Syntax and Helpers
  // ──────────────────────────────────────────────────────────────────────────
  describe('RFC Message-ID Syntax & Format Helpers', () => {
    it('generates a valid, globally unique RFC 2822 Message-ID incorporating sender domain', () => {
      const msgId1 = generateRfcMessageId('alex@acme.com');
      const msgId2 = generateRfcMessageId('alex@acme.com');

      expect(msgId1).toMatch(/^<leadforge\.[a-zA-Z0-9_-]+\.\d+@acme\.com>$/);
      expect(msgId2).toMatch(/^<leadforge\.[a-zA-Z0-9_-]+\.\d+@acme\.com>$/);
      expect(msgId1).not.toBe(msgId2);
    });

    it('isValidRfcMessageId correctly identifies valid Message-IDs and rejects bare IDs', () => {
      // Valid RFC forms
      expect(isValidRfcMessageId('<leadforge.abc.123@acme.com>')).toBe(true);
      expect(isValidRfcMessageId('leadforge.abc.123@acme.com')).toBe(true);
      expect(isValidRfcMessageId('<message-123@sub.domain.org>')).toBe(true);

      // Invalid / bare provider IDs / empty values
      expect(isValidRfcMessageId('18e5a7b123456789')).toBe(false); // Gmail REST message ID
      expect(isValidRfcMessageId('msg_18e5a7b123456789')).toBe(false);
      expect(isValidRfcMessageId('60d5ec49f1b2c8a1b2c3d4e5')).toBe(false); // Mongo ObjectId
      expect(isValidRfcMessageId('')).toBe(false);
      expect(isValidRfcMessageId(null)).toBe(false);
      expect(isValidRfcMessageId(undefined)).toBe(false);
      expect(isValidRfcMessageId('<invalid-no-domain>')).toBe(false);
      expect(isValidRfcMessageId('bare_id_without_at')).toBe(false);
    });

    it('formatRfcMessageId ensures standard angle-bracket enclosure', () => {
      expect(formatRfcMessageId('leadforge.abc.123@acme.com')).toBe('<leadforge.abc.123@acme.com>');
      expect(formatRfcMessageId('<leadforge.abc.123@acme.com>')).toBe('<leadforge.abc.123@acme.com>');
      expect(formatRfcMessageId('   <leadforge.abc.123@acme.com>   ')).toBe('<leadforge.abc.123@acme.com>');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. MimeBuilder Construction
  // ──────────────────────────────────────────────────────────────────────────
  describe('MimeBuilder Header Construction', () => {
    it('builds valid MIME without threading headers for initial message', () => {
      const messageId = '<leadforge.initial.123@acme.com>';
      const raw = MimeBuilder.buildRaw({
        from: 'sender@acme.com',
        to: 'recipient@client.com',
        subject: 'Intro Email',
        text: 'Hello world',
        messageId
      });

      const decoded = decodeBase64UrlMime(raw);
      expect(decoded).toContain(`Message-ID: ${messageId}`);
      expect(decoded).not.toContain('In-Reply-To:');
      expect(decoded).not.toContain('References:');
    });

    it('emits In-Reply-To and References correctly when specified', () => {
      const messageId = '<leadforge.followup.456@acme.com>';
      const predecessorId = '<leadforge.initial.123@acme.com>';

      const raw = MimeBuilder.buildRaw({
        from: 'sender@acme.com',
        to: 'recipient@client.com',
        subject: 'Re: Intro Email',
        text: 'Just following up',
        messageId,
        inReplyTo: predecessorId,
        references: [predecessorId]
      });

      const decoded = decodeBase64UrlMime(raw);
      expect(decoded).toContain(`Message-ID: ${messageId}`);
      expect(decoded).toContain(`In-Reply-To: ${predecessorId}`);
      expect(decoded).toContain(`References: ${predecessorId}`);
    });

    it('emits multi-hop References chain correctly formatted with space delimiters', () => {
      const messageId = '<leadforge.step2.789@acme.com>';
      const step0Id = '<leadforge.step0.123@acme.com>';
      const step1Id = '<leadforge.step1.456@acme.com>';

      const raw = MimeBuilder.buildRaw({
        from: 'sender@acme.com',
        to: 'recipient@client.com',
        subject: 'Re: Intro Email',
        text: 'Second follow up',
        messageId,
        inReplyTo: step1Id,
        references: [step0Id, step1Id]
      });

      const decoded = decodeBase64UrlMime(raw);
      expect(decoded).toContain(`Message-ID: ${messageId}`);
      expect(decoded).toContain(`In-Reply-To: ${step1Id}`);
      expect(decoded).toContain(`References: ${step0Id} ${step1Id}`);
    });

    it('rejects CRLF header injection attempts in Message-ID, In-Reply-To, and References', () => {
      expect(() => {
        MimeBuilder.buildRaw({
          from: 'sender@acme.com',
          to: 'recipient@client.com',
          subject: 'Test',
          text: 'Body',
          messageId: '<valid@acme.com>\r\nBcc: victim@target.com'
        });
      }).toThrow(/CRLF/);

      expect(() => {
        MimeBuilder.buildRaw({
          from: 'sender@acme.com',
          to: 'recipient@client.com',
          subject: 'Test',
          text: 'Body',
          inReplyTo: '<step0@acme.com>\nInjected-Header: evil'
        });
      }).toThrow(/CRLF/);

      expect(() => {
        MimeBuilder.buildRaw({
          from: 'sender@acme.com',
          to: 'recipient@client.com',
          subject: 'Test',
          text: 'Body',
          references: ['<valid@acme.com>', '<step0@acme.com>\r\nX-Injected: bad']
        });
      }).toThrow(/CRLF/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Initial Sequence Step (Step 0)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Initial Sequence Step (Step 0)', () => {
    it('Scenario 1, 2, 3: Initial sequence message receives unique RFC Message-ID and no In-Reply-To/References', async () => {
      const emailService = new EmailService(workspaceA);

      const result = await emailService.send({
        accountId,
        to: contactEmail,
        subject: 'Initial outreach intro',
        text: 'Hi there, introducing LeadForge.',
        campaignId,
        sequenceId: 'seq_1',
        executionId,
        stepIndex: 0,
        contactId
      });

      // Validates outbound delivery result has rfcMessageId
      expect(result.rfcMessageId).toBeDefined();
      expect(isValidRfcMessageId(result.rfcMessageId)).toBe(true);
      expect(result.rfcMessageId).toContain('@growth.acme.com');

      // Validates provider.send was called with Message-ID and NO inReplyTo / references
      expect(mockBuiltProviderSend).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: result.rfcMessageId,
          inReplyTo: undefined,
          references: undefined
        })
      );

      // Validates delivery record saved in Mongo ledger has the RFC messageId
      const savedDeliveries = Array.from(mockDeliveries.values());
      const initialDelivery = savedDeliveries.find((d) => d.executionId === executionId);
      expect(initialDelivery).toBeDefined();
      expect(initialDelivery.messageId).toBe(result.rfcMessageId);
      expect(initialDelivery.inReplyTo).toBeNull();
      expect(initialDelivery.references).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. First Follow-Up (Step 1)
  // ──────────────────────────────────────────────────────────────────────────
  describe('First Follow-Up (Step 1)', () => {
    it('Scenario 4, 5, 6: Follow-up resolves previous step 0 delivery and injects In-Reply-To and References', async () => {
      const emailService = new EmailService(workspaceA);

      const step0RfcId = '<leadforge.step0.12345678@growth.acme.com>';
      const step0ProviderThreadId = 'th_gmail_step0_999';

      // Mock predecessor delivery stored in Mongo
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query?.status === 'SENDING') {
          return mockQuery(null);
        }
        if (
          query?.workspaceId === workspaceA &&
          query?.executionId === executionId &&
          query?.direction === 'OUTBOUND' &&
          query?.status === 'SENT'
        ) {
          return mockQuery({
            _id: 'del_step0',
            workspaceId: workspaceA,
            executionId,
            contactId,
            stepIndex: 0,
            messageId: step0RfcId,
            providerMessageId: 'gmail_msg_000',
            providerThreadId: step0ProviderThreadId,
            references: [],
            status: 'SENT'
          });
        }
        return mockQuery(null);
      });

      const result = await emailService.send({
        accountId,
        to: contactEmail,
        subject: 'Re: Initial outreach intro',
        text: 'Checking in on my previous email.',
        campaignId,
        sequenceId: 'seq_1',
        executionId,
        stepIndex: 1,
        contactId
      });

      expect(result.rfcMessageId).toBeDefined();
      expect(isValidRfcMessageId(result.rfcMessageId)).toBe(true);
      expect(result.rfcMessageId).not.toBe(step0RfcId);

      // Verifies provider.send received In-Reply-To and References pointing to step 0
      expect(mockBuiltProviderSend).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: result.rfcMessageId,
          inReplyTo: step0RfcId,
          references: [step0RfcId],
          threadId: step0ProviderThreadId
        })
      );

      // Verifies delivery ledger stored inReplyTo and references
      const savedDeliveries = Array.from(mockDeliveries.values());
      const step1Delivery = savedDeliveries.find(
        (d) => d.executionId === executionId && d.stepIndex === 1
      );
      expect(step1Delivery).toBeDefined();
      expect(step1Delivery.messageId).toBe(result.rfcMessageId);
      expect(step1Delivery.inReplyTo).toBe(step0RfcId);
      expect(step1Delivery.references).toEqual([step0RfcId]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Multiple Follow-Ups (Step 2)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Multiple Follow-Ups (Step 2)', () => {
    it('Scenario 7, 8: Second follow-up references step 1 in In-Reply-To and preserves cumulative References chain', async () => {
      const emailService = new EmailService(workspaceA);

      const step0RfcId = '<leadforge.step0.11111111@growth.acme.com>';
      const step1RfcId = '<leadforge.step1.22222222@growth.acme.com>';
      const providerThreadId = 'th_gmail_chain_777';

      // Predecessor for step 2 is step 1 (which already has references: [step0RfcId])
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query?.status === 'SENDING') {
          return mockQuery(null);
        }
        if (
          query?.workspaceId === workspaceA &&
          query?.executionId === executionId &&
          query?.direction === 'OUTBOUND' &&
          query?.status === 'SENT'
        ) {
          return mockQuery({
            _id: 'del_step1',
            workspaceId: workspaceA,
            executionId,
            contactId,
            stepIndex: 1,
            messageId: step1RfcId,
            providerMessageId: 'gmail_msg_111',
            providerThreadId,
            references: [step0RfcId],
            status: 'SENT'
          });
        }
        return mockQuery(null);
      });

      const result = await emailService.send({
        accountId,
        to: contactEmail,
        subject: 'Re: Initial outreach intro',
        text: 'Final follow up attempt.',
        campaignId,
        sequenceId: 'seq_1',
        executionId,
        stepIndex: 2,
        contactId
      });

      // Verifies:
      // - In-Reply-To is step 1 (immediate predecessor)
      // - References contains [step 0, step 1]
      // - providerThreadId is passed to provider
      expect(mockBuiltProviderSend).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: result.rfcMessageId,
          inReplyTo: step1RfcId,
          references: [step0RfcId, step1RfcId],
          threadId: providerThreadId
        })
      );

      const savedDeliveries = Array.from(mockDeliveries.values());
      const step2Delivery = savedDeliveries.find(
        (d) => d.executionId === executionId && d.stepIndex === 2
      );
      expect(step2Delivery).toBeDefined();
      expect(step2Delivery.inReplyTo).toBe(step1RfcId);
      expect(step2Delivery.references).toEqual([step0RfcId, step1RfcId]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Missing Metadata & Failsafe Handling
  // ──────────────────────────────────────────────────────────────────────────
  describe('Missing Metadata & Failsafe Handling', () => {
    it('Scenario 9, 10, 11: Predecessor without RFC Message-ID sends cleanly without fabricated headers', async () => {
      const emailService = new EmailService(workspaceA);

      // Predecessor is a legacy record: has providerMessageId (Gmail REST ID) but NO RFC messageId
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query?.status === 'SENDING') {
          return mockQuery(null);
        }
        return mockQuery({
          _id: 'del_legacy_step0',
          workspaceId: workspaceA,
          executionId,
          contactId,
          stepIndex: 0,
          messageId: null, // Legacy: missing RFC Message-ID
          providerMessageId: '18e5a7b123456789', // Bare Gmail REST ID
          providerThreadId: 'th_gmail_legacy_555',
          references: [],
          status: 'SENT'
        });
      });

      const result = await emailService.send({
        accountId,
        to: contactEmail,
        subject: 'Follow-up to legacy message',
        text: 'Following up',
        campaignId,
        sequenceId: 'seq_1',
        executionId,
        stepIndex: 1,
        contactId
      });

      expect(result.rfcMessageId).toBeDefined();

      // Failsafe verified: In-Reply-To and References must NOT be fabricated from bare providerMessageId
      expect(mockBuiltProviderSend).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: result.rfcMessageId,
          inReplyTo: undefined,
          references: undefined,
          // Provider threadId is retained for Gmail thread grouping
          threadId: 'th_gmail_legacy_555'
        })
      );
    });

    it('Scenario 12, 13: Provider REST message ID is never confused with RFC Message-ID in MIME headers', async () => {
      const emailService = new EmailService(workspaceA);

      const legacyProviderMsgId = '18e5a7b123456789';
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query?.status === 'SENDING') {
          return mockQuery(null);
        }
        return mockQuery({
          _id: 'del_step0',
          workspaceId: workspaceA,
          executionId,
          contactId,
          stepIndex: 0,
          messageId: null,
          providerMessageId: legacyProviderMsgId,
          providerThreadId: 'th_123',
          status: 'SENT'
        });
      });

      await emailService.send({
        accountId,
        to: contactEmail,
        subject: 'Step 1',
        text: 'Followup',
        campaignId,
        sequenceId: 'seq_1',
        executionId,
        stepIndex: 1,
        contactId
      });

      const sendCallArgs = mockBuiltProviderSend.mock.calls[0][0];

      // In-Reply-To MUST NOT equal the bare providerMessageId
      expect(sendCallArgs.inReplyTo).toBeUndefined();
      expect(sendCallArgs.references).toBeUndefined();
      expect(sendCallArgs.inReplyTo).not.toBe(legacyProviderMsgId);
      expect(sendCallArgs.inReplyTo).not.toBe(`<${legacyProviderMsgId}>`);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Workspace Isolation
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workspace Isolation', () => {
    it('Scenario 26: Predecessor lookup for Workspace A never matches Workspace B delivery', async () => {
      const emailServiceA = new EmailService(workspaceA);

      // Predecessor only exists under Workspace B
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query?.status === 'SENDING') {
          return mockQuery(null);
        }
        if (query?.workspaceId === workspaceB) {
          return mockQuery({
            _id: 'del_ws_b',
            workspaceId: workspaceB,
            executionId,
            contactId,
            stepIndex: 0,
            messageId: '<msg-from-workspace-b@acme.com>',
            status: 'SENT'
          });
        }
        // Workspace A query returns null
        return mockQuery(null);
      });

      const result = await emailServiceA.send({
        accountId,
        to: contactEmail,
        subject: 'Follow-up attempt',
        text: 'Note in Workspace A',
        campaignId,
        sequenceId: 'seq_1',
        executionId,
        stepIndex: 1,
        contactId
      });

      // No cross-workspace bleeding: In-Reply-To is undefined
      expect(mockBuiltProviderSend).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: result.rfcMessageId,
          inReplyTo: undefined,
          references: undefined
        })
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Multiple Deliveries / Multiple Campaigns Per Contact
  // ──────────────────────────────────────────────────────────────────────────
  describe('Multiple Deliveries Per Contact', () => {
    it('Scenario 27: Resolves correct predecessor based on executionId without cross-campaign pollution', async () => {
      const emailService = new EmailService(workspaceA);

      const camp1ExecutionId = 'exec_camp1_contact1';
      const camp2ExecutionId = 'exec_camp2_contact1';
      const camp1MsgId = '<camp1-step0@acme.com>';
      const camp2MsgId = '<camp2-step0@acme.com>';

      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query?.status === 'SENDING') {
          return mockQuery(null);
        }
        if (query?.executionId === camp2ExecutionId) {
          return mockQuery({
            _id: 'del_camp2',
            workspaceId: workspaceA,
            executionId: camp2ExecutionId,
            contactId,
            stepIndex: 0,
            messageId: camp2MsgId,
            status: 'SENT'
          });
        }
        if (query?.executionId === camp1ExecutionId) {
          return mockQuery({
            _id: 'del_camp1',
            workspaceId: workspaceA,
            executionId: camp1ExecutionId,
            contactId,
            stepIndex: 0,
            messageId: camp1MsgId,
            status: 'SENT'
          });
        }
        return mockQuery(null);
      });

      // Send step 1 for Campaign 2
      await emailService.send({
        accountId,
        to: contactEmail,
        subject: 'Camp 2 Follow-up',
        text: 'Follow up for Campaign 2',
        campaignId: 'camp_2',
        sequenceId: 'seq_2',
        executionId: camp2ExecutionId,
        stepIndex: 1,
        contactId
      });

      // Verifies it threaded against camp2MsgId, NOT camp1MsgId
      expect(mockBuiltProviderSend).toHaveBeenCalledWith(
        expect.objectContaining({
          inReplyTo: camp2MsgId,
          references: [camp2MsgId]
        })
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Ordering & Non-SENT State Safety
  // ──────────────────────────────────────────────────────────────────────────
  describe('Ordering & Race Safety', () => {
    it('Scenario 25: Does not thread against incomplete (SENDING / AMBIGUOUS) deliveries', async () => {
      const emailService = new EmailService(workspaceA);

      // Predecessor is still in SENDING state (or AMBIGUOUS)
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query?.status === 'SENDING') {
          return mockQuery(null);
        }
        if (query?.status === 'SENT') {
          // Query strictly filters status: 'SENT', so non-SENT delivery returns null
          return mockQuery(null);
        }
        return mockQuery(null);
      });

      await emailService.send({
        accountId,
        to: contactEmail,
        subject: 'Attempted send',
        text: 'Body',
        campaignId,
        sequenceId: 'seq_1',
        executionId,
        stepIndex: 1,
        contactId
      });

      // Non-SENT deliveries cannot be used for threading
      expect(mockBuiltProviderSend).toHaveBeenCalledWith(
        expect.objectContaining({
          inReplyTo: undefined,
          references: undefined
        })
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 10. Tracking Independence
  // ──────────────────────────────────────────────────────────────────────────
  describe('Tracking Independence', () => {
    it('Scenario 19, 20, 21: Threading headers are generated identically with tracking enabled and disabled', async () => {
      const origTrackingUrl = process.env.TRACKING_BASE_URL;
      process.env.TRACKING_BASE_URL = 'https://track.leadforge.com';

      try {
        const emailService = new EmailService(workspaceA);
        const step0RfcId = '<tracked-step0@acme.com>';

        (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
          if (query?.status === 'SENDING') {
            return mockQuery(null);
          }
          return mockQuery({
            _id: 'del_step0',
            workspaceId: workspaceA,
            executionId,
            contactId,
            stepIndex: 0,
            messageId: step0RfcId,
            status: 'SENT'
          });
        });

        // Call 1: Tracking disabled
        await emailService.send({
          accountId,
          to: contactEmail,
          subject: 'Untracked follow up',
          html: '<p>Follow up</p>',
          campaignId,
          sequenceId: 'seq_1',
          executionId,
          stepIndex: 1,
          contactId,
          trackingEnabled: false
        });
        const call1Opts = mockBuiltProviderSend.mock.calls[0][0];

        // Call 2: Tracking enabled
        await emailService.send({
          accountId,
          to: contactEmail,
          subject: 'Tracked follow up',
          html: '<p>Follow up</p>',
          campaignId,
          sequenceId: 'seq_1',
          executionId,
          stepIndex: 1,
          contactId,
          trackingEnabled: true
        });
        const call2Opts = mockBuiltProviderSend.mock.calls[1][0];

        expect(call1Opts.inReplyTo).toBe(step0RfcId);
        expect(call2Opts.inReplyTo).toBe(step0RfcId);
        expect(call1Opts.references).toEqual([step0RfcId]);
        expect(call2Opts.references).toEqual([step0RfcId]);
      } finally {
        process.env.TRACKING_BASE_URL = origTrackingUrl;
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 11. Inbound Reply Correlation Compatibility
  // ──────────────────────────────────────────────────────────────────────────
  describe('Inbound Reply Correlation Compatibility', () => {
    it('Scenario 22: ReconciliationService matches inbound reply via In-Reply-To header matching stored RFC messageId', async () => {
      const reconService = new ReconciliationService(workspaceA, {} as any);
      const sentRfcMsgId = '<leadforge.outbound.999@growth.acme.com>';

      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        // Query should include messageId in $or
        const orHasRfcMatch = query?.$or?.some(
          (cond: any) =>
            cond.messageId === sentRfcMsgId ||
            cond.messageId === 'leadforge.outbound.999@growth.acme.com' ||
            cond.messageId === `<leadforge.outbound.999@growth.acme.com>`
        );
        if (orHasRfcMatch && query?.workspaceId === workspaceA) {
          return mockQuery({
            _id: 'del_outbound_match',
            workspaceId: workspaceA,
            contactId,
            messageId: sentRfcMsgId,
            direction: 'OUTBOUND',
            status: 'SENT'
          });
        }
        return mockQuery(null);
      });

      (ContactModel.findOne as any).mockResolvedValue({
        _id: contactId,
        email: contactEmail
      });

      const inboundItem = { id: 'msg_reply_1', threadId: 'unknown_thread' };
      const inboundDetail = {
        headers: {
          from: contactEmail,
          subject: 'Re: Initial outreach intro',
          inReplyTo: sentRfcMsgId
        },
        bodyText: 'Sounds great, let us talk!'
      };

      const evalResult = await reconService.evaluateInboundRelevance(
        inboundItem,
        inboundDetail,
        senderEmail
      );

      expect(evalResult.isRelevant).toBe(true);
      expect(evalResult.reason).toBe('header_matched');
      expect(evalResult.matchedDelivery?._id).toBe('del_outbound_match');
    });
  });
});
