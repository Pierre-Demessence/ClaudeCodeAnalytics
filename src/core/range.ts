import { dayKey, startOfDay } from './aggregate.ts';
import { DAY_MS, HOUR_MS, WEEK_MS } from './calibration.ts';
import { weekStarter } from './weekWindows.ts';

/** A span of time in ms; `to` is exclusive. */
export interface Range {
  from: number;
  to: number;
}

export type PresetId = 'week' | '4weeks' | '3months' | '12months' | 'all';

/** The preset ranges in the picker's order, with their hash ids. */
export const PRESETS: readonly { id: PresetId; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: '4weeks', label: 'Last 4 weeks' },
  { id: '3months', label: 'Last 3 months' },
  { id: '12months', label: 'Last 12 months' },
  { id: 'all', label: 'All time' },
];

/**
 * What the user picked. A preset stays relative to now; `back` counts the
 * steps taken into the past from it. A custom range is two inclusive local days.
 */
export type RangeChoice
  = | { kind: 'custom'; from: string; to: string }
    | { kind: 'preset'; back: number; preset: PresetId };

/** What a range depends on besides the choice. */
export interface RangeContext {
  /** Time of the first stored message; absent without data. */
  firstMessage?: number;
  now: number;
  /** Weekly reset times seen in readings, sorted. */
  resets: readonly number[];
  timeZone: string;
}

