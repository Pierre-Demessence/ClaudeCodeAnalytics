import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { UsageRow } from '@/core/aggregate';
import type { Summary } from '@/dashboard/api';
import type { Family } from '@/dashboard/models';

import { formatDay, formatTokens, formatUsd, formatUsdShort } from '@/dashboard/format';
import { familyOf, modelLabel, SERIES } from '@/dashboard/models';
import { Legend } from '@/dashboard/Patterns';
import { Toggle } from '@/dashboard/Toggle';

type Period = 'daily' | 'weekly';
type Metric = 'cost' | 'tokens';

const tokensOf = (row: UsageRow) => row.input + row.output + row.cacheWrite + row.cacheRead;

interface Bucket {
  [family: string]: number | string;
  bucket: string;
  label: string;
  total: number;
}

function toBuckets(rows: readonly UsageRow[], metric: Metric, period: Period): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    let bucket = buckets.get(row.bucket);
    if (!bucket) {
      bucket = { bucket: row.bucket, label: period === 'weekly' ? `from ${formatDay(row.bucket)}` : formatDay(row.bucket), total: 0 };
      buckets.set(row.bucket, bucket);
    }
    const value = metric === 'cost' ? row.cost : tokensOf(row);
    const family = familyOf(row.model);
    bucket[family] = (Number(bucket[family]) || 0) + value;
    bucket.total += value;
  }
  return [...buckets.values()];
}

export function RawUsage({ summary }: { summary: Summary }) {
  const [period, setPeriod] = useState<Period>('daily');
  const [metric, setMetric] = useState<Metric>('cost');
  const rows = period === 'daily' ? summary.daily : summary.weekly;
  const data = toBuckets(rows, metric, period);
  const families = new Set<Family>(rows.map(row => familyOf(row.model)));
  const series = SERIES.filter(s => families.has(s.family));
  const format = metric === 'cost' ? formatUsd : formatTokens;
  const models = [...new Set(rows.map(row => row.model))].sort();

  return (
    <section className="card">
      <h2>Raw usage</h2>
      <div className="controls">
        <Toggle label="Period" onChange={setPeriod} options={[['daily', 'Per day'], ['weekly', 'Per week']]} value={period} />
        <Toggle label="Metric" onChange={setMetric} options={[['cost', 'API-equivalent $'], ['tokens', 'Tokens']]} value={metric} />
      </div>
      <p className="note">
        {metric === 'cost'
          ? 'What this usage would cost at public API prices. It weights models and cache use the way plan limits roughly do.'
          : 'All token kinds, including cache reads, which are cheap but numerous.'}
        {period === 'daily' ? ' Last 5 weeks, local days.' : ' Weekly windows end at your plan\'s weekly reset.'}
      </p>
      {data.length === 0
        ? <p className="empty">No usage imported yet.</p>
        : (
            <>
              <Legend series={series} />
              <div className="chart" role="img" aria-label={`Usage ${period === 'daily' ? 'per day' : 'per week'} by model family`}>
                <ResponsiveContainer height={280} width="100%">
                  <BarChart data={data} margin={{ bottom: 0, left: 0, right: 16, top: 8 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="label" minTickGap={12} stroke="var(--text-secondary)" tickLine={false} />
                    <YAxis stroke="var(--text-secondary)" tickFormatter={(v: number) => (metric === 'cost' ? formatUsdShort(v) : formatTokens(v))} tickLine={false} width={64} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      cursor={{ fill: 'var(--hover)' }}
                      formatter={(value, name) => [format(Number(value)), SERIES.find(s => s.family === name)?.label ?? name]}
                    />
                    {series.map((s, index) => (
                      <Bar
                        dataKey={s.family}
                        fill={`url(#${s.pattern})`}
                        isAnimationActive={false}
                        key={s.family}
                        maxBarSize={40}
                        radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
                        stackId="usage"
                        stroke="var(--surface-1)"
                        strokeWidth={1}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details>
                <summary>Table view</summary>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{period === 'daily' ? 'Day' : 'Week'}</th>
                      {models.map(model => <th key={model} scope="col" title={model}>{modelLabel(model)}</th>)}
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map(bucket => (
                      <tr key={bucket.bucket}>
                        <th scope="row">{bucket.label}</th>
                        {models.map((model) => {
                          const row = rows.find(r => r.bucket === bucket.bucket && r.model === model);
                          return <td key={model}>{row ? format(metric === 'cost' ? row.cost : tokensOf(row)) : '—'}</td>;
                        })}
                        <td>{format(bucket.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
    </section>
  );
}
