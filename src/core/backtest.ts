import type { WindowForecast } from './forecast.ts';
import type { DashboardSummary, SummaryInput } from './summary.ts';
import type { PlanPeriod, Snapshot, UsageRecord } from './types.ts';

import { FIVE_HOURS_MS, HOUR_MS, WEEK_MS } from './calibration.ts';
import { FINAL_READING_MS } from './share.ts';
import { median } from './stats.ts';
import { buildSummary } from './summary.ts';

/** Replay an instant every 6 hours: often enough to see a week's trajectory, rare enough to stay fast. */
const DEFAULT_STEP_MS = 6 * HOUR_MS;
const DEFAULT_WEEKS = 8;
/** A 5-hour window whose last reading is this close to its reset needs no check for later messages. */
const FIVE_HOUR_FINAL_MS = 30 * 60_000;
/** Reset times from a replay can differ from the readings' by rounding. */
const RESET_TOLERANCE_MS = 2 * 60_000;
/** Past this share of the window left, a call counts as early. */
const EARLY_SHARE = 0.5;

export type WindowKind = 'fiveHour' | 'weekly';

/** One forecast made at one replayed instant, with what the window really ended at. */
export interface BacktestSample {
  at: number;
  /** Final %, as read at the end of the window. */
  final: number;
  high: number;
  kind: WindowKind;
  low: number;
  median: number;
  method: WindowForecast['method'];
  /** Share of the window left when the call was made. */
  remainingShare: number;
  resetsAt: number;
}

export interface BacktestScore {
  /** Share of finals inside [low, high]. */
  coverage: number;
  hit: { falseNegatives: number; falsePositives: number; truePositives: number };
  kind: WindowKind;
  /** `early`: more than half the window was left at the call. */
  lead: 'all' | 'early' | 'late';
  /** Median over samples of |projected median − final|, in % points, both capped at 100. */
  medianAbsError: number;
  method: WindowForecast['method'];
  /** Of the windows predicted to hit the limit, the share that did; absent when none were predicted. */
  precision?: number;
  /** Of the windows that hit the limit, the share predicted to; absent when none hit. */
  recall?: number;
  samples: number;
  /** Distinct windows behind the samples; samples of one window overlap heavily. */
  windows: number;
}

export interface BacktestReport {
  /** Windows that had a forecast but no usable final value. */
  leftOut: { fiveHour: number; weekly: number };
  scores: BacktestScore[];
}

export interface Thresholds {
  fiveHour: number;
  weekly: number;
}

/** `summarize` is the forecaster under test; the dashboard's `buildSummary` by default. */
export interface BacktestInput {
  /** 5-hour % from which a window counts as a limit hit. */
  limitThreshold: number;
  now: number;
  planHistory: readonly PlanPeriod[];
  records: readonly UsageRecord[];
  snapshots: readonly Snapshot[];
  stepMs?: number;
  timeZone: string;
  summarize?: (input: SummaryInput) => Pick<DashboardSummary, 'current' | 'fiveHourSession'>;
  /** Weekly % from which a week counts as a limit hit. */
  weekLimitThreshold: number;
  weeks?: number;
}

/** Final weekly % by reset time: the last reading of each completed window, when taken near its reset. */
export function weeklyFinals(snapshots: readonly Snapshot[], now: number): Map<number, number> {
  const last = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    const reset = Date.parse(snapshot.weeklyResetsAt);
    const known = last.get(reset);
    if (reset <= now && (!known || Date.parse(snapshot.ts) > Date.parse(known.ts)))
      last.set(reset, snapshot);
  }
  const finals = new Map<number, number>();
  for (const [reset, snapshot] of last) {
    if (reset - Date.parse(snapshot.ts) <= FINAL_READING_MS)
      finals.set(reset, snapshot.weekly);
  }
  return finals;
}

/** Index of the first value greater than `ms` in an ascending list. */
function upperBound(sorted: readonly number[], ms: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! <= ms)
      low = mid + 1;
    else
      high = mid;
  }
  return low;
}

