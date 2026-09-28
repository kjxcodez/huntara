/**
 * Desktop Runtime Configuration Regression Test Suite
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeApiUrl,
  CANONICAL_PRODUCTION_API_URL,
  LEGACY_PRODUCTION_API_URL,
  DEFAULT_PRODUCTION_API_URL,
  DEFAULT_DEVELOPMENT_API_URL,
  loadConfig
} from '../lib/config.js';
import { resolveWorkerApiUrl } from '../workers/worker-host.js';
import type { JobContext } from '../../shared/types/job.js';

describe('Desktop Runtime Configuration Suite', () => {
  it('verifies canonical and legacy default endpoints constants', () => {
    expect(CANONICAL_PRODUCTION_API_URL).toBe('https://api.huntara.online/api/v1');
    expect(LEGACY_PRODUCTION_API_URL).toBe('https://api.leadforge.kapiljangid.pro/api/v1');
    expect(DEFAULT_PRODUCTION_API_URL).toBe('https://api.huntara.online/api/v1');
    expect(DEFAULT_DEVELOPMENT_API_URL).toBe('http://localhost:3001/api/v1');
  });

  it('normalizes API URLs accurately across edge cases', () => {
    expect(normalizeApiUrl('http://localhost:3001')).toBe('http://localhost:3001/api/v1');
    expect(normalizeApiUrl('http://localhost:3001/')).toBe('http://localhost:3001/api/v1');
    expect(normalizeApiUrl('https://api.huntara.online/api/v1')).toBe('https://api.huntara.online/api/v1');
    expect(normalizeApiUrl('api.huntara.online/api/v1')).toBe('https://api.huntara.online/api/v1');
    expect(normalizeApiUrl('https://api.leadforge.kapiljangid.pro/api/v1')).toBe('https://api.leadforge.kapiljangid.pro/api/v1');
    expect(normalizeApiUrl('api.leadforge.kapiljangid.pro/api/v1')).toBe('https://api.leadforge.kapiljangid.pro/api/v1');
    expect(normalizeApiUrl('')).toBe('');
  });

  it('resolves worker API URL from payload._config or environment variables with fallback hierarchy', () => {
    // 1. Resolve from payload._config
    const mockCtxWithConfig: JobContext = {
      jobId: 'job_1',
      workspaceId: 'ws_1',
      payload: {
        _config: { apiUrl: 'https://custom-api.huntara.online/api/v1' }
      },
      dbPath: ':memory:',
      updateProgress: () => {},
      emitLog: () => {},
      isCancelled: () => false,
      isPaused: () => false,
      saveCheckpoint: () => {},
      getCheckpoint: () => null
    };
    expect(resolveWorkerApiUrl(mockCtxWithConfig)).toBe('https://custom-api.huntara.online/api/v1');

    // 2. Resolve from HUNTARA_API_URL precedence over LEADFORGE_API_URL and API_URL
    const origHuntara = process.env.HUNTARA_API_URL;
    const origLeadForge = process.env.LEADFORGE_API_URL;
    const origApi = process.env.API_URL;
    try {
      const mockEmptyCtx: JobContext = {
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

      // 2a. HUNTARA_API_URL takes highest precedence
      process.env.HUNTARA_API_URL = 'https://huntara-env.online/api/v1';
      process.env.LEADFORGE_API_URL = 'https://leadforge-env.online/api/v1';
      process.env.API_URL = 'http://localhost:3001/api/v1';
      expect(resolveWorkerApiUrl(mockEmptyCtx)).toBe('https://huntara-env.online/api/v1');

      // 2b. LEADFORGE_API_URL takes precedence when HUNTARA_API_URL is unset
      delete process.env.HUNTARA_API_URL;
      expect(resolveWorkerApiUrl(mockEmptyCtx)).toBe('https://leadforge-env.online/api/v1');

      // 2c. API_URL fallback when others unset
      delete process.env.LEADFORGE_API_URL;
      expect(resolveWorkerApiUrl(mockEmptyCtx)).toBe('http://localhost:3001/api/v1');

      // 3. Fails loudly when all missing
      delete process.env.API_URL;
      expect(() => resolveWorkerApiUrl(mockEmptyCtx)).toThrow(
        /HUNTARA could not determine the API server URL for this environment/
      );
    } finally {
      process.env.HUNTARA_API_URL = origHuntara;
      process.env.LEADFORGE_API_URL = origLeadForge;
      process.env.API_URL = origApi;
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
