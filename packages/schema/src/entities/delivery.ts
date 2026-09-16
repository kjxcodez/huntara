import { z } from 'zod';
import { entityIdField, entityIdFieldNullable } from '../fields/common.js';
import { EmailEventType, EmailFailureCategory } from '../enums/index.js';

export const emailDeliveryStatusSchema = z.enum([
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'RETRYING',
  'AMBIGUOUS',
  'CANCELLED',
  'SUPPRESSED',
  'RECEIVED'
]);
export type EmailDeliveryStatus = z.infer<typeof emailDeliveryStatusSchema>;

export const emailDeliveryProcessingStatusSchema = z.enum([
  'RECEIVED',
  'MATCHED',
  'UNMATCHED',
  'CORRELATION_PENDING',
  'AMBIGUOUS_MATCH',
  'IGNORED'
]);
export type EmailDeliveryProcessingStatus = z.infer<typeof emailDeliveryProcessingStatusSchema>;

export const emailAttachmentMetaSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number().nonnegative(),
  fileId: z.string().nullable().optional()
});
export type EmailAttachmentMeta = z.infer<typeof emailAttachmentMetaSchema>;

export const clickTrackingTokenSchema = z.object({
  token: z.string(),
  targetUrl: z.string()
});
export type ClickTrackingToken = z.infer<typeof clickTrackingTokenSchema>;

export const emailDeliverySchema = z.object({
  id: entityIdField,
  workspaceId: entityIdField,
  campaignId: entityIdFieldNullable.optional(),
  sequenceId: entityIdField,
  executionId: entityIdField,
  stepIndex: z.number().int().min(0),
  contactId: entityIdField,
  companyId: entityIdFieldNullable.optional(),
  accountId: entityIdField,
  senderEmail: z.string().email(),
  recipientEmail: z.string().email(),
  subject: z.string().min(1),
  htmlBody: z.string().nullable().optional(),
  textBody: z.string().nullable().optional(),
  attachments: z.array(emailAttachmentMetaSchema).default([]),
  provider: z.string().default('gmail'),
  messageId: z.string().nullable().optional(),
  providerMessageId: z.string().nullable().optional(),
  providerThreadId: z.string().nullable().optional(),
  status: emailDeliveryStatusSchema.default('QUEUED'),
  attempt: z.number().int().default(1),

  // Engagement tracking
  openTrackingToken: z.string().nullable().optional(),
  clickTrackingTokens: z.array(clickTrackingTokenSchema).default([]),
  firstOpenedAt: z.coerce.date().nullable().optional(),
  lastOpenedAt: z.coerce.date().nullable().optional(),
  openCount: z.number().int().nonnegative().default(0),
  firstClickedAt: z.coerce.date().nullable().optional(),
  lastClickedAt: z.coerce.date().nullable().optional(),
  clickCount: z.number().int().nonnegative().default(0),

  // Structured failure diagnostics
  error: z.string().nullable().optional(),
  failureCode: z.string().nullable().optional(),
  failureCategory: z.string().nullable().optional(),
  failureClassification: z.string().nullable().optional(),
  safeHumanMessage: z.string().nullable().optional(),
  technicalMessage: z.string().nullable().optional(),
  retryable: z.boolean().default(false).optional(),
  ambiguous: z.boolean().default(false).optional(),

  // Direction & Inbound Matching
  direction: z.enum(['OUTBOUND', 'INBOUND']).default('OUTBOUND'),
  inReplyTo: z.string().nullable().optional(),
  references: z.array(z.string()).default([]),
  matchedDeliveryId: entityIdFieldNullable.optional(),
  matchConfidence: z.enum(['thread', 'header', 'contact', 'manual', 'none']).nullable().optional(),
  processingStatus: emailDeliveryProcessingStatusSchema.default('MATCHED').optional(),
  hasReply: z.boolean().default(false).optional(),
  replyCount: z.number().int().nonnegative().default(0).optional(),
  lastRepliedAt: z.coerce.date().nullable().optional(),

  // Composition & Versioning Snapshot
  templateId: entityIdFieldNullable.optional(),
  templateVersion: z.number().int().positive().nullable().optional(),
  variablesSnapshot: z.record(z.string()).nullable().optional(),
  messageFingerprint: z.string().nullable().optional(),

  // Idempotency & Lease
  idempotencyKey: z.string().min(1).max(128),
  leaseExpiresAt: z.coerce.date().nullable().optional(),
  nextRetryAt: z.coerce.date().nullable().optional(),
  retryCount: z.number().int().default(0).optional(),
  reconciledAt: z.coerce.date().nullable().optional(),
  reconciliationNotes: z.string().nullable().optional(),
  reconciliationLeaseExpiresAt: z.coerce.date().nullable().optional(),
  reconciliationAttempts: z.number().int().nonnegative().default(0).optional(),
  nextReconciliationAt: z.coerce.date().nullable().optional(),
  snapshot: z.record(z.any()).nullable().optional(),
  sentAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});
export type EmailDelivery = z.infer<typeof emailDeliverySchema>;

export const emailEventSchema = z.object({
  id: entityIdField,
  workspaceId: entityIdField,
  deliveryId: entityIdField,
  contactId: entityIdFieldNullable.optional(),
  campaignId: entityIdFieldNullable.optional(),
  type: z.nativeEnum(EmailEventType),
  occurredAt: z.coerce.date(),
  receivedAt: z.coerce.date(),
  metadata: z.record(z.any()).nullable().optional(),
  dedupeKey: z.string()
});
export type EmailEvent = z.infer<typeof emailEventSchema>;

