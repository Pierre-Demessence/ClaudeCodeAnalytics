import { describe, expect, it } from 'vitest';

import type { Snapshot } from './types.ts';

import { calibrationPoints, fitRatio, fiveHourCalibrationPoints } from './calibration.ts';

const DAY = 86_400_000;

function snap(ts: string, weekly: number, claudeCodeShare?: number): Snapshot {
  return { claudeCodeShare, source: 'endpoint', ts, weekly, weeklyResetsAt: '2026-10-07T20:00:00.000Z' };
}

describe('calibrationPoints', () => {
  it('pairs the Claude Code part of each reading with the cost since the window started', () => {
    const costBetween = (from: number, to: number) => (to - from) / DAY * 10; // $10 per day
    const points = calibrationPoints([snap('2026-10-01T20:00:00Z', 40, 50)], costBetween);
    expect(points).toEqual([{ cost: 10, ts: Date.parse('2026-10-01T20:00:00Z'), usage: 20 }]);
  });

  it('skips windows that started before the first imported message', () => {
    const points = calibrationPoints([snap('2026-10-02T00:00:00Z', 30)], () => 5, Date.parse('2026-10-01T00:00:00Z'));
    expect(points).toEqual([]);
  });

  it('uses the whole reading when the share is unknown, and skips coarse readings', () => {
    const costBetween = () => 5;
    const points = calibrationPoints([snap('2026-10-02T00:00:00Z', 30), snap('2026-10-01T00:00:00Z', 4)], costBetween);
    expect(points.map(p => p.usage)).toEqual([30]);
  });
});

describe('fiveHourCalibrationPoints', () => {
  const costBetween = (from: number, to: number) => (to - from) / 3_600_000 * 4; // $4 per hour
  const reading = (fiveHour: number | undefined, fiveHourResetsAt?: string): Snapshot =>
    ({ fiveHour, fiveHourResetsAt, source: 'endpoint', ts: '2026-10-02T10:00:00.000Z', weekly: 50, weeklyResetsAt: '2026-10-07T20:00:00.000Z' });

  it('pairs the 5-hour % with the cost since that window started', () => {
    // The window ends at 12:00, so it opened at 07:00: 3 hours, $12, before the reading.
    expect(fiveHourCalibrationPoints([reading(30, '2026-10-02T12:00:00.000Z')], costBetween))
      .toEqual([{ cost: 12, ts: Date.parse('2026-10-02T10:00:00Z'), usage: 30 }]);
  });

  it('skips readings without a reset time, coarse readings and windows before the data', () => {
    const points = fiveHourCalibrationPoints(
      [reading(30), reading(undefined), reading(3, '2026-10-02T12:00:00.000Z'), reading(30, '2026-10-02T12:00:00.000Z')],
      costBetween,
      Date.parse('2026-10-02T08:00:00Z'),
    );
    expect(points).toEqual([]);
  });
});

describe('fitRatio', () => {
  const now = Date.parse('2026-10-07T00:00:00Z');

  it('recovers an exact ratio', () => {
    const points = [10, 20, 40].map(cost => ({ cost, ts: now, usage: cost * 0.5 }));
    const fit = fitRatio(points, now)!;
    expect(fit.k).toBeCloseTo(0.5);
    expect(fit.rmse).toBeCloseTo(0);
    expect(fit.n).toBe(3);
  });

  it('reports the time of its oldest reading', () => {
    const points = [3, 1, 2].map(i => ({ cost: i, ts: now - i * DAY, usage: i }));
    expect(fitRatio(points, now)!.from).toBe(new Date(now - 3 * DAY).toISOString());
  });

  it('weights recent readings more', () => {
    const old = { cost: 10, ts: now - 60 * DAY, usage: 100 }; // k = 10, four half-lives ago
    const recent = [{ cost: 10, ts: now, usage: 10 }, { cost: 20, ts: now, usage: 20 }]; // k = 1
    expect(fitRatio([old, ...recent], now)!.k).toBeLessThan(2);
  });

  it('needs at least three readings', () => {
    expect(fitRatio([{ cost: 1, ts: now, usage: 1 }, { cost: 2, ts: now, usage: 2 }], now)).toBeUndefined();
  });
});
