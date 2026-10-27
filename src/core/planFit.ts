import type { FiveHourWindow } from './sessions.ts';
import type { Plan, PlanPeriod } from './types.ts';
import type { WeekHistory, WeekRow } from './weekHistory.ts';

import { HOUR_MS, WEEK_MS } from './calibration.ts';
import { convertPercent, PLAN_PRICES, planAt, PLANS } from './plans.ts';
import { median } from './stats.ts';

/** Completed weeks needed before a plan comparison says anything. */
export const MIN_FIT_WEEKS = 3;
/** A plan whose busiest week stays under this % of its limit is too big when a cheaper plan holds the weeks; the smallest that does fits with room to grow. */
export const TOO_BIG_BELOW = 50;
/** Weeks over the limit up to which a plan is close rather than too small. */
export const CLOSE_MAX_WEEKS = 2;
/** Share of sessions over the limit up to which a plan is close rather than too small. */
export const CLOSE_MAX_SESSION_SHARE = 0.1;
/** Observed hours the comparison weeks need together before their pace fills the hidden time. */
export const MIN_OBSERVED_WEEK_HOURS = 72;
/** Observed hours the sessions need together before their pace fills the hidden time. */
export const MIN_OBSERVED_SESSION_HOURS = 10;
/** A week or session at this % of a limit has hit it. */
const LIMIT = 100;
const WEEKS_PER_MONTH = 52 / 12;

export interface FitWeek {
  /** API-equivalent dollars of the week. */
  cost: number;
  /** Estimated demand on the current plan: the final % plus the time the limit, or a missing subscription, hid at the typical pace. */
  demand: number;
  /** Not a final reading, or `demand` exceeds `floor`. */
  estimated: boolean;
  /** The final %, on the current plan: the minimum the week took. */
  floor: number;
  /** Hours of the week that the limit, a capped session or a missing subscription hid. */
  hiddenHours: number;
  /** The plans the week was used on, oldest first: more than one when its usage restarted on a plan change. */
  plans: Plan[];
  /** Share of the cost saved if all Opus ran on Sonnet, 0 to 1. */
  shift: number;
  /** ISO. */
  start: string;
}

export interface FitSession {
  /** Estimated peak % of a finished 5-hour window on the current plan, as `FitWeek.demand`. */
  demand: number;
  estimated: boolean;
  /** The window's peak, on the current plan. */
  floor: number;
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
  /** Highest weekly minimum: the busiest week took at least this much. */
  busiestFloor: number;
  /** ISO starts of the weeks over the limit, oldest first. */
  overWeeks: string[];
  plan: Plan;
  /** USD per month. */
  price: number;
  sessionsOver: number;
  /** Median weekly %. */
  typical: number;
  /** Median weekly minimum. */
  typicalFloor: number;
  verdict: FitVerdict;
  weeksOver: number;
}

/** A demand after moving `share` of the Opus work to Sonnet. */
export const shifted = (demand: number, share: number, shift: number): number => demand * (1 - share * shift);

/** Each week's estimated % of `plan`'s limit, with `share` of the Opus work moved to Sonnet. */
export function weekPercents(input: PlanFitInput, plan: Plan, share: number): number[] {
  return input.weeks.map(week => convertPercent(shifted(week.demand, share, week.shift), input.plan, plan));
}

/** Each week's minimum % of `plan`'s limit, as `weekPercents` has the estimates. */
export function weekFloors(input: PlanFitInput, plan: Plan, share: number): number[] {
  return input.weeks.map(week => convertPercent(shifted(week.floor, share, week.shift), input.plan, plan));
}

function verdictOf(weeksOver: number, sessionsOver: number, sessions: number, busiest: number): FitVerdict {
  if (weeksOver === 0 && sessionsOver === 0)
    return busiest < TOO_BIG_BELOW ? 'tooBig' : 'fits';
  return weeksOver <= CLOSE_MAX_WEEKS && sessionsOver <= sessions * CLOSE_MAX_SESSION_SHARE ? 'close' : 'tooSmall';
}

