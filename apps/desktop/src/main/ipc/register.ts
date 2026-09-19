import { SdkClient } from '@huntara/sdk';
import { registerAuthIpc } from './auth';
import { registerWorkspaceIpc } from './workspace';
import { registerCrmIpc } from './crm';
import { registerElectronIpc } from './electron';
import { registerDatabaseIpc } from './database';
import { registerOutreachIpc } from './outreach';
import { registerAutomationIpc } from './automation';
import { registerSchedulerIpc } from './scheduler';
import { registerDashboardIpc } from './dashboard';
import { registerLinkedInIpc } from './linkedin';
import { registerCampaignsIpc } from './campaigns-ipc';
import { registerOnboardingIpc } from './onboarding-ipc';
import { registerObservabilityIpc } from './observability-ipc';
import { registerAgentIPCHandlers } from './agent-ipc';
import { registerDiscoveryIpc } from './discovery-ipc';
import { registerAudiencesIpc } from './audiences-ipc';
import { registerDriveIpc } from './drive-ipc';
import { registerSuppressionsIpc } from './suppressions-ipc';
import { registerAnalyticsIpc } from './analytics-ipc';
import { registerPlaywrightIpc } from '../lib/playwright-setup';
import { WorkspaceManager } from '../lib/workspace-manager';
import { AppLogger } from '../lib/logger';

/**
 * Orchestrates and registers all IPC channels exactly once, utilizing safeRegister
 * to prevent duplicate handler collisions during hot reload HMR.
 */
export function registerAllIpc(
  sdk: SdkClient,
  customHeaders: Record<string, string>,
  setToken: (token: string | null) => void,
  persistActiveWorkspace: (workspaceId: string | null) => void,
  getPersistedActiveWorkspace: () => string | null
) {
  // Bind SDK instance to WorkspaceManager for isolated sync runtimes
  WorkspaceManager.setSdk(sdk);

  // Subscribe to AppLogger to asynchronously push workspace logs to cloud MongoDB
  AppLogger.subscribe((record) => {
    if (record.workspaceId && record.workspaceId !== 'global') {
      try {
        const sdkInstance = WorkspaceManager.getSdk();
        if (sdkInstance && typeof sdkInstance.systemLogs?.append === 'function') {
          sdkInstance.systemLogs
            .append({
              severity: record.severity,
              task: record.task,
              message: record.message,
              durationMs: record.durationMs || undefined,
              metadata: record.metadata || undefined
            })
            .catch(() => {});
        }
      } catch {}
    }
  });

  const setWorkspaceHeader = (workspaceId: string | null) => {
    if (workspaceId) {
      customHeaders['x-workspace-id'] = workspaceId;
    } else {
      delete customHeaders['x-workspace-id'];
    }
  };

  // Register domain specific handlers
  registerDatabaseIpc();
  registerAuthIpc(
    sdk,
    setToken,
    setWorkspaceHeader,
    persistActiveWorkspace,
    getPersistedActiveWorkspace
  );
  registerWorkspaceIpc(
    sdk,
    setWorkspaceHeader,
    persistActiveWorkspace,
    getPersistedActiveWorkspace
  );
  registerCrmIpc();
  registerElectronIpc(setWorkspaceHeader, persistActiveWorkspace, getPersistedActiveWorkspace);
  registerOutreachIpc(sdk);
  registerAutomationIpc(sdk);
  registerSchedulerIpc();
  registerDashboardIpc();
  registerLinkedInIpc();
  registerCampaignsIpc();
  registerOnboardingIpc();
  registerObservabilityIpc();
  registerAgentIPCHandlers();
  registerDiscoveryIpc();
  registerAudiencesIpc();
  registerDriveIpc();
  registerSuppressionsIpc();
  registerAnalyticsIpc();
  registerPlaywrightIpc();
}
