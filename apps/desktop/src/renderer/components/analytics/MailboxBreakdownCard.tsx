import React from 'react';
import { Mail, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { MailboxSenderAnalytics } from '@huntara/schema';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table';

interface MailboxBreakdownCardProps {
  mailboxes: MailboxSenderAnalytics[];
}

export function MailboxBreakdownCard({ mailboxes }: MailboxBreakdownCardProps) {
  if (mailboxes.length === 0) {
    return (
      <div className="bg-card border border-border-subtle rounded-none p-6 text-center text-muted-foreground italic text-[11px]">
        No mailbox sending metrics available for this campaign.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border-subtle rounded-none p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" />
          <h4 className="font-semibold text-foreground text-[12px] tracking-tight">
            Sending Mailbox & Sender Health
          </h4>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {mailboxes.length} Active Sending Accounts
        </span>
      </div>

      <div className="border border-border-subtle rounded-none overflow-x-auto">
        <Table>
          <TableHeader className="bg-surface-3/50 text-[10px]">
            <TableRow>
              <TableHead className="py-2 text-zinc-400 font-medium">Mailbox</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Quota Today</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Accepted</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Opens</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Replies</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-center">Bounces</TableHead>
              <TableHead className="py-2 text-zinc-400 font-medium text-right">Acceptance Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-[11px] divide-y divide-border-subtle">
            {mailboxes.map((m) => {
              const bounceRate = m.attempted > 0 ? ((m.bounced / m.attempted) * 100).toFixed(1) : '0.0';

              return (
                <TableRow key={m.accountId} className="hover:bg-surface-2/40 transition-colors">
                  <TableCell className="py-2 font-medium text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="text-foreground">{m.email}</span>
                      {m.rateLimited && (
                        <span className="text-[9px] text-warning bg-warning/10 px-1 py-0.2 border border-warning/20">
                          Quota Reached
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] text-muted-foreground block font-mono">
                      {m.provider.toUpperCase()} • {m.status}
                    </span>
                  </TableCell>

                  <TableCell className="py-2 text-center font-mono text-[10px]">
                    <span className="text-foreground font-semibold">{m.dailySent}</span>
                    <span className="text-zinc-500"> / {m.dailyLimit}</span>
                  </TableCell>

                  <TableCell className="py-2 text-center font-mono text-foreground">
                    {m.accepted.toLocaleString()}
                  </TableCell>

                  <TableCell className="py-2 text-center font-mono text-foreground">
                    {m.observedOpens.toLocaleString()}
                  </TableCell>

                  <TableCell className="py-2 text-center font-mono text-success font-semibold">
                    {m.replies.toLocaleString()}
                  </TableCell>

                  <TableCell className="py-2 text-center font-mono">
                    {m.bounced > 0 ? (
                      <span className="text-danger font-semibold">
                        {m.bounced} ({bounceRate}%)
                      </span>
                    ) : (
                      <span className="text-zinc-500">0</span>
                    )}
                  </TableCell>

                  <TableCell className="py-2 text-right font-mono font-bold text-primary">
                    {m.acceptanceRate.formatted}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
