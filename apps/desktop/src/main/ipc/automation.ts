import { safeRegister } from './helper';
import { SdkClient } from '@huntara/sdk';
import { WorkspaceManager } from '../lib/workspace-manager';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { randomUUID } from 'crypto';

/**
 * Registers sequences and executions automation IPC channels.
 */
export function registerAutomationIpc(sdk: SdkClient) {
  // Sequences CRUD
  safeRegister('sequence:list', async (_event, payload) => {
    const wsId = typeof payload === 'string' ? payload : payload?.workspaceId;
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime(wsId);
    if (!runtime) return [];
    try {
      const list = await sdk.sequences.list();
      await LocalCRMRepository.saveMany(
        'sequences',
        list.map((item) => ({ ...item, workspaceId: runtime.workspaceId })),
        true
      );
      return list;
    } catch (err) {
      console.warn('[IPC] Failed to list sequences from remote, falling back to local cache:', err);
      return LocalCRMRepository.findMany('sequences', runtime.workspaceId);
    }
  });

  safeRegister('sequence:get', async (_event, id) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    try {
      const res = await sdk.sequences.get(id);
      await LocalCRMRepository.save(
        'sequences',
        { ...res, workspaceId: runtime.workspaceId },
        true
      );
      return res;
    } catch (err) {
      const cached = await LocalCRMRepository.findById('sequences', runtime.workspaceId, id);
      if (!cached) throw err;
      return cached;
    }
  });

  safeRegister('sequence:create', async (_event, dto) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    const created = await sdk.sequences.create(dto);
    await LocalCRMRepository.saveFromServer('sequences', created);
    return created;
  });

  safeRegister('sequence:update', async (_event, { id, dto }) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    const updated = await sdk.sequences.update(id, dto);
    await LocalCRMRepository.saveFromServer('sequences', updated);
    return updated;
  });

  safeRegister('sequence:delete', async (_event, id) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');
    await sdk.sequences.delete(id);
    await LocalCRMRepository.softDeleteFromServer('sequences', runtime.workspaceId, id);
    return { success: true };
  });

  // Executions Orchestration — MongoDB-First Execution Start
  safeRegister('sequence:start', async (_event, { sequenceId, contactId, companyId }) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    const execution = await sdk.executions.start(sequenceId, contactId, companyId);
    await LocalCRMRepository.saveFromServer('sequence_executions', execution);

    // Enqueue automation:workflow job via SdkClient for desktop JobScheduler & JobWorker
    const jobId = randomUUID();
    const jobPayload = {
      sequenceId,
      entityId: contactId || companyId || '',
      entityType: contactId ? 'contact' : companyId ? 'company' : '',
      executionId: execution.id,
      workspaceId: runtime.workspaceId
    };

    try {
      await sdk.jobs.create({
        id: jobId,
        type: 'automation:workflow',
        priority: 3,
        payload: jobPayload,
        maxRetries: 3
      });
    } catch (err) {
      console.warn('[IPC] Note: scheduler job queueing:', err);
    }

    return execution;
  });

  safeRegister('sequence:stop', async (_event, id) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    const stopped = await sdk.executions.stop(id);
    await LocalCRMRepository.saveFromServer('sequence_executions', stopped);

    return stopped;
  });

  safeRegister('execution:list', async () => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    // 1. Read directly from local SQLite database (local-first)
    const localList = await LocalCRMRepository.findMany('sequence_executions', runtime.workspaceId);

    // 2. Background non-blocking remote sync pull
    sdk.executions
      .list()
      .then(async (remoteList) => {
        if (Array.isArray(remoteList)) {
          await LocalCRMRepository.saveMany(
            'sequence_executions',
            remoteList.map((item) => ({ ...item, workspaceId: runtime.workspaceId })),
            true
          );
        }
      })
      .catch((err) => {
        console.warn('[IPC] Remote executions pull skipped:', err.message);
      });

    return localList;
  });

  safeRegister('execution:get', async (_event, id) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    // Read directly from local SQLite database first
    const cached = await LocalCRMRepository.findById(
      'sequence_executions',
      runtime.workspaceId,
      id
    );
    if (cached) return cached;

    try {
      const res = await sdk.executions.get(id);
      if (res) {
        await LocalCRMRepository.save(
          'sequence_executions',
          { ...res, workspaceId: runtime.workspaceId },
          true
        );
      }
      return res;
    } catch (err) {
      return null;
    }
  });

  safeRegister('execution:logs', async (_event, id) => {
    const runtime = WorkspaceManager.getActiveRuntime();
    if (!runtime) throw new Error('No active workspace runtime');

    // 1. Read embedded logs column from cached sequence_executions record
    const execRecord = await LocalCRMRepository.findById(
      'sequence_executions',
      runtime.workspaceId,
      id
    );
    if (execRecord?.logs) {
      try {
        const parsed =
          typeof execRecord.logs === 'string' ? JSON.parse(execRecord.logs) : execRecord.logs;
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }

    // 2. Fallback to authoritative remote SDK
    try {
      return await sdk.executions.getLogs(id);
    } catch {
      return [];
    }
  });
}
