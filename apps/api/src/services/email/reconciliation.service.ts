import { EmailDeliveryModel, type EmailDeliveryDocument } from '../../db/models/email-delivery.model.js';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { EmailEventRepository } from '../../repositories/email-event/email-event.repository.js';
import { EmailAccountRepository } from '../../repositories/email-account/email-account.repository.js';
import { EmailAccountService } from './email-account.service.js';
import { GoogleAuthService } from '../google/auth.service.js';
import { GmailProvider } from '../google/gmail.provider.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../errors/index.js';
import {
  ContactStatus,
  ContactEmailStatus,
  EmailEventType,
  EmailFailureCategory,
  SuppressionReason,
  canTransitionContactStatus,
  generateEntityId,
  parseDsnReport,
  mapBounceCategoryToFailureCategory,
  sanitizeHtmlForPreview,
  isCircuitBreakerRejectionCategory
} from '@huntara/schema';
import { CampaignCircuitBreakerService } from '../campaign/campaign-circuit-breaker.service.js';
import { SuppressionRepository } from '../../repositories/suppression/suppression.repository.js';
import { EmailDomainError } from './types.js';
import { logger } from '../../config/index.js';

export interface ReconciliationResult {
  deliveryId: string;
  previousStatus: string;
  resolvedStatus: 'SENT' | 'FAILED' | 'AMBIGUOUS';
  matchedMessageId?: string | undefined;
  matchedThreadId?: string | undefined;
  notes: string;
}

export interface InboundPollResult {
  accountId: string;
  discoveredCount: number;
  processedCount: number;
  matchedCount: number;
  unmatchedCount: number;
  suppressedExecutionsCount: number;
}

export interface InboundRelevanceEvaluation {
  isRelevant: boolean;
  reason:
    | 'dsn_matched'
    | 'thread_matched'
    | 'header_matched'
    | 'contact_matched'
    | 'fast_reply_pending'
    | 'irrelevant'
    | 'self_sent';
  bouncedDelivery?: EmailDeliveryDocument | null;
  dsnReport?: ReturnType<typeof parseDsnReport>;
  matchedDelivery?: EmailDeliveryDocument | null;
  matchConfidence?: 'thread' | 'header' | 'contact' | 'none';
  contactDoc?: any;
  pendingSendingDelivery?: EmailDeliveryDocument | null;
  normalizedFrom: string;
}

export class ReconciliationService {
  private readonly accounts: EmailAccountService;
  private readonly accountRepo: EmailAccountRepository;
  private readonly gmailProvider: GmailProvider;

  constructor(
    private readonly workspaceId: string,
    gmailProvider?: GmailProvider
  ) {
    this.accounts = new EmailAccountService(workspaceId);
    this.accountRepo = new EmailAccountRepository(workspaceId);
    this.gmailProvider = gmailProvider || new GmailProvider(new GoogleAuthService());
  }

