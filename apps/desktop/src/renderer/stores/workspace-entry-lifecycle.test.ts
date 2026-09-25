import { describe, it, expect } from 'vitest';
import {
  initialState as initialWorkspaceState,
  workspaceReducer,
  type WorkspaceState
} from './workspace-store';
import {
  resolveApplicationEntryState,
  type EntryResolutionInput
} from '../utils/entry-resolver';
import type { Workspace } from '@huntara/schema';

describe('HUNTARA Phase 6 — Integrated Workspace & Entry Lifecycle Suite', () => {
  const mockOwnerWorkspace: Workspace = {
    id: 'ws_owner_100',
    name: 'Growth Engine',
    slug: 'growth-engine',
    ownerId: 'usr_alice_1',
    members: [{ userId: 'usr_alice_1', role: 'OWNER', status: 'ACTIVE', email: 'alice@growth.com' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as unknown as Workspace;

  const mockMemberWorkspace: Workspace = {
    id: 'ws_member_200',
    name: 'Partner Network',
    slug: 'partner-network',
    ownerId: 'usr_bob_2',
    members: [{ userId: 'usr_alice_1', role: 'MEMBER', status: 'ACTIVE', email: 'alice@growth.com' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as unknown as Workspace;

  const mockMigratedWorkspace: Workspace = {
    id: 'ws_migrated_300',
    name: 'Legacy LeadForge Workspace',
    slug: 'legacy-leadforge-workspace',
    ownerId: 'usr_alice_1',
    members: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as unknown as Workspace;

  it('LIFECYCLE A: Brand new user with zero workspaces creates their first workspace', () => {
    // Step 1: User authenticates with 0 workspaces
    let wsState: WorkspaceState = { ...initialWorkspaceState };
    wsState = workspaceReducer(wsState, { type: 'WORKSPACES_LOADING' });

    let entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error
    });
    // In-flight loading renders resolving spinner
    expect(entry).toBe('WORKSPACE_RESOLVING');

    // Step 2: Server returns 0 workspaces
    wsState = workspaceReducer(wsState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [], active: null }
    });
    entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error
    });
    expect(entry).toBe('WORKSPACE_CREATION_REQUIRED');

    // Step 3: User enters workspace name and creates it
    const createdWorkspace: Workspace = {
      ...mockOwnerWorkspace,
      id: 'ws_new_400',
      name: 'Acme Outbound'
    };
    wsState = workspaceReducer(wsState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [createdWorkspace], active: createdWorkspace }
    });
    entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error
    });
    // Immediately enters the application without any wizard steps or localStorage flag
    expect(entry).toBe('APPLICATION_READY');
    expect(wsState.activeWorkspace?.name).toBe('Acme Outbound');
  });

  it('LIFECYCLE B: Returning user on a fresh machine with zero localStorage enters directly', () => {
    // Authenticated, 1 workspace returned by server, local storage is completely empty
    const wsState = workspaceReducer(initialWorkspaceState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [mockOwnerWorkspace], active: mockOwnerWorkspace }
    });

    const entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error,
      localStorageOnboardingCompleted: null
    });

    expect(entry).toBe('APPLICATION_READY');
  });

  it('LIFECYCLE C: Returning user with conflicting/stale onboarding_completed="false" enters directly', () => {
    const wsState = workspaceReducer(initialWorkspaceState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [mockOwnerWorkspace], active: mockOwnerWorkspace }
    });

    const entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error,
      localStorageOnboardingCompleted: 'false'
    });

    expect(entry).toBe('APPLICATION_READY');
  });

  it('LIFECYCLE D: Invited user with zero personal workspaces views invites and joins workspace', () => {
    // Step 1: User has 0 owned workspaces, but was invited to a workspace
    let wsState = workspaceReducer(initialWorkspaceState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [], active: null }
    });

    // If navigating to /invites, they can view the invitations screen
    let entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error,
      currentPath: '/invites'
    });
    expect(entry).toBe('INVITATIONS_VIEW');

    // Step 2: User accepts invitation -> membership becomes active
    wsState = workspaceReducer(wsState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [mockMemberWorkspace], active: mockMemberWorkspace }
    });

    entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error,
      currentPath: '/dashboard'
    });
    expect(entry).toBe('APPLICATION_READY');
    expect(wsState.activeWorkspace?.id).toBe(mockMemberWorkspace.id);
  });

  it('LIFECYCLE E: Resolution network failure renders recoverable error state, not false workspace creation', () => {
    let wsState = workspaceReducer(initialWorkspaceState, { type: 'WORKSPACES_LOADING' });

    wsState = workspaceReducer(wsState, {
      type: 'WORKSPACES_ERROR',
      payload: 'ETIMEDOUT: Failed to fetch workspaces from server'
    });

    const entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error
    });

    expect(entry).toBe('WORKSPACE_RESOLUTION_ERROR');
    expect(wsState.error).toContain('ETIMEDOUT');

    // Retry succeeds:
    const recoveredState = workspaceReducer(wsState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [mockOwnerWorkspace], active: mockOwnerWorkspace }
    });
    const recoveredEntry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: recoveredState.isInitialized,
      isLoading: recoveredState.isLoading,
      workspaces: recoveredState.workspaces,
      activeWorkspace: recoveredState.activeWorkspace,
      error: recoveredState.error
    });
    expect(recoveredEntry).toBe('APPLICATION_READY');
  });

  it('LIFECYCLE F: Multi-workspace user resolves active workspace and can switch between workspaces', () => {
    let wsState = workspaceReducer(initialWorkspaceState, {
      type: 'WORKSPACES_LOADED',
      payload: {
        workspaces: [mockOwnerWorkspace, mockMemberWorkspace],
        active: mockOwnerWorkspace
      }
    });

    let entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error
    });
    expect(entry).toBe('APPLICATION_READY');
    expect(wsState.activeWorkspace?.id).toBe(mockOwnerWorkspace.id);

    // Switch to member workspace
    wsState = workspaceReducer(wsState, {
      type: 'WORKSPACE_SWITCHED',
      payload: mockMemberWorkspace
    });

    entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error
    });
    expect(entry).toBe('APPLICATION_READY');
    expect(wsState.activeWorkspace?.id).toBe(mockMemberWorkspace.id);
  });

  it('LIFECYCLE G: Migrated LeadForge owner-only workspace enters application cleanly', () => {
    const wsState = workspaceReducer(initialWorkspaceState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [mockMigratedWorkspace], active: mockMigratedWorkspace }
    });

    const entry = resolveApplicationEntryState({
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error
    });

    expect(entry).toBe('APPLICATION_READY');
    expect(wsState.activeWorkspace?.name).toBe('Legacy LeadForge Workspace');
  });

  it('LIFECYCLE H: Logout completely resets workspace state to uninitialized', () => {
    let wsState = workspaceReducer(initialWorkspaceState, {
      type: 'WORKSPACES_LOADED',
      payload: { workspaces: [mockOwnerWorkspace], active: mockOwnerWorkspace }
    });

    // User logs out
    wsState = workspaceReducer(wsState, { type: 'WORKSPACES_RESET' });

    const entry = resolveApplicationEntryState({
      authStatus: 'unauthenticated',
      emailVerified: false,
      isInitialized: wsState.isInitialized,
      isLoading: wsState.isLoading,
      workspaces: wsState.workspaces,
      activeWorkspace: wsState.activeWorkspace,
      error: wsState.error
    });

    expect(entry).toBe('AUTH_REQUIRED');
    expect(wsState.isInitialized).toBe(false);
    expect(wsState.activeWorkspace).toBeNull();
    expect(wsState.workspaces).toHaveLength(0);
  });
});
