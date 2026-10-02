import type { WindowForecast } from '@/core/forecast';
import type { WeekPacing } from '@/core/pacing';

import { DAY_MS } from '@/core/calibration';
import { formatDateTime, formatDollars, formatPercent, formatWeekday } from '@/dashboard/format';
import { scaleMax } from '@/dashboard/scale';

// Plot area inside the 1000 × 240 view box; labels use the margins.
const LEFT = 44;
const RIGHT = 930;
const TOP = 20;
const BOTTOM = 200;

interface Props {
  forecast?: WindowForecast;
  now: number;
  pacing: WeekPacing;
  /** Weekly % now: where the projection starts. */
  usedNow: number;
}

/**
 * Weekly % so far (solid), an even pace to 100 % (dashed), the projection to
 * reset (dotted) with its likely range (band), the limit and now. Each line is
 * labelled on the chart and has its own line style, not only a color.
 */
export function PacingChart({ forecast, now, pacing, usedNow }: Props) {
  const { from, points, roomPerDay, spentPerDay, to } = pacing;
  const top = scaleMax([100, usedNow, forecast?.high ?? 0]);
  const x = (at: number) => LEFT + (Math.min(Math.max(at, from), to) - from) / (to - from) * (RIGHT - LEFT);
  const y = (percent: number) => BOTTOM - Math.min(percent, top) / top * (BOTTOM - TOP);
  const grid = [0, 25, 50, 75, 100, ...(top > 100 ? [top] : [])];
  const days = Array.from({ length: Math.round((to - from) / DAY_MS) }, (_, i) => from + i * DAY_MS);
  const nowX = x(now);
  const nowY = y(usedNow);
  // Early in the week there is no room left of now for the "actual" label.
  const labelBefore = nowX - LEFT > 120;
  const actual = points.map(p => `${x(p.at)},${y(p.percent)}`).join(' ');
  // "even pace" sits under its line three quarters of the way, clear of the limit line above.
  const evenAt = 0.75;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Budget pacing this week</h2>
        <span className="card-subtitle">{`${formatDateTime(from)} → ${formatDateTime(to)}`}</span>
        <span className="card-head-spacer" />
        {roomPerDay !== undefined && usedNow < 100 && (
          <span
            className="pacing-room"
            title={`API-equivalent dollars per day you can use from now on and still end the week at 100%.${spentPerDay === undefined ? '' : ` So far this week you used ${formatDollars(spentPerDay)}/day.`}`}
          >
            Room left:
            {' '}
            <strong>{`≈ ${formatDollars(roomPerDay)}/day`}</strong>
            {' '}
            to reach 100% at reset
          </span>
        )}
      </div>
      <div className="pacing-scroll">
        <svg aria-label="Weekly usage so far against an even pace, with the projection to reset" className="pacing-chart" role="img" viewBox="0 0 1000 240">
          {grid.map(p => (
            <g key={p}>
              <line className="pacing-grid" x1={LEFT} x2={RIGHT} y1={y(p)} y2={y(p)} />
              <text className="pacing-axis" textAnchor="end" x={LEFT - 6} y={y(p) + 4}>{formatPercent(p)}</text>
            </g>
          ))}
          {days.map(day => (
            <text className="pacing-axis" key={day} textAnchor="middle" x={x(day + DAY_MS / 2)} y={BOTTOM + 22}>{formatWeekday(day)}</text>
          ))}
          <line className="pacing-limit" x1={LEFT} x2={RIGHT} y1={y(100)} y2={y(100)} />
          <text className="pacing-label-strong" textAnchor="end" x={RIGHT} y={y(100) - 6}>limit</text>
          {forecast && (
            <polygon className="pacing-band" points={`${nowX},${nowY} ${x(to)},${y(forecast.high)} ${x(to)},${y(forecast.low)}`} />
          )}
          <line className="pacing-even" x1={x(from)} x2={x(to)} y1={y(0)} y2={y(100)} />
          <text className="pacing-label" x={x(from + evenAt * (to - from))} y={y(100 * evenAt) + 18}>even pace</text>
          <polyline className="pacing-actual" points={actual} />
          {forecast && <line className="pacing-projection" x1={nowX} x2={x(to)} y1={nowY} y2={y(forecast.median)} />}
          <line className="pacing-now" x1={nowX} x2={nowX} y1={TOP + 4} y2={BOTTOM} />
          <text className="pacing-label-strong" x={nowX + 4} y={BOTTOM - 4}>now</text>
          <circle className="pacing-dot" cx={nowX} cy={nowY} r="5" />
          <text className="pacing-value" textAnchor={labelBefore ? 'end' : 'start'} x={labelBefore ? nowX - 8 : nowX + 8} y={nowY - 8}>{`actual ${formatPercent(usedNow)}`}</text>
          {forecast && <text className="pacing-value" x={RIGHT + 6} y={y(forecast.median) + 4}>{formatPercent(forecast.median)}</text>}
        </svg>
      </div>
      <ul className="legend">
        <li>
          <span className="legend-line legend-actual" />
          actual
        </li>
        {forecast && (
          <li>
            <span className="legend-line legend-projection" />
            projection
          </li>
        )}
        <li>
          <span className="legend-line legend-even" />
          even pace to 100%
        </li>
        {forecast && (
          <li>
            <span className="legend-band" />
            likely range
          </li>
        )}
      </ul>
    </section>
  );
}
