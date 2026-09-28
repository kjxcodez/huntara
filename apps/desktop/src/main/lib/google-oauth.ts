import { shell } from 'electron';
import { randomUUID } from 'crypto';
import http from 'http';
import { AppLogger } from './logger';
import { requireChrome } from './chrome-detect';

export interface GoogleOAuthResult {
  ok: boolean;
  reason?: 'cancelled' | 'error' | 'timeout' | 'no-token' | 'chrome-missing';
  error?: string;
  token?: string;
}

export interface GoogleOAuthOptions {
  apiUrl: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const LOOPBACK_HOST = '127.0.0.1';
/** Port the local callback server listens on for Google Login callbacks. */
const LOGIN_CALLBACK_PORT = 48113; // distinct from Gmail mailbox port (48112)

// ─── Active-flow guard ────────────────────────────────────────────────────────

let activeLoginFlow = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface InitiateResponse {
  url?: string;
  redirect?: boolean | string;
  authorizationUrl?: string;
  authorizeUrl?: string;
}

/**
 * Extracts the Google authorization URL from Better Auth's sign-in/social
 * response. Better Auth may return it as a Location header or in the JSON body.
 */
function extractAuthorizationUrl(
  headers: Headers,
  payload: InitiateResponse | null
): string | null {
  const locationHeader = headers.get('location') || headers.get('Location');
  if (locationHeader && /^https?:\/\//i.test(locationHeader)) {
    return locationHeader;
  }
  if (payload) {
    const candidate = payload.url || payload.authorizationUrl || payload.authorizeUrl;
    if (candidate && typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
    if (
      payload.redirect &&
      typeof payload.redirect === 'string' &&
      /^https?:\/\//i.test(payload.redirect)
    ) {
      return payload.redirect;
    }
  }
  return null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Performs a Google social sign-in via Better Auth using the user's installed
 * Google Chrome browser. No Electron BrowserWindow is used.
 *
 * Flow:
 *   1. Verify Chrome is installed (Windows registry + filesystem check).
 *   2. Start a tiny loopback HTTP server on 127.0.0.1:48113.
 *   3. Ask Better Auth to initiate the Google OAuth flow with
 *      callbackURL = http://127.0.0.1:48113/auth/callback.
 *   4. Open the returned Google authorization URL in Chrome.
 *   5. Google redirects → Better Auth → Better Auth redirects to our loopback.
 *   6. Loopback server reads `token` from query string.
 *   7. Return the session token to the IPC caller.
 *
 * This is intentionally separate from the Gmail mailbox OAuth flow
 * (gmail/oauth-flow.ts) which uses port 48112 and requests only gmail.send.
 */
export async function performGoogleOAuth(
  options: GoogleOAuthOptions
): Promise<GoogleOAuthResult> {
  const { apiUrl } = options;

  // ── 0. Chrome guard ──────────────────────────────────────────────────────
  try {
    requireChrome();
  } catch (err: any) {
    AppLogger.error('auth', 'Chrome not found for Google OAuth', undefined, err);
    return {
      ok: false,
      reason: 'chrome-missing',
      error: err.message
    };
  }

  // ── 1. Active-flow guard ─────────────────────────────────────────────────
  if (activeLoginFlow) {
    return {
      ok: false,
      reason: 'error',
      error: 'A Google sign-in is already in progress. Please complete or cancel it first.'
    };
  }
  activeLoginFlow = true;

  const apiOrigin = (() => {
    try {
      return new URL(apiUrl).origin;
    } catch {
      return apiUrl;
    }
  })();

  const port = LOGIN_CALLBACK_PORT;
  const callbackUrl = `http://${LOOPBACK_HOST}:${port}/auth/callback`;

  // ── 2. Start loopback server ─────────────────────────────────────────────
  let server: http.Server | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let settled = false;
  let resolvePromise!: (value: GoogleOAuthResult) => void;

  const promise = new Promise<GoogleOAuthResult>((res) => {
    resolvePromise = res;
  });

  const cleanup = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try {
      server?.close();
    } catch {
      /* already closed */
    }
    activeLoginFlow = false;
  };

  const settle = (result: GoogleOAuthResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    setImmediate(() => resolvePromise(result));
  };

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server = http.createServer((req, res) => {
        void handleCallback(req, res);
      });

      server.once('error', (err: NodeJS.ErrnoException) => {
        rejectListen(
          new Error(
            `Cannot listen on ${callbackUrl}: ${err.message}. ` +
              `Another application may be using port ${port}.`
          )
        );
      });

      server.listen(port, LOOPBACK_HOST, () => {
        resolveListen();
      });
    });
  } catch (err) {
    activeLoginFlow = false;
    AppLogger.error('auth', 'Failed to start Google login callback server', undefined, err as Error);
    return { ok: false, reason: 'error', error: (err as Error).message };
  }

  // ── 3. Build browser entry URL ───────────────────────────────────────────
  // Open Chrome directly to the API's GET /google/start entry point.
  // This allows Chrome to receive the `better-auth.state` Set-Cookie header from
  // Better Auth before following the 302 redirect to accounts.google.com,
  // guaranteeing state cookie persistence and preventing state_security_mismatch.
  const authorizationUrl = `${apiOrigin}/api/v1/auth/google/start?callbackURL=${encodeURIComponent(callbackUrl)}`;

  // ── 4. Open Chrome ───────────────────────────────────────────────────────
  AppLogger.info('auth', `Opening Google sign-in in Chrome: ${authorizationUrl}`);

  try {
    await shell.openExternal(authorizationUrl);
  } catch (err) {
    cleanup();
    activeLoginFlow = false;
    AppLogger.error('auth', 'Failed to open Chrome for Google sign-in', undefined, err as Error);
    return {
      ok: false,
      reason: 'error',
      error: 'Failed to open Google Chrome. Please ensure Chrome is installed and set as a capable browser.'
    };
  }

  // ── 5. Timeout guard ─────────────────────────────────────────────────────
  timeoutHandle = setTimeout(() => {
    AppLogger.warn('auth', 'Google login timed out after 5 minutes');
    settle({ ok: false, reason: 'timeout' });
  }, TIMEOUT_MS);

  // ── 6. Callback handler ──────────────────────────────────────────────────

  const handleCallback = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const url = new URL(req.url || '/', `http://${LOOPBACK_HOST}:${port}`);

    if (url.pathname !== '/auth/callback') {
      res.writeHead(404).end('Not found');
      return;
    }

    const errorParam = url.searchParams.get('error');
    const token = url.searchParams.get('token') || url.searchParams.get('session_token');

    if (errorParam) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(callbackPage('Sign-in failed', `Google returned: ${errorParam}`, false));
      AppLogger.warn('auth', `Google sign-in callback returned error: ${errorParam}`);
      settle({ ok: false, reason: 'error', error: `Google sign-in failed: ${errorParam}` });
      return;
    }

    if (!token) {
      // Better Auth may redirect without a token if the session is set via cookie.
      // In that case we must query the session endpoint separately.
      AppLogger.warn('auth', 'Google sign-in callback received without token param — session may be cookie-based');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(callbackPage('Completing sign-in…', 'Finishing authentication, you can close this tab.', true));
      settle({ ok: false, reason: 'no-token' });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(callbackPage('Signed in', 'You are signed in. Return to HUNTARA.', true));

    AppLogger.info('auth', 'Google sign-in callback received session token');
    settle({ ok: true, token });
  };

  return promise;
}

// ─── Page templates ───────────────────────────────────────────────────────────

function callbackPage(title: string, message: string, success: boolean): string {
  const icon = success ? '✅' : '⚠️';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} — HUNTARA</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0A0A0B;
      color: #F4F4F5;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 16px;
      text-align: center;
      padding: 32px;
    }
    .icon { font-size: 2.5rem; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #9ca3af; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
</body>
</html>`;
}
