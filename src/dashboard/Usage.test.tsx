import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { UsageRecord } from '@/core/types';
import type { Summary } from '@/dashboard/api';
import type { Bucket } from '@/dashboard/usageData';

import { DAY_MS, HOUR_MS } from '@/core/calibration';
import { buildSummary } from '@/core/summary';
import { formatUsd } from '@/dashboard/format';
import { Usage } from '@/dashboard/Usage';
import { UsageTooltip } from '@/dashboard/UsageChart';

const NOW = Date.now();

/** $20 of Opus 5.5 output by default. */
function rec(ago: number, extra: Partial<UsageRecord> = {}): UsageRecord {
  const ts = new Date(NOW - ago).toISOString();
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\app', input: 0, key: ts + JSON.stringify(extra), model: 'claude-opus-5-5', output: 1_000_000, project: 'p', sessionId: 's1', ts, ...extra };
}

function summary(records: UsageRecord[]): Summary {
  const resetsAt = new Date(NOW + 3 * DAY_MS).toISOString();
  return {
    ...buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [],
      records,
      snapshots: [{ source: 'endpoint', ts: new Date(NOW - 10 * 60_000).toISOString(), weekly: 42, weeklyResetsAt: resetsAt }],
      timeZone: 'UTC',
    }),
    status: {},
  };
}

const card = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

describe('usage tab', () => {
  afterEach(cleanup);

  it('switches the chart between days and weeks', () => {
    render(<Usage summary={summary([rec(HOUR_MS)])} />);
    expect(screen.getByRole('heading', { name: 'Daily usage by model' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('heading', { name: 'Weekly usage by model' })).toBeTruthy();
  });

  it('names the busiest hour and gives every cell a tooltip', () => {
    const at = new Date(NOW - DAY_MS);
    at.setUTCHours(14, 30);
    render(<Usage summary={summary([rec(NOW - at.getTime()), rec(2 * DAY_MS, { output: 100_000 })])} />);
    const heatmap = card('When you work');
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getUTCDay()];
    expect(within(heatmap).getByTitle(/^Hour with the highest/).textContent).toBe(`Busiest: ${weekday} 14:00–15:00`);
    expect(within(heatmap).getAllByTitle(/per day on average$/)).toHaveLength(7 * 24);
  });

  it('shows this week\'s cache figures and flags poor days', () => {
    // Whole days apart, so the two days never merge whatever the time of the run.
    render(<Usage summary={summary([rec(DAY_MS, { cacheRead: 900_000, input: 100_000 }), rec(2 * DAY_MS, { cacheRead: 100, input: 900 })])} />);
    const cache = card('Cache efficiency');
    expect(within(cache).getByTitle(/^Share of input tokens/).textContent).toBe('90%input from cache');
    const bars = within(cache).getAllByTitle(/of input from cache$/);
    expect(bars.map(bar => [bar.title.endsWith(': 10% of input from cache'), bar.classList.contains('poor')])).toEqual([[true, true], [false, false]]);
  });

  it('lists the outliers with their cause, and the total count', () => {
    // Two hours apart: each one's 1-hour cache had expired.
    const records = [1, 2, 3, 4, 5, 6].map(n => rec(n * 2 * HOUR_MS, { cacheWrite1h: 500_000, output: 0 }));
    render(<Usage summary={summary(records)} />);
    const costs = card('Cost per message');
    expect(within(costs).getByText('The 5 costliest of 6 messages over $1.')).toBeTruthy();
    expect(within(costs).getAllByRole('row')).toHaveLength(5);
    expect(within(costs).getAllByText(/^1h cache write, 500k tokens/)).toHaveLength(5);
    // The 5 newest tie on cost and stay in order: each has an older message 2 hours before it.
    expect(within(costs).getAllByText(/after a 2 h 0 min pause$/)).toHaveLength(5);
  });

  it('shows empty states without usage this week', () => {
    render(<Usage summary={summary([rec(40 * DAY_MS)])} />);
    expect(within(card('Cache efficiency')).getByText('No usage this week yet.')).toBeTruthy();
    expect(within(card('Cost per message')).getByText('No usage this week yet.')).toBeTruthy();
    expect(within(card('When you work')).getByText('No usage in the last 4 weeks.')).toBeTruthy();
  });
});

describe('usage tooltip', () => {
  afterEach(cleanup);

  const bucket: Bucket = { bucket: '2026-10-01', label: '1 Oct', total: 6, upgrade: '2.1.287', values: { haiku: 1, opus: 3, sonnet: 2 } };
  const payload = [{ payload: bucket }] as never;

  it('lists families bottom to top, then the total and the upgrade', () => {
    render(<UsageTooltip active format={formatUsd} payload={payload} />);
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['Opus$3.00', 'Sonnet$2.00', 'Haiku$1.00', 'Total$6.00']);
    expect(screen.getByText('Claude Code 2.1.287')).toBeTruthy();
  });
});
