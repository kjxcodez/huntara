import assert from 'assert';
import Database from 'better-sqlite3';
import { plainTextToHtml, formatEmailBody, renderCanonicalVariables, type CanonicalVariableContext } from '@huntara/sdk';
import { initCacheSchema } from '../database/cache-schema.js';

export async function runPostReleaseStabilizationTests() {
  console.log('\n============================================================');
  console.log('--- POST-RELEASE STABILIZATION REGRESSION TEST SUITE ---');
  console.log('============================================================\n');

  // ── 1. MESSAGE FORMATTING & SAFE HTML GENERATION ────────────────────────────
  console.log('[Test 1] Testing plainTextToHtml & formatEmailBody formatting rules...');

  const rawPlainText = `Hi {{contact.firstName}},\n\nI noticed {{company.name}} is expanding.\nAre you free for a quick chat tomorrow?\n\nBest regards,\n{{sender.name}}`;
  const renderCtx: CanonicalVariableContext = {
    contact: { firstName: 'Alice' },
    company: { name: 'Acme Corp' },
    sender: { name: 'Bob' }
  };
  const interpolated = renderCanonicalVariables(rawPlainText, renderCtx);
  assert.strictEqual(
    interpolated,
    `Hi Alice,\n\nI noticed Acme Corp is expanding.\nAre you free for a quick chat tomorrow?\n\nBest regards,\nBob`
  );

  const formatted = formatEmailBody(interpolated);
  assert.strictEqual(formatted.text, interpolated, 'formatted.text must preserve raw plain-text with newlines');

  // Verify HTML structure
  assert.ok(formatted.html.startsWith('<div style="font-family:sans-serif;line-height:107%;">'));
  assert.ok(formatted.html.endsWith('</div>'));
  assert.ok(formatted.html.includes('<p class="MsoNormal" style="margin:0in 0in 8pt;line-height:107%;font-size:11pt;font-family:Calibri,sans-serif">Hi Alice,</p>'));
  assert.ok(formatted.html.includes('<p class="MsoNormal" style="margin:0in 0in 8pt;line-height:107%;font-size:11pt;font-family:Calibri,sans-serif">I noticed Acme Corp is expanding.<br/>Are you free for a quick chat tomorrow?</p>'));
  assert.ok(formatted.html.includes('<p class="MsoNormal" style="margin:0in 0in 8pt;line-height:107%;font-size:11pt;font-family:Calibri,sans-serif">Best regards,<br/>Bob</p>'));

  // Test HTML character escaping
  const unsafeText = '5 < 10 & 20 > 15 "quote" \'single\'\n\nNext paragraph';
  const safeHtml = plainTextToHtml(unsafeText);
  assert.ok(safeHtml.includes('&lt;'), '< must be escaped to &lt;');
  assert.ok(safeHtml.includes('&gt;'), '> must be escaped to &gt;');
  assert.ok(safeHtml.includes('&amp;'), '& must be escaped to &amp;');
  assert.ok(safeHtml.includes('&quot;'), '" must be escaped to &quot;');
  assert.ok(safeHtml.includes('&#39;'), "' must be escaped to &#39;");
  assert.ok(safeHtml.includes('font-family:sans-serif'));
  assert.ok(safeHtml.includes('line-height:107%'));
  assert.ok(!safeHtml.includes('< 10'), 'Raw unescaped < must not be present');

  console.log('✅ Formatting tests passed: single newlines convert to <br/>, blank lines to <p>, entities escaped safely, and typography is default sans-serif at 107% line-height.');

  // ── 2. MIGRATION 031 & TEMPLATE ATTACHMENTS ────────────────────────────────
  console.log('\n[Test 2] Testing SQLite Migration 031 (templates.attachments column)...');

  const db = new Database(':memory:');
  initCacheSchema(db);

  const tableInfo = db.prepare("PRAGMA table_info('templates')").all() as any[];
  const hasAttachmentsCol = tableInfo.some((col: any) => col.name === 'attachments');
  assert.strictEqual(hasAttachmentsCol, true, 'templates table must have attachments column');

  // Insert template with attachments
  const templateId = 'tpl_test_123';
  const wsId = 'ws_alpha';
  const attachments = [
    {
      id: 'att_1',
      filename: 'whitepaper.pdf',
      size: 102400,
      storagePath: '/userData/attachments/ws_alpha/att_1_whitepaper.pdf',
      contentType: 'application/pdf'
    }
  ];

  db.prepare(`
    INSERT INTO templates (id, workspaceId, name, subject, body, variables, attachments, createdAt, updatedAt)
    VALUES (?, ?, 'Demo Template', 'Hello', 'Body text', '[]', ?, datetime('now'), datetime('now'))
  `).run(templateId, wsId, JSON.stringify(attachments));

  const row = db.prepare('SELECT subject, body, attachments FROM templates WHERE id = ?').get(templateId) as any;
  assert.strictEqual(row.subject, 'Hello');
  assert.ok(row.attachments, 'attachments column must return value');
  const parsedAtts = JSON.parse(row.attachments);
  assert.strictEqual(parsedAtts.length, 1);
  assert.strictEqual(parsedAtts[0].filename, 'whitepaper.pdf');
  assert.strictEqual(parsedAtts[0].storagePath, '/userData/attachments/ws_alpha/att_1_whitepaper.pdf');

  console.log('✅ Migration 031 verified: templates table successfully stores and retrieves attachment JSON.');

  console.log('\n============================================================');
  console.log('--- ALL POST-RELEASE STABILIZATION TESTS PASSED (2/2) ---');
  console.log('============================================================\n');
}

if (process.argv[1]?.includes('post-release-stabilization.test')) {
  runPostReleaseStabilizationTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
