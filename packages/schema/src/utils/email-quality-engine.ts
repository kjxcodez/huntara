/**
 * LeadForge OS — Phase 10: Authoritative Email Quality Decision Engine
 *
 * Enforces the central product invariants:
 * 1. Never represent an email as "verified" merely because it passes syntax validation or has MX records.
 * 2. Never claim mailbox existence without explicit evidence.
 * 3. Preserve distinction between syntax, domain, MX, mailbox verification, delivery, and suppression.
 * 4. Deterministic suppression precedence: stronger suppressions can never be cleared by weaker positive events.
 */

import { EmailQualityStatus, SuppressionReason, BounceCategory } from '../enums/index.js';
import type {
  EmailQualityEvidence,
  EmailQualityResult,
  EmailRiskLevel,
  EmailRecommendedAction
} from '../entities/email-quality.js';
import { isDisposableEmailDomain } from './disposable-domains.js';
import { isKnownRoleAccount, validateEmailStrict, evaluateEmailCandidate } from './email-sanitizer.js';

export const SUPPRESSION_PRECEDENCE_WEIGHTS: Record<SuppressionReason, number> = {
  [SuppressionReason.DO_NOT_CONTACT]: 100,
  [SuppressionReason.COMPANY_DNC]: 95,
  [SuppressionReason.DOMAIN_SUPPRESSION]: 92,
  [SuppressionReason.UNSUBSCRIBED]: 90,
  [SuppressionReason.SPAM_COMPLAINT]: 80,
  [SuppressionReason.HARD_BOUNCE]: 70,
  [SuppressionReason.MANUAL_SUPPRESSION]: 60,
  [SuppressionReason.POLICY_BLOCK]: 50,
  [SuppressionReason.INVALID_EMAIL]: 40
};

/**
 * Returns numeric weight for suppression reason. Higher weight = stronger suppression.
 */
export function getSuppressionWeight(reason: SuppressionReason): number {
  return SUPPRESSION_PRECEDENCE_WEIGHTS[reason] || 0;
}

/**
 * Compares two suppression reasons according to deterministic precedence hierarchy.
 * Returns positive if `a` is strictly stronger than `b`, negative if weaker, 0 if equal.
 */
export function compareSuppressionPrecedence(a: SuppressionReason, b: SuppressionReason): number {
  return getSuppressionWeight(a) - getSuppressionWeight(b);
}

/**
 * Evaluates whether an evidence item is still fresh based on its expiresAt timestamp.
 */
export function isEvidenceFresh(evidence: EmailQualityEvidence, now: Date = new Date()): boolean {
  if (!evidence.expiresAt) return true;
  const expiry = new Date(evidence.expiresAt);
  return expiry.getTime() > now.getTime();
}

export interface EvaluateEmailQualityInput {
  email: string;
  evidence?: EmailQualityEvidence[] | undefined;
  suppression?: {
    reason: SuppressionReason;
    suppressedAt: string | Date;
  } | null | undefined;
  historicalDeliveries?: Array<{
    status: string;
    failureCategory?: string | undefined;
    hasReply?: boolean | undefined;
    lastRepliedAt?: Date | string | undefined;
    sentAt?: Date | string | undefined;
  }> | undefined;
  now?: Date | undefined;
}

/**
 * Canonical deterministic decision function evaluating complete email deliverability and safety.
 * Used identically by campaign workers, audience builders, API direct-send gates, and UI inspectors.
 */
