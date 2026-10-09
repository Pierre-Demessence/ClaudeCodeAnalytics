import { describe, expect, it } from 'vitest';

import type { SessionsInput } from './sessions.ts';
import type { ApiEvent, Snapshot, UsageRecord } from './types.ts';

import { buildSessions, fiveHourWindows, sessionPaces } from './sessions.ts';

/** $20 of Opus 5.5 output by default. */
function rec(ts: string, extra: Partial<UsageRecord> = {}): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\app', input: 0, key: ts + JSON.stringify(extra), model: 'claude-opus-5-5', output: 1_000_000, project: 'S--Dev-app', sessionId: 's1', ts, ...extra };
}

function snap(ts: string, fiveHourResetsAt: string | undefined, fiveHour?: number): Snapshot {
  return { fiveHour, fiveHourResetsAt, source: 'endpoint', ts, weekly: 10, weeklyResetsAt: '2026-10-08T00:00:00.000Z' };
}

/** Saturday 3 Oct 2026, 14:00 in Paris (UTC+2): the range starts Sun 27 Sep 00:00 local. */
const base: Omit<SessionsInput, 'records' | 'snapshots'> = {
  limitThreshold: 95,
  now: Date.parse('2026-10-03T12:00:00Z'),
  timeZone: 'Europe/Paris',
};
function sessions(records: UsageRecord[], snapshots: Snapshot[] = [], extra: Partial<SessionsInput> = {}) {
  return buildSessions({ ...base, records, snapshots, ...extra });
}

describe('reading windows', () => {
  it('builds one window per 5-hour reset, its peak the highest reading', () => {
    const { windows } = sessions([], [
      snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 30),
      snap('2026-10-02T11:00:00Z', '2026-10-02T12:50:00.000Z', 60),
      snap('2026-10-02T10:00:00Z', '2026-10-02T12:50:00.000Z', 45),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ cost: 0, end: '2026-10-02T12:50:00.000Z', messages: 0, peak: 60, source: 'reading', start: '2026-10-02T07:50:00.000Z' });
    expect(windows[0]!.capped).toBeUndefined();
  });

  it('has no peak without a 5-hour %, and manual readings anchor nothing', () => {
    const { windows } = sessions([rec('2026-10-02T08:00:00Z')], [
      snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z'),
      { fiveHour: 80, source: 'manual', ts: '2026-10-01T09:00:00Z', weekly: 10, weeklyResetsAt: '2026-10-08T00:00:00.000Z' },
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.peak).toBeUndefined();
  });

  it('counts the limit as hit from the threshold up, from readings only', () => {
    const readings = [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 96)];
    expect(sessions([], readings).windows[0]!.capped).toBe(true);
    expect(sessions([], readings, { limitThreshold: 100 }).windows[0]!.capped).toBeUndefined();
    // An estimate at 100% is not a reading.
    expect(sessions([rec('2026-10-01T09:00:00Z')], [], { k: 10 }).windows[0]).toMatchObject({ peak: 100, peakEstimated: true });
    expect(sessions([rec('2026-10-01T09:00:00Z')], [], { k: 10 }).windows[0]!.capped).toBeUndefined();
  });
});

