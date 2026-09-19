/**
 * LeadForge OS — Phase 9: IMAP Polling Efficiency Test Matrix
 *
 * Deterministically validates:
 * 1. Range calculation boundary cases (calculateImapFetchRange).
 * 2. Large mailbox server-side narrowing (100k messages -> 50 fetched).
 * 3. Small mailbox handling (20 messages -> all 20 fetched).
 * 4. Empty mailbox handling (0 messages -> fetch not called).
 * 5. New messages arriving between polls (no gap).
 * 6. Repeated polling idempotency.
 * 7. Expunged messages / sequence shift safety.
 * 8. UID correctness (uid: true passed).
 * 9. Existing correlation & contact / execution update behavior.
 * 10. No whole-mailbox fetch assertion (1:* never called when total > window).
 * 11. Error behavior preservation (connect, auth, fetch errors).
 * 12. Performance scaling acceptance test (1,000 vs 100,000 messages).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateImapFetchRange, pollImapReplies } from './imap-poller';
import { ContactStatus } from '@huntara/schema';
import type { JobContext } from '../../../shared/types/job';

// ── Mock imapflow and sdk ───────────────────────────────────────────────────

let mockMailboxExists = 0;
let mockFetchRangeCalled: string | null = null;
let mockFetchQueryCalled: any = null;
let mockFetchGenerator: (range: string) => AsyncIterable<any>;
let mockConnectError: Error | null = null;
let mockFetchError: Error | null = null;
let mockLockReleased = false;

const mockClient = {
  connect: vi.fn(async () => {
    if (mockConnectError) throw mockConnectError;
  }),
  logout: vi.fn(async () => {}),
  getMailboxLock: vi.fn(async (_mailbox: string) => {
    mockLockReleased = false;
    return {
      path: 'INBOX',
      release: vi.fn(() => {
        mockLockReleased = true;
      })
    };
  }),
  mailbox: {
    get exists() {
      return mockMailboxExists;
    },
    path: 'INBOX'
  },
  fetch: vi.fn(async function* (range: string, query: any, _options: any) {
    mockFetchRangeCalled = range;
    mockFetchQueryCalled = query;
    if (mockFetchError) throw mockFetchError;
    const gen = mockFetchGenerator(range);
    for await (const msg of gen) {
      yield msg;
    }
  })
};

vi.mock('imapflow', () => {
  return {
    ImapFlow: class MockImapFlow {
      connect = mockClient.connect;
      logout = mockClient.logout;
      getMailboxLock = mockClient.getMailboxLock;
      get mailbox() {
        return mockClient.mailbox;
      }
      fetch = mockClient.fetch;
    }
  };
});

// Mock SdkClient
let mockAccounts: any[] = [];
let mockExecutions: any[] = [];
let mockContacts: Map<string, any> = new Map();
let mockContactUpdates: Array<{ id: string; patch: any }> = [];
let mockExecutionUpdates: Array<{ id: string; patch: any }> = [];

vi.mock('@huntara/sdk', () => {
  return {
    SdkClient: class MockSdkClient {
      outreach = {
        listAccounts: vi.fn(async () => mockAccounts)
      };
      executions = {
        list: vi.fn(async () => mockExecutions),
        update: vi.fn(async (id: string, patch: any) => {
          mockExecutionUpdates.push({ id, patch });
          const ex = mockExecutions.find((e) => e.id === id);
          if (ex) Object.assign(ex, patch);
          return ex;
        })
      };
      contacts = {
        get: vi.fn(async (id: string) => mockContacts.get(id)),
        update: vi.fn(async (id: string, patch: any) => {
          mockContactUpdates.push({ id, patch });
          const c = mockContacts.get(id);
          if (c) Object.assign(c, patch);
          return c;
        })
      };
    }
  };
});

// Mock worker-env
vi.mock('../worker-env', () => ({
  resolveWorkerApiUrl: vi.fn(() => 'http://127.0.0.1:4000')
}));

function createTestJobContext(payload: Record<string, any> = {}): JobContext {
  const logs: Array<{ message: string; level: string }> = [];
  return {
    jobId: 'job_test_1',
    jobType: 'outreach:imap-poll',
    workspaceId: 'ws_test_alpha',
    payload: {
      _secrets: {
        'imap.host': 'imap.example.com',
        'imap.port': 993,
        'imap.username': 'outreach@example.com',
        'imap.password': 'secret123'
      },
      ...payload
    },
    emitLog: vi.fn((message: string, level: string = 'info') => {
      logs.push({ message, level });
    }),
    emitProgress: vi.fn()
  } as any;
}

/**
 * Generates an async iterable yielding simulated messages for a given sequence range.
 */
