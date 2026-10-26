import type { WindowPart } from './restarts.ts';
import type { Plan, Snapshot } from './types.ts';

import { DAY_MS, HOUR_MS } from './calibration.ts';

export interface PacingPoint {
  at: number;
  percent: number;
}

/** A part of the window that ended at a restart. */
export interface EarlierPacing {
  plan: Plan;
  /** 0 at the part's start, then its readings. */
  points: PacingPoint[];
}

export interface WeekPacing {
  /** The parts of the window that ended at a restart, oldest first, on their own plan's %. */
  earlier?: EarlierPacing[];
  /** Window start and reset, ms. */
  from: number;
  /** Weekly % of the running part so far: 0 at its start, each reading, then now when estimated. */
  points: PacingPoint[];
  /** The running part started at a restart: when, its plan and the one before. */
  restart?: { at: number; plan: Plan; previousPlan: Plan };
  /** Dollars per day left to reach 100 % at reset, when calibrated. */
  roomPerDay?: number;
  /** Dollars per day spent so far in the running part; undefined in its first hour. */
  spentPerDay?: number;
  to: number;
}

export interface PacingInput {
  costBetween: (from: number, to: number) => number;
  /** Calibrated % per dollar. */
  k?: number;
  now: number;
  /** The window's parts, oldest first; the last one is running. */
  parts: readonly WindowPart[];
  resetsAt: number;
  /** Weekly % now: the last reading, or the estimate since it. */
  usedNow: number;
  windowMs: number;
}

function pointsOf(readings: readonly Snapshot[], start: number, until: number, includeStart: boolean): PacingPoint[] {
  const points = [{ at: start, percent: 0 }];
  for (const reading of [...readings].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const at = Date.parse(reading.ts);
    // A reading of 0 at the start is the start point itself.
    if ((includeStart ? at > start || (at === start && reading.weekly > 0) : at > start) && at <= until)
      points.push({ at, percent: reading.weekly });
  }
  return points;
}

/** How the weekly % builds up over the current window since its last restart, and the daily budget left. */
export function weekPacing({ costBetween, k, now, parts, resetsAt, usedNow, windowMs }: PacingInput): WeekPacing {
  const from = resetsAt - windowMs;
  const running = parts.at(-1) ?? { end: resetsAt, plan: 'pro' as const, readings: [], start: from };
  const restarted = parts.length > 1;
  const points = pointsOf(running.readings, running.start, now, restarted);
  const last = points.at(-1)!;
  if (last.at < now && usedNow !== last.percent)
    points.push({ at: now, percent: usedNow });

  const pacing: WeekPacing = { from, points, to: resetsAt };
  if (restarted) {
    const ended = parts.slice(0, -1);
    pacing.earlier = ended
      .filter(part => part.readings.length > 0)
      .map(part => ({ plan: part.plan, points: pointsOf(part.readings, part.start, part.end, part.start !== from) }));
    pacing.restart = { at: running.start, plan: running.plan, previousPlan: ended.at(-1)!.plan };
  }
  const elapsed = now - running.start;
  if (elapsed >= HOUR_MS)
    pacing.spentPerDay = costBetween(running.start, now) / (elapsed / DAY_MS);
  const daysLeft = (resetsAt - now) / DAY_MS;
  if (k !== undefined && k > 0 && daysLeft > 0)
    pacing.roomPerDay = Math.max(0, 100 - usedNow) / k / daysLeft;
  return pacing;
}
