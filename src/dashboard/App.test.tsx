import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Summary } from '@/dashboard/api';

import { DAY_MS } from '@/core/calibration';
import { buildSummary } from '@/core/summary';
import { App } from '@/dashboard/App';

const NOW = Date.now();
const RESET = new Date(NOW + 3 * DAY_MS).toISOString();

function summary(): Summary {
  const records = Array.from({ length: 10 }, (_, i) => ({
    cacheRead: 0,
    cacheWrite1h: 0,
    cacheWrite5m: 0,
    input: 0,
    key: `k${i}`,
    model: i % 2 ? 'claude-opus-5-5' : 'claude-haiku-4-5-20251001',
    output: 100_000,
    project: 'p',
    ts: new Date(NOW - (i + 1) * DAY_MS).toISOString(),
  }));
  return {
    ...buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [{ from: new Date(NOW - 30 * DAY_MS).toISOString(), plan: 'pro', source: 'detected' }],
      records,
      snapshots: [{ source: 'endpoint', ts: new Date(NOW - 3_600_000).toISOString(), weekly: 95, weeklyResetsAt: RESET }],
      timeZone: 'UTC',
    }),
    status: { endpointResult: 'ok', lastRunAt: new Date(NOW).toISOString(), messages: 10 },
  };
}

describe('app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders every section from the summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(summary())));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'This week' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Share of the plan per week' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Raw usage' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Settings/ })).toBeTruthy();
    // 95 % after 4 days: the trend fallback crosses the cap before reset.
    expect(screen.getByText('Likely to hit the weekly cap')).toBeTruthy();
    expect(screen.getByText('Current plan:', { exact: false }).textContent).toContain('Pro');
  });

  it('shows the server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'boom' }, { status: 500 })));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });
});
