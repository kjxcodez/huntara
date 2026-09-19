import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudOff, RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import type { RuntimeConnectivityState } from '@huntara/schema';

/**
 * ConnectivityBanner — Global runtime connectivity alert banner.
 *
 * Appears when the application is operating in DEGRADED (offline) or
 * AUTHENTICATION_REQUIRED state.
 *
 * Invariants:
 * - Makes the distinction between "empty workspace" and "API unreachable" obvious.
 * - Provides a direct "Retry Connection" recovery action.
 */
export function ConnectivityBanner() {
  const navigate = useNavigate();
  const [state, setState] = useState<RuntimeConnectivityState | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    // 1. Fetch initial connectivity state
    window.ipc
      .invoke('system:connectivity-status' as any, undefined)
      .then((res: any) => {
        if (res) setState(res);
      })
      .catch((err) => {
        console.warn('[ConnectivityBanner] Failed to fetch initial connectivity status:', err);
      });

    // 2. Subscribe to real-time connectivity change events
    const unsub = window.ipc.on('system:connectivity-changed' as any, (newState: any) => {
      if (newState) setState(newState);
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const res: any = await window.ipc.invoke('system:connectivity-check' as any, undefined);
      if (res) setState(res);
    } catch (err) {
      console.warn('[ConnectivityBanner] Retry check failed:', err);
    } finally {
      setIsRetrying(false);
    }
  };

  if (!state || state.status === 'ONLINE' || state.status === 'CHECKING') {
    return null;
  }

  if (state.status === 'AUTHENTICATION_REQUIRED') {
    return (
      <div className="w-full bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between gap-3 text-[12px] text-amber-600 dark:text-amber-400 select-none animate-in fade-in duration-200">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
          <span className="font-medium">Session Expired:</span>
          <span className="text-muted-foreground truncate">
            Your login session has expired or is invalid. Please sign in again.
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => navigate('/login')}
          className="h-6 text-[11px] px-2.5 font-medium bg-amber-500 text-white hover:bg-amber-600 rounded-none shrink-0 cursor-pointer"
        >
          Sign In
        </Button>
      </div>
    );
  }

  // DEGRADED / OFFLINE
  const errorMessage = state.error?.message || 'API server is offline or unreachable.';
  const errorCode = state.error?.code || 'NETWORK_UNREACHABLE';

  return (
    <div className="w-full bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center justify-between gap-3 text-[12px] text-destructive select-none animate-in fade-in duration-200">
      <div className="flex items-center gap-2 min-w-0">
        <CloudOff className="w-4 h-4 shrink-0 text-destructive" />
        <span className="font-semibold">Offline Mode:</span>
        <span className="text-foreground/80 truncate">
          API server is unreachable ({errorCode}). Live sync, lead discovery, and outreach schedules are paused.
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={handleRetry}
          disabled={isRetrying}
          className="h-6 text-[11px] px-2.5 font-medium gap-1.5 border-destructive/30 hover:bg-destructive/10 text-destructive rounded-none cursor-pointer"
          title={errorMessage}
        >
          <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
          <span>{isRetrying ? 'Checking...' : 'Retry Connection'}</span>
        </Button>
      </div>
    </div>
  );
}
