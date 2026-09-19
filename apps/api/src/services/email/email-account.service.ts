import { randomUUID, randomBytes, createHash } from 'crypto';
import { generateEntityId } from '@huntara/schema';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { GoogleConnectionModel } from '../../db/models/google-connection.model.js';
import { OAuthTransactionModel } from '../../db/models/oauth-transaction.model.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { CampaignService } from '../campaign/campaign.service.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { env, logger } from '../../config/index.js';
import { EmailDomainError, type SafeEmailAccount } from './types.js';
import { GoogleAuthService, GMAIL_DEFAULT_SCOPES, DRIVE_FILE_SCOPE } from '../google/auth.service.js';
import { GmailProvider } from '../google/gmail.provider.js';
import { normalizeEmailSignature } from '@huntara/sdk';
import { EmailAccountRepository } from '../../repositories/email-account/email-account.repository.js';
import type { EmailProvider } from './providers/types.js';

/**
 * EmailAccountService owns mailbox lifecycle and OAuth credential handling:
 * server-side OAuth transactions (PKCE state/code exchange), reconnect, disconnect,
 * lookup, list, and health. It never exposes raw tokens — it returns only
 * `SafeEmailAccount` objects.
 */
export class EmailAccountService {
  private readonly authService: GoogleAuthService;

