import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { errorHandler } from '../../middleware/error-handler.js';
import { workspacesRouter } from '../../routes/business.js';
import { WorkspaceService } from '../../services/workspace/workspace.service.js';
import { DEFAULT_SCHEDULER_POLICY } from '@leadforge/schema';

const mockWorkspaceFind = vi.fn();

function makeQuery(result: any) {
  const promise = Promise.resolve(result);
  (promise as any).session = vi.fn().mockImplementation(() => promise);
  return promise;
}

vi.mock('../../db/models/workspace.model.js', () => {
  return {
    WorkspaceModel: {
      findById: (...args: any[]) => makeQuery(mockWorkspaceFind(...args)),
      findOne: (...args: any[]) => makeQuery(mockWorkspaceFind(...args)),
      create: vi.fn()
    }
  };
});

describe('Phase 2: Persist Scheduler Concurrency Policy in MongoDB', () => {
  let app: OpenAPIHono;
  let workspaceService: WorkspaceService;

  const wsA = 'ws_alpha_123';
  const wsB = 'ws_bravo_456';
  const userOwner = 'usr_owner_1';
  const userMember = 'usr_member_2';

  function createMockWorkspace(overrides: any = {}) {
    return {
      _id: wsA,
      name: 'Workspace Alpha',
      ownerId: userOwner,
      settings: {
        defaultTimezone: 'UTC',
        ...(overrides.settings || {})
      },
      members: overrides.members || [{ userId: userOwner, role: 'OWNER', status: 'ACTIVE' }],
      save: vi.fn().mockImplementation(async function (this: any) {
        return this;
      }),
      ...overrides
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceService = new WorkspaceService();

    app = new OpenAPIHono();
    app.onError(errorHandler);

    // Context mock middleware
    app.use('/workspaces/*', async (c, next) => {
      const authHeader = c.req.header('x-user-id') || userOwner;
      const wsHeader = c.req.header('x-workspace-id') || wsA;
      (c as any).set('user', { id: authHeader });
      (c as any).set('workspaceId', wsHeader);
      await next();
    });

    app.route('/workspaces', workspacesRouter);
  });

  describe('Contract A: Default Policy for Legacy / Missing Policy Workspaces', () => {
    it('returns canonical defaults when workspace document has no schedulerPolicy', async () => {
      const mockWorkspaceDoc = createMockWorkspace({
        settings: { defaultTimezone: 'UTC' } // schedulerPolicy missing
      });
      mockWorkspaceFind.mockReturnValue(mockWorkspaceDoc);

      const policy = await workspaceService.getSchedulerPolicy(wsA);

      expect(policy.globalMaxConcurrency).toBe(3);
      expect(policy.typeLimits).toEqual({
        'scraper:maps': 1,
        'crawler:website': 2,
        'enrich:intelligence': 2,
        'outreach:campaign': 2,
        'automation:workflow': 2
      });

      // Verify legacy document was bootstrapped in MongoDB
      expect(mockWorkspaceDoc.save).toHaveBeenCalled();
      expect(mockWorkspaceDoc.settings.schedulerPolicy).toBeDefined();
      expect(mockWorkspaceDoc.settings.schedulerPolicy.globalMaxConcurrency).toBe(3);
    });

    it('returns canonical defaults via GET /workspaces/:id/scheduler-policy', async () => {
      const mockWorkspaceDoc = createMockWorkspace({
        settings: { defaultTimezone: 'UTC' }
      });
      mockWorkspaceFind.mockReturnValue(mockWorkspaceDoc);

      const res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'GET',
        headers: {
          'x-workspace-id': wsA,
          'x-user-id': userOwner
        }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.globalMaxConcurrency).toBe(3);
      expect(body.data.typeLimits['scraper:maps']).toBe(1);
      expect(body.data.typeLimits['crawler:website']).toBe(2);
      expect(body.data.typeLimits['enrich:intelligence']).toBe(2);
      expect(body.data.typeLimits['outreach:campaign']).toBe(2);
      expect(body.data.typeLimits['automation:workflow']).toBe(2);
    });
  });

  describe('Contract B: Policy Persistence', () => {
    it('persists updated concurrency limits in MongoDB and returns them', async () => {
      const mockWorkspaceDoc = createMockWorkspace({
        settings: {
          defaultTimezone: 'UTC',
          schedulerPolicy: {
            globalMaxConcurrency: 3,
            typeLimits: { ...DEFAULT_SCHEDULER_POLICY.typeLimits },
            updatedAt: new Date('2026-01-01')
          }
        }
      });
      mockWorkspaceFind.mockReturnValue(mockWorkspaceDoc);

      const res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': wsA,
          'x-user-id': userOwner
        },
        body: JSON.stringify({
          globalMaxConcurrency: 6,
          typeLimits: {
            'scraper:maps': 2,
            'outreach:campaign': 3
          }
        })
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.globalMaxConcurrency).toBe(6);
      expect(body.data.typeLimits['scraper:maps']).toBe(2);
      expect(body.data.typeLimits['outreach:campaign']).toBe(3);
      expect(body.data.typeLimits['crawler:website']).toBe(2); // Preserves existing limits

      expect(mockWorkspaceDoc.save).toHaveBeenCalled();
      expect(mockWorkspaceDoc.settings.schedulerPolicy.globalMaxConcurrency).toBe(6);
    });
  });

  describe('Contract C: Workspace Isolation & Security Authorization', () => {
    it('enforces workspace isolation: Workspace A cannot fetch Workspace B policy', async () => {
      // User belongs to Workspace A, but requests Workspace B's policy
      const res = await app.request(`/workspaces/${wsB}/scheduler-policy`, {
        method: 'GET',
        headers: {
          'x-workspace-id': wsA, // Active tenant is A
          'x-user-id': userOwner
        }
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
    });

    it('enforces workspace isolation: Workspace A cannot modify Workspace B policy', async () => {
      const res = await app.request(`/workspaces/${wsB}/scheduler-policy`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': wsA,
          'x-user-id': userOwner
        },
        body: JSON.stringify({ globalMaxConcurrency: 10 })
      });

      expect(res.status).toBe(403);
    });

    it('prevents non-manager roles (MEMBER) from modifying scheduler policy', async () => {
      const mockWorkspaceDoc = createMockWorkspace({
        settings: {
          defaultTimezone: 'UTC',
          schedulerPolicy: { ...DEFAULT_SCHEDULER_POLICY }
        },
        members: [
          { userId: userOwner, role: 'OWNER', status: 'ACTIVE' },
          { userId: userMember, role: 'MEMBER', status: 'ACTIVE' }
        ]
      });
      mockWorkspaceFind.mockReturnValue(mockWorkspaceDoc);

      const res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': wsA,
          'x-user-id': userMember // Normal member, not OWNER or ADMIN
        },
        body: JSON.stringify({ globalMaxConcurrency: 4 })
      });

      expect(res.status).toBe(403);
      expect(mockWorkspaceDoc.save).not.toHaveBeenCalled();
    });
  });

  describe('Contract D: Validation Rules & Rejections', () => {
    it('rejects globalMaxConcurrency <= 0, negative values, and floats', async () => {
      const mockWorkspaceDoc = createMockWorkspace();
      mockWorkspaceFind.mockReturnValue(mockWorkspaceDoc);

      // Zero
      let res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': wsA },
        body: JSON.stringify({ globalMaxConcurrency: 0 })
      });
      expect(res.status).toBe(400);

      // Negative
      res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': wsA },
        body: JSON.stringify({ globalMaxConcurrency: -3 })
      });
      expect(res.status).toBe(400);

      // Float
      res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': wsA },
        body: JSON.stringify({ globalMaxConcurrency: 2.5 })
      });
      expect(res.status).toBe(400);
    });

    it('rejects negative numbers and floats in type limits', async () => {
      const mockWorkspaceDoc = createMockWorkspace();
      mockWorkspaceFind.mockReturnValue(mockWorkspaceDoc);

      // Negative type limit
      let res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': wsA },
        body: JSON.stringify({ typeLimits: { 'scraper:maps': -1 } })
      });
      expect(res.status).toBe(400);

      // Float type limit
      res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': wsA },
        body: JSON.stringify({ typeLimits: { 'crawler:website': 1.5 } })
      });
      expect(res.status).toBe(400);
    });

    it('accepts setting 0 in type limits to disable claiming for a job type', async () => {
      const mockWorkspaceDoc = createMockWorkspace({
        settings: {
          defaultTimezone: 'UTC',
          schedulerPolicy: { ...DEFAULT_SCHEDULER_POLICY }
        }
      });
      mockWorkspaceFind.mockReturnValue(mockWorkspaceDoc);

      const res = await app.request(`/workspaces/${wsA}/scheduler-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': wsA },
        body: JSON.stringify({ typeLimits: { 'scraper:maps': 0 } })
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.typeLimits['scraper:maps']).toBe(0);
    });
  });
});
