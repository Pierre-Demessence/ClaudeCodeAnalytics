// @vitest-environment node
import type { AddressInfo } from 'node:net';

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { acquireLock } from '../collector/lock.ts';
import { Store } from '../collector/store.ts';
import { createApiMiddleware } from './api.ts';

describe('api routes', () => {
  let root: string;
  let base: string;
  let close: () => void;
  const env = { ...process.env };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'cca-api-'));
    process.env.CCA_DATA_DIR = join(root, 'data');
    process.env.CLAUDE_CONFIG_DIR = join(root, 'claude');
    await mkdir(join(root, 'claude', 'projects'), { recursive: true });
    // Endpoint off: these tests never touch the network or credentials.
    const store = new Store(process.env.CCA_DATA_DIR);
    await store.ensureDir();
    await store.saveSettings({ endpointEnabled: false, planHistory: [], throttleMinutes: 15 });

    const server = createServer(createApiMiddleware({ lockWaitMs: 200 }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });

  afterAll(async () => {
    close();
    process.env = env;
    await rm(root, { force: true, recursive: true });
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers }, method: 'POST' });

  it('serves the summary', async () => {
    const response = await fetch(`${base}/summary?tz=Europe/Paris`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ endpointEnabled: false, plan: 'pro', timeZone: 'Europe/Paris' });
  });

  it('saves settings and manual readings', async () => {
    const settings = await post('/settings', { planHistory: [{ from: '2026-01-01T00:00:00Z', plan: 'max5', source: 'manual' }] });
    expect(await settings.json()).toMatchObject({ plan: 'max5' });
    const resetsAt = new Date(Date.now() + 86_400_000).toISOString();
    const reading = await post('/readings', { weekly: 40, weeklyResetsAt: resetsAt });
    expect(await reading.json()).toMatchObject({ current: { source: 'manual', weekly: 40 } });
  });

  it('rejects writes that are not same-origin JSON', async () => {
    const form = await fetch(`${base}/settings`, { body: 'endpointEnabled=true', headers: { 'Content-Type': 'text/plain' }, method: 'POST' });
    expect(form.status).toBe(415);
    expect((await post('/settings', {}, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/settings', {}, { Origin: 'not a url' })).status).toBe(403);
  });

  it('rejects oversized bodies, invalid values and unknown routes', async () => {
    expect((await post('/settings', { padding: 'x'.repeat(70_000) })).status).toBe(413);
    expect((await post('/readings', { weekly: 300 })).status).toBe(400);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('answers 409 while the collector holds the lock', async () => {
    const release = await acquireLock(process.env.CCA_DATA_DIR!);
    try {
      expect((await post('/settings', { endpointEnabled: false })).status).toBe(409);
      expect((await post('/collect', {})).status).toBe(409);
    }
    finally {
      await release!();
    }
  });

  it('titles the conversations of the breakdown', async () => {
    const store = new Store(process.env.CCA_DATA_DIR!);
    const ts = new Date(Date.now() - 60_000).toISOString();
    const record = { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 0, key: 'm1|r1', model: 'claude-opus-5-5', output: 1000, project: 'p', sessionId: 's1', ts };
    await store.saveRecords(new Map([[record.key, record]]), [ts.slice(0, 7)]);
    await store.saveSessions({ s1: { title: 'Plan the Breakdown tab' } });
    const summary = await (await fetch(`${base}/summary`)).json() as { breakdown: { week: { conversations: { title?: string }[] } } };
    expect(summary.breakdown.week.conversations[0]?.title).toBe('Plan the Breakdown tab');
  });
});
