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
