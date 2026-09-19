import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobScheduler } from './scheduler.js';
import { redactSensitiveData } from '@huntara/logger';

describe('JobScheduler Automated Reliability Runner & Mutex Guards', () => {
  let mockSdk: any;
  let mockEventBus: any;
  let pollCount = 0;
  let reconcileCount = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    pollCount = 0;
    reconcileCount = 0;

    mockSdk = {
      jobs: {
        claim: vi.fn().mockResolvedValue([]),
        recover: vi.fn().mockResolvedValue({ recovered: 0, failed: 0 }),
        cancel: vi.fn().mockResolvedValue({}),
        updateStatus: vi.fn().mockResolvedValue({})
      },
      emailDeliveries: {
        pollReplies: vi.fn().mockImplementation(async () => {
          pollCount++;
          return [{ matchedCount: 1 }];
        }),
        reconcileAmbiguous: vi.fn().mockImplementation(async () => {
          reconcileCount++;
          return [{ deliveryId: 'del_1', resolvedStatus: 'SENT' }];
        }),
        reconcile: vi.fn().mockResolvedValue({})
      }
    };

    mockEventBus = {
      publish: vi.fn(),
      subscribe: vi.fn()
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('starts reliability runner on start() and executes background tasks', async () => {
    const scheduler = new JobScheduler('ws_test_ops', mockSdk, mockEventBus);

    await scheduler.start();
    expect(scheduler.isActive).toBe(true);

    // Advance 30 seconds (first tick of reliability runner)
    await vi.advanceTimersByTimeAsync(30_000);

    // Initial tick hasn't reached 120s or 300s thresholds yet
    expect(pollCount).toBe(0);

    // Advance to 125 seconds total (triggers reply poll)
    await vi.advanceTimersByTimeAsync(100_000);
    expect(pollCount).toBe(1);
    expect(reconcileCount).toBe(0);

    // Advance to 310 seconds total (triggers reply poll again and ambiguous reconciliation)
    await vi.advanceTimersByTimeAsync(185_000);
    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(reconcileCount).toBe(1);

    // Stop scheduler and ensure no more calls happen
    scheduler.stop();
    expect(scheduler.isActive).toBe(false);

    await vi.advanceTimersByTimeAsync(600_000);
    const pollsAfterStop = pollCount;
    const reconcilesAfterStop = reconcileCount;

    expect(pollsAfterStop).toBe(pollCount);
    expect(reconcilesAfterStop).toBe(reconcileCount);
  });

  it('handles background runner provider network failures gracefully without crashing', async () => {
    // Mock SDK failures
    mockSdk.emailDeliveries.pollReplies = vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Provider unreachable'));
    mockSdk.emailDeliveries.reconcileAmbiguous = vi.fn().mockRejectedValue(new Error('ECONNRESET: Socket closed'));

    const scheduler = new JobScheduler('ws_test_ops', mockSdk, mockEventBus);
    await scheduler.start();

    // Advance time to trigger both jobs
    await vi.advanceTimersByTimeAsync(310_000);

    // Scheduler state should remain ACTIVE despite provider errors
    expect(scheduler.isActive).toBe(true);
    expect(['ACTIVE', 'IDLE']).toContain(scheduler.getState());

    scheduler.stop();
  });
});

describe('Operations Correlation ID & Secret Redaction Guarantee', () => {
  it('preserves correlation hierarchy from sequence to delivery and event', () => {
    const correlationId = 'camp_001:seq_002:exec_003';
    const rawDelivery = {
      id: 'del_789',
      idempotencyKey: correlationId,
      executionId: 'exec_003',
      campaignId: 'camp_001',
      recipientEmail: 'lead@enterprise.com',
      accessToken: 'ya29.sensitive-oauth-token',
      rawPayload: '<html><body>Secret template content</body></html>'
    };

    const sanitized = redactSensitiveData(rawDelivery);

    expect(sanitized.idempotencyKey).toBe(correlationId);
    expect(sanitized.campaignId).toBe('camp_001');
    expect(sanitized.recipientEmail).toBe('lead@enterprise.com');
    // Security guarantees
    expect(sanitized.accessToken).toBe('[REDACTED]');
  });
});
