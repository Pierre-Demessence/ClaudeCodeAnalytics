import { describe, expect, it } from 'vitest';

import type { BacktestSample } from './backtest.ts';
import type { SummaryInput } from './summary.ts';
import type { Snapshot, UsageRecord } from './types.ts';

import { fiveHourFinals, formatReport, runBacktest, scoreSamples, weeklyFinals } from './backtest.ts';
import { DAY_MS, FIVE_HOURS_MS, HOUR_MS, WEEK_MS } from './calibration.ts';

const T0 = Date.parse('2026-09-01T00:00:00Z');

function snap(ts: number, weekly: number, weeklyResetsAt: number, extra: Partial<Snapshot> = {}): Snapshot {
  return { source: 'endpoint', ts: new Date(ts).toISOString(), weekly, weeklyResetsAt: new Date(weeklyResetsAt).toISOString(), ...extra };
}

function rec(ts: number): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 0, key: String(ts), model: 'claude-opus-5-5', output: 1000, project: 'p', ts: new Date(ts).toISOString() };
}

function sample(over: Partial<BacktestSample>): BacktestSample {
  return { at: 0, final: 50, high: 60, kind: 'weekly', low: 40, median: 50, method: 'calibrated', remainingShare: 0.8, resetsAt: 0, ...over };
}

describe('weeklyFinals', () => {
  it('keeps the last reading of each completed window when it is near reset', () => {
    const reset = T0 + WEEK_MS;
    const finals = weeklyFinals([
      snap(T0 + DAY_MS, 20, reset),
      snap(reset - HOUR_MS, 70, reset),
      // A window whose last reading is days before reset is an estimate, not a final.
      snap(T0 + WEEK_MS + DAY_MS, 30, reset + WEEK_MS),
    ], reset + 2 * WEEK_MS);
    expect(finals.get(reset)).toBe(70);
    expect(finals.has(reset + WEEK_MS)).toBe(false);
  });

  it('ignores windows that have not reset yet', () => {
    const reset = T0 + WEEK_MS;
    expect(weeklyFinals([snap(reset - HOUR_MS, 70, reset)], reset - 1).size).toBe(0);
  });
});

describe('fiveHourFinals', () => {
  const reset = T0 + FIVE_HOURS_MS;
  const five = (ts: number, fiveHour: number) => snap(ts, 10, T0 + WEEK_MS, { fiveHour, fiveHourResetsAt: new Date(reset).toISOString() });

  it('takes the highest reading of a window that was followed to its end', () => {
    expect(fiveHourFinals([five(T0 + HOUR_MS, 30), five(reset - 10 * 60_000, 65)], [], reset + 1).get(reset)).toBe(65);
  });

  it('accepts an early last reading when no message came after it', () => {
    expect(fiveHourFinals([five(T0 + HOUR_MS, 30)], [rec(T0 + HOUR_MS - 1000)], reset + 1).get(reset)).toBe(30);
  });

  it('drops a window with messages after its last reading and far from reset', () => {
    expect(fiveHourFinals([five(T0 + HOUR_MS, 30)], [rec(T0 + 3 * HOUR_MS)], reset + 1).has(reset)).toBe(false);
  });

  it('ignores windows that have not reset yet', () => {
    expect(fiveHourFinals([five(reset - 1000, 30)], [], reset - 1).size).toBe(0);
  });
});

describe('scoreSamples', () => {
  const samples = [
    // Exact median, final inside the range, a limit hit predicted and real.
    sample({ final: 100, high: 130, low: 90, median: 120, resetsAt: 1 }),
    // Off by 20 points, final outside the range, no hit predicted or real.
    sample({ final: 30, high: 45, low: 40, median: 50, resetsAt: 2 }),
    // A hit predicted but not real (final 60, median clamped to 100).
    sample({ final: 60, high: 200, low: 100, median: 150, resetsAt: 3 }),
    // A hit that was missed.
    sample({ final: 99, high: 70, low: 50, median: 60, resetsAt: 4 }),
  ];
  const [score] = scoreSamples(samples, { fiveHour: 95, weekly: 98 }).filter(s => s.kind === 'weekly' && s.lead === 'all');

  it('clamps projections at 100 before measuring the error', () => {
    // Errors: |100-100|=0, 20, |100-60|=40, 39 → median of [0, 20, 39, 40] = 29.5.
    expect(score!.medianAbsError).toBe(29.5);
  });

  it('counts the finals inside the range', () => {
    expect(score!.coverage).toBe(0.25);
  });

  it('scores the limit-hit call', () => {
    expect(score!.hit).toEqual({ falseNegatives: 1, falsePositives: 1, truePositives: 1 });
    expect(score!.precision).toBe(0.5);
    expect(score!.recall).toBe(0.5);
  });

  it('counts samples and distinct windows', () => {
    expect(score!.samples).toBe(4);
    expect(score!.windows).toBe(4);
  });

  it('splits by method, kind and how far from reset the call was made', () => {
    const scores = scoreSamples([
      sample({ method: 'calibrated', remainingShare: 0.9 }),
      sample({ method: 'trend', remainingShare: 0.2 }),
      sample({ kind: 'fiveHour', method: 'calibrated', remainingShare: 0.2 }),
    ], { fiveHour: 95, weekly: 98 });
    const keys = scores.map(s => `${s.kind}/${s.method}/${s.lead}`);
    expect(keys).toContain('weekly/calibrated/early');
    expect(keys).toContain('weekly/trend/late');
    expect(keys).toContain('fiveHour/calibrated/all');
    expect(keys).not.toContain('weekly/calibrated/late');
  });

  it('gives no precision without predicted hits', () => {
    const [only] = scoreSamples([sample({ final: 10, median: 20 })], { fiveHour: 95, weekly: 98 });
    expect(only!.precision).toBeUndefined();
    expect(only!.recall).toBeUndefined();
  });
});

