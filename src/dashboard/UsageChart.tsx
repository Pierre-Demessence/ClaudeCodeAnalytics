import type { TooltipContentProps } from 'recharts';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { Summary } from '@/dashboard/api';
import type { Family } from '@/dashboard/models';
import type { Bucket, Metric, Period } from '@/dashboard/usageData';

import { formatTokens, formatUsd, formatUsdShort } from '@/dashboard/format';
import { familyOf, SERIES } from '@/dashboard/models';
import { Legend, Swatch } from '@/dashboard/Patterns';
import { Toggle } from '@/dashboard/Toggle';
import { toBuckets } from '@/dashboard/usageData';

/** Families in the bars' bottom-to-top order, then the total and any upgrade. */
export function UsageTooltip({ active, format, payload }: Pick<TooltipContentProps<number, string>, 'active' | 'payload'> & { format: (value: number) => string }) {
  const bucket = payload?.[0]?.payload as Bucket | undefined;
  if (!active || !bucket)
    return null;
  return (
    <div className="chart-tooltip">
      <strong>{bucket.label}</strong>
      <ul>
        {SERIES.filter(s => bucket.values[s.family] !== undefined).map(s => (
          <li key={s.family}>
            <Swatch series={s} />
            {s.label}
            <span>{format(bucket.values[s.family]!)}</span>
          </li>
        ))}
        <li className="chart-tooltip-total">
          Total
          <span>{format(bucket.total)}</span>
        </li>
      </ul>
      {bucket.upgrade && <p>{`Claude Code ${bucket.upgrade}`}</p>}
    </div>
  );
}

/** Upgrade label, at the top of its line and starting right of it. */
function UpgradeLabel({ version, viewBox }: { version: string; viewBox?: { x?: number; y?: number } }) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  return <text className="upgrade-label" dominantBaseline="hanging" x={x + 4} y={y + 2}>{version}</text>;
}

export function UsageChart({ summary }: { summary: Summary }) {
  const [period, setPeriod] = useState<Period>('day');
  const [metric, setMetric] = useState<Metric>('cost');
  const rows = period === 'day' ? summary.daily : summary.weekly;
  const data = toBuckets(rows, metric, period, summary.activity.upgrades);
  const families = new Set<Family>(rows.map(row => familyOf(row.model)));
  const series = SERIES.filter(s => families.has(s.family));
  const format = metric === 'cost' ? formatUsd : formatTokens;
  const unit = metric === 'cost' ? 'API-equivalent dollars' : 'tokens';

  return (
    <section className="card">
      <div className="card-head">
        <h2>{period === 'day' ? 'Daily usage by model' : 'Weekly usage by model'}</h2>
        <span className="card-subtitle">
          {period === 'day' ? `last 35 days, ${unit}` : `per weekly window, ${unit}`}
        </span>
        <span className="card-head-spacer" />
        <div className="controls">
          <Toggle label="Unit" onChange={setMetric} options={[['cost', 'Dollars'], ['tokens', 'Tokens']]} value={metric} />
          <Toggle label="Bucket" onChange={setPeriod} options={[['day', 'Day'], ['week', 'Week']]} value={period} />
        </div>
      </div>
      {data.length === 0
        ? <p className="empty">No usage imported yet.</p>
        : (
            <>
              <div className="chart" role="img" aria-label={`Usage ${period === 'day' ? 'per day' : 'per week'} by model family`}>
                <ResponsiveContainer height={280} width="100%">
                  <BarChart data={data} margin={{ bottom: 0, left: 0, right: 16, top: 8 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="label" minTickGap={12} stroke="var(--text-secondary)" tickLine={false} />
                    <YAxis stroke="var(--text-secondary)" tickFormatter={(v: number) => (metric === 'cost' ? formatUsdShort(v) : formatTokens(v))} tickLine={false} width={64} />
                    <Tooltip
                      content={props => <UsageTooltip active={props.active} format={format} payload={props.payload} />}
                      cursor={{ fill: 'var(--hover)' }}
                    />
                    {/* SERIES order: Opus at the bottom of each bar. */}
                    {series.map((s, index) => (
                      <Bar
                        dataKey={(bucket: Bucket) => bucket.values[s.family] ?? 0}
                        fill={`url(#${s.pattern})`}
                        isAnimationActive={false}
                        key={s.family}
                        maxBarSize={40}
                        name={s.family}
                        radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
                        stackId="usage"
                        stroke="var(--surface-1)"
                        strokeWidth={1}
                      />
                    ))}
                    {data.filter(bucket => bucket.upgrade).map(bucket => (
                      <ReferenceLine
                        key={bucket.bucket}
                        label={<UpgradeLabel version={bucket.upgrade!} />}
                        position="start"
                        stroke="var(--text-secondary)"
                        strokeDasharray="4 3"
                        x={bucket.label}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Legend series={series} />
              {data.some(bucket => bucket.upgrade) && (
                <p className="note legend-note">
                  <span aria-hidden="true" className="legend-upgrade" />
                  Claude Code upgrade
                </p>
              )}
            </>
          )}
    </section>
  );
}
