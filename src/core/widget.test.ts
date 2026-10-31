import { describe, expect, it } from 'vitest';

import type { DashboardSummary } from './summary.ts';
import type { Snapshot } from './types.ts';

import { buildSummary } from './summary.ts';
import { widgetView } from './widget.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.parse('2026-10-12T15:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Input = Pick<DashboardSummary, 'current' | 'fiveHourSession' | 'limitThreshold' | 'noFiveHourLimit' | 'weekLimitThreshold'>;

function summary(overrides: Partial<Input> = {}): Input {
  return {
    current: { pacing: {} as never, readAt: iso(now - HOUR), resetsAt: iso(now + 2 * DAY + 5 * HOUR), source: 'endpoint', weekly: 59 },
    fiveHourSession: { percent: 42, readAt: iso(now - 10 * MIN), resetsAt: iso(now + 2 * HOUR + 59 * MIN + 40_000) },
    limitThreshold: 95,
    noFiveHourLimit: false,
    weekLimitThreshold: 98,
    ...overrides,
  };
}

describe('widgetView', () => {
  it('reads both windows with their limits and reset times', () => {
    const view = widgetView(summary(), now);
    expect(view.fiveHour).toMatchObject({ estimated: false, limit: 95, percent: 42, resetsAtMs: now + 2 * HOUR + 59 * MIN + 40_000 });
    expect(view.weekly).toMatchObject({ estimated: false, limit: 98, percent: 59, resetsAtMs: now + 2 * DAY + 5 * HOUR });
    expect(view.generatedAt).toBe(iso(now));
  });

  it('uses the estimate over the reading, and flags it', () => {
    const base = summary();
    const view = widgetView(summary({
      current: { ...base.current!, estimatedNow: 61 },
      fiveHourSession: { ...base.fiveHourSession!, estimatedNow: 47 },
    }), now);
    expect(view.fiveHour).toMatchObject({ estimated: true, percent: 47 });
    expect(view.weekly).toMatchObject({ estimated: true, percent: 61 });
  });

  it('shows an idle 5-hour window once its reset has passed', () => {
    const view = widgetView(summary({ fiveHourSession: { percent: 80, readAt: iso(now - 6 * HOUR), resetsAt: iso(now - HOUR) } }), now);
    expect(view.fiveHour).toEqual({ estimated: false, limit: 95, percent: 0 });
  });

  it('shows an idle 5-hour window for a reading with no window', () => {
    const view = widgetView(summary({ fiveHourSession: { percent: 0, readAt: iso(now - HOUR) } }), now);
    expect(view.fiveHour).toEqual({ estimated: false, limit: 95, percent: 0 });
  });

  it('shows an idle 5-hour window when only the week is known, as buildSummary reports an expired window', () => {
    const view = widgetView(summary({ fiveHourSession: undefined }), now);
    expect(view.fiveHour).toEqual({ estimated: false, limit: 95, percent: 0 });
    expect(view.weekly.percent).toBe(59);
  });

  it('marks the 5-hour row as none on an account without that limit', () => {
    const view = widgetView(summary({ fiveHourSession: undefined, noFiveHourLimit: true }), now);
    expect(view.fiveHour).toEqual({ estimated: false, limit: 95, none: true });
    expect(view.weekly.percent).toBe(59);
  });

  it('leaves a window unknown without any reading', () => {
    const view = widgetView(summary({ current: undefined, fiveHourSession: undefined }), now);
    expect(view.fiveHour).toEqual({ estimated: false, limit: 95 });
    expect(view.weekly).toEqual({ estimated: false, limit: 98 });
  });
});

describe('widgetView on a real summary', () => {
  const build = (snapshots: Snapshot[]) => widgetView(buildSummary({ endpointEnabled: true, now, planHistory: [], records: [], snapshots, timeZone: 'UTC' }), now);
  const reading = (extra: Partial<Snapshot>): Snapshot => ({ source: 'endpoint', ts: iso(now - 20 * MIN), weekly: 59, weeklyResetsAt: iso(now + 2 * DAY), ...extra });

  it('keeps an open window with its reset time', () => {
    const view = build([reading({ fiveHour: 42, fiveHourResetsAt: iso(now + 2 * HOUR) })]);
    expect(view.fiveHour).toMatchObject({ percent: 42, resetsAtMs: now + 2 * HOUR });
  });

  it('shows 0% once the window of the last reading has reset, before the next reading', () => {
    const view = build([reading({ fiveHour: 80, fiveHourResetsAt: iso(now - 10 * MIN) })]);
    expect(view.fiveHour).toEqual({ estimated: false, limit: 95, percent: 0 });
  });

  it('shows 0% for a reading that reports no window', () => {
    const view = build([reading({ fiveHour: 0 })]);
    expect(view.fiveHour).toEqual({ estimated: false, limit: 95, percent: 0 });
  });

  it('shows none for the 5-hour row of an Ultra account whose readings have no 5-hour window', () => {
    const ultra = [{ from: iso(now - 30 * DAY), plan: 'max20' as const, source: 'manual' as const }];
    const view = widgetView(buildSummary({ endpointEnabled: true, now, planHistory: ultra, records: [], snapshots: [reading({})], timeZone: 'UTC' }), now);
    expect(view.fiveHour).toEqual({ estimated: false, limit: 95, none: true });
  });

  it('leaves both rows unknown with no reading at all', () => {
    const view = build([]);
    expect(view.fiveHour.percent).toBeUndefined();
    expect(view.weekly.percent).toBeUndefined();
  });
});
