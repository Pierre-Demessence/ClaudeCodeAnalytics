import type { Activity } from './activity.ts';
import type { UsageRow } from './aggregate.ts';
import type { Breakdown } from './breakdown.ts';
import type { Range } from './range.ts';
import type { Sessions } from './sessions.ts';
import type { SummaryInput } from './summary.ts';
import type { WeekHistory } from './weekHistory.ts';

import { buildActivity } from './activity.ts';
import { aggregate, dayKey } from './aggregate.ts';
import { buildBreakdown } from './breakdown.ts';
import { DAILY_RANGE_MAX_DAYS, rangeDays } from './range.ts';
import { buildSessions } from './sessions.ts';
import { prepareSummary } from './summary.ts';
import { buildWeekHistory } from './weekHistory.ts';
import { weekBucketer } from './weekWindows.ts';

/** The views of the history tabs over one range. The tabs' default windows hold the same sections in `DashboardSummary`. */
export interface RangedSummary {
  /** Heatmap, cache and message costs over the range; upgrades within it. */
  activity: Activity;
  breakdown: Breakdown;
  range: Range;
  sessions: Sessions;
  /** Usage per bucket and model; `day` is absent when the range is too long for a bar per day. */
  usage: { day?: UsageRow[]; week: UsageRow[] };
  weekHistory: WeekHistory;
}

/** What the history tabs show for a range, computed by the builders of the default summary. */
export function buildRanged(input: SummaryInput, range: Range): RangedSummary {
  const { now, records, timeZone } = input;
  const { calibration, current, fiveHourCalibration, limitThreshold, plan, resets, sessionHits, sessionWindows, snapshots, weekHits, weekLimitThreshold, weeks, weekStartOf } = prepareSummary(input);

  const inRange = records.filter((record) => {
    const ms = Date.parse(record.ts);
    return ms >= range.from && ms < range.to;
  });
  const usage = {
    day: rangeDays(range) <= DAILY_RANGE_MAX_DAYS ? aggregate(inRange, ms => dayKey(ms, timeZone)) : undefined,
    week: aggregate(inRange, weekBucketer(resets, timeZone)),
  };

  return {
    breakdown: buildBreakdown(records, input.titles ?? {}, range.from, range.to),
    range,
    sessions: buildSessions({ hits: sessionHits, k: fiveHourCalibration?.k, limitThreshold, now, range, records, snapshots, timeZone }),
    usage,
    activity: buildActivity({
      cache: range,
      chartFrom: dayKey(range.from, timeZone),
      chartTo: dayKey(range.to - 1, timeZone),
      events: input.events,
      heatmap: range,
      messages: range,
      now,
      records,
      timeZone,
      weekStartOf,
    }),
    weekHistory: buildWeekHistory({
      calibrationK: calibration?.k,
      current,
      hits: weekHits,
      now,
      plan,
      range,
      records,
      sessionWindows,
      shares: weeks,
      snapshots,
      weekLimitThreshold,
      weekStartOf,
    }),
  };
}
