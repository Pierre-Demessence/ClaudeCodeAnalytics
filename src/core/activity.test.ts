import { describe, expect, it } from 'vitest';

import type { ActivityInput } from './activity.ts';
import type { UsageRecord } from './types.ts';

import { buildActivity } from './activity.ts';

/** Opus 5.5: $20 per million output tokens, $4 input, $0.2 cache read, $5 5-minute write, $8 1-hour write. */
function rec(ts: string, extra: Partial<UsageRecord> = {}): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\app', input: 0, key: ts + JSON.stringify(extra), model: 'claude-opus-5-5', output: 0, project: 'S--Dev-app', sessionId: 's1', ts, ...extra };
}

/** Saturday 3 Oct 2026, 14:00 in Paris (UTC+2); the weekly window started Thursday. */
const base: Omit<ActivityInput, 'records'> = {
  chartFrom: '2026-08-30',
  now: Date.parse('2026-10-03T12:00:00Z'),
  timeZone: 'Europe/Paris',
  weekStart: Date.parse('2026-10-01T00:00:00Z'),
};
const activity = (records: UsageRecord[], extra: Partial<ActivityInput> = {}) => buildActivity({ ...base, records, ...extra });

describe('heatmap', () => {
  it('averages cost per weekday and local hour over the last 28 days', () => {
    const { heatmap } = activity([
      rec('2026-09-01T10:00:00Z', { output: 1_000_000 }), // before the range
      rec('2026-10-01T10:30:00Z', { output: 1_000_000 }), // Thu 12:30
      rec('2026-09-28T22:30:00Z', { output: 200_000 }), // Tue 00:30 local, Mon in UTC
    ]);
    expect(heatmap.from).toBe('2026-09-06');
    expect(heatmap.to).toBe('2026-10-03');
    // 28 days hold 4 of each weekday.
    expect(heatmap.cells[3]![12]).toBeCloseTo(5);
    expect(heatmap.cells[1]![0]).toBeCloseTo(1);
    expect(heatmap.cells[0]!.every(v => v === 0)).toBe(true);
  });

  it('starts at the first imported day, counting only the weekdays it holds', () => {
    const { heatmap } = activity([rec('2026-10-01T10:30:00Z', { output: 1_000_000 })]);
    expect(heatmap.from).toBe('2026-10-01');
    expect(heatmap.cells[3]![12]).toBeCloseTo(20);
    expect(heatmap.cells[0]![12]).toBe(0);
  });
});

describe('cache', () => {
  it('measures the week\'s cache-read share, savings and write cost share', () => {
    const { cache } = activity([
      rec('2026-09-30T10:00:00Z', { cacheRead: 5_000_000 }), // before the week
      rec('2026-10-01T10:00:00Z', { cacheRead: 900_000, input: 100_000 }),
      rec('2026-10-02T10:00:00Z', { cacheWrite5m: 1_000_000 }),
    ]);
    expect(cache.week!.readShare).toBeCloseTo(0.45);
    // 0.9 M tokens at $4 instead of $0.2.
    expect(cache.week!.saved).toBeCloseTo(3.42);
    expect(cache.week!.writeCostShare).toBeCloseTo(5 / 5.58);
  });

  it('gives the daily share over 14 local days, none on days without usage', () => {
    const { cache } = activity([rec('2026-10-01T10:00:00Z', { cacheRead: 300, input: 100 })]);
    expect(cache.daily).toHaveLength(14);
    expect(cache.daily[0]).toEqual({ day: '2026-09-20' });
    expect(cache.daily.find(d => d.day === '2026-10-01')).toEqual({ day: '2026-10-01', readShare: 0.75 });
  });

  it('has no week figures without usage this week', () => {
    expect(activity([rec('2026-09-30T10:00:00Z', { cacheRead: 100 })]).cache.week).toBeUndefined();
  });
});

describe('messageCost', () => {
  it('bins the week\'s message costs, an edge going to the higher bin', () => {
    const { messageCost } = activity([
      rec('2026-10-01T10:00:00Z', { output: 250 }), // $0.005
      rec('2026-10-01T10:01:00Z', { output: 1_000 }), // $0.02
      rec('2026-10-01T10:02:00Z', { output: 25_000 }), // $0.50
      rec('2026-10-01T10:03:00Z', { output: 50_000 }), // $1
      rec('2026-10-01T10:04:00Z', { output: 750_000 }), // $15
      rec('2026-09-30T10:00:00Z', { output: 250 }), // before the week
    ]);
    expect(messageCost.bins).toEqual([1, 1, 0, 0, 1, 1, 0, 1]);
  });

  it('lists the 5 costliest messages of $1 or more, with the count', () => {
    const records = [1, 2, 3, 4, 5, 6].map(n => rec(`2026-10-01T1${n}:00:00Z`, { output: n * 100_000 }));
    records.push(rec('2026-10-02T10:00:00Z', { output: 40_000 })); // $0.80
    const { messageCost } = activity(records);
    expect(messageCost.outlierCount).toBe(6);
    expect(messageCost.outliers.map(o => o.cost)).toEqual([12, 10, 8, 6, 4].map(c => expect.closeTo(c)));
    expect(messageCost.outliers[0]).toMatchObject({ name: 'app', cause: 'output', tokens: 600_000 });
    expect(messageCost.outliers[0]!.pauseMs).toBeUndefined();
  });

  it('names the cache write that dominates and the pause that let the cache expire', () => {
    const { messageCost } = activity([
      rec('2026-10-01T10:00:00Z', { cwd: 'S:\\Dev\\app' }),
      rec('2026-10-01T13:30:00Z', { cacheWrite1h: 500_000, cwd: 'S:\\Dev\\app\\src' }),
      rec('2026-10-01T13:32:00Z', { cacheWrite5m: 300_000 }),
      rec('2026-10-01T15:00:00Z', { cacheWrite1h: 200_000, sessionId: 's2' }),
    ]);
    expect(messageCost.outliers[0]).toMatchObject({ name: 'app', cause: 'cacheWrite1h', pauseMs: 3.5 * 3_600_000, tokens: 500_000 });
    // A new conversation has no previous message; 2 minutes is within the 5-minute cache.
    expect(messageCost.outliers.slice(1).map(o => [o.cause, o.pauseMs])).toEqual([['cacheWrite1h', undefined], ['cacheWrite5m', undefined]]);
  });
});

describe('upgrades', () => {
  it('marks the days on which the highest version seen rose, once per day', () => {
    const { upgrades } = activity([
      rec('2026-08-20T10:00:00Z', { version: '2.1.280' }), // first version: not an upgrade
      rec('2026-08-25T10:00:00Z', { version: '2.1.283' }), // before the chart
      rec('2026-09-28T10:00:00Z', { version: '2.1.284' }),
      rec('2026-09-29T10:00:00Z', { version: '2.1.281' }), // an older surface
      rec('2026-09-30T08:00:00Z', { version: '2.1.285' }),
      rec('2026-09-30T20:00:00Z', { version: '2.1.286' }),
      rec('2026-10-01T10:00:00Z', { version: undefined }),
    ]);
    expect(upgrades).toEqual([
      { day: '2026-09-28', version: '2.1.284' },
      { day: '2026-09-30', version: '2.1.286' },
    ]);
  });
});
