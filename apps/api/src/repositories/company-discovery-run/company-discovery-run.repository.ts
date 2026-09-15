import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../base/base.repository.js';
import {
  CompanyDiscoveryRunModel,
  type CompanyDiscoveryRunDocument
} from '../../db/models/company-discovery-run.model.js';

export class CompanyDiscoveryRunRepository extends BaseRepository<CompanyDiscoveryRunDocument> {
  constructor(workspaceId?: string) {
    super(CompanyDiscoveryRunModel, workspaceId);
  }

  /**
   * Hard-deletes all provenance junction records linking companies to a specific discovery run.
   * Strictly isolated to the active workspaceId.
   */
  public async deleteForRun(discoveryRunId: string, session?: ClientSession): Promise<number> {
    const filter = this.applyScope({ discoveryRunId });
    const result = await this.model.deleteMany(filter).session(session || null);
    return result.deletedCount || 0;
  }
}
