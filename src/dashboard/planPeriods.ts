import type { Plan, PlanPeriod } from '@/core/types';

import { formatDateTime } from '@/dashboard/format';

/** `datetime-local` value for an instant, in local time. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** "from the start" for the placeholder period that keeps the plan assumed so far. */
export function periodStart(from: string): string {
  return Date.parse(from) === 0 ? 'from the start' : `from ${formatDateTime(from)}`;
}

/**
 * History with `added` appended. Without history, everything before the new
 * period would take its plan: keep the plan assumed so far as a first period.
 */
export function withPeriod(history: readonly PlanPeriod[], assumed: Plan, added: PlanPeriod): PlanPeriod[] {
  const before: PlanPeriod[] = history.length === 0 && added.plan !== assumed
    ? [{ from: new Date(0).toISOString(), plan: assumed, source: 'manual' }]
    : [];
  return [...before, ...history, added];
}
