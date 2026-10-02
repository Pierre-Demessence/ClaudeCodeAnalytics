import type { Snapshot } from './types.ts';

import { DAY_MS, HOUR_MS } from './calibration.ts';

export interface WeekPacing {
  /** Window start and reset, ms. */
  from: number;
  /** Weekly % over the window so far: 0 at the start, each reading, then now when estimated. */
  points: { at: number; percent: number }[];
  /** Dollars per day left to reach 100 % at reset, when calibrated. */
  roomPerDay?: number;
  /** Dollars per day spent so far this window; undefined in its first hour. */
  spentPerDay?: number;
  to: number;
}

export interface PacingInput {
  costBetween: (from: number, to: number) => number;
  /** Calibrated % per dollar. */
  k?: number;
  now: number;
  /** Readings of this window only. */
  readings: readonly Snapshot[];
  resetsAt: number;
  /** Weekly % now: the last reading, or the estimate since it. */
  usedNow: number;
  windowMs: number;
}

/** How the weekly % builds up over the current window, and the daily budget left. */
export function weekPacing({ costBetween, k, now, readings, resetsAt, usedNow, windowMs }: PacingInput): WeekPacing {
  const from = resetsAt - windowMs;
  const points = [{ at: from, percent: 0 }];
  for (const reading of [...readings].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const at = Date.parse(reading.ts);
    if (at > from && at <= now)
      points.push({ at, percent: reading.weekly });
  }
  const last = points.at(-1)!;
  if (last.at < now && usedNow !== last.percent)
    points.push({ at: now, percent: usedNow });

  const pacing: WeekPacing = { from, points, to: resetsAt };
  const elapsed = now - from;
  if (elapsed >= HOUR_MS)
    pacing.spentPerDay = costBetween(from, now) / (elapsed / DAY_MS);
  const daysLeft = (resetsAt - now) / DAY_MS;
  if (k !== undefined && k > 0 && daysLeft > 0)
    pacing.roomPerDay = Math.max(0, 100 - usedNow) / k / daysLeft;
  return pacing;
}
