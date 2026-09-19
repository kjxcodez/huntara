import React from 'react';
import { Calendar, Globe } from 'lucide-react';
import type { CampaignTimelinePoint } from '@huntara/schema';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

interface CampaignTimelineChartProps {
  points: CampaignTimelinePoint[];
  timezone: string;
}

export function CampaignTimelineChart({ points, timezone }: CampaignTimelineChartProps) {
  if (points.length === 0) {
    return (
      <div className="bg-card border border-border-subtle rounded-none p-8 text-center text-muted-foreground italic text-[11px]">
        No telemetry activity recorded for this campaign timeline yet.
      </div>
    );
  }

  // Format chart data
  const chartData = points.map((p) => ({
    date: p.label,
    Accepted: p.accepted,
    Opens: p.observedOpens,
    Clicks: p.observedClicks,
    Replies: p.replies,
    Bounces: p.bounces
  }));

  return (
    <div className="bg-card border border-border-subtle rounded-none p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h4 className="font-semibold text-foreground text-[12px] tracking-tight">
            Daily Activity & Telemetry Timeline
          </h4>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground bg-surface-3 px-2 py-0.5 border border-border-subtle">
          <Globe className="w-3 h-3 text-zinc-400" />
          <span>Basis: {timezone}</span>
        </div>
      </div>

      <div className="h-64 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              stroke="#71717a"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: '#27272a' }}
            />
            <YAxis
              stroke="#71717a"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: '#27272a' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                borderColor: '#27272a',
                borderRadius: 0,
                fontSize: 11,
                fontFamily: 'monospace'
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
              iconType="square"
            />
            <Bar dataKey="Accepted" fill="#3b82f6" radius={0} />
            <Bar dataKey="Opens" fill="#eab308" radius={0} />
            <Bar dataKey="Clicks" fill="#a855f7" radius={0} />
            <Bar dataKey="Replies" fill="#22c55e" radius={0} />
            <Bar dataKey="Bounces" fill="#ef4444" radius={0} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
