import type { ApiEvent, Snapshot, UsageRecord } from './types.ts';

import { dayKey, startOfDay } from './aggregate.ts';
import { sessionProjects } from './breakdown.ts';
import { DAY_MS, FIVE_HOURS_MS, HOUR_MS } from './calibration.ts';
import { messageCost, sonnetSaving } from './pricing.ts';
import { median } from './stats.ts';

/** 5-hour % from which a window counts as spent: a new agent run would stop almost at once. */
export const DEFAULT_LIMIT_THRESHOLD = 95;
/** A window without Claude Code messages is shown from this 5-hour %: below it, stray usage from outside the transcripts. */
const MIN_UNTRACKED_PEAK = 5;
/** Local days shown, today included. */
const SESSION_DAYS = 7;
/** A hit's reset time matches a window's end within this margin: readings round ends to the minute. */
const RESET_MATCH_MS = 60_000;

export interface FiveHourWindow {
  /** A reading in the window reached the limit threshold. */
  capped?: true;
  cost: number;
  /** ISO; for a window still running, its future end. */
  end: string;
  inProgress?: true;
  /** ISO times of the rate-limit hits seen in the transcripts during the window; absent without any. */
  limitHits?: string[];
  messages: number;
  /** Highest 5-hour % read in the window, or `k × cost` when `peakEstimated`. */
  peak?: number;
  peakEstimated?: true;
  /** By cost, highest first. */
  projects: { name: string; path: string; cost: number }[];
  /** Share of the cost saved if all Opus ran on Sonnet; absent without cost. */
  shift?: number;
  /** `reading`: placed by a reading's reset time; `estimated`: opened by the first message after the previous window. */
  source: 'reading' | 'estimated';
  /** ISO. */
  start: string;
}

export interface Sessions {
  /** The local days shown, newest first: the last 7, plus tomorrow while the window in progress runs into it. */
  days: string[];
  /** Medians leave out the window in progress; the cost median also leaves out windows without Claude Code messages. */
  stats: { blocked: number; capped: number; count: number; medianCost?: number; medianPeak?: number };
  /** Windows overlapping `days`, newest first. */
  windows: FiveHourWindow[];
}

export interface SessionsInput {
  /** Rate-limit hits of the 5-hour kind, merged as `dedupeHits` does. */
  hits?: readonly ApiEvent[];
  /** % of the 5-hour limit per dollar, when calibrated. */
  k?: number;
  limitThreshold: number;
  now: number;
  records: readonly UsageRecord[];
  snapshots: readonly Snapshot[];
  timeZone: string;
}

interface Building {
  cost: number;
  end: number;
  messages: number;
  peak?: number;
  projects: Map<string, { name: string; path: string; cost: number }>;
  saving: number;
  source: FiveHourWindow['source'];
  start: number;
}

function newWindow(start: number, end: number, source: Building['source']): Building {
  return { cost: 0, end, messages: 0, projects: new Map(), saving: 0, source, start };
}

/** `SessionsInput` without the time zone: `fiveHourWindows` is not cut to the last 7 local days. */
export type FiveHourWindowsInput = Omit<SessionsInput, 'timeZone'>;

/** The window a hit belongs to: the one ending at its reset time, else the one holding its time. */
function windowOfHit(windows: readonly Building[], hit: ApiEvent): Building | undefined {
  const resetsAt = hit.resetsAt ? Date.parse(hit.resetsAt) : undefined;
  const ms = Date.parse(hit.ts);
  return (resetsAt === undefined ? undefined : windows.find(w => Math.abs(w.end - resetsAt) <= RESET_MATCH_MS))
    ?? windows.find(w => w.start <= ms && ms < w.end);
}

/**
 * Every 5-hour window since the first reading or message, newest first.
 * Readings place their windows exactly (`fiveHourResetsAt` − 5 h); messages
 * outside them open estimated windows (the first message after the previous window), cut short where
 * a reading window starts.
 */
