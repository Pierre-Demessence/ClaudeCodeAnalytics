import { TriangleAlert } from 'lucide-react';

import type { PlanFitInput } from '@/core/planFit';
import type { Plan } from '@/core/types';

import { dayKey } from '@/core/aggregate';
import { PLAN_LABELS, PLANS } from '@/core/plans';
import { formatDay } from '@/dashboard/format';
import { chartBars } from '@/dashboard/plansData';
import { Toggle } from '@/dashboard/Toggle';
import { useTip } from '@/dashboard/useTip';

interface Props {
  input: PlanFitInput;
  plan: Plan;
  /** Share of Opus work moved to Sonnet. */
  share: number;
  timeZone: string;
  onPlanChange: (plan: Plan) => void;
}

/** The finished weeks, each as a % of the chosen plan's weekly limit. */
export function FitChart({ input, onPlanChange, plan, share, timeZone }: Props) {
  const tip = useTip();
  const bars = chartBars(input, plan, share, timeZone);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Each past week on</h2>
        <Toggle label="Plan shown in the chart" onChange={onPlanChange} options={PLANS.map(p => [p, PLAN_LABELS[p]])} value={plan} />
        <span className="card-head-spacer" />
        <span className="card-subtitle">Week starting date; % of the weekly limit</span>
      </div>
      <div className="fit-chart-scroll">
        <ol className="fit-chart">
          {bars.map(bar => (
            <li key={bar.start} {...tip(bar.tip)}>
              <span className="fit-bar-label">
                {bar.over && <TriangleAlert aria-hidden="true" className="icon-inline icon-critical" size={14} />}
                {bar.label}
              </span>
              <span className="fit-plot">
                <span className="fit-limit" />
                <span className={bar.over ? 'fit-bar over' : bar.estimated ? 'fit-bar estimated' : 'fit-bar'} style={{ height: `${bar.height}%` }} />
              </span>
              <span className="fit-bar-date">{formatDay(dayKey(Date.parse(bar.start), timeZone))}</span>
            </li>
          ))}
        </ol>
      </div>
      <ul className="legend">
        <li>
          <span className="legend-swatch" />
          fits the plan
        </li>
        <li>
          <span className="legend-swatch estimated" />
          estimated: not a final reading, or the limit was reached and this is the transcript estimate
        </li>
        <li>
          <span className="legend-swatch over" />
          <TriangleAlert aria-hidden="true" className="icon-inline icon-critical" size={14} />
          over the limit (bar cut at 150%)
        </li>
        <li>
          <span className="legend-typical" />
          limit (100%)
        </li>
      </ul>
    </section>
  );
}
