import { describe, expect, it } from 'vitest';

import type { WindowPart } from './restarts.ts';
import type { Snapshot } from './types.ts';

import { DAY_MS, WEEK_MS } from './calibration.ts';
import { weekPacing } from './pacing.ts';

const resetsAt = Date.parse('2026-10-07T20:00:00Z');
const from = resetsAt - WEEK_MS;
function reading(days: number, weekly: number): Snapshot {
  return {
    source: 'endpoint',
    ts: new Date(from + days * DAY_MS).toISOString(),
    weekly,
    weeklyResetsAt: new Date(resetsAt).toISOString(),
  };
}
/** One part for the whole window. */
const whole = (readings: Snapshot[]): WindowPart[] => [{ end: resetsAt, plan: 'pro', readings, start: from }];
const base = { resetsAt, windowMs: WEEK_MS, costBetween: () => 0 };

describe('weekPacing', () => {
  it('starts at 0 and follows the readings', () => {
    const pacing = weekPacing({ ...base, now: from + 3 * DAY_MS, parts: whole([reading(2, 30), reading(1, 10)]), usedNow: 30 });
    expect(pacing.points).toEqual([
      { at: from, percent: 0 },
      { at: from + DAY_MS, percent: 10 },
      { at: from + 2 * DAY_MS, percent: 30 },
    ]);
    expect(pacing.from).toBe(from);
    expect(pacing.to).toBe(resetsAt);
  });

  it('adds the estimate at now after a stale reading', () => {
    const now = from + 3 * DAY_MS;
    const pacing = weekPacing({ ...base, now, parts: whole([reading(1, 10)]), usedNow: 25 });
    expect(pacing.points.at(-1)).toEqual({ at: now, percent: 25 });
  });

  it('draws a week without readings from 0 to the estimate', () => {
    const now = from + DAY_MS;
    const pacing = weekPacing({ ...base, now, parts: whole([]), usedNow: 5 });
    expect(pacing.points).toEqual([{ at: from, percent: 0 }, { at: now, percent: 5 }]);
  });

  it('gives the daily budget left and the daily spend so far', () => {
    const now = from + 2 * DAY_MS;
    const pacing = weekPacing({ k: 0.5, now, parts: whole([reading(2, 20)]), resetsAt, usedNow: 20, windowMs: WEEK_MS, costBetween: () => 40 });
    // 80 points left ÷ 0.5 %/$ ÷ 5 days = $32/day; $40 over 2 days = $20/day.
    expect(pacing.roomPerDay).toBeCloseTo(32);
    expect(pacing.spentPerDay).toBeCloseTo(20);
  });

  it('leaves no budget past the limit', () => {
    const pacing = weekPacing({ ...base, k: 1, now: from + 5 * DAY_MS, parts: whole([reading(5, 110)]), usedNow: 110 });
    expect(pacing.roomPerDay).toBe(0);
  });

  it('has no budget without a calibration, and no spend in the first hour', () => {
    const pacing = weekPacing({ ...base, now: from + 60_000, parts: whole([]), usedNow: 0 });
    expect(pacing.roomPerDay).toBeUndefined();
    expect(pacing.spentPerDay).toBeUndefined();
  });

  it('has no earlier part nor restart for a window that never restarted', () => {
    const pacing = weekPacing({ ...base, now: from + 3 * DAY_MS, parts: whole([reading(1, 10)]), usedNow: 10 });
    expect(pacing.earlier).toBeUndefined();
    expect(pacing.restart).toBeUndefined();
  });

  describe('after a restart', () => {
    const restartAt = from + 2 * DAY_MS;
    const parts: WindowPart[] = [
      { end: restartAt, plan: 'pro', readings: [reading(0.5, 40), reading(1.5, 100)], start: from },
      { end: resetsAt, plan: 'max5', readings: [reading(2, 0), reading(2.5, 6)], start: restartAt },
    ];

    it('draws the running part from 0 at its start, and the earlier one on its own plan', () => {
      const pacing = weekPacing({ ...base, now: from + 3 * DAY_MS, parts, usedNow: 6 });
      expect(pacing.from).toBe(from);
      expect(pacing.points).toEqual([
        { at: restartAt, percent: 0 },
        { at: restartAt + DAY_MS / 2, percent: 6 },
      ]);
      expect(pacing.earlier).toEqual([{
        plan: 'pro',
        points: [{ at: from, percent: 0 }, { at: from + DAY_MS / 2, percent: 40 }, { at: from + 1.5 * DAY_MS, percent: 100 }],
      }]);
      expect(pacing.restart).toEqual({ at: restartAt, plan: 'max5', previousPlan: 'pro' });
    });

    it('counts the spend from the restart, and none in its first hour', () => {
      const now = from + 3 * DAY_MS;
      const pacing = weekPacing({ ...base, now, parts, usedNow: 6, costBetween: (a, b) => (a === restartAt ? (b - a) / DAY_MS * 10 : 999) });
      expect(pacing.spentPerDay).toBeCloseTo(10);
      expect(weekPacing({ ...base, now: restartAt + 60_000, parts, usedNow: 0 }).spentPerDay).toBeUndefined();
    });

    it('leaves out an earlier part without readings, but keeps the restart', () => {
      const empty: WindowPart[] = [{ end: restartAt, plan: 'pro', readings: [], start: from }, parts[1]!];
      const pacing = weekPacing({ ...base, now: from + 3 * DAY_MS, parts: empty, usedNow: 6 });
      expect(pacing.earlier).toEqual([]);
      expect(pacing.restart).toMatchObject({ previousPlan: 'pro' });
    });
  });
});
