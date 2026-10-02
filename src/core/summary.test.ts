import { describe, expect, it } from 'vitest';

import type { Snapshot, UsageRecord } from './types.ts';

import { DAY_MS } from './calibration.ts';
import { buildSummary } from './summary.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const RESET = '2026-10-21T20:00:00.000Z';

/** $20 of Opus 5.5 output per record. */
function rec(ts: number, model = 'claude-opus-5-5'): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 0, key: `${ts}${model}`, model, output: 1_000_000, project: 'p', ts: new Date(ts).toISOString() };
}

function snap(ts: number, weekly: number, weeklyResetsAt: string, extra: Partial<Snapshot> = {}): Snapshot {
  return { source: 'endpoint', ts: new Date(ts).toISOString(), weekly, weeklyResetsAt, ...extra };
}

describe('buildSummary', () => {
  // One record per day at noon UTC for 3 weeks: $20/day.
  const records = Array.from({ length: 21 }, (_, i) => rec(NOW - (i + 1) * DAY_MS));

  it('shows the current week with a forecast and the plan conversions', () => {
    const windowStart = Date.parse(RESET) - 7 * DAY_MS;
    const snapshots = [1, 2, 3, 4].map(d => snap(windowStart + d * DAY_MS, d * 10, RESET));
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });

    expect(summary.plan).toBe('pro');
    expect(summary.current).toMatchObject({ resetsAt: RESET, weekly: 40 });
    // Each reading: d × 10 % against d × $20 → k = 0.5 %/$.
    expect(summary.calibration?.k).toBeCloseTo(0.5, 1);
    expect(summary.current?.forecast?.method).toBe('calibrated');
    expect(summary.weeks).toEqual([]);
    expect(summary.typical).toBeUndefined();
  });

  it('summarises completed weeks on every plan', () => {
    const snapshots = [
      snap(Date.parse('2026-10-07T19:00:00Z'), 40, '2026-10-07T20:00:00.000Z'),
      snap(Date.parse('2026-10-14T19:00:00Z'), 60, '2026-10-14T20:00:00.000Z'),
    ];
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });
    expect(summary.weeks.map(w => w.percent)).toEqual([40, 60]);
    expect(summary.typical).toMatchObject({ byPlan: { max20: 2.5, max5: 10, pro: 50 }, median: 50 });
    expect(summary.current).toBeUndefined();
  });

  it('buckets weekly usage on the reset anchor and daily usage by local day', () => {
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots: [snap(NOW, 10, RESET)], timeZone: 'UTC' });
    // The first record (29 Sep noon) falls in the window starting 23 Sep 20:00.
    expect(summary.weekly.map(row => row.bucket)).toEqual([
      '2026-09-23T20:00:00.000Z',
      '2026-09-30T20:00:00.000Z',
      '2026-10-07T20:00:00.000Z',
      '2026-10-14T20:00:00.000Z',
    ]);
    expect(summary.daily.at(-1)).toMatchObject({ bucket: '2026-10-19', cost: 20 });
  });

  it('flags unknown models and a detected plan that differs from a manual one', () => {
    const summary = buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [{ from: '2026-01-01T00:00:00Z', plan: 'pro', source: 'manual' }],
      records: [...records, rec(NOW - DAY_MS, 'claude-mystery-1')],
      snapshots: [snap(NOW, 10, RESET, { rateLimitTier: 'default_claude_max_5x', subscriptionType: 'max' })],
      timeZone: 'UTC',
    });
    expect(summary.unknownModels).toEqual(['claude-mystery-1']);
    expect(summary.detectedPlan).toBe('max5');
  });

  it('estimates the current % from usage since a stale reading', () => {
    const windowStart = Date.parse(RESET) - 7 * DAY_MS;
    // k = 0.5 %/$ from readings; the last one is 12 h old and $20/day was spent since (noon records).
    const snapshots = [1, 2, 3].map(d => snap(windowStart + d * DAY_MS, d * 10, RESET));
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });
    expect(summary.current?.weekly).toBe(30);
    expect(summary.current?.estimatedNow).toBeGreaterThan(30);
  });

  it('keeps a manual 5-hour reading for 5 hours', () => {
    const manual = (age: number) => buildSummary({
      endpointEnabled: false,
      now: NOW,
      planHistory: [],
      records: [],
      snapshots: [{ fiveHour: 35, source: 'manual', ts: new Date(NOW - age).toISOString(), weekly: 44, weeklyResetsAt: RESET }],
      timeZone: 'UTC',
    }).current?.fiveHour;
    expect(manual(3_600_000)).toBe(35);
    expect(manual(6 * 3_600_000)).toBeUndefined();
  });

  it('works without any data', () => {
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [], snapshots: [], timeZone: 'UTC' });
    expect(summary).toMatchObject({ current: undefined, daily: [], weekly: [], weeks: [] });
  });
});
