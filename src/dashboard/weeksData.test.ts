import { describe, expect, it } from 'vitest';

import type { FitWeek, PlanFitInput } from '@/core/planFit';
import type { WeekPart, WeekRow } from '@/core/weekHistory';

import { chartBars } from '@/dashboard/plansData';
import { dayHeaders, formatWeekRange, heatBounds, heatLegend, heatLevel, percentText, projectsText, resetText, restartTip, uncappedMedian, uncappedOf, uncappedText, uncappedTip } from '@/dashboard/weeksData';

function week(extra: Partial<WeekRow> = {}): WeekRow {
  return { blockedSessions: 0, cappedSessions: 0, cost: 0, days: [], end: '2026-10-08T05:00:00.000Z', messages: 0, projectCount: 0, projects: [], sessions: 0, source: 'reading', start: '2026-10-01T05:00:00.000Z', ...extra };
}

describe('heat levels', () => {
  const bounds = heatBounds([week({ days: [100, 20, null] }), week({ days: [0, 50, 10] })]);

  it('splits the costliest day in five equal steps', () => {
    expect(bounds).toEqual([20, 40, 60, 80]);
  });

  it('puts a cost in its step, and no cost in level 0', () => {
    expect([0, 5, 20, 59, 60, 100].map(cost => heatLevel(cost, bounds))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('has no steps before any cost', () => {
    expect(heatBounds([week({ days: [0, null] })])).toEqual([]);
    expect(heatLegend([])).toEqual([]);
  });

  it('writes the legend from the steps', () => {
    expect(heatLegend(bounds)).toEqual(['under $20', '$20–40', '$40–60', '$60–80', '$80 and up']);
  });
});

describe('labels', () => {
  it('writes the range from the local days of the reset', () => {
    // Paris is UTC+2: the window starts Thursday 07:00 local.
    expect(formatWeekRange(week(), 'Europe/Paris')).toBe('Thu 1 Oct → Thu 8 Oct');
  });

  it('writes the reset weekday and time', () => {
    expect(resetText('2026-10-01T05:00:00.000Z', 'Europe/Paris')).toBe('Thu 07:00');
  });

  it('starts the day headers at the reset weekday', () => {
    expect(dayHeaders('2026-10-01T05:00:00.000Z', 'Europe/Paris')).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
  });

  it('marks an estimated percent with ~ and a missing one with a dash', () => {
    expect(percentText(week({ percent: 47.4 }))).toBe('47%');
    expect(percentText(week({ percent: 47.4, percentEstimated: true }))).toBe('~47%');
    expect(percentText(week())).toBe('–');
  });

  it('shows up to two project names, then how many more', () => {
    const p = (name: string) => ({ name, cost: 1, path: `S:\\${name}` });
    expect(projectsText(week())).toBe('–');
    expect(projectsText(week({ projectCount: 2, projects: [p('a'), p('b')] }))).toBe('a, b');
    expect(projectsText(week({ projectCount: 7, projects: [p('a'), p('b'), p('c'), p('d'), p('e')] }))).toBe('a, b +5');
  });
});

describe('estimate without the limit', () => {
  const fitWeek = (extra: Partial<FitWeek> = {}): FitWeek => ({ cost: 0, demand: 212, estimated: true, floor: 99, hiddenHours: 86.4, shift: 0, start: '2026-10-01T05:00:00.000Z', ...extra });
  const input = (weeks: FitWeek[]): PlanFitInput => ({ plan: 'pro', sessions: [], weeks });

  it('joins the estimate of a finished week above its reading', () => {
    expect(uncappedOf(input([fitWeek()]), week({ percent: 99 }))?.demand).toBe(212);
    expect(uncappedText(212.4)).toBe('≈ 212%');
  });

  it('has none when the estimate equals the reading, or the week is in progress or has no percent', () => {
    expect(uncappedOf(input([fitWeek({ demand: 99.2 })]), week({ percent: 99 }))).toBeUndefined();
    expect(uncappedOf(input([fitWeek()]), week({ inProgress: true, percent: 99 }))).toBeUndefined();
    expect(uncappedOf(input([fitWeek()]), week())).toBeUndefined();
    expect(uncappedOf(input([]), week({ percent: 99 }))).toBeUndefined();
  });

  it('gives the median of the estimates only when it exceeds the median peak', () => {
    const weeks = [fitWeek({ demand: 190, floor: 90, start: 'a' }), fitWeek({ demand: 196, floor: 99, start: 'b' }), fitWeek({ demand: 40, floor: 40, start: 'c' })];
    expect(uncappedMedian(input(weeks), 90)).toBe(190);
    expect(uncappedMedian(input(weeks), 190)).toBeUndefined();
    expect(uncappedMedian(input(weeks), undefined)).toBeUndefined();
  });

  it('says how many days were hidden and why', () => {
    const limited = week({ blockedSessions: 2, percent: 99, pressureAt: '2026-10-03T10:00:00.000Z' });
    expect(uncappedTip(limited, fitWeek(), 'UTC')).toBe('At least 99%: 3.6 days were hidden (the limit was close by Sat 3 Oct 10:00, 2 sessions blocked by a 5-hour limit) and filled at your typical pace.');
    expect(uncappedTip(week({ percent: 99 }), fitWeek(), 'UTC')).toContain('(before you subscribed)');
    expect(uncappedTip(week({ limitHits: ['2026-10-04T08:00:00.000Z'], percent: 99 }), fitWeek(), 'UTC')).toContain('the weekly limit was hit on Sun 4 Oct 08:00');
    expect(uncappedTip(week({ percent: 10, source: 'estimated', transcriptsFrom: '2026-10-03T10:00:00.000Z' }), fitWeek(), 'UTC')).toContain('(before the oldest transcript, from Sat 3 Oct 10:00)');
  });

  it('equals the Plans chart bar of the same week and the Typical week of the current plan', () => {
    const weeks = [fitWeek({ start: '2026-09-17T05:00:00.000Z' }), fitWeek({ demand: 60, floor: 60, start: '2026-09-24T05:00:00.000Z' }), fitWeek({ demand: 150, floor: 100, start: '2026-10-01T05:00:00.000Z' })];
    const planFit = input(weeks);
    const bars = chartBars(planFit, 'pro', 0, 'UTC');
    weeks.forEach((fit, i) => {
      const row = week({ percent: fit.floor, start: fit.start });
      const uncapped = uncappedOf(planFit, row);
      if (uncapped)
        expect(uncappedText(uncapped.demand).replace(' ', '')).toBe(bars[i]!.label);
      else
        expect(bars[i]!.label).toBe(`${Math.round(fit.demand)}%`);
    });
    expect(uncappedMedian(planFit, 60)).toBe(150);
  });
});

describe('restartTip', () => {
  const part = (extra: Partial<WeekPart>): WeekPart => ({ end: '2026-10-03T10:00:00.000Z', percent: 0, plan: 'pro', planPercent: 0, start: '2026-10-01T05:00:00.000Z', ...extra });

  it('lists the parts of a plan change and says how the peak adds them up', () => {
    const parts = [part({ planPercent: 100 }), part({ end: '2026-10-08T05:00:00.000Z', percent: 6, plan: 'max5', planPercent: 30, start: '2026-10-03T10:00:00.000Z' })];
    expect(restartTip(week({ parts, planChange: true }), 'max5', 'UTC')).toBe([
      'Usage restarted with the change to Max 5× on Sat 3 Oct 10:00.',
      'Pro until Sat 3 Oct 10:00: 100% of Pro',
      'Max 5× from Sat 3 Oct 10:00: 30% of Max 5×',
      'The peak adds the parts up, on Max 5×.',
    ].join('\n'));
  });

  it('says a reset without a plan change, and marks an estimated part', () => {
    const parts = [part({ percentEstimated: true, planPercent: 40 }), part({ planPercent: 5, start: '2026-10-03T10:00:00.000Z' })];
    const text = restartTip(week({ parts }), 'pro', 'UTC');
    expect(text).toContain('Usage reset on Sat 3 Oct 10:00, without a plan change.');
    expect(text).toContain('Pro until Sat 3 Oct 10:00: ~40% of Pro');
  });

  it('explains a plan change without a reset', () => {
    expect(restartTip(week({ planChange: true }), 'max5', 'UTC')).toContain('without a usage reset');
  });
});
