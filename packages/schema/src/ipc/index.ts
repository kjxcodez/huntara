import type { CreateCompanyDto, CompanyFilters } from '../dto/company.js';
import type { Company } from '../entities/company.js';
import type { LoginDto, RegisterDto, AuthResponse } from '../dto/auth.js';
import type { CreateWorkspaceDto, UpdateWorkspaceDto, InviteMemberDto } from '../dto/workspace.js';
import type { Workspace, WorkspaceMember } from '../entities/workspace.js';
import type { WorkspaceRole } from '../enums/index.js';

export type ConnectivityStatus = 'CHECKING' | 'ONLINE' | 'DEGRADED' | 'AUTHENTICATION_REQUIRED';

export type ConnectivityErrorCode =
  | 'NETWORK_UNREACHABLE'
  | 'TIMEOUT'
  | 'HTTP_5XX'
  | 'HTTP_401'
  | 'HTTP_403'
  | 'HEALTH_CHECK_INVALID_RESPONSE'
  | 'UNKNOWN';

export interface RuntimeConnectivityState {
  status: ConnectivityStatus;
  apiUrl: string;
  error: {
    code: ConnectivityErrorCode;
    message: string;
    statusCode?: number;
  } | null;
  lastCheckedAt: string;
  activeWorkspaceId: string | null;
}

export interface CanonicalContactQuery {
  search?: string | undefined;
  status?: string | undefined;
  companyId?: string | undefined;
  title?: string | undefined;
  source?: string | undefined;
  discoveryRunId?: string | undefined;
  location?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  country?: string | undefined;
}

export type BulkContactSelection =
  | {
      mode: 'explicit';
      selectedIds: string[];
    }
  | {
      mode: 'all-matching';
      query: CanonicalContactQuery;
      excludedIds: string[];
    };

export interface IpcChannelMap {
  'diagnostics:get-system-info': {
    input: { workspaceId?: string };
    output: any;
  };
  'diagnostics:export-support-bundle': {
    input: { workspaceId?: string };
    output: { success: boolean; message: string };
  };
  'system:connectivity-status': {
    input: void;
    output: RuntimeConnectivityState;
  };
  'system:connectivity-check': {
    input: void;
    output: RuntimeConnectivityState;
  };
  'system:connectivity-changed': {
    input: void;
    output: RuntimeConnectivityState;
  };
  'companies:list': {
    input: CompanyFilters;
    output: Company[];
  };
  'companies:create': {
    input: CreateCompanyDto;
    output: Company;
  };
  'companies:bulk:create': {
    input: { workspaceId: string; data: any[] };
    output: any;
  };
  'contacts:bulk:create': {
    input: { workspaceId: string; data: any[] };
    output: any;
  };
  'system:status': {
    input: void;
    output: Array<{ name: string; status: string }>;
  };
  'auth:login': {
    input: LoginDto;
    output: AuthResponse;
  };
  'auth:register': {
    input: RegisterDto;
    output: AuthResponse;
  };
  'auth:logout': {
    input: void;
    output: void;
  };
  'auth:session': {
    input: void;
    output: any;
  };
  'auth:forgot-password': {
    input: { email: string };
    output: { success: boolean };
  };
  'auth:resend-verification': {
    input: { email: string };
    output: { success: boolean };
  };
  'auth:unauthorized': {
    input: void;
    output: void;
  };
  'auth:google:login': {
    input: void;
    output: AuthResponse;
  };
  'auth:google:check-chrome': {
    input: void;
    output: { installed: boolean; path?: string };
  };
  'settings:getSync': {
    input: void;
    output: any;
  };
  'settings:set': {
    input: any;
    output: void;
  };
  'workspaces:create': {
    input: CreateWorkspaceDto;
    output: Workspace;
  };
  'workspaces:list': {
    input: void;
    output: Workspace[];
  };
  'workspaces:update': {
    input: { id: string; dto: UpdateWorkspaceDto };
    output: Workspace;
  };
  'workspaces:delete': {
    input: string;
    output: void;
  };
  'workspaces:get': {
    input: string;
    output: Workspace;
  };
  'workspaces:members:list': {
    input: string;
    output: WorkspaceMember[];
  };
  'workspaces:members:invite': {
    input: { id: string; dto: InviteMemberDto };
    output: Workspace;
  };
  'workspaces:members:updateRole': {
    input: { id: string; memberId: string; role: WorkspaceRole };
    output: Workspace;
  };
  'workspaces:members:remove': {
    input: { id: string; memberId: string };
    output: Workspace;
  };
  'workspaces:members:leave': {
    input: string;
    output: Workspace;
  };
  'workspaces:members:transferOwnership': {
    input: { id: string; newOwnerId: string };
    output: Workspace;
  };
  'workspaces:invites:list': {
    input: void;
    output: Workspace[];
  };
  'workspaces:invites:accept': {
    input: string;
    output: Workspace;
  };
  'workspaces:invites:decline': {
    input: string;
    output: Workspace;
  };
  'electron:setActiveWorkspace': {
    input: string | null;
    output: void;
  };
  'electron:getActiveWorkspace': {
    input: void;
    output: string | null;
  };

