import type { FiveHourWindow } from '@/core/sessions';

import { startOfDay } from '@/core/aggregate';
import { DAY_MS } from '@/core/calibration';
import { formatPercent } from '@/dashboard/format';

/** One window's piece on a day row, in % of the day. */
export interface TimelinePart {
  /** The window continues from the previous day: this piece's left edge is mid-window. */
  continuesLeft: boolean;
  /** The window continues onto the next day: this piece's right edge is mid-window. */
  continuesRight: boolean;
  /** The peak fill clipped to this piece, as a % of its width; absent without a peak. */
  fillWidth?: number;
  /** The piece holding the window's start, which carries its label. */
  isStart: boolean;
  left: number;
  width: number;
  window: FiveHourWindow;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/**
 * The peak fill, one continuous bar of `peak%` across the whole window, clipped
 * to one piece and returned as a % of that piece; undefined without a peak. A
 * window split at midnight keeps a single fill: the later piece stays empty
 * until the fill reaches it.
 */
function fillWithin(window: FiveHourWindow, begin: number, end: number, start: number, finish: number): number | undefined {
  if (window.peak === undefined)
    return undefined;
  const fillEnd = start + Math.min(window.peak, 100) / 100 * (finish - start);
  return Math.max(0, Math.min(end, fillEnd) - begin) / (end - begin) * 100;
}

/** Each day's window pieces; a window crossing midnight is split over both rows. */
export function timelineRows(windows: readonly FiveHourWindow[], days: readonly string[], timeZone: string): { day: string; parts: TimelinePart[] }[] {
  return days.map((day) => {
    const from = startOfDay(day, timeZone);
    const to = startOfDay(nextDay(day), timeZone);
    const parts = windows.flatMap((window) => {
      const start = Date.parse(window.start);
      const finish = Date.parse(window.end);
      const begin = Math.max(start, from);
      const end = Math.min(finish, to);
      if (end <= begin)
        return [];
      return [{ continuesLeft: start < from, continuesRight: finish > to, fillWidth: fillWithin(window, begin, end, start, finish), isStart: start >= from, left: (begin - from) / (to - from) * 100, width: (end - begin) / (to - from) * 100, window }];
    });
    return { day, parts };
  });
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', weekday: 'short' });

/** "Fri 25 Sept" for a local day `YYYY-MM-DD`. */
export const formatSessionDay = (day: string) => dayFormat.format(new Date(`${day}T12:00:00Z`));

const timeFormats = new Map<string, Intl.DateTimeFormat>();

export function formatTime(iso: string, timeZone: string): string {
  let format = timeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', timeZone });
    timeFormats.set(timeZone, format);
  }
  return format.format(new Date(iso));
}

/** "10:12–15:12". */
export const formatSpan = (window: FiveHourWindow, timeZone: string) => `${formatTime(window.start, timeZone)}–${formatTime(window.end, timeZone)}`;

/** "47%", "~47%" when estimated, "–" without a peak. */
export function peakText(window: FiveHourWindow): string {
  if (window.peak === undefined)
    return '–';
  return `${window.peakEstimated ? '~' : ''}${formatPercent(window.peak)}`;
}

/** Up to two project names, then "+n". */
export function projectsText(window: FiveHourWindow): string {
  const names = window.projects.map(p => p.name);
  if (names.length === 0)
    return '–';
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}
