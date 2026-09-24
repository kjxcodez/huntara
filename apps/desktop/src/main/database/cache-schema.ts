import Database from 'better-sqlite3';

/**
 * LeadForge OS — Clean Disposable SQLite Cache Schema Initializer (Phase 6)
 * 
 * Defines the minimal, read-optimized local SQLite schema.
 * SQLite is strictly a disposable read projection of authoritative MongoDB state.
 * 
 * Absolute Invariants:
 *  1. Zero sync infrastructure tables (no sync_queue, sync_metadata, sync_dead_letter).
 *  2. Zero sync status columns (no syncStatus, version, pending flags).
 *  3. All IDs are exact canonical strings matching MongoDB document _id.
 *  4. Database can be dropped (rm leadforge_<wsId>.db) and fully recreated without data loss.
 */

export const CACHE_SCHEMA_VERSION = 4;

export const CACHE_TABLES = [
  'workspaces',
  'companies',
  'contacts',
  'campaigns',
  'sequences',
  'sequence_executions',
  'templates',
  'email_accounts',
  'email_deliveries',
  'operations_cache',
  'suppressions',
  'email_quality',
  'audiences',
  'discovery_runs',
  'company_discovery_runs',
  'company_intelligence',
  'website_intelligence',
  'contact_intelligence',
  'opportunity_scores',
  'cache_metadata'
] as const;

export type CacheTable = (typeof CACHE_TABLES)[number];

/**
 * Initializes the clean SQLite cache schema directly without running the 33-step legacy migration runner.
 */
