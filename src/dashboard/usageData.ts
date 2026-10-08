import type { Activity, Outlier } from '@/core/activity';
import type { UsageRow } from '@/core/aggregate';
import type { Family } from '@/core/family';

import { familyOf } from '@/core/family';
import { formatDay, formatDuration, formatTokens } from '@/dashboard/format';

const HEAT_STEPS = 5;

export type Period = 'day' | 'week';
export type Metric = 'cost' | 'tokens';

const tokensOf = (row: UsageRow) => row.input + row.output + row.cacheWrite + row.cacheRead;

export interface Bucket {
  bucket: string;
  label: string;
  total: number;
  /** Claude Code version reached on this day, when it rose. */
  upgrade?: string;
  values: Partial<Record<Family, number>>;
}

export function toBuckets(rows: readonly UsageRow[], metric: Metric, period: Period, upgrades: Activity['upgrades']): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    let bucket = buckets.get(row.bucket);
    if (!bucket) {
      bucket = {
        bucket: row.bucket,
        label: period === 'week' ? `from ${formatDay(row.bucket)}` : formatDay(row.bucket),
        total: 0,
        upgrade: period === 'day' ? upgrades.find(u => u.day === row.bucket)?.version : undefined,
        values: {},
      };
      buckets.set(row.bucket, bucket);
    }
    const value = metric === 'cost' ? row.cost : tokensOf(row);
    const family = familyOf(row.model);
    bucket.values[family] = (bucket.values[family] ?? 0) + value;
    bucket.total += value;
  }
  return [...buckets.values()];
}

/** 0 for no usage, else 1–5 by share of the busiest cell. */
export function heatStep(value: number, max: number): number {
  return value > 0 && max > 0 ? Math.max(1, Math.ceil(value / max * HEAT_STEPS)) : 0;
}

const CAUSES: Record<Outlier['cause'], string> = {
  cacheRead: 'cache read',
  cacheWrite1h: '1h cache write',
  cacheWrite5m: '5m cache write',
  input: 'input',
  output: 'output',
};

/** "1h cache write, 554k tokens, after a 3 h 30 min pause". */
export function causeText(outlier: Outlier): string {
  const pause = outlier.pauseMs === undefined ? '' : `, after a ${formatDuration(outlier.pauseMs)} pause`;
  return `${CAUSES[outlier.cause]}, ${formatTokens(outlier.tokens)} tokens${pause}`;
}
