import { safeRegister } from './helper';
import { SdkClient } from '@huntara/sdk';
import { shell } from 'electron';
import { WorkspaceManager } from '../lib/workspace-manager';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import {
  connectGmailAccount,
  getOAuthTransactionStatus,
  disconnectGmailAccount,
  reconnectGmailAccount,
  sendTestEmail
} from '../services/email-account-service';
import { getDatabase } from '../database/connection';

/**
 * Registers outreach email accounts, templates, and campaigns scheduling IPC channels.
 */
export function registerOutreachIpc(sdk: SdkClient) {
  // Email Accounts
  safeRegister('email-accounts:list', async (_event, payload) => {
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime(payload?.workspaceId);
    if (!runtime) return [];

    const localAccounts = await LocalCRMRepository.findMany('email_accounts', runtime.workspaceId);

    try {
      const remoteList = await sdk.outreach.listAccounts();
      if (Array.isArray(remoteList) && remoteList.length > 0) {
        await LocalCRMRepository.saveMany(
          'email_accounts',
          remoteList.map((item) => ({ ...item, workspaceId: runtime.workspaceId })),
          true
        );
        // Merge local and remote by unique ID
        const map = new Map<string, any>();
        localAccounts.forEach((acc: any) => map.set(acc.id, acc));
        remoteList.forEach((acc: any) => map.set(acc.id, { ...map.get(acc.id), ...acc }));
        return Array.from(map.values());
      }
    } catch (err) {
      console.warn('[IPC] Failed to list accounts from remote, falling back to local cache:', err);
    }

    return localAccounts;
  });

  safeRegister('email-accounts:delete', async (_event, id) => {
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    await disconnectGmailAccount(sdk, id);
    await LocalCRMRepository.softDeleteFromServer('email_accounts', runtime.workspaceId, id);
    const { BrowserWindow } = await import('electron');
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('email-accounts:changed');
    });
    return { success: true };
  });

  // Initiate Gmail OAuth via API and open external Chrome browser
  safeRegister('email-accounts:gmail:connect', async () => {
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    const result = await connectGmailAccount(sdk);
    if (result.authorizationUrl) {
      console.log(`[IPC] Opening Google OAuth in Chrome: ${result.authorizationUrl}`);
      await shell.openExternal(result.authorizationUrl);
    }
    return result;
  });

  // Poll status of an OAuth transaction
  safeRegister('email-accounts:gmail:status', async (_event, { transactionId }) => {
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    const status = await getOAuthTransactionStatus(sdk, transactionId);
    if (status && status.status === 'completed') {
      const { BrowserWindow } = await import('electron');
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('email-accounts:changed');
      });
    }
    return status;
  });

  safeRegister('email-accounts:gmail:disconnect', async (_event, { id }) => {
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    const res = await disconnectGmailAccount(sdk, id);
    const { BrowserWindow } = await import('electron');
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('email-accounts:changed');
    });
    return res;
  });

  safeRegister('email-accounts:gmail:reconnect', async (_event, { id }) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    const result = await reconnectGmailAccount(sdk, id);
    if (result.authorizationUrl) {
      console.log(`[IPC] Opening Google Reconnect OAuth in Chrome: ${result.authorizationUrl}`);
      await shell.openExternal(result.authorizationUrl);
    }
    return result;
  });

  safeRegister('email-accounts:sync-signature', async (_event, { id }: { id: string }) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    return sdk.outreach.syncAccountSignature(id);
  });

  safeRegister('email-accounts:reset-health', async (_event, id: string) => {
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    const result = await sdk.outreach.resetAccountHealth(id);
    const { BrowserWindow } = await import('electron');
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('email-accounts:changed');
    });
    return result;
  });

  safeRegister('email-accounts:send-test', async (_event, payload) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    return sendTestEmail(sdk, payload);
  });

  safeRegister('email-accounts:test-recipients', async () => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    try {
      return await sdk.outreach.getTestRecipients();
    } catch {
      return [];
    }
  });

  safeRegister('attachments:save', async (_event, payload: { filePath?: string; filename?: string; contentBase64?: string; contentType?: string; googleConnectionId?: string }) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    let buffer: Buffer;
    let mimeType: string = payload.contentType || 'application/octet-stream';
    let safeFilename: string = payload.filename || 'attachment';
    let size = 0;

    if (payload.filePath) {
      const fs = await import('fs');
      const path = await import('path');

      if (!fs.existsSync(payload.filePath)) {
        throw new Error(`File does not exist at path: ${payload.filePath}`);
      }

      const stat = fs.statSync(payload.filePath);
      if (stat.size > 25 * 1024 * 1024) {
        throw new Error(`File size (${(stat.size / 1024 / 1024).toFixed(1)} MB) exceeds 25 MB limit.`);
      }

      buffer = fs.readFileSync(payload.filePath);
      size = stat.size;
      const ext = path.extname(payload.filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.csv': 'text/csv',
        '.txt': 'text/plain'
      };
      mimeType = payload.contentType || mimeMap[ext] || 'application/octet-stream';
      safeFilename = payload.filename || path.basename(payload.filePath);
    } else if (payload.contentBase64) {
      buffer = Buffer.from(payload.contentBase64, 'base64');
      size = buffer.length;
      if (size > 25 * 1024 * 1024) {
        throw new Error(`File size (${(size / 1024 / 1024).toFixed(1)} MB) exceeds 25 MB limit.`);
      }
    } else {
      throw new Error('Either filePath or contentBase64 is required to save an attachment.');
    }

    const sdk = WorkspaceManager.getSdk();
    let connId = payload.googleConnectionId;
    if (!connId) {
      const connections = await sdk.googleConnections.list().catch(() => []);
      const activeConn =
        connections.find(
          (c: any) =>
            c.status === 'active' ||
            c.gmailStatus === 'connected' ||
            c.driveStatus === 'authorized'
        ) || connections[0];

      if (!activeConn) {
        throw new Error(
          'No connected Google account found in this workspace. Please connect a Gmail/Google account in Settings before uploading Drive attachments.'
        );
      }
      connId = activeConn.id;
    }

    const createdAttachment = await sdk.attachments.upload({
      googleConnectionId: connId,
      filename: safeFilename,
      mimeType,
      contentBase64: buffer.toString('base64'),
      metadata: { size }
    });

    const driveUrl = (createdAttachment as any).driveUrl || (createdAttachment.fileId ? `https://drive.google.com/file/d/${createdAttachment.fileId}/view` : undefined);

    return {
      id: createdAttachment.id,
      filename: createdAttachment.filename,
      size: createdAttachment.size,
      mimeType: createdAttachment.mimeType,
      contentType: createdAttachment.mimeType,
      provider: createdAttachment.provider,
      fileId: createdAttachment.fileId,
      driveUrl,
      googleConnectionId: (createdAttachment as any).googleConnectionId || connId
    };
  });

  // Templates
  safeRegister('templates:list', async (_event, payload) => {
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime(payload?.workspaceId);
    if (!runtime) return [];
    const localTemplates = await LocalCRMRepository.findMany('templates', runtime.workspaceId);
    try {
      const list = await sdk.outreach.listTemplates();
      if (Array.isArray(list) && list.length > 0) {
        await LocalCRMRepository.saveMany(
          'templates',
          list.map((item) => ({
            ...item,
            workspaceId: runtime.workspaceId,
            variables:
              typeof item.variables === 'string'
                ? item.variables
                : JSON.stringify(item.variables || []),
            attachments:
              typeof item.attachments === 'string'
                ? item.attachments
                : JSON.stringify(item.attachments || [])
          })),
          true
        );
      }

      const localMap = new Map<string, any>();
      localTemplates.forEach((t: any) => localMap.set(t.id, t));

      const mergedList = (list || []).map((remote: any) => {
        const local = localMap.get(remote.id);
        const remoteAtts = Array.isArray(remote.attachments)
          ? remote.attachments
          : typeof remote.attachments === 'string'
          ? (() => {
              try {
                return JSON.parse(remote.attachments);
              } catch {
                return [];
              }
            })()
          : [];
        const localAtts = Array.isArray(local?.attachments) ? local.attachments : [];
        const attachments = remoteAtts.length > 0 ? remoteAtts : localAtts;
        return { ...local, ...remote, attachments };
      });

      const remoteIds = new Set((list || []).map((t: any) => t.id));
      const localOnly = localTemplates.filter((t: any) => !remoteIds.has(t.id));

      return [...mergedList, ...localOnly];
    } catch (err) {
      console.warn('[IPC] Failed to list templates from remote, falling back to local cache:', err);
      return localTemplates;
    }
  });

  safeRegister('templates:create', async (_event, dto) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    const created = await sdk.outreach.createTemplate(dto);
    const record = {
      ...created,
      workspaceId: runtime.workspaceId,
      variables:
        typeof created.variables === 'string' ? created.variables : JSON.stringify(created.variables || []),
      attachments:
        typeof created.attachments === 'string'
          ? created.attachments
          : JSON.stringify(created.attachments || [])
    };
    await LocalCRMRepository.saveFromServer('templates', record);
    return {
      ...record,
      variables: typeof record.variables === 'string' ? JSON.parse(record.variables) : (record.variables || []),
      attachments: typeof record.attachments === 'string' ? JSON.parse(record.attachments) : (record.attachments || [])
    };
  });

  safeRegister('templates:update', async (_event, { id, dto }) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    if (!id) throw new Error('Template ID is required.');
    const updated = await sdk.outreach.updateTemplate(id, dto);
    const record: any = {
      ...updated,
      id,
      workspaceId: runtime.workspaceId,
      variables:
        typeof updated.variables === 'string' ? updated.variables : JSON.stringify(updated.variables || []),
      attachments:
        typeof updated.attachments === 'string'
          ? updated.attachments
          : JSON.stringify(updated.attachments || [])
    };
    await LocalCRMRepository.saveFromServer('templates', record);
    return {
      ...record,
      variables: typeof record.variables === 'string' ? JSON.parse(record.variables) : (record.variables || []),
      attachments: typeof record.attachments === 'string' ? JSON.parse(record.attachments) : (record.attachments || [])
    };
  });

  safeRegister('templates:delete', async (_event, id) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    await sdk.outreach.deleteTemplate(id);
    await LocalCRMRepository.softDeleteFromServer('templates', runtime.workspaceId, id);
    return { success: true };
  });

  safeRegister('templates:preview', async (_event, { id, contactId }) => {
    return sdk.outreach.previewTemplate(id, contactId);
  });

  safeRegister('email-deliveries:list', async (_event, payload) => {
    const targetWsId = payload?.workspaceId || WorkspaceManager.getActiveRuntime()?.workspaceId;
    if (!targetWsId) throw new Error('workspaceId is required.');

    try {
      const sdk = WorkspaceManager.getSdk();
      const res = await sdk.emailDeliveries.list({
        campaignId: payload?.campaignId,
        sequenceId: payload?.sequenceId,
        contactId: payload?.contactId,
        companyId: payload?.companyId,
        accountId: payload?.accountId,
        status: payload?.status,
        processingStatus: payload?.processingStatus,
        direction: payload?.direction,
        search: payload?.search,
        startDate: payload?.startDate,
        endDate: payload?.endDate,
        page: payload?.page || 1,
        limit: payload?.limit || 100
      });
      const list: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

      // Cache returned deliveries locally in background
      try {
        if (list.length > 0) {
          const db = getDatabase(targetWsId);
          const upsert = db.prepare(`
            INSERT INTO email_deliveries (
              id, workspaceId, campaignId, sequenceId, executionId, stepIndex,
              contactId, companyId, accountId, senderEmail, recipientEmail, subject,
              providerMessageId, providerThreadId, htmlBody, textBody,
              templateId, templateVersion, variablesSnapshot, messageFingerprint,
              safeHumanMessage, technicalMessage, error, retryable, ambiguous,
              direction, openCount, clickCount, hasReply, replyCount,
              lastOpenedAt, lastClickedAt, lastRepliedAt, status, processingStatus,
              matchConfidence, reconciliationAttempts, reconciliationNotes, reconciledAt,
              attempt, idempotencyKey, sentAt, createdAt, updatedAt
            ) VALUES (
              @id, @workspaceId, @campaignId, @sequenceId, @executionId, @stepIndex,
              @contactId, @companyId, @accountId, @senderEmail, @recipientEmail, @subject,
              @providerMessageId, @providerThreadId, @htmlBody, @textBody,
              @templateId, @templateVersion, @variablesSnapshot, @messageFingerprint,
              @safeHumanMessage, @technicalMessage, @error, @retryable, @ambiguous,
              @direction, @openCount, @clickCount, @hasReply, @replyCount,
              @lastOpenedAt, @lastClickedAt, @lastRepliedAt, @status, @processingStatus,
              @matchConfidence, @reconciliationAttempts, @reconciliationNotes, @reconciledAt,
              @attempt, @idempotencyKey, @sentAt, @createdAt, @updatedAt
            )
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status,
              processingStatus = excluded.processingStatus,
              matchConfidence = excluded.matchConfidence,
              reconciliationAttempts = excluded.reconciliationAttempts,
              reconciliationNotes = excluded.reconciliationNotes,
              reconciledAt = excluded.reconciledAt,
              providerMessageId = excluded.providerMessageId,
              providerThreadId = excluded.providerThreadId,
              htmlBody = excluded.htmlBody,
              textBody = excluded.textBody,
              templateId = excluded.templateId,
              templateVersion = excluded.templateVersion,
              variablesSnapshot = excluded.variablesSnapshot,
              messageFingerprint = excluded.messageFingerprint,
              safeHumanMessage = excluded.safeHumanMessage,
              technicalMessage = excluded.technicalMessage,
              error = excluded.error,
              retryable = excluded.retryable,
              ambiguous = excluded.ambiguous,
              direction = excluded.direction,
              openCount = excluded.openCount,
              clickCount = excluded.clickCount,
              hasReply = excluded.hasReply,
              replyCount = excluded.replyCount,
              lastOpenedAt = excluded.lastOpenedAt,
              lastClickedAt = excluded.lastClickedAt,
              lastRepliedAt = excluded.lastRepliedAt,
              sentAt = excluded.sentAt,
              updatedAt = excluded.updatedAt
          `);
          const tx = db.transaction((rows: any[]) => {
            for (const row of rows) {
              upsert.run({
                id: row.id || row._id,
                workspaceId: targetWsId,
                campaignId: row.campaignId || null,
                sequenceId: row.sequenceId || null,
                executionId: row.executionId || null,
                stepIndex: row.stepIndex ?? 0,
                contactId: row.contactId || null,
                companyId: row.companyId || null,
                accountId: row.accountId || null,
                senderEmail: row.senderEmail || '',
                recipientEmail: row.recipientEmail || '',
                subject: row.subject || '',
                providerMessageId: row.providerMessageId || null,
                providerThreadId: row.providerThreadId || null,
                htmlBody: row.htmlBody || null,
                textBody: row.textBody || null,
                templateId: row.templateId || null,
                templateVersion: row.templateVersion ?? null,
                variablesSnapshot: row.variablesSnapshot
                  ? typeof row.variablesSnapshot === 'string'
                    ? row.variablesSnapshot
                    : JSON.stringify(row.variablesSnapshot)
                  : null,
                messageFingerprint: row.messageFingerprint || null,
                safeHumanMessage: row.safeHumanMessage || null,
                technicalMessage: row.technicalMessage || null,
                error: row.error || null,
                retryable: row.retryable ? 1 : 0,
                ambiguous: row.ambiguous ? 1 : 0,
                direction: row.direction || 'OUTBOUND',
                openCount: row.openCount || 0,
                clickCount: row.clickCount || 0,
                hasReply: row.hasReply ? 1 : 0,
                replyCount: row.replyCount || 0,
                lastOpenedAt: row.lastOpenedAt ? new Date(row.lastOpenedAt).toISOString() : null,
                lastClickedAt: row.lastClickedAt ? new Date(row.lastClickedAt).toISOString() : null,
                lastRepliedAt: row.lastRepliedAt ? new Date(row.lastRepliedAt).toISOString() : null,
                status: row.status || 'PENDING',
                processingStatus: row.processingStatus || null,
                matchConfidence: row.matchConfidence || null,
                reconciliationAttempts: row.reconciliationAttempts ?? 0,
                reconciliationNotes: row.reconciliationNotes || null,
                reconciledAt: row.reconciledAt ? new Date(row.reconciledAt).toISOString() : null,
                attempt: row.attempt || 1,
                idempotencyKey: row.idempotencyKey || null,
                sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
                createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
                updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
              });
            }
          });
          tx(list);
        }
      } catch (cacheErr) {
        console.warn('[IPC] Failed to cache deliveries to SQLite:', cacheErr);
      }

      const resAny = res as any;
      const resultArr: any = list;
      resultArr.total = typeof resAny?.total === 'number' ? resAny.total : list.length;
      resultArr.page = typeof resAny?.page === 'number' ? resAny.page : (payload?.page || 1);
      resultArr.limit = typeof resAny?.limit === 'number' ? resAny.limit : (payload?.limit || 100);
      resultArr.totalPages = typeof resAny?.totalPages === 'number' ? resAny.totalPages : Math.ceil(resultArr.total / (payload?.limit || 100));
      return resultArr;
    } catch {
      // Fallback to local cache query if API is temporarily unavailable
      const db = getDatabase(targetWsId);
      let query = `
        SELECT ed.*, c.firstName, c.lastName, c.email as contactEmail, comp.name as companyName, camp.name as campaignName
        FROM email_deliveries ed
        LEFT JOIN contacts c ON ed.contactId = c.id
        LEFT JOIN companies comp ON c.companyId = comp.id
        LEFT JOIN campaigns camp ON ed.campaignId = camp.id
        WHERE ed.workspaceId = ?
      `;
      const params: any[] = [targetWsId];
      if (payload?.campaignId) {
        query += ` AND ed.campaignId = ?`;
        params.push(payload.campaignId);
      }
      if (payload?.contactId) {
        query += ` AND ed.contactId = ?`;
        params.push(payload.contactId);
      }
      if (payload?.status) {
        query += ` AND ed.status = ?`;
        params.push(payload.status);
      }
      if (payload?.processingStatus && payload.processingStatus !== 'ALL') {
        query += ` AND ed.processingStatus = ?`;
        params.push(payload.processingStatus);
      }
      if (payload?.direction) {
        query += ` AND ed.direction = ?`;
        params.push(payload.direction);
      }
      if (payload?.search && payload.search.trim()) {
        query += ` AND (ed.subject LIKE ? OR ed.recipientEmail LIKE ? OR ed.senderEmail LIKE ?)`;
        const s = `%${payload.search.trim()}%`;
        params.push(s, s, s);
      }
      const page = payload?.page || 1;
      const limit = payload?.limit || 100;
      const offset = (page - 1) * limit;
      query += ` ORDER BY ed.createdAt DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      try {
        const rows = db.prepare(query).all(...params);
        const resultArr: any = rows;
        resultArr.total = rows.length;
        resultArr.page = page;
        resultArr.limit = limit;
        resultArr.totalPages = 1;
        return resultArr;
      } catch {
        const emptyArr: any = [];
        emptyArr.total = 0;
        emptyArr.page = 1;
        emptyArr.limit = limit;
        emptyArr.totalPages = 0;
        return emptyArr;
      }
    }
  });

  safeRegister('email-deliveries:get', async (_event, payload) => {
    const id = typeof payload === 'string' ? payload : payload?.id;
    if (!id) throw new Error('Delivery ID is required.');
    const targetWsId = (typeof payload === 'object' && payload?.workspaceId) || WorkspaceManager.getActiveRuntime()?.workspaceId;

    try {
      const sdk = WorkspaceManager.getSdk();
      const delivery = await sdk.emailDeliveries.get(id);
      return delivery;
    } catch {
      if (targetWsId) {
        try {
          const db = getDatabase(targetWsId);
          const row = db.prepare(`
            SELECT ed.*, c.firstName, c.lastName, c.email as contactEmail, comp.name as companyName, camp.name as campaignName
            FROM email_deliveries ed
            LEFT JOIN contacts c ON ed.contactId = c.id
            LEFT JOIN companies comp ON c.companyId = comp.id
            LEFT JOIN campaigns camp ON ed.campaignId = camp.id
            WHERE ed.id = ? AND ed.workspaceId = ?
          `).get(id, targetWsId);
          if (row) return row;
        } catch {}
      }
      throw new Error(`Email delivery with id ${id} not found.`);
    }
  });

  safeRegister('email-deliveries:events', async (_event, payload) => {
    const id = typeof payload === 'string' ? payload : payload?.id;
    if (!id) throw new Error('Delivery ID is required.');

    try {
      const sdk = WorkspaceManager.getSdk();
      const events = await sdk.emailDeliveries.getEvents(id);
      return Array.isArray(events) ? events : [];
    } catch (err) {
      console.warn('[IPC] Failed to fetch events for delivery:', err);
      return [];
    }
  });

  safeRegister('email-deliveries:reconcile', async (_event, payload) => {
    const id = typeof payload === 'string' ? payload : payload?.id;
    if (!id) throw new Error('Delivery ID is required.');

    const sdk = WorkspaceManager.getSdk();
    return await sdk.emailDeliveries.reconcileDelivery(id);
  });

  safeRegister('email-deliveries:poll-replies', async () => {
    const sdk = WorkspaceManager.getSdk();
    return await sdk.emailDeliveries.pollReplies();
  });

  safeRegister('email-deliveries:reindex-inbound', async (_event, payload?: { limit?: number }) => {
    const sdk = WorkspaceManager.getSdk();
    return await sdk.emailDeliveries.reindexPendingInboundReplies(payload);
  });

  safeRegister('email-deliveries:manual-reconcile', async (_event, payload) => {
    const deliveryId = payload?.inboundDeliveryId || payload?.deliveryId;
    if (!deliveryId) throw new Error('inboundDeliveryId is required.');
    if (!payload?.contactId) throw new Error('contactId is required.');

    const sdk = WorkspaceManager.getSdk();
    return await sdk.emailDeliveries.manualReconcile(deliveryId, {
      contactId: payload.contactId,
      campaignId: payload.campaignId || null,
      matchedDeliveryId: payload.matchedDeliveryId || payload.outboundDeliveryId || null,
      notes: payload.notes || null
    });
  });
}