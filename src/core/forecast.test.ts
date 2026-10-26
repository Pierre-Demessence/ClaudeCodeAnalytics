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

  describe('resampling the sum of the periods left', () => {
    // A day of $100 among idle days: the median day is $0, the mean $20.
    const skewed = { ...week, asOf: resetsAt - 7 * DAY_MS, k: 1, paceSamples: [0, 0, 0, 0, 100], used: 0 };

    it('projects near the sum of the means, not the median day times the days left', () => {
      expect(forecastWindow(skewed)!.median).toBe(0);
      const forecast = forecastWindow({ ...skewed, resampleSum: true })!;
      expect(forecast.method).toBe('calibrated');
      // 7 days at $20 on average: 140 points, in steps of 100 per busy day drawn.
      expect(forecast.median).toBeGreaterThanOrEqual(100);
      expect(forecast.median).toBeLessThanOrEqual(200);
      expect(forecast.low).toBeLessThanOrEqual(forecast.median);
      expect(forecast.median).toBeLessThanOrEqual(forecast.high);
    });

    it('gives the same forecast for the same input', () => {
      expect(forecastWindow({ ...skewed, resampleSum: true })).toEqual(forecastWindow({ ...skewed, resampleSum: true }));
    });

    it('times the cap at the median rate', () => {
      const forecast = forecastWindow({ ...skewed, resampleSum: true, used: 50 })!;
      const rate = (forecast.median - 50) / 7;
      expect(forecast.capAt).toBeCloseTo(skewed.asOf + 50 / rate * DAY_MS);
    });

    it('matches the plain projection for a constant pace, fractions of a period included', () => {
      const asOf = resetsAt - 2.5 * DAY_MS;
      const forecast = forecastWindow({ ...week, asOf, k: 0.5, paceSamples: [20, 20], resampleSum: true, used: 10 })!;
      expect(forecast.median).toBeCloseTo(35);
      expect(forecast.low).toBeCloseTo(35);
      expect(forecast.high).toBeCloseTo(35);
    });

    it('projects nothing beyond what is used at the reset', () => {
      const forecast = forecastWindow({ ...week, asOf: resetsAt, k: 1, paceSamples: [10], resampleSum: true, used: 40 })!;
      expect(forecast).toEqual({ high: 40, low: 40, median: 40, method: 'calibrated' });
    });
  });

  describe('blending in the window\'s own pace', () => {
    const start = resetsAt - WEEK_MS;
    const ownPaceAfterMs = 3 * DAY_MS;
    const base = { ...week, k: 1, paceSamples: [0, 5, 10, 20, 40], resampleSum: true };
    const at = (days: number, used: number, blend = true) =>
      forecastWindow({ ...base, asOf: start + days * DAY_MS, ownPaceAfterMs: blend ? ownPaceAfterMs : undefined, used })!;
    /** Projected points per day left for each of low, median, high. */
    const ratesOf = (forecast: ReturnType<typeof at>, days: number, used: number) =>
      [forecast.low, forecast.median, forecast.high].map(p => (p - used) / (7 - days));

    it('matches the typical pace at the window start', () => {
      expect(at(0, 0)).toEqual(at(0, 0, false));
    });

    it('rests on the window\'s own pace alone from the blend time on', () => {
      // 30 % over 3 days: 10 points a day for the 4 days left.
      expect(at(3, 30).median).toBeCloseTo(70);
      // 60 % over 4 days: 15 points a day for the 3 days left.
      expect(at(4, 60).median).toBeCloseTo(105);
    });

    it('averages the own and typical pace halfway through the blend', () => {
      const typical = ratesOf(at(1.5, 30, false), 1.5, 30)[1]!;
      // 30 % over 1.5 days: 20 points a day.
      expect(ratesOf(at(1.5, 30), 1.5, 30)[1]).toBeCloseTo((20 + typical) / 2);
    });

    it('keeps the typical spread around the blended centre', () => {
      const [low, median, high] = ratesOf(at(4, 60), 4, 60) as [number, number, number];
      const [tLow, tMedian, tHigh] = ratesOf(at(4, 60, false), 4, 60) as [number, number, number];
      expect(high - median).toBeCloseTo(tHigh - tMedian);
      expect(median - low).toBeCloseTo(tMedian - tLow);
      expect(high - low).toBeGreaterThan(0);
    });

    it('floors the band at what is used for an idle week', () => {
      const forecast = at(3.5, 0);
      expect(forecast.low).toBe(0);
      expect(forecast.median).toBe(0);
      expect(forecast.high).toBeGreaterThanOrEqual(0);
      expect(at(3.5, 0, false).median).toBeGreaterThan(0);
    });

    it('gives the same forecast for the same input', () => {
      expect(at(2, 25)).toEqual(at(2, 25));
    });

    it('leaves the forecast without resampling unchanged', () => {
      const input = { ...week, asOf: start + 4 * DAY_MS, k: 1, paceSamples: [10, 20], used: 60 };
      expect(forecastWindow({ ...input, ownPaceAfterMs })).toEqual(forecastWindow(input));
    });
  });

  describe('after a restart inside the window', () => {
    const windowStart = resetsAt - WEEK_MS;
    const startsAt = windowStart + 5 * DAY_MS;

    it('counts the trend from the restart', () => {
      // 10 % in the day since the restart: 10 points a day for the day left.
      const forecast = forecastWindow({ ...week, asOf: startsAt + DAY_MS, paceSamples: [], startsAt, used: 10 })!;
      expect(forecast.method).toBe('trend');
      expect(forecast.median).toBeCloseTo(20);
    });

    it('counts the blend of the own pace from the restart', () => {
      const input = { ...week, k: 1, ownPaceAfterMs: 3 * DAY_MS, paceSamples: [0, 5, 10, 20, 40], resampleSum: true, used: 30 };
      // Without the start, 30 % in 6 days is a pace of 5 a day; from the restart, 30 % in 1 day is 30 a day.
      const whole = forecastWindow({ ...input, asOf: startsAt + DAY_MS })!;
      const restarted = forecastWindow({ ...input, asOf: startsAt + DAY_MS, startsAt })!;
      expect(restarted.median).toBeGreaterThan(whole.median);
    });

    it('scales the typical week to the share of the window left after the restart', () => {
      const typical = { high: 80, low: 60, median: 70 };
      const forecast = forecastWindow({ ...week, asOf: startsAt + HOUR_MS, paceSamples: [], startsAt, typical, used: 1 })!;
      // 2 of 7 days left.
      expect(forecast.method).toBe('typical');
      expect([forecast.low, forecast.median, forecast.high]).toEqual([60 * 2 / 7, 70 * 2 / 7, 80 * 2 / 7].map(value => expect.closeTo(value)));
    });

    it('is unchanged when it starts with the window', () => {
      const input = { ...week, asOf: resetsAt - 5 * DAY_MS, paceSamples: [], used: 20 };
      expect(forecastWindow({ ...input, startsAt: windowStart })).toEqual(forecastWindow(input));
      const typicalInput = { ...week, asOf: windowStart + HOUR_MS, paceSamples: [], typical: { high: 80, low: 60, median: 70 }, used: 2 };
      expect(forecastWindow({ ...typicalInput, startsAt: windowStart })).toEqual(forecastWindow(typicalInput));
    });
  });
});
