import type { UsageRecord } from './types.ts';

/** USD per million tokens. */
export interface ModelPrice {
  cacheRead: number;
  input: number;
  output: number;
}

// Anthropic API list prices (checked 2026-10-26). Matched by longest prefix so
// dated ids like `claude-haiku-4-5-20251001` resolve.
const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5': { cacheRead: 1, input: 10, output: 50 },
  'claude-fable-5-1': { cacheRead: 0.25, input: 10, output: 50 },
  'claude-haiku-4-5': { cacheRead: 0.1, input: 1, output: 5 },
  'claude-haiku-5-5': { cacheRead: 0.01, input: 0.1, output: 0.5 },
  'claude-opus-4-6': { cacheRead: 0.5, input: 5, output: 25 },
  'claude-opus-4-7': { cacheRead: 0.5, input: 5, output: 25 },
  'claude-opus-4-8': { cacheRead: 0.5, input: 5, output: 25 },
  'claude-opus-5': { cacheRead: 0.5, input: 5, output: 25 },
  'claude-opus-5-5': { cacheRead: 0.2, input: 4, output: 20 },
  'claude-sonnet-4-6': { cacheRead: 0.3, input: 3, output: 15 },
  'claude-sonnet-5': { cacheRead: 0.2, input: 2, output: 10 },
  'claude-sonnet-5-5': { cacheRead: 0.1, input: 2, output: 10 },
};

/**
 * Models whose request pays higher prices once its prompt (input, cache reads and
 * cache writes) is over `upTo` tokens. Each request is priced on its own.
 */
const LONG_PROMPT_PRICES: Record<string, { price: ModelPrice; upTo: number }> = {
  'claude-haiku-5-5': { price: { cacheRead: 0.05, input: 0.5, output: 2.5 }, upTo: 100_000 },
};

const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
const FAST_MODE = 2;

// Runs per record many times per summary, on a handful of distinct models;
// unknown models are cached too (`undefined`).
const prefixCache = new Map<string, string | undefined>();

/** The longest prefix of a model id in the price table. */
function prefixOf(model: string): string | undefined {
  if (prefixCache.has(model))
    return prefixCache.get(model);
  let best: string | undefined;
  for (const prefix of Object.keys(PRICES)) {
    if (model.startsWith(prefix) && (!best || prefix.length > best.length))
      best = prefix;
  }
  prefixCache.set(model, best);
  return best;
}

/** A model's price: what a request with a short prompt pays. */
export function priceFor(model: string): ModelPrice | undefined {
  const prefix = prefixOf(model);
  return prefix === undefined ? undefined : PRICES[prefix];
}

/** The price a message was billed at: its model's, or the higher one its long prompt pays. */
export function priceOf(record: Pick<UsageRecord, 'cacheRead' | 'cacheWrite1h' | 'cacheWrite5m' | 'input' | 'model'>): ModelPrice | undefined {
  const prefix = prefixOf(record.model);
  if (prefix === undefined)
    return undefined;
  const long = LONG_PROMPT_PRICES[prefix];
  return long && record.input + record.cacheRead + record.cacheWrite5m + record.cacheWrite1h > long.upTo ? long.price : PRICES[prefix];
}

/** API-equivalent cost in USD of each token kind of a message. */
export interface CostParts {
  cacheRead: number;
  cacheWrite1h: number;
  cacheWrite5m: number;
  input: number;
  output: number;
}

function partsAt(record: UsageRecord, price: ModelPrice, fast: boolean): CostParts {
  const usd = (tokens: number, perMillion: number) => tokens * perMillion / 1_000_000 * (fast ? FAST_MODE : 1);
  return {
    cacheRead: usd(record.cacheRead, price.cacheRead),
    cacheWrite1h: usd(record.cacheWrite1h, price.input * CACHE_WRITE_1H),
    cacheWrite5m: usd(record.cacheWrite5m, price.input * CACHE_WRITE_5M),
    input: usd(record.input, price.input),
    output: usd(record.output, price.output),
  };
}

const totalOf = (parts: CostParts) => parts.input + parts.output + parts.cacheWrite5m + parts.cacheWrite1h + parts.cacheRead;

/** Cost per token kind at `price`, by default the one the message was billed at; undefined when the model has no price. */
export function costParts(record: UsageRecord, price = priceOf(record)): CostParts | undefined {
  return price && partsAt(record, price, record.speed === 'fast');
}

/** API-equivalent cost in USD; `known` is false when the model has no price. */
export function messageCost(record: UsageRecord): { cost: number; known: boolean } {
  const parts = costParts(record);
  if (!parts)
    return { cost: 0, known: false };
  return { cost: totalOf(parts), known: true };
}

/**
 * API-equivalent cost of a message's tokens on another model, at standard speed; undefined when
 * that model has no price. The prompt's length picks that model's price, as it would on its own.
 */
export function costAt(record: UsageRecord, model: string): number | undefined {
  const price = priceOf({ ...record, model });
  return price && totalOf(partsAt(record, price, false));
}

/** The Sonnet an Opus message is re-priced at: what the same work costs today. */
const SONNET_MODEL = 'claude-sonnet-5-5';

/**
 * API-equivalent dollars saved if an Opus message had run on Sonnet instead
 * (same tokens, no fast-mode surcharge, which Sonnet lacks); 0 for any other model.
 */
export function sonnetSaving(record: UsageRecord): number {
  const sonnet = costAt(record, SONNET_MODEL);
  const parts = costParts(record);
  if (!record.model.startsWith('claude-opus-') || sonnet === undefined || !parts)
    return 0;
  return totalOf(parts) - sonnet;
}
