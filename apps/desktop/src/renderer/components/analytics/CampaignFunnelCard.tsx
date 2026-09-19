import React from 'react';
import { Filter, Users, Send, Eye, MousePointer, MessageSquare, ShieldCheck, HelpCircle } from 'lucide-react';
import type { CampaignFunnelStage } from '@huntara/schema';

interface CampaignFunnelCardProps {
  stages: CampaignFunnelStage[];
  attributionConfidence?: {
    directThread: number;
    directHeader: number;
    contactMatch: number;
  };
}

const STAGE_ICONS: Record<string, React.ReactNode> = {
  enrolled: <Users className="w-3.5 h-3.5 text-primary" />,
  accepted: <Send className="w-3.5 h-3.5 text-info" />,
  opened: <Eye className="w-3.5 h-3.5 text-warning" />,
  clicked: <MousePointer className="w-3.5 h-3.5 text-purple-400" />,
  replied: <MessageSquare className="w-3.5 h-3.5 text-success" />
};

export function CampaignFunnelCard({ stages, attributionConfidence }: CampaignFunnelCardProps) {
  const totalAttributedReplies = attributionConfidence
    ? attributionConfidence.directThread +
      attributionConfidence.directHeader +
      attributionConfidence.contactMatch
    : 0;

  return (
    <div className="bg-card border border-border-subtle rounded-none p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary" />
          <h4 className="font-semibold text-foreground text-[12px] tracking-tight">
            Audience Conversion & Dropoff Funnel
          </h4>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          Deterministic Contact Denominators
        </span>
      </div>

      {/* Horizontal / Stepped Funnel Bars */}
      <div className="space-y-3">
        {stages.map((stage, idx) => {
          const maxCount = stages[0]?.count || 1;
          const pctOfTop = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;

          return (
            <div key={stage.stage} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-zinc-500">{idx + 1}.</span>
                  {STAGE_ICONS[stage.stage] || <Users className="w-3.5 h-3.5" />}
                  <span className="font-medium text-foreground">{stage.label}</span>
                </div>
                <div className="flex items-center gap-2 font-mono">
                  <span className="font-bold text-foreground">{stage.count.toLocaleString()}</span>
                  <span className="text-[10px] text-zinc-400">
                    ({stage.formattedConversionRate})
                  </span>
                  {stage.dropoffCount > 0 && !stage.isTerminal && (
                    <span className="text-[10px] text-danger bg-danger/10 px-1 py-0.2 border border-danger/20">
                      -{stage.dropoffCount} ({((stage.dropoffCount / (stage.denominator || 1)) * 100).toFixed(1)}% drop)
                    </span>
                  )}
                </div>
              </div>

              {/* Visual Funnel Bar */}
              <div className="h-2 w-full bg-surface-3 border border-border-subtle overflow-hidden">
                <div
                  className="h-full bg-primary/70 transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(pctOfTop, 1)}%` }}
                />
              </div>

              {stage.note && (
                <p className="text-[9px] text-muted-foreground italic pl-4">
                  {stage.note}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Reply Attribution Disclosure */}
      {attributionConfidence && totalAttributedReplies > 0 && (
        <div className="pt-3 border-t border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-foreground flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-success" />
              Reply Attribution Confidence
            </span>
            <span className="text-[9px] font-mono text-zinc-400">
              {totalAttributedReplies} attributed replies
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
            <div className="bg-surface-3 p-2 border border-border-subtle">
              <span className="text-zinc-500 text-[9px] block">Direct Thread Match</span>
              <span className="text-foreground font-bold text-sm">
                {attributionConfidence.directThread}
              </span>
              <span className="text-[9px] text-success block">Highest Confidence</span>
            </div>

            <div className="bg-surface-3 p-2 border border-border-subtle">
              <span className="text-zinc-500 text-[9px] block">Header Message-ID</span>
              <span className="text-foreground font-bold text-sm">
                {attributionConfidence.directHeader}
              </span>
              <span className="text-[9px] text-info block">High Confidence</span>
            </div>

            <div className="bg-surface-3 p-2 border border-border-subtle">
              <span className="text-zinc-500 text-[9px] block">Sender Email Match</span>
              <span className="text-foreground font-bold text-sm">
                {attributionConfidence.contactMatch}
              </span>
              <span className="text-[9px] text-warning block">Moderate Confidence</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
