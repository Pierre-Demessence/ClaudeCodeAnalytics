import type { Snapshot } from './types.ts';

import { dayKey, startOfDay } from './aggregate.ts';
import { DAY_MS, WEEK_MS } from './calibration.ts';

/** Reset times this close are one reset: rounded to the minute, the same reset time can tip either way. */
export const RESET_TOLERANCE_MS = 2 * 60_000;

/**
 * The readings, oldest first, each with the weekly reset time its window's first
 * reading gave, as that reading wrote it: everything keys a window by its reset
 * time, so one a minute off would make a window of its own. The first reading's
 * holds while later readings come in.
 */
export function snapResets(snapshots: readonly Snapshot[]): Snapshot[] {
  const firsts: { iso: string; ms: number }[] = [];
  return snapshots.map((snapshot) => {
    const reset = Date.parse(snapshot.weeklyResetsAt);
    // Readings come in time order: their window is almost always the newest one.
    let first = firsts.findLast(known => Math.abs(known.ms - reset) <= RESET_TOLERANCE_MS);
    if (!first) {
      first = { iso: snapshot.weeklyResetsAt, ms: reset };
      firsts.push(first);
    }
    return first.iso === snapshot.weeklyResetsAt ? snapshot : { ...snapshot, weeklyResetsAt: first.iso };
  });
}

/** Window start containing `ms`, for windows anchored on `anchor` (a reset time). */
export function windowStartOf(ms: number, anchor: number): number {
  return anchor + Math.floor((ms - anchor) / WEEK_MS) * WEEK_MS;
}

/**
 * Start of the weekly window holding `ms`, given the reset times seen in
 * readings (sorted). Uses the first reset after `ms`, so usage lands in the
 * same window as the readings grouped by that reset, even if Anthropic moves
 * the reset time; past the last reset, windows continue from it.
 */
export function weekStartFor(ms: number, resets: readonly number[]): number {
  const anchor = resets.find(reset => reset > ms) ?? resets.at(-1)!;
  return windowStartOf(ms, anchor);
}

/** Monday 00:00 local, as a fallback week start before any reading exists. */
export function isoWeekStart(ms: number, timeZone: string): string {
  const day = dayKey(ms, timeZone);
  const date = new Date(`${day}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return dayKey(date.getTime() - offset * DAY_MS, 'UTC');
}

/** Start of the weekly window holding a time: from the readings' reset times, else local Monday 00:00. */
export function weekStarter(resets: readonly number[], timeZone: string): (ms: number) => number {
  return ms => (resets.length === 0 ? startOfDay(isoWeekStart(ms, timeZone), timeZone) : weekStartFor(ms, resets));
}

/** Label of the weekly window holding a time, as the usage chart's buckets: the start's ISO time, or the Monday's local day before any reading. */
export function weekBucketer(resets: readonly number[], timeZone: string): (ms: number) => string {
  return ms => (resets.length === 0 ? isoWeekStart(ms, timeZone) : new Date(weekStartFor(ms, resets)).toISOString());
}
