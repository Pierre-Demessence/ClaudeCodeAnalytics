import type { WeekRow } from '@/core/weekHistory';

import { dayKey } from '@/core/aggregate';
import { DAY_MS } from '@/core/calibration';
import { formatDollars, formatPercent } from '@/dashboard/format';
import { formatSessionDay, formatTime } from '@/dashboard/sessionsData';

/** Upper bounds of heat levels 1 to 4: the costliest day split in five equal steps. Empty before any cost. */
export function heatBounds(weeks: readonly WeekRow[]): number[] {
  const max = Math.max(0, ...weeks.flatMap(w => w.days.map(cost => cost ?? 0)));
  return max > 0 ? [1, 2, 3, 4].map(i => max * i / 5) : [];
}

/** 0 for no cost, else 1 to 5 by step. */
export function heatLevel(cost: number, bounds: readonly number[]): number {
  if (cost <= 0)
    return 0;
  return 1 + bounds.filter(bound => cost >= bound).length;
}

/** "under $20", "$20–40", …, "$80 and up". */
export function heatLegend(bounds: readonly number[]): string[] {
  if (bounds.length === 0)
    return [];
  const dollars = bounds.map(formatDollars);
  return [
    `under ${dollars[0]}`,
    ...dollars.slice(0, -1).map((low, i) => `${low}–${dollars[i + 1]!.slice(1)}`),
    `${dollars.at(-1)} and up`,
  ];
}

/** "Thu 1 Oct → Thu 8 Oct", by local day. */
export function formatWeekRange(week: WeekRow, timeZone: string): string {
  const day = (iso: string) => formatSessionDay(dayKey(Date.parse(iso), timeZone));
  return `${day(week.start)} → ${day(week.end)}`;
}

const weekdayFormats = new Map<string, Intl.DateTimeFormat>();

function weekdayOf(ms: number, timeZone: string): string {
  let format = weekdayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' });
    weekdayFormats.set(timeZone, format);
  }
  return format.format(new Date(ms));
}

/** "Thu 07:00". */
export const resetText = (iso: string, timeZone: string) => `${weekdayOf(Date.parse(iso), timeZone)} ${formatTime(iso, timeZone)}`;

/** The 7 weekdays of a window's day blocks, from the weekday of its start. */
export function dayHeaders(startIso: string, timeZone: string): string[] {
  const start = Date.parse(startIso);
  return Array.from({ length: 7 }, (_, i) => weekdayOf(start + i * DAY_MS, timeZone));
}

/** "47%", "~47%" when estimated, "–" without a percent. */
export function percentText(week: WeekRow): string {
  if (week.percent === undefined)
    return '–';
  return `${week.percentEstimated ? '~' : ''}${formatPercent(week.percent)}`;
}

/** Up to two project names, then "+n". */
export function projectsText(week: WeekRow): string {
  const names = week.projects.map(p => p.name);
  if (names.length === 0)
    return '–';
  return week.projectCount > 2 ? `${names.slice(0, 2).join(', ')} +${week.projectCount - 2}` : names.join(', ');
}
