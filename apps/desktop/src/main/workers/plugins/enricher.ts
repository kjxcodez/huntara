import dns from 'dns';
import { promisify } from 'util';
import type { JobContext } from '../../../shared/types/job';
import { SdkClient } from '@huntara/sdk';
import { resolveWorkerApiUrl } from '../worker-env';

const resolveMxAsync = promisify(dns.resolveMx);

interface ContactRecord {
  id: string;
  companyId: string | null;
  email: string | null;
  sourceUrl: string | null;
  phone: string | null;
}

/**
 * Normalizes email by trimming, converting to lower-case, and stripping RFC-style display names.
 */
function normalizeEmail(raw: string | null): string {
  if (!raw) return '';
  let email = raw.trim().toLowerCase();
  const match = email.match(/<([^>]+)>/);
  if (match && match[1]) email = match[1].trim();
  return email;
}

/**
 * Phase 10: Checks domain MX routability without falsely claiming mailbox verification.
 * Invariant: Never represent an email as "verified" merely because MX records exist.
 */
async function checkDomainMx(email: string): Promise<{
  mxStatus: 'mx_valid' | 'mx_missing' | 'failed' | 'risky';
  confidence: number;
  mxDomain: string | null;
}> {
  const parts = email.split('@');
  if (parts.length !== 2) {
    return { mxStatus: 'failed', confidence: 0, mxDomain: null };
  }
  const domain = parts[1];
  if (!domain) {
    return { mxStatus: 'failed', confidence: 0, mxDomain: null };
  }

  try {
    const records = await resolveMxAsync(domain);
    if (!records || records.length === 0) {
      return { mxStatus: 'mx_missing', confidence: 0.9, mxDomain: null };
    }

    const primaryMx = records.sort((a: { priority: number }, b: { priority: number }) => a.priority - b.priority)[0]?.exchange.toLowerCase() || '';

    if (
      primaryMx.includes('pphosted.com') ||
      primaryMx.includes('mimecast.com') ||
      primaryMx.includes('barracudanetworks.com')
    ) {
      return { mxStatus: 'risky', confidence: 0.7, mxDomain: primaryMx };
    }

    return { mxStatus: 'mx_valid', confidence: 0.85, mxDomain: primaryMx };
  } catch {
    return { mxStatus: 'failed', confidence: 0, mxDomain: null };
  }
}

/**
 * Extracts candidate firstName and lastName from personal email addresses.
 */
function extractNameFromEmail(
  email: string,
  type: 'personal' | 'generic' | 'role_based'
): {
  firstName: string | null;
  lastName: string | null;
} {
  if (type !== 'personal') return { firstName: null, lastName: null };
  const localPart = email.split('@')[0] || '';
  const parts = localPart.split(/[._-]/).filter(Boolean);

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  if (parts.length >= 2 && parts[0] && parts[parts.length - 1]) {
    return {
      firstName: capitalize(parts[0]!),
      lastName: capitalize(parts[parts.length - 1]!)
    };
  }

  if (parts.length === 1 && parts[0] && parts[0].length >= 3) {
    return {
      firstName: capitalize(parts[0]),
      lastName: null
    };
  }

  return { firstName: null, lastName: null };
}

/**
 * Classifies an email address.
 */
function classifyEmail(email: string): {
  type: 'personal' | 'generic' | 'role_based';
  confidence: number;
} {
  const lower = email.toLowerCase();
  const localPart = lower.split('@')[0] || '';

  const rolePrefixes = [
    'info',
    'sales',
    'marketing',
    'admin',
    'office',
    'team',
    'hello',
    'contact',
    'press',
    'media',
    'careers',
    'jobs',
    'hr',
    'legal'
  ];

  if (rolePrefixes.includes(localPart)) {
    return { type: 'role_based', confidence: 0.65 };
  }

  if (localPart.length <= 2 || /^\d+$/.test(localPart)) {
    return { type: 'generic', confidence: 0.4 };
  }

  if (/^[a-z]+[._-][a-z]+$/i.test(localPart)) {
    return { type: 'personal', confidence: 0.95 };
  }

  return { type: 'personal', confidence: 0.8 };
}

/**
 * Website Enrichment Worker Plugin (Phase 7 - API/MongoDB-First).
 * Enriches candidate contacts via SdkClient without local SQLite business storage.
 */
