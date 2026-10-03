import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { costParts, messageCost, priceFor, sonnetSaving } from './pricing.ts';

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

describe('costParts', () => {
  it('prices each token kind separately, fast mode included', () => {
    expect(costParts(base)).toEqual({ cacheRead: 0.2, cacheWrite1h: 8, cacheWrite5m: 5, input: 4, output: 20 });
    expect(costParts({ ...base, speed: 'fast' })?.cacheWrite1h).toBe(16);
  });

  it('is undefined for unknown models', () => {
    expect(costParts({ ...base, model: 'claude-unknown-9' })).toBeUndefined();
  });
});

describe('sonnetSaving', () => {
  it('is the Opus cost minus the same tokens at the newest Sonnet price', () => {
    // Sonnet 5.5: 2 input + 10 output + 2.5 (1.25× write) + 4 (2× write) + 0.2 read = 18.7, against Opus 5.5's 37.2.
    expect(sonnetSaving(base)).toBeCloseTo(18.5);
  });

  it('drops the fast-mode surcharge, which Sonnet does not have', () => {
    expect(sonnetSaving({ ...base, speed: 'fast' })).toBeCloseTo(74.4 - 18.7);
  });

  it('is zero for other families and unknown models', () => {
    expect(sonnetSaving({ ...base, model: 'claude-sonnet-5-5' })).toBe(0);
    expect(sonnetSaving({ ...base, model: 'claude-haiku-4-5-20251001' })).toBe(0);
    expect(sonnetSaving({ ...base, model: 'claude-opus-9' })).toBe(0);
  });
});
