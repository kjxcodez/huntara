/**
 * LeadForge OS — Phase 10: Canonical Bounce & Rejection Classification Engine
 *
 * Deterministically categorizes recipient failures, SMTP status codes (RFC 3463 / RFC 5321),
 * provider diagnostics, and inbound Delivery Status Notifications (DSNs).
 */

import { BounceCategory, EmailFailureCategory } from '../enums/index.js';

export interface BounceClassification {
  category: BounceCategory;
  isPermanent: boolean;
  isHardBounce: boolean;
  statusCode?: number | undefined;
  enhancedStatusCode?: string | undefined;
  diagnosticMessage: string;
  safeDescription: string;
  observedAt: string;
}

export interface ClassifyBounceInput {
  code?: string | number | undefined;
  enhancedCode?: string | undefined;
  message?: string | undefined;
  observedAt?: Date | string | undefined;
}

/**
 * Classifies an outbound send failure, SMTP code, or provider error into a canonical BounceClassification.
 */
export function classifyBounce(input: ClassifyBounceInput): BounceClassification {
  const message = String(input.message || '').trim();
  const rawCode = String(input.code || '').trim();
  const observedAt = (input.observedAt ? new Date(input.observedAt) : new Date()).toISOString();

  // Extract numeric SMTP code (e.g. 550, 421, 451, 554)
  let statusCode: number | undefined;
  const statusMatch = rawCode.match(/\b([45]\d{2})\b/) || message.match(/\b([45]\d{2})\b/);
  if (statusMatch && statusMatch[1]) {
    statusCode = parseInt(statusMatch[1], 10);
  }

  // Extract enhanced status code (e.g. 5.1.1, 5.2.2, 5.7.1, 4.4.1)
  let enhancedStatusCode: string | undefined = input.enhancedCode;
  if (!enhancedStatusCode) {
    const enhancedMatch = message.match(/\b([45]\.\d{1,3}\.\d{1,3})\b/);
    if (enhancedMatch && enhancedMatch[1]) {
      enhancedStatusCode = enhancedMatch[1];
    }
  }

  const lowerMsg = message.toLowerCase();

  // 1. Rate Limiting (421, 4.7.x, 429, "rate limit", "too many")
  if (
    statusCode === 421 ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many connections') ||
    lowerMsg.includes('user rate limit') ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('concurrency limit')
  ) {
    return {
      category: BounceCategory.RATE_LIMIT,
      isPermanent: false,
      isHardBounce: false,
      statusCode: statusCode || 421,
      enhancedStatusCode,
      diagnosticMessage: message,
      safeDescription: 'Temporary sending rate limit exceeded. Retry later.',
      observedAt
    };
  }

  // 2. Domain Unavailable / DNS Failure (Hard Bounce)
  if (
    enhancedStatusCode === '5.1.2' ||
    lowerMsg.includes('domain not found') ||
    lowerMsg.includes('no mx records') ||
    lowerMsg.includes('unroutable domain') ||
    lowerMsg.includes('host or domain name not found')
  ) {
    return {
      category: BounceCategory.DOMAIN_UNAVAILABLE,
      isPermanent: true,
      isHardBounce: true,
      statusCode: statusCode || 550,
      enhancedStatusCode: enhancedStatusCode || '5.1.2',
      diagnosticMessage: message,
      safeDescription: 'Destination domain does not exist or has no mail exchange records.',
      observedAt
    };
  }

  // 3. Spam / Reputation Rejection
  if (
    (enhancedStatusCode === '5.7.1' && (lowerMsg.includes('spam') || lowerMsg.includes('blocklist') || lowerMsg.includes('reputation'))) ||
    lowerMsg.includes('blocked by spamhaus') ||
    lowerMsg.includes('spam detected') ||
    lowerMsg.includes('content rejected')
  ) {
    return {
      category: BounceCategory.SPAM_REJECTION,
      isPermanent: true,
      isHardBounce: false,
      statusCode: statusCode || 554,
      enhancedStatusCode: enhancedStatusCode || '5.7.1',
      diagnosticMessage: message,
      safeDescription: 'Rejected by receiving mail server due to spam filtering or IP reputation.',
      observedAt
    };
  }

  // 4. Policy / DMARC / SPF / Authentication Rejection
  if (
    enhancedStatusCode === '5.7.1' ||
    enhancedStatusCode === '5.7.26' ||
    lowerMsg.includes('dmarc') ||
    lowerMsg.includes('spf') ||
    lowerMsg.includes('dkim') ||
    lowerMsg.includes('policy rejection') ||
    lowerMsg.includes('relay access denied')
  ) {
    return {
      category: BounceCategory.POLICY_REJECTION,
      isPermanent: true,
      isHardBounce: false,
      statusCode: statusCode || 554,
      enhancedStatusCode: enhancedStatusCode || '5.7.1',
      diagnosticMessage: message,
      safeDescription: 'Rejected by security or authentication policy (SPF, DKIM, or DMARC).',
      observedAt
    };
  }

  // 5. Mailbox Unavailable / User Unknown (Hard Bounce)
  if (
    enhancedStatusCode === '5.1.1' ||
    statusCode === 550 ||
    statusCode === 551 ||
    statusCode === 553 ||
    lowerMsg.includes('user unknown') ||
    lowerMsg.includes('does not exist') ||
    lowerMsg.includes('recipient address rejected') ||
    lowerMsg.includes('mailbox unavailable') ||
    lowerMsg.includes('no such user') ||
    lowerMsg.includes('invalid recipient') ||
    lowerMsg.includes('address not found') ||
    lowerMsg.includes('undeliverable') ||
    rawCode === 'INVALID_RECIPIENT'
  ) {
    return {
      category: BounceCategory.MAILBOX_UNAVAILABLE,
      isPermanent: true,
      isHardBounce: true,
      statusCode: statusCode || 550,
      enhancedStatusCode: enhancedStatusCode || '5.1.1',
      diagnosticMessage: message,
      safeDescription: 'Recipient mailbox does not exist or is permanently unavailable.',
      observedAt
    };
  }

  // 6. Mailbox Full / Quota / Size (Soft Bounce)
  if (
    enhancedStatusCode === '5.2.2' ||
    statusCode === 452 ||
    lowerMsg.includes('mailbox full') ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('over quota') ||
    lowerMsg.includes('insufficient storage')
  ) {
    return {
      category: BounceCategory.SOFT_BOUNCE,
      isPermanent: false,
      isHardBounce: false,
      statusCode: statusCode || 452,
      enhancedStatusCode: enhancedStatusCode || '5.2.2',
      diagnosticMessage: message,
      safeDescription: 'Recipient mailbox is full or over storage quota.',
      observedAt
    };
  }

  // 7. Generic 5xx Permanent Hard Bounce
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return {
      category: BounceCategory.HARD_BOUNCE,
      isPermanent: true,
      isHardBounce: true,
      statusCode,
      enhancedStatusCode,
      diagnosticMessage: message,
      safeDescription: `Permanent SMTP rejection (${statusCode}).`,
      observedAt
    };
  }

  // 8. Generic 4xx Temporary Soft Bounce
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return {
      category: BounceCategory.SOFT_BOUNCE,
      isPermanent: false,
      isHardBounce: false,
      statusCode,
      enhancedStatusCode,
      diagnosticMessage: message,
      safeDescription: `Temporary mail transfer failure (${statusCode}).`,
      observedAt
    };
  }

  return {
    category: BounceCategory.UNKNOWN,
    isPermanent: false,
    isHardBounce: false,
    statusCode,
    enhancedStatusCode,
    diagnosticMessage: message,
    safeDescription: 'Unclassified delivery failure.',
    observedAt
  };
}

