/**
 * LeadForge OS — Campaign Lifecycle & Outreach Eligibility Policy
 *
 * Authoritative, server-grade decision engine for:
 * 1. Campaign state transitions (DRAFT -> ACTIVE -> PAUSED -> STOPPED -> COMPLETED / FAILED)
 * 2. Send authorization gates (worker & API boundaries)
 * 3. Contact outreach eligibility (suppression, validation, affiliation, and status checks)
 * 4. Contact status lifecycle transitions (monotonic progression)
 */

import { CampaignStatus, ContactStatus, ContactEmailStatus } from '../enums/index.js';
import { isDisposableEmailDomain } from './disposable-domains.js';

// ── 1. Campaign State Machine ──────────────────────────────────────────────────

/**
 * Permitted campaign lifecycle transitions.
 * Terminal states (STOPPED, COMPLETED, FAILED) cannot transition to any other state.
 */
export const VALID_CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  [CampaignStatus.DRAFT]: [CampaignStatus.ACTIVE, CampaignStatus.STOPPED],
  [CampaignStatus.ACTIVE]: [CampaignStatus.PAUSED, CampaignStatus.STOPPED, CampaignStatus.COMPLETED, CampaignStatus.FAILED],
  [CampaignStatus.PAUSED]: [CampaignStatus.ACTIVE, CampaignStatus.STOPPED, CampaignStatus.FAILED],
  [CampaignStatus.STOPPED]: [], // Terminal
  [CampaignStatus.COMPLETED]: [], // Terminal
  [CampaignStatus.FAILED]: [] // Terminal
};

/**
 * Asserts whether a campaign transition from `currentStatus` to `nextStatus` is valid.
 */
export function isValidCampaignTransition(
  currentStatus: CampaignStatus | string,
  nextStatus: CampaignStatus | string
): boolean {
  const cur = (String(currentStatus || '').toUpperCase()) as CampaignStatus;
  const next = (String(nextStatus || '').toUpperCase()) as CampaignStatus;
  if (cur === next) return true;
  const allowed = VALID_CAMPAIGN_TRANSITIONS[cur];
  if (!allowed) return false;
  return allowed.includes(next);
}

/**
 * Checks whether a campaign is currently authorized to dispatch outbound sends.
 * Only ACTIVE campaigns are authorized.
 */
export function isCampaignSendAuthorized(status: CampaignStatus | string | null | undefined): boolean {
  if (!status) return false;
  return String(status).toUpperCase() === CampaignStatus.ACTIVE;
}

// ── 2. Contact Outreach Eligibility ──────────────────────────────────────────

export type OutreachIneligibilityReason =
  | 'CONTACT_MISSING_EMAIL'
  | 'CONTACT_UNSUBSCRIBED'
  | 'CONTACT_BOUNCED'
  | 'CONTACT_DO_NOT_CONTACT'
  | 'CONTACT_ARCHIVED'
  | 'CONTACT_REPLIED'
  | 'EMAIL_SUPPRESSED'
  | 'COMPANY_DNC'
  | 'DOMAIN_SUPPRESSED'
  | 'EMAIL_DISPOSABLE'
  | 'EMAIL_INVALID'
  | 'EMAIL_QUARANTINED'
  | 'EMAIL_THIRD_PARTY'
  | 'DOMAIN_UNMATCHED'
  | 'CAMPAIGN_STOPPED'
  | 'CAMPAIGN_PAUSED'
  | 'CAMPAIGN_NOT_ACTIVE'
  | 'ALREADY_CONTACTED'
  | 'ALREADY_EXECUTED'
  | 'DOMAIN_PACING_THROTTLED'
  | 'COMPANY_CARDINALITY_EXCEEDED';

export interface OutreachEligibilityInput {
  contact: {
    id?: string | null | undefined;
    email?: string | null | undefined;
    bouncedEmail?: string | null | undefined;
    status?: string | null | undefined;
    emailStatus?: string | null | undefined;
    emailQuality?: {
      sendable?: boolean | undefined;
      status?: string | undefined;
      riskLevel?: string | undefined;
      reasons?: string[] | undefined;
    } | null | undefined;
    emailMeta?: {
      confidenceTier?: string | null | undefined;
      domainMatched?: boolean | null | undefined;
    } | null | undefined;
  };
  recipientEmail?: string | null | undefined;
  bouncedEmail?: string | null | undefined;
  suppression?: {
    reason?: string | undefined;
  } | boolean | null | undefined;
  companySuppressed?: boolean | null | undefined;
  domainSuppressed?: boolean | null | undefined;
  campaign?: {
    id?: string | null | undefined;
    status?: string | null | undefined;
  } | null | undefined;
  context?: {
    alreadyContactedIds?: Set<string> | undefined;
    alreadyExecutedIds?: Set<string> | undefined;
  } | null | undefined;
}

