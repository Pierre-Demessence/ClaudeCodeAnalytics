import { describe, expect, it } from 'vitest';

import type { PlanPeriod, Snapshot } from './types.ts';

import { DAY_MS, WEEK_MS } from './calibration.ts';
import { buildMultipliers } from './multipliers.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const FIRST_RESET = Date.parse('2026-08-05T20:00:00Z');
const reset = (i: number) => new Date(FIRST_RESET + i * WEEK_MS).toISOString();

/** A reading taken 1 day before the reset of week `i`. */
function reading(i: number, weekly: number): Snapshot {
  return { source: 'endpoint', ts: new Date(FIRST_RESET + i * WEEK_MS - DAY_MS).toISOString(), weekly, weeklyResetsAt: reset(i) };
}

/** $100 over the 6 days before a reading, so a weekly % reads straight as a ratio. */
const costBetween = (from: number, to: number) => (to - from) / (6 * DAY_MS) * 100;

const switchedAt = (i: number) => new Date(FIRST_RESET + i * WEEK_MS - 2 * DAY_MS).toISOString();
const history: PlanPeriod[] = [
  { from: new Date(0).toISOString(), plan: 'pro', source: 'manual' },
  { from: switchedAt(5), plan: 'max5', source: 'manual' },
];

function multipliers(snapshots: Snapshot[], planHistory: PlanPeriod[] = history) {
  return buildMultipliers({ costBetween, dataStart: 0, now: NOW, plan: 'max5', planHistory, snapshots });
}

describe('buildMultipliers', () => {
  // Pro: 60 to 100 % per $100; Max 5×: 12 to 20.
  const pro = [60, 70, 80, 90, 100].map((weekly, i) => reading(i, weekly));
  const max5 = [12, 14, 16, 18, 20].map((weekly, i) => reading(i + 5, weekly));

  it('has one entry for each pair of neighbouring plans, advertised ratio included', () => {
    expect(multipliers([]).map(m => [m.from, m.to, m.advertised])).toEqual([['pro', 'max5', 5], ['max5', 'max20', 4]]);
  });

  it('measures the ratio of the median drift ratios, with its likely range', () => {
    const [proToMax5] = multipliers([...pro, ...max5]);
    expect(proToMax5!.measured).toMatchObject({ fromWeeks: 5, toWeeks: 5, value: 5 });
    // Quartiles: 70 to 90 on Pro, 14 to 18 on Max 5×.
    expect(proToMax5!.measured!.low).toBeCloseTo(70 / 18);
    expect(proToMax5!.measured!.high).toBeCloseTo(90 / 14);
  });

  it('is not measured while a plan has no weeks, or fewer than 3', () => {
    expect(multipliers([...pro, ...max5])[1]!.measured).toBeUndefined();
    expect(multipliers([...pro, ...max5.slice(0, 2)])[0]!.measured).toBeUndefined();
  });

  it('leaves out the window still running', () => {
    // Week 11 resets after NOW.
    const [proToMax5] = multipliers([...pro, ...max5, reading(11, 90)]);
    expect(proToMax5!.measured!.toWeeks).toBe(5);
  });
});
