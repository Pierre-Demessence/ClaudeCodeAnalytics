import { TriangleAlert } from 'lucide-react';

import type { Summary } from '@/dashboard/api';

import { WEEK_MS } from '@/core/calibration';
import { convertPercent, PLAN_LABELS, PLANS } from '@/core/plans';
import { formatDay, formatPercent } from '@/dashboard/format';
import { useTip } from '@/dashboard/useTip';

/** Weeks shown in "Past weeks", newest first. */
const PAST_WEEKS = 8;

const HitIcon = () => <TriangleAlert aria-hidden="true" className="icon-inline icon-critical" size={14} />;

/** Final weekly % of the last completed weeks, on the current plan, against the typical week. */
export function PastWeeks({ summary }: { summary: Summary }) {
  const { plan, typical, weeks } = summary;
  const tip = useTip();
  const rows = weeks.slice(-PAST_WEEKS).reverse().map((week) => {
    const percent = convertPercent(week.percent, week.plan, plan);
    return { estimated: week.estimated, hit: percent >= 100, percent, start: Date.parse(week.resetsAt) - WEEK_MS };
  });
  const anyEstimated = rows.some(row => row.estimated);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Past weeks</h2>
        <span className="card-subtitle">{`final weekly % at reset, on ${PLAN_LABELS[plan]}`}</span>
      </div>
      {rows.length === 0
        ? <p className="empty">No completed week with readings yet. The first one ends at the next reset.</p>
        : (
            <>
              <ul className="week-bars">
                {rows.map(row => (
                  <li key={row.start}>
                    <span className="week-label">{`Week of ${formatDay(new Date(row.start).toISOString())}`}</span>
                    <span className="week-track">
                      <span
                        className={row.hit ? 'week-bar hit' : row.estimated ? 'week-bar estimated' : 'week-bar'}
                        style={{ width: `${Math.min(row.percent, 100)}%` }}
                      />
                      {typical && (
                        <span className="week-typical" style={{ left: `${Math.min(typical.median, 100)}%` }} {...tip(`Typical week: ${formatPercent(typical.median)}`)} />
                      )}
                    </span>
                    <span className="week-value">
                      <strong>{formatPercent(row.percent)}</strong>
                      {row.estimated && ' est.'}
                      {row.hit && <HitIcon />}
                    </span>
                  </li>
                ))}
              </ul>
              <ul className="legend">
                {typical && (
                  <li>
                    <span className="legend-typical" />
                    {`typical week (median of ${typical.weeks})`}
                  </li>
                )}
                <li>
                  <HitIcon />
                  hit the limit
                </li>
                {anyEstimated && (
                  <li>
                    <span className="legend-swatch estimated" />
                    est.: extended from an early reading
                  </li>
                )}
              </ul>
            </>
          )}
    </section>
  );
}

/** The typical week converted to each plan with the advertised multipliers. */
export function PlanEquivalents({ summary }: { summary: Summary }) {
  const { plan, typical } = summary;
  const tip = useTip();
  if (!typical)
    return null;
  const anyOver = PLANS.some(p => typical.byPlan[p] > 100);
  return (
    <section className="card">
      <h2>Typical week on each plan</h2>
      <p className="note">Your median week, converted with the advertised multipliers. Approximate.</p>
      <ul className="plan-bars">
        {PLANS.map((p) => {
          const percent = typical.byPlan[p];
          const range = `${formatPercent(convertPercent(typical.min, plan, p))}–${formatPercent(convertPercent(typical.max, plan, p))}`;
          return (
            <li key={p}>
              <span className="plan-bar-head">
                <span>
                  {PLAN_LABELS[p]}
                  {p === plan && <small> (current)</small>}
                </span>
                <strong {...tip(`Typical week on ${PLAN_LABELS[p]}; your weeks ranged ${range}.`)}>{`${p === plan ? '' : '≈ '}${formatPercent(percent)}`}</strong>
              </span>
              <span className="plan-track">
                <span className={percent > 100 ? 'plan-bar over' : 'plan-bar'} style={{ width: `${Math.min(percent, 100)}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="legend">
        <li>
          <span className="legend-swatch" />
          fits the plan
        </li>
        {anyOver && (
          <li>
            <span className="legend-swatch over" />
            over the limit (bar capped at 100%)
          </li>
        )}
      </ul>
    </section>
  );
}
