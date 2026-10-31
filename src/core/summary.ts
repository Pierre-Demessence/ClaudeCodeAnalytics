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
import type { LimitWindow } from './plans.ts';
import type { PartPercent } from './restarts.ts';
import type { FiveHourWindow, Sessions } from './sessions.ts';
import type { WeekShare } from './share.ts';
import type { ApiEvent, Plan, PlanPeriod, SessionInfo, Snapshot, UsageRecord } from './types.ts';
import type { ValueForMoney } from './valueForMoney.ts';
import type { WeekHistory } from './weekHistory.ts';

import { activeHourlyPace, activeLeftByFamily, activeTimeLeft } from './activePace.ts';
import { familyPaces } from './activeTime.ts';
import { buildActivity } from './activity.ts';
import { aggregate, createCostIndex, dailyCostSeries, dayKey } from './aggregate.ts';
import { buildBreakdown } from './breakdown.ts';
import { calibrationPoints, DAY_MS, fitRatio, FIVE_HOURS_MS, fiveHourCalibrationPoints, HOUR_MS, WEEK_MS } from './calibration.ts';
import { dedupeHits, hitScope } from './events.ts';
import { familyOf } from './family.ts';
import { forecastWindow } from './forecast.ts';
import { buildLimits } from './limits.ts';
import { modelRatios } from './modelRatio.ts';
import { buildMultipliers } from './multipliers.ts';
import { weekPacing } from './pacing.ts';
import { buildPlanFitInput } from './planFit.ts';
import { convertPercent, planAt, planChanges, planFromSubscription } from './plans.ts';
import { priceFor } from './pricing.ts';
import { endedPartPercent, partStartOf, windowParts } from './restarts.ts';
import { buildSessions, DEFAULT_LIMIT_THRESHOLD, fiveHourWindows, sessionPaces } from './sessions.ts';
import { typicalWeek, weeklyShares } from './share.ts';
import { subscriptionStartOf, valueForMoney } from './valueForMoney.ts';
import { buildWeekHistory, DEFAULT_WEEK_LIMIT_THRESHOLD } from './weekHistory.ts';
import { snapResets, weekBucketer, weekStarter, windowStartOf } from './weekWindows.ts';

/** Days of daily cost and 5-hour sessions used as "typical" for forecasts. */
const TYPICAL_DAYS = 28;
/** Days shown in the daily usage chart. */
const DAILY_CHART_DAYS = 35;
/** Readings older than this get an estimated current % from transcripts. */
const STALE_READING_MS = 30 * 60_000;
/** Fewer days than this under the current plan give no weekly pace of their own: the forecast keeps the full typical days. */
const MIN_PLAN_DAYS = 3;
/** Fewer finished 5-hour sessions than this under the current plan give no session pace of their own: the forecast keeps the last 28 days. */
const MIN_PLAN_SESSIONS = 3;
/** From this far into a week, its forecast rests on the week's own pace alone; before, past days steady it. */
const OWN_PACE_AFTER_MS = 3 * DAY_MS;

export interface SummaryInput {
  endpointEnabled: boolean;
  /** Rate-limit hits, overloads and compactions seen in the transcripts. */
  events?: readonly ApiEvent[];
  /** 5-hour % from which a window counts as having hit the limit; 95 by default. */
  limitThreshold?: number;
  now: number;
  planHistory: readonly PlanPeriod[];
  records: readonly UsageRecord[];
  snapshots: readonly Snapshot[];
  /** When the paid subscription started (ms), from Claude Code's account; a manual first plan period overrides it. */
  subscriptionStart?: number;
  /** Minutes between endpoint calls; 15 by default. */
  throttleMinutes?: number;
  timeZone: string;
  /** Conversation titles by session id. */
  titles?: Readonly<Record<string, SessionInfo>>;
  /** Weekly % from which a week counts as having hit the limit; 98 by default. */
  weekLimitThreshold?: number;
}

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
  /** When the usage restarted inside the window: each part's % on its own plan, the running one last. */
  parts?: PartPercent[];
  /** ISO time of the last reading; from an earlier week when `withoutReading`. */
  readAt: string;
  resetsAt: string;
  source: Snapshot['source'];
  /** This week's own fit, used for the week's estimate, forecast, pacing and active time when present. */
  weekCalibration?: Calibration;
  /** Weekly % at the last reading; 0 when `withoutReading`. */
  weekly: number;
  /** No reading yet in this window: it follows the last known reset, usage comes from transcripts. */
  withoutReading?: true;
}

