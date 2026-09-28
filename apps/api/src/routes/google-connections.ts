import { OpenAPIHono, z } from '@hono/zod-openapi';
import { GoogleConnectionRepository } from '../repositories/google-connection/google-connection.repository.js';
import { EmailAccountService } from '../services/email/email-account.service.js';
import { GoogleAuthService, GMAIL_DEFAULT_SCOPES, DRIVE_FILE_SCOPE } from '../services/google/auth.service.js';
import { GoogleDriveProvider } from '../services/google/drive.provider.js';
import { successResponse } from '../utils/index.js';
import { ForbiddenError } from '../errors/index.js';
import { logger } from '../config/index.js';

export const googleConnectionsRouter = new OpenAPIHono();

function getWorkspaceId(c: any): string {
  const wsId = c.get('workspaceId');
  if (!wsId) throw new ForbiddenError('Workspace context required.');
  return wsId.toString();
}

function getUserId(c: any): string {
  const user = c.get('user');
  if (!user || (!user.id && !user._id)) throw new ForbiddenError('User context required.');
  return (user.id || user._id).toString();
}

const connectSchema = z.object({
  scopes: z.array(z.string()).optional(),
  prompt: z.string().optional()
});

googleConnectionsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const repo = new GoogleConnectionRepository(wsId);
  const connections = await repo.findMany({}, { sort: { createdAt: -1 } });
  const sanitized = connections.map((conn) => sanitizeConnection(conn.toObject()));
  return c.json(successResponse(sanitized));
});

googleConnectionsRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const repo = new GoogleConnectionRepository(wsId);
  const connection = await repo.findById(id);
  if (!connection) {
    return c.json({ error: 'Connection not found' }, 404);
  }
  return c.json(successResponse(sanitizeConnection(connection.toObject())));
});

googleConnectionsRouter.post('/connect', async (c) => {
  const wsId = getWorkspaceId(c);
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = connectSchema.parse(body);

  const service = new EmailAccountService(wsId);
  const result = await service.initiateGmailOAuth(userId, undefined, parsed.scopes);
  return c.json(successResponse(result));
});

googleConnectionsRouter.get('/oauth/status/:transactionId', async (c) => {
  const wsId = getWorkspaceId(c);
  const transactionId = c.req.param('transactionId');
  const service = new EmailAccountService(wsId);
  const result = await service.getOAuthTransactionStatus(transactionId);
  return c.json(successResponse(result));
});

googleConnectionsRouter.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error || !code || !state) {
    return c.html(
      htmlShell(
        'Connection Failed',
        `<div class="card danger">
          <h1>Google Connection Failed</h1>
          <p>${error || 'Missing authorization code or state token.'}</p>
        </div>`
      ),
      400
    );
  }

  try {
    const { account } = await EmailAccountService.handleGmailOAuthCallback(code, state);
    return c.html(
      htmlShell(
        'Google Connected',
        `<div class="card success">
          <div class="icon">✓</div>
          <h1>Google Account Connected</h1>
          <p>Successfully authorized <strong>${account.email}</strong>.</p>
          <p class="sub">You can close this tab and return to HUNTARA.</p>
        </div>`
      )
    );
  } catch (err: any) {
    logger.error({ err, state }, 'Google OAuth callback exchange error');
    return c.html(
      htmlShell(
        'Connection Error',
        `<div class="card danger">
          <h1>OAuth Exchange Error</h1>
          <p>${err.message || String(err)}</p>
        </div>`
      ),
      500
    );
  }
});

googleConnectionsRouter.post('/:id/disconnect', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const authService = new GoogleAuthService();
  await authService.disconnectDrive(id);
  return c.json(successResponse({ success: true }));
});

