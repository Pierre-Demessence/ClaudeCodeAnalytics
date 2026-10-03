import type { Snapshot, UsageRecord } from './types.ts';

import { dayKey, startOfDay } from './aggregate.ts';
import { sessionProjects } from './breakdown.ts';
import { DAY_MS, FIVE_HOURS_MS } from './calibration.ts';
import { messageCost } from './pricing.ts';
import { median } from './stats.ts';

/** 5-hour % from which a window counts as spent: a new agent run would stop almost at once. */
export const DEFAULT_LIMIT_THRESHOLD = 95;
/** Local days shown, today included. */
const SESSION_DAYS = 7;

export interface FiveHourWindow {
  /** A reading in the window reached the limit threshold. */
  capped?: true;
  cost: number;
  /** ISO; for a window still running, its future end. */
  end: string;
  inProgress?: true;
  messages: number;
  /** Highest 5-hour % read in the window, or `k × cost` when `peakEstimated`. */
  peak?: number;
  peakEstimated?: true;
  /** By cost, highest first. */
  projects: { name: string; path: string; cost: number }[];
  /** `reading`: placed by a reading's reset time; `estimated`: opened by the first message after the previous window. */
  source: 'reading' | 'estimated';
  /** ISO. */
  start: string;
}

export interface Sessions {
  /** The local days shown, newest first. */
  days: string[];
  /** Medians leave out the window in progress; the cost median also leaves out windows without Claude Code messages. */
  stats: { capped: number; count: number; medianCost?: number; medianPeak?: number };
  /** Windows overlapping `days`, newest first. */
  windows: FiveHourWindow[];
}

export interface SessionsInput {
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
  source: FiveHourWindow['source'];
  start: number;
}

function newWindow(start: number, end: number, source: Building['source']): Building {
  return { cost: 0, end, messages: 0, projects: new Map(), source, start };
}

/** `SessionsInput` without the time zone: `fiveHourWindows` is not cut to the last 7 local days. */
export type FiveHourWindowsInput = Omit<SessionsInput, 'timeZone'>;

/**
 * Every 5-hour window since the first reading or message, newest first.
 * Readings place their windows exactly (`fiveHourResetsAt` − 5 h); messages
 * outside them open estimated windows, as `sessionCosts` does, cut short where
 * a reading window starts.
 */
export function fiveHourWindows({ k, limitThreshold, now, records, snapshots }: FiveHourWindowsInput): FiveHourWindow[] {
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
    window.messages++;
  }

  return windows
    .filter(w => w.start <= now)
    .sort((a, b) => b.start - a.start)
    .map((w): FiveHourWindow => {
      const peak = w.source === 'reading' ? w.peak : k !== undefined ? Math.min(100, k * w.cost) : undefined;
      return {
        capped: w.source === 'reading' && peak !== undefined && peak >= limitThreshold ? true : undefined,
        cost: w.cost,
        end: new Date(w.end).toISOString(),
        inProgress: now < w.end ? true : undefined,
        messages: w.messages,
        peak,
        peakEstimated: w.source === 'estimated' && peak !== undefined ? true : undefined,
        projects: [...w.projects.values()].sort((a, b) => b.cost - a.cost),
        source: w.source,
        start: new Date(w.start).toISOString(),
      };
    });
}

/** The 5-hour windows of the last 7 local days. */
export function buildSessions({ timeZone, ...input }: SessionsInput): Sessions {
  // Step through calendar days at UTC noon so DST never skips or repeats a day.
  const today = Date.parse(`${dayKey(input.now, timeZone)}T12:00:00Z`);
  const days = Array.from({ length: SESSION_DAYS }, (_, i) => new Date(today - i * DAY_MS).toISOString().slice(0, 10));
  const from = startOfDay(days.at(-1)!, timeZone);
  const shown = fiveHourWindows(input).filter(w => Date.parse(w.end) > from);

  const done = shown.filter(w => !w.inProgress);
  return {
    days,
    windows: shown,
    stats: {
      capped: shown.filter(w => w.capped).length,
      count: shown.length,
      medianCost: median(done.filter(w => w.messages > 0).map(w => w.cost)),
      medianPeak: median(done.filter(w => w.source === 'reading' && w.peak !== undefined).map(w => w.peak!)),
    },
  };
}