  /**
   * Reconciles an individual AMBIGUOUS delivery record against Gmail.
   * Atomically acquires a reconciliation lease to prevent concurrent worker execution.
   */
  public async reconcileAmbiguousDelivery(deliveryId: string): Promise<ReconciliationResult> {
    const now = new Date();

    // 1. Atomic lease acquisition using $and to wrap multiple $or clauses
    const delivery = await EmailDeliveryModel.findOneAndUpdate(
      {
        _id: deliveryId,
        workspaceId: this.workspaceId,
        status: 'AMBIGUOUS',
        $and: [
          {
            $or: [
              { reconciliationLeaseExpiresAt: null },
              { reconciliationLeaseExpiresAt: { $lt: now } }
            ]
          },
          {
            $or: [
              { nextReconciliationAt: null },
              { nextReconciliationAt: { $lte: now } }
            ]
          }
        ]
      },
      {
        $set: {
          reconciliationLeaseExpiresAt: new Date(now.getTime() + 60000) // 1-minute lease
        },
        $inc: { reconciliationAttempts: 1 }
      },
      { new: true }
    );

    if (!delivery) {
      return {
        deliveryId,
        previousStatus: 'UNKNOWN',
        resolvedStatus: 'AMBIGUOUS',
        notes: 'Delivery could not be claimed: currently leased by another worker or not eligible for reconciliation.'
      };
    }

    try {
      const account = await EmailAccountModel.findOne({
        _id: delivery.accountId,
        workspaceId: this.workspaceId
      });

      const connectionId = account?.connectionId || account?.googleConnectionId;
      if (!account || !connectionId) {
        // Mailbox deleted or lacks Google connection
        await EmailDeliveryModel.updateOne(
          { _id: delivery._id },
          {
            $set: {
              reconciliationLeaseExpiresAt: null,
              reconciliationNotes: 'Reconciliation deferred: Mailbox connection missing or unlinked.'
            }
          }
        );
        return {
          deliveryId,
          previousStatus: delivery.status,
          resolvedStatus: 'AMBIGUOUS',
          notes: 'Sending mailbox connection missing'
        };
      }

      const attemptTime = delivery.sentAt?.getTime() || delivery.createdAt.getTime();
      const attemptAgeMs = Date.now() - attemptTime;
      const afterTimestampSec = Math.max(0, Math.floor(attemptTime / 1000) - 180); // 3 mins before send
      const beforeTimestampSec = Math.floor(attemptTime / 1000) + 1200; // 20 mins after send

      logger.info(
        {
          deliveryId: delivery._id.toString(),
          recipient: delivery.recipientEmail,
          sender: delivery.senderEmail,
          subject: delivery.subject
        },
        'Reconciliation worker querying Gmail sent folder'
      );

      // Search Gmail with collision-resistant query: in:sent to:recipient from:sender subject:"exact subject"
      const candidates = await this.gmailProvider.searchSentMessages(connectionId, {
        recipientEmail: delivery.recipientEmail,
        senderEmail: delivery.senderEmail,
        subject: delivery.subject,
        afterTimestampSec,
        beforeTimestampSec
      });

      // Filter and correlate candidates
      const validMatches: Array<{ id: string; threadId: string; date: Date }> = [];
      const normRecipient = (delivery.recipientEmail || '').toLowerCase().trim();
      const normSender = (delivery.senderEmail || '').toLowerCase().trim();
      const normSubject = (delivery.subject || '').toLowerCase().trim();

      for (const cand of candidates) {
        const detail = await this.gmailProvider.getMessage(connectionId, cand.id).catch(() => null);
        if (!detail) continue;

        const toMatch = (detail.headers.to || '').toLowerCase().includes(normRecipient);
        const fromMatch = (detail.headers.from || '').toLowerCase().includes(normSender);
        const subMatch = (detail.headers.subject || '').toLowerCase().trim() === normSubject;

        if (toMatch && fromMatch && subMatch) {
          // Verify this Gmail messageId is NOT already assigned to a DIFFERENT delivery in this workspace
          const alreadyClaimed = await EmailDeliveryModel.findOne({
            workspaceId: this.workspaceId,
            providerMessageId: cand.id,
            _id: { $ne: delivery._id }
          });

          if (!alreadyClaimed) {
            validMatches.push({
              id: cand.id,
              threadId: cand.threadId || detail.threadId,
              date: detail.internalDate || new Date()
            });
          }
        }
      }

      // Case A: Exactly ONE verified matching message found in Gmail sent folder
      if (validMatches.length === 1) {
        const match = validMatches[0]!;
        await EmailDeliveryModel.updateOne(
          { _id: delivery._id },
          {
            $set: {
              status: 'SENT',
              providerMessageId: match.id,
              providerThreadId: match.threadId,
              sentAt: match.date,
              reconciledAt: new Date(),
              reconciliationNotes: 'Reconciled: matching sent message verified in Gmail sent folder.',
              reconciliationLeaseExpiresAt: null
            }
          }
        );

        // Update contact state to CONTACTED (only if eligible)
        if (delivery.contactId && delivery.contactId !== 'direct-contact') {
          await ContactModel.updateOne(
            {
              _id: delivery.contactId,
              workspaceId: this.workspaceId,
              status: { $nin: ['UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'ARCHIVED', 'REPLIED'] }
            } as any,
            {
              $set: {
                status: ContactStatus.CONTACTED,
                lastContactedAt: match.date
              }
            }
          );
        }

        logger.info(
          {
            deliveryId: delivery._id.toString(),
            providerMessageId: match.id,
            providerThreadId: match.threadId
          },
          'Reconciled ambiguous send to SENT'
        );

        return {
          deliveryId,
          previousStatus: 'AMBIGUOUS',
          resolvedStatus: 'SENT',
          matchedMessageId: match.id,
          matchedThreadId: match.threadId,
          notes: 'Message confirmed in Gmail sent folder.'
        };
      }

      // Case B: No matching messages found in Gmail
      if (validMatches.length === 0) {
        const maxAttempts = 3;
        const maxAgeMs = 15 * 60 * 1000; // 15 minutes
        const currentAttempts = delivery.reconciliationAttempts || 1;

        if (currentAttempts < maxAttempts && attemptAgeMs < maxAgeMs) {
          // Bounded retry: Provider indexing might be delayed, keep AMBIGUOUS and retry in 2 minutes
          const nextRetry = new Date(Date.now() + 120000);
          await EmailDeliveryModel.updateOne(
            { _id: delivery._id },
            {
              $set: {
                nextReconciliationAt: nextRetry,
                reconciliationLeaseExpiresAt: null,
                reconciliationNotes: `Attempt ${currentAttempts}/${maxAttempts}: message not yet indexed by Gmail. Retrying at ${nextRetry.toISOString()}.`
              }
            }
          );

          return {
            deliveryId,
            previousStatus: 'AMBIGUOUS',
            resolvedStatus: 'AMBIGUOUS',
            notes: `Message not found yet. Scheduled retry #${currentAttempts + 1}.`
          };
        } else {
          // Definitively absent: After max attempts or > 15 mins without appearing in Gmail sent folder, conclude send failed
          await EmailDeliveryModel.updateOne(
            { _id: delivery._id },
            {
              $set: {
                status: 'FAILED',
                failureClassification: 'reconciliation_verified_unsent',
                failureCode: 'SEND_VERIFIED_ABSENT',
                failureCategory: EmailFailureCategory.PROVIDER,
                safeHumanMessage: 'Message was verified absent from Gmail sent folder after network timeout.',
                technicalMessage: `Reconciliation verified message was not accepted by Gmail after ${currentAttempts} checks over ${Math.round(attemptAgeMs / 1000)}s.`,
                reconciledAt: new Date(),
                reconciliationNotes: 'Reconciliation concluded send failed: message was never dispatched.',
                reconciliationLeaseExpiresAt: null
              }
            }
          );

          // Release the provisional sending slot quota
          await this.accountRepo.releaseSendSlot(delivery.accountId);

          logger.warn(
            {
              deliveryId: delivery._id.toString(),
              attempts: currentAttempts,
              attemptAgeSec: Math.round(attemptAgeMs / 1000)
            },
            'Reconciled ambiguous send to FAILED (verified absent, quota released)'
          );

          return {
            deliveryId,
            previousStatus: 'AMBIGUOUS',
            resolvedStatus: 'FAILED',
            notes: 'Verified absent from Gmail sent folder. Marked FAILED and quota released.'
          };
        }
      }

      // Case C: Multiple matching candidates found (collision ambiguity)
      await EmailDeliveryModel.updateOne(
        { _id: delivery._id },
        {
          $set: {
            reconciliationLeaseExpiresAt: null,
            nextReconciliationAt: new Date(Date.now() + 300000), // Backoff 5 mins
            reconciliationNotes: `Ambiguous collision: found ${validMatches.length} matching sent messages in Gmail. Requires manual review.`
          }
        }
      );

      logger.warn(
        { deliveryId: delivery._id.toString(), candidateCount: validMatches.length },
        'Ambiguous collision during reconciliation: multiple candidates matched'
      );

      return {
        deliveryId,
        previousStatus: 'AMBIGUOUS',
        resolvedStatus: 'AMBIGUOUS',
        notes: `Collision: ${validMatches.length} matching messages found. Maintained AMBIGUOUS.`
      };
    } catch (err: any) {
      // Clear lease so delivery is not blocked indefinitely
      await EmailDeliveryModel.updateOne(
        { _id: delivery._id },
        {
          $set: {
            reconciliationLeaseExpiresAt: null,
            reconciliationNotes: `Reconciliation error: ${err.message || String(err)}`
          }
        }
      );
      throw err;
    }
  }

  /**
   * Scans and reconciles all eligible AMBIGUOUS deliveries for the workspace.
   */
  public async reconcileAllAmbiguous(limit = 10): Promise<ReconciliationResult[]> {
    const now = new Date();
    const candidates = await EmailDeliveryModel.find({
      workspaceId: this.workspaceId,
      status: 'AMBIGUOUS',
      $and: [
        {
          $or: [
            { reconciliationLeaseExpiresAt: null },
            { reconciliationLeaseExpiresAt: { $lt: now } }
          ]
        },
        {
          $or: [
            { nextReconciliationAt: null },
            { nextReconciliationAt: { $lte: now } }
          ]
        }
      ]
    })
      .sort({ createdAt: 1 })
      .limit(limit);

    const results: ReconciliationResult[] = [];
    for (const cand of candidates) {
      try {
        const res = await this.reconcileAmbiguousDelivery(cand._id.toString());
        results.push(res);
      } catch (err: any) {
        logger.error({ err, deliveryId: cand._id.toString() }, 'Failed to reconcile ambiguous delivery');
      }
    }

    return results;
  }

  /**
   * Phase 2: LeadForge Inbound Email Relevance Evaluator.
   *
   * Enforces the boundary between candidate mailbox fetch and LeadForge acceptance.
   * Evaluates the four canonical relevance signals:
   *   1. DSN bounce matching an outbound delivery in current workspace
   *   2. Gmail threadId matching providerThreadId of outbound delivery in workspace
   *   3. In-Reply-To or References header matching providerMessageId in workspace
   *   4. Sender address matching active contact with qualifying outbound delivery (SENT, AMBIGUOUS, or SENDING)
   *
   * Irrelevant candidate messages (newsletters, colleague emails, personal messages) return isRelevant: false
   * and must be silently dropped before writing to the operational ledger.
   */
  public async evaluateInboundRelevance(
    item: { id: string; threadId?: string | null | undefined },
    detail: {
      headers: Record<string, any>;
      bodyText?: string | null | undefined;
      bodyHtml?: string | null | undefined;
      internalDate?: Date | null | undefined;
    },
    accountEmail: string
  ): Promise<InboundRelevanceEvaluation> {
    const fromRaw = detail.headers.from || '';
    const emailMatch = fromRaw.match(/<([^>]+)>/) || fromRaw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    const normalizedFrom = (emailMatch?.[1] || fromRaw).toLowerCase().trim();

    // 0. Skip self-sent messages
    if (accountEmail && normalizedFrom === accountEmail.toLowerCase().trim()) {
      return { isRelevant: false, reason: 'self_sent', normalizedFrom };
    }

    // 1. Relevance Rule 1: DSN / Bounce
    const dsnReport = parseDsnReport(detail.bodyText || detail.bodyHtml, detail.headers);
    if (dsnReport && dsnReport.isDsn) {
      let bouncedDelivery: EmailDeliveryDocument | null = null;
      if (item.threadId) {
        bouncedDelivery = await EmailDeliveryModel.findOne({
          workspaceId: this.workspaceId,
          direction: 'OUTBOUND',
          providerThreadId: item.threadId
        }).sort({ sentAt: -1 });
      }

      if (!bouncedDelivery && dsnReport.failedRecipient) {
        bouncedDelivery = await EmailDeliveryModel.findOne({
          workspaceId: this.workspaceId,
          direction: 'OUTBOUND',
          recipientEmail: dsnReport.failedRecipient.toLowerCase().trim()
        }).sort({ sentAt: -1 });
      }

      if (bouncedDelivery) {
        return {
          isRelevant: true,
          reason: 'dsn_matched',
          bouncedDelivery,
          dsnReport,
          normalizedFrom
        };
      }

      // DSN bounce with no matching LeadForge outbound delivery in this workspace -> DROP
      return {
        isRelevant: false,
        reason: 'irrelevant',
        dsnReport,
        normalizedFrom
      };
    }

    // 2. Relevance Rule 2: Matching Gmail Thread
    let matchedDelivery: EmailDeliveryDocument | null = null;
    let matchConfidence: 'thread' | 'header' | 'contact' | 'none' = 'none';

    if (item.threadId) {
      matchedDelivery = await EmailDeliveryModel.findOne({
        workspaceId: this.workspaceId,
        direction: 'OUTBOUND',
        providerThreadId: item.threadId,
        status: { $in: ['SENT', 'AMBIGUOUS'] }
      }).sort({ sentAt: -1 });

      if (matchedDelivery) {
        matchConfidence = 'thread';
      }
    }

    // 3. Relevance Rule 3: Message Header Correlation (In-Reply-To / References)
    if (!matchedDelivery) {
      const headerRefs: string[] = [];
      if (detail.headers.inReplyTo) headerRefs.push(detail.headers.inReplyTo);
      if (Array.isArray(detail.headers.references)) headerRefs.push(...detail.headers.references);

      for (const ref of headerRefs) {
        const cleanRef = ref.replace(/[<>]/g, '').trim();
        matchedDelivery = await EmailDeliveryModel.findOne({
          workspaceId: this.workspaceId,
          direction: 'OUTBOUND',
          status: { $in: ['SENT', 'AMBIGUOUS'] },
          $or: [
            { providerMessageId: cleanRef },
            { providerMessageId: ref },
            { messageId: cleanRef },
            { messageId: ref },
            { messageId: `<${cleanRef}>` }
          ]
        });

        if (matchedDelivery) {
          matchConfidence = 'header';
          break;
        }
      }
    }

    // 4. Relevance Rule 4: Contact Address Correlation (Active contact + qualifying outbound delivery)
    let contactDoc = null;
    if (!matchedDelivery) {
      contactDoc = await ContactModel.findOne({
        workspaceId: this.workspaceId,
        $or: [{ email: normalizedFrom }, { 'additionalEmails.email': normalizedFrom }],
        deletedAt: null
      });

      if (contactDoc) {
        matchedDelivery = await EmailDeliveryModel.findOne({
          workspaceId: this.workspaceId,
          contactId: contactDoc._id.toString(),
          direction: 'OUTBOUND',
          status: { $in: ['SENT', 'AMBIGUOUS'] }
        }).sort({ sentAt: -1 });

        if (matchedDelivery) {
          matchConfidence = 'contact';
        }
      }
    } else if (matchedDelivery.contactId) {
      contactDoc = await ContactModel.findOne({
        _id: matchedDelivery.contactId,
        workspaceId: this.workspaceId
      });
    }

    if (matchedDelivery) {
      return {
        isRelevant: true,
        reason: `${matchConfidence}_matched` as any,
        matchedDelivery,
        contactDoc,
        matchConfidence,
        normalizedFrom
      };
    }

    // 5. Fast-Reply Safety Rule: Outbound delivery in SENDING status exists
    let pendingSendingDelivery: EmailDeliveryDocument | null = null;

    if (contactDoc) {
      pendingSendingDelivery = await EmailDeliveryModel.findOne({
        workspaceId: this.workspaceId,
        contactId: contactDoc._id.toString(),
        direction: 'OUTBOUND',
        status: 'SENDING'
      }).sort({ createdAt: -1 });
    }

    if (!pendingSendingDelivery && normalizedFrom) {
      pendingSendingDelivery = await EmailDeliveryModel.findOne({
        workspaceId: this.workspaceId,
        recipientEmail: normalizedFrom,
        direction: 'OUTBOUND',
        status: 'SENDING'
      }).sort({ createdAt: -1 });
    }

    if (!pendingSendingDelivery && item.threadId) {
      pendingSendingDelivery = await EmailDeliveryModel.findOne({
        workspaceId: this.workspaceId,
        direction: 'OUTBOUND',
        providerThreadId: item.threadId,
        status: 'SENDING'
      }).sort({ createdAt: -1 });
    }

    if (pendingSendingDelivery) {
      return {
        isRelevant: true,
        reason: 'fast_reply_pending',
        pendingSendingDelivery,
        contactDoc,
        normalizedFrom
      };
    }

    // Irrelevant candidate: no matching outbound delivery or active outreach
    return {
      isRelevant: false,
      reason: 'irrelevant',
      normalizedFrom
    };
  }

  /**
   * Helper verifying whether an inbound candidate is relevant to LeadForge outreach.
   */
  public async isLeadForgeRelevant(
    item: { id: string; threadId?: string | null | undefined },
    detail: {
      headers: Record<string, any>;
      bodyText?: string | null | undefined;
      bodyHtml?: string | null | undefined;
      internalDate?: Date | null | undefined;
    },
    accountEmail: string
  ): Promise<boolean> {
    const evaluation = await this.evaluateInboundRelevance(item, detail, accountEmail);
    return evaluation.isRelevant;
  }

  /**
   * Ingests and correlates inbound email replies received by a specific email account.
   */
  public async pollInboundRepliesForAccount(accountId: string): Promise<InboundPollResult> {
    const account = await EmailAccountModel.findOne({
      _id: accountId,
      workspaceId: this.workspaceId
    });

    const connectionId = account?.connectionId || account?.googleConnectionId;
    if (!account || !connectionId) {
      throw new EmailDomainError('MAILBOX_NOT_FOUND', `Account ${accountId} not found or missing connection.`);
    }

    // Default window: last poll time, or up to 7 days back on first run
    const sinceDate = account.lastInboundPollAt || new Date(Date.now() - 7 * 86400000);
    const afterTimestampSec = Math.floor(sinceDate.getTime() / 1000);

    logger.info(
      { accountId, email: account.email, afterTimestampSec },
      'Polling Gmail for inbound replies'
    );

    const messages = await this.gmailProvider.listInboundMessages(connectionId, {
      afterTimestampSec,
      maxResults: 25
    });

    let processedCount = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;
    let suppressedExecutionsCount = 0;

    const eventRepo = new EmailEventRepository(this.workspaceId);

    for (const item of messages) {
      const idempotencyKey = `inbound_${accountId}_${item.id}`;

      // Idempotency: skip if already ingested
      const existing = await EmailDeliveryModel.findOne({
        workspaceId: this.workspaceId,
        idempotencyKey
      });

      if (existing) {
        continue;
      }

      const detail = await this.gmailProvider.getMessage(connectionId, item.id).catch(() => null);
      if (!detail) continue;

      // ── Phase 2: LeadForge Relevance Evaluation ────────────────────────────
      const evaluation = await this.evaluateInboundRelevance(item, detail, account.email);
      if (!evaluation.isRelevant) {
        logger.debug(
          { inboundMessageId: item.id, reason: evaluation.reason, from: evaluation.normalizedFrom },
          'Silently dropped irrelevant mailbox message (no LeadForge outreach relationship)'
        );
        continue;
      }

      processedCount++;
      const safeHtml = detail.bodyHtml ? sanitizeHtmlForPreview(detail.bodyHtml) : null;
      const safeText = detail.bodyText || null;
      const incomingDate = detail.internalDate || new Date();
      const normalizedFrom = evaluation.normalizedFrom;

      // ── Case 1: Relevant DSN / Bounce Notification ────────────────────────
      if (evaluation.reason === 'dsn_matched' && evaluation.bouncedDelivery && evaluation.dsnReport) {
        const bouncedDelivery = evaluation.bouncedDelivery;
        const dsnReport = evaluation.dsnReport;
        const targetRecipient = dsnReport.failedRecipient || bouncedDelivery.recipientEmail;

        let bouncedContact = null;
        if (targetRecipient) {
          bouncedContact = await ContactModel.findOne({
            workspaceId: this.workspaceId,
            $or: [{ email: targetRecipient }, { 'additionalEmails.email': targetRecipient }],
            deletedAt: null
          });
        }

        const bounceCategory = dsnReport.classification.category;
        const failureCategory = mapBounceCategoryToFailureCategory(bounceCategory);

        await EmailDeliveryModel.updateOne(
          { _id: bouncedDelivery._id },
          {
            $set: {
              status: 'FAILED',
              failureCategory,
              failureClassification: bounceCategory,
              failureCode: dsnReport.classification.enhancedStatusCode || String(dsnReport.classification.statusCode || 'BOUNCE'),
              safeHumanMessage: dsnReport.classification.safeDescription,
              technicalMessage: dsnReport.classification.diagnosticMessage,
              retryable: !dsnReport.classification.isPermanent,
              error: dsnReport.classification.safeDescription || dsnReport.classification.diagnosticMessage
            }
          }
        );

        // Emit immutable BOUNCED event
        const bounceEventKey = `bounce_${this.workspaceId}_${item.id}`;
        await eventRepo.recordEvent({
          deliveryId: bouncedDelivery._id.toString(),
          contactId: bouncedContact ? bouncedContact._id.toString() : (bouncedDelivery.contactId || 'unknown'),
          campaignId: bouncedDelivery.campaignId || null,
          type: EmailEventType.BOUNCED,
          occurredAt: detail.internalDate || new Date(),
          metadata: {
            dsnMessageId: item.id,
            failedRecipient: targetRecipient,
            category: dsnReport.classification.category,
            statusCode: dsnReport.classification.statusCode,
            enhancedStatusCode: dsnReport.classification.enhancedStatusCode
          },
          dedupeKey: bounceEventKey
        });

        // Auto-suppress on hard bounce
        if (dsnReport.classification.isHardBounce && targetRecipient) {
          const suppressionRepo = new SuppressionRepository(this.workspaceId);
          await suppressionRepo.suppress(
            targetRecipient,
            SuppressionReason.HARD_BOUNCE,
            'inbound_dsn_bounce',
            {
              dsnMessageId: item.id,
              diagnostic: dsnReport.classification.diagnosticMessage,
              statusCode: dsnReport.classification.statusCode,
              enhancedStatusCode: dsnReport.classification.enhancedStatusCode
            }
          );

          if (bouncedContact) {
            const isPrimary = bouncedContact.email?.toLowerCase().trim() === targetRecipient.toLowerCase().trim();
            if (isPrimary) {
              await ContactModel.updateOne(
                { _id: bouncedContact._id, workspaceId: this.workspaceId },
                {
                  $set: {
                    status: ContactStatus.BOUNCED,
                    emailStatus: ContactEmailStatus.INVALID
                  }
                }
              );

              // Halt running sequence executions for this primary address
              const cancelled = await SequenceExecutionModel.updateMany(
                {
                  workspaceId: this.workspaceId,
                  contactId: bouncedContact._id.toString(),
                  status: { $in: ['active', 'running', 'waiting', 'pending', 'WAITING', 'ACTIVE', 'RUNNING', 'PENDING'] }
                },
                {
                  $set: {
                    status: 'completed',
                    completedAt: new Date(),
                    nextExecutionAt: null
                  },
                  $push: {
                    logs: {
                      timestamp: new Date(),
                      level: 'warn',
                      message: 'Sequence execution halted: recipient primary email hard bounced.'
                    }
                  }
                }
              );
              suppressedExecutionsCount += cancelled.modifiedCount;
            } else {
              // Address-scoped bounce for secondary email: mark only that additional email invalid
              await ContactModel.updateOne(
                {
                  _id: bouncedContact._id,
                  workspaceId: this.workspaceId,
                  'additionalEmails.email': targetRecipient
                },
                {
                  $set: {
                    'additionalEmails.$.status': ContactEmailStatus.INVALID
                  }
                }
              );
            }
          }
        }

        // Evaluate campaign circuit breaker if DSN bounce matches rejection criteria
        if (bouncedDelivery.campaignId && isCircuitBreakerRejectionCategory(failureCategory)) {
          try {
            const breakerService = new CampaignCircuitBreakerService(this.workspaceId);
            await breakerService.checkAndTripBreaker(this.workspaceId, bouncedDelivery.campaignId, {
              id: bouncedDelivery._id.toString(),
              failureCategory,
              failureCode: dsnReport.classification.enhancedStatusCode || String(dsnReport.classification.statusCode || 'BOUNCE'),
              technicalMessage: dsnReport.classification.diagnosticMessage
            });
          } catch (breakerErr) {
            logger.warn({ breakerErr, campaignId: bouncedDelivery.campaignId }, 'Failed to evaluate campaign circuit breaker on DSN bounce');
          }
        }

        // Persist the DSN message in unified ledger
        await EmailDeliveryModel.create({
          workspaceId: this.workspaceId,
          direction: 'INBOUND',
          status: 'RECEIVED',
          idempotencyKey,
          matchedDeliveryId: bouncedDelivery._id.toString(),
          contactId: bouncedContact ? bouncedContact._id.toString() : (bouncedDelivery.contactId || 'bounce-subsystem'),
          campaignId: bouncedDelivery.campaignId || null,
          sequenceId: bouncedDelivery.sequenceId || 'inbound-dsn',
          executionId: bouncedDelivery.executionId || 'inbound-dsn',
          stepIndex: (bouncedDelivery.stepIndex || 0) + 1,
          accountId: account._id.toString(),
          senderEmail: normalizedFrom,
          recipientEmail: account.email,
          subject: detail.headers.subject || 'Delivery Status Notification',
          htmlBody: safeHtml,
          textBody: safeText,
          provider: 'gmail',
          providerMessageId: item.id,
          providerThreadId: item.threadId,
          matchConfidence: 'thread',
          processingStatus: 'MATCHED',
          sentAt: incomingDate
        });

        continue;
      }

      // ── Case 2: Relevant Matched Reply ────────────────────────────────────
      if (evaluation.matchedDelivery) {
        const matchedDelivery = evaluation.matchedDelivery;
        const contactDoc = evaluation.contactDoc;
        const matchConfidence = evaluation.matchConfidence || 'none';
        matchedCount++;

        // Save matched inbound message in unified ledger
        await EmailDeliveryModel.create({
          workspaceId: this.workspaceId,
          direction: 'INBOUND',
          status: 'RECEIVED',
          idempotencyKey,
          matchedDeliveryId: matchedDelivery._id.toString(),
          contactId: contactDoc ? contactDoc._id.toString() : (matchedDelivery.contactId || 'unmatched-contact'),
          campaignId: matchedDelivery.campaignId || null,
          sequenceId: matchedDelivery.sequenceId || 'inbound-direct',
          executionId: matchedDelivery.executionId || 'inbound-direct',
          stepIndex: (matchedDelivery.stepIndex || 0) + 1,
          accountId: account._id.toString(),
          senderEmail: normalizedFrom,
          recipientEmail: account.email,
          subject: detail.headers.subject || '(No Subject)',
          htmlBody: safeHtml,
          textBody: safeText,
          provider: 'gmail',
          providerMessageId: item.id,
          providerThreadId: item.threadId,
          inReplyTo: detail.headers.inReplyTo || null,
          references: detail.headers.references || [],
          matchConfidence,
          processingStatus: 'MATCHED',
          sentAt: incomingDate
        });

        // Record immutable REPLIED event
        const dedupeKey = `reply_${this.workspaceId}_${item.id}`;
        await eventRepo.recordEvent({
          deliveryId: matchedDelivery._id.toString(),
          contactId: contactDoc ? contactDoc._id.toString() : (matchedDelivery.contactId || 'unmatched-contact'),
          campaignId: matchedDelivery.campaignId || null,
          type: EmailEventType.REPLIED,
          occurredAt: incomingDate,
          metadata: {
            providerMessageId: item.id,
            providerThreadId: item.threadId,
            from: normalizedFrom,
            subject: detail.headers.subject,
            matchConfidence
          },
          dedupeKey
        });

        // Update parent delivery
        await EmailDeliveryModel.updateOne(
          { _id: matchedDelivery._id },
          {
            $set: {
              hasReply: true,
              lastRepliedAt: incomingDate
            },
            $inc: { replyCount: 1 }
          }
        );

        // Monotonic Contact Status Transition: NEW / CONTACTED -> REPLIED
        if (contactDoc && canTransitionContactStatus(contactDoc.status, ContactStatus.REPLIED)) {
          await ContactModel.updateOne(
            {
              _id: contactDoc._id,
              workspaceId: this.workspaceId,
              status: { $nin: ['UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'ARCHIVED'] }
            } as any,
            {
              $set: {
                status: ContactStatus.REPLIED,
                lastRepliedAt: incomingDate
              }
            }
          );
        }

        // Scope cancellation to the matched campaign / execution to preserve unrelated campaigns
        const cancelFilter: any = {
          workspaceId: this.workspaceId,
          contactId: contactDoc ? contactDoc._id.toString() : matchedDelivery.contactId,
          status: { $in: ['active', 'running', 'waiting', 'pending', 'WAITING', 'ACTIVE', 'RUNNING', 'PENDING'] }
        };

        if (matchedDelivery.executionId && matchedDelivery.executionId !== 'inbound-direct' && !matchedDelivery.executionId.startsWith('direct-')) {
          cancelFilter._id = matchedDelivery.executionId;
        } else if (matchedDelivery.campaignId) {
          cancelFilter.campaignId = matchedDelivery.campaignId;
        }

        const cancelled = await SequenceExecutionModel.updateMany(
          cancelFilter,
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              nextExecutionAt: null
            },
            $inc: { replies: 1 },
            $push: {
              logs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Sequence execution halted: contact replied to email outreach.',
                step: matchedDelivery.stepIndex
              }
            }
          }
        );

        suppressedExecutionsCount += cancelled.modifiedCount;

        logger.info(
          {
            inboundMessageId: item.id,
            contactId: contactDoc ? contactDoc._id.toString() : matchedDelivery.contactId,
            matchedDeliveryId: matchedDelivery._id.toString(),
            matchConfidence
          },
          'Successfully ingested and matched inbound email reply'
        );
        continue;
      }

      // ── Case 3: Fast-Reply Race (Outbound is currently SENDING) ───────────
      if (evaluation.reason === 'fast_reply_pending' && evaluation.pendingSendingDelivery) {
        const pending = evaluation.pendingSendingDelivery;
        const contactDoc = evaluation.contactDoc;
        unmatchedCount++;

        await EmailDeliveryModel.create({
          workspaceId: this.workspaceId,
          direction: 'INBOUND',
          status: 'RECEIVED',
          idempotencyKey,
          matchedDeliveryId: null,
          contactId: contactDoc ? contactDoc._id.toString() : (pending.contactId || 'unmatched-contact'),
          campaignId: pending.campaignId || null,
          sequenceId: pending.sequenceId || 'inbound-direct',
          executionId: pending.executionId || 'inbound-direct',
          stepIndex: 0,
          accountId: account._id.toString(),
          senderEmail: normalizedFrom,
          recipientEmail: account.email,
          subject: detail.headers.subject || '(No Subject)',
          htmlBody: safeHtml,
          textBody: safeText,
          provider: 'gmail',
          providerMessageId: item.id,
          providerThreadId: item.threadId,
          inReplyTo: detail.headers.inReplyTo || null,
          references: detail.headers.references || [],
          matchConfidence: 'none',
          processingStatus: 'CORRELATION_PENDING',
          reconciliationAttempts: 1,
          nextReconciliationAt: new Date(Date.now() + 60000),
          sentAt: incomingDate
        });

        logger.info(
          { inboundMessageId: item.id, from: normalizedFrom, pendingDeliveryId: pending._id.toString() },
          'Ingested inbound email as CORRELATION_PENDING (fast reply to in-flight SENDING outbound delivery)'
        );
        continue;
      }
    }

    // Reconcile any pending inbound replies
    const pendingReconciliation = await this.reconcilePendingInboundReplies();
    matchedCount += pendingReconciliation.matchedCount;
    suppressedExecutionsCount += pendingReconciliation.suppressedExecutionsCount;

    // Update mailbox lastInboundPollAt
    await EmailAccountModel.updateOne(
      { _id: accountId },
      { $set: { lastInboundPollAt: new Date() } }
    );

    return {
      accountId,
      discoveredCount: messages.length,
      processedCount,
      matchedCount,
      unmatchedCount,
      suppressedExecutionsCount
    };
  }

  /**
   * Phase 15 (INBOUND-03): Reconciles inbound messages that were previously marked CORRELATION_PENDING.
   * This handles the race where a recipient replies while the outbound message was still SENDING or
   * before the provider message/thread IDs were finalized in the database.
   */
  public async reconcilePendingInboundReplies(limit = 50): Promise<{
    processedCount: number;
    matchedCount: number;
    expiredCount: number;
    suppressedExecutionsCount: number;
  }> {
    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const pendingInbounds = await EmailDeliveryModel.find({
      workspaceId: this.workspaceId,
      direction: 'INBOUND',
      processingStatus: 'CORRELATION_PENDING',
      createdAt: { $gte: cutoff24h },
      $and: [
        {
          $or: [
            { reconciliationAttempts: { $exists: false } },
            { reconciliationAttempts: { $lt: 5 } }
          ]
        },
        {
          $or: [
            { nextReconciliationAt: null },
            { nextReconciliationAt: { $lte: now } }
          ]
        }
      ]
    }).limit(limit);

    let processedCount = 0;
    let matchedCount = 0;
    let expiredCount = 0;
    let suppressedExecutionsCount = 0;

    const eventRepo = new EmailEventRepository(this.workspaceId);

    for (const pending of pendingInbounds) {
      processedCount++;

      let matchedDelivery: EmailDeliveryDocument | null = null;
      let matchConfidence: 'thread' | 'header' | 'contact' | 'none' = 'none';

      // 1. Thread ID Correlation (Strongest)
      if (pending.providerThreadId) {
        matchedDelivery = await EmailDeliveryModel.findOne({
          workspaceId: this.workspaceId,
          direction: 'OUTBOUND',
          providerThreadId: pending.providerThreadId,
          status: { $in: ['SENT', 'AMBIGUOUS'] }
        }).sort({ sentAt: -1 });

        if (matchedDelivery) {
          matchConfidence = 'thread';
        }
      }

      // 2. Message Header Correlation (In-Reply-To / References)
      if (!matchedDelivery) {
        const headerRefs: string[] = [];
        if (pending.inReplyTo) headerRefs.push(pending.inReplyTo);
        if (Array.isArray(pending.references)) headerRefs.push(...pending.references);

        for (const ref of headerRefs) {
          const cleanRef = ref.replace(/[<>]/g, '').trim();
          matchedDelivery = await EmailDeliveryModel.findOne({
            workspaceId: this.workspaceId,
            direction: 'OUTBOUND',
            status: { $in: ['SENT', 'AMBIGUOUS'] },
            $or: [
              { providerMessageId: cleanRef },
              { providerMessageId: ref },
              { messageId: cleanRef },
              { messageId: ref },
              { messageId: `<${cleanRef}>` }
            ]
          });

          if (matchedDelivery) {
            matchConfidence = 'header';
            break;
          }
        }
      }

      // 3. Sender Contact Correlation (Fallback)
      let contactDoc = null;
      if (!matchedDelivery) {
        contactDoc = await ContactModel.findOne({
          workspaceId: this.workspaceId,
          $or: [{ email: pending.senderEmail }, { 'additionalEmails.email': pending.senderEmail }],
          deletedAt: null
        });

        if (contactDoc) {
          matchedDelivery = await EmailDeliveryModel.findOne({
            workspaceId: this.workspaceId,
            contactId: contactDoc._id.toString(),
            accountId: pending.accountId,
            direction: 'OUTBOUND',
            status: { $in: ['SENT', 'AMBIGUOUS'] }
          }).sort({ sentAt: -1 });

          if (matchedDelivery) {
            matchConfidence = 'contact';
          }
        }
      } else if (pending.contactId && pending.contactId !== 'unmatched-contact') {
        contactDoc = await ContactModel.findOne({
          _id: pending.contactId,
          workspaceId: this.workspaceId
        });
      }

      if (matchedDelivery && contactDoc) {
        matchedCount++;

        // Upgrade pending inbound delivery to MATCHED
        await EmailDeliveryModel.updateOne(
          { _id: pending._id },
          {
            $set: {
              matchedDeliveryId: matchedDelivery._id.toString(),
              contactId: contactDoc._id.toString(),
              campaignId: matchedDelivery.campaignId || null,
              sequenceId: matchedDelivery.sequenceId || 'inbound-direct',
              executionId: matchedDelivery.executionId || 'inbound-direct',
              stepIndex: (matchedDelivery.stepIndex || 0) + 1,
              matchConfidence,
              processingStatus: 'MATCHED',
              reconciledAt: new Date()
            }
          }
        );

        // Record immutable REPLIED event
        const dedupeKey = `reply_${this.workspaceId}_${pending.providerMessageId || pending._id.toString()}`;
        await eventRepo.recordEvent({
          deliveryId: matchedDelivery._id.toString(),
          contactId: contactDoc._id.toString(),
          campaignId: matchedDelivery.campaignId || null,
          type: EmailEventType.REPLIED,
          occurredAt: pending.sentAt || new Date(),
          metadata: {
            providerMessageId: pending.providerMessageId,
            providerThreadId: pending.providerThreadId,
            from: pending.senderEmail,
            subject: pending.subject,
            matchConfidence,
            reconciledFromPending: true
          },
          dedupeKey
        });

        // Update parent delivery
        await EmailDeliveryModel.updateOne(
          { _id: matchedDelivery._id },
          {
            $set: {
              hasReply: true,
              lastRepliedAt: pending.sentAt || new Date()
            },
            $inc: { replyCount: 1 }
          }
        );

        // Monotonic Contact Status Transition: NEW / CONTACTED -> REPLIED
        if (canTransitionContactStatus(contactDoc.status, ContactStatus.REPLIED)) {
          await ContactModel.updateOne(
            {
              _id: contactDoc._id,
              workspaceId: this.workspaceId,
              status: { $nin: ['UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'ARCHIVED'] }
            } as any,
            {
              $set: {
                status: ContactStatus.REPLIED,
                lastRepliedAt: pending.sentAt || new Date()
              }
            }
          );
        }

        // Halt running sequence executions for this contact and campaign
        const cancelFilter: any = {
          workspaceId: this.workspaceId,
          contactId: contactDoc._id.toString(),
          status: { $in: ['active', 'running', 'waiting', 'pending', 'WAITING', 'ACTIVE', 'RUNNING', 'PENDING'] }
        };

        if (matchedDelivery.executionId && matchedDelivery.executionId !== 'inbound-direct' && !matchedDelivery.executionId.startsWith('direct-')) {
          cancelFilter._id = matchedDelivery.executionId;
        } else if (matchedDelivery.campaignId) {
          cancelFilter.campaignId = matchedDelivery.campaignId;
        }

        const cancelled = await SequenceExecutionModel.updateMany(
          cancelFilter,
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              nextExecutionAt: null
            },
            $inc: { replies: 1 },
            $push: {
              logs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Sequence execution halted: contact replied to email outreach (reconciled from pending).',
                step: matchedDelivery.stepIndex
              }
            }
          }
        );

        suppressedExecutionsCount += cancelled.modifiedCount;

        logger.info(
          {
            inboundDeliveryId: pending._id.toString(),
            contactId: contactDoc._id.toString(),
            matchedDeliveryId: matchedDelivery._id.toString()
          },
          'Successfully reconciled pending inbound reply to MATCHED'
        );
      } else {
        // No match found on this attempt: check bounded expiration window
        const attempts = (pending.reconciliationAttempts || 0) + 1;
        const createdAt = (pending as any).createdAt ? new Date((pending as any).createdAt).getTime() : Date.now();
        const ageMs = Date.now() - createdAt;
        const maxAttempts = 5;
        const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

        if (attempts >= maxAttempts || ageMs >= maxAgeMs) {
          expiredCount++;
          await EmailDeliveryModel.updateOne(
            { _id: pending._id },
            {
              $set: {
                processingStatus: 'UNMATCHED',
                reconciliationAttempts: attempts,
                reconciliationNotes: `Exhausted bounded re-indexing window (${attempts} attempts or >24h) without finding matching outbound delivery.`
              }
            }
          );
        } else {
          // Exponential backoff: 1m, 2m, 4m, 8m (capped at 24h)
          const delayMs = Math.min(24 * 60 * 60 * 1000, 60000 * Math.pow(2, attempts - 1));
          const nextRetry = new Date(Date.now() + delayMs);
          await EmailDeliveryModel.updateOne(
            { _id: pending._id },
            {
              $set: {
                reconciliationAttempts: attempts,
                nextReconciliationAt: nextRetry,
                reconciliationNotes: `Attempt ${attempts}/${maxAttempts}: matching outbound delivery not yet available. Retrying at ${nextRetry.toISOString()}.`
              }
            }
          );
        }
      }
    }

    return {
      processedCount,
      matchedCount,
      expiredCount,
      suppressedExecutionsCount
    };
  }

