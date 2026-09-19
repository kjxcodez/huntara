import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { loginDtoSchema, registerDtoSchema, forgotPasswordDtoSchema } from '@leadforge/schema';
import { auth } from '../../config/auth.js';
import { ErrorResponseSchema } from '../../openapi/index.js';
import { successResponse } from '../../utils/index.js';
import { ApiError } from '../../errors/index.js';

const router = new OpenAPIHono();

// Helper to forward custom routes to Better Auth handlers
async function handleBetterAuthRequest(c: any, targetPath: string) {
  const url = new URL(c.req.url);
  url.pathname = `/api/v1/auth${targetPath}`;

  const headers = new Headers(c.req.raw.headers);
  const body = c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.blob() : undefined;

  const modifiedRequest = new Request(url.toString(), {
    method: c.req.method,
    headers,
    body,
    duplex: 'half'
  } as any);

  return auth.handler(modifiedRequest);
}

// 1. POST /login
const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  summary: 'User Login',
  description: 'Authenticates credentials and establishes session cookie.',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginDtoSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Successfully logged in'
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Invalid input parameters'
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Unauthorized credentials'
    }
  }
});

router.openapi(loginRoute, async (c) => {
  try {
    const body = await c.req.json();
    const res = await auth.api.signInEmail({
      body: {
        email: body.email,
        password: body.password
      },
      headers: c.req.raw.headers
    });
    return c.json(
      successResponse({
        token: res.token,
        user: res.user
      })
    );
  } catch (err: any) {
    console.error('[DEBUG] Hono Auth sign-in caught error:', err);
    const msg = err.message || 'Invalid credentials.';
    const status = err.status || 401;
    throw new ApiError(status, status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST', msg);
  }
});

// 2. POST /signup
const signupRoute = createRoute({
  method: 'post',
  path: '/signup',
  summary: 'User Registration',
  description: 'Registers a new user and establishes a session.',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerDtoSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Successfully registered and logged in'
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Invalid parameters or user already exists'
    }
  }
});

router.openapi(signupRoute, async (c) => {
  try {
    const body = await c.req.json();
    const res = await auth.api.signUpEmail({
      body: {
        email: body.email,
        password: body.password,
        name: body.name
      },
      headers: c.req.raw.headers
    });
    return c.json(
      successResponse({
        token: res.token,
        user: res.user
      })
    );
  } catch (err: any) {
    console.error('[DEBUG] Hono Auth sign-up caught error:', err);
    const msg = err.message || 'Registration failed.';
    const status = err.status || 400;
    throw new ApiError(status, status === 409 ? 'CONFLICT' : 'BAD_REQUEST', msg);
  }
});

// 3. POST /logout
const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  summary: 'User Logout',
  description: 'Terminates the active session and clears the session cookie.',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Successfully logged out'
    }
  }
});

router.openapi(logoutRoute, async (c) => {
  try {
    await auth.api.signOut({
      headers: c.req.raw.headers
    });
    return c.json(successResponse({ success: true }));
  } catch (err: any) {
    console.error('[DEBUG] Hono Auth sign-out caught error:', err);
    return c.json(successResponse({ success: true }));
  }
});

// 4. GET /session
const sessionRoute = createRoute({
  method: 'get',
  path: '/session',
  summary: 'Get Current Session',
  description: 'Retrieves current authenticated session and user details.',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Active session details retrieved successfully'
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Not authenticated'
    }
  }
});

router.openapi(sessionRoute, async (c) => {
  try {
    const res = await auth.api.getSession({
      headers: c.req.raw.headers
    });
    if (!res || !res.session) {
      return c.json(successResponse(null));
    }
    return c.json(
      successResponse({
        token: res.session.token,
        user: res.user
      })
    );
  } catch (err: any) {
    console.error('[DEBUG] Hono Auth session caught error:', err);
    return c.json(successResponse(null));
  }
});

