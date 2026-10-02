import type { Plan, PlanPeriod, Snapshot } from './types.ts';

import { convertPercent, planAt } from './plans.ts';
import { median } from './stats.ts';

export interface WeekShare {
  resetsAt: string;
  /** Final weekly % on the plan active that week. */
  percent: number;
  /** True when the last reading was well before reset. */
  estimated: boolean;
  plan: Plan;
}

export interface TypicalWeek {
  max: number;
  median: number;
  min: number;
  weeks: number;
}

/** A last reading closer to reset than this is taken as final. */
const FINAL_READING_MS = 12 * 3_600_000;

/** Final weekly % of every completed window that has readings. */
export function weeklyShares(
  snapshots: readonly Snapshot[],
  costBetween: (from: number, to: number) => number,
  /** Calibrated % per dollar, and the plan it was fitted on. */
  calibration: { k: number; plan: Plan } | undefined,
  planHistory: readonly PlanPeriod[],
  now: number,
): WeekShare[] {
  const lastByWindow = new Map<string, Snapshot>();
  for (const snapshot of snapshots) {
    if (Date.parse(snapshot.weeklyResetsAt) > now)
      continue;
    const last = lastByWindow.get(snapshot.weeklyResetsAt);
    if (!last || Date.parse(snapshot.ts) > Date.parse(last.ts))
      lastByWindow.set(snapshot.weeklyResetsAt, snapshot);
  }

  return [...lastByWindow.values()]
    .sort((a, b) => Date.parse(a.weeklyResetsAt) - Date.parse(b.weeklyResetsAt))
    .map((last) => {
      const resetsAt = Date.parse(last.weeklyResetsAt);
      const ts = Date.parse(last.ts);
      const estimated = resetsAt - ts > FINAL_READING_MS;
      const plan = planAt(planHistory, last.ts);
      // The extension is in % of the calibration's plan; express it on this week's plan. Usage stops at the cap.
      const percent = estimated && calibration
        ? Math.min(100, last.weekly + convertPercent(calibration.k * costBetween(ts, resetsAt), calibration.plan, plan))
        : last.weekly;
      return { estimated, percent, plan, resetsAt: last.weeklyResetsAt };
    });
}

/** Median and range of completed weeks, all expressed on `plan`. */
export function typicalWeek(shares: readonly WeekShare[], plan: Plan): TypicalWeek | undefined {
  if (shares.length === 0)
    return undefined;
  const values = shares.map(share => convertPercent(share.percent, share.plan, plan));
  return { max: Math.max(...values), median: median(values)!, min: Math.min(...values), weeks: values.length };
}
