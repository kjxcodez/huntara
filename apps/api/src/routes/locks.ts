import { OpenAPIHono } from '@hono/zod-openapi';
import { AutomationLockRepository } from '../repositories/automation-lock/automation-lock.repository.js';
import {
  acquireLockDtoSchema,
  releaseLockDtoSchema
} from '@huntara/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId } from './common.js';

export const locksRouter = new OpenAPIHono();

// 1. Acquire Lock
locksRouter.post('/acquire', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = acquireLockDtoSchema.parse(body);

  const repo = new AutomationLockRepository(wsId);
  const result = await repo.acquireLock(
    validated.sequenceId,
    validated.entityId,
    validated.ownerId,
    validated.leaseDurationMs
  );

  return c.json(successResponse(result), result.acquired ? 200 : 409);
});

// 2. Renew Lock
locksRouter.post('/renew', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = acquireLockDtoSchema.parse(body);

  const repo = new AutomationLockRepository(wsId);
  const renewed = await repo.renewLock(
    validated.sequenceId,
    validated.entityId,
    validated.ownerId,
    validated.leaseDurationMs
  );

  return c.json(successResponse({ renewed }), renewed ? 200 : 404);
});

// 3. Release Lock
locksRouter.post('/release', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = releaseLockDtoSchema.parse(body);

  const repo = new AutomationLockRepository(wsId);
  const released = await repo.releaseLock(
    validated.sequenceId,
    validated.entityId,
    validated.ownerId
  );

  return c.json(successResponse({ released }));
});
