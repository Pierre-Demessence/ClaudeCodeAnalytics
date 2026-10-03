import type { FiveHourWindow } from './sessions.ts';
import type { Plan, PlanPeriod } from './types.ts';
import type { WeekHistory } from './weekHistory.ts';

import { WEEK_MS } from './calibration.ts';
import { convertPercent, PLAN_PRICES, planAt, PLANS } from './plans.ts';
import { median } from './stats.ts';

/** Completed weeks needed before a plan comparison says anything. */
export const MIN_FIT_WEEKS = 3;
/** A plan whose busiest week stays under this % of its limit is too big. */
export const TOO_BIG_BELOW = 50;
/** Weeks over the limit up to which a plan is close rather than too small. */
export const CLOSE_MAX_WEEKS = 2;
/** Share of sessions over the limit up to which a plan is close rather than too small. */
export const CLOSE_MAX_SESSION_SHARE = 0.1;
/** A week or session at this % of a limit has hit it. */
const LIMIT = 100;
const WEEKS_PER_MONTH = 52 / 12;

export interface FitWeek {
  /** API-equivalent dollars of the week. */
  cost: number;
  /** Final % on the current plan; the transcript estimate when the limit was reached and the estimate is higher. */
  demand: number;
  /** Not a final reading. */
  estimated: boolean;
  /** Share of the cost saved if all Opus ran on Sonnet, 0 to 1. */
  shift: number;
  /** ISO. */
  start: string;
}

export interface FitSession {
  /** Peak % of a finished 5-hour window on the current plan, as `FitWeek.demand`. */
  demand: number;
  estimated: boolean;
  shift: number;
}

/** What the plan comparison is computed from: the last weeks and 5-hour sessions, on the current plan. */
export interface PlanFitInput {
  /** The plan the demands are expressed on. */
  plan: Plan;
  sessions: FitSession[];
  /** API-equivalent dollars at 100% of the current plan's weekly limit; from the calibration. */
  weeklyBudget?: number;
  /** Completed weeks, oldest first. */
  weeks: FitWeek[];
}

export type FitVerdict = 'close' | 'fits' | 'tooBig' | 'tooSmall';

export interface PlanFit {
  /** Typical month at API prices that fits under the limit, over the price; absent without a calibration. */
  apiValueRatio?: number;
  /** Highest weekly %. */
  busiest: number;
  /** ISO starts of the weeks over the limit, oldest first. */
  overWeeks: string[];
  plan: Plan;
  /** USD per month. */
  price: number;
  sessionsOver: number;
  /** Median weekly %. */
  typical: number;
  verdict: FitVerdict;
  weeksOver: number;
}

/** A demand after moving `share` of the Opus work to Sonnet. */
export const shifted = (demand: number, share: number, shift: number): number => demand * (1 - share * shift);

/** Each week's % of `plan`'s limit, with `share` of the Opus work moved to Sonnet. */
export function weekPercents(input: PlanFitInput, plan: Plan, share: number): number[] {
  return input.weeks.map(week => convertPercent(shifted(week.demand, share, week.shift), input.plan, plan));
}

function verdictOf(weeksOver: number, sessionsOver: number, sessions: number, busiest: number): FitVerdict {
  if (weeksOver === 0 && sessionsOver === 0)
    return busiest < TOO_BIG_BELOW ? 'tooBig' : 'fits';
  return weeksOver <= CLOSE_MAX_WEEKS && sessionsOver <= sessions * CLOSE_MAX_SESSION_SHARE ? 'close' : 'tooSmall';
}

/** How each plan would have held the weeks and sessions of `input`, Pro first. */
export function evaluatePlans(input: PlanFitInput, share = 0): PlanFit[] {
  const weekCosts = input.weeks.map(week => shifted(week.cost, share, week.shift));
  const demandCost = median(weekCosts) ?? 0;
  return PLANS.map((plan): PlanFit => {
    const percents = weekPercents(input, plan, share);
    const overWeeks = input.weeks.filter((_, i) => percents[i]! >= LIMIT).map(week => week.start);
    const sessionsOver = input.sessions.filter(s => convertPercent(shifted(s.demand, share, s.shift), input.plan, plan) >= LIMIT).length;
    const busiest = Math.max(0, ...percents);
    // Plan limits are multiples of each other, so this plan's weekly dollars follow from the current plan's.
    const budget = input.weeklyBudget === undefined ? undefined : input.weeklyBudget / convertPercent(1, input.plan, plan);
    return {
      apiValueRatio: budget === undefined ? undefined : Math.min(demandCost, budget) * WEEKS_PER_MONTH / PLAN_PRICES[plan],
      busiest,
      overWeeks,
      plan,
      price: PLAN_PRICES[plan],
      sessionsOver,
      typical: median(percents) ?? 0,
      verdict: verdictOf(overWeeks.length, sessionsOver, input.sessions.length, busiest),
      weeksOver: overWeeks.length,
    };
  });
}

const VERDICT_RANK: Record<FitVerdict, number> = { close: 1, fits: 0, tooBig: 2, tooSmall: 3 };

/** The best verdict (fits, close, too big, too small); ties go to fewer weeks over, fewer sessions over, then the lower price. */
export function bestPlan(fits: readonly PlanFit[]): PlanFit {
  return [...fits].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || a.weeksOver - b.weeksOver || a.sessionsOver - b.sessionsOver || a.price - b.price)[0]!;
}

export interface PlanFitSource {
  /** % of the weekly limit per dollar, when calibrated. */
  calibrationK?: number;
  /** % of the 5-hour limit per dollar, when calibrated. */
  fiveHourK?: number;
  plan: Plan;
  planHistory: readonly PlanPeriod[];
  /** Every 5-hour window, as `fiveHourWindows` builds them. */
  sessionWindows: readonly FiveHourWindow[];
  weekHistory: WeekHistory;
}

/**
 * The finished weeks with a percent and the finished 5-hour windows with a
 * peak since the oldest of those weeks, on the current plan. A week or window
 * that reached its limit only shows 100: when the transcripts say it took
 * more, that estimate is its demand.
 */
export function buildPlanFitInput({ calibrationK, fiveHourK, plan, planHistory, sessionWindows, weekHistory }: PlanFitSource): PlanFitInput {
  const weeks = weekHistory.weeks
    .filter(week => !week.inProgress && week.percent !== undefined)
    .reverse()
    .map((week): FitWeek => {
      const percent = week.percent!;
      const demand = percent >= LIMIT && calibrationK !== undefined ? Math.max(percent, calibrationK * week.cost) : percent;
      return { cost: week.cost, demand, estimated: week.percentEstimated === true || demand > percent, shift: week.shift ?? 0, start: week.start };
    });

  // Only the windows that started inside a kept week: the one in progress and weeks without a percent have no say.
  const inKeptWeek = (ms: number) => weeks.some(week => ms >= Date.parse(week.start) && ms < Date.parse(week.start) + WEEK_MS);
  const sessions = sessionWindows
    .filter(w => !w.inProgress && w.peak !== undefined && inKeptWeek(Date.parse(w.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((w): FitSession => {
      const peak = convertPercent(w.peak!, planAt(planHistory, w.start), plan);
      const demand = w.capped && fiveHourK !== undefined ? Math.max(peak, fiveHourK * w.cost) : peak;
      return { demand, estimated: w.peakEstimated === true || demand > peak, shift: w.shift ?? 0 };
    });

  return { plan, sessions, weeklyBudget: calibrationK ? LIMIT / calibrationK : undefined, weeks };
}