  // ── CRM API Remote queries ──────────────────────────────────────────────
  'companies:get': {
    input: string;
    output: any;
  };
  'companies:update': {
    input: { id: string; dto: any };
    output: any;
  };
  'companies:delete': {
    input: { workspaceId: string; id: string };
    output: void;
  };
  'contacts:get': {
    input: string;
    output: any;
  };
  'contacts:list': {
    input: any;
    output: any[];
  };
  'contacts:create': {
    input: any;
    output: any;
  };
  'contacts:update': {
    input: { id: string; dto: any };
    output: any;
  };
  'contacts:delete': {
    input: { workspaceId: string; id: string };
    output: void;
  };
  'campaigns:get': {
    input: string;
    output: any;
  };
  'campaigns:list': {
    input: any;
    output: any[];
  };
  'campaigns:create': {
    input: any;
    output: any;
  };
  'campaigns:update': {
    input: { id: string; dto: any };
    output: any;
  };
  'campaigns:delete': {
    input: { workspaceId: string; id: string };
    output: void;
  };
  'campaigns:enroll': {
    input: { campaignId: string; contactIds?: string[]; selection?: BulkContactSelection };
    output: { success: boolean; enrolledCount: number };
  };
  'campaigns:enrollments:list': {
    input: { workspaceId: string; campaignId: string | null };
    output: any[];
  };
  'campaigns:bulk-pause-enrollments': {
    input: { campaignId: string | null; enrollmentIds: string[] };
    output: { success: boolean };
  };
  'campaigns:bulk-resume-enrollments': {
    input: { campaignId: string | null; enrollmentIds: string[] };
    output: { success: boolean };
  };
  'campaigns:bulk-remove-enrollments': {
    input: { campaignId: string | null; enrollmentIds: string[] };
    output: { success: boolean };
  };
  'campaigns:pause': {
    input: string;
    output: { success: boolean; campaignId: string; status: string };
  };
  'campaigns:resume': {
    input: string;
    output: { success: boolean; campaignId: string; status: string; enqueuedCount?: number };
  };
  'campaigns:stop': {
    input: string;
    output: { success: boolean; campaignId: string; status: string };
  };
  'campaigns:runtime:overview': {
    input: { workspaceId: string; campaignId?: string };
    output: { jobs: any[]; waiting: any[] };
  };
  'scheduler:queue:list': {
    input: { workspaceId: string };
    output: { jobs: any[]; waiting: any[] };
  };

  // ── Local SQLite Cache Queries ───────────────────────────────────────────
  'db:find': {
    input: { tableName: string; workspaceId: string; filter?: any };
    output: any[];
  };
  'db:findById': {
    input: { tableName: string; workspaceId: string; id: string };
    output: any | null;
  };
  'db:save': {
    input: { tableName: string; record: any };
    output: any;
  };
  'db:saveMany': {
    input: { tableName: string; records: any[] };
    output: void;
  };
  'db:softDelete': {
    input: { tableName: string; workspaceId: string; id: string };
    output: void;
  };
  'db:delete': {
    input: { tableName: string; workspaceId: string; id: string };
    output: void;
  };
  'db:workspaces:findMany': {
    input: void;
    output: any[];
  };
  'db:workspaces:saveMany': {
    input: any[];
    output: void;
  };


