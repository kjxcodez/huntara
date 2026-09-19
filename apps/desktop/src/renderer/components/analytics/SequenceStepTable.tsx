import React from 'react';
import { Layers, Clock, Mail, CheckCircle2, AlertOctagon, CornerDownRight } from 'lucide-react';
import type { SequenceStepAnalytics } from '@huntara/schema';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';

interface SequenceStepTableProps {
  steps: SequenceStepAnalytics[];
}

export function SequenceStepTable({ steps }: SequenceStepTableProps) {
  if (steps.length === 0) {
    return (
      <div className="bg-card border border-border-subtle rounded-none p-6 text-center text-muted-foreground italic text-[11px]">
        No sequence steps found for this campaign.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border-subtle rounded-none p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <h4 className="font-semibold text-foreground text-[12px] tracking-tight">
            Sequence Step Conversion & Attrition
          </h4>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {steps.length} Steps in Cadence
        </span>
      </div>

      <div className="border border-border-subtle rounded-none overflow-x-auto">
        <Table>
          <TableHeader className="bg-surface-3/50 text-[10px]">
            <TableRow>
              <TableHead className="py-2 text-zinc-400 font-medium">Step</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium">Delay</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Entered</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Accepted</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Unique Opens</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Unique Clicks</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Replies</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Bounces</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-right">Step Reply Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-[11px] divide-y divide-border-subtle">
            {steps.map((s) => (
              <TableRow key={s.stepIndex} className="hover:bg-surface-2/40 transition-colors">
                <TableCell className="py-2 font-medium text-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-zinc-500 text-[10px]">#{s.stepIndex + 1}</span>
                    <span>{s.stepName}</span>
                  </div>
                  {s.templateSubject && (
                    <span className="text-[9px] text-muted-foreground block truncate max-w-xs">
                      Subj: {s.templateSubject}
                    </span>
                  )}
                </TableCell>

                <TableCell className="py-2 text-muted-foreground font-mono text-[10px]">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-zinc-400" />
                    <span>+{s.delayDays}d</span>
                  </div>
                </TableCell>

                <TableCell className="py-2 text-center font-mono text-foreground font-semibold">
                  {s.contactsEntered.toLocaleString()}
                </TableCell>

                <TableCell className="py-2 text-center font-mono">
                  <span className="text-foreground">{s.accepted.toLocaleString()}</span>
                  <span className="text-[9px] text-zinc-500 block">
                    ({s.acceptanceRate.formatted})
                  </span>
                </TableCell>

                <TableCell className="py-2 text-center font-mono">
                  <span className="text-foreground">{s.uniqueOpens.toLocaleString()}</span>
                  <span className="text-[9px] text-zinc-500 block">
                    ({s.openRate.formatted})
                  </span>
                </TableCell>

                <TableCell className="py-2 text-center font-mono text-foreground">
                  {s.uniqueClicks.toLocaleString()}
                </TableCell>

                <TableCell className="py-2 text-center font-mono">
                  <span className="text-success font-bold">{s.replies.toLocaleString()}</span>
                  {s.stopped > 0 && (
                    <span className="text-[9px] text-zinc-500 block">
                      {s.stopped} stopped
                    </span>
                  )}
                </TableCell>

                <TableCell className="py-2 text-center font-mono">
                  {s.bounces > 0 ? (
                    <span className="text-danger font-semibold">
                      {s.bounces} ({s.bounceRate.formatted})
                    </span>
                  ) : (
                    <span className="text-zinc-500">0</span>
                  )}
                </TableCell>

                <TableCell className="py-2 text-right font-mono font-bold text-primary">
                  {s.replyRate.formatted}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