  constructor(private readonly workspaceId: string) {
    this.authService = new GoogleAuthService();
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  async listAccounts(): Promise<SafeEmailAccount[]> {
    const accounts = await EmailAccountModel.find({
      workspaceId: this.workspaceId
    } as any).sort({ createdAt: -1 });
    return accounts.map((a) => sanitize(a.toObject()));
  }

  async getAccount(id: string): Promise<SafeEmailAccount> {
    const account = await this.findAccount(id);
    return sanitize(account.toObject());
  }

  // ── Server-Side OAuth Transaction Lifecycle ──────────────────────────────

  /**
   * Initiates a short-lived Gmail OAuth transaction on the server.
   * Uses prompt='select_account consent' and PKCE.
   */
  async initiateGmailOAuth(
    userId: string,
    callbackRedirectUri?: string,
    scopes?: string[]
  ): Promise<{ transactionId: string; authorizationUrl: string }> {
    const transactionId = randomUUID();
    const state = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('hex');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const baseUrl = env.BETTER_AUTH_URL.replace(/\/auth\/?$/, '');
    const redirectUri = callbackRedirectUri || `${baseUrl}/email/accounts/gmail/oauth/callback`;

    const authorizationUrl = this.authService.buildAuthUrl({
      state,
      codeChallenge,
      redirectUri,
      scopes: scopes || GMAIL_DEFAULT_SCOPES,
      prompt: 'select_account consent'
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minute TTL

    await OAuthTransactionModel.create({
      transactionId,
      workspaceId: this.workspaceId,
      userId,
      state,
      codeVerifier,
      provider: 'gmail',
      status: 'pending',
      expiresAt
    });

    return { transactionId, authorizationUrl };
  }

  /**
   * Handles the Google OAuth redirect callback on the API.
   * Exchanges authorization code for tokens, resolves Google identity,
   * creates/updates GoogleConnection, and creates/updates EmailAccount.
   */
  static async handleGmailOAuthCallback(
    code: string,
    state: string
  ): Promise<{ transactionId: string; account: SafeEmailAccount }> {
    const transaction = await OAuthTransactionModel.findOne({ state });
    if (!transaction) {
      throw new EmailDomainError('GMAIL_OAUTH_FAILED', 'Invalid or expired OAuth state token.');
    }
    if (transaction.status === 'completed' && transaction.emailAccountId) {
      const accountService = new EmailAccountService(transaction.workspaceId);
      const account = await accountService.getAccount(transaction.emailAccountId);
      return { transactionId: transaction.transactionId, account };
    }

    const baseUrl = env.BETTER_AUTH_URL.replace(/\/auth\/?$/, '');
    const redirectUri = `${baseUrl}/email/accounts/gmail/oauth/callback`;

    const authService = new GoogleAuthService({ redirectUri });

    try {
      const tokens = await authService.exchangeCodeForTokens(code, transaction.codeVerifier, redirectUri);
      if (!tokens.refreshToken) {
        throw new EmailDomainError(
          'GMAIL_OAUTH_FAILED',
          'Google did not return a refresh token. Please re-consent.'
        );
      }

      const info = await authService.getIdentityInfo(tokens.accessToken);
      const email = info.email.toLowerCase().trim();
      const sub = info.sub;

      const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
      const grantedScopes = tokens.scope
        ? tokens.scope.split(' ').map((s) => s.trim()).filter(Boolean)
        : (info.scope ? info.scope.split(' ').map((s) => s.trim()).filter(Boolean) : GMAIL_DEFAULT_SCOPES);

      const hasDrive = grantedScopes.includes(DRIVE_FILE_SCOPE) || grantedScopes.includes('https://www.googleapis.com/auth/drive');
      const hasGmail = grantedScopes.includes('https://www.googleapis.com/auth/gmail.send') || grantedScopes.includes('https://www.googleapis.com/auth/gmail.modify');

      // 1. Find or create GoogleConnection for this (workspaceId, googleAccountId)
      let connection = await GoogleConnectionModel.findOne({
        workspaceId: transaction.workspaceId,
        googleAccountId: sub
      });

      if (connection) {
        connection.email = email;
        if (info.name) connection.name = info.name;
        if (info.picture) connection.picture = info.picture;
        connection.encryptedRefreshToken = encrypt(tokens.refreshToken);
        connection.encryptedAccessToken = encrypt(tokens.accessToken);
        connection.tokenExpiresAt = tokenExpiresAt;
        connection.grantedScopes = Array.from(new Set([...connection.grantedScopes, ...grantedScopes]));
        if (hasGmail) connection.gmailStatus = 'connected';
        if (hasDrive) connection.driveStatus = 'authorized';
        connection.status = 'active';
        connection.lastVerifiedAt = new Date();
        connection.lastError = null;
        await connection.save();
      } else {
        connection = await GoogleConnectionModel.create({
          _id: generateEntityId(),
          workspaceId: transaction.workspaceId,
          userId: transaction.userId,
          googleAccountId: sub,
          email,
          name: info.name || null,
          picture: info.picture || null,
          encryptedRefreshToken: encrypt(tokens.refreshToken),
          encryptedAccessToken: encrypt(tokens.accessToken),
          tokenExpiresAt,
          grantedScopes,
          gmailStatus: hasGmail ? 'connected' : 'revoked',
          driveStatus: hasDrive ? 'authorized' : 'not_authorized',
          status: 'active',
          lastVerifiedAt: new Date()
        });
      }

      // 2. Find or create EmailAccount linked to this GoogleConnection ONLY IF hasGmail is true
      let accountDoc: any = null;
      if (hasGmail) {
        accountDoc = await EmailAccountModel.findOne({
          workspaceId: transaction.workspaceId,
          $or: [
            { googleConnectionId: connection._id.toString() },
            { email }
          ]
        } as any);

        if (accountDoc) {
          accountDoc.provider = 'gmail';
          accountDoc.status = 'connected';
          accountDoc.googleConnectionId = connection._id.toString();
          accountDoc.googleAccountId = sub;
          accountDoc.email = email;
          accountDoc.encryptedRefreshToken = encrypt(tokens.refreshToken);
          accountDoc.encryptedAccessToken = encrypt(tokens.accessToken);
          accountDoc.tokenExpiresAt = tokenExpiresAt;
          accountDoc.lastVerifiedAt = new Date();
          accountDoc.lastError = null;
          await accountDoc.save();
        } else {
          accountDoc = await EmailAccountModel.create({
            _id: generateEntityId(),
            workspaceId: transaction.workspaceId as any,
            name: info.name || email.split('@')[0] || 'Gmail',
            email,
            provider: 'gmail',
            googleConnectionId: connection._id.toString(),
            googleAccountId: sub,
            status: 'connected',
            isDefault: false,
            dailyLimit: 200,
            hourlyLimit: 50,
            encryptedRefreshToken: encrypt(tokens.refreshToken),
            encryptedAccessToken: encrypt(tokens.accessToken),
            tokenExpiresAt,
            lastVerifiedAt: new Date()
          });
        }

        // Fetch and cache user's Gmail web signature immediately upon connection
        try {
          const gmailProvider = new GmailProvider(authService);
          const signature = await gmailProvider.getSendAsSignature(connection._id.toString(), email);
          if (signature) {
            accountDoc.signature = normalizeEmailSignature(signature);
            await accountDoc.save();
            logger.info({ email, accountId: accountDoc._id }, 'Synced Gmail web signature during OAuth connection');
          }
        } catch (sigErr) {
          logger.warn({ sigErr, email }, 'Could not fetch signature during Gmail OAuth connection');
        }

        // Phase 18: Reset mailbox health to HEALTHY upon successful reconnection
        accountDoc.health = {
          state: 'HEALTHY',
          consecutiveFailures: 0,
          failureWindowStart: null,
          lastFailureAt: null,
          lastSuccessfulSendAt: accountDoc.health?.lastSuccessfulSendAt || null,
          lastFailureCategory: null,
          cooldownUntil: null,
          operatorActionRequired: false,
          operatorMessage: null
        };
        accountDoc.status = 'connected';
        accountDoc.lastError = null;
        await accountDoc.save();

        // Phase 15 (DISCONNECT-16): Auto-resume campaigns that were paused strictly because the mailbox disconnected.
        // Preserve manual user pause intent: campaigns paused with 'USER_REQUESTED' must NOT auto-resume.
        try {
          const campaignService = new CampaignService(transaction.workspaceId);
          const pausedCampaigns = await CampaignModel.find({
            workspaceId: transaction.workspaceId,
            sendingAccountId: accountDoc._id.toString(),
            status: 'PAUSED',
            'settings.pauseReason': 'MAILBOX_DISCONNECTED'
          });

          for (const camp of pausedCampaigns) {
            await campaignService.resumeCampaign(camp._id.toString());
          }
        } catch (reconnectErr) {
          logger.warn({ err: reconnectErr }, 'Warning during post-reconnect campaign resumption');
        }
      }

      transaction.status = 'completed';
      if (accountDoc) {
        transaction.emailAccountId = accountDoc._id.toString();
      }
      await transaction.save();

      return {
        transactionId: transaction.transactionId,
        account: accountDoc ? sanitize(accountDoc.toObject()) : ({ email, status: 'connected' } as any)
      };
    } catch (err: any) {
      transaction.status = 'failed';
      transaction.error = err.message || String(err);
      await transaction.save();
      throw err;
    }
  }

  /**
   * Polls the status of a server-side OAuth transaction.
   */
  async getOAuthTransactionStatus(
    transactionId: string
  ): Promise<{ status: string; emailAccountId?: string; account?: SafeEmailAccount; error?: string }> {
    const transaction = await OAuthTransactionModel.findOne({
      transactionId,
      workspaceId: this.workspaceId
    });
    if (!transaction) {
      throw new EmailDomainError('TRANSACTION_NOT_FOUND', 'OAuth transaction not found or expired.');
    }
    if (transaction.status === 'completed' && transaction.emailAccountId) {
      const account = await this.getAccount(transaction.emailAccountId);
      return { status: 'completed', emailAccountId: transaction.emailAccountId, account };
    }
    return {
      status: transaction.status,
      ...(transaction.error ? { error: transaction.error } : {})
    };
  }

  /**
   * Re-runs authorization for an existing account.
   */
  async initiateGmailReconnect(
    userId: string,
    id: string
  ): Promise<{ transactionId: string; authorizationUrl: string }> {
    const account = await this.findAccount(id);
    const transactionId = randomUUID();
    const state = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('hex');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const baseUrl = env.BETTER_AUTH_URL.replace(/\/auth\/?$/, '');
    const redirectUri = `${baseUrl}/email/accounts/gmail/oauth/callback`;

    const authorizationUrl = this.authService.buildAuthUrl({
      state,
      codeChallenge,
      redirectUri,
      scopes: GMAIL_DEFAULT_SCOPES,
      prompt: 'select_account consent',
      loginHint: account.email
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await OAuthTransactionModel.create({
      transactionId,
      workspaceId: this.workspaceId,
      userId,
      state,
      codeVerifier,
      provider: 'gmail',
      status: 'pending',
      expiresAt
    });

    return { transactionId, authorizationUrl };
  }

  /**
   * Disconnects a mailbox and revokes credentials.
   */
  async disconnect(id: string): Promise<{ success: boolean }> {
    const account = await this.findAccount(id);

    account.status = 'disconnected';
    account.encryptedAccessToken = null;
    account.tokenExpiresAt = null;
    account.lastError = 'Disconnected by user';
    account.health = {
      state: 'DISCONNECTED',
      consecutiveFailures: 0,
      failureWindowStart: null,
      lastFailureAt: null,
      lastSuccessfulSendAt: account.health?.lastSuccessfulSendAt || null,
      lastFailureCategory: null,
      cooldownUntil: null,
      operatorActionRequired: true,
      operatorMessage: 'Mailbox disconnected by user.'
    };
    await account.save();

    // Phase 15 (DISCONNECT-16): Transition campaigns using this sending account into safe recoverable PAUSED state
    try {
      const campaignService = new CampaignService(this.workspaceId);
      const affectedCampaigns = await CampaignModel.find({
        workspaceId: this.workspaceId,
        sendingAccountId: id,
        status: 'ACTIVE'
      });

      for (const camp of affectedCampaigns) {
        await campaignService.pauseCampaign(camp._id.toString(), 'MAILBOX_DISCONNECTED');
      }
    } catch (campErr) {
      logger.warn({ err: campErr, accountId: id }, 'Warning pausing campaigns for disconnected account');
    }

    if (account.googleConnectionId) {
      // Check if any other email accounts in this workspace are using the connection
      const otherAccounts = await EmailAccountModel.countDocuments({
        _id: { $ne: account._id },
        googleConnectionId: account.googleConnectionId,
        status: 'connected'
      });

      if (otherAccounts === 0) {
        await this.authService.disconnectGmail(account.googleConnectionId);
      }
    } else if (account.encryptedRefreshToken) {
      try {
        const refreshToken = decrypt(account.encryptedRefreshToken);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
      } catch {}
    }

    return { success: true };
  }

  /**
   * Updates safe metadata fields for an account.
   */
  async syncMeta(
    id: string,
    meta: {
      provider?: string;
      name?: string;
      email?: string;
      status?: string;
      googleAccountId?: string;
      signature?: string;
      dailyLimit?: number;
      hourlyLimit?: number;
    }
  ): Promise<SafeEmailAccount> {
    const account = await this.findAccount(id);

    if (meta.name !== undefined) account.name = meta.name;
    if (meta.email !== undefined) account.email = meta.email;
    if (meta.status !== undefined) account.status = meta.status as any;
    if (meta.provider !== undefined) account.provider = meta.provider as any;
    if (meta.googleAccountId !== undefined) account.googleAccountId = meta.googleAccountId;
    if (meta.signature !== undefined) account.signature = meta.signature;
    if (meta.dailyLimit !== undefined) account.dailyLimit = meta.dailyLimit;
    if (meta.hourlyLimit !== undefined) account.hourlyLimit = meta.hourlyLimit;

    await account.save();
    return sanitize(account.toObject());
  }

  /**
   * Resets mailbox health state to HEALTHY (operator manual action).
   */
  async resetMailboxHealth(id: string): Promise<SafeEmailAccount> {
    const account = await this.findAccount(id);
    const repo = new EmailAccountRepository(this.workspaceId);
    await repo.resetHealthState(account._id.toString());
    const updated = await this.findAccount(id);
    return sanitize(updated.toObject());
  }

  /**
   * Syncs and updates the Gmail web signature for an email account.
   */
  public async syncSignature(id: string): Promise<{ signature: string | null; synced: boolean }> {
    const account = await this.findAccount(id);
    const provider: any = await this.buildProvider(id);
    const rawSig = typeof provider.fetchSignature === 'function' ? await provider.fetchSignature() : null;
    const signature = rawSig ? normalizeEmailSignature(rawSig) : null;
    await EmailAccountModel.updateOne(
      { _id: id } as any,
      { signature: signature || null }
    );
    return { signature: signature || null, synced: !!signature };
  }

  /**
   * Returns a provider for sending email. Rejects legacy SMTP accounts.
   */
  async buildProvider(id: string): Promise<EmailProvider> {
    const account = await this.findAccount(id);

    if (account.provider === 'smtp' || account.status === 'unsupported') {
      throw new EmailDomainError(
        'MAILBOX_NOT_SUPPORTED',
        'SMTP is permanently removed. Please connect a Gmail account.'
      );
    }

    if (account.status === 'disconnected' || account.status === 'disabled') {
      throw new EmailDomainError(
        'MAILBOX_DISCONNECTED',
        'Mailbox is disconnected. Please reconnect it.'
      );
    }

    if (account.provider === 'gmail' || account.provider === 'gmail_oauth') {
      let connectionId = account.googleConnectionId;

      if (!connectionId) {
        // Fallback 1: lookup GoogleConnection by googleAccountId or email
        const connection = await GoogleConnectionModel.findOne({
          workspaceId: this.workspaceId,
          $or: [
            ...(account.googleAccountId ? [{ googleAccountId: account.googleAccountId }] : []),
            { email: account.email }
          ]
        });
        if (connection) {
          connectionId = connection._id.toString();
          account.googleConnectionId = connectionId;
          await account.save();
        } else if (account.encryptedRefreshToken) {
          // Fallback 2: auto-synthesize GoogleConnection from valid stored account tokens
          const newConnection: any = await GoogleConnectionModel.create({
            _id: generateEntityId(),
            workspaceId: this.workspaceId,
            userId: this.workspaceId,
            email: account.email,
            status: 'active',
            gmailStatus: 'connected',
            driveStatus: 'authorized',
            encryptedRefreshToken: account.encryptedRefreshToken,
            encryptedAccessToken: account.encryptedAccessToken,
            tokenExpiresAt: account.tokenExpiresAt || new Date(Date.now() + 3600 * 1000),
            googleAccountId: account.googleAccountId || account.email,
            grantedScopes: [
              'https://www.googleapis.com/auth/gmail.send',
              'https://www.googleapis.com/auth/gmail.compose',
              'https://www.googleapis.com/auth/userinfo.email',
              'https://www.googleapis.com/auth/userinfo.profile'
            ]
          });
          connectionId = newConnection._id.toString();
          account.googleConnectionId = connectionId;
          await account.save();
        }
      }

      if (!connectionId) {
        throw new EmailDomainError(
          'MAILBOX_NOT_AUTHORIZED',
          `Gmail account "${account.email}" is missing OAuth credentials. Please connect via Google OAuth in Settings.`
        );
      }

      const gmailProvider = new GmailProvider(this.authService);

      return {
        kind: 'gmail_oauth',
        async send(options: any) {
          const attachments = options.attachments?.map((att: any) => ({
            filename: att.filename,
            contentType: att.contentType,
            data: att.contentBase64 || att.data
          }));

          const result = await gmailProvider.sendMessage({
            connectionId: connectionId!,
            from: options.from || account.email,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
            attachments
          });

          return { messageId: result.messageId, accepted: [options.to] };
        },
        async verify() {
          try {
            const accessToken = await new GoogleAuthService().getValidAccessToken(connectionId!);
            const info = await new GoogleAuthService().getIdentityInfo(accessToken);
            return info.email ? 'healthy' : 'failed';
          } catch {
            return 'reauth_required';
          }
        },
        async fetchSignature(): Promise<string | null> {
          return gmailProvider.getSendAsSignature(connectionId!, account.email);
        },
        close() {}
      } as any;
    }

    throw new EmailDomainError(
      'MAILBOX_NOT_SUPPORTED',
      `Unsupported email account provider: ${account.provider}. Only Gmail is supported.`
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async findAccount(id: string): Promise<any> {
    const account = await EmailAccountModel.findOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
    if (!account) {
      throw new EmailDomainError('MAILBOX_NOT_FOUND', 'Email Account not found.');
    }
    return account;
  }
}

function sanitize(doc: any): SafeEmailAccount {
  const obj: any = { ...doc };
  if (obj._id) obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  delete obj.encryptedPassword;
  delete obj.encryptedRefreshToken;
  delete obj.encryptedAccessToken;
  if (obj.createdAt) obj.createdAt = new Date(obj.createdAt).toISOString();
  if (obj.updatedAt) obj.updatedAt = new Date(obj.updatedAt).toISOString();
  if (obj.lastVerifiedAt)
    obj.lastVerifiedAt = new Date(obj.lastVerifiedAt).toISOString();
  if (obj.tokenExpiresAt)
    obj.tokenExpiresAt = new Date(obj.tokenExpiresAt).toISOString();
  return obj as SafeEmailAccount;
}