export function evaluateEmailQuality(input: EvaluateEmailQualityInput): EmailQualityResult {
  const { email, evidence = [], suppression, historicalDeliveries = [] } = input;
  const now = input.now || new Date();
  const evaluatedAt = now.toISOString();

  const reasons: string[] = [];
  const accumulatedEvidence: EmailQualityEvidence[] = [...evidence];

  const rawEmail = String(email || '').trim().toLowerCase();

  // ── 1. Suppression Precedence Gate (Highest Priority) ────────────────────────
  if (suppression) {
    const reasonText = suppression.reason;
    reasons.push(`Contact is suppressed: ${reasonText}`);
    return {
      email: rawEmail,
      status: EmailQualityStatus.SUPPRESSED,
      sendable: false,
      riskLevel: 'prohibited',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'do_not_send',
      evaluatedAt
    };
  }

  // ── 2. Syntax & RFC Validation Gate ──────────────────────────────────────────
  if (!rawEmail || !rawEmail.includes('@')) {
    reasons.push('Invalid email: missing @ or empty address');
    return {
      email: rawEmail,
      status: EmailQualityStatus.INVALID,
      sendable: false,
      riskLevel: 'prohibited',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'do_not_send',
      evaluatedAt
    };
  }

  const candidate = evaluateEmailCandidate(rawEmail, { sourceType: 'manual' });
  if (!candidate.syntaxValid || !candidate.domainValid || !candidate.isIcannTld || candidate.repaired) {
    reasons.push(`Syntax or domain structure invalid (${candidate.quarantineReason || 'malformed address'})`);
    accumulatedEvidence.push({
      id: `syntax_${Date.now()}`,
      source: 'syntax',
      observedAt: evaluatedAt,
      result: 'fail',
      confidence: 1.0,
      details: {
        syntaxValid: candidate.syntaxValid,
        domainValid: candidate.domainValid,
        isIcannTld: candidate.isIcannTld,
        repaired: candidate.repaired
      }
    });

    return {
      email: rawEmail,
      status: EmailQualityStatus.INVALID,
      sendable: false,
      riskLevel: 'prohibited',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'do_not_send',
      evaluatedAt
    };
  }

  accumulatedEvidence.push({
    id: `syntax_${Date.now()}`,
    source: 'syntax',
    observedAt: evaluatedAt,
    result: 'pass',
    confidence: 1.0,
    details: { localPart: candidate.localPart, domain: candidate.domain }
  });

  const domain = candidate.domain || rawEmail.split('@')[1] || '';
  const localPart = candidate.localPart || rawEmail.split('@')[0] || '';

  // ── 3. Disposable Domain Intelligence ────────────────────────────────────────
  if (isDisposableEmailDomain(domain)) {
    reasons.push(`Disposable / temporary email domain detected: "${domain}"`);
    accumulatedEvidence.push({
      id: `disposable_${Date.now()}`,
      source: 'disposable_db',
      observedAt: evaluatedAt,
      result: 'fail',
      confidence: 0.99,
      details: { domain }
    });

    return {
      email: rawEmail,
      status: EmailQualityStatus.DISPOSABLE,
      sendable: false,
      riskLevel: 'high',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'do_not_send',
      evaluatedAt
    };
  }

  // ── 4. Historical Deliveries & Hard Bounce Analysis ──────────────────────────
  const hasHardBounce = historicalDeliveries.some(
    (d) =>
      d.status === 'BOUNCED' ||
      d.status === 'FAILED' && d.failureCategory === 'INVALID_RECIPIENT'
  );

  if (hasHardBounce) {
    reasons.push('Prior delivery failed permanently (hard bounce / invalid recipient)');
    accumulatedEvidence.push({
      id: `hist_bounce_${Date.now()}`,
      source: 'historical_bounce',
      observedAt: evaluatedAt,
      result: 'fail',
      confidence: 0.95,
      details: { hasHardBounce: true }
    });

    return {
      email: rawEmail,
      status: EmailQualityStatus.INVALID,
      sendable: false,
      riskLevel: 'prohibited',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'do_not_send',
      evaluatedAt
    };
  }

  // Check for positive historical reply
  const hasHistoricalReply = historicalDeliveries.some((d) => d.hasReply === true);
  if (hasHistoricalReply) {
    accumulatedEvidence.push({
      id: `hist_reply_${Date.now()}`,
      source: 'historical_delivery',
      observedAt: evaluatedAt,
      result: 'pass',
      confidence: 0.90,
      details: { hasReply: true }
    });
    reasons.push('Historical inbound reply observed from recipient');
  }

  // ── 5. Role Account Check ───────────────────────────────────────────────────
  const isRole = isKnownRoleAccount(localPart);
  if (isRole) {
    reasons.push(`Role / department account local-part ("${localPart}")`);
    accumulatedEvidence.push({
      id: `role_${Date.now()}`,
      source: 'role_account',
      observedAt: evaluatedAt,
      result: 'risky',
      confidence: 0.85,
      details: { localPart }
    });
  }

  // ── 6. Inspection of External & DNS Evidence ────────────────────────────────
  const freshEvidence = evidence.filter((e) => isEvidenceFresh(e, now));
  const staleCount = evidence.length - freshEvidence.length;
  if (staleCount > 0) {
    reasons.push(`${staleCount} evidence record(s) expired / stale`);
  }

  const mxEvidence = freshEvidence.find((e) => e.source === 'mx');
  const verificationEvidence = freshEvidence.find(
    (e) => e.source === 'verification_provider'
  );
  const catchAllEvidence = freshEvidence.find((e) => e.source === 'catch_all');

  // Explicit MX failure
  if (mxEvidence && mxEvidence.result === 'fail') {
    reasons.push('Domain does not publish usable MX records');
    return {
      email: rawEmail,
      status: EmailQualityStatus.INVALID,
      sendable: false,
      riskLevel: 'high',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'do_not_send',
      evaluatedAt
    };
  }

  // Mailbox verification explicitly failed
  if (verificationEvidence && verificationEvidence.result === 'fail') {
    reasons.push('Mailbox verification confirmed recipient invalid');
    return {
      email: rawEmail,
      status: EmailQualityStatus.INVALID,
      sendable: false,
      riskLevel: 'prohibited',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'do_not_send',
      evaluatedAt
    };
  }

  // Catch-all domain note
  const isCatchAll = catchAllEvidence && catchAllEvidence.result === 'risky';
  if (isCatchAll) {
    reasons.push('Domain is configured as catch-all (accepts arbitrary recipients)');
  }

  // Mailbox verification explicitly passed
  if (verificationEvidence && verificationEvidence.result === 'pass') {
    reasons.push('Direct mailbox verification confirmed recipient deliverable');
    return {
      email: rawEmail,
      status: EmailQualityStatus.VERIFIED,
      sendable: true,
      riskLevel: 'low',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'send',
      evaluatedAt
    };
  }

  // ── 7. Fallback Status Syntheses ────────────────────────────────────────────

  // If MX was validated but mailbox verification has not occurred
  if (mxEvidence && mxEvidence.result === 'pass') {
    if (isRole) {
      return {
        email: rawEmail,
        status: EmailQualityStatus.ROLE_ACCOUNT,
        sendable: true,
        riskLevel: 'moderate',
        reasons,
        evidence: accumulatedEvidence,
        recommendedAction: 'caution',
        evaluatedAt
      };
    }

    if (isCatchAll) {
      return {
        email: rawEmail,
        status: EmailQualityStatus.RISKY,
        sendable: true,
        riskLevel: 'moderate',
        reasons,
        evidence: accumulatedEvidence,
        recommendedAction: 'caution',
        evaluatedAt
      };
    }

    return {
      email: rawEmail,
      status: EmailQualityStatus.MX_VALID,
      sendable: true,
      riskLevel: hasHistoricalReply ? 'low' : 'moderate',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'send',
      evaluatedAt
    };
  }

  // If newly discovered or only syntax validated
  if (isRole) {
    return {
      email: rawEmail,
      status: EmailQualityStatus.ROLE_ACCOUNT,
      sendable: true,
      riskLevel: 'moderate',
      reasons,
      evidence: accumulatedEvidence,
      recommendedAction: 'caution',
      evaluatedAt
    };
  }

  return {
    email: rawEmail,
    status: EmailQualityStatus.SYNTAX_VALID,
    sendable: true,
    riskLevel: hasHistoricalReply ? 'low' : 'moderate',
    reasons,
    evidence: accumulatedEvidence,
    recommendedAction: 'send',
    evaluatedAt
  };
}