  'scheduler:jobs:list': {
    input: { workspaceId: string };
    output: any[];
  };
  'scheduler:jobs:submit': {
    input: {
      id?: string;
      workspaceId: string;
      type: string;
      payload: any;
      priority?: number;
      maxRetries?: number;
    };
    output: any;
  };
  'scheduler:jobs:cancel': {
    input: { workspaceId: string; jobId: string };
    output: void;
  };
  'scheduler:dead-letters:list': {
    input: { workspaceId: string; limit?: number; offset?: number };
    output: { data: any[]; total: number; limit: number; offset: number };
  };
  'scheduler:dead-letters:requeue': {
    input: { workspaceId: string; jobId: string };
    output: any;
  };
  'scheduler:workers:health': {
    input?: { workspaceId?: string };
    output: { workers: any[]; systemStatus: string };
  };
  'projection:rebuild': {
    input: { workspaceId: string };
    output: { success: boolean; stats: any };
  };
  'sync:reconcile': {
    input: {
      workspaceId: string;
      scope?: 'all' | 'audiences' | 'companies' | 'contacts' | 'campaigns' | 'discovery_runs';
    };
    output: {
      success: boolean;
      scope: string;
      recordsReconciled: Record<string, number>;
    };
  };

  'discovery:run:create': {
    input: {
      workspaceId: string;
      name?: string;
      query: string;
      country?: string;
      state?: string;
      city?: string;
      maxResults?: number;
      provider?: string;
    };
    output: any;
  };
  'discovery:run:list': {
    input: { workspaceId: string };
    output: any[];
  };
  'discovery:run:get': {
    input: { workspaceId: string; id: string };
    output: any;
  };
  'discovery:run:companies': {
    input: { workspaceId: string; runId: string; forceSync?: boolean };
    output: any[];
  };
  'discovery:run:delete': {
    input: { workspaceId: string; id: string };
    output: { success: boolean; alreadyDeleted?: boolean };
  };
  'audiences:list': {
    input: { workspaceId: string };
    output: any[];
  };
  'audiences:create': {
    input: any;
    output: any;
  };
  'audiences:get': {
    input: { workspaceId: string; id: string };
    output: any;
  };
  'audiences:update': {
    input: { id: string; dto: any };
    output: any;
  };
  'audiences:delete': {
    input: { workspaceId: string; id: string };
    output: void;
  };
  'audiences:resolve': {
    input: { workspaceId: string; id?: string; filterDefinition?: any; mode?: string; staticMemberIds?: string[] };
    output: { contactIds: string[]; companyIds: string[]; contactCount?: number; companyCount?: number };
  };
  'companies:query': {
    input: {
      workspaceId: string;
      search?: string;
      status?: string;
      industry?: string;
      discoveryRunId?: string;
      location?: string;
    };
    output: any[];
  };
  'contacts:query': {
    input: {
      workspaceId: string;
      search?: string;
      status?: string;
      companyId?: string;
      title?: string;
      source?: string;
      discoveryRunId?: string;
    };
    output: any[];
  };
  'contacts:query:resolve': {
    input: {
      workspaceId: string;
      query: CanonicalContactQuery;
      excludedIds?: string[];
    };
    output: { contactIds: string[]; total: number };
  };
  'contacts:bulk:delete': {
    input: {
      workspaceId: string;
      selection: BulkContactSelection;
    };
    output: { success: boolean; count: number };
  };
  'contacts:bulk:update-status': {
    input: {
      workspaceId: string;
      selection: BulkContactSelection;
      status: string;
    };
    output: { success: boolean; count: number };
  };
  'companies:distinct-values': {
    input: { workspaceId: string };
    output: { industries: string[]; locations: string[]; cities?: string[]; states?: string[]; countries?: string[] };
  };
  'contacts:distinct-values': {
    input: { workspaceId: string };
    output: { titles: string[]; sources: string[] };
  };
  'drive:status': {
    input: { transactionId: string };
    output: { status: string; error?: string; connection?: any };
  };
  'drive:connect': {
    input: void | { workspaceId?: string };
    output: { transactionId?: string; authorizationUrl?: string };
  };
  'drive:reconnect': {
    input: { id: string };
    output: { transactionId?: string; authorizationUrl?: string };
  };
  'drive:disconnect': {
    input: { id: string };
    output: { success: boolean };
  };


