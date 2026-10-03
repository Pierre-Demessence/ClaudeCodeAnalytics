import { TriangleAlert } from 'lucide-react';

import type { DriftWindow } from '@/core/limits';
import type { Summary } from '@/dashboard/api';

import { WEEK_MS } from '@/core/calibration';
import { isOff, MIN_DRIFT_WEEKS } from '@/core/limits';
import { formatDay, formatUsd } from '@/dashboard/format';
import { useTip } from '@/dashboard/useTip';

/** Headroom above the tallest bar or the usual line. */
const SCALE_HEADROOM = 1.25;

const startOf = (window: DriftWindow) => new Date(Date.parse(window.resetsAt) - WEEK_MS).toISOString();

const AlertIcon = ({ size = 14 }: { size?: number }) => <TriangleAlert aria-hidden="true" className="icon-inline icon-critical" size={size} />;

/** Dates under the bars: the first, the last (marked "now" while running) and up to two between. */
function axisLabels(drift: readonly DriftWindow[]): { key: string; text: string }[] {
  const last = drift.length - 1;
  const indexes = [...new Set([0, Math.floor(last / 3), Math.floor(last * 2 / 3), last])];
  return indexes.map(i => ({ key: drift[i]!.resetsAt, text: `${formatDay(startOf(drift[i]!))}${i === last && drift[i]!.current ? ' (now)' : ''}` }));
}

/** Weekly % used per $100 of usage, week by week: a silent change of the limit shows as a run of off bars. */
export function DriftCard({ summary }: { summary: Summary }) {
  const { drift, shift, usual } = summary.limits;
  const tip = useTip();
  const completed = drift.filter(w => !w.current).length;
  const scaleMax = Math.max(...drift.map(w => w.ratio), usual ?? 0) * SCALE_HEADROOM;

  return (
    <section className="card cal-card cal-wide">
      <div className="card-head">
        <h2>Limit drift</h2>
        <span className="card-subtitle">weekly % used per $100 of usage, by week, current plan</span>
      </div>
      {shift && (
        <p className="alert">
          <AlertIcon size={18} />
          <span>
            <strong>{`Since the week of ${formatDay(shift.since)}, $100 costs ${Math.round(Math.abs(shift.change))}% ${shift.change > 0 ? 'more' : 'less'} of the limit.`}</strong>
            {' The limit may have changed; the calibration follows recent readings (half-life 2 weeks).'}
          </span>
        </p>
      )}
      {drift.length === 0
        ? <p className="empty">No weekly window with a reading of 10% or more on this plan yet.</p>
        : (
            <>
              <div aria-label="Weekly limit used per $100, by week" className="drift-chart" role="group">
                {usual !== undefined && (
                  <>
                    <div className="drift-usual" style={{ bottom: `${usual / scaleMax * 100}%` }} />
                    <span className="drift-usual-label" style={{ bottom: `calc(${usual / scaleMax * 100}% + 2px)` }}>{`usual ${usual.toFixed(1)}%`}</span>
                  </>
                )}
                {drift.map((window) => {
                  const off = usual !== undefined && isOff(window.ratio, usual);
                  const dates = `${formatDay(startOf(window))} – ${formatDay(window.resetsAt)}`;
                  return (
                    <div
                      className={off ? 'drift-bar off' : 'drift-bar'}
                      key={window.resetsAt}
                      style={{ height: `${window.ratio / scaleMax * 100}%` }}
                      {...tip(
                        <>
                          <strong>{`${window.current ? 'This week (so far): ' : 'Week of '}${dates}`}</strong>
                          <br />
                          {`${window.ratio.toFixed(1)}% of the weekly limit per $100`}
                          <br />
                          {`${formatUsd(window.cost)} of usage, Claude Code ${Math.round(window.claudeCode)}% of the weekly %`}
                          {off && (
                            <>
                              <br />
                              {`More than 15% off the usual ${usual.toFixed(1)}%`}
                            </>
                          )}
                        </>,
                      )}
                    >
                      <span>{window.ratio.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="drift-axis">
                {axisLabels(drift).map(label => <span key={label.key}>{label.text}</span>)}
              </div>
              {usual === undefined && (
                <p className="note">{`Drift needs ${MIN_DRIFT_WEEKS} completed weeks with a reading of 10% or more on this plan; ${completed} so far.`}</p>
              )}
              <ul className="legend">
                <li>
                  <span className="legend-swatch" />
                  {usual === undefined ? 'week' : 'week near the usual ratio'}
                </li>
                {usual !== undefined && (
                  <>
                    <li>
                      <span className="legend-swatch drift-off" />
                      <AlertIcon />
                      more than 15% off
                    </li>
                    <li>
                      <span className="legend-usual" />
                      usual: median of past weeks
                    </li>
                  </>
                )}
              </ul>
            </>
          )}
    </section>
  );
}
