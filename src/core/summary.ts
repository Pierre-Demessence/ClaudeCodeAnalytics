import type { FamilyActiveLeft } from './activePace.ts';
import type { Activity } from './activity.ts';
import type { UsageRow } from './aggregate.ts';
import type { Breakdown } from './breakdown.ts';
import type { Calibration } from './calibration.ts';
import type { Family } from './family.ts';
import type { WindowForecast } from './forecast.ts';
import type { Limits } from './limits.ts';
import type { ModelRatio } from './modelRatio.ts';
import type { MultiplierCheck } from './multipliers.ts';
import type { WeekPacing } from './pacing.ts';
import type { PlanFitInput } from './planFit.ts';
import type { Sessions } from './sessions.ts';
import type { WeekShare } from './share.ts';
import type { Plan, PlanPeriod, SessionInfo, Snapshot, UsageRecord } from './types.ts';
import type { WeekHistory } from './weekHistory.ts';

import { activeHourlyPace, activeLeftByFamily, activeTimeLeft } from './activePace.ts';
import { familyPaces } from './activeTime.ts';
import { buildActivity } from './activity.ts';
import { aggregate, createCostIndex, dailyCostSeries, dayKey, startOfDay } from './aggregate.ts';
import { buildBreakdown } from './breakdown.ts';
import { calibrationPoints, DAY_MS, fitRatio, FIVE_HOURS_MS, fiveHourCalibrationPoints, HOUR_MS, WEEK_MS } from './calibration.ts';
import { familyOf } from './family.ts';
import { forecastWindow } from './forecast.ts';
import { buildLimits } from './limits.ts';
import { modelRatios } from './modelRatio.ts';
import { buildMultipliers } from './multipliers.ts';
import { weekPacing } from './pacing.ts';
import { buildPlanFitInput } from './planFit.ts';
import { planAt, planFromSubscription } from './plans.ts';
import { priceFor } from './pricing.ts';
import { buildSessions, DEFAULT_LIMIT_THRESHOLD, fiveHourWindows, sessionPaces } from './sessions.ts';
import { typicalWeek, weeklyShares } from './share.ts';
import { buildWeekHistory, DEFAULT_WEEK_LIMIT_THRESHOLD } from './weekHistory.ts';

/** Days of daily cost and 5-hour sessions used as "typical" for forecasts. */
const TYPICAL_DAYS = 28;
/** Days shown in the daily usage chart. */
const DAILY_CHART_DAYS = 35;
/** Readings older than this get an estimated current % from transcripts. */
const STALE_READING_MS = 30 * 60_000;

export interface SummaryInput {
  endpointEnabled: boolean;
  /** 5-hour % from which a window counts as having hit the limit; 95 by default. */
  limitThreshold?: number;
  now: number;
  planHistory: readonly PlanPeriod[];
  records: readonly UsageRecord[];
  snapshots: readonly Snapshot[];
  /** Minutes between endpoint calls; 15 by default. */
  throttleMinutes?: number;
  timeZone: string;
  /** Conversation titles by session id. */
  titles?: Readonly<Record<string, SessionInfo>>;
  /** Weekly % from which a week counts as having hit the limit; 98 by default. */
  weekLimitThreshold?: number;
}

export type BreakdownPeriod = 'week' | 'fourWeeks' | 'all';

/** The 5-hour window of the latest reading, while that reading is still valid. */
export interface FiveHourSession {
  /** Active use (ms) left before the limit at the usual active pace; needs a 5-hour calibration. */
  activeLeftMs?: number;
  /** The same if only one model family were used, at that family's own pace. */
  activeLeftByFamily?: FamilyActiveLeft[];
  /** % now, estimated from usage since the reading. */
  estimatedNow?: number;
  forecast?: WindowForecast;
  /** % at the last reading. */
  percent: number;
  /** ISO time of the last reading. */
  readAt: string;
  /** ISO; absent for manual readings, whose window position is unknown. */
  resetsAt?: string;
}

export interface CurrentWeek {
  /** Active use (ms) left before the limit at the usual active pace; needs a calibration. */
  activeLeftMs?: number;
  /** The same if only one model family were used, at that family's own pace. */
  activeLeftByFamily?: FamilyActiveLeft[];
  /** Weekly % now, estimated from usage since a stale reading. */
  estimatedNow?: number;
  forecast?: WindowForecast;
  /** How the weekly % built up this week, and the daily budget left. */
  pacing: WeekPacing;
  /** ISO time of the last reading; from an earlier week when `withoutReading`. */
  readAt: string;
  resetsAt: string;
  source: Snapshot['source'];
  /** Weekly % at the last reading; 0 when `withoutReading`. */
  weekly: number;
  /** No reading yet in this window: it follows the last known reset, usage comes from transcripts. */
  withoutReading?: true;
}

