import mongoose, { Schema } from 'mongoose';
import {
  workspacePlugin,
  timestampPlugin,
  type WorkspaceScopedDocument,
  type TimestampDocument
} from '../plugins/index.js';
import type { EmailDeliveryStatus } from '@leadforge/schema';

export interface EmailAttachmentDoc {
  filename: string;
  contentType: string;
  size: number;
  fileId?: string | null;
}

export interface ClickTrackingDoc {
  token: string;
  targetUrl: string;
}

export interface EmailDeliveryDocument
  extends mongoose.Document,
    WorkspaceScopedDocument,
    TimestampDocument {
  campaignId?: string | null;
  sequenceId: string;
  executionId: string;
  stepIndex: number;
  contactId: string;
  companyId?: string | null;
  accountId: string;
  senderEmail: string;
  recipientEmail: string;
  recipientDomain?: string | null;
  subject: string;
  htmlBody?: string | null;
  textBody?: string | null;
  attachments?: EmailAttachmentDoc[];
  provider?: string;
  messageId?: string | null;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  status: EmailDeliveryStatus;
  attempt?: number;

  // Template Lineage & Composition Ledger
  templateId?: string | null;
  templateVersion?: number | null;
  variablesSnapshot?: Record<string, any> | null;
  messageFingerprint?: string | null;

  // Engagement tracking
  openTrackingToken?: string | null;
  clickTrackingTokens?: ClickTrackingDoc[];
  firstOpenedAt?: Date | null;
  lastOpenedAt?: Date | null;
  openCount?: number;
  firstClickedAt?: Date | null;
  lastClickedAt?: Date | null;
  clickCount?: number;

  // Structured failure diagnostics
  error?: string | null;
  failureCode?: string | null;
  failureCategory?: string | null;
  failureClassification?: string | null;
  safeHumanMessage?: string | null;
  technicalMessage?: string | null;
  retryable?: boolean;
  ambiguous?: boolean;

  // Direction & Inbound Matching
  direction?: 'OUTBOUND' | 'INBOUND';
  inReplyTo?: string | null;
  references?: string[];
  matchedDeliveryId?: string | null;
  matchConfidence?: 'thread' | 'header' | 'contact' | 'manual' | 'none' | null;
  processingStatus?: 'RECEIVED' | 'MATCHED' | 'UNMATCHED' | 'CORRELATION_PENDING' | 'AMBIGUOUS_MATCH' | 'IGNORED';
  hasReply?: boolean;
  replyCount?: number;
  lastRepliedAt?: Date | null;

  // Idempotency & Lease
  idempotencyKey: string;
  leaseExpiresAt?: Date | null;
  nextRetryAt?: Date | null;
  retryCount?: number;
  reconciledAt?: Date | null;
  reconciliationNotes?: string | null;
  reconciliationLeaseExpiresAt?: Date | null;
  reconciliationAttempts?: number;
  nextReconciliationAt?: Date | null;
  snapshot?: Record<string, any> | null;
  sentAt?: Date | null;
}

