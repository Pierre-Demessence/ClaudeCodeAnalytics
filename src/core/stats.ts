/** Linear-interpolated quantile (`q` in 0..1); undefined for an empty list. */
export function quantile(values: readonly number[], q: number): number | undefined {
  if (values.length === 0)
    return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (pos - lower);
}

export function median(values: readonly number[]): number | undefined {
  return quantile(values, 0.5);
}

/** Small seeded generator (mulberry32): repeatable, unlike `Math.random`. */
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
