import { safeRegister } from './helper';
import { getDatabase } from '../database/connection';
import { WorkspaceManager } from '../lib/workspace-manager';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { ProjectionService } from '../services/projection-service';
import { resolveMatchingContactIds } from './crm';
import { randomUUID } from 'crypto';

/**
 * Registers advanced campaign execution, batch enrollments, bulk transitions,
 * and real-time scheduler queue visibility IPC channels.
 */
export function registerCampaignsIpc(): void {
  // 1. Batch enroll contacts into a campaign
  safeRegister('campaigns:enroll', async (_event, { campaignId, contactIds, selection }) => {
    if (!campaignId) throw new Error('campaignId is required.');

    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    const db = getDatabase(runtime.workspaceId);
    const sdk = WorkspaceManager.getSdk();

    let targetContactIds: string[] = [];
    if (selection) {
      if (selection.mode === 'explicit') {
        targetContactIds = Array.isArray(selection.selectedIds) ? selection.selectedIds : [];
      } else if (selection.mode === 'all-matching') {
        targetContactIds = resolveMatchingContactIds(db, runtime.workspaceId, selection.query || {}, selection.excludedIds || []);
      }
    } else if (Array.isArray(contactIds)) {
      targetContactIds = contactIds;
    }

    if (targetContactIds.length === 0) {
      throw new Error('contactIds must be a non-empty array or resolved selection.');
    }

    // Load target campaign to get sequenceId and status
    let campaign = db
      .prepare(
        `
      SELECT sequenceId, status FROM campaigns 
      WHERE id = ? AND workspaceId = ? AND deletedAt IS NULL
    `
      )
      .get(campaignId, runtime.workspaceId) as { sequenceId?: string | null | undefined; status?: string | null | undefined } | undefined;

    if (!campaign) {
      const serverCampaign = await sdk.campaigns.get(campaignId).catch(() => null);
      if (serverCampaign) {
        await LocalCRMRepository.saveFromServer('campaigns', serverCampaign);
        campaign = {
          sequenceId: serverCampaign.sequenceId ?? null,
          status: serverCampaign.status ?? null
        };
      }
    }

    if (!campaign) throw new Error(`Campaign "${campaignId}" not found or deleted.`);

    let sequenceId = campaign.sequenceId;
    if (!sequenceId) {
      const serverCampaign = await sdk.campaigns.get(campaignId).catch(() => null);
      if (serverCampaign?.sequenceId) {
        sequenceId = serverCampaign.sequenceId;
        await LocalCRMRepository.saveFromServer('campaigns', serverCampaign);
      }
    }

    if (!sequenceId) {
      throw new Error(`Campaign "${campaignId}" does not have an attached automation sequence. Please attach a sequence before enrolling contacts.`);
    }

    const isActive = campaign.status?.toUpperCase() === 'ACTIVE';
    const now = new Date().toISOString();
    const enrolledIds: string[] = [];

    for (const contactId of targetContactIds) {
      // Phase 15 (ENROLL-08): Contact cross-campaign exclusivity check.
      // A contact cannot have more than one active execution across the entire workspace concurrently.
      const activeExec = db
        .prepare(
          `
        SELECT id, campaignId, status FROM sequence_executions
        WHERE workspaceId = ? AND contactId = ? AND deletedAt IS NULL
          AND UPPER(status) IN ('PENDING', 'RUNNING', 'WAITING', 'PAUSED')
      `
        )
        .get(runtime.workspaceId, contactId) as { id: string; campaignId: string; status: string } | undefined;

      if (activeExec) {
        console.warn(
          `[IPC] Contact ${contactId} already has active execution ${activeExec.id} (campaign ${activeExec.campaignId}, status ${activeExec.status}). Skipping enrollment.`
        );
        continue;
      }

      let created;
      try {
        created = await sdk.executions.create({
          sequenceId,
          campaignId,
          workspaceId: runtime.workspaceId,
          contactId,
          status: isActive ? 'running' : 'paused',
          startedAt: now
        });
      } catch (err: any) {
        if (err?.message?.includes('exclusivity') || err?.status === 409 || err?.code === 'CONFLICT') {
          console.warn(`[IPC] Contact ${contactId} enrollment conflict on server:`, err.message);
          continue;
        }
        throw err;
      }

      await LocalCRMRepository.saveFromServer('sequence_executions', created);

      // If the campaign is already active, spawn the workflow job via SDK
      if (isActive) {
        try {
          await sdk.jobs.create({
            id: randomUUID(),
            type: 'automation:workflow',
            priority: 3,
            payload: {
              sequenceId: campaign.sequenceId,
              entityId: contactId,
              entityType: 'contact',
              executionId: created.id,
              workspaceId: runtime.workspaceId,
              campaignId,
              contactId
            }
          });
        } catch (err) {
          console.warn('[IPC] Job creation note:', err);
        }
      }

      enrolledIds.push(created.id);
    }

    if (isActive && enrolledIds.length > 0) {
      WorkspaceManager.wakeScheduler();
    }

    if (enrolledIds.length > 0) {
      ProjectionService.broadcastProjectionUpdated('campaigns', runtime.workspaceId);
    }

    console.log(`[IPC] Enrolled ${enrolledIds.length} contact(s) into campaign: ${campaignId}`);
    return { success: true, enrolledCount: enrolledIds.length };
  });

  // 2. List all enrollments for a campaign, enriched with contact and sequence info
  safeRegister('campaigns:enrollments:list', async (_event, { workspaceId, campaignId }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!campaignId) throw new Error('campaignId is required.');

    const db = getDatabase(workspaceId);

    const rows = db
      .prepare(
        `
      SELECT 
        se.*,
        c.firstName,
        c.lastName,
        c.email,
        c.title as contactTitle,
        comp.name as companyName,
        comp.domain as companyDomain,
        s.name as sequenceName
      FROM sequence_executions se
      LEFT JOIN contacts c ON se.contactId = c.id
      LEFT JOIN companies comp ON c.companyId = comp.id
      LEFT JOIN sequences s ON se.sequenceId = s.id
      WHERE se.workspaceId = ? AND se.campaignId = ? AND se.deletedAt IS NULL
      ORDER BY se.createdAt DESC
    `
      )
      .all(workspaceId, campaignId) as any[];

    return rows.map((row) => {
      try {
        if (row.logs && typeof row.logs === 'string') {
          row.logs = JSON.parse(row.logs);
        }
      } catch {
        row.logs = [];
      }
      return row;
    });
  });

  // 3. Bulk Pause Enrollments
  safeRegister(
    'campaigns:bulk-pause-enrollments',
    async (_event, { campaignId, enrollmentIds }) => {
      if (!campaignId) throw new Error('campaignId is required.');
      if (!Array.isArray(enrollmentIds) || enrollmentIds.length === 0) {
        throw new Error('enrollmentIds must be a non-empty array.');
      }

      const runtime = WorkspaceManager.getActiveRuntime();
      if (!runtime) throw new Error('No active workspace runtime');
      const db = getDatabase(runtime.workspaceId);
      const sdk = WorkspaceManager.getSdk();
      const now = new Date().toISOString();

      db.transaction(() => {
        for (const id of enrollmentIds) {
          db.prepare(
            `
          UPDATE sequence_executions
          SET status = 'PAUSED', updatedAt = ?
          WHERE id = ? AND campaignId = ? AND UPPER(status) IN ('RUNNING', 'QUEUED', 'STARTING', 'WAITING')
        `
          ).run(now, id, campaignId);
        }
      })();

      // Cancel pending jobs via SDK
      try {
        const jobsList = await sdk.jobs.list({ limit: 100 });
        const jobsToCancel = (jobsList.data || []).filter(
          (j: any) =>
            j.type === 'automation:workflow' &&
            j.payload?.executionId &&
            enrollmentIds.includes(j.payload.executionId) &&
            ['queued', 'starting', 'running', 'retrying'].includes(j.status)
        );
        for (const job of jobsToCancel) {
          await sdk.jobs.cancel(job.id).catch(() => {});
        }
      } catch (err) {
        console.warn('[IPC] Error cancelling jobs via SDK:', err);
      }

      ProjectionService.broadcastProjectionUpdated('campaigns', runtime.workspaceId);

      return { success: true };
    }
  );

  // 4. Bulk Resume Enrollments
  safeRegister(
    'campaigns:bulk-resume-enrollments',
    async (_event, { campaignId, enrollmentIds }) => {
      if (!campaignId) throw new Error('campaignId is required.');
      if (!Array.isArray(enrollmentIds) || enrollmentIds.length === 0) {
        throw new Error('enrollmentIds must be a non-empty array.');
      }

      const runtime = WorkspaceManager.getActiveRuntime();
      if (!runtime) throw new Error('No active workspace runtime');
      const db = getDatabase(runtime.workspaceId);
      const sdk = WorkspaceManager.getSdk();
      const now = new Date().toISOString();

      const toResume: Array<{ id: string; sequenceId: string; contactId: string; nextExecutionAt: string | null }> = [];

      db.transaction(() => {
        for (const id of enrollmentIds) {
          const enroll = db
            .prepare(
              `
          SELECT sequenceId, contactId, nextExecutionAt FROM sequence_executions
          WHERE id = ? AND campaignId = ? AND UPPER(status) = 'PAUSED'
        `
            )
            .get(id, campaignId) as
            { sequenceId: string; contactId: string; nextExecutionAt: string | null } | undefined;

          if (!enroll) continue;

          const isWaiting = enroll.nextExecutionAt && new Date(enroll.nextExecutionAt) > new Date();
          const newStatus = isWaiting ? 'WAITING' : 'RUNNING';

          db.prepare(
            `
          UPDATE sequence_executions
          SET status = ?, updatedAt = ?
          WHERE id = ?
        `
          ).run(newStatus, now, id);

          if (!isWaiting) {
            toResume.push({ id, ...enroll });
          }
        }
      })();

      // Enqueue resumed jobs via SDK
      for (const item of toResume) {
        try {
          await sdk.jobs.create({
            id: randomUUID(),
            type: 'automation:workflow',
            priority: 3,
            payload: {
              sequenceId: item.sequenceId,
              entityId: item.contactId,
              entityType: 'contact',
              executionId: item.id,
              workspaceId: runtime.workspaceId,
              campaignId,
              contactId: item.contactId
            }
          });
        } catch (err) {
          console.warn('[IPC] Error queueing resumed job:', err);
        }
      }

      ProjectionService.broadcastProjectionUpdated('campaigns', runtime.workspaceId);

      return { success: true };
    }
  );

  // 5. Bulk Remove Enrollments (Hard delete or soft delete execution)
  safeRegister(
    'campaigns:bulk-remove-enrollments',
    async (_event, { campaignId, enrollmentIds }) => {
      if (!campaignId) throw new Error('campaignId is required.');
      if (!Array.isArray(enrollmentIds) || enrollmentIds.length === 0) {
        throw new Error('enrollmentIds must be a non-empty array.');
      }

      const runtime = WorkspaceManager.getActiveRuntime();
      if (!runtime) throw new Error('No active workspace runtime');
      const sdk = WorkspaceManager.getSdk();

      for (const id of enrollmentIds) {
        try {
          await sdk.executions.delete(id);
        } catch (err) {
          console.warn(`[IPC] Execution remote delete warning for ${id}:`, err);
        }

        // Soft delete execution record in SQLite cache
        await LocalCRMRepository.softDeleteFromServer('sequence_executions', runtime.workspaceId, id);
      }

      // Cancel any active background scheduler jobs for these executions
      try {
        const jobsList = await sdk.jobs.list({ limit: 100 });
        const jobsToCancel = (jobsList.data || []).filter(
          (j: any) =>
            j.type === 'automation:workflow' &&
            j.payload?.executionId &&
            enrollmentIds.includes(j.payload.executionId) &&
            ['queued', 'starting', 'running', 'retrying'].includes(j.status)
        );
        for (const job of jobsToCancel) {
          await sdk.jobs.cancel(job.id).catch(() => {});
        }
      } catch (err) {
        console.warn('[IPC] Error cancelling jobs via SDK:', err);
      }

      ProjectionService.broadcastProjectionUpdated('campaigns', runtime.workspaceId);

      return { success: true, count: enrollmentIds.length };
    }
  );

  // 6. Get real-time campaign runtime health & scheduled jobs overview
  safeRegister('campaigns:runtime:overview', async (_event, { workspaceId, campaignId }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const db = getDatabase(workspaceId);
    const sdk = WorkspaceManager.getSdk();

    let parsedJobs: any[] = [];
    try {
      const jobsList = await sdk.jobs.list({ limit: 100 });
      const activeJobs = (jobsList.data || []).filter(
        (j: any) =>
          j.type === 'automation:workflow' &&
          ['queued', 'starting', 'running', 'retrying'].includes(j.status)
      );

      parsedJobs = activeJobs.filter((job: any) => {
        if (!campaignId) return true;
        const execRow = db
          .prepare('SELECT campaignId FROM sequence_executions WHERE id = ?')
          .get(job.payload?.executionId) as any;
        return execRow?.campaignId === campaignId;
      });
    } catch {
      parsedJobs = [];
    }

    // Check waiting executions
    let waitQuery = `
      SELECT id, campaignId, sequenceId, contactId, currentStepIndex, status, nextExecutionAt, startedAt
      FROM sequence_executions
      WHERE workspaceId = ? AND UPPER(status) = 'WAITING' AND deletedAt IS NULL
    `;
    const waitParams: any[] = [workspaceId];
    if (campaignId) {
      waitQuery += ' AND campaignId = ?';
      waitParams.push(campaignId);
    }
    const waitingExecutions = db.prepare(waitQuery).all(...waitParams) as any[];

    return {
      jobs: parsedJobs,
      waiting: waitingExecutions
    };
  });

  // 7. Schedule campaign locally
  safeRegister('campaigns:schedule', async (_event, campaignId) => {
    if (!campaignId) throw new Error('campaignId is required.');

    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    const db = getDatabase(runtime.workspaceId);
    const sdk = WorkspaceManager.getSdk();
    const now = new Date().toISOString();

    // Load campaign record
    const campaign = db
      .prepare(`SELECT sequenceId, status FROM campaigns WHERE id = ? AND workspaceId = ? AND deletedAt IS NULL`)
      .get(campaignId, runtime.workspaceId) as { sequenceId: string; status: string } | undefined;

    if (!campaign) throw new Error(`Campaign "${campaignId}" not found or deleted.`);

    // 1. Set campaign status to ACTIVE authoritatively in MongoDB via SDK
    try {
      const updatedCampaign = await sdk.campaigns.update(campaignId, { status: 'ACTIVE' as any });
      if (updatedCampaign) {
        await LocalCRMRepository.saveFromServer('campaigns', updatedCampaign);
      }
    } catch (err) {
      console.warn(`[IPC] Server campaign status update warning for ${campaignId}:`, err);
      db.prepare(`UPDATE campaigns SET status = 'ACTIVE', updatedAt = ? WHERE id = ? AND workspaceId = ?`)
        .run(now, campaignId, runtime.workspaceId);
    }

    // 2. Fetch sequence_executions for this campaign that are not completed
    const enrollments = db
      .prepare(`SELECT id, contactId, nextExecutionAt, status FROM sequence_executions WHERE campaignId = ? AND UPPER(status) != 'COMPLETED' AND deletedAt IS NULL`)
      .all(campaignId) as Array<{ id: string; contactId: string; nextExecutionAt: string | null; status: string }>;

    for (const enroll of enrollments) {
      if (enroll.status?.toUpperCase() === 'COMPLETED') continue;
      const isWaiting = enroll.nextExecutionAt && new Date(enroll.nextExecutionAt) > new Date();
      const newStatus = isWaiting ? 'WAITING' : 'RUNNING';

      db.prepare(`UPDATE sequence_executions SET status = ?, updatedAt = ? WHERE id = ?`).run(newStatus, now, enroll.id);
    }

    WorkspaceManager.wakeScheduler();

    ProjectionService.broadcastProjectionUpdated('campaigns', runtime.workspaceId);

    console.log(`[IPC] Campaign "${campaignId}" scheduled successfully.`);
    return { success: true, campaignId };
  });

  // 8. Pause campaign
  safeRegister('campaigns:pause', async (_event, campaignId) => {
    if (!campaignId) throw new Error('campaignId is required.');
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    const db = getDatabase(runtime.workspaceId);
    const sdk = WorkspaceManager.getSdk();
    const now = new Date().toISOString();

    // 1. Update authoritative server state with USER_REQUESTED pauseReason
    try {
      const updated = await sdk.campaigns.update(campaignId, {
        status: 'PAUSED' as any,
        settings: { pauseReason: 'USER_REQUESTED' } as any
      });
      if (updated) {
        await LocalCRMRepository.saveFromServer('campaigns', updated);
      }
    } catch (err) {
      console.warn(`[IPC] Server campaign pause warning for ${campaignId}:`, err);
      db.prepare(`UPDATE campaigns SET status = 'PAUSED', updatedAt = ? WHERE id = ? AND workspaceId = ?`)
        .run(now, campaignId, runtime.workspaceId);
    }

    // 2. Pause active and waiting sequence executions in SQLite (PAUSE-07)
    db.prepare(`
      UPDATE sequence_executions
      SET status = 'PAUSED', updatedAt = ?
      WHERE campaignId = ? AND UPPER(status) IN ('RUNNING', 'QUEUED', 'STARTING', 'WAITING')
    `).run(now, campaignId);

    // 3. Cancel any in-flight/queued jobs for this campaign
    try {
      const jobsList = await sdk.jobs.list({ limit: 100 });
      const jobsToCancel = (jobsList.data || []).filter(
        (j: any) =>
          (j.payload?.campaignId === campaignId ||
            (j.type === 'outreach:campaign' && j.payload?.campaignId === campaignId) ||
            (j.payload?.executionId && Boolean(db.prepare('SELECT campaignId FROM sequence_executions WHERE id = ? AND campaignId = ?').get(j.payload.executionId, campaignId)))) &&
          ['queued', 'starting', 'running', 'retrying'].includes(j.status)
      );
      for (const job of jobsToCancel) {
        await sdk.jobs.cancel(job.id).catch(() => {});
      }
    } catch (err) {
      console.warn('[IPC] Error cancelling paused jobs via SDK:', err);
    }

    ProjectionService.broadcastProjectionUpdated('campaigns', runtime.workspaceId);

    return { success: true, campaignId, status: 'PAUSED' };
  });

  // 8b. Resume campaign (RESUME-09)
  safeRegister('campaigns:resume', async (_event, campaignId) => {
    if (!campaignId) throw new Error('campaignId is required.');
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    const db = getDatabase(runtime.workspaceId);
    const sdk = WorkspaceManager.getSdk();
    const now = new Date().toISOString();

    const campaign = db
      .prepare(`SELECT sequenceId, status FROM campaigns WHERE id = ? AND workspaceId = ? AND deletedAt IS NULL`)
      .get(campaignId, runtime.workspaceId) as { sequenceId: string; status: string } | undefined;

    if (!campaign) throw new Error(`Campaign "${campaignId}" not found or deleted.`);

    // 1. Authoritatively resume campaign in MongoDB via API (clearing pauseReason)
    try {
      const updated = await sdk.campaigns.update(campaignId, {
        status: 'ACTIVE' as any,
        settings: { pauseReason: null } as any
      });
      if (updated) {
        await LocalCRMRepository.saveFromServer('campaigns', updated);
      }
    } catch (err) {
      console.warn(`[IPC] Server campaign resume warning for ${campaignId}:`, err);
      db.prepare(`UPDATE campaigns SET status = 'ACTIVE', updatedAt = ? WHERE id = ? AND workspaceId = ?`)
        .run(now, campaignId, runtime.workspaceId);
    }

    // 2. Restore paused executions in SQLite
    const pausedExecutions = db
      .prepare(`
        SELECT id, contactId, nextExecutionAt, currentStepIndex 
        FROM sequence_executions 
        WHERE campaignId = ? AND UPPER(status) = 'PAUSED' AND deletedAt IS NULL
      `)
      .all(campaignId) as Array<{ id: string; contactId: string; nextExecutionAt: string | null; currentStepIndex: number }>;

    let enqueuedCount = 0;
    const nowMs = Date.now();

    for (const exec of pausedExecutions) {
      const isWaiting = exec.nextExecutionAt && new Date(exec.nextExecutionAt).getTime() > nowMs;
      const newStatus = isWaiting ? 'WAITING' : 'RUNNING';

      db.prepare(`UPDATE sequence_executions SET status = ?, updatedAt = ? WHERE id = ?`)
        .run(newStatus, now, exec.id);

      if (!isWaiting) {
        try {
          await sdk.jobs.create({
            id: randomUUID(),
            type: 'automation:workflow',
            priority: 3,
            payload: {
              sequenceId: campaign.sequenceId,
              entityId: exec.contactId,
              entityType: 'contact',
              executionId: exec.id,
              workspaceId: runtime.workspaceId,
              campaignId,
              contactId: exec.contactId
            }
          });
          enqueuedCount++;
        } catch (err) {
          console.warn('[IPC] Error re-queueing resumed job:', err);
        }
      }
    }

    if (enqueuedCount > 0) {
      WorkspaceManager.wakeScheduler();
    }

    ProjectionService.broadcastProjectionUpdated('campaigns', runtime.workspaceId);

    console.log(`[IPC] Resumed campaign ${campaignId}. Enqueued ${enqueuedCount} immediate job(s).`);
    return { success: true, campaignId, status: 'ACTIVE', enqueuedCount };
  });

  // 9. Stop campaign (terminal)
  safeRegister('campaigns:stop', async (_event, campaignId) => {
    if (!campaignId) throw new Error('campaignId is required.');
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    const db = getDatabase(runtime.workspaceId);
    const sdk = WorkspaceManager.getSdk();
    const now = new Date().toISOString();

    // 1. Update authoritative server state
    try {
      const updated = await sdk.campaigns.update(campaignId, { status: 'STOPPED' as any });
      if (updated) {
        await LocalCRMRepository.saveFromServer('campaigns', updated);
      }
    } catch (err) {
      console.warn(`[IPC] Server campaign stop warning for ${campaignId}:`, err);
      db.prepare(`UPDATE campaigns SET status = 'STOPPED', updatedAt = ? WHERE id = ? AND workspaceId = ?`)
        .run(now, campaignId, runtime.workspaceId);
    }

    // 2. Permanently cancel all non-completed executions in SQLite
    db.prepare(`
      UPDATE sequence_executions
      SET status = 'CANCELLED', updatedAt = ?
      WHERE campaignId = ? AND UPPER(status) IN ('RUNNING', 'QUEUED', 'STARTING', 'WAITING', 'PAUSED')
    `).run(now, campaignId);

    // 3. Cancel any in-flight/queued jobs for this campaign
    try {
      const jobsList = await sdk.jobs.list({ limit: 100 });
      const jobsToCancel = (jobsList.data || []).filter(
        (j: any) =>
          (j.payload?.campaignId === campaignId ||
            (j.type === 'outreach:campaign' && j.payload?.campaignId === campaignId) ||
            (j.payload?.executionId && Boolean(db.prepare('SELECT campaignId FROM sequence_executions WHERE id = ? AND campaignId = ?').get(j.payload.executionId, campaignId)))) &&
          ['queued', 'starting', 'running', 'retrying'].includes(j.status)
      );
      for (const job of jobsToCancel) {
        await sdk.jobs.cancel(job.id).catch(() => {});
      }
    } catch (err) {
      console.warn('[IPC] Error cancelling stopped jobs via SDK:', err);
    }

    ProjectionService.broadcastProjectionUpdated('campaigns', runtime.workspaceId);

    return { success: true, campaignId, status: 'STOPPED' };
  });
}