// 5. POST /forgot-password
const forgotPasswordRoute = createRoute({
  method: 'post',
  path: '/forgot-password',
  summary: 'Request Password Reset',
  description: 'Sends a password reset link to the specified email address.',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: forgotPasswordDtoSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Reset email sent successfully'
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Invalid input parameters or user not found'
    }
  }
});

router.openapi(forgotPasswordRoute, async (c) => {
  try {
    const body = await c.req.json();
    await auth.api.requestPasswordReset({
      body: {
        email: body.email,
        redirectTo: `${process.env.BETTER_AUTH_URL}/api/v1/auth/reset-password-form`
      },
      headers: c.req.raw.headers
    });
    return c.json(successResponse({ success: true }));
  } catch (err: any) {
    console.error('[DEBUG] Hono Auth forgot-password caught error:', err);
    throw new ApiError(err.status || 400, 'BAD_REQUEST', err.message || 'Failed to send reset link.');
  }
});

// 6. POST /resend-verification
const resendVerificationRoute = createRoute({
  method: 'post',
  path: '/resend-verification',
  summary: 'Resend Verification Email',
  description: 'Resends the email verification link to the specified email.',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: forgotPasswordDtoSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Verification email sent successfully'
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Invalid parameters or verification not enabled'
    }
  }
});