describe('runBacktest', () => {
  const NOW = T0 + 4 * WEEK_MS;
  // Weekly windows reset every Thursday-ish: T0 + n weeks. Final 40 % for the one closing at T0 + 3 weeks.
  const reset3 = T0 + 3 * WEEK_MS;
  const snapshots = [
    snap(reset3 - HOUR_MS, 40, reset3),
    snap(NOW - HOUR_MS, 10, T0 + 5 * WEEK_MS),
  ];
  const records = [rec(T0 + DAY_MS), rec(T0 + 20 * DAY_MS), rec(NOW - 2 * HOUR_MS)];

  function run(extra: Partial<Parameters<typeof runBacktest>[0]> = {}) {
    const seen: { at: number; lastRecord: number; lastSnapshot: number }[] = [];
    const report = runBacktest({
      limitThreshold: 95,
      now: NOW,
      planHistory: [],
      records,
      snapshots,
      stepMs: 12 * HOUR_MS,
      timeZone: 'UTC',
      weekLimitThreshold: 98,
      weeks: 2,
      summarize: (input: SummaryInput) => {
        seen.push({
          at: input.now,
          lastRecord: Math.max(...input.records.map(r => Date.parse(r.ts))),
          lastSnapshot: Math.max(...input.snapshots.map(s => Date.parse(s.ts))),
        });
        return {
          current: {
            forecast: { high: 60, low: 20, median: 40, method: 'calibrated' },
            resetsAt: new Date(reset3).toISOString(),
            weekly: 5,
          },
        } as never;
      },
      ...extra,
    });
    return { report, seen };
  }

  it('gives each replay only the data before its instant', () => {
    const { seen } = run();
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call.lastRecord).toBeLessThanOrEqual(call.at);
      expect(call.lastSnapshot).toBeLessThanOrEqual(call.at);
    }
  });

  it('replays from `weeks` back to now at the step', () => {
    const { seen } = run();
    expect(seen[0]!.at).toBe(NOW - 2 * WEEK_MS);
    expect(seen.at(-1)!.at).toBeLessThan(NOW);
    expect(seen[1]!.at - seen[0]!.at).toBe(12 * HOUR_MS);
  });

  it('aligns the instants to the step, so two runs a few minutes apart replay the same ones', () => {
    const first = run({ now: NOW + 7 * 60_000 }).seen.map(call => call.at);
    const second = run({ now: NOW + 41 * 60_000 }).seen.map(call => call.at);
    expect(first).toEqual(second);
    expect(first.every(at => at % (12 * HOUR_MS) === 0)).toBe(true);
  });

  it('scores forecasts against the final of their window', () => {
    const { report } = run();
    const weekly = report.scores.find(s => s.kind === 'weekly' && s.lead === 'all')!;
    expect(weekly.medianAbsError).toBe(0);
    expect(weekly.coverage).toBe(1);
  });

  it('counts windows left out for lack of a final value', () => {
    const { report } = run({ snapshots: [snap(NOW - HOUR_MS, 10, T0 + 5 * WEEK_MS)] });
    expect(report.scores.filter(s => s.kind === 'weekly')).toHaveLength(0);
    expect(report.leftOut.weekly).toBe(1);
  });

  it('leaves out neither a window still running nor its forecasts', () => {
    // The only window resets after `now`: it has no final value yet, which is not a missing reading.
    const { report } = run({ snapshots: [snap(NOW - HOUR_MS, 10, NOW + WEEK_MS)], summarize: () => ({
      current: { forecast: { high: 60, low: 20, median: 40, method: 'calibrated' }, resetsAt: new Date(NOW + WEEK_MS).toISOString(), weekly: 5 },
    }) as never });
    expect(report.scores).toHaveLength(0);
    expect(report.leftOut.weekly).toBe(0);
  });

  it('matches a window whose reset time differs by a minute of rounding', () => {
    const { report } = run({ summarize: () => ({
      current: { forecast: { high: 60, low: 20, median: 40, method: 'calibrated' }, resetsAt: new Date(reset3 + 60_000).toISOString(), weekly: 5 },
    }) as never });
    expect(report.scores.find(s => s.kind === 'weekly' && s.lead === 'all')!.medianAbsError).toBe(0);
  });

  it('orders readings by time when timestamps differ in format', () => {
    const mixed = [
      { ...snap(NOW - 3 * HOUR_MS, 10, T0 + 5 * WEEK_MS), ts: new Date(NOW - 3 * HOUR_MS + 500).toISOString() },
      { ...snap(NOW - 3 * HOUR_MS, 11, T0 + 5 * WEEK_MS), ts: new Date(NOW - 3 * HOUR_MS).toISOString().replace('.000Z', 'Z') },
    ];
    const { seen } = run({ snapshots: mixed });
    for (const call of seen)
      expect(call.lastSnapshot).toBeLessThanOrEqual(call.at);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify({ records, snapshots });
    run();
    expect(JSON.stringify({ records, snapshots })).toBe(before);
  });
});

describe('formatReport', () => {
  it('prints one line per score with the figures and the windows left out', () => {
    const scores = scoreSamples([sample({ final: 100, median: 100 })], { fiveHour: 95, weekly: 98 });
    const text = formatReport({ leftOut: { fiveHour: 2, weekly: 3 }, scores });
    expect(text).toContain('weekly');
    expect(text).toContain('calibrated');
    expect(text).toContain('3 weekly');
    expect(text).toContain('2 5-hour');
  });

  it('says so when there is nothing to score', () => {
    expect(formatReport({ leftOut: { fiveHour: 0, weekly: 0 }, scores: [] })).toContain('No forecast');
  });
});