export interface DashboardSummary {
  /** Heatmap, cache use, message costs (this weekly window) and Claude Code upgrades. */
  activity: Activity;
  /** Where the usage went in the current weekly window. */
  breakdown: Breakdown;
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
  /** What the history ranges resolve against: the weekly reset times and the first stored message. */
  rangeBasis: { firstMessage?: number; resets: number[] };
  /** Past 5-hour windows of the last 7 days. */
  sessions: Sessions;
  /** Minutes between endpoint calls. */
  throttleMinutes: number;
  timeZone: string;
  /** Models without a known price; their cost counts as zero. */
  unknownModels: string[];
  /** The usage at API prices against the plan's price; absent without cost. */
  value?: ValueForMoney;
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

/**
 * What the summary and the ranged views share, whatever the range: readings
 * sorted, calibrations, the 5-hour windows, the current week. Computed once by
 * `prepareSummary`, so the two can never disagree.
 */
export interface PreparedSummary {
  calibration?: Calibration;
  current?: CurrentWeek;
  costBetween: (from: number, to: number) => number;
  /** Time of the first stored message, or `now` without any. */
  first: number;
  fiveHourCalibration?: Calibration;
  fiveHourSession?: FiveHourSession;
  limitThreshold: number;
  plan: Plan;
  /** Weekly reset times seen in readings, sorted. */
  resets: number[];
  sessionHits: ApiEvent[];
  sessionWindows: FiveHourWindow[];
  /** Readings oldest first. */
  snapshots: Snapshot[];
  weekHits: ApiEvent[];
  weekLimitThreshold: number;
  /** Start of the weekly window holding a time. */
  weekStartOf: (ms: number) => number;
  /** Final % of every completed window with readings. */
  weeks: WeekShare[];
}

/**
 * Right after a plan change the new plan has no fit yet: the most recent other plan
 * that has one stands in, converted at the advertised multipliers (`k` is a % per
 * dollar, so it scales like a %). Rough, since the multipliers are approximate.
 */
function borrowedFit(fitOn: (plan: Plan) => Calibration | undefined, plan: Plan, planHistory: readonly PlanPeriod[], window: LimitWindow): Calibration | undefined {
  const tried = new Set<Plan>([plan]);
  for (const period of planHistory.toReversed()) {
    if (tried.has(period.plan))
      continue;
    tried.add(period.plan);
    const fit = fitOn(period.plan);
    const k = fit && convertPercent(fit.k, period.plan, plan, window);
    const rmse = fit && convertPercent(fit.rmse, period.plan, plan, window);
    // A 5-hour fit cannot cross to or from a plan without that limit: look further back.
    if (fit && k !== undefined && rmse !== undefined)
      return { ...fit, borrowedFrom: period.plan, k, rmse };
  }
  return undefined;
}

/** The part of the summary that does not depend on a range. */
export function prepareSummary(input: SummaryInput): PreparedSummary {
  const { now, planHistory, records, timeZone } = input;
  const snapshots = snapResets([...input.snapshots].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)));
  const nowIso = new Date(now).toISOString();
  const plan = planAt(planHistory, nowIso);
  const costBetween = createCostIndex(records);
  const latest = snapshots.at(-1);

  // A loop, not Math.min(...): spreading a year of records overflows the call stack.
  let first = now;
  for (const record of records)
    first = Math.min(first, Date.parse(record.ts));
  const firstDay = dayKey(first, timeZone);

  // Calibrate only on readings taken under the current plan. A reading's cost counts from the start of its part: a restart inside the window (an upgrade, a free reset) empties the % but not the cost since the window start.
  const parts = windowParts(snapshots, planHistory);
  const startOf = partStartOf(parts);
  const onPlan = (which: Plan) => snapshots.filter(s => planAt(planHistory, s.ts) === which);
  const fitOn = (which: Plan) => fitRatio(calibrationPoints(onPlan(which), costBetween, first, startOf), now);
  const fiveHourFitOn = (which: Plan) => fitRatio(fiveHourCalibrationPoints(onPlan(which), costBetween, first), now);
  const calibration = fitOn(plan) ?? borrowedFit(fitOn, plan, planHistory, 'week');
  const fiveHourCalibration = fiveHourFitOn(plan) ?? borrowedFit(fiveHourFitOn, plan, planHistory, 'fiveHour');
  const yesterday = dayKey(now - DAY_MS, timeZone);
  const typicalFrom = [firstDay, dayKey(now - TYPICAL_DAYS * DAY_MS, timeZone)].sort().at(-1)!;
  const dailyCostsFrom = (from: string) => from <= yesterday
    ? dailyCostSeries(records, timeZone, from, yesterday).map(d => d.cost)
    : [];
  // The weekly pace comes from the days under the current plan: a plan change moves the usage with it.
  // Only a change counts: a period that keeps the plan (the collector's first detected one) starts nothing.
  const latestChange = planChanges(planHistory).findLast(change => change.at <= now);
  const planFrom = latestChange ? [typicalFrom, dayKey(latestChange.at, timeZone)].sort().at(-1)! : typicalFrom;
  const planDays = dailyCostsFrom(planFrom);
  const dailyCosts = planDays.length >= MIN_PLAN_DAYS ? planDays : dailyCostsFrom(typicalFrom);
  const limitThreshold = input.limitThreshold ?? DEFAULT_LIMIT_THRESHOLD;
  const weekLimitThreshold = input.weekLimitThreshold ?? DEFAULT_WEEK_LIMIT_THRESHOLD;
  const hits = dedupeHits(input.events ?? []).filter(event => event.kind === 'limit');
  const sessionHits = hits.filter(hit => hitScope(hit) === 'session');
  const weekHits = hits.filter(hit => hitScope(hit) === 'week');
  const sessionWindows = fiveHourWindows({ hits: sessionHits, k: fiveHourCalibration?.k, limitThreshold, now, planHistory, records, snapshots });
  // The session pace comes from the sessions under the current plan too: a smaller plan's limit cut its sessions short.
  const planSessions = sessionPaces(sessionWindows, Math.max(now - TYPICAL_DAYS * DAY_MS, latestChange?.at ?? -Infinity));
  const paceSamples = planSessions.length >= MIN_PLAN_SESSIONS ? planSessions : sessionPaces(sessionWindows, now - TYPICAL_DAYS * DAY_MS);
  const activePace = activeHourlyPace(records, now - TYPICAL_DAYS * DAY_MS, now);
  const paceByFamily = familyPaces(records, now - TYPICAL_DAYS * DAY_MS, now);

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
      // Without a reset time (manual readings), the window ends within 5 hours of the reading.
      const fiveHourUntil = (latest.fiveHourResetsAt ? Date.parse(latest.fiveHourResetsAt) : readAt + FIVE_HOURS_MS) - now;
      fiveHourSession.activeLeftMs = activeTimeLeft({ k: fiveHourCalibration?.k, pace: activePace, until: fiveHourUntil, used: fiveHourUsed });
      fiveHourSession.activeLeftByFamily = activeLeftByFamily({ k: fiveHourCalibration?.k, paces: paceByFamily, until: fiveHourUntil, used: fiveHourUsed });
    }

    const latestReset = Date.parse(latest.weeklyResetsAt);
    const withoutReading = latestReset <= now;
    // Weekly windows are fixed 7-day blocks: a week without a reading yet follows the last known reset.
    const resetsAt = withoutReading ? windowStartOf(now, latestReset) + WEEK_MS : latestReset;
    const windowFrom = resetsAt - WEEK_MS;
    // The window's parts: a restart (an upgrade, a free reset) empties the % but not the cost since the window start, so the week is counted from its running part.
    const weekParts = parts.get(resetsAt) ?? [{ end: resetsAt, plan, readings: [], start: windowFrom }];
    const running = weekParts.at(-1)!;
    const restarted = weekParts.length > 1;
    // Weeks of one plan can burn the limit at very different rates per dollar (model mix):
    // with enough readings of its own, the week uses its own ratio rather than the pooled one.
    const weekCalibration = withoutReading
      ? undefined
      : fitRatio(calibrationPoints(running.readings.filter(s => planAt(planHistory, s.ts) === plan), costBetween, first, startOf), now);
    const weekK = (weekCalibration ?? calibration)?.k;

    let used: number | undefined;
    let estimatedNow: number | undefined;
    // Where the projections start: the reading plus the usage since it, shown as an estimate only once the reading is stale.
    let projectedFrom: number | undefined;
    if (!withoutReading) {
      used = latest.weekly;
      // A stale reading misses the usage since; with a calibration, add it back from transcripts.
      const sinceReading = weekK !== undefined ? weekK * costBetween(readAt, now) : 0;
      if (sinceReading > 0)
        projectedFrom = Math.min(100, latest.weekly + sinceReading);
      if (now - readAt > STALE_READING_MS)
        estimatedNow = projectedFrom;
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
      const from = estimatedNow ?? projectedFrom ?? used;
      const week = {
        k: weekK,
        ownPaceAfterMs: OWN_PACE_AFTER_MS,
        paceSamples: dailyCosts,
        resampleSum: true,
        resetsAt,
        sampleMs: DAY_MS,
        startsAt: running.start,
        typical: typicalBase && { high: typicalBase.high, low: typicalBase.low, median: typicalBase.median },
        windowMs: WEEK_MS,
      };
      const forecast = estimatedNow !== undefined || withoutReading
        // Uncalibrated, a week without a reading has no pace of its own (claude.ai use is unseen): project it from its start, i.e. the typical week.
        ? forecastWindow({ ...week, asOf: calibration || !withoutReading ? now : windowFrom, used: estimatedNow ?? used })
        : forecastWindow({ ...week, asOf: calibration ? now : readAt, used: from });

      const resetsAtIso = new Date(resetsAt).toISOString();
      current = {
        activeLeftByFamily: activeLeftByFamily({ k: weekK, paces: paceByFamily, until: resetsAt - now, used: from }),
        activeLeftMs: activeTimeLeft({ k: weekK, pace: activePace, until: resetsAt - now, used: from }),
        estimatedNow,
        forecast,
        readAt: latest.ts,
        resetsAt: withoutReading ? resetsAtIso : latest.weeklyResetsAt,
        source: latest.source,
        weekCalibration,
        weekly: used,
        withoutReading: withoutReading || undefined,
        pacing: weekPacing({
          costBetween,
          k: weekK,
          now,
          parts: weekParts,
          resetsAt,
          roomFrom: from,
          usedNow: estimatedNow ?? used,
          windowMs: WEEK_MS,
        }),
        parts: restarted
          ? [
              ...weekParts.slice(0, -1).map(part => endedPartPercent(part, costBetween, calibration && { k: calibration.k, plan })),
              { ...(estimatedNow !== undefined && { estimated: true as const }), percent: estimatedNow ?? used, plan: running.plan, start: new Date(running.start).toISOString() },
            ]
          : undefined,
      };
    }
  }

  const resets = [...new Set(snapshots.map(s => Date.parse(s.weeklyResetsAt)))].sort((a, b) => a - b);
  return {
    calibration,
    costBetween,
    current,
    first,
    fiveHourCalibration,
    fiveHourSession,
    limitThreshold,
    plan,
    resets,
    sessionHits,
    sessionWindows,
    snapshots,
    weekHits,
    weekLimitThreshold,
    weeks,
    weekStartOf: weekStarter(resets, timeZone),
  };
}

