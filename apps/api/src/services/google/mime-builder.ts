import { EmailDomainError } from '../email/types.js';

/**
 * RFC 2822 / MIME message builder for Gmail API.
 * Produces base64url-encoded strings suitable for Gmail's messages.send endpoint.
 */

export const MAX_GMAIL_RAW_MESSAGE_BYTES = 25 * 1024 * 1024; // 25 MB

export interface MimeAttachment {
  filename: string;
  contentType?: string | undefined;
  data: Buffer | string; // Buffer or Base64 string
}

export interface MimeMessageOptions {
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
}

export class MimeBuilder {
  /**
   * Sanitizes header values to prevent CRLF Header Injection attacks.
   */
  public static sanitizeHeader(value: string | undefined, headerName: string): string {
    if (!value) return '';
    if (/[\r\n]/.test(value)) {
      throw new EmailDomainError(
        'HEADER_INJECTION_DETECTED',
        `Header injection detected in ${headerName}: disallowed CRLF characters.`
      );
    }
    return value.trim();
  }

  /**
   * Encodes a string (e.g. subject, display name) using RFC 2047 UTF-8 Base64 format if non-ASCII.
   */
  public static encodeHeaderValue(value: string): string {
    // If entirely ASCII without special characters, return as is
    if (/^[\x20-\x7E]+$/.test(value) && !value.includes('=?')) {
      return value;
    }
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }

