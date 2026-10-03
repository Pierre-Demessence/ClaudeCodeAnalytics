import type { PlanFit, PlanFitInput } from '@/core/planFit';

import { PLAN_LABELS } from '@/core/plans';
import { bestVerdict, FIT_KIND, shareText, switchText } from '@/dashboard/plansData';
import { VerdictBox } from '@/dashboard/VerdictBox';

interface Props {
  best: PlanFit;
  current: PlanFit;
  input: PlanFitInput;
  /** Share of Opus work moved to Sonnet; the card says so when above 0. */
  share: number;
  timeZone: string;
}

/** The plan that fits the last weeks best, and what switching to it does to the bill. It names no other plan. */
export function BestPlanCard({ best, current, input, share, timeZone }: Props) {
  const { action, tag } = switchText(best, current);
  const verdict = bestVerdict(best, input, timeZone);
  return (
    <section className="card fit-best">
      <div className="card-head">
        <h2>{`Best plan for your last ${input.weeks.length} weeks`}</h2>
        {share > 0 && <span className="fit-tag fit-scenario">{shareText(share)}</span>}
      </div>
      <div className="fit-best-name">
        <strong>{PLAN_LABELS[best.plan]}</strong>
        <span className="fit-tag">{tag}</span>
        {action && <span className="fit-action">{action}</span>}
      </div>
      <VerdictBox detail={verdict.detail} kind={FIT_KIND[best.verdict]} title={verdict.title} />
    </section>
  );
}
