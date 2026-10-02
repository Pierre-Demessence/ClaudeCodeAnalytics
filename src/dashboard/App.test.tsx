import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    location.hash = '';
  });

  it('opens on the overview tab', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(summary())));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Weekly limit' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Past weeks' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Budget pacing this week' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Raw usage' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    // 95 % after 4 days: the trend fallback crosses the cap before reset.
    expect(screen.getByText(/^Likely to hit the limit/)).toBeTruthy();
    expect(screen.getByTitle(/Plan in effect now/).textContent).toBe('Pro');
  });

  it('switches tabs with the URL hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(summary())));
    render(<App />);
    await screen.findByRole('heading', { name: 'Weekly limit' });
    act(() => {
      location.hash = '#/usage';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('heading', { name: 'Raw usage' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Weekly limit' })).toBeNull();
    act(() => {
      location.hash = '#/calibration';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('heading', { name: /Settings/ })).toBeTruthy();
    expect(screen.getByText('Current plan:', { exact: false }).textContent).toContain('Pro');
  });

  it('toggles the theme from the header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(summary())));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('refreshes from the header', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(summary()));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('heading', { name: 'Weekly limit' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/collect'))).toBe(true));
  });

  it('shows the server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'boom' }, { status: 500 })));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });
});
