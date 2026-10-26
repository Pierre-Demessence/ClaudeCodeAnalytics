import { ArrowRightLeft, RotateCcw, TriangleAlert } from 'lucide-react';

import type { WeekRow } from '@/core/weekHistory';
import type { Summary } from '@/dashboard/api';
import type { HistoryView } from '@/dashboard/history';

import { dayKey } from '@/core/aggregate';
import { BlockedIcon } from '@/dashboard/BlockedIcon';
import { formatDollars, formatInteger, formatPercent, formatUsd } from '@/dashboard/format';
import { defaultView, rangeText } from '@/dashboard/history';
import { Pager } from '@/dashboard/Pager';
import { RangeFrame } from '@/dashboard/RangePicker';
import { formatSessionDay, formatTime } from '@/dashboard/sessionsData';
import { InfoTip } from '@/dashboard/Tip';
import { usePage } from '@/dashboard/usePage';
import { useTip } from '@/dashboard/useTip';
import { dayHeaders, formatWeekRange, heatBounds, heatLegend, heatLevel, percentText, projectsText, resetText, restartTip, uncappedMedian, uncappedOf, uncappedText, uncappedTip } from '@/dashboard/weeksData';

const HitIcon = ({ size = 14 }: { size?: number }) => <TriangleAlert aria-hidden="true" className="icon-inline icon-critical" size={size} />;

const PlanChangeIcon = ({ size = 14 }: { size?: number }) => <ArrowRightLeft aria-hidden="true" className="icon-inline" size={size} />;

const ResetIcon = ({ size = 14 }: { size?: number }) => <RotateCcw aria-hidden="true" className="icon-inline" size={size} />;

/** A week whose usage restarted: a plan change, or a reset without one. */
const isRestarted = (week: WeekRow) => week.planChange || week.parts;
const isReset = (week: WeekRow) => !week.planChange && week.parts;

/** Rows per page of the week list. */
const LIST_ROWS = 12;

const emptyText = (view: HistoryView) => (view.range ? 'No weekly window in this range.' : 'No weekly window yet.');

/** What the rate limits seen in the transcripts did to a week: blocked 5-hour sessions, weekly-limit hits and when. */
function blockedTip({ blockedSessions, limitHits }: WeekRow, timeZone: string): string {
  const when = (hit: string) => `${formatSessionDay(dayKey(Date.parse(hit), timeZone))} ${formatTime(hit, timeZone)}`;
  return [
    blockedSessions > 0 && `${blockedSessions} ${blockedSessions === 1 ? 'session' : 'sessions'} blocked by a rate limit`,
    limitHits && `Weekly limit hit: ${limitHits.map(when).join(', ')}`,
  ].filter(Boolean).join('\n');
}

function weekTip(week: WeekRow, timeZone: string): string {
  return `${formatWeekRange(week, timeZone)}${week.inProgress ? ' (in progress)' : ''}\n${formatUsd(week.cost)} · ${week.messages} messages · ${week.sessions} sessions`;
}

function Stats({ summary, view }: { summary: Summary; view: HistoryView }) {
  const { planFit, weekLimitThreshold } = summary;
  const { stats, weeks } = view.history.weekHistory;
  // The estimate is the Plans tab's typical week over its own weeks, so it only matches the default 12.
  const uncapped = view.range ? undefined : uncappedMedian(planFit, stats.medianPercent);
  return (
    <section aria-label="Weeks summary" className="session-stats">
      <div className="card">
        <strong>{weeks.length}</strong>
        <span>
          weeks shown
          <InfoTip label="About weeks shown">{view.range ? 'Weekly windows with a reading or a message that start in the range, the one in progress included.' : 'Weekly windows with a reading or a message, the one in progress included. At most the last 12.'}</InfoTip>
        </span>
      </div>
      <div className="card">
        <strong>
          {stats.hit > 0 && <HitIcon size={24} />}
          {stats.hit}
        </strong>
        <span>
          {`peak ≥ ${weekLimitThreshold}%`}
          <InfoTip label="About the limit">Weeks whose peak reached that %. A percent estimated from transcripts never counts.</InfoTip>
        </span>
        <span>
          <BlockedIcon />
          {`${stats.blocked} blocked by a rate limit`}
          <InfoTip label="About blocked weeks">Weeks in which Claude Code printed a rate-limit message, read from the transcripts: a 5-hour or a weekly limit actually hit.</InfoTip>
        </span>
      </div>
      <div className="card">
        <strong>{stats.medianPercent === undefined ? '–' : formatPercent(stats.medianPercent)}</strong>
        <span>
          median peak
          <InfoTip label="About median peak">
            {stats.medianPercent === undefined
              ? 'No finished week with a percent yet.'
              : 'Median of the finished weeks\' peak weekly %, estimates included, on your current plan; a week whose usage restarted counts its parts added up. The tick on every bar marks it.'}
          </InfoTip>
        </span>
        {uncapped !== undefined && <span className="wk-uncapped">{`${uncappedText(uncapped)} without the limit`}</span>}
      </div>
      <div className="card">
        <strong>{stats.medianCost === undefined ? '–' : formatDollars(stats.medianCost)}</strong>
        <span>
          median cost
          <InfoTip label="About median cost">Median API-equivalent cost of the finished weeks with Claude Code messages.</InfoTip>
        </span>
      </div>
    </section>
  );
}

