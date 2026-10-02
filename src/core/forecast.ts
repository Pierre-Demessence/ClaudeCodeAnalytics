import { quantile } from './stats.ts';

export interface WindowForecast {
  /** When the median projection reaches 100 %, if before reset. */
  capAt?: number;
  /** Projected % at reset: high, low and median. May exceed 100. */
  high: number;
  low: number;
  median: number;
  /** `calibrated`: typical cost pace × ratio; `trend`: this window's own pace. */
  method: 'calibrated' | 'trend';
}

export interface ForecastInput {
  /** Time at which `used` holds: the projection starts there. */
  asOf: number;
  /** Calibrated % per dollar, when available. */
  k?: number;
  /** Recent costs per `sampleMs`, idle periods included: the spread of the typical pace. */
  paceSamples: readonly number[];
  resetsAt: number;
  sampleMs: number;
  /** Used % at `asOf`. */
  used: number;
  windowMs: number;
}

/** Trend forecasts before this share of the window has passed are noise: half a day of a week, about 20 minutes of 5 hours. */
const MIN_TREND_SHARE = 1 / 14;

/** Projects a limit window (weekly or 5-hour) to its reset. */
export function forecastWindow({ asOf, k, paceSamples, resetsAt, sampleMs, used, windowMs }: ForecastInput): WindowForecast | undefined {
  const periodsLeft = Math.max(0, (resetsAt - asOf) / sampleMs);
  let method: WindowForecast['method'];
  let rates: [number, number, number];

  if (k !== undefined && paceSamples.length > 0) {
    method = 'calibrated';
    rates = [0.25, 0.5, 0.75].map(q => quantile(paceSamples, q)! * k) as [number, number, number];
  }
  else {
    const elapsed = asOf - (resetsAt - windowMs);
    if (elapsed < windowMs * MIN_TREND_SHARE)
      return undefined;
    method = 'trend';
    const rate = used / (elapsed / sampleMs);
    rates = [rate, rate, rate];
  }

  const [low, median, high] = rates.map(rate => used + rate * periodsLeft) as [number, number, number];
  const forecast: WindowForecast = { high, low, median, method };
  if (used >= 100)
    forecast.capAt = asOf;
  else if (median >= 100)
    forecast.capAt = asOf + (100 - used) / rates[1] * sampleMs;
  return forecast;
}
