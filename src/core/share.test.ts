import { describe, expect, it } from 'vitest';

import type { PlanPeriod, Snapshot } from './types.ts';

import { typicalWeek, weeklyShares } from './share.ts';

function snap(ts: string, weekly: number, weeklyResetsAt: string): Snapshot {
  return { source: 'endpoint', ts, weekly, weeklyResetsAt };
}

const history: PlanPeriod[] = [{ from: '2026-09-01T00:00:00Z', plan: 'pro', source: 'detected' }];
const now = Date.parse('2026-10-20T00:00:00Z');

describe('weeklyShares', () => {
  it('takes the last reading of each completed window', () => {
    const shares = weeklyShares([
      snap('2026-10-07T10:00:00Z', 50, '2026-10-07T20:00:00Z'),
      snap('2026-10-07T19:00:00Z', 60, '2026-10-07T20:00:00Z'),
      snap('2026-10-19T00:00:00Z', 10, '2026-10-21T20:00:00Z'), // current window: excluded
    ], () => 0, undefined, history, now);
    expect(shares).toEqual([{ estimated: false, percent: 60, plan: 'pro', resetsAt: '2026-10-07T20:00:00Z' }]);
  });

  it('extends an early last reading with the calibrated ratio', () => {
    const shares = weeklyShares([snap('2026-10-14T00:00:00Z', 50, '2026-10-14T20:00:00Z')], () => 20, { k: 0.5, plan: 'pro' }, history, now);
    expect(shares[0]).toMatchObject({ estimated: true, percent: 60 });
  });

  it('converts the extension when the ratio was fitted on another plan, and caps at 100%', () => {
    // k fitted on Max 5×: $20 → 2% of Max 5× = 10% of Pro.
    const shares = weeklyShares([snap('2026-10-14T00:00:00Z', 50, '2026-10-14T20:00:00Z')], () => 20, { k: 0.1, plan: 'max5' }, history, now);
    expect(shares[0]?.percent).toBeCloseTo(60);
    const capped = weeklyShares([snap('2026-10-14T00:00:00Z', 95, '2026-10-14T20:00:00Z')], () => 20, { k: 0.5, plan: 'pro' }, history, now);
    expect(capped[0]?.percent).toBe(100);
  });

  it('marks a window holding a plan change, and adds the parts up on the new plan', () => {
    const upgraded: PlanPeriod[] = [...history, { from: '2026-10-10T00:00:00Z', plan: 'max5', source: 'manual' }];
    const shares = weeklyShares([
      snap('2026-10-07T19:00:00Z', 60, '2026-10-07T20:00:00Z'),
      snap('2026-10-09T19:00:00Z', 100, '2026-10-14T20:00:00Z'),
      snap('2026-10-14T19:00:00Z', 20, '2026-10-14T20:00:00Z'),
      snap('2026-10-18T19:00:00Z', 30, '2026-10-19T20:00:00Z'),
    ], () => 0, undefined, upgraded, now);
    expect(shares.map(share => share.planChange)).toEqual([undefined, true, undefined]);
    // Pro's 100% is 20% of Max 5×, and the Max 5× part reached 20% on top.
    expect(shares[1]).toMatchObject({ estimated: false, percent: 40, plan: 'max5' });
    expect(shares[1]!.parts).toEqual([
      { percent: 100, plan: 'pro', start: '2026-10-07T20:00:00.000Z' },
      { percent: 20, plan: 'max5', start: '2026-10-10T00:00:00.000Z' },
    ]);
    expect(shares[0]!.parts).toBeUndefined();
  });

  it('adds the parts of a reset week on one plan', () => {
    const shares = weeklyShares([
      snap('2026-10-09T19:00:00Z', 70, '2026-10-14T20:00:00Z'),
      snap('2026-10-10T19:00:00Z', 5, '2026-10-14T20:00:00Z'),
      snap('2026-10-14T19:00:00Z', 30, '2026-10-14T20:00:00Z'),
    ], () => 0, undefined, history, now);
    expect(shares[0]).toMatchObject({ estimated: false, percent: 100, plan: 'pro' });
    expect(shares[0]!.planChange).toBeUndefined();
    expect(shares[0]!.parts).toHaveLength(2);
  });

  it('extends only the part that ran to the reset, and estimates an ended part without readings', () => {
    const upgraded: PlanPeriod[] = [...history, { from: '2026-10-10T00:00:00Z', plan: 'max5', source: 'manual' }];
    // The only reading comes after the upgrade and a day early: the Pro part has none.
    const shares = weeklyShares([snap('2026-10-13T20:00:00Z', 10, '2026-10-14T20:00:00Z')], (from, to) => (to - from) / 3_600_000, { k: 0.1, plan: 'max5' }, upgraded, now);
    // Max 5× part: 10% + 24 h at $1 an hour × 0.1 %/$ = 12.4%. The Pro part comes from its cost (0.1 %/$ of Max 5× is 0.5 %/$ of Pro).
    const [ended, running] = shares[0]!.parts!;
    expect(ended).toMatchObject({ estimated: true, plan: 'pro' });
    expect(running).toMatchObject({ estimated: true, plan: 'max5' });
    expect(running!.percent).toBeCloseTo(12.4);
    expect(shares[0]!.percent).toBeCloseTo(running!.percent + ended!.percent / 5);
    expect(shares[0]!.estimated).toBe(true);
  });

  it('marks an early last reading as estimated even without a ratio', () => {
    const shares = weeklyShares([snap('2026-10-14T00:00:00Z', 50, '2026-10-14T20:00:00Z')], () => 20, undefined, history, now);
    expect(shares[0]).toMatchObject({ estimated: true, percent: 50 });
  });
});

describe('typicalWeek', () => {
  it('summarises weeks on the current plan', () => {
    const typical = typicalWeek([
      { estimated: false, percent: 40, plan: 'pro', resetsAt: 'a' },
      { estimated: false, percent: 60, plan: 'pro', resetsAt: 'b' },
      { estimated: false, percent: 10, plan: 'max5', resetsAt: 'c' }, // = 50 % of Pro
    ], 'pro');
    expect(typical).toEqual({ high: 55, low: 45, max: 60, median: 50, min: 40, weeks: 3 });
  });

  it('keeps a restarted week, its parts added up', () => {
    const typical = typicalWeek([
      { estimated: false, percent: 40, plan: 'pro', resetsAt: 'a' },
      { estimated: false, percent: 20, plan: 'max5', planChange: true, resetsAt: 'b' }, // = 100 % of Pro
      { estimated: false, percent: 60, plan: 'pro', resetsAt: 'c' },
    ], 'pro');
    expect(typical).toEqual({ high: 80, low: 50, max: 100, median: 60, min: 40, weeks: 3 });
  });

  it('is undefined without completed weeks', () => {
    expect(typicalWeek([], 'pro')).toBeUndefined();
  });
});
