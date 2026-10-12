import type { DashboardSummary } from './summary.ts';

/** One window of the taskbar widget; no `percent` means no reading yet. */
export interface WidgetRow {
  estimated: boolean;
  /** % from which the window counts as having hit the limit. */
  limit: number;
  percent?: number;
  /** Epoch milliseconds; absent for an idle or unknown window. */
  resetsAtMs?: number;
}

export interface WidgetView {
  fiveHour: WidgetRow;
  generatedAt: string;
  weekly: WidgetRow;
}

type WidgetInput = Pick<DashboardSummary, 'current' | 'fiveHourSession' | 'limitThreshold' | 'weekLimitThreshold'>;

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
    fiveHour.resetsAtMs = Date.parse(session.resetsAt!);
  }
  else if (session || week) {
    fiveHour.percent = 0;
  }

  const weekly: WidgetRow = { estimated: false, limit: summary.weekLimitThreshold };
  if (week) {
    weekly.estimated = week.estimatedNow !== undefined;
    weekly.percent = week.estimatedNow ?? week.weekly;
    weekly.resetsAtMs = Date.parse(week.resetsAt);
  }

  return { fiveHour, generatedAt: new Date(now).toISOString(), weekly };
}
