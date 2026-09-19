import type { WorkflowRepository } from '@huntara/agent-core';
import type { SequenceExecution, SequenceLog, Sequence } from '@huntara/schema';
import { LocalCRMRepository } from './local-crm';

export class WorkflowRepositoryImpl implements WorkflowRepository {
  public async getExecutionById(
    id: string,
    workspaceId: string
  ): Promise<SequenceExecution | null> {
    return LocalCRMRepository.findById('sequence_executions', workspaceId, id);
  }

  public async saveExecution(execution: SequenceExecution): Promise<SequenceExecution> {
    return LocalCRMRepository.save('sequence_executions', execution);
  }

  public async saveLog(log: SequenceLog): Promise<SequenceLog> {
    if (log.executionId && log.workspaceId) {
      const exec = await LocalCRMRepository.findById('sequence_executions', log.workspaceId, log.executionId);
      if (exec) {
        const existingLogs = Array.isArray(exec.logs)
          ? exec.logs
          : typeof exec.logs === 'string'
          ? JSON.parse(exec.logs || '[]')
          : [];
        existingLogs.push(log);
        await LocalCRMRepository.save('sequence_executions', { ...exec, logs: existingLogs });
      }
    }
    return log;
  }

  public async findExecutions(
    workspaceId: string,
    filter?: Record<string, any>
  ): Promise<SequenceExecution[]> {
    return LocalCRMRepository.findMany('sequence_executions', workspaceId, filter);
  }

  public async getSequenceById(id: string, workspaceId: string): Promise<Sequence | null> {
    return LocalCRMRepository.findById('sequences', workspaceId, id);
  }
}
