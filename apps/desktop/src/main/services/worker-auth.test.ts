/**
 * Worker Authentication Boundary Contract Test Suite
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SdkClient } from '@huntara/sdk';

describe('Worker Authentication Boundary Contract Tests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('constructs Authorization Bearer and x-workspace-id headers correctly', async () => {
    const mockToken = 'mock_session_token_12345';
    const mockWorkspaceId = 'ws_test_99999';

    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return new Response(JSON.stringify({ success: true, data: { messageId: 'msg_test_001' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    const sdk = new SdkClient({
      baseUrl: 'http://localhost:3001/api/v1',
      token: mockToken,
      headers: {
        'x-workspace-id': mockWorkspaceId
      }
    });

    await sdk.outreach.sendEmail({
      accountId: 'acc_123',
      to: 'test@example.com',
      subject: 'Test Subject',
      html: '<p>Test</p>'
    });

    expect(capturedHeaders['Authorization']).toBe(`Bearer ${mockToken}`);
    expect(capturedHeaders['x-workspace-id']).toBe(mockWorkspaceId);
  });

  it('handles 401 unauthorized errors with structured code and message', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized access. Please log in.' }
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const unauthSdk = new SdkClient({
      baseUrl: 'http://localhost:3001/api/v1',
      token: ''
    });

    await expect(
      unauthSdk.outreach.sendEmail({
        accountId: 'acc_123',
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>'
      })
    ).rejects.toMatchObject({
      status: 401,
      message: 'Unauthorized access. Please log in.'
    });
  });
});
