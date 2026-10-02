import type { RefObject } from 'react';

import { TriangleAlert } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import type { WindowForecast } from '@/core/forecast';
import type { Measure } from '@/dashboard/meterLayout';

import { CAP_LABEL, meterLayout, meterTexts, overText } from '@/dashboard/meterLayout';

/** Track width and label widths, measured in the browser. */
function useMeasure(texts: readonly string[]): { measure: Measure; measureRef: RefObject<HTMLDivElement | null>; trackRef: RefObject<HTMLDivElement | null> } {
  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<{ labels: ReadonlyMap<string, number>; trackPx: number }>(() => ({ labels: new Map(), trackPx: 0 }));
  const key = texts.join('|');

  // A ResizeObserver reports every observed element once before the first paint, then on each resize.
  // Label spans are keyed by their text, so a changed label is a new element and gets measured too.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const box = measureRef.current;
    if (!track || !box || typeof ResizeObserver === 'undefined')
      return;
    const observer = new ResizeObserver(() => setSizes({
      labels: new Map([...box.children].map(span => [span.textContent ?? '', span.getBoundingClientRect().width])),
      trackPx: track.getBoundingClientRect().width,
    }));
    observer.observe(track);
    for (const span of box.children)
      observer.observe(span);
    return () => observer.disconnect();
  }, [key]);

  return { measure: { trackPx: sizes.trackPx, labelPx: text => sizes.labels.get(text) ?? 0 }, measureRef, trackRef };
}

interface MeterProps {
  estimated: boolean;
  forecast?: WindowForecast;
  /** Widths to use instead of measuring, for tests (jsdom has no layout). */
  measure?: Measure;
  title: string;
  used: number;
}

const pct = (share: number) => `${share * 100}%`;

/** The over-limit label starts with a warning icon, measured with it. */
function LabelText({ over, text }: { over: boolean; text: string }) {
  return over
    ? (
        <>
          <TriangleAlert aria-hidden="true" className="icon-inline icon-critical" size={14} />
          {text}
        </>
      )
    : text;
}

/**
 * Filled = used, hatched = projection to the median, striped = past the
 * limit, bracket = likely range. Labels sit inside their segment or, when it
 * is too narrow, on the row above the bar.
 */
export function Meter({ estimated, forecast, measure: fixed, title, used }: MeterProps) {
  const input = { estimated, high: forecast?.high, low: forecast?.low, median: forecast?.median, used };
  const texts = meterTexts(input);
  const over = overText(forecast?.median);
  const measured = useMeasure(texts);
  const layout = meterLayout(input, fixed ?? measured.measure);
  return (
    <div className="meter" title={title}>
      <div className="meter-labels">
        {layout.outside.map(label => (
          <span className={label.key === 'over' ? 'meter-outside meter-outside-over' : 'meter-outside'} key={label.key} style={{ left: label.left }}>
            <LabelText over={label.key === 'over'} text={label.text} />
          </span>
        ))}
        {layout.capLabel?.row === 'top' && <span className="meter-cap-label" style={{ left: layout.capLabel.left }}>{CAP_LABEL}</span>}
      </div>
      <div className="meter-track" ref={measured.trackRef}>
        {layout.used && (
          <div className="meter-fill" style={{ left: pct(layout.used.left), width: pct(layout.used.width) }}>
            {layout.used.inside && <span className="meter-label">{layout.used.inside}</span>}
          </div>
        )}
        {layout.projection && (
          <div className="meter-projection" style={{ left: pct(layout.projection.left), width: pct(layout.projection.width) }}>
            {layout.projection.inside && <span className="meter-label">{layout.projection.inside}</span>}
          </div>
        )}
        {layout.over && (
          <div className="meter-over" style={{ left: pct(layout.over.left), width: pct(layout.over.width) }}>
            {layout.over.inside && <span className="meter-label"><LabelText over text={layout.over.inside} /></span>}
          </div>
        )}
        <div className="meter-cap" style={{ left: pct(layout.capAt) }} />
      </div>
      {(layout.range || layout.capLabel?.row === 'bottom') && (
        <div className="meter-range-row">
          {layout.range && (
            <>
              <div
                className="meter-range"
                style={{ left: pct(layout.range.left), width: pct(layout.range.width) }}
                title="Likely range: projection with a quieter (25th percentile) and a busier (75th percentile) pace than usual."
              />
              <span className="meter-range-label" style={{ left: layout.range.labelLeft }}>{layout.range.label}</span>
            </>
          )}
          {layout.capLabel?.row === 'bottom' && <span className="meter-cap-label" style={{ left: layout.capLabel.left }}>{CAP_LABEL}</span>}
        </div>
      )}
      <div aria-hidden="true" className="meter-measure" ref={measured.measureRef}>
        {texts.map(text => <span className="meter-label" key={text}><LabelText over={text === over} text={text} /></span>)}
      </div>
    </div>
  );
}