  /**
   * Encodes address with display name (e.g. "John Doe <john@example.com>") safely.
   */
  public static encodeAddress(rawAddress: string, headerName: string): string {
    const clean = MimeBuilder.sanitizeHeader(rawAddress, headerName);
    const match = clean.match(/^(.*?)\s*<([^>]+)>$/);
    if (match && match[1] !== undefined && match[2] !== undefined) {
      const displayName = match[1].trim().replace(/^["']|["']$/g, '');
      const email = match[2].trim();
      if (displayName) {
        const encodedName = MimeBuilder.encodeHeaderValue(displayName);
        return `"${encodedName}" <${email}>`;
      }
      return `<${email}>`;
    }
    return clean;
  }

  /**
   * Encodes and line-wraps base64 payload at 76 characters per RFC 2045 with CRLF line breaks.
   */
  public static formatBase64(data: Buffer | string): string {
    let base64Data: string;
    if (Buffer.isBuffer(data)) {
      base64Data = data.toString('base64');
    } else if (typeof data === 'string' && data.length > 0) {
      const trimmed = data.trim();
      base64Data = /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length % 4 === 0
        ? trimmed.replace(/[\r\n]/g, '')
        : Buffer.from(data, 'utf8').toString('base64');
    } else {
      return '';
    }
    return base64Data.match(/.{1,76}/g)?.join('\r\n') || base64Data;
  }

  /**
   * Enforces RFC 2822 angle bracket formatting around a message identifier.
   * Ensures `<id>` format and strips leading/trailing spaces.
   */
  public static formatMessageId(msgId: string): string {
    const trimmed = msgId.trim();
    if (!trimmed) return '';
    return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed : `<${trimmed}>`;
  }

  /**
   * Constructs an RFC 2822 compliant message and encodes it as Base64URL without padding.
   */
  public static buildRaw(options: MimeMessageOptions): string {
    const from = MimeBuilder.encodeAddress(options.from, 'From');
    const to = MimeBuilder.encodeAddress(options.to, 'To');
    const cc = options.cc ? MimeBuilder.encodeAddress(options.cc, 'Cc') : undefined;
    const bcc = options.bcc ? MimeBuilder.encodeAddress(options.bcc, 'Bcc') : undefined;

    const rawSubject = MimeBuilder.sanitizeHeader(options.subject, 'Subject');
    const encodedSubject = MimeBuilder.encodeHeaderValue(rawSubject);

    const hasAttachments = Array.isArray(options.attachments) && options.attachments.length > 0;
    const mixedBoundary = options.mixedBoundary || `----=_Part_Mixed_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const altBoundary = options.altBoundary || `----=_Part_Alt_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    const headers: string[] = [
      `From: ${from}`,
      `To: ${to}`
    ];

    if (cc) headers.push(`Cc: ${cc}`);
    if (bcc) headers.push(`Bcc: ${bcc}`);
    headers.push(`Subject: ${encodedSubject}`);

    if (options.messageId) {
      const cleanMsgId = MimeBuilder.sanitizeHeader(options.messageId, 'Message-ID');
      const formatted = MimeBuilder.formatMessageId(cleanMsgId);
      if (formatted) headers.push(`Message-ID: ${formatted}`);
    }

    if (options.inReplyTo) {
      const cleanInReplyTo = MimeBuilder.sanitizeHeader(options.inReplyTo, 'In-Reply-To');
      const formatted = MimeBuilder.formatMessageId(cleanInReplyTo);
      if (formatted) headers.push(`In-Reply-To: ${formatted}`);
    }

    if (options.references) {
      let rawRefs: string[];
      if (Array.isArray(options.references)) {
        rawRefs = options.references;
      } else {
        rawRefs = options.references.split(/\s+/).filter(Boolean);
      }
      const formattedRefs = rawRefs
        .map((ref) => MimeBuilder.sanitizeHeader(ref, 'References'))
        .map((ref) => MimeBuilder.formatMessageId(ref))
        .filter(Boolean);
      if (formattedRefs.length > 0) {
        headers.push(`References: ${formattedRefs.join(' ')}`);
      }
    }

    headers.push('MIME-Version: 1.0');

    let mimeContent = '';

    if (hasAttachments) {
      headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
      const mixedParts: string[] = [];

      // Part 1: multipart/alternative (text + html)
      const altParts: string[] = [];
      if (options.text) {
        altParts.push(
          [
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            MimeBuilder.formatBase64(Buffer.from(options.text, 'utf8'))
          ].join('\r\n')
        );
      }
      if (options.html) {
        altParts.push(
          [
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            MimeBuilder.formatBase64(Buffer.from(options.html, 'utf8'))
          ].join('\r\n')
        );
      }

      if (altParts.length > 0) {
        mixedParts.push(
          [
            `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
            '',
            `--${altBoundary}`,
            altParts.join(`\r\n--${altBoundary}\r\n`),
            `--${altBoundary}--`
          ].join('\r\n')
        );
      }

      // Part 2+: Attachments
      for (const att of options.attachments || []) {
        const rawFilename = MimeBuilder.sanitizeHeader(att.filename, 'attachment filename');
        const encodedFilename = MimeBuilder.encodeHeaderValue(rawFilename);
        const contentType = att.contentType || (att as any).mimeType || 'application/octet-stream';

        const rawData = att.data ?? (att as any).contentBase64 ?? (att as any).content;

        if (Buffer.isBuffer(rawData) && rawData.length === 0) {
          throw new EmailDomainError('ATTACHMENT_BINARY_EMPTY', `Attachment "${rawFilename}" binary data is empty.`);
        }
        if (typeof rawData === 'string' && rawData.trim().length === 0) {
          throw new EmailDomainError('ATTACHMENT_BINARY_EMPTY', `Attachment "${rawFilename}" binary data is empty or missing.`);
        }
        if (!rawData) {
          throw new EmailDomainError('ATTACHMENT_BINARY_EMPTY', `Attachment "${rawFilename}" binary data is empty or missing.`);
        }

        const chunkedBase64 = MimeBuilder.formatBase64(rawData);

        mixedParts.push(
          [
            `Content-Type: ${contentType}; name="${encodedFilename}"`,
            `Content-Disposition: attachment; filename="${encodedFilename}"`,
            'Content-Transfer-Encoding: base64',
            '',
            chunkedBase64
          ].join('\r\n')
        );
      }

      mimeContent = [
        headers.join('\r\n'),
        '',
        `--${mixedBoundary}`,
        mixedParts.join(`\r\n--${mixedBoundary}\r\n`),
        `--${mixedBoundary}--`
      ].join('\r\n');
    } else {
      // No attachments: direct multipart/alternative or simple part
      const altParts: string[] = [];
      if (options.text) {
        altParts.push(
          [
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            MimeBuilder.formatBase64(Buffer.from(options.text, 'utf8'))
          ].join('\r\n')
        );
      }
      if (options.html) {
        altParts.push(
          [
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            MimeBuilder.formatBase64(Buffer.from(options.html, 'utf8'))
          ].join('\r\n')
        );
      }

      if (altParts.length > 1) {
        headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
        mimeContent = [
          headers.join('\r\n'),
          '',
          `--${altBoundary}`,
          altParts.join(`\r\n--${altBoundary}\r\n`),
          `--${altBoundary}--`
        ].join('\r\n');
      } else if (options.html) {
        headers.push('Content-Type: text/html; charset=UTF-8');
        headers.push('Content-Transfer-Encoding: base64');
        mimeContent = [
          headers.join('\r\n'),
          '',
          MimeBuilder.formatBase64(Buffer.from(options.html, 'utf8'))
        ].join('\r\n');
      } else {
        headers.push('Content-Type: text/plain; charset=UTF-8');
        headers.push('Content-Transfer-Encoding: base64');
        mimeContent = [
          headers.join('\r\n'),
          '',
          MimeBuilder.formatBase64(Buffer.from(options.text || '', 'utf8'))
        ].join('\r\n');
      }
    }

    const byteLength = Buffer.byteLength(mimeContent, 'utf8');
    if (byteLength > MAX_GMAIL_RAW_MESSAGE_BYTES) {
      throw new EmailDomainError(
        'MESSAGE_SIZE_EXCEEDED',
        `MIME message size (${(byteLength / (1024 * 1024)).toFixed(2)} MB) exceeds the Gmail 25 MB limit.`
      );
    }

    // Gmail API requires Base64URL without padding (RFC 4648 §5)
    return Buffer.from(mimeContent, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