export function initCacheSchema(db: Database.Database): void {
  // Configure high-performance WAL and pragmas for read concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  db.transaction(() => {
    // 1. Cache Metadata Table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS cache_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    try {
      const metaCols = (db.pragma('table_info(cache_metadata)') as Array<{ name: string }>).map((c) => c.name);
      if (!metaCols.includes('updatedAt')) {
        db.prepare(`ALTER TABLE cache_metadata ADD COLUMN updatedAt DATETIME`).run();
      }
    } catch (err) {
      console.warn('[CacheSchema] Failed to add updatedAt to cache_metadata:', err);
    }

    // 2. Workspaces Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT,
        ownerId TEXT,
        plan TEXT DEFAULT 'free',
        settings TEXT,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();

    // Ensure plan column exists if table existed from an earlier version
    try {
      const wsCols = (db.pragma('table_info(workspaces)') as Array<{ name: string }>).map(
        (c) => c.name
      );
      if (!wsCols.includes('plan')) {
        db.prepare(`ALTER TABLE workspaces ADD COLUMN plan TEXT DEFAULT 'free'`).run();
      }
    } catch {}

    // 3. Companies Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        name TEXT NOT NULL,
        domain TEXT,
        industry TEXT,
        status TEXT,
        website TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        employeeCount INTEGER,
        size TEXT,
        revenue TEXT,
        city TEXT,
        state TEXT,
        country TEXT,
        location TEXT,
        linkedin TEXT,
        linkedinUrl TEXT,
        notes TEXT,
        opportunityScore REAL,
        tags TEXT DEFAULT '[]',
        customFields TEXT DEFAULT '{}',
        metrics TEXT DEFAULT '{}',
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_companies_ws ON companies(workspaceId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_companies_ws_del ON companies(workspaceId, deletedAt)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_companies_ws_del_created ON companies(workspaceId, deletedAt, createdAt DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_companies_domain ON companies(workspaceId, domain)`).run();

    // 4. Contacts Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        companyId TEXT,
        firstName TEXT,
        lastName TEXT,
        email TEXT,
        phone TEXT,
        title TEXT,
        linkedin TEXT,
        linkedinUrl TEXT,
        source TEXT,
        priority INTEGER DEFAULT 0,
        status TEXT,
        emailStatus TEXT DEFAULT 'unverified',
        emailMeta TEXT DEFAULT NULL,
        notes TEXT,
        tags TEXT DEFAULT '[]',
        lastContactedAt DATETIME,
        customFields TEXT DEFAULT '{}',
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    // Ensure emailStatus, emailMeta, emailQuality, and additionalEmails columns exist on existing databases
    try {
      const contactCols = (db.pragma(`table_info(contacts)`) as Array<{ name: string }>).map((c) => c.name);
      if (!contactCols.includes('emailStatus')) {
        db.prepare(`ALTER TABLE contacts ADD COLUMN emailStatus TEXT DEFAULT 'unverified'`).run();
      }
      if (!contactCols.includes('emailMeta')) {
        db.prepare(`ALTER TABLE contacts ADD COLUMN emailMeta TEXT DEFAULT NULL`).run();
      }
      if (!contactCols.includes('emailQuality')) {
        db.prepare(`ALTER TABLE contacts ADD COLUMN emailQuality TEXT DEFAULT NULL`).run();
      }
      if (!contactCols.includes('additionalEmails')) {
        db.prepare(`ALTER TABLE contacts ADD COLUMN additionalEmails TEXT DEFAULT '[]'`).run();
      }
    } catch {}

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_contacts_ws ON contacts(workspaceId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_contacts_ws_comp ON contacts(workspaceId, companyId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_contacts_ws_del ON contacts(workspaceId, deletedAt)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_contacts_ws_del_created ON contacts(workspaceId, deletedAt, createdAt DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_contacts_email ON contacts(workspaceId, email)`).run();

    // 5. Campaigns Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        sequenceId TEXT,
        sendingAccountId TEXT,
        name TEXT NOT NULL,
        description TEXT,
        dailyLimit INTEGER DEFAULT 50,
        timezone TEXT DEFAULT 'UTC',
        status TEXT DEFAULT 'DRAFT',
        trackingEnabled INTEGER DEFAULT 0,
        settings TEXT DEFAULT '{}',
        stats TEXT DEFAULT '{}',
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    try {
      const campCols = db.pragma('table_info(campaigns)') as Array<{ name: string }>;
      if (!campCols.some((c) => c.name === 'trackingEnabled')) {
        db.prepare('ALTER TABLE campaigns ADD COLUMN trackingEnabled INTEGER DEFAULT 0').run();
      }
    } catch (_) {}

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_campaigns_ws ON campaigns(workspaceId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_campaigns_ws_del ON campaigns(workspaceId, deletedAt)`).run();

    // 6. Sequences Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sequences (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        steps TEXT DEFAULT '[]',
        status TEXT DEFAULT 'DRAFT',
        trigger TEXT DEFAULT '{}',
        triggers TEXT DEFAULT '[]',
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_sequences_ws ON sequences(workspaceId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_sequences_ws_del ON sequences(workspaceId, deletedAt)`).run();

    // 7. Sequence Executions Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sequence_executions (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        sequenceId TEXT,
        campaignId TEXT,
        contactId TEXT,
        companyId TEXT,
        status TEXT DEFAULT 'PENDING',
        currentStep INTEGER DEFAULT 0,
        currentStepName TEXT,
        startedAt DATETIME,
        completedAt DATETIME,
        failedAt DATETIME,
        pausedAt DATETIME,
        nextExecutionAt DATETIME,
        logs TEXT DEFAULT '[]',
        metrics TEXT DEFAULT '{}',
        emailsSent INTEGER DEFAULT 0,
        replies INTEGER DEFAULT 0,
        failures INTEGER DEFAULT 0,
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_seq_exec_ws ON sequence_executions(workspaceId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_seq_exec_camp ON sequence_executions(workspaceId, campaignId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_seq_exec_cont ON sequence_executions(workspaceId, contactId)`).run();

    // 8. Templates Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        name TEXT NOT NULL,
        subject TEXT,
        body TEXT,
        variables TEXT DEFAULT '[]',
        attachments TEXT DEFAULT '[]',
        version INTEGER DEFAULT 1,
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    try {
      const tplCols = (db.pragma('table_info(templates)') as Array<{ name: string }>).map((c) => c.name);
      if (!tplCols.includes('version')) {
        db.prepare('ALTER TABLE templates ADD COLUMN version INTEGER DEFAULT 1').run();
      }
    } catch {}

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_templates_ws ON templates(workspaceId)`).run();

    // 9. Email Accounts Cache (Safe, non-secret fields only)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS email_accounts (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        name TEXT,
        provider TEXT,
        email TEXT NOT NULL,
        displayName TEXT,
        dailyLimit INTEGER DEFAULT 50,
        hourlyLimit INTEGER DEFAULT 50,
        dailySent INTEGER DEFAULT 0,
        hourlySent INTEGER DEFAULT 0,
        signature TEXT,
        lastVerifiedAt DATETIME,
        lastError TEXT,
        googleAccountId TEXT,
        status TEXT DEFAULT 'ACTIVE',
        smtpHost TEXT,
        smtpPort INTEGER,
        imapHost TEXT,
        imapPort INTEGER,
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    // Safe column migrations for email_accounts table
    try {
      const emailAccCols = (db.pragma('table_info(email_accounts)') as Array<{ name: string }>).map((c) => c.name);
      if (!emailAccCols.includes('signature')) {
        db.prepare('ALTER TABLE email_accounts ADD COLUMN signature TEXT').run();
      }
      if (!emailAccCols.includes('googleAccountId')) {
        db.prepare('ALTER TABLE email_accounts ADD COLUMN googleAccountId TEXT').run();
      }
      if (!emailAccCols.includes('hourlyLimit')) {
        db.prepare('ALTER TABLE email_accounts ADD COLUMN hourlyLimit INTEGER DEFAULT 50').run();
      }
      if (!emailAccCols.includes('dailySent')) {
        db.prepare('ALTER TABLE email_accounts ADD COLUMN dailySent INTEGER DEFAULT 0').run();
      }
      if (!emailAccCols.includes('hourlySent')) {
        db.prepare('ALTER TABLE email_accounts ADD COLUMN hourlySent INTEGER DEFAULT 0').run();
      }
      if (!emailAccCols.includes('lastVerifiedAt')) {
        db.prepare('ALTER TABLE email_accounts ADD COLUMN lastVerifiedAt DATETIME').run();
      }
      if (!emailAccCols.includes('lastError')) {
        db.prepare('ALTER TABLE email_accounts ADD COLUMN lastError TEXT').run();
      }
    } catch {
      // Ignored if table was just created or already migrated
    }

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_email_acc_ws ON email_accounts(workspaceId)`).run();

    // Email Deliveries Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS email_deliveries (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        campaignId TEXT,
        sequenceId TEXT,
        executionId TEXT,
        stepIndex INTEGER DEFAULT 0,
        contactId TEXT,
        companyId TEXT,
        accountId TEXT,
        senderEmail TEXT,
        recipientEmail TEXT,
        subject TEXT,
        messageId TEXT,
        inReplyTo TEXT,
        referencesList TEXT,
        providerMessageId TEXT,
        htmlBody TEXT,
        textBody TEXT,
        templateId TEXT,
        templateVersion INTEGER,
        variablesSnapshot TEXT,
        messageFingerprint TEXT,
        providerThreadId TEXT,
        safeHumanMessage TEXT,
        technicalMessage TEXT,
        error TEXT,
        retryable INTEGER DEFAULT 0,
        ambiguous INTEGER DEFAULT 0,
        direction TEXT DEFAULT 'OUTBOUND',
        openCount INTEGER DEFAULT 0,
        clickCount INTEGER DEFAULT 0,
        hasReply INTEGER DEFAULT 0,
        replyCount INTEGER DEFAULT 0,
        lastOpenedAt DATETIME,
        lastClickedAt DATETIME,
        lastRepliedAt DATETIME,
        status TEXT DEFAULT 'PENDING',
        processingStatus TEXT DEFAULT NULL,
        matchConfidence TEXT DEFAULT NULL,
        reconciliationAttempts INTEGER DEFAULT 0,
        reconciliationNotes TEXT DEFAULT NULL,
        reconciledAt DATETIME,
        attempt INTEGER DEFAULT 1,
        idempotencyKey TEXT UNIQUE,
        sentAt DATETIME,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();

    const extraDeliveryCols = [
      'processingStatus TEXT DEFAULT NULL',
      'matchConfidence TEXT DEFAULT NULL',
      'reconciliationAttempts INTEGER DEFAULT 0',
      'reconciliationNotes TEXT DEFAULT NULL',
      'reconciledAt DATETIME',
      'htmlBody TEXT',
      'textBody TEXT',
      'templateId TEXT',
      'templateVersion INTEGER',
      'variablesSnapshot TEXT',
      'messageFingerprint TEXT',
      'providerThreadId TEXT',
      'safeHumanMessage TEXT',
      'technicalMessage TEXT',
      'error TEXT',
      'retryable INTEGER DEFAULT 0',
      'ambiguous INTEGER DEFAULT 0',
      'direction TEXT DEFAULT "OUTBOUND"',
      'openCount INTEGER DEFAULT 0',
      'clickCount INTEGER DEFAULT 0',
      'hasReply INTEGER DEFAULT 0',
      'replyCount INTEGER DEFAULT 0',
      'lastOpenedAt DATETIME',
      'lastClickedAt DATETIME',
      'lastRepliedAt DATETIME',
      'messageId TEXT',
      'inReplyTo TEXT',
      'referencesList TEXT'
    ];
    for (const col of extraDeliveryCols) {
      try {
        db.prepare(`ALTER TABLE email_deliveries ADD COLUMN ${col}`).run();
      } catch {}
    }

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_email_del_ws ON email_deliveries(workspaceId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_email_del_idem ON email_deliveries(idempotencyKey)`).run();

    // 9b. Operations Cache (Phase 9)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS operations_cache (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        failureClass TEXT,
        errorCode TEXT,
        safeHumanMessage TEXT,
        technicalMessage TEXT,
        attempt INTEGER DEFAULT 1,
        maxAttempts INTEGER DEFAULT 3,
        nextRetryAt DATETIME,
        lastHeartbeatAt DATETIME,
        isStale INTEGER DEFAULT 0,
        retryable INTEGER DEFAULT 0,
        correlationId TEXT,
        campaignId TEXT,
        campaignName TEXT,
        contactId TEXT,
        contactEmail TEXT,
        deliveryId TEXT,
        sequenceExecutionId TEXT,
        provider TEXT,
        providerMessageId TEXT,
        metadata TEXT DEFAULT '{}',
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_ops_ws ON operations_cache(workspaceId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_ops_status ON operations_cache(status)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_ops_type ON operations_cache(type)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_ops_updated ON operations_cache(workspaceId, updatedAt)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_ops_stale ON operations_cache(workspaceId, isStale)`).run();

    // 10. Audiences Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS audiences (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        entityType TEXT DEFAULT 'contacts',
        type TEXT DEFAULT 'STATIC',
        mode TEXT DEFAULT 'dynamic',
        isDynamic INTEGER DEFAULT 0,
        filterRules TEXT DEFAULT '[]',
        filterDefinition TEXT DEFAULT '{}',
        memberCount INTEGER DEFAULT 0,
        staticMemberIds TEXT DEFAULT '[]',
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_audiences_ws ON audiences(workspaceId)`).run();

    // 11. Discovery Runs Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS discovery_runs (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        country TEXT,
        state TEXT,
        city TEXT,
        provider TEXT DEFAULT 'google_maps',
        status TEXT DEFAULT 'pending',
        resultCount INTEGER DEFAULT 0,
        startedAt DATETIME,
        completedAt DATETIME,
        failedAt DATETIME,
        error TEXT,
        createdAt DATETIME,
        updatedAt DATETIME,
        deletedAt DATETIME DEFAULT NULL
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_discovery_ws ON discovery_runs(workspaceId)`).run();

    // 12. Company Discovery Runs Junction Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS company_discovery_runs (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        discoveryRunId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        createdAt DATETIME
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_comp_disc_ws ON company_discovery_runs(workspaceId, discoveryRunId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_comp_disc_comp ON company_discovery_runs(workspaceId, companyId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_comp_disc_run_comp ON company_discovery_runs(workspaceId, discoveryRunId, companyId)`).run();

    // 13. Intelligence Sources Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS intelligence_sources (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        sourceType TEXT NOT NULL,
        url TEXT,
        retrievedAt DATETIME,
        status TEXT,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_intel_src_ws ON intelligence_sources(workspaceId)`).run();

    // 14. Intelligence Evidence Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS intelligence_evidence (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        sourceId TEXT NOT NULL,
        evidenceType TEXT NOT NULL,
        key TEXT,
        value TEXT,
        rawExcerpt TEXT,
        extractionMethod TEXT,
        observedAt DATETIME,
        createdAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_intel_evi_ws ON intelligence_evidence(workspaceId)`).run();

    // 15. Intelligence Claims Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS intelligence_claims (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        evidenceIds TEXT DEFAULT '[]',
        subject TEXT,
        predicate TEXT,
        objectValue TEXT,
        verificationStatus TEXT,
        createdAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_intel_clm_ws ON intelligence_claims(workspaceId)`).run();

    // 16. Intelligence Inferences Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS intelligence_inferences (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        supportingClaimIds TEXT DEFAULT '[]',
        field TEXT,
        value TEXT,
        inferenceMethod TEXT,
        confidence REAL,
        reason TEXT,
        createdAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_intel_inf_ws ON intelligence_inferences(workspaceId)`).run();

    // 17. Company Intelligence Cache (lead scoring summary + opening line + tech stack)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS company_intelligence (
        companyId TEXT PRIMARY KEY,
        workspaceId TEXT,
        summary TEXT,
        openingLine TEXT,
        techStack TEXT,
        painPoints TEXT,
        useCases TEXT,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_comp_intel_ws ON company_intelligence(workspaceId)`).run();

    // 18. Website Intelligence Cache (scraped site signals)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS website_intelligence (
        companyId TEXT PRIMARY KEY,
        workspaceId TEXT,
        headline TEXT,
        description TEXT,
        services TEXT,
        techStack TEXT,
        scrapedAt DATETIME,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_web_intel_ws ON website_intelligence(workspaceId)`).run();

    // 19. Contact Intelligence Cache (individual contact enrichment)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS contact_intelligence (
        contactId TEXT PRIMARY KEY,
        workspaceId TEXT,
        companyId TEXT,
        summary TEXT,
        openingLine TEXT,
        linkedinData TEXT,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_cont_intel_ws ON contact_intelligence(workspaceId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_cont_intel_comp ON contact_intelligence(companyId)`).run();

    // 20. Opportunity Scores Cache (ICP scoring per company)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS opportunity_scores (
        companyId TEXT PRIMARY KEY,
        workspaceId TEXT,
        overallScore REAL,
        fitScore REAL,
        sizeScore REAL,
        intentScore REAL,
        urgencyScore REAL,
        explanation TEXT,
        scoredAt DATETIME,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_opp_score_ws ON opportunity_scores(workspaceId)`).run();

    // 21. Settings Cache
    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        createdAt DATETIME,
        updatedAt DATETIME
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_settings_ws ON settings(workspaceId, key)`).run();

    // Store schema version in metadata
    // 21. Suppressions Cache (Phase 10)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS suppressions (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        email TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT DEFAULT 'system',
        evidence TEXT DEFAULT NULL,
        suppressedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        suppressedBy TEXT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_suppressions_ws_email ON suppressions(workspaceId, email)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_suppressions_ws_reason ON suppressions(workspaceId, reason)`).run();

    // 22. Email Quality Cache (Phase 10)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS email_quality (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL,
        sendable INTEGER DEFAULT 1,
        riskLevel TEXT DEFAULT 'moderate',
        reasons TEXT DEFAULT '[]',
        evidence TEXT DEFAULT '[]',
        recommendedAction TEXT DEFAULT 'send',
        evaluatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        expiresAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_email_quality_ws_email ON email_quality(workspaceId, email)`).run();

    db.prepare(`
      INSERT OR REPLACE INTO cache_metadata (key, value, updatedAt)
      VALUES ('schema_version', ?, datetime('now'))
    `).run(String(CACHE_SCHEMA_VERSION));
  })();
}

export type CacheState = 'CLEAN' | 'EMPTY' | 'LEGACY' | 'CORRUPT';

/**
 * Deterministically inspects an open SQLite database or file path to classify its cache state.
 */
export function detectCacheState(dbOrPath: Database.Database | string): CacheState {
  let db: Database.Database;
  let shouldClose = false;

  if (typeof dbOrPath === 'string') {
    try {
      const DatabaseConstructor = require('better-sqlite3');
      db = new DatabaseConstructor(dbOrPath);
      shouldClose = true;
    } catch {
      return 'CORRUPT';
    }
  } else {
    db = dbOrPath;
  }

  try {
    // 1. Integrity check
    const integrityRow = db.pragma('integrity_check', { simple: true }) as string;
    if (integrityRow !== 'ok') {
      return 'CORRUPT';
    }

    // 2. Inspect existing tables
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);

    if (tables.length === 0) {
      return 'EMPTY';
    }

    // 3. Check for legacy migration or legacy sync remnants
    const legacyRemnants = ['_' + 'migrations', 'sync_' + 'queue', 'sync_' + 'metadata', 'sync_' + 'dead_letter'];
    for (const legacy of legacyRemnants) {
      if (tables.includes(legacy)) {
        return 'LEGACY';
      }
    }

    // 4. Check cache_metadata table exists
    if (!tables.includes('cache_metadata')) {
      return 'LEGACY';
    }

    // 5. Check schema_version in cache_metadata
    try {
      const versionRow = db
        .prepare("SELECT value FROM cache_metadata WHERE key = 'schema_version'")
        .get() as { value: string } | undefined;

      if (!versionRow || Number(versionRow.value) !== CACHE_SCHEMA_VERSION) {
        return 'LEGACY';
      }
    } catch {
      return 'LEGACY';
    }

    // 6. Check that all required cache tables exist
    for (const table of CACHE_TABLES) {
      if (!tables.includes(table)) {
        return 'LEGACY';
      }
    }

    return 'CLEAN';
  } catch (err) {
    return 'CORRUPT';
  } finally {
    if (shouldClose && db) {
      try {
        db.close();
      } catch {}
    }
  }
}

/**
 * Safely resets a workspace cache database.
 * IMPORTANT: Implementation lives in connection.ts to avoid the circular
 * dependency: connection.ts → cache-schema.ts → connection.ts.
 * This export is intentionally a forward declaration that gets replaced
 * by the concrete implementation injected from connection.ts at startup.
 * Callers within connection.ts call the real implementation directly.
 */
export let resetWorkspaceCache: (
  workspaceId: string,
  archivePrefix?: string
) => Database.Database = (_workspaceId: string, _archivePrefix?: string): Database.Database => {
  throw new Error(
    '[CacheSchema] resetWorkspaceCache was called before connection module initialized. ' +
    'This is a boot-order bug — ensure getDatabase() has been called first.'
  );
};

/**
 * Called by connection.ts on module load to inject the concrete resetWorkspaceCache
 * implementation. Breaks the circular dependency without a runtime require().
 */
export function registerResetWorkspaceCache(
  impl: (workspaceId: string, archivePrefix?: string) => Database.Database
): void {
  resetWorkspaceCache = impl;
}

/**
 * Idempotently verifies and adds additive performance indexes to existing clean databases.
 */
export function ensureCacheIndexes(db: Database.Database): void {
  try {
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_companies_ws_del_created ON companies(workspaceId, deletedAt, createdAt DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_contacts_ws_del_created ON contacts(workspaceId, deletedAt, createdAt DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_comp_disc_comp ON company_discovery_runs(workspaceId, companyId)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_comp_disc_run_comp ON company_discovery_runs(workspaceId, discoveryRunId, companyId)`).run();
  } catch (err) {
    console.warn('[CacheSchema] Note ensuring performance indexes:', err);
  }
}

/**
 * Ensures a workspace database is in a clean cache state.
 * If legacy or corrupt, safely archives and rebuilds a fresh cache.
 */
export function ensureCleanCache(
  db: Database.Database,
  workspaceId?: string
): Database.Database {
  const state = detectCacheState(db);

  if (state === 'CLEAN') {
    ensureCacheIndexes(db);
    return db;
  }

  if (state === 'EMPTY') {
    initCacheSchema(db);
    return db;
  }

  if (workspaceId && (state === 'LEGACY' || state === 'CORRUPT')) {
    console.log(
      `[CacheLifecycle] Detected ${state} cache for workspace "${workspaceId}". Performing safe archive and clean rebuild.`
    );
    const prefix = state === 'CORRUPT' ? 'corrupt_archive' : 'legacy_archive';
    return resetWorkspaceCache(workspaceId, prefix);
  }

  // Fallback in-memory or global DB
  initCacheSchema(db);
  return db;
}

