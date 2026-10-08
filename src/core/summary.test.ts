import { describe, expect, it } from 'vitest';

import type { Snapshot, UsageRecord } from './types.ts';

import { DAY_MS, HOUR_MS } from './calibration.ts';
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
  });

  it('lists the completed weeks', () => {
    const snapshots = [
      snap(Date.parse('2026-10-07T19:00:00Z'), 40, '2026-10-07T20:00:00.000Z'),
      snap(Date.parse('2026-10-14T19:00:00Z'), 60, '2026-10-14T20:00:00.000Z'),
    ];
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });
    expect(summary.weeks.map(w => w.percent)).toEqual([40, 60]);
    expect(summary.current).toBeUndefined();
  });

  it('feeds the Plans tab with the completed weeks and the multiplier checks', () => {
    const snapshots = [
      snap(Date.parse('2026-10-07T19:00:00Z'), 40, '2026-10-07T20:00:00.000Z'),
      snap(Date.parse('2026-10-14T19:00:00Z'), 60, '2026-10-14T20:00:00.000Z'),
    ];
    const { multipliers, planFit } = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });
    expect(planFit.plan).toBe('pro');
    expect(planFit.weeks.map(w => w.demand)).toEqual([40, 60]);
    expect(planFit.weeklyBudget).toBeUndefined();
    expect(multipliers.map(m => [m.from, m.to, m.measured])).toEqual([['pro', 'max5', undefined], ['max5', 'max20', undefined]]);
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
    expect(summary).toMatchObject({ detected: 'max5', planSource: 'manual' });
  });

  it('reports the raw detection even when it matches the plan, and no source without history', () => {
    const detected = buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [],
      records: [],
      snapshots: [snap(NOW, 10, RESET, { rateLimitTier: 'default_claude_max_5x', subscriptionType: 'max' })],
      timeZone: 'UTC',
    });
    expect(detected).toMatchObject({ detected: 'max5', detectedPlan: 'max5', planSource: undefined });
    const same = buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [{ from: '2026-01-01T00:00:00Z', plan: 'max5', source: 'detected' }],
      records: [],
      snapshots: [snap(NOW, 10, RESET, { rateLimitTier: 'default_claude_max_5x', subscriptionType: 'max' })],
      timeZone: 'UTC',
    });
    expect(same).toMatchObject({ detected: 'max5', detectedPlan: undefined, planSource: 'detected' });
  });

  it('builds the limit drift from the readings and the first imported message', () => {
    const snapshots = [snap(NOW, 10, RESET)];
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' });
    expect(summary.limits.readings).toEqual(snapshots);
    expect(summary.limits.readingsPerPeriod).toEqual([]);
    // The window started 14 Oct, after the first record: 10 % over the 5 noon records of 15–19 Oct, $100.
    expect(summary.limits.drift).toMatchObject([{ current: true, resetsAt: RESET }]);
    expect(summary.limits.drift[0]!.ratio).toBeCloseTo(10);
  });

  it('builds the week history, the running window first with its reading', () => {
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots: [snap(NOW, 10, RESET)], timeZone: 'UTC' });
    expect(summary.weekHistory.weeks[0]).toMatchObject({ cost: 100, end: RESET, inProgress: true, messages: 5, percent: 10, start: '2026-10-14T20:00:00.000Z' });
    expect(summary.weekHistory.weeks[0]!.sessions).toBe(5);
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
    expect(summary.fiveHourSession?.estimatedNow).toBeCloseTo(30);
    // Past sessions: one $20 record each, so $4/hour × 0.5 %/$ × 3 hours left = 6 points.
    expect(summary.fiveHourSession?.forecast).toMatchObject({ method: 'calibrated' });
    expect(summary.fiveHourSession?.forecast?.median).toBeCloseTo(36);
  });

  it('gives the active use left at the usual active pace', () => {
    const at = (time: string) => Date.parse(`2026-10-20T${time}:00Z`);
    // $60 over 20 active minutes: $180 per active hour.
    const today = [at('10:00'), at('10:10'), at('10:20')].map(ts => rec(ts));
    const fiveHourResetsAt = '2026-10-20T15:00:00.000Z';
    // Both windows: 10 % per $20 record.
    const snapshots = [['10:05', 10], ['10:15', 20], ['10:25', 30]].map(([time, percent]) =>
      snap(at(time as string), percent as number, RESET, { fiveHour: percent as number, fiveHourResetsAt }));
    // An old record, outside the 4-week pace, so the weekly window counts as fully imported.
    const old = rec(NOW - 40 * DAY_MS);
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [old, ...today], snapshots, timeZone: 'UTC' });

    const k = summary.fiveHourCalibration?.k;
    expect(k).toBeDefined();
    expect(summary.fiveHourSession?.activeLeftMs).toBeCloseTo((100 - 30) / k! / 180 * HOUR_MS);
    const weeklyK = summary.calibration?.k;
    expect(weeklyK).toBeDefined();
    expect(summary.current?.activeLeftMs).toBeCloseTo((100 - 30) / weeklyK! / 180 * HOUR_MS);
  });

  it('gives the active use left per model family and names the family in use', () => {
    const at = (time: string) => Date.parse(`2026-10-20T${time}:00Z`);
    const today = [rec(at('10:00')), rec(at('10:10'), 'claude-sonnet-4-6'), rec(at('10:20'), 'claude-sonnet-4-6')];
    const fiveHourResetsAt = '2026-10-20T15:00:00.000Z';
    const snapshots = [['10:05', 10], ['10:15', 20], ['10:25', 30]].map(([time, percent]) =>
      snap(at(time as string), percent as number, RESET, { fiveHour: percent as number, fiveHourResetsAt }));
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [rec(NOW - 40 * DAY_MS), ...today], snapshots, timeZone: 'UTC' });

    expect(summary.currentFamily).toBe('sonnet');
    const weekly = summary.current!.activeLeftByFamily!;
    expect(weekly.map(f => f.family)).toEqual(['opus', 'sonnet']);
    // Little active time in either family: both are estimates, and Opus is the pricier one.
    expect(weekly.every(f => f.lowConfidence)).toBe(true);
    expect(weekly[0]!.ms).toBeLessThan(weekly[1]!.ms);
    expect(summary.fiveHourSession!.activeLeftByFamily!.map(f => f.family)).toEqual(['opus', 'sonnet']);
  });

  it('lists the 5-hour windows, estimated peaks from the 5-hour calibration', () => {
    const at = (time: string) => Date.parse(`2026-10-20T${time}:00Z`);
    const fiveHourResetsAt = '2026-10-20T15:00:00.000Z';
    // 10 % for $20, 20 % for $40: k = 0.5 %/$.
    const snapshots = [['10:30', 10], ['11:30', 20], ['11:50', 20]].map(([time, fiveHour]) =>
      snap(at(time as string), 30, RESET, { fiveHour: fiveHour as number, fiveHourResetsAt }));
    const input = { endpointEnabled: true, now: NOW, planHistory: [], records: [...records, rec(at('10:00')), rec(at('11:00'))], snapshots, timeZone: 'UTC' };

    const summary = buildSummary(input);
    expect(summary.limitThreshold).toBe(95);
    expect(summary.weekLimitThreshold).toBe(98);
    expect(summary.sessions.windows[0]).toMatchObject({ inProgress: true, peak: 20, source: 'reading', start: '2026-10-20T10:00:00.000Z' });
    // Yesterday's $20 at k = 0.5 %/$.
    expect(summary.sessions.windows[1]).toMatchObject({ peak: 10, peakEstimated: true, source: 'estimated' });
    expect(buildSummary({ ...input, limitThreshold: 20 }).sessions.stats.capped).toBe(1);
  });

  it('keeps a manual 5-hour reading for 5 hours', () => {
    const manual = (age: number) => buildSummary({
      endpointEnabled: false,
      now: NOW,
      planHistory: [],
      records: [],
      snapshots: [{ fiveHour: 35, source: 'manual', ts: new Date(NOW - age).toISOString(), weekly: 44, weeklyResetsAt: RESET }],
      timeZone: 'UTC',
    }).fiveHourSession;
    // Without a reset time the window's position is unknown: no 5-hour forecast.
    expect(manual(3_600_000)?.percent).toBe(35);
    expect(manual(3_600_000)?.forecast).toBeUndefined();
    expect(manual(6 * 3_600_000)).toBeUndefined();
  });

  it('keeps a valid 5-hour reading when the new week has no calibration yet', () => {
    // The weekly window reset 2 hours ago; the last reading came just before, and a message since makes the week non-zero.
    const resetAt = NOW - 2 * 3_600_000;
    const summary = buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [],
      records: [rec(NOW - 3_600_000)],
      snapshots: [snap(NOW - 2.5 * 3_600_000, 50, new Date(resetAt).toISOString(), { fiveHour: 30, fiveHourResetsAt: new Date(NOW + 2 * 3_600_000).toISOString() })],
      timeZone: 'UTC',
    });
    expect(summary.current).toBeUndefined();
    expect(summary.fiveHourSession).toMatchObject({ percent: 30 });
  });

  it('breaks usage down for this week, the last 4 weeks and all time', () => {
    const older = rec(NOW - 30 * DAY_MS);
    const summary = buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [],
      records: [...records.map(r => ({ ...r, sessionId: 's1' })), older],
      snapshots: [snap(NOW, 10, RESET)],
      timeZone: 'UTC',
      titles: { s1: { title: 'Daily work' } },
    });
    // This week starts 14 Oct 20:00: records of 15–19 Oct.
    expect(summary.breakdown.week.total).toEqual({ cost: 100, messages: 5 });
    // Four windows back: from 23 Sep 20:00, which leaves out the 20 Sep record.
    expect(summary.breakdown.fourWeeks.total).toEqual({ cost: 420, messages: 21 });
    expect(summary.breakdown.all.total).toEqual({ cost: 440, messages: 22 });
    expect(summary.breakdown.week.conversations[0]?.title).toBe('Daily work');
    // Message costs share the Breakdown's week: 5 messages of $20.
    expect(summary.activity.messageCost.bins.reduce((a, b) => a + b)).toBe(5);
    expect(summary.activity.messageCost.outlierCount).toBe(5);
  });

  it('starts this week on local Monday before any reading', () => {
    const sunday = rec(Date.parse('2026-10-18T23:00:00Z'));
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [sunday], snapshots: [], timeZone: 'Europe/Paris' });
    // Sunday 23:00 UTC is Monday 01:00 in Paris.
    expect(summary.breakdown.week.total.messages).toBe(1);
    const utc = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [sunday], snapshots: [], timeZone: 'UTC' });
    expect(utc.breakdown.week.total.messages).toBe(0);
  });

  it('works without any data', () => {
    const summary = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [], snapshots: [], timeZone: 'UTC' });
    expect(summary).toMatchObject({ current: undefined, daily: [], weekly: [], weeks: [] });
    expect(summary.activity.cache.week).toBeUndefined();
    expect(summary.activity.heatmap.cells.flat().every(v => v === 0)).toBe(true);
  });
});
