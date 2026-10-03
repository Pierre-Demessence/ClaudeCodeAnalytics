import { useState } from 'react';

import type { Plan } from '@/core/types';
import type { Summary } from '@/dashboard/api';
import type { ShareKey } from '@/dashboard/plansData';

import { bestPlan, evaluatePlans, MIN_FIT_WEEKS } from '@/core/planFit';
import { BestPlanCard } from '@/dashboard/BestPlanCard';
import { FitChart } from '@/dashboard/FitChart';
import { MultipliersCard } from '@/dashboard/MultipliersCard';
import { PlanFitCards } from '@/dashboard/PlanFitCards';
import { SHARE_OPTIONS } from '@/dashboard/plansData';
import { Toggle } from '@/dashboard/Toggle';
import { VerdictBox } from '@/dashboard/VerdictBox';

function NotEnoughHistory({ weeks }: { weeks: number }) {
  return (
    <section className="card">
      <h2>Not enough history yet</h2>
      <VerdictBox detail={`You have ${weeks}. Weeks count once they have a plan-limit reading or a calibrated estimate.`} kind="info" title={`Plan comparison needs ${MIN_FIT_WEEKS} completed weeks.`} />
      <div aria-label={`${weeks} of ${MIN_FIT_WEEKS} weeks collected`} className="fit-progress" role="img">
        {Array.from({ length: MIN_FIT_WEEKS }, (_, i) => <span className={i < weeks ? 'done' : undefined} key={i} />)}
      </div>
      <span className="card-subtitle">{`${weeks} of ${MIN_FIT_WEEKS} weeks`}</span>
    </section>
  );
}

export function Plans({ summary }: { summary: Summary }) {
  const { multipliers, plan, planFit, timeZone } = summary;
  const [shareKey, setShareKey] = useState<ShareKey>('0');
  const [chartPlan, setChartPlan] = useState<Plan>(plan);
  const share = Number(shareKey);

  if (planFit.weeks.length < MIN_FIT_WEEKS)
    return <NotEnoughHistory weeks={planFit.weeks.length} />;

  const fits = evaluatePlans(planFit, share);
  const best = bestPlan(fits);
  const current = fits.find(fit => fit.plan === plan)!;
  return (
    <>
      <div className="fit-top">
        <BestPlanCard best={best} current={current} input={planFit} share={share} timeZone={timeZone} />
        <section className="card fit-whatif">
          <h2>What if Opus ran on Sonnet?</h2>
          <p className="note">Re-prices the whole tab. Approximate.</p>
          <Toggle label="Share of Opus work moved to Sonnet" onChange={setShareKey} options={SHARE_OPTIONS} value={shareKey} />
        </section>
      </div>
      <PlanFitCards current={current} fits={fits} input={planFit} timeZone={timeZone} />
      <FitChart input={planFit} onPlanChange={setChartPlan} plan={chartPlan} share={share} timeZone={timeZone} />
      <MultipliersCard multipliers={multipliers} />
    </>
  );
}
