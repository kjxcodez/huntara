import { describe, it, expect } from 'vitest';
import { isValidWorkspaceId, getDatabase } from './connection';

describe('Desktop Database Path Traversal Security (HUNTARA-SEC-005)', () => {
  it('validates canonical and legitimate workspace ID formats', () => {
    expect(isValidWorkspaceId('ws_12345')).toBe(true);
    expect(isValidWorkspaceId('ws-alpha-tenant')).toBe(true);
    expect(isValidWorkspaceId('65df9a4b2a8f9c001e4a5b6c')).toBe(true);
    expect(isValidWorkspaceId('workspace_test_2026')).toBe(true);
  });

  it('rejects directory traversal attempts in workspace IDs', () => {
    expect(isValidWorkspaceId('../evil')).toBe(false);
    expect(isValidWorkspaceId('../../etc/passwd')).toBe(false);
    expect(isValidWorkspaceId('..\\..\\windows\\system32')).toBe(false);
    expect(isValidWorkspaceId('ws/subpath')).toBe(false);
    expect(isValidWorkspaceId('ws\\subpath')).toBe(false);
    expect(isValidWorkspaceId('ws..name')).toBe(false);
  });

  it('rejects empty, null, or malformed workspace IDs', () => {
    expect(isValidWorkspaceId('')).toBe(false);
    expect(isValidWorkspaceId(' ')).toBe(false);
    expect(isValidWorkspaceId(null as any)).toBe(false);
    expect(isValidWorkspaceId(undefined as any)).toBe(false);
    expect(isValidWorkspaceId('ws*wildcard')).toBe(false);
    expect(isValidWorkspaceId('ws;drop table;')).toBe(false);
  });

  it('throws an error when getDatabase is called with a directory traversal payload', () => {
    expect(() => getDatabase('../../escaping-workspaces')).toThrow(
      /Invalid workspaceId: directory traversal/
    );
  });
});
