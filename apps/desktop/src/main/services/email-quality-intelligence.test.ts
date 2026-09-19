/**
 * LeadForge OS — Phase 10: Email Quality, Verification, Bounce & Suppression Test Suite
 *
 * Authoritative integration & regression test suite verifying:
 * 1. Multi-dimensional email quality evaluation and invariant enforcement
 * 2. Dedicated SQLite suppression repository operations & precedence rules
 * 3. Verification provider DNS resolution & evidence generation without false claims
 * 4. DSN parsing and canonical bounce classification
 * 5. Audience resolution exclusion of suppressed contacts
 * 6. Adversarial cases (disposable domains, role accounts, stale evidence, suppression overrides)
 */

import Database from 'better-sqlite3';
import assert from 'assert';
import {
  EmailQualityStatus,
  SuppressionReason,
  BounceCategory,
  evaluateEmailQuality,
  parseDsnReport,
  isDisposableEmailDomain,
  type EmailQualityEvidence
} from '@huntara/schema';
import { initCacheSchema } from '../database/cache-schema';
import { DesktopSuppressionRepository } from '../database/suppression-repository';
import { DnsEmailVerificationProvider } from '@huntara/core';

export async function runEmailQualityIntelligenceTests() {
  console.log('--- STARTING PHASE 10 EMAIL QUALITY & SUPPRESSION INTEGRATION TESTS ---');

  const db = new Database(':memory:');
  initCacheSchema(db);
  const suppRepo = new DesktopSuppressionRepository(db);
  const workspaceId = 'ws_p10_test';

  // ==========================================
  // Test 1: SQLite Suppression Repository & Precedence Invariants
  // ==========================================
  console.log('[Test 1] Testing SQLite Suppression Repository & Precedence Invariants...');

  assert.strictEqual(suppRepo.isSuppressed(workspaceId, 'Lead@Acme.com'), false);

  suppRepo.suppress(
    workspaceId,
    'Lead@Acme.com',
    SuppressionReason.UNSUBSCRIBED,
    'user_link',
    { linkClicked: true }
  );

  assert.strictEqual(suppRepo.isSuppressed(workspaceId, 'lead@acme.com'), true);
  assert.strictEqual(suppRepo.isSuppressed(workspaceId, 'LEAD@ACME.COM'), true);

  const record = suppRepo.getSuppression(workspaceId, 'lead@acme.com');
  assert.ok(record);
  assert.strictEqual(record?.reason, SuppressionReason.UNSUBSCRIBED);

  // Precedence test: DO_NOT_CONTACT > HARD_BOUNCE
  suppRepo.suppress(workspaceId, 'vip@target.com', SuppressionReason.DO_NOT_CONTACT);
  let vipRecord = suppRepo.getSuppression(workspaceId, 'vip@target.com');
  assert.strictEqual(vipRecord?.reason, SuppressionReason.DO_NOT_CONTACT);

  // Weaker reason should NOT overwrite DO_NOT_CONTACT
  suppRepo.suppress(workspaceId, 'vip@target.com', SuppressionReason.HARD_BOUNCE, 'smtp_bounce');
  vipRecord = suppRepo.getSuppression(workspaceId, 'vip@target.com');
  assert.strictEqual(vipRecord?.reason, SuppressionReason.DO_NOT_CONTACT);

  // Upgrade: HARD_BOUNCE to UNSUBSCRIBED
  suppRepo.suppress(workspaceId, 'other@target.com', SuppressionReason.HARD_BOUNCE);
  suppRepo.suppress(workspaceId, 'other@target.com', SuppressionReason.UNSUBSCRIBED);
  const otherRecord = suppRepo.getSuppression(workspaceId, 'other@target.com');
  assert.strictEqual(otherRecord?.reason, SuppressionReason.UNSUBSCRIBED);

  // Unsuppress
  suppRepo.suppress(workspaceId, 'remove@me.com', SuppressionReason.MANUAL_SUPPRESSION);
  assert.strictEqual(suppRepo.isSuppressed(workspaceId, 'remove@me.com'), true);
  const removed = suppRepo.unsuppress(workspaceId, 'remove@me.com');
  assert.strictEqual(removed, true);
  assert.strictEqual(suppRepo.isSuppressed(workspaceId, 'remove@me.com'), false);

  console.log('✅ SQLite Suppression Repository & Precedence Invariants verified.');

  // ==========================================
  // Test 2: Email Verification Provider (DNS / MX Abstraction)
  // ==========================================
  console.log('[Test 2] Testing Email Verification Provider (DNS / MX Abstraction)...');

  const mockDnsValid: any = {
    resolve4: async () => ['142.250.190.46'],
    resolve6: async () => [],
    resolveMx: async () => [
      { exchange: 'aspmx.l.google.com', priority: 1 },
      { exchange: 'alt1.aspmx.l.google.com', priority: 5 }
    ]
  };

  const provider = new DnsEmailVerificationProvider({ dnsPromises: mockDnsValid });
  const res = await provider.verify('prospect@google.com');

  assert.strictEqual(res.syntaxValid, true);
  assert.strictEqual(res.domainValid, true);
  assert.strictEqual(res.mxValid, true);
  assert.strictEqual(res.primaryMx, 'aspmx.l.google.com');
  // INVARIANT: DNS provider must NEVER claim individual mailbox is verified!
  assert.strictEqual(res.mailboxVerified, null);

  const evidence = provider.toEvidence(res);
  assert.ok(evidence.some((e) => e.source === 'mx' && e.result === 'pass'));
  assert.ok(evidence.some((e) => e.source === 'syntax' && e.result === 'pass'));

  // Negative resolution
  const mockDnsInvalid: any = {
    resolve4: async () => {
      throw new Error('ENOTFOUND');
    },
    resolve6: async () => {
      throw new Error('ENOTFOUND');
    },
    resolveMx: async () => {
      throw new Error('ENOTFOUND');
    }
  };

  const invalidProvider = new DnsEmailVerificationProvider({ dnsPromises: mockDnsInvalid });
  const invalidRes = await invalidProvider.verify('nobody@nonexistent-fake-domain.xyz');
  assert.strictEqual(invalidRes.syntaxValid, true);
  assert.strictEqual(invalidRes.domainValid, false);
  assert.strictEqual(invalidRes.mxValid, false);

  console.log('✅ Email Verification Provider & evidence generation verified.');

  // ==========================================
  // Test 3: Adversarial Email Quality Matrix
  // ==========================================
  console.log('[Test 3] Testing Adversarial Email Quality Matrix...');

  // Invariant 1: MX Valid does NOT become VERIFIED without mailbox proof
  const mxEvidence: EmailQualityEvidence = {
    id: 'ev-1',
    source: 'mx',
    observedAt: new Date().toISOString(),
    result: 'pass',
    confidence: 0.9,
    details: { primaryMx: 'mail.company.com' }
  };
  const q1 = evaluateEmailQuality({
    email: 'founder@company.com',
    evidence: [mxEvidence]
  });
  assert.strictEqual(q1.sendable, true);
  assert.strictEqual(q1.status, EmailQualityStatus.MX_VALID);
  assert.notStrictEqual(q1.status, EmailQualityStatus.VERIFIED);

  // Invariant 2: Disposable burner domains are blocked regardless of MX status
  assert.strictEqual(isDisposableEmailDomain('mailinator.com'), true);
  assert.strictEqual(isDisposableEmailDomain('sub.temp-mail.org'), true);
  assert.strictEqual(isDisposableEmailDomain('gmail.com'), false);

  const q2 = evaluateEmailQuality({
    email: 'spammer@mailinator.com',
    evidence: [mxEvidence]
  });
  assert.strictEqual(q2.sendable, false);
  assert.strictEqual(q2.status, EmailQualityStatus.DISPOSABLE);
  assert.strictEqual(q2.riskLevel, 'high');
  assert.strictEqual(q2.recommendedAction, 'do_not_send');

  // Invariant 3: Role accounts are classified as sendable but moderate risk
  const q3 = evaluateEmailQuality({
    email: 'sales@enterprise.com',
    evidence: [mxEvidence]
  });
  assert.strictEqual(q3.sendable, true);
  assert.strictEqual(q3.status, EmailQualityStatus.ROLE_ACCOUNT);
  assert.strictEqual(q3.riskLevel, 'moderate');
  assert.strictEqual(q3.recommendedAction, 'caution');

  // Invariant 4: Historical reply does NOT override a subsequent hard bounce
  const q4 = evaluateEmailQuality({
    email: 'former-employee@company.com',
    historicalDeliveries: [
      { status: 'SENT', hasReply: true, sentAt: '2026-01-01T00:00:00Z' },
      { status: 'FAILED', failureCategory: 'INVALID_RECIPIENT', sentAt: '2026-06-01T00:00:00Z' }
    ]
  });
  assert.strictEqual(q4.sendable, false);
  assert.strictEqual(q4.status, EmailQualityStatus.INVALID);
  assert.strictEqual(q4.riskLevel, 'prohibited');

  // Invariant 5: Positive verification does NOT override active workspace suppression
  const verifEvidence: EmailQualityEvidence = {
    id: 'ev-verif',
    source: 'verification_provider',
    observedAt: new Date().toISOString(),
    result: 'pass',
    confidence: 0.99
  };
  const q5 = evaluateEmailQuality({
    email: 'prospect@acme.com',
    evidence: [verifEvidence],
    suppression: {
      reason: SuppressionReason.DO_NOT_CONTACT,
      suppressedAt: new Date().toISOString()
    }
  });
  assert.strictEqual(q5.sendable, false);
  assert.strictEqual(q5.status, EmailQualityStatus.SUPPRESSED);
  assert.strictEqual(q5.recommendedAction, 'do_not_send');

  console.log('✅ Adversarial Email Quality Matrix verified.');

  // ==========================================
  // Test 4: Audience Resolution Exclusion of Suppressed Contacts
  // ==========================================
  console.log('[Test 4] Testing Audience Resolution Exclusion of Suppressed Contacts...');

  db.prepare(`
    INSERT INTO contacts (id, workspaceId, email, status, emailStatus)
    VALUES 
      ('c1', ?, 'valid@acme.com', 'NEW', 'VALID'),
      ('c2', ?, 'bounced@acme.com', 'BOUNCED', 'INVALID'),
      ('c3', ?, 'suppressed@acme.com', 'NEW', 'VALID')
  `).run(workspaceId, workspaceId, workspaceId);

  suppRepo.suppress(workspaceId, 'suppressed@acme.com', SuppressionReason.UNSUBSCRIBED);

  const activeContacts = db
    .prepare(`
      SELECT id, email FROM contacts 
      WHERE workspaceId = ? 
        AND deletedAt IS NULL 
        AND email IS NOT NULL AND email != ''
        AND UPPER(COALESCE(status, 'NEW')) NOT IN ('UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'ARCHIVED')
        AND UPPER(COALESCE(emailStatus, 'UNVERIFIED')) NOT IN ('QUARANTINED', 'INVALID')
        AND LOWER(email) NOT IN (SELECT LOWER(email) FROM suppressions WHERE workspaceId = ?)
    `)
    .all(workspaceId, workspaceId) as Array<{ id: string; email: string }>;

  assert.strictEqual(activeContacts.length, 1);
  assert.strictEqual(activeContacts[0]?.id, 'c1');
  assert.strictEqual(activeContacts[0]?.email, 'valid@acme.com');

  console.log('✅ Audience Resolution Exclusion of Suppressed Contacts verified.');

  // ==========================================
  // Test 5: DSN Parser & Bounce Classifier
  // ==========================================
  console.log('[Test 5] Testing DSN Parser & Bounce Classifier...');

  const dsnText = `
Delivery to the following recipient failed permanently:
     alex.smith@defunct-startup.com
Technical details of permanent failure:
Google tried to deliver your message, but it was rejected by the server for the recipient domain defunct-startup.com by mail.defunct-startup.com. [198.51.100.1].
The error that the other server returned was:
550 5.1.1 <alex.smith@defunct-startup.com>: Recipient address rejected: User unknown
  `;

  const dsn = parseDsnReport(dsnText, {
    from: 'mailer-daemon@googlemail.com',
    subject: 'Delivery Status Notification (Failure)'
  });

  assert.ok(dsn);
  assert.strictEqual(dsn?.isDsn, true);
  assert.strictEqual(dsn?.failedRecipient, 'alex.smith@defunct-startup.com');
  assert.strictEqual(dsn?.classification.category, BounceCategory.MAILBOX_UNAVAILABLE);
  assert.strictEqual(dsn?.classification.isHardBounce, true);
  assert.strictEqual(dsn?.classification.statusCode, 550);

  console.log('✅ DSN Parser & Bounce Classifier verified.');

  console.log('--- ALL PHASE 10 EMAIL QUALITY & SUPPRESSION INTEGRATION TESTS PASSED ---');
}

if (require.main === module) {
  runEmailQualityIntelligenceTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
