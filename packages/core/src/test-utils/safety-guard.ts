/**
 * LeadForge OS — Production Safety Guard for Automated Testing
 *
 * Prevents accidental connection to live production databases,
 * production OAuth endpoints, or customer email inboxes during tests.
 */

export class ProductionSafetyViolationError extends Error {
  constructor(message: string) {
    super(`[PRODUCTION SAFETY VIOLATION] ${message}`);
    this.name = 'ProductionSafetyViolationError';
  }
}

const FORBIDDEN_PRODUCTION_PATTERNS = [
  /api\.huntara\.online/i,
  /huntara-prod/i,
  /api\.leadforge\.kapiljangid\.pro/i,
  /leadforge-prod/i,
  /production/i,
  /cluster.*\.mongodb\.net/i
];

export function isTestMode(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.TEST_MODE === 'true' ||
    process.env.VITEST === 'true'
  );
}

export function enableTestMode(): void {
  process.env.NODE_ENV = 'test';
  process.env.TEST_MODE = 'true';
}

export function assertSafeDatabaseUri(uri: string): void {
  if (!isTestMode()) {
    return;
  }

  for (const pattern of FORBIDDEN_PRODUCTION_PATTERNS) {
    if (pattern.test(uri)) {
      throw new ProductionSafetyViolationError(
        `Blocked attempt to connect to production database in test mode: "${uri}". Tests must use memory or local test databases.`
      );
    }
  }
}

export function assertSafeEmailRecipient(recipient: string): void {
  if (!isTestMode()) {
    return;
  }

  const normalized = recipient.toLowerCase().trim();
  const safeDomains = ['example.com', 'test.com', 'localhost', 'huntara.local', 'leadforge.local', 'company.com'];
  const domain = normalized.split('@')[1];

  if (!domain || (!safeDomains.includes(domain) && !domain.endsWith('.test'))) {
    // In strict test mode, prevent real outbound dispatch to actual customer domains
    if (process.env.STRICT_EMAIL_SAFETY === 'true') {
      throw new ProductionSafetyViolationError(
        `Blocked attempt to send email to external recipient "${recipient}" in test mode.`
      );
    }
  }
}
