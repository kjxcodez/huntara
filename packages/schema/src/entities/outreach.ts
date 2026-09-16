import { z } from 'zod';
import { entityIdField, entityIdFieldNullable, nameField } from '../fields/common.js';

/**
 * Represents an attachment file metadata descriptor.
 * Durable binaries reside in Google Drive; metadata lives in MongoDB.
 */
export const attachmentItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  provider: z.enum(['google-drive', 'local']).default('google-drive'),
  fileId: z.string().nullable().optional(),
  driveUrl: z.string().nullable().optional(),
  googleConnectionId: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  storagePath: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  contentBase64: z.string().nullable().optional()
});
export type AttachmentItem = z.infer<typeof attachmentItemSchema>;

export const emailTemplateSchema = z.object({
  id: entityIdField,
  workspaceId: entityIdField,
  name: nameField,
  subject: z.string(),
  body: z.string(),
  variables: z.array(z.string()).default([]),
  attachments: z.array(attachmentItemSchema).optional().default([]),
  version: z.number().int().positive().default(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

export const templateVersionSchema = z.object({
  id: entityIdField,
  templateId: entityIdField,
  workspaceId: entityIdField,
  version: z.number().int().positive(),
  name: nameField,
  subject: z.string(),
  body: z.string(),
  variables: z.array(z.string()).default([]),
  attachments: z.array(attachmentItemSchema).default([]),
  createdAt: z.coerce.date()
});
export type TemplateVersion = z.infer<typeof templateVersionSchema>;

export const emailMessageSchema = z.object({
  messageId: z.string(),
  threadId: z.string().optional(),
  subject: z.string(),
  body: z.string()
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;

export const outreachSchema = z.object({
  id: entityIdField,
  workspaceId: entityIdField,
  contactId: entityIdField,
  campaignId: entityIdFieldNullable,
  companyId: entityIdFieldNullable,
  provider: z.string(),
  status: z.string(),
  attempts: z.number().int().nonnegative().default(0),
  lastSentAt: z.coerce.date().nullable().optional(),
  messageDetails: emailMessageSchema.nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});
export type Outreach = z.infer<typeof outreachSchema>;

export const testRecipientSchema = z.object({
  email: z.string().email(),
  firstUsedAt: z.union([z.date(), z.string()]).optional(),
  lastUsedAt: z.union([z.date(), z.string()]).optional()
});
export type TestRecipient = z.infer<typeof testRecipientSchema>;

/**
 * Per-mailbox send rate policy. All limits are optional; null means "use platform default".
 * The effective limit is always resolved server-side as:
 *   Platform default → workspace override → account override → platform ceiling.
 */
export const sendPolicySchema = z.object({
  dailyLimit: z.number().int().positive().nullable().optional(),
  hourlyLimit: z.number().int().positive().nullable().optional(),
  /** Minimum elapsed milliseconds between consecutive sends from this mailbox. */
  minSendIntervalMs: z.number().int().nonnegative().nullable().optional(),
  /**
   * Maximum number of concurrent in-flight sends from this mailbox.
   * Platform currently enforces 1 (one send at a time per mailbox).
   */
  maxConcurrent: z.number().int().min(1).optional()
}).optional();
export type SendPolicy = z.infer<typeof sendPolicySchema>;

/**
 * Mutable per-mailbox send state. Written atomically by reserveSendSlot().
 * Never written directly from the desktop or from API validation code.
 */
export const sendStateSchema = z.object({
  /** Number of sends in the current daily window. */
  dailySent: z.number().int().nonnegative().default(0),
  /** Number of sends in the current hourly window. */
  hourlySent: z.number().int().nonnegative().default(0),
  /** When the current daily window expires and counters are reset. */
  dailyResetAt: z.coerce.date(),
  /** When the current hourly window expires and counters are reset. */
  hourlyResetAt: z.coerce.date(),
  /** Timestamp of the most recent successful send. */
  lastSentAt: z.coerce.date().nullable().optional(),
  /** Earliest time the next send may be dispatched (enforces minSendIntervalMs). */
  nextSendAt: z.coerce.date().nullable().optional(),
  /** When the Google provider rate-limit expires. Null when not rate-limited. */
  rateLimitedUntil: z.coerce.date().nullable().optional(),
  /**
   * In-flight send lease. Non-null when a send is actively in progress.
   * Enforces maxConcurrent = 1 independently of timing constraints.
   * Expires automatically after leaseDurationMs (default 30 s) to prevent permanent lock
   * on worker crash.
   */
  sendLeaseExpiresAt: z.coerce.date().nullable().optional()
}).optional();
export type SendState = z.infer<typeof sendStateSchema>;

export const MailboxHealthState = {
  HEALTHY: 'HEALTHY',
  COOLDOWN: 'COOLDOWN',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  DISCONNECTED: 'DISCONNECTED',
  DEGRADED: 'DEGRADED',
  BLOCKED: 'BLOCKED'
} as const;
export type MailboxHealthState = (typeof MailboxHealthState)[keyof typeof MailboxHealthState];

export const mailboxHealthStateSchema = z.enum([
  'HEALTHY',
  'COOLDOWN',
  'AUTH_REQUIRED',
  'DISCONNECTED',
  'DEGRADED',
  'BLOCKED'
]);

export const emailAccountHealthSchema = z.object({
  state: mailboxHealthStateSchema.default('HEALTHY'),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  failureWindowStart: z.coerce.date().nullable().optional(),
  lastFailureAt: z.coerce.date().nullable().optional(),
  lastSuccessfulSendAt: z.coerce.date().nullable().optional(),
  lastFailureCategory: z.enum(['AUTH', 'RATE_LIMIT', 'NETWORK', 'INVALID_RECIPIENT', 'AMBIGUOUS']).nullable().optional(),
  cooldownUntil: z.coerce.date().nullable().optional(),
  operatorActionRequired: z.boolean().default(false),
  operatorMessage: z.string().nullable().optional()
}).optional();
export type EmailAccountHealth = z.infer<typeof emailAccountHealthSchema>;

export const emailAccountSchema = z.object({
  id: entityIdField,
  workspaceId: entityIdField.optional(),
  name: z.string(),
  email: z.string().email(),
  provider: z.enum(['gmail', 'gmail_oauth', 'unsupported']).default('gmail'),
  googleConnectionId: z.string().nullable().optional(),
  status: z.enum([
    'connected',
    'reauth_required',
    'disconnected',
    'failed',
    'disabled',
    'unsupported'
  ]).default('connected'),
  dailyLimit: z.number().int().default(200),
  hourlyLimit: z.number().int().default(50),
  dailySent: z.number().int().default(0),
  hourlySent: z.number().int().default(0),
  sendPolicy: sendPolicySchema,
  sendState: sendStateSchema,
  health: emailAccountHealthSchema,
  signature: z.string().nullable().optional(),
  testRecipients: z.array(testRecipientSchema).optional(),
  lastVerifiedAt: z.union([z.date(), z.string()]).nullable().optional(),
  lastError: z.string().nullable().optional(),
  googleAccountId: z.string().nullable().optional(),
  tokenExpiresAt: z.union([z.date(), z.string()]).nullable().optional(),
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()])
});
export type EmailAccount = z.infer<typeof emailAccountSchema>;

/**
 * Evaluates whether an email account is currently eligible to dispatch outreach.
 */
export function isMailboxEligibleForDispatch(
  account: {
    status?: string | null;
    health?: {
      state?: MailboxHealthState | string | null;
      cooldownUntil?: Date | string | null;
      consecutiveSendFailures?: number | null;
    } | null;
  },
  referenceTime: Date = new Date()
): { eligible: boolean; reason?: string } {
  if (account.status !== 'connected') {
    return {
      eligible: false,
      reason: `Account status is "${account.status || 'unknown'}", must be "connected"`
    };
  }

  const health = account.health;
  if (!health) {
    return { eligible: true };
  }

  const now = referenceTime;

  switch (health.state) {
    case 'HEALTHY':
      return { eligible: true };

    case 'COOLDOWN': {
      if (health.cooldownUntil && new Date(health.cooldownUntil) > now) {
        return {
          eligible: false,
          reason: `Mailbox is in cooldown until ${new Date(health.cooldownUntil).toISOString()}`
        };
      }
      return { eligible: true };
    }

    case 'AUTH_REQUIRED':
      return {
        eligible: false,
        reason: 'Mailbox requires re-authentication before sending can resume'
      };

    case 'BLOCKED':
      return {
        eligible: false,
        reason: 'Mailbox is blocked by provider or administrator'
      };

    case 'DEGRADED':
      return { eligible: true };

    case 'DISCONNECTED':
      return {
        eligible: false,
        reason: 'Mailbox is disconnected'
      };

    default:
      return { eligible: true };
  }
}




export const audienceSchema = z.object({
  id: entityIdField,
  workspaceId: entityIdField,
  name: nameField,
  description: z.string().nullable().optional(),
  entityType: z.enum(['companies', 'contacts', 'both']).default('contacts'),
  mode: z.enum(['dynamic', 'static']).default('dynamic'),
  filterDefinition: z.record(z.any()).default({}),
  staticMemberIds: z.array(z.string()).optional(),
  contactCount: z.number().optional(),
  companyCount: z.number().optional(),
  resolvedContactIds: z.array(z.string()).optional(),
  resolvedCompanyIds: z.array(z.string()).optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  updatedAt: z.union([z.date(), z.string()]).optional()
});
export type Audience = z.infer<typeof audienceSchema>;


