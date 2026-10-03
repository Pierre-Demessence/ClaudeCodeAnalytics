import type { FitVerdict, PlanFit, PlanFitInput } from '@/core/planFit';
import type { Plan } from '@/core/types';
import type { BoxKind } from '@/dashboard/VerdictBox';

import { dayKey } from '@/core/aggregate';
import { weekPercents } from '@/core/planFit';
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
      return { detail: `Your busiest week used only ${floored(fit.busiest)} of it; a typical week leaves ${unused}% unused.`, title: 'Too big.' };
    case 'tooSmall':
      return { detail: overText(fit, input, timeZone, false), title: 'Too small.' };
  }
}

/** The verdict of the best plan, which names only that plan. */
export function bestVerdict(fit: PlanFit, input: PlanFitInput, timeZone: string): VerdictText {
  switch (fit.verdict) {
    case 'fits':
      return { detail: `A typical week uses ${formatPercent(fit.typical)} of it and your busiest week ${formatPercent(fit.busiest)}.`, title: 'Fits every week and session.' };
    case 'close':
      return { detail: overText(fit, input, timeZone, true), title: 'Close.' };
    case 'tooBig':
      return { detail: `Your busiest week used only ${floored(fit.busiest)} of it.`, title: 'More than you need.' };
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
  /** Bar height, % of the chart. */
  height: number;
  label: string;
  over: boolean;
  start: string;
  tip: string;
}

/** The weeks as bars on `plan`, with `share` of the Opus work moved to Sonnet. */
export function chartBars(input: PlanFitInput, plan: Plan, share: number, timeZone: string): ChartBar[] {
  const percents = weekPercents(input, plan, share);
  return input.weeks.map((week, i) => {
    const percent = percents[i]!;
    const over = percent >= 100;
    const day = formatDay(dayKey(Date.parse(week.start), timeZone));
    const note = week.estimated ? ' Estimated: not a final reading, or the limit was reached and this is the transcript estimate.' : '';
    return {
      estimated: week.estimated && !over,
      height: Math.min(percent, CHART_CAP) / CHART_CAP * 100,
      label: formatPercent(percent),
      over,
      start: week.start,
      tip: `Week of ${day}: ${formatPercent(percent)} of the ${PLAN_LABELS[plan]} limit${over ? ', over it' : ''}.${note}`,
    };
  });
}
