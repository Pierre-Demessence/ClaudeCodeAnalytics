import type { Flush } from './cacheAnomalies.ts';
import type { ApiEvent, UsageRecord } from './types.ts';

import { sessionProjects } from './breakdown.ts';
import { detectFlushes } from './cacheAnomalies.ts';
import { costParts, messageCost, priceFor } from './pricing.ts';
import { compareVersions } from './versions.ts';

const DAY_MS = 86_400_000;
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
    /** The last 14 local days; `readShare` is absent on a day without usage, `flushes` on a day without any. */
    daily: { day: string; flushes?: DayFlushes; readShare?: number }[];
    /** The current weekly window; absent without usage. */
    week?: CacheWeek;
  };
  /** Average cost per day for each weekday (Monday first) and local hour, over `from`–`to` (local days). */
  heatmap: { cells: number[][]; from: string; to: string };
  /** Costs of the current weekly window's messages. */
  messageCost: {
    /** Message counts per bin of `COST_BIN_EDGES`. */
    bins: number[];
    outlierCount: number;
    /** The most expensive outliers, costliest first. */
    outliers: Outlier[];
  };
  /** Local days, within the daily chart, on which the highest Claude Code version seen rose. */
  upgrades: { day: string; version: string }[];
}

export interface ActivityInput {
  /** First local day of the daily chart. */
  chartFrom: string;
  /** Compactions excuse a cache read drop; other events are ignored. */
  events?: readonly ApiEvent[];
  now: number;
  records: readonly UsageRecord[];
  timeZone: string;
  /** Start of the current weekly window. */
  weekStart: number;
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

/** The local day `offset` calendar days from `day`, whatever the DST changes between. */
function addDays(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** Records older than `days` local days before `now` (plus a day of time zone margin) are skipped before the costlier local-time lookup. */
const isRecent = (record: Pick<UsageRecord, 'ts'>, now: number, days: number) => Date.parse(record.ts) >= now - (days + 1) * DAY_MS;

const inputTokens = (r: UsageRecord) => r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;

function heatmapOf(records: readonly UsageRecord[], localTime: ReturnType<typeof localTimeOf>, now: number): Activity['heatmap'] {
  const to = localTime(now).day;
  // A loop, not Math.min(...): spreading a year of records overflows the call stack.
  let first = now;
  for (const record of records)
    first = Math.min(first, Date.parse(record.ts));
  const firstDay = localTime(first).day;
  const earliest = addDays(to, -(HEATMAP_DAYS - 1));
  const from = firstDay > earliest ? firstDay : earliest;

  const dayCounts = Array.from<number>({ length: 7 }).fill(0);
  for (const day of daysBetween(from, to))
    dayCounts[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]!++;

  const cells = Array.from({ length: 7 }, () => Array.from<number>({ length: 24 }).fill(0));
  for (const record of records) {
    if (!isRecent(record, now, HEATMAP_DAYS))
      continue;
    const local = localTime(Date.parse(record.ts));
    if (local.day >= from && local.day <= to)
      cells[local.weekday]![local.hour]! += messageCost(record).cost;
  }
  return { cells: cells.map((row, weekday) => row.map(total => (dayCounts[weekday] ? total / dayCounts[weekday] : 0))), from, to };
}

function cacheOf(week: readonly UsageRecord[], records: readonly UsageRecord[], flushes: readonly Flush[], localTime: ReturnType<typeof localTimeOf>, now: number): Activity['cache'] {
  let read = 0;
  let input = 0;
  let saved = 0;
  let writeCost = 0;
  let cost = 0;
  for (const record of week) {
    read += record.cacheRead;
    input += inputTokens(record);
    const parts = costParts(record);
    const price = priceFor(record.model);
    if (!parts || !price)
      continue;
    saved += parts.cacheRead * (price.input / price.cacheRead - 1);
    writeCost += parts.cacheWrite5m + parts.cacheWrite1h;
    cost += parts.input + parts.output + parts.cacheWrite5m + parts.cacheWrite1h + parts.cacheRead;
  }

  const today = localTime(now).day;
  const days = daysBetween(addDays(today, -(CACHE_DAYS - 1)), today);
  const perDay = new Map<string, { input: number; read: number }>();
  for (const record of records) {
    if (!isRecent(record, now, CACHE_DAYS))
      continue;
    const day = localTime(Date.parse(record.ts)).day;
    if (day < days[0]!)
      continue;
    const totals = perDay.get(day) ?? { input: 0, read: 0 };
    totals.read += record.cacheRead;
    totals.input += inputTokens(record);
    perDay.set(day, totals);
  }

  const flushesPerDay = new Map<string, DayFlushes>();
  for (const flush of flushes) {
    if (!isRecent(flush, now, CACHE_DAYS))
      continue;
    const day = localTime(Date.parse(flush.ts)).day;
    const totals = flushesPerDay.get(day) ?? { extra: 0, idleGap: 0, noGap: 0 };
    totals[flush.kind]++;
    totals.extra += flush.extra;
    flushesPerDay.set(day, totals);
  }

  return {
    week: input > 0 ? { readShare: read / input, saved, writeCostShare: cost > 0 ? writeCost / cost : 0 } : undefined,
    daily: days.map((day) => {
      const totals = perDay.get(day);
      const dayFlushes = flushesPerDay.get(day);
      return { day, ...totals?.input ? { readShare: totals.read / totals.input } : {}, ...dayFlushes && { flushes: dayFlushes } };
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
      let previous = -Infinity;
      for (const other of records) {
        const otherMs = Date.parse(other.ts);
        if (other.sessionId === record.sessionId && otherMs < ms && otherMs > previous)
          previous = otherMs;
      }
      if (ms - previous > CACHE_LIFETIME_MS[cause] && previous > -Infinity)
        outlier.pauseMs = ms - previous;
    }
    return outlier;
  });

  return { bins, outlierCount: expensive.length, outliers };
}

function upgradesOf(records: readonly UsageRecord[], localTime: ReturnType<typeof localTimeOf>, chartFrom: string): Activity['upgrades'] {
  const versioned = records.filter(r => r.version).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const byDay = new Map<string, string>();
  let highest: string | undefined;
  for (const record of versioned) {
    if (highest && compareVersions(record.version!, highest) > 0)
      byDay.set(localTime(Date.parse(record.ts)).day, record.version!);
    if (!highest || compareVersions(record.version!, highest) > 0)
      highest = record.version;
  }
  return [...byDay].filter(([day]) => day >= chartFrom).map(([day, version]) => ({ day, version }));
}

/** Heatmap, cache use, message costs and Claude Code upgrades. */
export function buildActivity({ chartFrom, events = [], now, records, timeZone, weekStart }: ActivityInput): Activity {
  const localTime = localTimeOf(timeZone);
  const week = records.filter(r => Date.parse(r.ts) >= weekStart);
  return {
    cache: cacheOf(week, records, detectFlushes(records, events), localTime, now),
    heatmap: heatmapOf(records, localTime, now),
    messageCost: messageCostOf(week, records),
    upgrades: upgradesOf(records, localTime, chartFrom),
  };
}
