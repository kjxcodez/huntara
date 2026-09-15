import { OpenAPIHono, z } from '@hono/zod-openapi';
import { EmailAccountService } from '../../services/email/email-account.service.js';
import { EmailService } from '../../services/email/email.service.js';
import { successResponse } from '../../utils/index.js';
import { ForbiddenError } from '../../errors/index.js';
import { logger } from '../../config/index.js';

export const emailRouter = new OpenAPIHono();

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

const sendSchema = z
  .object({
    accountId: z.string().min(1),
    to: z.string().email(),
    subject: z.string().min(1),
    text: z.string().optional(),
    html: z.string().optional(),
    from: z.string().optional(),
    useSignature: z.boolean().optional(),
    idempotencyKey: z.string().optional(),
    campaignId: z.string().optional(),
    sequenceId: z.string().optional(),
    executionId: z.string().optional(),
    stepIndex: z.number().optional(),
    contactId: z.string().optional(),
    messageId: z.string().optional(),
    inReplyTo: z.string().optional(),
    references: z.union([z.array(z.string()), z.string()]).optional(),
    threadId: z.string().optional(),
    attachments: z
      .array(
        z
          .object({
            id: z.string().optional(),
            attachmentId: z.string().optional(),
            fileId: z.string().nullable().optional(),
            provider: z.string().optional(),
            filename: z.string(),
            contentBase64: z.string().optional(),
            data: z.any().optional(),
            path: z.string().optional(),
            contentType: z.string().optional(),
            mimeType: z.string().nullable().optional(),
            size: z.number().optional(),
            driveUrl: z.string().nullable().optional(),
            googleConnectionId: z.string().nullable().optional()
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();

// ── Accounts ──────────────────────────────────────────────────────────────

emailRouter.get('/accounts', async (c) => {
  const wsId = getWorkspaceId(c);
  const service = new EmailAccountService(wsId);
  const accounts = await service.listAccounts();
  return c.json(successResponse(accounts));
});

emailRouter.get('/accounts/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new EmailAccountService(wsId);
  const account = await service.getAccount(id);
  return c.json(successResponse(account));
});

const updateAccountPolicySchema = z.object({
  dailyLimit: z.number().int().min(1).max(2000).nullable().optional(),
  hourlyLimit: z.number().int().min(1).max(200).nullable().optional(),
  minSendIntervalMs: z.number().int().min(1000).nullable().optional()
});

emailRouter.patch('/accounts/:id/policy', async (c) => {
  const wsId = getWorkspaceId(c);
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const validated = updateAccountPolicySchema.parse(body);

  const { WorkspaceModel } = await import('../../db/models/workspace.model.js');
  const workspace = await WorkspaceModel.findById(wsId);
  if (!workspace) throw new ForbiddenError('Workspace not found.');

  const isOwner = workspace.ownerId === userId;
  const member = workspace.members.find((m) => m.userId === userId);
  const isAdmin = member?.role === 'ADMIN' || member?.role === 'OWNER';

  if (!isOwner && !isAdmin) {
    throw new ForbiddenError('Only workspace admins or owners can update mailbox policy.');
  }

  const { EmailAccountModel } = await import('../../db/models/email-account.model.js');
  const account = await EmailAccountModel.findOne({ _id: id, workspaceId: wsId });
  if (!account) throw new ForbiddenError('Email account not found.');

  account.sendPolicy = {
    dailyLimit: validated.dailyLimit ?? account.sendPolicy?.dailyLimit ?? null,
    hourlyLimit: validated.hourlyLimit ?? account.sendPolicy?.hourlyLimit ?? null,
    minSendIntervalMs: validated.minSendIntervalMs ?? account.sendPolicy?.minSendIntervalMs ?? null
  };

  const updated = await account.save();
  return c.json(successResponse(updated));
});

// Initiate server-side Gmail OAuth connection transaction.
// Returns transactionId + authorizationUrl for Chrome.
emailRouter.post('/accounts/gmail/connect', async (c) => {
  const wsId = getWorkspaceId(c);
  const userId = getUserId(c);
  const service = new EmailAccountService(wsId);
  const result = await service.initiateGmailOAuth(userId);
  return c.json(successResponse(result));
});

// Poll status of an OAuth transaction.
emailRouter.get('/accounts/gmail/oauth/status/:transactionId', async (c) => {
  const wsId = getWorkspaceId(c);
  const transactionId = c.req.param('transactionId');
  const service = new EmailAccountService(wsId);
  const result = await service.getOAuthTransactionStatus(transactionId);
  return c.json(successResponse(result));
});

// Public Google OAuth callback endpoint (target of Google's 302 redirect from Chrome).
emailRouter.get('/accounts/gmail/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error || !code || !state) {
    return c.html(
      htmlShell(
        'Connection Failed',
        `<div class="card danger">
          <h1>Gmail Connection Failed</h1>
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
        'Gmail Connected',
        `<div class="card success">
          <div class="icon">✓</div>
          <h1>Gmail Account Connected</h1>
          <p>Successfully authorized <strong>${account.email}</strong>.</p>
          <p class="sub">You can close this tab and return to LeadForge OS.</p>
        </div>`
      )
    );
  } catch (err: any) {
    logger.error({ err, state }, 'Gmail OAuth callback exchange error');
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

emailRouter.post('/accounts/:id/reconnect', async (c) => {
  const wsId = getWorkspaceId(c);
  const userId = getUserId(c);
  const id = c.req.param('id');
  const service = new EmailAccountService(wsId);
  const result = await service.initiateGmailReconnect(userId, id);
  return c.json(successResponse(result));
});

emailRouter.post('/accounts/:id/disconnect', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new EmailAccountService(wsId);
  const result = await service.disconnect(id);
  return c.json(successResponse(result));
});

emailRouter.post('/accounts/:id/sync-signature', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new EmailAccountService(wsId);
  const result = await service.syncSignature(id);
  return c.json(successResponse(result));
});

emailRouter.post('/accounts/:id/reset-health', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new EmailAccountService(wsId);
  const result = await service.resetMailboxHealth(id);
  return c.json(successResponse(result));
});

// ── Global Test Recipients ───────────────────────────────────────────────

emailRouter.get('/test-recipients', async (c) => {
  const userId = getUserId(c);
  const recipients = await EmailService.getGlobalTestRecipients(userId);
  return c.json(successResponse(recipients));
});

// ── Sending ────────────────────────────────────────────────────────────────

emailRouter.post('/accounts/:id/test', async (c) => {
  const wsId = getWorkspaceId(c);
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const service = new EmailService(wsId, userId);
  const result = await service.sendTest(id, body);
  return c.json(successResponse(result));
});

emailRouter.post('/send', async (c) => {
  const wsId = getWorkspaceId(c);
  const userId = getUserId(c);
  const reqId = c.req.header('x-request-id') || crypto.randomUUID();
  const rawBody = await c.req.json();
  const body = sendSchema.parse(rawBody);

  logger.info(
    {
      correlationId: reqId,
      workspaceId: wsId,
      userId,
      accountId: body.accountId,
      to: body.to,
      subject: body.subject,
      campaignId: body.campaignId,
      executionId: body.executionId,
      stepIndex: body.stepIndex,
      attachmentsCount: body.attachments?.length || 0,
      idempotencyKey: body.idempotencyKey
    },
    'Email dispatch requested via POST /email/send'
  );

  const service = new EmailService(wsId, userId);
  const result = await service.send(body);
  return c.json(successResponse(result));
});

function htmlShell(title: string, content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} — LeadForge OS</title>
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
