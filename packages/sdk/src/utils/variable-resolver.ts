import crypto from 'crypto';
import {
  generateTrackingToken,
  injectOpenTrackingPixel,
  rewriteLinksForClickTracking,
  type ComposeMessageInput,
  type ComposeMessageResult
} from '@leadforge/schema';

/**
 * Canonical Variable Context structure for template rendering across LeadForge.
 */
export interface CanonicalVariableContext {
  contact?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    title?: string | null;
    phone?: string | null;
    status?: string | null;
    source?: string | null;
    [key: string]: any;
  } | null;
  company?: {
    id?: string;
    name?: string | null;
    domain?: string | null;
    industry?: string | null;
    size?: string | null;
    location?: string | null;
    status?: string | null;
    website?: string | null;
    [key: string]: any;
  } | null;
  workspace?: {
    id?: string;
    name?: string;
  } | null;
  sequence?: {
    id?: string;
    name?: string;
  } | null;
  execution?: {
    id?: string;
    currentStep?: number | string;
    startedAt?: string;
  } | null;
  sender?: {
    name?: string;
    email?: string;
  } | null;
  variables?: Record<string, any> | null;
  [key: string]: any;
}

/**
 * Resolves a single dotted path token (e.g. "contact.firstName", "company.name")
 * against a CanonicalVariableContext, with legacy token aliases fallback.
 */
export function resolveTokenPath(path: string, ctx: CanonicalVariableContext): string {
  const trimmed = (path || '').trim();
  if (!trimmed) return '';

  const dotIdx = trimmed.indexOf('.');
  const ns = dotIdx === -1 ? trimmed : trimmed.slice(0, dotIdx);
  const field = dotIdx === -1 ? '' : trimmed.slice(dotIdx + 1);

  const contact = ctx.contact || {};
  const company = ctx.company || {};
  const workspace = ctx.workspace || {};
  const sequence = ctx.sequence || {};
  const execution = ctx.execution || {};
  const sender = ctx.sender || {};
  const variables = ctx.variables || {};

  switch (ns) {
    case 'contact': {
      if (!field || field === 'name') {
        const full = `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
        return full || String(contact.email || '');
      }
      const val = contact[field];
      return val !== undefined && val !== null ? String(val) : '';
    }

    case 'company': {
      if (!field || field === 'name') {
        return String(company.name || '');
      }
      if (field === 'website' || field === 'domain') {
        return String(company.domain || company.website || '');
      }
      const val = company[field];
      return val !== undefined && val !== null ? String(val) : '';
    }

    case 'workspace': {
      if (field === 'name') return String(workspace.name || '');
      if (field === 'id') return String(workspace.id || '');
      return String(workspace.id || workspace.name || '');
    }

    case 'sequence': {
      if (field === 'name') return String(sequence.name || '');
      if (field === 'id') return String(sequence.id || '');
      return String(sequence.name || sequence.id || '');
    }

    case 'execution': {
      if (field === 'id') return String(execution.id || '');
      if (field === 'currentStep') return String(execution.currentStep ?? '');
      if (field === 'startedAt') return String(execution.startedAt || '');
      return '';
    }

    case 'sender': {
      if (field === 'name') return String(sender.name || '');
      if (field === 'email') return String(sender.email || '');
      return String(sender.name || sender.email || '');
    }

    case 'variables': {
      if (field.includes('.')) {
        const parts = field.split('.');
        let cur: any = variables;
        for (const p of parts) {
          if (cur === null || cur === undefined) return '';
          cur = cur[p];
        }
        return cur !== undefined && cur !== null ? String(cur) : '';
      }
      const val = variables[field];
      return val !== undefined && val !== null ? String(val) : '';
    }

    case 'today':
      return new Date().toISOString().split('T')[0] ?? '';

    case 'now':
      return new Date().toISOString();

    default: {
      // Legacy un-namespaced alias mappings
      const legacyMap: Record<string, () => string> = {
        firstName: () => String(contact.firstName || ''),
        lastName: () => String(contact.lastName || ''),
        fullName: () => `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        email: () => String(contact.email || ''),
        phone: () => String(contact.phone || ''),
        title: () => String(contact.title || ''),
        company: () => String(company.name || ''),
        website: () => String(company.domain || company.website || ''),
        domain: () => String(company.domain || company.website || ''),
        industry: () => String(company.industry || ''),
        location: () => String(company.location || ''),
        senderName: () => String(sender.name || 'Sales Director'),
        workspaceName: () => String(workspace.name || 'Workspace CRM'),
        sequence: () => String(sequence.name || ''),
        today: () => new Date().toISOString().split('T')[0] ?? '',
        now: () => new Date().toISOString()
      };

      if (trimmed in legacyMap) {
        return legacyMap[trimmed]!();
      }

      if (variables && trimmed in variables) {
        const val = variables[trimmed];
        return val !== undefined && val !== null ? String(val) : '';
      }

      return '';
    }
  }
}

