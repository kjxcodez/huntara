import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconciliationService } from './reconciliation.service.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { EmailEventRepository } from '../../repositories/email-event/email-event.repository.js';
import { SuppressionRepository } from '../../repositories/suppression/suppression.repository.js';
import {
  EmailFailureCategory,
  BounceCategory,
  SuppressionReason,
  ContactStatus,
  ContactEmailStatus,
  EmailEventType
} from '@leadforge/schema';

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

const mockRecordEvent = vi.fn().mockResolvedValue({});
vi.mock('../../repositories/email-event/email-event.repository.js', () => ({
  EmailEventRepository: class {
    recordEvent = mockRecordEvent;
  }
}));

const mockSuppress = vi.fn().mockResolvedValue({});
vi.mock('../../repositories/suppression/suppression.repository.js', () => ({
  SuppressionRepository: class {
    suppress = mockSuppress;
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

describe('fix(email): preserve DSN failure classification during reconciliation (Issue #34)', () => {
  const workspaceId = 'ws_issue_34_test';
  const accountEmail = 'sender@leadforge.ai';
  const accountId = 'acc_issue_34';
  let reconciliationService: ReconciliationService;
  let mockGmailProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordEvent.mockClear();
    mockSuppress.mockClear();

    mockGmailProvider = {
      listInboundMessages: vi.fn(),
      getMessage: vi.fn()
    };
    reconciliationService = new ReconciliationService(workspaceId, mockGmailProvider as any);

    (EmailAccountModel.findOne as any).mockResolvedValue({
      _id: accountId,
      workspaceId,
      email: accountEmail,
      connectionId: 'conn_test',
      lastInboundPollAt: new Date(Date.now() - 3600000)
    });
    (EmailAccountModel.updateOne as any).mockResolvedValue({});
  });

  function setupOutboundDelivery(recipientEmail: string, threadId = 'thread_outbound_1', deliveryId = 'del_outbound_1') {
    const outboundDelivery = {
      _id: deliveryId,
      workspaceId,
      direction: 'OUTBOUND',
      status: 'SENT',
      recipientEmail,
      senderEmail: accountEmail,
      providerThreadId: threadId,
      providerMessageId: 'outbound-msg-id-123',
      contactId: 'contact_target_1',
      campaignId: 'camp_1',
      sequenceId: 'seq_1',
      executionId: 'exec_1',
      stepIndex: 1
    };

    (EmailDeliveryModel.findOne as any).mockImplementation((query: any) => {
      if (query.idempotencyKey) {
        return Promise.resolve(null); // Not yet ingested
      }
      if (query.direction === 'OUTBOUND') {
        if (query.providerThreadId === threadId || query.recipientEmail === recipientEmail.toLowerCase().trim()) {
          return {
            sort: vi.fn().mockResolvedValue(outboundDelivery)
          };
        }
      }
      return { sort: vi.fn().mockResolvedValue(null) };
    });

    return outboundDelivery;
  }

  function setupContact(email: string, contactId = 'contact_target_1') {
    const contact = {
      _id: contactId,
      workspaceId,
      email,
      status: ContactStatus.CONTACTED,
      emailStatus: ContactEmailStatus.VALID
    };

    (ContactModel.findOne as any).mockResolvedValue(contact);
    return contact;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test Case 1: Hard Recipient Failure (User Unknown 550 5.1.1)
  // ──────────────────────────────────────────────────────────────────────────
  it('preserves MAILBOX_UNAVAILABLE and maps to INVALID_RECIPIENT for 550 5.1.1 User unknown', async () => {
    const recipient = 'unknown.user@company.com';
    const outbound = setupOutboundDelivery(recipient, 'thread_hard_bounce');
    setupContact(recipient);

    const dsnMsg = {
      id: 'msg_dsn_hard_bounce',
      threadId: 'thread_hard_bounce'
    };
    mockGmailProvider.listInboundMessages.mockResolvedValue([dsnMsg]);
    mockGmailProvider.getMessage.mockResolvedValue({
      id: 'msg_dsn_hard_bounce',
      threadId: 'thread_hard_bounce',
      headers: {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        to: accountEmail,
        subject: 'Delivery Status Notification (Failure)'
      },
      bodyText: `
** Address not found **
Your message wasn't delivered to unknown.user@company.com because the address couldn't be found.
Final-Recipient: rfc822; unknown.user@company.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.
      `,
      internalDate: new Date()
    });

    const result = await reconciliationService.pollInboundRepliesForAccount(accountId);
    expect(result.processedCount).toBe(1);

    // Verify delivery updated with preserved classification
    expect(EmailDeliveryModel.updateOne).toHaveBeenCalledWith(
      { _id: outbound._id },
      {
        $set: {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.INVALID_RECIPIENT,
          failureClassification: BounceCategory.MAILBOX_UNAVAILABLE,
          failureCode: '5.1.1',
          safeHumanMessage: expect.stringContaining('Recipient mailbox does not exist'),
          technicalMessage: expect.stringContaining('550-5.1.1'),
          retryable: false,
          error: expect.stringContaining('Recipient mailbox does not exist')
        }
      }
    );

    // Verify hard bounce triggers suppression
    expect(mockSuppress).toHaveBeenCalledWith(
      recipient,
      SuppressionReason.HARD_BOUNCE,
      'inbound_dsn_bounce',
      expect.objectContaining({
        dsnMessageId: 'msg_dsn_hard_bounce',
        enhancedStatusCode: '5.1.1'
      })
    );

    // Verify contact marked bounced
    expect(ContactModel.updateOne).toHaveBeenCalledWith(
      { _id: 'contact_target_1', workspaceId },
      {
        $set: {
          status: ContactStatus.BOUNCED,
          emailStatus: ContactEmailStatus.INVALID
        }
      }
    );

    // Verify immutable BOUNCED event
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EmailEventType.BOUNCED,
        metadata: expect.objectContaining({
          category: BounceCategory.MAILBOX_UNAVAILABLE,
          enhancedStatusCode: '5.1.1'
        })
      })
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test Case 2: Hard Domain Failure (Domain Unavailable 550 5.1.2)
  // ──────────────────────────────────────────────────────────────────────────
  it('preserves DOMAIN_UNAVAILABLE and maps to INVALID_RECIPIENT for 550 5.1.2 Host/domain not found', async () => {
    const recipient = 'user@dead-domain-xyz123.org';
    const outbound = setupOutboundDelivery(recipient, 'thread_domain_bounce');
    setupContact(recipient);

    const dsnMsg = {
      id: 'msg_dsn_domain_bounce',
      threadId: 'thread_domain_bounce'
    };
    mockGmailProvider.listInboundMessages.mockResolvedValue([dsnMsg]);
    mockGmailProvider.getMessage.mockResolvedValue({
      id: 'msg_dsn_domain_bounce',
      threadId: 'thread_domain_bounce',
      headers: {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        to: accountEmail,
        subject: 'Delivery Status Notification (Failure)'
      },
      bodyText: `
Final-Recipient: rfc822; user@dead-domain-xyz123.org
Action: failed
Status: 5.1.2
Diagnostic-Code: smtp; 550 5.1.2 Host or domain name not found. Name service error for name=dead-domain-xyz123.org type=MX: Host not found
      `,
      internalDate: new Date()
    });

    const result = await reconciliationService.pollInboundRepliesForAccount(accountId);
    expect(result.processedCount).toBe(1);

    expect(EmailDeliveryModel.updateOne).toHaveBeenCalledWith(
      { _id: outbound._id },
      {
        $set: {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.INVALID_RECIPIENT,
          failureClassification: BounceCategory.DOMAIN_UNAVAILABLE,
          failureCode: '5.1.2',
          safeHumanMessage: expect.stringContaining('Destination domain does not exist'),
          technicalMessage: expect.stringContaining('550 5.1.2'),
          retryable: false,
          error: expect.stringContaining('Destination domain does not exist')
        }
      }
    );

    expect(mockSuppress).toHaveBeenCalledWith(
      recipient,
      SuppressionReason.HARD_BOUNCE,
      'inbound_dsn_bounce',
      expect.anything()
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test Case 3: Temporary / Mailbox Full Failure (Soft Bounce 452 4.2.2)
  // ──────────────────────────────────────────────────────────────────────────
  it('preserves SOFT_BOUNCE and maps to PROVIDER (not INVALID_RECIPIENT) for 452 4.2.2 Mailbox full', async () => {
    const recipient = 'busy.executive@corp.com';
    const outbound = setupOutboundDelivery(recipient, 'thread_soft_bounce');
    setupContact(recipient);

    const dsnMsg = {
      id: 'msg_dsn_soft_bounce',
      threadId: 'thread_soft_bounce'
    };
    mockGmailProvider.listInboundMessages.mockResolvedValue([dsnMsg]);
    mockGmailProvider.getMessage.mockResolvedValue({
      id: 'msg_dsn_soft_bounce',
      threadId: 'thread_soft_bounce',
      headers: {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        to: accountEmail,
        subject: 'Delivery Status Notification (Delay)'
      },
      bodyText: `
Final-Recipient: rfc822; busy.executive@corp.com
Action: failed
Status: 4.2.2
Diagnostic-Code: smtp; 452 4.2.2 The email account that you tried to reach is over quota. Mailbox full.
      `,
      internalDate: new Date()
    });

    const result = await reconciliationService.pollInboundRepliesForAccount(accountId);
    expect(result.processedCount).toBe(1);

    // CRITICAL ASSERTION: INVALID_RECIPIENT must NOT be substituted!
    expect(EmailDeliveryModel.updateOne).toHaveBeenCalledWith(
      { _id: outbound._id },
      {
        $set: {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.PROVIDER,
          failureClassification: BounceCategory.SOFT_BOUNCE,
          failureCode: '4.2.2',
          safeHumanMessage: expect.stringContaining('Recipient mailbox is full'),
          technicalMessage: expect.stringContaining('452 4.2.2'),
          retryable: true,
          error: expect.stringContaining('Recipient mailbox is full')
        }
      }
    );

    // Soft bounce must NOT trigger permanent contact suppression!
    expect(mockSuppress).not.toHaveBeenCalled();
    expect(ContactModel.updateOne).not.toHaveBeenCalled();

    // Event metadata must record SOFT_BOUNCE
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EmailEventType.BOUNCED,
        metadata: expect.objectContaining({
          category: BounceCategory.SOFT_BOUNCE,
          enhancedStatusCode: '4.2.2'
        })
      })
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test Case 4: Policy / Spam Rejection (554 5.7.1 Spamhaus / Reputation)
  // ──────────────────────────────────────────────────────────────────────────
  it('preserves SPAM_REJECTION and maps to POLICY (not INVALID_RECIPIENT) for 554 5.7.1 Spamhaus block', async () => {
    const recipient = 'prospect@enterprise.com';
    const outbound = setupOutboundDelivery(recipient, 'thread_spam_bounce');
    setupContact(recipient);

    const dsnMsg = {
      id: 'msg_dsn_spam_bounce',
      threadId: 'thread_spam_bounce'
    };
    mockGmailProvider.listInboundMessages.mockResolvedValue([dsnMsg]);
    mockGmailProvider.getMessage.mockResolvedValue({
      id: 'msg_dsn_spam_bounce',
      threadId: 'thread_spam_bounce',
      headers: {
        from: 'postmaster@enterprise.com',
        to: accountEmail,
        subject: 'Mail delivery failed: returning message to sender'
      },
      bodyText: `
The following address failed: prospect@enterprise.com
Diagnostic-Code: smtp; 554 5.7.1 Service unavailable; Client host [1.2.3.4] blocked by Spamhaus; spam detected
Final-Recipient: rfc822; prospect@enterprise.com
Status: 5.7.1
      `,
      internalDate: new Date()
    });

    const result = await reconciliationService.pollInboundRepliesForAccount(accountId);
    expect(result.processedCount).toBe(1);

    // CRITICAL ASSERTION: INVALID_RECIPIENT must NOT be substituted!
    expect(EmailDeliveryModel.updateOne).toHaveBeenCalledWith(
      { _id: outbound._id },
      {
        $set: {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.POLICY,
          failureClassification: BounceCategory.SPAM_REJECTION,
          failureCode: '5.7.1',
          safeHumanMessage: expect.stringContaining('spam filtering or IP reputation'),
          technicalMessage: expect.stringContaining('554 5.7.1'),
          retryable: false,
          error: expect.stringContaining('spam filtering or IP reputation')
        }
      }
    );

    // Spam/reputation rejection is not a hard recipient address defect; must not trigger address suppression
    expect(mockSuppress).not.toHaveBeenCalled();
    expect(ContactModel.updateOne).not.toHaveBeenCalled();

    // Event metadata must record SPAM_REJECTION
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EmailEventType.BOUNCED,
        metadata: expect.objectContaining({
          category: BounceCategory.SPAM_REJECTION,
          enhancedStatusCode: '5.7.1'
        })
      })
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test Case 5: Policy / Authentication Rejection (550 5.7.26 SPF/DKIM/DMARC)
  // ──────────────────────────────────────────────────────────────────────────
  it('preserves POLICY_REJECTION and maps to POLICY for 550 5.7.26 DMARC rejection', async () => {
    const recipient = 'lead@secure-gov.com';
    const outbound = setupOutboundDelivery(recipient, 'thread_auth_bounce');
    setupContact(recipient);

    const dsnMsg = {
      id: 'msg_dsn_auth_bounce',
      threadId: 'thread_auth_bounce'
    };
    mockGmailProvider.listInboundMessages.mockResolvedValue([dsnMsg]);
    mockGmailProvider.getMessage.mockResolvedValue({
      id: 'msg_dsn_auth_bounce',
      threadId: 'thread_auth_bounce',
      headers: {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        to: accountEmail,
        subject: 'Delivery Status Notification (Failure)'
      },
      bodyText: `
Final-Recipient: rfc822; lead@secure-gov.com
Action: failed
Status: 5.7.26
Diagnostic-Code: smtp; 550 5.7.26 This message does not pass authentication checks (SPF/DKIM/DMARC). Policy rejection.
      `,
      internalDate: new Date()
    });

    const result = await reconciliationService.pollInboundRepliesForAccount(accountId);
    expect(result.processedCount).toBe(1);

    expect(EmailDeliveryModel.updateOne).toHaveBeenCalledWith(
      { _id: outbound._id },
      {
        $set: {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.POLICY,
          failureClassification: BounceCategory.POLICY_REJECTION,
          failureCode: '5.7.26',
          safeHumanMessage: expect.stringContaining('security or authentication policy'),
          technicalMessage: expect.stringContaining('550 5.7.26'),
          retryable: false,
          error: expect.stringContaining('security or authentication policy')
        }
      }
    );

    expect(mockSuppress).not.toHaveBeenCalled();
    expect(ContactModel.updateOne).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test Case 6: Rate Limiting Temporary Failure (421 4.7.0 Rate Limit)
  // ──────────────────────────────────────────────────────────────────────────
  it('preserves RATE_LIMIT and maps to RATE_LIMIT for 421 Rate limit exceeded', async () => {
    const recipient = 'prospect@high-volume.com';
    const outbound = setupOutboundDelivery(recipient, 'thread_rate_bounce');
    setupContact(recipient);

    const dsnMsg = {
      id: 'msg_dsn_rate_bounce',
      threadId: 'thread_rate_bounce'
    };
    mockGmailProvider.listInboundMessages.mockResolvedValue([dsnMsg]);
    mockGmailProvider.getMessage.mockResolvedValue({
      id: 'msg_dsn_rate_bounce',
      threadId: 'thread_rate_bounce',
      headers: {
        from: 'mailer-daemon@high-volume.com',
        to: accountEmail,
        subject: 'Delivery Status Notification'
      },
      bodyText: `
Final-Recipient: rfc822; prospect@high-volume.com
Status: 421
Diagnostic-Code: smtp; 421 4.7.0 Try again later, closing connection. Rate limit exceeded. Too many connections.
      `,
      internalDate: new Date()
    });

    const result = await reconciliationService.pollInboundRepliesForAccount(accountId);
    expect(result.processedCount).toBe(1);

    expect(EmailDeliveryModel.updateOne).toHaveBeenCalledWith(
      { _id: outbound._id },
      {
        $set: {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.RATE_LIMIT,
          failureClassification: BounceCategory.RATE_LIMIT,
          failureCode: '4.7.0',
          safeHumanMessage: expect.stringContaining('Temporary sending rate limit exceeded'),
          technicalMessage: expect.stringContaining('421'),
          retryable: true,
          error: expect.stringContaining('Temporary sending rate limit exceeded')
        }
      }
    );

    expect(mockSuppress).not.toHaveBeenCalled();
    expect(ContactModel.updateOne).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test Case 7: Irrelevant DSN (no matching outbound delivery in workspace)
  // ──────────────────────────────────────────────────────────────────────────
  it('drops DSN with no matching LeadForge outbound delivery without updating any records', async () => {
    const dsnMsg = {
      id: 'msg_unrelated_dsn',
      threadId: 'thread_unrelated'
    };
    mockGmailProvider.listInboundMessages.mockResolvedValue([dsnMsg]);
    mockGmailProvider.getMessage.mockResolvedValue({
      id: 'msg_unrelated_dsn',
      threadId: 'thread_unrelated',
      headers: {
        from: 'mailer-daemon@google.com',
        to: accountEmail,
        subject: 'Delivery Status Notification (Failure)'
      },
      bodyText: `
Final-Recipient: rfc822; someone-else@unrelated-external.com
Diagnostic-Code: smtp; 550 5.1.1 User unknown
      `,
      internalDate: new Date()
    });

    // No delivery found for this recipient
    (EmailDeliveryModel.findOne as any).mockImplementation(() => ({
      sort: vi.fn().mockResolvedValue(null)
    }));

    const result = await reconciliationService.pollInboundRepliesForAccount(accountId);
    expect(result.processedCount).toBe(0);
    expect(EmailDeliveryModel.updateOne).not.toHaveBeenCalled();
    expect(EmailDeliveryModel.create).not.toHaveBeenCalled();
    expect(mockSuppress).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test Case 8: Inbound DSN Ledger Persistence
  // ──────────────────────────────────────────────────────────────────────────
  it('persists inbound DSN message with MATCHED status and matchedDeliveryId link', async () => {
    const recipient = 'bounced@target.com';
    const outbound = setupOutboundDelivery(recipient, 'thread_ledger_test');
    setupContact(recipient);

    const dsnMsg = {
      id: 'msg_dsn_ledger_1',
      threadId: 'thread_ledger_test'
    };
    mockGmailProvider.listInboundMessages.mockResolvedValue([dsnMsg]);
    mockGmailProvider.getMessage.mockResolvedValue({
      id: 'msg_dsn_ledger_1',
      threadId: 'thread_ledger_test',
      headers: {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        to: accountEmail,
        subject: 'Delivery Status Notification (Failure)'
      },
      bodyText: '550 5.1.1 User unknown. Final-Recipient: rfc822; bounced@target.com',
      bodyHtml: '<p>550 5.1.1 User unknown.</p>',
      internalDate: new Date('2026-09-10T02:00:00Z')
    });

    await reconciliationService.pollInboundRepliesForAccount(accountId);

    expect(EmailDeliveryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        idempotencyKey: `inbound_${accountId}_msg_dsn_ledger_1`,
        matchedDeliveryId: outbound._id,
        processingStatus: 'MATCHED',
        matchConfidence: 'thread',
        recipientEmail: accountEmail,
        provider: 'gmail',
        providerMessageId: 'msg_dsn_ledger_1',
        providerThreadId: 'thread_ledger_test'
      })
    );
  });
});
