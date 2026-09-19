import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannelMap } from '@huntara/schema';

contextBridge.exposeInMainWorld('ipc', {
  test: (): Promise<{ status: string; timestamp: number }> => {
    return ipcRenderer.invoke('ipc:test');
  },

  getInitialSettings: (): any => {
    return ipcRenderer.sendSync('settings:getSync');
  },

  setSettings: (settings: any): void => {
    ipcRenderer.send('settings:set', settings);
  },

  invoke: <K extends keyof IpcChannelMap>(
    channel: K,
    payload: IpcChannelMap[K]['input']
  ): Promise<IpcChannelMap[K]['output']> => {
    const validChannels: Array<string> = [
      'ipc:test',
      'companies:list',
      'companies:get',
      'companies:create',
      'companies:update',
      'companies:delete',
      'companies:query',
      'companies:distinct-values',
      'companies:bulk:create',
      'contacts:list',
      'contacts:get',
      'contacts:create',
      'contacts:update',
      'contacts:delete',
      'contacts:query',
      'contacts:query:resolve',
      'contacts:distinct-values',
      'contacts:bulk:create',
      'contacts:bulk:delete',
      'contacts:bulk:update-status',
      'campaigns:list',
      'campaigns:get',
      'campaigns:create',
      'campaigns:update',
      'campaigns:delete',
      'campaigns:schedule',
      'campaigns:enroll',
      'campaigns:enrollments:list',
      'campaigns:bulk-pause-enrollments',
      'campaigns:bulk-resume-enrollments',
      'campaigns:bulk-remove-enrollments',
      'campaigns:pause',
      'campaigns:resume',
      'campaigns:stop',
      'campaigns:runtime:overview',
      'activities:list',
      'system:status',
      'system:connectivity-status',
      'system:connectivity-check',
      'system:diagnostics',
      'system:infrastructure-status',
      'system-logs:query',
      'audit-logs:list',
      'metrics:get',
      'errors:get',
      'recovery:execute',
      'dev-mode:log',
      'diagnostics:run',
      'diagnostics:get-system-info',
      'diagnostics:export-support-bundle',
      'auth:login',
      'auth:register',
      'auth:logout',
      'auth:session',
      'auth:forgot-password',
      'auth:resend-verification',
      'auth:google:login',
      'auth:google:check-chrome',
      'workspaces:create',
      'workspaces:list',
      'workspaces:update',
      'workspaces:delete',
      'workspaces:get',
      'workspaces:members:list',
      'workspaces:members:invite',
      'workspaces:members:updateRole',
      'workspaces:members:remove',
      'workspaces:members:leave',
      'workspaces:members:transferOwnership',
      'workspaces:invites:list',
      'workspaces:invites:accept',
      'workspaces:invites:decline',
      'electron:setActiveWorkspace',
      'electron:getActiveWorkspace',
      'electron:version',
      'electron:platform',
      'electron:openUrl',
      'electron:notify',
      'electron:ready-to-show',
      'db:find',
      'db:findById',
      'db:save',
      'db:saveMany',
      'db:softDelete',
      'db:delete',
      'db:workspaces:findMany',
      'db:workspaces:saveMany',
      'scheduler:jobs:list',
      'scheduler:jobs:submit',
      'scheduler:jobs:cancel',
      'scheduler:jobs:pause',
      'scheduler:jobs:resume',
      'scheduler:queue:list',
      'scheduler:dead-letters:list',
      'scheduler:dead-letters:requeue',
      'scheduler:workers:health',
      'projection:rebuild',
      'sync:reconcile',
      'discovery:run:create',
      'discovery:run:list',
      'discovery:run:get',
      'discovery:run:companies',
      'discovery:run:delete',
      'email-accounts:list',
      'email-accounts:delete',
      'email-accounts:gmail:connect',
      'email-accounts:gmail:status',
      'email-accounts:gmail:disconnect',
      'email-accounts:gmail:reconnect',
      'email-accounts:sync-signature',
      'email-accounts:reset-health',
      'email-accounts:send-test',
      'email-accounts:test-recipients',
      'attachments:save',
      'templates:list',
      'templates:create',
      'templates:update',
      'templates:delete',
      'templates:preview',
      'email-deliveries:list',
      'email-deliveries:get',
      'email-deliveries:events',
      'email-deliveries:reconcile',
      'email-deliveries:poll-replies',
      'email-deliveries:reindex-inbound',
      'email-deliveries:manual-reconcile',
      'operations:health',
      'operations:list',
      'operations:get',
      'operations:events',
      'operations:retry',
      'operations:reconcile',
      'sequence:list',
      'sequence:get',
      'sequence:create',
      'sequence:update',
      'sequence:delete',
      'sequence:start',
      'sequence:stop',
      'execution:list',
      'execution:get',
      'execution:logs',
      'dashboard:stats',
      'dashboard:chart-data',
      'dashboard:activity-feed',
      'linkedin:get-cookie-status',
      'linkedin:save-cookie',
      'linkedin:validate',
      'intelligence:get',
      'intelligence:trigger',
      'onboarding:get-diagnostics',
      'onboarding:save-setting',
      'settings:get-all',
      'drive:connections:list',
      'drive:connect',
      'drive:status',
      'drive:disconnect',
      'drive:reconnect',
      'drive:files:list',
      'drive:files:get',
      'drive:about',
      'media:list',
      'media:upload',
      'media:delete',
      'media:link',
      'updater:get-status',
      'updater:check',
      'updater:download',
      'updater:install',
      'agent:execute',
      'agent:workflow:execute',
      'audiences:list',
      'audiences:create',
      'audiences:get',
      'audiences:update',
      'audiences:delete',
      'audiences:resolve',
      'suppressions:list',
      'suppressions:check',
      'suppressions:suppress',
      'suppressions:unsuppress',
      'analytics:campaign:overview',
      'analytics:campaign:timeline',
      'analytics:campaign:steps',
      'analytics:campaign:mailboxes',
      'analytics:campaign:quality',
      'analytics:campaign:compare',
      'analytics:campaign:export',
      'browser:status',
      'browser:install'
    ];
    if (validChannels.includes(channel as string)) {
      return ipcRenderer.invoke(channel, payload);
    }
    throw new Error(`Unauthorized IPC channel: ${channel}`);
  },

  on: <K extends keyof IpcChannelMap>(
    channel: K,
    callback: (payload: IpcChannelMap[K]['output']) => void
  ) => {
    const validChannels: Array<string> = [
      'system:connectivity-changed',
      'auth:unauthorized',
      'sync:completed',
      'system:log:event',
      'job:progress',
      'job:completed',
      'job:failed',
      'job:starting',
      'job:started',
      'job:paused',
      'job:cancelled',
      'automation:queued',
      'automation:started',
      'automation:resumed',
      'automation:paused',
      'automation:waiting',
      'automation:completed',
      'automation:cancelled',
      'automation:failed',
      'automation:recovered',
      'workspace:boot-progress',
      'updater:status-changed',
      'agent:workflow:progress',
      'email-accounts:changed',
      'google-connections:changed',
      'browser:install-progress'
    ];
    if (validChannels.includes(channel as string)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
        callback(args[0] as any);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
    throw new Error(`Unauthorized IPC channel: ${channel}`);
  }
});

export interface IpcApi {
  test(): Promise<{ status: string; timestamp: number }>;
  getInitialSettings(): any;
  setSettings(settings: any): void;
  invoke<K extends keyof IpcChannelMap>(
    channel: K,
    payload: IpcChannelMap[K]['input']
  ): Promise<IpcChannelMap[K]['output']>;
  on<K extends keyof IpcChannelMap>(
    channel: K,
    callback: (payload: IpcChannelMap[K]['output']) => void
  ): () => void;
}

declare global {
  interface Window {
    ipc: IpcApi;
  }
}