function Timeline({ summary, view }: { summary: Summary; view: HistoryView }) {
  const { planFit, timeZone, weekLimitThreshold } = summary;
  const { stats, weeks } = view.history.weekHistory;
  const tip = useTip();
  const bounds = heatBounds(weeks);
  const maxDay = Math.max(0, ...weeks.flatMap(w => w.days.map(cost => cost ?? 0)));
  const legend = heatLegend(bounds);
  const headers = weeks[0] ? dayHeaders(weeks[0].start, timeZone) : [];
  return (
    <section className="card">
      <div className="card-head">
        <h2>{`Weekly usage, ${rangeText(view, 'last 12 weeks')}`}</h2>
        <InfoTip label="About the weekly timeline">
          {weeks[0]
            ? `Each cell is the cost of 24 h from the weekly reset (${resetText(weeks[0].start, timeZone)}). The bar is the week's peak %.`
            : 'Each cell is the cost of 24 h from the weekly reset. The bar is the week\'s peak %.'}
        </InfoTip>
      </div>
      {weeks.length === 0
        ? <p className="empty">{emptyText(view)}</p>
        : (
            <>
              <div className="wk-grid">
                <div className="wk-row wk-head">
                  <span />
                  <div aria-hidden="true" className="wk-days">
                    {headers.map(day => <span key={day}>{day}</span>)}
                  </div>
                  <div className="wk-percent wk-percent-head">
                    <span>Peak weekly %</span>
                    <span>Without limit</span>
                  </div>
                </div>
                {weeks.map((week) => {
                  const uncapped = uncappedOf(planFit, week);
                  return (
                    <div className="wk-row" key={week.start}>
                      <span className="wk-label" {...tip(weekTip(week, timeZone))}>
                        {formatSessionDay(dayKey(Date.parse(week.start), timeZone))}
                        {week.inProgress && <span className="wk-now">now</span>}
                      </span>
                      <div className="wk-cells">
                        {week.days.map((cost, i) => (
                          <div className={cost === null ? 'wk-cell later' : `wk-cell heat-${heatLevel(cost, bounds)}`} key={headers[i]}>
                            {cost !== null && cost > 0 && <span className="wk-fill" style={{ height: `${cost / maxDay * 100}%` }} />}
                            <span className="wk-cell-text">{cost === null ? '' : formatDollars(cost)}</span>
                          </div>
                        ))}
                      </div>
                      <p className="wk-meta">
                        {`${formatUsd(week.cost)} · ${week.sessions} sessions · ${formatInteger(week.messages)} messages · ${projectsText(week)}`}
                      </p>
                      <div className="wk-percent">
                        <span className="week-track">
                          {week.percent !== undefined && (
                            <span className={week.hit ? 'week-bar hit' : week.percentEstimated ? 'week-bar estimated' : 'week-bar'} style={{ width: `${Math.min(week.percent, 100)}%` }} />
                          )}
                          {stats.medianPercent !== undefined && (
                            <span className="week-typical" style={{ left: `${Math.min(stats.medianPercent, 100)}%` }} {...tip(`Typical week: ${formatPercent(stats.medianPercent)}`, { focusable: false })} />
                          )}
                        </span>
                        <span className="wk-flags">
                          {isRestarted(week) && (
                            <span aria-label={isReset(week) ? 'Usage reset in this week' : 'Plan change in this week'} className="wk-plan-change" role="img" {...tip(restartTip(week, planFit.plan, timeZone))}>
                              {isReset(week) ? <ResetIcon /> : <PlanChangeIcon />}
                            </span>
                          )}
                          {week.hit && <HitIcon />}
                          {(week.blockedSessions > 0 || week.limitHits) && (
                            <span className="wk-blocked-mark" {...tip(blockedTip(week, timeZone))}>
                              <BlockedIcon />
                              {week.blockedSessions + (week.limitHits?.length ?? 0)}
                            </span>
                          )}
                        </span>
                        <strong className="wk-peak">{percentText(week)}</strong>
                        {uncapped && <span className="wk-uncapped" {...tip(uncappedTip(week, uncapped, timeZone))}>{uncappedText(uncapped.demand)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <ul className="legend session-legend">
                {legend.map((text, i) => (
                  <li className="wk-legend-heat" key={text}>
                    <span className={`legend-session heat-${i + 1}`} />
                    {text}
                  </li>
                ))}
                {stats.medianPercent !== undefined && (
                  <li>
                    <span className="legend-typical" />
                    {`typical week (median ${formatPercent(stats.medianPercent)})`}
                  </li>
                )}
                <li>
                  <span className="legend-swatch estimated" />
                  estimated
                </li>
                <li>
                  <span className="legend-swatch over" />
                  <HitIcon />
                  {`peak ≥ ${weekLimitThreshold}%`}
                </li>
                <li>
                  <BlockedIcon />
                  blocked by a rate limit
                </li>
                {weeks.some(w => w.planChange) && (
                  <li>
                    <PlanChangeIcon />
                    plan change in the week
                  </li>
                )}
                {weeks.some(isReset) && (
                  <li>
                    <ResetIcon />
                    usage reset in the week
                  </li>
                )}
              </ul>
            </>
          )}
    </section>
  );
}

function List({ summary, view }: { summary: Summary; view: HistoryView }) {
  const { limitThreshold, planFit, timeZone } = summary;
  const { weeks } = view.history.weekHistory;
  const tip = useTip();
  const { end, page, pages, setPage, start } = usePage(weeks.length, LIST_ROWS, view.range ? `${view.range.from}-${view.range.to}` : 'default');
  return (
    <section className="card">
      <h2>Week list</h2>
      {weeks.length === 0
        ? <p className="empty">{emptyText(view)}</p>
        : (
            <>
              <div className="table-scroll">
                <table className="table week-table">
                  <thead>
                    <tr>
                      <th scope="col">Week</th>
                      <th scope="col">Projects</th>
                      <th scope="col">
                        Sessions
                        <InfoTip label="About sessions">
                          {'5-hour windows started in the week.\n'}
                          <HitIcon size={13} />
                          {` peak ≥ ${limitThreshold}%\n`}
                          <BlockedIcon size={13} />
                          {' blocked by a rate limit'}
                        </InfoTip>
                      </th>
                      <th scope="col">Messages</th>
                      <th scope="col">
                        Cost
                        <InfoTip label="About cost">API-equivalent cost of the week's Claude Code messages.</InfoTip>
                      </th>
                      <th scope="col">Peak %</th>
                      <th scope="col">
                        Without the limit
                        <InfoTip label="About without the limit">The peak % plus the days a limit or a missing subscription hid, filled at your typical pace. The same estimate as the Plans tab, on your current plan.</InfoTip>
                      </th>
                      <th scope="col">
                        Source
                        <InfoTip label="About source">{'Reading: the peak % comes from a reading of the week.\nEstimated: no reading, so it comes from the transcripts and the calibration.'}</InfoTip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.slice(start, end).map((week) => {
                      const uncapped = uncappedOf(planFit, week);
                      return (
                        <tr key={week.start}>
                          <th scope="row">
                            {formatWeekRange(week, timeZone)}
                            {week.inProgress && <span className="session-now">in progress</span>}
                            {isRestarted(week) && (
                              <span className="session-now wk-plan-change" {...tip(restartTip(week, planFit.plan, timeZone))}>
                                {isReset(week) ? <ResetIcon size={13} /> : <PlanChangeIcon size={13} />}
                                {isReset(week) ? 'usage reset' : 'plan change'}
                              </span>
                            )}
                          </th>
                          <td {...(week.projects.length > 0 ? tip(week.projects.map(p => p.path).join('\n')) : {})}>{projectsText(week)}</td>
                          <td className="wk-sessions-cell">
                            {week.sessions}
                            {week.cappedSessions > 0 && (
                              <span className="wk-capped">
                                <HitIcon size={13} />
                                {week.cappedSessions}
                              </span>
                            )}
                            {week.blockedSessions > 0 && (
                              <span className="wk-blocked-sessions">
                                <BlockedIcon size={13} />
                                {week.blockedSessions}
                              </span>
                            )}
                          </td>
                          <td>{formatInteger(week.messages)}</td>
                          <td><strong>{formatUsd(week.cost)}</strong></td>
                          <td><strong>{percentText(week)}</strong></td>
                          <td {...(uncapped ? tip(uncappedTip(week, uncapped, timeZone)) : {})}>{uncapped ? uncappedText(uncapped.demand) : ''}</td>
                          <td className="secondary">{week.source}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <Pager
                  canNext={page < pages - 1}
                  canPrevious={page > 0}
                  label="Week list pages"
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

/** Past weekly windows: summary numbers, a week × day timeline and the list. */
export function Weeks({ summary, view = defaultView(summary) }: { summary: Summary; view?: HistoryView }) {
  return (
    <RangeFrame view={view}>
      <Stats summary={summary} view={view} />
      <Timeline summary={summary} view={view} />
      <List summary={summary} view={view} />
    </RangeFrame>
  );
}
