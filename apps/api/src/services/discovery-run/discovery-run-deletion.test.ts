import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryRunService } from './discovery-run.service.js';
import { CompanyService } from '../company/company.service.js';
import { CompanyModel } from '../../db/models/company.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { CompanyDiscoveryRunModel } from '../../db/models/company-discovery-run.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { AudienceModel } from '../../db/models/audience.model.js';
import { JobModel } from '../../db/models/job.model.js';

// Mocks
vi.mock('../../repositories/discovery-run/discovery-run.repository.js', () => ({
  DiscoveryRunRepository: class {
    findById = vi.fn();
    delete = vi.fn();
    paginate = vi.fn();
    create = vi.fn();
    update = vi.fn();
  }
}));

vi.mock('../../repositories/company-discovery-run/company-discovery-run.repository.js', () => ({
  CompanyDiscoveryRunRepository: class {
    deleteForRun = vi.fn().mockResolvedValue(true);
    deleteForCompany = vi.fn().mockResolvedValue(true);
  }
}));

vi.mock('../../repositories/company/company.repository.js', () => ({
  CompanyRepository: class {
    findById = vi.fn();
    findOne = vi.fn();
    delete = vi.fn();
  }
}));

vi.mock('../company/company.service.js', () => ({
  CompanyService: class {
    deleteCompany = vi.fn().mockResolvedValue({
      success: true,
      companyDeleted: true,
      contactsDeletedCount: 1,
      contactsPreservedCount: 0,
      deletedContactIds: ['contact_clean_1']
    });
  }
}));

vi.mock('../../db/models/company.model.js', () => ({
  CompanyModel: {
    findOne: vi.fn()
  }
}));

vi.mock('../../db/models/contact.model.js', () => ({
  ContactModel: {
    find: vi.fn()
  }
}));

vi.mock('../../db/models/company-discovery-run.model.js', () => ({
  CompanyDiscoveryRunModel: {
    find: vi.fn(),
    countDocuments: vi.fn()
  }
}));

vi.mock('../../db/models/sequence-execution.model.js', () => ({
  SequenceExecutionModel: {
    countDocuments: vi.fn()
  }
}));

vi.mock('../../db/models/email-delivery.model.js', () => ({
  EmailDeliveryModel: {
    countDocuments: vi.fn()
  }
}));

vi.mock('../../db/models/audience.model.js', () => ({
  AudienceModel: {
    countDocuments: vi.fn()
  }
}));

vi.mock('../../db/models/job.model.js', () => ({
  JobModel: {
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: vi.fn().mockResolvedValue(0)
  }
}));