export const createEmailDeliveryDtoSchema = z.object({
  id: entityIdField.optional(),
  campaignId: entityIdFieldNullable.optional(),
  sequenceId: entityIdField,
  executionId: entityIdField,
  stepIndex: z.number().int().min(0),
  contactId: entityIdField,
  companyId: entityIdFieldNullable.optional(),
  accountId: entityIdField,
  senderEmail: z.string().email(),
  recipientEmail: z.string().email(),
  subject: z.string().min(1),
  htmlBody: z.string().nullable().optional(),
  textBody: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  inReplyTo: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  attachments: z.array(emailAttachmentMetaSchema).optional(),
  templateId: entityIdFieldNullable.optional(),
  templateVersion: z.number().int().positive().nullable().optional(),
  variablesSnapshot: z.record(z.string()).nullable().optional(),
  messageFingerprint: z.string().nullable().optional(),
  status: emailDeliveryStatusSchema.default('SENDING').optional(),
  idempotencyKey: z.string().min(1).max(128),
  snapshot: z.record(z.any()).nullable().optional()
});
export type CreateEmailDeliveryDto = z.infer<typeof createEmailDeliveryDtoSchema>;

export const reserveEmailDeliveryDtoSchema = z.object({
  id: entityIdField.optional(),
  campaignId: entityIdFieldNullable.optional(),
  sequenceId: entityIdField,
  executionId: entityIdField,
  stepIndex: z.number().int().min(0),
  contactId: entityIdField,
  companyId: entityIdFieldNullable.optional(),
  accountId: entityIdField,
  senderEmail: z.string().email(),
  recipientEmail: z.string().email(),
  subject: z.string().min(1),
  htmlBody: z.string().nullable().optional(),
  textBody: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  inReplyTo: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  attachments: z.array(emailAttachmentMetaSchema).optional(),
  templateId: entityIdFieldNullable.optional(),
  templateVersion: z.number().int().positive().nullable().optional(),
  variablesSnapshot: z.record(z.string()).nullable().optional(),
  messageFingerprint: z.string().nullable().optional(),
  openTrackingToken: z.string().nullable().optional(),
  clickTrackingTokens: z.array(clickTrackingTokenSchema).optional(),
  idempotencyKey: z.string().min(1).max(128),
  leaseDurationMs: z.number().int().min(1000).max(3600000).default(300000).optional(),
  snapshot: z.record(z.any()).nullable().optional()
});
export type ReserveEmailDeliveryDto = z.infer<typeof reserveEmailDeliveryDtoSchema>;

export const finalizeEmailDeliveryDtoSchema = z.object({
  status: z.enum(['SENT', 'FAILED', 'RETRYING', 'AMBIGUOUS', 'CANCELLED', 'SUPPRESSED']),
  messageId: z.string().nullable().optional(),
  providerMessageId: z.string().nullable().optional(),
  providerThreadId: z.string().nullable().optional(),
  inReplyTo: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
  failureClassification: z.string().nullable().optional(),
  failureCode: z.string().nullable().optional(),
  failureCategory: z.string().nullable().optional(),
  safeHumanMessage: z.string().nullable().optional(),
  technicalMessage: z.string().nullable().optional(),
  sentAt: z.coerce.date().nullable().optional(),
  nextRetryAt: z.coerce.date().nullable().optional()
});
export type FinalizeEmailDeliveryDto = z.infer<typeof finalizeEmailDeliveryDtoSchema>;

export const reconcileEmailDeliveryDtoSchema = z.object({
  action: z.enum(['mark_sent', 'mark_failed', 'retry', 'ignore']),
  providerMessageId: z.string().nullable().optional(),
  providerThreadId: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});
export type ReconcileEmailDeliveryDto = z.infer<typeof reconcileEmailDeliveryDtoSchema>;

export const updateEmailDeliveryDtoSchema = z.object({
  status: emailDeliveryStatusSchema,
  messageId: z.string().nullable().optional(),
  providerMessageId: z.string().nullable().optional(),
  providerThreadId: z.string().nullable().optional(),
  inReplyTo: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
  failureClassification: z.string().nullable().optional(),
  failureCode: z.string().nullable().optional(),
  failureCategory: z.string().nullable().optional(),
  safeHumanMessage: z.string().nullable().optional(),
  technicalMessage: z.string().nullable().optional(),
  sentAt: z.coerce.date().nullable().optional(),
  nextRetryAt: z.coerce.date().nullable().optional(),
  leaseExpiresAt: z.coerce.date().nullable().optional(),
  reconciledAt: z.coerce.date().nullable().optional(),
  reconciliationNotes: z.string().nullable().optional()
});
export type UpdateEmailDeliveryDto = z.infer<typeof updateEmailDeliveryDtoSchema>;

export const manualReconcileReplyDtoSchema = z.object({
  inboundDeliveryId: entityIdField,
  contactId: entityIdField,
  campaignId: entityIdFieldNullable.optional(),
  matchedDeliveryId: entityIdFieldNullable.optional(),
  notes: z.string().nullable().optional()
});
export type ManualReconcileReplyDto = z.infer<typeof manualReconcileReplyDtoSchema>;

