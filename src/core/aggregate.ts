import type { UsageRecord } from './types.ts';

import { messageCost } from './pricing.ts';

export interface UsageRow {
  bucket: string;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  input: number;
  messages: number;
  model: string;
  output: number;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dayKey(ms: number, timeZone: string): string {
  let format = dayFormats.get(timeZone);
  if (!format) {
    // en-CA formats dates as YYYY-MM-DD.
    format = new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone, year: 'numeric' });
    dayFormats.set(timeZone, format);
  }
  return format.format(ms);
}

/** First instant of a local day (`YYYY-MM-DD`) in a time zone. */
export function startOfDay(day: string, timeZone: string): number {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', { day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', month: '2-digit', timeZone, year: 'numeric' }).formatToParts(utcMidnight);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const wallClock = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:00Z`);
  return utcMidnight - (wallClock - utcMidnight);
}

/** Totals per (bucket, model), sorted by bucket then model. */
export function aggregate(records: readonly UsageRecord[], bucketOf: (ms: number) => string): UsageRow[] {
  const rows = new Map<string, UsageRow>();
  for (const record of records) {
    const bucket = bucketOf(Date.parse(record.ts));
    const id = `${bucket}\u0000${record.model}`;
    let row = rows.get(id);
    if (!row) {
      row = { bucket, cacheRead: 0, cacheWrite: 0, cost: 0, input: 0, messages: 0, model: record.model, output: 0 };
      rows.set(id, row);
    }
    row.cost += messageCost(record).cost;
    row.input += record.input;
    row.output += record.output;
    row.cacheWrite += record.cacheWrite5m + record.cacheWrite1h;
    row.cacheRead += record.cacheRead;
    row.messages++;
  }
  return [...rows.values()].sort((a, b) => a.bucket.localeCompare(b.bucket) || a.model.localeCompare(b.model));
}

/** Returns a function giving the total cost of records with `from <= ts < to`. */
export function createCostIndex(records: readonly UsageRecord[]): (from: number, to: number) => number {
  const points = records.map(r => ({ cost: messageCost(r).cost, ms: Date.parse(r.ts) })).sort((a, b) => a.ms - b.ms);
  const times = points.map(p => p.ms);
  const cumulative = [0];
  for (const point of points)
    cumulative.push(cumulative.at(-1)! + point.cost);

  // Index of the first time >= ms.
  const lowerBound = (ms: number) => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! < ms)
        lo = mid + 1;
      else
        hi = mid;
    }
    return lo;
  };

  return (from, to) => (to <= from ? 0 : cumulative[lowerBound(to)]! - cumulative[lowerBound(from)]!);
}

/** Cost per local day from `fromDay` to `toDay` inclusive, zero-filled. */
export function dailyCostSeries(records: readonly UsageRecord[], timeZone: string, fromDay: string, toDay: string): { day: string; cost: number }[] {
  const totals = new Map<string, number>();
  for (const record of records) {
    const day = dayKey(Date.parse(record.ts), timeZone);
    totals.set(day, (totals.get(day) ?? 0) + messageCost(record).cost);
  }
  const series: { day: string; cost: number }[] = [];
  // Step through calendar days at UTC noon so DST never skips or repeats a day.
  for (let ms = Date.parse(`${fromDay}T12:00:00Z`); ; ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10);
    if (day > toDay)
      break;
    series.push({ cost: totals.get(day) ?? 0, day });
  }
  return series;
}

/**
 * Cost of each 5-hour session that started at or after `from` and ended by
 * `to`, rebuilt from message times: a session opens at the first message after
 * the previous one closed. claude.ai also opens sessions and transcripts miss
 * it, so the boundaries are approximate.
 */
export function sessionCosts(records: readonly UsageRecord[], from: number, to: number, sessionMs: number): number[] {
  const points = records.map(r => ({ cost: messageCost(r).cost, ms: Date.parse(r.ts) })).sort((a, b) => a.ms - b.ms);
  const sessions: { cost: number; start: number }[] = [];
  for (const point of points) {
    const last = sessions.at(-1);
    if (last && point.ms < last.start + sessionMs)
      last.cost += point.cost;
    else
      sessions.push({ cost: point.cost, start: point.ms });
  }
  return sessions.filter(s => s.start >= from && s.start + sessionMs <= to).map(s => s.cost);
}
