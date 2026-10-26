import type { Plan, PlanPeriod } from './types.ts';

export const PLANS: readonly Plan[] = ['pro', 'max5', 'max20'];

export const PLAN_LABELS: Record<Plan, string> = { max20: 'Max 20×', max5: 'Max 5×', pro: 'Pro' };

/** Advertised usage relative to Pro. Approximate: Anthropic does not publish exact limits. */
export const PLAN_MULTIPLIERS: Record<Plan, number> = { max20: 20, max5: 5, pro: 1 };

/** Plan active at `ts`; before the first period, the first plan; Pro without history. */
export function planAt(history: readonly PlanPeriod[], ts: string): Plan {
  const time = Date.parse(ts);
  let active = history[0]?.plan ?? 'pro';
  for (const period of history) {
    if (Date.parse(period.from) <= time)
      active = period.plan;
  }
  return active;
}

export interface PlanChange {
  /** Start of the new period (ms). */
  at: number;
  from: Plan;
  to: Plan;
}

/** Each period whose plan differs from the one before; the first period is no change. */
export function planChanges(history: readonly PlanPeriod[]): PlanChange[] {
  return history.flatMap((period, i): PlanChange[] =>
    i > 0 && period.plan !== history[i - 1]!.plan ? [{ at: Date.parse(period.from), from: history[i - 1]!.plan, to: period.plan }] : []);
}

/**
 * Whether a period of another plan starts inside a window (strictly: a change
 * at its start leaves it whole).
 */
export function planChangeWithin(history: readonly PlanPeriod[], from: number, to: number): boolean {
  return planChanges(history).some(change => change.at > from && change.at < to);
}

/** List price in USD per month (monthly billing, checked 2026-10-03). */
export const PLAN_PRICES: Record<Plan, number> = { max20: 200, max5: 100, pro: 20 };

/** The same absolute usage, expressed as a % of another plan's limit. */
export function convertPercent(percent: number, from: Plan, to: Plan): number {
  return percent * PLAN_MULTIPLIERS[from] / PLAN_MULTIPLIERS[to];
}

/** Maps the credentials' `subscriptionType` / `rateLimitTier` to a plan, if recognised. */
export function planFromSubscription(subscriptionType: string | undefined, rateLimitTier: string | undefined): Plan | undefined {
  if (subscriptionType === 'pro')
    return 'pro';
  if (subscriptionType === 'max')
    return rateLimitTier?.includes('20x') ? 'max20' : 'max5';
  return undefined;
}

/**
 * Appends a detected period when it differs from the plan active at `ts`.
 * A manual period wins over detection; the dashboard shows the mismatch instead.
 */
export function withDetectedPlan(history: readonly PlanPeriod[], plan: Plan, ts: string): readonly PlanPeriod[] {
  const time = Date.parse(ts);
  const active = history.findLast(period => Date.parse(period.from) <= time);
  if (active?.source === 'manual' || (history.length > 0 && planAt(history, ts) === plan))
    return history;
  const detected: PlanPeriod = { from: ts, plan, source: 'detected' };
  return [...history, detected].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
}
