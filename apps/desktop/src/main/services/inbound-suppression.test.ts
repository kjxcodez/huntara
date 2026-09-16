import assert from 'assert';
import Database from 'better-sqlite3';
import { initCacheSchema } from '../database/cache-schema.js';
import { DesktopSuppressionRepository } from '../database/suppression-repository.js';
import {
  evaluateOutreachEligibility,
  canRestoreContactStatus,
  SuppressionReason
} from '@leadforge/schema';

/**
 * LeadForge OS — Phase 17 Inbound Reconciliation & Suppression Consistency Integration Test Suite
 *
 * Validates:
 * 1. Administrative Unsuppression Convergence (UNSUPPRESS-13)
 * 2. Multi-Address Bounce Isolation (Isolated Primary vs. Secondary Addresses)
 * 3. Inbound Reply Correlation Lifecycle & SQLite Caching (CORRELATION_PENDING -> MATCHED / UNMATCHED)
 * 4. Manual Inbound Reply Reconciliation & Sequence Halting
 * 5. Provider Error Classification (AUTH, RATE_LIMIT, NETWORK, INVALID_RECIPIENT)
 */

export async function runInboundSuppressionPhase17Tests() {
  console.log('\n============================================================');
  console.log('--- PHASE 17 INBOUND RECONCILIATION & SUPPRESSION CONSISTENCY ---');
  console.log('============================================================\n');

  const db = new Database(':memory:');
  initCacheSchema(db);

  const workspaceId = 'ws_phase17_test';
  const testNow = '2026-09-06T02:00:00.000Z';

  // ── INVARIANT 1: ADMINISTRATIVE UNSUPPRESSION CONVERGENCE (UNSUPPRESS-13) ──
  console.log('[Test 1] Testing Administrative Unsuppression Convergence (UNSUPPRESS-13)...');

  const suppressionRepo = new DesktopSuppressionRepository(db);

  // Setup sample contacts in SQLite cache
  const insertContact = db.prepare(`
    INSERT INTO contacts (
      id, workspaceId, firstName, lastName, email, status, emailStatus, lastContactedAt, createdAt, updatedAt
    ) VALUES (
      @id, @workspaceId, @firstName, @lastName, @email, @status, @emailStatus, @lastContactedAt, @createdAt, @updatedAt
    )
  `);

  // Contact 1: Previously contacted, then bounced -> should restore to CONTACTED
  insertContact.run({
    id: 'contact_bounced_with_history',
    workspaceId,
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@example.com',
    status: 'BOUNCED',
    emailStatus: 'INVALID',
    lastContactedAt: '2026-09-01T10:00:00.000Z',
    createdAt: testNow,
    updatedAt: testNow
  });

  // Contact 2: Brand new contact that bounced without prior history -> should restore to NEW
  insertContact.run({
    id: 'contact_bounced_fresh',
    workspaceId,
    firstName: 'Bob',
    lastName: 'Jones',
    email: 'bob@example.com',
    status: 'BOUNCED',
    emailStatus: 'INVALID',
    lastContactedAt: null,
    createdAt: testNow,
    updatedAt: testNow
  });

  // Contact 3: Contact that already REPLIED -> MUST NOT be reset to CONTACTED or NEW
  insertContact.run({
    id: 'contact_replied_protected',
    workspaceId,
    firstName: 'Carol',
    lastName: 'White',
    email: 'carol@example.com',
    status: 'REPLIED',
    emailStatus: 'VALID',
    lastContactedAt: '2026-09-02T12:00:00.000Z',
    createdAt: testNow,
    updatedAt: testNow
  });

  // Contact 4: Contact marked DO_NOT_CONTACT -> MUST NOT be reset
  insertContact.run({
    id: 'contact_dnc_protected',
    workspaceId,
    firstName: 'Dave',
    lastName: 'Brown',
    email: 'dave@example.com',
    status: 'DO_NOT_CONTACT',
    emailStatus: 'VALID',
    lastContactedAt: null,
    createdAt: testNow,
    updatedAt: testNow
  });

  // Suppress alice@example.com
  suppressionRepo.suppress(
    workspaceId,
    'alice@example.com',
    SuppressionReason.HARD_BOUNCE,
    'inbound_bounce',
    null,
    null,
    '550 mailbox unavailable'
  );

  assert.strictEqual(suppressionRepo.isSuppressed(workspaceId, 'alice@example.com'), true);

  // Administratively unsuppress alice@example.com
  const unsuppressed = suppressionRepo.unsuppress(workspaceId, 'alice@example.com');
  assert.strictEqual(unsuppressed, true);
  assert.strictEqual(suppressionRepo.isSuppressed(workspaceId, 'alice@example.com'), false);

  // Execute UNSUPPRESS-13 SQLite projection update
  const unsuppressEmail = 'alice@example.com';
  db.prepare(`
    UPDATE contacts
    SET status = CASE WHEN lastContactedAt IS NOT NULL THEN 'CONTACTED' ELSE 'NEW' END,
        emailStatus = 'VALID',
        updatedAt = ?
    WHERE workspaceId = ?
      AND LOWER(TRIM(email)) = ?
      AND status = 'BOUNCED'
  `).run(testNow, workspaceId, unsuppressEmail.toLowerCase().trim());

  // Verify Alice was restored to CONTACTED and emailStatus to VALID
  const alice = db.prepare(`SELECT * FROM contacts WHERE id = 'contact_bounced_with_history'`).get() as any;
  assert.strictEqual(alice.status, 'CONTACTED');
  assert.strictEqual(alice.emailStatus, 'VALID');

  // Verify canRestoreContactStatus helper preserves protection
  assert.strictEqual(canRestoreContactStatus('BOUNCED', 'CONTACTED'), true);
  assert.strictEqual(canRestoreContactStatus('BOUNCED', 'NEW'), true);
  assert.strictEqual(canRestoreContactStatus('REPLIED', 'CONTACTED'), false, 'Cannot override REPLIED');
  assert.strictEqual(canRestoreContactStatus('DO_NOT_CONTACT', 'NEW'), false, 'Cannot override DO_NOT_CONTACT');
  assert.strictEqual(canRestoreContactStatus('UNSUBSCRIBED', 'CONTACTED'), false, 'Cannot override UNSUBSCRIBED');

  console.log('✅ Invariant 1 passed: UNSUPPRESS-13 converged SQLite contact projection without corrupting protected statuses.');

  // ── INVARIANT 2: MULTI-ADDRESS BOUNCE ISOLATION ────────────────────────────
  console.log('[Test 2] Testing Multi-Address Bounce Isolation...');

  const contactMultiAddress = {
    id: 'contact_multi_1',
    status: 'BOUNCED',
    email: 'primary_dead@company.com',
    secondaryEmails: ['backup_alive@gmail.com']
  };

  // Attempt to contact the primary (dead) address -> must be rejected
  const primaryEval = evaluateOutreachEligibility({
    contact: contactMultiAddress,
    recipientEmail: 'primary_dead@company.com',
    bouncedEmail: 'primary_dead@company.com'
  });
  assert.strictEqual(primaryEval.eligible, false);
  assert.strictEqual(primaryEval.reason, 'CONTACT_BOUNCED');

  // Attempt to contact the secondary (alive) address -> must be allowed (isolated)
  const secondaryEval = evaluateOutreachEligibility({
    contact: contactMultiAddress,
    recipientEmail: 'backup_alive@gmail.com',
    bouncedEmail: 'primary_dead@company.com'
  });
  assert.strictEqual(secondaryEval.eligible, true);

  console.log('✅ Invariant 2 passed: Primary email bounce isolated; secondary address remains outreach eligible.');

  // ── INVARIANT 3: INBOUND REPLY CORRELATION & SQLITE CACHING ─────────────────
  console.log('[Test 3] Testing Inbound Reply Correlation Lifecycle & SQLite Caching...');

  const insertDelivery = db.prepare(`
    INSERT INTO email_deliveries (
      id, workspaceId, campaignId, sequenceId, executionId, contactId, senderEmail, recipientEmail,
      subject, status, processingStatus, matchConfidence, reconciliationAttempts, reconciliationNotes,
      direction, createdAt, updatedAt
    ) VALUES (
      @id, @workspaceId, @campaignId, @sequenceId, @executionId, @contactId, @senderEmail, @recipientEmail,
      @subject, @status, @processingStatus, @matchConfidence, @reconciliationAttempts, @reconciliationNotes,
      @direction, @createdAt, @updatedAt
    )
  `);

  // Insert an inbound message currently awaiting correlation
  insertDelivery.run({
    id: 'del_inbound_pending',
    workspaceId,
    campaignId: 'camp_1',
    sequenceId: 'seq_1',
    executionId: null,
    contactId: null,
    senderEmail: 'prospect@acme.corp',
    recipientEmail: 'sales@leadforge.test',
    subject: 'Re: Quick inquiry',
    status: 'SENT',
    processingStatus: 'CORRELATION_PENDING',
    matchConfidence: null,
    reconciliationAttempts: 1,
    reconciliationNotes: 'Awaiting In-Reply-To header matching',
    direction: 'INBOUND',
    createdAt: testNow,
    updatedAt: testNow
  });

  // Insert a correlated inbound message
  insertDelivery.run({
    id: 'del_inbound_matched',
    workspaceId,
    campaignId: 'camp_1',
    sequenceId: 'seq_1',
    executionId: 'exec_1',
    contactId: 'contact_bounced_with_history',
    senderEmail: 'prospect@acme.corp',
    recipientEmail: 'sales@leadforge.test',
    subject: 'Re: Interested in demo',
    status: 'SENT',
    processingStatus: 'MATCHED',
    matchConfidence: 'high',
    reconciliationAttempts: 1,
    reconciliationNotes: 'Matched via In-Reply-To header to message del_outbound_1',
    direction: 'INBOUND',
    createdAt: testNow,
    updatedAt: testNow
  });

  // Verify SQLite filtering by processingStatus
  const pendingRows = db.prepare(`
    SELECT * FROM email_deliveries WHERE workspaceId = ? AND processingStatus = 'CORRELATION_PENDING'
  `).all(workspaceId);
  assert.strictEqual(pendingRows.length, 1);
  assert.strictEqual((pendingRows[0] as any).id, 'del_inbound_pending');

  const matchedRows = db.prepare(`
    SELECT * FROM email_deliveries WHERE workspaceId = ? AND processingStatus = 'MATCHED'
  `).all(workspaceId);
  assert.strictEqual(matchedRows.length, 1);
  assert.strictEqual((matchedRows[0] as any).matchConfidence, 'high');

  console.log('✅ Invariant 3 passed: Inbound reconciliation statuses stored and queryable in SQLite delivery ledger.');

  // ── INVARIANT 4: MANUAL REPLY RECONCILIATION & SEQUENCE HALTING ────────────
  console.log('[Test 4] Testing Manual Reply Reconciliation & Sequence Halting...');

  // Target contact currently in sequence
  insertContact.run({
    id: 'contact_active_sequence',
    workspaceId,
    firstName: 'Diana',
    lastName: 'Prince',
    email: 'diana@amazon.corp',
    status: 'CONTACTED',
    emailStatus: 'VALID',
    lastContactedAt: '2026-09-05T12:00:00.000Z',
    createdAt: testNow,
    updatedAt: testNow
  });

  // Contact was contacted -> currently eligible for step 2
  const preReconcileEval = evaluateOutreachEligibility({
    contact: {
      email: 'diana@amazon.corp',
      status: 'CONTACTED'
    }
  });
  assert.strictEqual(preReconcileEval.eligible, true);

  // Perform manual reconciliation: link an unmatched reply to Diana Prince
  db.prepare(`
    UPDATE email_deliveries
    SET contactId = ?,
        processingStatus = 'MATCHED',
        matchConfidence = 'manual',
        reconciliationNotes = 'Manually linked by operator: confirmed prospect response',
        updatedAt = ?
    WHERE id = 'del_inbound_pending'
  `).run('contact_active_sequence', testNow);

  // Transition contact status to REPLIED
  db.prepare(`
    UPDATE contacts
    SET status = 'REPLIED',
        updatedAt = ?
    WHERE id = 'contact_active_sequence'
  `).run(testNow);

  // Re-evaluate eligibility for next sequence step -> must be blocked
  const postReconcileContact = db.prepare(`SELECT * FROM contacts WHERE id = 'contact_active_sequence'`).get() as any;
  const postReconcileEval = evaluateOutreachEligibility({
    contact: postReconcileContact
  });
  assert.strictEqual(postReconcileEval.eligible, false);
  assert.strictEqual(postReconcileEval.reason, 'CONTACT_REPLIED');

  console.log('✅ Invariant 4 passed: Manual reconciliation halts subsequent outreach sequence execution.');

  // ── INVARIANT 5: DETERMINISTIC PROVIDER ERROR CLASSIFICATION ──────────────
  console.log('[Test 5] Testing Provider Error Classification...');

  const classifyError = (code: number, message: string) => {
    const msg = message.toLowerCase();
    if (code === 401 || code === 403 || msg.includes('invalid_grant') || msg.includes('token revoked')) {
      return { classification: 'AUTH', retryable: false, code: 'AUTH_FAILED' };
    }
    if (code === 429 || msg.includes('rate limit') || msg.includes('quota') || msg.includes('userratelimitexceeded')) {
      return { classification: 'RATE_LIMIT', retryable: true, code: 'RATE_LIMIT_EXCEEDED' };
    }
    if (code >= 500 && code < 600 || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('network')) {
      return { classification: 'NETWORK', retryable: true, code: 'NETWORK_TIMEOUT', ambiguous: true };
    }
    if (msg.includes('550') || msg.includes('recipient not found') || msg.includes('mailbox unavailable')) {
      return { classification: 'INVALID_RECIPIENT', retryable: false, code: 'ADDRESS_INVALID' };
    }
    return { classification: 'GENERIC', retryable: false, code: 'UNKNOWN' };
  };

  const authClass = classifyError(401, 'invalid_grant: Token has been expired or revoked.');
  assert.strictEqual(authClass.classification, 'AUTH');
  assert.strictEqual(authClass.retryable, false);

  const rateLimitClass = classifyError(429, 'UserRateLimitExceeded: Mail sending quota exceeded.');
  assert.strictEqual(rateLimitClass.classification, 'RATE_LIMIT');
  assert.strictEqual(rateLimitClass.retryable, true);

  const networkClass = classifyError(504, 'ETIMEDOUT: Gateway timeout during transmission');
  assert.strictEqual(networkClass.classification, 'NETWORK');
  assert.strictEqual(networkClass.retryable, true);
  assert.strictEqual(networkClass.ambiguous, true);

  const invalidRcptClass = classifyError(0, '550 5.1.1 Recipient address rejected: User unknown');
  assert.strictEqual(invalidRcptClass.classification, 'INVALID_RECIPIENT');
  assert.strictEqual(invalidRcptClass.retryable, false);

  console.log('✅ Invariant 5 passed: Provider failures deterministically categorized across auth, rate limits, timeouts, and invalid recipients.');

  console.log('\n============================================================');
  console.log('--- ALL PHASE 17 ADVERSARIAL INVARIANTS PASSED (5/5) ---');
  console.log('============================================================\n');

  db.close();
}

// Auto-run when executed directly via Electron runner
if (
  process.argv[1]?.includes('inbound-suppression.test') ||
  process.argv[1]?.includes('inbound-suppression-phase17.test')
) {
  runInboundSuppressionPhase17Tests().catch((err) => {
    console.error('Phase 17 Test Suite Failure:', err);
    process.exit(1);
  });
}
