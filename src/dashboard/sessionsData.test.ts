import { describe, expect, it } from 'vitest';

import type { FiveHourWindow } from '@/core/sessions';

import { formatSessionDay, formatSpan, nowMark, peakText, projectsText, timelineRows } from '@/dashboard/sessionsData';

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
    expect(before).toMatchObject({ continuesLeft: false, continuesRight: true, hasLabel: true, left: 87.5 });
    expect(before!.width).toBeCloseTo(12.5);
    expect(after).toMatchObject({ continuesLeft: true, continuesRight: false, hasLabel: false, left: 0 });
    expect(after!.width).toBeCloseTo(100 / 12);
  });

  it('labels the wider piece of a window split near midnight', () => {
    // Paris is UTC+2: 23:20–04:20 local, only 40 minutes before midnight.
    const window = win('2026-10-01T21:20:00.000Z', '2026-10-02T02:20:00.000Z');
    const [after, before] = timelineRows([window], ['2026-10-02', '2026-10-01'], 'Europe/Paris');
    expect(before!.parts[0]!.hasLabel).toBe(false);
    expect(after!.parts[0]!.hasLabel).toBe(true);
  });

  it('keeps the label on the start piece when the next day has no row', () => {
    const window = win('2026-10-01T21:20:00.000Z', '2026-10-02T02:20:00.000Z');
    const [row] = timelineRows([window], ['2026-10-01'], 'Europe/Paris');
    expect(row!.parts[0]!.hasLabel).toBe(true);
  });

  it('spreads one peak fill across a split window, filling pieces in order', () => {
    // Paris is UTC+2: 19:25–00:25 local, a 5-hour window at 65%. The 3h15 fill
    // lands inside the before-midnight piece, so the 25-minute one stays empty.
    const window = win('2026-10-01T17:25:00.000Z', '2026-10-01T22:25:00.000Z', { peak: 65 });
    const rows = timelineRows([window], ['2026-10-02', '2026-10-01'], 'Europe/Paris');
    const [after] = rows[0]!.parts;
    const [before] = rows[1]!.parts;
    // Before-midnight piece is 275 of the 300 minutes; 195 min (65%) fill it 70.9%.
    expect(before!.fillWidth).toBeCloseTo(195 / 275 * 100);
    expect(after!.fillWidth).toBe(0);
  });

  it('carries no fill without a peak, and a same-day window is not cut', () => {
    const rows = timelineRows([win('2026-10-01T08:00:00.000Z', '2026-10-01T13:00:00.000Z')], ['2026-10-01'], 'UTC');
    expect(rows[0]!.parts[0]).toMatchObject({ continuesLeft: false, continuesRight: false, fillWidth: undefined });
  });

  it('leaves out windows outside the day', () => {
    const rows = timelineRows([win('2026-10-01T08:00:00.000Z', '2026-10-01T13:00:00.000Z')], ['2026-10-02'], 'UTC');
    expect(rows[0]!.parts).toEqual([]);
  });
});

describe('nowMark', () => {
  it('places now on its local day, as a % of that day', () => {
    // 22:00 in Paris (UTC+2).
    const mark = nowMark(Date.parse('2026-10-03T20:00:00Z'), 'Europe/Paris');
    expect(mark.day).toBe('2026-10-03');
    expect(mark.left).toBeCloseTo(22 / 24 * 100);
  });

  it('measures a 25-hour day when the clocks go back', () => {
    // Sun 25 Oct 2026 in Paris runs 25 hours; 13:00 local is 14 hours in.
    expect(nowMark(Date.parse('2026-10-25T12:00:00Z'), 'Europe/Paris').left).toBeCloseTo(14 / 25 * 100);
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
