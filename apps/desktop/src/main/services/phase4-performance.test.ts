import assert from 'assert';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { getDatabase, closeDatabase } from '../database/connection';

/**
 * Phase 4 Performance Regression & Large-Dataset Benchmark Test Suite
 *
 * Validates:
 * 1. EXPLAIN QUERY PLAN assertions (index utilization, no unexpected table scans).
 * 2. Correctness invariants (workspace isolation, soft-delete filtering, run filtering).
 * 3. Aggregation query consolidation (campaign sequence execution stats).
 * 4. Synthetic dataset scaling benchmarks (100, 1,000, 5,000, 10,000 records).
 */
export async function runPhase4PerformanceTests() {
  console.log('============================================================');
  console.log('--- PHASE 4 PERFORMANCE REGRESSION & BENCHMARK SUITE ---');
  console.log('============================================================\n');

  const tempDir = mkdtempSync(join(tmpdir(), 'huntara-perf-phase4-'));
  const originalEnv = process.env.WORKSPACES_DB_DIR;
  process.env.WORKSPACES_DB_DIR = tempDir;

  try {
    const wsId = 'ws-perf-' + Math.random().toString(36).substring(2, 9);
    const otherWsId = 'ws-perf-other-' + Math.random().toString(36).substring(2, 9);

    const db = getDatabase(wsId);
    assert.ok(db, 'getDatabase(wsId) must return active Database instance');

    // -------------------------------------------------------------
    // PART 1: EXPLAIN QUERY PLAN Index Assertions
    // -------------------------------------------------------------
    console.log('[Test 1] Testing EXPLAIN QUERY PLAN index utilization...');

    // 1.1 Company Discovery Runs delete/lookup index (workspaceId, companyId)
    const planCdrComp = db
      .prepare('EXPLAIN QUERY PLAN DELETE FROM company_discovery_runs WHERE workspaceId = ? AND companyId = ?')
      .all(wsId, 'comp-1') as Array<{ detail: string }>;
    const usesCdrCompIndex = planCdrComp.some((p) => p.detail.includes('idx_cache_comp_disc_comp'));
    assert.ok(
      usesCdrCompIndex,
      `company_discovery_runs lookup by (workspaceId, companyId) must use idx_cache_comp_disc_comp. Got: ${JSON.stringify(planCdrComp)}`
    );
    console.log('  ✅ 1.1 company_discovery_runs (workspaceId, companyId) uses idx_cache_comp_disc_comp');

    // 1.2 Company Discovery Runs covering index (workspaceId, discoveryRunId, companyId)
    const planCdrRunComp = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT DISTINCT c.* FROM companies c
         INNER JOIN company_discovery_runs cdr ON c.id = cdr.companyId
         WHERE cdr.workspaceId = ? AND cdr.discoveryRunId = ? AND c.deletedAt IS NULL
         ORDER BY c.createdAt DESC`
      )
      .all(wsId, 'run-1') as Array<{ detail: string }>;
    const usesCdrRunCompIndex = planCdrRunComp.some((p) => p.detail.includes('idx_cache_comp_disc_run_comp'));
    assert.ok(
      usesCdrRunCompIndex,
      `Company discovery run join must use idx_cache_comp_disc_run_comp. Got: ${JSON.stringify(planCdrRunComp)}`
    );
    console.log('  ✅ 1.2 company discovery run join uses covering index idx_cache_comp_disc_run_comp');

    // 1.3 Contacts discovery run join covering index
    const planContactRun = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT DISTINCT c.* FROM contacts c
         INNER JOIN company_discovery_runs cdr ON c.companyId = cdr.companyId
         INNER JOIN companies comp ON c.companyId = comp.id AND comp.deletedAt IS NULL
         WHERE c.workspaceId = ? AND c.deletedAt IS NULL AND cdr.workspaceId = ? AND cdr.discoveryRunId = ?
         ORDER BY c.createdAt DESC`
      )
      .all(wsId, wsId, 'run-1') as Array<{ detail: string }>;
    const contactsUsesCdrIndex = planContactRun.some((p) => p.detail.includes('idx_cache_comp_disc_run_comp'));
    assert.ok(
      contactsUsesCdrIndex,
      `Contacts discovery run join must use idx_cache_comp_disc_run_comp. Got: ${JSON.stringify(planContactRun)}`
    );
    console.log('  ✅ 1.3 contacts discovery run join uses idx_cache_comp_disc_run_comp');

    // 1.4 Sequence Executions by (workspaceId, campaignId)
    const planSeqExec = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM sequence_executions
         WHERE workspaceId = ? AND campaignId = ? AND deletedAt IS NULL`
      )
      .all(wsId, 'camp-1') as Array<{ detail: string }>;
    const usesSeqExecCampIndex = planSeqExec.some((p) => p.detail.includes('idx_cache_seq_exec_camp'));
    assert.ok(
      usesSeqExecCampIndex,
      `Sequence executions lookup must use idx_cache_seq_exec_camp. Got: ${JSON.stringify(planSeqExec)}`
    );
    console.log('  ✅ 1.4 sequence executions by campaign uses idx_cache_seq_exec_camp');

    // 1.5 Sequence Executions GROUP BY campaignId with workspaceId
    const planSeqExecGroup = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT campaignId, COUNT(id) FROM sequence_executions
         WHERE workspaceId = ? AND deletedAt IS NULL
         GROUP BY campaignId`
      )
      .all(wsId) as Array<{ detail: string }>;
    const seqExecGroupIndexed = planSeqExecGroup.some(
      (p) => p.detail.includes('idx_cache_seq_exec_ws') || p.detail.includes('idx_cache_seq_exec_camp')
    );
    assert.ok(
      seqExecGroupIndexed,
      `Sequence executions group by stats query must use workspace index. Got: ${JSON.stringify(planSeqExecGroup)}`
    );
    console.log('  ✅ 1.5 consolidated campaign stats query uses workspace index\n');

    // -------------------------------------------------------------
    // PART 2: Semantic Invariant Verification
    // -------------------------------------------------------------
    console.log('[Test 2] Testing correctness semantics under optimization...');

    const insertCompany = db.prepare(`
      INSERT INTO companies (id, workspaceId, name, domain, industry, location, city, state, country, createdAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertContact = db.prepare(`
      INSERT INTO contacts (id, workspaceId, companyId, firstName, lastName, email, title, source, createdAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertCdr = db.prepare(`
      INSERT INTO company_discovery_runs (id, workspaceId, companyId, discoveryRunId, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertCampaign = db.prepare(`
      INSERT INTO campaigns (id, workspaceId, name, status, createdAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertSeqExec = db.prepare(`
      INSERT INTO sequence_executions (id, workspaceId, campaignId, contactId, companyId, status, createdAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    // Insert sample records for wsId
    db.transaction(() => {
      insertCompany.run('c1', wsId, 'Active Corp', 'active.com', 'Tech', 'NYC', 'NYC', 'NY', 'USA', now, null);
      insertCompany.run('c2', wsId, 'Soft Deleted Corp', 'deleted.com', 'Tech', 'NYC', 'NYC', 'NY', 'USA', now, now);
      insertCompany.run('c3', wsId, 'Other Run Corp', 'other.com', 'Tech', 'NYC', 'NYC', 'NY', 'USA', now, null);

      // Insert for other workspace to test isolation
      insertCompany.run('c4', otherWsId, 'Foreign Corp', 'foreign.com', 'Tech', 'NYC', 'NYC', 'NY', 'USA', now, null);

      insertContact.run('ct1', wsId, 'c1', 'John', 'Doe', 'john@active.com', 'CEO', 'web', now, null);
      insertContact.run('ct2', wsId, 'c2', 'Jane', 'Doe', 'jane@deleted.com', 'CTO', 'web', now, null); // company is soft-deleted
      insertContact.run('ct3', wsId, 'c1', 'Bob', 'Smith', 'bob@active.com', 'VP', 'web', now, now); // contact is soft-deleted
      insertContact.run('ct4', otherWsId, 'c4', 'Alice', 'Wonder', 'alice@foreign.com', 'CEO', 'web', now, null); // other ws

      insertCdr.run('cdr1', wsId, 'c1', 'run-100', now);
      insertCdr.run('cdr2', wsId, 'c2', 'run-100', now);
      insertCdr.run('cdr3', wsId, 'c3', 'run-200', now);

      insertCampaign.run('camp1', wsId, 'Q1 Outbound', 'ACTIVE', now, null);
      insertCampaign.run('camp2', wsId, 'Q2 Nurture', 'DRAFT', now, null);

      insertSeqExec.run('se1', wsId, 'camp1', 'ct1', 'c1', 'RUNNING', now, null);
      insertSeqExec.run('se2', wsId, 'camp1', 'ct1', 'c1', 'WAITING', now, null);
      insertSeqExec.run('se3', wsId, 'camp1', 'ct1', 'c1', 'REPLIED', now, null);
      insertSeqExec.run('se4', wsId, 'camp1', 'ct1', 'c1', 'COMPLETED', now, null);
      insertSeqExec.run('se5', wsId, 'camp1', 'ct1', 'c1', 'FAILED', now, now); // soft-deleted execution
      insertSeqExec.run('se6', wsId, 'camp2', 'ct1', 'c1', 'PAUSED', now, null);
    })();

    // 2.1 Workspace Isolation
    const ws1Companies = db.prepare('SELECT id FROM companies WHERE workspaceId = ? AND deletedAt IS NULL').all(wsId) as any[];
    assert.strictEqual(ws1Companies.length, 2, 'wsId should see exactly 2 active companies (c1, c3)');
    assert.ok(!ws1Companies.some((c) => c.id === 'c4'), 'wsId must not see companies from otherWsId');

    // 2.2 Discovery Run Filtering
    const run100Companies = db
      .prepare(
        `SELECT DISTINCT c.id FROM companies c
         INNER JOIN company_discovery_runs cdr ON c.id = cdr.companyId
         WHERE cdr.workspaceId = ? AND cdr.discoveryRunId = ? AND c.deletedAt IS NULL`
      )
      .all(wsId, 'run-100') as any[];
    assert.strictEqual(run100Companies.length, 1, 'run-100 should return only 1 active company (c1; c2 is soft-deleted)');
    assert.strictEqual(run100Companies[0].id, 'c1');

    // 2.3 Contacts Discovery Run Join with Soft Deletes
    const run100Contacts = db
      .prepare(
        `SELECT DISTINCT c.id FROM contacts c
         INNER JOIN company_discovery_runs cdr ON c.companyId = cdr.companyId
         INNER JOIN companies comp ON c.companyId = comp.id AND comp.deletedAt IS NULL
         WHERE c.workspaceId = ? AND c.deletedAt IS NULL AND cdr.workspaceId = ? AND cdr.discoveryRunId = ?`
      )
      .all(wsId, wsId, 'run-100') as any[];
    assert.strictEqual(run100Contacts.length, 1, 'run-100 contacts should return ct1 (ct2 company is deleted, ct3 is deleted)');
    assert.strictEqual(run100Contacts[0].id, 'ct1');

    // 2.4 Consolidated Campaign Execution Stats
    const statsRows = db
      .prepare(
        `SELECT
           campaignId,
           COUNT(id) as total,
           SUM(CASE WHEN UPPER(status) IN ('RUNNING', 'QUEUED', 'STARTING') THEN 1 ELSE 0 END) as running,
           SUM(CASE WHEN UPPER(status) = 'WAITING' THEN 1 ELSE 0 END) as waiting,
           SUM(CASE WHEN UPPER(status) = 'REPLIED' THEN 1 ELSE 0 END) as replied,
           SUM(CASE WHEN UPPER(status) = 'FAILED' THEN 1 ELSE 0 END) as failed,
           SUM(CASE WHEN UPPER(status) = 'PAUSED' THEN 1 ELSE 0 END) as paused,
           SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN 1 ELSE 0 END) as completed
         FROM sequence_executions
         WHERE workspaceId = ? AND deletedAt IS NULL
         GROUP BY campaignId`
      )
      .all(wsId) as Array<{
      campaignId: string;
      total: number;
      running: number;
      waiting: number;
      replied: number;
      failed: number;
      paused: number;
      completed: number;
    }>;

    const camp1Stats = statsRows.find((s) => s.campaignId === 'camp1');
    assert.ok(camp1Stats, 'camp1 stats must be present');
    assert.strictEqual(camp1Stats.total, 4, 'camp1 active executions must be 4 (se5 is soft deleted)');
    assert.strictEqual(camp1Stats.running, 1);
    assert.strictEqual(camp1Stats.waiting, 1);
    assert.strictEqual(camp1Stats.replied, 1);
    assert.strictEqual(camp1Stats.completed, 1);
    assert.strictEqual(camp1Stats.failed, 0);

    const camp2Stats = statsRows.find((s) => s.campaignId === 'camp2');
    assert.ok(camp2Stats, 'camp2 stats must be present');
    assert.strictEqual(camp2Stats.total, 1);
    assert.strictEqual(camp2Stats.paused, 1);

    console.log('  ✅ 2.1 Workspace isolation verified');
    console.log('  ✅ 2.2 Discovery run filtering verified');
    console.log('  ✅ 2.3 Contacts discovery run join + soft-delete filtering verified');
    console.log('  ✅ 2.4 Consolidated campaign stats verified\n');

    // -------------------------------------------------------------
    // PART 3: High-Volume Deterministic Benchmarks (100, 1k, 5k, 10k)
    // -------------------------------------------------------------
    console.log('[Test 3] Running deterministic scaling benchmarks...');

    const scaleTiers = [100, 1000, 5000, 10000];

    const bulkInsertCompanies = db.prepare(`
      INSERT INTO companies (id, workspaceId, name, domain, industry, location, city, state, country, createdAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const bulkInsertContacts = db.prepare(`
      INSERT INTO contacts (id, workspaceId, companyId, firstName, lastName, email, title, source, createdAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const bulkInsertCdr = db.prepare(`
      INSERT INTO company_discovery_runs (id, workspaceId, companyId, discoveryRunId, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);

    let currentCount = 0;
    const benchWsId = 'ws-bench-' + Math.random().toString(36).substring(2, 9);
    const benchRunId = 'bench-run-alpha';

    for (const targetTier of scaleTiers) {
      const recordsToAdd = targetTier - currentCount;

      db.transaction(() => {
        for (let i = currentCount; i < targetTier; i++) {
          const compId = `bcomp_${i}`;
          const contId = `bcont_${i}`;
          const isDeleted = i % 50 === 0 ? now : null; // 2% soft-deleted
          const createdTime = new Date(Date.now() - i * 1000).toISOString();

          bulkInsertCompanies.run(
            compId,
            benchWsId,
            `Company ${i}`,
            `domain${i}.com`,
            i % 2 === 0 ? 'Technology' : 'Finance',
            'New York, NY',
            'New York',
            'NY',
            'US',
            createdTime,
            isDeleted
          );

          bulkInsertContacts.run(
            contId,
            benchWsId,
            compId,
            `First${i}`,
            `Last${i}`,
            `user${i}@domain${i}.com`,
            'Engineering Director',
            'google_maps',
            createdTime,
            isDeleted
          );

          if (i % 2 === 0) {
            bulkInsertCdr.run(`bcdr_${i}`, benchWsId, compId, benchRunId, createdTime);
          }
        }
      })();

      currentCount = targetTier;

      // Benchmark A: Companies query with ORDER BY createdAt DESC LIMIT 50
      const startComp = process.hrtime.bigint();
      const compRows = db
        .prepare('SELECT DISTINCT c.* FROM companies c WHERE c.workspaceId = ? AND c.deletedAt IS NULL ORDER BY c.createdAt DESC LIMIT 50')
        .all(benchWsId);
      const elapsedCompMs = Number(process.hrtime.bigint() - startComp) / 1e6;
      assert.ok(compRows.length >= 48 && compRows.length <= 50);

      // Benchmark B: Contacts query with ORDER BY createdAt DESC LIMIT 50
      const startCont = process.hrtime.bigint();
      const contRows = db
        .prepare('SELECT DISTINCT c.* FROM contacts c WHERE c.workspaceId = ? AND c.deletedAt IS NULL ORDER BY c.createdAt DESC LIMIT 50')
        .all(benchWsId);
      const elapsedContMs = Number(process.hrtime.bigint() - startCont) / 1e6;
      assert.ok(contRows.length >= 48 && contRows.length <= 50);

      // Benchmark C: Discovery Run Companies Join LIMIT 50
      const startRun = process.hrtime.bigint();
      const runCompRows = db
        .prepare(
          `SELECT DISTINCT c.* FROM companies c
           INNER JOIN company_discovery_runs cdr ON c.id = cdr.companyId
           WHERE cdr.workspaceId = ? AND cdr.discoveryRunId = ? AND c.deletedAt IS NULL
           ORDER BY c.createdAt DESC LIMIT 50`
        )
        .all(benchWsId, benchRunId);
      const elapsedRunMs = Number(process.hrtime.bigint() - startRun) / 1e6;
      assert.ok(runCompRows.length >= 48 && runCompRows.length <= 50);

      // Benchmark D: Contacts Discovery Run Join
      const startContRun = process.hrtime.bigint();
      const runContRows = db
        .prepare(
          `SELECT DISTINCT c.* FROM contacts c
           INNER JOIN company_discovery_runs cdr ON c.companyId = cdr.companyId
           INNER JOIN companies comp ON c.companyId = comp.id AND comp.deletedAt IS NULL
           WHERE c.workspaceId = ? AND c.deletedAt IS NULL AND cdr.workspaceId = ? AND cdr.discoveryRunId = ?
           ORDER BY c.createdAt DESC LIMIT 50`
        )
        .all(benchWsId, benchWsId, benchRunId);
      const elapsedContRunMs = Number(process.hrtime.bigint() - startContRun) / 1e6;
      assert.ok(runContRows.length >= 48 && runContRows.length <= 50);

      console.log(
        `  📊 [Tier ${targetTier.toLocaleString()} rows] ` +
          `Companies: ${elapsedCompMs.toFixed(3)}ms | ` +
          `Contacts: ${elapsedContMs.toFixed(3)}ms | ` +
          `Run Companies: ${elapsedRunMs.toFixed(3)}ms | ` +
          `Run Contacts: ${elapsedContRunMs.toFixed(3)}ms`
      );

      // Invariant: Even at 10,000 rows, indexed query must finish in under 50ms locally
      assert.ok(
        elapsedCompMs < 50,
        `Companies query at tier ${targetTier} must be < 50ms, took ${elapsedCompMs.toFixed(2)}ms`
      );
      assert.ok(
        elapsedRunMs < 50,
        `Run companies query at tier ${targetTier} must be < 50ms, took ${elapsedRunMs.toFixed(2)}ms`
      );
    }

    closeDatabase(wsId);
    closeDatabase(otherWsId);

    console.log('\n============================================================');
    console.log('✅ ALL PHASE 4 PERFORMANCE & BENCHMARK TESTS PASSED');
    console.log('============================================================\n');
  } finally {
    process.env.WORKSPACES_DB_DIR = originalEnv;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

if (require.main === module) {
  runPhase4PerformanceTests().catch((err) => {
    console.error('❌ Phase 4 performance test failed:', err);
    process.exit(1);
  });
}
