import type { Plan, PlanPeriod } from './types.ts';

import { DAY_MS } from './calibration.ts';
import { PLAN_PRICES, planAt } from './plans.ts';

/** Average month, to prorate the monthly price when the billing date is unknown. */
export const MONTH_MS = 30.4375 * DAY_MS;
const RECENT_MS = 28 * DAY_MS;

/** The unused time of the plan left by an upgrade, refunded on the new plan's first charge. */
export interface Credit {
  amount: number;
  plan: Plan;
}

export interface Value {
  /** What the usage would have cost at public API prices. */
  apiCost: number;
  /** The credits for unused time included in `paid`; only with the billing date. */
  credits?: Credit[];
  /** What the plan cost: the charges in the window, or the list price prorated by time. */
  paid: number;
  /** `apiCost - paid`; negative when the plan cost more than the usage was worth. */
  saved: number;
  /** `saved` as a % of `apiCost`: how far below API prices you paid. */
  savedPercent: number;
}

export interface ValueForMoney {
  /** Since the subscription started, or the first message without a billing date. */
  allTime?: Value;
  /** `cycle`: the current billing cycle; `fourWeeks`: the last 4 weeks, prorated. */
  kind: 'cycle' | 'fourWeeks';
  recent?: Value;
}

export interface ValueForMoneyInput {
  costBetween: (from: number, to: number) => number;
  /** Time of the first message. */
  dataStart: number;
  now: number;
  planHistory: readonly PlanPeriod[];
  /** When the paid subscription started: it is billed on the same day of each month. */
  subscriptionStart?: number;
}

/**
 * When the paid subscription started: the first plan period's start when it was set by hand,
 * else the account's date. A detected first period only marks when the collector first saw the
 * plan, and one from the epoch keeps the plan assumed before any history.
 */
export function subscriptionStartOf(planHistory: readonly PlanPeriod[], accountStart: number | undefined): number | undefined {
  const first = planHistory[0];
  const from = first ? Date.parse(first.from) : 0;
  return first?.source === 'manual' && from > 0 ? from : accountStart;
}

const priceAt = (planHistory: readonly PlanPeriod[], time: number) => PLAN_PRICES[planAt(planHistory, new Date(time).toISOString())];

/** The `n`th billing date: the start's day of the month and time, `n` months on, cut to the month's last day. */
function billingDate(start: number, n: number): number {
  const at = new Date(start);
  const month = at.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Date.UTC(at.getUTCFullYear(), month, Math.min(at.getUTCDate(), lastDay), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds());
}

/** One charge and the billing cycle it pays for, from `start` to the next charge. */
interface Cycle {
  credit?: Credit;
  paid: number;
  start: number;
}

/**
 * The charges from the subscription start up to `now`. Each billing date charges the plan then
 * active; it recurs on the same day each month. An upgrade starts a new cycle there and then: the
 * new plan's full price less the unused time of the plan paid for, and the billing day moves to it.
 * A downgrade waits for the next billing date and refunds nothing, so a plan no dearer than the one
 * paid for this cycle charges nothing.
 */
function billingCycles(planHistory: readonly PlanPeriod[], subscriptionStart: number, now: number): Cycle[] {
  const changes = planHistory.map(period => Date.parse(period.from)).filter(time => time > subscriptionStart && time <= now).sort((a, b) => a - b);
  const planOn = (time: number) => planAt(planHistory, new Date(time).toISOString());
  let anchor = subscriptionStart;
  let n = 0;
  let paidFor = planOn(anchor);
  const cycles: Cycle[] = [{ paid: PLAN_PRICES[paidFor], start: anchor }];
  for (;;) {
    const start = cycles.at(-1)!.start;
    const end = billingDate(anchor, n + 1);
    const upgrade = changes.find(time => time > start && time < end && PLAN_PRICES[planOn(time)] > PLAN_PRICES[paidFor]);
    if (upgrade !== undefined) {
      const credit = { amount: PLAN_PRICES[paidFor] * (end - upgrade) / (end - start), plan: paidFor };
      paidFor = planOn(upgrade);
      cycles.push({ credit, paid: PLAN_PRICES[paidFor] - credit.amount, start: upgrade });
      anchor = upgrade;
      n = 0;
    }
    else if (end <= now) {
      paidFor = planOn(end);
      cycles.push({ paid: PLAN_PRICES[paidFor], start: end });
      n++;
    }
    else {
      return cycles;
    }
  }
}

/** The list price of the plan active at each moment of `[from, to]`, prorated by time. */
function proratedPrice(planHistory: readonly PlanPeriod[], from: number, to: number): number {
  const cuts = planHistory.map(period => Date.parse(period.from)).filter(time => time > from && time < to);
  const edges = [from, ...cuts.sort((a, b) => a - b), to];
  let paid = 0;
  for (let i = 0; i < edges.length - 1; i++)
    paid += priceAt(planHistory, edges[i]!) * (edges[i + 1]! - edges[i]!) / MONTH_MS;
  return paid;
}

/** The usage since `from` at API prices against `paid`; absent without cost. */
function valueSince(input: ValueForMoneyInput, from: number, paid: number, credits: Credit[] = []): Value | undefined {
  const apiCost = input.costBetween(from, input.now);
  if (!(apiCost > 0))
    return undefined;
  const saved = apiCost - paid;
  return { apiCost, paid, saved, savedPercent: saved / apiCost * 100, ...(credits.length > 0 && { credits }) };
}

/** The usage since the first cycle began against what its cycles cost. */
function valueOfCycles(input: ValueForMoneyInput, cycles: readonly Cycle[]): Value | undefined {
  const credits = cycles.flatMap(cycle => cycle.credit ? [cycle.credit] : []);
  return valueSince(input, cycles[0]!.start, cycles.reduce((sum, cycle) => sum + cycle.paid, 0), credits);
}

/**
 * What the plan bought: the usage at API prices against what the plan cost.
 * With the billing date, that is the charges (see `billingCycles`) against the usage since the
 * current cycle began, and since the subscription began.
 * Without it, the list price prorated by time over the last 4 weeks and since the first message,
 * neither starting before the first message.
 */
export function valueForMoney(input: ValueForMoneyInput): ValueForMoney | undefined {
  const { dataStart, now, planHistory, subscriptionStart } = input;
  const result = ((): ValueForMoney => {
    if (subscriptionStart !== undefined && subscriptionStart <= now) {
      const cycles = billingCycles(planHistory, subscriptionStart, now);
      return { allTime: valueOfCycles(input, cycles), kind: 'cycle', recent: valueOfCycles(input, cycles.slice(-1)) };
    }
    const from = Math.max(dataStart, now - RECENT_MS);
    return {
      allTime: valueSince(input, dataStart, proratedPrice(planHistory, dataStart, now)),
      kind: 'fourWeeks',
      recent: valueSince(input, from, proratedPrice(planHistory, from, now)),
    };
  })();
  return dataStart < now && (result.allTime || result.recent) ? result : undefined;
}
