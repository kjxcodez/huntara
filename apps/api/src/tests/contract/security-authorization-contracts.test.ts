import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { errorHandler } from '../../middleware/error-handler.js';
import { emailRouter } from '../../routes/email/index.js';
import { deliveriesRouter } from '../../routes/deliveries.js';
import { jobsRouter } from '../../routes/jobs.js';
import { EmailAccountService } from '../../services/email/email-account.service.js';
import { EmailDeliveryRepository } from '../../repositories/email-delivery/email-delivery.repository.js';
import { ReconciliationService } from '../../services/email/reconciliation.service.js';
import { JobRepository } from '../../repositories/job/job.repository.js';
import { NotFoundError, BadRequestError } from '../../errors/index.js';

vi.mock('../../services/email/email-account.service.js');
vi.mock('../../repositories/email-delivery/email-delivery.repository.js');
vi.mock('../../services/email/reconciliation.service.js');
vi.mock('../../repositories/job/job.repository.js');

describe('Phase 19 Security Hardening & Cross-Tenant Authorization Matrix', () => {
  let app: OpenAPIHono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new OpenAPIHono();
    app.onError(errorHandler);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. MISSING WORKSPACE CONTEXT REJECTION (HTTP 403)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Missing Workspace Context Guard', () => {
    it('rejects unauthenticated requests to email accounts router with 403', async () => {
      app.route('/email', emailRouter);
      const res = await app.request('/email/accounts/acc_123/reset-health', { method: 'POST' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toBe('FORBIDDEN');
    });

    it('rejects unauthenticated requests to deliveries router with 403', async () => {
      app.route('/email-deliveries', deliveriesRouter);
      const res = await app.request('/email-deliveries/del_123/manual-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: 'cnt_1' })
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toBe('FORBIDDEN');
    });

    it('rejects unauthenticated requests to jobs/dead-letters router with 403', async () => {
      app.route('/jobs', jobsRouter);
      const res = await app.request('/jobs/dead-letters', { method: 'GET' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toBe('FORBIDDEN');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. HOSTILE CROSS-TENANT MUTATION REJECTION (HTTP 404 / 403)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Hostile Cross-Tenant Isolation', () => {
    const ATTACKER_WS = 'ws_attacker_corp';
    const VICTIM_ACCOUNT_ID = 'acc_victim_001';
    const VICTIM_DELIVERY_ID = 'del_victim_999';
    const VICTIM_JOB_ID = 'job_victim_dead_777';

    beforeEach(() => {
      // Attacker context
      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', ATTACKER_WS);
        (c as any).set('user', { id: 'usr_attacker', role: 'member' });
        await next();
      });
      app.route('/email', emailRouter);
      app.route('/email-deliveries', deliveriesRouter);
      app.route('/jobs', jobsRouter);
    });

    it('rejects Attacker attempt to reset Victim mailbox health with 404 (scoped isolation)', async () => {
      EmailAccountService.prototype.resetMailboxHealth = vi.fn().mockRejectedValue(
        new NotFoundError('Account not found in workspace')
      );

      const res = await app.request(`/email/accounts/${VICTIM_ACCOUNT_ID}/reset-health`, {
        method: 'POST'
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toBe('NOT_FOUND');
    });

    it('rejects Attacker attempt to manually reconcile Victim delivery with 404', async () => {
      ReconciliationService.prototype.manualReconcileInboundReply = vi.fn().mockRejectedValue(
        new NotFoundError(`Inbound delivery with id "${VICTIM_DELIVERY_ID}" not found in workspace.`)
      );

      const res = await app.request(`/email-deliveries/${VICTIM_DELIVERY_ID}/manual-reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: 'cnt_attacker_1' })
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toBe('NOT_FOUND');
    });

    it('rejects Attacker attempt to requeue Victim dead-letter job with 404', async () => {
      JobRepository.prototype.requeueDeadLetter = vi.fn().mockResolvedValue(null);

      const res = await app.request(`/jobs/${VICTIM_JOB_ID}/requeue`, {
        method: 'POST'
      });

      expect(res.status).toBe(404);
      expect(JobRepository).toHaveBeenCalledWith(ATTACKER_WS);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. INPUT VALIDATION & ADVERSARIAL FUZZING
  // ──────────────────────────────────────────────────────────────────────────
  describe('Adversarial Input Fuzzing & Injection Protection', () => {
    beforeEach(() => {
      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', 'ws_fuzz_test');
        (c as any).set('user', { id: 'usr_fuzzer', role: 'owner' });
        await next();
      });
      app.route('/email-deliveries', deliveriesRouter);
    });

    it('rejects malformed reserve delivery payload with 400 (Zod validation constraint)', async () => {
      const res = await app.request('/email-deliveries/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing required fields like idempotencyKey, campaignId, contactId, etc.
          maliciousField: 'exploit_test'
        })
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.stack).toBeUndefined(); // Zero stack trace leakage
    });

    it('rejects missing contactId in manual reconcile with 400 Bad Request', async () => {
      const res = await app.request('/email-deliveries/del_123/manual-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.message).toBe('BAD_REQUEST');
      expect(body.stack).toBeUndefined();
    });

    it('rejects path traversal strings in resource ID safely with 404', async () => {
      EmailDeliveryRepository.prototype.findById = vi.fn().mockResolvedValue(null);

      const pathTraversalId = '../../../../etc/passwd';
      const res = await app.request(`/email-deliveries/${encodeURIComponent(pathTraversalId)}`, {
        method: 'GET'
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.stack).toBeUndefined();
    });

    it('handles SQL injection attempt in contactId safely via domain service rejection', async () => {
      const sqlInjection = "' OR '1'='1'; DROP TABLE sequence_executions; --";
      ReconciliationService.prototype.manualReconcileInboundReply = vi.fn().mockRejectedValue(
        new NotFoundError(`Target contact with id "${sqlInjection}" not found in workspace.`)
      );

      const res = await app.request('/email-deliveries/del_1/manual-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: sqlInjection })
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error.message).toBe('NOT_FOUND');
      expect(body.stack).toBeUndefined();
    });

    it('rejects prototype pollution attempts in JSON body safely', async () => {
      const pollutedPayload = JSON.parse('{"__proto__": {"isAdmin": true}, "contactId": "cnt_pollute"}');
      ReconciliationService.prototype.manualReconcileInboundReply = vi.fn().mockRejectedValue(
        new NotFoundError('Target contact not found')
      );

      const res = await app.request('/email-deliveries/del_1/manual-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pollutedPayload)
      });

      // Verify Object prototype was not corrupted
      expect((Object.prototype as any).isAdmin).toBeUndefined();
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. SECRET & CREDENTIAL LEAKAGE AUDIT
  // ──────────────────────────────────────────────────────────────────────────
  describe('Secret & Credential Privacy Invariant', () => {
    it('verifies mailbox responses never leak OAuth tokens or client secrets', async () => {
      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', 'ws_secret_test');
        (c as any).set('user', { id: 'usr_test', role: 'owner' });
        await next();
      });
      app.route('/email', emailRouter);

      EmailAccountService.prototype.resetMailboxHealth = vi.fn().mockResolvedValue({
        id: 'acc_secret_01',
        workspaceId: 'ws_secret_test',
        email: 'sender@secret.internal',
        displayName: 'Secret Sender',
        status: 'connected',
        healthState: 'HEALTHY',
        cooldownUntil: null
      } as any);

      const res = await app.request('/email/accounts/acc_secret_01/reset-health', {
        method: 'POST'
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      const rawString = JSON.stringify(body);

      // Invariant: Zero secret tokens exposed in response
      expect(rawString.includes('ya29.')).toBe(false);
      expect(rawString.includes('sensitive_oauth_access_token')).toBe(false);
      expect(rawString.includes('sensitive_oauth_refresh_token')).toBe(false);
      expect(rawString.includes('super_secret_client_key')).toBe(false);
    });
  });
});

