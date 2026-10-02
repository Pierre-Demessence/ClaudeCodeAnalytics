import type { RefObject } from 'react';

import { useLayoutEffect, useRef, useState } from 'react';

import type { Calibration } from '@/core/calibration';
import type { WindowForecast } from '@/core/forecast';
import type { Summary } from '@/dashboard/api';
import type { Measure } from '@/dashboard/meter';

import { formatCountdown, formatDateTime, formatPercent, formatRelative } from '@/dashboard/format';
import { CAP_LABEL, meterLayout, meterTexts } from '@/dashboard/meter';
import { useNow } from '@/dashboard/useNow';

/** Readings older than this get a visible warning. */
const STALE_WARNING_MS = 6 * 3_600_000;

const VERDICTS = {
  fiveHour: { bad: 'Likely to hit the 5-hour cap', good: 'On track to last until the 5-hour reset', warn: 'Tight, but should last until the 5-hour reset' },
  week: { bad: 'Likely to hit the weekly cap', good: 'On track to last the week', warn: 'Tight, but should last the week' },
};

function Verdict({ forecast: { capAt, median }, window }: { forecast: WindowForecast; window: keyof typeof VERDICTS }) {
  const text = VERDICTS[window];
  if (capAt !== undefined) {
    return (
      <p className="verdict verdict-bad">
        <span aria-hidden="true" className="verdict-icon">⚠</span>
        <span>
          <strong>{text.bad}</strong>
          {' '}
          around
          {' '}
          {formatDateTime(capAt)}
          .
        </span>
      </p>
    );
  }
  return (
    <p className={median >= 85 ? 'verdict verdict-warn' : 'verdict verdict-good'}>
      <span aria-hidden="true" className="verdict-icon">{median >= 85 ? '!' : '✓'}</span>
      <span>
        <strong>{median >= 85 ? text.warn : text.good}</strong>
        .
      </span>
    </p>
  );
}

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

/**
 * Filled = used, hatched = projection to the median, striped = past the
 * limit, bracket = likely range. Labels sit inside their segment or, when it
 * is too narrow, on the row above the bar.
 */
