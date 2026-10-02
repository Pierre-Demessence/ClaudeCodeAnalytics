import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { aggregate, createCostIndex, dailyCostSeries, dayKey } from './aggregate.ts';

function rec(ts: string, model = 'claude-opus-5-5', output = 1_000_000): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 0, key: ts + model, model, output, project: 'p', ts };
}

describe('dayKey', () => {
  it('uses the given time zone', () => {
    const ms = Date.parse('2026-10-01T23:30:00Z');
    expect(dayKey(ms, 'UTC')).toBe('2026-10-01');
    expect(dayKey(ms, 'Europe/Paris')).toBe('2026-10-02');
  });
});

describe('aggregate', () => {
  it('sums cost and tokens per bucket and model', () => {
    const rows = aggregate(
      [rec('2026-10-01T10:00:00Z'), rec('2026-10-01T11:00:00Z'), rec('2026-10-01T12:00:00Z', 'claude-haiku-4-5'), rec('2026-10-02T10:00:00Z')],
      ms => dayKey(ms, 'UTC'),
    );
    expect(rows).toEqual([
      { bucket: '2026-10-01', cacheRead: 0, cacheWrite: 0, cost: 5, input: 0, messages: 1, model: 'claude-haiku-4-5', output: 1_000_000 },
      { bucket: '2026-10-01', cacheRead: 0, cacheWrite: 0, cost: 40, input: 0, messages: 2, model: 'claude-opus-5-5', output: 2_000_000 },
      { bucket: '2026-10-02', cacheRead: 0, cacheWrite: 0, cost: 20, input: 0, messages: 1, model: 'claude-opus-5-5', output: 1_000_000 },
    ]);
  });
});

describe('createCostIndex', () => {
  it('sums cost in a half-open time range', () => {
    const cost = createCostIndex([rec('2026-10-01T10:00:00Z'), rec('2026-10-01T12:00:00Z'), rec('2026-10-01T14:00:00Z')]);
    expect(cost(Date.parse('2026-10-01T10:00:00Z'), Date.parse('2026-10-01T14:00:00Z'))).toBe(40);
    expect(cost(Date.parse('2026-10-01T15:00:00Z'), Date.parse('2026-10-02T00:00:00Z'))).toBe(0);
  });
});

describe('dailyCostSeries', () => {
  it('includes days without usage as zero', () => {
    const series = dailyCostSeries(
      [rec('2026-10-01T10:00:00Z'), rec('2026-10-03T10:00:00Z')],
      'UTC',
      '2026-10-01',
      '2026-10-03',
    );
    expect(series).toEqual([
      { cost: 20, day: '2026-10-01' },
      { cost: 0, day: '2026-10-02' },
      { cost: 20, day: '2026-10-03' },
    ]);
  });
});