  /**
   * Public bounded re-indexer for pending inbound replies.
   */
  public async reindexPendingInboundReplies(options?: { limit?: number }): Promise<{
    processedCount: number;
    matchedCount: number;
    expiredCount: number;
    suppressedExecutionsCount: number;
  }> {
    return this.reconcilePendingInboundReplies(options?.limit ?? 50);
  }

  /**
   * Polls inbound replies across all connected email accounts in the workspace.
   */
  public async pollAllInboundReplies(): Promise<InboundPollResult[]> {
    const accounts = await EmailAccountModel.find({
      workspaceId: this.workspaceId,
      status: 'connected'
    });

    const results: InboundPollResult[] = [];
    for (const acc of accounts) {
      try {
        const res = await this.pollInboundRepliesForAccount(acc._id.toString());
        results.push(res);
      } catch (err: any) {
        logger.error({ err, accountId: acc._id.toString() }, 'Failed to poll inbound replies for account');
      }
    }

    return results;
  }

  /**
   * Manually reconciles an unresolved or pending inbound reply with an explicit contact,
   * optional campaign, and optional parent delivery.
   *
   * Enforces strict workspace multi-tenant isolation, duplicate match prevention,
   * immutable REPLIED event generation, monotonic contact status transition, and
   * sequence outreach cessation.
   */
  public async manualReconcileInboundReply(
    inboundDeliveryId: string,
    options: {
      contactId: string;
      campaignId?: string | null;
      matchedDeliveryId?: string | null;
      notes?: string | null;
      operatorId?: string | null;
    }
  ): Promise<{
    success: boolean;
    inboundDeliveryId: string;
    contactId: string;
    matchedDeliveryId: string | null;
    cancelledExecutionsCount: number;
  }> {
    // 1. Validate inbound message belongs to caller's workspace
    const inbound = await EmailDeliveryModel.findOne({
      _id: inboundDeliveryId,
      workspaceId: this.workspaceId
    });

    if (!inbound) {
      throw new NotFoundError(`Inbound delivery with id "${inboundDeliveryId}" not found in workspace.`);
    }

    if (inbound.direction !== 'INBOUND') {
      throw new BadRequestError('Only inbound delivery messages can be reconciled as replies.');
    }

    if (inbound.processingStatus === 'MATCHED' && inbound.matchedDeliveryId) {
      throw new ConflictError(`Inbound delivery "${inboundDeliveryId}" is already matched to delivery "${inbound.matchedDeliveryId}".`);
    }

    // 2. Validate target contact belongs to workspace
    const contact = await ContactModel.findOne({
      _id: options.contactId,
      workspaceId: this.workspaceId,
      deletedAt: null
    });

    if (!contact) {
      throw new NotFoundError(`Target contact with id "${options.contactId}" not found in workspace.`);
    }

    // 3. If parent outbound delivery is specified, validate it
    let outbound: EmailDeliveryDocument | null = null;
    if (options.matchedDeliveryId) {
      outbound = await EmailDeliveryModel.findOne({
        _id: options.matchedDeliveryId,
        workspaceId: this.workspaceId,
        direction: 'OUTBOUND'
      });

      if (!outbound) {
        throw new NotFoundError(`Outbound delivery with id "${options.matchedDeliveryId}" not found in workspace.`);
      }

      if (options.campaignId && outbound.campaignId && String(options.campaignId) !== String(outbound.campaignId)) {
        throw new BadRequestError('Specified campaignId does not match outbound delivery campaign.');
      }
    } else if (options.campaignId) {
      const camp = await CampaignModel.findOne({
        _id: options.campaignId,
        workspaceId: this.workspaceId
      });

      if (!camp) {
        throw new NotFoundError(`Specified campaign with id "${options.campaignId}" not found in workspace.`);
      }
    }

    // 4. Update inbound delivery record
    const effectiveCampaignId = outbound?.campaignId || options.campaignId || null;
    inbound.processingStatus = 'MATCHED';
    inbound.matchConfidence = 'manual';
    inbound.contactId = contact._id.toString();
    if (outbound) {
      inbound.matchedDeliveryId = outbound._id.toString();
      inbound.campaignId = outbound.campaignId || effectiveCampaignId;
      inbound.sequenceId = outbound.sequenceId || 'inbound-manual';
      inbound.executionId = outbound.executionId || 'inbound-manual';
      inbound.stepIndex = (outbound.stepIndex || 0) + 1;
    } else {
      inbound.campaignId = effectiveCampaignId;
      inbound.sequenceId = 'inbound-manual';
      inbound.executionId = 'inbound-manual';
    }
    inbound.reconciledAt = new Date();
    inbound.reconciliationNotes = options.notes || 'Manually reconciled by operator';
    await inbound.save();

    // 5. Update parent outbound delivery if present
    if (outbound) {
      await EmailDeliveryModel.updateOne(
        { _id: outbound._id, workspaceId: this.workspaceId },
        {
          $set: {
            hasReply: true,
            lastRepliedAt: inbound.sentAt || new Date()
          },
          $inc: { replyCount: 1 }
        }
      );
    }

    // 6. Record immutable REPLIED event in ledger
    const dedupeKey = `manual_reply_${this.workspaceId}_${inbound._id.toString()}`;
    const eventRepo = new EmailEventRepository(this.workspaceId);
    await eventRepo.recordEvent({
      deliveryId: outbound ? outbound._id.toString() : inbound._id.toString(),
      contactId: contact._id.toString(),
      campaignId: effectiveCampaignId,
      type: EmailEventType.REPLIED,
      occurredAt: inbound.sentAt || new Date(),
      metadata: {
        manualReconciliation: true,
        operatorId: options.operatorId || 'operator',
        inboundDeliveryId: inbound._id.toString(),
        matchedDeliveryId: outbound ? outbound._id.toString() : null,
        notes: options.notes || null
      },
      dedupeKey
    });

    // 7. Transition Contact to REPLIED
    if (canTransitionContactStatus(contact.status, ContactStatus.REPLIED)) {
      await ContactModel.updateOne(
        {
          _id: contact._id,
          workspaceId: this.workspaceId,
          status: { $nin: ['UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'ARCHIVED'] }
        } as any,
        {
          $set: {
            status: ContactStatus.REPLIED,
            lastRepliedAt: inbound.sentAt || new Date()
          }
        }
      );
    }

    // 8. Halt running sequence outreach for this contact & campaign
    const cancelFilter: any = {
      workspaceId: this.workspaceId,
      contactId: contact._id.toString(),
      status: { $in: ['active', 'running', 'waiting', 'pending', 'WAITING', 'ACTIVE', 'RUNNING', 'PENDING'] }
    };
    if (effectiveCampaignId) {
      cancelFilter.campaignId = effectiveCampaignId;
    }

    const cancelled = await SequenceExecutionModel.updateMany(
      cancelFilter,
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          nextExecutionAt: null
        },
        $inc: { replies: 1 },
        $push: {
          logs: {
            timestamp: new Date(),
            level: 'info',
            message: 'Sequence execution halted: reply manually reconciled by operator.'
          }
        }
      }
    );

    logger.info(
      {
        workspaceId: this.workspaceId,
        inboundDeliveryId: inbound._id.toString(),
        contactId: contact._id.toString(),
        matchedDeliveryId: outbound ? outbound._id.toString() : null,
        operatorId: options.operatorId,
        cancelledExecutionsCount: cancelled.modifiedCount
      },
      'Manually reconciled inbound reply successfully'
    );

    return {
      success: true,
      inboundDeliveryId: inbound._id.toString(),
      contactId: contact._id.toString(),
      matchedDeliveryId: outbound ? outbound._id.toString() : null,
      cancelledExecutionsCount: cancelled.modifiedCount
    };
  }
}

