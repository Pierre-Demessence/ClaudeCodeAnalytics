import type { Plan, PlanPeriod, Snapshot } from './types.ts';

import { WEEK_MS } from './calibration.ts';
import { convertPercent, PLAN_MULTIPLIERS, planAt, planChanges } from './plans.ts';

/** A reading this many points under the previous one of its window marks a restart. */
export const RESTART_DROP = 2;

/** Where a weekly window's usage ran from `start` to `end` (ms) on one plan. */
export interface WindowPart {
  end: number;
  /** The plan of the part's last reading, or of its start without one. */
  plan: Plan;
  readings: Snapshot[];
  start: number;
}

/** The final weekly % of a part, on its own plan. */
export interface PartPercent {
  /** The part has no reading to take it from. */
  estimated?: true;
  percent: number;
  plan: Plan;
  /** ISO. */
  start: string;
}

/**
 * Each weekly window with readings, by reset time (ms), split where its usage
 * restarted; parts oldest first. Anthropic restarts the weekly % before the reset
 * time on an upgrade (100% to 0% with the same reset time) and on a free reset.
 */
export function windowParts(snapshots: readonly Snapshot[], planHistory: readonly PlanPeriod[]): Map<number, WindowPart[]> {
  const byReset = new Map<number, Snapshot[]>();
  for (const snapshot of [...snapshots].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const reset = Date.parse(snapshot.weeklyResetsAt);
    const group = byReset.get(reset);
    if (group)
      group.push(snapshot);
    else
      byReset.set(reset, [snapshot]);
  }
  const changes = planChanges(planHistory);

  const result = new Map<number, WindowPart[]>();
  for (const [reset, readings] of byReset) {
    const windowFrom = reset - WEEK_MS;
    const restarts = new Set<number>();
    for (let i = 1; i < readings.length; i++) {
      const [before, after] = [readings[i - 1]!, readings[i]!];
      if (after.weekly > before.weekly - RESTART_DROP)
        continue;
      const [from, to] = [Date.parse(before.ts), Date.parse(after.ts)];
      // A plan change between the two readings explains the drop; else the later reading does.
      const change = changes.findLast(c => c.at > from && c.at <= to);
      restarts.add(change?.at ?? to);
    }
    // An upgrade before the first reading cannot show as a drop, and restarts the usage.
    const firstReading = Date.parse(readings[0]!.ts);
    for (const change of changes) {
      if (PLAN_MULTIPLIERS[change.to] > PLAN_MULTIPLIERS[change.from] && change.at > windowFrom && change.at < reset && firstReading >= change.at)
        restarts.add(change.at);
    }

    const starts = [windowFrom, ...[...restarts].sort((a, b) => a - b)];
    // A reading goes to the last part starting at or before it (the first part when none does).
    const owned = starts.map((): Snapshot[] => []);
    for (const reading of readings) {
      const time = Date.parse(reading.ts);
      owned[Math.max(0, starts.findLastIndex(start => start <= time))]!.push(reading);
    }
    result.set(reset, starts.map((start, i) => {
      const last = owned[i]!.at(-1);
      return { end: starts[i + 1] ?? reset, plan: planAt(planHistory, last?.ts ?? new Date(start).toISOString()), readings: owned[i]!, start };
    }));
  }
  return result;
}

/** Where a reading's cost counts from: the start of its part (its window's start when the window has no parts). */
export function partStartOf(parts: ReadonlyMap<number, readonly WindowPart[]>): (snapshot: Snapshot) => number {
  return (snapshot) => {
    const reset = Date.parse(snapshot.weeklyResetsAt);
    const windowParts = parts.get(reset);
    const time = Date.parse(snapshot.ts);
    return windowParts?.findLast(part => part.start <= time)?.start ?? windowParts?.[0]?.start ?? reset - WEEK_MS;
  };
}

/**
 * The final % of a part that ended at a restart, on its own plan: its last
 * reading, else the calibrated cost since its start (0 without a calibration).
 */
export function endedPartPercent(
  part: WindowPart,
  costBetween: (from: number, to: number) => number,
  /** Calibrated % per dollar, and the plan it was fitted on. */
  calibration: { k: number; plan: Plan } | undefined,
): PartPercent {
  const start = new Date(part.start).toISOString();
  const last = part.readings.at(-1);
  if (last)
    return { percent: last.weekly, plan: part.plan, start };
  if (!calibration)
    return { estimated: true, percent: 0, plan: part.plan, start };
  const percent = Math.min(100, convertPercent(calibration.k * costBetween(part.start, part.end), calibration.plan, part.plan));
  return { estimated: true, percent, plan: part.plan, start };
}