export async function enrichWebsite(ctx: JobContext): Promise<any> {
  const companyId = ctx.payload.companyId as string | undefined;

  ctx.emitLog(
    `Initializing Website Contact Enricher plugin. Workspace: ${ctx.workspaceId} | Target Company: ${companyId || 'ALL'}`,
    'info'
  );

  // Initialize SdkClient for authoritative API/MongoDB persistence
  const apiUrl = resolveWorkerApiUrl(ctx);
  const authToken = ctx.payload._secrets?.sessionToken || process.env.HUNTARA_API_TOKEN || process.env.LEADFORGE_API_TOKEN || '';
  const sdk = new SdkClient({
    baseUrl: apiUrl,
    token: authToken,
    headers: {
      'x-workspace-id': ctx.workspaceId
    }
  });

  const checkpoint = ctx.getCheckpoint();
  const processedContacts = new Set<string>();
  let currentIndex = 0;
  if (checkpoint) {
    checkpoint.processedContacts?.forEach((id: string) => processedContacts.add(id));
    currentIndex = checkpoint.currentIndex || 0;
    ctx.emitLog(
      `Resuming enrichment from checkpoint. Processed: ${processedContacts.size} contacts.`,
      'info'
    );
  }

  try {
    // 1. Fetch contacts requiring enrichment from API
    let rawContacts: any[] = [];
    if (companyId) {
      const res = await sdk.contacts.list({ companyId });
      rawContacts = Array.isArray(res) ? res : [];
    } else {
      const res = await sdk.contacts.list({});
      rawContacts = Array.isArray(res) ? res : [];
    }

    const contacts: ContactRecord[] = rawContacts.map((c) => ({
      id: c.id,
      companyId: c.companyId || null,
      email: c.email || null,
      sourceUrl: c.customFields?.sourceUrl || null,
      phone: c.phone || null
    }));

    if (contacts.length === 0) {
      ctx.emitLog('No contacts found requiring enrichment.', 'info');
      return { enrichedCount: 0 };
    }

    ctx.emitLog(
      `Retrieved ${contacts.length} candidate contacts for enrichment. Checking duplicates...`,
      'info'
    );

    // 2. Duplicate detection
    const seenEmails = new Map<string, string>();
    const duplicatesToDelete: string[] = [];

    for (const c of contacts) {
      const norm = normalizeEmail(c.email);
      if (norm) {
        if (seenEmails.has(norm)) {
          duplicatesToDelete.push(c.id);
        } else {
          seenEmails.set(norm, c.id);
        }
      }
    }

    if (duplicatesToDelete.length > 0) {
      ctx.emitLog(`Removing ${duplicatesToDelete.length} duplicate contacts via API...`, 'info');
      for (const dupId of duplicatesToDelete) {
        try {
          await sdk.contacts.delete(dupId);
        } catch {}
      }
    }

    const validContacts = contacts.filter((c) => !duplicatesToDelete.includes(c.id));
    let enrichedCount = 0;

    // 3. Process remaining contacts
    for (let i = currentIndex; i < validContacts.length; i++) {
      if (ctx.isCancelled()) {
        ctx.emitLog('Enricher received cancellation signal. Terminating.', 'warn');
        break;
      }

      if (ctx.isPaused()) {
        ctx.emitLog('Enricher received pause signal. Saving checkpoint.', 'warn');
        ctx.saveCheckpoint({
          processedContacts: Array.from(processedContacts),
          currentIndex: i
        });
        throw new Error('Job paused.');
      }

      const contact = validContacts[i];
      if (!contact || processedContacts.has(contact.id)) continue;

      const normEmail = normalizeEmail(contact.email);
      if (!normEmail) {
        processedContacts.add(contact.id);
        continue;
      }

      try {
        const { mxStatus, confidence, mxDomain } = await checkDomainMx(normEmail);
        const { type } = classifyEmail(normEmail);
        const { firstName, lastName } = extractNameFromEmail(normEmail, type);

        // Update contact record via API
        await sdk.contacts.update(contact.id, {
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          notes: `[Enriched] mxDomain=${mxDomain || 'N/A'}, mxStatus=${mxStatus}, confidence=${confidence}`
        });

        enrichedCount++;
        processedContacts.add(contact.id);
        ctx.emitLog(
          `Enriched contact ${contact.id} (${normEmail}): MX Status: ${mxStatus} | Confidence: ${confidence}`,
          'info'
        );
      } catch (err: any) {
        ctx.emitLog(`Failed to enrich contact ${contact.id}: ${err.message || err}`, 'warn');
      }

      const progress = Math.round(((i + 1) / validContacts.length) * 100);
      ctx.updateProgress(progress, {
        current: i + 1,
        total: validContacts.length,
        entity: normEmail,
        description: `Enriched ${enrichedCount} of ${validContacts.length} contacts`
      });

      if ((i + 1) % 5 === 0) {
        ctx.saveCheckpoint({
          processedContacts: Array.from(processedContacts),
          currentIndex: i + 1
        });
      }
    }

    ctx.updateProgress(100, { description: `Enrichment completed: ${enrichedCount} contacts enriched` });
    ctx.emitLog(`Enrichment complete. Total contacts enriched: ${enrichedCount}`, 'info');
    return { enrichedCount };
  } catch (err: any) {
    if (err.message === 'Job paused.' || err.message === 'Job cancelled.') {
      throw err;
    }
    ctx.emitLog(`Fatal error in enricher: ${err.message || err}`, 'error');
    throw err;
  }
}