router.openapi(resendVerificationRoute, async (c) => {
  try {
    const body = await c.req.json();
    await auth.api.sendVerificationEmail({
      body: {
        email: body.email
      },
      headers: c.req.raw.headers
    });
    return c.json(successResponse({ success: true }));
  } catch (err: any) {
    console.error('[DEBUG] Hono Auth resend-verification caught error:', err);
    throw new ApiError(err.status || 400, 'BAD_REQUEST', err.message || 'Failed to send verification link.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared HTML page shell — all hosted pages use this for consistency.
// Uses exact DESIGN.md tokens.
// ─────────────────────────────────────────────────────────────────────────────
function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — HUNTARA</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-base:      #0A0A0B;
      --bg-surface-1: #131316;
      --bg-surface-2: #1B1B1F;
      --border-subtle: #232327;
      --border-default: #2E2E33;
      --accent:       #FA7125;
      --accent-hover: #FB8846;
      --text-primary: #F4F4F5;
      --text-secondary: #A3A3AB;
      --text-tertiary: #6E6E76;
      --text-on-accent: #0A0A0B;
      --success:      #3FB27F;
      --danger:       #E24C4B;
      --font: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      --mono: 'JetBrains Mono', 'Menlo', monospace;
    }
    html { -webkit-text-size-adjust: 100%; }
    body {
      font-family: var(--font);
      background-color: var(--bg-base);
      color: var(--text-secondary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
    }

    /* Wordmark */
    .wordmark {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      margin-bottom: 32px;
      user-select: none;
    }
    .wordmark em {
      font-style: normal;
      color: var(--accent);
    }

    /* Card */
    .card {
      width: 100%;
      max-width: 420px;
      background-color: var(--bg-surface-1);
      border: 1px solid var(--border-default);
      border-radius: 0px;
      padding: 40px;
    }

    /* Typography */
    h1 {
      font-size: 20px;
      font-weight: 600;
      line-height: 28px;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 14px;
      line-height: 22px;
      color: var(--text-secondary);
      margin-bottom: 32px;
    }

    /* Form elements */
    .field { margin-bottom: 20px; }
    label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      margin-bottom: 6px;
    }
    input[type="password"] {
      width: 100%;
      height: 40px;
      padding: 0 14px;
      background-color: var(--bg-base);
      border: 1px solid var(--border-default);
      border-radius: 0px;
      color: var(--text-primary);
      font-family: var(--font);
      font-size: 14px;
      outline: none;
      transition: border-color 120ms ease;
      -webkit-appearance: none;
    }
    input[type="password"]:focus { border-color: var(--accent); }
    input[type="password"]::placeholder { color: var(--text-tertiary); }

    /* Primary button */
    .btn {
      display: block;
      width: 100%;
      height: 44px;
      padding: 0 16px;
      background-color: var(--accent);
      color: var(--text-on-accent);
      border: none;
      border-radius: 0px;
      font-family: var(--font);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: -0.01em;
      transition: background-color 120ms ease;
      margin-top: 8px;
    }
    .btn:hover { background-color: var(--accent-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Error message */
    .error-msg {
      display: none;
      font-size: 12px;
      color: var(--danger);
      margin-top: 10px;
      line-height: 18px;
    }

    /* Divider */
    .divider {
      height: 1px;
      background-color: var(--border-subtle);
      margin: 28px 0;
    }

    /* Icon box */
    .icon-box {
      width: 48px;
      height: 48px;
      border-radius: 0px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px auto;
      font-size: 20px;
      font-weight: 600;
    }
    .icon-box.success {
      background-color: rgba(63, 178, 127, 0.12);
      border: 1px solid rgba(63, 178, 127, 0.25);
      color: var(--success);
    }
    .icon-box.danger {
      background-color: rgba(226, 76, 75, 0.12);
      border: 1px solid rgba(226, 76, 75, 0.25);
      color: var(--danger);
    }

    /* Caption */
    .caption {
      font-size: 12px;
      line-height: 18px;
      color: var(--text-tertiary);
    }
    .mono {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--text-tertiary);
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="wordmark">HUNT<em>ARA</em></div>
  <div class="card">
    ${body}
  </div>
</body>
</html>`;
}

// GET /reset-password-form — serves the reset password HTML form
router.get('/reset-password-form', (c) => {
  const token = c.req.query('token') || '';

  if (!token) {
    return c.html(pageShell('Invalid Link', `
      <div class="icon-box danger">✕</div>
      <h1 style="text-align:center;">Invalid link</h1>
      <p class="subtitle" style="text-align:center;">
        This password reset link is invalid or has expired.
        Request a new one from the desktop app.
      </p>
    `), 400);
  }

  return c.html(pageShell('Reset Password', `
    <h1>Reset password</h1>
    <p class="subtitle">Enter a new password below. Minimum 8 characters.</p>

    <form action="/api/v1/auth/reset-password-submit" method="POST"
          onsubmit="return validate()" autocomplete="off">
      <input type="hidden" name="token" value="${token}" />

      <div class="field">
        <label for="newPassword">New password</label>
        <input type="password" id="newPassword" name="newPassword"
               required minlength="8" autofocus placeholder="At least 8 characters" />
      </div>
      <div class="field">
        <label for="confirmPassword">Confirm new password</label>
        <input type="password" id="confirmPassword" required minlength="8"
               placeholder="Repeat your password" />
      </div>

      <p id="errMsg" class="error-msg">Passwords do not match.</p>
      <button type="submit" class="btn" id="submitBtn">Update password</button>
    </form>

    <script>
      function validate() {
        var p = document.getElementById('newPassword').value;
        var c = document.getElementById('confirmPassword').value;
        var e = document.getElementById('errMsg');
        if (p !== c) { e.style.display = 'block'; return false; }
        e.style.display = 'none';
        document.getElementById('submitBtn').disabled = true;
        document.getElementById('submitBtn').textContent = 'Updating…';
        return true;
      }
    </script>
  `));
});

// POST /reset-password-submit — processes the reset form
router.post('/reset-password-submit', async (c) => {
  try {
    const body = await c.req.parseBody();
    const token = body.token as string;
    const newPassword = body.newPassword as string;

    if (!token || !newPassword) throw new Error('Token and password are required.');

    await auth.api.resetPassword({
      body: { token, newPassword },
      headers: c.req.raw.headers
    });

    return c.html(pageShell('Password Updated', `
      <div class="icon-box success">✓</div>
      <h1 style="text-align:center;">Password updated</h1>
      <p class="subtitle" style="text-align:center;">
        Your password has been reset. You can now sign in on the desktop app
        with your new password.
      </p>
      <div class="divider"></div>
      <p class="caption" style="text-align:center;">You can close this window.</p>
    `));
  } catch (err: any) {
    console.error('[Auth] reset-password-submit error:', err);
    return c.html(pageShell('Reset Failed', `
      <div class="icon-box danger">✕</div>
      <h1 style="text-align:center;">Reset failed</h1>
      <p class="subtitle" style="text-align:center;">
        ${err.message || 'An error occurred while resetting your password.'}
        The link may have expired — request a new one from the desktop app.
      </p>
    `), 400);
  }
});

// GET /verify-success — shown after Better Auth processes the verification link
router.get('/verify-success', (c) => {
  return c.html(pageShell('Email Verified', `
    <div class="icon-box success">✓</div>
    <h1 style="text-align:center;">Email verified</h1>
    <p class="subtitle" style="text-align:center;">
      Your email address has been confirmed. Your HUNTARA account is now active.
    </p>
    <div class="divider"></div>
    <p class="caption" style="text-align:center;">
      Open the desktop app, click <strong style="color: #F4F4F5; font-weight: 500;">
      "I've verified my email"</strong>, and you'll be signed in automatically.
    </p>
  `));
});

// GET /google/start — Browser entry point for Google OAuth social sign-in.
// Passes through Better Auth to generate state cookie, attaches Set-Cookie to the
// response, and 302 redirects Chrome to accounts.google.com.
router.get('/google/start', async (c) => {
  const callbackURL = c.req.query('callbackURL') || 'http://127.0.0.1:48113/auth/callback';
  try {
    const res = await auth.api.signInSocial({
      body: {
        provider: 'google',
        callbackURL
      },
      headers: c.req.raw.headers,
      asResponse: true
    });

    const googleAuthUrl = res.headers.get('location') || (await res.json().catch(() => ({})))?.url;
    if (!googleAuthUrl) {
      throw new Error('Google authorization URL not generated');
    }

    const responseHeaders = new Headers();
    // Copy all set-cookie headers from Better Auth so Chrome saves the state cookie
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      responseHeaders.set('Set-Cookie', setCookie);
    }
    responseHeaders.set('Location', googleAuthUrl);

    return new Response(null, {
      status: 302,
      headers: responseHeaders
    });
  } catch (err: any) {
    console.error('[Auth] GET /google/start failed:', err);
    return c.html(pageShell('Sign-in Error', `
      <div class="icon-box danger">✕</div>
      <h1 style="text-align:center;">Sign-in failed</h1>
      <p class="subtitle" style="text-align:center;">
        ${err.message || 'Could not start Google sign-in.'}
      </p>
    `), 400);
  }
});

// Wildcard routing to support direct Better Auth client SDK requests
router.on(['GET', 'POST'], '/*', async (c) => {
  const res = await auth.handler(c.req.raw);

  // When an OAuth callback (GET /callback/google) redirects to a loopback address
  // (127.0.0.1:* or localhost:*), extract the session token from Set-Cookie and
  // append ?token=... to the location redirect so desktop gets the token directly.
  const location = res.headers.get('location');
  const setCookie = res.headers.get('set-cookie');

  if (res.status === 302 && location && (location.includes('127.0.0.1') || location.includes('localhost')) && setCookie) {
    const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
    if (match && match[1]) {
      const rawToken = decodeURIComponent(match[1]).split('.')[0];
      if (rawToken) {
        try {
          const url = new URL(location);
          if (!url.searchParams.has('token')) {
            url.searchParams.set('token', rawToken);
            const headers = new Headers(res.headers);
            headers.set('location', url.toString());
            return new Response(res.body, {
              status: res.status,
              statusText: res.statusText,
              headers
            });
          }
        } catch {
          // ignore URL parsing errors
        }
      }
    }
  }

  return res;
});

export { router };
