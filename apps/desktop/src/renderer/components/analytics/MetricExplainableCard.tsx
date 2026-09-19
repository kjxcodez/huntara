import React, { useState } from 'react';
import { HelpCircle, AlertTriangle, Info } from 'lucide-react';
import type { MetricWithDenominator } from '@huntara/schema';

interface MetricExplainableCardProps {
  title: string;
  metric: MetricWithDenominator;
  icon?: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  benchmark?: string;
}

export function MetricExplainableCard({
  title,
  metric,
  icon,
  variant = 'default',
  benchmark
}: MetricExplainableCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return 'border-success/30 text-success';
      case 'warning':
        return 'border-warning/30 text-warning';
      case 'danger':
        return 'border-danger/30 text-danger';
      case 'info':
        return 'border-info/30 text-info';
      default:
        return 'border-border-subtle text-foreground';
    }
  };

  return (
    <div className="bg-card border border-border-subtle rounded-none p-3.5 flex flex-col justify-between shadow-sm relative group hover:border-primary/40 transition-colors">
      <div>
        <div className="flex items-center justify-between gap-1 text-muted-foreground mb-1.5">
          <div className="flex items-center gap-1.5">
            {icon && <span className="opacity-80">{icon}</span>}
            <span className="text-[11px] font-medium text-foreground tracking-tight">{title}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="text-zinc-400 hover:text-foreground transition-colors p-0.5 rounded-none"
            title="Inspect calculation formula and caveats"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Primary Metric Value */}
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-xl font-bold font-mono tracking-tight text-foreground">
            {metric.formatted}
          </span>
          {benchmark && (
            <span className="text-[10px] text-muted-foreground font-mono">
              target: {benchmark}
            </span>
          )}
        </div>

        {/* Explicit Numerator & Denominator */}
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono bg-surface-3/50 px-2 py-1 border border-border-subtle/50">
          <span className="text-foreground font-semibold">
            {metric.numerator.toLocaleString()}
          </span>
          <span className="text-zinc-500">/</span>
          <span>{metric.denominator.toLocaleString()}</span>
          <span className="text-zinc-500 text-[9px] ml-auto">
            ({metric.denominator > 0 ? ((metric.numerator / metric.denominator) * 100).toFixed(1) : 0}%)
          </span>
        </div>
      </div>

      {/* Expanded Formula and Caveat Drawer */}
      {showDetails && (
        <div className="mt-3 pt-2.5 border-t border-border-subtle text-[10px] space-y-1.5 bg-background/90 p-2">
          <div>
            <span className="text-zinc-500 font-mono block text-[9px] uppercase tracking-wider">
              Formula
            </span>
            <code className="text-primary font-mono text-[10px] bg-primary/10 px-1 py-0.5 rounded-none">
              {metric.formula}
            </code>
          </div>
          <div>
            <span className="text-zinc-500 font-mono block text-[9px] uppercase tracking-wider">
              Definition
            </span>
            <p className="text-muted-foreground leading-tight">{metric.description}</p>
          </div>
          {metric.limitations && (
            <div className="flex items-start gap-1 text-warning bg-warning/10 p-1.5 border border-warning/20">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <p className="text-[9px] leading-tight text-warning-foreground">
                {metric.limitations}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
