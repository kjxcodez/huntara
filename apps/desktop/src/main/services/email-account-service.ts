import { getDatabase } from '../database/connection';
import type { SdkClient } from '@huntara/sdk';

export interface EmailAccountRow {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  provider: string;
  status: string;
  dailyLimit: number;
  hourlyLimit: number;
  dailySent: number;
  hourlySent: number;
  signature?: string | null;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
  googleAccountId?: string | null;
}

/**
 * Loads a safe email account row from local SQLite cache.
 */
export function loadEmailAccount(
  workspaceId: string,
  id: string
): EmailAccountRow | null {
  const db = getDatabase(workspaceId);
  return (db
    .prepare(
      `SELECT id, workspaceId, name, email, provider, status, dailyLimit, hourlyLimit, dailySent, hourlySent, signature, lastVerifiedAt, lastError, googleAccountId FROM email_accounts WHERE id = ? AND workspaceId = ? AND deletedAt IS NULL`
    )
    .get(id, workspaceId) as EmailAccountRow) || null;
}

/**
 * Initiates a server-owned Gmail OAuth connection transaction via API SDK.
 */
export async function connectGmailAccount(
  sdk: SdkClient
): Promise<{ transactionId: string; authorizationUrl: string }> {
  return sdk.outreach.connectGmail();
}

/**
 * Polls the status of an OAuth connection transaction.
 */
export async function getOAuthTransactionStatus(
  sdk: SdkClient,
  transactionId: string
): Promise<{ status: string; emailAccountId?: string; account?: any; error?: string }> {
  return sdk.outreach.getOAuthStatus(transactionId);
}

/**
 * Re-initiates Gmail OAuth authorization for an existing account via API SDK.
 */
export async function reconnectGmailAccount(
  sdk: SdkClient,
  id: string
): Promise<{ transactionId: string; authorizationUrl: string }> {
  return sdk.outreach.reconnectGmail(id);
}

/**
 * Disconnects a Gmail mailbox remotely via API SDK.
 */
export async function disconnectGmailAccount(
  sdk: SdkClient,
  id: string
): Promise<{ success: boolean }> {
  return sdk.outreach.disconnectAccount(id);
}

export async function sendTestEmail(
  sdk: SdkClient,
  payload: {
    id: string;
    to: string;
    useSignature?: boolean;
    attachments?: Array<{
      filename: string;
      contentBase64?: string;
      path?: string;
      contentType?: string;
      size?: number;
      id?: string;
      fileId?: string;
      driveUrl?: string;
      googleConnectionId?: string;
    }>;
  }
): Promise<{ sent: boolean; messageId?: string; sentTo?: string; signatureNotice?: string }> {
  const processedAttachments: Array<{
    filename: string;
    contentBase64?: string;
    path?: string;
    contentType?: string;
    size?: number;
    id?: string;
    fileId?: string;
    driveUrl?: string;
    googleConnectionId?: string;
  }> = [];
  if (Array.isArray(payload.attachments)) {
    const fs = await import('fs');
    for (const att of payload.attachments) {
      const filename = att.filename || 'attachment';
      const ext = filename.split('.').pop()?.toLowerCase();
      if (['exe', 'bat', 'cmd', 'scr', 'vbs', 'sh', 'ps1'].includes(ext || '')) {
        throw new Error(`File type .${ext} is not allowed for email attachments.`);
      }
      if (att.size && att.size > 25 * 1024 * 1024) {
        throw new Error(`Attachment "${filename}" exceeds the 25 MB limit.`);
      }

      let contentBase64 = att.contentBase64 || '';
      if (!contentBase64 && att.path) {
        if (fs.existsSync(att.path)) {
          try {
            const stat = fs.statSync(att.path);
            if (stat.isFile() && stat.size <= 25 * 1024 * 1024) {
              contentBase64 = fs.readFileSync(att.path).toString('base64');
            }
          } catch {
            // Handled by validation check below
          }
        }
      }

      const isDriveAttachment = !!(att.id || att.fileId || att.driveUrl);
      if (!contentBase64 && !isDriveAttachment) {
        throw new Error(`Unable to read "${filename}". Please remove and attach the file again.`);
      }

      const item: any = { filename };
      if (contentBase64) item.contentBase64 = contentBase64;
      if (att.id) item.id = att.id;
      if (att.fileId) item.fileId = att.fileId;
      if (att.driveUrl) item.driveUrl = att.driveUrl;
      if (att.googleConnectionId) item.googleConnectionId = att.googleConnectionId;
      if (att.contentType) item.contentType = att.contentType;
      if (att.size) item.size = att.size;
      processedAttachments.push(item);
    }
  }

  const sendOpts: any = {
    to: payload.to,
    attachments: processedAttachments
  };
  if (payload.useSignature !== undefined) {
    sendOpts.useSignature = payload.useSignature;
  }

  const res = await sdk.outreach.sendTestEmail(payload.id, sendOpts);
  return {
    sent: true,
    messageId: res.messageId,
    sentTo: res.sentTo,
    ...(res.signatureNotice ? { signatureNotice: res.signatureNotice } : {})
  };
}