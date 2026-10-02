// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Credentials } from './endpoint.ts';

import { fetchUsage, parseUsageResponse, readCredentials, roundToMinute } from './endpoint.ts';

// Trimmed from a real response (2026-10-02).
const RESPONSE = {
  extra_usage: { is_enabled: false },
  five_hour: { resets_at: '2026-10-02T12:50:00.452964+00:00', utilization: 35.0 },
  seven_day: { resets_at: '2026-10-07T20:00:00.452990+00:00', utilization: 44.0 },
  seven_day_opus: null,
  seven_day_breakdown: {
    window_started_at: '2026-09-30T20:00:00.452990+00:00',
    rows: [
      { key: 'claude_code', percent: 100 },
      { key: 'chat', percent: 0 },
    ],
  },
};

describe('roundToMinute', () => {
  it('removes the sub-minute jitter', () => {
    expect(roundToMinute('2026-10-07T20:00:00.452990+00:00')).toBe('2026-10-07T20:00:00.000Z');
    expect(roundToMinute('nonsense')).toBeUndefined();
  });
});

describe('parseUsageResponse', () => {
  it('extracts the weekly and 5-hour windows and the Claude Code share', () => {
    expect(parseUsageResponse(RESPONSE, '2026-10-02T08:57:07.000Z')).toEqual({
      claudeCodeShare: 100,
      fiveHour: 35,
      fiveHourResetsAt: '2026-10-02T12:50:00.000Z',
      source: 'endpoint',
      ts: '2026-10-02T08:57:07.000Z',
      weekly: 44,
      weeklyResetsAt: '2026-10-07T20:00:00.000Z',
    });
  });

  it('rejects a response without the weekly window', () => {
    expect(parseUsageResponse({ five_hour: RESPONSE.five_hour }, 'x')).toBeUndefined();
    expect(parseUsageResponse(null, 'x')).toBeUndefined();
  });
});

describe('readCredentials', () => {
  let dir: string;
  const now = Date.parse('2026-10-02T09:00:00Z');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cca-creds-'));
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  const write = (content: unknown) => writeFile(join(dir, '.credentials.json'), JSON.stringify(content));

  it('reads the token and the subscription', async () => {
    await write({ claudeAiOauth: { accessToken: 'tok', expiresAt: now + 3_600_000, rateLimitTier: 'tier', subscriptionType: 'pro' } });
    expect(await readCredentials(dir, now)).toEqual({ expiresAt: now + 3_600_000, rateLimitTier: 'tier', subscriptionType: 'pro', token: 'tok' });
  });

  it('reports a missing file or token', async () => {
    expect(await readCredentials(dir, now)).toBe('no-token');
    await write({ claudeAiOauth: {} });
    expect(await readCredentials(dir, now)).toBe('no-token');
  });

  it('reports an expired token instead of refreshing it', async () => {
    await write({ claudeAiOauth: { accessToken: 'tok', expiresAt: now - 1 } });
    expect(await readCredentials(dir, now)).toBe('expired');
  });
});

describe('fetchUsage', () => {
  const credentials: Credentials = { subscriptionType: 'pro', token: 'secret-token' };
  const now = Date.parse('2026-10-02T08:57:07Z');

  it('sends the token and a Claude Code user agent, and adds the subscription', async () => {
    const fetchImpl = vi.fn(async () => Response.json(RESPONSE));
    const snapshot = await fetchUsage(credentials, '2.1.287', now, fetchImpl);
    expect(snapshot).toMatchObject({ subscriptionType: 'pro', weekly: 44 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(init.headers).toMatchObject({ 'Authorization': 'Bearer secret-token', 'User-Agent': 'claude-code/2.1.287' });
  });

  it('maps failures to error kinds', async () => {
    expect(await fetchUsage(credentials, '1', now, async () => new Response('', { status: 429 }))).toBe('http-429');
    expect(await fetchUsage(credentials, '1', now, async () => new Response('not json'))).toBe('bad-shape');
    expect(await fetchUsage(credentials, '1', now, async () => Response.json({}))).toBe('bad-shape');
    expect(await fetchUsage(credentials, '1', now, async () => {
      throw new TypeError('offline');
    })).toBe('network');
  });
});
