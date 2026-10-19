import { describe, expect, it } from 'vitest';

import type { SummaryInput } from './summary.ts';
import type { Snapshot, UsageRecord } from './types.ts';

import { startOfDay } from './aggregate.ts';
import { DAY_MS, WEEK_MS } from './calibration.ts';
import { addDays } from './range.ts';
import { buildRanged } from './ranged.ts';
import { buildSummary } from './summary.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const RESET = '2026-10-21T20:00:00.000Z';
const WEEK_START = Date.parse(RESET) - WEEK_MS;
const TODAY = '2026-10-20';
const END_OF_TODAY = startOfDay(addDays(TODAY, 1), 'UTC');

/** $20 of Opus 5.5 output, in a conversation per day. */
function rec(ts: number, extra: Partial<UsageRecord> = {}): UsageRecord {
  const day = new Date(ts).toISOString().slice(0, 10);
  return { cacheRead: 100, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\app', input: 50, key: `${ts}`, model: 'claude-opus-5-5', output: 1_000_000, project: 'p', sessionId: day, ts: new Date(ts).toISOString(), version: '2.0.0', ...extra };
}

function snap(ts: number, weekly: number, weeklyResetsAt: string, extra: Partial<Snapshot> = {}): Snapshot {
  return { source: 'endpoint', ts: new Date(ts).toISOString(), weekly, weeklyResetsAt, ...extra };
}

/** Ninety days of one message a day, readings for the last 3 weeks, and a few 5-hour readings. */
const input: SummaryInput = {
  endpointEnabled: true,
  now: NOW,
  planHistory: [],
  records: Array.from({ length: 90 }, (_, i) => rec(NOW - (i + 1) * DAY_MS)),
  timeZone: 'UTC',
  titles: { '2026-10-19': { title: 'Yesterday' } },
  snapshots: [
    snap(WEEK_START + 2 * DAY_MS, 30, RESET, { fiveHour: 40, fiveHourResetsAt: '2026-10-18T15:00:00.000Z' }),
    snap(WEEK_START - 5 * DAY_MS, 60, new Date(WEEK_START).toISOString()),
    snap(WEEK_START - 12 * DAY_MS, 50, new Date(WEEK_START - WEEK_MS).toISOString()),
  ],
};
const summary = buildSummary(input);
const rangedOver = (from: number, to: number) => buildRanged(input, { from, to });

describe('buildRanged on the default windows', () => {
  it('gives the Breakdown of the current weekly window', () => {
    expect(rangedOver(WEEK_START, WEEK_START + WEEK_MS).breakdown).toEqual(summary.breakdown);
  });

  it('gives the 7-day Sessions', () => {
    expect(rangedOver(startOfDay('2026-10-14', 'UTC'), END_OF_TODAY).sessions).toEqual(summary.sessions);
  });

  it('gives the last 12 weeks of the Weeks tab', () => {
    const weeks = summary.weekHistory.weeks;
    expect(weeks).toHaveLength(12);
    expect(rangedOver(Date.parse(weeks.at(-1)!.start), END_OF_TODAY).weekHistory).toEqual(summary.weekHistory);
  });

  it('gives the 35 days of the daily chart', () => {
    const range = rangedOver(startOfDay('2026-09-16', 'UTC'), END_OF_TODAY);
    expect(range.usage.day).toEqual(summary.daily);
    expect(range.activity.upgrades).toEqual(summary.activity.upgrades);
  });

  it('gives the heatmap, the cache chart and the message costs of the activity', () => {
    expect(rangedOver(startOfDay('2026-09-23', 'UTC'), END_OF_TODAY).activity.heatmap).toEqual(summary.activity.heatmap);
    expect(rangedOver(startOfDay('2026-10-07', 'UTC'), END_OF_TODAY).activity.cache.daily).toEqual(summary.activity.cache.daily);
    const week = rangedOver(WEEK_START, WEEK_START + WEEK_MS).activity;
    expect(week.messageCost).toEqual(summary.activity.messageCost);
    expect(week.cache.week).toEqual(summary.activity.cache.week);
  });
});

describe('buildRanged over a past range', () => {
  const september = rangedOver(startOfDay('2026-09-01', 'UTC'), startOfDay('2026-10-01', 'UTC'));

  it('counts only the range\'s messages everywhere', () => {
    expect(september.breakdown.total.messages).toBe(30);
    expect(september.breakdown.total.cost).toBeCloseTo(600, 1);
    expect(september.usage.day!.reduce((sum, row) => sum + row.messages, 0)).toBe(30);
    expect(september.weekHistory.weeks.every(w => Date.parse(w.start) >= Date.parse('2026-09-01T00:00:00Z'))).toBe(true);
    expect(september.sessions.windows.every(w => w.start >= '2026-09-01' && w.start < '2026-10-01')).toBe(true);
  });

  it('echoes the range', () => {
    expect(september.range).toEqual({ from: startOfDay('2026-09-01', 'UTC'), to: startOfDay('2026-10-01', 'UTC') });
  });

  it('buckets a long range by weekly window and leaves out the daily rows', () => {
    const long = rangedOver(startOfDay('2026-07-01', 'UTC'), END_OF_TODAY);
    expect(long.usage.day).toBeUndefined();
    expect(long.usage.week.length).toBeGreaterThan(10);
    expect(long.activity.cache.bucket).toBe('week');
    expect(september.activity.cache.bucket).toBe('day');
  });

  it('is empty for a range before the first message', () => {
    const empty = rangedOver(startOfDay('2025-01-01', 'UTC'), startOfDay('2025-02-01', 'UTC'));
    expect(empty.breakdown.total).toEqual({ cost: 0, messages: 0 });
    expect(empty.usage.day).toEqual([]);
    expect(empty.sessions.windows).toEqual([]);
    expect(empty.weekHistory.weeks).toEqual([]);
    expect(empty.activity.messageCost.bins.every(n => n === 0)).toBe(true);
  });

  it('shows the same weekly percent as the summary for a week it holds', () => {
    const lastWeek = summary.weekHistory.weeks.find(w => !w.inProgress && w.percent !== undefined)!;
    const week = rangedOver(Date.parse(lastWeek.start), Date.parse(lastWeek.end)).weekHistory.weeks;
    expect(week).toEqual([lastWeek]);
  });
});

describe('buildRanged across a DST change', () => {
  // Paris springs forward on 2026-03-29: the local day of the 29th lasts 23 hours.
  const paris: SummaryInput = {
    ...input,
    now: Date.parse('2026-04-02T12:00:00Z'),
    records: Array.from({ length: 10 }, (_, i) => rec(Date.parse('2026-03-25T12:00:00Z') + i * DAY_MS)),
    snapshots: [],
    timeZone: 'Europe/Paris',
  };

  it('counts each message once, on its local day', () => {
    const ranged = buildRanged(paris, { from: startOfDay('2026-03-27', 'Europe/Paris'), to: startOfDay('2026-03-31', 'Europe/Paris') });
    expect(ranged.usage.day!.map(row => [row.bucket, row.messages])).toEqual([['2026-03-27', 1], ['2026-03-28', 1], ['2026-03-29', 1], ['2026-03-30', 1]]);
    expect(ranged.breakdown.total.messages).toBe(4);
  });
});
