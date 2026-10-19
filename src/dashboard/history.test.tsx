import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SummaryInput } from '@/core/summary';
import type { UsageRecord } from '@/core/types';
import type { Summary } from '@/dashboard/api';

import { DAY_MS } from '@/core/calibration';
import { resolveRange } from '@/core/range';
import { buildRanged } from '@/core/ranged';
import { buildSummary } from '@/core/summary';
import { defaultHistory, rangeContext, useHistoryView } from '@/dashboard/history';

const NOW = Date.parse('2026-10-19T12:00:00Z');

function rec(ago: number, extra: Partial<UsageRecord> = {}): UsageRecord {
  const ts = new Date(NOW - ago).toISOString();
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\secret-app', input: 0, key: ts, model: 'claude-opus-5-5', output: 1_000_000, project: 'p', sessionId: 's1', ts, ...extra };
}

const input: SummaryInput = {
  endpointEnabled: false,
  now: NOW,
  planHistory: [],
  records: [rec(DAY_MS), rec(40 * DAY_MS), rec(100 * DAY_MS)],
  snapshots: [],
  timeZone: 'UTC',
  titles: { s1: { title: 'Fix the secret parser' } },
};
const summary: Summary = { ...buildSummary(input), status: {} };

/** Answers `/api/range` like the server, over the stored records. */
function serve() {
  const fetch = vi.fn(async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams;
    return Response.json(buildRanged(input, { from: Number(params.get('from')), to: Number(params.get('to')) }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('useHistoryView', () => {
  beforeEach(() => {
    location.hash = '#/usage';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    location.hash = '';
  });

  it('reads the summary and fetches nothing without a range', () => {
    const fetch = serve();
    const { result } = renderHook(() => useHistoryView(summary, false));
    expect(result.current!.history).toEqual(defaultHistory(summary));
    expect(result.current).toMatchObject({ choice: undefined, loading: false, range: undefined });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is undefined until the summary is there', () => {
    const { result } = renderHook(() => useHistoryView(undefined, false));
    expect(result.current).toBeUndefined();
  });

  it('fetches the range from the hash, keeping the summary until the answer arrives', async () => {
    location.hash = '#/usage?range=3months';
    const fetch = serve();
    const { result } = renderHook(() => useHistoryView(summary, false));
    expect(result.current!.loading).toBe(true);
    expect(result.current!.history).toEqual(defaultHistory(summary));
    await waitFor(() => expect(result.current!.loading).toBe(false));

    const range = resolveRange({ back: 0, kind: 'preset', preset: '3months' }, rangeContext(summary));
    expect(result.current!.range).toEqual(range);
    expect(result.current!.history.breakdown).toEqual(buildRanged(input, range).breakdown);
    expect(fetch).toHaveBeenCalledOnce();
    const url = new URL(fetch.mock.calls[0]![0], 'http://localhost');
    expect(url.pathname).toBe('/api/range');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: String(range.from), to: String(range.to), tz: expect.any(String) });
  });

  it('keeps the previous range\'s data, loading, while another is fetched', async () => {
    location.hash = '#/usage?range=3months';
    serve();
    const { result } = renderHook(() => useHistoryView(summary, false));
    await waitFor(() => expect(result.current!.loading).toBe(false));
    const three = result.current!.history;

    act(() => result.current!.onChoose({ back: 0, kind: 'preset', preset: 'all' }));
    act(() => void dispatchEvent(new HashChangeEvent('hashchange')));
    expect(result.current!.loading).toBe(true);
    expect(result.current!.history).toBe(three);
    await waitFor(() => expect(result.current!.loading).toBe(false));
    expect(result.current!.history.breakdown.total.messages).toBe(3);
    expect(three.breakdown.total.messages).toBe(2);
  });

  it('returns to the summary when the range is cleared', async () => {
    location.hash = '#/usage?range=3months';
    serve();
    const { result } = renderHook(() => useHistoryView(summary, false));
    await waitFor(() => expect(result.current!.loading).toBe(false));
    act(() => result.current!.onChoose(undefined));
    act(() => void dispatchEvent(new HashChangeEvent('hashchange')));
    expect(result.current!.history).toEqual(defaultHistory(summary));
    expect(result.current!.range).toBeUndefined();
  });

  it('masks names in the ranged data in anonymous mode', async () => {
    location.hash = '#/usage?range=all';
    serve();
    const { result } = renderHook(() => useHistoryView(summary, true));
    await waitFor(() => expect(result.current!.loading).toBe(false));
    const json = JSON.stringify(result.current!.history);
    expect(json).not.toContain('secret');
    expect(result.current!.history.breakdown.projects[0]!.name).toBe('Project 1');
  });

  it('reports a failed fetch and stops loading', async () => {
    location.hash = '#/usage?range=all';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Range too long' }, { status: 400 })));
    const { result } = renderHook(() => useHistoryView(summary, false));
    await waitFor(() => expect(result.current!.error).toBe('Range too long'));
    expect(result.current!.loading).toBe(false);
    expect(result.current!.history).toEqual(defaultHistory(summary));
  });

  it('fetches nothing while the open tab does not read the range', () => {
    location.hash = '#/usage?range=3months';
    const fetch = serve();
    const { result } = renderHook(() => useHistoryView(summary, false, false));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current!.history).toEqual(defaultHistory(summary));
  });

  it('abandons the request of a range left behind', async () => {
    location.hash = '#/usage?range=3months';
    const fetch = serve();
    const { unmount } = renderHook(() => useHistoryView(summary, false));
    const signal = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('fetches again when the summary reloads and the range includes now, not for a past range', async () => {
    location.hash = '#/usage?range=3months';
    const fetch = serve();
    const { rerender, result } = renderHook(({ shown }) => useHistoryView(shown, false), { initialProps: { shown: summary } });
    await waitFor(() => expect(result.current!.loading).toBe(false));
    rerender({ shown: { ...summary, generatedAt: new Date(NOW + 60_000).toISOString() } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    act(() => result.current!.onChoose({ back: 1, kind: 'preset', preset: '3months' }));
    act(() => void dispatchEvent(new HashChangeEvent('hashchange')));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    rerender({ shown: { ...summary, generatedAt: new Date(NOW + 120_000).toISOString() } });
    await waitFor(() => expect(result.current!.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