export function fiveHourWindows({ hits = [], k, limitThreshold, now, records, snapshots }: FiveHourWindowsInput): FiveHourWindow[] {
  const anchored = new Map<number, Building>();
  for (const snapshot of snapshots) {
    if (!snapshot.fiveHourResetsAt)
      continue;
    const end = Date.parse(snapshot.fiveHourResetsAt);
    let window = anchored.get(end);
    if (!window) {
      window = newWindow(end - FIVE_HOURS_MS, end, 'reading');
      anchored.set(end, window);
    }
    if (snapshot.fiveHour !== undefined)
      window.peak = Math.max(window.peak ?? 0, snapshot.fiveHour);
  }
  const readingWindows = [...anchored.values()].sort((a, b) => a.start - b.start);

  const windows = [...readingWindows];
  const projectOf = sessionProjects(records);
  const sorted = records.map(record => ({ ms: Date.parse(record.ts), record })).sort((a, b) => a.ms - b.ms);
  let next = 0;
  let open: Building | undefined;
  for (const { ms, record } of sorted) {
    while (next < readingWindows.length && readingWindows[next]!.end <= ms)
      next++;
    const reading = readingWindows[next];
    let window: Building;
    if (reading && reading.start <= ms) {
      window = reading;
    }
    else if (open && ms < open.end) {
      window = open;
    }
    else {
      open = newWindow(ms, Math.min(ms + FIVE_HOURS_MS, reading?.start ?? Infinity), 'estimated');
      windows.push(open);
      window = open;
    }
    const cost = messageCost(record).cost;
    const project = projectOf(record);
    const entry = window.projects.get(project.path) ?? { ...project, cost: 0 };
    entry.cost += cost;
    window.projects.set(project.path, entry);
    window.cost += cost;
    window.saving += sonnetSaving(record);
    window.messages++;
  }

  const past = windows.filter(w => w.start <= now).sort((a, b) => b.start - a.start);
  const hitsOf = new Map<Building, string[]>();
  for (const hit of hits) {
    const window = windowOfHit(past, hit);
    if (window)
      hitsOf.set(window, [...hitsOf.get(window) ?? [], hit.ts]);
  }

  return past
    .map((w): FiveHourWindow => {
      const peak = w.source === 'reading' ? w.peak : k !== undefined ? Math.min(100, k * w.cost) : undefined;
      return {
        capped: w.source === 'reading' && peak !== undefined && peak >= limitThreshold ? true : undefined,
        cost: w.cost,
        end: new Date(w.end).toISOString(),
        inProgress: now < w.end ? true : undefined,
        limitHits: hitsOf.get(w),
        messages: w.messages,
        peak,
        peakEstimated: w.source === 'estimated' && peak !== undefined ? true : undefined,
        projects: [...w.projects.values()].sort((a, b) => b.cost - a.cost),
        shift: w.cost > 0 ? w.saving / w.cost : undefined,
        source: w.source,
        start: new Date(w.start).toISOString(),
      };
    });
}

/**
 * Average $/hour of each finished window that started at or after `from`, idle
 * time included (like the zero days of the daily series). Windows without
 * Claude Code messages are claude.ai use that transcripts cannot price.
 */
export function sessionPaces(windows: readonly FiveHourWindow[], from: number): number[] {
  return windows
    .filter(w => !w.inProgress && w.messages > 0 && Date.parse(w.start) >= from)
    .map(w => w.cost / (FIVE_HOURS_MS / HOUR_MS));
}

/** The 5-hour windows of the last 7 local days. */
export function buildSessions({ timeZone, ...input }: SessionsInput): Sessions {
  // Step through calendar days at UTC noon so DST never skips or repeats a day.
  const today = Date.parse(`${dayKey(input.now, timeZone)}T12:00:00Z`);
  const days = Array.from({ length: SESSION_DAYS }, (_, i) => new Date(today - i * DAY_MS).toISOString().slice(0, 10));
  const from = startOfDay(days.at(-1)!, timeZone);
  // Drop windows that are noise: no transcript message fell inside and the reading
  // shows little or no usage. A bigger reading without messages is claude.ai use.
  const shown = fiveHourWindows(input)
    .filter(w => Date.parse(w.end) > from)
    .filter(w => w.messages > 0 || (w.peak ?? 0) >= MIN_UNTRACKED_PEAK);

  const tomorrow = new Date(today + DAY_MS).toISOString().slice(0, 10);
  const runsIntoTomorrow = shown.some(w => w.inProgress && Date.parse(w.end) > startOfDay(tomorrow, timeZone));
  const done = shown.filter(w => !w.inProgress);
  return {
    days: runsIntoTomorrow ? [tomorrow, ...days] : days,
    windows: shown,
    stats: {
      blocked: shown.filter(w => w.limitHits).length,
      capped: shown.filter(w => w.capped).length,
      count: shown.length,
      medianCost: median(done.filter(w => w.messages > 0).map(w => w.cost)),
      medianPeak: median(done.filter(w => w.source === 'reading' && w.peak !== undefined).map(w => w.peak!)),
    },
  };
}
