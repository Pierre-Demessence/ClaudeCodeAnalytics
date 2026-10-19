import type { FocusEvent, PointerEvent } from 'react';

import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import type { FiveHourWindow } from '@/core/sessions';
import type { Summary } from '@/dashboard/api';
import type { HistoryView } from '@/dashboard/history';

import { dayKey } from '@/core/aggregate';
import { BlockedIcon } from '@/dashboard/BlockedIcon';
import { formatDollars, formatPercent, formatUsd } from '@/dashboard/format';
import { defaultView, rangeText } from '@/dashboard/history';
import { Pager } from '@/dashboard/Pager';
import { RangeFrame } from '@/dashboard/RangePicker';
import { formatSessionDay, formatSpan, formatTime, nowMark, peakText, projectsText, timelineRows } from '@/dashboard/sessionsData';
import { InfoTip } from '@/dashboard/Tip';
import { useNow } from '@/dashboard/useNow';
import { usePage } from '@/dashboard/usePage';
import { useTip } from '@/dashboard/useTip';

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

const CappedIcon = ({ size = 14 }: { size?: number }) => <TriangleAlert aria-hidden="true" className="icon-inline icon-critical" size={size} />;

/** Days shown at a time on the block chart. */
const CHART_DAYS = 7;
/** Rows per page of the session list. */
const LIST_ROWS = 25;

/** "in the last 7 days" or "in this range". */
const scopeOf = (view: HistoryView) => (view.range ? 'in this range' : 'in the last 7 days');
/** A range key, so a page resets to the first when another range is picked. */
const keyOf = (view: HistoryView) => (view.range ? `${view.range.from}-${view.range.to}` : 'default');

const SOURCE_TEXT: Record<FiveHourWindow['source'], string> = { estimated: 'estimated', reading: 'reading' };

/** "Thu 1 Oct · 10:12–15:12". */
function windowText(window: FiveHourWindow, timeZone: string) {
  return `${formatSessionDay(dayKey(Date.parse(window.start), timeZone))} · ${formatSpan(window, timeZone)}`;
}

/** The block already shows the peak and, by its border, the source. */
function windowTip(window: FiveHourWindow, timeZone: string): string {
  const hits = window.limitHits?.map(hit => `\nRate limit hit at ${formatTime(hit, timeZone)}`).join('') ?? '';
  return `${windowText(window, timeZone)}${window.inProgress ? ' (in progress)' : ''} · ${formatUsd(window.cost)}\n${window.messages} messages${hits}`;
}

function Stats({ summary, view }: { summary: Summary; view: HistoryView }) {
  const { limitThreshold } = summary;
  const { stats } = view.history.sessions;
  const scope = scopeOf(view);
  return (
    <section aria-label="Sessions summary" className="session-stats">
      <div className="card">
        <strong>{stats.count}</strong>
        <span>
          {`sessions, ${rangeText(view, 'last 7 days')}`}
          <InfoTip label="About sessions">{`5-hour windows with a message, or a usage reading of 5% or more, ${scope}, the one in progress included.`}</InfoTip>
        </span>
      </div>
      <div className="card">
        <strong>
          {stats.capped > 0 && <CappedIcon size={24} />}
          {stats.capped}
        </strong>
        <span>
          {`peak ≥ ${limitThreshold}%`}
          <InfoTip label="About the limit">Windows where a reading reached the threshold. Set it in the Calibration tab.</InfoTip>
        </span>
        <span>
          <BlockedIcon />
          {`${stats.blocked} blocked by a rate limit`}
          <InfoTip label="About blocked windows">Windows in which Claude Code printed a rate-limit message, read from the transcripts. Unlike the threshold, this is a limit actually hit.</InfoTip>
        </span>
      </div>
      <div className="card">
        <strong>{stats.medianPeak === undefined ? '–' : formatPercent(stats.medianPeak)}</strong>
        <span>
          median peak
          <InfoTip label="About median peak">
            {stats.medianPeak === undefined
              ? `No finished window with a 5-hour reading ${scope}.`
              : 'Median of the highest 5-hour % read in each finished window with readings.'}
          </InfoTip>
        </span>
      </div>
      <div className="card">
        <strong>{stats.medianCost === undefined ? '–' : formatDollars(stats.medianCost)}</strong>
        <span>
          median cost
          <InfoTip label="About median cost">Median API-equivalent cost of the finished windows with Claude Code messages.</InfoTip>
        </span>
      </div>
    </section>
  );
}