googleConnectionsRouter.post('/:id/reauthorize', async (c) => {
  const wsId = getWorkspaceId(c);
  const userId = getUserId(c);
  const id = c.req.param('id');
  const repo = new GoogleConnectionRepository(wsId);
  const connection = await repo.findById(id);
  if (!connection) {
    return c.json({ error: 'Connection not found' }, 404);
  }

  const service = new EmailAccountService(wsId);
  const body = await c.req.json().catch(() => ({}));
  const requestedScopes = body.scopes || ['openid', 'email', 'https://www.googleapis.com/auth/userinfo.profile', DRIVE_FILE_SCOPE];
  const result = await service.initiateGmailOAuth(userId, undefined, requestedScopes);
  return c.json(successResponse(result));
});

// ── Google Drive Browsing & Picker Endpoints ──────────────────────────────────

googleConnectionsRouter.get('/:id/drive/files', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const folderId = c.req.query('folderId') || undefined;
  const search = c.req.query('search') || undefined;
  const pageToken = c.req.query('pageToken') || undefined;
  const pageSize = parseInt(c.req.query('pageSize') || '50');

  const repo = new GoogleConnectionRepository(wsId);
  const connection = await repo.findById(id);
  if (!connection) {
    return c.json({ error: 'Connection not found' }, 404);
  }

  if (connection.driveStatus !== 'authorized' || connection.status === 'disconnected') {
    return c.json(successResponse({ files: [], nextPageToken: undefined }));
  }

  const authService = new GoogleAuthService();
  const driveProvider = new GoogleDriveProvider(authService);
  try {
    const result = await driveProvider.listFiles(id, { folderId, search, pageToken, pageSize });
    return c.json(successResponse(result));
  } catch (err: any) {
    logger.warn({ err, connectionId: id }, 'Failed to list Google Drive files');
    return c.json(successResponse({ files: [], nextPageToken: undefined }));
  }
});

googleConnectionsRouter.get('/:id/drive/files/:fileId', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const fileId = c.req.param('fileId');

  const repo = new GoogleConnectionRepository(wsId);
  const connection = await repo.findById(id);
  if (!connection) {
    return c.json({ error: 'Connection not found' }, 404);
  }

  if (connection.driveStatus !== 'authorized' || connection.status === 'disconnected') {
    return c.json({ error: 'Google Drive is not authorized for this connection' }, 400);
  }

  const authService = new GoogleAuthService();
  const driveProvider = new GoogleDriveProvider(authService);
  const metadata = await driveProvider.getFileMetadata(id, fileId);
  return c.json(successResponse(metadata));
});

googleConnectionsRouter.get('/:id/drive/about', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');

  const repo = new GoogleConnectionRepository(wsId);
  const connection = await repo.findById(id);
  if (!connection) {
    return c.json({ error: 'Connection not found' }, 404);
  }

  if (connection.driveStatus !== 'authorized' || connection.status === 'disconnected') {
    return c.json(successResponse({ user: {}, storageQuota: {} }));
  }

  const authService = new GoogleAuthService();
  const driveProvider = new GoogleDriveProvider(authService);
  try {
    const about = await driveProvider.getDriveAbout(id);
    return c.json(successResponse(about));
  } catch (err: any) {
    logger.warn({ err, connectionId: id }, 'Failed to fetch Google Drive about/quota');
    return c.json(successResponse({ user: {}, storageQuota: {} }));
  }
});

function sanitizeConnection(doc: any): any {
  const obj: any = { ...doc };
  if (obj._id) obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  delete obj.encryptedRefreshToken;
  delete obj.encryptedAccessToken;
  return obj;
}

function htmlShell(title: string, content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} — HUNTARA</title>
  <style>
    body { background: #09090b; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 40px; text-align: center; max-width: 420px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .card.success .icon { background: #10b981; color: #000; width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; margin: 0 auto 20px; }
    .card.danger { border-color: #ef4444; }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 10px; color: #fff; }
    p { font-size: 14px; color: #a1a1aa; margin: 0 0 10px; line-height: 1.5; }
    p.sub { font-size: 13px; color: #71717a; margin-top: 15px; }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
}
