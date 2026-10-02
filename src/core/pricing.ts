import type { UsageRecord } from './types.ts';

/** USD per million tokens. */
export interface ModelPrice {
  cacheRead: number;
  input: number;
  output: number;
}

// Anthropic API list prices (checked 2026-10-02). Matched by longest prefix so
// dated ids like `claude-haiku-4-5-20251001` resolve.
const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5': { cacheRead: 1, input: 10, output: 50 },
  'claude-fable-5-1': { cacheRead: 0.25, input: 10, output: 50 },
  'claude-haiku-4-5': { cacheRead: 0.1, input: 1, output: 5 },
  'claude-opus-4-6': { cacheRead: 0.5, input: 5, output: 25 },
  'claude-opus-4-7': { cacheRead: 0.5, input: 5, output: 25 },
  'claude-opus-4-8': { cacheRead: 0.5, input: 5, output: 25 },
  'claude-opus-5': { cacheRead: 0.5, input: 5, output: 25 },
  'claude-opus-5-5': { cacheRead: 0.2, input: 4, output: 20 },
  'claude-sonnet-4-6': { cacheRead: 0.3, input: 3, output: 15 },
  'claude-sonnet-5': { cacheRead: 0.2, input: 2, output: 10 },
  'claude-sonnet-5-5': { cacheRead: 0.2, input: 2, output: 10 },
};

const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
const FAST_MODE = 2;

export function priceFor(model: string): ModelPrice | undefined {
  let best: string | undefined;
  for (const prefix of Object.keys(PRICES)) {
    if (model.startsWith(prefix) && (!best || prefix.length > best.length))
      best = prefix;
  }
  return best ? PRICES[best] : undefined;
}

/** API-equivalent cost in USD; `known` is false when the model has no price. */
export function messageCost(record: UsageRecord): { cost: number; known: boolean } {
  const price = priceFor(record.model);
  if (!price)
    return { cost: 0, known: false };
  const perMillion = record.input * price.input
    + record.output * price.output
    + record.cacheWrite5m * price.input * CACHE_WRITE_5M
    + record.cacheWrite1h * price.input * CACHE_WRITE_1H
    + record.cacheRead * price.cacheRead;
  const multiplier = record.speed === 'fast' ? FAST_MODE : 1;
  return { cost: perMillion / 1_000_000 * multiplier, known: true };
}
