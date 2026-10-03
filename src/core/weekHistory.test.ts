import { describe, expect, it } from 'vitest';

import type { FiveHourWindow } from './sessions.ts';
import type { Snapshot, UsageRecord } from './types.ts';
import type { WeekHistoryInput } from './weekHistory.ts';

import { DAY_MS, WEEK_MS } from './calibration.ts';
import { buildWeekHistory } from './weekHistory.ts';

/** Thursday 1 Oct 2026, 07:00 UTC: the start of the running window. */
const START = Date.parse('2026-10-01T07:00:00Z');
/** Saturday 3 Oct 2026: day 3 of the running window. */
const NOW = Date.parse('2026-10-03T12:00:00Z');
/** Start of the window `i` weeks before the running one. */
const weekStart = (i: number) => START - i * WEEK_MS;
const iso = (ms: number) => new Date(ms).toISOString();

/** $20 of Opus 5.5 output by default. */
function rec(ms: number, extra: Partial<UsageRecord> = {}): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\app', input: 0, key: `${ms}${JSON.stringify(extra)}`, model: 'claude-opus-5-5', output: 1_000_000, project: 'S--Dev-app', sessionId: 's1', ts: iso(ms), ...extra };
}

/** A reading in the window `i` weeks before the running one. */
function snap(i: number, weekly = 40): Snapshot {
  return { source: 'endpoint', ts: iso(weekStart(i) + 2 * DAY_MS), weekly, weeklyResetsAt: iso(weekStart(i) + WEEK_MS) };
}

function session(startMs: number, extra: Partial<FiveHourWindow> = {}): FiveHourWindow {
  return { cost: 0, end: iso(startMs + 5 * 3_600_000), messages: 1, projects: [], source: 'reading', start: iso(startMs), ...extra };
}

const base: WeekHistoryInput = {
  now: NOW,
  plan: 'max5',
  records: [],
  sessionWindows: [],
  shares: [],
  snapshots: [],
  weekStartOf: ms => START + Math.floor((ms - START) / WEEK_MS) * WEEK_MS,
};
const weeks = (extra: Partial<WeekHistoryInput> = {}) => buildWeekHistory({ ...base, ...extra });

