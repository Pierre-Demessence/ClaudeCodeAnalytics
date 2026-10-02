import { formatPercent } from '@/dashboard/format';
import { scaleMax } from '@/dashboard/scale';

/** Room a label needs around its text to sit inside a segment, in px. */
const INSIDE_PADDING = 16;
/** Gap between two labels on the row above the bar, in px. */
const LABEL_GAP = 8;

export interface MeterInput {
  /** Used is an estimate (last reading plus usage since). */
  estimated: boolean;
  high?: number;
  low?: number;
  median?: number;
  used: number;
}

export interface Measure {
  trackPx: number;
  labelPx: (text: string) => number;
}

/** A label on the row above the bar, at `left` px. */
export interface OutsideLabel {
  key: 'over' | 'projection' | 'used';
  left: number;
  text: string;
}

export interface Segment {
  /** Label drawn inside the segment, when it fits. */
  inside?: string;
  /** Start and width, as shares of the scale (0–1). */
  left: number;
  width: number;
}

export interface MeterLayout {
  capAt: number;
  /** The "limit 100%" label: left in px, above or below the bar. */
  capLabel?: { left: number; row: 'bottom' | 'top' };
  outside: OutsideLabel[];
  over?: Segment;
  projection?: Segment;
  range?: { label: string; labelLeft: number; left: number; width: number };
  used?: Segment;
}

export const CAP_LABEL = 'limit 100%';

interface Span {
  left: number;
  right: number;
}

/** Whether two spans come closer than the label gap. */
const overlaps = (a: Span, b: Span) => a.left < b.right + LABEL_GAP && b.left < a.right + LABEL_GAP;

const usedText = ({ estimated, used }: MeterInput) => `used ${estimated ? '≈ ' : ''}${formatPercent(used)}`;
const projectionText = (median?: number) => median === undefined ? undefined : `projected ${formatPercent(median)}`;
const overText = (median?: number) => median !== undefined && median > 100 ? `▲ +${formatPercent(median - 100)}` : undefined;

function rangeText({ high, low }: MeterInput): string | undefined {
  return low !== undefined && high !== undefined && high > low ? `likely ${formatPercent(low).slice(0, -1)}–${formatPercent(high)}` : undefined;
}

/** Every label the layout may measure, so they can be rendered once off-screen. */
export function meterTexts(input: MeterInput): string[] {
  return [usedText(input), projectionText(input.median), overText(input.median), rangeText(input), CAP_LABEL]
    .filter((text): text is string => text !== undefined);
}

/**
 * Positions of the meter's segments and labels. Each segment label goes inside
 * its segment when it fits, else on the row above the bar, left to right
 * without overlapping; the "limit 100%" label takes a free spot by the cap line.
 */
export function meterLayout(input: MeterInput, { labelPx, trackPx }: Measure): MeterLayout {
  const { high, low, median, used } = input;
  const max = scaleMax([used, median ?? 0, high ?? 0]);
  const share = (value: number) => Math.max(0, Math.min(value, max)) / max;
  const fits = (text: string, width: number) => width * trackPx >= labelPx(text) + INSIDE_PADDING;
  const capAt = share(100);

  const segments: { key: OutsideLabel['key']; segment: Segment; text: string }[] = [];
  const add = (key: OutsideLabel['key'], from: number, to: number, text: string) => {
    const segment = { left: share(from), width: share(to) - share(from) };
    segments.push({ key, segment, text });
    return segment;
  };

  const layout: MeterLayout = { capAt, outside: [] };
  layout.used = add('used', 0, used, usedText(input));
  // An estimate can put used past 100 %: then only the over-limit segment remains.
  if (median !== undefined && median > used && used < 100)
    layout.projection = add('projection', used, Math.min(median, 100), projectionText(median)!);
  if (median !== undefined && median > 100)
    layout.over = add('over', Math.max(used, 100), median, overText(median)!);

  const capWidth = labelPx(CAP_LABEL);
  const capX = capAt * trackPx;
  const range = rangeText(input);
  if (range) {
    const left = share(low!);
    const width = share(high!) - left;
    const labelWidth = labelPx(range);
    const centre = (left + width / 2) * trackPx;
    layout.range = { label: range, labelLeft: Math.max(0, Math.min(trackPx - labelWidth, centre - labelWidth / 2)), left, width };
  }

  const placeLabels = (avoid?: Span) => {
    layout.outside = [];
    let previousRight = -LABEL_GAP;
    for (const { key, segment, text } of segments) {
      if (segment.width > 0 && fits(text, segment.width)) {
        segment.inside = text;
        continue;
      }
      const width = labelPx(text);
      let left = Math.max(segment.left * trackPx, previousRight + LABEL_GAP);
      // Past the avoided span if there is room, else before it.
      if (avoid && overlaps({ left, right: left + width }, avoid))
        left = avoid.right + LABEL_GAP + width <= trackPx ? avoid.right + LABEL_GAP : avoid.left - LABEL_GAP - width;
      // Never back over the previous label; at worst the limit label is overlapped.
      left = Math.max(previousRight + LABEL_GAP, 0, Math.min(trackPx - width, left));
      layout.outside.push({ key, left, text });
      previousRight = left + width;
    }
  };
  const inTrack = (span: Span) => span.left >= 0 && span.right <= trackPx;
  const capSpan = (left: number): Span => ({ left, right: left + capWidth });

  // Segment labels go at their segment's start; the limit label takes a free spot by the cap line:
  // above the bar (ending at the line, then starting after it), else below it, left of the line.
  placeLabels();
  const top = [capX - capWidth, capX + LABEL_GAP].map(capSpan).find(span => inTrack(span) && layout.outside.every(label => !overlaps(span, { left: label.left, right: label.left + labelPx(label.text) })));
  if (top) {
    layout.capLabel = { left: top.left, row: 'top' };
    return layout;
  }
  const below = capSpan(capX - capWidth);
  const bracket = layout.range && { left: layout.range.left * trackPx, right: (layout.range.left + layout.range.width) * trackPx };
  const rangeLabel = layout.range && { left: layout.range.labelLeft, right: layout.range.labelLeft + labelPx(layout.range.label) };
  if (inTrack(below) && !(bracket && overlaps(below, bracket)) && !(rangeLabel && overlaps(below, rangeLabel))) {
    layout.capLabel = { left: below.left, row: 'bottom' };
    return layout;
  }
  // Last resort: the limit label keeps its spot above the bar and the segment labels move around it.
  const fixed = capSpan(Math.max(0, capX - capWidth));
  placeLabels(fixed);
  layout.capLabel = { left: fixed.left, row: 'top' };
  return layout;
}
