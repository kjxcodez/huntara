export enum CompanyStatus {
  LEAD = 'LEAD',
  QUALIFIED = 'QUALIFIED',
  CUSTOMER = 'CUSTOMER',
  ARCHIVED = 'ARCHIVED'
}

export enum OpportunityStage {
  PROSPECTING = 'PROSPECTING',
  QUALIFICATION = 'QUALIFICATION',
  PROPOSAL = 'PROPOSAL',
  NEGOTIATION = 'NEGOTIATION',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST'
}

export enum OutreachChannel {
  EMAIL = 'EMAIL',
  LINKEDIN = 'LINKEDIN',
  CALL = 'CALL'
}

/**
 * Email account provider identifiers. `gmail_oauth` represents a Gmail
 * mailbox connected through Google OAuth 2.0 (Gmail API, gmail.send scope).
 */
export enum EmailAccountProvider {
  GMAIL_OAUTH = 'gmail_oauth',
  OTHER = 'other'
}

/**
 * Mailbox connection states.
 * - CONNECTED: OAuth tokens valid and sending is permitted.
 * - REAUTH_REQUIRED: access/refresh token expired, revoked, or invalid —
 *   the user must re-authorize the mailbox.
 * - DISCONNECTED: the mailbox was intentionally disconnected/revoked.
 * - FAILED: last verification/send attempt failed.
 * - DISABLED: account administratively disabled.
 */
export enum EmailAccountStatus {
  CONNECTED = 'connected',
  REAUTH_REQUIRED = 'reauth_required',
  DISCONNECTED = 'disconnected',
  FAILED = 'failed',
  DISABLED = 'disabled'
}

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER'
}

export enum WorkflowStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR'
}

export enum WorkflowStepType {
  DISCOVER = 'DISCOVER',
  ENRICH = 'ENRICH',
  VERIFY = 'VERIFY',
  QUALIFY = 'QUALIFY',
  SEND = 'SEND'
}

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum CampaignPauseReason {
  USER_REQUESTED = 'USER_REQUESTED',
  MAILBOX_DISCONNECTED = 'MAILBOX_DISCONNECTED',
  OUTBOUND_REJECTION_CIRCUIT_BREAKER = 'OUTBOUND_REJECTION_CIRCUIT_BREAKER'
}

export enum ContactStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  REPLIED = 'REPLIED',
  BOUNCED = 'BOUNCED',
  UNSUBSCRIBED = 'UNSUBSCRIBED',
  DO_NOT_CONTACT = 'DO_NOT_CONTACT',
  ARCHIVED = 'ARCHIVED'
}

export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  EMAIL_RATE_LIMITED = 'EMAIL_RATE_LIMITED',
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED'
}

export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500
}

export enum WorkspaceRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  READ_ONLY = 'READ_ONLY',
  BILLING = 'BILLING'
}

export enum WorkspacePermission {
  MANAGE_WORKSPACE = 'MANAGE_WORKSPACE',
  INVITE_MEMBERS = 'INVITE_MEMBERS',
  MANAGE_MEMBERS = 'MANAGE_MEMBERS',
  TRANSFER_OWNERSHIP = 'TRANSFER_OWNERSHIP',
  VIEW_SETTINGS = 'VIEW_SETTINGS',
  CREATE_CAMPAIGNS = 'CREATE_CAMPAIGNS'
}

export enum WorkspaceMemberStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED'
}

export enum AutomationTriggerType {
  CONTACT_CREATED = 'CONTACT_CREATED',
  COMPANY_CREATED = 'COMPANY_CREATED',
  DISCOVERY_IMPORT_COMPLETED = 'DISCOVERY_IMPORT_COMPLETED',
  CAMPAIGN_COMPLETED = 'CAMPAIGN_COMPLETED',
  EMAIL_SENT = 'EMAIL_SENT',
  EMAIL_REPLIED = 'EMAIL_REPLIED',
  EMAIL_BOUNCED = 'EMAIL_BOUNCED',
  TAG_ADDED = 'TAG_ADDED',
  PIPELINE_STAGE_CHANGED = 'PIPELINE_STAGE_CHANGED',
  MANUAL = 'MANUAL'
}

export enum AutomationActionType {
  WAIT = 'WAIT',
  SEND_EMAIL = 'SEND_EMAIL',
  ASSIGN_TAG = 'ASSIGN_TAG',
  REMOVE_TAG = 'REMOVE_TAG',
  CREATE_NOTE = 'CREATE_NOTE',
  MOVE_PIPELINE_STAGE = 'MOVE_PIPELINE_STAGE',
  START_CAMPAIGN = 'START_CAMPAIGN',
  STOP_CAMPAIGN = 'STOP_CAMPAIGN',
  ASSIGN_OWNER = 'ASSIGN_OWNER',
  CREATE_ACTIVITY = 'CREATE_ACTIVITY',
  FINISH_SEQUENCE = 'FINISH_SEQUENCE'
}

