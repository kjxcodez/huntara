import { OpenAPIHono } from '@hono/zod-openapi';
import { AuditLogRepository } from '../repositories/audit-log/audit-log.repository.js';
import { createAuditLogDtoSchema } from '@huntara/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId } from './common.js';

export const auditRouter = new OpenAPIHono();

// 1. Append Audit Log
auditRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createAuditLogDtoSchema.parse(body);

  const repo = new AuditLogRepository(wsId);
  const log = await repo.appendLog({
    ...validated,
    actor: {
      ...validated.actor,
      userId: validated.actor.userId ?? null
    },
    timestamp: new Date()
  } as any);
  return c.json(successResponse(log), 201);
});

// 2. List Recent Audit Logs
auditRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  const repo = new AuditLogRepository(wsId);
  const result = await repo.paginate({}, page, limit, { timestamp: -1 });
  return c.json(successResponse(result));
});

// 3. Query Audit Logs by Entity
auditRouter.get('/entity/:entityType/:entityId', async (c) => {
  const wsId = getWorkspaceId(c);
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  const repo = new AuditLogRepository(wsId);
  const logs = await repo.findByEntity(entityType, entityId, limit);
  return c.json(successResponse(logs));
});

// 4. Query Audit Logs by Actor
auditRouter.get('/actor/:userId', async (c) => {
  const wsId = getWorkspaceId(c);
  const userId = c.req.param('userId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  const repo = new AuditLogRepository(wsId);
  const logs = await repo.findByActor(userId, limit);
  return c.json(successResponse(logs));
});
