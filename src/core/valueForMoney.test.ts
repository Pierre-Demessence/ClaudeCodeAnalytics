import { describe, expect, it } from 'vitest';

import type { PlanPeriod } from './types.ts';

import { DAY_MS } from './calibration.ts';
import { MONTH_MS, valueForMoney } from './valueForMoney.ts';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const period = (from: number, plan: PlanPeriod['plan']): PlanPeriod => ({ from: iso(from), plan, source: 'manual' });

/** A flat $10 per day over the whole range. */
const costBetween = (from: number, to: number) => (to - from) / DAY_MS * 10;

describe('valueForMoney', () => {
  it('prices a window at the plan list price, prorated by time', () => {
    const value = valueForMoney({ costBetween, dataStart: NOW - 60 * DAY_MS, now: NOW, planHistory: [period(NOW - 90 * DAY_MS, 'max5')] });
    expect(value?.recent?.paid).toBeCloseTo(100 * 28 * DAY_MS / MONTH_MS);
    expect(value?.recent?.apiCost).toBeCloseTo(280);
    expect(value?.allTime?.apiCost).toBeCloseTo(600);
  });

  it('derives the saving in dollars and as a share below the API price', () => {
    const value = valueForMoney({ costBetween, dataStart: NOW - 60 * DAY_MS, now: NOW, planHistory: [period(NOW - 90 * DAY_MS, 'pro')] })!.recent!;
    expect(value.saved).toBeCloseTo(value.apiCost - value.paid);
    expect(value.savedPercent).toBeCloseTo(value.saved / value.apiCost * 100);
  });

  it('prices each part of the window at the plan active then', () => {
    const history = [period(NOW - 90 * DAY_MS, 'pro'), period(NOW - 7 * DAY_MS, 'max5')];
    const { paid } = valueForMoney({ costBetween, dataStart: NOW - 60 * DAY_MS, now: NOW, planHistory: history })!.recent!;
    expect(paid).toBeCloseTo((20 * 21 + 100 * 7) * DAY_MS / MONTH_MS);
  });

  it('starts both windows at the first data when it is more recent', () => {
    const value = valueForMoney({ costBetween, dataStart: NOW - 10 * DAY_MS, now: NOW, planHistory: [period(NOW - 90 * DAY_MS, 'pro')] })!;
    expect(value.recent).toEqual(value.allTime);
    expect(value.allTime!.paid).toBeCloseTo(20 * 10 * DAY_MS / MONTH_MS);
  });

  it('prices the first plan before its period starts, and Pro without history', () => {
    const before = valueForMoney({ costBetween, dataStart: NOW - 10 * DAY_MS, now: NOW, planHistory: [period(NOW - 2 * DAY_MS, 'max20')] })!.allTime!;
    expect(before.paid).toBeCloseTo(200 * 10 * DAY_MS / MONTH_MS);
    const none = valueForMoney({ costBetween, dataStart: NOW - 10 * DAY_MS, now: NOW, planHistory: [] })!.allTime!;
    expect(none.paid).toBeCloseTo(20 * 10 * DAY_MS / MONTH_MS);
  });

  it('is absent without data or without cost', () => {
    expect(valueForMoney({ costBetween, dataStart: NOW, now: NOW, planHistory: [] })).toBeUndefined();
    expect(valueForMoney({ dataStart: NOW - DAY_MS, now: NOW, planHistory: [], costBetween: () => 0 })).toBeUndefined();
  });

  it('reports a negative saving when the plan cost more than the usage', () => {
    const cheap = (from: number, to: number) => (to - from) / DAY_MS * 0.1;
    const value = valueForMoney({ costBetween: cheap, dataStart: NOW - 28 * DAY_MS, now: NOW, planHistory: [period(NOW - 90 * DAY_MS, 'max20')] })!.allTime!;
    expect(value.saved).toBeLessThan(0);
    expect(value.savedPercent).toBeLessThan(0);
  });

  describe('with the billing date', () => {
    const start = Date.parse('2026-09-28T19:26:00Z');
    const now = Date.parse('2026-10-08T12:00:00Z');
    const pro = [period(start - DAY_MS, 'pro')];

    it('charges the full price of the cycle, however far into it you are', () => {
      const value = valueForMoney({ costBetween, dataStart: start, now, planHistory: pro, subscriptionStart: start })!;
      expect(value.kind).toBe('cycle');
      expect(value.recent!.paid).toBe(20);
      expect(value.allTime!.paid).toBe(20);
      expect(value.recent!.apiCost).toBeCloseTo((now - start) / DAY_MS * 10);
      expect(value.recent!.saved).toBeCloseTo(value.recent!.apiCost - 20);
    });

    it('counts the usage of the current cycle only, and every charge since the start in all time', () => {
      const later = Date.parse('2026-12-10T12:00:00Z');
      const value = valueForMoney({ costBetween, dataStart: start, now: later, planHistory: pro, subscriptionStart: start })!;
      expect(value.allTime!.paid).toBe(60);
      expect(value.recent!.paid).toBe(20);
      expect(value.recent!.apiCost).toBeCloseTo((later - Date.parse('2026-11-28T19:26:00Z')) / DAY_MS * 10);
    });

    it('charges a billing date at the instant, not before it', () => {
      const on = Date.parse('2026-10-28T19:26:00Z');
      expect(valueForMoney({ costBetween, dataStart: start, now: on - 1, planHistory: pro, subscriptionStart: start })!.allTime!.paid).toBe(20);
      expect(valueForMoney({ costBetween, dataStart: start, now: on, planHistory: pro, subscriptionStart: start })!.allTime!.paid).toBe(40);
    });

    it('prices each charge at the plan active on its date', () => {
      const history = [period(start - DAY_MS, 'pro'), period(Date.parse('2026-10-15T00:00:00Z'), 'max5')];
      const value = valueForMoney({ costBetween, dataStart: start, now: Date.parse('2026-11-30T00:00:00Z'), planHistory: history, subscriptionStart: start })!;
      expect(value.allTime!.paid).toBe(20 + 100 + 100);
      expect(value.recent!.paid).toBe(100);
    });

    it('cuts a billing day missing from a short month to its last day', () => {
      const thirtyFirst = Date.parse('2026-01-31T10:00:00Z');
      const feb = Date.parse('2026-02-28T10:00:00Z');
      const value = (at: number) => valueForMoney({ costBetween, dataStart: thirtyFirst, now: at, planHistory: [], subscriptionStart: thirtyFirst })!.allTime!.paid;
      expect(value(feb - 1)).toBe(20);
      expect(value(feb)).toBe(40);
    });

    it('ignores usage before the subscription started', () => {
      const value = valueForMoney({ costBetween, dataStart: start - 30 * DAY_MS, now, planHistory: pro, subscriptionStart: start })!;
      expect(value.allTime!.apiCost).toBeCloseTo((now - start) / DAY_MS * 10);
    });

    it('falls back to proration when the start is in the future', () => {
      expect(valueForMoney({ costBetween, dataStart: start, now, planHistory: pro, subscriptionStart: now + DAY_MS })!.kind).toBe('fourWeeks');
    });

    it('is absent without cost', () => {
      expect(valueForMoney({ dataStart: start, now, planHistory: pro, subscriptionStart: start, costBetween: () => 0 })).toBeUndefined();
    });
  });
});
