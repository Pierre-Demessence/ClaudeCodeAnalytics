import { describe, expect, it } from 'vitest';

import type { PlanPeriod } from './types.ts';

import { convertPercent, planAt, planFromSubscription, withDetectedPlan } from './plans.ts';

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

describe('convertPercent', () => {
  it('scales by the advertised plan multipliers', () => {
    expect(convertPercent(50, 'pro', 'max5')).toBe(10);
    expect(convertPercent(10, 'max5', 'max20')).toBe(2.5);
    expect(convertPercent(10, 'max20', 'pro')).toBe(200);
  });
});

describe('planFromSubscription', () => {
  it('maps known subscription values', () => {
    expect(planFromSubscription('pro', 'default_claude_ai')).toBe('pro');
    expect(planFromSubscription('max', 'default_claude_max_20x')).toBe('max20');
    expect(planFromSubscription('max', 'default_claude_max_5x')).toBe('max5');
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
