/**
 * LeadForge OS — Domain Pacing & Company Contact Cardinality Engine
 *
 * Deterministically controls outbound activity to prevent excessive concentration
 * of sends to the same recipient domain or company.
 */

export interface OutreachPacingConfig {
  /** Maximum distinct contacts from the same company permitted in active outreach per campaign. Default: 3. */
  maxContactsPerCompany: number;
  /** Rolling time window in milliseconds for company cardinality tracking. Default: 30 days (2,592,000,000 ms). */
  companyCardinalityWindowMs: number;
  /** Minimum elapsed milliseconds between outbound sends to the same destination domain. Default: 60,000 ms (1 minute). */
  minDomainIntervalMs: number;
  /** Maximum outbound sends to the same destination domain within the pacing window. Default: 1. */
  maxSendsPerDomainPerWindow: number;
  /** Rolling time window in milliseconds for domain pacing. Default: 60,000 ms (1 minute). */
  domainPacingWindowMs: number;
}

export const DEFAULT_OUTREACH_PACING_CONFIG: OutreachPacingConfig = {
  maxContactsPerCompany: 3,
  companyCardinalityWindowMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  minDomainIntervalMs: 60 * 1000, // 1 minute
  maxSendsPerDomainPerWindow: 1,
  domainPacingWindowMs: 60 * 1000 // 1 minute
};

/**
 * Normalizes an email address, website, or hostname into a clean, canonical destination domain.
 *
 * Examples:
 * - "Person@Example.com" -> "example.com"
 * - "user@sub.EXAMPLE.COM" -> "sub.example.com"
 * - "https://www.example.com/about" -> "example.com"
 * - "WWW.EXAMPLE.COM" -> "example.com"
 */
