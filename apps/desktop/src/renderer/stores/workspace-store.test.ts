import { describe, it, expect } from 'vitest';
import {
  initialState,
  workspaceReducer,
  type WorkspaceState,
  type WorkspaceAction
} from './workspace-store';
import type { Workspace } from '@huntara/schema';

describe('HUNTARA — WorkspaceStore Initialization & State Gating', () => {
  const mockWorkspace: Workspace = {
    id: 'ws_test_123',
    name: 'Acme Growth',
    slug: 'acme-growth',
    ownerId: 'usr_owner_1',
    members: [{ userId: 'usr_owner_1', role: 'OWNER', status: 'ACTIVE' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as unknown as Workspace;

  it('1. initialState guarantees isInitialized is false before any resolution', () => {
    expect(initialState.isInitialized).toBe(false);
    expect(initialState.isLoading).toBe(false);
    expect(initialState.activeWorkspace).toBeNull();
    expect(initialState.workspaces).toEqual([]);
    expect(initialState.error).toBeNull();
  });

  it('2. WORKSPACES_LOADING preserves isInitialized = false to prevent premature empty screen rendering', () => {
    const next = workspaceReducer(initialState, { type: 'WORKSPACES_LOADING' });

    expect(next.isLoading).toBe(true);
    expect(next.isInitialized).toBe(false);
    expect(next.activeWorkspace).toBeNull();
    expect(next.error).toBeNull();
  });

  it('3. WORKSPACES_LOADED marks isInitialized = true and sets active workspace when available', () => {
    const loadingState: WorkspaceState = {
      ...initialState,
      isLoading: true
    };

    const next = workspaceReducer(loadingState, {
      type: 'WORKSPACES_LOADED',
      payload: {
        workspaces: [mockWorkspace],
        active: mockWorkspace
      }
    });

    expect(next.isLoading).toBe(false);
    expect(next.isInitialized).toBe(true);
    expect(next.activeWorkspace).toEqual(mockWorkspace);
    expect(next.workspaces).toHaveLength(1);
    expect(next.error).toBeNull();
  });

  it('4. WORKSPACES_LOADED with 0 workspaces correctly resolves as isInitialized = true and active = null', () => {
    const next = workspaceReducer(initialState, {
      type: 'WORKSPACES_LOADED',
      payload: {
        workspaces: [],
        active: null
      }
    });

    expect(next.isLoading).toBe(false);
    expect(next.isInitialized).toBe(true);
    expect(next.activeWorkspace).toBeNull();
    expect(next.workspaces).toHaveLength(0);
  });

  it('5. WORKSPACES_ERROR marks isInitialized = true with error string', () => {
    const next = workspaceReducer(initialState, {
      type: 'WORKSPACES_ERROR',
      payload: 'Network timeout loading workspaces'
    });

    expect(next.isLoading).toBe(false);
    expect(next.isInitialized).toBe(true);
    expect(next.error).toBe('Network timeout loading workspaces');
  });

  it('6. WORKSPACE_SWITCHED updates activeWorkspace while retaining initialized state', () => {
    const populatedState: WorkspaceState = {
      workspaces: [mockWorkspace],
      activeWorkspace: null,
      isLoading: false,
      isInitialized: true,
      error: null
    };

    const next = workspaceReducer(populatedState, {
      type: 'WORKSPACE_SWITCHED',
      payload: mockWorkspace
    });

    expect(next.activeWorkspace).toEqual(mockWorkspace);
    expect(next.isInitialized).toBe(true);
  });

  it('7. WORKSPACES_RESET restores uninitialized initialState on logout', () => {
    const populatedState: WorkspaceState = {
      workspaces: [mockWorkspace],
      activeWorkspace: mockWorkspace,
      isLoading: false,
      isInitialized: true,
      error: null
    };

    const next = workspaceReducer(populatedState, { type: 'WORKSPACES_RESET' });

    expect(next).toEqual(initialState);
    expect(next.isInitialized).toBe(false);
  });
});
