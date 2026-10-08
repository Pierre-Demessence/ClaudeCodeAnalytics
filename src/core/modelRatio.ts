import type { FamilyActivity } from './activeTime.ts';
import type { Family } from './family.ts';
import type { UsageRecord } from './types.ts';

import { activeByFamily, familyPaces } from './activeTime.ts';
import { dayKey } from './aggregate.ts';
import { HOUR_MS } from './calibration.ts';
import { quantile } from './stats.ts';

/** Days a model needs to have been used on for its ratios to be resampled. */
const MIN_FAMILY_DAYS = 2;
/** Days both models were used on, below which the comparison falls back to every day. */
const MIN_SHARED_DAYS = 3;
const RESAMPLES = 1000;
const RANGE: readonly [number, number] = [0.1, 0.9];
/** A fixed seed: the same data always gives the same range. */
const SEED = 20_261_008;

/** How many hours on `to` use as much limit as one hour on `from`, in the user's own usage. */
export interface ModelRatio {
  /** Days behind the ratio. */
  days: number;
  /** The heavier model: it drains the limit faster per active hour. */
  from: Family;
  /** 90th percentile of the resampled ratio. */
  high: number;
  /** `price × volume`. */
  hours: number;
  /** 10th percentile of the resampled ratio. */
  low: number;
  /** The two models shared too few days: every day was used, so the work given to each differs more. */
  lowConfidence?: true;
  /** Ratio of dollars per token, at the mix of tokens each model was used with. */
  price: number;
  to: Family;
  /** Ratio of tokens per active hour. */
  volume: number;
}

/** Small seeded generator (mulberry32): repeatable, unlike `Math.random`. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Per local day, active time and cost of each family. Active time restarts each day; a gap over midnight is lost. */
function activeByDay(records: readonly UsageRecord[], from: number, to: number, timeZone: string): Map<string, Map<Family, FamilyActivity>> {
  const byDay = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const ms = Date.parse(record.ts);
    if (ms < from || ms >= to)
      continue;
    const day = dayKey(ms, timeZone);
    const list = byDay.get(day);
    if (list)
      list.push(record);
    else
      byDay.set(day, [record]);
  }
  return new Map([...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => [day, activeByFamily(list, -Infinity, Infinity)]));
}

interface Sums { activeMs: number; cost: number; tokens: number }

function sum(days: readonly Map<Family, FamilyActivity>[], family: Family): Sums {
  const total = { activeMs: 0, cost: 0, tokens: 0 };
  for (const day of days) {
    const activity = day.get(family);
    if (activity) {
      total.activeMs += activity.activeMs;
      total.cost += activity.cost;
      total.tokens += activity.tokens;
    }
  }
  return total;
}

/** $ per active hour of `a` over $ per active hour of `b`; undefined without active time or cost on either side. */
function paceRatio(a: Sums, b: Sums): number | undefined {
  if (a.activeMs <= 0 || b.activeMs <= 0 || a.cost <= 0 || b.cost <= 0)
    return undefined;
  return (a.cost / a.activeMs) / (b.cost / b.activeMs);
}

/** The ratio of `from` to `to` over `days`, with its bootstrap range; undefined without active time or cost on either side. */
function ratioOf(days: readonly Map<Family, FamilyActivity>[], from: Family, to: Family, paired: boolean): ModelRatio | undefined {
  const a = sum(days, from);
  const b = sum(days, to);
  const hours = paceRatio(a, b);
  if (hours === undefined)
    return undefined;

  const random = seeded(SEED);
  const resampled: number[] = [];
  for (let r = 0; r < RESAMPLES; r++) {
    const picked = Array.from({ length: days.length }, () => days[Math.floor(random() * days.length)]!);
    const ratio = paceRatio(sum(picked, from), sum(picked, to));
    if (ratio !== undefined)
      resampled.push(ratio);
  }

  return {
    days: days.length,
    from,
    high: quantile(resampled, RANGE[1]) ?? hours,
    hours,
    low: quantile(resampled, RANGE[0]) ?? hours,
    lowConfidence: paired ? undefined : true,
    price: (a.cost / a.tokens) / (b.cost / b.tokens),
    to,
    volume: (a.tokens / (a.activeMs / HOUR_MS)) / (b.tokens / (b.activeMs / HOUR_MS)),
  };
}

/**
 * Every pair of measured model families, heavier first: how many active hours
 * on the lighter one equal an hour on the heavier. Only the days both were used
 * are compared when there are enough of them, since the work done on a day is
 * then the same for both. The range is the 10th-90th percentile of a seeded
 * bootstrap over those days. A family needs the active time `familyPaces`
 * measures (not an estimate) and `MIN_FAMILY_DAYS` days of use.
 */
export function modelRatios(records: readonly UsageRecord[], from: number, to: number, timeZone: string): ModelRatio[] {
  const measured = familyPaces(records, from, to)
    .filter(p => !p.lowConfidence)
    .sort((a, b) => b.pace - a.pace)
    .map(p => p.family);
  if (measured.length < 2)
    return [];
  const byDay = [...activeByDay(records, from, to, timeZone).values()];
  const usedOn = (day: Map<Family, FamilyActivity>, family: Family) => (day.get(family)?.activeMs ?? 0) > 0;

  const ratios: ModelRatio[] = [];
  for (const [i, heavy] of measured.entries()) {
    for (const light of measured.slice(i + 1)) {
      if (byDay.filter(day => usedOn(day, heavy)).length < MIN_FAMILY_DAYS || byDay.filter(day => usedOn(day, light)).length < MIN_FAMILY_DAYS)
        continue;
      const shared = byDay.filter(day => usedOn(day, heavy) && usedOn(day, light));
      const paired = shared.length >= MIN_SHARED_DAYS;
      const days = paired ? shared : byDay.filter(day => usedOn(day, heavy) || usedOn(day, light));

      // `heavy` is heavier over the whole range; on the days compared it can be the lighter one.
      const forward = ratioOf(days, heavy, light, paired);
      const ratio = forward && forward.hours < 1 ? ratioOf(days, light, heavy, paired) : forward;
      if (ratio)
        ratios.push(ratio);
    }
  }
  return ratios;
}