describe('empty windows', () => {
  it('drops a message-less reading window under 5%, keeps it from 5%', () => {
    const window = (peak: number) => sessions([], [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', peak)]).windows;
    expect(window(2)).toHaveLength(0);
    expect(window(5)).toHaveLength(1);
    // A message makes a low-% window real.
    expect(sessions([rec('2026-10-02T08:00:00Z')], [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 2)]).windows).toHaveLength(1);
  });

  it('drops a reading window with no usage and no messages, keeps one with usage', () => {
    // A reset time read at 0% with no transcript message inside is noise.
    expect(sessions([], [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 0)]).windows).toHaveLength(0);
    // No 5-hour % at all and no message: also nothing happened.
    expect(sessions([], [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z')]).windows).toHaveLength(0);
    // A reading with usage but no priced messages is claude.ai use: keep it.
    expect(sessions([], [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 40)]).windows).toHaveLength(1);
    // A reading at 0% but with a message inside is real: keep it.
    expect(sessions([rec('2026-10-02T08:00:00Z')], [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 0)]).windows).toHaveLength(1);
  });
});

describe('estimated windows', () => {
  it('opens a window at a message outside every window, for 5 hours', () => {
    const { windows } = sessions([
      rec('2026-10-02T01:00:00Z'),
      rec('2026-10-02T05:59:00Z'),
      rec('2026-10-02T06:30:00Z'),
    ]);
    expect(windows.map(w => [w.start, w.end, w.messages, w.source])).toEqual([
      ['2026-10-02T06:30:00.000Z', '2026-10-02T11:30:00.000Z', 1, 'estimated'],
      ['2026-10-02T01:00:00.000Z', '2026-10-02T06:00:00.000Z', 2, 'estimated'],
    ]);
    expect(windows[1]!.cost).toBeCloseTo(40);
  });

  it('ends where the next reading window starts, and messages inside a reading window join it', () => {
    const { windows } = sessions(
      [rec('2026-10-02T06:00:00Z'), rec('2026-10-02T08:00:00Z'), rec('2026-10-02T12:00:00Z')],
      [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 50)],
    );
    expect(windows.map(w => [w.start, w.end, w.messages, w.source])).toEqual([
      ['2026-10-02T07:50:00.000Z', '2026-10-02T12:50:00.000Z', 2, 'reading'],
      ['2026-10-02T06:00:00.000Z', '2026-10-02T07:50:00.000Z', 1, 'estimated'],
    ]);
  });

  it('estimates the peak from the 5-hour calibration, without one leaves it out', () => {
    expect(sessions([rec('2026-10-01T09:00:00Z')], [], { k: 2 }).windows[0]).toMatchObject({ peak: 40, peakEstimated: true });
    const [window] = sessions([rec('2026-10-01T09:00:00Z')]).windows;
    expect(window!.peak).toBeUndefined();
    expect(window!.peakEstimated).toBeUndefined();
  });
});

describe('range and details', () => {
  it('keeps the windows overlapping the last 7 local days, newest first, and marks the one in progress', () => {
    const result = sessions([
      rec('2026-09-26T15:00:00Z'), // ends 20:00 UTC, before Sun 27 Sep 00:00 Paris (26 Sep 22:00 UTC)
      rec('2026-09-26T20:00:00Z'), // runs past the range start
      rec('2026-10-03T11:00:00Z'), // in progress
    ]);
    expect(result.days).toEqual(['2026-10-03', '2026-10-02', '2026-10-01', '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-27']);
    expect(result.windows.map(w => [w.start, w.inProgress])).toEqual([
      ['2026-10-03T11:00:00.000Z', true],
      ['2026-09-26T20:00:00.000Z', undefined],
    ]);
  });

  it('adds tomorrow on top while the window in progress runs past midnight', () => {
    // 22:00 Paris; the window opened at 21:30 ends at 02:30 on Sun 4 Oct.
    const result = sessions([rec('2026-10-03T19:30:00Z')], [], { now: Date.parse('2026-10-03T20:00:00Z') });
    expect(result.days).toEqual(['2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01', '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-27']);
    expect(result.windows[0]!.inProgress).toBe(true);
  });

  it('lists projects by cost, each conversation under the directory it started in', () => {
    const { windows } = sessions([
      rec('2026-10-02T01:00:00Z', { cwd: 'S:\\Dev\\app' }),
      rec('2026-10-02T01:10:00Z', { cwd: 'S:\\Dev\\app\\src' }),
      rec('2026-10-02T01:20:00Z', { cwd: 'S:\\Dev\\tool', output: 500_000, sessionId: 's2' }),
    ]);
    expect(windows[0]!.projects).toEqual([
      { name: 'app', cost: 40, path: 's:\\Dev\\app' },
      { name: 'tool', cost: 10, path: 's:\\Dev\\tool' },
    ]);
  });

  it('summarizes the windows, medians leaving out the one in progress', () => {
    const { stats } = sessions(
      [
        rec('2026-09-30T08:00:00Z'), // $20, estimated
        rec('2026-10-01T08:00:00Z', { output: 3_000_000 }), // $60, inside the reading window below
        rec('2026-10-03T11:00:00Z', { output: 10_000_000 }), // in progress
      ],
      [
        snap('2026-10-01T09:00:00Z', '2026-10-01T12:00:00.000Z', 97),
        snap('2026-10-02T09:00:00Z', '2026-10-02T12:00:00.000Z', 41), // claude.ai only
        snap('2026-10-03T11:30:00Z', '2026-10-03T15:00:00.000Z', 99), // in progress
      ],
    );
    // Windows: 30 Sep estimated, 1 Oct reading (97%), 2 Oct reading (41%, no message), 3 Oct reading in progress (99%).
    expect(stats).toEqual({ blocked: 0, capped: 2, count: 4, medianCost: 40, medianPeak: 69 });
  });

  it('has no medians without windows', () => {
    expect(sessions([]).stats).toEqual({ blocked: 0, capped: 0, count: 0, medianCost: undefined, medianPeak: undefined });
  });
});

