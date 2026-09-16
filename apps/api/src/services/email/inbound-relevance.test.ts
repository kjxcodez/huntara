import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconciliationService } from './reconciliation.service.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { EmailEventRepository } from '../../repositories/email-event/email-event.repository.js';
import { SuppressionRepository } from '../../repositories/suppression/suppression.repository.js';
import { GmailProvider } from '../google/gmail.provider.js';

// Mocks
vi.mock('../../db/models/email-delivery.model.js', () => ({
  EmailDeliveryModel: {
    findOne: vi.fn(),
    find: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
    create: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn()
  }
}));

vi.mock('../../db/models/contact.model.js', () => ({
  ContactModel: {
    findOne: vi.fn(),
    updateOne: vi.fn()
  }
}));

vi.mock('../../db/models/email-account.model.js', () => ({
  EmailAccountModel: {
    findOne: vi.fn(),
    updateOne: vi.fn()
  }
}));

vi.mock('../../db/models/campaign.model.js', () => ({
  CampaignModel: {
    findOne: vi.fn().mockResolvedValue(null),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 })
  }
}));

vi.mock('../../db/models/sequence-execution.model.js', () => ({
  SequenceExecutionModel: {
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 })
  }
}));

vi.mock('../../repositories/email-event/email-event.repository.js', () => ({
  EmailEventRepository: class {
    recordEvent = vi.fn().mockResolvedValue({});
  }
}));

vi.mock('../../repositories/suppression/suppression.repository.js', () => ({
  SuppressionRepository: class {
    suppress = vi.fn().mockResolvedValue({});
  }
}));

vi.mock('../google/gmail.provider.js', () => ({
  GmailProvider: class {
    listInboundMessages = vi.fn();
    getMessage = vi.fn();
  }
}));

vi.mock('../google/auth.service.js', () => ({
  GoogleAuthService: class {
    getValidAccessToken = vi.fn().mockResolvedValue('test_token');
  }
}));