export interface OutreachEligibilityResult {
  eligible: boolean;
  reason?: OutreachIneligibilityReason;
}

/**
 * Authoritative single decision function for evaluating contact outreach eligibility.
 * Evaluates contact state, email quality status, domain affiliation, and campaign state.
 */
export function evaluateOutreachEligibility(input: OutreachEligibilityInput): OutreachEligibilityResult {
  const { contact, campaign, context, suppression, companySuppressed, domainSuppressed } = input;
  const targetEmail = input.recipientEmail || contact.email;

  // 1. Email existence
  if (!targetEmail || typeof targetEmail !== 'string' || !targetEmail.includes('@')) {
    return { eligible: false, reason: 'CONTACT_MISSING_EMAIL' };
  }

  // 1a. Explicit suppression checks (Dedicated suppression records)
  if (suppression) {
    return { eligible: false, reason: 'EMAIL_SUPPRESSED' };
  }
  if (companySuppressed) {
    return { eligible: false, reason: 'COMPANY_DNC' };
  }
  if (domainSuppressed) {
    return { eligible: false, reason: 'DOMAIN_SUPPRESSED' };
  }

  // 2. Contact CRM status (suppression checks)
  const contactStatus = (contact.status || '').toUpperCase();
  if (contactStatus === ContactStatus.UNSUBSCRIBED || contactStatus === 'UNSUBSCRIBED') {
    return { eligible: false, reason: 'CONTACT_UNSUBSCRIBED' };
  }
  if (contactStatus === ContactStatus.BOUNCED || contactStatus === 'BOUNCED') {
    // Multi-address bounce isolation: If contact bounced on a different address (e.g. primary bounced
    // but secondary is being dispatched, or vice-versa), do not block an unrelated valid address.
    const cleanBounced = (input.bouncedEmail || contact.bouncedEmail)?.toLowerCase().trim();
    const cleanTarget = targetEmail.toLowerCase().trim();
    if (cleanBounced && cleanBounced !== cleanTarget) {
      // Address is distinct from the bounced address on this contact: proceed to address-level checks.
    } else {
      return { eligible: false, reason: 'CONTACT_BOUNCED' };
    }
  }
  if (contactStatus === ContactStatus.DO_NOT_CONTACT || contactStatus === 'DO_NOT_CONTACT') {
    return { eligible: false, reason: 'CONTACT_DO_NOT_CONTACT' };
  }
  if (contactStatus === ContactStatus.ARCHIVED || contactStatus === 'ARCHIVED') {
    return { eligible: false, reason: 'CONTACT_ARCHIVED' };
  }
  if (contactStatus === ContactStatus.REPLIED || contactStatus === 'REPLIED') {
    return { eligible: false, reason: 'CONTACT_REPLIED' };
  }

  // 2a. Disposable domain check
  const domain = targetEmail.split('@')[1];
  if (isDisposableEmailDomain(domain)) {
    return { eligible: false, reason: 'EMAIL_DISPOSABLE' };
  }

  // 2b. Explicit structured email quality evaluation
  if (contact.emailQuality) {
    if (contact.emailQuality.sendable === false) {
      if (contact.emailQuality.status === 'SUPPRESSED') {
        return { eligible: false, reason: 'EMAIL_SUPPRESSED' };
      }
      if (contact.emailQuality.status === 'DISPOSABLE') {
        return { eligible: false, reason: 'EMAIL_DISPOSABLE' };
      }
      if (contact.emailQuality.status === 'QUARANTINED') {
        return { eligible: false, reason: 'EMAIL_QUARANTINED' };
      }
      return { eligible: false, reason: 'EMAIL_INVALID' };
    }
  }

  // 3. Email quality / candidate correctness status
  const emailStatus = (contact.emailStatus || '').toUpperCase();
  if (emailStatus === ContactEmailStatus.QUARANTINED || emailStatus === 'QUARANTINED') {
    return { eligible: false, reason: 'EMAIL_QUARANTINED' };
  }
  if (emailStatus === ContactEmailStatus.INVALID || emailStatus === 'INVALID') {
    return { eligible: false, reason: 'EMAIL_INVALID' };
  }

  // 4. Candidate metadata & domain affiliation
  if (contact.emailMeta) {
    const tier = (contact.emailMeta.confidenceTier || '').toLowerCase();
    if (tier === 'quarantined' || tier === 'ambiguous') {
      return { eligible: false, reason: 'EMAIL_QUARANTINED' };
    }
    if (tier === 'invalid') {
      return { eligible: false, reason: 'EMAIL_INVALID' };
    }
    if (tier === 'third_party' || contact.emailMeta.domainMatched === false) {
      return { eligible: false, reason: 'EMAIL_THIRD_PARTY' };
    }
  }

  // 5. Campaign state authorization
  if (campaign && campaign.status) {
    const campStatus = String(campaign.status).toUpperCase();
    if (campStatus === CampaignStatus.STOPPED) {
      return { eligible: false, reason: 'CAMPAIGN_STOPPED' };
    }
    if (campStatus === CampaignStatus.PAUSED) {
      return { eligible: false, reason: 'CAMPAIGN_PAUSED' };
    }
    if (campStatus !== CampaignStatus.ACTIVE) {
      return { eligible: false, reason: 'CAMPAIGN_NOT_ACTIVE' };
    }
  }

  // 6. Contextual execution deduplication
  if (contact.id && context) {
    if (context.alreadyContactedIds?.has(contact.id)) {
      return { eligible: false, reason: 'ALREADY_CONTACTED' };
    }
    if (context.alreadyExecutedIds?.has(contact.id)) {
      return { eligible: false, reason: 'ALREADY_EXECUTED' };
    }
  }

  return { eligible: true };
}

