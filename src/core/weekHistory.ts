import type { FiveHourWindow } from './sessions.ts';
import type { WeekShare } from './share.ts';
import type { ApiEvent, Plan, Snapshot, UsageRecord } from './types.ts';

import { sessionProjects } from './breakdown.ts';
import { DAY_MS, WEEK_MS } from './calibration.ts';
import { convertPercent } from './plans.ts';
import { messageCost, sonnetSaving } from './pricing.ts';
import { median } from './stats.ts';

/** Weekly % from which a week counts as having hit the limit: at 5 % of the week left, a run is not stopped at once, but the week is as good as spent. */
export const DEFAULT_WEEK_LIMIT_THRESHOLD = 98;
/** Weekly windows listed. */
const HISTORY_WEEKS = 12;
/** Projects kept per week; `projectCount` has the total. */
const TOP_PROJECTS = 5;

export interface WeekRow {
  /** 5-hour sessions started in the week that a rate limit seen in the transcripts blocked. */
  blockedSessions: number;
  /** 5-hour sessions started in the week that hit the limit threshold. */
  cappedSessions: number;
  cost: number;
  /** Cost of each 24 h block from `start`; null for a block that has not started. */
  days: (number | null)[];
  /** ISO. */
  end: string;
  /** The final reading, not an estimate, reached the weekly limit threshold. */
  hit?: true;
  inProgress?: true;
  /** ISO times of the weekly-limit hits seen in the transcripts during the week; absent without any. */
  limitHits?: string[];
  messages: number;
  /** Final weekly %, on the current plan. */
  percent?: number;
  /** Not a final reading: extended from an early one, estimated now, or from transcripts. */
  percentEstimated?: true;
  projectCount: number;
  /** By cost, highest first. */
  projects: { name: string; path: string; cost: number }[];
  sessions: number;
  /** Share of the cost saved if all Opus ran on Sonnet; absent without cost. */
  shift?: number;
  /** `estimated`: no reading in the window, the % comes from transcripts. */
  source: 'reading' | 'estimated';
  /** ISO. */
  start: string;
}

export interface WeekHistory {
  /** Medians leave out the window in progress; the cost median also leaves out windows without Claude Code messages. */
  stats: { blocked: number; hit: number; medianCost?: number; medianPercent?: number };
  /** The last 12 windows, newest first. */
  weeks: WeekRow[];
}

export interface WeekHistoryInput {
  /** Rate-limit hits of the weekly kind, merged as `dedupeHits` does. */
  hits?: readonly ApiEvent[];
  /** % of the weekly limit per dollar, when calibrated. */
  calibrationK?: number;
  /** The weekly window now, as in `CurrentWeek`. */
  current?: { estimatedNow?: number; resetsAt: string; weekly: number; withoutReading?: true };
  now: number;
  /** The plan the percents are shown on. */
  plan: Plan;
  records: readonly UsageRecord[];
  /** Every 5-hour window, as `fiveHourWindows` builds them. */
  sessionWindows: readonly FiveHourWindow[];
  /** Final % of every completed window with readings. */
  shares: readonly WeekShare[];
  snapshots: readonly Snapshot[];
  /** Weekly % from which a week counts as having hit the limit. */
  weekLimitThreshold: number;
  /** Start of the weekly window holding a time. */
  weekStartOf: (ms: number) => number;
}

interface Building {
  cost: number;
  days: number[];
  messages: number;
  projects: Map<string, { name: string; path: string; cost: number }>;
  saving: number;
}

/** The last 12 weekly windows: final %, cost per day, sessions and projects. */
export function buildWeekHistory(input: WeekHistoryInput): WeekHistory {
  const { calibrationK, current, hits = [], now, plan, records, sessionWindows, shares, snapshots, weekLimitThreshold, weekStartOf } = input;

  const starts = new Set<number>(snapshots.map(s => Date.parse(s.weeklyResetsAt) - WEEK_MS));
  if (current)
    starts.add(Date.parse(current.resetsAt) - WEEK_MS);
  const recordStarts = records.map(record => ({ record, start: weekStartOf(Date.parse(record.ts)) }));
  for (const { start } of recordStarts)
    starts.add(start);
  const shown = [...starts].sort((a, b) => b - a).slice(0, HISTORY_WEEKS);

  const building = new Map<number, Building>(shown.map(start => [start, { cost: 0, days: Array.from<number>({ length: 7 }).fill(0), messages: 0, projects: new Map(), saving: 0 }]));
  const projectOf = sessionProjects(records);
  for (const { record, start } of recordStarts) {
    const week = building.get(start);
    if (!week)
      continue;
    const cost = messageCost(record).cost;
    week.cost += cost;
    week.saving += sonnetSaving(record);
    week.messages++;
    const day = Math.min(6, Math.floor((Date.parse(record.ts) - start) / DAY_MS));
    week.days[day]! += cost;
    const project = projectOf(record);
    const entry = week.projects.get(project.path) ?? { ...project, cost: 0 };
    entry.cost += cost;
    week.projects.set(project.path, entry);
  }

  const rows = shown.map((start): WeekRow => {
    const end = start + WEEK_MS;
    const week = building.get(start)!;
    const inProgress = now < end;
    const windows = sessionWindows.filter(w => Date.parse(w.start) >= start && Date.parse(w.start) < end);
    const projects = [...week.projects.values()].sort((a, b) => b.cost - a.cost);

    let percent: number | undefined;
    let percentEstimated = false;
    let source: WeekRow['source'] = 'reading';
    const share = shares.find(s => Date.parse(s.resetsAt) === end);
    if (current && Date.parse(current.resetsAt) === end) {
      percent = current.estimatedNow ?? current.weekly;
      percentEstimated = current.estimatedNow !== undefined || current.withoutReading === true;
      if (current.withoutReading)
        source = 'estimated';
    }
    else if (share) {
      percent = convertPercent(share.percent, share.plan, plan);
      percentEstimated = share.estimated;
    }
    else if (calibrationK !== undefined && week.cost > 0) {
      percent = Math.min(100, calibrationK * week.cost);
      percentEstimated = true;
      source = 'estimated';
    }

    const weekHits = hits.map(hit => hit.ts).filter(ts => Date.parse(ts) >= start && Date.parse(ts) < end);

    return {
      blockedSessions: windows.filter(w => w.limitHits).length,
      cappedSessions: windows.filter(w => w.capped).length,
      cost: week.cost,
      days: week.days.map((cost, i) => (start + i * DAY_MS > now ? null : cost)),
      end: new Date(end).toISOString(),
      hit: source === 'reading' && !percentEstimated && percent !== undefined && percent >= weekLimitThreshold ? true : undefined,
      inProgress: inProgress ? true : undefined,
      limitHits: weekHits.length > 0 ? weekHits : undefined,
      messages: week.messages,
      percent,
      percentEstimated: percentEstimated ? true : undefined,
      projectCount: projects.length,
      projects: projects.slice(0, TOP_PROJECTS),
      sessions: windows.length,
      shift: week.cost > 0 ? week.saving / week.cost : undefined,
      source,
      start: new Date(start).toISOString(),
    };
  });

  const done = rows.filter(w => !w.inProgress);
  return {
    weeks: rows,
    stats: {
      blocked: rows.filter(w => w.blockedSessions > 0 || w.limitHits).length,
      hit: rows.filter(w => w.hit).length,
      medianCost: median(done.filter(w => w.messages > 0).map(w => w.cost)),
      medianPercent: median(done.filter(w => w.percent !== undefined).map(w => w.percent!)),
    },
  };
}
