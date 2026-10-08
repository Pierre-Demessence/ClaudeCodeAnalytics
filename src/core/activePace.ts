import type { FamilyPace } from './activeTime.ts';
import type { Family } from './family.ts';
import type { UsageRecord } from './types.ts';

import { activeByFamily } from './activeTime.ts';
import { HOUR_MS } from './calibration.ts';

/**
 * $ per hour of active use for records with `from <= ts < to`, all models
 * together (see `activeByFamily` for how active time is measured).
 */
export function activeHourlyPace(records: readonly UsageRecord[], from: number, to: number): number | undefined {
  let cost = 0;
  let activeMs = 0;
  for (const activity of activeByFamily(records, from, to).values()) {
    cost += activity.cost;
    activeMs += activity.activeMs;
  }
  // Unpriced models cost $0: no pace rather than an endless time left.
  return activeMs > 0 && cost > 0 ? cost / (activeMs / HOUR_MS) : undefined;
}

export interface FamilyActiveLeft {
  family: Family;
  /** From an estimated pace: the family has too little active time of its own. */
  lowConfidence?: true;
  /** Active time (ms) left if only this family is used. */
  ms: number;
}

/** Active time left before the limit if only each family were used, at its own pace. */
export function activeLeftByFamily({ k, paces, used }: { k?: number; paces: readonly FamilyPace[]; used: number }): FamilyActiveLeft[] {
  return paces.flatMap(({ family, lowConfidence, pace }) => {
    const ms = activeTimeLeft({ k, pace, used });
    return ms === undefined ? [] : [{ family, ...lowConfidence && { lowConfidence }, ms }];
  });
}

/** Active time (ms) until `used` reaches 100 % at `pace` $/hour, with `k` % per dollar. */
export function activeTimeLeft({ k, pace, used }: { k?: number; pace?: number; used: number }): number | undefined {
  if (!k || !pace || k < 0 || pace < 0 || used >= 100)
    return undefined;
  return (100 - used) / k / pace * HOUR_MS;
}
