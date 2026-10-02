import { describe, expect, it } from 'vitest';

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
const base = { resetsAt, windowMs: WEEK_MS, costBetween: () => 0 };

describe('weekPacing', () => {
  it('starts at 0 and follows the readings', () => {
    const pacing = weekPacing({ ...base, now: from + 3 * DAY_MS, readings: [reading(2, 30), reading(1, 10)], usedNow: 30 });
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
    const pacing = weekPacing({ ...base, now, readings: [reading(1, 10)], usedNow: 25 });
    expect(pacing.points.at(-1)).toEqual({ at: now, percent: 25 });
  });

  it('draws a week without readings from 0 to the estimate', () => {
    const now = from + DAY_MS;
    const pacing = weekPacing({ ...base, now, readings: [], usedNow: 5 });
    expect(pacing.points).toEqual([{ at: from, percent: 0 }, { at: now, percent: 5 }]);
  });

  it('gives the daily budget left and the daily spend so far', () => {
    const now = from + 2 * DAY_MS;
    const pacing = weekPacing({ k: 0.5, now, readings: [reading(2, 20)], resetsAt, usedNow: 20, windowMs: WEEK_MS, costBetween: () => 40 });
    // 80 points left ÷ 0.5 %/$ ÷ 5 days = $32/day; $40 over 2 days = $20/day.
    expect(pacing.roomPerDay).toBeCloseTo(32);
    expect(pacing.spentPerDay).toBeCloseTo(20);
  });

  it('leaves no budget past the limit', () => {
    const pacing = weekPacing({ ...base, k: 1, now: from + 5 * DAY_MS, readings: [reading(5, 110)], usedNow: 110 });
    expect(pacing.roomPerDay).toBe(0);
  });

  it('has no budget without a calibration, and no spend in the first hour', () => {
    const pacing = weekPacing({ ...base, now: from + 60_000, readings: [], usedNow: 0 });
    expect(pacing.roomPerDay).toBeUndefined();
    expect(pacing.spentPerDay).toBeUndefined();
  });
});
