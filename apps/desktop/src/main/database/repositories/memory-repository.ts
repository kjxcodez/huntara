import { randomUUID } from 'crypto';
import type { AgentMemoryRepository } from '@huntara/agent-core';
import { getDatabase } from '../connection';

export class AgentMemoryRepositoryImpl implements AgentMemoryRepository {
  /**
   * Retrieves scoped memory value from workspace_memory table.
   */
  public async getMemory(workspaceId: string, scope: string, key: string): Promise<unknown> {
    const db = getDatabase(workspaceId);
    const row = db
      .prepare(
        `
      SELECT value FROM workspace_memory
      WHERE workspaceId = ? AND scope = ? AND key = ? AND deletedAt IS NULL
    `
      )
      .get(workspaceId, scope, key) as { value: string } | undefined;

    if (row?.value) {
      try {
        return JSON.parse(row.value);
      } catch {
        return row.value;
      }
    }
    return null;
  }

  /**
   * Saves memory to workspace_memory table.
   */
  public async saveMemory(
    workspaceId: string,
    scope: string,
    key: string,
    value: unknown
  ): Promise<void> {
    const db = getDatabase(workspaceId);
    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const id = randomUUID();

    db.transaction(() => {
      const existing = db
        .prepare(
          `
        SELECT id, version FROM workspace_memory
        WHERE workspaceId = ? AND scope = ? AND key = ? AND deletedAt IS NULL
      `
        )
        .get(workspaceId, scope, key) as { id: string; version: number } | undefined;

      if (existing) {
        db.prepare(
          `
          UPDATE workspace_memory
          SET value = ?, version = version + 1, updatedAt = datetime('now')
          WHERE id = ?
        `
        ).run(serialized, existing.id);
      } else {
        db.prepare(
          `
          INSERT INTO workspace_memory (id, workspaceId, scope, key, value, version)
          VALUES (?, ?, ?, ?, ?, 1)
        `
        ).run(id, workspaceId, scope, key, serialized);
      }
    })();
  }

  /**
   * Soft deletes memory from workspace_memory table.
   */
  public async deleteMemory(workspaceId: string, scope: string, key: string): Promise<void> {
    const db = getDatabase(workspaceId);

    db.transaction(() => {
      const existing = db
        .prepare(
          `
        SELECT id FROM workspace_memory
        WHERE workspaceId = ? AND scope = ? AND key = ? AND deletedAt IS NULL
      `
        )
        .get(workspaceId, scope, key) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          `
          UPDATE workspace_memory
          SET deletedAt = datetime('now'), updatedAt = datetime('now')
          WHERE id = ?
        `
        ).run(existing.id);
      }
    })();
  }
}
