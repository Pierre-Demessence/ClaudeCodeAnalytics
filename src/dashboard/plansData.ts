import type { FitVerdict, PlanFit, PlanFitInput } from '@/core/planFit';
import type { Plan } from '@/core/types';
import type { BoxKind } from '@/dashboard/VerdictBox';

import { dayKey } from '@/core/aggregate';
import { weekFloors, weekPercents } from '@/core/planFit';
import { PLAN_LABELS } from '@/core/plans';
import { formatDay, formatDollars, formatPercent } from '@/dashboard/format';

/** The chart's top, in % of the limit: taller bars are cut. */
export const CHART_CAP = 150;
/** Weeks over the limit up to which their dates are listed. */
const LISTED_WEEKS = 3;

/** Shares of Opus work moved to Sonnet, as numbers in text so a `Toggle` can hold them. */
export type ShareKey = '0' | '0.25' | '0.5' | '1';
export const SHARE_OPTIONS: [ShareKey, string][] = [['0', 'None'], ['0.25', '25%'], ['0.5', '50%'], ['1', 'All']];

export const FIT_KIND: Record<FitVerdict, BoxKind> = { close: 'tight', fits: 'good', tooBig: 'big', tooSmall: 'cap' };

/** "50% of Opus work on Sonnet". */
export const shareText = (share: number) => (share === 1 ? 'All Opus work on Sonnet' : `${formatPercent(share * 100)} of Opus work on Sonnet`);

/** Rounded down, so a busiest week just under half the limit never reads "50%". */
const floored = (percent: number) => formatPercent(Math.floor(percent));

/** A percent whose estimate and minimum differ at the displayed precision. */
export const differs = (percent: number, floor: number) => formatPercent(percent) !== formatPercent(floor);

export interface EstimateText {
  /** "≈ 190%" when the estimate is above the minimum, else the plain %. */
  main: string;
  /** "at least 71%", only with an estimate. */
  minimum?: string;
}

/** An estimated % with its minimum: "≈ 190%" over "at least 71%". */
export function estimateText(percent: number, floor: number): EstimateText {
  return differs(percent, floor)
    ? { main: `≈ ${formatPercent(percent)}`, minimum: `at least ${formatPercent(floor)}` }
    : { main: formatPercent(percent) };
}

/** "≈ 29%" when `percent` is an estimate above its minimum, else "29%"; rounded down like `floored`. */
const flooredEstimate = (percent: number, floor: number) => `${differs(percent, floor) ? '≈ ' : ''}${floored(percent)}`;

/** "≈ 13×", or a dash without a calibrated budget. */
export const valueText = (ratio: number | undefined) => (ratio === undefined ? '–' : `≈ ${Math.round(ratio)}×`);

/** "Over the limit in 1 of 12 weeks (7 Aug) and 2 of 30 sessions." */
function overText(fit: PlanFit, input: PlanFitInput, timeZone: string, withDates: boolean): string {
  const parts: string[] = [];
  if (fit.weeksOver > 0) {
    const dates = withDates && fit.weeksOver <= LISTED_WEEKS ? ` (${fit.overWeeks.map(start => formatDay(dayKey(Date.parse(start), timeZone))).join(', ')})` : '';
    parts.push(`${fit.weeksOver} of ${input.weeks.length} weeks${dates}`);
  }
  if (fit.sessionsOver > 0)
    parts.push(`${fit.sessionsOver} of ${input.sessions.length} sessions`);
  return `Over the limit in ${parts.join(' and ')}.`;
}

export interface VerdictText {
  detail: string;
  title: string;
}

/** The verdict of one plan's card. */
export function cardVerdict(fit: PlanFit, input: PlanFitInput, timeZone: string): VerdictText {
  const unused = Math.max(0, Math.round(100 - fit.typical));
  switch (fit.verdict) {
    case 'fits':
      return { detail: `A typical week leaves ${unused}% unused.`, title: 'Fits every week and session.' };
    case 'close':
      return { detail: overText(fit, input, timeZone, false), title: 'Close.' };
    case 'tooBig':
      return { detail: `Your busiest week used only ${flooredEstimate(fit.busiest, fit.busiestFloor)} of it; a typical week leaves ${unused}% unused.`, title: 'Too big.' };
    case 'tooSmall':
      return { detail: overText(fit, input, timeZone, false), title: 'Too small.' };
  }
}

/** The verdict of the best plan, which names only that plan. */
export function bestVerdict(fit: PlanFit, input: PlanFitInput, timeZone: string): VerdictText {
  switch (fit.verdict) {
    case 'fits':
      return { detail: `A typical week uses ${estimateText(fit.typical, fit.typicalFloor).main} of it and your busiest week ${estimateText(fit.busiest, fit.busiestFloor).main}.`, title: 'Fits every week and session.' };
    case 'close':
      return { detail: overText(fit, input, timeZone, true), title: 'Close.' };
    case 'tooBig':
      return { detail: `Your busiest week used only ${flooredEstimate(fit.busiest, fit.busiestFloor)} of it.`, title: 'More than you need.' };
    case 'tooSmall':
      return { detail: overText(fit, input, timeZone, true), title: 'Too small, but the nearest match.' };
  }
}

/** What the best plan means for the current one: a tag and, when it differs, what switching does to the bill. */
export function switchText(best: PlanFit, current: PlanFit): { action?: string; tag: string } {
  if (best.plan === current.plan)
    return { tag: 'your current plan' };
  const delta = best.price - current.price;
  return {
    action: delta < 0 ? `Saves ${formatDollars(-delta)} / month` : `Costs ${formatDollars(delta)} more / month`,
    tag: `switch from ${PLAN_LABELS[current.plan]}`,
  };
}

export interface ChartBar {
  estimated: boolean;
  /** Height of the solid part, % of the chart: the minimum. Present when the estimate holds hidden time. */
  floorHeight?: number;
  /** Bar height, % of the chart. */
  height: number;
  label: string;
  over: boolean;
  start: string;
  tip: string;
}

/** "3.6 days", "1 day". */
export function daysText(hours: number): string {
  const days = Math.round(hours / 24 * 10) / 10;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The weeks as bars on `plan`, with `share` of the Opus work moved to Sonnet. */
export function chartBars(input: PlanFitInput, plan: Plan, share: number, timeZone: string): ChartBar[] {
  const percents = weekPercents(input, plan, share);
  const floors = weekFloors(input, plan, share);
  return input.weeks.map((week, i) => {
    const percent = percents[i]!;
    const floor = floors[i]!;
    const over = percent >= 100;
    const hidden = differs(percent, floor);
    const day = formatDay(dayKey(Date.parse(week.start), timeZone));
    const { main } = estimateText(percent, floor);
    const note = hidden
      ? ` At least ${formatPercent(floor)}: ${daysText(week.hiddenHours)} were hidden (by the limit, before you subscribed or before the oldest transcript) and filled at your typical pace.`
      : week.estimated ? ' Estimated: not a final reading.' : '';
    return {
      estimated: week.estimated && !over,
      floorHeight: hidden ? Math.min(floor, CHART_CAP) / CHART_CAP * 100 : undefined,
      height: Math.min(percent, CHART_CAP) / CHART_CAP * 100,
      label: hidden ? main.replace(' ', '') : main,
      over,
      start: week.start,
      tip: `Week of ${day}: ${main} of the ${PLAN_LABELS[plan]} limit${over ? ', over it' : ''}.${note}`,
    };
  });
}
