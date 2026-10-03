import { describe, expect, it } from 'vitest';

import type { FiveHourWindow } from '@/core/sessions';

import { formatSessionDay, formatSpan, peakText, projectsText, timelineRows } from '@/dashboard/sessionsData';

function win(start: string, end: string, extra: Partial<FiveHourWindow> = {}): FiveHourWindow {
  return { cost: 0, end, messages: 0, projects: [], source: 'reading', start, ...extra };
}

describe('timelineRows', () => {
  it('places a window by its local time and splits it at midnight', () => {
    // Paris is UTC+2: 21:00–02:00 local.
    const window = win('2026-10-01T19:00:00.000Z', '2026-10-02T00:00:00.000Z');
    const rows = timelineRows([window], ['2026-10-02', '2026-10-01'], 'Europe/Paris');
    expect(rows.map(r => r.day)).toEqual(['2026-10-02', '2026-10-01']);
    const [after] = rows[0]!.parts;
    const [before] = rows[1]!.parts;
    expect(before).toMatchObject({ isStart: true, left: 87.5 });
    expect(before!.width).toBeCloseTo(12.5);
    expect(after).toMatchObject({ isStart: false, left: 0 });
    expect(after!.width).toBeCloseTo(100 / 12);
  });

  it('leaves out windows outside the day', () => {
    const rows = timelineRows([win('2026-10-01T08:00:00.000Z', '2026-10-01T13:00:00.000Z')], ['2026-10-02'], 'UTC');
    expect(rows[0]!.parts).toEqual([]);
  });
});

describe('labels', () => {
  it('formats days and spans in the summary time zone', () => {
    expect(formatSessionDay('2026-10-01')).toMatch(/^Thu 1 Oct/);
    expect(formatSpan(win('2026-10-01T08:12:00.000Z', '2026-10-01T13:12:00.000Z'), 'Europe/Paris')).toBe('10:12–15:12');
  });

  it('writes the peak as read, estimated or missing', () => {
    expect(peakText(win('', '', { peak: 47 }))).toBe('47%');
    expect(peakText(win('', '', { peak: 47.4, peakEstimated: true }))).toBe('~47%');
    expect(peakText(win('', ''))).toBe('–');
  });

  it('names up to two projects', () => {
    const project = (name: string) => ({ name, cost: 1, path: name });
    expect(projectsText(win('', '', { projects: ['a', 'b'].map(project) }))).toBe('a, b');
    expect(projectsText(win('', '', { projects: ['a', 'b', 'c', 'd'].map(project) }))).toBe('a, b +2');
    expect(projectsText(win('', ''))).toBe('–');
  });
});
