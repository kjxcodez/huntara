import { BrowserWindow } from 'electron';
import type { SdkClient } from '@huntara/sdk';
import type {
  RuntimeConnectivityState,
  ConnectivityStatus,
  ConnectivityErrorCode
} from '@huntara/schema';
import { AppLogger } from '../lib/logger';
import { WorkspaceManager } from '../lib/workspace-manager';
import { loadConfig } from '../lib/config';

/**
 * ConnectivityService manages the runtime connectivity health gate, state machine,
 * and controlled recovery for the Electron Main process.
 */
class ConnectivityServiceClass {
  private state: RuntimeConnectivityState = {
    status: 'CHECKING',
    apiUrl: loadConfig().apiUrl,
    error: null,
    lastCheckedAt: new Date().toISOString(),
    activeWorkspaceId: null
  };

  private checkPromise: Promise<RuntimeConnectivityState> | null = null;

  public getState(): RuntimeConnectivityState {
    const activeRuntime = WorkspaceManager.getActiveRuntime();
    return {
      ...this.state,
      apiUrl: this.state.apiUrl || loadConfig().apiUrl,
      activeWorkspaceId: activeRuntime?.workspaceId || this.state.activeWorkspaceId
    };
  }

  public setState(patch: Partial<RuntimeConnectivityState>): RuntimeConnectivityState {
    const prevStatus = this.state.status;
    this.state = {
      ...this.state,
      ...patch,
      lastCheckedAt: patch.lastCheckedAt || new Date().toISOString()
    };

    if (prevStatus !== this.state.status) {
      AppLogger.info('connectivity', `runtime_state_changed: ${prevStatus} -> ${this.state.status}`, undefined, {
        prevStatus,
        newStatus: this.state.status,
        error: this.state.error
      });
    }

    this.broadcastState();
    return this.getState();
  }

  /**
   * Broadcasts the current connectivity state to all active renderer browser windows.
   */
  public broadcastState(): void {
    const state = this.getState();
    try {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('system:connectivity-changed', state);
        }
      });
    } catch {
      // In headless or test environments where BrowserWindow may not exist
    }
  }

  /**
   * Executes a bounded connectivity check against the configured API endpoint.
   */
  public async checkConnectivity(
    apiUrl?: string,
    timeoutMs: number = 3500
  ): Promise<RuntimeConnectivityState> {
    const targetUrl = apiUrl || this.state.apiUrl || loadConfig().apiUrl;
    if (this.checkPromise) {
      return this.checkPromise;
    }

    this.state.apiUrl = targetUrl;
    AppLogger.info('connectivity', 'api_connectivity_check_started', undefined, { apiUrl: targetUrl, timeoutMs });

    this.checkPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Clean base url and build health check path
      const normalizedBase = targetUrl.replace(/\/+$/, '');
      const healthUrl = normalizedBase.endsWith('/api/v1')
        ? `${normalizedBase}/health`
        : `${normalizedBase}/api/v1/health`;

      try {
        const res = await fetch(healthUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.status === 401 || res.status === 403) {
          AppLogger.warn('connectivity', 'api_connectivity_check_failed (401/403 unauthorized)', undefined, {
            status: res.status
          });
          return this.setState({
            status: 'AUTHENTICATION_REQUIRED',
            error: {
              code: (res.status === 401 ? 'HTTP_401' : 'HTTP_403') as ConnectivityErrorCode,
              message: 'Authentication required. Your session may have expired.',
              statusCode: res.status
            }
          });
        }

        if (res.status >= 500) {
          AppLogger.error('connectivity', `api_connectivity_check_failed (HTTP ${res.status})`, undefined);
          return this.setState({
            status: 'DEGRADED',
            error: {
              code: 'HTTP_5XX',
              message: `API server internal error (HTTP ${res.status})`,
              statusCode: res.status
            }
          });
        }

        if (!res.ok) {
          return this.setState({
            status: 'DEGRADED',
            error: {
              code: 'UNKNOWN',
              message: `API server returned unexpected HTTP status: ${res.status}`,
              statusCode: res.status
            }
          });
        }

        const body: any = await res.json().catch(() => ({}));
        const data = body?.data || body;

        if (data?.status === 'DEGRADED' || data?.database?.status === 'disconnected') {
          AppLogger.warn('connectivity', 'api_connectivity_check_succeeded (Database Degraded)', undefined);
          return this.setState({
            status: 'DEGRADED',
            error: {
              code: 'HTTP_5XX',
              message: 'API server is running but database is disconnected or degraded',
              statusCode: 503
            }
          });
        }

        AppLogger.info('connectivity', 'api_connectivity_check_succeeded', undefined, {
          version: data?.version || '1.0.0',
          uptime: data?.uptime
        });

        return this.setState({
          status: 'ONLINE',
          error: null
        });
      } catch (err: any) {
        clearTimeout(timer);
        let code: ConnectivityErrorCode = 'UNKNOWN';
        let message = err.message || 'Unknown network failure';

        if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
          code = 'TIMEOUT';
          message = `API connectivity check timed out after ${timeoutMs}ms`;
        } else if (
          err.code === 'ECONNREFUSED' ||
          err.code === 'ENOTFOUND' ||
          err.code === 'EAI_AGAIN' ||
          message.includes('fetch failed') ||
          message.includes('ECONNREFUSED') ||
          message.includes('connect ECONNREFUSED')
        ) {
          code = 'NETWORK_UNREACHABLE';
          message = `API server is unreachable at ${targetUrl}. Verify server process is running.`;
        }

        AppLogger.warn('connectivity', 'api_connectivity_check_failed', undefined, {
          code,
          message
        });

        return this.setState({
          status: 'DEGRADED',
          error: { code, message }
        });
      }
    })();

    try {
      return await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  /**
   * Recovers runtime connectivity when the API becomes available after an outage.
   * Serialized and safe against duplicate runtimes.
   */
  public async recoverConnection(
    sdk: SdkClient,
    targetWorkspaceId: string | null
  ): Promise<RuntimeConnectivityState> {
    AppLogger.info('connectivity', 'runtime_recovery_started', targetWorkspaceId || undefined);
    const result = await this.checkConnectivity(this.state.apiUrl);

    if (result.status === 'ONLINE' && targetWorkspaceId) {
      const activeRuntime = WorkspaceManager.getActiveRuntime();
      if (!activeRuntime || activeRuntime.workspaceId !== targetWorkspaceId) {
        try {
          AppLogger.info(
            'connectivity',
            `Activating workspace runtime on connection recovery: ${targetWorkspaceId}`,
            targetWorkspaceId
          );
          await WorkspaceManager.setActiveWorkspace(targetWorkspaceId);
        } catch (err: any) {
          AppLogger.error(
            'connectivity',
            `Failed to start workspace runtime on recovery: ${err.message}`,
            targetWorkspaceId,
            err
          );
        }
      }
    }

    AppLogger.info('connectivity', 'runtime_recovery_completed', targetWorkspaceId || undefined, {
      status: result.status
    });
    return this.getState();
  }
}

export const ConnectivityService = new ConnectivityServiceClass();