export interface RenderVariableOptions {
  /** If true, substituted values are HTML-entity escaped to prevent injection. */
  isHtml?: boolean;
  /** Optional collector map to record every substituted token and resolved value. */
  captureSnapshot?: Record<string, string>;
}

/**
 * Escapes HTML-special characters (&, <, >, ", ') to prevent script/markup injection.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replaces all `{{token}}` occurrences in a template string using the CanonicalVariableContext.
 */
export function renderCanonicalVariables(
  template: string | null | undefined,
  ctx: CanonicalVariableContext,
  options?: RenderVariableOptions
): string {
  if (template === null || template === undefined) return '';
  if (typeof template !== 'string') return String(template);

  return template.replace(/\{\{([^}]+)\}\}/g, (_m, rawToken: string) => {
    const trimmed = rawToken.trim();
    const val = resolveTokenPath(trimmed, ctx);
    if (options?.captureSnapshot) {
      options.captureSnapshot[trimmed] = val;
    }
    return options?.isHtml ? escapeHtml(val) : val;
  });
}

/**
 * Extracts and captures a snapshot of all variable tokens in a template with their resolved values.
 */
export function captureVariablesSnapshot(
  template: string | null | undefined,
  ctx: CanonicalVariableContext
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  if (!template) return snapshot;
  renderCanonicalVariables(template, ctx, { captureSnapshot: snapshot });
  return snapshot;
}

/**
 * Extracts unique variable tokens found in a template string.
 */
export function extractTemplateVariables(template: string | null | undefined): string[] {
  if (!template || typeof template !== 'string') return [];
  const matches = template.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  const set = new Set<string>();
  for (const m of matches) {
    const raw = m.slice(2, -2).trim();
    if (raw) set.add(raw);
  }
  return Array.from(set);
}

/**
 * Converts a plain-text email body (with \n line breaks) into safe HTML suitable
 * for rendering in email clients (Gmail, Outlook, Apple Mail) with default Gmail-like typography.
 *
 * Conversion rules (applied in order):
 *  1. HTML-escape all special characters (&, <, >, ", ') to prevent XSS/injection.
 *  2. Collapse \r\n to \n for consistent handling.
 *  3. Split on double newlines (\n\n) to create paragraph blocks.
 *  4. Within each paragraph, convert single \n to <br/>.
 *  5. Wrap each paragraph in <p style="margin:0 0 16px 0;line-height:107%;">.
 *  6. Wrap the entire body in <div style="font-family:sans-serif;line-height:107%;">.
 *
 * @param text - Raw plain-text string (as stored in SQLite template body).
 * @returns Safe HTML string ready for use in a MIME text/html part.
 */
export function plainTextToHtml(text: string): string {
  if (!text) return '';

  // 1. Escape HTML entities
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // 2. Normalise line endings
  const normalised = escaped.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Split into paragraphs on blank lines (two or more consecutive newlines)
  const paragraphs = normalised.split(/\n{2,}/);

  // 4 & 5. Within each paragraph, convert single \n to <br/> and wrap with Outlook/Gmail MsoNormal typography
  const htmlParagraphs = paragraphs.map((para) => {
    const withBreaks = para.replace(/\n/g, '<br/>');
    return `<p class="MsoNormal" style="margin:0in 0in 8pt;line-height:107%;font-size:11pt;font-family:Calibri,sans-serif">${withBreaks}</p>`;
  });

  return `<div style="font-family:sans-serif;line-height:107%;">${htmlParagraphs.join('\n')}</div>`;
}

