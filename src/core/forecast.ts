import { quantile, seeded } from './stats.ts';

export interface WindowForecast {
  /** When the median projection reaches 100 %, if before reset. */
  capAt?: number;
  /** Projected % at reset: high, low and median. May exceed 100. */
  high: number;
  low: number;
  median: number;
  /**
   * `calibrated`: typical cost pace × ratio; `trend`: this window's own pace;
   * `typical`: the final % of past windows, before the trend is usable.
   */
  method: 'calibrated' | 'trend' | 'typical';
}

export interface ForecastInput {
  /** Time at which `used` holds: the projection starts there. */
  asOf: number;
  /** Calibrated % per dollar, when available. */
  k?: number;
  /**
   * Time from the window start after which the window's own pace (used % over the
   * time elapsed) replaces the typical pace; before it, the two blend linearly.
   * The band keeps the spread of the typical pace around the blend. With `resampleSum` only.
   */
  ownPaceAfterMs?: number;
  /** Recent costs per `sampleMs`, idle periods included: the spread of the typical pace. */
  paceSamples: readonly number[];
  /**
   * Each sample is one independent period, so the cost over the periods left is
   * resampled as a sum of samples, not one sample times their count. Calibrated only.
   */
  resampleSum?: boolean;
  resetsAt: number;
  sampleMs: number;
  /** Final % of past windows (25th, 50th, 75th percentile), for the `typical` method. */
  typical?: { high: number; low: number; median: number };
  /** Used % at `asOf`. */
  used: number;
  windowMs: number;
}

/** Trend forecasts before this share of the window has passed are noise: half a day of a week, about 20 minutes of 5 hours. */
const MIN_TREND_SHARE = 1 / 14;
/** Bootstrap resamples of the sum over the periods left. */
const RESAMPLES = 1000;
/** Fixed seed: the same data gives the same forecast on every refresh. */
const RESAMPLE_SEED = 20_261_026;

/**
 * Cost over `periodsLeft` periods (25th, 50th, 75th percentile): each resample sums
 * whole periods drawn with replacement, plus the fraction of one more draw.
 */
function resampledSums(samples: readonly number[], periodsLeft: number): [number, number, number] {
  const random = seeded(RESAMPLE_SEED);
  const draw = () => samples[Math.floor(random() * samples.length)]!;
  const whole = Math.floor(periodsLeft);
  const fraction = periodsLeft - whole;
  const sums: number[] = [];
  for (let i = 0; i < RESAMPLES; i++) {
    let sum = 0;
    for (let j = 0; j < whole; j++)
      sum += draw();
    if (fraction > 0)
      sum += fraction * draw();
    sums.push(sum);
  }
  return [0.25, 0.5, 0.75].map(q => quantile(sums, q)!) as [number, number, number];
}

/**
 * Moves the centre of the typical rates toward the window's own pace (`used` over the
 * `elapsed` periods), fully once `ownAfter` periods have passed. The spread around the
 * centre stays the typical one, floored at 0, so the band does not collapse to a line.
 */
function blendOwnPace(typical: [number, number, number], used: number, elapsed: number, ownAfter: number): [number, number, number] {
  const ownRate = elapsed > 0 ? used / elapsed : 0;
  const weight = ownAfter > 0 ? Math.min(1, elapsed / ownAfter) : 1;
  const center = weight * ownRate + (1 - weight) * typical[1];
  return typical.map(rate => Math.max(0, center + rate - typical[1])) as [number, number, number];
}

/** A past window's final %, never below what is already used. No cap time: past weeks give no pace. */
function typicalForecast(typical: NonNullable<ForecastInput['typical']>, used: number, asOf: number): WindowForecast {
  const forecast: WindowForecast = {
    high: Math.max(used, typical.high),
    low: Math.max(used, typical.low),
    median: Math.max(used, typical.median),
    method: 'typical',
  };
  if (used >= 100)
    forecast.capAt = asOf;
  return forecast;
}

/** Projects a limit window (weekly or 5-hour) to its reset. */
export function forecastWindow({ asOf, k, ownPaceAfterMs, paceSamples, resampleSum, resetsAt, sampleMs, typical, used, windowMs }: ForecastInput): WindowForecast | undefined {
  const periodsLeft = Math.max(0, (resetsAt - asOf) / sampleMs);
  let method: WindowForecast['method'];
  let rates: [number, number, number];

  if (k !== undefined && paceSamples.length > 0 && resampleSum) {
    method = 'calibrated';
    // As rates per period, so the projection and the cap time below stay shared; no periods left projects nothing.
    rates = periodsLeft > 0
      ? resampledSums(paceSamples, periodsLeft).map(sum => sum / periodsLeft * k) as [number, number, number]
      : [0, 0, 0];
    if (ownPaceAfterMs !== undefined && periodsLeft > 0)
      rates = blendOwnPace(rates, used, Math.max(0, asOf - (resetsAt - windowMs)) / sampleMs, ownPaceAfterMs / sampleMs);
  }
  else if (k !== undefined && paceSamples.length > 0) {
    method = 'calibrated';
    rates = [0.25, 0.5, 0.75].map(q => quantile(paceSamples, q)! * k) as [number, number, number];
  }
  else {
    const elapsed = asOf - (resetsAt - windowMs);
    if (elapsed < windowMs * MIN_TREND_SHARE)
      return typical && typicalForecast(typical, used, asOf);
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
