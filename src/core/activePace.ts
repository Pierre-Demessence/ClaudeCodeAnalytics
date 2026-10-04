import type { UsageRecord } from './types.ts';

import { HOUR_MS } from './calibration.ts';
import { messageCost } from './pricing.ts';

/** A longer gap between two messages is a pause, not active use. */
export const IDLE_GAP_MS = 15 * 60_000;

/**
 * $ per hour of active use for records with `from <= ts < to`. Active time is
 * the sum of the gaps between consecutive messages up to `IDLE_GAP_MS`, on one
 * timeline across sessions, since parallel sessions share the same limits.
 */
export function activeHourlyPace(records: readonly UsageRecord[], from: number, to: number): number | undefined {
  const points = records
    .map(r => ({ ms: Date.parse(r.ts), record: r }))
    .filter(p => p.ms >= from && p.ms < to)
    .map(p => ({ cost: messageCost(p.record).cost, ms: p.ms }))
    .sort((a, b) => a.ms - b.ms);

  let cost = 0;
  let activeMs = 0;
  for (const [i, point] of points.entries()) {
    cost += point.cost;
    const gap = i > 0 ? point.ms - points[i - 1]!.ms : Infinity;
    if (gap <= IDLE_GAP_MS)
      activeMs += gap;
  }
  // Unpriced models cost $0: no pace rather than an endless time left.
  return activeMs > 0 && cost > 0 ? cost / (activeMs / HOUR_MS) : undefined;
}

/** Active time (ms) until `used` reaches 100 % at `pace` $/hour, with `k` % per dollar. */
export function activeTimeLeft({ k, pace, used }: { k?: number; pace?: number; used: number }): number | undefined {
  if (!k || !pace || k < 0 || pace < 0 || used >= 100)
    return undefined;
  return (100 - used) / k / pace * HOUR_MS;
}
