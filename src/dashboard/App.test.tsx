import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SummaryInput } from '@/core/summary';
import type { Summary } from '@/dashboard/api';

import { DAY_MS } from '@/core/calibration';
import { buildRanged } from '@/core/ranged';
import { buildSummary } from '@/core/summary';
import { App } from '@/dashboard/App';

const NOW = Date.now();
const RESET = new Date(NOW + 3 * DAY_MS).toISOString();

function input(): SummaryInput {
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
    endpointEnabled: true,
    now: NOW,
    planHistory: [{ from: new Date(NOW - 30 * DAY_MS).toISOString(), plan: 'pro', source: 'detected' }],
    records,
    snapshots: [{ source: 'endpoint', ts: new Date(NOW - 3_600_000).toISOString(), weekly: 95, weeklyResetsAt: RESET }],
    timeZone: 'UTC',
  };
}

function summary(): Summary {
  return {
    ...buildSummary(input()),
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
    expect(screen.queryByRole('heading', { name: 'Past weeks' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Budget pacing this week' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Daily usage by model' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    // 95 % after 4 days: the trend fallback crosses the cap before reset.
    expect(screen.getByText(/^Likely to hit the limit/)).toBeTruthy();
    expect(document.querySelector('.plan-badge')!.textContent).toBe('Pro');
  });

  it('switches tabs with the URL hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(summary())));
    render(<App />);
    await screen.findByRole('heading', { name: 'Weekly limit' });
    act(() => {
      location.hash = '#/usage';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('heading', { name: 'Daily usage by model' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Weekly limit' })).toBeNull();
    act(() => {
      location.hash = '#/weeks';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('heading', { name: 'Weekly usage, last 12 weeks' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Weeks' }).getAttribute('aria-current')).toBe('page');
    act(() => {
      location.hash = '#/calibration';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('heading', { name: 'Limit drift' })).toBeTruthy();
    expect((screen.getByLabelText('Plan', { selector: '#plan-select' }) as HTMLSelectElement).value).toBe('pro');
  });

  it('opens a tab on the range in the hash, and carries it to the other history tabs', async () => {
    location.hash = '#/breakdown?range=3months';
    const fetch = vi.fn(async (url: string) => {
      if (!url.startsWith('/api/range'))
        return Response.json(summary());
      const params = new URL(url, 'http://localhost').searchParams;
      return Response.json(buildRanged(input(), { from: Number(params.get('from')), to: Number(params.get('to')) }));
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('button', { name: 'Last 3 months' });
    expect(screen.getByRole('button', { name: 'Last 3 months' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(screen.getByText(/^Total/).textContent).toBe('Total $13'));
    expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/range'))).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Weeks' }).getAttribute('href')).toBe('#/weeks?range=3months');
    expect(screen.getByRole('link', { name: 'Plans' }).getAttribute('href')).toBe('#/plans');

    act(() => {
      location.hash = '#/weeks?range=3months';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('button', { name: 'Last 3 months' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: /^Weekly usage, \d/ })).toBeTruthy();
  });

  it('shows the default windows without a range, and fetches no range', async () => {
    location.hash = '#/sessions';
    const fetch = vi.fn(async (_url: string) => Response.json(summary()));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    expect(await screen.findByRole('heading', { name: '5-hour sessions, last 7 days' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Default' }).getAttribute('aria-pressed')).toBe('true');
    expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/range'))).toBe(false);
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

  it('ignores a slow response that a newer request has superseded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let finishRefresh!: (response: Response) => void;
    let plan = 'pro';
    const fetch = vi.fn((url: string) => url.startsWith('/api/collect')
      ? new Promise<Response>((resolve) => { finishRefresh = resolve; })
      : Promise.resolve(Response.json({ ...summary(), plan })));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('heading', { name: 'Weekly limit' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    // The auto-reload fires while the refresh is still running and finishes first.
    plan = 'max5';
    await act(async () => vi.advanceTimersByTime(5 * 60_000));
    await waitFor(() => expect(document.querySelector('.plan-badge')?.textContent).toBe('Max'));
    await act(async () => finishRefresh(Response.json({ ...summary(), plan: 'pro' })));
    expect(document.querySelector('.plan-badge')!.textContent).toBe('Max');
    vi.useRealTimers();
  });

  it('reloads every 30 seconds while the token is expired, every 5 minutes otherwise', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let result = 'expired';
    const fetch = vi.fn(async (_url: string) => Response.json({ ...summary(), status: { ...summary().status, endpointResult: result } }));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('heading', { name: 'Weekly limit' });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => vi.advanceTimersByTime(30_000));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    result = 'ok';
    await act(async () => vi.advanceTimersByTime(30_000));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('paints the stored summary first, then replaces it with the imported one', async () => {
    let finishFull!: (response: Response) => void;
    const fetch = vi.fn((url: string) => url.includes('collect=0')
      ? Promise.resolve(Response.json({ ...summary(), plan: 'pro' }))
      : new Promise<Response>((resolve) => { finishFull = resolve; }));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('heading', { name: 'Weekly limit' });
    expect(document.querySelector('.plan-badge')!.textContent).toBe('Pro');
    // While the full request runs, the page stays and shows the busy state.
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByText('Updating…')).toBeTruthy();
    expect(new URL(fetch.mock.calls[0]![0], 'http://x').searchParams.get('collect')).toBe('0');
    expect(new URL(fetch.mock.calls[1]![0], 'http://x').searchParams.has('collect')).toBe(false);
    await act(async () => finishFull(Response.json({ ...summary(), plan: 'max5' })));
    expect(document.querySelector('.plan-badge')!.textContent).toBe('Max');
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it('shows no error when the stored summary fails but the full one succeeds', async () => {
    const fetch = vi.fn(async (url: string) => url.includes('collect=0')
      ? Response.json({ error: 'stored failed' }, { status: 500 })
      : Response.json(summary()));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Weekly limit' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error when both requests fail', async () => {
    const fetch = vi.fn(async () => Response.json({ error: 'both failed' }, { status: 500 }));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toContain('both failed');
  });

  it('shows the server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'boom' }, { status: 500 })));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });
});
