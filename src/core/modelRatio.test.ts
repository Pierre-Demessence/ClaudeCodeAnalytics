// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { DAY_MS } from './calibration.ts';
import { modelRatios } from './modelRatio.ts';

const MINUTE_MS = 60_000;
const START = Date.parse('2026-10-01T10:00:00Z');
const FROM = START - DAY_MS;
const TO = START + 30 * DAY_MS;

const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-4-5';

/** An hour of messages every 10 minutes from `startMinute` of day `day`: 7 messages, 60 active minutes. */
function hour(day: number, startMinute: number, model: string, output = 1_000_000): UsageRecord[] {
  return Array.from({ length: 7 }, (_, i) => {
    const ts = new Date(START + day * DAY_MS + (startMinute + i * 10) * MINUTE_MS).toISOString();
    return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 0, key: `${model}${ts}`, model, output, project: 'p', ts };
  });
}

/** Sonnet at $15 per message and Opus at $30 (1.5M output tokens at $20/MTok), over `days` days. */
function days(days: number[], opusOutput = 1_500_000): UsageRecord[] {
  return days.flatMap(day => [...hour(day, 0, SONNET), ...hour(day, 120, OPUS, opusOutput)]);
}

const run = (records: UsageRecord[]) => modelRatios(records, FROM, TO, 'UTC');

describe('modelRatios', () => {
  it('gives how many hours of the lighter model one hour of the heavier one equals', () => {
    // Opus $210/h, Sonnet $105/h.
    const [ratio] = run(days([0, 1, 2, 3, 4]));
    expect(ratio).toMatchObject({ from: 'opus', to: 'sonnet' });
    expect(ratio!.hours).toBeCloseTo(2);
  });

  it('splits the ratio into price per token and tokens per active hour', () => {
    const [ratio] = run(days([0, 1, 2, 3, 4]));
    // $20/MTok against $15/MTok, and 1.5 times the tokens per hour.
    expect(ratio!.price).toBeCloseTo(20 / 15);
    expect(ratio!.volume).toBeCloseTo(1.5);
    expect(ratio!.price * ratio!.volume).toBeCloseTo(ratio!.hours);
  });

  it('collapses the range when every day agrees', () => {
    const [ratio] = run(days([0, 1, 2, 3, 4]));
    expect(ratio!.low).toBeCloseTo(2);
    expect(ratio!.high).toBeCloseTo(2);
  });

  it('widens the range when days differ, repeatably', () => {
    const mixed = [...days([0, 1], 1_000_000), ...days([2, 3], 2_000_000), ...days([4], 3_000_000)];
    const first = run(mixed)[0]!;
    expect(first.low).toBeLessThan(first.hours);
    expect(first.high).toBeGreaterThan(first.hours);
    expect(run(mixed)[0]).toEqual(first);
  });

  it('compares only the days both models were used', () => {
    // Three days of Sonnet alone, at three times the cost per message, must not move the ratio.
    const sonnetOnly = [5, 6, 7].flatMap(day => hour(day, 0, SONNET, 3_000_000));
    const [ratio] = run([...days([0, 1, 2, 3]), ...sonnetOnly]);
    expect(ratio!.hours).toBeCloseTo(2);
    expect(ratio!.lowConfidence).toBeUndefined();
  });

  it('uses every day and says so when the models share too few days', () => {
    // Opus on 2 days (3 h of active time), Sonnet on 5.
    const records = [...days([0, 1]), ...[2, 3, 4].flatMap(day => hour(day, 0, SONNET))];
    const [ratio] = run(records);
    expect(ratio).toBeDefined();
    expect(ratio!.lowConfidence).toBe(true);
  });

  it('puts the model that is heavier on the compared days first, so hours is never below 1', () => {
    // Opus has the higher pace overall (three Opus-only days at $840/h), but on the three shared days Sonnet is heavier ($315/h against $210/h).
    const shared = [0, 1, 2].flatMap(day => [...hour(day, 0, SONNET, 3_000_000), ...hour(day, 120, OPUS, 1_500_000)]);
    const opusOnly = [3, 4, 5].flatMap(day => hour(day, 120, OPUS, 6_000_000));
    const [ratio] = run([...shared, ...opusOnly]);
    expect(ratio).toMatchObject({ from: 'sonnet', to: 'opus' });
    expect(ratio!.hours).toBeCloseTo(1.5);
    expect(ratio!.low).toBeGreaterThanOrEqual(1);
    expect(ratio!.price * ratio!.volume).toBeCloseTo(ratio!.hours);
  });

  it('gives no ratio for a model with too little data', () => {
    // One hour of Opus is under the 2 h needed to measure a pace.
    expect(run([...days([0, 1, 2, 3, 4]).filter(r => r.model !== OPUS), ...hour(0, 120, OPUS)])).toEqual([]);
  });

  it('gives no ratio for a model used on a single day', () => {
    // Plenty of active time, but all on one day: nothing to resample.
    const longDay = Array.from({ length: 3 }, (_, i) => hour(0, 120 + i * 70, OPUS)).flat();
    expect(run([...days([0, 1, 2, 3, 4]).filter(r => r.model !== OPUS), ...longDay])).toEqual([]);
  });

  it('gives no ratio with a single model or none', () => {
    expect(run(days([0, 1, 2, 3, 4]).filter(r => r.model === SONNET))).toEqual([]);
    expect(run([])).toEqual([]);
  });

  it('lists every pair, the heavier model first', () => {
    const haiku = [0, 1, 2, 3, 4].flatMap(day => hour(day, 240, HAIKU));
    const pairs = run([...days([0, 1, 2, 3, 4]), ...haiku]).map(r => `${r.from}>${r.to}`);
    expect(pairs).toEqual(['opus>sonnet', 'opus>haiku', 'sonnet>haiku']);
  });
});
