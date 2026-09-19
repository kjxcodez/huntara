import React from 'react';
import { ShieldCheck, ShieldAlert, AlertCircle, CheckCircle } from 'lucide-react';
import type { AudienceQualityBreakdown } from '@huntara/schema';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';

interface AudienceQualityCardProps {
  breakdown: AudienceQualityBreakdown;
}

export function AudienceQualityCard({ breakdown }: AudienceQualityCardProps) {
  if (!breakdown || breakdown.segments.length === 0) {
    return (
      <div className="bg-card border border-border-subtle rounded-none p-6 text-center text-muted-foreground italic text-[11px]">
        No audience verification quality data available.
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'VERIFIED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] text-success bg-success/10 px-1.5 py-0.5 border border-success/20 font-mono font-semibold">
            <CheckCircle className="w-3 h-3" />
            Verified
          </span>
        );
      case 'MX_VALID':
      case 'DOMAIN_VALID':
      case 'SYNTAX_VALID':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] text-info bg-info/10 px-1.5 py-0.5 border border-info/20 font-mono">
            {status.replace('_', ' ')}
          </span>
        );
      case 'RISKY':
      case 'DISPOSABLE':
      case 'ROLE_ACCOUNT':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 border border-warning/20 font-mono">
            <AlertCircle className="w-3 h-3" />
            {status.replace('_', ' ')}
          </span>
        );
      case 'INVALID':
      case 'SUPPRESSED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] text-danger bg-danger/10 px-1.5 py-0.5 border border-danger/20 font-mono">
            <ShieldAlert className="w-3 h-3" />
            {status}
          </span>
        );
      default:
        return (
          <span className="text-[10px] text-zinc-400 bg-surface-3 px-1.5 py-0.5 border border-border-subtle font-mono">
            Unknown
          </span>
        );
    }
  };

  return (
    <div className="bg-card border border-border-subtle rounded-none p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h4 className="font-semibold text-foreground text-[12px] tracking-tight">
            Audience Quality & Deliverability Correlation
          </h4>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          Phase 10 Quality Tiers ({breakdown.totalEnrolled} Contacts)
        </span>
      </div>

      <div className="border border-border-subtle rounded-none overflow-x-auto">
        <Table>
          <TableHeader className="bg-surface-3/50 text-[10px]">
            <TableRow>
              <TableHead className="py-2 text-zinc-400 font-medium">Quality Tier</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Contacts</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Share</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Accepted</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Replies</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Bounces</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-right">Bounce Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-[11px] divide-y divide-border-subtle">
            {breakdown.segments.map((seg) => (
              <TableRow key={seg.status} className="hover:bg-surface-2/40 transition-colors">
                <TableCell className="py-2 font-medium">
                  {getStatusBadge(seg.status)}
                </TableCell>

                <TableCell className="py-2 text-center font-mono text-foreground font-semibold">
                  {seg.count.toLocaleString()}
                </TableCell>

                <TableCell className="py-2 text-center font-mono text-zinc-400 text-[10px]">
                  {seg.percentage}%
                </TableCell>

                <TableCell className="py-2 text-center font-mono text-foreground">
                  {seg.accepted.toLocaleString()}
                </TableCell>

                <TableCell className="py-2 text-center font-mono text-success font-semibold">
                  {seg.replied.toLocaleString()}
                </TableCell>

                <TableCell className="py-2 text-center font-mono">
                  {seg.bounced > 0 ? (
                    <span className="text-danger font-semibold">{seg.bounced}</span>
                  ) : (
                    <span className="text-zinc-500">0</span>
                  )}
                </TableCell>

                <TableCell className="py-2 text-right font-mono font-bold">
                  {seg.bounceRate > 5 ? (
                    <span className="text-danger">{seg.bounceRate}%</span>
                  ) : seg.bounceRate > 0 ? (
                    <span className="text-warning">{seg.bounceRate}%</span>
                  ) : (
                    <span className="text-success">0.00%</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
