import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { errorHandler } from '../../middleware/error-handler.js';
import { workspacesRouter } from '../../routes/business.js';
import { WorkspaceService } from '../../services/workspace/workspace.service.js';
import { WorkspaceModel } from '../../db/models/workspace.model.js';
import { workspaceMiddleware } from '../../middleware/auth.js';
import { NotFoundError, ForbiddenError } from '../../errors/index.js';

vi.mock('../../services/workspace/workspace.service.js');
vi.mock('../../db/models/workspace.model.js');

describe('Workspace & Tenant Authorization Boundaries (HUNTARA-SEC-001 & SEC-002)', () => {
  let app: OpenAPIHono;
  const ATTACKER_USER_ID = 'usr_attacker_999';
  const VICTIM_WS_ID = 'ws_victim_corp';

  beforeEach(() => {
    vi.clearAllMocks();
    app = new OpenAPIHono();
    app.onError(errorHandler);
  });

  describe('BOLA / IDOR Protection on Workspaces Router', () => {
    beforeEach(() => {
      // Authenticated as attacker
      app.use('*', async (c, next) => {
        (c as any).set('user', { id: ATTACKER_USER_ID, email: 'attacker@evil.com', role: 'member' });
        (c as any).set('workspaceId', 'ws_attacker_workspace');
        await next();
      });
      app.route('/workspaces', workspacesRouter);
    });

    it('rejects attacker querying GET /workspaces/{victimId} with 404 (BOLA protection)', async () => {
      // Mock workspaceService to enforce caller authorization
      vi.spyOn(WorkspaceService.prototype, 'getWorkspaceById').mockImplementation(
        async (id: string, callerUserId?: string) => {
          if (id === VICTIM_WS_ID && callerUserId === ATTACKER_USER_ID) {
            throw new NotFoundError('Workspace not found.');
          }
          return {
            _id: id,
            name: 'Victim Corp',
            ownerId: 'usr_victim_owner',
            members: []
          } as any;
        }
      );

      const res = await app.request(`/workspaces/${VICTIM_WS_ID}`, { method: 'GET' });
      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toBe('NOT_FOUND');
      // Verify getWorkspaceById was invoked with the caller's userId
      expect(WorkspaceService.prototype.getWorkspaceById).toHaveBeenCalledWith(
        VICTIM_WS_ID,
        ATTACKER_USER_ID
      );
    });

    it('rejects attacker querying GET /workspaces/{victimId}/members with 404 (roster leak protection)', async () => {
      vi.spyOn(WorkspaceService.prototype, 'getWorkspaceById').mockImplementation(
        async (id: string, callerUserId?: string) => {
          if (id === VICTIM_WS_ID && callerUserId === ATTACKER_USER_ID) {
            throw new NotFoundError('Workspace not found.');
          }
          return {
            _id: id,
            name: 'Victim Corp',
            ownerId: 'usr_victim_owner',
            members: [
              { userId: 'usr_victim_owner', email: 'owner@victim.com', role: 'OWNER' },
              { userId: 'usr_victim_cfo', email: 'cfo@victim.com', role: 'ADMIN' }
            ]
          } as any;
        }
      );

      const res = await app.request(`/workspaces/${VICTIM_WS_ID}/members`, { method: 'GET' });
      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toBe('NOT_FOUND');
      expect(WorkspaceService.prototype.getWorkspaceById).toHaveBeenCalledWith(
        VICTIM_WS_ID,
        ATTACKER_USER_ID
      );
    });

    it('allows authorized member to query their own workspace details', async () => {
      const OWN_WS_ID = 'ws_attacker_workspace';
      vi.spyOn(WorkspaceService.prototype, 'getWorkspaceById').mockResolvedValue({
        _id: OWN_WS_ID,
        name: 'Attacker Workspace',
        ownerId: ATTACKER_USER_ID,
        members: [{ userId: ATTACKER_USER_ID, email: 'attacker@evil.com', role: 'OWNER' }]
      } as any);

      const res = await app.request(`/workspaces/${OWN_WS_ID}`, { method: 'GET' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.name).toBe('Attacker Workspace');
    });
  });

  describe('Workspace Middleware ActiveWorkspace Verification (HUNTARA-SEC-002)', () => {
    it('does not trust stale activeWorkspaceId if user is neither owner nor member', async () => {
      const mockNext = vi.fn();
      const mockSet = vi.fn();

      // Attacker has activeWorkspaceId pointing to Victim workspace, but no x-workspace-id header
      const mockContext: any = {
        get: vi.fn().mockReturnValue({
          id: ATTACKER_USER_ID,
          activeWorkspaceId: VICTIM_WS_ID
        }),
        set: mockSet,
        req: {
          header: vi.fn().mockReturnValue(undefined)
        }
      };

      // WorkspaceModel.findById returns victim workspace where attacker is NOT owner and NOT member
      (WorkspaceModel.findById as any) = vi.fn().mockResolvedValue({
        _id: VICTIM_WS_ID,
        ownerId: 'usr_victim_owner',
        members: [{ userId: 'usr_victim_other', role: 'MEMBER' }]
      });

      // Also fallback findOne finds nothing for attacker
      (WorkspaceModel.findOne as any) = vi.fn().mockResolvedValue(null);

      await workspaceMiddleware(mockContext, mockNext);

      // Verify attacker was NOT assigned the victim workspace
      expect(mockSet).not.toHaveBeenCalledWith('workspaceId', VICTIM_WS_ID);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