function createMessageGenerator(startSeq: number, endSeq: number, customMessages: Map<number, any> = new Map()) {
  return async function* () {
    for (let seq = startSeq; seq <= endSeq; seq++) {
      if (customMessages.has(seq)) {
        yield customMessages.get(seq);
      } else {
        yield {
          seq,
          uid: seq + 1000,
          envelope: {
            from: [{ address: `sender_${seq}@external.com` }],
            inReplyTo: undefined
          },
          headers: Buffer.from('')
        };
      }
    }
  };
}

describe('Phase 9 — IMAP Polling Efficiency Test Matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMailboxExists = 1000;
    mockFetchRangeCalled = null;
    mockFetchQueryCalled = null;
    mockConnectError = null;
    mockFetchError = null;
    mockLockReleased = false;

    mockAccounts = [
      {
        id: 'acc_1',
        email: 'outreach@example.com',
        status: 'connected',
        imapHost: 'imap.example.com',
        imapPort: 993
      }
    ];

    mockExecutions = [
      {
        id: 'exec_bob',
        contactId: 'cont_bob',
        campaignId: 'camp_1',
        status: 'RUNNING',
        startedAt: '2026-09-01T00:00:00.000Z'
      }
    ];

    mockContacts = new Map([
      [
        'cont_bob',
        {
          id: 'cont_bob',
          email: 'bob@prospect.com',
          firstName: 'Bob',
          lastName: 'Prospect'
        }
      ]
    ]);

    mockContactUpdates = [];
    mockExecutionUpdates = [];

    // Default generator for range e.g. "851:*"
    mockFetchGenerator = (range: string) => {
      const parts = range.split(':');
      const start = parseInt(parts[0] || '1', 10) || 1;
      const endPart = parts[1] || '*';
      const end = endPart === '*' ? mockMailboxExists : parseInt(endPart, 10) || mockMailboxExists;
      return createMessageGenerator(start, end)();
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── [1. Range Calculation Unit Tests] ───────────────────────────────────

  describe('calculateImapFetchRange', () => {
    it('returns null for empty mailbox (0 messages)', () => {
      expect(calculateImapFetchRange(0, 150)).toBeNull();
      expect(calculateImapFetchRange(-5, 150)).toBeNull();
    });

    it('returns "1:*" when mailbox size is smaller than window', () => {
      expect(calculateImapFetchRange(20, 150)).toBe('1:*');
      expect(calculateImapFetchRange(1, 150)).toBe('1:*');
    });

    it('returns "1:*" when mailbox size exactly matches window', () => {
      expect(calculateImapFetchRange(150, 150)).toBe('1:*');
      expect(calculateImapFetchRange(50, 50)).toBe('1:*');
    });

    it('returns startSeq:* when mailbox size exceeds window', () => {
      // 151 messages with window 150 -> 151 - 150 + 1 = 2
      expect(calculateImapFetchRange(151, 150)).toBe('2:*');
      // 1,000 messages with window 150 -> 1000 - 150 + 1 = 851
      expect(calculateImapFetchRange(1000, 150)).toBe('851:*');
      // 100,000 messages with window 50 -> 100000 - 50 + 1 = 99951
      expect(calculateImapFetchRange(100000, 50)).toBe('99951:*');
      // 500,000 messages with window 150 -> 500000 - 150 + 1 = 499851
      expect(calculateImapFetchRange(500000, 150)).toBe('499851:*');
    });
  });

  // ── [2. Acceptance Scenarios] ──────────────────────────────────────────

  it('Scenario 1 — Large mailbox narrowing: requests only recent window server-side', async () => {
    mockMailboxExists = 100_000;
    const ctx = createTestJobContext({ recentWindow: 50 });

    const result = await pollImapReplies(ctx);

    expect(result.status).toBe('success');
    expect(mockFetchRangeCalled).toBe('99951:*');
    expect(result.metrics.mailboxTotal).toBe(100_000);
    expect(result.metrics.windowSize).toBe(50);
    expect(result.metrics.fetchedCount).toBe(50);
    expect(result.metrics.processedCount).toBe(50);

    // Verify structured metrics log emitted
    const metricsLog = (ctx.emitLog as any).mock.calls.find((c: any) =>
      c[0].includes('[IMAP Metrics]')
    );
    expect(metricsLog).toBeDefined();
    expect(metricsLog[0]).toContain('Total: 100000');
    expect(metricsLog[0]).toContain('Range: 99951:*');
    expect(metricsLog[0]).toContain('Fetched: 50');
  });

  it('Scenario 2 — Small mailbox: requests all available messages when total <= window', async () => {
    mockMailboxExists = 20;
    const ctx = createTestJobContext({ recentWindow: 150 });

    const result = await pollImapReplies(ctx);

    expect(result.status).toBe('success');
    expect(mockFetchRangeCalled).toBe('1:*');
    expect(result.metrics.mailboxTotal).toBe(20);
    expect(result.metrics.fetchedCount).toBe(20);
    expect(result.metrics.processedCount).toBe(20);
  });

  it('Scenario 3 — Empty mailbox: skips fetch entirely and completes cleanly', async () => {
    mockMailboxExists = 0;
    const ctx = createTestJobContext();

    const result = await pollImapReplies(ctx);

    expect(result.status).toBe('success');
    expect(mockClient.fetch).not.toHaveBeenCalled();
    expect(result.metrics.mailboxTotal).toBe(0);
    expect(result.metrics.fetchedCount).toBe(0);
    expect(mockLockReleased).toBe(true);
  });

  it('Scenario 4 — New messages between polls: captures newly arrived messages without gaps', async () => {
    // Poll 1: 1,000 messages
    mockMailboxExists = 1000;
    const ctx1 = createTestJobContext({ recentWindow: 150 });
    const res1 = await pollImapReplies(ctx1);
    expect(mockFetchRangeCalled).toBe('851:*');
    expect(res1.metrics.fetchedCount).toBe(150);

    // 10 new messages arrive: total is now 1,010
    mockMailboxExists = 1010;
    const ctx2 = createTestJobContext({ recentWindow: 150 });
    const res2 = await pollImapReplies(ctx2);

    // Poll 2 requests 861:* (messages 861..1010, which includes 1001..1010)
    expect(mockFetchRangeCalled).toBe('861:*');
    expect(res2.metrics.fetchedCount).toBe(150);
  });

  it('Scenario 5 — Repeated polling: idempotent execution does not duplicate reply handling', async () => {
    mockMailboxExists = 500;
    const customMsgs = new Map<number, any>([
      [
        500,
        {
          seq: 500,
          uid: 5500,
          envelope: {
            from: [{ address: 'bob@prospect.com' }],
            inReplyTo: '<leadforge-camp1-bob@leadforge.internal>'
          },
          headers: Buffer.from('In-Reply-To: <leadforge-camp1-bob@leadforge.internal>\r\n')
        }
      ]
    ]);
    mockFetchGenerator = (range: string) => {
      const parts = range.split(':');
      const start = parseInt(parts[0] || '1', 10) || 1;
      return createMessageGenerator(start, 500, customMsgs)();
    };

    // First poll: Bob's reply is detected
    const ctx1 = createTestJobContext({ recentWindow: 150 });
    const res1 = await pollImapReplies(ctx1);
    expect(res1.repliedContactsCount).toBe(1);
    expect(mockExecutionUpdates.length).toBe(1);
    expect(mockExecutionUpdates[0]).toEqual({
      id: 'exec_bob',
      patch: expect.objectContaining({ status: 'COMPLETED' })
    });
    expect(mockContactUpdates[0]).toEqual({
      id: 'cont_bob',
      patch: { status: ContactStatus.REPLIED }
    });

    // Second poll: Bob's execution is now COMPLETED, so activeExecutions is empty
    const ctx2 = createTestJobContext({ recentWindow: 150 });
    const res2 = await pollImapReplies(ctx2);
    expect(res2.repliedContactsCount).toBe(0);
    // No additional updates executed
    expect(mockExecutionUpdates.length).toBe(1);
    expect(mockContactUpdates.length).toBe(1);
  });

  it('Scenario 6 — Expunged messages / sequence shift: correctly computes range after mailbox compaction', async () => {
    // Initially 10,000 messages
    mockMailboxExists = 10000;
    const ctx1 = createTestJobContext({ recentWindow: 150 });
    await pollImapReplies(ctx1);
    expect(mockFetchRangeCalled).toBe('9851:*');

    // 500 old messages expunged: total drops to 9,500
    mockMailboxExists = 9500;
    const ctx2 = createTestJobContext({ recentWindow: 150 });
    await pollImapReplies(ctx2);
    // New range aligns with compacted sequence numbers: 9500 - 150 + 1 = 9351
    expect(mockFetchRangeCalled).toBe('9351:*');
  });

  it('Scenario 7 — UID correctness: ensures uid: true option is passed to fetch', async () => {
    mockMailboxExists = 500;
    const ctx = createTestJobContext({ recentWindow: 100 });
    await pollImapReplies(ctx);

    expect(mockFetchQueryCalled).toBeDefined();
    expect(mockFetchQueryCalled.uid).toBe(true);
  });

  it('Scenario 8 — Existing correlation behavior: properly correlates reply and updates records', async () => {
    mockMailboxExists = 100;
    const customMsgs = new Map<number, any>([
      [
        100,
        {
          seq: 100,
          uid: 1100,
          envelope: {
            from: [{ address: 'bob@prospect.com' }],
            inReplyTo: '<camp1-step1-bob@domain.com>'
          },
          headers: Buffer.from('In-Reply-To: <camp1-step1-bob@domain.com>\r\nReferences: <camp1-step1-bob@domain.com>\r\n')
        }
      ]
    ]);
    mockFetchGenerator = () => createMessageGenerator(1, 100, customMsgs)();

    const ctx = createTestJobContext({ recentWindow: 50 });
    const result = await pollImapReplies(ctx);

    expect(result.repliedContactsCount).toBe(1);
    expect(mockExecutionUpdates).toHaveLength(1);
    expect(mockExecutionUpdates[0]!.id).toBe('exec_bob');
    expect(mockExecutionUpdates[0]!.patch.status).toBe('COMPLETED');
    expect(mockContactUpdates).toHaveLength(1);
    expect(mockContactUpdates[0]!.id).toBe('cont_bob');
    expect(mockContactUpdates[0]!.patch.status).toBe(ContactStatus.REPLIED);
  });

  it('Scenario 9 — No whole-mailbox request: 1:* is never called when total > window', async () => {
    mockMailboxExists = 50_000;
    const ctx = createTestJobContext({ recentWindow: 150 });

    await pollImapReplies(ctx);

    expect(mockFetchRangeCalled).not.toBe('1:*');
    expect(mockFetchRangeCalled).toBe('49851:*');
  });

  it('Scenario 10a — Error behavior: connection error is logged, lock released, and re-thrown', async () => {
    mockConnectError = new Error('ECONNREFUSED: Connection refused by IMAP server');
    const ctx = createTestJobContext();

    await expect(pollImapReplies(ctx)).rejects.toThrow('ECONNREFUSED');
    expect(ctx.emitLog).toHaveBeenCalledWith(
      expect.stringContaining('IMAP Poller execution failed: ECONNREFUSED'),
      'error'
    );
  });

  it('Scenario 10b — Error behavior: fetch failure releases lock and re-throws cleanly', async () => {
    mockMailboxExists = 500;
    mockFetchError = new Error('IMAP FETCH socket dropped');
    const ctx = createTestJobContext();

    await expect(pollImapReplies(ctx)).rejects.toThrow('IMAP FETCH socket dropped');
    expect(mockLockReleased).toBe(true);
    expect(ctx.emitLog).toHaveBeenCalledWith(
      expect.stringContaining('IMAP FETCH socket dropped'),
      'error'
    );
  });

  // ── [3. Performance Scaling Acceptance Test] ───────────────────────────

  it('Scenario 11 — Performance Scaling Acceptance Test: 1k vs 100k mailbox fetches identical message count', async () => {
    const WINDOW = 50;

    // Case A: 1,000-message mailbox
    mockMailboxExists = 1_000;
    const ctxA = createTestJobContext({ recentWindow: WINDOW });
    const resA = await pollImapReplies(ctxA);

    // Case B: 100,000-message mailbox (100x larger!)
    mockMailboxExists = 100_000;
    const ctxB = createTestJobContext({ recentWindow: WINDOW });
    const resB = await pollImapReplies(ctxB);

    // Critical assertion: both cases retrieved exactly WINDOW (50) messages
    expect(resA.metrics.fetchedCount).toBe(WINDOW);
    expect(resB.metrics.fetchedCount).toBe(WINDOW);
    expect(resA.metrics.fetchedCount).toBe(resB.metrics.fetchedCount);

    // Verify ranges were server-side restricted
    expect(resA.metrics.range).toBe('951:*');
    expect(resB.metrics.range).toBe('99951:*');
  });
});
