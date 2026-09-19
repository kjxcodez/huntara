import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignService } from '../../services/campaign/campaign.service.js';
import { EmailDeliveryRepository } from '../../repositories/email-delivery/email-delivery.repository.js';
import { CampaignStatus, ContactStatus, ContactEmailStatus, EmailFailureCategory } from '@huntara/schema';

// Mock MongoDB Models
vi.mock('../../db/models/index.js', () => {
  return {
    JobModel: {
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 })
    },
    SequenceExecutionModel: {
      find: vi.fn().mockReturnValue({
        distinct: vi.fn().mockResolvedValue(['exec-1', 'exec-2'])
      }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 })
    }
  };
});

const mockFindById = vi.fn().mockResolvedValue({
  _id: 'camp-123',
  status: CampaignStatus.ACTIVE
});

const mockUpdate = vi.fn().mockImplementation((id, data) => Promise.resolve({
  _id: id,
  ...data
}));

vi.mock('../../repositories/campaign/campaign.repository.js', () => {
  return {
    CampaignRepository: class {
      findById = mockFindById;
      update = mockUpdate;
    }
  };
});

describe('Phase 12 — Outreach Core Consolidation Contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({
      _id: 'camp-123',
      status: CampaignStatus.ACTIVE
    });
  });

  describe('Campaign STOPPED Cascade Contract (REM-05 / Invariant I-010)', () => {
    it('cascades job and sequence execution cancellations on updateCampaign({ status: STOPPED })', async () => {
      const { JobModel, SequenceExecutionModel } = await import('../../db/models/index.js');
      const service = new CampaignService('ws_test');

      const updated = await service.updateCampaign('camp-123', {
        status: CampaignStatus.STOPPED
      });

      expect(updated.status).toBe(CampaignStatus.STOPPED);
      expect(JobModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws_test',
          status: { $in: ['queued', 'starting', 'running', 'retrying'] }
        }),
        { $set: { status: 'cancelled' } }
      );
      expect(SequenceExecutionModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws_test',
          campaignId: 'camp-123',
          status: { $in: ['PENDING', 'RUNNING', 'WAITING', 'PAUSED'] }
        }),
        { $set: { status: 'CANCELLED' } }
      );
    });

    it('rejects invalid campaign status transition (e.g. STOPPED -> ACTIVE)', async () => {
      mockFindById.mockResolvedValueOnce({
        _id: 'camp-stopped',
        status: CampaignStatus.STOPPED
      });

      const service = new CampaignService('ws_test');
      await expect(
        service.updateCampaign('camp-stopped', { status: CampaignStatus.ACTIVE })
      ).rejects.toThrow(/Invalid campaign state transition/);
    });
  });

  describe('Delivery Ledger Crash Consistency Contract (REM-10 / Invariant I-007 & I-017)', () => {
    it('transitions stale SENDING deliveries with expired leases to AMBIGUOUS (not FAILED)', async () => {
      const mockStaleDelivery = {
        _id: 'del-stale-1',
        status: 'SENDING',
        recipientEmail: 'lead@example.com'
      };

      const mockModel = {
        find: vi.fn().mockResolvedValue([mockStaleDelivery]),
        findOneAndUpdate: vi.fn().mockResolvedValue({
          ...mockStaleDelivery,
          status: 'AMBIGUOUS',
          ambiguous: true,
          reconciliationNotes: 'Automated reconciliation marked stale SENDING delivery with expired lease as AMBIGUOUS.'
        })
      };

      const repo = new EmailDeliveryRepository('ws_test');
      (repo as any).model = mockModel;

      const res = await repo.reconcileStaleDeliveries(300000);
      expect(res.diagnosedCount).toBe(1);
      expect(res.deliveries[0]!.status).toBe('AMBIGUOUS');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'del-stale-1', status: 'SENDING' }),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'AMBIGUOUS',
            ambiguous: true
          })
        }),
        expect.any(Object)
      );
    });
  });
});
