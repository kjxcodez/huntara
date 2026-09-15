import { GoogleAuthService } from './auth.service.js';
import { MimeBuilder, type MimeAttachment } from './mime-builder.js';
import { GoogleConnectionModel } from '../../db/models/google-connection.model.js';
import { EmailDomainError } from '../email/types.js';
import { logger } from '../../config/index.js';

const GMAIL_SEND_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export interface SendGmailMessageOptions {
  connectionId: string;
  from: string;
  to: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  subject: string;
  text?: string | undefined;
  html?: string | undefined;
  attachments?: MimeAttachment[] | undefined;
  mixedBoundary?: string | undefined;
  altBoundary?: string | undefined;
  messageId?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | string[] | undefined;
  threadId?: string | undefined;
}

export type GmailTransportFn = (url: string, init: RequestInit) => Promise<Response>;

export class GmailProvider {
  private transportFn: GmailTransportFn = fetch;

  constructor(private readonly authService: GoogleAuthService) {}

  /**
   * Allows injecting a custom transport function for deterministic unit & integration tests.
   */
  public setTransport(transport: GmailTransportFn): void {
    this.transportFn = transport;
  }

  /**
   * Sends an email through the Gmail REST API for a specific Google Connection.
   */
  public async sendMessage(
    options: SendGmailMessageOptions
  ): Promise<{ messageId: string; threadId?: string }> {
    if (!options.connectionId) {
      throw new EmailDomainError('MAILBOX_NOT_AUTHORIZED', 'No Google Connection specified for message send.');
    }
    const connection = await GoogleConnectionModel.findById(options.connectionId);
    if (!connection) {
      throw new EmailDomainError('MAILBOX_NOT_FOUND', `Google connection "${options.connectionId}" not found.`);
    }

    if (connection.status === 'disconnected' || connection.gmailStatus === 'revoked') {
      throw new EmailDomainError(
        'MAILBOX_DISCONNECTED',
        `Gmail mailbox "${connection.email}" is disconnected or revoked. Please reconnect the account.`
      );
    }

    // Acquire valid access token (refreshes independently if needed)
    let accessToken: string;
    try {
      accessToken = await this.authService.getValidAccessToken(options.connectionId);
    } catch (err: any) {
      if (err instanceof EmailDomainError) throw err;
      throw new EmailDomainError('GMAIL_TOKEN_REFRESH_FAILED', `Failed to obtain access token: ${err.message}`, true);
    }

    // Build standard base64url MIME payload
    const raw = MimeBuilder.buildRaw({
      from: options.from,
      to: options.to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
      mixedBoundary: options.mixedBoundary,
      altBoundary: options.altBoundary,
      messageId: options.messageId,
      inReplyTo: options.inReplyTo,
      references: options.references
    });

    const sendPayload: Record<string, any> = { raw };
    if (options.threadId) {
      sendPayload.threadId = options.threadId;
    }

    logger.info(
      {
        connectionId: options.connectionId,
        from: options.from,
        to: options.to,
        subject: options.subject,
        attachmentsCount: options.attachments?.length || 0,
        rawPayloadBytes: raw.length,
        threadId: options.threadId || undefined
      },
      'Posting MIME message to Gmail REST API users.me.messages.send'
    );

    let res: Response;
    try {
      res = await this.transportFn(GMAIL_SEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sendPayload)
      });
    } catch (netErr: any) {
      // Network disconnect / socket error during sending
      logger.error(
        {
          netErr,
          connectionId: options.connectionId,
          to: options.to
        },
        'Network error contacting Gmail API'
      );
      throw new EmailDomainError(
        'AMBIGUOUS_SEND_TIMEOUT',
        `Network failure while contacting Gmail API: ${netErr.message}`,
        false,
        false,
        'ambiguous_network'
      );
    }

    const body: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg = body?.error?.message || 'unknown error';
      const errorDetails = body?.error?.errors ? JSON.stringify(body.error.errors) : '';
      const fullErrorText = errorDetails ? `${errorMsg} (details: ${errorDetails})` : errorMsg;

      logger.error(
        {
          status: res.status,
          connectionId: options.connectionId,
          to: options.to,
          error: body?.error
        },
        'Gmail messages.send returned error response'
      );

      if (res.status === 401 || res.status === 403) {
        await GoogleConnectionModel.updateOne(
          { _id: options.connectionId },
          {
            $set: {
              gmailStatus: 'reauth_required',
              status: 'reauth_required',
              lastError: fullErrorText || 'Gmail authorization expired or revoked'
            }
          }
        );
        throw new EmailDomainError(
          'MAILBOX_REAUTH_REQUIRED',
          `Gmail authorization expired or was revoked (${fullErrorText}). Please reconnect the mailbox.`,
          true,
          false,
          'authentication'
        );
      }

      if (res.status === 429 || body?.error?.status === 'RESOURCE_EXHAUSTED') {
        throw new EmailDomainError(
          'SENDER_RATE_LIMITED',
          `Gmail API rate limit exceeded for sender "${connection.email}": ${fullErrorText}. Please back off before retrying.`,
          false,
          true,
          'rate_limit'
        );
      }

      if (res.status === 400) {
        throw new EmailDomainError(
          'INVALID_RECIPIENT',
          `Gmail rejected message as invalid request: ${fullErrorText}`,
          false,
          false,
          'invalid_request'
        );
      }

      if (res.status >= 500) {
        throw new EmailDomainError(
          'TRANSIENT_NETWORK_ERROR',
          `Gmail API temporary server error (HTTP ${res.status}): ${fullErrorText}`,
          false,
          true,
          'transient_server_error'
        );
      }

      throw new EmailDomainError(
        'EMAIL_SEND_FAILED',
        `Gmail send failed (HTTP ${res.status}): ${fullErrorText}`,
        false,
        false,
        'permanent_provider_error'
      );
    }

    logger.info(
      {
        connectionId: options.connectionId,
        messageId: body.id,
        threadId: body.threadId,
        to: options.to
      },
      'Gmail REST API accepted message successfully'
    );

    return {
      messageId: body.id || '',
      threadId: body.threadId || null
    };
  }

  /**
   * Fetches the web signature configured in Gmail for the user's sendAs address.
   * First queries the direct sendAs endpoint by email; falls back to listing all sendAs aliases.
   */
  public async getSendAsSignature(connectionId: string, email: string): Promise<string | null> {
    try {
      const accessToken = await this.authService.getValidAccessToken(connectionId);
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(email)}`;
      const res = await this.transportFn(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return data?.signature ? String(data.signature).trim() : null;
      }

      // Fallback: list all sendAs aliases to match lowercase, primary, or default
      const listUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs';
      const listRes = await this.transportFn(listUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!listRes.ok) return null;
      const listData: any = await listRes.json().catch(() => ({}));
      const sendAsList: any[] = Array.isArray(listData?.sendAs) ? listData.sendAs : [];
      const norm = (email || '').toLowerCase().trim();
      const match =
        sendAsList.find((s) => (s.sendAsEmail || '').toLowerCase().trim() === norm) ||
        sendAsList.find((s) => s.isPrimary || s.isDefault) ||
        sendAsList[0];

      return match?.signature ? String(match.signature).trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Searches Gmail sent folder with collision-resistant criteria for send reconciliation.
   */
  public async searchSentMessages(
    connectionId: string,
    query: {
      recipientEmail: string;
      senderEmail: string;
      subject: string;
      afterTimestampSec?: number;
      beforeTimestampSec?: number;
    }
  ): Promise<Array<{ id: string; threadId: string }>> {
    const accessToken = await this.authService.getValidAccessToken(connectionId);
    // Sanitize subject for Gmail search syntax
    const cleanSubject = query.subject.replace(/["\\]/g, ' ').trim();
    let q = `in:sent to:${query.recipientEmail} from:${query.senderEmail} subject:"${cleanSubject}"`;
    if (query.afterTimestampSec) q += ` after:${query.afterTimestampSec}`;
    if (query.beforeTimestampSec) q += ` before:${query.beforeTimestampSec}`;

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=10`;
    const res = await this.transportFn(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new EmailDomainError('GMAIL_SEARCH_FAILED', `Gmail message search failed: ${res.status} ${errText}`);
    }

    const data: any = await res.json().catch(() => ({}));
    if (!Array.isArray(data?.messages)) return [];
    return data.messages.map((m: any) => ({
      id: String(m.id || ''),
      threadId: String(m.threadId || '')
    }));
  }

  /**
   * Lists messages received in mailbox matching an optional query or timestamp window.
   */
  public async listInboundMessages(
    connectionId: string,
    query: { afterTimestampSec?: number; maxResults?: number; q?: string } = {}
  ): Promise<Array<{ id: string; threadId: string }>> {
    const accessToken = await this.authService.getValidAccessToken(connectionId);
    let q = query.q || 'is:inbox';
    if (query.afterTimestampSec) q += ` after:${query.afterTimestampSec}`;
    const maxResults = query.maxResults || 20;

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`;
    const res = await this.transportFn(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new EmailDomainError('GMAIL_INBOUND_LIST_FAILED', `Gmail list inbound failed: ${res.status} ${errText}`);
    }

    const data: any = await res.json().catch(() => ({}));
    if (!Array.isArray(data?.messages)) return [];
    return data.messages.map((m: any) => ({
      id: String(m.id || ''),
      threadId: String(m.threadId || '')
    }));
  }

  /**
   * Fetches full message payload, headers, and body content for a specific messageId.
   */
  public async getMessage(
    connectionId: string,
    messageId: string
  ): Promise<GmailMessageDetail | null> {
    const accessToken = await this.authService.getValidAccessToken(connectionId);
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
    const res = await this.transportFn(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      const errText = await res.text().catch(() => '');
      throw new EmailDomainError('GMAIL_GET_MESSAGE_FAILED', `Gmail getMessage failed: ${res.status} ${errText}`);
    }

    const data: any = await res.json().catch(() => ({}));
    if (!data?.id) return null;

    const headersList: any[] = Array.isArray(data.payload?.headers) ? data.payload.headers : [];
    const getHeader = (name: string): string => {
      const h = headersList.find((x) => (x.name || '').toLowerCase() === name.toLowerCase());
      return h?.value ? String(h.value).trim() : '';
    };

    const referencesHeader = getHeader('References');
    const references = referencesHeader
      ? referencesHeader.split(/\s+/).map((r) => r.trim()).filter(Boolean)
      : [];

    const { text, html, hasAttachments, attachmentCount } = extractBodyParts(data.payload);

    return {
      id: String(data.id),
      threadId: String(data.threadId || ''),
      snippet: data.snippet ? String(data.snippet) : undefined,
      internalDate: data.internalDate ? new Date(Number(data.internalDate)) : new Date(),
      headers: {
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        messageId: getHeader('Message-ID') || undefined,
        inReplyTo: getHeader('In-Reply-To') || undefined,
        references,
        date: getHeader('Date') || undefined
      },
      bodyText: text,
      bodyHtml: html,
      hasAttachments,
      attachmentCount
    };
  }
}

export interface GmailMessageDetail {
  id: string;
  threadId: string;
  snippet?: string | undefined;
  internalDate: Date;
  headers: {
    from: string;
    to: string;
    subject: string;
    messageId?: string | undefined;
    inReplyTo?: string | undefined;
    references?: string[] | undefined;
    date?: string | undefined;
  };
  bodyText?: string | undefined;
  bodyHtml?: string | undefined;
  hasAttachments: boolean;
  attachmentCount: number;
}

function extractBodyParts(payload: any): {
  text?: string | undefined;
  html?: string | undefined;
  hasAttachments: boolean;
  attachmentCount: number;
} {
  let text = '';
  let html = '';
  let attachmentCount = 0;

  function traverse(part: any) {
    if (!part) return;
    const mimeType = (part.mimeType || '').toLowerCase();
    const filename = part.filename;

    if (filename && filename.length > 0) {
      attachmentCount++;
    }

    if (part.body && part.body.data) {
      try {
        const decoded = Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
        if (mimeType === 'text/plain' && !text) {
          text = decoded;
        } else if (mimeType === 'text/html' && !html) {
          html = decoded;
        }
      } catch {}
    }

    if (Array.isArray(part.parts)) {
      for (const p of part.parts) {
        traverse(p);
      }
    }
  }

  traverse(payload);
  return {
    text: text || undefined,
    html: html || undefined,
    hasAttachments: attachmentCount > 0,
    attachmentCount
  };
}
