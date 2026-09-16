import { SequenceModel } from '../../db/models/sequence.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { SequenceLogModel } from '../../db/models/sequence-log.model.js';
import { SuppressionRepository } from '../../repositories/suppression/suppression.repository.js';
import { SequenceStatus, ExecutionStatus } from '@leadforge/schema';
import { ConflictError } from '../../errors/index.js';

export class AutomationService {
  constructor(private workspaceId: string) {}

  // ── Sequence CRUD ────────────────────────────────────────────────────────

  public async createSequence(data: any): Promise<any> {
    const seq = new SequenceModel({
      _id: data.id || data._id || undefined,
      workspaceId: this.workspaceId as any,
      name: data.name,
      description: data.description || '',
      status: data.status || SequenceStatus.DRAFT,
      trigger: data.trigger,
      steps: data.steps || [],
      createdBy: data.createdBy || null
    });
    await seq.save();
    return seq;
  }

  public async listSequences(): Promise<any[]> {
    return SequenceModel.find({
      workspaceId: this.workspaceId
    } as any).sort({ createdAt: -1 });
  }

  public async getSequence(id: string): Promise<any> {
    const seq = await SequenceModel.findOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
    return seq;
  }

  public async updateSequence(id: string, data: any): Promise<any> {
    const seq = await SequenceModel.findOneAndUpdate(
      { _id: id, workspaceId: this.workspaceId } as any,
      { $set: data },
      { returnDocument: 'after' }
    );
    if (!seq) throw new Error('Sequence not found.');
    return seq;
  }

  public async deleteSequence(id: string): Promise<void> {
    await SequenceModel.findOneAndDelete({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
  }

  // ── Executions Management ────────────────────────────────────────────────

  public async createExecution(data: any): Promise<any> {
    if (data.contactId && data.campaignId) {
      // Early policy filtering: check effective workspace suppression (recipient, company DNC, domain suppression)
      const contactDoc = await ContactModel.findOne({
        _id: data.contactId,
        workspaceId: this.workspaceId,
        deletedAt: null
      });

      if (contactDoc) {
        const suppressionRepo = new SuppressionRepository(this.workspaceId);
        const effectiveSuppression = await suppressionRepo.evaluateEffectiveSuppression({
          email: contactDoc.email || '',
          companyId: contactDoc.companyId || data.companyId || null
        });

        if (effectiveSuppression.suppressed) {
          throw new ConflictError(
            `Cannot enroll contact "${data.contactId}" in campaign: ${effectiveSuppression.message}`
          );
        }
      }

      // Phase 15 (ENROLL-08): Contact cross-campaign active exclusivity check
      const existingActive = await SequenceExecutionModel.findOne({
        workspaceId: this.workspaceId,
        contactId: data.contactId,
        status: { $in: ['PENDING', 'RUNNING', 'WAITING', 'PAUSED'] }
      });

      if (existingActive) {
        // Verify if previous campaign was stopped or completed
        let isStale = false;
        if (existingActive.campaignId) {
          const camp = await CampaignModel.findById(existingActive.campaignId);
          if (camp && (camp.status === 'STOPPED' || camp.status === 'COMPLETED' || camp.status === 'FAILED')) {
            existingActive.status = 'CANCELLED';
            await existingActive.save();
            isStale = true;
          }
        }

        if (!isStale) {
          if (String(existingActive.campaignId) !== String(data.campaignId)) {
            throw new ConflictError(
              `Contact "${data.contactId}" is already actively enrolled in campaign "${existingActive.campaignId}". Cross-campaign simultaneous outreach is prohibited.`
            );
          } else {
            throw new ConflictError(
              `Contact "${data.contactId}" is already enrolled in this campaign (execution: ${existingActive._id}).`
            );
          }
        }
      }
    }

    const exec = new SequenceExecutionModel({
      _id: data.id || data._id || undefined,
      workspaceId: this.workspaceId as any,
      sequenceId: data.sequenceId,
      campaignId: data.campaignId,
      contactId: data.contactId,
      companyId: data.companyId,
      currentStep: data.currentStep || 0,
      currentStepName: data.currentStepName || 'Initial',
      status: (data.status || 'RUNNING').toUpperCase(),
      startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      logs: data.logs || [],
      sentMessageIds: data.sentMessageIds || []
    });

    try {
      await exec.save();
    } catch (saveErr: any) {
      if (saveErr.code === 11000) {
        throw new ConflictError(
          `Contact "${data.contactId}" already has an active execution in progress in this workspace.`
        );
      }
      throw saveErr;
    }
    return exec;
  }

  public async updateExecution(id: string, data: any): Promise<any> {
    const updateData = { ...data };
    if (updateData.status) {
      updateData.status = updateData.status.toUpperCase();
    }
    const exec = await SequenceExecutionModel.findOneAndUpdate(
      { _id: id, workspaceId: this.workspaceId } as any,
      { $set: updateData },
      { returnDocument: 'after' }
    );
    if (!exec) throw new Error('Sequence execution not found.');
    return exec;
  }

  public async deleteExecution(id: string): Promise<void> {
    await SequenceExecutionModel.findOneAndDelete({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
  }

  public async listExecutions(): Promise<any[]> {
    return SequenceExecutionModel.find({
      workspaceId: this.workspaceId
    } as any).sort({ startedAt: -1 });
  }

  public async getExecution(id: string): Promise<any> {
    return SequenceExecutionModel.findOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
  }

  public async getExecutionLogs(executionId: string): Promise<any[]> {
    return SequenceLogModel.find({
      workspaceId: this.workspaceId,
      executionId
    } as any).sort({ timestamp: 1 });
  }

  public async addExecutionLogs(executionId: string, logs: any[]): Promise<any[]> {
    const docs = logs.map((l) => ({
      _id: l.id || undefined,
      workspaceId: this.workspaceId,
      executionId,
      step: l.step ?? 0,
      action: l.action || 'LOG',
      status: l.status || 'info',
      message: l.message || '',
      error: l.error || null,
      timestamp: l.timestamp ? new Date(l.timestamp) : new Date()
    }));
    await SequenceLogModel.insertMany(docs);
    return docs;
  }
}
