import { dayKey, startOfDay } from './aggregate.ts';
import { DAY_MS, WEEK_MS } from './calibration.ts';

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