export function Meter({ estimated, forecast, measure: fixed, title, used }: MeterProps) {
  const input = { estimated, high: forecast?.high, low: forecast?.low, median: forecast?.median, used };
  const texts = meterTexts(input);
  const measured = useMeasure(texts);
  const layout = meterLayout(input, fixed ?? measured.measure);
  return (
    <div className="meter" title={title}>
      <div className="meter-labels">
        {layout.outside.map(label => (
          <span className={label.key === 'over' ? 'meter-outside meter-outside-over' : 'meter-outside'} key={label.key} style={{ left: label.left }}>{label.text}</span>
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
            {layout.over.inside && <span className="meter-label">{layout.over.inside}</span>}
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
        {texts.map(text => <span className="meter-label" key={text}>{text}</span>)}
      </div>
    </div>
  );
}

interface WindowStatsProps {
  calibration?: Calibration;
  forecast?: WindowForecast;
  /** Tooltip of the method card: how the projection is computed. */
  methodNote: string;
  now: number;
  /** Name of the trend method for this window. */
  paceLabel: string;
  reading: { readAt: string; source: string };
  resetsAt?: string;
  /** % at the last reading. */
  used: number;
  /** Tooltip of the usage card. */
  usedNote: string;
}

/** Usage at the last reading, reset time and projection method of one limit window. */
function WindowStats({ calibration, forecast, methodNote, now, paceLabel, reading, resetsAt, used, usedNote }: WindowStatsProps) {
  let methodDetail = 'too early to project';
  if (forecast?.method === 'calibrated' && calibration)
    methodDetail = `fit on ${calibration.n} readings, ±${calibration.rmse.toFixed(1)} pts`;
  else if (forecast)
    methodDetail = calibration ? 'no usage history for a typical pace yet' : 'not enough readings to calibrate';
  return (
    <dl className="stats">
      <div title={usedNote}>
        <dt>Used at last reading</dt>
        <dd>
          {formatPercent(used)}
          <small>{`${formatRelative(reading.readAt, now)} (${reading.source})`}</small>
        </dd>
      </div>
      <div title="When this limit resets.">
        <dt>Resets</dt>
        <dd>
          {resetsAt ? formatDateTime(resetsAt) : '—'}
          <small>{resetsAt ? formatCountdown(resetsAt, now) : 'unknown for a manual reading'}</small>
        </dd>
      </div>
      <div title={methodNote}>
        <dt>Projection method</dt>
        <dd>
          {forecast ? (forecast.method === 'calibrated' ? 'Calibrated' : paceLabel) : '—'}
          <small>{methodDetail}</small>
        </dd>
      </div>
    </dl>
  );
}

function FiveHour({ current, now, summary }: { current: NonNullable<Summary['current']>; now: number; summary: Summary }) {
  const { fiveHour, fiveHourEstimatedNow, fiveHourForecast: forecast, fiveHourResetsAt } = current;
  if (fiveHour === undefined) {
    return (
      <section className="card">
        <h2>5-hour session</h2>
        <p className="empty">No 5-hour session in progress at the last reading.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>5-hour session</h2>
      <Meter
        estimated={fiveHourEstimatedNow !== undefined}
        forecast={forecast}
        title="5-hour session limit used (≈: last reading plus the usage seen in transcripts since), the projection at reset with its likely range, and the 100 % cap."
        used={fiveHourEstimatedNow ?? fiveHour}
      />
      {forecast
        ? <Verdict forecast={forecast} window="fiveHour" />
        : fiveHourResetsAt && <p className="empty">Too early in the session to project.</p>}
      <WindowStats
        calibration={summary.fiveHourCalibration}
        forecast={forecast}
        methodNote={forecast?.method === 'calibrated'
          ? 'Current % plus the usage seen in transcripts since the reading, then your typical session pace (median $/hour of 5-hour sessions in the last 4 weeks, range = 25th–75th percentile), converted with the calibrated 5-hour % per $.'
          : 'Not enough 5-hour readings to calibrate yet: extrapolates this session\'s own pace so far.'}
        now={now}
        paceLabel="This session's pace"
        reading={current}
        resetsAt={fiveHourResetsAt}
        used={fiveHour}
        usedNote="Share of the 5-hour session limit used, as reported by the usage endpoint or your last manual reading."
      />
    </section>
  );
}

export function ThisWeek({ summary }: { summary: Summary }) {
  const now = useNow();
  const current = summary.current;
  if (!current) {
    return (
      <section className="card">
        <h2>This week</h2>
        <p className="empty">
          No reading for the current weekly window yet. Once the hook is installed the collector takes one every
          15 minutes; you can also add a manual reading from
          {' '}
          <code>/usage</code>
          {' '}
          in the settings below.
        </p>
      </section>
    );
  }

  const forecast = current.forecast;
  const readingAgeMs = now - Date.parse(current.readAt);

  return (
    <>
      <section className="card">
        <h2>This week</h2>
        <Meter
          estimated={current.estimatedNow !== undefined}
          forecast={forecast}
          title="Weekly limit used so far (≈: last reading plus the usage seen in transcripts since), the projection at reset with its likely range, and the 100 % cap."
          used={current.estimatedNow ?? current.weekly}
        />

        {readingAgeMs > STALE_WARNING_MS && (
          <p className="status-bad">
            <span aria-hidden="true">! </span>
            {`The last reading was taken ${formatRelative(current.readAt, now)}`}
            {current.estimatedNow !== undefined ? '; the projection adds the usage seen in transcripts since then.' : '; the projection may be optimistic.'}
            {' Check the collection status below.'}
          </p>
        )}

        {forecast
          ? <Verdict forecast={forecast} window="week" />
          : <p className="empty">Too early in the window to project; check back in a few hours.</p>}

        <WindowStats
          calibration={summary.calibration}
          forecast={forecast}
          methodNote={forecast?.method === 'calibrated'
            ? 'Current % plus your typical daily usage (median of the last 4 weeks, range = 25th–75th percentile), converted with the calibrated % per $.'
            : 'Not enough readings to calibrate yet: extrapolates this window\'s own pace so far.'}
          now={now}
          paceLabel="This week's pace"
          reading={current}
          resetsAt={current.resetsAt}
          used={current.weekly}
          usedNote="Share of the weekly limit used, as reported by the usage endpoint or your last manual reading."
        />
      </section>
      <FiveHour current={current} now={now} summary={summary} />
    </>
  );
}
