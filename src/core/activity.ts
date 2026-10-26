import type { Flush } from './cacheAnomalies.ts';
import type { Range } from './range.ts';
import type { ApiEvent, UsageRecord } from './types.ts';

import { startOfDay } from './aggregate.ts';
import { sessionProjects } from './breakdown.ts';
import { detectFlushes } from './cacheAnomalies.ts';
import { DAY_MS, WEEK_MS } from './calibration.ts';
import { costParts, messageCost, priceOf } from './pricing.ts';
import { addDays, DAILY_RANGE_MAX_DAYS, rangeDays } from './range.ts';
import { compareVersions } from './versions.ts';
import { weekStarter } from './weekWindows.ts';

/** Days averaged in the weekday × hour heatmap. */
const HEATMAP_DAYS = 28;
/** Days in the daily cache-share chart. */
const CACHE_DAYS = 14;
/** Upper edges of the cost-per-message bins, in USD; the last bin is open. */
export const COST_BIN_EDGES = [0.01, 0.03, 0.1, 0.3, 1, 3, 10] as const;
/** A message costing this much or more is an outlier. */
const OUTLIER_USD = 1;
const MAX_OUTLIERS = 5;
/** How long each prompt cache lives without a hit. */
const CACHE_LIFETIME_MS = { cacheWrite1h: 3_600_000, cacheWrite5m: 300_000 } as const;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type CostCause = 'input' | 'output' | 'cacheWrite5m' | 'cacheWrite1h' | 'cacheRead';

export interface Outlier {
  name: string;
  cause: CostCause;
  cost: number;
  /** Directory the conversation started in. */
  path: string;
  /** Time since the conversation's previous message, when it outlived the written cache. */
  pauseMs?: number;
  /** Tokens of the `cause` kind. */
  tokens: number;
  ts: string;
}

/** The cache flushes of one local day. */
export interface DayFlushes {
  /** USD the rewrites cost beyond reading the same tokens from the cache. */
  extra: number;
  idleGap: number;
  noGap: number;
}

/** Cache use over the `messages` range. */
export interface CacheWeek {
  /** Share of input tokens read from the cache, 0–1. */
  readShare: number;
  /** What the cache reads would have cost as fresh input, minus what they cost. */
  saved: number;
  /** Share of the cost spent writing the cache, 0–1. */
  writeCostShare: number;
}

/** When and how the usage happens. Costs are API-equivalent USD. */
export interface Activity {
  cache: {
    /** Whether `daily` holds local days or, for a range over 62 days, weekly windows. */
    bucket: 'day' | 'week';
    /** The last 14 local days, or the cache range's days or weekly windows; `day` is the local day a bucket starts. `readShare` is absent without usage, `flushes` without any. */
    daily: { day: string; flushes?: DayFlushes; readShare?: number }[];
    /** The `messages` range (the current weekly window by default); absent without usage. */
    week?: CacheWeek;
  };
  /** Average cost per day for each weekday (Monday first) and local hour, over `from`–`to` (local days). */
  heatmap: { cells: number[][]; from: string; to: string };
  /** Costs of the `messages` range's messages (the current weekly window by default). */
  messageCost: {
    /** Message counts per bin of `COST_BIN_EDGES`. */
    bins: number[];
    outlierCount: number;
    /** The most expensive outliers, costliest first. */
    outliers: Outlier[];
  };
  /** Local days, within the usage chart, on which the highest Claude Code version seen rose. */
  upgrades: { day: string; version: string }[];
}

export interface ActivityInput {
  /** Span of the cache-share chart; the last 14 local days by default. */
  cache?: Range;
  /** First local day of the usage chart. */
  chartFrom: string;
  /** Last local day of the usage chart; open by default. */
  chartTo?: string;
  /** Compactions excuse a cache read drop; other events are ignored. */
  events?: readonly ApiEvent[];
  /** Days averaged in the weekday × hour heatmap; the last 28 local days by default. */
  heatmap?: Range;
  /** Messages behind the cache stats and the cost bins; those from `weekStart` on by default. */
  messages?: Range;
  now: number;
  records: readonly UsageRecord[];
  timeZone: string;
  /** Start of the current weekly window: where the default `messages` begins. */
  weekStart?: number;
  /** Start of the weekly window holding a time, for the cache chart of a long range; local Mondays by default. */
  weekStartOf?: (ms: number) => number;
}

