export type ApplicationEntryState =
  | 'AUTH_REQUIRED'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'WORKSPACE_RESOLVING'
  | 'WORKSPACE_RESOLUTION_ERROR'
  | 'WORKSPACE_CREATION_REQUIRED'
  | 'INVITATIONS_VIEW'
  | 'APPLICATION_READY';

export interface EntryResolutionInput {
  authStatus: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  emailVerified?: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  workspaces: Array<{ id: string; name: string }>;
  activeWorkspace: { id: string; name: string } | null;
  error: string | null;
  currentPath?: string;
  /**
   * Client-side storage flags for auditing purposes.
   * Under HUNTARA Phase 6 architecture, local flags MUST NOT gate application readiness.
   */
  localStorageOnboardingCompleted?: string | null;
}

/**
 * resolveApplicationEntryState determines the authoritative application readiness
 * based strictly on authentication and server-resolved workspace state.
 *
 * Invariants:
 * 1. An unauthenticated session ALWAYS requires authentication.
 * 2. Unverified email sessions ALWAYS require email verification.
 * 3. While auth or workspace resolution is in-flight, state is RESOLVING (never false workspace creation).
 * 4. Workspace resolution errors render an explicit error state (never false workspace creation).
 * 5. If confirmed authenticated with zero workspaces, routes to minimal workspace creation
 *    (or allows viewing invitations if currently navigating to /invites).
 * 6. If confirmed authenticated with at least one accessible workspace, the user is immediately
 *    APPLICATION_READY regardless of any missing, stale, or false client localStorage flags.
 */
export function resolveApplicationEntryState(input: EntryResolutionInput): ApplicationEntryState {
  if (input.authStatus === 'unauthenticated') {
    return 'AUTH_REQUIRED';
  }

  if (input.authStatus === 'idle' || input.authStatus === 'loading') {
    return 'WORKSPACE_RESOLVING';
  }

  if (input.authStatus === 'authenticated' && input.emailVerified === false) {
    return 'EMAIL_VERIFICATION_REQUIRED';
  }

  // If there's an error during workspace resolution and no active workspace is available,
  // do NOT fall through to Create Workspace — present the recoverable error.
  if (input.error && !input.activeWorkspace) {
    return 'WORKSPACE_RESOLUTION_ERROR';
  }

  // Still resolving workspaces from API / cache
  if (!input.isInitialized || (input.isLoading && !input.activeWorkspace)) {
    return 'WORKSPACE_RESOLVING';
  }

  // Confirmed zero accessible workspaces
  if (!input.activeWorkspace && input.workspaces.length === 0) {
    if (input.currentPath === '/invites') {
      return 'INVITATIONS_VIEW';
    }
    return 'WORKSPACE_CREATION_REQUIRED';
  }

  // User has accessible workspace(s) — application is ready
  return 'APPLICATION_READY';
}

/**
 * Helper to purge obsolete client-only onboarding keys without disturbing
 * active workspace settings or general application preferences.
 */
export function cleanupObsoleteOnboardingStorage(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (window.localStorage.getItem('onboarding_completed') !== null) {
        window.localStorage.removeItem('onboarding_completed');
      }
    }
  } catch (err) {
    // Storage access failures (e.g. privacy mode) must never crash entry
    console.warn('[Storage] Failed to cleanup obsolete onboarding key:', err);
  }
}
