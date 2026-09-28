/**
 * Phase 8 LeadForge -> HUNTARA Storage Migration & Compatibility Test Suite
 *
 * Validates:
 * - CASE A: Fresh HUNTARA installation
 * - CASE B: Simulated legacy LeadForge installation
 * - CASE C: Partially migrated installation (ensuring no overwrite of newer HUNTARA data)
 * - CASE D: Already migrated HUNTARA installation (idempotency, marker preservation)
 * - CASE E: Legacy workspace database fallback resolution
 * - CASE F: Protocol and origin compatibility (leadforge://, huntara://, app://)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeStorageAndMigrate } from './storage-migration';

describe('Phase 8 — Storage Migration & Legacy Compatibility', () => {
  let tempSandbox: string;

  beforeEach(() => {
    tempSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'huntara-phase8-migration-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempSandbox, { recursive: true, force: true });
    } catch {}
  });

  describe('CASE A: Fresh HUNTARA installation', () => {
    it('initializes canonical HUNTARA directory structure without error when no legacy directory exists', () => {
      const mockAppData = path.join(tempSandbox, 'fresh-appdata');
      fs.mkdirSync(mockAppData, { recursive: true });

      const result = initializeStorageAndMigrate(mockAppData);

      const canonicalDir = path.join(mockAppData, 'HUNTARA');
      expect(result.canonicalUserData).toBe(canonicalDir);
      expect(result.isMigrated).toBe(false);
      expect(result.legacySourcePath).toBeNull();
      expect(result.migratedDatabases).toEqual([]);

      // Verify canonical directories exist
      expect(fs.existsSync(canonicalDir)).toBe(true);
      expect(fs.existsSync(path.join(canonicalDir, 'workspaces'))).toBe(true);
      expect(fs.existsSync(path.join(canonicalDir, 'logs'))).toBe(true);

      // Verify marker file exists
      const markerPath = path.join(canonicalDir, '.huntara-migrated.json');
      expect(fs.existsSync(markerPath)).toBe(true);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      expect(marker.canonicalPath).toBe(canonicalDir);
      expect(marker.sourcePath).toBeNull();
    });
  });

  describe('CASE B: Simulated legacy LeadForge installation', () => {
    it('seamlessly migrates legacy LeadForge data, renames global and workspace databases, and records marker', () => {
      const mockAppData = path.join(tempSandbox, 'legacy-appdata');
      const legacyDir = path.join(mockAppData, '@leadforge', 'desktop');
      fs.mkdirSync(path.join(legacyDir, 'workspaces'), { recursive: true });
      fs.mkdirSync(path.join(legacyDir, 'logs'), { recursive: true });

      // Create legacy artifacts
      fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ activeWorkspaceId: 'ws_alpha', theme: 'dark' }), 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'session.dat'), 'mock-legacy-session-data', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'leadforge.db'), 'global-sqlite-data', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'leadforge.db-wal'), 'global-sqlite-wal', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'workspaces', 'leadforge_ws_alpha.db'), 'workspace-alpha-sqlite-data', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'workspaces', 'leadforge_ws_alpha.db-wal'), 'workspace-alpha-sqlite-wal', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'logs', 'app.log'), 'legacy-log-entry\n', 'utf8');

      const result = initializeStorageAndMigrate(mockAppData);

      const canonicalDir = path.join(mockAppData, 'HUNTARA');
      expect(result.canonicalUserData).toBe(canonicalDir);
      expect(result.isMigrated).toBe(true);
      expect(result.legacySourcePath).toBe(legacyDir);
      expect(result.migratedDatabases).toContain('huntara.db');
      expect(result.migratedDatabases).toContain('huntara_ws_alpha.db');

      // Verify root config and session migrated
      expect(fs.existsSync(path.join(canonicalDir, 'config.json'))).toBe(true);
      expect(fs.readFileSync(path.join(canonicalDir, 'config.json'), 'utf8')).toContain('ws_alpha');
      expect(fs.readFileSync(path.join(canonicalDir, 'session.dat'), 'utf8')).toBe('mock-legacy-session-data');

      // Verify global db migration (leadforge.db -> huntara.db + wal)
      expect(fs.existsSync(path.join(canonicalDir, 'huntara.db'))).toBe(true);
      expect(fs.readFileSync(path.join(canonicalDir, 'huntara.db'), 'utf8')).toBe('global-sqlite-data');
      expect(fs.existsSync(path.join(canonicalDir, 'huntara.db-wal'))).toBe(true);
      expect(fs.readFileSync(path.join(canonicalDir, 'huntara.db-wal'), 'utf8')).toBe('global-sqlite-wal');

      // Verify workspace db migration (leadforge_ws_alpha.db -> huntara_ws_alpha.db + wal)
      expect(fs.existsSync(path.join(canonicalDir, 'workspaces', 'huntara_ws_alpha.db'))).toBe(true);
      expect(fs.readFileSync(path.join(canonicalDir, 'workspaces', 'huntara_ws_alpha.db'), 'utf8')).toBe('workspace-alpha-sqlite-data');
      expect(fs.existsSync(path.join(canonicalDir, 'workspaces', 'huntara_ws_alpha.db-wal'))).toBe(true);

      // Verify source files are NOT deleted prematurely
      expect(fs.existsSync(path.join(legacyDir, 'config.json'))).toBe(true);
      expect(fs.existsSync(path.join(legacyDir, 'leadforge.db'))).toBe(true);
      expect(fs.existsSync(path.join(legacyDir, 'workspaces', 'leadforge_ws_alpha.db'))).toBe(true);

      // Verify marker file
      const markerPath = path.join(canonicalDir, '.huntara-migrated.json');
      expect(fs.existsSync(markerPath)).toBe(true);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      expect(marker.sourcePath).toBe(legacyDir);
      expect(marker.migratedDatabases).toContain('huntara.db');
      expect(marker.migratedDatabases).toContain('huntara_ws_alpha.db');
    });
  });

  describe('CASE C: Partially migrated installation', () => {
    it('does not overwrite newer canonical HUNTARA data when legacy source files exist', () => {
      const mockAppData = path.join(tempSandbox, 'partial-appdata');
      const canonicalDir = path.join(mockAppData, 'HUNTARA');
      const legacyDir = path.join(mockAppData, 'LeadForge');

      fs.mkdirSync(path.join(canonicalDir, 'workspaces'), { recursive: true });
      fs.mkdirSync(path.join(legacyDir, 'workspaces'), { recursive: true });

      // Newer canonical data
      fs.writeFileSync(path.join(canonicalDir, 'workspaces', 'huntara_ws_beta.db'), 'NEW-CANONICAL-DATA', 'utf8');
      fs.writeFileSync(path.join(canonicalDir, 'config.json'), JSON.stringify({ activeWorkspaceId: 'ws_newer' }), 'utf8');

      // Older legacy data
      fs.writeFileSync(path.join(legacyDir, 'workspaces', 'leadforge_ws_beta.db'), 'OLD-LEGACY-DATA', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'workspaces', 'leadforge_ws_gamma.db'), 'GAMMA-DATA', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ activeWorkspaceId: 'ws_older' }), 'utf8');

      const result = initializeStorageAndMigrate(mockAppData);

      // Newer data in canonical must be preserved
      expect(fs.readFileSync(path.join(canonicalDir, 'workspaces', 'huntara_ws_beta.db'), 'utf8')).toBe('NEW-CANONICAL-DATA');
      expect(JSON.parse(fs.readFileSync(path.join(canonicalDir, 'config.json'), 'utf8')).activeWorkspaceId).toBe('ws_newer');

      // Missing item (ws_gamma) should be migrated
      expect(fs.existsSync(path.join(canonicalDir, 'workspaces', 'huntara_ws_gamma.db'))).toBe(true);
      expect(fs.readFileSync(path.join(canonicalDir, 'workspaces', 'huntara_ws_gamma.db'), 'utf8')).toBe('GAMMA-DATA');
    });
  });

  describe('CASE D: Already migrated HUNTARA installation', () => {
    it('is completely idempotent and returns immediately without modifying files when marker exists', () => {
      const mockAppData = path.join(tempSandbox, 'already-migrated-appdata');
      const canonicalDir = path.join(mockAppData, 'HUNTARA');
      fs.mkdirSync(canonicalDir, { recursive: true });

      const markerPath = path.join(canonicalDir, '.huntara-migrated.json');
      fs.writeFileSync(
        markerPath,
        JSON.stringify({
          migratedAt: '2026-09-01T00:00:00.000Z',
          canonicalPath: canonicalDir,
          sourcePath: null,
          migratedDatabases: []
        }),
        'utf8'
      );

      const result = initializeStorageAndMigrate(mockAppData);

      expect(result.isMigrated).toBe(true);
      expect(result.legacySourcePath).toBeNull();
      expect(result.migratedDatabases).toEqual([]);

      // Marker untouched
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      expect(marker.migratedAt).toBe('2026-09-01T00:00:00.000Z');
    });
  });

  describe('CASE E: Candidate discovery order precedence', () => {
    it('prioritizes @leadforge/desktop if present over other legacy candidates', () => {
      const mockAppData = path.join(tempSandbox, 'priority-appdata');
      const scopedDir = path.join(mockAppData, '@leadforge', 'desktop');
      const simpleDir = path.join(mockAppData, 'LeadForge');

      fs.mkdirSync(scopedDir, { recursive: true });
      fs.mkdirSync(simpleDir, { recursive: true });

      fs.writeFileSync(path.join(scopedDir, 'config.json'), JSON.stringify({ priority: 'scoped' }), 'utf8');
      fs.writeFileSync(path.join(simpleDir, 'config.json'), JSON.stringify({ priority: 'simple' }), 'utf8');

      const result = initializeStorageAndMigrate(mockAppData);

      expect(result.legacySourcePath).toBe(scopedDir);
      const canonicalConfig = JSON.parse(fs.readFileSync(path.join(mockAppData, 'HUNTARA', 'config.json'), 'utf8'));
      expect(canonicalConfig.priority).toBe('scoped');
    });
  });

  describe('CASE F: Protocol & origin compatibility boundaries', () => {
    it('accepts and parses both huntara:// and legacy leadforge:// deep links accurately', () => {
      const canonicalLink = 'huntara://auth/callback?token=canonical_tok_123&workspaceId=ws_1';
      const legacyLink = 'leadforge://auth/callback?token=legacy_tok_456&workspaceId=ws_2';

      const parsedCanonical = new URL(canonicalLink);
      expect(parsedCanonical.protocol).toBe('huntara:');
      expect(parsedCanonical.hostname).toBe('auth');
      expect(parsedCanonical.searchParams.get('token')).toBe('canonical_tok_123');

      const parsedLegacy = new URL(legacyLink);
      expect(parsedLegacy.protocol).toBe('leadforge:');
      expect(parsedLegacy.hostname).toBe('auth');
      expect(parsedLegacy.searchParams.get('token')).toBe('legacy_tok_456');
    });

    it('distinguishes supported application schemes from unsupported external schemes', () => {
      const supportedSchemes = ['huntara:', 'leadforge:', 'app:'];
      const isSupportedScheme = (urlStr: string) => {
        try {
          const parsed = new URL(urlStr);
          return supportedSchemes.includes(parsed.protocol);
        } catch {
          return false;
        }
      };

      expect(isSupportedScheme('huntara://app')).toBe(true);
      expect(isSupportedScheme('leadforge://auth/callback')).toBe(true);
      expect(isSupportedScheme('app://localhost')).toBe(true);
      expect(isSupportedScheme('https://example.com')).toBe(false);
      expect(isSupportedScheme('ftp://files.example.com')).toBe(false);
      expect(isSupportedScheme('malformed_uri')).toBe(false);
    });
  });
});
