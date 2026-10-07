import { TriangleAlert } from 'lucide-react';

import type { FiveHourWindow } from '@/core/sessions';
import type { Summary } from '@/dashboard/api';

import { dayKey } from '@/core/aggregate';
import { formatDollars, formatPercent, formatUsd } from '@/dashboard/format';
import { formatSessionDay, formatSpan, peakText, projectsText, timelineRows } from '@/dashboard/sessionsData';
import { InfoTip } from '@/dashboard/Tip';
import { useTip } from '@/dashboard/useTip';

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

const CappedIcon = ({ size = 14 }: { size?: number }) => <TriangleAlert aria-hidden="true" className="icon-inline icon-critical" size={size} />;

const SOURCE_TEXT: Record<FiveHourWindow['source'], string> = { estimated: 'estimated', reading: 'reading' };

/** "Thu 1 Oct · 10:12–15:12". */
function windowText(window: FiveHourWindow, timeZone: string) {
  return `${formatSessionDay(dayKey(Date.parse(window.start), timeZone))} · ${formatSpan(window, timeZone)}`;
}

/** The block already shows the peak and, by its border, the source. */
function windowTip(window: FiveHourWindow, timeZone: string): string {
  return `${windowText(window, timeZone)}${window.inProgress ? ' (in progress)' : ''} · ${formatUsd(window.cost)}\n${window.messages} messages`;
}

function Stats({ summary }: { summary: Summary }) {
  const { limitThreshold, sessions: { stats } } = summary;
  return (
    <section aria-label="Sessions summary" className="session-stats">
      <div className="card">
        <strong>{stats.count}</strong>
        <span>
          sessions, last 7 days
          <InfoTip label="About sessions">5-hour windows with a message, or a usage reading of 5% or more, in the last 7 days, the one in progress included.</InfoTip>
        </span>
      </div>
      <div className="card">
        <strong>
          {stats.capped > 0 && <CappedIcon size={24} />}
          {stats.capped}
        </strong>
        <span>
          {`hit the 5-hour limit (≥ ${limitThreshold}%)`}
          <InfoTip label="About the limit">Windows where a reading reached the threshold. Set it in the Calibration tab.</InfoTip>
        </span>
      </div>
      <div className="card">
        <strong>{stats.medianPeak === undefined ? '–' : formatPercent(stats.medianPeak)}</strong>
        <span>
          median peak
          <InfoTip label="About median peak">
            {stats.medianPeak === undefined
              ? 'No finished window with a 5-hour reading in the last 7 days.'
              : 'Median of the highest 5-hour % read in each finished window with readings.'}
          </InfoTip>
        </span>
      </div>
      <div className="card">
        <strong>{stats.medianCost === undefined ? '–' : formatDollars(stats.medianCost)}</strong>
        <span>
          median session cost
          <InfoTip label="About median session cost">Median API-equivalent cost of the finished windows with Claude Code messages.</InfoTip>
        </span>
      </div>
    </section>
  );
}

function Timeline({ summary }: { summary: Summary }) {
  const { sessions: { days, windows }, timeZone } = summary;
  const tip = useTip();
  return (
    <section className="card">
      <div className="card-head">
        <h2>5-hour sessions, last 7 days</h2>
        <span className="card-subtitle">each block is one 5-hour window; the bar inside is its peak usage</span>
      </div>
      {windows.length === 0
        ? <p className="empty">No 5-hour session in the last 7 days.</p>
        : (
            <>
              <div className="session-timeline">
                <span />
                <div aria-hidden="true" className="session-hours">
                  {HOURS.map(h => <span key={h}>{`${String(h).padStart(2, '0')}:00`}</span>)}
                </div>
                {timelineRows(windows, days, timeZone).map(row => (
                  <div className="session-row" key={row.day}>
                    <span className="session-day">{formatSessionDay(row.day)}</span>
                    <div className="session-track">
                      {row.parts.map(({ continuesLeft, continuesRight, fillWidth, isStart, left, width, window }) => (
                        <div
                          className={`session-block ${window.source}${continuesLeft ? ' cut-left' : ''}${continuesRight ? ' cut-right' : ''}`}
                          key={window.start}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          {...tip(windowTip(window, timeZone))}
                        >
                          {fillWidth !== undefined && <span className={`session-fill${window.capped ? ' capped' : ''}`} style={{ width: `${fillWidth}%` }} />}
                          {isStart && (
                            <span className="session-label">
                              {window.capped && <CappedIcon size={12} />}
                              {peakText(window)}
                              {window.inProgress && <span className="wk-now">now</span>}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <ul className="legend session-legend">
                <li>
                  <span className="legend-session reading" />
                  window from a reading
                </li>
                <li>
                  <span className="legend-session estimated" />
                  window estimated from transcript times (peak marked ~)
                </li>
                <li>
                  <span className="legend-session capped" />
                  <CappedIcon />
                  hit the limit
                </li>
              </ul>
            </>
          )}
    </section>
  );
}

function List({ summary }: { summary: Summary }) {
  const { sessions: { windows }, timeZone } = summary;
  const tip = useTip();
  return (
    <section className="card">
      <h2>Session list</h2>
      {windows.length === 0
        ? <p className="empty">No 5-hour session in the last 7 days.</p>
        : (
            <div className="table-scroll">
              <table className="table session-table">
                <thead>
                  <tr>
                    <th scope="col">Window</th>
                    <th scope="col">Projects</th>
                    <th scope="col">Messages</th>
                    <th scope="col">
                      Cost
                      <InfoTip label="About cost">API-equivalent cost of the window's Claude Code messages.</InfoTip>
                    </th>
                    <th scope="col">
                      Peak
                      <InfoTip label="About peak">Highest 5-hour % read during the window; ~ marks an estimate from the 5-hour calibration.</InfoTip>
                    </th>
                    <th scope="col">
                      Source
                      <InfoTip label="About source">Whether the window's start comes from a reading or is estimated from transcript times.</InfoTip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {windows.map(window => (
                    <tr key={window.start}>
                      <th scope="row">
                        {windowText(window, timeZone)}
                        {window.inProgress && <span className="session-now">in progress</span>}
                      </th>
                      <td {...(window.projects.length > 0 ? tip(window.projects.map(p => p.path).join('\n')) : {})}>{projectsText(window)}</td>
                      <td>{window.messages}</td>
                      <td><strong>{formatUsd(window.cost)}</strong></td>
                      <td className="session-peak-cell">
                        <div className="session-peak">
                          <span className="session-peak-track">
                            {window.peak !== undefined && <span className={`session-peak-bar${window.capped ? ' capped' : ''}${window.peakEstimated ? ' estimated' : ''}`} style={{ width: `${Math.min(window.peak, 100)}%` }} />}
                          </span>
                          {/* A fixed slot right of the bar, so the icon lines up whatever the % width. */}
                          <span className="session-peak-icon">{window.capped && <CappedIcon />}</span>
                          <span className="session-peak-text">{peakText(window)}</span>
                        </div>
                      </td>
                      <td className="secondary">{SOURCE_TEXT[window.source]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  );
}

/** Past 5-hour windows: summary numbers, a day × hour timeline and the list. */
export function Sessions({ summary }: { summary: Summary }) {
  return (
    <>
      <Stats summary={summary} />
      <Timeline summary={summary} />
      <List summary={summary} />
    </>
  );
}
