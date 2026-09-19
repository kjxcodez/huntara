/**
 * Desktop Runtime Configuration Regression Test Suite
 */

import { describe, it, expect } from 'vitest';
import { normalizeApiUrl, DEFAULT_PRODUCTION_API_URL, DEFAULT_DEVELOPMENT_API_URL } from '../lib/config.js';
import { resolveWorkerApiUrl } from '../workers/worker-host.js';
import type { JobContext } from '../../shared/types/job.js';

describe('Desktop Runtime Configuration Suite', () => {
  it('verifies default endpoints constants', () => {
    expect(DEFAULT_PRODUCTION_API_URL).toBe('https://api.leadforge.kapiljangid.pro/api/v1');
    expect(DEFAULT_DEVELOPMENT_API_URL).toBe('http://localhost:3001/api/v1');
  });

  it('normalizes API URLs accurately across edge cases', () => {
    expect(normalizeApiUrl('http://localhost:3001')).toBe('http://localhost:3001/api/v1');
    expect(normalizeApiUrl('http://localhost:3001/')).toBe('http://localhost:3001/api/v1');
    expect(normalizeApiUrl('https://api.leadforge.kapiljangid.pro/api/v1')).toBe('https://api.leadforge.kapiljangid.pro/api/v1');
    expect(normalizeApiUrl('api.leadforge.kapiljangid.pro/api/v1')).toBe('https://api.leadforge.kapiljangid.pro/api/v1');
    expect(normalizeApiUrl('')).toBe('');
  });

  it('resolves worker API URL from payload._config or process.env with loud failure on absence', () => {
    // 1. Resolve from payload._config
    const mockCtxWithConfig: JobContext = {
      jobId: 'job_1',
      workspaceId: 'ws_1',
      payload: {
        _config: { apiUrl: 'https://custom-api.leadforge.io/api/v1' }
      },
      dbPath: ':memory:',
      updateProgress: () => {},
      emitLog: () => {},
      isCancelled: () => false,
      isPaused: () => false,
      saveCheckpoint: () => {},
      getCheckpoint: () => null
    };
    expect(resolveWorkerApiUrl(mockCtxWithConfig)).toBe('https://custom-api.leadforge.io/api/v1');

    // 2. Resolve from process.env fallback
    const originalEnv = process.env.API_URL;
    try {
      process.env.API_URL = 'http://localhost:3001/api/v1';
      const mockCtxWithoutConfig: JobContext = {
        jobId: 'job_2',
        workspaceId: 'ws_1',
        payload: {},
        dbPath: ':memory:',
        updateProgress: () => {},
        emitLog: () => {},
        isCancelled: () => false,
        isPaused: () => false,
        saveCheckpoint: () => {},
        getCheckpoint: () => null
      };
      expect(resolveWorkerApiUrl(mockCtxWithoutConfig)).toBe('http://localhost:3001/api/v1');

      // 3. Fails loudly when missing
      delete process.env.API_URL;
      expect(() => resolveWorkerApiUrl(mockCtxWithoutConfig)).toThrow(
        /HUNTARA could not determine the API server URL for this environment/
      );
    } finally {
      process.env.API_URL = originalEnv;
    }
  });

  it('enforces worker JobContext dbPath and payload secrets contract', () => {
    const mockWorkerCtx: JobContext = {
      jobId: 'job_4',
      workspaceId: 'ws_test_123',
      payload: {
        _secrets: {
          sessionToken: 'test_session_token_xyz',
          linkedin_li_at: 'test_li_at_cookie_abc'
        }
      },
      dbPath: 'C:\\Users\\Mock\\AppData\\Roaming\\LeadForge\\workspaces\\leadforge_ws_test_123.db',
      updateProgress: () => {},
      emitLog: () => {},
      isCancelled: () => false,
      isPaused: () => false,
      saveCheckpoint: () => {},
      getCheckpoint: () => null
    };

    expect(mockWorkerCtx.dbPath).toBe('C:\\Users\\Mock\\AppData\\Roaming\\LeadForge\\workspaces\\leadforge_ws_test_123.db');
    expect(mockWorkerCtx.payload._secrets?.sessionToken).toBe('test_session_token_xyz');
    expect(mockWorkerCtx.payload._secrets?.linkedin_li_at).toBe('test_li_at_cookie_abc');
  });
});
