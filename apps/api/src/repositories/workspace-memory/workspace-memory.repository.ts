import { BaseRepository } from '../base/base.repository.js';
import { WorkspaceMemoryModel, type WorkspaceMemoryDocument } from '../../db/models/workspace-memory.model.js';
import { generateEntityId } from '@huntara/schema';

export class WorkspaceMemoryRepository extends BaseRepository<WorkspaceMemoryDocument> {
  constructor(workspaceId?: string) {
    super(WorkspaceMemoryModel, workspaceId);
  }

  public async getMemory(scope: string, key: string): Promise<WorkspaceMemoryDocument | null> {
    return this.findOne({ scope, key });
  }

  public async setMemory(scope: string, key: string, value: any): Promise<WorkspaceMemoryDocument> {
    const filter: any = { scope, key };
    if (this.workspaceId) {
      filter.workspaceId = this.workspaceId;
    }

    const doc = await this.model.findOneAndUpdate(
      filter,
      {
        $set: { value, updatedAt: new Date() },
        $setOnInsert: { _id: generateEntityId(), workspaceId: this.workspaceId, scope, key, createdAt: new Date() }
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    return doc as unknown as WorkspaceMemoryDocument;
  }

  public async deleteMemory(scope: string, key: string): Promise<boolean> {
    const filter: any = { scope, key };
    if (this.workspaceId) {
      filter.workspaceId = this.workspaceId;
    }
    const res = await this.model.deleteOne(filter);
    return res.deletedCount > 0;
  }

  public async listScope(scope: string): Promise<WorkspaceMemoryDocument[]> {
    return this.findMany({ scope });
  }
}
