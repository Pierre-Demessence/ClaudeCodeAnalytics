import type { Range } from './range.ts';
import type { PartPercent } from './restarts.ts';
import type { FiveHourWindow } from './sessions.ts';
import type { WeekShare } from './share.ts';
import type { ApiEvent, Plan, PlanPeriod, Snapshot, UsageRecord } from './types.ts';

import { sessionProjects } from './breakdown.ts';
import { DAY_MS, WEEK_MS } from './calibration.ts';
import { convertPercent, planAt, planChangeWithin } from './plans.ts';
import { messageCost, sonnetSaving } from './pricing.ts';
import { median } from './stats.ts';

/** Weekly % from which a week counts as having hit the limit: at 5 % of the week left, a run is not stopped at once, but the week is as good as spent. */
export const DEFAULT_WEEK_LIMIT_THRESHOLD = 98;
/** Weekly % (of the limit of the plan active then) from which the user is held back by the approaching limit: what happens after it no longer shows the demand. */
export const PRESSURE_PERCENT = 90;
/** Weekly windows listed. */
const HISTORY_WEEKS = 12;
/** Projects kept per week; `projectCount` has the total. */
const TOP_PROJECTS = 5;

/** One part of a window whose usage restarted: the time between two restarts. */
export interface WeekPart {
  /** ISO. */
  end: string;
  /** The part's final %, on the current plan. */
  percent: number;
  /** Not a final reading: no reading in the part, extended from an early one, or estimated now. */
  percentEstimated?: true;
  plan: Plan;
  /** The part's final %, on its own plan. */
  planPercent: number;
  /** ISO; the first reading of the part at `PRESSURE_PERCENT` of its own plan. Absent for the window in progress. */
  pressureAt?: string;
  /** The weekly % at `pressureAt`, on the current plan. */
  pressurePercent?: number;
  /** ISO. */
  start: string;
}

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
  /** The parts of a window whose usage restarted (an upgrade, a free reset), oldest first; their % add up to `percent`. */
  parts?: WeekPart[];
  /** Final weekly %, on the current plan; for a restarted window, the parts added up. */
  percent?: number;
  /** Not a final reading: extended from an early one, estimated now, or from transcripts. */
  percentEstimated?: true;
  /**
   * The plan whose limit `planPercent` is a % of: the plan of the last reading (the current plan for the window in
   * progress), or the plan a week estimated from transcripts started on. Absent for a restarted window: its parts have theirs.
   */
  plan?: Plan;
  /** A plan change started inside the window, which keeps its 7 days; shown as such (the % adds the parts up). */
  planChange?: true;
  /** Final weekly %, on `plan`: what the Weeks tab shows, a Pro week at its limit as 100%. */
  planPercent?: number;
  /** ISO; the first reading of the week at `PRESSURE_PERCENT`, or for a week estimated from transcripts the message at which `k × cost so far` reaches it. */
  pressureAt?: string;
  /** The weekly % at `pressureAt`, on the current plan. */
  pressurePercent?: number;
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
  /** ISO; the oldest imported message, for a week estimated from transcripts that started before it: the time before it is unseen. */
  transcriptsFrom?: string;
}

export interface WeekHistory {
  /** Medians leave out the window in progress; the cost median also leaves out windows without Claude Code messages. */
  stats: { blocked: number; hit: number; medianCost?: number; medianPercent?: number };
  /** The windows starting in the range, or the last 12 without one; newest first. */
  weeks: WeekRow[];
}

export interface WeekHistoryInput {
  /** Rate-limit hits of the weekly kind, merged as `dedupeHits` does. */
  hits?: readonly ApiEvent[];
  /** % of the weekly limit per dollar, when calibrated. */
  calibrationK?: number;
  /** The weekly window now, as in `CurrentWeek`. */
  current?: { estimatedNow?: number; parts?: readonly PartPercent[]; resetsAt: string; weekly: number; withoutReading?: true };
  now: number;
  /** The plan the percents are shown on. */
  plan: Plan;
  /** Marks the windows holding a plan change. */
  planHistory: readonly PlanPeriod[];
  /** Lists the windows that start in it, without a cap; without one, the last 12. */
  range?: Range;
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
  /** Time and cost of each message. */
  spend: { cost: number; ms: number }[];
}