describe('sessionPaces', () => {
  const input = { limitThreshold: 95, now: Date.parse('2026-10-03T12:00:00Z') };

  it('cuts sessions where the readings put the windows, not where messages suggest', () => {
    // A reading says the window ran 12:00–17:00: the 11:00 message belongs to an earlier window.
    const records = [rec('2026-10-02T11:00:00Z'), rec('2026-10-02T13:00:00Z')];
    const snapshots = [snap('2026-10-02T14:00:00Z', '2026-10-02T17:00:00.000Z', 20)];
    const windows = fiveHourWindows({ ...input, records, snapshots });
    // $20 over 5 hours each; guessing from messages alone would give one $40 session.
    expect(sessionPaces(windows, 0)).toEqual([4, 4]);
  });

  it('leaves out windows in progress, without messages, or before `from`', () => {
    const records = [rec('2026-10-01T08:00:00Z'), rec('2026-10-03T10:00:00Z')];
    const snapshots = [snap('2026-10-02T12:00:00Z', '2026-10-02T15:00:00.000Z', 5)];
    const windows = fiveHourWindows({ ...input, records, snapshots });
    expect(sessionPaces(windows, Date.parse('2026-10-02T00:00:00Z'))).toEqual([]);
    expect(sessionPaces(windows, 0)).toEqual([4]);
  });
});

describe('shift', () => {
  it('is the share of the cost saved if Opus ran on Sonnet', () => {
    const { windows } = sessions([
      rec('2026-10-02T09:00:00Z'),
      rec('2026-10-02T09:30:00Z', { model: 'claude-sonnet-5-5' }),
    ]);
    // $20 of Opus would cost $10 on Sonnet; the $10 Sonnet message stays.
    expect(windows[0]!.shift).toBeCloseTo(10 / 30);
  });

  it('is absent for a window without cost', () => {
    expect(sessions([], [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 30)]).windows[0]!.shift).toBeUndefined();
  });
});

describe('observed limit hits', () => {
  const hit = (ts: string, extra: Partial<ApiEvent> = {}): ApiEvent => ({ key: ts, kind: 'limit', limitType: 'five_hour', ts, ...extra });
  const readingWindow = [snap('2026-10-02T09:00:00Z', '2026-10-02T12:50:00.000Z', 80)];

  it('puts a hit in the window its reset time ends, apart from the inferred cap', () => {
    const { stats, windows } = sessions([rec('2026-10-02T09:00:00Z')], readingWindow, { hits: [hit('2026-10-02T12:20:00Z', { resetsAt: '2026-10-02T12:50:00.000Z' })] });
    expect(windows[0]).toMatchObject({ limitHits: ['2026-10-02T12:20:00Z'] });
    expect(windows[0]!.capped).toBeUndefined();
    expect(stats.blocked).toBe(1);
  });

  it('puts a hit in the window holding its time when no window ends at its reset time', () => {
    const { windows } = sessions([rec('2026-10-02T08:00:00Z')], [], { hits: [hit('2026-10-02T10:00:00Z', { resetsAt: '2026-10-02T13:10:00.000Z' })] });
    expect(windows[0]).toMatchObject({ limitHits: ['2026-10-02T10:00:00Z'], source: 'estimated' });
  });

  it('ignores a hit that falls in no window, and leaves other windows unmarked', () => {
    const { stats, windows } = sessions([rec('2026-10-02T09:00:00Z')], readingWindow, { hits: [hit('2026-09-29T10:00:00Z')] });
    expect(windows[0]!.limitHits).toBeUndefined();
    expect(stats.blocked).toBe(0);
  });
});
