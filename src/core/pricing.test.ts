import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { messageCost, priceFor } from './pricing.ts';

const base: UsageRecord = {
  cacheRead: 1_000_000,
  cacheWrite1h: 1_000_000,
  cacheWrite5m: 1_000_000,
  input: 1_000_000,
  key: 'k',
  model: 'claude-opus-5-5',
  output: 1_000_000,
  project: 'p',
  ts: '2026-10-01T00:00:00Z',
};

describe('priceFor', () => {
  it('matches the longest model prefix, including dated ids', () => {
    expect(priceFor('claude-opus-5-5')?.input).toBe(4);
    expect(priceFor('claude-opus-5')?.input).toBe(5);
    expect(priceFor('claude-haiku-4-5-20251001')?.input).toBe(1);
  });

  it('returns undefined for unknown models', () => {
    expect(priceFor('claude-unknown-9')).toBeUndefined();
  });
});

describe('messageCost', () => {
  it('prices every token kind at its own rate', () => {
    // Opus 5.5: 4 input + 20 output + 5 (1.25× write) + 8 (2× write) + 0.2 read.
    expect(messageCost(base)).toEqual({ cost: 37.2, known: true });
  });

  it('doubles the price in fast mode', () => {
    expect(messageCost({ ...base, speed: 'fast' }).cost).toBeCloseTo(74.4);
  });

  it('flags unknown models with zero cost', () => {
    expect(messageCost({ ...base, model: 'claude-unknown-9' })).toEqual({ cost: 0, known: false });
  });
});
