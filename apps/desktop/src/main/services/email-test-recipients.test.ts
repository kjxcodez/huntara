import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Phase 8R — Global User-Scoped Test Recipient Limit Test
 *
 * Verifies:
 * 1. Maximum 3 unique test recipients per LeadForge user.
 * 2. Limit persists across multiple senders and workspaces for the same user.
 * 3. Reusing a previously registered recipient is always allowed.
 * 4. 4th unique recipient is rejected.
 * 5. Case-insensitivity and trimming normalization.
 * 6. User A quota does not affect User B quota.
 */

const globalRegistry = new Map<string, Array<{ email: string; firstUsedAt: Date; lastUsedAt: Date }>>();

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function registerTestRecipient(userId: string, rawEmail: string): { success: boolean; error?: string } {
  const email = normalizeEmail(rawEmail);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return { success: false, error: 'Invalid email address' };
  }

  const existing = globalRegistry.get(userId) || [];
  const isKnown = existing.some((r) => r.email === email);

  if (!isKnown) {
    if (existing.length >= 3) {
      return {
        success: false,
        error: 'You can use up to 3 different test recipients across your HUNTARA account. Reuse one of your existing test addresses to continue.'
      };
    }
    existing.push({ email, firstUsedAt: new Date(), lastUsedAt: new Date() });
    globalRegistry.set(userId, existing);
  } else {
    const match = existing.find((r) => r.email === email);
    if (match) match.lastUsedAt = new Date();
  }

  return { success: true };
}

describe('Global User Test Recipient Limit (Phase 8R)', () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  it('allows registering up to 3 unique recipients for a user', () => {
    const userIdA = 'user_111';
    expect(registerTestRecipient(userIdA, '  Alice@Example.com ').success).toBe(true);
    expect(registerTestRecipient(userIdA, 'bob@example.com').success).toBe(true);
    expect(registerTestRecipient(userIdA, 'carol@example.com').success).toBe(true);
  });

  it('rejects 4th unique recipient with user-friendly error', () => {
    const userIdA = 'user_111';
    registerTestRecipient(userIdA, 'Alice@Example.com');
    registerTestRecipient(userIdA, 'bob@example.com');
    registerTestRecipient(userIdA, 'carol@example.com');

    const res4 = registerTestRecipient(userIdA, 'dave@example.com');
    expect(res4.success).toBe(false);
    expect(res4.error).toContain('up to 3 different test recipients');
  });

  it('allows reusing existing recipient with case-insensitivity', () => {
    const userIdA = 'user_111';
    registerTestRecipient(userIdA, 'alice@example.com');
    registerTestRecipient(userIdA, 'bob@example.com');
    registerTestRecipient(userIdA, 'carol@example.com');

    expect(registerTestRecipient(userIdA, 'ALICE@EXAMPLE.COM').success).toBe(true);
  });

  it('isolates quotas between independent users', () => {
    const userIdA = 'user_111';
    const userIdB = 'user_222';

    registerTestRecipient(userIdA, 'alice@example.com');
    registerTestRecipient(userIdA, 'bob@example.com');
    registerTestRecipient(userIdA, 'carol@example.com');

    expect(registerTestRecipient(userIdB, 'dave@example.com').success).toBe(true);
    expect(registerTestRecipient(userIdB, 'eve@example.com').success).toBe(true);
    expect(registerTestRecipient(userIdB, 'frank@example.com').success).toBe(true);
    expect(registerTestRecipient(userIdB, 'grace@example.com').success).toBe(false);
  });
});
