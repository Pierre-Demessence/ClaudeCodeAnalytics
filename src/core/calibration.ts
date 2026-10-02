import type { Snapshot } from './types.ts';

export const HOUR_MS = 3_600_000;
export const FIVE_HOURS_MS = 5 * HOUR_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** Utilization comes in whole percents; below this, rounding dominates. */
const MIN_PERCENT_FOR_FIT = 5;
const MIN_POINTS = 3;

export interface CalibrationPoint {
  ts: number;
  /** Claude Code's part of the weekly %. */
  usage: number;
  /** API-equivalent cost since the window started. */
  cost: number;
}

/** % of the weekly limit used per dollar of API-equivalent usage. */
export interface Calibration {
  k: number;
  n: number;
  /** Root-mean-square error of the fit, in % points. */
  rmse: number;
}

export function windowStart(snapshot: Snapshot): number {
  return Date.parse(snapshot.weeklyResetsAt) - WEEK_MS;
}

/**
 * One point per reading: the Claude Code part of the weekly % against the
 * cost seen in transcripts since the window started. Transcripts only see
 * Claude Code, so claude.ai usage is taken out using the endpoint's breakdown.
 * Windows that started before the first imported message are skipped.
 */
export function calibrationPoints(
  snapshots: readonly Snapshot[],
  costBetween: (from: number, to: number) => number,
  /** Time of the first imported message: earlier windows have incomplete costs. */
  dataStart = Number.NEGATIVE_INFINITY,
): CalibrationPoint[] {
  return snapshots
    .filter(s => s.weekly >= MIN_PERCENT_FOR_FIT && windowStart(s) >= dataStart)
    .map((s) => {
      const ts = Date.parse(s.ts);
      return { cost: costBetween(windowStart(s), ts), ts, usage: s.weekly * (s.claudeCodeShare ?? 100) / 100 };
    });
}

/**
 * One point per reading with a 5-hour window: the 5-hour % against the cost
 * since that window started. The endpoint gives no Claude Code share for the
 * 5-hour window, so claude.ai usage in it counts against Claude Code's cost.
 */
export function fiveHourCalibrationPoints(
  snapshots: readonly Snapshot[],
  costBetween: (from: number, to: number) => number,
  /** Time of the first imported message: earlier windows have incomplete costs. */
  dataStart = Number.NEGATIVE_INFINITY,
): CalibrationPoint[] {
  return snapshots.flatMap((s) => {
    if (s.fiveHour === undefined || s.fiveHour < MIN_PERCENT_FOR_FIT || !s.fiveHourResetsAt)
      return [];
    const start = Date.parse(s.fiveHourResetsAt) - FIVE_HOURS_MS;
    if (start < dataStart)
      return [];
    const ts = Date.parse(s.ts);
    return [{ cost: costBetween(start, ts), ts, usage: s.fiveHour }];
  });
}

/**
 * Weighted least squares through the origin: `usage ≈ k × cost`. Each point's
 * weight halves every `halfLifeDays`, since limits and promotions change.
 */
export function fitRatio(points: readonly CalibrationPoint[], now: number, halfLifeDays = 14): Calibration | undefined {
  if (points.length < MIN_POINTS)
    return undefined;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const weight = 0.5 ** ((now - p.ts) / DAY_MS / halfLifeDays);
    num += weight * p.usage * p.cost;
    den += weight * p.cost * p.cost;
  }
  if (den === 0)
    return undefined;
  const k = num / den;
  const squared = points.reduce((sum, p) => sum + (p.usage - k * p.cost) ** 2, 0);
  return { k, n: points.length, rmse: Math.sqrt(squared / points.length) };
}