/** How each plan would have held the weeks and sessions of `input`, Pro first. */
export function evaluatePlans(input: PlanFitInput, share = 0): PlanFit[] {
  // The hidden part of a week is the cost of its extra %, at the current plan's dollars per %.
  const dollarsPerPercent = input.weeklyBudget === undefined ? 0 : input.weeklyBudget / LIMIT;
  const weekCosts = input.weeks.map(week => shifted(week.cost + (week.demand - week.floor) * dollarsPerPercent, share, week.shift));
  const demandCost = median(weekCosts) ?? 0;
  const fits = PLANS.map((plan): PlanFit => {
    const percents = weekPercents(input, plan, share);
    const floors = weekFloors(input, plan, share);
    const overWeeks = input.weeks.filter((_, i) => percents[i]! >= LIMIT).map(week => week.start);
    const sessionsOver = input.sessions.filter(s => convertPercent(shifted(s.demand, share, s.shift), input.plan, plan) >= LIMIT).length;
    const busiest = Math.max(0, ...percents);
    // Plan limits are multiples of each other, so this plan's weekly dollars follow from the current plan's.
    const budget = input.weeklyBudget === undefined ? undefined : input.weeklyBudget / convertPercent(1, input.plan, plan);
    return {
      apiValueRatio: budget === undefined ? undefined : Math.min(demandCost, budget) * WEEKS_PER_MONTH / PLAN_PRICES[plan],
      busiest,
      busiestFloor: Math.max(0, ...floors),
      overWeeks,
      plan,
      price: PLAN_PRICES[plan],
      sessionsOver,
      typical: median(percents) ?? 0,
      typicalFloor: median(floors) ?? 0,
      verdict: verdictOf(overWeeks.length, sessionsOver, input.sessions.length, busiest),
      weeksOver: overWeeks.length,
    };
  });
  // Plans go cheapest first. Roomy is only too much next to a cheaper plan that holds the weeks: the smallest that does fits.
  return fits.map((fit, i) => (fit.verdict === 'tooBig' && (i === 0 || fits[i - 1]!.verdict === 'tooSmall') ? { ...fit, verdict: 'fits' } : fit));
}

const VERDICT_RANK: Record<FitVerdict, number> = { close: 1, fits: 0, tooBig: 2, tooSmall: 3 };

/** The best verdict (fits, close, too big, too small); ties go to fewer weeks over, fewer sessions over, then the lower price. */
export function bestPlan(fits: readonly PlanFit[]): PlanFit {
  return [...fits].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || a.weeksOver - b.weeksOver || a.sessionsOver - b.sessionsOver || a.price - b.price)[0]!;
}

export interface PlanFitSource {
  /** % of the weekly limit per dollar, when calibrated. */
  calibrationK?: number;
  plan: Plan;
  planHistory: readonly PlanPeriod[];
  /** Every 5-hour window, as `fiveHourWindows` builds them. */
  sessionWindows: readonly FiveHourWindow[];
  /** Epoch ms of the subscription's start: what happened before it is not the user's demand. */
  subscriptionStart?: number;
  weekHistory: WeekHistory;
}

const hours = (ms: number) => Math.max(0, ms) / HOUR_MS;

/** A pace in %/hour from pooled usage and observed time; absent when too little time was observed. */
function pooledPace(percent: number, observedHours: number, minHours: number): number | undefined {
  return observedHours >= minHours ? percent / observedHours : undefined;
}

interface WeekSpan {
  /** The % when the demand stopped showing, on the current plan; the parts' added up. */
  cutoffPercent: number;
  hiddenHours: number;
  observedHours: number;
  /** The cutoff % of the parts with observed time: what the pace pools. */
  pacePercent: number;
  week: WeekRow;
}

/** What a span reads of a part: the window's one part when it never restarted. */
interface SpanPart {
  end: number;
  percent: number;
  pressureAt?: number;
  pressurePercent?: number;
  /** Where the oldest transcript starts, for a week estimated from transcripts that started before it. */
  seenFrom?: number;
  start: number;
}

/**
 * Splits a week into the time its usage shows the demand (observed) and the
 * time it does not (hidden): before the subscription, before the oldest
 * transcript (for a week estimated from transcripts), after the cutoff (the
 * pressure point or a weekly hit, whichever came first), and inside 5-hour
 * sessions after they were capped. A week whose usage restarted is split per
 * part, each with its own cutoff, and the spans are added up.
 */