/**
 * Normalizes an email signature (e.g. from Gmail web settings).
 * - Decodes entity-escaped HTML (e.g. &lt;td&gt; wrapped in <pre><code>)
 * - Cleans nested linkifier artifacts in attributes
 * - Wraps bare <td> or <tr> table elements in a proper <table>
 */
export function normalizeEmailSignature(sig: string): string {
  if (!sig) return '';
  let result = sig.trim();

  // 1. Detect if signature contains escaped HTML tags (e.g. &lt;td, &lt;div, etc.)
  if (/&lt;\/?(td|tr|table|tbody|div|span|p|b|strong|i|em|a|img|br|hr|ul|ol|li)\b/i.test(result)) {
    // Strip wrapping <pre> and <code>
    result = result.replace(/<pre[^>]*>/gi, '').replace(/<\/pre>/gi, '');
    result = result.replace(/<code[^>]*>/gi, '').replace(/<\/code>/gi, '');

    // Clean up Gmail auto-linkifier inserting nested <a> tags inside attributes
    result = result.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, (_match, href, text) => {
      return text || href;
    });

    // Decode HTML entities
    result = result
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  result = result.trim();

  // 2. Unwrap outer <div> if it directly wraps bare <td or <tr
  if (/^<div[^>]*>\s*<(td|tr)\b/i.test(result)) {
    result = result.replace(/^<div[^>]*>/i, '').replace(/<\/div>$/i, '').trim();
  }

  // 3. If it contains <td or <tr without an enclosing <table, wrap in a table
  if (/<(td|tr)\b/i.test(result) && !/<table\b/i.test(result)) {
    if (!/<tr\b/i.test(result)) {
      result = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:0;"><tr>${result}</tr></table>`;
    } else {
      result = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:0;">${result}</table>`;
    }
  }

  return result;
}

/**
 * Ensures any outbound HTML email body is wrapped with default Gmail-like typography
 * (font-family: sans-serif; line-height: 107%;) at the root container level,
 * without duplicating existing wrappers.
 */
export function wrapHtmlWithDefaultTypography(html: string): string {
  if (!html) return '';
  const trimmed = html.trim();
  // If already wrapped with font-family:sans-serif and line-height:107%, don't duplicate
  if (
    trimmed.startsWith('<div') &&
    trimmed.includes('font-family:') &&
    trimmed.includes('sans-serif') &&
    trimmed.includes('line-height:107%')
  ) {
    return html;
  }
  return `<div style="font-family:sans-serif;line-height:107%;">${html}</div>`;
}

/**
 * Formats a plain-text email body into both text/plain and text/html MIME parts.
 *
 * Use this at the send boundary (worker plugins and API layer) so that:
 * - `text` is passed as the MIME text/plain part (preserves \n for plain-text clients).
 * - `html` is passed as the MIME text/html part (correct paragraph/line break rendering).
 *
 * @param body - Raw plain-text string as stored in SQLite.
 * @returns Object with `text` (unchanged) and `html` (safe HTML conversion).
 */
export function formatEmailBody(body: string): { text: string; html: string } {
  return {
    text: body,
    html: plainTextToHtml(body)
  };
}

/**
 * Sanitizes an email subject line:
 * 1. Strips all CRLF characters (\r, \n) to prevent email header injection attacks.
 * 2. Normalizes multiple consecutive whitespace characters to a single space.
 * 3. Enforces non-empty content and truncates to the RFC 5322 Section 2.1.1 maximum line limit (998 characters).
 */
export function sanitizeSubject(subject: string | null | undefined): {
  sanitized: string;
  isValid: boolean;
  error?: string;
} {
  if (subject === null || subject === undefined) {
    return { sanitized: '', isValid: false, error: 'Subject line cannot be empty.' };
  }
  // 1. Strip CRLF characters (\r, \n) to prevent email header injection
  let clean = subject.replace(/[\r\n]+/g, ' ');
  // 2. Collapse whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return { sanitized: '', isValid: false, error: 'Subject line cannot be empty.' };
  }
  // 3. RFC 5322 Section 2.1.1 maximum line length is 998 characters
  if (clean.length > 998) {
    clean = clean.substring(0, 998);
  }
  return { sanitized: clean, isValid: true };
}