  'activities:list': {
    input: any;
    output: any[];
  };
  'email-accounts:list': {
    input: void;
    output: any[];
  };
  'email-accounts:delete': {
    input: string;
    output: void;
  };
  'email-accounts:reset-health': {
    input: string;
    output: { success: boolean };
  };
  'email-accounts:gmail:connect': {
    input: void;
    output: { transactionId: string; authorizationUrl: string };
  };
  'email-accounts:gmail:status': {
    input: { transactionId: string };
    output: { status: string; emailAccountId?: string; account?: any; error?: string };
  };
  'email-accounts:gmail:disconnect': {
    input: { id: string };
    output: { success: boolean };
  };
  'email-accounts:gmail:reconnect': {
    input: { id: string };
    output: { transactionId: string; authorizationUrl: string };
  };
  'email-accounts:sync-signature': {
    input: { id: string };
    output: { signature: string | null; synced: boolean };
  };
  'email-accounts:send-test': {
    input: {
      id: string;
      to: string;
      useSignature?: boolean;
      attachments?: Array<{
        filename: string;
        path?: string;
        contentBase64?: string;
        contentType?: string;
        size?: number;
      }>;
    };
    output: { sent: boolean; messageId?: string; sentTo?: string; error?: string; signatureNotice?: string };
  };
  'email-accounts:test-recipients': {
    input: void;
    output: Array<{ email: string; firstUsedAt?: string | Date; lastUsedAt?: string | Date }>;
  };
  'templates:list': {
    input: void;
    output: any[];
  };
  'templates:create': {
    input: any;
    output: any;
  };
  'templates:update': {
    input: { id: string; dto: any };
    output: any;
  };
  'templates:delete': {
    input: string;
    output: void;
  };
  'templates:preview': {
    input: { id: string; contactId?: string };
    output: {
      subject: string;
      body: string;
      html?: string;
      text?: string;
      version?: number;
      variablesSnapshot?: Record<string, any>;
    };
  };
  'email-deliveries:list': {
    input: {
      workspaceId?: string;
      campaignId?: string;
      sequenceId?: string;
      contactId?: string;
      companyId?: string;
      accountId?: string;
      status?: string;
      direction?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      processingStatus?: string;
      page?: number;
      limit?: number;
    };
    output: any;
  };
  'email-deliveries:get': {
    input: { id: string; workspaceId?: string } | string;
    output: any;
  };
  'email-deliveries:events': {
    input: { id: string; workspaceId?: string } | string;
    output: any[];
  };
  'email-deliveries:reconcile': {
    input: { id: string; workspaceId?: string } | string;
    output: any;
  };
  'email-deliveries:poll-replies': {
    input?: { workspaceId?: string } | void;
    output: any;
  };
  'email-deliveries:manual-reconcile': {
    input: {
      deliveryId?: string;
      inboundDeliveryId?: string;
      contactId: string;
      campaignId?: string | null;
      matchedDeliveryId?: string | null;
      outboundDeliveryId?: string | null;
      notes?: string | null;
    };
    output: any;
  };
  'email-deliveries:reindex-inbound': {
    input: { workspaceId: string; limit?: number };
    output: { processed: number; matched: number };
  };
  'campaigns:schedule': {
    input: string;
    output: void;
  };
  'sequence:list': {
    input: void;
    output: any[];
  };
  'sequence:get': {
    input: string;
    output: any;
  };
  'sequence:create': {
    input: any;
    output: any;
  };
  'sequence:update': {
    input: { id: string; dto: any };
    output: any;
  };
  'sequence:delete': {
    input: string;
    output: any;
  };
  'sequence:start': {
    input: { sequenceId: string; contactId?: string | null; companyId?: string | null };
    output: any;
  };
  'sequence:stop': {
    input: string;
    output: any;
  };
  'execution:list': {
    input: void;
    output: any[];
  };
  'execution:get': {
    input: string;
    output: any;
  };
  'execution:logs': {
    input: string;
    output: any[];
  };
  'job:progress': {
    input: void;
    output: { jobId: string; progress: number; metadata?: any };
  };
  'job:completed': {
    input: void;
    output: { jobId: string; result: any };
  };
  'job:failed': {
    input: void;
    output: { jobId: string; error: string; willRetry?: boolean };
  };
  'job:starting': {
    input: void;
    output: { jobId: string; workerId: string };
  };
  'job:started': {
    input: void;
    output: { jobId: string; workerId: string };
  };
  'job:paused': {
    input: void;
    output: { jobId: string };
  };
  'job:cancelled': {
    input: void;
    output: { jobId: string };
  };
  'automation:queued': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      timestamp: string;
    };
  };
  'automation:started': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      workerPid: number;
      timestamp: string;
    };
  };
  'automation:resumed': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      workerPid: number;
      timestamp: string;
    };
  };
  'automation:paused': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      workerPid: number;
      timestamp: string;
    };
  };
  'automation:waiting': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      workerPid: number;
      timestamp: string;
    };
  };
  'automation:completed': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      workerPid: number;
      timestamp: string;
    };
  };
  'automation:cancelled': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      workerPid: number;
      timestamp: string;
    };
  };
  'automation:failed': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      workerPid: number;
      error?: string;
      timestamp: string;
    };
  };
  'automation:recovered': {
    input: void;
    output: {
      executionId: string;
      sequenceId: string;
      workspaceId: string;
      entityId: string;
      currentStep: number;
      timestamp: string;
    };
  };
  'ipc:test': {
    input: void;
    output: { status: string; timestamp: number };
  };
  'electron:version': {
    input: void;
    output: string;
  };
  'electron:platform': {
    input: void;
    output: string;
  };
  'electron:openUrl': {
    input: string;
    output: void;
  };
  'electron:notify': {
    input: { title: string; body: string };
    output: void;
  };
  'system:diagnostics': {
    input: { workspaceId: string };
    output: any;
  };
  'scheduler:jobs:pause': {
    input: { workspaceId: string; jobId: string };
    output: void;
  };
  'scheduler:jobs:resume': {
    input: { workspaceId: string; jobId: string };
    output: void;
  };
  'sync:completed': {
    input: void;
    output: { timestamp: string };
  };
  'system:log:event': {
    input: void;
    output: any;
  };
  'linkedin:get-cookie-status': {
    input: { workspaceId: string };
    output: { configured: boolean; preview: string };
  };
  'linkedin:save-cookie': {
    input: { workspaceId: string; cookie: string };
    output: { success: boolean };
  };
  'linkedin:validate': {
    input: { cookie?: string };
    output: { valid: boolean; message: string; csrfToken?: string };
  };
  'updater:get-status': {
    input: void;
    output: {
      status: string;
      progress: number;
      currentVersion: string;
      availableVersion: string;
      releaseNotes: string;
      channel: string;
    };
  };
  'updater:check': {
    input: void;
    output: {
      updateAvailable: boolean;
      version: string;
      releaseNotes?: string;
      downloadUrl?: string;
      checksum?: string;
    };
  };
  'updater:download': {
    input: void;
    output: void;
  };
  'updater:install': {
    input: void;
    output: void;
  };
  'intelligence:get': {
    input: { workspaceId: string; companyId: string };
    output: {
      companyIntelligence: any;
      websiteIntelligence: any;
      contactIntelligences: any[];
      opportunityScore: any;
      sources?: any[];
      evidence?: any[];
      claims?: any[];
      inferences?: any[];
    };
  };
  'intelligence:trigger': {
    input: { workspaceId: string; companyId: string };
    output: { success: boolean; jobId: string };
  };
  'onboarding:get-diagnostics': {
    input: void;
    output: {
      os: string;
      electronVersion: string;
      workspaceDir: string;
      writePermissions: boolean;
      sqliteAvailable: boolean;
      freeDiskSpaceGB: number;
      internetConnected: boolean;
      ollamaInstalled: boolean;
      ollamaModels: string[];
      workersReady: boolean;
    };
  };
  'onboarding:save-setting': {
    input: { workspaceId: string; key: string; value: string };
    output: { success: boolean };
  };
  'system-logs:query': {
    input: { workspaceId: string; query?: string; severity?: string; limit?: number };
    output: any[];
  };
  'audit-logs:list': {
    input: { workspaceId: string; limit?: number };
    output: any[];
  };
  'diagnostics:run': {
    input: { workspaceId: string };
    output: {
      smtp: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
      imap: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
      internet: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
      dns: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
      sqlite: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
      workers: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
      ai: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
      disk: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
      memory: { status: 'healthy' | 'warning' | 'error'; message: string; guidance?: string };
    };
  };
  'metrics:get': {
    input: { workspaceId: string };
    output: {
      discoveryDurationAvg: number;
      crawlerDurationAvg: number;
      enrichmentDurationAvg: number;
      workflowDurationAvg: number;
      workerUtilization: number;
      queueWaitTimeAvg: number;
      dbQueryTimeAvg: number;
    };
  };
  'errors:get': {
    input: { workspaceId: string };
    output: any[];
  };
  'recovery:execute': {
    input: { workspaceId: string; action: string; targetId?: string };
    output: { success: boolean; message: string };
  };
  'dev-mode:log': {
    input: { workspaceId?: string; limit?: number };
    output: any[];
  };
  'drive:connections:list': {
    input: void | { workspaceId?: string };
    output: any[];
  };
  'drive:files:list': {
    input: { connectionId: string; folderId?: string; search?: string; pageToken?: string; pageSize?: number };
    output: { files: any[]; nextPageToken?: string };
  };
  'drive:files:get': {
    input: { connectionId: string; fileId: string };
    output: any;
  };

  // ── Attachment & Media management ─────────────────────────────────────────
  'attachments:save': {
    input: { filePath?: string; filename?: string; contentBase64?: string; contentType?: string; googleConnectionId?: string };
    output: { id?: string; path?: string; filename: string; size: number; contentType?: string; mimeType?: string; provider?: string; fileId?: string; driveUrl?: string };
  };
  'media:list': {
    input: { search?: string; category?: string; page?: number; limit?: number } | void;
    output: any[];
  };
  'media:upload': {
    input: { filename: string; mimeType: string; contentBase64: string; googleConnectionId?: string; metadata?: Record<string, any> };
    output: any;
  };
  'media:delete': {
    input: { id: string };
    output: { success: boolean };
  };
  'media:link': {
    input: { googleConnectionId: string; fileId: string };
    output: any;
  };

  // ── System / Infrastructure ──────────────────────────────────────────────
  'system:infrastructure-status': {
    input: { workspaceId?: string };
    output: {
      api: { status: string; latencyMs?: number };
      database: { status: string };
      workers: { status: string; activeCount: number };
      scheduler: { status: string };
    };
  };

  // ── Operations Center ────────────────────────────────────────────────────
  'operations:health': {
    input: { workspaceId?: string };
    output: import('../dto/operations.js').OperationsHealthSummary;
  };
  'operations:list': {
    input: { workspaceId?: string } & import('../dto/operations.js').OperationsQueryDto;
    output: { items: import('../dto/operations.js').OperationRecord[]; total: number; page: number; isCached?: boolean };
  };
  'operations:get': {
    input: { workspaceId?: string; id: string };
    output: import('../dto/operations.js').OperationRecord | null;
  };
  'operations:events': {
    input: { workspaceId?: string; id: string };
    output: import('../dto/operations.js').OperationTimelineEvent[];
  };
  'operations:retry': {
    input: { workspaceId?: string; id: string; force?: boolean };
    output: { success: boolean; message: string; operation?: any };
  };
  'operations:reconcile': {
    input: { workspaceId?: string; id: string };
    output: { success: boolean; message: string; result?: any };
  };

  // ── Phase 11: Campaign Analytics & Performance Intelligence Channels ──
  'analytics:campaign:overview': {
    input: { workspaceId?: string; campaignId: string } & import('../dto/analytics.js').CampaignAnalyticsQuery;
    output: import('../dto/analytics.js').CampaignAnalyticsOverview;
  };
  'analytics:campaign:timeline': {
    input: { workspaceId?: string; campaignId: string } & import('../dto/analytics.js').CampaignAnalyticsQuery;
    output: { points: import('../dto/analytics.js').CampaignTimelinePoint[]; timezone: string };
  };
  'analytics:campaign:steps': {
    input: { workspaceId?: string; campaignId: string };
    output: { steps: import('../dto/analytics.js').SequenceStepAnalytics[] };
  };
  'analytics:campaign:mailboxes': {
    input: { workspaceId?: string; campaignId: string };
    output: { mailboxes: import('../dto/analytics.js').MailboxSenderAnalytics[] };
  };
  'analytics:campaign:quality': {
    input: { workspaceId?: string; campaignId: string };
    output: import('../dto/analytics.js').AudienceQualityBreakdown;
  };
  'analytics:campaign:compare': {
    input: { workspaceId?: string } & import('../dto/analytics.js').CampaignCompareQuery;
    output: import('../dto/analytics.js').CampaignComparisonResult;
  };
  'analytics:campaign:export': {
    input: { workspaceId?: string; campaignId: string; format?: 'json' | 'csv' } & import('../dto/analytics.js').CampaignAnalyticsQuery;
    output: import('../dto/analytics.js').CampaignAnalyticsExport;
  };

  // ── Push-event channels (main → renderer via ipc.on) ────────────────────
  'email-accounts:changed': {
    input: void;
    output: { timestamp?: string } | void;
  };
  'google-connections:changed': {
    input: void;
    output: { timestamp?: string } | void;
  };
  'workspace:boot-progress': {
    input: void;
    output: { stage: string; message: string; progress?: number };
  };
  'scheduler:tick': {
    input: void;
    output: { workspaceId: string; timestamp: string };
  };
  'agent:workflow:progress': {
    input: void;
    output: { executionId: string; step: number; status: string; message?: string };
  };

  // ── Native Electron & Settings ──────────────────────────────────────────
  'electron:ready-to-show': {
    input: void;
    output: void;
  };
  'settings:get-all': {
    input: void;
    output: any;
  };

  // ── Dashboard ────────────────────────────────────────────────────────────
  'dashboard:stats': {
    input: { workspaceId: string };
    output: any;
  };
  'dashboard:chart-data': {
    input: { workspaceId: string; range?: string };
    output: any;
  };
  'dashboard:activity-feed': {
    input: { workspaceId: string; limit?: number };
    output: any[];
  };

  // ── Google Drive & Storage ──────────────────────────────────────────────
  'drive:about': {
    input: { connectionId: string };
    output: any;
  };

  // ── AI Agent Workflows ───────────────────────────────────────────────────
  'agent:execute': {
    input: {
      workspaceId: string;
      query: string;
      traceId: string;
      actorId: string;
      aiConfig?: any;
    };
    output: any;
  };
  'agent:workflow:execute': {
    input: {
      workspaceId: string;
      workflowId: string;
      inputData?: any;
    };
    output: any;
  };

  // ── Suppressions ─────────────────────────────────────────────────────────
  'suppressions:list': {
    input: { workspaceId: string; type?: string; limit?: number };
    output: any;
  };
  'suppressions:check': {
    input: { workspaceId: string; email?: string; domain?: string; companyId?: string };
    output: any;
  };
  'suppressions:suppress': {
    input: { workspaceId: string; type: string; value: string; reason?: string };
    output: any;
  };
  'suppressions:unsuppress': {
    input: { workspaceId: string; id: string };
    output: any;
  };

  // ── Browser Engine (Playwright) ──────────────────────────────────────────
  'browser:status': {
    input: void;
    output: {
      isInstalled: boolean;
      isInstalling: boolean;
      browsersPath: string;
      executablePath?: string | undefined;
      headlessPath?: string | undefined;
      lastError?: string | undefined;
    };
  };
  'browser:install': {
    input: void;
    output: boolean;
  };
  'browser:install-progress': {
    input: void;
    output: string;
  };
}

export interface IpcRequest<T> {
  channel: string;
  payload: T;
}

export interface IpcResponse<T> {
  success: true;
  data: T;
}

export interface IpcError {
  success: false;
  error: {
    message: string;
    code?: string;
  };
}
