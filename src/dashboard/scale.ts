/**
 * End of the meter scale: 100 % when everything fits, else the highest value
 * rounded up to 10 %, and at least 125 % to leave room past the cap.
 */
export function scaleMax(values: readonly number[]): number {
  const top = Math.max(100, ...values);
  return top <= 100 ? 100 : Math.max(125, Math.ceil(top / 10) * 10);
}

export interface Tick {
  label: string;
  /** Position as a share of the scale, 0–1. */
  at: number;
}

/** Labels need about this share of a phone-width meter to stay apart. */
const MIN_TICK_GAP = 0.1;

/** Keeps each tick unless it is too close to one kept before it: pass ticks by priority. */
export function spreadTicks(ticks: readonly Tick[]): Tick[] {
  const kept: Tick[] = [];
  for (const tick of ticks) {
    if (kept.every(other => Math.abs(other.at - tick.at) >= MIN_TICK_GAP))
      kept.push(tick);
  }
  return kept;
}

/** Ticks for both ends of a range, merged into one centred label when they would touch. */
export function rangeTicks(low: Tick, high: Tick): Tick[] {
  if (high.at - low.at >= MIN_TICK_GAP)
    return [low, high];
  return [{ at: (low.at + high.at) / 2, label: `${low.label}–${high.label}` }];
}

/** Range width, as a share of the scale, with room for the caption between the end labels. */
const CAPTION_FITS = 0.35;

/** Rows of labels under the range bracket: the caption sits between the ends, or on its own row under them. */
export function rangeRows(low: Tick, high: Tick, caption: string): Tick[][] {
  const middle = { at: (low.at + high.at) / 2, label: caption };
  if (high.at - low.at >= CAPTION_FITS)
    return [[low, middle, high]];
  return [rangeTicks(low, high), [middle]];
}

/** Ticks near an edge are aligned to it so they never spill out of the meter. */
export function tickAlign(at: number): 'center' | 'end' | 'start' {
  if (at < 0.05)
    return 'start';
  return at > 0.95 ? 'end' : 'center';
}