/** The message at which `k × cost so far` reaches `PRESSURE_PERCENT`. */
function pressureByCost(spend: readonly { cost: number; ms: number }[], k: number): { at: string; percent: number } | undefined {
  let total = 0;
  for (const { cost, ms } of [...spend].sort((a, b) => a.ms - b.ms)) {
    total += cost;
    if (k * total >= PRESSURE_PERCENT)
      return { at: new Date(ms).toISOString(), percent: Math.min(100, k * total) };
  }
  return undefined;
}

const sumOnPlan = (parts: readonly PartPercent[], plan: Plan) => parts.reduce((sum, part) => sum + convertPercent(part.percent, part.plan, plan), 0);

/**
 * Whether a week hit the limit: its final reading is not an estimate and reaches the threshold on the plan it
 * was read on (`planPercent`). A restarted window hits when any part ended on a reading at the threshold of its own plan.
 */
function hitOf(parts: readonly WeekPart[] | undefined, planPercent: number | undefined, estimated: boolean, threshold: number): boolean {
  if (parts)
    return parts.some(part => !part.percentEstimated && part.planPercent >= threshold);
  return !estimated && planPercent !== undefined && planPercent >= threshold;
}

/** The weekly windows starting in a range, or the last 12: final %, cost per day, sessions and projects. */
export function buildWeekHistory(input: WeekHistoryInput): WeekHistory {
  const { calibrationK, current, hits = [], now, plan, planHistory, range, records, sessionWindows, shares, snapshots, weekLimitThreshold, weekStartOf } = input;

  const starts = new Set<number>(snapshots.map(s => Date.parse(s.weeklyResetsAt) - WEEK_MS));
  if (current)
    starts.add(Date.parse(current.resetsAt) - WEEK_MS);
  const recordStarts = records.map(record => ({ record, start: weekStartOf(Date.parse(record.ts)) }));
  for (const { start } of recordStarts)
    starts.add(start);
  // Claude Code deletes old transcripts: a week estimated from them is unseen before the oldest one.
  // A loop, not Math.min(...): spreading a year of records overflows the call stack.
  let firstMessage = Infinity;
  for (const record of records)
    firstMessage = Math.min(firstMessage, Date.parse(record.ts));
  const ordered = [...starts].sort((a, b) => b - a);
  const shown = range ? ordered.filter(start => start >= range.from && start < range.to) : ordered.slice(0, HISTORY_WEEKS);

  const building = new Map<number, Building>(shown.map(start => [start, { cost: 0, days: Array.from<number>({ length: 7 }).fill(0), messages: 0, projects: new Map(), saving: 0, spend: [] }]));
  const projectOf = sessionProjects(records);
  for (const { record, start } of recordStarts) {
    const week = building.get(start);
    if (!week)
      continue;
    const cost = messageCost(record).cost;
    week.cost += cost;
    week.saving += sonnetSaving(record);
    week.messages++;
    week.spend.push({ cost, ms: Date.parse(record.ts) });
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
    // The final % on the plan the week was read on: what its limit is judged against.
    let planPercent: number | undefined;
    let ownPlan: Plan | undefined;
    let percentEstimated = false;
    let source: WeekRow['source'] = 'reading';
    let pressure: { at: string; percent: number } | undefined;
    let partsOf: readonly PartPercent[] | undefined;
    let completed = false;
    let transcriptsFrom: string | undefined;
    const share = shares.find(s => Date.parse(s.resetsAt) === end);
    if (current && Date.parse(current.resetsAt) === end) {
      percent = current.estimatedNow ?? current.weekly;
      planPercent = percent;
      ownPlan = plan;
      percentEstimated = current.estimatedNow !== undefined || current.withoutReading === true;
      partsOf = current.parts;
      if (current.parts)
        percent = sumOnPlan(current.parts, plan);
      if (current.withoutReading)
        source = 'estimated';
    }
    else if (share) {
      percent = convertPercent(share.percent, share.plan, plan);
      planPercent = share.percent;
      ownPlan = share.plan;
      percentEstimated = share.estimated;
      partsOf = share.parts;
      completed = true;
      const reached = snapshots
        .filter(s => Date.parse(s.weeklyResetsAt) === end && s.weekly >= PRESSURE_PERCENT)
        .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))[0];
      pressure = reached && { at: reached.ts, percent: convertPercent(reached.weekly, share.plan, plan) };
    }
    else if (calibrationK !== undefined && week.cost > 0) {
      // `calibrationK` is a % of the current plan per dollar; the week's limit and its pressure point are on the
      // plan it ran on. Without readings it has no parts: that is the plan it started on (`plan` without a history).
      const ranOn = planHistory.length > 0 ? planAt(planHistory, new Date(start).toISOString()) : plan;
      const k = convertPercent(calibrationK, plan, ranOn);
      planPercent = Math.min(100, k * week.cost);
      ownPlan = ranOn;
      percent = convertPercent(planPercent, ranOn, plan);
      percentEstimated = true;
      source = 'estimated';
      const reached = pressureByCost(week.spend, k);
      pressure = reached && { at: reached.at, percent: convertPercent(reached.percent, ranOn, plan) };
      if (start < firstMessage)
        transcriptsFrom = new Date(firstMessage).toISOString();
    }

    const parts = partsOf?.map((part, i): WeekPart => {
      const partStart = Date.parse(part.start);
      const partEnd = partsOf[i + 1] ? Date.parse(partsOf[i + 1]!.start) : end;
      // The window in progress has no pressure point: it is still going.
      const reached = !completed
        ? undefined
        : snapshots
          .filter(s => Date.parse(s.weeklyResetsAt) === end && Date.parse(s.ts) >= partStart && Date.parse(s.ts) < partEnd && s.weekly >= PRESSURE_PERCENT)
          .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))[0];
      return {
        end: new Date(partEnd).toISOString(),
        percent: convertPercent(part.percent, part.plan, plan),
        percentEstimated: part.estimated,
        plan: part.plan,
        planPercent: part.percent,
        pressureAt: reached?.ts,
        pressurePercent: reached && convertPercent(reached.weekly, part.plan, plan),
        start: part.start,
      };
    });
    if (parts) {
      const first = parts.find(part => part.pressureAt !== undefined);
      pressure = first && { at: first.pressureAt!, percent: first.pressurePercent! };
      percentEstimated ||= parts.some(part => part.percentEstimated);
    }

    const weekHits = hits.map(hit => hit.ts).filter(ts => Date.parse(ts) >= start && Date.parse(ts) < end);

    return {
      blockedSessions: windows.filter(w => w.limitHits).length,
      cappedSessions: windows.filter(w => w.capped).length,
      cost: week.cost,
      days: week.days.map((cost, i) => (start + i * DAY_MS > now ? null : cost)),
      end: new Date(end).toISOString(),
      hit: source === 'reading' && hitOf(parts, planPercent, percentEstimated, weekLimitThreshold) ? true : undefined,
      inProgress: inProgress ? true : undefined,
      limitHits: weekHits.length > 0 ? weekHits : undefined,
      messages: week.messages,
      parts,
      percent,
      percentEstimated: percentEstimated ? true : undefined,
      plan: parts ? undefined : ownPlan,
      planChange: planChangeWithin(planHistory, start, end) || undefined,
      planPercent: parts ? undefined : planPercent,
      pressureAt: pressure?.at,
      pressurePercent: pressure?.percent,
      projectCount: projects.length,
      projects: projects.slice(0, TOP_PROJECTS),
      sessions: windows.length,
      shift: week.cost > 0 ? week.saving / week.cost : undefined,
      source,
      start: new Date(start).toISOString(),
      transcriptsFrom,
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