/** Everything the dashboard shows, computed from collector data. */
export function buildSummary(input: SummaryInput): DashboardSummary {
  const { now, planHistory, records, timeZone } = input;
  const nowIso = new Date(now).toISOString();
  const prepared = prepareSummary(input);
  const { calibration, costBetween, current, first, fiveHourCalibration, fiveHourSession, limitThreshold, plan, resets, sessionHits, sessionWindows, snapshots, weekHits, weekLimitThreshold, weeks, weekStartOf } = prepared;
  const latest = snapshots.at(-1);
  const subscriptionStart = subscriptionStartOf(planHistory, input.subscriptionStart);
  // A loop, not Math.max(...): spreading a year of records overflows the call stack.
  let latestRecord: UsageRecord | undefined;
  for (const record of records) {
    if (!latestRecord || Date.parse(record.ts) > Date.parse(latestRecord.ts))
      latestRecord = record;
  }

  const chartFrom = dayKey(now - (DAILY_CHART_DAYS - 1) * DAY_MS, timeZone);
  const daily = aggregate(records.filter(r => dayKey(Date.parse(r.ts), timeZone) >= chartFrom), ms => dayKey(ms, timeZone));
  const weekly = aggregate(records, weekBucketer(resets, timeZone));

  const weekStart = weekStartOf(now);
  const breakdown = buildBreakdown(records, input.titles ?? {}, weekStart);

  const detected = latest && planFromSubscription(latest.subscriptionType, latest.rateLimitTier);
  const unknownModels = [...new Set(records.map(r => r.model))].filter(model => !priceFor(model)).sort();

  const activity = buildActivity({ chartFrom, events: input.events, now, records, timeZone, weekStart });
  const sessions = buildSessions({ hits: sessionHits, k: fiveHourCalibration?.k, limitThreshold, now, planHistory, records, snapshots, timeZone });
  const weekHistory = buildWeekHistory({
    calibrationK: calibration?.k,
    current,
    hits: weekHits,
    now,
    plan,
    planHistory,
    records,
    sessionWindows,
    shares: weeks,
    snapshots,
    weekLimitThreshold,
    weekStartOf,
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
    planFit: buildPlanFitInput({ calibrationK: calibration?.k, plan, planHistory, sessionWindows, subscriptionStart, weekHistory }),
    planHistory,
    planSource: (planHistory.findLast(period => Date.parse(period.from) <= now) ?? planHistory[0])?.source,
    rangeBasis: { firstMessage: records.length > 0 ? first : undefined, resets },
    sessions,
    throttleMinutes: input.throttleMinutes ?? 15,
    timeZone,
    unknownModels,
    value: valueForMoney({ costBetween, dataStart: first, now, planHistory, subscriptionStart }),
    weekHistory,
    weekLimitThreshold,
    weekly,
    weeks,
  };
}
