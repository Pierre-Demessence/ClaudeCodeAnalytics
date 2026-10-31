import { describe, expect, it } from 'vitest';

import type { FiveHourWindow } from './sessions.ts';
import type { ApiEvent, Snapshot, UsageRecord } from './types.ts';
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
  planHistory: [],
  records: [],
  sessionWindows: [],
  shares: [],
  snapshots: [],
  weekLimitThreshold: 98,
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
    expect(weeks()).toEqual({ stats: { blocked: 0, hit: 0 }, weeks: [] });
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
    // Ultra is twice Max.
    expect(rows[0]).toMatchObject({ percent: 40, source: 'reading' });
    expect(rows[0]!.percentEstimated).toBeUndefined();
  });

  it('keeps the % on the plan the week was read on, for the Weeks tab to show', () => {
    // A Pro week at its limit is 20% of Max; the window in progress is read on the current plan.
    const { weeks: rows } = weeks({ current: { resetsAt: iso(START + WEEK_MS), weekly: 38 }, shares: [share(1, 100, { plan: 'pro' })], snapshots: [snap(1, 100)] });
    expect(rows[1]).toMatchObject({ percent: 20, plan: 'pro', planPercent: 100 });
    expect(rows[0]).toMatchObject({ percent: 38, plan: 'max5', planPercent: 38 });
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

  it('marks an estimated window that started before the oldest transcript with where the transcripts start', () => {
    // The transcripts start on day 3 of the window 2 weeks back; the window after it is seen whole.
    const first = weekStart(2) + 3 * DAY_MS;
    const records = [rec(first), rec(weekStart(1) + DAY_MS)];
    const { weeks: rows } = weeks({ calibrationK: 1, records });
    expect(rows.find(w => w.start === iso(weekStart(2)))!.transcriptsFrom).toBe(iso(first));
    expect(rows.find(w => w.start === iso(weekStart(1)))!.transcriptsFrom).toBeUndefined();
    // A reading sees the whole window, whatever the transcripts kept.
    const share = { estimated: false, percent: 40, plan: 'max5' as const, resetsAt: iso(weekStart(1)) };
    expect(weeks({ calibrationK: 1, records, shares: [share], snapshots: [snap(2)] }).weeks.find(w => w.start === iso(weekStart(2)))!.transcriptsFrom).toBeUndefined();
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

describe('pressure point', () => {
  const share = (percent: number, plan: 'max5' | 'pro' = 'max5') => ({ estimated: false, percent, plan, resetsAt: iso(weekStart(1) + WEEK_MS) });
  const reading = (weekly: number, day: number) => ({ ...snap(1, weekly), ts: iso(weekStart(1) + day * DAY_MS) });

  it('is the first reading of the window at 90%, whatever the later ones say', () => {
    const snapshots = [reading(95, 4), reading(70, 1), reading(91, 3), reading(100, 5)];
    expect(weeks({ shares: [share(100)], snapshots }).weeks[0]).toMatchObject({ pressureAt: iso(weekStart(1) + 3 * DAY_MS), pressurePercent: 91 });
  });

  it('converts the reading from the plan of the window to the current plan', () => {
    // The window was read on Pro, where 92% crossed the point; it is 18.4% of Max.
    const snapshots = [reading(92, 3)];
    expect(weeks({ plan: 'max5', shares: [share(92, 'pro')], snapshots }).weeks[0]).toMatchObject({ pressurePercent: 92 / 5 });
  });

  it('reads the reading on its own plan when a plan change in the window did not restart the usage', () => {
    // A downgrade from Max to Pro on day 4 shows as no drop: 92% of Max on day 3 is 460% of Pro.
    const planHistory = [{ from: iso(weekStart(5)), plan: 'max5' as const, source: 'manual' as const }, { from: iso(weekStart(1) + 4 * DAY_MS), plan: 'pro' as const, source: 'manual' as const }];
    const snapshots = [reading(92, 3), reading(100, 5)];
    expect(weeks({ plan: 'pro', planHistory, shares: [share(100, 'pro')], snapshots }).weeks[0]).toMatchObject({ pressureAt: iso(weekStart(1) + 3 * DAY_MS), pressurePercent: 460 });
  });

  it('is absent for a window that never reached it', () => {
    const row = weeks({ shares: [share(89)], snapshots: [reading(89, 3)] }).weeks[0]!;
    expect(row.pressureAt).toBeUndefined();
    expect(row.pressurePercent).toBeUndefined();
  });

  it('is the message where k × cost so far reaches 90% for a week estimated from transcripts', () => {
    // $20 per message at 2.4 %/$ is 48% each: the second one crosses.
    const records = [rec(weekStart(1) + 3 * DAY_MS), rec(weekStart(1) + DAY_MS), rec(weekStart(1) + 5 * DAY_MS)];
    const row = weeks({ calibrationK: 2.4, records }).weeks[0]!;
    expect(row).toMatchObject({ pressureAt: iso(weekStart(1) + 3 * DAY_MS), source: 'estimated' });
    expect(row.pressurePercent).toBeCloseTo(96);
  });

  it('is absent for an estimated week that stays under it', () => {
    expect(weeks({ calibrationK: 2.4, records: [rec(weekStart(1) + DAY_MS)] }).weeks[0]!.pressureAt).toBeUndefined();
  });

  it('reads an estimated week on its own plan: its limit and its 90%', () => {
    // 0.5 % of Max per dollar is 2.5 % of Pro: the $20 messages of a Pro week are 50% of Pro each.
    const planHistory = [{ from: iso(weekStart(5)), plan: 'pro' as const, source: 'manual' as const }, { from: iso(START), plan: 'max5' as const, source: 'manual' as const }];
    const records = [rec(weekStart(1) + DAY_MS), rec(weekStart(1) + 2 * DAY_MS), rec(weekStart(1) + 3 * DAY_MS)];
    const row = weeks({ calibrationK: 0.5, planHistory, records }).weeks.find(w => w.start === iso(weekStart(1)))!;
    // The second message crosses 90% of Pro; the third would pass the Pro limit, where usage stops.
    expect(row).toMatchObject({ percent: 20, plan: 'pro', planPercent: 100, pressureAt: iso(weekStart(1) + 2 * DAY_MS), pressurePercent: 20, source: 'estimated' });
  });
});

describe('hit', () => {
  const share = (percent: number) => ({ estimated: false, percent, plan: 'max5' as const, resetsAt: iso(weekStart(1) + WEEK_MS) });

  it('marks a window whose reading reached the threshold', () => {
    expect(weeks({ shares: [share(100)], snapshots: [snap(1)] }).weeks[0]!.hit).toBe(true);
    expect(weeks({ shares: [share(98)], snapshots: [snap(1)] }).weeks[0]!.hit).toBe(true);
    expect(weeks({ shares: [share(97)], snapshots: [snap(1)] }).weeks[0]!.hit).toBeUndefined();
    expect(weeks({ shares: [share(97)], snapshots: [snap(1)], weekLimitThreshold: 90 }).weeks[0]!.hit).toBe(true);
  });

  it('reads the threshold on the plan of the week, not on the current plan', () => {
    // A Pro week at its limit reads 20% of Max; an Ultra week at 30% reads 300% of Pro.
    const pro = weeks({ shares: [{ ...share(100), plan: 'pro' }], snapshots: [snap(1, 100)] }).weeks[0]!;
    expect(pro).toMatchObject({ hit: true, percent: 20 });
    const max20 = weeks({ plan: 'pro', shares: [{ ...share(30), plan: 'max20' }], snapshots: [snap(1, 30)] }).weeks[0]!;
    expect(max20.percent).toBe(300);
    expect(max20.hit).toBeUndefined();
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

  it('counts the 5-hour windows that were blocked by a rate limit seen in the transcripts', () => {
    const { weeks: rows } = weeks({
      records: [rec(START + DAY_MS)],
      sessionWindows: [
        session(START + DAY_MS, { limitHits: [iso(START + DAY_MS + 3_600_000)] }),
        session(START + 2 * DAY_MS),
        session(START + 3 * DAY_MS, { capped: true }),
      ],
    });
    expect(rows[0]).toMatchObject({ blockedSessions: 1, cappedSessions: 1, sessions: 3 });
  });
});

describe('weekly limit hits', () => {
  const hit = (ms: number): ApiEvent => ({ key: String(ms), kind: 'limit', limitType: 'seven_day', ts: iso(ms) });

  it('lists the weekly-limit hits that fall in each window', () => {
    const { weeks: rows } = weeks({
      hits: [hit(START + DAY_MS), hit(START + 2 * DAY_MS), hit(weekStart(1) + DAY_MS), hit(weekStart(5))],
      records: [rec(weekStart(1) + DAY_MS), rec(START + DAY_MS)],
    });
    expect(rows.map(w => w.limitHits)).toEqual([[iso(START + DAY_MS), iso(START + 2 * DAY_MS)], [iso(weekStart(1) + DAY_MS)]]);
  });

  it('has none without hits', () => {
    expect(weeks({ records: [rec(START + DAY_MS)] }).weeks[0]!.limitHits).toBeUndefined();
  });

  it('counts the weeks that a rate limit blocked, by a weekly hit or a blocked session', () => {
    const { stats } = weeks({
      hits: [hit(weekStart(1) + DAY_MS)],
      records: [rec(START + DAY_MS), rec(weekStart(1) + DAY_MS), rec(weekStart(2) + DAY_MS), rec(weekStart(3) + DAY_MS)],
      sessionWindows: [session(weekStart(2) + DAY_MS, { limitHits: [iso(weekStart(2) + DAY_MS)] })],
    });
    expect(stats.blocked).toBe(2);
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

describe('plan change', () => {
  const share = (i: number, percent: number) => ({ estimated: false, percent, plan: 'max5' as const, resetsAt: iso(weekStart(i) + WEEK_MS) });
  const planHistory = [
    { from: iso(weekStart(5)), plan: 'pro' as const, source: 'detected' as const },
    { from: iso(weekStart(2) + 3 * DAY_MS), plan: 'max5' as const, source: 'manual' as const },
  ];
  /** Week 2: Pro to 100%, then Max from day 3 to 20%: 40% of Max in all. */
  const restartedShare = {
    ...share(2, 40),
    planChange: true as const,
    parts: [
      { percent: 100, plan: 'pro' as const, start: iso(weekStart(2)) },
      { percent: 20, plan: 'max5' as const, start: iso(weekStart(2) + 3 * DAY_MS) },
    ],
  };
  const reading = (ms: number, weekly: number): Snapshot => ({ source: 'endpoint', ts: iso(ms), weekly, weeklyResetsAt: iso(weekStart(2) + WEEK_MS) });

  it('marks the window the new plan started in, with its full length and its parts', () => {
    const { weeks: rows } = weeks({ planHistory, shares: [share(1, 60), restartedShare, share(3, 50)], snapshots: [snap(1), snap(2), snap(3)] });
    expect(rows.map(w => [w.start, w.planChange])).toEqual([
      [iso(weekStart(1)), undefined],
      [iso(weekStart(2)), true],
      [iso(weekStart(3)), undefined],
    ]);
    expect(rows[1]).toMatchObject({ end: iso(weekStart(1)), percent: 40, start: iso(weekStart(2)) });
    expect(rows[1]!.parts).toEqual([
      { end: iso(weekStart(2) + 3 * DAY_MS), percent: 20, plan: 'pro', planPercent: 100, start: iso(weekStart(2)) },
      { end: iso(weekStart(1)), percent: 20, plan: 'max5', planPercent: 20, start: iso(weekStart(2) + 3 * DAY_MS) },
    ]);
    // Each part has its plan; the row's % adds them up on the current plan, so it has no plan of its own.
    expect(rows[1]!.plan).toBeUndefined();
    expect(rows[1]!.planPercent).toBeUndefined();
    expect(rows[0]!.parts).toBeUndefined();
    expect(rows[0]).toMatchObject({ plan: 'max5', planPercent: 60 });
  });

  it('marks nothing without a change in the history', () => {
    const { weeks: rows } = weeks({ planHistory: planHistory.slice(0, 1), shares: [share(2, 20)], snapshots: [snap(2)] });
    expect(rows.some(w => w.planChange)).toBe(false);
  });

  it('keeps its percent in the median peak and its cost in the median cost', () => {
    const { stats } = weeks({
      planHistory,
      // $20, $40 (the restarted week) and $60.
      records: [rec(weekStart(1) + 1000), rec(weekStart(2) + 1000), rec(weekStart(2) + 2000), rec(weekStart(3) + 1000), rec(weekStart(3) + 2000), rec(weekStart(3) + 3000)],
      shares: [share(1, 60), restartedShare, share(3, 100)],
      snapshots: [snap(1), snap(2), snap(3)],
    });
    expect(stats).toMatchObject({ medianCost: 40, medianPercent: 60 });
  });

  it('counts a week as having hit the limit when a part ended at the threshold of its own plan', () => {
    const { stats, weeks: rows } = weeks({ planHistory, shares: [restartedShare], snapshots: [snap(2)] });
    // The Max part ended at 20%, the Pro part at 100% of Pro.
    expect(rows[0]!.hit).toBe(true);
    expect(stats.hit).toBe(1);
    const estimated = { ...restartedShare, estimated: true, parts: [{ ...restartedShare.parts[0], estimated: true as const }, restartedShare.parts[1]!] };
    expect(weeks({ planHistory, shares: [estimated], snapshots: [snap(2)] }).weeks[0]!.hit).toBeUndefined();
  });

  it('gives each part its own pressure point, and the row the first one', () => {
    const readings = [reading(weekStart(2) + DAY_MS, 92), reading(weekStart(2) + 2 * DAY_MS, 100), reading(weekStart(2) + 4 * DAY_MS, 20)];
    const { weeks: rows } = weeks({ planHistory, shares: [restartedShare], snapshots: readings });
    const [pro, max5] = rows[0]!.parts!;
    expect(pro).toMatchObject({ pressureAt: iso(weekStart(2) + DAY_MS), pressurePercent: 92 / 5 });
    expect(max5!.pressureAt).toBeUndefined();
    expect(rows[0]).toMatchObject({ pressureAt: iso(weekStart(2) + DAY_MS), pressurePercent: 92 / 5 });
  });

  it('reads a part\'s pressure point on the plan of its reading, not the part\'s last one', () => {
    // Max from day 3 restarts the usage; back to Pro on day 5 does not: the last part holds readings of both plans.
    const history = [...planHistory, { from: iso(weekStart(2) + 5 * DAY_MS), plan: 'pro' as const, source: 'manual' as const }];
    const share = {
      ...restartedShare,
      parts: [restartedShare.parts[0]!, { percent: 100, plan: 'pro' as const, start: iso(weekStart(2) + 3 * DAY_MS) }],
      percent: 200,
      plan: 'pro' as const,
    };
    const readings = [reading(weekStart(2) + DAY_MS, 50), reading(weekStart(2) + 4 * DAY_MS, 92), reading(weekStart(2) + 6 * DAY_MS, 100)];
    const { weeks: rows } = weeks({ plan: 'pro', planHistory: history, shares: [share], snapshots: readings });
    // 92% of Max is 460% of Pro.
    expect(rows[0]!.parts![1]).toMatchObject({ pressureAt: iso(weekStart(2) + 4 * DAY_MS), pressurePercent: 460 });
    expect(rows[0]).toMatchObject({ pressureAt: iso(weekStart(2) + 4 * DAY_MS), pressurePercent: 460 });
  });

  it('adds the earlier parts to the % of the window in progress', () => {
    const current = {
      estimatedNow: 8,
      resetsAt: iso(START + WEEK_MS),
      weekly: 5,
      parts: [
        { percent: 100, plan: 'pro' as const, start: iso(START) },
        { estimated: true as const, percent: 8, plan: 'max5' as const, start: iso(START + DAY_MS) },
      ],
    };
    const { weeks: rows } = weeks({ current, planHistory: [{ from: iso(START - 9 * DAY_MS), plan: 'pro', source: 'manual' }, { from: iso(START + DAY_MS), plan: 'max5', source: 'manual' }] });
    expect(rows[0]).toMatchObject({ inProgress: true, percent: 28, percentEstimated: true });
    expect(rows[0]!.parts).toHaveLength(2);
    expect(rows[0]!.plan).toBeUndefined();
    // The Pro part is a final reading at its limit.
    expect(rows[0]!.hit).toBe(true);
  });

  it('shows a reset week on one plan as parts, without the plan-change flag', () => {
    const reset = { ...share(2, 45), parts: [{ percent: 40, plan: 'max5' as const, start: iso(weekStart(2)) }, { percent: 5, plan: 'max5' as const, start: iso(weekStart(2) + 3 * DAY_MS) }] };
    const { weeks: rows } = weeks({ shares: [reset], snapshots: [snap(2)] });
    expect(rows[0]!.planChange).toBeUndefined();
    expect(rows[0]!.parts!.map(part => part.percent)).toEqual([40, 5]);
    expect(rows[0]!.percent).toBe(45);
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

describe('over a range', () => {
  const snapshots = Array.from({ length: 15 }, (_, i) => snap(i));

  it('lists the windows starting in the range, without the cap of 12', () => {
    const { weeks: rows } = weeks({ range: { from: weekStart(14), to: START + WEEK_MS }, snapshots });
    expect(rows).toHaveLength(15);
    expect(rows.at(-1)!.start).toBe(iso(weekStart(14)));
  });

  it('leaves out windows starting before or after the range', () => {
    const { weeks: rows } = weeks({ range: { from: weekStart(4), to: weekStart(1) }, snapshots });
    expect(rows.map(w => w.start)).toEqual([iso(weekStart(2)), iso(weekStart(3)), iso(weekStart(4))]);
  });

  it('takes the stats from the listed windows only', () => {
    const records = [rec(weekStart(2) + DAY_MS), rec(weekStart(6) + DAY_MS, { output: 3_000_000 })];
    const { stats } = weeks({ range: { from: weekStart(3), to: weekStart(1) }, records, snapshots });
    expect(stats.medianCost).toBe(20);
  });

  it('is empty for a range with no window', () => {
    expect(weeks({ range: { from: weekStart(30), to: weekStart(20) }, snapshots }).weeks).toEqual([]);
  });
});
