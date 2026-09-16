import type { JobContext } from '../../../shared/types/job';
import { SdkClient, renderCanonicalVariables, formatEmailBody, captureVariablesSnapshot, type CanonicalVariableContext } from '@leadforge/sdk';
import { generateEntityId, evaluateOutreachEligibility } from '@leadforge/schema';
import { resolveWorkerApiUrl } from '../worker-env';

interface ContactRecord {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  title: string | null;
  status: string | null;
  emailStatus?: string | null;
  emailMeta?: any;
  companyId: string | null;
}

interface OutreachCheckpoint {
  processedContactIds: string[];
  dispatchedCount: number;
  failureCount: number;
  skippedCount: number;
  currentIndex: number;
}

/**
 * Outreach Campaign Dispatcher Job Plugin (Phase 7 - API/MongoDB-First).
 * Dispatches outreach emails through the API-owned EmailService via SdkClient.
 */
export async function dispatchOutreach(ctx: JobContext): Promise<any> {
  const campaignId: string = ctx.payload.campaignId || '';
  if (!campaignId) {
    throw new Error('Missing required payload field: campaignId.');
  }

  ctx.emitLog(`Initializing API-owned outreach dispatcher for Campaign: ${campaignId}`, 'info');

  // Initialize SDK client for API communication
  const apiUrl = resolveWorkerApiUrl(ctx);
  const authToken = ctx.payload._secrets?.sessionToken || process.env.LEADFORGE_API_TOKEN || '';
  const sdk = new SdkClient({
    baseUrl: apiUrl,
    token: authToken,
    headers: {
      'x-workspace-id': ctx.workspaceId
    }
  });

  // 1. Load email account from API
  const accounts = await sdk.outreach.listAccounts();
  const account = accounts.find((a: any) => a.status === 'connected') || accounts[0];

  if (!account) {
    throw new Error('No connected email account found in workspace. Please connect an email account in Settings → Email Accounts.');
  }

  const accountId = account.id;
  ctx.emitLog(`Using email account ${account.email} (id: ${accountId}) for outreach`, 'info');

  // 2. Load campaign from API
  let campaign: any = null;
  try {
    campaign = await sdk.campaigns.get(campaignId);
  } catch {
    campaign = { id: campaignId, name: `Campaign ${campaignId}` };
  }

  ctx.emitLog(`Campaign resolved: "${campaign.name}"`, 'info');

  // 3. Resolve email subject, body, and attachments
  let subject: string = ctx.payload.subject || '';
  let body: string = ctx.payload.body || '';
  let rawAttachments: any[] = ctx.payload.attachments || [];

  let matchedTemplate: any = null;
  if (ctx.payload.templateId) {
    try {
      const templates = await sdk.outreach.listTemplates();
      const tpl = templates.find((t: any) => t.id === ctx.payload.templateId);
      if (tpl) {
        matchedTemplate = tpl;
        if (!subject) subject = tpl.subject;
        if (!body) body = tpl.body;
        if (!rawAttachments || rawAttachments.length === 0) {
          rawAttachments = Array.isArray(tpl.attachments)
            ? tpl.attachments
            : typeof tpl.attachments === 'string'
            ? JSON.parse(tpl.attachments)
            : [];
        }
      }
    } catch {}
  }

  if (!subject) subject = `Message from ${account.name || 'LeadForge'}`;
  if (!body) {
    body = `Hello {{firstName}},\n\nThis message was sent via LeadForge OS.\n\nBest regards,\n${account.name || 'LeadForge'}`;
  }

  // Process attachments
  const processedAttachments: any[] = [];
  if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
    const fs = await import('fs');
    for (const att of rawAttachments) {
      const filePath = att.storagePath || att.path;
      let contentBase64 = att.contentBase64 || '';
      if (!contentBase64 && filePath && fs.existsSync(filePath)) {
        contentBase64 = fs.readFileSync(filePath).toString('base64');
      }
      processedAttachments.push({
        id: att.id,
        fileId: att.fileId,
        driveUrl: att.driveUrl,
        googleConnectionId: att.googleConnectionId,
        provider: att.provider || 'google-drive',
        filename: att.filename || 'attachment',
        contentBase64,
        contentType: att.contentType || att.mimeType,
        size: att.size
      });
    }
  }

  // 4. Load eligible contacts from API or Campaign Audience
  let targetContactIds: Set<string> | null = null;
  if (campaign.audienceId) {
    try {
      ctx.emitLog(`Resolving audience membership for audience "${campaign.audienceId}"...`, 'info');
      const resolved = await sdk.audiences.resolve(campaign.audienceId);
      if (resolved && Array.isArray(resolved.contactIds)) {
        targetContactIds = new Set(resolved.contactIds);
        ctx.emitLog(`Audience resolved ${targetContactIds.size} eligible contact ID(s).`, 'info');
      }
    } catch (audErr) {
      ctx.emitLog(`Failed to resolve audience "${campaign.audienceId}": ${audErr}`, 'warn');
    }
  }

  // Resolve already-contacted contacts for this campaign to prevent duplicate dispatch
  const alreadyContactedIds = new Set<string>();
  try {
    const prevDeliveriesRes = await sdk.emailDeliveries.list({ campaignId, limit: 1000 });
    const prevList = Array.isArray(prevDeliveriesRes) ? prevDeliveriesRes : (prevDeliveriesRes as any)?.data || [];
    for (const d of prevList) {
      if (d.contactId && ['SENT', 'SENDING', 'AMBIGUOUS'].includes(d.status)) {
        alreadyContactedIds.add(d.contactId);
      }
    }
  } catch {}

  const contactsRes = await sdk.contacts.list({});
  const rawContacts = Array.isArray(contactsRes) ? contactsRes : [];
  const contacts: ContactRecord[] = rawContacts
    .filter((c: any) => {
      if (targetContactIds && !targetContactIds.has(c.id)) return false;
      const el = evaluateOutreachEligibility({
        contact: c,
        campaign,
        context: { alreadyContactedIds }
      });
      return el.eligible;
    })
    .map((c: any) => ({
      id: c.id,
      firstName: c.firstName || null,
      lastName: c.lastName || null,
      email: c.email,
      title: c.title || null,
      status: c.status || null,
      emailStatus: c.emailStatus || null,
      emailMeta: c.emailMeta || null,
      companyId: c.companyId || null
    }));

  if (contacts.length === 0) {
    ctx.emitLog(
      'No eligible contacts found for this campaign. All contacts have already been contacted, none match audience filter, or none exist.',
      'info'
    );
    return { dispatchedCount: 0, failureCount: 0, skippedCount: 0 };
  }

  ctx.emitLog(
    `Found ${contacts.length} eligible contact(s). Starting API email dispatch loop...`,
    'info'
  );

  // 5. Restore checkpoint if resuming
  const savedCheckpoint = ctx.getCheckpoint() as OutreachCheckpoint | null;
  const processedContactIds: Set<string> = new Set(savedCheckpoint?.processedContactIds || []);
  let dispatchedCount = savedCheckpoint?.dispatchedCount || 0;
  let failureCount = savedCheckpoint?.failureCount || 0;
  let skippedCount = savedCheckpoint?.skippedCount || 0;
  let startIndex = savedCheckpoint?.currentIndex || 0;

  if (startIndex > 0) {
    ctx.emitLog(
      `Resuming from checkpoint at index ${startIndex} (${processedContactIds.size} contacts already processed).`,
      'info'
    );
  }

  // 6. Dispatch loop
  const totalContacts = contacts.length;

  for (let i = startIndex; i < totalContacts; i++) {
    if (ctx.isCancelled()) {
      ctx.emitLog(`Outreach cancelled at contact ${i + 1}/${totalContacts}.`, 'warn');
      break;
    }

    if (ctx.isPaused()) {
      ctx.emitLog(
        `Outreach paused at contact ${i + 1}/${totalContacts}. Saving checkpoint...`,
        'info'
      );
      ctx.saveCheckpoint({
        processedContactIds: Array.from(processedContactIds),
        dispatchedCount,
        failureCount,
        skippedCount,
        currentIndex: i
      } satisfies OutreachCheckpoint);
      return { status: 'paused', dispatchedCount, failureCount, skippedCount, resumeIndex: i };
    }

    // Send-time server-authoritative campaign status check
    let freshCampaign: any = null;
    try {
      freshCampaign = await sdk.campaigns.get(campaignId);
    } catch {}

    if (freshCampaign) {
      const campStatus = String(freshCampaign.status || '').toUpperCase();
      if (campStatus === 'STOPPED' || campStatus === 'FAILED') {
        ctx.emitLog(`Campaign "${campaignId}" has transitioned to ${campStatus} on server. Aborting outreach loop immediately.`, 'warn');
        break;
      }
      if (campStatus === 'PAUSED') {
        ctx.emitLog(`Campaign "${campaignId}" has transitioned to PAUSED on server. Halting outreach loop.`, 'info');
        ctx.saveCheckpoint({
          processedContactIds: Array.from(processedContactIds),
          dispatchedCount,
          failureCount,
          skippedCount,
          currentIndex: i
        } satisfies OutreachCheckpoint);
        return { status: 'paused', dispatchedCount, failureCount, skippedCount, resumeIndex: i };
      }
    }

    const contact = contacts[i];
    if (!contact) continue;

    if (processedContactIds.has(contact.id)) {
      skippedCount++;
      continue;
    }

    let isSuppressed = false;
    try {
      const { getDatabase } = await import('../../database/connection');
      const { DesktopSuppressionRepository } = await import('../../database/suppression-repository');
      const suppRepo = new DesktopSuppressionRepository(getDatabase(campaign.workspaceId));
      isSuppressed = suppRepo.isSuppressed(campaign.workspaceId, contact.email);
    } catch {}

    const eligibility = evaluateOutreachEligibility({
      contact,
      suppression: isSuppressed,
      campaign: freshCampaign || campaign,
      context: { alreadyContactedIds: processedContactIds }
    });
    if (!eligibility.eligible) {
      ctx.emitLog(`Skipping contact "${contact.email}" before send: ${eligibility.reason}`, 'info');
      skippedCount++;
      continue;
    }

    const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email;
    ctx.emitLog(`Preparing email for "${fullName}" <${contact.email}>`, 'info');

    let companyRow: any = null;
    if (contact.companyId) {
      try {
        companyRow = await sdk.companies.get(contact.companyId);
      } catch {}
    }

    const renderCtx: CanonicalVariableContext = {
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        title: contact.title,
        status: contact.status
      },
      company: companyRow
        ? {
            id: companyRow.id,
            name: companyRow.name,
            domain: companyRow.domain || companyRow.website,
            industry: companyRow.industry,
            location: companyRow.location || companyRow.address || '',
            website: companyRow.website
          }
        : null,
      sender: {
        name: account.name || 'LeadForge',
        email: account.email
      },
      sequence: {
        name: campaign.name
      },
      workspace: {
        id: ctx.workspaceId
      }
    };

    const renderedSubject = renderCanonicalVariables(subject, renderCtx);
    const renderedBody = renderCanonicalVariables(body, renderCtx);
    const formattedBody = formatEmailBody(renderedBody);

    const idempotencyKey = `campaign_${campaignId}_${contact.id}_step0`;
    let messageId = '';
    let sendSuccess = false;
    let sendError = '';

    try {
      const res = await sdk.outreach.sendEmail({
        accountId,
        to: contact.email,
        subject: renderedSubject,
        text: formattedBody.text,
        html: formattedBody.html,
        useSignature: campaign.settings?.useSignature !== false,
        attachments: processedAttachments,
        idempotencyKey,
        campaignId,
        sequenceId: campaign.sequenceId || `campaign-${campaignId}`,
        executionId: `exec_${campaignId}_${contact.id}`,
        stepIndex: 0,
        contactId: contact.id,
        templateId: ctx.payload.templateId || undefined,
        templateVersion: matchedTemplate?.version || undefined,
        variablesSnapshot: captureVariablesSnapshot(subject + ' ' + body, renderCtx as any)
      });

      messageId = res.messageId || '';
      sendSuccess = true;
      dispatchedCount++;
      ctx.emitLog(`✅ Email sent via API to ${contact.email} (messageId: ${messageId})`, 'info', {
        messageId,
        recipient: contact.email,
        subject: renderedSubject,
        campaignId,
        attachmentsCount: processedAttachments.length
      });
    } catch (err: any) {
      sendError = err.message || String(err);
      sendSuccess = false;

      const isAmbiguous =
        err.code === 'AMBIGUOUS_SEND_TIMEOUT' ||
        err.category === 'AMBIGUOUS' ||
        err.ambiguous === true ||
        sendError.includes('AMBIGUOUS_SEND_TIMEOUT') ||
        sendError.includes('ambiguous') ||
        sendError.includes('pending reconciliation');

      const isRateLimited =
        err.status === 429 ||
        err.code === 'EMAIL_RATE_LIMITED' ||
        err.code === 'PROVIDER_RATE_LIMITED' ||
        err.code === 'DOMAIN_PACING_THROTTLED' ||
        sendError.includes('DOMAIN_PACING_THROTTLED') ||
        sendError.includes('RATE_LIMITED') ||
        sendError.includes('rate limit') ||
        sendError.includes('429');

      const isCardinalityExceeded =
        err.code === 'COMPANY_CARDINALITY_EXCEEDED' ||
        sendError.includes('COMPANY_CARDINALITY_EXCEEDED') ||
        sendError.includes('cardinality limit reached');

      const isSuppressedOrDnc =
        err.code === 'COMPANY_DNC' ||
        err.code === 'DOMAIN_SUPPRESSED' ||
        err.code === 'RECIPIENT_SUPPRESSED' ||
        sendError.includes('COMPANY_DNC') ||
        sendError.includes('DOMAIN_SUPPRESSED') ||
        sendError.includes('RECIPIENT_SUPPRESSED') ||
        sendError.includes('Do Not Contact') ||
        sendError.includes('suppressed in this workspace');

      if (isSuppressedOrDnc) {
        skippedCount++;
        ctx.emitLog(
          `Skipped contact "${contact.email}": blocked by suppression/DNC policy (${err.code || 'POLICY_BLOCKED'}).`,
          'info'
        );
      } else if (isAmbiguous) {
        skippedCount++;
        ctx.emitLog(
          `⚠️ Ambiguous delivery outcome for "${contact.email}": send outcome is unconfirmed (pending reconciliation). Blind re-dispatch suppressed to prevent duplicate sending.`,
          'warn',
          {
            recipient: contact.email,
            campaignId,
            error: sendError
          }
        );
      } else if (isCardinalityExceeded) {
        skippedCount++;
        ctx.emitLog(
          `Skipped contact "${contact.email}": company contact cardinality limit reached for campaign.`,
          'info'
        );
      } else if (isRateLimited) {
        const retrySec = typeof err.retryAfterSec === 'number' && err.retryAfterSec > 0
          ? err.retryAfterSec
          : 10;

        ctx.emitLog(
          `Outreach throttled by domain pacing/rate limit (retryAfter=${retrySec}s). Backing off before retrying ${contact.email}...`,
          'warn'
        );

        const waitStart = Date.now();
        while (Date.now() - waitStart < retrySec * 1000) {
          if (ctx.isCancelled()) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (!ctx.isCancelled()) {
          // Retry the contact once after backoff
          try {
            const retryRes = await sdk.outreach.sendEmail({
              accountId,
              to: contact.email,
              subject: renderedSubject,
              text: formattedBody.text,
              html: formattedBody.html,
              useSignature: campaign.settings?.useSignature !== false,
              attachments: processedAttachments,
              idempotencyKey,
              campaignId,
              sequenceId: campaign.sequenceId || `campaign-${campaignId}`,
              executionId: `exec_${campaignId}_${contact.id}`,
              stepIndex: 0,
              contactId: contact.id,
              templateId: ctx.payload.templateId || undefined,
              templateVersion: matchedTemplate?.version || undefined,
              variablesSnapshot: captureVariablesSnapshot(subject + ' ' + body, renderCtx as any)
            });
            messageId = retryRes.messageId || '';
            sendSuccess = true;
            dispatchedCount++;
            ctx.emitLog(`✅ Email sent on retry to ${contact.email} (messageId: ${messageId})`, 'info');
          } catch (retryErr: any) {
            sendError = retryErr.message || String(retryErr);
            const isRetryAmbiguous =
              retryErr.code === 'AMBIGUOUS_SEND_TIMEOUT' ||
              retryErr.category === 'AMBIGUOUS' ||
              retryErr.ambiguous === true ||
              sendError.includes('AMBIGUOUS_SEND_TIMEOUT') ||
              sendError.includes('ambiguous') ||
              sendError.includes('pending reconciliation');

            if (isRetryAmbiguous) {
              skippedCount++;
              ctx.emitLog(
                `⚠️ Ambiguous delivery outcome on retry for "${contact.email}": pending reconciliation. Blind re-dispatch suppressed.`,
                'warn'
              );
            } else {
              failureCount++;
              ctx.emitLog(`❌ Failed to send email on retry to ${contact.email}: ${sendError}`, 'error');
            }
          }
        }
      } else {
        failureCount++;
        ctx.emitLog(`❌ Failed to send email to ${contact.email}: ${sendError}`, 'error', {
          error: sendError,
          recipient: contact.email,
          subject: renderedSubject,
          campaignId
        });

        // Phase 10: Auto-suppress on hard bounce
        const isHardBounce =
          !isSuppressedOrDnc &&
          (err.code === 'INVALID_RECIPIENT' ||
            err.status === 400 ||
            sendError.includes('INVALID_RECIPIENT') ||
            sendError.includes('550'));

        if (isHardBounce) {
          try {
            const { getDatabase } = await import('../../database/connection');
            const { DesktopSuppressionRepository } = await import('../../database/suppression-repository');
            const { SuppressionReason } = await import('@leadforge/schema');
            const suppRepo = new DesktopSuppressionRepository(getDatabase(campaign.workspaceId));
            suppRepo.suppress(
              campaign.workspaceId,
              contact.email,
              SuppressionReason.HARD_BOUNCE,
              'outreach_worker_bounce',
              { error: sendError }
            );
          } catch {}
        }
      }
    }

    processedContactIds.add(contact.id);

    const progress = Math.round(((i + 1) / totalContacts) * 100);
    ctx.updateProgress(progress, {
      current: i + 1,
      total: totalContacts,
      description: `Sent: ${dispatchedCount} | Failed: ${failureCount} | Skipped: ${skippedCount}`
    });

    if ((i + 1) % 10 === 0) {
      ctx.saveCheckpoint({
        processedContactIds: Array.from(processedContactIds),
        dispatchedCount,
        failureCount,
        skippedCount,
        currentIndex: i + 1
      } satisfies OutreachCheckpoint);
      ctx.emitLog(`Checkpoint saved after ${i + 1} contact(s).`, 'info');
    }

    // Steady pacing between consecutive sends with bounded jitter
    if (i < totalContacts - 1 && !ctx.isCancelled()) {
      const baseIntervalMs = typeof (campaign as any).settings?.sendIntervalSeconds === 'number'
        ? (campaign as any).settings.sendIntervalSeconds * 1000
        : 1500;
      const jitterMs = Math.floor(Math.random() * 600) - 300; // +/- 300ms jitter
      const sleepDuration = Math.max(800, baseIntervalMs + jitterMs);

      const startTime = Date.now();
      while (Date.now() - startTime < sleepDuration) {
        if (ctx.isCancelled()) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  ctx.emitLog(
    `Campaign dispatch complete — Sent: ${dispatchedCount} | Failed: ${failureCount} | Skipped: ${skippedCount}`,
    'info'
  );

  // False success protection: if all attempted sends failed, fail the job explicitly
  if (dispatchedCount === 0 && failureCount > 0) {
    const fatalMsg = `Campaign outreach failed: 0/${failureCount} emails were accepted by the provider.`;
    ctx.emitLog(`❌ ${fatalMsg}`, 'error');
    throw new Error(fatalMsg);
  }

  return { dispatchedCount, failureCount, skippedCount };
}