export interface DashboardSummary {
  /** Heatmap, cache use, message costs (this weekly window) and Claude Code upgrades. */
  activity: Activity;
  /** Where the usage went: this weekly window, it and the 3 before, all time. */
  breakdown: Record<BreakdownPeriod, Breakdown>;
  calibration?: Calibration;
  /** The current weekly window, from its reading or, without one yet, from the last known reset. */
  current?: CurrentWeek;
  /** The model family of the latest message. */
  currentFamily?: Family;
  /** Usage per local day and model, for the last weeks. */
  daily: UsageRow[];
  /** The plan the latest reading reports, whether or not it is the active one. */
  detected?: Plan;
  /** A detected plan that differs from a manual setting. */
  detectedPlan?: Plan;
  endpointEnabled: boolean;
  /** % of the 5-hour limit per dollar. */
  fiveHourCalibration?: Calibration;
  /** The 5-hour window of the latest reading, whether or not the current week is known. */
  fiveHourSession?: FiveHourSession;
  generatedAt: string;
  /** 5-hour % from which a window counts as having hit the limit. */
  limitThreshold: number;
  /** Limit drift and the readings table. */
  limits: Limits;
  /** How many hours of a lighter model equal an hour of a heavier one, in the user's usage of the last 4 weeks. */
  modelRatios: ModelRatio[];
  /** Measured against advertised multipliers between neighbouring plans. */
  multipliers: MultiplierCheck[];
  plan: Plan;
  /** The last weeks and 5-hour sessions on the current plan, for the Plans tab. */
  planFit: PlanFitInput;
  planHistory: readonly PlanPeriod[];
  /** How the active plan period was set; absent without history. */
  planSource?: PlanPeriod['source'];
  /** Past 5-hour windows of the last 7 days. */
  sessions: Sessions;
  /** Minutes between endpoint calls. */
  throttleMinutes: number;
  timeZone: string;
  /** Models without a known price; their cost counts as zero. */
  unknownModels: string[];
  /** Usage per weekly window (bucket = window start, ISO) and model. */
  weekly: UsageRow[];
  /** The last 12 weekly windows: final %, cost per day, sessions and projects. */
  weekHistory: WeekHistory;
  /** Weekly % from which a week counts as having hit the limit. */
  weekLimitThreshold: number;
  /** Final % of every completed window with readings. */
  weeks: WeekShare[];
}

/** A 5-hour reading is stale once its window reset; manual readings have no reset time, so they last 5 hours. */
function fiveHourStillValid(snapshot: Snapshot, now: number): boolean {
  if (snapshot.fiveHourResetsAt)
    return Date.parse(snapshot.fiveHourResetsAt) > now;
  return now - Date.parse(snapshot.ts) < FIVE_HOURS_MS;
}

/** Window start containing `ms`, for windows anchored on `anchor` (a reset time). */
function windowStartOf(ms: number, anchor: number): number {
  return anchor + Math.floor((ms - anchor) / WEEK_MS) * WEEK_MS;
}

/**
 * Start of the weekly window holding `ms`, given the reset times seen in
 * readings (sorted). Uses the first reset after `ms`, so usage lands in the
 * same window as the readings grouped by that reset, even if Anthropic moves
 * the reset time; past the last reset, windows continue from it.
 */
export function weekStartFor(ms: number, resets: readonly number[]): number {
  const anchor = resets.find(reset => reset > ms) ?? resets.at(-1)!;
  return windowStartOf(ms, anchor);
}

