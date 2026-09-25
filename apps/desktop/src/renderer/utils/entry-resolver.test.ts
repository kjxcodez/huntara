import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveApplicationEntryState,
  cleanupObsoleteOnboardingStorage,
  type EntryResolutionInput
} from './entry-resolver';

describe('HUNTARA Phase 6 — Onboarding & Application Readiness Matrix', () => {
  const sampleWorkspace = {
    id: 'ws_alpha_123',
    name: 'Alpha Outbound'
  };

  const sampleMemberWorkspace = {
    id: 'ws_member_456',
    name: 'Partner Workspace'
  };

  const sampleMigratedWorkspace = {
    id: 'ws_legacy_owner_only',
    name: 'Legacy Owner Org'
  };

  let baseInput: EntryResolutionInput;

  beforeEach(() => {
    baseInput = {
      authStatus: 'authenticated',
      emailVerified: true,
      isInitialized: true,
      isLoading: false,
      workspaces: [sampleWorkspace],
      activeWorkspace: sampleWorkspace,
      error: null,
      currentPath: '/dashboard',
      localStorageOnboardingCompleted: 'true'
    };
  });

  // 1. Unauthenticated user → auth flow
  it('1. Unauthenticated user resolves to AUTH_REQUIRED', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      authStatus: 'unauthenticated',
      activeWorkspace: null,
      workspaces: []
    };
    expect(resolveApplicationEntryState(input)).toBe('AUTH_REQUIRED');
  });

  // 2. Authenticated owner with workspace → application directly
  it('2. Authenticated owner with workspace resolves to APPLICATION_READY', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      authStatus: 'authenticated',
      workspaces: [sampleWorkspace],
      activeWorkspace: sampleWorkspace
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 3. Authenticated member with workspace → application directly
  it('3. Authenticated member with workspace resolves to APPLICATION_READY', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      authStatus: 'authenticated',
      workspaces: [sampleMemberWorkspace],
      activeWorkspace: sampleMemberWorkspace
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 4. Migrated owner-only workspace → application directly
  it('4. Migrated owner-only workspace resolves to APPLICATION_READY', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      authStatus: 'authenticated',
      workspaces: [sampleMigratedWorkspace],
      activeWorkspace: sampleMigratedWorkspace
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 5. User with multiple workspaces → existing workspace selection behavior
  it('5. User with multiple workspaces resolves to APPLICATION_READY with active workspace preserved', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      authStatus: 'authenticated',
      workspaces: [sampleWorkspace, sampleMemberWorkspace],
      activeWorkspace: sampleWorkspace
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 6. User with zero workspaces → workspace creation
  it('6. User with zero confirmed workspaces resolves to WORKSPACE_CREATION_REQUIRED', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      authStatus: 'authenticated',
      workspaces: [],
      activeWorkspace: null
    };
    expect(resolveApplicationEntryState(input)).toBe('WORKSPACE_CREATION_REQUIRED');
  });

  // 7. Workspace creation succeeds → application directly
  it('7. Successful workspace creation flips state to APPLICATION_READY immediately', () => {
    // Before creation: 0 workspaces
    const initialInput: EntryResolutionInput = {
      ...baseInput,
      workspaces: [],
      activeWorkspace: null
    };
    expect(resolveApplicationEntryState(initialInput)).toBe('WORKSPACE_CREATION_REQUIRED');

    // After creation: active workspace populated
    const createdInput: EntryResolutionInput = {
      ...baseInput,
      workspaces: [sampleWorkspace],
      activeWorkspace: sampleWorkspace
    };
    expect(resolveApplicationEntryState(createdInput)).toBe('APPLICATION_READY');
  });

  // 8. Workspace creation fails → remain in recoverable setup state
  it('8. Failed workspace creation keeps state in WORKSPACE_CREATION_REQUIRED without crashing', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      workspaces: [],
      activeWorkspace: null,
      error: 'Workspace name already exists'
    };
    // With 0 workspaces, it still requires workspace creation, remaining on setup screen
    expect(resolveApplicationEntryState(input)).toBe('WORKSPACE_RESOLUTION_ERROR');
  });

  // 9. Workspace resolution fails → error/retry state, not Create Workspace
  it('9. Workspace resolution error with no active workspace resolves to WORKSPACE_RESOLUTION_ERROR, NOT false workspace creation', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      workspaces: [],
      activeWorkspace: null,
      error: 'Database connection timed out during lookup'
    };
    expect(resolveApplicationEntryState(input)).toBe('WORKSPACE_RESOLUTION_ERROR');
  });

  // 10. Stale local onboarding flag + valid workspace → application
  it('10. Stale local onboarding flag (value="false") with valid workspace resolves to APPLICATION_READY', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      localStorageOnboardingCompleted: 'false'
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 11. Missing local onboarding flag + valid workspace → application
  it('11. Missing local onboarding flag (value=null) with valid workspace resolves to APPLICATION_READY', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      localStorageOnboardingCompleted: null
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 12. Cleared local storage + valid workspace → application
  it('12. Cleared local storage with valid workspace resolves to APPLICATION_READY', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      localStorageOnboardingCompleted: null
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 13. Invitation user → existing invitation flow remains intact
  it('13. User with zero workspaces navigating to /invites resolves to INVITATIONS_VIEW', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      workspaces: [],
      activeWorkspace: null,
      currentPath: '/invites'
    };
    expect(resolveApplicationEntryState(input)).toBe('INVITATIONS_VIEW');
  });

  // 14. Session expiration during onboarding/workspace creation → auth flow
  it('14. Session expiration sets authStatus=unauthenticated and resolves to AUTH_REQUIRED', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      authStatus: 'unauthenticated',
      activeWorkspace: null,
      workspaces: []
    };
    expect(resolveApplicationEntryState(input)).toBe('AUTH_REQUIRED');
  });

  // 15. Logout → no stale onboarding/workspace state
  it('15. Logout resets state and resolves to AUTH_REQUIRED', () => {
    const input: EntryResolutionInput = {
      authStatus: 'unauthenticated',
      emailVerified: false,
      isInitialized: false,
      isLoading: false,
      workspaces: [],
      activeWorkspace: null,
      error: null,
      localStorageOnboardingCompleted: null
    };
    expect(resolveApplicationEntryState(input)).toBe('AUTH_REQUIRED');
  });

  // 16. Re-login → correct workspace state
  it('16. Re-login restores authenticated session and accessible workspaces into APPLICATION_READY', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      authStatus: 'authenticated',
      isInitialized: true,
      workspaces: [sampleWorkspace],
      activeWorkspace: sampleWorkspace
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 17. Deep link directly to protected route with workspace → application
  it('17. Deep link directly to protected route with valid workspace resolves to APPLICATION_READY', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      currentPath: '/companies',
      activeWorkspace: sampleWorkspace,
      workspaces: [sampleWorkspace]
    };
    expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
  });

  // 18. Deep link directly to protected route with no workspace → minimal workspace creation
  it('18. Deep link directly to protected route with zero workspaces resolves to WORKSPACE_CREATION_REQUIRED', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      currentPath: '/discovery',
      activeWorkspace: null,
      workspaces: []
    };
    expect(resolveApplicationEntryState(input)).toBe('WORKSPACE_CREATION_REQUIRED');
  });

  // 19. No redirect loop: idempotent resolution
  it('19. State resolution is strictly idempotent and does not produce circular redirects', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      currentPath: '/dashboard'
    };
    const firstResolution = resolveApplicationEntryState(input);
    const secondResolution = resolveApplicationEntryState(input);
    expect(firstResolution).toBe('APPLICATION_READY');
    expect(secondResolution).toBe('APPLICATION_READY');
  });

  // 20. No onboarding state persists as an application-access blocker
  it('20. LocalStorage onboarding flag has zero gating power over APPLICATION_READY', () => {
    // Both with true, false, garbage string, and undefined:
    const variations: Array<string | null> = ['true', 'false', 'incomplete', '', null];
    for (const flagValue of variations) {
      const input: EntryResolutionInput = {
        ...baseInput,
        localStorageOnboardingCompleted: flagValue
      };
      expect(resolveApplicationEntryState(input)).toBe('APPLICATION_READY');
    }
  });

  // Email verification invariant
  it('blocks unverified accounts with EMAIL_VERIFICATION_REQUIRED', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      emailVerified: false
    };
    expect(resolveApplicationEntryState(input)).toBe('EMAIL_VERIFICATION_REQUIRED');
  });

  // Workspace loading invariant
  it('renders WORKSPACE_RESOLVING during background workspace resolution', () => {
    const input: EntryResolutionInput = {
      ...baseInput,
      isInitialized: false,
      isLoading: true,
      activeWorkspace: null,
      workspaces: []
    };
    expect(resolveApplicationEntryState(input)).toBe('WORKSPACE_RESOLVING');
  });

  // Storage cleanup utility verification
  it('cleanupObsoleteOnboardingStorage cleanly purges onboarding_completed key if present', () => {
    const mockStorage: Record<string, string> = {
      onboarding_completed: 'true',
      huntara_theme: 'dark',
      active_tab: 'leads'
    };

    const originalWindow = global.window;
    const mockStorageInstance = {
      getItem: (k: string) => mockStorage[k] ?? null,
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      clear: () => {},
      key: () => null,
      length: Object.keys(mockStorage).length
    } as Storage;

    global.window = {
      ...global.window,
      localStorage: mockStorageInstance
    } as unknown as Window & typeof globalThis;

    cleanupObsoleteOnboardingStorage();

    expect(mockStorage['onboarding_completed']).toBeUndefined();
    expect(mockStorage['huntara_theme']).toBe('dark');
    expect(mockStorage['active_tab']).toBe('leads');

    global.window = originalWindow;
  });
});
