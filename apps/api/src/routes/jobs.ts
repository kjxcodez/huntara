import { OpenAPIHono } from '@hono/zod-openapi';
import { JobRepository } from '../repositories/job/job.repository.js';
import {
  createJobDtoSchema,
  bulkJobDtoSchema,
  jobCheckpointDtoSchema,
  jobStatusTransitionDtoSchema,
  jobHeartbeatDtoSchema
} from '@huntara/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId } from './common.js';
import { NotFoundError } from '../errors/index.js';

export const jobsRouter = new OpenAPIHono();

// 1. List / Poll Jobs
jobsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const status = c.req.query('status');
  const type = c.req.query('type');
  const workerId = c.req.query('workerId');

  const filter: any = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (workerId) filter.workerId = workerId;

  const repo = new JobRepository(wsId);
  const result = await repo.paginate(filter, page, limit, { priority: -1, createdAt: 1 });
  return c.json(successResponse(result));
});

// 2. Claim Next Eligible Job (Atomic Concurrency Primitive)
jobsRouter.post('/claim', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json().catch(() => ({}));
  const workerId = body.workerId || 'default-worker';
  const supportedTypes = Array.isArray(body.supportedTypes)
    ? body.supportedTypes
    : body.types && Array.isArray(body.types)
      ? body.types
      : [body.type || 'generic'];
  const leaseDurationMs = body.leaseDurationMs || 60_000;

  const repo = new JobRepository(wsId);
  const claimedJob = await repo.claimJob(workerId, supportedTypes, leaseDurationMs);
  return c.json(successResponse(claimedJob));
});

// 3. Batch Create Jobs (Max 100)
jobsRouter.post('/bulk', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = bulkJobDtoSchema.parse(body);

  const repo = new JobRepository(wsId);
  const result = await repo.bulkInsert(validated.jobs);
  return c.json(successResponse(result), result.failed > 0 && result.inserted === 0 ? 400 : 201);
});

// 4. Create Single Job (with Idempotency Support)
jobsRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createJobDtoSchema.parse(body);

  const repo = new JobRepository(wsId);
  if (validated.idempotencyKey) {
    const existing = await repo.findByIdempotencyKey(validated.idempotencyKey);
    if (existing) {
      return c.json(successResponse(existing), 200);
    }
  }

  const job = await repo.create(validated);
  return c.json(successResponse(job), 201);
});

// 5. Recover Interrupted / Stale Lease Jobs
jobsRouter.post('/recover', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json().catch(() => ({}));
  const staleThresholdMs = body.staleThresholdMs || 60_000;

  const repo = new JobRepository(wsId);
  const result = await repo.recoverInterruptedJobs(staleThresholdMs);
  return c.json(successResponse(result));
});

// 5b. List Dead-Letter Jobs
jobsRouter.get('/dead-letters', async (c) => {
  const wsId = getWorkspaceId(c);
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const repo = new JobRepository(wsId);
  const result = await repo.listDeadLetters(limit, offset);
  return c.json(successResponse(result));
});

// 6. Get Job by ID
jobsRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const repo = new JobRepository(wsId);
  const job = await repo.findById(id);
  return c.json(successResponse(job));
});

// 7. Save Checkpoint Progress
jobsRouter.post('/:id/checkpoint', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const validated = jobCheckpointDtoSchema.parse(body);

  const repo = new JobRepository(wsId);
  const updated = await repo.checkpoint(id, validated.progress, validated.checkpointData, validated.workerId);
  if (!updated) throw new NotFoundError(`Job with id ${id} not found or worker mismatch`);
  return c.json(successResponse(updated));
});

// 8. Heartbeat
jobsRouter.post('/:id/heartbeat', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const validated = jobHeartbeatDtoSchema.parse(body);

  const repo = new JobRepository(wsId);
  const updated = await repo.heartbeat(id, validated.workerId, validated.leaseDurationMs || 60_000);
  if (!updated) throw new NotFoundError(`Job with id ${id} not found or lease inactive`);
  return c.json(successResponse(updated));
});

// 9. Transition Job Status
jobsRouter.post('/:id/status', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const validated = jobStatusTransitionDtoSchema.parse(body);

  const repo = new JobRepository(wsId);
  const updated = await repo.transitionStatus(
    id,
    validated.status,
    validated.workerId,
    validated.error,
    validated.durationMs,
    validated.scheduledAt
  );
  if (!updated) throw new NotFoundError(`Job with id ${id} not found`);
  return c.json(successResponse(updated));
});

// 10. Complete Job Shortcut
jobsRouter.post('/:id/complete', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const repo = new JobRepository(wsId);
  const updated = await repo.transitionStatus(id, 'completed', body.workerId, null, body.durationMs);
  if (!updated) throw new NotFoundError(`Job with id ${id} not found`);
  return c.json(successResponse(updated));
});

// 11. Fail Job Shortcut
jobsRouter.post('/:id/fail', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const repo = new JobRepository(wsId);
  const updated = await repo.transitionStatus(id, 'failed', body.workerId, body.error, body.durationMs);
  if (!updated) throw new NotFoundError(`Job with id ${id} not found`);
  return c.json(successResponse(updated));
});

// 12. Cancel Job Shortcut
jobsRouter.post('/:id/cancel', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const repo = new JobRepository(wsId);
  const updated = await repo.transitionStatus(id, 'cancelled');
  if (!updated) throw new NotFoundError(`Job with id ${id} not found`);
  return c.json(successResponse(updated));
});

// 13. Move Job to Dead-Letter
jobsRouter.post('/:id/dead-letter', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const repo = new JobRepository(wsId);
  const updated = await repo.moveToDeadLetter(id, body.reason || 'manual_operator_dead_letter', body.lineage);
  if (!updated) throw new NotFoundError(`Job with id ${id} not found`);
  return c.json(successResponse(updated));
});

// 14. Requeue Dead-Letter Job
jobsRouter.post('/:id/requeue', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const repo = new JobRepository(wsId);
  const updated = await repo.requeueDeadLetter(id);
  if (!updated) throw new NotFoundError(`Dead-letter job with id ${id} not found`);
  return c.json(successResponse(updated));
});

