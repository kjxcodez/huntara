import { useEffect, Suspense, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';

import { useWorkspace } from '../hooks/useWorkspace';
import { Skeleton } from '../components/ui/skeleton';
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar';
import AppHeader from './AppHeader';
import { AppSidebar } from '../components/sidebar/AppSidebar';
import { CreateWorkspaceForm } from '../components/workspace/CreateWorkspaceForm';
import ProductTour from '../components/onboarding/ProductTour';
import { CommandPalette } from '../components/common/CommandPalette';
import { NotificationCenter } from '../components/common/NotificationCenter';
import { WhatsNewDialog } from '../components/common/WhatsNewDialog';
import { ConnectivityBanner } from '../components/common/ConnectivityBanner';

/**
 * AppLayout — the authenticated application shell.
 *
 * Renders: AppSidebar → AppHeader → page content via <Outlet />.
 * Auth and workspace state are read from their respective stores — no prop drilling.
 *
 * Emits `electron:ready-to-show` when there is no active workspace (so the
 * window frame appears even before a workspace is selected).
 *
 * Route transitions: AnimatePresence (mode="wait") wraps each page in a
 * 180ms fade + y-slide so navigation feels immediate and premium.
 */
export function AppLayout() {
  const { activeWorkspace, isInitialized, isLoading, workspaces, error } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Redirect to onboarding if not completed
  useEffect(() => {
    const isCompleted = localStorage.getItem('onboarding_completed') === 'true';
    if (!isCompleted) {
      navigate('/onboarding');
    }
  }, [navigate]);

  // Show window frame only when workspace state has been deterministically resolved
  useEffect(() => {
    if (isInitialized && (!activeWorkspace || workspaces.length === 0)) {
      window.ipc.invoke('electron:ready-to-show' as any, null).catch(() => {});
    }
  }, [isInitialized, activeWorkspace, workspaces.length]);

  // Invalidate all queries when a sync completes or connection is recovered.
  // Debounced to 500 ms to prevent rapid-fire sync:completed events (e.g. from a
  // scraper job streaming progress) from cascading back into a reconciliation loop.
  useEffect(() => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) return;

    let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedInvalidate = (payload?: any) => {
      if (payload?.workspaceId && payload.workspaceId !== workspaceId) {
        return;
      }
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(() => {
        console.log('[Renderer] Sync completed — invalidating queries.');
        queryClient.invalidateQueries();
      }, 500);
    };

    const unsubscribeSync = window.ipc.on('sync:completed', debouncedInvalidate);

    const unsubscribeEmailAcc = window.ipc.on('email-accounts:changed' as any, () => {
      console.log('[Renderer] Email accounts changed — invalidating email_accounts queries.');
      queryClient.invalidateQueries({ queryKey: ['email_accounts'] });
    });

    const unsubscribeGoogleConn = window.ipc.on('google-connections:changed' as any, () => {
      console.log('[Renderer] Google connections changed — invalidating connection queries.');
      queryClient.invalidateQueries({ queryKey: ['google_connections'] });
      queryClient.invalidateQueries({ queryKey: ['drive_connections'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
    });

    const unsubscribeConn = window.ipc.on('system:connectivity-changed' as any, (state: any) => {
      if (state?.status === 'ONLINE') {
        console.log('[Renderer] Connection restored to ONLINE — invalidating queries.');
        queryClient.invalidateQueries();
      }
    });

    return () => {
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      unsubscribeSync();
      unsubscribeEmailAcc();
      unsubscribeGoogleConn();
      unsubscribeConn();
    };
  }, [activeWorkspace?.id, queryClient]);

  // ── Error state: display actionable error with reload rather than failing through to Create Workspace ──
  if (error && !activeWorkspace) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <p className="text-sm text-destructive font-medium">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Initializing state: show clean progress gate if not resolved yet ─────
  if (!isInitialized || (isLoading && !activeWorkspace)) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-xs text-muted-foreground font-mono">Initializing workspace...</p>
        </div>
      </div>
    );
  }

  // ── No workspace: ONLY prompt to create one if resolution completed and 0 workspaces exist ──
  if (!activeWorkspace && workspaces.length === 0) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="w-full max-w-sm space-y-6 text-center border border-border-subtle p-8 rounded-none bg-card"
        >
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Create a workspace
            </h2>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              You need a workspace to start using HUNTARA.
            </p>
          </div>
          <CreateWorkspaceForm />
        </motion.div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
        <AppSidebar activeWorkspace={activeWorkspace} />

        <SidebarInset className="flex flex-col min-w-0">
          <AppHeader onOpenNotifications={() => setNotificationsOpen(true)} />
          <ConnectivityBanner />
          <main className="flex-1 overflow-y-auto p-4 max-h-[calc(100vh-44px)]">
            <Suspense fallback={<AppContentSkeleton />}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                  className="min-h-full"
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </Suspense>
          </main>
        </SidebarInset>
      </div>
      <ProductTour />
      <CommandPalette />
      <NotificationCenter isOpen={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <WhatsNewDialog />
    </SidebarProvider>
  );
}

/** Skeleton shown while lazy-loaded screen chunks are loading. */
function AppContentSkeleton() {
  return (
    <div className="space-y-4 p-2">
      <Skeleton className="h-6 w-1/3" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Skeleton className="h-20 rounded-none" />
        <Skeleton className="h-20 rounded-none" />
        <Skeleton className="h-20 rounded-none" />
        <Skeleton className="h-20 rounded-none" />
      </div>
      <Skeleton className="h-64 rounded-none" />
    </div>
  );
}
