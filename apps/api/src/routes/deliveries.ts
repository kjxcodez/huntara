import { OpenAPIHono } from '@hono/zod-openapi';
import { EmailDeliveryRepository } from '../repositories/email-delivery/email-delivery.repository.js';
import { EmailEventRepository } from '../repositories/email-event/email-event.repository.js';
import { ReconciliationService } from '../services/email/reconciliation.service.js';
import {
  createEmailDeliveryDtoSchema,
  bulkEmailDeliveryDtoSchema,
  updateEmailDeliveryDtoSchema,
  reserveEmailDeliveryDtoSchema,
  finalizeEmailDeliveryDtoSchema
} from '@huntara/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId, getUserId } from './common.js';
import { NotFoundError, BadRequestError } from '../errors/index.js';

export const deliveriesRouter = new OpenAPIHono();

// 1. List / Paginate Deliveries
deliveriesRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const campaignId = c.req.query('campaignId');
  const sequenceId = c.req.query('sequenceId');
  const contactId = c.req.query('contactId');
  const companyId = c.req.query('companyId');
  const accountId = c.req.query('accountId');
  const status = c.req.query('status');
  const direction = c.req.query('direction');
  const processingStatus = c.req.query('processingStatus');
  const search = c.req.query('search');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const filter: any = {};
  if (campaignId && campaignId !== 'undefined' && campaignId !== 'null') filter.campaignId = campaignId;
  if (sequenceId && sequenceId !== 'undefined' && sequenceId !== 'null') filter.sequenceId = sequenceId;
  if (contactId && contactId !== 'undefined' && contactId !== 'null') filter.contactId = contactId;
  if (companyId && companyId !== 'undefined' && companyId !== 'null') filter.companyId = companyId;
  if (accountId && accountId !== 'undefined' && accountId !== 'null') filter.accountId = accountId;
  if (status && status !== 'undefined' && status !== 'null') filter.status = status;
  if (direction && direction !== 'undefined' && direction !== 'null') filter.direction = direction;
  if (processingStatus && processingStatus !== 'undefined' && processingStatus !== 'null' && processingStatus !== 'all') {
    filter.processingStatus = processingStatus;
  }

  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { subject: { $regex: escaped, $options: 'i' } },
      { recipientEmail: { $regex: escaped, $options: 'i' } },
      { senderEmail: { $regex: escaped, $options: 'i' } }
    ];
  }

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const repo = new EmailDeliveryRepository(wsId);
  const result = await repo.paginate(filter, page, limit, { createdAt: -1 });
  return c.json(successResponse(result));
});

// 2. Query Ambiguous Deliveries for Diagnosis
deliveriesRouter.get('/ambiguous', async (c) => {
  const wsId = getWorkspaceId(c);
  const repo = new EmailDeliveryRepository(wsId);
  const ambiguous = await repo.findMany({ status: 'AMBIGUOUS' });
  return c.json(successResponse(ambiguous));
});

// 3. Lookup Delivery by Idempotency Key
deliveriesRouter.get('/by-idempotency/:key', async (c) => {
  const wsId = getWorkspaceId(c);
  const key = c.req.param('key');

  const repo = new EmailDeliveryRepository(wsId);
  const delivery = await repo.findByIdempotencyKey(key);
  if (!delivery) throw new NotFoundError(`Delivery with idempotency key ${key} not found`);
  return c.json(successResponse(delivery));
});

// 4. Reserve Delivery Atomically (Pre-Send Ledger Reservation)
deliveriesRouter.post('/reserve', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = reserveEmailDeliveryDtoSchema.parse(body);

  const repo = new EmailDeliveryRepository(wsId);
  const result = await repo.reserveDelivery(validated);
  return c.json(successResponse(result), result.isAlreadySent ? 200 : 201);
});

// 5. Batch Create/Upsert Deliveries (Max 50)
deliveriesRouter.post('/bulk', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = bulkEmailDeliveryDtoSchema.parse(body);

  const repo = new EmailDeliveryRepository(wsId);
  const result = await repo.bulkUpsert(validated.deliveries, ['idempotencyKey']);
  return c.json(successResponse(result), result.failed > 0 && result.inserted === 0 ? 400 : 201);
});

