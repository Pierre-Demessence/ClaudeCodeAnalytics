import { describe, expect, it } from 'vitest';

import type { Snapshot } from './types.ts';

import { DAY_MS, WEEK_MS } from './calibration.ts';
import { buildLimits } from './limits.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const FIRST_RESET = Date.parse('2026-08-05T20:00:00Z');
/** Reset time of week `i`, counted from a fixed anchor. */
const reset = (i: number) => new Date(FIRST_RESET + i * WEEK_MS).toISOString();
const windowStartOfWeek = (i: number) => FIRST_RESET + i * WEEK_MS - WEEK_MS;

/** A reading taken 1 day before the reset of week `i`. */
function reading(i: number, weekly: number, extra: Partial<Snapshot> = {}): Snapshot {
  return { source: 'endpoint', ts: new Date(FIRST_RESET + i * WEEK_MS - DAY_MS).toISOString(), weekly, weeklyResetsAt: reset(i), ...extra };
}

/** $100 over the 6 days before a reading, so a weekly % reads straight as a ratio. */
const costBetween = (from: number, to: number) => (to - from) / (6 * DAY_MS) * 100;

function limits(snapshots: Snapshot[], extra: Partial<Parameters<typeof buildLimits>[0]> = {}) {
  return buildLimits({ costBetween, dataStart: 0, now: NOW, plan: 'pro', planHistory: [], snapshots, ...extra });
}

describe('buildLimits drift', () => {
  // Weeks 0–10 are completed (their resets are before NOW); week 11 is running.
  const steady = [0, 1, 2, 3].map(i => reading(i, 30));

  it('computes % of the limit per $100 of Claude Code usage, from the last reading of each window', () => {
    const early = reading(0, 5, { ts: new Date(FIRST_RESET - 3 * DAY_MS).toISOString() });
    const { drift } = limits([early, reading(0, 30, { claudeCodeShare: 50 })]);
    expect(drift).toHaveLength(1);
    // 30% × 50% Claude Code = 15 pts over $100.
    expect(drift[0]).toMatchObject({ claudeCode: 50, cost: 100, ratio: 15, resetsAt: reset(0) });
  });

  it('skips windows under 10%, before the first message, on another plan, or without cost', () => {
    const snapshots = [0, 1, 2, 3, 4, 5, 6].map(i => reading(i, i === 0 ? 9 : 30));
    const { drift } = limits(snapshots, {
      dataStart: windowStartOfWeek(3),
      planHistory: [
        { from: new Date(0).toISOString(), plan: 'pro', source: 'manual' },
        { from: new Date(Date.parse(reading(5, 0).ts) - 3_600_000).toISOString(), plan: 'max5', source: 'manual' },
        { from: new Date(Date.parse(reading(5, 0).ts) + 3_600_000).toISOString(), plan: 'pro', source: 'manual' },
      ],
      costBetween: (from, to) => (from === windowStartOfWeek(4) ? 0 : costBetween(from, to)),
    });
    // Week 0: 9%. Weeks 1–2: before the data. Week 4: no cost. Week 5: Max 5×.
    expect(drift.map(w => w.resetsAt)).toEqual([reset(3), reset(6)]);
  });

  it('keeps the last 12 windows and marks the running one', () => {
    const { drift } = limits(Array.from({ length: 12 }, (_, i) => reading(i, 30)));
    expect(drift).toHaveLength(12);
    // Week 11's reset is after NOW.
    expect(drift.filter(w => w.current).map(w => w.resetsAt)).toEqual([reset(11)]);
    expect(limits(Array.from({ length: 14 }, (_, i) => reading(i, 30))).drift[0]?.resetsAt).toBe(reset(2));
  });

  it('draws no usual line under 3 completed windows', () => {
    const { shift, usual } = limits([reading(0, 30), reading(1, 30), reading(11, 30)]);
    expect(usual).toBeUndefined();
    expect(shift).toBeUndefined();
  });

  it('takes the usual ratio as the median of completed windows only', () => {
    expect(limits([...steady, reading(11, 90)]).usual).toBeCloseTo(30);
  });

  it('reports a shift when the last two completed windows are both off the same way', () => {
    const { shift, usual } = limits([...steady, reading(4, 40), reading(5, 40), reading(6, 40)]);
    // Completed ratios: 30 ×4, 40 ×3. The median is 30, the run (weeks 4–6) is 40.
    expect(usual).toBeCloseTo(30);
    expect(shift?.change).toBeCloseTo(33.3, 0);
    expect(shift?.since).toBe(new Date(windowStartOfWeek(4)).toISOString());
  });

  it('reports a shift downwards as a negative change', () => {
    const { shift } = limits([0, 1, 2, 3, 4].map(i => reading(i, 40)).concat(reading(5, 20), reading(6, 20)));
    expect(shift?.change).toBeCloseTo(-50);
  });

  it('reports no shift for a single off window, or two off in opposite directions', () => {
    expect(limits([...steady, reading(4, 30), reading(5, 60)]).shift).toBeUndefined();
    expect(limits([...steady, reading(4, 60), reading(5, 15)]).shift).toBeUndefined();
  });
});

describe('buildLimits readings', () => {
  it('sends the latest 100 readings plus every manual one, newest first', () => {
    const snapshots: Snapshot[] = Array.from({ length: 130 }, (_, i) => ({
      source: i === 3 || i === 120 ? 'manual' : 'endpoint',
      ts: new Date(NOW - (130 - i) * 3_600_000).toISOString(),
      weekly: 20,
      weeklyResetsAt: reset(11),
    }));
    const { readings } = limits(snapshots);
    expect(readings).toHaveLength(101);
    expect(readings[0]).toBe(snapshots[129]);
    expect(readings.at(-1)).toBe(snapshots[3]);
  });

  it('counts the readings taken in each plan period', () => {
    const planHistory = [
      { from: reading(1, 0).ts, plan: 'pro' as const, source: 'manual' as const },
      { from: reading(3, 0).ts, plan: 'max5' as const, source: 'manual' as const },
    ];
    // One before the first period (counted in it), two in the first, one in the second.
    const snapshots = [reading(0, 20), reading(1, 20), reading(2, 20), reading(3, 20)];
    expect(limits(snapshots, { planHistory }).readingsPerPeriod).toEqual([3, 1]);
    expect(limits(snapshots).readingsPerPeriod).toEqual([]);
  });
});
