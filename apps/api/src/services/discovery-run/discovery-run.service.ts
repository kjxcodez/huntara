import { DiscoveryRunRepository } from '../../repositories/discovery-run/discovery-run.repository.js';
import { CompanyDiscoveryRunRepository } from '../../repositories/company-discovery-run/company-discovery-run.repository.js';
import { CompanyRepository } from '../../repositories/company/company.repository.js';
import { CompanyService } from '../company/company.service.js';
import { CompanyModel } from '../../db/models/company.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { CompanyDiscoveryRunModel } from '../../db/models/company-discovery-run.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { AudienceModel } from '../../db/models/audience.model.js';
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
   * 2. Evaluates linked companies while provenance still exists:
   *    - Preserves companies linked to multiple runs.
   *    - Preserves companies that pre-existed the discovery run.
   *    - Preserves companies and contacts with CRM/outreach lineage (executions, deliveries, jobs, audiences).
   *    - Safely deletes exclusive, clean companies and their eligible contacts via CompanyService.
   * 3. Cancels active/scheduled jobs tied to this discovery run.
   * 4. Hard-deletes run-owned provenance records (CompanyDiscoveryRun).
   * 5. Soft-deletes authoritative DiscoveryRun record.
   */
  public async deleteRun(id: string): Promise<{
    success: boolean;
    deletedCompanyIds?: string[];
    deletedContactIds?: string[];
  }> {
    const run = await this.discoveryRunRepository.findById(id);
    if (!run) {
      throw new NotFoundError(`Discovery run with id ${id} not found.`);
    }

    if (run.status === 'running') {
      throw new BadRequestError(
        'Cannot delete a discovery run while it is actively running. Please cancel or wait for it to complete first.'
      );
    }

    const deletedCompanyIds: string[] = [];
    const deletedContactIds: string[] = [];

    // 1. Determine candidate companies linked to this run before removing provenance
    const runLinks = await CompanyDiscoveryRunModel.find({
      workspaceId: this.workspaceId,
      discoveryRunId: id
    });
    const candidateCompanyIds = [
      ...new Set(runLinks.map((link) => (link.companyId ? link.companyId.toString() : '')).filter(Boolean))
    ];

    const companyService = new CompanyService(this.workspaceId);

    // 2. Evaluate each company while provenance still exists
    for (const companyId of candidateCompanyIds) {
      // Step A: Check if company is linked to any other discovery run
      const otherRunsCount = await CompanyDiscoveryRunModel.countDocuments({
        workspaceId: this.workspaceId,
        companyId,
        discoveryRunId: { $ne: id }
      });
      if (otherRunsCount > 0) {
        // Preserved (Case 2): Shared with other discovery run(s)
        continue;
      }

      // Step B: Check if company existed before the run
      const company = await CompanyModel.findOne({
        _id: companyId,
        workspaceId: this.workspaceId
      });
      if (!company) continue;

      if (
        company.createdAt &&
        run.createdAt &&
        new Date(company.createdAt).getTime() < new Date(run.createdAt).getTime()
      ) {
        // Preserved (Case 3): Pre-existed the discovery run
        continue;
      }

      // Step C: Check downstream lineage
      // C1: Direct company sequence executions
      const compExecCount = await SequenceExecutionModel.countDocuments({
        workspaceId: this.workspaceId,
        companyId
      });
      if (compExecCount > 0) continue;

      // C2: Active jobs targeting the company (other than this run's jobs)
      const compJobsCount = await JobModel.countDocuments({
        workspaceId: this.workspaceId,
        'payload.companyId': companyId,
        'payload.discoveryRunId': { $ne: id },
        status: { $in: ['pending', 'queued', 'starting', 'waiting', 'retrying', 'running'] }
      });
      if (compJobsCount > 0) continue;

      // C3: Static audience membership
      const compAudienceCount = await AudienceModel.countDocuments({
        workspaceId: this.workspaceId,
        staticMemberIds: companyId
      });
      if (compAudienceCount > 0) continue;

      // C4: Contact outreach history & active work
      const contacts = await ContactModel.find({
        workspaceId: this.workspaceId,
        companyId
      });

      if (contacts.length > 0) {
        const contactIds = contacts.map((c) => c._id.toString());
        const contactEmails = contacts.map((c) => c.email).filter(Boolean) as string[];

        const [contactExecs, contactDeliveries, contactActiveJobs, contactAudiences] =
          await Promise.all([
            SequenceExecutionModel.countDocuments({
              workspaceId: this.workspaceId,
              contactId: { $in: contactIds }
            }),
            EmailDeliveryModel.countDocuments({
              workspaceId: this.workspaceId,
              $or: [
                { contactId: { $in: contactIds } },
                { recipientEmail: { $in: contactEmails } }
              ]
            }),
            JobModel.countDocuments({
              workspaceId: this.workspaceId,
              'payload.contactId': { $in: contactIds },
              status: { $in: ['pending', 'queued', 'starting', 'waiting', 'retrying', 'running'] }
            }),
            AudienceModel.countDocuments({
              workspaceId: this.workspaceId,
              staticMemberIds: { $in: contactIds }
            })
          ]);

        if (
          contactExecs > 0 ||
          contactDeliveries > 0 ||
          contactActiveJobs > 0 ||
          contactAudiences > 0
        ) {
          // Preserved (Case 4 / Case F): One or more contacts has outreach/lineage history
          continue;
        }
      }

      // Step D: Delete only if safe (Case 1)
      try {
        const delRes = await companyService.deleteCompany(companyId, {
          mode: 'company-and-eligible-contacts'
        });
        if (delRes.companyDeleted) {
          deletedCompanyIds.push(companyId);
        }
        if (delRes.deletedContactIds?.length) {
          deletedContactIds.push(...delRes.deletedContactIds);
        }
      } catch (delErr) {
        console.warn(`[DiscoveryRunService] Failed to cascade delete company ${companyId}:`, delErr);
      }
    }

    // 3. Cancel/clean any scheduled or active discovery jobs for this run
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

    // 4. Remove this run's CompanyDiscoveryRun provenance
    await this.companyDiscoveryRunRepository.deleteForRun(id);

    // 5. Soft-delete the authoritative DiscoveryRun record
    await this.discoveryRunRepository.delete(id);

    const result: {
      success: boolean;
      deletedCompanyIds?: string[];
      deletedContactIds?: string[];
    } = {
      success: true
    };

    if (deletedCompanyIds.length > 0) {
      result.deletedCompanyIds = deletedCompanyIds;
    }
    if (deletedContactIds.length > 0) {
      result.deletedContactIds = deletedContactIds;
    }

    return result;
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
