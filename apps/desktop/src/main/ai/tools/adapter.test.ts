/**
 * SchedulerGateway Adapter Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { SchedulerGatewayImpl } from './scheduler-gateway';
import type { ExecutionContext } from '@huntara/agent-core';
import { WorkspaceManager } from '../../lib/workspace-manager';

const mockSdk = {
  jobs: {
    create: async (_payload: any) => ({ id: 'job-test' }),
    cancel: async (_jobId: string) => ({ success: true }),
    get: async (_id: string) => ({ status: 'running' })
  }
} as any;
WorkspaceManager.setSdk(mockSdk);

class MockDatabase {
  public queries: string[] = [];
  public runArgs: any[] = [];

  public prepare(sql: string) {
    this.queries.push(sql);
    return {
      run: (...args: any[]) => {
        this.runArgs.push(args);
        return { changes: 1 };
      },
      get: (...args: any[]) => {
        return { status: 'running' };
      }
    };
  }
}

class MockEventBus {
  private listeners: Map<string, Array<(event: any) => void>> = new Map();

  public subscribe(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
    return () => {
      const idx = this.listeners.get(type)!.indexOf(listener);
      if (idx !== -1) {
        this.listeners.get(type)!.splice(idx, 1);
      }
    };
  }

  public publish(type: string, payload: any) {
    const list = this.listeners.get(type) || [];
    for (const listener of list) {
      listener({ type, payload });
    }
  }
}

const mockContext: ExecutionContext = {
  workspaceId: 'ws-test',
  executionId: 'exec-test',
  traceId: 'trace-1',
  jobId: 'job-test',
  actorId: 'user-test',
  actorType: 'user',
  requestedBy: 'test',
  permissions: [],
  executionMode: 'offline'
};

describe('SchedulerGateway AI Tools Adapter Suite', () => {
  it('submits job and returns job ID', async () => {
    const db = new MockDatabase() as any;
    const bus = new MockEventBus();
    const gateway = new SchedulerGatewayImpl(db, bus as any);

    const jobId = await gateway.submit('scraper:maps', { query: 'test' }, mockContext);
    expect(jobId).toBe('job-test');
  });

  it('submits and awaits completed job output', async () => {
    const db = new MockDatabase() as any;
    const bus = new MockEventBus();
    const gateway = new SchedulerGatewayImpl(db, bus as any);

    const execPromise = gateway.submitAndAwait('scraper:maps', { query: 'test' }, mockContext);

    setTimeout(() => {
      bus.publish('job:completed', { jobId: 'job-test', result: { leads: 10 } });
    }, 10);

    const result = await execPromise;
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ leads: 10 });
  });

  it('submits and awaits failed job error', async () => {
    const db = new MockDatabase() as any;
    const bus = new MockEventBus();
    const gateway = new SchedulerGatewayImpl(db, bus as any);

    const execPromise = gateway.submitAndAwait('scraper:maps', { query: 'test' }, mockContext);

    setTimeout(() => {
      bus.publish('job:failed', { jobId: 'job-test', error: 'Failed intentionally' });
    }, 10);

    const result = await execPromise;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WORKER_ERROR');
    expect(result.error?.message).toBe('Failed intentionally');
  });

  it('handles abort cancellation signal gracefully', async () => {
    const db = new MockDatabase() as any;
    const bus = new MockEventBus();
    const gateway = new SchedulerGatewayImpl(db, bus as any);

    const controller = new AbortController();
    const execPromise = gateway.submitAndAwait(
      'scraper:maps',
      { query: 'test' },
      {
        ...mockContext,
        abortSignal: controller.signal
      }
    );

    setTimeout(() => {
      controller.abort();
    }, 10);

    const result = await execPromise;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CANCELLED_BY_USER');
  });

  it('queries job status accurately', async () => {
    const db = new MockDatabase() as any;
    const bus = new MockEventBus();
    const gateway = new SchedulerGatewayImpl(db, bus as any);

    const status = await gateway.status('job-test', 'ws-test');
    expect(status).toBe('running');
  });
});
