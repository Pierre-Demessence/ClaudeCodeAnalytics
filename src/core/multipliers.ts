import type { LimitsInput } from './limits.ts';
import type { Plan } from './types.ts';

import { driftWindows, MIN_DRIFT_WEEKS } from './limits.ts';
import { PLAN_MULTIPLIERS } from './plans.ts';
import { median, quantile } from './stats.ts';

/**
 * The advertised ratio between two plans and, once both have enough completed
 * weeks (`MIN_DRIFT_WEEKS`), the one measured from your own weeks.
 */
export interface MultiplierCheck {
  advertised: number;
  from: Plan;
  to: Plan;
  measured?: {
    fromWeeks: number;
    /** From the busier quartile of the smaller plan against the quieter one of the bigger. */
    high: number;
    /** From the quieter quartile of the smaller plan against the busier one of the bigger. */
    low: number;
    toWeeks: number;
    value: number;
  };
}

const NEIGHBOURS: readonly (readonly [Plan, Plan])[] = [['pro', 'max5'], ['max5', 'max20']];

/**
 * How much more usage a bigger plan gave, measured: the limit used per $100 of
 * Claude Code usage (the drift ratio) on the smaller plan over that on the
 * bigger one. The same work uses 5 times less of Max 5× than of Pro if it gives 5× the usage.
 */
export function buildMultipliers(input: LimitsInput): MultiplierCheck[] {
  const ratios = (plan: Plan) => driftWindows(input, plan).filter(w => !w.current).map(w => w.ratio);
  return NEIGHBOURS.map(([from, to]): MultiplierCheck => {
    const advertised = PLAN_MULTIPLIERS[to] / PLAN_MULTIPLIERS[from];
    const small = ratios(from);
    const big = ratios(to);
    if (small.length < MIN_DRIFT_WEEKS || big.length < MIN_DRIFT_WEEKS)
      return { advertised, from, to };
    return {
      advertised,
      from,
      to,
      measured: {
        fromWeeks: small.length,
        high: quantile(small, 0.75)! / quantile(big, 0.25)!,
        low: quantile(small, 0.25)! / quantile(big, 0.75)!,
        toWeeks: big.length,
        value: median(small)! / median(big)!,
      },
    };
  });
}
