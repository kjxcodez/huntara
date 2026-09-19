import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { JobScheduler } from './scheduler.js';
import {
  DEFAULT_SCHEDULER_POLICY,
  OUTREACH_JOB_TYPES,
  DISCOVERY_JOB_TYPES,
  type Job
} from '@huntara/schema';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('C:\\tmp\\mock-userData'),
    isPackaged: false
  }
}));

// Mock child_process.fork
class MockChildProcess extends EventEmitter {
  public connected = true;
  public killed = false;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public send = vi.fn();
  public kill = vi.fn((signal?: string) => {
    this.killed = true;
    this.connected = false;
    this.emit('exit', signal === 'SIGKILL' ? 1 : 0, signal || 'SIGTERM');
  });
}

let activeMockWorkers: MockChildProcess[] = [];

vi.mock('child_process', () => ({
  fork: vi.fn(() => {
    const worker = new MockChildProcess();
    activeMockWorkers.push(worker);
    return worker;
  })
}));

// Mock config and session
vi.mock('../lib/config', () => ({
  loadConfig: vi.fn().mockReturnValue({ apiUrl: 'https://api.test.leadforge' })
}));

vi.mock('../lib/session', () => ({
  loadSession: vi.fn().mockReturnValue({ accessToken: 'mock-token' })
}));

vi.mock('../lib/crypto', () => ({
  decryptSecret: vi.fn((val) => val)
}));

vi.mock('../lib/logger', () => ({
  AppLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  }
}));

vi.mock('./projection-service', () => ({
  ProjectionService: {
    reconcileJobOutcome: vi.fn().mockResolvedValue({})
  }
}));

vi.mock('../database/connection', () => ({
  getDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 0 })
    })
  })
}));

interface SimulatedJob {
  id: string;
  type: string;
  priority: number;
  status: 'queued' | 'starting' | 'running' | 'completed' | 'failed';
  payload?: any;
  createdAt: Date;
  maxRetries?: number;
  retryCount?: number;
}