function weekSpan(week: WeekRow, sessionWindows: readonly FiveHourWindow[], subscriptionStart: number | undefined): WeekSpan {
  const parts: SpanPart[] = week.parts
    ? week.parts.map(part => ({
        end: Date.parse(part.end),
        percent: part.percent,
        pressureAt: part.pressureAt === undefined ? undefined : Date.parse(part.pressureAt),
        pressurePercent: part.pressurePercent,
        start: Date.parse(part.start),
      }))
    : [{
        end: Date.parse(week.end),
        percent: week.percent!,
        pressureAt: week.pressureAt === undefined ? undefined : Date.parse(week.pressureAt),
        pressurePercent: week.pressurePercent,
        seenFrom: week.transcriptsFrom === undefined ? undefined : Date.parse(week.transcriptsFrom),
        start: Date.parse(week.start),
      }];
  const span: WeekSpan = { cutoffPercent: 0, hiddenHours: 0, observedHours: 0, pacePercent: 0, week };
  for (const { end, percent: final, pressureAt = Infinity, pressurePercent, seenFrom, start } of parts) {
    const observedStart = Math.min(end, Math.max(start, subscriptionStart ?? start, seenFrom ?? start));
    const hitAt = Math.min(Infinity, ...(week.limitHits ?? []).map(ts => Date.parse(ts)).filter(at => at >= start && at < end));
    const cutoff = Math.max(observedStart, Math.min(pressureAt, hitAt, end));
    // The pressure reading stands for the cutoff only when it is the cutoff; after an earlier hit the final % is what the limit froze.
    const cutoffPercent = pressureAt <= hitAt && pressurePercent !== undefined ? Math.min(final, pressurePercent) : final;
    let blocked = 0;
    for (const window of sessionWindows) {
      const cappedAt = window.cappedAt === undefined ? undefined : Date.parse(window.cappedAt);
      if (cappedAt !== undefined && cappedAt >= observedStart && cappedAt < cutoff)
        blocked += Math.min(Date.parse(window.end), cutoff) - cappedAt;
    }
    const observedHours = hours(cutoff - observedStart - blocked);
    span.cutoffPercent += cutoffPercent;
    span.hiddenHours += hours(observedStart - start + end - cutoff + blocked);
    span.observedHours += observedHours;
    // A part without observed time has no usage the pace could come from.
    if (observedHours > 0)
      span.pacePercent += cutoffPercent;
  }
  return span;
}

/**
 * The finished weeks with a percent and the finished 5-hour windows with a
 * peak since the oldest of those weeks, on the current plan. A week whose usage
 * restarted counts its parts added up. A reading stops
 * where a limit stopped the user, so each demand is the reading plus the time
 * the limit hid, at the user's typical pace (the weeks' and the sessions' own).
 */
export function buildPlanFitInput({ calibrationK, plan, planHistory, sessionWindows, subscriptionStart, weekHistory }: PlanFitSource): PlanFitInput {
  const spans = weekHistory.weeks
    .filter(week => !week.inProgress && week.percent !== undefined)
    .reverse()
    .map(week => weekSpan(week, sessionWindows, subscriptionStart));
  const weekPace = pooledPace(
    spans.reduce((sum, span) => sum + span.pacePercent, 0),
    spans.reduce((sum, span) => sum + span.observedHours, 0),
    MIN_OBSERVED_WEEK_HOURS,
  );
  const weeks = spans.map(({ cutoffPercent, hiddenHours, week }): FitWeek => {
    const floor = week.percent!;
    const demand = weekPace === undefined ? floor : Math.max(floor, cutoffPercent + hiddenHours * weekPace);
    const plans = week.parts ? [...new Set(week.parts.map(part => part.plan))] : [week.plan ?? plan];
    return { cost: week.cost, demand, estimated: week.percentEstimated === true || demand > floor, floor, hiddenHours, plans, shift: week.shift ?? 0, start: week.start };
  });

  // Only the windows that started inside a kept week: the one in progress and weeks without a percent have no say.
  const inKeptWeek = (ms: number) => weeks.some(week => ms >= Date.parse(week.start) && ms < Date.parse(week.start) + WEEK_MS);
  const kept = sessionWindows
    .filter(w => !w.inProgress && w.peak !== undefined && inKeptWeek(Date.parse(w.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((w) => {
      // A window can start just before an upgrade, so its plan is the one it ended on.
      const from = planAt(planHistory, new Date(Date.parse(w.end) - 1).toISOString());
      const cappedAt = w.cappedAt === undefined ? undefined : Date.parse(w.cappedAt);
      const peak = convertPercent(w.peak!, from, plan);
      return {
        capPercent: cappedAt === undefined ? peak : convertPercent(w.capPercent ?? LIMIT, from, plan),
        hidden: cappedAt === undefined ? 0 : hours(Date.parse(w.end) - cappedAt),
        observed: hours((cappedAt ?? Date.parse(w.end)) - Date.parse(w.start)),
        peak,
        w,
      };
    });
  const sessionPace = pooledPace(
    kept.reduce((sum, s) => sum + s.capPercent, 0),
    kept.reduce((sum, s) => sum + s.observed, 0),
    MIN_OBSERVED_SESSION_HOURS,
  );
  const sessions = kept.map(({ capPercent, hidden, peak, w }): FitSession => {
    const demand = sessionPace === undefined || w.cappedAt === undefined ? peak : Math.max(peak, capPercent + hidden * sessionPace);
    return { demand, estimated: w.peakEstimated === true || demand > peak, floor: peak, shift: w.shift ?? 0 };
  });

  return { plan, sessions, weeklyBudget: calibrationK ? LIMIT / calibrationK : undefined, weeks };
}
