import { ImapFlow } from 'imapflow';
import type { JobContext } from '../../../shared/types/job';
import { SdkClient } from '@leadforge/sdk';
import { generateEntityId, ContactStatus } from '@leadforge/schema';
import { resolveWorkerApiUrl } from '../worker-env';

function getHeaderValue(headers: Buffer | undefined, headerName: string): string | null {
  if (!headers) return null;
  const text = headers.toString('utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.toLowerCase().startsWith(`${headerName.toLowerCase()}:`)) {
      return line.substring(headerName.length + 1).trim();
    }
  }
  return null;
}

function extractMessageIds(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/<[^>]+>/g);
  return matches ? matches.map((m) => m.trim()) : [];
}

/**
 * Calculates a bounded IMAP sequence range targeting only the newest messages in the mailbox.
 * In IMAP, sequence numbers are 1-based and strictly contiguous up to totalMessages.
 * Sequence `exists` is the most recent message; sequence 1 is the oldest.
 *
 * Examples:
 * - total: 0, window: 150 -> null (nothing to fetch)
 * - total: 20, window: 150 -> '1:*'
 * - total: 150, window: 150 -> '1:*'
 * - total: 1000, window: 150 -> '851:*'
 * - total: 100000, window: 50 -> '99951:*'
 */
export function calculateImapFetchRange(totalMessages: number, windowSize: number = 150): string | null {
  if (!totalMessages || totalMessages <= 0) {
    return null;
  }
  const safeWindow = Math.max(1, windowSize);
  const startSeq = Math.max(1, totalMessages - safeWindow + 1);
  return `${startSeq}:*`;
}

/**
 * IMAP Inbox Poller Worker Plugin (Phase 9 - Efficient Inbound Polling).
 * Polls configured IMAP account using server-side range narrowing and updates sequence executions & contacts via SdkClient.
 */
