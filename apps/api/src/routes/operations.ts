import { OpenAPIHono } from '@hono/zod-openapi';
import { OperationsService } from '../services/operations/operations.service.js';
import { operationsQueryDtoSchema, retryOperationDtoSchema } from '@huntara/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId } from './common.js';
import { NotFoundError } from '../errors/index.js';

export const operationsRouter = new OpenAPIHono();

// 1. Get System Operations Health Summary
operationsRouter.get('/health', async (c) => {
  const wsId = getWorkspaceId(c);
  const service = new OperationsService(wsId);
  const summary = await service.getHealthSummary();
  return c.json(successResponse(summary));
});

// 2. List & Query Operations (Unified Jobs + Deliveries)
operationsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const query = c.req.query();
  const validated = operationsQueryDtoSchema.parse(query);

  const service = new OperationsService(wsId);
  const result = await service.listOperations(validated);
  return c.json(successResponse(result));
});

// 3. Get Single Operation Detail
operationsRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OperationsService(wsId);
  const operation = await service.getOperation(id);
  if (!operation) {
    throw new NotFoundError(`Operation with id "${id}" not found.`);
  }
  return c.json(successResponse(operation));
});

// 4. Get Operation Timeline Events
operationsRouter.get('/:id/events', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OperationsService(wsId);
  const events = await service.getOperationEvents(id);
  return c.json(successResponse(events));
});

// 5. Safely Retry Failed/Eligible Operation
operationsRouter.post('/:id/retry', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const validated = retryOperationDtoSchema.parse(body);

  const service = new OperationsService(wsId);
  const result = await service.retryOperation(id, validated.force);
  return c.json(successResponse(result));
});

// 6. Reconcile Ambiguous Delivery or Stalled Task
operationsRouter.post('/:id/reconcile', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OperationsService(wsId);
  const result = await service.reconcileOperation(id);
  return c.json(successResponse(result));
});
