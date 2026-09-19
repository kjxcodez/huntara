import { OpenAPIHono } from '@hono/zod-openapi';
import { SystemLogRepository } from '../repositories/system-log/system-log.repository.js';
import { createSystemLogDtoSchema, bulkSystemLogDtoSchema } from '@huntara/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId } from './common.js';

export const systemLogsRouter = new OpenAPIHono();

// 1. Append Single Log
systemLogsRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createSystemLogDtoSchema.parse(body);

  const repo = new SystemLogRepository(wsId);
  const log = await repo.create(validated);
  return c.json(successResponse(log), 201);
});

// 2. Batch Append Logs (Max 200)
systemLogsRouter.post('/bulk', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = bulkSystemLogDtoSchema.parse(body);

  const repo = new SystemLogRepository(wsId);
  const result = await repo.bulkInsert(validated.logs);
  return c.json(successResponse(result), result.failed > 0 && result.inserted === 0 ? 400 : 201);
});

// 3. List Recent Logs
systemLogsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 200);
  const severity = c.req.query('severity');

  const repo = new SystemLogRepository(wsId);
  const logs = await repo.listRecent(limit, severity);
  return c.json(successResponse(logs));
});
