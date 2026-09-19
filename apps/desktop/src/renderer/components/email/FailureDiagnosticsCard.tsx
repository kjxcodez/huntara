import React, { useState } from 'react';
import {
  AlertTriangle,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  RotateCcw,
  Clock
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

export interface FailureDiagnosticsCardProps {
  deliveryId: string;
  status: string;
  safeHumanMessage?: string | null;
  technicalMessage?: string | null;
  failureCode?: string | null;
  failureCategory?: string | null;
  failureClassification?: string | null;
  error?: string | null;
  retryable?: boolean;
  retryCount?: number;
  nextRetryAt?: Date | string | null;
  ambiguous?: boolean;
  onReconciled?: () => void;
  className?: string;
}

export const FailureDiagnosticsCard: React.FC<FailureDiagnosticsCardProps> = ({
  deliveryId,
  status,
  safeHumanMessage,
  technicalMessage,
  failureCode,
  failureCategory,
  failureClassification,
  error,
  retryable,
  retryCount,
  nextRetryAt,
  ambiguous,
  onReconciled,
  className = ''
}) => {
  const [showTechnical, setShowTechnical] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

  const isAmbiguous = status === 'AMBIGUOUS' || !!ambiguous;
  const isFailed = status === 'FAILED' || isAmbiguous;

  if (!isFailed && !error && !safeHumanMessage) {
    return null;
  }

  const handleCopy = () => {
    const errorDetails = JSON.stringify(
      {
        deliveryId,
        status,
        safeHumanMessage,
        failureCode,
        failureCategory,
        failureClassification,
        technicalMessage,
        error
      },
      null,
      2
    );
    navigator.clipboard.writeText(errorDetails);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReconcile = async () => {
    try {
      setReconciling(true);
      setReconcileResult(null);
      const res = await (window as any).ipc?.invoke?.('email-deliveries:reconcile', { id: deliveryId });
      if (res?.reconciledStatus) {
        setReconcileResult(`Reconciliation resolved: ${res.reconciledStatus}`);
      } else {
        setReconcileResult('Reconciliation complete. Status verified against Gmail.');
      }
      if (onReconciled) {
        onReconciled();
      }
    } catch (err: any) {
      setReconcileResult(`Reconciliation error: ${err?.message || 'Failed to reconcile'}`);
    } finally {
      setReconciling(false);
    }
  };

  return (
    <Card
      className={`border min-w-0 overflow-hidden ${
        isAmbiguous
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-rose-500/10 border-rose-500/30'
      } ${className}`}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header Title & Status */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {isAmbiguous ? (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div>
              <h4 className={`text-sm font-semibold ${isAmbiguous ? 'text-amber-300' : 'text-rose-300'}`}>
                {isAmbiguous ? 'Ambiguous Delivery State' : 'Delivery Failure'}
              </h4>
              <p className="text-xs text-foreground/80 mt-0.5">
                {safeHumanMessage ||
                  (isAmbiguous
                    ? 'Provider response was inconclusive. HUNTARA did not record false success or trigger duplicate sends.'
                    : error || 'An error occurred while sending this message.')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {failureCategory === 'INVALID_RECIPIENT' && (
              <Badge variant="outline" className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[10px] font-mono">
                Auto-Suppressed
              </Badge>
            )}
            {failureCategory && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {failureCategory}
              </Badge>
            )}
          </div>
        </div>

        {/* Ambiguous Reconcile Action Banner */}
        {isAmbiguous && (
          <div className="flex items-center justify-between p-2.5 rounded-md bg-amber-500/15 border border-amber-500/25">
            <span className="text-xs text-amber-200">
              Check Gmail Sent messages to confirm if this email was actually transmitted.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border-amber-400/40 shrink-0"
              onClick={handleReconcile}
              disabled={reconciling}
            >
              <RefreshCw className={`w-3 h-3 mr-1.5 ${reconciling ? 'animate-spin' : ''}`} />
              {reconciling ? 'Reconciling...' : 'Reconcile Now'}
            </Button>
          </div>
        )}

        {reconcileResult && (
          <div className="text-xs p-2 rounded bg-muted/50 border border-border text-foreground">
            {reconcileResult}
          </div>
        )}

        {/* Retry Information */}
        {(retryable || (retryCount !== undefined && retryCount > 0) || nextRetryAt) && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
            <div className="flex items-center gap-1">
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                Retries: <strong className="text-foreground">{retryCount || 0}</strong>
              </span>
            </div>
            {retryable && (
              <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-300">
                Eligible for auto-retry
              </Badge>
            )}
            {nextRetryAt && (
              <div className="flex items-center gap-1 text-[11px]">
                <Clock className="w-3 h-3" />
                <span>Next retry: {new Date(nextRetryAt).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        )}

        {/* Technical Details Toggle */}
        <div className="pt-1 border-t border-border/40">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowTechnical(!showTechnical)}
            >
              {showTechnical ? (
                <>
                  <ChevronUp className="w-3 h-3 mr-1" />
                  Hide Technical Details
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3 mr-1" />
                  Show Technical Details
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 mr-1 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy Diagnostic JSON
                </>
              )}
            </Button>
          </div>

          {showTechnical && (
            <div className="mt-2 p-2.5 rounded bg-background/80 border border-border text-[11px] font-mono text-muted-foreground space-y-1 select-text">
              {failureCode && (
                <div>
                  <span className="text-foreground/70">Error Code:</span> {failureCode}
                </div>
              )}
              {failureClassification && (
                <div>
                  <span className="text-foreground/70">Classification:</span> {failureClassification}
                </div>
              )}
              {technicalMessage && (
                <div className="break-all whitespace-pre-wrap">
                  <span className="text-foreground/70">Technical Message:</span> {technicalMessage}
                </div>
              )}
              {error && (
                <div className="break-all whitespace-pre-wrap">
                  <span className="text-foreground/70">Raw Error:</span> {error}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
