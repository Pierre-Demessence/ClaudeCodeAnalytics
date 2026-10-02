import { describe, expect, it } from 'vitest';

import { DAY_MS } from './calibration.ts';
import { forecastWeek } from './forecast.ts';

const resetsAt = Date.parse('2026-10-07T20:00:00Z');

describe('forecastWeek', () => {
  it('projects with the calibrated ratio and the daily cost spread', () => {
    const forecast = forecastWeek({
      asOf: resetsAt - 4 * DAY_MS,
      dailyCosts: [10, 20, 30, 40, 50],
      k: 0.5,
      resetsAt,
      weekly: 30,
    })!;
    // Median $30/day × 0.5 %/$ × 4 days = 60 points.
    expect(forecast.method).toBe('calibrated');
    expect(forecast.median).toBeCloseTo(90);
    expect(forecast.low).toBeCloseTo(70);
    expect(forecast.high).toBeCloseTo(110);
    expect(forecast.capAt).toBeUndefined();
  });

  it('gives the time the median projection hits the cap', () => {
    const now = resetsAt - 4 * DAY_MS;
    const forecast = forecastWeek({ asOf: now, dailyCosts: [40], k: 0.5, resetsAt, weekly: 60 })!;
    // 20 points per day from 60 % reaches 100 % after 2 days.
    expect(forecast.capAt).toBe(now + 2 * DAY_MS);
  });

  it('falls back to the current window trend without a calibration', () => {
    const now = resetsAt - 5 * DAY_MS; // 2 days into the window
    const forecast = forecastWeek({ asOf: now, dailyCosts: [], resetsAt, weekly: 20 })!;
    expect(forecast.method).toBe('trend');
    expect(forecast.median).toBeCloseTo(70);
  });

  it('declines to forecast in the first hours of a window without a calibration', () => {
    expect(forecastWeek({ asOf: resetsAt - 7 * DAY_MS + 3_600_000, dailyCosts: [], resetsAt, weekly: 2 })).toBeUndefined();
  });

  it('reports a cap already reached', () => {
    const now = resetsAt - DAY_MS;
    expect(forecastWeek({ asOf: now, dailyCosts: [10], k: 1, resetsAt, weekly: 100 })!.capAt).toBe(now);
  });
});
