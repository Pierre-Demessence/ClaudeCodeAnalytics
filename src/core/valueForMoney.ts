import type { PlanPeriod } from './types.ts';

import { DAY_MS } from './calibration.ts';
import { PLAN_PRICES, planAt } from './plans.ts';

/** Average month, to prorate the monthly price when the billing date is unknown. */
export const MONTH_MS = 30.4375 * DAY_MS;
const RECENT_MS = 28 * DAY_MS;

export interface Value {
  /** What the usage would have cost at public API prices. */
  apiCost: number;
  /** What the plan cost: the price of each billing date in the window, or its list price prorated by time. */
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

const priceAt = (planHistory: readonly PlanPeriod[], time: number) => PLAN_PRICES[planAt(planHistory, new Date(time).toISOString())];

/** The `n`th billing date: the start's day of the month and time, `n` months on, cut to the month's last day. */
function billingDate(start: number, n: number): number {
  const at = new Date(start);
  const month = at.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Date.UTC(at.getUTCFullYear(), month, Math.min(at.getUTCDate(), lastDay), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds());
}

/** The billing dates from the start up to `now`. */
function billingDates(start: number, now: number): number[] {
  const dates: number[] = [];
  for (let n = 0; billingDate(start, n) <= now; n++)
    dates.push(billingDate(start, n));
  return dates;
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
function valueSince(input: ValueForMoneyInput, from: number, paid: number): Value | undefined {
  const apiCost = input.costBetween(from, input.now);
  if (!(apiCost > 0))
    return undefined;
  const saved = apiCost - paid;
  return { apiCost, paid, saved, savedPercent: saved / apiCost * 100 };
}

/**
 * What the plan bought: the usage at API prices against what the plan cost.
 * With the billing date, that is the price charged on each billing date (at the plan then
 * active) against the usage since the current cycle began, and since the subscription began.
 * Without it, the list price prorated by time over the last 4 weeks and since the first message,
 * neither starting before the first message.
 */
export function valueForMoney(input: ValueForMoneyInput): ValueForMoney | undefined {
  const { dataStart, now, planHistory, subscriptionStart } = input;
  const result = ((): ValueForMoney => {
    if (subscriptionStart !== undefined && subscriptionStart <= now) {
      const dates = billingDates(subscriptionStart, now);
      const cycleStart = dates.at(-1)!;
      return {
        allTime: valueSince(input, subscriptionStart, dates.reduce((sum, date) => sum + priceAt(planHistory, date), 0)),
        kind: 'cycle',
        recent: valueSince(input, cycleStart, priceAt(planHistory, cycleStart)),
      };
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
