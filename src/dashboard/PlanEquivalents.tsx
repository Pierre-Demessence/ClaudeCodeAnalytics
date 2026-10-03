import type { Summary } from '@/dashboard/api';

import { convertPercent, PLAN_LABELS, PLANS } from '@/core/plans';
import { formatPercent } from '@/dashboard/format';
import { useTip } from '@/dashboard/useTip';

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
