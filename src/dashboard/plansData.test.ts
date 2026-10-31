import { describe, expect, it } from 'vitest';

import type { PlanFit, PlanFitInput } from '@/core/planFit';

import { evaluatePlans } from '@/core/planFit';
import { bestVerdict, cardVerdict, chartBars, estimateText, heldBackText, shareText, switchText, valueText } from '@/dashboard/plansData';

const week = (i: number, demand: number, extra = {}) => ({ cost: 100, demand, estimated: false, floor: demand, hiddenHours: 0, plans: ['max5' as const], shift: 0, start: new Date(Date.UTC(2026, 6, 10 + 7 * i, 7)).toISOString(), ...extra });
const input: PlanFitInput = {
  plan: 'max5',
  sessions: Array.from({ length: 20 }, (_, i) => ({ demand: i === 7 ? 112 : 20 + i, estimated: false, floor: i === 7 ? 112 : 20 + i, shift: 0 })),
  weeks: [41, 55, 118, 62].map((demand, i) => week(i, demand, demand > 100 ? { estimated: true } : {})),
};
const fits = Object.fromEntries(evaluatePlans(input).map(f => [f.plan, f])) as Record<PlanFit['plan'], PlanFit>;
/** Ultra holds the sample's weeks; this is a plan that is more than they need. */
const big = { ...fits.max20, busiest: 29.5, busiestFloor: 29.5, typical: 14.625, typicalFloor: 14.625, verdict: 'tooBig' as const };

describe('verdict texts', () => {
  it('describes each verdict of a card', () => {
    expect(cardVerdict(fits.max5, input, 'UTC')).toEqual({ detail: 'Over the limit in 1 of 4 weeks and 1 of 20 sessions.', title: 'Close.' });
    expect(cardVerdict(fits.pro, input, 'UTC').title).toBe('Too small.');
    expect(cardVerdict(big, input, 'UTC')).toEqual({ detail: 'Your busiest week used only 29% of it; a typical week leaves 85% unused.', title: 'Too big.' });
    expect(cardVerdict({ ...fits.max5, typical: 61, verdict: 'fits' }, input, 'UTC').detail).toBe('A typical week leaves 39% unused.');
  });

  it('gives the room to grow of a roomy plan that fits, in typical weeks rounded down', () => {
    const roomy = { ...fits.max5, busiest: 44, busiestFloor: 44, typical: 36, typicalFloor: 36, verdict: 'fits' as const };
    expect(cardVerdict(roomy, input, 'UTC')).toEqual({ detail: 'Room for ≈ 2.7× a typical week; the smallest plan that holds your weeks.', title: 'Fits, with room to grow.' });
    expect(bestVerdict(roomy, input, 'UTC')).toEqual({ detail: 'A typical week uses 36% of it and your busiest week 44%: room for ≈ 2.7× a typical week.', title: 'Fits, with room to grow.' });
    expect(cardVerdict({ ...roomy, typical: 4 }, input, 'UTC').detail).toContain('≈ 25×');
  });

  it('lists the dates of the few weeks over the limit for the best plan only', () => {
    expect(bestVerdict(fits.max5, input, 'UTC')).toEqual({ detail: 'Over the limit in 1 of 4 weeks (24 Jul) and 1 of 20 sessions.', title: 'Close.' });
    const many = { ...fits.max5, overWeeks: input.weeks.map(w => w.start), weeksOver: 4 };
    expect(bestVerdict(many, input, 'UTC').detail).toBe('Over the limit in 4 of 4 weeks and 1 of 20 sessions.');
  });

  it('names what is wrong with a best plan that is not a clean fit', () => {
    expect(bestVerdict(big, input, 'UTC')).toEqual({ detail: 'Your busiest week used only 29% of it.', title: 'More than you need.' });
    expect(bestVerdict({ ...fits.max5, verdict: 'tooSmall' }, input, 'UTC').title).toBe('Too small, but the nearest match.');
    expect(bestVerdict({ ...fits.max5, busiest: 80, busiestFloor: 80, typical: 60, typicalFloor: 60, verdict: 'fits' }, input, 'UTC').detail).toBe('A typical week uses 60% of it and your busiest week 80%.');
  });

  it('never rounds a busiest week just under half up to 50%', () => {
    expect(bestVerdict({ ...big, busiest: 49.6, busiestFloor: 49.6 }, input, 'UTC').detail).toBe('Your busiest week used only 49% of it.');
  });
});

