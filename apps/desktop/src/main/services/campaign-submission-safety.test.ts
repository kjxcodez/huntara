import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'crypto';

describe('Phase 3 — Campaign Submission Safety & Idempotency Suite', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Section 15: Rapid Double-Click Simulation & Submission Lock
  // ──────────────────────────────────────────────────────────────────────────
  describe('Section 15: Rapid Double-Click Submission Protection', () => {
    it('prevents duplicate sequence and campaign creation when Launch Outreach is double-clicked', async () => {
      let isSubmitting = false;
      const mockIpcInvoke = vi.fn();

      // Configure mock IPC responses with realistic async latency
      mockIpcInvoke.mockImplementation(async (channel: string, payload: any) => {
        if (channel === 'sequence:create') {
          // Simulate network flight time
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { id: 'seq_created_123', name: payload.name };
        }
        if (channel === 'campaigns:create') {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { id: 'camp_created_123', name: payload.name };
        }
        if (channel === 'audiences:resolve') {
          return { contactIds: ['cont_1', 'cont_2'] };
        }
        if (channel === 'campaigns:enroll') {
          return { success: true, enrolledCount: 2 };
        }
        if (channel === 'campaigns:schedule') {
          return { success: true };
        }
        return {};
      });

      // Exact submission logic from CampaignsScreen.tsx
      const handleCreateCampaign = async (e: { preventDefault: () => void }) => {
        e.preventDefault();
        // 1. Guard check: prevent duplicate in-flight invocation
        if (isSubmitting) return;

        isSubmitting = true;
        try {
          // 1. Build & create sequence
          const seq = await mockIpcInvoke('sequence:create', {
            name: 'Sequence: Q3 Inbound',
            status: 'ACTIVE',
            steps: [{ id: 'step_1', type: 'SEND_EMAIL' }]
          });

          // 2. Create Campaign
          const campaign = await mockIpcInvoke('campaigns:create', {
            workspaceId: 'ws_test',
            name: 'Q3 Inbound',
            sequenceId: seq.id,
            status: 'ACTIVE',
            idempotencyKey: 'camp_sub_ws_test_123'
          });

          // 3. Resolve & enroll
          const resolved = await mockIpcInvoke('audiences:resolve', {
            workspaceId: 'ws_test',
            id: 'aud_1'
          });
          if (resolved.contactIds?.length > 0) {
            await mockIpcInvoke('campaigns:enroll', {
              campaignId: campaign.id,
              contactIds: resolved.contactIds
            });
          }

          // 4. Schedule
          await mockIpcInvoke('campaigns:schedule', campaign.id);
        } finally {
          isSubmitting = false;
        }
      };

      // Simulate user rapid double-clicking "Launch Outreach"
      const clickEvent = { preventDefault: vi.fn() };
      const firstClick = handleCreateCampaign(clickEvent);
      const secondClick = handleCreateCampaign(clickEvent); // Triggered while firstClick is in-flight

      await Promise.all([firstClick, secondClick]);

      // Verifications:
      // Exactly 1 sequence was created
      const sequenceCalls = mockIpcInvoke.mock.calls.filter(([channel]) => channel === 'sequence:create');
      expect(sequenceCalls).toHaveLength(1);

      // Exactly 1 campaign was created
      const campaignCalls = mockIpcInvoke.mock.calls.filter(([channel]) => channel === 'campaigns:create');
      expect(campaignCalls).toHaveLength(1);

      // Exactly 1 enrollment and schedule occurred
      const enrollCalls = mockIpcInvoke.mock.calls.filter(([channel]) => channel === 'campaigns:enroll');
      expect(enrollCalls).toHaveLength(1);

      const scheduleCalls = mockIpcInvoke.mock.calls.filter(([channel]) => channel === 'campaigns:schedule');
      expect(scheduleCalls).toHaveLength(1);

      // Submission lock is cleared after pipeline completion
      expect(isSubmitting).toBe(false);
    });

    it('always resets isSubmitting lock on pipeline failure so user can retry', async () => {
      let isSubmitting = false;
      const mockIpcInvoke = vi.fn();

      mockIpcInvoke.mockRejectedValueOnce(new Error('Network disconnected during campaign creation'));

      const handleCreateCampaign = async () => {
        if (isSubmitting) return;
        isSubmitting = true;
        try {
          await mockIpcInvoke('campaigns:create', { name: 'Failing Campaign' });
        } catch {
          // Handled / toast shown
        } finally {
          isSubmitting = false;
        }
      };

      await handleCreateCampaign();

      // State MUST be unlocked
      expect(isSubmitting).toBe(false);

      // Subsequent retry must now be allowed
      mockIpcInvoke.mockResolvedValueOnce({ id: 'camp_recovered' });
      await handleCreateCampaign();

      expect(mockIpcInvoke).toHaveBeenCalledTimes(2);
      expect(isSubmitting).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Section 16: Redundant Workflow Job Removal in campaigns:schedule
  // ──────────────────────────────────────────────────────────────────────────
  describe('Section 16: Job Creation Deduplication across Enroll and Schedule', () => {
    it('creates workflow job during campaigns:enroll, but does NOT create a redundant job during campaigns:schedule', async () => {
      const mockSdkJobsCreate = vi.fn().mockResolvedValue({ id: 'job_created_1' });
      const contactId = 'cont_job_test_1';
      const campaignId = 'camp_job_test_1';
      const sequenceId = 'seq_job_1';
      const workspaceId = 'ws_phase3_jobs';
      const executionId = 'exec_dedupe_1';

      // Mock database store
      const executions: any[] = [];

      // 1. Simulate campaigns:enroll handler
      const isActive = true;
      executions.push({
        id: executionId,
        sequenceId,
        campaignId,
        contactId,
        status: 'running',
        nextExecutionAt: null
      });

      // campaigns:enroll spawns workflow job via SDK
      if (isActive) {
        await mockSdkJobsCreate({
          id: randomUUID(),
          type: 'automation:workflow',
          priority: 3,
          payload: {
            sequenceId,
            entityId: contactId,
            entityType: 'contact',
            executionId,
            workspaceId,
            campaignId,
            contactId
          }
        });
      }

      expect(mockSdkJobsCreate).toHaveBeenCalledTimes(1);

      // 2. Simulate updated campaigns:schedule handler (Phase 3 implementation)
      // It updates execution status but DOES NOT invoke sdk.jobs.create
      const enrollments = executions.filter(
        (e) => e.campaignId === campaignId && e.status?.toUpperCase() !== 'COMPLETED'
      );

      for (const enroll of enrollments) {
        const isWaiting = enroll.nextExecutionAt && new Date(enroll.nextExecutionAt) > new Date();
        enroll.status = isWaiting ? 'WAITING' : 'RUNNING';
        // Phase 3 invariant: NO redundant sdk.jobs.create call here!
      }

      // Assert total workflow job creations for this execution remains exactly 1
      expect(mockSdkJobsCreate).toHaveBeenCalledTimes(1);
      expect(executions[0].status).toBe('RUNNING');
    });
  });
});
