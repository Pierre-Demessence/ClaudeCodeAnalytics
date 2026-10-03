import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MultiplierCheck } from '@/core/multipliers';
import type { PlanFitInput } from '@/core/planFit';
import type { Summary } from '@/dashboard/api';

import { buildSummary } from '@/core/summary';
import { Plans } from '@/dashboard/Plans';
import { TipProvider } from '@/dashboard/Tip';

const NOW = Date.parse('2026-10-03T12:00:00Z');

/** The design's sample: Max 5× with one week (7 Aug) and two sessions over the limit. */
const percents = [41, 55, 63, 47, 118, 72, 58, 66, 49, 84, 62, 77];
const peaks = [12, 35, 48, 22, 64, 71, 18, 55, 112, 41, 29, 66, 38, 52, 24, 77, 45, 33, 60, 19, 88, 43, 27, 104, 58, 36, 50, 31, 69, 40];
const planFit: PlanFitInput = {
  plan: 'max5',
  sessions: peaks.map(demand => ({ demand, estimated: false, shift: 0.3 })),
  weeklyBudget: 480,
  weeks: percents.map((demand, i) => ({
    cost: demand * 4.8,
    demand,
    estimated: demand > 100,
    shift: 0.3,
    start: new Date(Date.UTC(2026, 6, 10 + 7 * i, 7)).toISOString(),
  })),
};
const multipliers: MultiplierCheck[] = [
  { advertised: 5, from: 'pro', measured: { fromWeeks: 6, high: 5.4, low: 3.9, toWeeks: 6, value: 4.6 }, to: 'max5' },
  { advertised: 4, from: 'max5', to: 'max20' },
];

function summary(extra: Partial<Summary> = {}): Summary {
  return { ...buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [], snapshots: [], timeZone: 'UTC' }), status: {}, ...extra };
}

const full = () => summary({ multipliers, plan: 'max5', planFit });
const renderTab = (data: Summary) => render(<TipProvider><Plans summary={data} /></TipProvider>);
const card = (name: string) => screen.getByRole('heading', { name }).closest('section, article') as HTMLElement;

describe('plans tab', () => {
  afterEach(cleanup);

  it('asks for more weeks before comparing', () => {
    renderTab(summary({ planFit: { ...planFit, weeks: planFit.weeks.slice(0, 2) } }));
    expect(screen.getByText('Plan comparison needs 3 completed weeks.')).toBeTruthy();
    expect(screen.getByRole('img', { name: '2 of 3 weeks collected' })).toBeTruthy();
    expect(screen.queryByText(/Best plan/)).toBeNull();
  });

  it('names the best plan with its verdict, and only that plan', () => {
    renderTab(full());
    const best = card('Best plan for your last 12 weeks');
    expect(within(best).getByText('Max 5×')).toBeTruthy();
    expect(within(best).getByText('your current plan')).toBeTruthy();
    expect(within(best).getByText('Close.')).toBeTruthy();
    expect(best.textContent).toContain('Over the limit in 1 of 12 weeks (');
    expect(best.textContent).toContain('2 of 30 sessions');
    expect(best.textContent).not.toMatch(/Pro|Max 20×/);
  });

  it('gives each plan a verdict with its own title', () => {
    renderTab(full());
    expect(within(card('Pro')).getByText('Too small.')).toBeTruthy();
    expect(within(card('Max 5×')).getByText('Close.')).toBeTruthy();
    expect(within(card('Max 20×')).getByText('Too big.')).toBeTruthy();
    expect(within(card('Max 5×')).getByText('current')).toBeTruthy();
    expect(within(card('Max 20×')).getByText('$200 / month')).toBeTruthy();
  });

  it('re-prices the whole tab when Opus work moves to Sonnet', () => {
    renderTab(full());
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const best = card('Best plan for your last 12 weeks');
    expect(within(best).getByText('All Opus work on Sonnet')).toBeTruthy();
    expect(within(best).getByText('Fits every week and session.')).toBeTruthy();
    expect(within(card('Max 5×')).getByText('Fits every week and session.')).toBeTruthy();
    expect(within(card('Max 5×')).getByText('0 of 12')).toBeTruthy();
  });

  it('suggests a cheaper plan with what switching saves', () => {
    const light: PlanFitInput = { ...planFit, plan: 'max20', sessions: [], weeks: planFit.weeks.map(w => ({ ...w, demand: w.demand / 4 })) };
    renderTab(summary({ multipliers, plan: 'max20', planFit: light }));
    const best = card('Best plan for your last 12 weeks');
    expect(within(best).getByText('Max 5×')).toBeTruthy();
    expect(within(best).getByText('switch from Max 20×')).toBeTruthy();
    expect(within(best).getByText('Saves $100 / month')).toBeTruthy();
  });

  it('draws the weeks on the chosen plan, hatching and flagging the ones over the limit', () => {
    renderTab(full());
    const chart = card('Each past week on');
    expect(chart.querySelectorAll('.fit-bar.over')).toHaveLength(1);
    fireEvent.click(within(chart).getByRole('button', { name: 'Pro' }));
    expect(within(chart).getByText('590%')).toBeTruthy();
    expect(chart.querySelectorAll('.fit-bar.over')).toHaveLength(12);
    fireEvent.click(within(chart).getByRole('button', { name: 'Max 20×' }));
    expect(chart.querySelectorAll('.fit-bar.over')).toHaveLength(0);
  });

  it('shows the measured multiplier, or says it is not measured', () => {
    renderTab(full());
    const trust = card('How far to trust the conversions');
    expect(within(trust).getByText('measured 4.6×')).toBeTruthy();
    expect(within(trust).getByText('not measured')).toBeTruthy();
    expect(trust.textContent).toContain('advertised 4× is used');
  });
});
