import { CompanyRepository } from '../../repositories/company/company.repository.js';
import { CompanyDiscoveryRunRepository } from '../../repositories/company-discovery-run/company-discovery-run.repository.js';
import type { CompanyDocument } from '../../db/models/company.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { JobModel } from '../../db/models/job.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { CompanyIntelligenceModel } from '../../db/models/company-intelligence.model.js';
import { WebsiteIntelligenceModel } from '../../db/models/website-intelligence.model.js';
import { OpportunityScoreModel } from '../../db/models/opportunity-score.model.js';
import { PageCrawlModel } from '../../db/models/page-crawl.model.js';
import { IntelligenceSourceModel } from '../../db/models/intelligence-source.model.js';
import { IntelligenceEvidenceModel } from '../../db/models/intelligence-evidence.model.js';
import { IntelligenceClaimModel } from '../../db/models/intelligence-claim.model.js';
import { IntelligenceInferenceModel } from '../../db/models/intelligence-inference.model.js';
import { NotFoundError } from '../../errors/index.js';
import {
  createCompanyDtoSchema,
  updateCompanyDtoSchema,
  bulkCompanyDtoSchema,
  type CreateCompanyDto,
  type UpdateCompanyDto,
  type BulkCompanyDto,
  type BulkOperationResult,
  type DeleteCompanyMode,
  type DeleteCompanyResult
} from '@huntara/schema';

export class CompanyService {
  private companyRepository: CompanyRepository;
  private companyDiscoveryRunRepository: CompanyDiscoveryRunRepository;

  constructor(private workspaceId: string) {
    this.companyRepository = new CompanyRepository(workspaceId);
    this.companyDiscoveryRunRepository = new CompanyDiscoveryRunRepository(workspaceId);
  }

  public async getCompanyById(id: string): Promise<CompanyDocument> {
    return this.companyRepository.findById(id);
  }

  public async listCompanies(
    page?: number,
    limit?: number,
    filter?: any
  ): Promise<{ data: CompanyDocument[]; total: number }> {
    const query: any = {};
    if (filter) {
      if (filter.status) query.status = filter.status;
      if (filter.industry) query.industry = { $regex: filter.industry, $options: 'i' };
      if (filter.city) query.$or = [{ city: { $regex: filter.city, $options: 'i' } }, { location: { $regex: filter.city, $options: 'i' } }];
      if (filter.state) {
        const stateOr = [{ state: { $regex: filter.state, $options: 'i' } }, { location: { $regex: filter.state, $options: 'i' } }];
        if (query.$or) {
          query.$and = (query.$and || []).concat([{ $or: query.$or }, { $or: stateOr }]);
          delete query.$or;
        } else {
          query.$or = stateOr;
        }
      }
      if (filter.country) {
        const countryOr = [{ country: { $regex: filter.country, $options: 'i' } }, { location: { $regex: filter.country, $options: 'i' } }];
        if (query.$and || query.$or) {
          query.$and = (query.$and || []).concat(query.$or ? [{ $or: query.$or }] : []).concat([{ $or: countryOr }]);
          delete query.$or;
        } else {
          query.$or = countryOr;
        }
      }
      if (filter.location && !filter.city && !filter.state && !filter.country) {
        query.location = { $regex: filter.location, $options: 'i' };
      }
      if (filter.name) query.name = { $regex: filter.name, $options: 'i' };
      if (filter.domain) query.domain = { $regex: filter.domain, $options: 'i' };
      if (filter.search) {
        const searchRegex = { $regex: filter.search, $options: 'i' };
        const searchConditions = [
          { name: searchRegex },
          { domain: searchRegex },
          { industry: searchRegex },
          { location: searchRegex }
        ];
        if (query.$and || query.$or) {
          query.$and = (query.$and || []).concat(query.$or ? [{ $or: query.$or }] : []).concat([{ $or: searchConditions }]);
          delete query.$or;
        } else {
          query.$or = searchConditions;
        }
      }
    }
    return this.companyRepository.paginate(query, page, limit, { createdAt: -1 });
  }

