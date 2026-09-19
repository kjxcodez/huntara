import { Component, type ErrorInfo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/button';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

/**
 * AppErrorBoundary — catches unhandled React render errors and renders a
 * premium, branded fallback page instead of a blank white crash.
 *
 * Design:
 *  - Full-screen centered layout matching the SessionExpired screen aesthetic.
 *  - Animated entrance via Framer Motion.
 *  - Collapsible stack trace for debugging.
 *  - "Reload App" button to recover without a manual restart.
 */
export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AppErrorBoundary] Caught unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, errorInfo, showDetails } = this.state;

    return (
      <div
        className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-background"
        role="alert"
        aria-label="Application error"
      >
        {/* Ambient glow blobs */}
        <div
          className="pointer-events-none absolute -top-32 -left-32 w-72 h-72 rounded-full opacity-10 blur-3xl"
          style={{ background: 'var(--danger)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-24 -right-24 w-56 h-56 rounded-full opacity-8 blur-3xl"
          style={{ background: 'var(--warning)' }}
        />

        {/* Error card */}
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className="relative z-10 w-full max-w-md mx-4 bg-card border border-danger/30 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]"
        >
          {/* Top danger stripe */}
          <div className="h-1 w-full bg-gradient-to-r from-danger via-warning to-danger opacity-80" />

          <div className="p-8 space-y-6">
            {/* Icon + headline */}
            <div className="flex flex-col items-center text-center space-y-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 20 }}
                className="w-14 h-14 bg-danger/10 border border-danger/20 flex items-center justify-center text-danger"
              >
                <AlertTriangle className="w-7 h-7" />
              </motion.div>

              <div className="space-y-2">
                <h1 className="text-base font-bold text-foreground uppercase tracking-wider">
                  Something went wrong
                </h1>
                <p className="text-[12px] text-muted-foreground leading-relaxed max-w-xs">
                  HUNTARA encountered an unexpected error. Your data is safe — reload to recover.
                </p>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-surface-3 border border-border-subtle px-4 py-3">
                <p className="text-[11px] font-mono text-danger leading-relaxed break-all">
                  {error.message || 'An unknown error occurred.'}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <Button
                onClick={this.handleReload}
                className="w-full rounded-none gap-2"
                size="sm"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload Application
              </Button>
              <Button
                onClick={this.handleReset}
                variant="ghost"
                className="w-full rounded-none text-[11px] text-muted-foreground"
                size="sm"
              >
                Try to recover without reloading
              </Button>
            </div>

            {/* Collapsible stack trace */}
            {errorInfo && (
              <div className="border-t border-border-subtle pt-4">
                <button
                  onClick={() => this.setState({ showDetails: !showDetails })}
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider font-semibold"
                >
                  {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showDetails ? 'Hide' : 'Show'} stack trace
                </button>
                {showDetails && (
                  <motion.pre
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3 text-[9px] font-mono text-muted-foreground overflow-x-auto bg-surface-3 p-3 leading-relaxed max-h-40"
                  >
                    {errorInfo.componentStack}
                  </motion.pre>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }
}
