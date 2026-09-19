/**
 * LeadForge OS — SQLite to MongoDB Migration Manifest
 * Defines table-to-collection mapping, dependency ordering, foreign key relations,
 * JSON transformations, and field normalization rules.
 */

export interface FieldTransformer {
  (value: any, row: Record<string, any>): any;
}

export interface TableMigrationConfig {
  sqliteTable: string;
  mongoCollection: string;
  idField: string;
  workspaceField: string;
  dependencies: string[]; // List of sqliteTable names that must be migrated prior
  foreignKeys: Array<{
    field: string;
    targetTable: string;
    targetCollection: string;
    targetField: string;
    isArray?: boolean;
    nullable?: boolean;
  }>;
  transform: (row: Record<string, any>, workspaceId: string) => Record<string, any>;
}

export function parseJsonField(val: any, fallback: any = null): any {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

export function parseDate(val: any): Date | null {
  if (!val || val === '' || val === 'null') return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export function parseBool(val: any): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

export function parseNumber(val: any, fallback = 0): number {
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  if (!val) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

export const MIGRATION_TABLE_ORDER: TableMigrationConfig[] = [
  // 1. Workspaces
  {
    sqliteTable: 'workspaces',
    mongoCollection: 'workspaces',
    idField: 'id',
    workspaceField: 'id',
    dependencies: [],
    foreignKeys: [],
    transform: (row, wsId) => ({
      _id: String(row.id || wsId),
      name: String(row.name || 'Workspace'),
      slug: row.slug ? String(row.slug) : undefined,
      ownerId: row.ownerId ? String(row.ownerId) : 'system',
      settings: parseJsonField(row.settings, {}),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 2. Companies
  {
    sqliteTable: 'companies',
    mongoCollection: 'companies',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      name: String(row.name || 'Unnamed Company'),
      domain: row.domain ? String(row.domain).toLowerCase().trim() : null,
      industry: row.industry ? String(row.industry) : null,
      size: row.size ? String(row.size) : null,
      location: row.location ? String(row.location) : null,
      linkedinUrl: row.linkedinUrl ? String(row.linkedinUrl) : null,
      website: row.website ? String(row.website) : null,
      description: row.description ? String(row.description) : null,
      revenueRange: row.revenueRange ? String(row.revenueRange) : null,
      foundedYear: row.foundedYear ? parseNumber(row.foundedYear, 0) : null,
      techStack: Array.isArray(parseJsonField(row.techStack))
        ? parseJsonField(row.techStack)
        : row.techStack
          ? String(row.techStack)
              .split(',')
              .map((s) => s.trim())
          : [],
      socialProfiles: parseJsonField(row.socialProfiles, {}),
      tags: Array.isArray(parseJsonField(row.tags)) ? parseJsonField(row.tags) : [],
      customFields: parseJsonField(row.customFields, {}),
      isDeleted: parseBool(row.isDeleted),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 3. Contacts
  {
    sqliteTable: 'contacts',
    mongoCollection: 'contacts',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id',
        nullable: true
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: row.companyId ? String(row.companyId) : null,
      firstName: row.firstName ? String(row.firstName) : null,
      lastName: row.lastName ? String(row.lastName) : null,
      email: row.email ? String(row.email).toLowerCase().trim() : null,
      title: row.title ? String(row.title) : null,
      phone: row.phone ? String(row.phone) : null,
      linkedinUrl: row.linkedinUrl ? String(row.linkedinUrl) : null,
      location: row.location ? String(row.location) : null,
      isDecisionMaker: parseBool(row.isDecisionMaker),
      score: row.score !== undefined && row.score !== null ? parseNumber(row.score, 0) : null,
      status: String(row.status || 'UNCONTACTED'),
      notes: typeof row.notes === 'string' ? row.notes : JSON.stringify(row.notes || ''),
      tags: Array.isArray(parseJsonField(row.tags)) ? parseJsonField(row.tags) : [],
      customFields: parseJsonField(row.customFields, {}),
      lastContactedAt: parseDate(row.lastContactedAt),
      isDeleted: parseBool(row.isDeleted),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 4. Email Accounts
  {
    sqliteTable: 'email_accounts',
    mongoCollection: 'emailaccounts',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      email: String(row.email).toLowerCase().trim(),
      provider: String(row.provider || 'OTHER'),
      status: String(row.status || 'ACTIVE'),
      smtpHost: row.smtpHost ? String(row.smtpHost) : undefined,
      smtpPort: row.smtpPort ? parseNumber(row.smtpPort, 587) : undefined,
      smtpUser: row.smtpUser ? String(row.smtpUser) : undefined,
      smtpPassword: row.smtpPassword ? String(row.smtpPassword) : undefined,
      imapHost: row.imapHost ? String(row.imapHost) : undefined,
      imapPort: row.imapPort ? parseNumber(row.imapPort, 993) : undefined,
      imapUser: row.imapUser ? String(row.imapUser) : undefined,
      imapPassword: row.imapPassword ? String(row.imapPassword) : undefined,
      dailyLimit: parseNumber(row.dailyLimit, 50),
      sentToday: parseNumber(row.sentToday, 0),
      warmupEnabled: parseBool(row.warmupEnabled),
      warmupStatus: parseJsonField(row.warmupStatus, {}),
      authType: row.authType ? String(row.authType) : 'PASSWORD',
      oauthProvider: row.oauthProvider ? String(row.oauthProvider) : undefined,
      oauthTokens: parseJsonField(row.oauthTokens, undefined),
      errorDetails:
        typeof row.errorDetails === 'string'
          ? row.errorDetails
          : row.errorDetails
            ? JSON.stringify(row.errorDetails)
            : undefined,
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 5. Templates
  {
    sqliteTable: 'templates',
    mongoCollection: 'emailtemplates',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      name: String(row.name || 'Untitled Template'),
      subject: String(row.subject || ''),
      body: String(row.body || ''),
      variables: Array.isArray(parseJsonField(row.variables)) ? parseJsonField(row.variables) : [],
      category: row.category ? String(row.category) : undefined,
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 6. Sequences
  {
    sqliteTable: 'sequences',
    mongoCollection: 'sequences',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      name: String(row.name || 'Untitled Sequence'),
      description: row.description ? String(row.description) : undefined,
      status: String(row.status || 'DRAFT'),
      steps: Array.isArray(parseJsonField(row.steps)) ? parseJsonField(row.steps) : [],
      settings: parseJsonField(row.settings, {}),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 7. Campaigns
  {
    sqliteTable: 'campaigns',
    mongoCollection: 'campaigns',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'sequences', 'email_accounts'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'sequenceId',
        targetTable: 'sequences',
        targetCollection: 'sequences',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'sendingAccountId',
        targetTable: 'email_accounts',
        targetCollection: 'emailaccounts',
        targetField: '_id',
        nullable: true
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      name: String(row.name || 'Untitled Campaign'),
      status: String(row.status || 'DRAFT'),
      type: row.type ? String(row.type) : 'OUTBOUND',
      sequenceId: row.sequenceId ? String(row.sequenceId) : undefined,
      sendingAccountId: row.sendingAccountId ? String(row.sendingAccountId) : undefined,
      targetAudienceId: row.targetAudienceId ? String(row.targetAudienceId) : undefined,
      dailyLimit: parseNumber(row.dailyLimit, 50),
      settings: parseJsonField(row.settings, {}),
      statistics: parseJsonField(row.statistics, {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        bounced: 0
      }),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 8. Sequence Executions
  {
    sqliteTable: 'sequence_executions',
    mongoCollection: 'sequenceexecutions',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'sequences', 'campaigns', 'contacts'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'sequenceId',
        targetTable: 'sequences',
        targetCollection: 'sequences',
        targetField: '_id'
      },
      {
        field: 'campaignId',
        targetTable: 'campaigns',
        targetCollection: 'campaigns',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'contactId',
        targetTable: 'contacts',
        targetCollection: 'contacts',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id',
        nullable: true
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      sequenceId: String(row.sequenceId),
      campaignId: row.campaignId ? String(row.campaignId) : undefined,
      contactId: String(row.contactId),
      companyId: row.companyId ? String(row.companyId) : undefined,
      status: String(row.status || 'ACTIVE'),
      currentStep: parseNumber(row.currentStep, 0),
      nextStepAt: parseDate(row.nextStepAt),
      variables: parseJsonField(row.variables, {}),
      logs: Array.isArray(parseJsonField(row.logs)) ? parseJsonField(row.logs) : [],
      parentJobId: row.parentJobId ? String(row.parentJobId) : undefined,
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 9. Sequence Logs
  {
    sqliteTable: 'sequence_logs',
    mongoCollection: 'sequencelogs',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'sequence_executions'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'executionId',
        targetTable: 'sequence_executions',
        targetCollection: 'sequenceexecutions',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      executionId: String(row.executionId),
      stepIndex: parseNumber(row.stepIndex, 0),
      action: String(row.action || 'EXECUTE_STEP'),
      status: String(row.status || 'COMPLETED'),
      payload: parseJsonField(row.payload, {}),
      error: row.error ? String(row.error) : undefined,
      createdAt: parseDate(row.createdAt) || new Date()
    })
  },

  // 10. Audiences
  {
    sqliteTable: 'audiences',
    mongoCollection: 'audiences',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'contacts'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'staticMemberIds',
        targetTable: 'contacts',
        targetCollection: 'contacts',
        targetField: '_id',
        isArray: true,
        nullable: true
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      name: String(row.name || 'Untitled Audience'),
      description: row.description ? String(row.description) : undefined,
      type: String(row.type || 'STATIC'),
      filterDefinition: parseJsonField(row.filterDefinition, {}),
      staticMemberIds: Array.isArray(parseJsonField(row.staticMemberIds))
        ? parseJsonField(row.staticMemberIds).map(String)
        : [],
      memberCount: parseNumber(row.memberCount, 0),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 11. Discovery Runs
  {
    sqliteTable: 'discovery_runs',
    mongoCollection: 'discoveryruns',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      name: String(row.name || 'Discovery Run'),
      status: String(row.status || 'COMPLETED'),
      config: parseJsonField(row.config, {}),
      stats: parseJsonField(row.stats, {}),
      error: row.error ? String(row.error) : undefined,
      startedAt: parseDate(row.startedAt),
      finishedAt: parseDate(row.finishedAt),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 12. Company Discovery Runs
  {
    sqliteTable: 'company_discovery_runs',
    mongoCollection: 'companydiscoveryruns',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'discovery_runs', 'companies'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'discoveryRunId',
        targetTable: 'discovery_runs',
        targetCollection: 'discoveryruns',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      discoveryRunId: String(row.discoveryRunId),
      companyId: String(row.companyId),
      status: String(row.status || 'PENDING'),
      data: parseJsonField(row.data, {}),
      error: row.error ? String(row.error) : undefined,
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 13. Jobs (Historical & queued)
  {
    sqliteTable: 'jobs',
    mongoCollection: 'jobs',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      type: String(row.type || 'generic'),
      status: String(row.status || 'completed'),
      priority: parseNumber(row.priority, 0),
      payload: parseJsonField(row.payload, {}),
      result: parseJsonField(row.result, undefined),
      error: row.error ? String(row.error) : undefined,
      progress: parseNumber(row.progress, 0),
      retryCount: parseNumber(row.retryCount, 0),
      maxRetries: parseNumber(row.maxRetries, 3),
      checkpointData: parseJsonField(row.checkpointData, undefined),
      idempotencyKey: row.idempotencyKey ? String(row.idempotencyKey) : undefined,
      workerId: row.workerId ? String(row.workerId) : undefined,
      scheduledAt: parseDate(row.scheduledAt),
      startedAt: parseDate(row.startedAt),
      finishedAt: parseDate(row.finishedAt),
      heartbeatAt: parseDate(row.heartbeatAt),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 14. System Logs
  {
    sqliteTable: 'system_logs',
    mongoCollection: 'systemlogs',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      severity: String(row.severity || 'info'),
      source: String(row.source || 'desktop'),
      message: String(row.message || ''),
      context: parseJsonField(row.context, {}),
      workerId: row.workerId ? String(row.workerId) : undefined,
      createdAt: parseDate(row.createdAt) || new Date()
    })
  },

  // 15. Automation Locks
  {
    sqliteTable: 'automation_locks',
    mongoCollection: 'automationlocks',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'sequences'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => {
      const lockKey =
        row.id && String(row.id).includes(':')
          ? String(row.id)
          : `${row.workspaceId || wsId}:${row.sequenceId}:${row.entityId}`;
      return {
        _id: lockKey,
        workspaceId: String(row.workspaceId || wsId),
        sequenceId: String(row.sequenceId),
        entityId: String(row.entityId),
        ownerId: String(row.ownerId || 'migration'),
        lockedAt: parseDate(row.lockedAt) || new Date(),
        expiresAt: parseDate(row.expiresAt) || new Date(Date.now() + 30000)
      };
    }
  },

  // 16. Email Deliveries
  {
    sqliteTable: 'email_deliveries',
    mongoCollection: 'emaildeliveries',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: [
      'workspaces',
      'campaigns',
      'sequences',
      'sequence_executions',
      'contacts',
      'companies',
      'email_accounts'
    ],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'campaignId',
        targetTable: 'campaigns',
        targetCollection: 'campaigns',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'sequenceId',
        targetTable: 'sequences',
        targetCollection: 'sequences',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'executionId',
        targetTable: 'sequence_executions',
        targetCollection: 'sequenceexecutions',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'contactId',
        targetTable: 'contacts',
        targetCollection: 'contacts',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'accountId',
        targetTable: 'email_accounts',
        targetCollection: 'emailaccounts',
        targetField: '_id',
        nullable: true
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      campaignId: row.campaignId ? String(row.campaignId) : undefined,
      sequenceId: row.sequenceId ? String(row.sequenceId) : undefined,
      executionId: row.executionId ? String(row.executionId) : undefined,
      stepIndex: parseNumber(row.stepIndex, 0),
      contactId: row.contactId ? String(row.contactId) : undefined,
      companyId: row.companyId ? String(row.companyId) : undefined,
      accountId: row.accountId ? String(row.accountId) : undefined,
      senderEmail: String(row.senderEmail || '')
        .toLowerCase()
        .trim(),
      recipientEmail: String(row.recipientEmail || '')
        .toLowerCase()
        .trim(),
      subject: String(row.subject || ''),
      body: row.body ? String(row.body) : undefined,
      status: String(row.status || 'SENT'),
      providerMessageId: row.providerMessageId ? String(row.providerMessageId) : undefined,
      error: row.error ? String(row.error) : undefined,
      idempotencyKey: String(row.idempotencyKey || `deliv-${row.id}`),
      sentAt: parseDate(row.sentAt),
      openedAt: parseDate(row.openedAt),
      clickedAt: parseDate(row.clickedAt),
      repliedAt: parseDate(row.repliedAt),
      bouncedAt: parseDate(row.bouncedAt),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 17. Company Intelligence
  {
    sqliteTable: 'company_intelligence',
    mongoCollection: 'companyintelligences',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: String(row.companyId),
      summary: String(row.summary || ''),
      painPoints: Array.isArray(parseJsonField(row.painPoints))
        ? parseJsonField(row.painPoints)
        : [],
      valuePropositions: Array.isArray(parseJsonField(row.valuePropositions))
        ? parseJsonField(row.valuePropositions)
        : [],
      offerings: Array.isArray(parseJsonField(row.offerings)) ? parseJsonField(row.offerings) : [],
      targetAudience: Array.isArray(parseJsonField(row.targetAudience))
        ? parseJsonField(row.targetAudience)
        : [],
      buyingSignals: Array.isArray(parseJsonField(row.buyingSignals))
        ? parseJsonField(row.buyingSignals)
        : [],
      confidenceScore: parseNumber(row.confidenceScore, 0.8),
      modelUsed: row.modelUsed ? String(row.modelUsed) : 'gpt-4o-mini',
      lastEnrichedAt: parseDate(row.lastEnrichedAt) || new Date(),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 18. Website Intelligence
  {
    sqliteTable: 'website_intelligence',
    mongoCollection: 'websiteintelligences',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: String(row.companyId),
      domain: String(row.domain || '')
        .toLowerCase()
        .trim(),
      techStack: Array.isArray(parseJsonField(row.techStack)) ? parseJsonField(row.techStack) : [],
      keyPages: Array.isArray(parseJsonField(row.keyPages)) ? parseJsonField(row.keyPages) : [],
      metaDescription: row.metaDescription ? String(row.metaDescription) : undefined,
      h1Tags: Array.isArray(parseJsonField(row.h1Tags)) ? parseJsonField(row.h1Tags) : [],
      pricingModel: row.pricingModel ? String(row.pricingModel) : undefined,
      lastCrawledAt: parseDate(row.lastCrawledAt) || new Date(),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 19. Contact Intelligence
  {
    sqliteTable: 'contact_intelligence',
    mongoCollection: 'contactintelligences',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'contacts'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'contactId',
        targetTable: 'contacts',
        targetCollection: 'contacts',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      contactId: String(row.contactId),
      summary: String(row.summary || ''),
      keyResponsibilities: Array.isArray(parseJsonField(row.keyResponsibilities))
        ? parseJsonField(row.keyResponsibilities)
        : [],
      talkingPoints: Array.isArray(parseJsonField(row.talkingPoints))
        ? parseJsonField(row.talkingPoints)
        : [],
      communicationStyle: row.communicationStyle ? String(row.communicationStyle) : undefined,
      confidenceScore: parseNumber(row.confidenceScore, 0.8),
      modelUsed: row.modelUsed ? String(row.modelUsed) : 'gpt-4o-mini',
      lastEnrichedAt: parseDate(row.lastEnrichedAt) || new Date(),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 20. Opportunity Scores
  {
    sqliteTable: 'opportunity_scores',
    mongoCollection: 'opportunityscores',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: String(row.companyId),
      score: parseNumber(row.score, 50),
      fitScore: parseNumber(row.fitScore, 50),
      intentScore: parseNumber(row.intentScore, 50),
      factors: Array.isArray(parseJsonField(row.factors)) ? parseJsonField(row.factors) : [],
      recommendation: row.recommendation ? String(row.recommendation) : undefined,
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 21. Page Crawls
  {
    sqliteTable: 'page_crawls',
    mongoCollection: 'pagecrawls',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: String(row.companyId),
      url: String(row.url || ''),
      contentHash: String(row.contentHash || ''),
      extractedText: String(row.extractedText || '').slice(0, 65536), // Max 64KB
      extractedMetadata: parseJsonField(row.extractedMetadata, {}),
      httpStatus: parseNumber(row.httpStatus, 200),
      crawledAt: parseDate(row.crawledAt) || new Date(),
      createdAt: parseDate(row.createdAt) || new Date()
    })
  },

  // 22. Intelligence Sources
  {
    sqliteTable: 'intelligence_sources',
    mongoCollection: 'intelligencesources',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: String(row.companyId),
      sourceType: String(row.sourceType || 'WEBSITE'),
      url: String(row.url || ''),
      title: row.title ? String(row.title) : undefined,
      fetchedAt: parseDate(row.fetchedAt) || new Date(),
      metadata: parseJsonField(row.metadata, {}),
      createdAt: parseDate(row.createdAt) || new Date()
    })
  },

  // 23. Intelligence Evidence
  {
    sqliteTable: 'intelligence_evidence',
    mongoCollection: 'intelligenceevidences',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies', 'intelligence_sources'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      },
      {
        field: 'sourceId',
        targetTable: 'intelligence_sources',
        targetCollection: 'intelligencesources',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: String(row.companyId),
      sourceId: String(row.sourceId),
      factType: String(row.factType || 'KEYWORD'),
      factValue: String(row.factValue || ''),
      rawExcerpt: row.rawExcerpt ? String(row.rawExcerpt).slice(0, 4096) : undefined,
      confidence: parseNumber(row.confidence, 0.9),
      createdAt: parseDate(row.createdAt) || new Date()
    })
  },

  // 24. Intelligence Claims
  {
    sqliteTable: 'intelligence_claims',
    mongoCollection: 'intelligenceclaims',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies', 'intelligence_evidence'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      },
      {
        field: 'evidenceIds',
        targetTable: 'intelligence_evidence',
        targetCollection: 'intelligenceevidences',
        targetField: '_id',
        isArray: true
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: String(row.companyId),
      evidenceIds: Array.isArray(parseJsonField(row.evidenceIds))
        ? parseJsonField(row.evidenceIds).map(String)
        : [],
      claimText: String(row.claimText || ''),
      claimCategory: String(row.claimCategory || 'OFFERING'),
      confidence: parseNumber(row.confidence, 0.9),
      createdAt: parseDate(row.createdAt) || new Date()
    })
  },

  // 25. Intelligence Inferences
  {
    sqliteTable: 'intelligence_inferences',
    mongoCollection: 'intelligenceinferences',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'companies', 'intelligence_claims'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id'
      },
      {
        field: 'supportingClaimIds',
        targetTable: 'intelligence_claims',
        targetCollection: 'intelligenceclaims',
        targetField: '_id',
        isArray: true
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      companyId: String(row.companyId),
      supportingClaimIds: Array.isArray(parseJsonField(row.supportingClaimIds))
        ? parseJsonField(row.supportingClaimIds).map(String)
        : [],
      inferenceText: String(row.inferenceText || ''),
      inferenceType: String(row.inferenceType || 'PAIN_POINT'),
      confidence: parseNumber(row.confidence, 0.85),
      createdAt: parseDate(row.createdAt) || new Date()
    })
  },

  // 26. Workspace Memory
  {
    sqliteTable: 'workspace_memory',
    mongoCollection: 'workspacememories',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id || `${wsId}:${row.scope}:${row.key}`),
      workspaceId: String(row.workspaceId || wsId),
      scope: String(row.scope || 'general'),
      key: String(row.key || 'default'),
      value: parseJsonField(row.value, row.value),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  },

  // 27. Audit Logs
  {
    sqliteTable: 'audit_logs',
    mongoCollection: 'auditlogs',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      actor: parseJsonField(row.actor, { type: 'system', userId: null }),
      action: String(row.action || 'system.audit'),
      entityType: String(row.entityType || 'Unknown'),
      entityId: String(row.entityId || ''),
      beforeValue: parseJsonField(row.beforeValue, undefined),
      afterValue: parseJsonField(row.afterValue, undefined),
      timestamp: parseDate(row.timestamp) || parseDate(row.createdAt) || new Date()
    })
  },

  // 28. Outreach
  {
    sqliteTable: 'outreach',
    mongoCollection: 'outreaches',
    idField: 'id',
    workspaceField: 'workspaceId',
    dependencies: ['workspaces', 'campaigns', 'contacts', 'companies'],
    foreignKeys: [
      {
        field: 'workspaceId',
        targetTable: 'workspaces',
        targetCollection: 'workspaces',
        targetField: '_id'
      },
      {
        field: 'campaignId',
        targetTable: 'campaigns',
        targetCollection: 'campaigns',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'contactId',
        targetTable: 'contacts',
        targetCollection: 'contacts',
        targetField: '_id',
        nullable: true
      },
      {
        field: 'companyId',
        targetTable: 'companies',
        targetCollection: 'companies',
        targetField: '_id',
        nullable: true
      }
    ],
    transform: (row, wsId) => ({
      _id: String(row.id),
      workspaceId: String(row.workspaceId || wsId),
      campaignId: row.campaignId ? String(row.campaignId) : undefined,
      contactId: row.contactId ? String(row.contactId) : undefined,
      companyId: row.companyId ? String(row.companyId) : undefined,
      type: String(row.type || 'EMAIL'),
      channel: String(row.channel || 'EMAIL'),
      status: String(row.status || 'SENT'),
      scheduledAt: parseDate(row.scheduledAt),
      sentAt: parseDate(row.sentAt),
      error: row.error ? String(row.error) : undefined,
      metadata: parseJsonField(row.metadata, {}),
      createdAt: parseDate(row.createdAt) || new Date(),
      updatedAt: parseDate(row.updatedAt) || new Date()
    })
  }
];

export const IGNORED_SQLITE_TABLES = [
  'sync_queue',
  'sync_metadata',
  'sync_dead_letter',
  '_migrations',
  'sqlite_sequence',
  'sqlite_stat1',
  'discovery_jobs',
  'discovery_results'
];