describe('windows', () => {
  it('has a row for each window with a reading or a message, newest first', () => {
    const { weeks: rows } = weeks({ records: [rec(weekStart(2) + DAY_MS)], snapshots: [snap(1)] });
    expect(rows.map(w => w.start)).toEqual([iso(weekStart(1)), iso(weekStart(2))]);
    expect(rows[0]).toMatchObject({ cost: 0, end: iso(weekStart(0)), messages: 0 });
    expect(rows[1]).toMatchObject({ cost: 20, messages: 1 });
  });

  it('adds the window in progress from the current week, even without messages', () => {
    const { weeks: rows } = weeks({ current: { resetsAt: iso(START + WEEK_MS), weekly: 0 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ end: iso(START + WEEK_MS), inProgress: true, start: iso(START) });
  });

  it('keeps the last 12', () => {
    const snapshots = Array.from({ length: 15 }, (_, i) => snap(i + 1));
    const { weeks: rows } = weeks({ snapshots });
    expect(rows).toHaveLength(12);
    expect(rows.at(-1)!.start).toBe(iso(weekStart(12)));
  });

  it('is empty without data', () => {
    expect(weeks()).toEqual({ stats: { hit: 0 }, weeks: [] });
  });
});

describe('days', () => {
  it('splits the cost in 24 h blocks from the window start', () => {
    const { weeks: rows } = weeks({
      records: [rec(START + 3_600_000), rec(START + DAY_MS - 1), rec(START + DAY_MS + 1)],
      snapshots: [snap(0)],
    });
    expect(rows[0]!.days.slice(0, 3)).toEqual([40, 20, 0]);
    expect(rows[0]!.cost).toBe(60);
  });

  it('leaves the blocks that start after now empty', () => {
    const { weeks: rows } = weeks({ records: [rec(START)], snapshots: [snap(0)] });
    // Now is 2 days 5 h in: blocks 0–2 have started.
    expect(rows[0]!.days).toEqual([20, 0, 0, null, null, null, null]);
  });

  it('fills a completed window completely', () => {
    const { weeks: rows } = weeks({ records: [rec(weekStart(1) + 6 * DAY_MS)] });
    expect(rows[0]!.days).toEqual([0, 0, 0, 0, 0, 0, 20]);
  });
});

describe('final percent', () => {
  const share = (i: number, percent: number, extra = {}) => ({ estimated: false, percent, plan: 'max5' as const, resetsAt: iso(weekStart(i) + WEEK_MS), ...extra });

  it('takes a completed window\'s final reading, converted to the current plan', () => {
    const { weeks: rows } = weeks({ plan: 'max20', shares: [share(1, 80)], snapshots: [snap(1)] });
    // Max 20× is 4 times Max 5×.
    expect(rows[0]).toMatchObject({ percent: 20, source: 'reading' });
    expect(rows[0]!.percentEstimated).toBeUndefined();
  });

  it('marks a reading extended from before the reset as estimated', () => {
    const { weeks: rows } = weeks({ shares: [share(1, 90, { estimated: true })], snapshots: [snap(1)] });
    expect(rows[0]).toMatchObject({ percent: 90, percentEstimated: true, source: 'reading' });
  });

  it('estimates a completed window without a reading from the calibration, capped at 100', () => {
    const records = [rec(weekStart(1) + DAY_MS), rec(weekStart(2) + DAY_MS)];
    const { weeks: rows } = weeks({ calibrationK: 3, records });
    expect(rows.map(w => w.percent)).toEqual([60, 60]);
    expect(rows[0]).toMatchObject({ percentEstimated: true, source: 'estimated' });
    expect(weeks({ calibrationK: 10, records }).weeks[0]!.percent).toBe(100);
  });

  it('has no percent without a reading or a calibration', () => {
    const { weeks: rows } = weeks({ records: [rec(weekStart(1) + DAY_MS)] });
    expect(rows[0]!.percent).toBeUndefined();
    expect(rows[0]!.cost).toBe(20);
  });

  it('shows the running window\'s estimate when there is one, else its reading', () => {
    const current = { resetsAt: iso(START + WEEK_MS), weekly: 38 };
    expect(weeks({ current: { ...current, estimatedNow: 44 } }).weeks[0]).toMatchObject({ percent: 44, percentEstimated: true, source: 'reading' });
    const reading = weeks({ current }).weeks[0]!;
    expect(reading.percent).toBe(38);
    expect(reading.percentEstimated).toBeUndefined();
  });

  it('marks a running window without a reading as estimated', () => {
    const { weeks: rows } = weeks({ current: { estimatedNow: 12, resetsAt: iso(START + WEEK_MS), weekly: 0, withoutReading: true } });
    expect(rows[0]).toMatchObject({ percent: 12, percentEstimated: true, source: 'estimated' });
  });
});

describe('hit', () => {
  const share = (percent: number) => ({ estimated: false, percent, plan: 'max5' as const, resetsAt: iso(weekStart(1) + WEEK_MS) });

  it('marks a window whose reading reached 100%', () => {
    expect(weeks({ shares: [share(100)], snapshots: [snap(1)] }).weeks[0]!.hit).toBe(true);
    expect(weeks({ shares: [share(99)], snapshots: [snap(1)] }).weeks[0]!.hit).toBeUndefined();
  });

  it('never counts a reading extended from before the reset, nor the running estimate', () => {
    const extended = weeks({ shares: [{ ...share(100), estimated: true }], snapshots: [snap(1)] }).weeks[0]!;
    expect(extended).toMatchObject({ percent: 100, percentEstimated: true });
    expect(extended.hit).toBeUndefined();
    const running = weeks({ current: { estimatedNow: 100, resetsAt: iso(START + WEEK_MS), weekly: 90 } });
    expect(running.weeks[0]!.hit).toBeUndefined();
    expect(running.stats.hit).toBe(0);
  });

  it('never counts an estimate from transcripts', () => {
    const { weeks: rows } = weeks({ calibrationK: 10, records: [rec(weekStart(1) + DAY_MS)] });
    expect(rows[0]).toMatchObject({ percent: 100, source: 'estimated' });
    expect(rows[0]!.hit).toBeUndefined();
  });
});

describe('sessions', () => {
  it('counts the 5-hour windows started in each week, and those that hit the limit', () => {
    const { weeks: rows } = weeks({
      records: [rec(weekStart(1) + DAY_MS), rec(START + DAY_MS)],
      sessionWindows: [
        session(START + DAY_MS, { capped: true }),
        session(START + 2 * DAY_MS),
        session(weekStart(1) + DAY_MS),
        // Started before the window opened: belongs to the previous one.
        session(START - 3_600_000, { capped: true }),
      ],
    });
    expect(rows.map(w => [w.sessions, w.cappedSessions])).toEqual([[2, 1], [2, 1]]);
  });
});

describe('projects', () => {
  it('lists the five costliest, with the total count', () => {
    const records = Array.from({ length: 7 }, (_, i) => rec(START + 1000 * i, { cwd: `S:\\Dev\\p${i}`, output: 1_000_000 * (i + 1), sessionId: `s${i}` }));
    const { weeks: rows } = weeks({ records });
    expect(rows[0]!.projectCount).toBe(7);
    expect(rows[0]!.projects.map(p => p.name)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2']);
  });
});

describe('stats', () => {
  it('counts the windows that hit, and takes medians over the completed ones', () => {
    const share = (i: number, percent: number) => ({ estimated: false, percent, plan: 'max5' as const, resetsAt: iso(weekStart(i) + WEEK_MS) });
    const { stats } = weeks({
      current: { resetsAt: iso(START + WEEK_MS), weekly: 95 },
      records: [rec(START + 1000), rec(weekStart(1) + 1000), rec(weekStart(1) + 2000), rec(weekStart(2) + 1000), rec(weekStart(2) + 2000), rec(weekStart(2) + 3000)],
      shares: [share(1, 60), share(2, 100)],
      snapshots: [snap(1), snap(2)],
    });
    // The running window (95%, $20) is left out of the medians.
    expect(stats).toMatchObject({ hit: 1, medianCost: 50, medianPercent: 80 });
  });

  it('leaves the cost median without messages out of windows that had none', () => {
    const { stats } = weeks({ records: [rec(weekStart(1) + 1000)], shares: [], snapshots: [snap(1), snap(2)] });
    expect(stats.medianCost).toBe(20);
  });
});

describe('shift', () => {
  const sonnet = (ms: number) => rec(ms, { model: 'claude-sonnet-5-5' });

  it('is the share of the cost saved if Opus ran on Sonnet', () => {
    // $20 of Opus 5.5 output would cost $10 on Sonnet 5.5; a $10 Sonnet message stays.
    const { weeks: rows } = weeks({ records: [rec(weekStart(1) + DAY_MS), sonnet(weekStart(1) + DAY_MS)], snapshots: [snap(1)] });
    expect(rows[0]!.shift).toBeCloseTo(10 / 30);
  });

  it('is zero without Opus and absent without cost', () => {
    const { weeks: rows } = weeks({ records: [sonnet(weekStart(2) + DAY_MS)], snapshots: [snap(1)] });
    expect(rows.find(w => w.start === iso(weekStart(2)))!.shift).toBe(0);
    expect(rows.find(w => w.start === iso(weekStart(1)))!.shift).toBeUndefined();
  });
});
