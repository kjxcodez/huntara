import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { corsConfig, resolveCorsOrigin } from '../../config/index.js';

describe('CORS Origin & Web Security Qualification (HUNTARA-SEC-003)', () => {
  let app: OpenAPIHono;

  beforeEach(() => {
    app = new OpenAPIHono();
    app.use('*', cors(corsConfig));
    app.get('/test', (c) => c.json({ ok: true }));
  });

  describe('resolveCorsOrigin', () => {
    it('allows localhost and loopback origins in development/test', () => {
      expect(resolveCorsOrigin('http://localhost:5173')).toBe('http://localhost:5173');
      expect(resolveCorsOrigin('http://127.0.0.1:48113')).toBe('http://127.0.0.1:48113');
      expect(resolveCorsOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('allows desktop custom protocol origins', () => {
      expect(resolveCorsOrigin('leadforge://desktop')).toBe('leadforge://desktop');
      expect(resolveCorsOrigin('huntara://app')).toBe('huntara://app');
    });

    it('rejects unauthorized external web origins', () => {
      expect(resolveCorsOrigin('https://attacker.com')).toBeNull();
      expect(resolveCorsOrigin('http://evil-site.org:8080')).toBeNull();
      expect(resolveCorsOrigin('https://phishing-huntara.com')).toBeNull();
    });

    it('handles empty or undefined origins safely', () => {
      expect(resolveCorsOrigin('')).toBeNull();
      expect(resolveCorsOrigin(undefined)).toBeNull();
    });
  });

  describe('CORS HTTP Middleware Behavior', () => {
    it('sets Access-Control-Allow-Origin for permitted local origins', async () => {
      const res = await app.request('/test', {
        headers: { Origin: 'http://localhost:5173' }
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('does NOT set Access-Control-Allow-Origin for unauthorized external origins', async () => {
      const res = await app.request('/test', {
        headers: { Origin: 'https://malicious-site.com' }
      });
      expect(res.status).toBe(200);
      // Crucial: origin must NOT be reflected
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('handles preflight OPTIONS request correctly with allowed headers', async () => {
      const res = await app.request('/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, x-workspace-id'
        }
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      const allowHeaders = res.headers.get('access-control-allow-headers');
      expect(allowHeaders).toContain('x-workspace-id');
    });
  });
});
