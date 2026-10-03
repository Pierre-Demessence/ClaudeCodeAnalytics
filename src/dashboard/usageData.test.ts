import { describe, expect, it } from 'vitest';

import type { UsageRow } from '@/core/aggregate';

import { causeText, heatStep, toBuckets } from '@/dashboard/usageData';

function row(bucket: string, model: string, cost: number): UsageRow {
  return { bucket, cacheRead: 0, cacheWrite: 0, cost, input: 0, messages: 1, model, output: 10 };
}

describe('toBuckets', () => {
  const rows = [row('2026-10-01', 'claude-opus-5-5', 3), row('2026-10-01', 'claude-sonnet-5-5', 2), row('2026-10-02', 'claude-opus-4-8', 1)];
  const upgrades = [{ day: '2026-10-02', version: '2.1.287' }];

  it('sums families per bucket and marks upgrade days', () => {
    expect(toBuckets(rows, 'cost', 'day', upgrades)).toEqual([
      { bucket: '2026-10-01', label: '1 Oct', total: 5, upgrade: undefined, values: { opus: 3, sonnet: 2 } },
      { bucket: '2026-10-02', label: '2 Oct', total: 1, upgrade: '2.1.287', values: { opus: 1 } },
    ]);
  });

  it('marks no upgrade on weekly buckets', () => {
    expect(toBuckets(rows, 'tokens', 'week', [{ day: '2026-10-01', version: '2.1.287' }]).map(b => [b.label, b.upgrade, b.total])).toEqual([
      ['from 1 Oct', undefined, 20],
      ['from 2 Oct', undefined, 10],
    ]);
  });
});

describe('heatStep', () => {
  it('maps a value to 1–5 by share of the busiest cell, 0 when empty', () => {
    expect([0, 0.01, 2, 5, 10].map(v => heatStep(v, 10))).toEqual([0, 1, 1, 3, 5]);
    expect(heatStep(0, 0)).toBe(0);
  });
});

describe('causeText', () => {
  it('names the cost component, its tokens and the pause', () => {
    const outlier = { name: 'app', cause: 'cacheWrite1h' as const, cost: 4.4, path: 'app', tokens: 554_000, ts: '2026-10-01T10:00:00Z' };
    expect(causeText(outlier)).toBe('1h cache write, 554k tokens');
    expect(causeText({ ...outlier, pauseMs: 3.5 * 3_600_000 })).toBe('1h cache write, 554k tokens, after a 3 h 30 min pause');
  });
});