// ── 3. Contact Lifecycle State Transitions ────────────────────────────────────

/**
 * Valid transitions for ContactStatus.
 * Progression: NEW -> CONTACTED -> REPLIED (or BOUNCED / UNSUBSCRIBED / DO_NOT_CONTACT).
 * Terminal suppression states (BOUNCED, UNSUBSCRIBED, DO_NOT_CONTACT) cannot be reversed to CONTACTED.
 */
export const VALID_CONTACT_TRANSITIONS: Record<ContactStatus, ContactStatus[]> = {
  [ContactStatus.NEW]: [
    ContactStatus.CONTACTED,
    ContactStatus.REPLIED,
    ContactStatus.BOUNCED,
    ContactStatus.UNSUBSCRIBED,
    ContactStatus.DO_NOT_CONTACT,
    ContactStatus.ARCHIVED
  ],
  [ContactStatus.CONTACTED]: [
    ContactStatus.REPLIED,
    ContactStatus.BOUNCED,
    ContactStatus.UNSUBSCRIBED,
    ContactStatus.DO_NOT_CONTACT,
    ContactStatus.ARCHIVED
  ],
  [ContactStatus.REPLIED]: [
    ContactStatus.BOUNCED,
    ContactStatus.UNSUBSCRIBED,
    ContactStatus.DO_NOT_CONTACT,
    ContactStatus.ARCHIVED
  ],
  [ContactStatus.BOUNCED]: [ContactStatus.DO_NOT_CONTACT, ContactStatus.ARCHIVED],
  [ContactStatus.UNSUBSCRIBED]: [ContactStatus.DO_NOT_CONTACT, ContactStatus.ARCHIVED],
  [ContactStatus.DO_NOT_CONTACT]: [ContactStatus.ARCHIVED],
  [ContactStatus.ARCHIVED]: [ContactStatus.NEW] // Can unarchive
};

export function canTransitionContactStatus(current: ContactStatus | string, next: ContactStatus | string): boolean {
  const cur = (String(current || '').toUpperCase()) as ContactStatus;
  const target = (String(next || '').toUpperCase()) as ContactStatus;
  if (cur === target) return true;
  const allowed = VALID_CONTACT_TRANSITIONS[cur];
  if (!allowed) return false;
  return allowed.includes(target);
}

/**
 * Evaluates whether an administrative unsuppression or operator correction
 * can safely restore a contact's status to CONTACTED or NEW.
 *
 * Invariants (UNSUPPRESS-13):
 * 1. BOUNCED can be restored to CONTACTED or NEW when suppression is lifted.
 * 2. Higher-priority safety states (REPLIED, UNSUBSCRIBED, DO_NOT_CONTACT) can NEVER
 *    be overridden or undone by unsuppression.
 */
export function canRestoreContactStatus(current: ContactStatus | string, target: ContactStatus | string = ContactStatus.CONTACTED): boolean {
  const cur = (String(current || '').toUpperCase()) as ContactStatus;
  const tgt = (String(target || '').toUpperCase()) as ContactStatus;
  if (cur === ContactStatus.BOUNCED) {
    return tgt === ContactStatus.CONTACTED || tgt === ContactStatus.NEW;
  }
  if (cur === ContactStatus.NEW || cur === ContactStatus.CONTACTED) {
    return true;
  }
  // REPLIED, UNSUBSCRIBED, DO_NOT_CONTACT, ARCHIVED cannot be overwritten by unsuppression
  return false;
}

