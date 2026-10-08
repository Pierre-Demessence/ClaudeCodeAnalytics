import type { Family } from './family.ts';
import type { UsageRecord } from './types.ts';

import { HOUR_MS } from './calibration.ts';
import { familyOf } from './family.ts';
import { messageCost, priceFor } from './pricing.ts';

/** A longer gap between two messages is a pause, not active use. */
export const IDLE_GAP_MS = 15 * 60_000;

/** A family with less active time than this has too little data for its own pace. */
export const MIN_FAMILY_ACTIVE_MS = 2 * HOUR_MS;

const FAMILY_ORDER: readonly Family[] = ['opus', 'sonnet', 'haiku', 'fable', 'other'];

export interface FamilyActivity {
  activeMs: number;
  cost: number;
  /** The family's most recent priced model in the range (or its latest, when none is priced): its price stands for the family. */
  model: string;
}

export interface FamilyPace {
  /** Active time behind the pace, ms. */
  activeMs: number;
  family: Family;
  /** Estimated from the pooled pace and the price: too little active time to measure. */
  lowConfidence?: true;
  /** API-equivalent dollars per hour of active use. */
  pace: number;
}

/**
 * Active time and cost per model family for records with `from <= ts < to`.
 * Active time is the sum of the gaps between consecutive messages up to
 * `IDLE_GAP_MS`, on one timeline across sessions since they share the limits;
 * each gap is credited to the message that ended it.
 */
export function activeByFamily(records: readonly UsageRecord[], from: number, to: number): Map<Family, FamilyActivity> {
  const points = records
    .map(r => ({ ms: Date.parse(r.ts), record: r }))
    .filter(p => p.ms >= from && p.ms < to)
    .sort((a, b) => a.ms - b.ms);

  const byFamily = new Map<Family, FamilyActivity>();
  for (const [i, { ms, record }] of points.entries()) {
    const family = familyOf(record.model);
    const activity = byFamily.get(family) ?? { activeMs: 0, cost: 0, model: record.model };
    const gap = i > 0 ? ms - points[i - 1]!.ms : Infinity;
    if (gap <= IDLE_GAP_MS)
      activity.activeMs += gap;
    activity.cost += messageCost(record).cost;
    // An unpriced id (a model newer than the price table) must not replace a priced one: the price stands for the family.
    if (priceFor(record.model) || !priceFor(activity.model))
      activity.model = record.model;
    byFamily.set(family, activity);
  }
  return byFamily;
}

/**
 * $ per active hour of each family present, in a fixed order. A family with at
 * least `MIN_FAMILY_ACTIVE_MS` is measured. A thinner one is estimated: the
 * pooled pace, scaled by the family's output price against the active-time-
 * weighted price of the whole mix. A family without a price, and every family
 * when there is no active time, is left out.
 */
export function familyPaces(records: readonly UsageRecord[], from: number, to: number): FamilyPace[] {
  const byFamily = activeByFamily(records, from, to);
  let cost = 0;
  let activeMs = 0;
  let weightedPrice = 0;
  for (const activity of byFamily.values()) {
    cost += activity.cost;
    activeMs += activity.activeMs;
    weightedPrice += activity.activeMs * (priceFor(activity.model)?.output ?? 0);
  }
  if (activeMs === 0 || cost === 0)
    return [];
  const pooled = cost / (activeMs / HOUR_MS);
  const mixPrice = weightedPrice / activeMs;

  const paces: FamilyPace[] = [];
  for (const family of FAMILY_ORDER) {
    const activity = byFamily.get(family);
    if (!activity)
      continue;
    if (activity.activeMs >= MIN_FAMILY_ACTIVE_MS && activity.cost > 0) {
      paces.push({ activeMs: activity.activeMs, family, pace: activity.cost / (activity.activeMs / HOUR_MS) });
      continue;
    }
    const price = priceFor(activity.model)?.output;
    if (price && mixPrice > 0)
      paces.push({ activeMs: activity.activeMs, family, lowConfidence: true, pace: pooled * price / mixPrice });
  }
  return paces;
}
