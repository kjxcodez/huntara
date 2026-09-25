import React, { useEffect, lazy } from 'react';
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ProtectedRoute, GuestRoute } from './guards';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { BlankLayout } from '../layouts/BlankLayout';
import { useAuth } from '../hooks/useAuth';
import { useAuthStore } from '../stores/auth-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import { queryClient } from '../providers/AppProviders';

import { SplashScreen } from '../screens/SplashScreen';

// Lazy load screens
const LoginScreen = lazy(() =>
  import('../screens/LoginScreen').then((m) => ({ default: m.LoginScreen }))
);
const RegisterScreen = lazy(() =>
  import('../screens/RegisterScreen').then((m) => ({ default: m.RegisterScreen }))
);
const ForgotPasswordScreen = lazy(() =>
  import('../screens/ForgotPasswordScreen').then((m) => ({ default: m.ForgotPasswordScreen }))
);
const VerifyEmailScreen = lazy(() =>
  import('../screens/VerifyEmailScreen').then((m) => ({ default: m.VerifyEmailScreen }))
);
const SessionExpiredScreen = lazy(() =>
  import('../screens/SessionExpiredScreen').then((m) => ({ default: m.SessionExpiredScreen }))
);

const WorkspaceSettingsScreen = lazy(() => import('../screens/WorkspaceSettingsScreen'));
const WorkspaceInvitesScreen = lazy(() => import('../screens/WorkspaceInvitesScreen'));
const DashboardScreen = lazy(() => import('../screens/DashboardScreen'));
const CompaniesScreen = lazy(() => import('../screens/CompaniesScreen'));
const ContactsScreen = lazy(() => import('../screens/ContactsScreen'));
const DiscoveryScreen = lazy(() => import('../screens/DiscoveryScreen'));
const CampaignsScreen = lazy(() => import('../screens/CampaignsScreen'));
const EmailLogsScreen = lazy(() => import('../screens/EmailLogsScreen'));
const MediaLibraryScreen = lazy(() => import('../screens/MediaLibraryScreen'));
const AutomationScreen = lazy(() => import('../screens/AutomationScreen'));
const OperationsCenterScreen = lazy(() =>
  import('../screens/OperationsCenterScreen').then((m) => ({ default: m.OperationsCenterScreen }))
);
const ReportsScreen = lazy(() => import('../screens/ReportsScreen'));
const AudiencesScreen = lazy(() => import('../screens/AudiencesScreen'));
const PreferencesScreen = lazy(() => import('../screens/PreferencesScreen'));

// ---------------------------------------------------------------------------
// Session Bootstrap
// ---------------------------------------------------------------------------

/**
 * SessionBootstrap runs the session restore logic once on app startup.
 * It lives here rather than in main.tsx so it has access to all providers.
 */
function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const { restoreSession, isIdle } = useAuth();
  const { setLoggedOut } = useAuthStore();
  const workspaceStore = useWorkspaceStore();

  useEffect(() => {
    if (isIdle) {
      restoreSession();
    }
  }, [isIdle, restoreSession]);

  useEffect(() => {
    const unsubscribe = window.ipc.on('auth:unauthorized', () => {
      setLoggedOut();
      workspaceStore.reset();
      queryClient.clear();
      window.location.hash = '#/session-expired';
    });

    return () => {
      unsubscribe();
    };
  }, [setLoggedOut, workspaceStore]);

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Placeholder screens for CRM routes (Phase 2+)
// ---------------------------------------------------------------------------

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 h-full text-muted-foreground">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs mt-1 opacity-60">Coming in Phase 2</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Router definition
// ---------------------------------------------------------------------------

/**
 * We use HashRouter (createHashRouter) because Electron serves files from disk.
 * BrowserRouter requires a server to handle history-based navigation.
 */
const router = createHashRouter([
  // ── Splash / session idle ────────────────────────────────────────────────
  {
    path: '/splash',
    element: (
      <BlankLayout>
        <SplashScreen />
      </BlankLayout>
    )
  },

  // ── Onboarding Experience (redirects to authoritative app entry) ───────────
  {
    path: '/onboarding',
    element: <Navigate to="/" replace />
  },

  // ── Session expired ──────────────────────────────────────────────────────
  {
    path: '/session-expired',
    element: (
      <BlankLayout>
        <SessionExpiredScreen />
      </BlankLayout>
    )
  },

  // ── Auth routes (guests only) ────────────────────────────────────────────
  {
    element: <GuestRoute />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: '/auth/login', element: <LoginScreen /> },
          { path: '/auth/register', element: <RegisterScreen /> },
          { path: '/auth/forgot-password', element: <ForgotPasswordScreen /> }
        ]
      }
    ]
  },

  // ── Standalone auth routes (accessible by guests and unverified users) ─────
  {
    element: <AuthLayout />,
    children: [
      { path: '/auth/verify-email', element: <VerifyEmailScreen /> }
    ]
  },

  // ── App routes (authenticated only) ─────────────────────────────────────
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          {
            path: '/dashboard',
            element: <DashboardScreen />
          },
          { path: '/companies', element: <CompaniesScreen /> },
          { path: '/contacts', element: <ContactsScreen /> },
          { path: '/audiences', element: <AudiencesScreen /> },
          { path: '/campaigns', element: <CampaignsScreen /> },
          { path: '/emails', element: <EmailLogsScreen /> },
          { path: '/emails/:id', element: <EmailLogsScreen /> },
          { path: '/media', element: <MediaLibraryScreen /> },
          { path: '/discovery', element: <DiscoveryScreen /> },
          { path: '/automation', element: <AutomationScreen /> },
          { path: '/workflows', element: <Navigate to="/automation" replace /> },
          { path: '/reports', element: <ReportsScreen /> },
          { path: '/settings', element: <WorkspaceSettingsScreen /> },
          { path: '/invites', element: <WorkspaceInvitesScreen /> },
          { path: '/diagnostics', element: <Navigate to="/operations" replace /> },
          { path: '/operations', element: <OperationsCenterScreen /> },
          { path: '/preferences', element: <PreferencesScreen /> }
        ]
      }
    ]
  },

  // ── Fallback ─────────────────────────────────────────────────────────────
  { path: '*', element: <Navigate to="/" replace /> }
]);

// ---------------------------------------------------------------------------
// AppRouter
// ---------------------------------------------------------------------------

/**
 * AppRouter wraps React Router with the session bootstrap logic.
 */
export function AppRouter() {
  useEffect(() => {
    (window as any).__reactMountTime = performance.now();
  }, []);

  return (
    <SessionBootstrap>
      <RouterProvider router={router} />
    </SessionBootstrap>
  );
}
