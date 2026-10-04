// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { activeHourlyPace, activeTimeLeft } from './activePace.ts';
import { HOUR_MS } from './calibration.ts';
import { messageCost } from './pricing.ts';

const MINUTE_MS = 60_000;
const START = Date.parse('2026-10-01T10:00:00Z');

function record(minute: number): UsageRecord {
  return {
    cacheRead: 0,
    cacheWrite1h: 0,
    cacheWrite5m: 0,
    input: 0,
    key: `m${minute}`,
    model: 'claude-sonnet-4-6',
    output: 1_000_000,
    project: 'p',
    ts: new Date(START + minute * MINUTE_MS).toISOString(),
  };
}

const COST = messageCost(record(0)).cost;

describe('activeHourlyPace', () => {
  it('uses a priced model', () => {
    expect(COST).toBe(15);
  });

  it('divides the cost by the time between messages', () => {
    // 3 messages over 25 minutes of active time; a gap of exactly the threshold still counts.
    const pace = activeHourlyPace([record(0), record(10), record(25)], START, START + HOUR_MS);
    expect(pace).toBeCloseTo(3 * COST / (25 / 60));
  });

  it('leaves out gaps longer than the idle threshold', () => {
    // 10 + 10 active minutes; the 2-hour gap is idle.
    const pace = activeHourlyPace([record(0), record(10), record(130), record(140)], START, START + 3 * HOUR_MS);
    expect(pace).toBeCloseTo(4 * COST / (20 / 60));
  });

  it('merges parallel sessions on one timeline', () => {
    const pace = activeHourlyPace([record(10), record(0), record(5)], START, START + HOUR_MS);
    expect(pace).toBeCloseTo(3 * COST / (10 / 60));
  });

  it('ignores records outside the range', () => {
    const pace = activeHourlyPace([record(-30), record(0), record(10), record(70)], START, START + HOUR_MS);
    expect(pace).toBeCloseTo(2 * COST / (10 / 60));
  });

  it('is undefined without active time', () => {
    expect(activeHourlyPace([], START, START + HOUR_MS)).toBeUndefined();
    expect(activeHourlyPace([record(0), record(120)], START, START + 3 * HOUR_MS)).toBeUndefined();
  });

  it('is undefined when every message is unpriced', () => {
    const unpriced = [record(0), record(10)].map(r => ({ ...r, model: 'unknown-model' }));
    expect(activeHourlyPace(unpriced, START, START + HOUR_MS)).toBeUndefined();
  });
});

describe('activeTimeLeft', () => {
  it('turns the % left into active time at the given pace', () => {
    // 20 % left at 2 %/$ is $10; at $5/hour, 2 hours.
    expect(activeTimeLeft({ k: 2, pace: 5, used: 80 })).toBe(2 * HOUR_MS);
  });

  it('is undefined at the limit or without a calibration or pace', () => {
    expect(activeTimeLeft({ k: 2, pace: 5, used: 100 })).toBeUndefined();
    expect(activeTimeLeft({ k: undefined, pace: 5, used: 50 })).toBeUndefined();
    expect(activeTimeLeft({ k: 2, pace: undefined, used: 50 })).toBeUndefined();
    expect(activeTimeLeft({ k: 0, pace: 5, used: 50 })).toBeUndefined();
    expect(activeTimeLeft({ k: 2, pace: 0, used: 50 })).toBeUndefined();
  });
});