describe('JobScheduler Phase 3: Starvation Prevention & Fair Capacity Allocation', () => {
  let mockEventBus: any;
  let simulatedQueue: SimulatedJob[];
  let claimLog: Array<{ types: string[]; workerId: string; returnedJobId: string | null }>;
  let mockSdk: any;

  beforeEach(() => {
    vi.clearAllMocks();
    activeMockWorkers = [];
    simulatedQueue = [];
    claimLog = [];

    mockEventBus = {
      publish: vi.fn(),
      subscribe: vi.fn()
    };

    mockSdk = {
      jobs: {
        claim: vi.fn(async (types: string[], workerId: string) => {
          // Atomically find next eligible job matching types, sorted by priority DESC, createdAt ASC
          const eligible = simulatedQueue
            .filter((j) => j.status === 'queued' && types.includes(j.type))
            .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());

          const claimed = eligible[0];
          if (!claimed) {
            claimLog.push({ types, workerId, returnedJobId: null });
            return null;
          }
          claimed.status = 'starting';
          claimLog.push({ types, workerId, returnedJobId: claimed.id });
          return {
            id: claimed.id,
            type: claimed.type,
            priority: claimed.priority,
            status: claimed.status,
            payload: claimed.payload || {},
            maxRetries: claimed.maxRetries ?? 3,
            retryCount: claimed.retryCount ?? 0,
            createdAt: claimed.createdAt,
            updatedAt: new Date()
          } as Job;
        }),
        updateStatus: vi.fn().mockResolvedValue({}),
        complete: vi.fn(async (id: string) => {
          const job = simulatedQueue.find((j) => j.id === id);
          if (job) job.status = 'completed';
          return {};
        }),
        checkpoint: vi.fn().mockResolvedValue({}),
        heartbeat: vi.fn().mockResolvedValue({}),
        create: vi.fn(async (dto: any) => {
          const newJob: SimulatedJob = {
            id: dto.id || `auto_${Date.now()}_${Math.random()}`,
            type: dto.type,
            priority: dto.priority || 1,
            status: 'queued',
            payload: dto.payload,
            createdAt: new Date()
          };
          simulatedQueue.push(newJob);
          return newJob;
        }),
        recover: vi.fn().mockResolvedValue({ recovered: 0, failed: 0 })
      },
      emailDeliveries: {
        pollReplies: vi.fn().mockResolvedValue([]),
        reconcileAmbiguous: vi.fn().mockResolvedValue([])
      }
    };
  });

  afterEach(() => {
    for (const w of activeMockWorkers) {
      w.removeAllListeners();
    }
  });

  const runSchedulerTick = async (scheduler: JobScheduler) => {
    (scheduler as any).state = 'ACTIVE';
    await (scheduler as any).tick();
  };

  it('Scenario A — Discovery only: utilizes full global capacity when outreach is idle', async () => {
    const scheduler = new JobScheduler('ws_scen_a', mockSdk, mockEventBus);
    scheduler.setPolicy(DEFAULT_SCHEDULER_POLICY); // G=3, scraper=1, crawler=2

    // Queue 1 scraper and 4 crawlers, 0 outreach
    simulatedQueue.push(
      { id: 'sc_1', type: 'scraper:maps', priority: 1, status: 'queued', createdAt: new Date(1000) },
      { id: 'cr_1', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1001) },
      { id: 'cr_2', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1002) },
      { id: 'cr_3', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1003) }
    );

    // Tick 1: claims scraper
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(1);

    // Tick 2: claims crawler 1
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(2);

    // Tick 3: claims crawler 2
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);

    // Tick 4: global capacity 3 reached -> no more claims
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);

    // Verify all 3 active workers are discovery (1 scraper, 2 crawlers)
    expect((scheduler as any).typeActiveCount.get('scraper:maps')).toBe(1);
    expect((scheduler as any).typeActiveCount.get('crawler:website')).toBe(2);
    await scheduler.stop();
  });

  it('Scenario B — Campaign only: executes up to configured outreach capacity normally', async () => {
    const scheduler = new JobScheduler('ws_scen_b', mockSdk, mockEventBus);
    scheduler.setPolicy(DEFAULT_SCHEDULER_POLICY); // G=3, outreach:campaign=2, automation:workflow=2

    simulatedQueue.push(
      { id: 'wf_1', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1000) },
      { id: 'wf_2', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1001) },
      { id: 'wf_3', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1002) }
    );

    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(1);

    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(2);

    // Workflow type limit is 2; 3rd workflow job waits
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(2);
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(2);
    await scheduler.stop();
  });

  it('Scenario C — Discovery starts first, Campaign arrives: campaign claims slots on worker completion without waiting for discovery backlog to drain', async () => {
    const scheduler = new JobScheduler('ws_scen_c', mockSdk, mockEventBus);
    scheduler.setPolicy(DEFAULT_SCHEDULER_POLICY); // G=3, targetOutreach=2, targetDiscovery=1

    // Step 1: Start discovery and fill all 3 slots (1 scraper, 2 crawlers)
    simulatedQueue.push(
      { id: 'sc_1', type: 'scraper:maps', priority: 1, status: 'queued', createdAt: new Date(1000) },
      { id: 'cr_1', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1001) },
      { id: 'cr_2', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1002) },
      { id: 'cr_3', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1003) } // backlog
    );

    await runSchedulerTick(scheduler);
    await runSchedulerTick(scheduler);
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);
    expect((scheduler as any).typeActiveCount.get('scraper:maps')).toBe(1);
    expect((scheduler as any).typeActiveCount.get('crawler:website')).toBe(2);

    // Step 2: Campaign starts while discovery is running
    simulatedQueue.push(
      { id: 'wf_1', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(2000) },
      { id: 'wf_2', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(2001) }
    );

    // Step 3: Crawler 1 completes!
    await (scheduler as any).handleJobSuccess('cr_1', {}, 'worker-1', 'crawler:website', { companyId: 'comp_1' });
    expect(scheduler.activeWorkerCount).toBe(2);

    // Step 4: Next scheduler tick runs.
    // Even though cr_3 and auto-queued intelligence are queued in discovery,
    // Outreach is under its target (0 < 2) while discovery is at/above target (2 >= 1).
    // The scheduler MUST offer the slot to Outreach!
    await runSchedulerTick(scheduler);

    // Campaign job wf_1 must be claimed!
    expect(scheduler.activeWorkerCount).toBe(3);
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(1);

    // Step 5: Crawler 2 completes!
    await (scheduler as any).handleJobSuccess('cr_2', {}, 'worker-2', 'crawler:website', { companyId: 'comp_2' });
    expect(scheduler.activeWorkerCount).toBe(2);

    await runSchedulerTick(scheduler);
    // Second campaign job wf_2 claimed!
    expect(scheduler.activeWorkerCount).toBe(3);
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(2);
    expect((scheduler as any).typeActiveCount.get('scraper:maps')).toBe(1);

    // Reached fair equilibrium: 2 outreach, 1 discovery!
    await scheduler.stop();
  });

  it('Scenario D — Campaign starts first, Discovery arrives: discovery receives available capacity without displacing campaign', async () => {
    const scheduler = new JobScheduler('ws_scen_d', mockSdk, mockEventBus);
    scheduler.setPolicy(DEFAULT_SCHEDULER_POLICY); // G=3, targetOutreach=2, targetDiscovery=1

    // Campaign running 2 workers
    simulatedQueue.push(
      { id: 'wf_1', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1000) },
      { id: 'wf_2', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1001) }
    );
    await runSchedulerTick(scheduler);
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(2);

    // Discovery enqueues scraper and crawlers
    simulatedQueue.push(
      { id: 'sc_1', type: 'scraper:maps', priority: 1, status: 'queued', createdAt: new Date(2000) },
      { id: 'cr_1', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(2001) }
    );

    // Tick: available capacity = 1. Outreach already has 2 workers.
    // Discovery gets the 3rd slot! (cr_1 has higher priority than sc_1)
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(2);
    expect((scheduler as any).typeActiveCount.get('crawler:website')).toBe(1);
    await scheduler.stop();
  });

  it('Scenario E — Heavy discovery cascade: high-priority enrich:intelligence (P5) cannot outrank or starve campaign work', async () => {
    const scheduler = new JobScheduler('ws_scen_e', mockSdk, mockEventBus);
    scheduler.setPolicy(DEFAULT_SCHEDULER_POLICY);

    // Heavy discovery cascade: 1 active scraper, plus 10 P5 intelligence jobs and 5 P2 crawlers
    simulatedQueue.push(
      { id: 'sc_active', type: 'scraper:maps', priority: 1, status: 'queued', createdAt: new Date(500) }
    );
    await runSchedulerTick(scheduler); // active discovery = 1

    // Add 10 P5 intelligence jobs and 1 P3 campaign job
    for (let i = 1; i <= 10; i++) {
      simulatedQueue.push({
        id: `intel_${i}`,
        type: 'enrich:intelligence',
        priority: 5,
        status: 'queued',
        createdAt: new Date(1000 + i)
      });
    }
    simulatedQueue.push({
      id: 'wf_target',
      type: 'automation:workflow',
      priority: 3,
      status: 'queued',
      createdAt: new Date(2000)
    });

    // Available capacity = 2.
    // Active: discovery = 1 (target reached: 1 >= 1), outreach = 0 (target not reached: 0 < 2).
    // The next claim attempt MUST be outreach.
    // Even though intel jobs have priority 5 and workflow has priority 3,
    // the outreach claim query searches only outreach types.
    await runSchedulerTick(scheduler);

    // Assert: workflow job was claimed, NOT a P5 intelligence job!
    const wfJob = simulatedQueue.find((j) => j.id === 'wf_target');
    expect(wfJob?.status).toBe('starting');
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(1);
    await scheduler.stop();
  });

  it('Scenario F — Heavy campaign workload: campaign respects its capacity ceiling and cannot starve discovery', async () => {
    const scheduler = new JobScheduler('ws_scen_f', mockSdk, mockEventBus);
    scheduler.setPolicy(DEFAULT_SCHEDULER_POLICY); // G=3, targetOutreach=2, targetDiscovery=1

    // 50 workflow jobs queued
    for (let i = 1; i <= 50; i++) {
      simulatedQueue.push({
        id: `wf_${i}`,
        type: 'automation:workflow',
        priority: 3,
        status: 'queued',
        createdAt: new Date(1000 + i)
      });
    }

    // 5 discovery jobs queued
    simulatedQueue.push(
      { id: 'sc_1', type: 'scraper:maps', priority: 1, status: 'queued', createdAt: new Date(2000) },
      { id: 'cr_1', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(2001) }
    );

    // Slot 1: Outreach (alternates from initial)
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(1);

    // Slot 2: Discovery (cr_1 claimed because P2 > P1)
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(2);

    // Slot 3: Outreach
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);

    // Both are at their targets: 2 outreach, 1 discovery!
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(2);
    expect((scheduler as any).typeActiveCount.get('crawler:website')).toBe(1);

    // Now discovery worker completes:
    await (scheduler as any).handleJobSuccess('cr_1', {}, 'worker-cr', 'crawler:website', {});
    expect((scheduler as any).typeActiveCount.get('crawler:website') ?? 0).toBe(0);

    // Even though 48 workflow jobs are queued, discovery is under its target (0 < 1).
    // Discovery MUST get the next slot! (sc_1 claimed)
    await runSchedulerTick(scheduler);
    expect((scheduler as any).typeActiveCount.get('scraper:maps')).toBe(1);
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(2);
    await scheduler.stop();
  });

  it('Scenario G — Elasticity after contention: discovery expands back to 3 slots when campaign finishes', async () => {
    const scheduler = new JobScheduler('ws_scen_g', mockSdk, mockEventBus);
    scheduler.setPolicy(DEFAULT_SCHEDULER_POLICY);

    // 1 discovery active, 2 campaign active
    simulatedQueue.push(
      { id: 'sc_1', type: 'scraper:maps', priority: 1, status: 'queued', createdAt: new Date(1000) },
      { id: 'wf_1', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1001) },
      { id: 'wf_2', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1002) }
    );
    await runSchedulerTick(scheduler);
    await runSchedulerTick(scheduler);
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);

    // More crawlers arrive, but campaign has no more jobs
    simulatedQueue.push(
      { id: 'cr_1', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(2000) },
      { id: 'cr_2', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(2001) }
    );

    // Both campaign workers finish and exit
    await (scheduler as any).handleJobSuccess('wf_1', {}, 'w-1', 'automation:workflow', {});
    await (scheduler as any).handleJobSuccess('wf_2', {}, 'w-2', 'automation:workflow', {});
    expect(scheduler.activeWorkerCount).toBe(1);

    // Tick 1: Outreach queue returns null, discovery claims cr_1
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(2);

    // Tick 2: Outreach queue returns null, discovery claims cr_2
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);

    // Full discovery throughput restored: 1 scraper + 2 crawlers = 3 active workers
    expect((scheduler as any).typeActiveCount.get('scraper:maps')).toBe(1);
    expect((scheduler as any).typeActiveCount.get('crawler:website')).toBe(2);
    await scheduler.stop();
  });

  it('handles worker failure and crash recovery without corrupting capacity accounting', async () => {
    const scheduler = new JobScheduler('ws_crash_rec', mockSdk, mockEventBus);
    scheduler.setPolicy(DEFAULT_SCHEDULER_POLICY);

    simulatedQueue.push(
      { id: 'sc_1', type: 'scraper:maps', priority: 1, status: 'queued', createdAt: new Date(1000) },
      { id: 'wf_1', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1001) },
      { id: 'wf_2', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1002) }
    );
    await runSchedulerTick(scheduler);
    await runSchedulerTick(scheduler);
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);

    // Campaign worker wf_1 crashes
    await (scheduler as any).handleJobFailure('wf_1', 0, 3, 'Worker process crashed', 'w-1', 'automation:workflow', {});
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(1);
    expect(scheduler.activeWorkerCount).toBe(2);

    // Queued retry or new campaign job
    simulatedQueue.push({
      id: 'wf_replacement',
      type: 'automation:workflow',
      priority: 3,
      status: 'queued',
      createdAt: new Date(3000)
    });

    // Scheduler replaces the crashed campaign worker
    await runSchedulerTick(scheduler);
    expect(scheduler.activeWorkerCount).toBe(3);
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(2);
    await scheduler.stop();
  });

  it('honors custom MongoDB policy (G=5 -> Outreach=2, Discovery=3) under simultaneous load', async () => {
    const scheduler = new JobScheduler('ws_custom_g5', mockSdk, mockEventBus);
    scheduler.setPolicy({
      globalMaxConcurrency: 5,
      typeLimits: {
        'scraper:maps': 1,
        'crawler:website': 3,
        'enrich:intelligence': 2,
        'outreach:campaign': 2,
        'automation:workflow': 2
      }
    });

    // Queue heavy mix of discovery and outreach
    simulatedQueue.push(
      { id: 'sc_1', type: 'scraper:maps', priority: 1, status: 'queued', createdAt: new Date(1000) },
      { id: 'cr_1', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1001) },
      { id: 'cr_2', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1002) },
      { id: 'cr_3', type: 'crawler:website', priority: 2, status: 'queued', createdAt: new Date(1003) },
      { id: 'wf_1', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1004) },
      { id: 'wf_2', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1005) },
      { id: 'wf_3', type: 'automation:workflow', priority: 3, status: 'queued', createdAt: new Date(1006) }
    );

    // Fill all 5 slots
    for (let i = 0; i < 5; i++) {
      await runSchedulerTick(scheduler);
    }

    expect(scheduler.activeWorkerCount).toBe(5);
    // Outreach gets 2 (its limit)
    expect((scheduler as any).typeActiveCount.get('automation:workflow')).toBe(2);
    // Discovery gets 3 (1 scraper + 2 crawlers)
    const discoveryActive =
      ((scheduler as any).typeActiveCount.get('scraper:maps') || 0) +
      ((scheduler as any).typeActiveCount.get('crawler:website') || 0);
    expect(discoveryActive).toBe(3);
    await scheduler.stop();
  });
});
