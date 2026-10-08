// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { activeByFamily, familyPaces } from './activeTime.ts';
import { HOUR_MS } from './calibration.ts';

const MINUTE_MS = 60_000;
const START = Date.parse('2026-10-01T10:00:00Z');

/** 1M output tokens: $15 on Sonnet 4.6, $20 on Opus 5.5, $5 on Haiku 4.5. */
function record(minute: number, model = 'claude-sonnet-4-6'): UsageRecord {
  return {
    cacheRead: 0,
    cacheWrite1h: 0,
    cacheWrite5m: 0,
    input: 0,
    key: `${model}${minute}`,
    model,
    output: 1_000_000,
    project: 'p',
    ts: new Date(START + minute * MINUTE_MS).toISOString(),
  };
}

const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-4-5';
const END = START + 24 * HOUR_MS;

describe('activeByFamily', () => {
  it('credits the gap before a message to that message\'s family', () => {
    const byFamily = activeByFamily([record(0), record(10, OPUS), record(20)], START, END);
    expect(byFamily.get('opus')).toMatchObject({ activeMs: 10 * MINUTE_MS, cost: 20 });
    expect(byFamily.get('sonnet')).toMatchObject({ activeMs: 10 * MINUTE_MS, cost: 30 });
  });

  it('counts the cost of the first message without active time', () => {
    expect(activeByFamily([record(0)], START, END).get('sonnet')).toMatchObject({ activeMs: 0, cost: 15 });
  });

  it('leaves out gaps longer than the idle threshold', () => {
    const byFamily = activeByFamily([record(0), record(120, OPUS)], START, END);
    expect(byFamily.get('opus')).toMatchObject({ activeMs: 0, cost: 20 });
  });

  it('merges sessions on one timeline', () => {
    // Out of order, as parallel sessions write them.
    const byFamily = activeByFamily([record(10), record(0), record(5)], START, END);
    expect(byFamily.get('sonnet')!.activeMs).toBe(10 * MINUTE_MS);
  });

  it('ignores records outside the range', () => {
    const byFamily = activeByFamily([record(-30), record(0), record(10), record(70)], START, START + HOUR_MS);
    expect(byFamily.get('sonnet')).toMatchObject({ activeMs: 10 * MINUTE_MS, cost: 30 });
  });

  it('remembers the latest model of each family', () => {
    const byFamily = activeByFamily([record(0, 'claude-opus-4-7'), record(5, OPUS)], START, END);
    expect(byFamily.get('opus')!.model).toBe(OPUS);
  });

  it('keeps the latest priced model when the newest one has no price', () => {
    const byFamily = activeByFamily([record(0, OPUS), record(5, 'claude-opus-4-5')], START, END);
    expect(byFamily.get('opus')!.model).toBe(OPUS);
  });

  it('costs an unpriced model at zero', () => {
    expect(activeByFamily([record(0, 'mystery-1'), record(5, 'mystery-1')], START, END).get('other')).toMatchObject({ activeMs: 5 * MINUTE_MS, cost: 0 });
  });
});

describe('familyPaces', () => {
  // 3 h of Sonnet every 10 minutes: $285 over 3 active hours = $95/h.
  const sonnet = Array.from({ length: 19 }, (_, i) => record(i * 10));
  // Then 20 minutes of Opus: too little to measure.
  const opus = [record(190, OPUS), record(200, OPUS)];
  const byFamily = (paces: ReturnType<typeof familyPaces>) => Object.fromEntries(paces.map(p => [p.family, p]));

  it('measures a family with enough active time', () => {
    const sonnetPace = byFamily(familyPaces([...sonnet, ...opus], START, END)).sonnet!;
    expect(sonnetPace.pace).toBeCloseTo(95);
    expect(sonnetPace.lowConfidence).toBeUndefined();
  });

  it('estimates a thin family from the pooled pace and its price', () => {
    const opusPace = byFamily(familyPaces([...sonnet, ...opus], START, END)).opus!;
    // Pooled: $325 over 200 active minutes = $97.5/h. Active-time-weighted output price: (180 × 15 + 20 × 20) / 200 = $15.5/MTok.
    expect(opusPace.pace).toBeCloseTo(97.5 * 20 / 15.5);
    expect(opusPace.lowConfidence).toBe(true);
  });

  it('gives a family seen once an estimate too', () => {
    const haiku = byFamily(familyPaces([...sonnet, record(500, HAIKU)], START, END)).haiku!;
    expect(haiku.lowConfidence).toBe(true);
    expect(haiku.pace).toBeGreaterThan(0);
  });

  it('lists only families present, none without active time or without a price', () => {
    expect(Object.keys(byFamily(familyPaces(sonnet, START, END)))).toEqual(['sonnet']);
    expect(familyPaces([], START, END)).toEqual([]);
    expect(familyPaces([record(0, 'mystery-1'), record(5, 'mystery-1')], START, END)).toEqual([]);
  });

  it('lists families in a fixed order', () => {
    const families = familyPaces([...sonnet, ...opus, record(500, HAIKU)], START, END).map(p => p.family);
    expect(families).toEqual(['opus', 'sonnet', 'haiku']);
  });
});
