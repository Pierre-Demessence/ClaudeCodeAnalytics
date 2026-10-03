import { describe, expect, it } from 'vitest';

import type { PlanFit, PlanFitInput } from '@/core/planFit';

import { evaluatePlans } from '@/core/planFit';
import { bestVerdict, cardVerdict, chartBars, shareText, switchText, valueText } from '@/dashboard/plansData';

const week = (i: number, demand: number, extra = {}) => ({ cost: 100, demand, estimated: false, shift: 0, start: new Date(Date.UTC(2026, 6, 10 + 7 * i, 7)).toISOString(), ...extra });
const input: PlanFitInput = {
  plan: 'max5',
  sessions: Array.from({ length: 20 }, (_, i) => ({ demand: i === 7 ? 112 : 20 + i, estimated: false, shift: 0 })),
  weeks: [41, 55, 118, 62].map((demand, i) => week(i, demand, demand > 100 ? { estimated: true } : {})),
};
const fits = Object.fromEntries(evaluatePlans(input).map(f => [f.plan, f])) as Record<PlanFit['plan'], PlanFit>;

describe('verdict texts', () => {
  it('describes each verdict of a card', () => {
    expect(cardVerdict(fits.max5, input, 'UTC')).toEqual({ detail: 'Over the limit in 1 of 4 weeks and 1 of 20 sessions.', title: 'Close.' });
    expect(cardVerdict(fits.pro, input, 'UTC').title).toBe('Too small.');
    expect(cardVerdict(fits.max20, input, 'UTC')).toEqual({ detail: 'Your busiest week used only 29% of it; a typical week leaves 85% unused.', title: 'Too big.' });
    expect(cardVerdict({ ...fits.max5, typical: 61, verdict: 'fits' }, input, 'UTC').detail).toBe('A typical week leaves 39% unused.');
  });

  it('lists the dates of the few weeks over the limit for the best plan only', () => {
    expect(bestVerdict(fits.max5, input, 'UTC')).toEqual({ detail: 'Over the limit in 1 of 4 weeks (24 Jul) and 1 of 20 sessions.', title: 'Close.' });
    const many = { ...fits.max5, overWeeks: input.weeks.map(w => w.start), weeksOver: 4 };
    expect(bestVerdict(many, input, 'UTC').detail).toBe('Over the limit in 4 of 4 weeks and 1 of 20 sessions.');
  });

  it('names what is wrong with a best plan that is not a clean fit', () => {
    expect(bestVerdict(fits.max20, input, 'UTC')).toEqual({ detail: 'Your busiest week used only 29% of it.', title: 'More than you need.' });
    expect(bestVerdict({ ...fits.max5, verdict: 'tooSmall' }, input, 'UTC').title).toBe('Too small, but the nearest match.');
    expect(bestVerdict({ ...fits.max5, busiest: 80, typical: 60, verdict: 'fits' }, input, 'UTC').detail).toBe('A typical week uses 60% of it and your busiest week 80%.');
  });

  it('never rounds a busiest week just under half up to 50%', () => {
    expect(bestVerdict({ ...fits.max20, busiest: 49.6 }, input, 'UTC').detail).toBe('Your busiest week used only 49% of it.');
  });
});

describe('switchText', () => {
  it('tags the current plan', () => {
    expect(switchText(fits.max5, fits.max5)).toEqual({ tag: 'your current plan' });
  });

  it('says what switching does to the monthly bill', () => {
    expect(switchText(fits.pro, fits.max5)).toEqual({ action: 'Saves $80 / month', tag: 'switch from Max 5×' });
    expect(switchText(fits.max20, fits.max5)).toEqual({ action: 'Costs $100 more / month', tag: 'switch from Max 5×' });
  });
});

describe('chartBars', () => {
  it('draws each week on the chosen plan, cut at the chart top', () => {
    const bars = chartBars(input, 'pro', 0, 'UTC');
    expect(bars.map(b => b.label)).toEqual(['205%', '275%', '590%', '310%']);
    expect(bars.every(b => b.over && b.height === 100)).toBe(true);
    const own = chartBars(input, 'max5', 0, 'UTC');
    expect(own.map(b => b.over)).toEqual([false, false, true, false]);
    expect(own[0]!.height).toBeCloseTo(41 / 150 * 100);
  });

  it('marks an estimated week unless it is over the limit, and follows the share', () => {
    expect(chartBars(input, 'max5', 0, 'UTC')[2]).toMatchObject({ estimated: false, over: true });
    const weeks = [week(0, 60, { estimated: true, shift: 0.5 }), week(1, 60), week(2, 60)];
    const moved = chartBars({ plan: 'max5', sessions: [], weeks }, 'max5', 1, 'UTC');
    expect(moved[0]).toMatchObject({ estimated: true, label: '30%' });
    expect(moved[0]!.tip).toContain('Estimated');
  });
});

describe('small texts', () => {
  it('words the moved share and the API value', () => {
    expect(shareText(0.25)).toBe('25% of Opus work on Sonnet');
    expect(shareText(1)).toBe('All Opus work on Sonnet');
    expect(valueText(12.6)).toBe('≈ 13×');
    expect(valueText(undefined)).toBe('–');
  });
});