describe('Phase 2 — Inbound Email Scope & Relevance Filtering', () => {
  const workspaceId = 'ws_phase2_test';
  const accountEmail = 'rep@leadforge.ai';
  let reconciliationService: ReconciliationService;
  let mockGmailProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (EmailDeliveryModel.find as any).mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    mockGmailProvider = {
      listInboundMessages: vi.fn(),
      getMessage: vi.fn()
    };
    reconciliationService = new ReconciliationService(workspaceId, mockGmailProvider as any);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Section 14: Four-Message Mailbox Scenario Test
  // ──────────────────────────────────────────────────────────────────────────
  describe('Section 14: Mailbox 4-Case Scenario (A. Reply, B. DSN, C. Newsletter, D. Colleague)', () => {
    it('persists only relevant messages (A, B) and silently drops irrelevant messages (C, D)', async () => {
      // Setup connected account
      (EmailAccountModel.findOne as any).mockResolvedValue({
        _id: 'acc_123',
        workspaceId,
        email: accountEmail,
        connectionId: 'conn_123',
        lastInboundPollAt: new Date(Date.now() - 3600000)
      });
      (EmailAccountModel.updateOne as any).mockResolvedValue({});

      // Mailbox returns 4 messages from Gmail is:inbox
      mockGmailProvider.listInboundMessages.mockResolvedValue([
        { id: 'msg_reply_A', threadId: 'thread_outbound_A' },
        { id: 'msg_bounce_B', threadId: 'thread_bounce_B' },
        { id: 'msg_newsletter_C', threadId: 'thread_newsletter_C' },
        { id: 'msg_colleague_D', threadId: 'thread_colleague_D' }
      ]);

      // Message A: Valid cold-email reply
      const detailA = {
        id: 'msg_reply_A',
        threadId: 'thread_outbound_A',
        headers: {
          from: 'Prospect Alice <alice@prospect.com>',
          to: accountEmail,
          subject: 'Re: Quick question about growth',
          inReplyTo: '<leadforge-outbound-A@leadforge.ai>'
        },
        bodyText: 'Yes, I would love to schedule a demo tomorrow.',
        internalDate: new Date()
      };

      // Message B: Valid DSN bounce
      const detailB = {
        id: 'msg_bounce_B',
        threadId: 'thread_bounce_B',
        headers: {
          from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
          to: accountEmail,
          subject: 'Delivery Status Notification (Failure)'
        },
        bodyText: '550 5.1.1 The email account that you tried to reach does not exist. Final-Recipient: rfc822; deadend@target.com',
        internalDate: new Date()
      };

      // Message C: Newsletter from Substack
      const detailC = {
        id: 'msg_newsletter_C',
        threadId: 'thread_newsletter_C',
        headers: {
          from: 'Tech Weekly <digest@substack.com>',
          to: accountEmail,
          subject: 'Top AI Trends This Week'
        },
        bodyText: 'Check out the top engineering stories from our community.',
        internalDate: new Date()
      };

      // Message D: Personal email from colleague
      const detailD = {
        id: 'msg_colleague_D',
        threadId: 'thread_colleague_D',
        headers: {
          from: 'Bob Coworker <bob@internal.company>',
          to: accountEmail,
          subject: 'Lunch today?'
        },
        bodyText: 'Hey, are we grabbing tacos at 12:30?',
        internalDate: new Date()
      };

      mockGmailProvider.getMessage.mockImplementation(async (_connId: string, msgId: string) => {
        if (msgId === 'msg_reply_A') return detailA;
        if (msgId === 'msg_bounce_B') return detailB;
        if (msgId === 'msg_newsletter_C') return detailC;
        if (msgId === 'msg_colleague_D') return detailD;
        return null;
      });

      // Outbound delivery matching A
      const mockOutboundA = {
        _id: 'del_outbound_A',
        workspaceId,
        direction: 'OUTBOUND',
        status: 'SENT',
        providerThreadId: 'thread_outbound_A',
        providerMessageId: 'leadforge-outbound-A@leadforge.ai',
        recipientEmail: 'alice@prospect.com',
        contactId: 'contact_alice',
        campaignId: 'camp_growth',
        sequenceId: 'seq_1',
        executionId: 'exec_1'
      };

      // Outbound delivery matching B
      const mockOutboundB = {
        _id: 'del_outbound_B',
        workspaceId,
        direction: 'OUTBOUND',
        status: 'SENT',
        recipientEmail: 'deadend@target.com',
        contactId: 'contact_deadend',
        campaignId: 'camp_growth'
      };

      // Contact for A
      const mockContactA = {
        _id: 'contact_alice',
        workspaceId,
        email: 'alice@prospect.com',
        status: 'CONTACTED'
      };

      // Contact for B
      const mockContactB = {
        _id: 'contact_deadend',
        workspaceId,
        email: 'deadend@target.com',
        status: 'CONTACTED'
      };

      // Configure EmailDeliveryModel.findOne
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        // Idempotency checks: none ingested yet
        if (query.idempotencyKey) return Promise.resolve(null);

        // Case A lookup: thread match or header match
        if (query.providerThreadId === 'thread_outbound_A' && query.workspaceId === workspaceId) {
          return { sort: vi.fn().mockResolvedValue(mockOutboundA) };
        }
        if (query.recipientEmail === 'deadend@target.com' && query.workspaceId === workspaceId) {
          return { sort: vi.fn().mockResolvedValue(mockOutboundB) };
        }

        // Substack and colleague lookups return null
        return { sort: vi.fn().mockResolvedValue(null) };
      });

      // Configure ContactModel.findOne
      (ContactModel.findOne as any).mockImplementation((query: any) => {
        if (query._id === 'contact_alice') return Promise.resolve(mockContactA);
        if (query.$or?.some((item: any) => item.email === 'alice@prospect.com')) {
          return Promise.resolve(mockContactA);
        }
        if (query.$or?.some((item: any) => item.email === 'deadend@target.com')) {
          return Promise.resolve(mockContactB);
        }
        return Promise.resolve(null);
      });

      // Execute polling
      const result = await reconciliationService.pollInboundRepliesForAccount('acc_123');

      // 1. Discovered candidates: all 4 fetched from Gmail
      expect(result.discoveredCount).toBe(4);

      // 2. Processed candidates: only the 2 relevant messages (A & B) accepted
      expect(result.processedCount).toBe(2);
      expect(result.matchedCount).toBe(1);

      // 3. EmailDeliveryModel.create calls verification
      const createCalls = (EmailDeliveryModel.create as any).mock.calls;
      expect(createCalls).toHaveLength(2);

      // Verification of Message A: Valid reply accepted
      const createdReply = createCalls.find((call: any[]) => call[0].idempotencyKey === 'inbound_acc_123_msg_reply_A')?.[0];
      expect(createdReply).toBeDefined();
      expect(createdReply.direction).toBe('INBOUND');
      expect(createdReply.status).toBe('RECEIVED');
      expect(createdReply.processingStatus).toBe('MATCHED');
      expect(createdReply.matchedDeliveryId).toBe('del_outbound_A');
      expect(createdReply.senderEmail).toBe('alice@prospect.com');

      // Verification of Message B: DSN bounce accepted
      const createdBounce = createCalls.find((call: any[]) => call[0].idempotencyKey === 'inbound_acc_123_msg_bounce_B')?.[0];
      expect(createdBounce).toBeDefined();
      expect(createdBounce.direction).toBe('INBOUND');
      expect(createdBounce.status).toBe('RECEIVED');
      expect(createdBounce.processingStatus).toBe('MATCHED');
      expect(createdBounce.matchedDeliveryId).toBe('del_outbound_B');

      // Verification of Messages C & D: Dropped silently (0 operational records)
      const createdNewsletter = createCalls.find((call: any[]) => call[0].idempotencyKey === 'inbound_acc_123_msg_newsletter_C');
      const createdColleague = createCalls.find((call: any[]) => call[0].idempotencyKey === 'inbound_acc_123_msg_colleague_D');
      expect(createdNewsletter).toBeUndefined();
      expect(createdColleague).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Section 15: Required Behavioral Matrix
  // ──────────────────────────────────────────────────────────────────────────
  describe('Section 15: Behavioral Matrix Tests', () => {
    it('Relevance Rule 1 (DSN Bounce): Accepts DSN matching outbound delivery in workspace', async () => {
      const item = { id: 'dsn_msg_1', threadId: 'thread_dsn_1' };
      const detail = {
        headers: { from: 'mailer-daemon@google.com', subject: 'Undelivered Mail' },
        bodyText: 'Delivery failed: 550 5.1.1 User unknown. Final-Recipient: rfc822; target@prospect.com'
      };

      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query.recipientEmail === 'target@prospect.com' && query.workspaceId === workspaceId) {
          return { sort: vi.fn().mockResolvedValue({ _id: 'del_sent_1', recipientEmail: 'target@prospect.com' }) };
        }
        return { sort: vi.fn().mockResolvedValue(null) };
      });

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(true);
      expect(evalResult.reason).toBe('dsn_matched');
      expect(evalResult.bouncedDelivery).toBeDefined();
    });

    it('Relevance Rule 1 (DSN Bounce): Drops DSN with no matching outbound delivery in workspace', async () => {
      const item = { id: 'dsn_msg_unrelated', threadId: 'thread_dsn_unrelated' };
      const detail = {
        headers: { from: 'mailer-daemon@google.com', subject: 'Undelivered Mail' },
        bodyText: 'Delivery failed: 550 5.1.1 User unknown. Final-Recipient: rfc822; someone@elsewhere.com'
      };

      (EmailDeliveryModel.findOne as any).mockImplementation(() => ({
        sort: vi.fn().mockResolvedValue(null)
      }));

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(false);
      expect(evalResult.reason).toBe('irrelevant');
    });

    it('Relevance Rule 2 (Matching Gmail Thread): Accepts reply with matching providerThreadId', async () => {
      const item = { id: 'msg_thread_match', threadId: 'thread_xyz' };
      const detail = {
        headers: { from: 'client@domain.com', subject: 'Re: Follow up' },
        bodyText: 'Thanks for reaching out.'
      };

      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query.providerThreadId === 'thread_xyz' && query.workspaceId === workspaceId) {
          return { sort: vi.fn().mockResolvedValue({ _id: 'del_thread_matched', contactId: 'cnt_1' }) };
        }
        return { sort: vi.fn().mockResolvedValue(null) };
      });
      (ContactModel.findOne as any).mockResolvedValue({ _id: 'cnt_1', email: 'client@domain.com' });

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(true);
      expect(evalResult.reason).toBe('thread_matched');
    });

    it('Relevance Rule 3 (Message Headers): Accepts reply matching In-Reply-To header', async () => {
      const item = { id: 'msg_header_match', threadId: 'unknown_thread' };
      const detail = {
        headers: {
          from: 'lead@enterprise.com',
          subject: 'Re: Partnership',
          inReplyTo: '<provider-msg-777@leadforge.ai>'
        },
        bodyText: 'Lets chat on Monday.'
      };

      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query.$or?.some((x: any) => x.providerMessageId === 'provider-msg-777@leadforge.ai') && query.workspaceId === workspaceId) {
          return Promise.resolve({ _id: 'del_header_matched', contactId: 'cnt_2' });
        }
        return { sort: vi.fn().mockResolvedValue(null) };
      });
      (ContactModel.findOne as any).mockResolvedValue({ _id: 'cnt_2', email: 'lead@enterprise.com' });

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(true);
      expect(evalResult.reason).toBe('header_matched');
    });

    it('Relevance Rule 3 (Message Headers): Accepts reply matching References header', async () => {
      const item = { id: 'msg_refs_match', threadId: 'unknown_thread' };
      const detail = {
        headers: {
          from: 'lead@enterprise.com',
          subject: 'Re: Partnership',
          references: ['<root-id@leadforge.ai>', '<provider-msg-888@leadforge.ai>']
        },
        bodyText: 'Sounds good.'
      };

      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query.$or?.some((x: any) => x.providerMessageId === 'provider-msg-888@leadforge.ai') && query.workspaceId === workspaceId) {
          return Promise.resolve({ _id: 'del_refs_matched', contactId: 'cnt_3' });
        }
        return { sort: vi.fn().mockResolvedValue(null) };
      });
      (ContactModel.findOne as any).mockResolvedValue({ _id: 'cnt_3', email: 'lead@enterprise.com' });

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(true);
      expect(evalResult.reason).toBe('header_matched');
    });

    it('Relevance Rule 4 (Contact Address): Accepts reply when contact has qualifying SENT outbound delivery', async () => {
      const item = { id: 'msg_contact_match', threadId: 'new_thread' };
      const detail = {
        headers: { from: 'registered@contact.com', subject: 'Fresh message' },
        bodyText: 'Hi, I saw your email from yesterday.'
      };

      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query.contactId === 'cnt_active' && query.workspaceId === workspaceId) {
          return { sort: vi.fn().mockResolvedValue({ _id: 'del_contact_sent', status: 'SENT' }) };
        }
        return { sort: vi.fn().mockResolvedValue(null) };
      });
      (ContactModel.findOne as any).mockResolvedValue({ _id: 'cnt_active', email: 'registered@contact.com' });

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(true);
      expect(evalResult.reason).toBe('contact_matched');
    });

    it('Relevance Rule 4 (Contact Address): Drops message if contact exists in CRM but has NO qualifying outbound delivery', async () => {
      const item = { id: 'msg_crm_no_outreach', threadId: 'thread_none' };
      const detail = {
        headers: { from: 'stale@contact.com', subject: 'Unsolicited note' },
        bodyText: 'Hello'
      };

      (ContactModel.findOne as any).mockResolvedValue({ _id: 'cnt_stale', email: 'stale@contact.com' });
      // EmailDeliveryModel returns null for qualifying outbound (SENT / AMBIGUOUS / SENDING)
      (EmailDeliveryModel.findOne as any).mockImplementation(() => ({
        sort: vi.fn().mockResolvedValue(null)
      }));

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(false);
      expect(evalResult.reason).toBe('irrelevant');
    });

    it('Fast-Reply Safety Rule: Accepts fast reply when matching outbound delivery is SENDING', async () => {
      const item = { id: 'msg_fast_reply', threadId: 'thread_pending' };
      const detail = {
        headers: { from: 'fast@responder.com', subject: 'Re: Outbound in flight' },
        bodyText: 'Got it!'
      };

      const mockPendingSendingDelivery = {
        _id: 'del_outbound_sending',
        workspaceId,
        direction: 'OUTBOUND',
        status: 'SENDING',
        recipientEmail: 'fast@responder.com',
        contactId: 'cnt_fast'
      };

      (ContactModel.findOne as any).mockResolvedValue({ _id: 'cnt_fast', email: 'fast@responder.com' });
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        // Query for SENT / AMBIGUOUS returns null (since it is still SENDING)
        if (query.status?.$in) {
          return { sort: vi.fn().mockResolvedValue(null) };
        }
        // Query for SENDING matches
        if (query.status === 'SENDING' && query.workspaceId === workspaceId) {
          return { sort: vi.fn().mockResolvedValue(mockPendingSendingDelivery) };
        }
        return { sort: vi.fn().mockResolvedValue(null) };
      });

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(true);
      expect(evalResult.reason).toBe('fast_reply_pending');
      expect(evalResult.pendingSendingDelivery).toEqual(mockPendingSendingDelivery);
    });

    it('Fast-Reply Safety Rule: Drops message when no SENDING outbound delivery exists', async () => {
      const item = { id: 'msg_random_fast', threadId: 'thread_random' };
      const detail = {
        headers: { from: 'stranger@unknown.com', subject: 'Random email' },
        bodyText: 'Hey there'
      };

      (ContactModel.findOne as any).mockResolvedValue(null);
      (EmailDeliveryModel.findOne as any).mockImplementation(() => ({
        sort: vi.fn().mockResolvedValue(null)
      }));

      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(false);
      expect(evalResult.reason).toBe('irrelevant');
    });

    it('Unrelated emails: Drops newsletter, colleague, and personal email', async () => {
      (ContactModel.findOne as any).mockResolvedValue(null);
      (EmailDeliveryModel.findOne as any).mockImplementation(() => ({
        sort: vi.fn().mockResolvedValue(null)
      }));

      const newsletter = {
        item: { id: 'n1' },
        detail: { headers: { from: 'news@substack.com', subject: 'Daily Update' }, bodyText: 'Stories' }
      };
      const colleague = {
        item: { id: 'c1' },
        detail: { headers: { from: 'co-worker@mycompany.internal', subject: 'Project standup' }, bodyText: 'Meeting' }
      };
      const personal = {
        item: { id: 'p1' },
        detail: { headers: { from: 'family@gmail.com', subject: 'Weekend plans' }, bodyText: 'Dinner Sunday?' }
      };

      const evalN = await reconciliationService.evaluateInboundRelevance(newsletter.item, newsletter.detail, accountEmail);
      const evalC = await reconciliationService.evaluateInboundRelevance(colleague.item, colleague.detail, accountEmail);
      const evalP = await reconciliationService.evaluateInboundRelevance(personal.item, personal.detail, accountEmail);

      expect(evalN.isRelevant).toBe(false);
      expect(evalC.isRelevant).toBe(false);
      expect(evalP.isRelevant).toBe(false);
    });

    it('Self-sent email: Evaluates to self_sent and is not relevant', async () => {
      const selfItem = { id: 'self_1' };
      const selfDetail = {
        headers: { from: accountEmail, subject: 'Note to self' },
        bodyText: 'Remember to check reports'
      };

      const evalSelf = await reconciliationService.evaluateInboundRelevance(selfItem, selfDetail, accountEmail);
      expect(evalSelf.isRelevant).toBe(false);
      expect(evalSelf.reason).toBe('self_sent');
    });

    it('Workspace Isolation: Inbound message matching outbound delivery in another workspace is DROPPED in current workspace', async () => {
      const otherWorkspaceId = 'ws_different_tenant';
      const item = { id: 'msg_cross_ws', threadId: 'thread_cross_ws' };
      const detail = {
        headers: { from: 'prospect@external.com', subject: 'Re: Hello' },
        bodyText: 'I agree.'
      };

      // Only returns delivery if query.workspaceId === otherWorkspaceId
      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query.workspaceId === otherWorkspaceId) {
          return { sort: vi.fn().mockResolvedValue({ _id: 'del_other_ws', workspaceId: otherWorkspaceId }) };
        }
        // In current workspace, findOne returns null
        return { sort: vi.fn().mockResolvedValue(null) };
      });
      (ContactModel.findOne as any).mockResolvedValue(null);

      // Evaluate within current workspace (workspaceId = 'ws_phase2_test')
      const evalResult = await reconciliationService.evaluateInboundRelevance(item, detail, accountEmail);
      expect(evalResult.isRelevant).toBe(false);
      expect(evalResult.reason).toBe('irrelevant');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fast Reply Integration in Polling
  // ──────────────────────────────────────────────────────────────────────────
  describe('Fast Reply Ingestion in Polling Pipeline', () => {
    it('persists fast reply as INBOUND, RECEIVED, CORRELATION_PENDING when outbound is SENDING', async () => {
      (EmailAccountModel.findOne as any).mockResolvedValue({
        _id: 'acc_fast',
        workspaceId,
        email: accountEmail,
        connectionId: 'conn_fast',
        lastInboundPollAt: new Date(Date.now() - 3600000)
      });
      (EmailAccountModel.updateOne as any).mockResolvedValue({});

      mockGmailProvider.listInboundMessages.mockResolvedValue([
        { id: 'fast_msg_1', threadId: 'thread_fast_1' }
      ]);

      mockGmailProvider.getMessage.mockResolvedValue({
        id: 'fast_msg_1',
        threadId: 'thread_fast_1',
        headers: {
          from: 'rapid@responder.com',
          to: accountEmail,
          subject: 'Re: Quick offer'
        },
        bodyText: 'Count me in!',
        internalDate: new Date()
      });

      const mockSendingDelivery = {
        _id: 'del_sending_1',
        workspaceId,
        direction: 'OUTBOUND',
        status: 'SENDING',
        recipientEmail: 'rapid@responder.com',
        contactId: 'cnt_rapid',
        campaignId: 'camp_fast',
        sequenceId: 'seq_fast',
        executionId: 'exec_fast'
      };

      (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
        if (query.idempotencyKey) return Promise.resolve(null);
        if (query.status === 'SENDING' && query.workspaceId === workspaceId) {
          return { sort: vi.fn().mockResolvedValue(mockSendingDelivery) };
        }
        return { sort: vi.fn().mockResolvedValue(null) };
      });
      (ContactModel.findOne as any).mockResolvedValue({
        _id: 'cnt_rapid',
        email: 'rapid@responder.com',
        workspaceId
      });

      const result = await reconciliationService.pollInboundRepliesForAccount('acc_fast');

      expect(result.discoveredCount).toBe(1);
      expect(result.processedCount).toBe(1);
      expect(result.unmatchedCount).toBe(1);

      expect(EmailDeliveryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          direction: 'INBOUND',
          status: 'RECEIVED',
          processingStatus: 'CORRELATION_PENDING',
          senderEmail: 'rapid@responder.com',
          recipientEmail: accountEmail,
          matchedDeliveryId: null
        })
      );
    });
  });
});
