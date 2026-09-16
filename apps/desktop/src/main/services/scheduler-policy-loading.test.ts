import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobScheduler } from './scheduler.js';
import { DEFAULT_SCHEDULER_POLICY } from '@leadforge/schema';

describe('JobScheduler Concurrency Policy Configuration Authority', () => {
  let mockSdk: any;
  let mockEventBus: any;

  beforeEach(() => {
    vi.useFakeTimers();

    mockSdk = {
      jobs: {
        claim: vi.fn().mockResolvedValue(null),
        recover: vi.fn().mockResolvedValue({ recovered: 0, failed: 0 }),
        cancel: vi.fn().mockResolvedValue({}),
        updateStatus: vi.fn().mockResolvedValue({})
      },
      emailDeliveries: {
        pollReplies: vi.fn().mockResolvedValue([]),
        reconcileAmbiguous: vi.fn().mockResolvedValue([])
      },
      workspaces: {
        getSchedulerPolicy: vi.fn().mockResolvedValue(DEFAULT_SCHEDULER_POLICY)
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

  it('initializes with canonical default concurrency policy', () => {
    const scheduler = new JobScheduler('ws_default_policy', mockSdk, mockEventBus);
    const policy = scheduler.getPolicy();

    expect(policy.globalMaxConcurrency).toBe(3);
    expect(policy.typeLimits).toEqual({
      'scraper:maps': 1,
      'crawler:website': 2,
      'enrich:intelligence': 2,
      'outreach:campaign': 2,
      'automation:workflow': 2
    });
  });

  it('honors dynamically configured policy via setPolicy()', () => {
    const scheduler = new JobScheduler('ws_custom_policy', mockSdk, mockEventBus);

    scheduler.setPolicy({
      globalMaxConcurrency: 5,
      typeLimits: {
        'scraper:maps': 2,
        'crawler:website': 4,
        'enrich:intelligence': 3,
        'outreach:campaign': 3,
        'automation:workflow': 3
      }
    });

    const policy = scheduler.getPolicy();
    expect(policy.globalMaxConcurrency).toBe(5);
    expect(policy.typeLimits['scraper:maps']).toBe(2);
    expect(policy.typeLimits['crawler:website']).toBe(4);
    expect(policy.typeLimits['outreach:campaign']).toBe(3);
  });

  it('accepts policy on start() and executes with configured limits', async () => {
    const scheduler = new JobScheduler('ws_start_policy', mockSdk, mockEventBus);

    await scheduler.start({
      globalMaxConcurrency: 4,
      typeLimits: {
        'scraper:maps': 1,
        'crawler:website': 2,
        'enrich:intelligence': 2,
        'outreach:campaign': 4,
        'automation:workflow': 2
      }
    });

    expect(scheduler.getPolicy().globalMaxConcurrency).toBe(4);
    expect(scheduler.getPolicy().typeLimits['outreach:campaign']).toBe(4);
    await scheduler.stop();
  });

  it('safely falls back to canonical defaults when setPolicy receives malformed data', () => {
    const scheduler = new JobScheduler('ws_corrupt_policy', mockSdk, mockEventBus);

    // Corrupted input: negative global concurrency
    scheduler.setPolicy({
      globalMaxConcurrency: -1,
      typeLimits: { 'scraper:maps': -5 }
    } as any);

    // Must safely fallback rather than corrupting scheduler runtime state
    const policy = scheduler.getPolicy();
    expect(policy.globalMaxConcurrency).toBe(3);
    expect(policy.typeLimits['scraper:maps']).toBe(1);
  });

  it('proves concurrency authority is configurable rather than hardcoded in scheduler.ts', () => {
    const schedulerA = new JobScheduler('ws_a', mockSdk, mockEventBus);
    const schedulerB = new JobScheduler('ws_b', mockSdk, mockEventBus);

    schedulerA.setPolicy({
      globalMaxConcurrency: 1,
      typeLimits: { 'scraper:maps': 1 }
    });

    schedulerB.setPolicy({
      globalMaxConcurrency: 8,
      typeLimits: { 'scraper:maps': 4 }
    });

    expect(schedulerA.getPolicy().globalMaxConcurrency).toBe(1);
    expect(schedulerB.getPolicy().globalMaxConcurrency).toBe(8);
    expect(schedulerA.getPolicy().typeLimits['scraper:maps']).toBe(1);
    expect(schedulerB.getPolicy().typeLimits['scraper:maps']).toBe(4);
  });
});
