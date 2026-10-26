import type { FitWeek, PlanFitInput } from '@/core/planFit';
import type { Plan } from '@/core/types';
import type { WeekPart, WeekRow } from '@/core/weekHistory';

import { dayKey } from '@/core/aggregate';
import { DAY_MS } from '@/core/calibration';
import { evaluatePlans } from '@/core/planFit';
import { PLAN_LABELS } from '@/core/plans';
import { formatDollars, formatPercent } from '@/dashboard/format';
import { daysText, differs } from '@/dashboard/plansData';
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

/** The Plans tab's estimate for a finished week, when it exceeds the reading at the displayed precision; the same numbers as the Plans chart on the current plan. */
export function uncappedOf(planFit: PlanFitInput, week: WeekRow): FitWeek | undefined {
  if (week.inProgress || week.percent === undefined)
    return undefined;
  const fit = planFit.weeks.find(w => w.start === week.start);
  return fit && differs(fit.demand, week.percent) ? fit : undefined;
}

/** "≈ 212%". */
export const uncappedText = (percent: number) => `≈ ${formatPercent(percent)}`;

/** The median of the finished weeks' estimates on the current plan, when it exceeds `medianPercent`; the Plans tab's "Typical week". */
export function uncappedMedian(planFit: PlanFitInput, medianPercent: number | undefined): number | undefined {
  if (medianPercent === undefined)
    return undefined;
  const typical = evaluatePlans(planFit).find(fit => fit.plan === planFit.plan)?.typical;
  return typical !== undefined && differs(typical, medianPercent) ? typical : undefined;
}

/** Why a week's estimate is above its reading: how long was hidden, and by what. */
export function uncappedTip(week: WeekRow, fit: FitWeek, timeZone: string): string {
  const when = (iso: string) => `${formatSessionDay(dayKey(Date.parse(iso), timeZone))} ${formatTime(iso, timeZone)}`;
  const firstHit = week.limitHits?.[0];
  const reasons = [
    week.pressureAt ? `the limit was close by ${when(week.pressureAt)}` : firstHit && `the weekly limit was hit on ${when(firstHit)}`,
    week.blockedSessions > 0 && `${week.blockedSessions} ${week.blockedSessions === 1 ? 'session' : 'sessions'} blocked by a 5-hour limit`,
  ].filter(Boolean);
  const why = reasons.length > 0 ? reasons.join(', ') : 'before you subscribed';
  return `At least ${formatPercent(fit.floor)}: ${daysText(fit.hiddenHours)} were hidden (${why}) and filled at your typical pace.`;
}

/**
 * Why a week is flagged as restarted: when and why its usage restarted, each part's %, and how the peak adds them up on `plan`.
 * Only for a week with `parts` or a plan change.
 */
export function restartTip(week: WeekRow, plan: Plan, timeZone: string): string {
  const parts = week.parts;
  if (!parts || parts.length < 2)
    return 'The plan changed in this week without a usage reset: the % after the change covers the whole week on the new plan.';
  const when = (iso: string) => `${formatSessionDay(dayKey(Date.parse(iso), timeZone))} ${formatTime(iso, timeZone)}`;
  const label = (part: WeekPart) => PLAN_LABELS[part.plan];
  const percent = (part: WeekPart) => `${part.percentEstimated ? '~' : ''}${formatPercent(part.planPercent)} of ${label(part)}`;
  const restarts = parts.slice(1).map((part, i) => parts[i]!.plan === part.plan
    ? `Usage reset on ${when(part.start)}, without a plan change.`
    : `Usage restarted with the change to ${label(part)} on ${when(part.start)}.`);
  const lines = parts.map((part, i) => {
    const from = i > 0 ? `from ${when(part.start)}` : '';
    const until = i < parts.length - 1 ? `until ${when(part.end)}` : '';
    return `${label(part)} ${[from, until].filter(Boolean).join(' ')}: ${percent(part)}`;
  });
  return [...restarts, ...lines, `The peak adds the parts up, on ${PLAN_LABELS[plan]}.`].join('\n');
}

/** Up to two project names, then "+n". */
export function projectsText(week: WeekRow): string {
  const names = week.projects.map(p => p.name);
  if (names.length === 0)
    return '–';
  return week.projectCount > 2 ? `${names.slice(0, 2).join(', ')} +${week.projectCount - 2}` : names.join(', ');
}