/**
 * Final 5-hour % by reset time: the highest reading of each completed window.
 * Readings follow messages, so a window whose last reading is far from its
 * reset is final only if no message came after that reading.
 */
export function fiveHourFinals(snapshots: readonly Snapshot[], records: readonly UsageRecord[], now: number): Map<number, number> {
  const messageTimes = records.map(r => Date.parse(r.ts)).sort((a, b) => a - b);
  const windows = new Map<number, { last: number; peak: number }>();
  for (const snapshot of snapshots) {
    if (snapshot.fiveHour === undefined || !snapshot.fiveHourResetsAt)
      continue;
    const reset = Date.parse(snapshot.fiveHourResetsAt);
    if (reset > now)
      continue;
    const ts = Date.parse(snapshot.ts);
    const known = windows.get(reset);
    windows.set(reset, { last: Math.max(ts, known?.last ?? ts), peak: Math.max(snapshot.fiveHour, known?.peak ?? 0) });
  }
  const finals = new Map<number, number>();
  for (const [reset, { last, peak }] of windows) {
    const messageAfter = upperBound(messageTimes, last) < upperBound(messageTimes, reset);
    if (reset - last <= FIVE_HOUR_FINAL_MS || !messageAfter)
      finals.set(reset, peak);
  }
  return finals;
}

function finalFor(finals: ReadonlyMap<number, number>, resetsAt: number): number | undefined {
  const exact = finals.get(resetsAt);
  if (exact !== undefined)
    return exact;
  for (const [reset, value] of finals) {
    if (Math.abs(reset - resetsAt) <= RESET_TOLERANCE_MS)
      return value;
  }
  return undefined;
}

const cap = (percent: number) => Math.min(100, percent);

/** Scores per window kind, method and lead; groups without samples are left out. */
export function scoreSamples(samples: readonly BacktestSample[], thresholds: Thresholds): BacktestScore[] {
  const groups = new Map<string, { lead: BacktestScore['lead']; list: BacktestSample[] }>();
  const add = (key: string, lead: BacktestScore['lead'], sample: BacktestSample) => {
    const group = groups.get(key) ?? { lead, list: [] };
    group.list.push(sample);
    groups.set(key, group);
  };
  for (const sample of samples) {
    const base = `${sample.kind}|${sample.method}`;
    add(`${base}|all`, 'all', sample);
    const lead = sample.remainingShare > EARLY_SHARE ? 'early' : 'late';
    add(`${base}|${lead}`, lead, sample);
  }

  return [...groups.entries()].map(([key, { lead, list }]) => {
    const [kind, method] = key.split('|') as [WindowKind, WindowForecast['method']];
    const threshold = thresholds[kind];
    const hit = { falseNegatives: 0, falsePositives: 0, truePositives: 0 };
    let inRange = 0;
    for (const s of list) {
      if (cap(s.low) <= s.final && s.final <= cap(s.high))
        inRange++;
      const predicted = cap(s.median) >= threshold;
      const actual = s.final >= threshold;
      if (predicted && actual)
        hit.truePositives++;
      else if (predicted)
        hit.falsePositives++;
      else if (actual)
        hit.falseNegatives++;
    }
    const predictedHits = hit.truePositives + hit.falsePositives;
    const actualHits = hit.truePositives + hit.falseNegatives;
    return {
      coverage: inRange / list.length,
      hit,
      kind,
      lead,
      medianAbsError: median(list.map(s => Math.abs(cap(s.median) - s.final)))!,
      method,
      precision: predictedHits > 0 ? hit.truePositives / predictedHits : undefined,
      recall: actualHits > 0 ? hit.truePositives / actualHits : undefined,
      samples: list.length,
      windows: new Set(list.map(s => s.resetsAt)).size,
    };
  });
}

/**
 * Replays the forecast at past instants with only the data that existed then,
 * and scores it against how each window really ended. Read-only: nothing is
 * stored.
 */
