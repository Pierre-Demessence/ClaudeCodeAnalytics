import { DAY_MS, WEEK_MS } from './calibration.ts';
import { quantile } from './stats.ts';

export interface WeekForecast {
  /** When the median projection reaches 100 %, if before reset. */
  capAt?: number;
  /** Projected weekly % at reset: high, low and median. May exceed 100. */
  high: number;
  low: number;
  median: number;
  /** `calibrated`: typical daily cost × ratio; `trend`: this window's own pace. */
  method: 'calibrated' | 'trend';
}

export interface ForecastInput {
  /** Time at which `weekly` holds: the projection starts there. */
  asOf: number;
  /** Recent daily costs, zero days included. */
  dailyCosts: readonly number[];
  /** Calibrated % per dollar, when available. */
  k?: number;
  resetsAt: number;
  /** Weekly % at `asOf`. */
  weekly: number;
}

/** Trend forecasts before this much of the window has passed are noise. */
const MIN_TREND_DAYS = 0.5;

export function forecastWeek({ asOf, dailyCosts, k, resetsAt, weekly }: ForecastInput): WeekForecast | undefined {
  const daysLeft = Math.max(0, (resetsAt - asOf) / DAY_MS);
  let method: WeekForecast['method'];
  let rates: [number, number, number];

  if (k !== undefined && dailyCosts.length > 0) {
    method = 'calibrated';
    rates = [0.25, 0.5, 0.75].map(q => quantile(dailyCosts, q)! * k) as [number, number, number];
  }
  else {
    const daysElapsed = (asOf - (resetsAt - WEEK_MS)) / DAY_MS;
    if (daysElapsed < MIN_TREND_DAYS)
      return undefined;
    method = 'trend';
    const rate = weekly / daysElapsed;
    rates = [rate, rate, rate];
  }

  const [low, median, high] = rates.map(rate => weekly + rate * daysLeft) as [number, number, number];
  const forecast: WeekForecast = { high, low, median, method };
  if (weekly >= 100)
    forecast.capAt = asOf;
  else if (median >= 100)
    forecast.capAt = asOf + (100 - weekly) / rates[1] * DAY_MS;
  return forecast;
}
