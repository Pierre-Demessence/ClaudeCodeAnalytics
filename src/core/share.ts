import type { PartPercent } from './restarts.ts';
import type { Plan, PlanPeriod, Snapshot } from './types.ts';

import { WEEK_MS } from './calibration.ts';
import { convertWeekly, planAt, planChangeWithin } from './plans.ts';
import { endedPartPercent, windowParts } from './restarts.ts';
import { median, quantile } from './stats.ts';

export interface WeekShare {
  /** True when the last reading was well before reset, or a part has no reading. */
  estimated: boolean;
  /** Each part's final % on its own plan, when the usage restarted inside the window; the last one is the part that ran to the reset. */
  parts?: PartPercent[];
  /** Final weekly % on `plan`: the sum of the parts' final %, each converted to it. */
  percent: number;
  plan: Plan;
  /** A plan change started inside the window; shown as such, the % already adds the parts up. */
  planChange?: true;
  resetsAt: string;
}

export interface TypicalWeek {
  /** 75th percentile of final weekly %. */
  high: number;
  /** 25th percentile of final weekly %. */
  low: number;
  max: number;
  median: number;
  min: number;
  weeks: number;
}

/** A last reading closer to reset than this is taken as final. */
export const FINAL_READING_MS = 12 * 3_600_000;

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

  const parts = windowParts(snapshots, planHistory);
  return [...lastByWindow.values()]
    .sort((a, b) => Date.parse(a.weeklyResetsAt) - Date.parse(b.weeklyResetsAt))
    .map((last) => {
      const resetsAt = Date.parse(last.weeklyResetsAt);
      const ts = Date.parse(last.ts);
      const lateEstimate = resetsAt - ts > FINAL_READING_MS;
      const plan = planAt(planHistory, last.ts);
      // The extension is in % of the calibration's plan; express it on this week's plan. Usage stops at the cap.
      const lastPercent = lateEstimate && calibration
        ? Math.min(100, last.weekly + convertWeekly(calibration.k * costBetween(ts, resetsAt), calibration.plan, plan))
        : last.weekly;
      const planChange = planChangeWithin(planHistory, resetsAt - WEEK_MS, resetsAt) || undefined;
      // Only the part that ran to the reset is extended; the ones that ended at a restart are final.
      const ended = (parts.get(resetsAt) ?? []).slice(0, -1).map(part => endedPartPercent(part, costBetween, calibration));
      if (ended.length === 0)
        return { estimated: lateEstimate, percent: lastPercent, plan, planChange, resetsAt: last.weeklyResetsAt };
      const running = parts.get(resetsAt)!.at(-1)!;
      const all: PartPercent[] = [...ended, { ...(lateEstimate && { estimated: true as const }), percent: lastPercent, plan, start: new Date(running.start).toISOString() }];
      return {
        estimated: all.some(part => part.estimated),
        parts: all,
        percent: all.reduce((sum, part) => sum + convertWeekly(part.percent, part.plan, plan), 0),
        plan,
        planChange,
        resetsAt: last.weeklyResetsAt,
      };
    });
}

/** Median, quartiles and range of completed weeks, all expressed on `plan`. */
export function typicalWeek(shares: readonly WeekShare[], plan: Plan): TypicalWeek | undefined {
  if (shares.length === 0)
    return undefined;
  const values = shares.map(share => convertWeekly(share.percent, share.plan, plan));
  return {
    high: quantile(values, 0.75)!,
    low: quantile(values, 0.25)!,
    max: Math.max(...values),
    median: median(values)!,
    min: Math.min(...values),
    weeks: values.length,
  };
}