describe('heldBackText', () => {
  const on = (plans: PlanFit['plan'][]): PlanFitInput => ({ ...input, weeks: input.weeks.map(w => ({ ...w, plans })) });

  const note = 'Measured on a smaller plan whose limits you ran into: if you held back to stay under them, expect to use more than these numbers show.';

  it('warns that weeks used on a cheaper plan are a minimum when one of them went over its limit', () => {
    expect(heldBackText(fits.max5, on(['pro']), 0)).toBe(note);
    // Only the third week, 118% of Max, went over it.
    expect(heldBackText(fits.max20, on(['max5', 'max20']), 0)).toBe(note);
  });

  it('says nothing when the weeks were used on the best plan, or the weeks on a smaller plan stayed under its limit', () => {
    expect(heldBackText(fits.max5, on(['max5']), 0)).toBeUndefined();
    // Only the 41% week was on Max; the 118% one was on Ultra.
    const mixed = { ...input, weeks: input.weeks.map((w, i) => ({ ...w, plans: [i === 0 ? 'max5' as const : 'max20' as const] })) };
    expect(heldBackText(fits.max20, mixed, 0)).toBeUndefined();
  });

  it('follows the share of Opus work moved to Sonnet', () => {
    const shifted = { ...input, weeks: input.weeks.map(w => ({ ...w, plans: ['max5' as const], shift: 0.5 })) };
    expect(heldBackText(fits.max20, shifted, 0)).toBe(note);
    // 118% × 0.5 stays under the limit.
    expect(heldBackText(fits.max20, shifted, 1)).toBeUndefined();
  });
});

describe('switchText', () => {
  it('tags the current plan', () => {
    expect(switchText(fits.max5, fits.max5)).toEqual({ tag: 'your current plan' });
  });

  it('says what switching does to the monthly bill', () => {
    expect(switchText(fits.pro, fits.max5)).toEqual({ action: 'Saves $80 / month', tag: 'switch from Max' });
    expect(switchText(fits.max20, fits.max5)).toEqual({ action: 'Costs $100 more / month', tag: 'switch from Max' });
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

  it('splits a bar with hidden time into its minimum and the estimate, and says so in the tooltip', () => {
    const weeks = [week(0, 190, { estimated: true, floor: 71.5, hiddenHours: 120 }), week(1, 60), week(2, 60)];
    const [capped, plain] = chartBars({ plan: 'pro', sessions: [], weeks }, 'pro', 0, 'UTC');
    expect(capped).toMatchObject({ label: '≈190%', over: true });
    expect(capped!.height).toBe(100);
    expect(capped!.floorHeight).toBeCloseTo(71.5 / 150 * 100);
    expect(capped!.tip).toBe('Week of 10 Jul: ≈ 190% of the Pro limit, over it. At least 72%: 5 days were hidden (by the limit, before you subscribed or before the oldest transcript) and filled at your typical pace.');
    expect(plain!.floorHeight).toBeUndefined();
    expect(plain!.tip).not.toContain('hidden');
  });

  it('converts the minimum with the estimate when the chart shows another plan', () => {
    const weeks = [week(0, 40, { estimated: true, floor: 20, hiddenHours: 36 }), week(1, 60), week(2, 60)];
    const [bar] = chartBars({ plan: 'max5', sessions: [], weeks }, 'max20', 0, 'UTC');
    expect(bar).toMatchObject({ label: '≈20%' });
    expect(bar!.floorHeight).toBeCloseTo(10 / 150 * 100);
    expect(bar!.tip).toContain('At least 10%: 1.5 days');
  });
});

describe('estimateText', () => {
  it('puts ≈ on an estimate above its minimum, with the minimum under it', () => {
    expect(estimateText(190, 71.5)).toEqual({ main: '≈ 190%', minimum: 'at least 72%' });
  });

  it('is the plain % when the estimate is the minimum at the displayed precision', () => {
    expect(estimateText(62, 62)).toEqual({ main: '62%' });
    expect(estimateText(62.2, 62)).toEqual({ main: '62%' });
  });

  it('marks the numbers of the verdicts that are estimates', () => {
    expect(bestVerdict({ ...fits.max5, busiest: 80, busiestFloor: 60, typical: 60, typicalFloor: 60, verdict: 'fits' }, input, 'UTC').detail).toBe('A typical week uses 60% of it and your busiest week ≈ 80%.');
    expect(cardVerdict({ ...big, busiestFloor: 20 }, input, 'UTC').detail).toContain('only ≈ 29% of it');
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
