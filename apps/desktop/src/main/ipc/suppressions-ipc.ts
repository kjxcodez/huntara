import { safeRegister } from './helper';
import { getDatabase } from '../database/connection';
import { DesktopSuppressionRepository } from '../database/suppression-repository';
import { WorkspaceManager } from '../lib/workspace-manager';
import { SuppressionReason } from '@huntara/schema';

export function registerSuppressionsIpc(): void {
  safeRegister('suppressions:list', async (_event, { workspaceId, limit, offset }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const db = getDatabase(workspaceId);
    const repo = new DesktopSuppressionRepository(db);
    return repo.listSuppressions(workspaceId, limit, offset);
  });

  safeRegister('suppressions:check', async (_event, { workspaceId, email }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!email) throw new Error('email is required.');
    const db = getDatabase(workspaceId);
    const repo = new DesktopSuppressionRepository(db);
    const record = repo.getSuppression(workspaceId, email);
    return {
      email,
      suppressed: Boolean(record),
      suppression: record
    };
  });

  safeRegister('suppressions:suppress', async (_event, { workspaceId, email, reason, source, notes }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!email) throw new Error('email is required.');
    const db = getDatabase(workspaceId);
    const repo = new DesktopSuppressionRepository(db);
    repo.suppress(
      workspaceId,
      email,
      (reason as SuppressionReason) || SuppressionReason.MANUAL_SUPPRESSION,
      source || 'desktop_ui',
      null,
      null,
      notes || null
    );

    // Sync to API server if available
    try {
      const sdk = WorkspaceManager.getSdk();
      if ((sdk as any).suppressions?.create) {
        await (sdk as any).suppressions.create({ email, reason, source, notes });
      }
    } catch {}

    return { success: true, email };
  });

  safeRegister('suppressions:unsuppress', async (_event, { workspaceId, email }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!email) throw new Error('email is required.');
    const db = getDatabase(workspaceId);
    const repo = new DesktopSuppressionRepository(db);
    const unsuppressed = repo.unsuppress(workspaceId, email);

    // Sync to API server if available
    let restoredContactIds: string[] = [];
    try {
      const sdk = WorkspaceManager.getSdk();
      if ((sdk as any).suppressions?.delete) {
        const apiRes = await (sdk as any).suppressions.delete(email);
        if (Array.isArray(apiRes?.restoredContactIds)) {
          restoredContactIds = apiRes.restoredContactIds;
        }
      }
    } catch {}

    // UNSUPPRESS-13: Synchronize local SQLite contacts projection
    try {
      const now = new Date().toISOString();
      const cleanEmail = email.toLowerCase().trim();
      db.prepare(`
        UPDATE contacts
        SET status = CASE WHEN lastContactedAt IS NOT NULL THEN 'CONTACTED' ELSE 'NEW' END,
            emailStatus = 'VALID',
            updatedAt = ?
        WHERE workspaceId = ?
          AND LOWER(TRIM(email)) = ?
          AND status = 'BOUNCED'
      `).run(now, workspaceId, cleanEmail);
    } catch {}

    return { success: true, unsuppressed, email, restoredContactIds };
  });
}
