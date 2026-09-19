import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { suppressionsRouter } from '../../routes/suppressions.js';
import { emailQualityRouter } from '../../routes/email-quality.js';
import { SuppressionRepository } from '../../repositories/suppression/suppression.repository.js';
import { EmailQualityService } from '../../services/email/email-quality.service.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { EmailQualityStatus, SuppressionReason } from '@huntara/schema';

vi.mock('../../repositories/suppression/suppression.repository.js');
vi.mock('../../services/email/email-quality.service.js');

describe('Suppression & Email Quality Route Contracts', () => {
  let app: OpenAPIHono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new OpenAPIHono();
    app.onError(errorHandler);
  });

  describe('Suppression Endpoints Contract', () => {
    it('enforces workspace context requirement (HTTP 403 / Forbidden)', async () => {
      app.route('/suppressions', suppressionsRouter);

      const res = await app.request('/suppressions', {
        method: 'GET'
      });

      expect(res.status).toBe(403);
    });

    it('GET /suppressions returns 200 with list of suppressions', async () => {
      const mockResult = {
        items: [
          {
            id: 'sup_1',
            workspaceId: 'ws_test',
            email: 'blocked@example.com',
            reason: SuppressionReason.DO_NOT_CONTACT,
            source: 'manual',
            suppressedAt: new Date().toISOString()
          }
        ],
        total: 1
      };

      SuppressionRepository.prototype.listSuppressions = vi.fn().mockResolvedValue(mockResult);

      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', 'ws_test');
        await next();
      });
      app.route('/suppressions', suppressionsRouter);

      const res = await app.request('/suppressions', { method: 'GET' });
      expect(res.status).toBe(200);

      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(1);
      expect(json.data.items[0].email).toBe('blocked@example.com');
      expect(json.data.items[0].reason).toBe(SuppressionReason.DO_NOT_CONTACT);
    });

    it('GET /suppressions/check returns suppressed boolean status', async () => {
      SuppressionRepository.prototype.getSuppression = vi.fn().mockResolvedValue({
        email: 'bounced@example.com',
        reason: SuppressionReason.HARD_BOUNCE
      });

      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', 'ws_test');
        await next();
      });
      app.route('/suppressions', suppressionsRouter);

      const res = await app.request('/suppressions/check?email=bounced@example.com', {
        method: 'GET'
      });
      expect(res.status).toBe(200);

      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.suppressed).toBe(true);
      expect(json.data.suppression.reason).toBe(SuppressionReason.HARD_BOUNCE);
    });

    it('POST /suppressions creates suppression and returns 201', async () => {
      const mockCreated = {
        id: 'sup_created',
        workspaceId: 'ws_test',
        email: 'unsub@example.com',
        reason: SuppressionReason.UNSUBSCRIBED,
        source: 'manual'
      };

      SuppressionRepository.prototype.suppress = vi.fn().mockResolvedValue(mockCreated);

      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', 'ws_test');
        await next();
      });
      app.route('/suppressions', suppressionsRouter);

      const res = await app.request('/suppressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'unsub@example.com',
          reason: SuppressionReason.UNSUBSCRIBED
        })
      });

      expect(res.status).toBe(201);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.email).toBe('unsub@example.com');
      expect(json.data.reason).toBe(SuppressionReason.UNSUBSCRIBED);
    });

    it('DELETE /suppressions/:email unsuppresses and returns 200', async () => {
      SuppressionRepository.prototype.unsuppress = vi.fn().mockResolvedValue(true);

      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', 'ws_test');
        await next();
      });
      app.route('/suppressions', suppressionsRouter);

      const res = await app.request('/suppressions/unsub%40example.com', {
        method: 'DELETE'
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.unsuppressed).toBe(true);
    });
  });

  describe('Email Quality Endpoints Contract', () => {
    it('POST /email-quality/evaluate returns authoritative quality assessment', async () => {
      const mockQuality = {
        email: 'prospect@acme.com',
        status: EmailQualityStatus.MX_VALID,
        sendable: true,
        riskLevel: 'moderate',
        reasons: ['Domain MX valid'],
        evidence: [],
        recommendedAction: 'send',
        evaluatedAt: new Date().toISOString()
      };

      EmailQualityService.prototype.evaluateEmail = vi.fn().mockResolvedValue(mockQuality);

      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', 'ws_test');
        await next();
      });
      app.route('/email-quality', emailQualityRouter);

      const res = await app.request('/email-quality/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'prospect@acme.com' })
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.email).toBe('prospect@acme.com');
      expect(json.data.status).toBe(EmailQualityStatus.MX_VALID);
      expect(json.data.sendable).toBe(true);
    });
  });
});
