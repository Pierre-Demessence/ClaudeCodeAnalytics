import type { Plan, PlanPeriod, Snapshot } from './types.ts';

import { WEEK_MS } from './calibration.ts';
import { windowParts } from './restarts.ts';
import { median } from './stats.ts';

/** Weekly windows drawn in the drift chart. */
const DRIFT_WINDOWS = 12;
/** One reading's whole-percent rounding is ±0.5 pt: under 10%, it is over 5% of the ratio, close to the off threshold. */
const MIN_PERCENT_FOR_DRIFT = 10;
/** Completed windows needed for a usual ratio. */
export const MIN_DRIFT_WEEKS = 3;
/** A window this far (relative) from the usual ratio is off. */
export const OFF_THRESHOLD = 0.15;
/** Readings sent besides the manual ones. */
const LATEST_READINGS = 100;

export interface DriftWindow {
  /** Claude Code's share of the weekly %, 0–100. */
  claudeCode: number;
  /** API-equivalent cost from the window start to its last reading. */
  cost: number;
  /** Set on the weekly window still running. */
  current?: true;
  /** ISO start of the first part counted, when the window restarted and it is not the window's own start. */
  from?: string;
  /** % of the weekly limit per $100 of Claude Code usage. */
  ratio: number;
  resetsAt: string;
}

export interface Limits {
  /** Up to 12 windows on the current plan, oldest first. */
  drift: DriftWindow[];
  /** Latest 100 readings plus every manual one, newest first. */
  readings: Snapshot[];
  /** Readings taken in each plan period, by index in `planHistory`. */
  readingsPerPeriod: number[];
  /** Trailing run of off windows, when the last two completed are off the same way. */
  shift?: {
    /** % change of the run's median ratio against the usual one; negative when $100 costs less of the limit. */
    change: number;
    /** ISO start of the run's first window. */
    since: string;
  };
  /** Median ratio of the completed windows; absent under 3 of them. */
  usual?: number;
}

export interface LimitsInput {
  costBetween: (from: number, to: number) => number;
  /** Time of the first imported message: earlier windows have incomplete costs. */
  dataStart: number;
  now: number;
  plan: Plan;
  planHistory: readonly PlanPeriod[];
  /** Sorted by time. */
  snapshots: readonly Snapshot[];
}

export const isOff = (ratio: number, usual: number): boolean => Math.abs(ratio - usual) / usual > OFF_THRESHOLD;

/**
 * The last 12 windows taken on `plan` (the current one by default), oldest first.
 * A window whose usage restarted counts its parts on that plan: their % added up
 * over their cost added up, each cost from its own part's start.
 */
export function driftWindows({ costBetween, dataStart, now, plan, planHistory, snapshots }: LimitsInput, onPlan: Plan = plan): DriftWindow[] {
  return [...windowParts(snapshots, planHistory)]
    .sort(([a], [b]) => a - b)
    .flatMap(([reset, parts]): DriftWindow[] => {
      const counted = parts.filter(part => part.plan === onPlan && part.readings.length > 0 && part.start >= dataStart);
      let weekly = 0;
      let usage = 0;
      let cost = 0;
      for (const part of counted) {
        const last = part.readings.at(-1)!;
        weekly += last.weekly;
        usage += last.weekly * (last.claudeCodeShare ?? 100) / 100;
        cost += costBetween(part.start, Date.parse(last.ts));
      }
      // All claude.ai usage: Claude Code's cost says nothing about the limit.
      if (weekly < MIN_PERCENT_FOR_DRIFT || cost <= 0)
        return [];
      const window: DriftWindow = { claudeCode: usage / weekly * 100, cost, ratio: usage / cost * 100, resetsAt: counted[0]!.readings[0]!.weeklyResetsAt };
      const from = counted[0]!.start;
      if (from > reset - WEEK_MS)
        window.from = new Date(from).toISOString();
      if (reset > now)
        window.current = true;
      return [window];
    })
    .slice(-DRIFT_WINDOWS);
}

/** The longest trailing run of completed windows off in the same direction, if at least 2 long. */
function shiftOf(completed: readonly DriftWindow[], usual: number): Limits['shift'] {
  const direction = (w: DriftWindow) => (isOff(w.ratio, usual) ? Math.sign(w.ratio - usual) : 0);
  const last = completed.at(-1);
  const sign = last ? direction(last) : 0;
  if (!sign)
    return undefined;
  let start = completed.length - 1;
  while (start > 0 && direction(completed[start - 1]!) === sign)
    start--;
  const run = completed.slice(start);
  if (run.length < 2)
    return undefined;
  return {
    change: (median(run.map(w => w.ratio))! / usual - 1) * 100,
    since: new Date(Date.parse(run[0]!.resetsAt) - WEEK_MS).toISOString(),
  };
}

function readingsPerPeriod(snapshots: readonly Snapshot[], planHistory: readonly PlanPeriod[]): number[] {
  const counts = planHistory.map(() => 0);
  for (const snapshot of snapshots) {
    const time = Date.parse(snapshot.ts);
    // Before the first period, the first plan applies (as in `planAt`).
    const index = planHistory.findLastIndex(period => Date.parse(period.from) <= time);
    if (counts.length > 0)
      counts[Math.max(index, 0)]!++;
  }
  return counts;
}

/** Limit drift, and the readings table's rows, for the Calibration tab. */
export function buildLimits(input: LimitsInput): Limits {
  const drift = driftWindows(input);
  const completed = drift.filter(w => !w.current);
  const usual = completed.length >= MIN_DRIFT_WEEKS ? median(completed.map(w => w.ratio)) : undefined;
  const newestFirst = [...input.snapshots].reverse();
  const readings = [
    ...newestFirst.slice(0, LATEST_READINGS),
    ...newestFirst.slice(LATEST_READINGS).filter(s => s.source === 'manual'),
  ];
  return {
    drift,
    readings,
    readingsPerPeriod: readingsPerPeriod(input.snapshots, input.planHistory),
    shift: usual === undefined ? undefined : shiftOf(completed, usual),
    usual,
  };
}
