import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Mock electron before importing database modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
    getVersion: vi.fn(() => '1.2.1-beta.1'),
    isPackaged: false,
    setAppUserModelId: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}));

import { getDatabase, closeDatabase } from '../../main/database/connection';
import { initCacheSchema } from '../../main/database/cache-schema';
import { resolveMatchingContactIds } from '../../main/ipc/query-resolver';
import { matchesCanonicalQuery } from './contact-selection';

describe('HUNTARA — Discovery Run Contact Filtering & Bulk Selection Suite', () => {
  let tempDbDir: string;
  const workspaceA = 'ws_discovery_filter_A';
  const workspaceB = 'ws_discovery_filter_B';

  const runAlpha = 'run_alpha_101';
  const runBeta = 'run_beta_202';
  const runGamma = 'run_gamma_303';

  beforeEach(() => {
    tempDbDir = path.join(os.tmpdir(), `huntara-disc-filt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDbDir, { recursive: true });
    process.env.WORKSPACES_DB_DIR = tempDbDir;

    // Seed Workspace A database
    const dbA = getDatabase(workspaceA);
    initCacheSchema(dbA);

    // 1. Companies in Workspace A
    const insertComp = dbA.prepare(`
      INSERT INTO companies (id, workspaceId, name, domain, city, state, country, deletedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    insertComp.run('comp_a1', workspaceA, 'Alpha Prime', 'alpha.com', 'San Francisco', 'CA', 'USA', null);
    insertComp.run('comp_a2', workspaceA, 'Alpha Second', 'alphasec.com', 'Austin', 'TX', 'USA', null);
    insertComp.run('comp_shared', workspaceA, 'Cross Run Tech', 'crossrun.com', 'New York', 'NY', 'USA', null);
    insertComp.run('comp_b1', workspaceA, 'Beta Solutions', 'beta.com', 'Chicago', 'IL', 'USA', null);
    insertComp.run('comp_del', workspaceA, 'Deleted Corp', 'deleted.com', 'Seattle', 'WA', 'USA', '2026-01-01');

    // 2. Company Discovery Runs in Workspace A
    const insertCdr = dbA.prepare(`
      INSERT INTO company_discovery_runs (id, workspaceId, discoveryRunId, companyId, createdAt)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    // Run Alpha has comp_a1, comp_a2, comp_shared
    insertCdr.run('cdr_1', workspaceA, runAlpha, 'comp_a1');
    insertCdr.run('cdr_2', workspaceA, runAlpha, 'comp_a2');
    insertCdr.run('cdr_3', workspaceA, runAlpha, 'comp_shared');

    // Run Beta has comp_b1 and comp_shared (shared across both runs)
    insertCdr.run('cdr_4', workspaceA, runBeta, 'comp_b1');
    insertCdr.run('cdr_5', workspaceA, runBeta, 'comp_shared');

    // Run Gamma has comp_del (soft-deleted company)
    insertCdr.run('cdr_6', workspaceA, runGamma, 'comp_del');

    // 3. Contacts in Workspace A
    const insertCont = dbA.prepare(`
      INSERT INTO contacts (id, workspaceId, companyId, firstName, lastName, email, title, status, deletedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    // Contacts belonging to Run Alpha
    insertCont.run('cont_a1', workspaceA, 'comp_a1', 'Alice', 'Alpha', 'alice@alpha.com', 'CEO', 'NEW', null);
    insertCont.run('cont_a2', workspaceA, 'comp_a2', 'Aaron', 'Austin', 'aaron@alphasec.com', 'CTO', 'CONTACTED', null);

    // Contact belonging to shared company (appears in Alpha and Beta)
    insertCont.run('cont_shared', workspaceA, 'comp_shared', 'Sam', 'Shared', 'sam@crossrun.com', 'VP', 'NEW', null);

    // Contact belonging to Run Beta only
    insertCont.run('cont_b1', workspaceA, 'comp_b1', 'Bob', 'Beta', 'bob@beta.com', 'Director', 'NEW', null);

    // Contact belonging to soft-deleted company
    insertCont.run('cont_del', workspaceA, 'comp_del', 'Dan', 'Deleted', 'dan@deleted.com', 'Manager', 'NEW', null);

    // Contact with NO company (orphan contact)
    insertCont.run('cont_orphan', workspaceA, null, 'Oliver', 'Orphan', 'oliver@nocompany.com', 'Freelancer', 'NEW', null);

    // 4. Seed Workspace B database to verify strict workspace isolation
    const dbB = getDatabase(workspaceB);
    initCacheSchema(dbB);
    const insertCompB = dbB.prepare(`
      INSERT INTO companies (id, workspaceId, name, domain, deletedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    insertCompB.run('comp_other_ws', workspaceB, 'Other WS Corp', 'other.com', null);

    const insertCdrB = dbB.prepare(`
      INSERT INTO company_discovery_runs (id, workspaceId, discoveryRunId, companyId, createdAt)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    insertCdrB.run('cdr_other', workspaceB, runAlpha, 'comp_other_ws');

    const insertContB = dbB.prepare(`
      INSERT INTO contacts (id, workspaceId, companyId, firstName, lastName, email, deletedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    insertContB.run('cont_other_ws', workspaceB, 'comp_other_ws', 'Zack', 'Other', 'zack@other.com', null);
  });

  afterEach(() => {
    closeDatabase(workspaceA);
    closeDatabase(workspaceB);
    delete process.env.WORKSPACES_DB_DIR;
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Specification Requirement: CASE 1 — No Discovery Run filter
  // ---------------------------------------------------------------------------
  it('CASE 1: no discovery run filter resolves all non-deleted workspace contacts', () => {
    const db = getDatabase(workspaceA);
    const resolved = resolveMatchingContactIds(db, workspaceA, {});

    expect(resolved).toContain('cont_a1');
    expect(resolved).toContain('cont_a2');
    expect(resolved).toContain('cont_shared');
    expect(resolved).toContain('cont_b1');
    expect(resolved).toContain('cont_del');
    expect(resolved).toContain('cont_orphan');
    expect(resolved).not.toContain('cont_other_ws');
  });

  // ---------------------------------------------------------------------------
  // Specification Requirement: CASE 2 — Discovery Run Alpha filter
  // ---------------------------------------------------------------------------
  it('CASE 2: Discovery Run Alpha filter resolves only contacts whose company belongs to Alpha', () => {
    const db = getDatabase(workspaceA);
    const resolved = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runAlpha });

    expect(resolved).toHaveLength(3);
    expect(resolved).toEqual(expect.arrayContaining(['cont_a1', 'cont_a2', 'cont_shared']));
    expect(resolved).not.toContain('cont_b1');
    expect(resolved).not.toContain('cont_orphan');
    expect(resolved).not.toContain('cont_other_ws');
  });

  // ---------------------------------------------------------------------------
  // Specification Requirement: CASE 3 — Discovery Run Beta filter
  // ---------------------------------------------------------------------------
  it('CASE 3: Discovery Run Beta filter resolves only contacts whose company belongs to Beta', () => {
    const db = getDatabase(workspaceA);
    const resolved = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runBeta });

    expect(resolved).toHaveLength(2);
    expect(resolved).toEqual(expect.arrayContaining(['cont_b1', 'cont_shared']));
    expect(resolved).not.toContain('cont_a1');
    expect(resolved).not.toContain('cont_a2');
    expect(resolved).not.toContain('cont_orphan');
  });

  // ---------------------------------------------------------------------------
  // Specification Requirement: CASE 4 — Switch Alpha -> Beta leaves zero stale Alpha contacts
  // ---------------------------------------------------------------------------
  it('CASE 4: switching from Run Alpha to Run Beta resolves cleanly without stale Alpha contacts', () => {
    const db = getDatabase(workspaceA);

    const alphaResult = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runAlpha });
    expect(alphaResult).toContain('cont_a1');
    expect(alphaResult).toContain('cont_a2');

    const betaResult = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runBeta });
    expect(betaResult).not.toContain('cont_a1');
    expect(betaResult).not.toContain('cont_a2');
    expect(betaResult).toContain('cont_b1');
  });

  // ---------------------------------------------------------------------------
  // Specification Requirement: CASE 5 — Clear filter restores full contact set
  // ---------------------------------------------------------------------------
  it('CASE 5: clearing discovery run filter restores full workspace contact set', () => {
    const db = getDatabase(workspaceA);

    const filtered = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runAlpha });
    expect(filtered).toHaveLength(3);

    const cleared = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: undefined });
    expect(cleared.length).toBeGreaterThan(filtered.length);
    expect(cleared).toContain('cont_b1');
    expect(cleared).toContain('cont_orphan');
  });

  // ---------------------------------------------------------------------------
  // Specification Requirement: CASE 6 — Unknown / invalid discovery run
  // ---------------------------------------------------------------------------
  it('CASE 6: unknown or nonexistent discovery run ID returns zero contacts', () => {
    const db = getDatabase(workspaceA);
    const resolved = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: 'nonexistent_run_999' });

    expect(resolved).toEqual([]);
    expect(resolved).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Specification Requirement: CASE 7 — Company belongs to multiple discovery runs
  // ---------------------------------------------------------------------------
  it('CASE 7: contact belonging to a company in multiple runs is included for both runs', () => {
    const db = getDatabase(workspaceA);

    const alphaContacts = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runAlpha });
    const betaContacts = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runBeta });

    expect(alphaContacts).toContain('cont_shared');
    expect(betaContacts).toContain('cont_shared');
  });

  // ---------------------------------------------------------------------------
  // Specification Requirement: CASE 8 — Contact has no company (orphan)
  // ---------------------------------------------------------------------------
  it('CASE 8: contact with null companyId is never assigned to any discovery run', () => {
    const db = getDatabase(workspaceA);

    const alphaContacts = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runAlpha });
    const betaContacts = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runBeta });
    const gammaContacts = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runGamma });

    expect(alphaContacts).not.toContain('cont_orphan');
    expect(betaContacts).not.toContain('cont_orphan');
    expect(gammaContacts).not.toContain('cont_orphan');
  });

  // ---------------------------------------------------------------------------
  // Safety: Soft-deleted company contacts are excluded from run
  // ---------------------------------------------------------------------------
  it('excludes contacts belonging to soft-deleted companies', () => {
    const db = getDatabase(workspaceA);
    const gammaContacts = resolveMatchingContactIds(db, workspaceA, { discoveryRunId: runGamma });

    // comp_del was soft-deleted, so cont_del must not be resolved
    expect(gammaContacts).not.toContain('cont_del');
  });

  // ---------------------------------------------------------------------------
  // Safety: Strict tenant isolation across workspaces
  // ---------------------------------------------------------------------------
  it('strictly enforces workspace boundaries and never exposes another workspace data', () => {
    const dbA = getDatabase(workspaceA);
    const alphaContacts = resolveMatchingContactIds(dbA, workspaceA, { discoveryRunId: runAlpha });

    expect(alphaContacts).not.toContain('cont_other_ws');

    const dbB = getDatabase(workspaceB);
    const bContacts = resolveMatchingContactIds(dbB, workspaceB, { discoveryRunId: runAlpha });
    expect(bContacts).toEqual(['cont_other_ws']);
  });

  // ---------------------------------------------------------------------------
  // Combined Filtering: Discovery Run + Search
  // ---------------------------------------------------------------------------
  it('combines discovery run filter with search term correctly', () => {
    const db = getDatabase(workspaceA);

    // Run Alpha contains Alice and Aaron and Sam. Search "Aaron" should return ONLY Aaron.
    const resolved = resolveMatchingContactIds(db, workspaceA, {
      discoveryRunId: runAlpha,
      search: 'Aaron'
    });

    expect(resolved).toEqual(['cont_a2']);
  });

  // ---------------------------------------------------------------------------
  // Excluded IDs support during bulk selection
  // ---------------------------------------------------------------------------
  it('excludes specified excludedIds from resolved discovery run contacts', () => {
    const db = getDatabase(workspaceA);

    const resolved = resolveMatchingContactIds(
      db,
      workspaceA,
      { discoveryRunId: runAlpha },
      ['cont_a2']
    );

    expect(resolved).toHaveLength(2);
    expect(resolved).toEqual(expect.arrayContaining(['cont_a1', 'cont_shared']));
    expect(resolved).not.toContain('cont_a2');
  });

  // ---------------------------------------------------------------------------
  // In-memory matchesCanonicalQuery unit tests
  // ---------------------------------------------------------------------------
  it('matchesCanonicalQuery correctly evaluates discoveryRunCompanyIds set', () => {
    const runAlphaCompanyIds = new Set(['comp_a1', 'comp_a2', 'comp_shared']);

    const contactAlpha = { id: 'c1', companyId: 'comp_a1', status: 'NEW' };
    const contactBeta = { id: 'c2', companyId: 'comp_b1', status: 'NEW' };
    const contactOrphan = { id: 'c3', companyId: null, status: 'NEW' };

    const query = { discoveryRunId: runAlpha };

    expect(matchesCanonicalQuery(contactAlpha, query, runAlphaCompanyIds)).toBe(true);
    expect(matchesCanonicalQuery(contactBeta, query, runAlphaCompanyIds)).toBe(false);
    expect(matchesCanonicalQuery(contactOrphan, query, runAlphaCompanyIds)).toBe(false);
  });
});
