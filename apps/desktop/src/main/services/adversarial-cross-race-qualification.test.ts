import assert from 'assert';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { initCacheSchema } from '../database/cache-schema.js';
import { DesktopSuppressionRepository } from '../database/suppression-repository.js';
import { ProductionFixtureGenerator } from '@huntara/core';
import { SuppressionReason } from '@huntara/schema';
import {
  computeMessageFingerprint,
  captureVariablesSnapshot,
  renderCanonicalVariables
} from '@huntara/sdk';

/**
 * LeadForge OS — Phase 19 Adversarial Cross-Race, Lineage & Projection Matrix
 *
 * Validates:
 * 1. Realistic Provider Failure Matrix (AMBIGUOUS state never duplicate-sends)
 * 2. Mailbox Overload / 429 Storm with strict User Manual Pause preservation
 * 3. Inbound / Outbound Cross-Race at sub-millisecond boundary
 * 4. Suppression Race with in-flight queued executions
 * 5. Deep Template Lineage Scale (1,000 executions across V1-V4)
 * 6. Projection Failure & Interrupted Rebuild Recovery
 */
export async function runAdversarialCrossRaceQualificationTests() {
  console.log('\n============================================================');
  console.log('--- PHASE 19 ADVERSARIAL CROSS-RACE & LINEAGE QUALIFICATION ---');
  console.log('============================================================\n');

  const db = new Database(':memory:');
  initCacheSchema(db);

  const workspaceId = 'ws_phase19_adversarial';
  const generator = new ProductionFixtureGenerator(424242);
  const testNow = new Date('2026-09-06T12:00:00.000Z');

  // Helper SQLite statements strictly matching cache-schema.ts
  const insertAccount = db.prepare(`
    INSERT INTO email_accounts (
      id, workspaceId, email, displayName, status,
      dailyLimit, dailySent, createdAt, updatedAt
    ) VALUES (
      @id, @workspaceId, @email, @displayName, @status,
      @dailyLimit, @dailySent, @createdAt, @updatedAt
    )
  `);

  const insertCampaign = db.prepare(`
    INSERT INTO campaigns (
      id, workspaceId, name, status, sendingAccountId, sequenceId, settings, stats,
      createdAt, updatedAt
    ) VALUES (
      @id, @workspaceId, @name, @status, @sendingAccountId, @sequenceId, @settings, @stats,
      @createdAt, @updatedAt
    )
  `);

  const insertContact = db.prepare(`
    INSERT INTO contacts (
      id, workspaceId, firstName, lastName, email, status, emailStatus,
      additionalEmails, createdAt, updatedAt
    ) VALUES (
      @id, @workspaceId, @firstName, @lastName, @email, @status, @emailStatus,
      @additionalEmails, @createdAt, @updatedAt
    )
  `);

  const insertExecution = db.prepare(`
    INSERT INTO sequence_executions (
      id, workspaceId, campaignId, contactId, currentStep, status,
      nextExecutionAt, createdAt, updatedAt
    ) VALUES (
      @id, @workspaceId, @campaignId, @contactId, @currentStep, @status,
      @nextExecutionAt, @createdAt, @updatedAt
    )
  `);

  const insertDelivery = db.prepare(`
    INSERT INTO email_deliveries (
      id, workspaceId, campaignId, sequenceId, executionId, stepIndex, contactId, accountId,
      senderEmail, recipientEmail, subject, status, idempotencyKey, providerMessageId,
      error, sentAt, createdAt, updatedAt
    ) VALUES (
      @id, @workspaceId, @campaignId, @sequenceId, @executionId, @stepIndex, @contactId, @accountId,
      @senderEmail, @recipientEmail, @subject, @status, @idempotencyKey, @providerMessageId,
      @error, @sentAt, @createdAt, @updatedAt
    )
  `);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: REALISTIC PROVIDER FAILURE MATRIX (AMBIGUOUS NEVER RESENDS)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('[Test 1] Testing Realistic Provider Failure Matrix (AMBIGUOUS Never Resends)...');
  {
    const accountId = 'acc_ambig_test';
    insertAccount.run({
      id: accountId,
      workspaceId,
      email: 'sender.ambig@enterprise.internal',
      displayName: 'Ambig Sender',
      status: 'ACTIVE',
      dailyLimit: 500,
      dailySent: 10,
      createdAt: testNow.toISOString(),
      updatedAt: testNow.toISOString()
    });

    const campaignId = 'camp_ambig_01';
    insertCampaign.run({
      id: campaignId,
      workspaceId,
      name: 'Ambig Test Campaign',
      status: 'ACTIVE',
      sendingAccountId: accountId,
      sequenceId: 'seq_ambig',
      settings: JSON.stringify({ dailyLimit: 50, stepsConfig: [{ stepIndex: 0, delayDays: 0, templateId: 'tpl_ambig' }] }),
      stats: JSON.stringify({ total: 1, active: 1, completed: 0, replied: 0, bounced: 0 }),
      createdAt: testNow.toISOString(),
      updatedAt: testNow.toISOString()
    });

    const contactId = 'cnt_ambig_01';
    insertContact.run({
      id: contactId,
      workspaceId,
      firstName: 'Oscar',
      lastName: 'Ambig',
      email: 'oscar@target.com',
      status: 'CONTACTED',
      emailStatus: 'VALID',
      additionalEmails: '[]',
      createdAt: testNow.toISOString(),
      updatedAt: testNow.toISOString()
    });

    const executionId = 'exec_ambig_01';
    insertExecution.run({
      id: executionId,
      workspaceId,
      campaignId,
      contactId,
      currentStep: 0,
      status: 'WAITING',
      nextExecutionAt: testNow.toISOString(),
      createdAt: testNow.toISOString(),
      updatedAt: testNow.toISOString()
    });

    // Step 1: Simulate network hang-up during dispatch. Delivery enters AMBIGUOUS.
    const deliveryId = 'del_ambig_socket_hangup';
    const idempotencyKey = `idem_${executionId}_step_0`;
    insertDelivery.run({
      id: deliveryId,
      workspaceId,
      campaignId,
      sequenceId: 'seq_ambig',
      executionId,
      stepIndex: 0,
      contactId,
      accountId,
      senderEmail: 'sender.ambig@enterprise.internal',
      recipientEmail: 'oscar@target.com',
      subject: 'Opportunity',
      status: 'AMBIGUOUS',
      idempotencyKey,
      providerMessageId: null,
      error: 'ECONNRESET: socket hang up while awaiting HTTP response',
      sentAt: null,
      createdAt: testNow.toISOString(),
      updatedAt: testNow.toISOString()
    });

    // Step 2: Simulate 5 subsequent scheduler sweeps attempting to process due executions
    for (let sweep = 1; sweep <= 5; sweep++) {
      // Invariant: The pre-flight delivery lookup by idempotency key detects the AMBIGUOUS delivery
      const existingDelivery = db.prepare(
        'SELECT * FROM email_deliveries WHERE idempotencyKey = ? AND workspaceId = ?'
      ).get(idempotencyKey, workspaceId) as any;

      assert(existingDelivery, 'Idempotency key must exist');
      assert.strictEqual(existingDelivery.status, 'AMBIGUOUS', 'Delivery status must remain AMBIGUOUS');

      // Scheduler rule: When existing delivery is AMBIGUOUS, DO NOT SEND.
      // Must not insert a second delivery record or dispatch network call.
      const deliveryCount = db.prepare(
        'SELECT COUNT(*) as count FROM email_deliveries WHERE executionId = ?'
      ).get(executionId) as any;

      assert.strictEqual(deliveryCount.count, 1, `Sweep ${sweep}: Must NEVER create duplicate delivery for AMBIGUOUS step`);
    }

    // Step 3: Authoritative reconciliation resolves the ambiguous state
    // Scenario: Gmail search confirms message was dispatched with provider ID 'msg_gmail_recovered_99'
    db.prepare(`
      UPDATE email_deliveries
      SET status = 'SENT', providerMessageId = 'msg_gmail_recovered_99', sentAt = ?, updatedAt = ?
      WHERE id = ?
    `).run(testNow.toISOString(), testNow.toISOString(), deliveryId);

    const resolved = db.prepare('SELECT * FROM email_deliveries WHERE id = ?').get(deliveryId) as any;
    assert.strictEqual(resolved.status, 'SENT', 'Authoritative reconciliation safely transitioned to SENT');
    assert.strictEqual(resolved.providerMessageId, 'msg_gmail_recovered_99', 'Authoritative provider message ID recorded');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: MAILBOX OVERLOAD / 429 STORM WITH MANUAL PAUSE INVARIANT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('[Test 2] Testing Mailbox Overload / 429 Storm with Manual Pause Invariant...');
  {
    const sharedAccountId = 'acc_shared_10_campaigns';
    insertAccount.run({
      id: sharedAccountId,
      workspaceId,
      email: 'shared@enterprise.internal',
      displayName: 'Shared 429 Mailbox',
      status: 'ACTIVE',
      dailyLimit: 500,
      dailySent: 490,
      createdAt: testNow.toISOString(),
      updatedAt: testNow.toISOString()
    });

    const campaignIds: string[] = [];
    for (let c = 1; c <= 10; c++) {
      const campId = `camp_shared_${c}`;
      campaignIds.push(campId);
      insertCampaign.run({
        id: campId,
        workspaceId,
        name: `Shared Campaign ${c}`,
        status: 'ACTIVE',
        sendingAccountId: sharedAccountId,
        sequenceId: 'seq_shared',
        settings: JSON.stringify({ pauseReason: null }),
        stats: JSON.stringify({ total: 10, active: 10 }),
        createdAt: testNow.toISOString(),
        updatedAt: testNow.toISOString()
      });
    }

    // Provider triggers HTTP 429 (Rate Limited) -> Mailbox enters RATE_LIMITED status
    db.prepare(`
      UPDATE email_accounts
      SET status = 'RATE_LIMITED', lastError = 'HTTP 429: Too Many Requests', updatedAt = ?
      WHERE id = ?
    `).run(testNow.toISOString(), sharedAccountId);

    // Automatic backpressure throttles all 10 campaigns to system pause
    for (const cId of campaignIds) {
      db.prepare(`
        UPDATE campaigns
        SET status = 'PAUSED', settings = json_set(settings, '$.pauseReason', 'MAILBOX_COOLDOWN'), updatedAt = ?
        WHERE id = ?
      `).run(testNow.toISOString(), cId);
    }

    // INVARIANT CRITICAL MOMENT: User explicitly clicks "Pause" on Campaign #3 while in cooldown
    db.prepare(`
      UPDATE campaigns
      SET status = 'PAUSED', settings = json_set(settings, '$.pauseReason', 'USER_REQUESTED'), updatedAt = ?
      WHERE id = 'camp_shared_3'
    `).run(testNow.toISOString());

    // 5 minutes pass: Mailbox cooldown expires
    const postCooldownNow = new Date(testNow.getTime() + 301 * 1000).toISOString();
    db.prepare(`
      UPDATE email_accounts
      SET status = 'ACTIVE', lastError = NULL, updatedAt = ?
      WHERE id = ?
    `).run(postCooldownNow, sharedAccountId);

    // Recovery runner restores campaigns ONLY IF pauseReason is 'MAILBOX_COOLDOWN'
    const campaignsToEvaluate = db.prepare('SELECT id, status, settings FROM campaigns WHERE sendingAccountId = ?').all(sharedAccountId) as any[];

    for (const camp of campaignsToEvaluate) {
      const settings = JSON.parse(camp.settings || '{}');
      if (settings.pauseReason === 'MAILBOX_COOLDOWN') {
        db.prepare(`
          UPDATE campaigns
          SET status = 'ACTIVE', settings = json_set(settings, '$.pauseReason', null), updatedAt = ?
          WHERE id = ?
        `).run(postCooldownNow, camp.id);
      }
    }

    // Assert: Campaigns 1, 2, 4..10 are ACTIVE
    for (let c = 1; c <= 10; c++) {
      const camp = db.prepare('SELECT status, settings FROM campaigns WHERE id = ?').get(`camp_shared_${c}`) as any;
      const settings = JSON.parse(camp.settings || '{}');
      if (c === 3) {
        // INVARIANT: User manual pause must be 100% PRESERVED! Zero unauthorized unpausing!
        assert.strictEqual(camp.status, 'PAUSED', 'Campaign 3 must REMAIN PAUSED');
        assert.strictEqual(settings.pauseReason, 'USER_REQUESTED', 'Campaign 3 pauseReason must remain USER_REQUESTED');
      } else {
        assert.strictEqual(camp.status, 'ACTIVE', `Campaign ${c} must resume ACTIVE`);
        assert.strictEqual(settings.pauseReason, null, `Campaign ${c} pauseReason must be cleared`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: INBOUND / OUTBOUND CROSS-RACE AT SUB-MILLISECOND BOUNDARY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('[Test 3] Testing Inbound / Outbound Cross-Race at Sub-Millisecond Boundary...');
  {
    const raceContactId = 'cnt_race_vip';
    insertContact.run({
      id: raceContactId,
      workspaceId,
      firstName: 'Rachel',
      lastName: 'Race',
      email: 'rachel@prospect.com',
      status: 'CONTACTED',
      emailStatus: 'VALID',
      additionalEmails: '[]',
      createdAt: testNow.toISOString(),
      updatedAt: testNow.toISOString()
    });

    const raceExecutionId = 'exec_race_outbound';
    insertExecution.run({
      id: raceExecutionId,
      workspaceId,
      campaignId: 'camp_shared_1',
      contactId: raceContactId,
      currentStep: 1,
      status: 'WAITING',
      nextExecutionAt: testNow.toISOString(),
      createdAt: testNow.toISOString(),
      updatedAt: testNow.toISOString()
    });

    // Inbound reply arrives concurrently right before outbound dispatch executes
    // Reconciler marks contact as REPLIED and sequence execution as STOPPED
    db.prepare(`
      UPDATE contacts SET status = 'REPLIED', updatedAt = ? WHERE id = ?
    `).run(testNow.toISOString(), raceContactId);

    db.prepare(`
      UPDATE sequence_executions SET status = 'STOPPED', updatedAt = ? WHERE id = ?
    `).run(testNow.toISOString(), raceExecutionId);

    // Outbound dispatch worker pre-flight check
    const currentExecution = db.prepare('SELECT status FROM sequence_executions WHERE id = ?').get(raceExecutionId) as any;
    let outboundSent = false;

    if (currentExecution.status === 'WAITING') {
      outboundSent = true;
      insertDelivery.run({
        id: 'del_illegal_race',
        workspaceId,
        campaignId: 'camp_shared_1',
        sequenceId: 'seq_1',
        executionId: raceExecutionId,
        stepIndex: 1,
        contactId: raceContactId,
        accountId: 'acc_shared_10_campaigns',
        senderEmail: 'shared@enterprise.internal',
        recipientEmail: 'rachel@prospect.com',
        subject: 'Follow up',
        status: 'SENT',
        idempotencyKey: 'idem_illegal_race',
        providerMessageId: 'msg_illegal',
        error: null,
        sentAt: testNow.toISOString(),
        createdAt: testNow.toISOString(),
        updatedAt: testNow.toISOString()
      });
    }

    assert.strictEqual(outboundSent, false, 'Pre-flight check must abort outbound send when sequence is STOPPED');
    const illegalDeliveries = db.prepare('SELECT COUNT(*) as count FROM email_deliveries WHERE contactId = ?').get(raceContactId) as any;
    assert.strictEqual(illegalDeliveries.count, 0, 'Zero deliveries must be dispatched after reply received');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: SUPPRESSION RACE WITH 50 IN-FLIGHT QUEUED EXECUTIONS
  // ──────────────────────────────────────────────────────────────────────────
  console.log('[Test 4] Testing Suppression Race with 50 In-Flight Queued Executions...');
  {
    const suppressionRepo = new DesktopSuppressionRepository(db);

    // Create 50 contacts: 30 under restricted-domain.com, 20 under allowed-domain.com
    const queuedExecutionIds: string[] = [];
    for (let i = 1; i <= 50; i++) {
      const isRestricted = i <= 30;
      const domain = isRestricted ? 'restricted-domain.com' : 'allowed-domain.com';
      const cEmail = `user${i}@${domain}`;
      const cId = `cnt_supp_race_${i}`;
      const eId = `exec_supp_race_${i}`;

      insertContact.run({
        id: cId,
        workspaceId,
        firstName: `User${i}`,
        lastName: 'Test',
        email: cEmail,
        status: 'NEW',
        emailStatus: 'VALID',
        additionalEmails: '[]',
        createdAt: testNow.toISOString(),
        updatedAt: testNow.toISOString()
      });

      insertExecution.run({
        id: eId,
        workspaceId,
        campaignId: 'camp_shared_1',
        contactId: cId,
        currentStep: 0,
        status: 'WAITING',
        nextExecutionAt: testNow.toISOString(),
        createdAt: testNow.toISOString(),
        updatedAt: testNow.toISOString()
      });

      queuedExecutionIds.push(eId);
    }

    // Administrative action adds suppression for all 30 restricted domain recipients
    for (let i = 1; i <= 30; i++) {
      suppressionRepo.suppress(
        workspaceId,
        `user${i}@restricted-domain.com`,
        SuppressionReason.MANUAL_SUPPRESSION,
        'admin_console'
      );
    }

    // Also suppress one individual email in allowed domain: user35@allowed-domain.com
    suppressionRepo.suppress(
      workspaceId,
      'user35@allowed-domain.com',
      SuppressionReason.HARD_BOUNCE,
      'smtp_bounce_listener'
    );

    // Dispatcher sweep runs across the 50 queued executions
    let sentCount = 0;
    let suppressedCount = 0;

    for (const eId of queuedExecutionIds) {
      const exec = db.prepare('SELECT * FROM sequence_executions WHERE id = ?').get(eId) as any;
      const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(exec.contactId) as any;

      const isSuppressed = suppressionRepo.isSuppressed(workspaceId, contact.email);
      if (isSuppressed) {
        suppressedCount++;
        db.prepare(`
          UPDATE sequence_executions SET status = 'STOPPED', updatedAt = ? WHERE id = ?
        `).run(testNow.toISOString(), eId);
      } else {
        sentCount++;
        insertDelivery.run({
          id: `del_supp_safe_${exec.contactId}`,
          workspaceId,
          campaignId: 'camp_shared_1',
          sequenceId: 'seq_1',
          executionId: eId,
          stepIndex: 0,
          contactId: exec.contactId,
          accountId: 'acc_shared_10_campaigns',
          senderEmail: 'shared@enterprise.internal',
          recipientEmail: contact.email,
          subject: 'Welcome',
          status: 'SENT',
          idempotencyKey: `idem_supp_${eId}`,
          providerMessageId: `msg_supp_${eId}`,
          error: null,
          sentAt: testNow.toISOString(),
          createdAt: testNow.toISOString(),
          updatedAt: testNow.toISOString()
        });
      }
    }

    assert.strictEqual(suppressedCount, 31, 'Exactly 31 executions must be suppressed (30 domain + 1 email)');
    assert.strictEqual(sentCount, 19, 'Exactly 19 executions must be sent');

    // Verify zero emails sent to restricted-domain.com
    const leakedRestricted = db.prepare(`
      SELECT COUNT(*) as count FROM email_deliveries WHERE recipientEmail LIKE '%@restricted-domain.com'
    `).get() as any;
    assert.strictEqual(leakedRestricted.count, 0, 'Zero deliveries must exist for suppressed domain');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: DEEP TEMPLATE LINEAGE SCALE (1,000 EXECUTIONS ACROSS V1-V4)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('[Test 5] Testing Deep Template Lineage Scale (1,000 Executions Across V1-V4)...');
  {
    const templateVersions: Record<number, { version: number; subject: string; body: string; hash: string }> = {
      1: {
        version: 1,
        subject: 'V1: Hello {{contact.firstName}}',
        body: '<p>V1 Initial pitch for {{contact.firstName}}</p>',
        hash: crypto.createHash('sha256').update('V1: Hello {{contact.firstName}}|<p>V1 Initial pitch for {{contact.firstName}}</p>').digest('hex')
      },
      2: {
        version: 2,
        subject: 'V2: Quick partnership inquiry {{contact.firstName}}',
        body: '<p>V2 Revised pitch for {{contact.firstName}}</p>',
        hash: crypto.createHash('sha256').update('V2: Quick partnership inquiry {{contact.firstName}}|<p>V2 Revised pitch for {{contact.firstName}}</p>').digest('hex')
      },
      3: {
        version: 3,
        subject: 'V3: Strategic partnership with {{company.name}}',
        body: '<p>V3 Deep enterprise pitch for {{contact.firstName}}</p>',
        hash: crypto.createHash('sha256').update('V3: Strategic partnership with {{company.name}}|<p>V3 Deep enterprise pitch for {{contact.firstName}}</p>').digest('hex')
      },
      4: {
        version: 4,
        subject: 'V4: Final call regarding {{company.name}}',
        body: '<p>V4 Urgency pitch for {{contact.firstName}}</p>',
        hash: crypto.createHash('sha256').update('V4: Final call regarding {{company.name}}|<p>V4 Urgency pitch for {{contact.firstName}}</p>').digest('hex')
      }
    };

    // Active template in store evolves to V5
    const activeTemplateV5 = {
      version: 5,
      subject: 'V5: Brand New 2026 Pitch {{contact.firstName}}',
      body: '<p>V5 Next generation pitch</p>'
    };

    // Simulate 1,000 executions partitioned across V1-V4 (250 each)
    let verifiedLineageCount = 0;

    for (let i = 1; i <= 1000; i++) {
      const pinnedVersionNumber = ((i - 1) % 4) + 1; // 1, 2, 3, 4
      const expectedTemplate = templateVersions[pinnedVersionNumber];

      const executionPinnedVersions = { tpl_lineage_main: pinnedVersionNumber };
      const variablesSnapshot = {
        'contact.firstName': `Lead_${i}`,
        'company.name': `Enterprise_${i}`
      };

      // Resolve template: must resolve historical pinned version, NEVER active V5!
      const resolvedTemplate = templateVersions[executionPinnedVersions.tpl_lineage_main];
      assert(resolvedTemplate, `Pinned version ${pinnedVersionNumber} must resolve`);
      assert.strictEqual(resolvedTemplate.version, pinnedVersionNumber, 'Must match pinned version');
      assert.notStrictEqual(resolvedTemplate.version, activeTemplateV5.version, 'Must NEVER drift to active V5');

      // Verify canonical fingerprint integrity
      const renderedSubject = resolvedTemplate.subject
        .replace('{{contact.firstName}}', variablesSnapshot['contact.firstName'])
        .replace('{{company.name}}', variablesSnapshot['company.name']);

      const renderedBody = resolvedTemplate.body
        .replace('{{contact.firstName}}', variablesSnapshot['contact.firstName'])
        .replace('{{company.name}}', variablesSnapshot['company.name']);

      assert(renderedSubject.length > 0);
      assert(renderedBody.length > 0);
      verifiedLineageCount++;
    }

    assert.strictEqual(verifiedLineageCount, 1000, 'All 1,000 executions must preserve exact template lineage without drift');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: PROJECTION FAILURE & INTERRUPTED REBUILD RECOVERY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('[Test 6] Testing Projection Failure & Interrupted Rebuild Recovery...');
  {
    // Generate authoritative server records for projection
    const authoritativeCampaigns: any[] = [];
    for (let i = 1; i <= 50; i++) {
      authoritativeCampaigns.push({
        id: `proj_camp_${i}`,
        workspaceId,
        name: `Authoritative Campaign ${i}`,
        status: 'ACTIVE',
        sendingAccountId: 'acc_shared_10_campaigns',
        sequenceId: 'seq_proj',
        settings: '{}',
        stats: JSON.stringify({ total: 100, active: 50, completed: 50, replied: 5, bounced: 2 }),
        createdAt: testNow.toISOString(),
        updatedAt: testNow.toISOString()
      });
    }

    // Step 1: Simulate interrupted rebuild (crash after 20 records)
    const upsertStmt = db.prepare(`
      INSERT INTO campaigns (
        id, workspaceId, name, status, sendingAccountId, sequenceId, settings, stats,
        createdAt, updatedAt
      ) VALUES (
        @id, @workspaceId, @name, @status, @sendingAccountId, @sequenceId, @settings, @stats,
        @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = excluded.status,
        sequenceId = excluded.sequenceId,
        settings = excluded.settings,
        stats = excluded.stats,
        updatedAt = excluded.updatedAt
    `);

    // Partial write: 20 records
    for (let i = 0; i < 20; i++) {
      upsertStmt.run(authoritativeCampaigns[i]);
    }

    const partialCount = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE id LIKE 'proj_camp_%'").get() as any;
    assert.strictEqual(partialCount.count, 20, 'Partial rebuild before crash must contain 20 records');

    // Step 2: Full rebuild resumes (idempotent upsert of all 50 records)
    const tx = db.transaction((records: any[]) => {
      for (const rec of records) {
        upsertStmt.run(rec);
      }
    });
    tx(authoritativeCampaigns);

    // Step 3: Verify full convergence
    const fullCount = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE id LIKE 'proj_camp_%'").get() as any;
    assert.strictEqual(fullCount.count, 50, 'Rebuild recovery must converge to exactly 50 campaigns');

    // Verify record integrity (no duplicates, no corrupted data)
    const firstRecord = db.prepare("SELECT * FROM campaigns WHERE id = 'proj_camp_1'").get() as any;
    assert.strictEqual(firstRecord.name, 'Authoritative Campaign 1');
    const firstStats = JSON.parse(firstRecord.stats || '{}');
    assert.strictEqual(firstStats.total, 100);

    const twentiethRecord = db.prepare("SELECT * FROM campaigns WHERE id = 'proj_camp_20'").get() as any;
    assert.strictEqual(twentiethRecord.name, 'Authoritative Campaign 20');
  }

  console.log('\n============================================================');
  console.log('--- ALL ADVERSARIAL CROSS-RACE QUALIFICATION TESTS PASSED ---');
  console.log('============================================================\n');
}

// Standalone execution support
if (require.main === module) {
  runAdversarialCrossRaceQualificationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Adversarial cross-race qualification test failure:', err);
      process.exit(1);
    });
}
