import type { PlanFit, PlanFitInput } from '@/core/planFit';

import { PLAN_LABELS } from '@/core/plans';
import { formatDollars, formatPercent } from '@/dashboard/format';
import { cardVerdict, FIT_KIND, valueText } from '@/dashboard/plansData';
import { InfoTip } from '@/dashboard/Tip';
import { VerdictBox } from '@/dashboard/VerdictBox';

function Bar({ percent }: { percent: number }) {
  return (
    <span className="plan-track">
      <span className={percent >= 100 ? 'plan-bar over' : 'plan-bar'} style={{ width: `${Math.min(percent, 100)}%` }} />
    </span>
  );
}

function PlanCard({ fit, input, isCurrent, timeZone }: { fit: PlanFit; input: PlanFitInput; isCurrent: boolean; timeZone: string }) {
  const verdict = cardVerdict(fit, input, timeZone);
  return (
    <article className="card fit-card">
      <div className="card-head">
        <h2>{PLAN_LABELS[fit.plan]}</h2>
        {isCurrent && <span className="fit-tag">current</span>}
        <span className="card-head-spacer" />
        <span className="card-subtitle">{`${formatDollars(fit.price)} / month`}</span>
      </div>
      <div className="fit-stat">
        <span className="card-subtitle">Typical week</span>
        <strong className="fit-number">{formatPercent(fit.typical)}</strong>
        <Bar percent={fit.typical} />
      </div>
      <div className="fit-stat">
        <span className="fit-stat-row">
          <span className="card-subtitle">Busiest week</span>
          <strong>{formatPercent(fit.busiest)}</strong>
        </span>
        <Bar percent={fit.busiest} />
      </div>
      <dl className="fit-facts">
        <dt>Weeks over the limit</dt>
        <dd>{`${fit.weeksOver} of ${input.weeks.length}`}</dd>
        <dt>5-hour sessions over</dt>
        <dd>{`${fit.sessionsOver} of ${input.sessions.length}`}</dd>
        <dt>
          API value per $ paid
          <InfoTip label="About API value per dollar paid">
            A typical month of your usage at public API prices, counting only what fits under this plan's limit, divided by its price. It needs a calibration.
          </InfoTip>
        </dt>
        <dd>{valueText(fit.apiValueRatio)}</dd>
      </dl>
      <VerdictBox detail={verdict.detail} kind={FIT_KIND[fit.verdict]} title={verdict.title} />
    </article>
  );
}

/** Each plan's typical and busiest week, the weeks and sessions over its limit, and its verdict. */
export function PlanFitCards({ current, fits, input, timeZone }: { current: PlanFit; fits: readonly PlanFit[]; input: PlanFitInput; timeZone: string }) {
  return (
    <section aria-label="Plan comparison" className="fit-cards">
      {fits.map(fit => <PlanCard fit={fit} input={input} isCurrent={fit.plan === current.plan} key={fit.plan} timeZone={timeZone} />)}
    </section>
  );
}
