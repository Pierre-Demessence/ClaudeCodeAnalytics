import { describe, expect, it } from 'vitest';

import type { Snapshot, UsageRecord } from './types.ts';

import { DAY_MS } from './calibration.ts';
import { buildSummary, weekStartFor } from './summary.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const RESET = '2026-10-21T20:00:00.000Z';

/** $20 of Opus 5.5 output per record. */
function rec(ts: number, model = 'claude-opus-5-5'): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 0, key: `${ts}${model}`, model, output: 1_000_000, project: 'p', ts: new Date(ts).toISOString() };
}

function snap(ts: number, weekly: number, weeklyResetsAt: string, extra: Partial<Snapshot> = {}): Snapshot {
  return { source: 'endpoint', ts: new Date(ts).toISOString(), weekly, weeklyResetsAt, ...extra };
}

describe('weekStartFor', () => {
  const h = 3_600_000;
  // The reset moved from Wednesday 20:00 to Thursday 08:00 between two weeks.
  const resets = [Date.parse('2026-10-07T20:00:00Z'), Date.parse('2026-10-15T08:00:00Z')];

  it('uses the window of the next reset', () => {
    expect(weekStartFor(Date.parse('2026-10-05T00:00:00Z'), resets)).toBe(resets[0]! - 7 * DAY_MS);
    expect(weekStartFor(Date.parse('2026-10-10T00:00:00Z'), resets)).toBe(resets[1]! - 7 * DAY_MS);
  });

  it('steps back whole weeks before the first reading and forward after the last', () => {
    expect(weekStartFor(Date.parse('2026-09-25T00:00:00Z'), resets)).toBe(resets[0]! - 14 * DAY_MS);
    expect(weekStartFor(resets[1]! + h, resets)).toBe(resets[1]);
  });
});

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

  it('starts a new week without a reading at 0 %, projected from the typical week', () => {
    const lastReset = Date.parse('2026-10-14T20:00:00Z');
    const now = lastReset + 2 * 3_600_000;
    const snapshots = [
      snap(Date.parse('2026-10-07T19:00:00Z'), 40, '2026-10-07T20:00:00.000Z'),
      snap(Date.parse('2026-10-14T19:00:00Z'), 60, '2026-10-14T20:00:00.000Z'),
    ];
    const summary = buildSummary({ endpointEnabled: true, now, planHistory: [], records: records.filter(r => Date.parse(r.ts) < lastReset), snapshots, timeZone: 'UTC' });
    expect(summary.current).toMatchObject({ resetsAt: '2026-10-21T20:00:00.000Z', weekly: 0, withoutReading: true });
    expect(summary.current?.estimatedNow).toBeUndefined();
    expect(summary.current?.forecast).toMatchObject({ median: 50, method: 'typical' });
    expect(summary.current?.pacing.points).toEqual([{ at: lastReset, percent: 0 }]);
  });

  it('keeps the typical week for an uncalibrated week without a reading, even past its first hours', () => {
    const lastReset = Date.parse('2026-10-14T20:00:00Z');
    const snapshots = [
      snap(Date.parse('2026-10-07T19:00:00Z'), 40, '2026-10-07T20:00:00.000Z'),
      snap(Date.parse('2026-10-14T19:00:00Z'), 60, '2026-10-14T20:00:00.000Z'),
    ];
    const summary = buildSummary({ endpointEnabled: true, now: lastReset + 3 * DAY_MS, planHistory: [], records: records.filter(r => Date.parse(r.ts) < lastReset), snapshots, timeZone: 'UTC' });
    expect(summary.current?.forecast).toMatchObject({ median: 50, method: 'typical' });
  });

  it('estimates a week without a reading from transcripts when calibrated', () => {
    const windowStart = Date.parse(RESET) - 7 * DAY_MS;
    // Calibrated on last week's readings (k = 0.5 %/$); nothing read since the reset.
    const lastWeek = Date.parse(RESET) - 14 * DAY_MS;
    const lastReset = new Date(windowStart).toISOString();
    const snapshots = [1, 2, 3, 4].map(d => snap(lastWeek + d * DAY_MS, d * 10, lastReset));
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });
    expect(summary.current).toMatchObject({ resetsAt: RESET, weekly: 0, withoutReading: true });
    // $20 a day for 5 days since the reset at 0.5 %/$.
    expect(summary.current?.estimatedNow).toBeCloseTo(50, 0);
  });

  it('has no current week without a reading, a calibration and an idle week', () => {
    const snapshots = [snap(Date.parse('2026-10-14T19:00:00Z'), 60, '2026-10-14T20:00:00.000Z')];
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });
    expect(summary.current).toBeUndefined();
  });

  it('estimates the current % from usage since a stale reading', () => {
    const windowStart = Date.parse(RESET) - 7 * DAY_MS;
    // k = 0.5 %/$ from readings; the last one is 12 h old and $20/day was spent since (noon records).
    const snapshots = [1, 2, 3].map(d => snap(windowStart + d * DAY_MS, d * 10, RESET));
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });
    expect(summary.current?.weekly).toBe(30);
    expect(summary.current?.estimatedNow).toBeGreaterThan(30);
  });

  it('forecasts the 5-hour window from the calibrated session pace', () => {
    const at = (time: string) => Date.parse(`2026-10-20T${time}:00Z`);
    // Today's session opened at 10:00 and resets at 15:00; $20 per record.
    const today = [at('10:00'), at('11:00'), at('11:55')].map(ts => rec(ts));
    const fiveHourResetsAt = '2026-10-20T15:00:00.000Z';
    // 10 % for $20, 20 % for $40: k = 0.5 %/$.
    const snapshots = [['10:30', 10], ['11:30', 20], ['11:50', 20]].map(([time, fiveHour]) =>
      snap(at(time as string), 30, RESET, { fiveHour: fiveHour as number, fiveHourResetsAt }));
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [...records, ...today], snapshots, timeZone: 'UTC' });

    expect(summary.fiveHourCalibration?.k).toBeCloseTo(0.5);
    // The 11:55 record ($20) adds 10 points since the last reading.
    expect(summary.current?.fiveHourEstimatedNow).toBeCloseTo(30);
    // Past sessions: one $20 record each, so $4/hour × 0.5 %/$ × 3 hours left = 6 points.
    expect(summary.current?.fiveHourForecast).toMatchObject({ method: 'calibrated' });
    expect(summary.current?.fiveHourForecast?.median).toBeCloseTo(36);
  });

  it('keeps a manual 5-hour reading for 5 hours', () => {
    const manual = (age: number) => buildSummary({
      endpointEnabled: false,
      now: NOW,
      planHistory: [],
      records: [],
      snapshots: [{ fiveHour: 35, source: 'manual', ts: new Date(NOW - age).toISOString(), weekly: 44, weeklyResetsAt: RESET }],
      timeZone: 'UTC',
    }).current;
    // Without a reset time the window's position is unknown: no 5-hour forecast.
    expect(manual(3_600_000)).toMatchObject({ fiveHour: 35, fiveHourForecast: undefined });
    expect(manual(6 * 3_600_000)?.fiveHour).toBeUndefined();
  });

  it('works without any data', () => {
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [], snapshots: [], timeZone: 'UTC' });
    expect(summary).toMatchObject({ current: undefined, daily: [], weekly: [], weeks: [] });
  });
});
