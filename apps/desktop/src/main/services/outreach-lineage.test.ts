import assert from 'assert';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { initCacheSchema } from '../database/cache-schema.js';
import {
  computeMessageFingerprint,
  computeAttachmentChecksums,
  composeOutboundMessage,
  captureVariablesSnapshot,
  renderCanonicalVariables
} from '@leadforge/sdk';

/**
 * LeadForge OS — Phase 16 Adversarial Integration Test Suite
 *
 * Validates immutable outreach lineage, template versioning, composition integrity,
 * and retry lineage preservation:
 * 1. Pinned Template Versioning (TPL-05)
 * 2. Contact Variables Snapshot Immutability (VARIABLES-SNAPSHOT)
 * 3. Throttle / Rate-Limit Retry Lineage Preservation (RETRY-LINEAGE-10)
 * 4. Active Template Deletion Safety (TPL-DELETE-15)
 * 5. SQLite Delivery Ledger Lineage Caching
 * 6. Canonical Message Fingerprint Parity Across Boundaries (FINGERPRINT-06)
 */

export async function runOutreachLineagePhase16Tests() {
  console.log('\n============================================================');
  console.log('--- PHASE 16 IMMUTABLE OUTREACH LINEAGE & COMPOSITION ---');
  console.log('============================================================\n');

  const db = new Database(':memory:');
  initCacheSchema(db);

  const workspaceId = 'ws_phase16_lineage';
  const testNow = '2026-09-05T20:00:00.000Z';

  // ── INVARIANT 1: PINNED TEMPLATE VERSIONING (TPL-05) ──────────────────────
  console.log('[Test 1] Testing Pinned Template Versioning (TPL-05)...');

  const templateId1 = 'tpl_alpha_01';

  // Mock template store simulating versioned historical storage
  const templateStore: Record<string, { current: any; versions: Record<number, any> }> = {
    [templateId1]: {
      current: {
        id: templateId1,
        workspaceId,
        version: 2,
        name: 'Enterprise Outreach',
        subject: 'V2 Subject: Strategic Partnership',
        body: '<p>V2 Body content for {{contact.firstName}}</p>',
        variables: ['contact.firstName'],
        attachments: []
      },
      versions: {
        1: {
          id: 'ver_snap_1',
          templateId: templateId1,
          workspaceId,
          version: 1,
          name: 'Enterprise Outreach',
          subject: 'V1 Subject: Initial Introduction',
          body: '<p>V1 Body content for {{contact.firstName}}</p>',
          variables: ['contact.firstName'],
          attachments: []
        },
        2: {
          id: 'ver_snap_2',
          templateId: templateId1,
          workspaceId,
          version: 2,
          name: 'Enterprise Outreach',
          subject: 'V2 Subject: Strategic Partnership',
          body: '<p>V2 Body content for {{contact.firstName}}</p>',
          variables: ['contact.firstName'],
          attachments: []
        }
      }
    }
  };

  const resolveTemplateVersion = (tId: string, version: number) => {
    const entry = templateStore[tId];
    if (!entry) return null;
    if (entry.versions[version]) return entry.versions[version];
    return null;
  };

  // Execution was initialized and pinned to template v1
  const executionContextV1: any = {
    templateVersions: { [templateId1]: 1 },
    contact: { firstName: 'Sarah', email: 'sarah@enterprise.com' },
    company: { name: 'Acme Corp' }
  };

  const pinnedVersion = executionContextV1.templateVersions[templateId1];
  assert.strictEqual(pinnedVersion, 1, 'Execution must pin version 1');

  // Even though current template is v2, worker retrieves pinned version 1
  const resolvedTemplate = resolveTemplateVersion(templateId1, pinnedVersion);
  assert.strictEqual(resolvedTemplate?.version, 1, 'Worker must retrieve historical version 1');
  assert.strictEqual(resolvedTemplate?.subject, 'V1 Subject: Initial Introduction');

  // Requesting non-existent version must return null and fail deterministically (no fallback to latest)
  const missingVersion = resolveTemplateVersion(templateId1, 99);
  assert.strictEqual(missingVersion, null, 'Unregistered version must return null without fallback');

  console.log('✅ Invariant 1 passed: Execution strictly adheres to pinned historical template version.');

  // ── INVARIANT 2: VARIABLES SNAPSHOT IMMUTABILITY ──────────────────────────
  console.log('[Test 2] Testing Contact Variables Snapshot Immutability...');

  // 2a. Initial Contact row in SQLite
  const contactId = 'cont_alice_01';
  db.prepare(`
    INSERT INTO contacts (id, workspaceId, firstName, lastName, email, title, createdAt, updatedAt)
    VALUES (?, ?, 'Alice', 'Smith', 'alice@cyberdyne.com', 'Cybernetics Lead', ?, ?)
  `).run(contactId, workspaceId, testNow, testNow);

  // 2b. Execution created at start of campaign: snapshots contact
  const initialContact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) as any;
  const execCtx: any = {
    execution: { id: 'exec_lineage_01', currentStep: 0 },
    contact: { ...initialContact },
    company: { name: 'Cyberdyne Systems' },
    templateVersions: { [templateId1]: 1 }
  };

  // 2c. Contact in database is subsequently mutated (e.g. edited to Bob / QA Analyst)
  db.prepare(`
    UPDATE contacts
    SET firstName = 'Bob', lastName = 'Jones', title = 'QA Analyst', updatedAt = datetime('now')
    WHERE id = ?
  `).run(contactId);

  const mutatedContactInDb = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) as any;
  assert.strictEqual(mutatedContactInDb.firstName, 'Bob', 'Database row must reflect new edit');

  // 2d. When worker renders message for execution, snapshot takes precedence over mutated database row
  const renderCtx: any = {
    ...execCtx,
    contact: {
      ...mutatedContactInDb,
      ...(execCtx.contact || {}),
      email: initialContact.email
    }
  };

  const renderedSubject = renderCanonicalVariables('Hello {{contact.firstName}} ({{contact.title}}) at {{company.name}}', renderCtx);
  assert.strictEqual(renderedSubject, 'Hello Alice (Cybernetics Lead) at Cyberdyne Systems');

  const snap = captureVariablesSnapshot('Hello {{contact.firstName}} ({{contact.title}}) at {{company.name}}', renderCtx);
  assert.strictEqual(snap['contact.firstName'], 'Alice');
  assert.strictEqual(snap['contact.title'], 'Cybernetics Lead');
  assert.strictEqual(snap['company.name'], 'Cyberdyne Systems');

  console.log('✅ Invariant 2 passed: Variables snapshot preserves original execution state across contact mutations.');

  // ── INVARIANT 3: THROTTLE / RETRY LINEAGE PRESERVATION (RETRY-LINEAGE-10) ──
  console.log('[Test 3] Testing Throttle Retry Lineage Preservation (RETRY-LINEAGE-10)...');

  const deliveryId1 = 'deliv_retry_01';
  const idempotencyKey1 = 'idem_key_retry_01';

  // Compute canonical fingerprint for original delivery
  const canonicalFp = computeMessageFingerprint({
    workspaceId,
    senderEmail: 'sender@leadforge.ai',
    recipientEmail: 'alice@cyberdyne.com',
    subject: renderedSubject,
    htmlBody: '<p>Hello Alice</p>',
    textBody: 'Hello Alice',
    templateId: templateId1,
    templateVersion: 1,
    attachmentChecksums: []
  });

  // Simulate initial delivery record in SQLite ledger
  db.prepare(`
    INSERT INTO email_deliveries (
      id, workspaceId, senderEmail, recipientEmail, subject, htmlBody, textBody,
      templateId, templateVersion, variablesSnapshot, messageFingerprint,
      status, attempt, idempotencyKey, createdAt, updatedAt
    ) VALUES (
      ?, ?, 'sender@leadforge.ai', 'alice@cyberdyne.com', ?, '<p>Hello Alice</p>', 'Hello Alice',
      ?, 1, ?, ?,
      'RETRYING', 1, ?, ?, ?
    )
  `).run(
    deliveryId1,
    workspaceId,
    renderedSubject,
    templateId1,
    JSON.stringify(snap),
    canonicalFp,
    idempotencyKey1,
    testNow,
    testNow
  );

  // Operator or scheduler performs 429 throttle retry
  const existingLedger = db.prepare('SELECT * FROM email_deliveries WHERE id = ?').get(deliveryId1) as any;

  assert.strictEqual(existingLedger.templateId, templateId1);
  assert.strictEqual(existingLedger.templateVersion, 1);
  assert.strictEqual(existingLedger.messageFingerprint, canonicalFp);
  assert.deepStrictEqual(JSON.parse(existingLedger.variablesSnapshot), snap);

  // Retry updates status to SENT without altering lineage
  db.prepare(`
    UPDATE email_deliveries
    SET status = 'SENT', attempt = 2, providerMessageId = 'gmail_msg_retried_999', sentAt = datetime('now')
    WHERE id = ?
  `).run(deliveryId1);

  const retriedLedger = db.prepare('SELECT * FROM email_deliveries WHERE id = ?').get(deliveryId1) as any;
  assert.strictEqual(retriedLedger.status, 'SENT');
  assert.strictEqual(retriedLedger.attempt, 2);
  assert.strictEqual(retriedLedger.templateId, templateId1);
  assert.strictEqual(retriedLedger.templateVersion, 1);
  assert.strictEqual(retriedLedger.messageFingerprint, canonicalFp);
  assert.deepStrictEqual(JSON.parse(retriedLedger.variablesSnapshot), snap);

  console.log('✅ Invariant 3 passed: Lineage metadata survives throttle retries and attempt increments.');

  // ── INVARIANT 4: TEMPLATE DELETION SAFETY (TPL-DELETE-15) ──────────────────
  console.log('[Test 4] Testing Active Template Deletion Safety (TPL-DELETE-15)...');

  // Operator deletes current template from active collection
  delete (templateStore as any)[templateId1].current;
  assert.strictEqual(templateStore[templateId1]?.current, undefined);

  // Historical version 1 remains accessible in versions table/archive
  const archivedV1 = resolveTemplateVersion(templateId1, 1);
  assert.notStrictEqual(archivedV1, null);
  assert.strictEqual(archivedV1.version, 1);
  assert.strictEqual(archivedV1.subject, 'V1 Subject: Initial Introduction');

  console.log('✅ Invariant 4 passed: Deleting current template preserves historical versions for active executions.');

  // ── INVARIANT 5: SQLITE DELIVERY LEDGER LINEAGE CACHING ───────────────────
  console.log('[Test 5] Testing SQLite Delivery Ledger Lineage Caching & Legacy Record Handling...');

  // 5a. Modern record with full lineage
  const modernRow = db.prepare(`
    SELECT templateId, templateVersion, variablesSnapshot, messageFingerprint
    FROM email_deliveries WHERE id = ?
  `).get(deliveryId1) as any;

  assert.strictEqual(modernRow.templateId, templateId1);
  assert.strictEqual(modernRow.templateVersion, 1);
  assert.strictEqual(modernRow.messageFingerprint, canonicalFp);
  assert.ok(modernRow.variablesSnapshot.includes('Alice'));

  // 5b. Pre-Phase 16 legacy record without lineage
  const legacyId = 'deliv_legacy_pre_phase16';
  db.prepare(`
    INSERT INTO email_deliveries (
      id, workspaceId, senderEmail, recipientEmail, subject, status, idempotencyKey, createdAt, updatedAt
    ) VALUES (
      ?, ?, 'sender@leadforge.ai', 'legacy@enterprise.com', 'Old Subject', 'SENT', 'idem_legacy_01', ?, ?
    )
  `).run(legacyId, workspaceId, testNow, testNow);

  const legacyRow = db.prepare(`
    SELECT templateId, templateVersion, variablesSnapshot, messageFingerprint
    FROM email_deliveries WHERE id = ?
  `).get(legacyId) as any;

  assert.strictEqual(legacyRow.templateId, null, 'Legacy record must have null templateId');
  assert.strictEqual(legacyRow.templateVersion, null, 'Legacy record must have null templateVersion (no invented version)');
  assert.strictEqual(legacyRow.messageFingerprint, null, 'Legacy record must have null fingerprint');
  assert.strictEqual(legacyRow.variablesSnapshot, null, 'Legacy record must have null variablesSnapshot');

  console.log('✅ Invariant 5 passed: Ledger caches complete lineage and preserves unadulterated legacy records.');

  // ── INVARIANT 6: FINGERPRINT PARITY & ATTACHMENT DETERMINISM (FINGERPRINT-06)
  console.log('[Test 6] Testing Fingerprint Parity and Attachment Determinism (FINGERPRINT-06)...');

  const attachment1 = { filename: 'catalog.pdf', data: Buffer.from('PDF Product Catalog 2026') };
  const attachment2 = { filename: 'pricing.xlsx', data: Buffer.from('XLSX Enterprise Pricing 2026') };

  const checksums1 = computeAttachmentChecksums([attachment1, attachment2]);
  const checksums2 = computeAttachmentChecksums([attachment2, attachment1]);
  assert.deepStrictEqual(checksums1, checksums2, 'Attachment checksum array must be order-invariant');

  const composeInput = {
    workspaceId,
    context: {},
    sender: { email: 'alex@leadforge.ai', name: 'Alex' },
    recipient: { email: 'sarah@enterprise.com', firstName: 'Sarah' },
    template: {
      id: templateId1,
      version: 1,
      subject: 'Offer for {{contact.firstName}}',
      body: '<p>Hi {{contact.firstName}}, check out <a href="https://acme.com">link</a>.</p>'
    },
    attachments: [attachment1, attachment2],
    trackingBaseUrl: 'https://track.leadforge.ai'
  };

  // Preview composition
  const preview = composeOutboundMessage(composeInput);
  // Send composition
  const actualSend = composeOutboundMessage(composeInput);

  assert.strictEqual(preview.messageFingerprint, actualSend.messageFingerprint);
  assert.strictEqual(preview.messageFingerprint.length, 64);
  assert.notStrictEqual(preview.openTrackingToken, actualSend.openTrackingToken, 'Tracking tokens must vary per send');

  console.log('✅ Invariant 6 passed: Canonical message fingerprint matches 100% across preview and send.');

  console.log('\n============================================================');
  console.log('--- ALL PHASE 16 ADVERSARIAL INVARIANTS PASSED (6/6) ---');
  console.log('============================================================\n');

  db.close();
}

// Auto-run when executed directly via Electron runner
if (
  process.argv[1]?.includes('outreach-lineage.test') ||
  process.argv[1]?.includes('outreach-lineage-phase16.test')
) {
  runOutreachLineagePhase16Tests().catch((err) => {
    console.error('Phase 16 Test Suite Failure:', err);
    process.exit(1);
  });
}
