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
    expect(typical).toEqual({ max: 60, median: 50, min: 40, weeks: 3 });
  });

  it('is undefined without completed weeks', () => {
    expect(typicalWeek([], 'pro')).toBeUndefined();
  });
});