export async function pollImapReplies(ctx: JobContext): Promise<any> {
  ctx.emitLog('Initializing background IMAP reply poller.', 'info');

  // Initialize SdkClient for authoritative API/MongoDB persistence
  const apiUrl = resolveWorkerApiUrl(ctx);
  const authToken = ctx.payload._secrets?.sessionToken || process.env.LEADFORGE_API_TOKEN || '';
  const sdk = new SdkClient({
    baseUrl: apiUrl,
    token: authToken,
    headers: {
      'x-workspace-id': ctx.workspaceId
    }
  });

  let client: ImapFlow | null = null;

  try {
    // 1. Resolve connected email account from API
    const accounts = await sdk.outreach.listAccounts();
    const account = accounts.find((a: any) => a.status === 'connected') || accounts[0];

    const host = ctx.payload._secrets?.['imap.host'] || (account as any)?.imapHost || '';
    const port = Number(ctx.payload._secrets?.['imap.port'] || (account as any)?.imapPort || 993);
    const secure = ctx.payload._secrets?.['imap.secure'] !== 'false';
    const username = ctx.payload._secrets?.['imap.username'] || account?.email || '';
    const password = ctx.payload._secrets?.['imap.password'] || ctx.payload._secrets?.['accountPassword'] || '';

    if (!host || !username || !password) {
      ctx.emitLog('IMAP connection skipped: Incomplete credentials configuration.', 'warn');
      return { status: 'skipped', reason: 'incomplete_credentials' };
    }

    ctx.emitLog(`Connecting to IMAP server: ${host}:${port} (secure=${secure})`, 'info');

    client = new ImapFlow({
      host,
      port,
      secure,
      auth: {
        user: username,
        pass: password
      },
      logger: false
    });

    await client.connect();
    ctx.emitLog('Successfully established IMAP server connection.', 'info');

    // 2. Open INBOX in Read-Only mode to parse messages safely
    const lock = await client.getMailboxLock('INBOX');
    let repliedContactsCount = 0;
    let totalMailboxMessages = 0;
    let fetchedMessagesCount = 0;
    let appliedRange: string | null = null;
    const windowSize = Math.max(1, Number(ctx.payload?.recentWindow) || 150);

    try {
      totalMailboxMessages = client.mailbox ? client.mailbox.exists : 0;

      // Load active executions from API
      const executionsRes = await sdk.executions.list();
      const allExecutions = Array.isArray(executionsRes) ? executionsRes : [];
      const activeExecutions = allExecutions
        .filter((se: any) => se.status === 'ACTIVE' || se.status === 'RUNNING' || se.status === 'running')
        .map((se: any) => ({
          executionId: se.id,
          startedAt: se.startedAt,
          contactId: se.contactId,
          companyId: se.companyId,
          campaignId: se.campaignId
        }));

      if (activeExecutions.length === 0) {
        ctx.emitLog('No active outreach executions. Skipping inbox parse.', 'info');
      } else if (totalMailboxMessages === 0) {
        ctx.emitLog(
          `[IMAP Metrics] Mailbox: INBOX | Total: 0 | Window: ${windowSize} | Range: none | Fetched: 0 | Processed: 0`,
          'info'
        );
        ctx.emitLog('Mailbox contains 0 messages. Skipping fetch.', 'info');
      } else {
        ctx.emitLog(
          `Loaded ${activeExecutions.length} active executions for reply checks.`,
          'info'
        );

        appliedRange = calculateImapFetchRange(totalMailboxMessages, windowSize);
        if (!appliedRange) {
          ctx.emitLog('No messages to fetch for calculated range.', 'info');
        } else {
          ctx.emitLog(
            `Fetching recent messages from IMAP server: sequence range ${appliedRange} (total: ${totalMailboxMessages}, window: ${windowSize})`,
            'info'
          );

          // Fetch only the server-side bounded range with uid enabled
          const messages = await client.fetch(appliedRange, {
            envelope: true,
            headers: ['in-reply-to', 'references'],
            uid: true
          });

          const messageList: any[] = [];
          for await (const msg of messages) {
            messageList.push(msg);
          }

          messageList.reverse();
          fetchedMessagesCount = messageList.length;

          ctx.emitLog(
            `[IMAP Metrics] Mailbox: INBOX | Total: ${totalMailboxMessages} | Window: ${windowSize} | Range: ${appliedRange} | Fetched: ${fetchedMessagesCount} | Processed: ${fetchedMessagesCount}`,
            'info'
          );
          ctx.emitLog(`Scanning the ${fetchedMessagesCount} most recent emails in inbox.`, 'info');

          const matchedExecutionIds = new Set<string>();

          // Pre-resolve contact emails for active executions to prevent accidental cross-contact correlation
          const contactEmailToExec = new Map<string, (typeof activeExecutions)[0]>();
          for (const exec of activeExecutions) {
            if (exec.contactId) {
              try {
                const c = await sdk.contacts.get(exec.contactId);
                if (c?.email) {
                  contactEmailToExec.set(c.email.toLowerCase().trim(), exec);
                }
                if (Array.isArray(c?.additionalEmails)) {
                  for (const add of c.additionalEmails) {
                    if (add?.email) {
                      contactEmailToExec.set(add.email.toLowerCase().trim(), exec);
                    }
                  }
                }
              } catch {}
            }
          }

          for (let i = 0; i < messageList.length; i++) {
            const msg = messageList[i];
            const envelope = msg?.envelope;
            if (!envelope || !envelope.from || envelope.from.length === 0) continue;

            const senderEmail = (envelope.from[0].address || '').toLowerCase().trim();
            if (!senderEmail) continue;

            const inReplyToVal = envelope.inReplyTo || getHeaderValue(msg.headers, 'in-reply-to');
            const inReplyToIds = extractMessageIds(inReplyToVal);
            const referencesVal = getHeaderValue(msg.headers, 'references');
            const referencesIds = extractMessageIds(referencesVal);

            const allThreadRelMsgIds = new Set([...inReplyToIds, ...referencesIds]);

            // Strict correlation: require senderEmail to match the target contact of an active execution
            const correlatedExec = contactEmailToExec.get(senderEmail);
            if (!correlatedExec) {
              continue;
            }

            if (correlatedExec && !matchedExecutionIds.has(correlatedExec.executionId)) {
              ctx.emitLog(
                `Correlated reply from ${senderEmail} to execution: ${correlatedExec.executionId}`,
                'info'
              );

              matchedExecutionIds.add(correlatedExec.executionId);
              const execId = correlatedExec.executionId;
              const contactId = correlatedExec.contactId;

              // 1. Update contact status via API
              if (contactId) {
                try {
                  await sdk.contacts.update(contactId, { status: ContactStatus.REPLIED });
                } catch {}
              }

              // 2. Update execution status via API
              try {
                await sdk.executions.update(execId, {
                  status: 'COMPLETED',
                  completedAt: new Date().toISOString()
                });
              } catch {}

              repliedContactsCount++;
            }
          }
        }
      }
    } finally {
      lock.release();
    }

    ctx.emitLog(
      `IMAP poll complete. Detected and updated ${repliedContactsCount} contact reply/replies.`,
      'info'
    );
    await client.logout();

    return {
      status: 'success',
      repliedContactsCount,
      metrics: {
        mailboxTotal: totalMailboxMessages,
        windowSize,
        range: appliedRange,
        fetchedCount: fetchedMessagesCount,
        processedCount: fetchedMessagesCount
      }
    };
  } catch (err: any) {
    ctx.emitLog(`IMAP Poller execution failed: ${err.message || err}`, 'error');
    if (client) {
      try {
        await client.logout();
      } catch {}
    }
    throw err;
  }
}
