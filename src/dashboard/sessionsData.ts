import type { FiveHourWindow } from '@/core/sessions';

import { startOfDay } from '@/core/aggregate';
import { DAY_MS } from '@/core/calibration';
import { formatPercent } from '@/dashboard/format';

/** One window's piece on a day row, in % of the day. */
export interface TimelinePart {
  /** The piece holding the window's start, which carries its label. */
  isStart: boolean;
  left: number;
  width: number;
  window: FiveHourWindow;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** Each day's window pieces; a window crossing midnight is split over both rows. */
export function timelineRows(windows: readonly FiveHourWindow[], days: readonly string[], timeZone: string): { day: string; parts: TimelinePart[] }[] {
  return days.map((day) => {
    const from = startOfDay(day, timeZone);
    const to = startOfDay(nextDay(day), timeZone);
    const parts = windows.flatMap((window) => {
      const start = Date.parse(window.start);
      const begin = Math.max(start, from);
      const end = Math.min(Date.parse(window.end), to);
      if (end <= begin)
        return [];
      return [{ isStart: start >= from, left: (begin - from) / (to - from) * 100, width: (end - begin) / (to - from) * 100, window }];
    });
    return { day, parts };
  });
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', weekday: 'short' });

/** "Fri 25 Sept" for a local day `YYYY-MM-DD`. */
export const formatSessionDay = (day: string) => dayFormat.format(new Date(`${day}T12:00:00Z`));

const timeFormats = new Map<string, Intl.DateTimeFormat>();

function formatTime(iso: string, timeZone: string): string {
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
