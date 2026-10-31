import { describe, expect, it } from 'vitest';

import type { PlanPeriod } from './types.ts';

import { convertPercent, convertWeekly, planAt, planChanges, planChangeWithin, planFromSubscription, withDetectedPlan } from './plans.ts';

const history: PlanPeriod[] = [
  { from: '2026-09-01T00:00:00Z', plan: 'pro', source: 'detected' },
  { from: '2026-10-10T00:00:00Z', plan: 'max5', source: 'manual' },
];

describe('planAt', () => {
  it('returns the plan active at a time', () => {
    expect(planAt(history, '2026-10-01T00:00:00Z')).toBe('pro');
    expect(planAt(history, '2026-10-11T00:00:00Z')).toBe('max5');
  });

  it('uses the first plan before history starts, and Pro without history', () => {
    expect(planAt(history, '2026-01-01T00:00:00Z')).toBe('pro');
    expect(planAt([], '2026-01-01T00:00:00Z')).toBe('pro');
  });
});

describe('planChanges', () => {
  it('lists the periods whose plan differs from the one before', () => {
    expect(planChanges(history)).toEqual([{ at: Date.parse('2026-10-10T00:00:00Z'), from: 'pro', to: 'max5' }]);
  });

  it('counts neither the first period nor a period that keeps the plan', () => {
    const same: PlanPeriod[] = [...history, { from: '2026-10-20T00:00:00Z', plan: 'max5', source: 'detected' }];
    expect(planChanges(same)).toHaveLength(1);
    expect(planChanges(history.slice(0, 1))).toEqual([]);
    expect(planChanges([])).toEqual([]);
  });
});

describe('planChangeWithin', () => {
  const at = (ts: string) => Date.parse(ts);

  it('is true when a period of another plan starts inside the window', () => {
    expect(planChangeWithin(history, at('2026-10-07T20:00:00Z'), at('2026-10-14T20:00:00Z'))).toBe(true);
  });

  it('is false when the change falls outside the window or on its start', () => {
    expect(planChangeWithin(history, at('2026-09-30T20:00:00Z'), at('2026-10-07T20:00:00Z'))).toBe(false);
    expect(planChangeWithin(history, at('2026-10-10T00:00:00Z'), at('2026-10-17T00:00:00Z'))).toBe(false);
    expect(planChangeWithin(history, at('2026-10-14T20:00:00Z'), at('2026-10-21T20:00:00Z'))).toBe(false);
  });

  it('does not count the first period, nor a period that keeps the plan', () => {
    expect(planChangeWithin(history, at('2026-08-27T00:00:00Z'), at('2026-09-03T00:00:00Z'))).toBe(false);
    const same: PlanPeriod[] = [...history, { from: '2026-10-20T00:00:00Z', plan: 'max5', source: 'detected' }];
    expect(planChangeWithin(same, at('2026-10-17T00:00:00Z'), at('2026-10-24T00:00:00Z'))).toBe(false);
  });

  it('is false without history', () => {
    expect(planChangeWithin([], 0, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe('convertWeekly', () => {
  it('scales by the advertised weekly multipliers: Pro 1, Max 5, Ultra 10', () => {
    expect(convertWeekly(50, 'pro', 'max5')).toBe(10);
    expect(convertWeekly(10, 'max5', 'max20')).toBe(5);
    expect(convertWeekly(100, 'max5', 'max20')).toBe(50);
    expect(convertWeekly(10, 'max20', 'pro')).toBe(100);
  });
});

describe('convertPercent', () => {
  it('converts a weekly % like convertWeekly', () => {
    expect(convertPercent(100, 'max5', 'max20', 'week')).toBe(50);
  });

  it('scales a 5-hour % by Pro 1, Max 5', () => {
    expect(convertPercent(50, 'pro', 'max5', 'fiveHour')).toBe(10);
    expect(convertPercent(10, 'max5', 'pro', 'fiveHour')).toBe(50);
  });

  it('has no 5-hour equivalent to or from Ultra', () => {
    expect(convertPercent(10, 'max5', 'max20', 'fiveHour')).toBeUndefined();
    expect(convertPercent(10, 'max20', 'pro', 'fiveHour')).toBeUndefined();
  });

  it('keeps a 5-hour % on the same plan, Ultra included', () => {
    expect(convertPercent(40, 'max20', 'max20', 'fiveHour')).toBe(40);
  });
});

describe('planFromSubscription', () => {
  it('maps known subscription values', () => {
    expect(planFromSubscription('pro', 'default_claude_ai')).toBe('pro');
    expect(planFromSubscription('max', 'default_claude_max_20x')).toBe('max20');
    expect(planFromSubscription('max', 'default_claude_max_5x')).toBe('max5');
  });

  it('maps the Ultra subscription type', () => {
    expect(planFromSubscription('ultra', undefined)).toBe('max20');
  });

  it('returns undefined for unknown values', () => {
    expect(planFromSubscription('team', undefined)).toBeUndefined();
    expect(planFromSubscription(undefined, undefined)).toBeUndefined();
  });
});

describe('withDetectedPlan', () => {
  it('adds a period when the detected plan differs from a detected one', () => {
    const next = withDetectedPlan(history, 'max20', '2026-10-05T00:00:00Z');
    expect(next).toHaveLength(3);
    expect(next[1]).toEqual({ from: '2026-10-05T00:00:00Z', plan: 'max20', source: 'detected' });
  });

  it('never overrides a manual period', () => {
    expect(withDetectedPlan(history, 'max20', '2026-10-20T00:00:00Z')).toBe(history);
  });

  it('leaves history unchanged when the plan matches', () => {
    expect(withDetectedPlan(history, 'max5', '2026-10-20T00:00:00Z')).toBe(history);
  });

  it('starts history from the detection when empty', () => {
    expect(withDetectedPlan([], 'pro', '2026-10-02T00:00:00Z')).toEqual([{ from: '2026-10-02T00:00:00Z', plan: 'pro', source: 'detected' }]);
  });
});