/** A range of this many days or fewer is charted by day, a longer one by weekly window. */
export const DAILY_RANGE_MAX_DAYS = 62;
/** The longest range the API answers; keeps a typo'd year from walking millions of days. */
export const MAX_RANGE_MS = 100 * 366 * DAY_MS;
/** Steps back a hash may name: far more than any history. */
const MAX_BACK = 1000;
const PRESET_MONTHS: Partial<Record<PresetId, number>> = { '12months': 12, '3months': 3 };
const WEEK_COUNTS: Partial<Record<PresetId, number>> = { '4weeks': 4, 'week': 1 };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The local day `offset` calendar days from `day`, whatever the DST changes between. */
export function addDays(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** The local day `offset` calendar months from `day`, its day of the month cut to the month's length. */
function addMonths(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const months = year * 12 + month - 1 + offset;
  const newYear = Math.floor(months / 12);
  const newMonth = months % 12;
  const length = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  return `${String(newYear).padStart(4, '0')}-${String(newMonth + 1).padStart(2, '0')}-${String(Math.min(date, length)).padStart(2, '0')}`;
}

/** Whether `value` is a real `YYYY-MM-DD` date. */
function isDay(value: string | null): value is string {
  if (value === null || !DAY_PATTERN.test(value))
    return false;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/** Number of calendar days a range covers (a DST day of 23 or 25 hours counts as one). */
export function rangeDays(range: Range): number {
  return Math.max(1, Math.round((range.to - range.from) / DAY_MS));
}

/** Whether the range runs past the present, so new messages change it. */
export const includesNow = (range: Range, now: number) => range.to > now;

/** Weekly windows: `count` of them, `back * count` windows before the current one. */
function weekRange(count: number, back: number, ctx: RangeContext): Range {
  const weekStartOf = weekStarter(ctx.resets, ctx.timeZone);
  const current = weekStartOf(ctx.now);
  // Walk back one window at a time: reset times may have moved, so windows are not exact multiples of a week.
  const startOf = (windowsBack: number) => {
    let start = current;
    for (let i = 0; i < windowsBack; i++)
      start = weekStartOf(start - 1);
    return start;
  };
  const newest = count * back;
  // Three hours past a week's length lands inside the next window even in a 167 or 169-hour DST week.
  return { from: startOf(newest + count - 1), to: newest === 0 ? weekStartOf(current + WEEK_MS + 3 * HOUR_MS) : startOf(newest - 1) };
}

/** The span a choice stands for, now. */
export function resolveRange(choice: RangeChoice, ctx: RangeContext): Range {
  const { now, timeZone } = ctx;
  if (choice.kind === 'custom')
    return { from: startOfDay(choice.from, timeZone), to: startOfDay(addDays(choice.to, 1), timeZone) };

  const tomorrow = addDays(dayKey(now, timeZone), 1);
  const weeks = WEEK_COUNTS[choice.preset];
  if (weeks !== undefined)
    return weekRange(weeks, choice.back, ctx);
  const months = PRESET_MONTHS[choice.preset];
  if (months !== undefined) {
    return {
      from: startOfDay(addMonths(tomorrow, -months * (choice.back + 1)), timeZone),
      to: startOfDay(addMonths(tomorrow, -months * choice.back), timeZone),
    };
  }
  return { from: startOfDay(dayKey(ctx.firstMessage ?? now, timeZone), timeZone), to: startOfDay(tomorrow, timeZone) };
}

/** A custom choice holding the days of `range`, up to today. */
export function customFromRange(range: Range, ctx: Pick<RangeContext, 'now' | 'timeZone'>): RangeChoice {
  const last = dayKey(Math.min(range.to - 1, ctx.now), ctx.timeZone);
  return { from: dayKey(range.from, ctx.timeZone), kind: 'custom', to: last };
}

/**
 * The choice one step into the past (`-1`) or toward now (`1`), by the range's
 * own length; undefined when there is nowhere to go.
 */
export function stepRange(choice: RangeChoice, direction: -1 | 1, ctx: RangeContext): RangeChoice | undefined {
  const range = resolveRange(choice, ctx);
  if (direction === -1 ? ctx.firstMessage === undefined || range.from <= ctx.firstMessage : includesNow(range, ctx.now))
    return undefined;
  if (choice.kind === 'preset') {
    if (choice.preset === 'all')
      return undefined;
    return { ...choice, back: choice.back - direction };
  }
  const days = rangeDays(range) * direction;
  // Never past today: the data stops there.
  const today = dayKey(ctx.now, ctx.timeZone);
  const to = addDays(choice.to, days);
  return { from: addDays(choice.from, days), kind: 'custom', to: to > today ? today : to };
}

const dayFormats = new Map<boolean, Intl.DateTimeFormat>();

function formatDay(day: string, withYear: boolean): string {
  let format = dayFormats.get(withYear);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', ...withYear && { year: 'numeric' } });
    dayFormats.set(withYear, format);
  }
  return format.format(new Date(`${day}T12:00:00Z`));
}

/** "12 Oct – 18 Oct 2026", by local day; one day reads "19 Oct 2026". */
export function rangeLabel(range: Range, timeZone: string): string {
  const first = dayKey(range.from, timeZone);
  const last = dayKey(range.to - 1, timeZone);
  if (first === last)
    return formatDay(first, true);
  return `${formatDay(first, first.slice(0, 4) !== last.slice(0, 4))} – ${formatDay(last, true)}`;
}

/** The choice named by a hash query (`range=week&back=1`, `from=…&to=…`); undefined when absent or invalid. */
export function parseRangeQuery(query: string): RangeChoice | undefined {
  const params = new URLSearchParams(query);
  const preset = params.get('range');
  if (preset !== null) {
    const found = PRESETS.find(p => p.id === preset);
    const backText = params.get('back');
    const back = backText === null ? 0 : Number(backText);
    if (!found || !Number.isInteger(back) || back < 0 || back > MAX_BACK)
      return undefined;
    return { back: found.id === 'all' ? 0 : back, kind: 'preset', preset: found.id };
  }
  const from = params.get('from');
  const to = params.get('to');
  if (isDay(from) && isDay(to) && from <= to)
    return { from, kind: 'custom', to };
  return undefined;
}

/** The hash query for a choice, without the `?`. */
export function formatRangeQuery(choice: RangeChoice): string {
  if (choice.kind === 'custom')
    return `from=${choice.from}&to=${choice.to}`;
  return choice.back > 0 ? `range=${choice.preset}&back=${choice.back}` : `range=${choice.preset}`;
}