/** Local day, weekday (Monday = 0) and hour of an instant, memoized per 15-minute slot. */
function localTimeOf(timeZone: string): (ms: number) => { day: string; hour: number; weekday: number } {
  const format = new Intl.DateTimeFormat('en-US', { day: '2-digit', hour: '2-digit', hourCycle: 'h23', month: '2-digit', timeZone, weekday: 'short', year: 'numeric' });
  // Every time zone offset is a multiple of 15 minutes, so a slot never straddles a local hour.
  const slots = new Map<number, { day: string; hour: number; weekday: number }>();
  return (ms) => {
    const slot = Math.floor(ms / 900_000);
    let local = slots.get(slot);
    if (!local) {
      const parts = format.formatToParts(ms);
      const part = (type: string) => parts.find(p => p.type === type)!.value;
      local = { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')), weekday: WEEKDAYS.indexOf(part('weekday')) };
      slots.set(slot, local);
    }
    return local;
  };
}

/** Local days from `from` to `to` inclusive. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  // UTC noon steps never skip or repeat a calendar day.
  for (let ms = Date.parse(`${from}T12:00:00Z`); ; ms += DAY_MS) {
    const day = new Date(ms).toISOString().slice(0, 10);
    if (day > to)
      return days;
    days.push(day);
  }
}

/** Records more than a day outside `range` are skipped before the costlier local-time lookup; the day is the time zone margin. */
function isNear(record: Pick<UsageRecord, 'ts'>, range: Range): boolean {
  const ms = Date.parse(record.ts);
  return ms >= range.from - DAY_MS && ms < range.to + DAY_MS;
}

const inputTokens = (r: UsageRecord) => r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;

function heatmapOf(records: readonly UsageRecord[], localTime: ReturnType<typeof localTimeOf>, range: Range, now: number): Activity['heatmap'] {
  // Days after today have no usage yet and must not dilute the averages.
  const to = localTime(Math.min(range.to - 1, now)).day;
  // A loop, not Math.min(...): spreading a year of records overflows the call stack.
  let first = now;
  for (const record of records)
    first = Math.min(first, Date.parse(record.ts));
  const firstDay = localTime(first).day;
  const earliest = localTime(range.from).day;
  const from = firstDay > earliest ? firstDay : earliest;

  const dayCounts = Array.from<number>({ length: 7 }).fill(0);
  for (const day of daysBetween(from, to))
    dayCounts[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]!++;

  const cells = Array.from({ length: 7 }, () => Array.from<number>({ length: 24 }).fill(0));
  for (const record of records) {
    if (!isNear(record, range))
      continue;
    const local = localTime(Date.parse(record.ts));
    if (local.day >= from && local.day <= to)
      cells[local.weekday]![local.hour]! += messageCost(record).cost;
  }
  return { cells: cells.map((row, weekday) => row.map(total => (dayCounts[weekday] ? total / dayCounts[weekday] : 0))), from, to };
}

function cacheOf(week: readonly UsageRecord[], records: readonly UsageRecord[], flushes: readonly Flush[], localTime: ReturnType<typeof localTimeOf>, range: Range, now: number, weekStartOf: (ms: number) => number): Activity['cache'] {
  let read = 0;
  let input = 0;
  let saved = 0;
  let writeCost = 0;
  let cost = 0;
  for (const record of week) {
    read += record.cacheRead;
    input += inputTokens(record);
    const parts = costParts(record);
    const price = priceOf(record);
    if (!parts || !price)
      continue;
    saved += parts.cacheRead * (price.input / price.cacheRead - 1);
    writeCost += parts.cacheWrite5m + parts.cacheWrite1h;
    cost += parts.input + parts.output + parts.cacheWrite5m + parts.cacheWrite1h + parts.cacheRead;
  }

  // Nothing happened after now.
  const shown = { from: range.from, to: Math.min(range.to, now + 1) };
  const bucket = rangeDays(range) > DAILY_RANGE_MAX_DAYS ? 'week' : 'day';
  const bucketOf = (ms: number) => localTime(bucket === 'day' ? ms : weekStartOf(ms)).day;
  const buckets: string[] = [];
  if (bucket === 'day') {
    buckets.push(...daysBetween(localTime(shown.from).day, localTime(shown.to - 1).day));
  }
  else {
    for (let start = weekStartOf(shown.from); start < shown.to;) {
      buckets.push(localTime(start).day);
      const next = weekStartOf(start + WEEK_MS);
      start = next > start ? next : start + WEEK_MS;
    }
  }

  const perBucket = new Map<string, { input: number; read: number }>();
  for (const record of records) {
    const ms = Date.parse(record.ts);
    if (ms < shown.from || ms >= shown.to)
      continue;
    const key = bucketOf(ms);
    const totals = perBucket.get(key) ?? { input: 0, read: 0 };
    totals.read += record.cacheRead;
    totals.input += inputTokens(record);
    perBucket.set(key, totals);
  }

  const flushesPerBucket = new Map<string, DayFlushes>();
  for (const flush of flushes) {
    const ms = Date.parse(flush.ts);
    if (ms < shown.from || ms >= shown.to)
      continue;
    const key = bucketOf(ms);
    const totals = flushesPerBucket.get(key) ?? { extra: 0, idleGap: 0, noGap: 0 };
    totals[flush.kind]++;
    totals.extra += flush.extra;
    flushesPerBucket.set(key, totals);
  }

  return {
    bucket,
    week: input > 0 ? { readShare: read / input, saved, writeCostShare: cost > 0 ? writeCost / cost : 0 } : undefined,
    daily: buckets.map((day) => {
      const totals = perBucket.get(day);
      const bucketFlushes = flushesPerBucket.get(day);
      return { day, ...totals?.input ? { readShare: totals.read / totals.input } : {}, ...bucketFlushes && { flushes: bucketFlushes } };
    }),
  };
}

function messageCostOf(week: readonly UsageRecord[], records: readonly UsageRecord[]): Activity['messageCost'] {
  const bins = Array.from<number>({ length: COST_BIN_EDGES.length + 1 }).fill(0);
  const expensive: { cost: number; record: UsageRecord }[] = [];
  for (const record of week) {
    const { cost } = messageCost(record);
    const bin = COST_BIN_EDGES.findIndex(edge => cost < edge);
    bins[bin === -1 ? COST_BIN_EDGES.length : bin]!++;
    if (cost >= OUTLIER_USD)
      expensive.push({ cost, record });
  }
  expensive.sort((a, b) => b.cost - a.cost);

  const projectFor = sessionProjects(records);
  const outliers = expensive.slice(0, MAX_OUTLIERS).map(({ cost, record }): Outlier => {
    const parts = costParts(record)!;
    const cause = (Object.keys(parts) as CostCause[]).reduce((a, b) => (parts[b] > parts[a] ? b : a));
    const outlier: Outlier = { ...projectFor(record), cause, cost, tokens: record[cause], ts: record.ts };
    if ((cause === 'cacheWrite5m' || cause === 'cacheWrite1h') && record.sessionId) {
      const ms = Date.parse(record.ts);
      // The main conversation and its subagents each have their own cache: a subagent at work does not keep the main one alive.
      let previous = -Infinity;
      for (const other of records) {
        const otherMs = Date.parse(other.ts);
        if (other.sessionId === record.sessionId && Boolean(other.sidechain) === Boolean(record.sidechain) && otherMs < ms && otherMs > previous)
          previous = otherMs;
      }
      if (ms - previous > CACHE_LIFETIME_MS[cause] && previous > -Infinity)
        outlier.pauseMs = ms - previous;
    }
    return outlier;
  });

  return { bins, outlierCount: expensive.length, outliers };
}

function upgradesOf(records: readonly UsageRecord[], localTime: ReturnType<typeof localTimeOf>, chartFrom: string, chartTo: string): Activity['upgrades'] {
  const versioned = records.filter(r => r.version).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const byDay = new Map<string, string>();
  let highest: string | undefined;
  for (const record of versioned) {
    if (highest && compareVersions(record.version!, highest) > 0)
      byDay.set(localTime(Date.parse(record.ts)).day, record.version!);
    if (!highest || compareVersions(record.version!, highest) > 0)
      highest = record.version;
  }
  return [...byDay].filter(([day]) => day >= chartFrom && day <= chartTo).map(([day, version]) => ({ day, version }));
}

/** Heatmap, cache use, message costs and Claude Code upgrades. */
export function buildActivity({ cache, chartFrom, chartTo = '9999-12-31', events = [], heatmap, messages, now, records, timeZone, weekStart = -Infinity, weekStartOf }: ActivityInput): Activity {
  const localTime = localTimeOf(timeZone);
  const today = localTime(now).day;
  const endOfToday = startOfDay(addDays(today, 1), timeZone);
  const heatmapRange = heatmap ?? { from: startOfDay(addDays(today, -(HEATMAP_DAYS - 1)), timeZone), to: endOfToday };
  const cacheRange = cache ?? { from: startOfDay(addDays(today, -(CACHE_DAYS - 1)), timeZone), to: endOfToday };
  const messagesRange = messages ?? { from: weekStart, to: Infinity };
  const week = records.filter((record) => {
    const ms = Date.parse(record.ts);
    return ms >= messagesRange.from && ms < messagesRange.to;
  });
  return {
    cache: cacheOf(week, records, detectFlushes(records, events), localTime, cacheRange, now, weekStartOf ?? weekStarter([], timeZone)),
    heatmap: heatmapOf(records, localTime, heatmapRange, now),
    messageCost: messageCostOf(week, records),
    upgrades: upgradesOf(records, localTime, chartFrom, chartTo),
  };
}
