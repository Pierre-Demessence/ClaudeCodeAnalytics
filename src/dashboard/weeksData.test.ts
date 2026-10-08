import { describe, expect, it } from 'vitest';

import type { WeekRow } from '@/core/weekHistory';

import { dayHeaders, formatWeekRange, heatBounds, heatLegend, heatLevel, percentText, projectsText, resetText } from '@/dashboard/weeksData';

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