/**
 * Converts an HTML email body into a clean, readable plain-text representation.
 * Used to populate the MIME text/plain part when an outbound template is HTML-only,
 * ensuring high deliverability and readable fallback on plain-text email clients.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  let text = html;
  // Convert break tags and paragraph tags to line endings
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  // Remove script and style elements
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Unescape common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
  // Normalize line endings and multiple blank lines
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export interface MessageFingerprintInput {
  workspaceId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  attachmentChecksums?: string[];
  templateId?: string | null;
  templateVersion?: number | null;
}

/**
 * Computes a deterministic SHA-256 fingerprint for outbound message content.
 * Guarantees that identical intended content yields the exact same fingerprint,
 * detecting accidental mutations and preserving audit evidence.
 */
export function computeMessageFingerprint(input: MessageFingerprintInput): string {
  const normalized = {
    workspaceId: input.workspaceId,
    sender: (input.senderEmail || '').toLowerCase().trim(),
    recipient: (input.recipientEmail || '').toLowerCase().trim(),
    subject: (input.subject || '').trim(),
    text: (input.textBody || '').trim(),
    html: (input.htmlBody || '').trim(),
    attachments: (input.attachmentChecksums || []).slice().sort(),
    templateId: input.templateId || null,
    templateVersion: input.templateVersion ?? null
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Computes deterministic SHA-256 checksums for attachments participating in canonical message identity.
 * Handles buffers, base64 data, Google Drive identifiers, and metadata fallbacks.
 * Sorts checksums alphabetically to ensure attachment ordering invariance.
 */
export function computeAttachmentChecksums(attachments?: any[] | null): string[] {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  const checksums: string[] = attachments.map((a) => {
    if (!a) return crypto.createHash('sha256').update('null').digest('hex');
    if (a.sha256 && typeof a.sha256 === 'string' && a.sha256.length === 64) {
      return a.sha256;
    }
    if (a.data && Buffer.isBuffer(a.data)) {
      return crypto.createHash('sha256').update(a.data).digest('hex');
    }
    const rawData = (a as any).contentBase64 ?? (a as any).content;
    if (typeof rawData === 'string' && rawData.trim().length > 0) {
      return crypto.createHash('sha256').update(Buffer.from(rawData, 'base64')).digest('hex');
    }
    const fileId = a.fileId || a.id;
    if (fileId) {
      const filename = a.filename || 'attachment';
      const size = a.size || 0;
      return crypto.createHash('sha256').update(`${filename}:${fileId}:${size}`).digest('hex');
    }
    const filename = a.filename || 'unknown';
    const size = a.size || 0;
    return crypto.createHash('sha256').update(`${filename}:${size}`).digest('hex');
  });

  return checksums.sort();
}

/**
 * Unified canonical composition engine for outbound messages.
 * Deterministically binds templates, resolves variables with HTML entity safety,
 * sanitizes subjects, renders typography, appends signatures, executes tracking
 * transformations with token idempotency, and calculates content fingerprints.
 */
export function composeOutboundMessage(input: ComposeMessageInput): ComposeMessageResult {
  // 1. Resolve raw subject and body
  const rawSubject = input.subject ?? input.template?.subject ?? '';
  const rawBody = input.body ?? input.template?.body ?? '';
  const templateId = input.template?.id || null;
  const templateVersion = input.template?.version || null;

  // 2. Build CanonicalVariableContext
  const ctx: CanonicalVariableContext = {
    ...input.context,
    contact: {
      ...(input.context?.contact || {}),
      email: input.recipient.email,
      firstName: input.recipient.firstName ?? input.context?.contact?.firstName,
      lastName: input.recipient.lastName ?? input.context?.contact?.lastName
    },
    sender: {
      name: input.sender.name || 'LeadForge',
      email: input.sender.email
    },
    workspace: {
      id: input.workspaceId
    }
  };

  // 3. Render subject line (plain text, no HTML escaping) and sanitize for CRLF
  const variablesSnapshot: Record<string, string> = {};
  const renderedSubject = renderCanonicalVariables(rawSubject, ctx, {
    isHtml: false,
    captureSnapshot: variablesSnapshot
  });
  const subjectCheck = sanitizeSubject(renderedSubject);
  const finalSubject = subjectCheck.isValid ? subjectCheck.sanitized : renderedSubject.replace(/[\r\n]+/g, ' ').trim();

  // 4. Determine if template is HTML or plain text
  const isHtml = input.isHtml ?? /<(?:p|div|br|span|table|h[1-6]|a)\b/i.test(rawBody);

  // 5. Render body
  const renderedBody = renderCanonicalVariables(rawBody, ctx, {
    isHtml,
    captureSnapshot: variablesSnapshot
  });

  let textBody = '';
  let htmlBody = '';

  if (isHtml) {
    htmlBody = wrapHtmlWithDefaultTypography(renderedBody);
    textBody = htmlToPlainText(renderedBody);
  } else {
    const formatted = formatEmailBody(renderedBody);
    textBody = formatted.text;
    htmlBody = formatted.html;
  }

  // 6. Signature handling
  if (input.useSignature !== false && input.sender.signatureHtml && htmlBody) {
    const cleanSig = normalizeEmailSignature(input.sender.signatureHtml);
    if (cleanSig && !htmlBody.includes('class="gmail_signature"')) {
      htmlBody = `${htmlBody}<br/><span class="gmail_signature_prefix">-- </span><br/><div class="gmail_signature" dir="ltr" data-smartmail="gmail_signature">${cleanSig}</div>`;
    }
  }

  // 7. Calculate canonical attachment checksums
  const attachments = input.attachments || [];
  const attachmentChecksums = computeAttachmentChecksums(attachments);

  // 8. Canonical Message Fingerprint
  // Evaluated over canonical authored content BEFORE dynamic tracking tokens are injected.
  // Tracking tokens (pixel nonces, redirect tokens) are delivery instrumentation, not part of
  // the authored content. Computing fingerprint on canonical pre-tracking content guarantees
  // preview and delivery fingerprint parity and ensures retries retain identical content identity.
  const messageFingerprint = computeMessageFingerprint({
    workspaceId: input.workspaceId,
    senderEmail: input.sender.email,
    recipientEmail: input.recipient.email,
    subject: finalSubject,
    textBody,
    htmlBody,
    attachmentChecksums,
    templateId,
    templateVersion
  });

  // 9. Tracking transformations
  // Tracking is strictly opt-in. When trackingEnabled === false, no tracking tokens or transformations are applied.
  // In unit test scenarios where trackingBaseUrl is explicitly supplied without a trackingEnabled flag,
  // tracking is active only if trackingBaseUrl is present and trackingEnabled !== false.
  const isTrackingEnabled = input.trackingEnabled !== undefined
    ? Boolean(input.trackingEnabled)
    : Boolean(input.trackingBaseUrl);

  const trackingBaseUrl = input.trackingBaseUrl || '';
  let openTrackingToken = '';
  let clickTrackingTokens: Array<{ token: string; targetUrl: string }> = [];

  if (isTrackingEnabled && htmlBody && trackingBaseUrl) {
    openTrackingToken = input.existingTracking?.openTrackingToken || '';
    clickTrackingTokens = input.existingTracking?.clickTrackingTokens
      ? [...input.existingTracking.clickTrackingTokens]
      : [];

    if (!clickTrackingTokens || clickTrackingTokens.length === 0) {
      const clickRes = rewriteLinksForClickTracking(htmlBody, trackingBaseUrl);
      htmlBody = clickRes.rewrittenHtml;
      clickTrackingTokens = clickRes.tokens;
    }

    if (!openTrackingToken) {
      openTrackingToken = generateTrackingToken();
      htmlBody = injectOpenTrackingPixel(htmlBody, trackingBaseUrl, openTrackingToken);
    }
  }

  return {
    subject: finalSubject,
    htmlBody,
    textBody,
    variablesSnapshot,
    openTrackingToken,
    clickTrackingTokens,
    attachments,
    messageFingerprint,
    templateId,
    templateVersion
  };
}