// 6. Create Single Delivery
deliveriesRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createEmailDeliveryDtoSchema.parse(body);

  const repo = new EmailDeliveryRepository(wsId);
  const existing = await repo.findByIdempotencyKey(validated.idempotencyKey);
  if (existing) {
    return c.json(successResponse(existing), 200);
  }

  const delivery = await repo.create(validated as any);
  return c.json(successResponse(delivery), 201);
});

// 7. Get Delivery / Message by ID
deliveriesRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const repo = new EmailDeliveryRepository(wsId);
  const delivery = await repo.findById(id);
  if (!delivery) throw new NotFoundError(`Delivery with id ${id} not found`);
  return c.json(successResponse(delivery));
});

// 7b. Get Engagement Events for Delivery
deliveriesRouter.get('/:id/events', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const eventRepo = new EmailEventRepository(wsId);
  const events = await eventRepo.findEventsForDelivery(id);
  return c.json(successResponse(events));
});

// 8. Finalize Delivery Status (Mark SENT)
deliveriesRouter.post('/:id/finalize', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const validated = finalizeEmailDeliveryDtoSchema.parse(body);

  const repo = new EmailDeliveryRepository(wsId);
  const updated = await repo.finalizeDelivery(id, {
    providerMessageId: validated.providerMessageId || '',
    providerThreadId: validated.providerThreadId,
    sentAt: validated.sentAt || new Date()
  });

  return c.json(successResponse(updated));
});

// 9. Reconcile Stale Deliveries
deliveriesRouter.post('/reconcile', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json().catch(() => ({}));
  const maxAgeMs = typeof body.maxAgeMs === 'number' ? body.maxAgeMs : 300000;

  const repo = new EmailDeliveryRepository(wsId);
  const diagnosis = await repo.reconcileStaleDeliveries(maxAgeMs);
  return c.json(successResponse(diagnosis));
});

// 10. Update Delivery Status (Mark SENT, FAILED, RETRYING)
deliveriesRouter.patch('/:id/status', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const validated = updateEmailDeliveryDtoSchema.parse(body);

  const repo = new EmailDeliveryRepository(wsId);
  const updated = await repo.updateDeliveryStatus(
    id,
    validated.status,
    validated.providerMessageId,
    validated.error,
    validated.sentAt
  );
  if (!updated) throw new NotFoundError(`Delivery with id ${id} not found`);
  return c.json(successResponse(updated));
});

// 11. Reconcile AMBIGUOUS Sends against Gmail
deliveriesRouter.post('/reconcile-ambiguous', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json().catch(() => ({}));
  const limit = typeof body.limit === 'number' ? body.limit : 10;

  const service = new ReconciliationService(wsId);
  const results = await service.reconcileAllAmbiguous(limit);
  return c.json(successResponse(results));
});

// 11b. Reconcile Single Ambiguous Delivery by ID
deliveriesRouter.post('/:id/reconcile', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');

  const service = new ReconciliationService(wsId);
  const result = await service.reconcileAmbiguousDelivery(id);
  return c.json(successResponse(result));
});

// 12. Poll Inbound Replies from Connected Gmail Accounts
deliveriesRouter.post('/poll-replies', async (c) => {
  const wsId = getWorkspaceId(c);
  const service = new ReconciliationService(wsId);
  const results = await service.pollAllInboundReplies();
  return c.json(successResponse(results));
});

// 12b. Re-index Pending Inbound Replies (Bounded Exponential Backoff)
deliveriesRouter.post('/reindex-inbound', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json().catch(() => ({}));
  const limit = typeof body.limit === 'number' ? body.limit : 50;

  const service = new ReconciliationService(wsId);
  const result = await service.reindexPendingInboundReplies({ limit });
  return c.json(successResponse(result));
});

// 13. Manually Reconcile Inbound Reply to Contact / Campaign / Outbound Delivery
deliveriesRouter.post('/:id/manual-reconcile', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const userId = getUserId(c);

  const contactId = body.contactId;
  if (!contactId) {
    throw new BadRequestError('contactId is required for manual reply reconciliation.');
  }

  const service = new ReconciliationService(wsId);
  const result = await service.manualReconcileInboundReply(id, {
    contactId,
    campaignId: body.campaignId || null,
    matchedDeliveryId: body.matchedDeliveryId || null,
    notes: body.notes || null,
    operatorId: userId || 'operator'
  });

  return c.json(successResponse(result));
});