export function runBacktest(input: BacktestInput): BacktestReport {
  const { now, planHistory, timeZone } = input;
  const summarize = input.summarize ?? buildSummary;
  const step = input.stepMs ?? DEFAULT_STEP_MS;
  const records = [...input.records].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const recordTimes = records.map(r => Date.parse(r.ts));
  const snapshots = [...input.snapshots].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const snapshotTimes = snapshots.map(s => Date.parse(s.ts));
  const weeklyTruth = weeklyFinals(snapshots, now);
  const fiveHourTruth = fiveHourFinals(snapshots, records, now);

  const samples: BacktestSample[] = [];
  const unresolved = { fiveHour: new Set<number>(), weekly: new Set<number>() };
  const record = (kind: WindowKind, at: number, resetsAt: number, windowMs: number, forecast: WindowForecast | undefined) => {
    // A window still running has no final value yet: not scored, not left out.
    if (!forecast || resetsAt <= at || resetsAt > now)
      return;
    const final = finalFor(kind === 'weekly' ? weeklyTruth : fiveHourTruth, resetsAt);
    if (final === undefined) {
      unresolved[kind].add(resetsAt);
      return;
    }
    samples.push({
      at,
      final,
      high: forecast.high,
      kind,
      low: forecast.low,
      median: forecast.median,
      method: forecast.method,
      remainingShare: (resetsAt - at) / windowMs,
      resetsAt,
    });
  };

  const weeks = input.weeks ?? DEFAULT_WEEKS;
  // Multiples of the step, not offsets from `now`: runs minutes apart then replay the same instants and stay comparable.
  for (let at = Math.ceil((now - weeks * WEEK_MS) / step) * step; at < now; at += step) {
    const summary = summarize({
      endpointEnabled: true,
      limitThreshold: input.limitThreshold,
      now: at,
      planHistory,
      records: records.slice(0, upperBound(recordTimes, at)),
      snapshots: snapshots.slice(0, upperBound(snapshotTimes, at)),
      timeZone,
      weekLimitThreshold: input.weekLimitThreshold,
    });
    const { current, fiveHourSession } = summary;
    if (current)
      record('weekly', at, Date.parse(current.resetsAt), WEEK_MS, current.forecast);
    if (fiveHourSession?.resetsAt)
      record('fiveHour', at, Date.parse(fiveHourSession.resetsAt), FIVE_HOURS_MS, fiveHourSession.forecast);
  }

  // A window resolved at one instant and not at another (reset jitter) is not left out.
  const resolved = new Set(samples.map(s => `${s.kind}|${s.resetsAt}`));
  const leftOut = (kind: WindowKind) => [...unresolved[kind]].filter(reset => !resolved.has(`${kind}|${reset}`)).length;
  return {
    leftOut: { fiveHour: leftOut('fiveHour'), weekly: leftOut('weekly') },
    scores: scoreSamples(samples, { fiveHour: input.limitThreshold, weekly: input.weekLimitThreshold }),
  };
}

const percent = (value: number | undefined) => (value === undefined ? 'n/a' : `${Math.round(value * 100)}%`);

/** The report as text, one line per score. */
export function formatReport({ leftOut, scores }: BacktestReport): string {
  if (scores.length === 0)
    return `No forecast could be scored (left out: ${leftOut.weekly} weekly, ${leftOut.fiveHour} 5-hour windows without a final value).`;
  const order = [...scores].sort((a, b) => a.kind.localeCompare(b.kind) || a.method.localeCompare(b.method) || a.lead.localeCompare(b.lead));
  const lines = order.map(s => [
    s.kind.padEnd(8),
    s.method.padEnd(10),
    s.lead.padEnd(5),
    `${String(s.windows).padStart(3)} windows`,
    `${String(s.samples).padStart(5)} samples`,
    `median error ${s.medianAbsError.toFixed(1)} pts`,
    `final in range ${percent(s.coverage)}`,
    `limit hit: precision ${percent(s.precision)}, recall ${percent(s.recall)}`,
    `(tp ${s.hit.truePositives}, fp ${s.hit.falsePositives}, fn ${s.hit.falseNegatives})`,
  ].join('  '));
  lines.push('', `Left out for lack of a final value: ${leftOut.weekly} weekly, ${leftOut.fiveHour} 5-hour windows.`);
  return lines.join('\n');
}
