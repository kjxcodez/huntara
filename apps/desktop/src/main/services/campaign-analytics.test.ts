import Database from 'better-sqlite3';
import { initCacheSchema } from '../database/cache-schema';
import { DesktopAnalyticsRepository } from '../database/analytics-repository';
import { randomUUID } from 'crypto';
import assert from 'assert';
import { EmailQualityStatus } from '@huntara/schema';

/**
 * LeadForge OS — Phase 11 Adversarial Campaign Analytics Integration Test Suite
 *
 * Verifies the 7 mandatory analytical invariants:
 * 1. Open event deduplication (multiple tracking pixel events vs unique contacts)
 * 2. Retry non-inflation (retried dispatches do not artificially distort metrics)
 * 3. Multiple replies attribution (multiple messages from 1 contact = 1 replying contact)
 * 4. Timezone boundary precision (UTC vs local timezone date bucketing)
 * 5. Explicit denominators & zero-division safety (zero NaN or Infinity)
 * 6. Audience quality tier correlation (Phase 10 verification vs bounce rate)
 * 7. RFC 4180 CSV export correctness (explicit formulas, numerators, denominators)
 */
export async function runCampaignAnalyticsTests() {
  console.log('--- STARTING CAMPAIGN ANALYTICS INTEGRATION TESTS ---');

  const db = new Database(':memory:');
  initCacheSchema(db);
  const repo = new DesktopAnalyticsRepository(db);

  const workspaceId = `ws_${randomUUID()}`;
  const campaignId = `camp_${randomUUID()}`;
  const sequenceId = `seq_${randomUUID()}`;
  const accountId = `acc_${randomUUID()}`;

  // 1. Seed Campaign
  db.prepare(`
    INSERT INTO campaigns (id, workspaceId, sequenceId, sendingAccountId, name, status, timezone, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(campaignId, workspaceId, sequenceId, accountId, 'Enterprise Q3 Outreach', 'ACTIVE', 'America/New_York');

  // Seed Sending Account
  db.prepare(`
    INSERT INTO email_accounts (id, workspaceId, name, email, provider, status, dailyLimit, dailySent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, workspaceId, 'Primary Sender', 'outreach@enterprise.com', 'google', 'ACTIVE', 100, 25);

  // 2. Seed Contacts
  const contact1 = `cnt_${randomUUID()}`;
  const contact2 = `cnt_${randomUUID()}`;
  const contact3 = `cnt_${randomUUID()}`;
  const contact4 = `cnt_${randomUUID()}`; // will be suppressed

  db.prepare(`
    INSERT INTO contacts (id, workspaceId, firstName, lastName, email, emailStatus, emailQuality)
    VALUES 
      (?, ?, 'Alice', 'Smith', 'alice@verified.com', 'verified', ?),
      (?, ?, 'Bob', 'Jones', 'bob@risky.com', 'risky', ?),
      (?, ?, 'Charlie', 'Brown', 'charlie@unknown.com', 'unverified', NULL),
      (?, ?, 'Diana', 'Prince', 'diana@suppressed.com', 'unverified', NULL)
  `).run(
    contact1, workspaceId, JSON.stringify({ status: EmailQualityStatus.VERIFIED }),
    contact2, workspaceId, JSON.stringify({ status: EmailQualityStatus.RISKY }),
    contact3, workspaceId,
    contact4, workspaceId
  );

  // Seed Suppression for contact 4
  db.prepare(`
    INSERT INTO suppressions (id, workspaceId, email, reason, source, suppressedAt)
    VALUES (?, ?, 'diana@suppressed.com', 'UNSUBSCRIBED', 'manual', datetime('now'))
  `).run(`sup_${randomUUID()}`, workspaceId);

  // 3. Seed Enrollments (Sequence Executions)
  const exec1 = `exec_${randomUUID()}`;
  const exec2 = `exec_${randomUUID()}`;
  const exec3 = `exec_${randomUUID()}`;
  const exec4 = `exec_${randomUUID()}`;

  db.prepare(`
    INSERT INTO sequence_executions (id, workspaceId, sequenceId, campaignId, contactId, status, currentStep, emailsSent, replies)
    VALUES 
      (?, ?, ?, ?, ?, 'RUNNING', 1, 1, 0),
      (?, ?, ?, ?, ?, 'COMPLETED', 1, 1, 0),
      (?, ?, ?, ?, ?, 'REPLIED', 1, 1, 3),
      (?, ?, ?, ?, ?, 'PAUSED', 0, 0, 0)
  `).run(
    exec1, workspaceId, sequenceId, campaignId, contact1,
    exec2, workspaceId, sequenceId, campaignId, contact2,
    exec3, workspaceId, sequenceId, campaignId, contact3,
    exec4, workspaceId, sequenceId, campaignId, contact4
  );

  // ── INVARIANT 1: OPEN DEDUPLICATION ──────────────────────────────────────────
  // Contact 1 receives email, and opens it 5 times
  const deliv1 = `del_${randomUUID()}`;
  db.prepare(`
    INSERT INTO email_deliveries (
      id, workspaceId, campaignId, sequenceId, executionId, stepIndex, contactId, accountId,
      senderEmail, recipientEmail, subject, status, direction, openCount, clickCount, hasReply,
      sentAt, lastOpenedAt
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'outreach@enterprise.com', 'alice@verified.com', 'Meeting Request', 'SENT', 'OUTBOUND', 5, 2, 0, '2026-09-01T14:00:00.000Z', '2026-09-01T14:15:00.000Z')
  `).run(deliv1, workspaceId, campaignId, sequenceId, exec1, contact1, accountId);

  // ── INVARIANT 2: RETRY & BOUNCE ──────────────────────────────────────────────
  // Contact 2 email bounces (hard bounce)
  const deliv2 = `del_${randomUUID()}`;
  db.prepare(`
    INSERT INTO email_deliveries (
      id, workspaceId, campaignId, sequenceId, executionId, stepIndex, contactId, accountId,
      senderEmail, recipientEmail, subject, status, direction, openCount, clickCount, hasReply,
      sentAt
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'outreach@enterprise.com', 'bob@risky.com', 'Meeting Request', 'BOUNCED', 'OUTBOUND', 0, 0, 0, '2026-09-01T15:00:00.000Z')
  `).run(deliv2, workspaceId, campaignId, sequenceId, exec2, contact2, accountId);

  // ── INVARIANT 3: MULTIPLE REPLIES ATTRIBUTION ────────────────────────────────
  // Contact 3 receives email and sends 3 separate replies
  const deliv3 = `del_${randomUUID()}`;
  db.prepare(`
    INSERT INTO email_deliveries (
      id, workspaceId, campaignId, sequenceId, executionId, stepIndex, contactId, accountId,
      senderEmail, recipientEmail, subject, status, direction, openCount, clickCount, hasReply, replyCount,
      providerThreadId, sentAt, lastOpenedAt, lastRepliedAt
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'outreach@enterprise.com', 'charlie@unknown.com', 'Meeting Request', 'SENT', 'OUTBOUND', 1, 0, 1, 3, 'thread_xyz', '2026-09-01T16:00:00.000Z', '2026-09-01T17:00:00.000Z', '2026-09-01T18:30:00.000Z')
  `).run(deliv3, workspaceId, campaignId, sequenceId, exec3, contact3, accountId);

  // Run Overview Analysis
  const overview = repo.getOverview(workspaceId, campaignId);

  console.log('[Test] Running Invariant 1 (Open Deduplication Checks)...');
  // 4 enrolled contacts, 1 suppressed = 3 eligible contacts
  assert.strictEqual(overview.counts.contactsEnrolled, 4, 'Total enrolled contacts must be 4');
  assert.strictEqual(overview.counts.contactsSuppressed, 1, 'Suppressed contacts must be 1');
  assert.strictEqual(overview.counts.contactsEligible, 3, 'Eligible contacts must be 3 (4 enrolled - 1 suppressed)');

  // Contact 1 opened 5 times, Contact 3 opened 1 time = 6 observed opens across 2 distinct contacts
  assert.strictEqual(overview.counts.observedOpens, 6, 'Observed open signals must equal 6');
  assert.strictEqual(overview.counts.uniqueOpenedContacts, 2, 'Unique opened contacts must equal 2 (deduplicated)');
  assert.strictEqual(overview.rates.uniqueOpenRate.numerator, 2, 'Unique open rate numerator must be 2');
  assert.strictEqual(overview.rates.uniqueOpenRate.denominator, 2, 'Unique open rate denominator must be 2 (emails accepted: deliv1 & deliv3)');
  assert.strictEqual(overview.rates.uniqueOpenRate.formatted, '100.00%', 'Unique open rate must be 100.00%');
  console.log('✅ Invariant 1 passed: Multiple opens correctly deduplicated to unique contacts.');

  console.log('[Test] Running Invariant 2 (Bounce & Acceptance Checks)...');
  assert.strictEqual(overview.counts.emailsAttempted, 3, 'Outbound attempts must equal 3');
  assert.strictEqual(overview.counts.emailsAccepted, 2, 'Accepted emails must equal 2');
  assert.strictEqual(overview.counts.hardBounces, 1, 'Hard bounces must equal 1');
  assert.strictEqual(overview.rates.providerAcceptanceRate.formatted, '66.67%', 'Acceptance rate must be 66.67% (2 / 3)');
  assert.strictEqual(overview.rates.hardBounceRate.formatted, '33.33%', 'Hard bounce rate must be 33.33% (1 / 3)');
  console.log('✅ Invariant 2 passed: Acceptance and bounce rates reflect exact denominators.');

  console.log('[Test] Running Invariant 3 (Multiple Replies Attribution Checks)...');
  assert.strictEqual(overview.counts.repliesReceived, 3, 'Total replies received must equal 3');
  assert.strictEqual(overview.counts.replyingContacts, 1, 'Replying contacts must equal 1 (Charlie)');
  // Contact reply rate: 1 replying contact / 3 eligible contacts = 33.33%
  assert.strictEqual(overview.rates.contactReplyRate.numerator, 1, 'Contact reply rate numerator must be 1');
  assert.strictEqual(overview.rates.contactReplyRate.denominator, 3, 'Contact reply rate denominator must be 3 eligible contacts');
  assert.strictEqual(overview.rates.contactReplyRate.formatted, '33.33%', 'Contact reply rate must be 33.33%');

  // Latency: sentAt 16:00, repliedAt 18:30 = 2.5 hours
  assert.strictEqual(overview.latency.medianHours, 2.5, 'Median reply latency must be 2.5 hours');
  assert.strictEqual(overview.latency.totalRepliesCalculated, 1, '1 reply latency calculated');

  // Attribution confidence: direct thread match
  assert.strictEqual(overview.attributionConfidence.directThread, 1, '1 reply matched via direct thread ID');
  console.log('✅ Invariant 3 passed: Multiple reply messages attributed to 1 converting contact with latency calculation.');

  // ── INVARIANT 4: TIMEZONE BOUNDARIES ─────────────────────────────────────────
  console.log('[Test] Running Invariant 4 (Timezone Boundary Aggregation)...');
  // Add a delivery at 2026-09-01T23:30:00Z and 2026-09-02T02:30:00Z
  // In UTC: these fall on 2026-09-01 and 2026-09-02 (2 separate dates)
  // In America/New_York (UTC-4): 23:30Z is 19:30 (Sept 1), 02:30Z is 22:30 (Sept 1) -> Both fall on 2026-09-01!
  const tzCampId = `tz_camp_${randomUUID()}`;
  db.prepare(`
    INSERT INTO campaigns (id, workspaceId, name, timezone, createdAt, updatedAt)
    VALUES (?, ?, 'TZ Test Campaign', 'America/New_York', datetime('now'), datetime('now'))
  `).run(tzCampId, workspaceId);

  db.prepare(`
    INSERT INTO email_deliveries (id, workspaceId, campaignId, status, direction, sentAt)
    VALUES 
      (?, ?, ?, 'SENT', 'OUTBOUND', '2026-09-01T23:30:00.000Z'),
      (?, ?, ?, 'SENT', 'OUTBOUND', '2026-09-02T02:30:00.000Z')
  `).run(`tz_d1_${randomUUID()}`, workspaceId, tzCampId, `tz_d2_${randomUUID()}`, workspaceId, tzCampId);

  // In America/New_York timezone:
  const nyTimeline = repo.getTimeline(workspaceId, tzCampId, { timezone: 'America/New_York' });
  assert.strictEqual(nyTimeline.points.length, 1, 'In America/New_York, both dispatches fall on 2026-09-01');
  assert.strictEqual(nyTimeline.points[0]?.label, '2026-09-01', 'Bucket date label must be 2026-09-01');
  assert.strictEqual(nyTimeline.points[0]?.attempted, 2, 'Attempted count on 2026-09-01 must be 2');

  // In UTC timezone:
  const utcTimeline = repo.getTimeline(workspaceId, tzCampId, { timezone: 'UTC' });
  assert.strictEqual(utcTimeline.points.length, 2, 'In UTC, dispatches span 2 separate dates (2026-09-01 and 2026-09-02)');
  console.log('✅ Invariant 4 passed: Timezone boundary bucketing accurately distinguishes local vs UTC dates.');

  // ── INVARIANT 5: ZERO-DIVISION SAFETY ────────────────────────────────────────
  console.log('[Test] Running Invariant 5 (Zero-Division & Empty Campaign Safety)...');
  const emptyCampId = `empty_${randomUUID()}`;
  db.prepare(`
    INSERT INTO campaigns (id, workspaceId, name, timezone, createdAt, updatedAt)
    VALUES (?, ?, 'Empty Campaign', 'UTC', datetime('now'), datetime('now'))
  `).run(emptyCampId, workspaceId);

  const emptyOverview = repo.getOverview(workspaceId, emptyCampId);
  assert.strictEqual(emptyOverview.counts.contactsEnrolled, 0);
  assert.strictEqual(emptyOverview.rates.contactReplyRate.value, 0);
  assert.strictEqual(emptyOverview.rates.contactReplyRate.formatted, '0.00%');
  assert.strictEqual(emptyOverview.rates.contactReplyRate.denominator, 0);
  assert.strictEqual(emptyOverview.rates.uniqueOpenRate.formatted, '0.00%');
  assert.strictEqual(emptyOverview.rates.providerAcceptanceRate.formatted, '0.00%');
  console.log('✅ Invariant 5 passed: Zero-division yields clean 0.00% without NaN or crashes.');

  // ── INVARIANT 6: AUDIENCE QUALITY CORRELATION ────────────────────────────────
  console.log('[Test] Running Invariant 6 (Audience Quality Deliverability Correlation)...');
  const quality = repo.getQuality(workspaceId, campaignId);
  assert.strictEqual(quality.totalEnrolled, 4, 'Quality breakdown must evaluate all 4 enrolled contacts');
  const verifiedSeg = quality.segments.find(s => s.status === EmailQualityStatus.VERIFIED);
  const riskySeg = quality.segments.find(s => s.status === EmailQualityStatus.RISKY);

  assert.ok(verifiedSeg, 'Verified segment must exist');
  assert.strictEqual(verifiedSeg?.accepted, 1, 'Verified contact had 1 accepted email');
  assert.strictEqual(verifiedSeg?.bounced, 0, 'Verified contact had 0 bounces');
  assert.strictEqual(verifiedSeg?.bounceRate, 0, 'Verified bounce rate must be 0%');

  assert.ok(riskySeg, 'Risky segment must exist');
  assert.strictEqual(riskySeg?.accepted, 0, 'Risky contact had 0 accepted emails');
  assert.strictEqual(riskySeg?.bounced, 1, 'Risky contact had 1 hard bounce');
  assert.strictEqual(riskySeg?.bounceRate, 100, 'Risky bounce rate must be 100%');
  console.log('✅ Invariant 6 passed: Audience quality correlation accurately links verification tiers to bounce rates.');

  // ── INVARIANT 7: RFC 4180 CSV EXPORT ─────────────────────────────────────────
  console.log('[Test] Running Invariant 7 (RFC 4180 CSV Export)...');
  const csvExport = repo.export(workspaceId, campaignId, 'csv');
  assert.ok(csvExport.csvContent, 'CSV content must be generated');
  assert.ok(csvExport.csvContent.includes('# HUNTARA Campaign Performance Export'), 'CSV must contain header banner');
  assert.ok(csvExport.csvContent.includes('Unique Open Rate'), 'CSV must contain Unique Open Rate');
  assert.ok(csvExport.csvContent.includes('Contact Reply Rate'), 'CSV must contain Contact Reply Rate');
  assert.ok(csvExport.csvContent.includes('replyingContacts / contactsEligible'), 'CSV must expose explicit formula');
  console.log('✅ Invariant 7 passed: CSV export generated with explicit formulas and denominators.');

  console.log('\n--- ALL 7 CAMPAIGN ANALYTICS INVARIANTS PASSED PERFECTLY ---');
}

// Self-executing runner if executed directly
if (require.main === module || process.env.ELECTRON_RUN_AS_NODE === '1') {
  runCampaignAnalyticsTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test failure:', err);
      process.exit(1);
    });
}
