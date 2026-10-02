import { describe, expect, it } from 'vitest';

import { DAY_MS, WEEK_MS } from './calibration.ts';
import { forecastWindow } from './forecast.ts';

const resetsAt = Date.parse('2026-10-07T20:00:00Z');
const week = { resetsAt, sampleMs: DAY_MS, windowMs: WEEK_MS };
const HOUR_MS = 3_600_000;

describe('forecastWindow', () => {
  it('projects with the calibrated ratio and the daily cost spread', () => {
    const forecast = forecastWindow({ ...week, asOf: resetsAt - 4 * DAY_MS, k: 0.5, paceSamples: [10, 20, 30, 40, 50], used: 30 })!;
    // Median $30/day × 0.5 %/$ × 4 days = 60 points.
    expect(forecast.method).toBe('calibrated');
    expect(forecast.median).toBeCloseTo(90);
    expect(forecast.low).toBeCloseTo(70);
    expect(forecast.high).toBeCloseTo(110);
    expect(forecast.capAt).toBeUndefined();
  });

  it('gives the time the median projection hits the cap', () => {
    const now = resetsAt - 4 * DAY_MS;
    const forecast = forecastWindow({ ...week, asOf: now, k: 0.5, paceSamples: [40], used: 60 })!;
    // 20 points per day from 60 % reaches 100 % after 2 days.
    expect(forecast.capAt).toBe(now + 2 * DAY_MS);
  });

  it('falls back to the current window trend without a calibration', () => {
    const now = resetsAt - 5 * DAY_MS; // 2 days into the window
    const forecast = forecastWindow({ ...week, asOf: now, paceSamples: [], used: 20 })!;
    expect(forecast.method).toBe('trend');
    expect(forecast.median).toBeCloseTo(70);
  });

  it('declines to forecast in the first hours of a window without a calibration or past weeks', () => {
    expect(forecastWindow({ ...week, asOf: resetsAt - 7 * DAY_MS + HOUR_MS, paceSamples: [], used: 2 })).toBeUndefined();
  });

  it('uses the typical past window in the first hours without a calibration', () => {
    const typical = { high: 80, low: 60, median: 70 };
    const forecast = forecastWindow({ ...week, asOf: resetsAt - 7 * DAY_MS + HOUR_MS, paceSamples: [], typical, used: 2 })!;
    expect(forecast).toEqual({ high: 80, low: 60, median: 70, method: 'typical' });
  });

  it('keeps a typical projection at or above what is already used', () => {
    const typical = { high: 30, low: 10, median: 20 };
    const forecast = forecastWindow({ ...week, asOf: resetsAt - 7 * DAY_MS + HOUR_MS, paceSamples: [], typical, used: 25 })!;
    expect(forecast).toMatchObject({ high: 30, low: 25, median: 25 });
  });

  it('prefers the trend over the typical window once it is usable', () => {
    const forecast = forecastWindow({ ...week, asOf: resetsAt - 5 * DAY_MS, paceSamples: [], typical: { high: 1, low: 1, median: 1 }, used: 20 })!;
    expect(forecast.method).toBe('trend');
  });

  it('reports a cap already reached', () => {
    const now = resetsAt - DAY_MS;
    expect(forecastWindow({ ...week, asOf: now, k: 1, paceSamples: [10], used: 100 })!.capAt).toBe(now);
  });

  it('projects a 5-hour window from hourly pace', () => {
    const now = resetsAt - 2 * HOUR_MS;
    const forecast = forecastWindow({ asOf: now, k: 2, paceSamples: [5, 10, 15], resetsAt, sampleMs: HOUR_MS, used: 70, windowMs: 5 * HOUR_MS })!;
    // Median $10/h × 2 %/$ = 20 points per hour: 100 % after 1.5 hours.
    expect(forecast.median).toBeCloseTo(110);
    expect(forecast.capAt).toBe(now + 1.5 * HOUR_MS);
  });

  it('extrapolates a 5-hour window from its own pace after about 20 minutes', () => {
    const start = resetsAt - 5 * HOUR_MS;
    const fiveHour = { paceSamples: [], resetsAt, sampleMs: HOUR_MS, windowMs: 5 * HOUR_MS };
    expect(forecastWindow({ ...fiveHour, asOf: start + 10 * 60_000, used: 5 })).toBeUndefined();
    // 30 % in the first hour: 150 % at reset, cap after 3h20.
    const forecast = forecastWindow({ ...fiveHour, asOf: start + HOUR_MS, used: 30 })!;
    expect(forecast.median).toBeCloseTo(150);
    expect(forecast.capAt).toBeCloseTo(start + HOUR_MS + 70 / 30 * HOUR_MS);
  });
});
