import { CampaignRepository } from '../../repositories/campaign/campaign.repository.js';
import { CampaignModel, type CampaignDocument } from '../../db/models/campaign.model.js';
import { JobModel, SequenceExecutionModel } from '../../db/models/index.js';
import {
  createCampaignDtoSchema,
  updateCampaignDtoSchema,
  isValidCampaignTransition,
  CampaignStatus,
  VALID_CAMPAIGN_TRANSITIONS,
  type CreateCampaignDto,
  type UpdateCampaignDto
} from '@leadforge/schema';
import { ValidationError, ConflictError } from '../../errors/index.js';

export class CampaignService {
  private campaignRepository: CampaignRepository;
  private workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    this.campaignRepository = new CampaignRepository(workspaceId);
  }

  public async getCampaignById(id: string): Promise<CampaignDocument> {
    return this.campaignRepository.findById(id);
  }

  public async listCampaigns(
    page?: number,
    limit?: number
  ): Promise<{ data: CampaignDocument[]; total: number }> {
    return this.campaignRepository.paginate({}, page, limit);
  }

  public async createCampaign(dto: CreateCampaignDto): Promise<CampaignDocument> {
    const validated = createCampaignDtoSchema.parse(dto);
    const clientRecord: any = dto;
    const idempotencyKey = (clientRecord.idempotencyKey || clientRecord.idempotency_key) as string | undefined;

    // ── Phase 3: Server-Side Campaign Idempotency Boundary ────────────────────
    if (idempotencyKey) {
      const existing = await CampaignModel.findOne({
        workspaceId: this.workspaceId,
        idempotencyKey,
        deletedAt: null
      });

      if (existing) {
        const createdAtTime = existing.createdAt ? new Date(existing.createdAt).getTime() : 0;
        const ageMs = Date.now() - createdAtTime;
        if (ageMs <= 60000) {
          return existing;
        }
        throw new ConflictError('A campaign with this idempotency key was already created outside the 60-second window.');
      }
    }

    try {
      return await this.campaignRepository.create({
        ...(clientRecord.id || clientRecord._id ? { _id: clientRecord.id || clientRecord._id } : {}),
        name: validated.name,
        description: validated.description || null,
        sequenceId: validated.sequenceId || null,
        sendingAccountId: validated.sendingAccountId || null,
        steps: validated.steps || [],
        status: (validated.status ? String(validated.status).toUpperCase() : 'DRAFT') as any,
        template: validated.template || null,
        schedule: validated.schedule || null,
        timezone: validated.timezone || 'UTC',
        dailyLimit: validated.dailyLimit !== undefined ? validated.dailyLimit : 0,
        trackingEnabled: Boolean(validated.trackingEnabled ?? (clientRecord.settings?.trackingEnabled) ?? false),
        settings: validated.settings || null,
        ...(idempotencyKey ? { idempotencyKey } : {})
      });
    } catch (err: any) {
      // Deterministic concurrent race resolution:
      // If two concurrent requests with the same idempotencyKey reach the server simultaneously,
      // the second request will trigger a unique index violation on idempotencyKey.
      const isConflict =
        err instanceof ConflictError ||
        err?.code === 11000 ||
        err?.code === 'CONFLICT' ||
        err?.statusCode === 409 ||
        err?.message?.includes('duplicate key') ||
        err?.message?.includes('unique constraint');

      if (idempotencyKey && isConflict) {
        const existing = await CampaignModel.findOne({
          workspaceId: this.workspaceId,
          idempotencyKey,
          deletedAt: null
        });
        if (existing) {
          const createdAtTime = existing.createdAt ? new Date(existing.createdAt).getTime() : 0;
          const ageMs = Date.now() - createdAtTime;
          if (ageMs <= 60000) {
            return existing;
          }
          throw new ConflictError('A campaign with this idempotency key was already created outside the 60-second window.');
        }
      }
      throw err;
    }
  }

  public async updateCampaign(id: string, dto: UpdateCampaignDto): Promise<CampaignDocument> {
    const validated = updateCampaignDtoSchema.parse(dto);
    const updatePayload: any = { ...validated };
    if (updatePayload.status) {
      const targetStatus = String(updatePayload.status).toUpperCase();
      const existing = await this.campaignRepository.findById(id);
      if (!isValidCampaignTransition(existing.status, targetStatus)) {
        throw new ValidationError(
          `Invalid campaign state transition from "${existing.status}" to "${targetStatus}". Allowed: ${
            (VALID_CAMPAIGN_TRANSITIONS as any)[existing.status]?.join(', ') || 'none'
          }.`
        );
      }
      updatePayload.status = targetStatus;

      if (targetStatus === 'PAUSED') {
        try {
          const executionIds = await SequenceExecutionModel.find({
            workspaceId: this.workspaceId,
            campaignId: id
          }).distinct('_id');

          await JobModel.updateMany(
            {
              workspaceId: this.workspaceId,
              status: { $in: ['queued', 'starting', 'running', 'retrying'] },
              $or: [
                { 'payload.campaignId': id },
                { 'payload.executionId': { $in: executionIds.map((eid) => String(eid)) } }
              ]
            },
            { $set: { status: 'cancelled' } }
          );

          await SequenceExecutionModel.updateMany(
            {
              workspaceId: this.workspaceId,
              campaignId: id,
              status: { $in: ['PENDING', 'RUNNING', 'WAITING'] }
            },
            { $set: { status: 'PAUSED' } }
          );
        } catch (pauseErr) {
          console.warn(`[CampaignService] Warning during pause cleanup for ${id}:`, pauseErr);
        }
      }

      if (targetStatus === 'ACTIVE' && existing.status === 'PAUSED') {
        try {
          const now = new Date();
          const pausedExecutions = await SequenceExecutionModel.find({
            workspaceId: this.workspaceId,
            campaignId: id,
            status: 'PAUSED'
          });

          for (const exec of pausedExecutions) {
            const isWaiting = exec.nextExecutionAt && new Date(exec.nextExecutionAt) > now;
            exec.status = isWaiting ? 'WAITING' : 'RUNNING';
            await exec.save();
          }
        } catch (resumeErr) {
          console.warn(`[CampaignService] Warning during resume reconciliation for ${id}:`, resumeErr);
        }
      }

      if (targetStatus === 'STOPPED') {
        try {
          const executionIds = await SequenceExecutionModel.find({
            workspaceId: this.workspaceId,
            campaignId: id
          }).distinct('_id');

          await JobModel.updateMany(
            {
              workspaceId: this.workspaceId,
              status: { $in: ['queued', 'starting', 'running', 'retrying'] },
              $or: [
                { 'payload.campaignId': id },
                { 'payload.executionId': { $in: executionIds.map((eid) => String(eid)) } }
              ]
            },
            { $set: { status: 'cancelled' } }
          );

          await SequenceExecutionModel.updateMany(
            {
              workspaceId: this.workspaceId,
              campaignId: id,
              status: { $in: ['PENDING', 'RUNNING', 'WAITING', 'PAUSED'] }
            },
            { $set: { status: 'CANCELLED' } }
          );
        } catch (cancelErr) {
          console.warn(`[CampaignService] Warning during stop cleanup for ${id}:`, cancelErr);
        }
      }
    }
    return this.campaignRepository.update(id, updatePayload);
  }

  public async pauseCampaign(id: string, reason?: string): Promise<CampaignDocument> {
    const existing = await this.campaignRepository.findById(id);
    const updatedSettings = {
      ...(existing.settings || {}),
      pauseReason: reason || 'USER_REQUESTED'
    };
    return this.updateCampaign(id, {
      status: CampaignStatus.PAUSED as any,
      settings: updatedSettings
    });
  }

  public async resumeCampaign(id: string): Promise<CampaignDocument> {
    const existing = await this.campaignRepository.findById(id);
    const updatedSettings = { ...(existing.settings || {}) };
    delete updatedSettings.pauseReason;
    updatedSettings.resumedAt = new Date().toISOString();
    return this.updateCampaign(id, {
      status: CampaignStatus.ACTIVE as any,
      settings: updatedSettings
    });
  }

  public async stopCampaign(id: string): Promise<CampaignDocument> {
    return this.updateCampaign(id, { status: CampaignStatus.STOPPED as any });
  }

  public async deleteCampaign(id: string): Promise<boolean> {
    return this.campaignRepository.delete(id);
  }
}
