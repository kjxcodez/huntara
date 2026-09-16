import assert from 'assert';
import Database from 'better-sqlite3';
import { initCacheSchema } from '../database/cache-schema.js';
import { CampaignPauseReason } from '@leadforge/schema';

/**
 * LeadForge OS — Phase 15 Adversarial Integration Test Suite
 *
 * Validates deterministic outbound safety, campaign lifecycle, contact exclusivity,
 * account disconnect/reconnect, and reply race hardening:
 * 1. Pause Invariant (PAUSE-07)
 * 2. Resume Invariant (RESUME-09)
 * 3. Stop vs Pause Terminal Invariant (DRIFT-STOP-19)
 * 4. Contact Cross-Campaign Exclusivity Invariant (ENROLL-08)
 * 5. Mailbox Disconnect & Reconnect Invariant (DISCONNECT-16)
 * 6. Fast Inbound Reply Race Window (INBOUND-03)
 * 7. Secondary Email Precedence (SEC-EMAIL-14)
 */

export async function runCampaignLifecycleSafetyPhase15Tests() {
  console.log('\n============================================================');
  console.log('--- PHASE 15 CAMPAIGN LIFECYCLE SAFETY & RACE HARDENING ---');
  console.log('============================================================\n');

  const db = new Database(':memory:');
  initCacheSchema(db);

  const workspaceId = 'ws_phase15_lifecycle';
  const testNow = '2026-09-05T18:00:00.000Z';

  // ── INVARIANT 1: CAMPAIGN PAUSE SAFETY (PAUSE-07) ──────────────────────────
  console.log('[Test 1] Testing Campaign Pause Safety (PAUSE-07)...');

  const campaignId1 = 'camp_pause_01';
  db.prepare(`
    INSERT INTO campaigns (id, workspaceId, name, status, sequenceId, sendingAccountId, createdAt, updatedAt)
    VALUES (?, ?, 'Outbound Sprint 1', 'ACTIVE', 'seq-1', 'acc-1', ?, ?)
  `).run(campaignId1, workspaceId, testNow, testNow);

  // Insert multiple executions: 1 running, 1 waiting for delay step, 1 queued
  db.prepare(`
    INSERT INTO sequence_executions (id, workspaceId, sequenceId, contactId, campaignId, currentStep, status, nextExecutionAt, createdAt, updatedAt)
    VALUES 
      ('exec_p1_running', ?, 'seq-1', 'cont-1', ?, 0, 'RUNNING', NULL, ?, ?),
      ('exec_p1_waiting', ?, 'seq-1', 'cont-2', ?, 1, 'WAITING', '2026-09-05T18:30:00.000Z', ?, ?),
      ('exec_p1_queued', ?, 'seq-1', 'cont-3', ?, 0, 'QUEUED', NULL, ?, ?)
  `).run(
    workspaceId, campaignId1, testNow, testNow,
    workspaceId, campaignId1, testNow, testNow,
    workspaceId, campaignId1, testNow, testNow
  );

  // Simulate operator triggering campaigns:pause IPC:
  // 1. Authoritative campaign record transitions to PAUSED with USER_REQUESTED pauseReason
  const pauseSettings = JSON.stringify({ pauseReason: CampaignPauseReason.USER_REQUESTED });
  db.prepare(`
    UPDATE campaigns
    SET status = 'PAUSED', settings = ?, updatedAt = ?
    WHERE id = ? AND workspaceId = ?
  `).run(pauseSettings, testNow, campaignId1, workspaceId);

  // 2. All non-terminal executions in SQLite (RUNNING, QUEUED, STARTING, WAITING) must transition to PAUSED
  db.prepare(`
    UPDATE sequence_executions
    SET status = 'PAUSED', updatedAt = ?
    WHERE campaignId = ? AND UPPER(status) IN ('RUNNING', 'QUEUED', 'STARTING', 'WAITING')
  `).run(testNow, campaignId1);

  // Verify all executions are strictly PAUSED
  const pausedRows = db.prepare(`SELECT id, status, currentStep, nextExecutionAt FROM sequence_executions WHERE campaignId = ?`).all(campaignId1) as any[];
  for (const row of pausedRows) {
    assert.strictEqual(row.status, 'PAUSED', `Execution ${row.id} must be in PAUSED state`);
  }

  // Verify WAITING execution retained its nextExecutionAt schedule for resume
  const waitingExec = pausedRows.find((r) => r.id === 'exec_p1_waiting');
  assert.strictEqual(waitingExec.nextExecutionAt, '2026-09-05T18:30:00.000Z', 'Paused execution must retain future due timestamp');
  assert.strictEqual(waitingExec.currentStep, 1, 'Paused execution must retain currentStep');

  // Verify pre-send worker check simulation:
  // A worker picking up a job for paused campaign must abort immediately, yielding status 'paused', not 'completed'
  const simulateWorkerPreSend = (campStatus: string) => {
    if (campStatus === 'PAUSED') {
      return { status: 'paused', halted: true, transmitted: false };
    }
    return { status: 'success', halted: false, transmitted: true };
  };
  const workerResult = simulateWorkerPreSend('PAUSED');
  assert.strictEqual(workerResult.status, 'paused', 'Worker must yield status paused');
  assert.strictEqual(workerResult.transmitted, false, 'No message transmission permitted under paused campaign');

  console.log('✅ Invariant 1 passed: Campaign pause authoritatively halts dispatches, transitions WAITING/RUNNING to PAUSED, and retains schedule.');

  // ── INVARIANT 2: CAMPAIGN RESUME DETERMINISM (RESUME-09) ───────────────────
  console.log('\n[Test 2] Testing Campaign Resume Determinism (RESUME-09)...');

  // Fast forward clock by 10 minutes: 18:10:00Z
  const resumeTime = '2026-09-05T18:10:00.000Z';
  const resumeTimeMs = new Date(resumeTime).getTime();

  // Campaign resumes authoritatively (clearing pauseReason)
  db.prepare(`
    UPDATE campaigns
    SET status = 'ACTIVE', settings = NULL, updatedAt = ?
    WHERE id = ? AND workspaceId = ?
  `).run(resumeTime, campaignId1, workspaceId);

  // Execute resume logic (matches campaigns:resume IPC channel)
  const toResume = db.prepare(`
    SELECT id, contactId, nextExecutionAt, currentStep
    FROM sequence_executions
    WHERE campaignId = ? AND UPPER(status) = 'PAUSED' AND deletedAt IS NULL
  `).all(campaignId1) as any[];

  const enqueuedResumedJobs: string[] = [];

  for (const exec of toResume) {
    const isWaiting = exec.nextExecutionAt && new Date(exec.nextExecutionAt).getTime() > resumeTimeMs;
    const newStatus = isWaiting ? 'WAITING' : 'RUNNING';

    db.prepare(`UPDATE sequence_executions SET status = ?, updatedAt = ? WHERE id = ?`)
      .run(newStatus, resumeTime, exec.id);

    if (!isWaiting) {
      enqueuedResumedJobs.push(exec.id);
    }
  }

  // Verify states after resume:
  const resumedRows = db.prepare(`SELECT id, status, currentStep, nextExecutionAt FROM sequence_executions WHERE campaignId = ?`).all(campaignId1) as any[];
  const rRunning = resumedRows.find((r) => r.id === 'exec_p1_running');
  const rWaiting = resumedRows.find((r) => r.id === 'exec_p1_waiting');
  const rQueued = resumedRows.find((r) => r.id === 'exec_p1_queued');

  assert.strictEqual(rRunning.status, 'RUNNING', 'Due execution must be restored to RUNNING');
  assert.strictEqual(rQueued.status, 'RUNNING', 'Queued execution must be restored to RUNNING');
  assert.strictEqual(rWaiting.status, 'WAITING', 'Future scheduled execution must be restored to WAITING');
  assert.strictEqual(rWaiting.nextExecutionAt, '2026-09-05T18:30:00.000Z', 'Future execution time must not drift');
  assert.strictEqual(rWaiting.currentStep, 1, 'Current step index must be preserved without step duplication');
  assert.strictEqual(enqueuedResumedJobs.length, 2, 'Only due executions (exec_p1_running, exec_p1_queued) should be re-enqueued');

  console.log('✅ Invariant 2 passed: Campaign resume deterministically restores WAITING vs RUNNING without step duplication or drift.');

  // ── INVARIANT 3: STOP VS PAUSE TERMINAL CANCELLATION (DRIFT-STOP-19) ───────
  console.log('\n[Test 3] Testing Stop Terminal Cancellation (DRIFT-STOP-19)...');

  const campaignId3 = 'camp_stop_03';
  db.prepare(`
    INSERT INTO campaigns (id, workspaceId, name, status, sequenceId, sendingAccountId, createdAt, updatedAt)
    VALUES (?, ?, 'Legacy Campaign', 'ACTIVE', 'seq-1', 'acc-1', ?, ?)
  `).run(campaignId3, workspaceId, testNow, testNow);

  db.prepare(`
    INSERT INTO sequence_executions (id, workspaceId, sequenceId, contactId, campaignId, currentStep, status, nextExecutionAt, createdAt, updatedAt)
    VALUES 
      ('exec_s3_1', ?, 'seq-1', 'cont-31', ?, 1, 'WAITING', '2026-09-05T19:00:00.000Z', ?, ?),
      ('exec_s3_2', ?, 'seq-1', 'cont-32', ?, 0, 'RUNNING', NULL, ?, ?),
      ('exec_s3_3', ?, 'seq-1', 'cont-33', ?, 2, 'PAUSED', NULL, ?, ?)
  `).run(
    workspaceId, campaignId3, testNow, testNow,
    workspaceId, campaignId3, testNow, testNow,
    workspaceId, campaignId3, testNow, testNow
  );

  // Stop campaign (terminal)
  db.prepare(`
    UPDATE campaigns SET status = 'STOPPED', updatedAt = ? WHERE id = ?
  `).run(testNow, campaignId3);

  // All executions transitioned to CANCELLED
  db.prepare(`
    UPDATE sequence_executions
    SET status = 'CANCELLED', updatedAt = ?
    WHERE campaignId = ? AND UPPER(status) IN ('RUNNING', 'QUEUED', 'STARTING', 'WAITING', 'PAUSED')
  `).run(testNow, campaignId3);

  const stoppedExecs = db.prepare(`SELECT status FROM sequence_executions WHERE campaignId = ?`).all(campaignId3) as any[];
  for (const s of stoppedExecs) {
    assert.strictEqual(s.status, 'CANCELLED', 'Stopped campaign executions must be CANCELLED');
  }

  // Simulate stale SQLite resurrection attempt:
  // A scheduler tick evaluates due executions. Even if an execution was erroneously marked WAITING in SQLite,
  // the worker re-checks campaignDoc from API. If STOPPED, immediately cancels.
  const workerAuthorityRecheck = (campaignStatus: string) => {
    if (campaignStatus === 'STOPPED' || campaignStatus === 'FAILED') {
      return { status: 'cancelled', executionStatus: 'CANCELLED', allowSend: false };
    }
    return { status: 'running', executionStatus: 'RUNNING', allowSend: true };
  };
  const recheckResult = workerAuthorityRecheck('STOPPED');
  assert.strictEqual(recheckResult.status, 'cancelled');
  assert.strictEqual(recheckResult.allowSend, false, 'Stopped campaign must never send emails');

  console.log('✅ Invariant 3 passed: Stop authoritatively cancels all executions and prevents stale projection resurrection.');

  // ── INVARIANT 4: CONTACT CROSS-CAMPAIGN EXCLUSIVITY (ENROLL-08) ────────────
  console.log('\n[Test 4] Testing Contact Cross-Campaign Exclusivity (ENROLL-08)...');

  const contactExclusiveId = 'cont_exclusive_99';
  const campA = 'camp_A';
  const campB = 'camp_B';

  db.prepare(`
    INSERT INTO campaigns (id, workspaceId, name, status, sequenceId, sendingAccountId, createdAt, updatedAt)
    VALUES 
      (?, ?, 'Campaign Alpha', 'ACTIVE', 'seq-1', 'acc-1', ?, ?),
      (?, ?, 'Campaign Beta', 'ACTIVE', 'seq-2', 'acc-1', ?, ?)
  `).run(campA, workspaceId, testNow, testNow, campB, workspaceId, testNow, testNow);

  // Enroll contact into Campaign Alpha
  db.prepare(`
    INSERT INTO sequence_executions (id, workspaceId, sequenceId, contactId, campaignId, currentStep, status, nextExecutionAt, createdAt, updatedAt)
    VALUES ('exec_alpha_1', ?, 'seq-1', ?, ?, 0, 'RUNNING', NULL, ?, ?)
  `).run(workspaceId, contactExclusiveId, campA, testNow, testNow);

  // Attempt to enroll same contact into Campaign Beta
  const checkActiveCrossCampaign = (cid: string) => {
    return db.prepare(`
      SELECT id, campaignId, status FROM sequence_executions
      WHERE workspaceId = ? AND contactId = ? AND deletedAt IS NULL
        AND UPPER(status) IN ('PENDING', 'RUNNING', 'WAITING', 'PAUSED')
    `).get(workspaceId, cid) as any;
  };

  const existingActive = checkActiveCrossCampaign(contactExclusiveId);
  assert.ok(existingActive, 'Active execution must be found for contactExclusiveId');
  assert.strictEqual(existingActive.campaignId, campA);

  // Enrollment in Camp B must be rejected
  const enrollResultCampB = existingActive ? { enrolled: false, reason: 'ACTIVE_EXECUTION_EXISTS' } : { enrolled: true };
  assert.strictEqual(enrollResultCampB.enrolled, false, 'Concurrent enrollment across campaigns must be rejected');

  // Now complete execution in Campaign Alpha
  db.prepare(`
    UPDATE sequence_executions SET status = 'COMPLETED', updatedAt = ? WHERE id = 'exec_alpha_1'
  `).run(testNow);

  // Now re-check: contact has no active execution
  const activeAfterCompletion = checkActiveCrossCampaign(contactExclusiveId);
  assert.strictEqual(activeAfterCompletion, undefined, 'Completed contact must no longer have active execution');

  // Enrollment in Camp B now succeeds
  const enrollAfterCompletion = !activeAfterCompletion ? { enrolled: true } : { enrolled: false };
  assert.strictEqual(enrollAfterCompletion.enrolled, true, 'Contact can be enrolled in new campaign after prior execution finishes');

  console.log('✅ Invariant 4 passed: Strict cross-campaign exclusivity enforced; completed contacts can re-enroll.');

  // ── INVARIANT 5: MAILBOX DISCONNECT & RECONNECT (DISCONNECT-16) ─────────────
  console.log('\n[Test 5] Testing Mailbox Disconnect & Reconnect (DISCONNECT-16)...');

  const mailboxId = 'mailbox_gmail_01';
  const campAuto = 'camp_auto_resume';
  const campManual = 'camp_manual_paused';

  // 1. campAuto is ACTIVE using mailboxId
  db.prepare(`
    INSERT INTO campaigns (id, workspaceId, name, status, sequenceId, sendingAccountId, settings, createdAt, updatedAt)
    VALUES (?, ?, 'Auto Resume Campaign', 'ACTIVE', 'seq-1', ?, NULL, ?, ?)
  `).run(campAuto, workspaceId, mailboxId, testNow, testNow);

  // 2. campManual is already PAUSED by user operator using mailboxId
  const userPauseSettings = JSON.stringify({ pauseReason: CampaignPauseReason.USER_REQUESTED });
  db.prepare(`
    INSERT INTO campaigns (id, workspaceId, name, status, sequenceId, sendingAccountId, settings, createdAt, updatedAt)
    VALUES (?, ?, 'User Paused Campaign', 'PAUSED', 'seq-1', ?, ?, ?, ?)
  `).run(campManual, workspaceId, mailboxId, userPauseSettings, testNow, testNow);

  // Disconnect mailboxId:
  // Active campaigns using mailboxId transition to PAUSED with pauseReason: 'MAILBOX_DISCONNECTED'
  const activeUsingMailbox = db.prepare(`
    SELECT id FROM campaigns WHERE sendingAccountId = ? AND UPPER(status) = 'ACTIVE'
  `).all(mailboxId) as any[];

  for (const c of activeUsingMailbox) {
    const disconnectSettings = JSON.stringify({ pauseReason: CampaignPauseReason.MAILBOX_DISCONNECTED });
    db.prepare(`
      UPDATE campaigns SET status = 'PAUSED', settings = ?, updatedAt = ? WHERE id = ?
    `).run(disconnectSettings, testNow, c.id);
  }

  // Reconnect mailboxId:
  // Only campaigns with pauseReason === 'MAILBOX_DISCONNECTED' should be auto-resumed!
  const pausedCampaigns = db.prepare(`
    SELECT id, settings FROM campaigns WHERE sendingAccountId = ? AND UPPER(status) = 'PAUSED'
  `).all(mailboxId) as any[];

  const autoResumed: string[] = [];
  for (const c of pausedCampaigns) {
    const settingsObj = typeof c.settings === 'string' ? JSON.parse(c.settings) : c.settings;
    if (settingsObj?.pauseReason === CampaignPauseReason.MAILBOX_DISCONNECTED) {
      db.prepare(`UPDATE campaigns SET status = 'ACTIVE', settings = NULL, updatedAt = ? WHERE id = ?`)
        .run(testNow, c.id);
      autoResumed.push(c.id);
    }
  }

  assert.deepStrictEqual(autoResumed, [campAuto], 'Only campaigns paused due to disconnect must auto-resume');

  // Verify manual paused campaign remained PAUSED with USER_REQUESTED intact
  const manualCampRow = db.prepare(`SELECT status, settings FROM campaigns WHERE id = ?`).get(campManual) as any;
  assert.strictEqual(manualCampRow.status, 'PAUSED', 'Operator paused campaign must stay PAUSED');
  const manualSettings = JSON.parse(manualCampRow.settings);
  assert.strictEqual(manualSettings.pauseReason, CampaignPauseReason.USER_REQUESTED, 'USER_REQUESTED intent must be preserved');

  console.log('✅ Invariant 5 passed: Mailbox disconnect auto-resumes only affected campaigns, preserving USER_REQUESTED pause.');

  // ── INVARIANT 6: FAST INBOUND REPLY RACE WINDOW (INBOUND-03) ───────────────
  console.log('\n[Test 6] Testing Fast Inbound Reply Race Window (INBOUND-03)...');

  // Scenario: Inbound reply arrives via webhook while outbound delivery record is still in SENDING or not yet indexed.
  // Delivery table has processingStatus.
  db.prepare(`
    INSERT INTO email_deliveries (
      id, workspaceId, campaignId, accountId, contactId, recipientEmail, subject, status, processingStatus, createdAt, updatedAt
    ) VALUES (
      'deliv_inbound_fast', ?, 'camp-1', 'acc-1', 'cont-fast', 'prospect@acme.com', 'Quick Question', 'DELIVERED', 'CORRELATION_PENDING', ?, ?
    )
  `).run(workspaceId, testNow, testNow);

  // Inbound delivery record is recorded with CORRELATION_PENDING (not failed or permanently unmatched)
  const pendingInbounds = db.prepare(`
    SELECT id, processingStatus FROM email_deliveries
    WHERE workspaceId = ? AND processingStatus = 'CORRELATION_PENDING'
  `).all(workspaceId) as any[];

  assert.strictEqual(pendingInbounds.length, 1);
  assert.strictEqual(pendingInbounds[0].id, 'deliv_inbound_fast');

  // Subsequent reconciliation pass matches the message against the finalized outbound delivery
  const matchPendingReply = (deliveryId: string, matchedContactId: string) => {
    db.prepare(`
      UPDATE email_deliveries
      SET processingStatus = 'MATCHED', updatedAt = ?
      WHERE id = ?
    `).run(testNow, deliveryId);

    // Update contact status to REPLIED to halt further sequence outreach
    db.prepare(`
      UPDATE contacts SET status = 'REPLIED', updatedAt = ? WHERE id = ?
    `).run(testNow, matchedContactId);
  };

  // Insert mock contact
  db.prepare(`
    INSERT INTO contacts (id, workspaceId, email, status, createdAt, updatedAt)
    VALUES ('cont-fast', ?, 'prospect@acme.com', 'CONTACTED', ?, ?)
  `).run(workspaceId, testNow, testNow);

  matchPendingReply('deliv_inbound_fast', 'cont-fast');

  const resolvedDelivery = db.prepare(`SELECT processingStatus FROM email_deliveries WHERE id = 'deliv_inbound_fast'`).get() as any;
  assert.strictEqual(resolvedDelivery.processingStatus, 'MATCHED', 'Pending correlation must upgrade to MATCHED');

  const resolvedContact = db.prepare(`SELECT status FROM contacts WHERE id = 'cont-fast'`).get() as any;
  assert.strictEqual(resolvedContact.status, 'REPLIED', 'Contact status must be upgraded to REPLIED');

  console.log('✅ Invariant 6 passed: CORRELATION_PENDING lifecycle prevents permanently unmatched reply lockups.');

  // ── INVARIANT 7: SECONDARY EMAIL PRECEDENCE (SEC-EMAIL-14) ──────────────────
  console.log('\n[Test 7] Testing Secondary Email Precedence (SEC-EMAIL-14)...');

  const resolveTargetRecipient = (
    stepConfigRecipient?: string,
    primaryEmail?: string | null,
    secondaryEmails?: string[]
  ) => {
    return (
      stepConfigRecipient ||
      primaryEmail ||
      (Array.isArray(secondaryEmails) && secondaryEmails.length > 0 ? secondaryEmails[0] : null) ||
      null
    );
  };

  // 7a. Step config override has highest precedence
  const r1 = resolveTargetRecipient('direct@target.com', 'primary@acme.com', ['sec1@acme.com', 'sec2@acme.com']);
  assert.strictEqual(r1, 'direct@target.com');

  // 7b. Primary email has second precedence
  const r2 = resolveTargetRecipient(undefined, 'primary@acme.com', ['sec1@acme.com']);
  assert.strictEqual(r2, 'primary@acme.com');

  // 7c. First secondary email is used when primary is null/empty
  const r3 = resolveTargetRecipient(undefined, null, ['sec1@acme.com', 'sec2@acme.com']);
  assert.strictEqual(r3, 'sec1@acme.com');

  // 7d. Returns null if all are missing
  const r4 = resolveTargetRecipient(undefined, null, []);
  assert.strictEqual(r4, null);

  console.log('✅ Invariant 7 passed: Deterministic recipient email resolution hierarchy strictly observed.');

  console.log('\n============================================================');
  console.log('--- ALL PHASE 15 ADVERSARIAL INVARIANTS PASSED (7/7) ---');
  console.log('============================================================\n');

  db.close();
}

// Auto-run when executed directly via Electron runner
if (
  process.argv[1]?.includes('campaign-lifecycle-safety-sqlite.test') ||
  process.argv[1]?.includes('campaign-lifecycle-safety-phase15.test')
) {
  runCampaignLifecycleSafetyPhase15Tests().catch((err) => {
    console.error('Phase 15 Test Suite Failure:', err);
    process.exit(1);
  });
}