export enum AutomationConditionType {
  HAS_TAG = 'HAS_TAG',
  NO_REPLY_RECEIVED = 'NO_REPLY_RECEIVED',
  REPLY_RECEIVED = 'REPLY_RECEIVED',
  EMAIL_BOUNCED = 'EMAIL_BOUNCED',
  CAMPAIGN_FINISHED = 'CAMPAIGN_FINISHED',
  PIPELINE_STAGE = 'PIPELINE_STAGE',
  LEAD_SCORE = 'LEAD_SCORE',
  COMPANY_INDUSTRY = 'COMPANY_INDUSTRY',
  COMPANY_SIZE = 'COMPANY_SIZE'
}

export enum SequenceStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED'
}

export enum ExecutionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  WAITING = 'WAITING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

/**
 * Email address validation lifecycle status for contacts.
 * - VALID: Address passed all validation checks and can receive outreach.
 * - UNVERIFIED: Address has not been checked (default for newly scraped contacts).
 * - QUARANTINED: Address was identified as corrupted or ambiguous; excluded from outreach
 *   until a human reviews and resolves it.
 * - INVALID: Address was checked and is definitively invalid (e.g. permanent bounce).
 */
export enum ContactEmailStatus {
  VALID = 'VALID',
  UNVERIFIED = 'UNVERIFIED',
  QUARANTINED = 'QUARANTINED',
  INVALID = 'INVALID'
}

export enum EmailEventType {
  DELIVERED = 'DELIVERED',
  BOUNCED = 'BOUNCED',
  OPENED = 'OPENED',
  CLICKED = 'CLICKED',
  REPLIED = 'REPLIED'
}

export enum EmailFailureCategory {
  AUTH = 'AUTH',
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_RECIPIENT = 'INVALID_RECIPIENT',
  POLICY = 'POLICY',
  NETWORK = 'NETWORK',
  PROVIDER = 'PROVIDER',
  INTERNAL = 'INTERNAL',
  AMBIGUOUS = 'AMBIGUOUS'
}

/**
 * Phase 10: Multi-dimensional email quality statuses.
 * Explicitly separates syntax, domain, MX, mailbox, disposable, and suppression states.
 */
export enum EmailQualityStatus {
  UNKNOWN = 'UNKNOWN',
  DISCOVERED = 'DISCOVERED',
  SYNTAX_VALID = 'SYNTAX_VALID',
  DOMAIN_VALID = 'DOMAIN_VALID',
  MX_VALID = 'MX_VALID',
  VERIFIED = 'VERIFIED',
  RISKY = 'RISKY',
  DISPOSABLE = 'DISPOSABLE',
  ROLE_ACCOUNT = 'ROLE_ACCOUNT',
  INVALID = 'INVALID',
  SUPPRESSED = 'SUPPRESSED'
}

/**
 * Target entity type for workspace suppression policies.
 */
export enum SuppressionTargetType {
  RECIPIENT = 'recipient',
  COMPANY = 'company',
  DOMAIN = 'domain'
}

/**
 * Phase 10: Structured reasons for contact / email address / company / domain suppression.
 * Follows strict precedence hierarchy: DO_NOT_CONTACT > COMPANY_DNC > DOMAIN_SUPPRESSION > UNSUBSCRIBED > SPAM_COMPLAINT > HARD_BOUNCE > MANUAL_SUPPRESSION > POLICY_BLOCK > INVALID_EMAIL.
 */
export enum SuppressionReason {
  DO_NOT_CONTACT = 'DO_NOT_CONTACT',
  UNSUBSCRIBED = 'UNSUBSCRIBED',
  SPAM_COMPLAINT = 'SPAM_COMPLAINT',
  HARD_BOUNCE = 'HARD_BOUNCE',
  MANUAL_SUPPRESSION = 'MANUAL_SUPPRESSION',
  POLICY_BLOCK = 'POLICY_BLOCK',
  INVALID_EMAIL = 'INVALID_EMAIL',
  COMPANY_DNC = 'COMPANY_DNC',
  DOMAIN_SUPPRESSION = 'DOMAIN_SUPPRESSION'
}

/**
 * Phase 10: Canonical classification of bounce and rejection events.
 */
export enum BounceCategory {
  HARD_BOUNCE = 'HARD_BOUNCE',
  SOFT_BOUNCE = 'SOFT_BOUNCE',
  MAILBOX_UNAVAILABLE = 'MAILBOX_UNAVAILABLE',
  DOMAIN_UNAVAILABLE = 'DOMAIN_UNAVAILABLE',
  POLICY_REJECTION = 'POLICY_REJECTION',
  AUTHENTICATION_REJECTION = 'AUTHENTICATION_REJECTION',
  RATE_LIMIT = 'RATE_LIMIT',
  SPAM_REJECTION = 'SPAM_REJECTION',
  UNKNOWN = 'UNKNOWN'
}
