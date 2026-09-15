import { DiscoveryRunRepository } from '../../repositories/discovery-run/discovery-run.repository.js';
import { CompanyDiscoveryRunRepository } from '../../repositories/company-discovery-run/company-discovery-run.repository.js';
import { CompanyRepository } from '../../repositories/company/company.repository.js';
import { JobModel } from '../../db/models/job.model.js';
import { BadRequestError, NotFoundError } from '../../errors/index.js';
import type { DiscoveryRunDocument } from '../../db/models/discovery-run.model.js';
import type { CompanyDiscoveryRunDocument } from '../../db/models/company-discovery-run.model.js';
import type { CompanyDocument } from '../../db/models/company.model.js';

export class DiscoveryRunService {
  private discoveryRunRepository: DiscoveryRunRepository;
  private companyDiscoveryRunRepository: CompanyDiscoveryRunRepository;
  private companyRepository: CompanyRepository;

  constructor(private workspaceId: string) {
    this.discoveryRunRepository = new DiscoveryRunRepository(workspaceId);
    this.companyDiscoveryRunRepository = new CompanyDiscoveryRunRepository(workspaceId);
    this.companyRepository = new CompanyRepository(workspaceId);
  }

  public async getRunById(id: string): Promise<DiscoveryRunDocument> {
    return this.discoveryRunRepository.findById(id);
  }

  public async listRuns(
    page?: number,
    limit?: number
  ): Promise<{ data: DiscoveryRunDocument[]; total: number }> {
    return this.discoveryRunRepository.paginate({}, page, limit);
  }

  public async createRun(data: Partial<DiscoveryRunDocument>): Promise<DiscoveryRunDocument> {
    return this.discoveryRunRepository.create(data);
  }

  public async updateRun(id: string, data: Partial<DiscoveryRunDocument>): Promise<DiscoveryRunDocument> {
    return this.discoveryRunRepository.update(id, data);
  }

  /**
   * Safely deletes a discovery run:
   * 1. Rejects deletion if run is actively running.
   * 2. Cancels active/scheduled jobs tied to this discovery run.
   * 3. Hard-deletes run-owned provenance records (CompanyDiscoveryRun).
   * 4. Soft-deletes authoritative DiscoveryRun record.
   * ABSOLUTE INVARIANT: NEVER deletes canonical Company or Contact records.
   */
  public async deleteRun(id: string): Promise<boolean> {
    const run = await this.discoveryRunRepository.findById(id);
    if (!run) {
      throw new NotFoundError(`Discovery run with id ${id} not found.`);
    }

    if (run.status === 'running') {
      throw new BadRequestError(
        'Cannot delete a discovery run while it is actively running. Please cancel or wait for it to complete first.'
      );
    }

    // 1. Cancel/clean any scheduled or active discovery jobs for this run
    try {
      await JobModel.updateMany(
        {
          workspaceId: this.workspaceId,
          'payload.discoveryRunId': id,
          status: { $in: ['pending', 'queued', 'starting', 'waiting', 'retrying'] }
        },
        {
          $set: {
            status: 'cancelled',
            finishedAt: new Date(),
            error: 'Discovery run deleted'
          }
        }
      );
    } catch (err) {
      console.warn('[DiscoveryRunService] Note on cancelling discovery jobs:', err);
    }

    // 2. Remove run-owned provenance records (CompanyDiscoveryRun)
    await this.companyDiscoveryRunRepository.deleteForRun(id);

    // 3. Soft-delete the authoritative DiscoveryRun record
    await this.discoveryRunRepository.delete(id);

    return true;
  }

  public async recordCompanyProvenance(
    companyId: string,
    discoveryRunId: string,
    requiresReview = false
  ): Promise<any> {
    return this.companyDiscoveryRunRepository.create({
      companyId,
      discoveryRunId,
      requiresReview
    });
  }

  public async listProvenance(
    filter?: any,
    page?: number,
    limit?: number
  ): Promise<{ data: CompanyDiscoveryRunDocument[]; total: number }> {
    return this.companyDiscoveryRunRepository.paginate(filter || {}, page, limit);
  }

  public async listCompaniesForRun(discoveryRunId: string): Promise<string[]> {
    const records = await this.companyDiscoveryRunRepository.findMany({ discoveryRunId });
    return records.map((r) => r.companyId);
  }

  public async getCompaniesForRun(discoveryRunId: string): Promise<CompanyDocument[]> {
    const companyIds = await this.listCompaniesForRun(discoveryRunId);
    if (!companyIds.length) return [];
    return this.companyRepository.findMany({ _id: { $in: companyIds } } as any);
  }
}
