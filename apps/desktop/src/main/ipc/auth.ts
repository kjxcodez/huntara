import { safeRegister } from './helper';
import { SdkClient } from '@huntara/sdk';
import { saveSession, loadSession, clearSession } from '../lib/session';
import { performGoogleOAuth } from '../lib/google-oauth';
import { detectChrome } from '../lib/chrome-detect';
import { AppLogger } from '../lib/logger';
import { ConnectivityService } from '../services/connectivity-service';

/**
 * Registers authentication and API test IPC channels.
 */
export function registerAuthIpc(
  sdk: SdkClient,
  setToken: (token: string | null) => void,
  setWorkspaceHeader: (workspaceId: string | null) => void,
  persistActiveWorkspace: (workspaceId: string | null) => void,
  getPersistedActiveWorkspace: () => string | null
) {
  safeRegister('auth:login', async (_event, payload) => {
    console.log('Main Process: Logging in user:', payload.email);
    const res = await sdk.auth.login(payload);
    setToken(res.token);

    const savedWorkspaceId = getPersistedActiveWorkspace();
    const workspaceId = savedWorkspaceId || res.user?.activeWorkspaceId;
    if (workspaceId) {
      setWorkspaceHeader(workspaceId);
    }

    try {
      saveSession({
        accessToken: res.token,
        userId: res.user?.id,
        activeWorkspaceId: workspaceId || null,
        user: res.user,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
    } catch (err) {
      AppLogger.error('auth', 'Failed to save session on login', undefined, err);
    }

    return res;
  });

  safeRegister('auth:register', async (_event, payload) => {
    console.log('Main Process: Registering user:', payload.email);
    const res = await sdk.auth.register(payload);
    setToken(res.token);

    const savedWorkspaceId = getPersistedActiveWorkspace();
    const workspaceId = savedWorkspaceId || res.user?.activeWorkspaceId;
    if (workspaceId) {
      setWorkspaceHeader(workspaceId);
    }

    try {
      saveSession({
        accessToken: res.token,
        userId: res.user?.id,
        activeWorkspaceId: workspaceId || null,
        user: res.user,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
    } catch (err) {
      AppLogger.error('auth', 'Failed to save session on register', undefined, err);
    }

    return res;
  });

  safeRegister('auth:logout', async () => {
    console.log('Main Process: Logging out user');
    try {
      await sdk.auth.logout();
    } catch (err) {
      console.warn('Backend session logout failed, clearing local headers anyway:', err);
    }
    setToken(null);
    setWorkspaceHeader(null);
    clearSession();
    persistActiveWorkspace(null);
    AppLogger.info('auth', 'Logout completed');
  });

  safeRegister('auth:session', async () => {
    try {
      AppLogger.info('auth', 'Session validation');
      const res = await sdk.auth.session();
      if (res && res.token && res.user) {
        // Online and session is valid! Save/update the session.dat.
        const savedWorkspaceId = getPersistedActiveWorkspace();
        const workspaceId = savedWorkspaceId || res.user.activeWorkspaceId;
        if (workspaceId) {
          setWorkspaceHeader(workspaceId);
        }
        setToken(res.token);

        saveSession({
          accessToken: res.token,
          userId: res.user.id,
          activeWorkspaceId: workspaceId || null,
          user: res.user,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
        AppLogger.info('auth', 'Session restored');
        return res;
      } else {
        // Online but session is invalid (e.g. null returned)
        AppLogger.warn('auth', 'Session validation returned empty/invalid');
        clearSession();
        setToken(null);
        setWorkspaceHeader(null);
        return null;
      }
    } catch (err: any) {
      const isServerError = err.status >= 500 || err.code === 'INTERNAL_SERVER_ERROR';
      const isNetworkError =
        err.code === 'NETWORK_ERROR' ||
        err.message?.includes('fetch') ||
        err.message?.includes('network') ||
        err.status === null;

      if (isNetworkError || isServerError) {
        AppLogger.info('auth', `Server/Network error (${err.status || err.code}), attempting local session restore`);
        const session = loadSession();
        if (session && session.user) {
          if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
            AppLogger.warn('auth', 'Local session expired during server outage');
            clearSession();
            setToken(null);
            setWorkspaceHeader(null);
            return null;
          }
          setToken(session.accessToken);
          if (session.activeWorkspaceId) {
            setWorkspaceHeader(session.activeWorkspaceId);
          }
          return {
            token: session.accessToken,
            user: session.user
          };
        }
      }

      // Explicit authentication failure (401 / 403) or missing session
      AppLogger.error('auth', 'Session validation failed with authentication error', undefined, err);
      clearSession();
      setToken(null);
      setWorkspaceHeader(null);
      return null;
    }
  });

  safeRegister('auth:forgot-password', async (_event, payload) => {
    AppLogger.info('auth', `Requesting forgot-password for: ${payload.email}`);
    await sdk.auth.forgotPassword(payload);
    return { success: true };
  });

  safeRegister('auth:resend-verification', async (_event, payload) => {
    AppLogger.info('auth', `Requesting resend-verification for: ${payload.email}`);
    await sdk.auth.resendVerification(payload);
    return { success: true };
  });

  safeRegister('system:connectivity-status', async () => {
    return ConnectivityService.getState();
  });

  safeRegister('system:connectivity-check', async () => {
    const savedWorkspaceId = getPersistedActiveWorkspace();
    return ConnectivityService.recoverConnection(sdk, savedWorkspaceId);
  });

  safeRegister('system:status', async () => {
    const connState = ConnectivityService.getState();
    const isOnline = connState.status === 'ONLINE';
    return [
      { name: 'API Server', status: isOnline ? 'online' : 'offline' },
      { name: 'Database', status: isOnline ? 'connected' : 'disconnected' }
    ];
  });

  safeRegister('ipc:test', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  safeRegister('auth:google:login', async () => {
    const apiBaseUrl = (sdk as any).httpClient?.config?.baseUrl as string | undefined;
    if (!apiBaseUrl) {
      throw new Error('API URL not configured');
    }

    AppLogger.info('auth', 'Starting Google OAuth flow via external Chrome');
    const result = await performGoogleOAuth({ apiUrl: apiBaseUrl });

    if (!result.ok || !result.token) {
      const message =
        result.reason === 'chrome-missing'
          ? result.error || 'Google Chrome is required for sign-in but was not found on this computer.'
          : result.reason === 'cancelled'
            ? 'Google sign-in was cancelled.'
            : result.reason === 'timeout'
              ? 'Google sign-in timed out. Please try again.'
              : result.reason === 'no-token'
                ? 'Google sign-in completed but no session was established. Please try again.'
                : result.error || 'Google sign-in failed.';
      throw new Error(message);
    }

    const sessionToken = result.token;

    setToken(sessionToken);

    let sessionResult: { token: string; user: any } | null = null;
    try {
      sessionResult = (await sdk.auth.session()) as any;
    } catch (err) {
      AppLogger.warn('auth', 'Failed to fetch session details after Google login', undefined, err as Error);
    }

    if (!sessionResult || !sessionResult.user) {
      const fallbackUser = {
        id: '',
        email: '',
        name: '',
        displayName: '',
        role: 'MEMBER',
        activeWorkspaceId: null,
        emailVerified: true,
        status: 'active'
      };
      const payload = {
        token: sessionToken,
        user: fallbackUser
      };

      try {
        saveSession({
          accessToken: sessionToken,
          userId: fallbackUser.id,
          activeWorkspaceId: null,
          user: fallbackUser,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
      } catch (err) {
        AppLogger.error('auth', 'Failed to save fallback session after Google login', undefined, err);
      }

      return payload;
    }

    AppLogger.info('auth', 'Google OAuth succeeded, restoring workspaces');

    const savedWorkspaceId = getPersistedActiveWorkspace();
    const workspaceId = savedWorkspaceId || sessionResult.user?.activeWorkspaceId;
    if (workspaceId) {
      setWorkspaceHeader(workspaceId);
    }

    try {
      saveSession({
        accessToken: sessionResult.token,
        userId: sessionResult.user.id,
        activeWorkspaceId: workspaceId || null,
        user: sessionResult.user,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
    } catch (err) {
      AppLogger.error('auth', 'Failed to save session after Google login', undefined, err);
    }

    return sessionResult;
  });

  // Runtime health check — used by the renderer to show actionable diagnostics
  safeRegister('auth:google:check-chrome', async () => {
    const result = detectChrome();
    return {
      chromeAvailable: result.found,
      chromePath: result.path,
      error: result.error
    };
  });
}
