import type { DashboardSummary } from './summary.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** One window of the taskbar widget; no `percent` means no reading yet. */
export interface WidgetRow {
  estimated: boolean;
  /** % from which the window counts as having hit the limit. */
  limit: number;
  percent?: number;
  /** ISO; absent for an idle or unknown window. */
  resetsAt?: string;
}

export interface WidgetView {
  fiveHour: WidgetRow;
  generatedAt: string;
  weekly: WidgetRow;
}

type WidgetInput = Pick<DashboardSummary, 'current' | 'fiveHourSession' | 'limitThreshold' | 'weekLimitThreshold'>;

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Time left as `2d05h`, `2h59m` or `45m`, rounded down: a bare `2h` would hide
 * whether 2h59 or 2h00 is left.
 */
export function formatResetIn(ms: number): string {
  if (ms < MINUTE_MS)
    return '<1m';
  if (ms >= DAY_MS)
    return `${Math.floor(ms / DAY_MS)}d${two(Math.floor((ms % DAY_MS) / HOUR_MS))}h`;
  if (ms >= HOUR_MS)
    return `${Math.floor(ms / HOUR_MS)}h${two(Math.floor((ms % HOUR_MS) / MINUTE_MS))}m`;
  return `${Math.floor(ms / MINUTE_MS)}m`;
}

/** The two rows of the taskbar widget, from the same numbers the Overview shows. */
export function widgetView(summary: WidgetInput, now: number): WidgetView {
  const session = summary.fiveHourSession;
  const week = summary.current;

  // A 5-hour window past its reset, or never opened, is idle: Claude Code
  // starts the next one with the next message, not before. `buildSummary` drops
  // an expired window altogether, so a week with no session still means idle.
  const sessionOpen = session?.resetsAt !== undefined && Date.parse(session.resetsAt) > now;
  const fiveHour: WidgetRow = { estimated: false, limit: summary.limitThreshold };
  if (session && sessionOpen) {
    fiveHour.estimated = session.estimatedNow !== undefined;
    fiveHour.percent = session.estimatedNow ?? session.percent;
    fiveHour.resetsAt = session.resetsAt;
  }
  else if (session || week) {
    fiveHour.percent = 0;
  }

  const weekly: WidgetRow = { estimated: false, limit: summary.weekLimitThreshold };
  if (week) {
    weekly.estimated = week.estimatedNow !== undefined;
    weekly.percent = week.estimatedNow ?? week.weekly;
    weekly.resetsAt = week.resetsAt;
  }

  return { fiveHour, generatedAt: new Date(now).toISOString(), weekly };
}