/** Monday 00:00 local, as a fallback week start before any reading exists. */
function isoWeekStart(ms: number, timeZone: string): string {
  const day = dayKey(ms, timeZone);
  const date = new Date(`${day}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return dayKey(date.getTime() - offset * DAY_MS, 'UTC');
}

/** Everything the dashboard shows, computed from collector data. */
export function buildSummary(input: SummaryInput): DashboardSummary {
  const { now, planHistory, records, timeZone } = input;
  const snapshots = [...input.snapshots].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const nowIso = new Date(now).toISOString();
  const plan = planAt(planHistory, nowIso);
  const costBetween = createCostIndex(records);
  const latest = snapshots.at(-1);

  // A loop, not Math.min(...): spreading a year of records overflows the call stack.
  let first = now;
  for (const record of records)
    first = Math.min(first, Date.parse(record.ts));
  const firstDay = dayKey(first, timeZone);

  // Calibrate only on readings taken under the current plan.
  const planSnapshots = snapshots.filter(s => planAt(planHistory, s.ts) === plan);
  const calibration = fitRatio(calibrationPoints(planSnapshots, costBetween, first), now);
  const fiveHourCalibration = fitRatio(fiveHourCalibrationPoints(planSnapshots, costBetween, first), now);
  const yesterday = dayKey(now - DAY_MS, timeZone);
  const typicalFrom = [firstDay, dayKey(now - TYPICAL_DAYS * DAY_MS, timeZone)].sort().at(-1)!;
  const dailyCosts = typicalFrom <= yesterday
    ? dailyCostSeries(records, timeZone, typicalFrom, yesterday).map(d => d.cost)
    : [];
  const limitThreshold = input.limitThreshold ?? DEFAULT_LIMIT_THRESHOLD;
  const weekLimitThreshold = input.weekLimitThreshold ?? DEFAULT_WEEK_LIMIT_THRESHOLD;
  const sessionWindows = fiveHourWindows({ k: fiveHourCalibration?.k, limitThreshold, now, records, snapshots });
  const paceSamples = sessionPaces(sessionWindows, now - TYPICAL_DAYS * DAY_MS);
  const activePace = activeHourlyPace(records, now - TYPICAL_DAYS * DAY_MS, now);
  const paceByFamily = familyPaces(records, now - TYPICAL_DAYS * DAY_MS, now);
  // A loop, not Math.max(...): spreading a year of records overflows the call stack.
  let latestRecord: UsageRecord | undefined;
  for (const record of records) {
    if (!latestRecord || Date.parse(record.ts) > Date.parse(latestRecord.ts))
      latestRecord = record;
  }

  const weeks = weeklyShares(snapshots, costBetween, calibration && { k: calibration.k, plan }, planHistory, now);
  const typicalBase = typicalWeek(weeks, plan);

  let current: CurrentWeek | undefined;
  let fiveHourSession: FiveHourSession | undefined;
  if (latest) {
    const readAt = Date.parse(latest.ts);
    const fiveHour = fiveHourStillValid(latest, now) ? latest.fiveHour : undefined;
    if (fiveHour !== undefined) {
      fiveHourSession = { percent: fiveHour, readAt: latest.ts, resetsAt: latest.fiveHourResetsAt };
      // Without a reset time (manual readings), the window's position is unknown.
      if (latest.fiveHourResetsAt) {
        const k = fiveHourCalibration?.k;
        // A 5-hour window moves fast: always add the usage since the reading when calibrated.
        const sinceFiveHour = k !== undefined ? k * costBetween(readAt, now) : 0;
        fiveHourSession.estimatedNow = sinceFiveHour > 0 ? Math.min(100, fiveHour + sinceFiveHour) : undefined;
        fiveHourSession.forecast = forecastWindow({
          asOf: k !== undefined ? now : readAt,
          k,
          paceSamples,
          resetsAt: Date.parse(latest.fiveHourResetsAt),
          sampleMs: HOUR_MS,
          used: fiveHourSession.estimatedNow ?? fiveHour,
          windowMs: FIVE_HOURS_MS,
        });
      }
      const fiveHourUsed = fiveHourSession.estimatedNow ?? fiveHour;
      fiveHourSession.activeLeftMs = activeTimeLeft({ k: fiveHourCalibration?.k, pace: activePace, used: fiveHourUsed });
      fiveHourSession.activeLeftByFamily = activeLeftByFamily({ k: fiveHourCalibration?.k, paces: paceByFamily, used: fiveHourUsed });
    }

    const latestReset = Date.parse(latest.weeklyResetsAt);
    const withoutReading = latestReset <= now;
    // Weekly windows are fixed 7-day blocks: a week without a reading yet follows the last known reset.
    const resetsAt = withoutReading ? windowStartOf(now, latestReset) + WEEK_MS : latestReset;
    const windowFrom = resetsAt - WEEK_MS;

    let used: number | undefined;
    let estimatedNow: number | undefined;
    if (!withoutReading) {
      used = latest.weekly;
      // A stale reading misses the usage since; with a calibration, add it back from transcripts.
      const sinceReading = calibration ? calibration.k * costBetween(readAt, now) : 0;
      if (now - readAt > STALE_READING_MS && sinceReading > 0)
        estimatedNow = Math.min(100, latest.weekly + sinceReading);
    }
    else {
      // No Claude Code usage this week is a known 0 %; other usage needs a calibration to become a %.
      const sinceStart = costBetween(windowFrom, now);
      if (sinceStart === 0 || calibration)
        used = 0;
      if (sinceStart > 0 && calibration)
        estimatedNow = Math.min(100, calibration.k * sinceStart);
    }

    if (used !== undefined) {
      const week = {
        k: calibration?.k,
        paceSamples: dailyCosts,
        resetsAt,
        sampleMs: DAY_MS,
        typical: typicalBase && { high: typicalBase.high, low: typicalBase.low, median: typicalBase.median },
        windowMs: WEEK_MS,
      };
      const forecast = estimatedNow !== undefined || withoutReading
        // Uncalibrated, a week without a reading has no pace of its own (claude.ai use is unseen): project it from its start, i.e. the typical week.
        ? forecastWindow({ ...week, asOf: calibration || !withoutReading ? now : windowFrom, used: estimatedNow ?? used })
        : forecastWindow({ ...week, asOf: calibration ? now : readAt, used });

      const resetsAtIso = new Date(resetsAt).toISOString();
      current = {
        activeLeftByFamily: activeLeftByFamily({ k: calibration?.k, paces: paceByFamily, used: estimatedNow ?? used }),
        activeLeftMs: activeTimeLeft({ k: calibration?.k, pace: activePace, used: estimatedNow ?? used }),
        estimatedNow,
        forecast,
        readAt: latest.ts,
        resetsAt: withoutReading ? resetsAtIso : latest.weeklyResetsAt,
        source: latest.source,
        weekly: used,
        withoutReading: withoutReading || undefined,
        pacing: weekPacing({
          costBetween,
          k: calibration?.k,
          now,
          readings: snapshots.filter(s => Date.parse(s.weeklyResetsAt) === resetsAt),
          resetsAt,
          usedNow: estimatedNow ?? used,
          windowMs: WEEK_MS,
        }),
      };
    }
  }

  const chartFrom = dayKey(now - (DAILY_CHART_DAYS - 1) * DAY_MS, timeZone);
  const daily = aggregate(records.filter(r => dayKey(Date.parse(r.ts), timeZone) >= chartFrom), ms => dayKey(ms, timeZone));
  const resets = [...new Set(snapshots.map(s => Date.parse(s.weeklyResetsAt)))].sort((a, b) => a - b);
  const weekly = aggregate(records, ms => (resets.length === 0
    ? isoWeekStart(ms, timeZone)
    : new Date(weekStartFor(ms, resets)).toISOString()));

  const weekStart = resets.length === 0 ? startOfDay(isoWeekStart(now, timeZone), timeZone) : weekStartFor(now, resets);
  const titles = input.titles ?? {};
  const breakdown = {
    all: buildBreakdown(records, titles),
    fourWeeks: buildBreakdown(records, titles, weekStart - 3 * WEEK_MS),
    week: buildBreakdown(records, titles, weekStart),
  };

  const detected = latest && planFromSubscription(latest.subscriptionType, latest.rateLimitTier);
  const unknownModels = [...new Set(records.map(r => r.model))].filter(model => !priceFor(model)).sort();

  const activity = buildActivity({ chartFrom, now, records, timeZone, weekStart });
  const sessions = buildSessions({ k: fiveHourCalibration?.k, limitThreshold, now, records, snapshots, timeZone });
  const weekHistory = buildWeekHistory({
    calibrationK: calibration?.k,
    current,
    now,
    plan,
    records,
    sessionWindows,
    shares: weeks,
    snapshots,
    weekLimitThreshold,
    weekStartOf: ms => (resets.length === 0 ? startOfDay(isoWeekStart(ms, timeZone), timeZone) : weekStartFor(ms, resets)),
  });

  const limitsInput = { costBetween, dataStart: first, now, plan, planHistory, snapshots };

  return {
    activity,
    breakdown,
    calibration,
    current,
    currentFamily: latestRecord && familyOf(latestRecord.model),
    daily,
    detected,
    detectedPlan: detected && detected !== plan ? detected : undefined,
    endpointEnabled: input.endpointEnabled,
    fiveHourCalibration,
    fiveHourSession,
    generatedAt: nowIso,
    limits: buildLimits(limitsInput),
    limitThreshold,
    modelRatios: modelRatios(records, now - TYPICAL_DAYS * DAY_MS, now, timeZone),
    multipliers: buildMultipliers(limitsInput),
    plan,
    planFit: buildPlanFitInput({ calibrationK: calibration?.k, fiveHourK: fiveHourCalibration?.k, plan, planHistory, sessionWindows, weekHistory, weekLimitThreshold }),
    planHistory,
    planSource: (planHistory.findLast(period => Date.parse(period.from) <= now) ?? planHistory[0])?.source,
    sessions,
    throttleMinutes: input.throttleMinutes ?? 15,
    timeZone,
    unknownModels,
    weekHistory,
    weekLimitThreshold,
    weekly,
    weeks,
  };
}