describe('DiscoveryRun Cascade Deletion Suite', () => {
  const workspaceId = 'ws_discovery_test';
  const runId = 'run_target_123';
  const runCreatedAt = new Date('2026-09-01T10:00:00Z');

  let service: DiscoveryRunService;
  let mockRunRepo: any;
  let mockCompanyDiscoveryRunRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DiscoveryRunService(workspaceId);
    mockRunRepo = (service as any).discoveryRunRepository;
    mockCompanyDiscoveryRunRepo = (service as any).companyDiscoveryRunRepository;

    mockRunRepo.findById.mockResolvedValue({
      id: runId,
      _id: runId,
      workspaceId,
      status: 'completed',
      createdAt: runCreatedAt
    });

    // Default: clean state for models
    (SequenceExecutionModel.countDocuments as any).mockResolvedValue(0);
    (EmailDeliveryModel.countDocuments as any).mockResolvedValue(0);
    (AudienceModel.countDocuments as any).mockResolvedValue(0);
    (JobModel.countDocuments as any).mockResolvedValue(0);
  });

  it('1. exclusive_discovery_company_is_deleted: deletes company when discovered exclusively by run', async () => {
    const companyId = 'comp_exclusive_1';
    (CompanyDiscoveryRunModel.find as any).mockResolvedValue([
      { companyId, discoveryRunId: runId }
    ]);
    (CompanyDiscoveryRunModel.countDocuments as any).mockResolvedValue(0); // No other runs
    (CompanyModel.findOne as any).mockResolvedValue({
      _id: companyId,
      createdAt: new Date('2026-09-01T10:05:00Z') // created AFTER run
    });
    (ContactModel.find as any).mockResolvedValue([]);

    const result = await service.deleteRun(runId);

    expect(result.success).toBe(true);
    expect(result.deletedCompanyIds).toEqual([companyId]);
    expect(mockRunRepo.delete).toHaveBeenCalledWith(runId);
  });

  it('2. exclusive_clean_contacts_are_deleted: deletes eligible contacts belonging to exclusive company', async () => {
    const companyId = 'comp_with_clean_contacts';
    const contactId = 'contact_clean_1';

    (CompanyDiscoveryRunModel.find as any).mockResolvedValue([
      { companyId, discoveryRunId: runId }
    ]);
    (CompanyDiscoveryRunModel.countDocuments as any).mockResolvedValue(0);
    (CompanyModel.findOne as any).mockResolvedValue({
      _id: companyId,
      createdAt: new Date('2026-09-01T10:05:00Z')
    });
    (ContactModel.find as any).mockResolvedValue([
      { _id: contactId, email: 'clean@test.com' }
    ]);

    const result = await service.deleteRun(runId);

    expect(result.success).toBe(true);
    expect(result.deletedCompanyIds).toContain(companyId);
    expect(result.deletedContactIds).toContain(contactId);
  });

  it('3. company_linked_to_multiple_runs_is_preserved: preserves company linked to another run', async () => {
    const companyId = 'comp_shared_1';
    (CompanyDiscoveryRunModel.find as any).mockResolvedValue([
      { companyId, discoveryRunId: runId }
    ]);
    // Other run exists!
    (CompanyDiscoveryRunModel.countDocuments as any).mockResolvedValue(1);
    (CompanyModel.findOne as any).mockResolvedValue({
      _id: companyId,
      createdAt: new Date('2026-09-01T10:05:00Z')
    });

    const result = await service.deleteRun(runId);

    expect(result.success).toBe(true);
    expect(result.deletedCompanyIds).toBeUndefined();
    // Run provenance still deleted for this run
    expect(mockCompanyDiscoveryRunRepo.deleteForRun).toHaveBeenCalledWith(runId);
    expect(mockRunRepo.delete).toHaveBeenCalledWith(runId);
  });

  it('4. pre_existing_company_is_preserved: preserves company created before the run', async () => {
    const companyId = 'comp_pre_existing_1';
    (CompanyDiscoveryRunModel.find as any).mockResolvedValue([
      { companyId, discoveryRunId: runId }
    ]);
    (CompanyDiscoveryRunModel.countDocuments as any).mockResolvedValue(0);
    // Created BEFORE run
    (CompanyModel.findOne as any).mockResolvedValue({
      _id: companyId,
      createdAt: new Date('2026-08-15T10:00:00Z')
    });

    const result = await service.deleteRun(runId);

    expect(result.success).toBe(true);
    expect(result.deletedCompanyIds).toBeUndefined();
    expect(mockRunRepo.delete).toHaveBeenCalledWith(runId);
  });

  it('5. company_with_outreach_lineage_is_preserved: preserves company with sequence executions', async () => {
    const companyId = 'comp_with_executions';
    (CompanyDiscoveryRunModel.find as any).mockResolvedValue([
      { companyId, discoveryRunId: runId }
    ]);
    (CompanyDiscoveryRunModel.countDocuments as any).mockResolvedValue(0);
    (CompanyModel.findOne as any).mockResolvedValue({
      _id: companyId,
      createdAt: new Date('2026-09-01T10:05:00Z')
    });
    // SequenceExecution on company
    (SequenceExecutionModel.countDocuments as any).mockResolvedValueOnce(1);

    const result = await service.deleteRun(runId);

    expect(result.success).toBe(true);
    expect(result.deletedCompanyIds).toBeUndefined();
  });

  it('6. contact_with_sequence_execution_is_preserved: preserves company if contact has sequence execution', async () => {
    const companyId = 'comp_with_contact_exec';
    const contactId = 'contact_with_exec';

    (CompanyDiscoveryRunModel.find as any).mockResolvedValue([
      { companyId, discoveryRunId: runId }
    ]);
    (CompanyDiscoveryRunModel.countDocuments as any).mockResolvedValue(0);
    (CompanyModel.findOne as any).mockResolvedValue({
      _id: companyId,
      createdAt: new Date('2026-09-01T10:05:00Z')
    });
    (ContactModel.find as any).mockResolvedValue([
      { _id: contactId, email: 'busy@test.com' }
    ]);
    // Sequence execution on contact
    (SequenceExecutionModel.countDocuments as any).mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const result = await service.deleteRun(runId);

    expect(result.success).toBe(true);
    expect(result.deletedCompanyIds).toBeUndefined();
  });

  it('7. contact_with_email_delivery_is_preserved: preserves company if contact has email delivery history', async () => {
    const companyId = 'comp_with_contact_delivery';
    const contactId = 'contact_with_delivery';

    (CompanyDiscoveryRunModel.find as any).mockResolvedValue([
      { companyId, discoveryRunId: runId }
    ]);
    (CompanyDiscoveryRunModel.countDocuments as any).mockResolvedValue(0);
    (CompanyModel.findOne as any).mockResolvedValue({
      _id: companyId,
      createdAt: new Date('2026-09-01T10:05:00Z')
    });
    (ContactModel.find as any).mockResolvedValue([
      { _id: contactId, email: 'delivered@test.com' }
    ]);
    // Email delivery on contact
    (EmailDeliveryModel.countDocuments as any).mockResolvedValueOnce(1);

    const result = await service.deleteRun(runId);

    expect(result.success).toBe(true);
    expect(result.deletedCompanyIds).toBeUndefined();
  });

  it('8. discovery_run_provenance_is_removed: removes CompanyDiscoveryRun records and cancels jobs', async () => {
    (CompanyDiscoveryRunModel.find as any).mockResolvedValue([]);

    const result = await service.deleteRun(runId);

    expect(result.success).toBe(true);
    expect(mockCompanyDiscoveryRunRepo.deleteForRun).toHaveBeenCalledWith(runId);
    expect(JobModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ 'payload.discoveryRunId': runId }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'cancelled' }) })
    );
    expect(mockRunRepo.delete).toHaveBeenCalledWith(runId);
  });
});