function Timeline({ summary, view }: { summary: Summary; view: HistoryView }) {
  const { limitThreshold, timeZone } = summary;
  const { days, windows } = view.history.sessions;
  const tip = useTip();
  // Tomorrow's row, while the window in progress runs into it, stays on the first page without using one of its days.
  const leading = days[0] !== undefined && days[0] > dayKey(view.ctx.now, timeZone) ? 1 : 0;
  const { end, page, pages, setPage, start } = usePage(days.length - leading, CHART_DAYS, keyOf(view));
  const shownDays = [...page === 0 ? days.slice(0, leading) : [], ...days.slice(leading + start, leading + end)];
  // The hovered or focused window's start; its block(s) stay lit while the rest dim.
  const [active, setActive] = useState<string>();
  // From the browser clock, so the mark moves between data reloads.
  const now = useNow();
  const mark = nowMark(now, timeZone);
  const nowText = `Now ${formatTime(now, timeZone)}`;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{`5-hour sessions, ${rangeText(view, 'last 7 days')}`}</h2>
        <span className="card-subtitle">each block is one 5-hour window; the bar inside is its peak usage</span>
        <span className="card-head-spacer" />
        {pages > 1 && (
          // Page 1 holds the newest days: the left button goes back in time, like the range picker's.
          <Pager
            canNext={page > 0}
            canPrevious={page < pages - 1}
            label="Chart days"
            onNext={() => setPage(page - 1)}
            onPrevious={() => setPage(page + 1)}
            text={`${formatSessionDay(days[leading + end - 1]!)} – ${formatSessionDay(days[leading + start]!)}`}
          />
        )}
      </div>
      {windows.length === 0
        ? <p className="empty">{`No 5-hour session ${scopeOf(view)}.`}</p>
        : (
            <>
              <div className="session-timeline">
                <span />
                <div aria-hidden="true" className="session-hours">
                  {HOURS.map(h => <span key={h}>{`${String(h).padStart(2, '0')}:00`}</span>)}
                </div>
                {timelineRows(windows, shownDays, timeZone).map(row => (
                  <div className="session-row" key={row.day}>
                    <span className={`session-day${row.day === mark.day ? ' today' : ''}`}>
                      {formatSessionDay(row.day)}
                      {row.day >= mark.day && <span className="session-day-relative">{row.day === mark.day ? 'today' : 'tomorrow'}</span>}
                    </span>
                    <div className="session-track">
                      {row.day === mark.day && <span aria-label={nowText} className="session-now-mark" role="img" style={{ left: `${mark.left}%` }} {...tip(nowText)} />}
                      {row.parts.map(({ continuesLeft, continuesRight, fillWidth, hasLabel, left, width, window }) => {
                        const tipProps = tip(windowTip(window, timeZone));
                        const dimmed = active !== undefined && active !== window.start;
                        return (
                          <div
                            className={`session-block ${window.source}${continuesLeft ? ' cut-left' : ''}${continuesRight ? ' cut-right' : ''}${dimmed ? ' dimmed' : ''}`}
                            key={window.start}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            {...tipProps}
                            onBlur={(e: FocusEvent<Element>) => {
                              tipProps.onBlur(e);
                              setActive(undefined);
                            }}
                            onFocus={(e: FocusEvent<Element>) => {
                              tipProps.onFocus(e);
                              setActive(window.start);
                            }}
                            onPointerEnter={(e: PointerEvent<Element>) => {
                              tipProps.onPointerEnter(e);
                              if (e.pointerType === 'mouse')
                                setActive(window.start);
                            }}
                            onPointerLeave={(e: PointerEvent<Element>) => {
                              tipProps.onPointerLeave(e);
                              if (e.pointerType === 'mouse')
                                setActive(undefined);
                            }}
                          >
                            {fillWidth !== undefined && <span className={`session-fill${window.capped ? ' capped' : ''}`} style={{ width: `${fillWidth}%` }} />}
                            {hasLabel && (
                              <span className="session-label">
                                {window.capped && <CappedIcon size={12} />}
                                {window.limitHits && <BlockedIcon size={12} />}
                                {peakText(window)}
                                {window.inProgress && <span className="wk-now">now</span>}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <ul className="legend session-legend">
                <li>
                  <span className="legend-session reading" />
                  from a reading
                </li>
                <li>
                  <span className="legend-session estimated" />
                  estimated from transcript times
                </li>
                <li>
                  <span className="legend-session capped" />
                  <CappedIcon />
                  {`peak ≥ ${limitThreshold}%`}
                </li>
                <li>
                  <BlockedIcon />
                  blocked by a rate limit
                </li>
              </ul>
            </>
          )}
    </section>
  );
}

function List({ summary, view }: { summary: Summary; view: HistoryView }) {
  const { limitThreshold, timeZone } = summary;
  const { windows } = view.history.sessions;
  const tip = useTip();
  const { end, page, pages, setPage, start } = usePage(windows.length, LIST_ROWS, keyOf(view));
  return (
    <section className="card">
      <h2>Session list</h2>
      {windows.length === 0
        ? <p className="empty">{`No 5-hour session ${scopeOf(view)}.`}</p>
        : (
            <>
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
                        <InfoTip label="About peak">
                          {'Highest 5-hour % read during the window.\n~ marks an estimate from the 5-hour calibration.\n'}
                          <CappedIcon size={13} />
                          {` peak ≥ ${limitThreshold}%\n`}
                          <BlockedIcon size={13} />
                          {' blocked by a rate limit: hover the icon for the time'}
                        </InfoTip>
                      </th>
                      <th scope="col">
                        Source
                        <InfoTip label="About source">Whether the window's start comes from a reading or is estimated from transcript times.</InfoTip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {windows.slice(start, end).map(window => (
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
                            <span className="session-peak-icon">
                              {window.limitHits && (
                                <span className="session-peak-blocked" {...tip(window.limitHits.map(hit => `Rate limit hit at ${formatTime(hit, timeZone)}`).join('\n'))}>
                                  <BlockedIcon />
                                </span>
                              )}
                            </span>
                            <span className="session-peak-text">{peakText(window)}</span>
                          </div>
                        </td>
                        <td className="secondary">{SOURCE_TEXT[window.source]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <Pager
                  canNext={page < pages - 1}
                  canPrevious={page > 0}
                  label="Session list pages"
                  onNext={() => setPage(page + 1)}
                  onPrevious={() => setPage(page - 1)}
                  text={`Page ${page + 1} of ${pages}`}
                />
              )}
            </>
          )}
    </section>
  );
}

/** Past 5-hour windows: summary numbers, a day × hour timeline and the list. */
export function Sessions({ summary, view = defaultView(summary) }: { summary: Summary; view?: HistoryView }) {
  return (
    <RangeFrame view={view}>
      <Stats summary={summary} view={view} />
      <Timeline summary={summary} view={view} />
      <List summary={summary} view={view} />
    </RangeFrame>
  );
}