/**
 * Inspects an inbound message body and headers to identify whether it is a DSN non-delivery notification
 * (e.g. from Mail Delivery Subsystem / mailer-daemon).
 */
export function parseDsnReport(
  bodyText: string | null | undefined,
  headers: Record<string, any> = {}
): {
  isDsn: boolean;
  failedRecipient?: string | undefined;
  classification: BounceClassification;
} | null {
  const fromHeader = String(headers.from || '').toLowerCase();
  const subjectHeader = String(headers.subject || '').toLowerCase();
  const body = String(bodyText || '');

  const isDsnSender =
    fromHeader.includes('mailer-daemon') ||
    fromHeader.includes('postmaster') ||
    fromHeader.includes('mail delivery subsystem');

  const isDsnSubject =
    subjectHeader.includes('delivery status notification') ||
    subjectHeader.includes('failure notice') ||
    subjectHeader.includes('undelivered mail returned to sender') ||
    subjectHeader.includes('mail delivery failed');

  if (!isDsnSender && !isDsnSubject) {
    return null;
  }

  // Extract failed recipient: search for RFC 3464 "Final-Recipient: rfc822; ..." or "The following address failed:"
  let failedRecipient: string | undefined;
  const finalRecipientMatch = body.match(/final-recipient:\s*rfc822;\s*([^\s<>;]+)/i);
  if (finalRecipientMatch && finalRecipientMatch[1]) {
    failedRecipient = finalRecipientMatch[1].trim().toLowerCase();
  } else {
    const toMatch = body.match(/failed to deliver to:\s*<([^>]+)>/i) ||
                    body.match(/recipient address:\s*<([^>]+)>/i) ||
                    body.match(/<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/);
    if (toMatch && toMatch[1]) {
      failedRecipient = toMatch[1].trim().toLowerCase();
    }
  }

  // Classify bounce based on body content
  const classification = classifyBounce({
    message: body.slice(0, 1000)
  });

  return {
    isDsn: true,
    failedRecipient,
    classification
  };
}

/**
 * Maps a canonical BounceCategory to the corresponding EmailFailureCategory.
 */
export function mapBounceCategoryToFailureCategory(category: BounceCategory): EmailFailureCategory {
  switch (category) {
    case BounceCategory.SPAM_REJECTION:
    case BounceCategory.POLICY_REJECTION:
    case BounceCategory.AUTHENTICATION_REJECTION:
      return EmailFailureCategory.POLICY;

    case BounceCategory.MAILBOX_UNAVAILABLE:
    case BounceCategory.DOMAIN_UNAVAILABLE:
    case BounceCategory.HARD_BOUNCE:
      return EmailFailureCategory.INVALID_RECIPIENT;

    case BounceCategory.RATE_LIMIT:
      return EmailFailureCategory.RATE_LIMIT;

    case BounceCategory.SOFT_BOUNCE:
      return EmailFailureCategory.PROVIDER;

    case BounceCategory.UNKNOWN:
    default:
      return EmailFailureCategory.PROVIDER;
  }
}