export function normalizeDomain(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';

  let hostPart = trimmed;

  // 1. If email address, extract right of '@'
  if (hostPart.includes('@')) {
    const parts = hostPart.split('@');
    hostPart = parts[parts.length - 1] || '';
  }

  // 2. Strip protocol, path, port if present
  if (hostPart.includes('://')) {
    try {
      const parsed = new URL(hostPart);
      hostPart = parsed.hostname;
    } catch {
      hostPart = hostPart.replace(/^[a-z]+:\/\//i, '').split('/')[0] || '';
    }
  } else if (hostPart.includes('/')) {
    hostPart = hostPart.split('/')[0] || '';
  }

  if (hostPart.includes(':')) {
    hostPart = hostPart.split(':')[0] || '';
  }

  // 3. Strip leading "www."
  hostPart = hostPart.replace(/^www\./i, '');

  if (!hostPart.includes('.')) {
    return '';
  }

  return hostPart.trim().toLowerCase();
}

export interface DeliverySummaryForPacing {
  recipientEmail?: string | null | undefined;
  recipientDomain?: string | null | undefined;
  createdAt: Date | string | number;
  sentAt?: Date | string | number | null | undefined;
  leaseExpiresAt?: Date | string | number | null | undefined;
  status: string;
}

export interface DomainPacingEvaluation {
  allowed: boolean;
  reason?: string | undefined;
  retryAfterSec?: number | undefined;
  lastSentAt?: Date | null | undefined;
}

/**
 * Pure evaluation function for domain pacing.
 * Evaluates whether a new send to the destination domain is permissible given recent deliveries.
 */
export function evaluateDomainPacing(
  domain: string,
  recentDeliveries: DeliverySummaryForPacing[],
  config: Partial<OutreachPacingConfig> = {},
  now: Date = new Date()
): DomainPacingEvaluation {
  const mergedConfig: OutreachPacingConfig = {
    ...DEFAULT_OUTREACH_PACING_CONFIG,
    ...config
  };

  const normTargetDomain = normalizeDomain(domain);
  if (!normTargetDomain) {
    return { allowed: true };
  }

  const nowMs = now.getTime();
  const windowStartMs = nowMs - mergedConfig.domainPacingWindowMs;

  let sendsInWindow = 0;
  let mostRecentMs = 0;

  for (const d of recentDeliveries) {
    const deliveryDomain = d.recipientDomain || normalizeDomain(d.recipientEmail);
    if (deliveryDomain && deliveryDomain !== normTargetDomain) continue;

    const dTime = new Date(d.sentAt || d.createdAt).getTime();
    const isSending = d.status === 'SENDING';
    const isSent = d.status === 'SENT';

    if (isSending) {
      const leaseExpiresAtMs = d.leaseExpiresAt ? new Date(d.leaseExpiresAt).getTime() : 0;
      const remainingLeaseMs = leaseExpiresAtMs > nowMs ? leaseExpiresAtMs - nowMs : mergedConfig.minDomainIntervalMs;
      const retryAfterSec = Math.max(1, Math.ceil(remainingLeaseMs / 1000));
      return {
        allowed: false,
        reason: `Domain pacing threshold reached for "${normTargetDomain}". Active delivery lease in progress.`,
        retryAfterSec,
        lastSentAt: dTime > 0 ? new Date(dTime) : null
      };
    }

    if (isSent && dTime >= windowStartMs) {
      sendsInWindow++;
      if (dTime > mostRecentMs) {
        mostRecentMs = dTime;
      }
    }
  }

  if (sendsInWindow >= mergedConfig.maxSendsPerDomainPerWindow) {
    const elapsedMs = mostRecentMs > 0 ? nowMs - mostRecentMs : 0;
    const remainingMs = Math.max(1000, mergedConfig.minDomainIntervalMs - elapsedMs);
    const retryAfterSec = Math.ceil(remainingMs / 1000);
    const elapsedSec = Math.round(elapsedMs / 1000);

    return {
      allowed: false,
      reason: `Domain pacing threshold reached for "${normTargetDomain}". Recent dispatch ${elapsedSec}s ago. Maximum ${mergedConfig.maxSendsPerDomainPerWindow} send(s) per ${mergedConfig.domainPacingWindowMs / 1000}s.`,
      retryAfterSec,
      lastSentAt: mostRecentMs > 0 ? new Date(mostRecentMs) : null
    };
  }

  return { allowed: true };
}

export interface CompanyCardinalityEvaluation {
  allowed: boolean;
  reason?: string | undefined;
  contactedCount: number;
  maxAllowed: number;
}

/**
 * Pure evaluation function for company contact cardinality.
 * Determines whether a contact from a company can be actively engaged in a campaign.
 */
export function evaluateCompanyCardinality(
  contactedContactIds: string[] = [],
  currentContactId: string | null | undefined,
  config: Partial<OutreachPacingConfig> = {}
): CompanyCardinalityEvaluation {
  const mergedConfig: OutreachPacingConfig = {
    ...DEFAULT_OUTREACH_PACING_CONFIG,
    ...config
  };

  const distinctContacted = new Set((contactedContactIds || []).filter(Boolean));
  const contactedCount = distinctContacted.size;

  // If current contact is already part of the contacted set, allow (e.g. sequence step 2)
  if (currentContactId && distinctContacted.has(currentContactId)) {
    return {
      allowed: true,
      contactedCount,
      maxAllowed: mergedConfig.maxContactsPerCompany
    };
  }

  // If new contact would exceed the limit, disallow
  if (contactedCount >= mergedConfig.maxContactsPerCompany) {
    return {
      allowed: false,
      reason: `Company contact cardinality limit reached (${contactedCount}/${mergedConfig.maxContactsPerCompany}). Cannot add new contact to active campaign outreach.`,
      contactedCount,
      maxAllowed: mergedConfig.maxContactsPerCompany
    };
  }

  return {
    allowed: true,
    contactedCount,
    maxAllowed: mergedConfig.maxContactsPerCompany
  };
}