  public async createCompany(dto: CreateCompanyDto): Promise<CompanyDocument> {
    const validated = createCompanyDtoSchema.parse(dto);
    return this.companyRepository.create({
      ...validated,
      tags: []
    });
  }

  public async createBulk(dto: BulkCompanyDto): Promise<BulkOperationResult<CompanyDocument>> {
    const validated = bulkCompanyDtoSchema.parse(dto);
    return this.companyRepository.bulkInsert(validated.companies);
  }

  public async updateCompany(id: string, dto: UpdateCompanyDto): Promise<CompanyDocument> {
    const validated = updateCompanyDtoSchema.parse(dto);
    return this.companyRepository.update(id, validated);
  }

  /**
   * Authoritatively and safely deletes a canonical Company.
   *
   * Enforces:
   * 1. Workspace-scoped authorization & existence.
   * 2. Idempotent repeated deletion (returns alreadyDeleted: true if already soft-deleted).
   * 3. Cancellation of pending/queued background jobs targeting this company.
   * 4. Removal of run-provenance junctions (CompanyDiscoveryRun) without cascading into DiscoveryRun.
   * 5. Cleanup of company-owned intelligence and scoring records.
   * 6. Contact eligibility evaluation:
   *    - In 'company-only' mode: preserves 100% of contacts.
   *    - In 'company-and-eligible-contacts' mode: only soft-deletes fresh uncontacted contacts.
   *      Contacts with active campaign executions, historical executions, or email delivery records
   *      are strictly PROTECTED and preserved.
   * 7. Preservation of suppressions, campaign records, sequence executions, and email deliveries.
   */
  public async deleteCompany(
    id: string,
    options?: { mode?: DeleteCompanyMode; deletedBy?: string }
  ): Promise<DeleteCompanyResult> {
    if (!id || typeof id !== 'string') {
      throw new NotFoundError('Company id is required.');
    }

    // 1. Authoritative workspace-scoped existence and idempotency check
    const company = await this.companyRepository.findOne({ _id: id } as any);
    if (!company) {
      const existingDeleted = await this.companyRepository.findOne({ _id: id, includeDeleted: true } as any);
      if (existingDeleted && (existingDeleted as any).deletedAt) {
        return {
          success: true,
          alreadyDeleted: true,
          companyDeleted: false,
          contactsDeletedCount: 0,
          contactsPreservedCount: 0
        };
      }
      throw new NotFoundError(`Company with id ${id} not found.`);
    }

    // 2. Clean/cancel pending/queued jobs targeting this company
    try {
      await JobModel.updateMany(
        {
          workspaceId: this.workspaceId,
          'payload.companyId': id,
          status: { $in: ['pending', 'queued', 'starting', 'waiting', 'retrying'] }
        },
        {
          $set: {
            status: 'cancelled',
            finishedAt: new Date(),
            error: 'Target company deleted'
          }
        }
      );
    } catch (err) {
      console.warn('[CompanyService] Note on cancelling company jobs:', err);
    }

    // 3. Remove run-provenance junctions for this company (DiscoveryRun itself is untouched)
    await this.companyDiscoveryRunRepository.deleteForCompany(id);

    // 4. Clean up company-owned intelligence, crawling, and ICP scoring records
    try {
      await Promise.all([
        CompanyIntelligenceModel.deleteMany({ workspaceId: this.workspaceId, companyId: id }),
        WebsiteIntelligenceModel.deleteMany({ workspaceId: this.workspaceId, companyId: id }),
        OpportunityScoreModel.deleteMany({ workspaceId: this.workspaceId, companyId: id }),
        PageCrawlModel.deleteMany({ workspaceId: this.workspaceId, companyId: id }),
        IntelligenceSourceModel.deleteMany({ workspaceId: this.workspaceId, companyId: id }),
        IntelligenceEvidenceModel.deleteMany({ workspaceId: this.workspaceId, companyId: id }),
        IntelligenceClaimModel.deleteMany({ workspaceId: this.workspaceId, companyId: id }),
        IntelligenceInferenceModel.deleteMany({ workspaceId: this.workspaceId, companyId: id })
      ]);
    } catch (err) {
      console.warn('[CompanyService] Note on cleaning company intelligence records:', err);
    }

    // 5. Contact eligibility analysis
    const mode: DeleteCompanyMode = options?.mode || 'company-only';
    const contacts = await ContactModel.find({
      workspaceId: this.workspaceId,
      companyId: id
    });

    let contactsDeletedCount = 0;
    let contactsPreservedCount = 0;
    const deletedContactIds: string[] = [];
    const preservedReasons: { activeWork?: number; historicalLineage?: number } = {};

    if (mode === 'company-and-eligible-contacts' && contacts.length > 0) {
      const contactIds = contacts.map((c) => c._id.toString());
      const contactEmails = contacts.map((c) => c.email).filter(Boolean) as string[];

      const [activeExecs, histExecs, deliveries, activeJobs] = await Promise.all([
        SequenceExecutionModel.find({
          workspaceId: this.workspaceId,
          contactId: { $in: contactIds },
          status: { $in: ['PENDING', 'RUNNING', 'WAITING', 'PAUSED'] }
        }).select('contactId'),
        SequenceExecutionModel.find({
          workspaceId: this.workspaceId,
          contactId: { $in: contactIds },
          status: { $in: ['COMPLETED', 'FAILED', 'REPLIED', 'CANCELLED'] }
        }).select('contactId'),
        EmailDeliveryModel.find({
          workspaceId: this.workspaceId,
          $or: [
            { contactId: { $in: contactIds } },
            { recipientEmail: { $in: contactEmails } }
          ]
        }).select('contactId recipientEmail'),
        JobModel.find({
          workspaceId: this.workspaceId,
          'payload.contactId': { $in: contactIds },
          status: { $in: ['pending', 'queued', 'starting', 'waiting', 'retrying', 'running'] }
        }).select('payload.contactId')
      ]);

      const activeContactIdSet = new Set(activeExecs.map((e) => e.contactId?.toString()));
      const activeJobContactIdSet = new Set(
        activeJobs.map((j) => (j.payload as any)?.contactId?.toString()).filter(Boolean)
      );
      const histContactIdSet = new Set(histExecs.map((e) => e.contactId?.toString()));
      const deliveryContactIdSet = new Set(
        deliveries.map((d) => d.contactId?.toString()).filter(Boolean)
      );
      const deliveryEmailSet = new Set(
        deliveries.map((d) => d.recipientEmail?.toLowerCase()).filter(Boolean)
      );

      for (const contact of contacts) {
        const cId = contact._id.toString();
        const cEmail = contact.email?.toLowerCase();

        const hasActiveWork = activeContactIdSet.has(cId) || activeJobContactIdSet.has(cId);
        const hasHistoricalLineage =
          histContactIdSet.has(cId) ||
          deliveryContactIdSet.has(cId) ||
          (cEmail ? deliveryEmailSet.has(cEmail) : false);

        if (hasActiveWork) {
          contactsPreservedCount++;
          preservedReasons.activeWork = (preservedReasons.activeWork || 0) + 1;
        } else if (hasHistoricalLineage) {
          contactsPreservedCount++;
          preservedReasons.historicalLineage = (preservedReasons.historicalLineage || 0) + 1;
        } else {
          // Fresh, uncontacted contact with no outreach history -> eligible!
          if (typeof (contact as any).softDelete === 'function') {
            await (contact as any).softDelete(options?.deletedBy);
          } else {
            await ContactModel.updateOne({ _id: cId }, { $set: { deletedAt: new Date() } });
          }
          contactsDeletedCount++;
          deletedContactIds.push(cId);
        }
      }
    } else {
      contactsPreservedCount = contacts.length;
    }

    // 6. Soft-delete the authoritative Company record
    if (typeof (company as any).softDelete === 'function') {
      await (company as any).softDelete(options?.deletedBy);
    } else {
      await this.companyRepository.delete(id);
    }

    return {
      success: true,
      companyDeleted: true,
      contactsDeletedCount,
      contactsPreservedCount,
      deletedContactIds: deletedContactIds.length > 0 ? deletedContactIds : undefined,
      preservedReasons: Object.keys(preservedReasons).length > 0 ? preservedReasons : undefined
    };
  }
}
