import type { WindowForecast } from '@/core/forecast';
import type { Summary } from '@/dashboard/api';

import { formatDateTime, formatPercent, formatRelative } from '@/dashboard/format';

/** Meter scale: room to show a projection past the cap. */
const SCALE_MAX = 150;
/** Readings older than this get a visible warning. */
const STALE_WARNING_MS = 6 * 3_600_000;
const at = (value: number) => `${Math.min(value, SCALE_MAX) / SCALE_MAX * 100}%`;

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

/** Filled = used, hatched = projection from `start` to the median, bracket = range. */
function Meter({ forecast, start, title, used }: { forecast?: WindowForecast; start: number; title: string; used: number }) {
  return (
    <div className="meter" title={title}>
      <div className="meter-track">
        {forecast && (
          <div
            className="meter-projection"
            style={{ left: at(start), width: `calc(${at(forecast.median)} - ${at(start)})` }}
          />
        )}
        <div className="meter-fill" style={{ width: at(used) }} />
        {forecast && forecast.high > forecast.low && (
          <div className="meter-range" style={{ left: at(forecast.low), width: `calc(${at(forecast.high)} - ${at(forecast.low)})` }} />
        )}
        <div className="meter-cap" style={{ left: at(100) }}>
          <span>cap</span>
        </div>
      </div>
      <div className="meter-legend">
        <span>
          <span aria-hidden="true" className="key key-fill" />
          {' '}
          used:
          {' '}
          {formatPercent(used)}
        </span>
        {forecast && (
          <span>
            <span aria-hidden="true" className="key key-projection" />
            {' '}
            projected at reset:
            {' '}
            {formatPercent(forecast.median)}
            {forecast.high > forecast.low && ` (range ${formatPercent(forecast.low)}–${formatPercent(forecast.high)})`}
          </span>
        )}
      </div>
    </div>
  );
}

function FiveHour({ current }: { current: NonNullable<Summary['current']> }) {
  const { fiveHour, fiveHourEstimatedNow, fiveHourForecast: forecast, fiveHourResetsAt } = current;
  if (fiveHour === undefined)
    return null;
  const methodNote = forecast?.method === 'calibrated'
    ? 'Current % plus the usage seen in transcripts since the reading, then your typical session pace (median $/hour of 5-hour sessions in the last 4 weeks, range = 25th–75th percentile), converted with the calibrated 5-hour % per $.'
    : 'Not enough 5-hour readings to calibrate yet: extrapolates this session\'s own pace so far.';
  return (
    <div className="five-hour">
      <h3 title={methodNote}>
        5-hour session
        {fiveHourResetsAt && <small>{`resets ${formatDateTime(fiveHourResetsAt)} (${formatRelative(fiveHourResetsAt)})`}</small>}
      </h3>
      <Meter
        forecast={forecast}
        start={fiveHourEstimatedNow ?? fiveHour}
        title="5-hour session limit used at the last reading, the projected range at reset, and the 100 % cap."
        used={fiveHour}
      />
      {fiveHourEstimatedNow !== undefined && (
        <p className="note">{`≈ ${formatPercent(fiveHourEstimatedNow)} now (estimated from usage since the reading).`}</p>
      )}
      {forecast
        ? <Verdict forecast={forecast} window="fiveHour" />
        : fiveHourResetsAt && <p className="empty">Too early in the session to project.</p>}
    </div>
  );
}

export function ThisWeek({ summary }: { summary: Summary }) {
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
  const start = current.estimatedNow ?? current.weekly;
  const readingAgeMs = Date.parse(summary.generatedAt) - Date.parse(current.readAt);
  const methodNote = forecast?.method === 'calibrated'
    ? 'Current % plus your typical daily usage (median of the last 4 weeks, range = 25th–75th percentile), converted with the calibrated % per $.'
    : 'Not enough readings to calibrate yet: extrapolates this window\'s own pace so far.';

  return (
    <section className="card">
      <h2>This week</h2>
      <Meter
        forecast={forecast}
        start={start}
        title="Weekly limit used so far, the projected range at reset, and the 100 % cap."
        used={current.weekly}
      />

      {readingAgeMs > STALE_WARNING_MS && (
        <p className="status-bad">
          <span aria-hidden="true">! </span>
          {`The last reading was taken ${formatRelative(current.readAt)}`}
          {current.estimatedNow !== undefined ? '; the projection adds the usage seen in transcripts since then.' : '; the projection may be optimistic.'}
          {' Check the collection status below.'}
        </p>
      )}

      {forecast
        ? <Verdict forecast={forecast} window="week" />
        : <p className="empty">Too early in the window to project; check back in a few hours.</p>}

      <dl className="stats">
        <div title="Share of the weekly limit used, as reported by the usage endpoint or your last manual reading.">
          <dt>Weekly used</dt>
          <dd>
            {formatPercent(current.weekly)}
            {current.estimatedNow !== undefined && <small>{`≈ ${formatPercent(current.estimatedNow)} now (estimated)`}</small>}
          </dd>
        </div>
        <div title="When the weekly limit resets.">
          <dt>Resets</dt>
          <dd>
            {formatDateTime(current.resetsAt)}
            <small>{formatRelative(current.resetsAt)}</small>
          </dd>
        </div>
        <div title={methodNote}>
          <dt>Projection method</dt>
          <dd>
            {forecast ? (forecast.method === 'calibrated' ? 'Calibrated' : 'This week\'s pace') : '—'}
            <small>{`reading ${formatRelative(current.readAt)} (${current.source})`}</small>
          </dd>
        </div>
      </dl>

      <FiveHour current={current} />
    </section>
  );
}