const emailDeliverySchema = new Schema<EmailDeliveryDocument>(
  {
    campaignId: { type: String, default: null, index: true },
    sequenceId: { type: String, required: true, index: true },
    executionId: { type: String, required: true, index: true },
    stepIndex: { type: Number, required: true, default: 0 },
    contactId: { type: String, required: true, index: true },
    companyId: { type: String, default: null, index: true },
    accountId: { type: String, required: true, index: true },
    senderEmail: { type: String, required: true, lowercase: true, trim: true },
    recipientEmail: { type: String, required: true, lowercase: true, trim: true },
    recipientDomain: { type: String, default: null, lowercase: true, trim: true, index: true },
    subject: { type: String, required: true },
    htmlBody: { type: String, default: null },
    textBody: { type: String, default: null },

    // Template Lineage & Composition Ledger
    templateId: { type: String, default: null, index: true },
    templateVersion: { type: Number, default: null },
    variablesSnapshot: { type: Schema.Types.Mixed, default: null },
    messageFingerprint: { type: String, default: null, index: true },
    attachments: [
      {
        filename: { type: String, required: true },
        contentType: { type: String, required: true },
        size: { type: Number, required: true, default: 0 },
        fileId: { type: String, default: null }
      }
    ],
    provider: { type: String, default: 'gmail' },
    messageId: { type: String, default: null, index: true },
    providerMessageId: { type: String, default: null, index: true },
    providerThreadId: { type: String, default: null, index: true },
    status: {
      type: String,
      required: true,
      enum: ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'RETRYING', 'AMBIGUOUS', 'CANCELLED', 'SUPPRESSED', 'RECEIVED'],
      default: 'QUEUED',
      index: true
    },
    attempt: { type: Number, default: 1 },

    // Engagement tracking
    openTrackingToken: { type: String, default: null, index: true, sparse: true },
    clickTrackingTokens: [
      {
        token: { type: String, required: true },
        targetUrl: { type: String, required: true }
      }
    ],
    firstOpenedAt: { type: Date, default: null },
    lastOpenedAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 },
    firstClickedAt: { type: Date, default: null },
    lastClickedAt: { type: Date, default: null },
    clickCount: { type: Number, default: 0 },

    // Failure diagnostics
    error: { type: String, default: null },
    failureCode: { type: String, default: null },
    failureCategory: { type: String, default: null },
    failureClassification: { type: String, default: null },
    safeHumanMessage: { type: String, default: null },
    technicalMessage: { type: String, default: null },
    retryable: { type: Boolean, default: false },
    ambiguous: { type: Boolean, default: false },

    // Direction & Inbound Matching
    direction: { type: String, enum: ['OUTBOUND', 'INBOUND'], default: 'OUTBOUND', index: true },
    inReplyTo: { type: String, default: null },
    references: [{ type: String }],
    matchedDeliveryId: { type: String, default: null, index: true },
    matchConfidence: { type: String, default: null },
    processingStatus: {
      type: String,
      enum: ['RECEIVED', 'MATCHED', 'UNMATCHED', 'CORRELATION_PENDING', 'AMBIGUOUS_MATCH', 'IGNORED'],
      default: 'MATCHED',
      index: true
    },
    hasReply: { type: Boolean, default: false },
    replyCount: { type: Number, default: 0 },
    lastRepliedAt: { type: Date, default: null },

    // Idempotency & Lease
    idempotencyKey: { type: String, required: true, trim: true },
    leaseExpiresAt: { type: Date, default: null, index: true },
    nextRetryAt: { type: Date, default: null, index: true },
    retryCount: { type: Number, default: 0 },
    reconciledAt: { type: Date, default: null },
    reconciliationNotes: { type: String, default: null },
    reconciliationLeaseExpiresAt: { type: Date, default: null, index: true },
    reconciliationAttempts: { type: Number, default: 0 },
    nextReconciliationAt: { type: Date, default: null, index: true },
    snapshot: { type: Schema.Types.Mixed, default: null },
    sentAt: { type: Date, default: null, index: true }
  },
  {
    strict: true
  }
);

// Strategic Indexes:
// 1. Mandatory workspace-scoped uniqueness on idempotencyKey to prevent duplicate sends:
emailDeliverySchema.index({ workspaceId: 1, idempotencyKey: 1 }, { unique: true });
// 2. Fast tenant query filters:
emailDeliverySchema.index({ workspaceId: 1, status: 1 });
emailDeliverySchema.index({ workspaceId: 1, contactId: 1, createdAt: -1 });
emailDeliverySchema.index({ workspaceId: 1, campaignId: 1, createdAt: -1 });
emailDeliverySchema.index({ workspaceId: 1, executionId: 1 });
emailDeliverySchema.index({ workspaceId: 1, sentAt: -1 });
// 3. Stale lease and retry query indexes:
emailDeliverySchema.index({ workspaceId: 1, status: 1, leaseExpiresAt: 1 });
emailDeliverySchema.index({ workspaceId: 1, status: 1, nextRetryAt: 1 });
// 4. Click tracking multi-key index:
emailDeliverySchema.index({ 'clickTrackingTokens.token': 1 }, { sparse: true });
// 5. Thread & direction indexes for rapid reply correlation and message logs:
emailDeliverySchema.index({ workspaceId: 1, providerThreadId: 1 });
emailDeliverySchema.index({ workspaceId: 1, direction: 1, createdAt: -1 });
emailDeliverySchema.index({ workspaceId: 1, recipientDomain: 1, createdAt: -1 });
emailDeliverySchema.index({ workspaceId: 1, campaignId: 1, companyId: 1, createdAt: -1 });
emailDeliverySchema.index({ workspaceId: 1, status: 1, reconciliationLeaseExpiresAt: 1 });

// Note: Permanent outbound send ledger; zero TTL index.
emailDeliverySchema.plugin(workspacePlugin);
emailDeliverySchema.plugin(timestampPlugin);

export const EmailDeliveryModel = mongoose.models.EmailDelivery
  ? (mongoose.models.EmailDelivery as mongoose.Model<EmailDeliveryDocument>)
  : mongoose.model<EmailDeliveryDocument>('EmailDelivery', emailDeliverySchema);
