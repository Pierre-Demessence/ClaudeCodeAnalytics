// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collect } from './collect.ts';
import { acquireLock } from './lock.ts';
import { Store } from './store.ts';

const NOW = Date.parse('2026-10-02T09:00:00Z');

function assistantLine(id: string, output: number, version = '2.1.287') {
  return JSON.stringify({
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: output } },
    requestId: `req_${id}`,
    timestamp: '2026-10-02T08:00:00Z',
    type: 'assistant',
    version,
  });
}

const USAGE = {
  five_hour: { resets_at: '2026-10-02T12:50:00Z', utilization: 35 },
  seven_day: { resets_at: '2026-10-07T20:00:00Z', utilization: 44 },
};

describe('collect', () => {
  let root: string;
  let claudeDir: string;
  let dataDir: string;
  const fetchImpl = vi.fn(async () => Response.json(USAGE));

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cca-collect-'));
    claudeDir = join(root, 'claude');
    dataDir = join(root, 'data');
    await mkdir(join(claudeDir, 'projects', 'proj-a', 'session', 'subagents'), { recursive: true });
    await writeFile(join(claudeDir, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'secret-token', expiresAt: NOW + 3_600_000, rateLimitTier: 'tier', subscriptionType: 'pro' },
    }));
    await writeFile(join(claudeDir, 'projects', 'proj-a', 's1.jsonl'), [
      assistantLine('m1', 3),
      assistantLine('m1', 600),
      JSON.stringify({ type: 'user' }),
      '{broken',
    ].join('\n'));
    await writeFile(join(claudeDir, 'projects', 'proj-a', 'session', 'subagents', 'agent.jsonl'), assistantLine('m2', 10, '2.1.300'));
    fetchImpl.mockClear();
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('imports deduplicated messages, including subagents, and takes a snapshot', async () => {
    const result = await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
    expect(result.skipped).toBeUndefined();

    const store = new Store(dataDir);
    const records = await store.loadRecords();
    expect(records.size).toBe(2);
    expect(records.get('m1|req_m1')?.output).toBe(600);
    expect(records.get('m2|req_m2')?.project).toBe('proj-a');

    expect(await store.loadSnapshots()).toEqual([expect.objectContaining({ subscriptionType: 'pro', weekly: 44 })]);
    expect((await store.loadSettings()).planHistory).toEqual([{ from: '2026-10-02T09:00:00.000Z', plan: 'pro', source: 'detected' }]);
    const status = await store.loadStatus();
    expect(status).toMatchObject({ claudeCodeVersion: '2.1.300', endpointResult: 'ok', malformedLines: 1, messages: 2 });
  });

  it('never writes the token to the data dir', async () => {
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
    for (const name of ['messages-2026-10.jsonl', 'snapshots.jsonl', 'settings.json', 'status.json', 'scan-state.json'])
      expect(await readFile(join(dataDir, name), 'utf8')).not.toContain('secret-token');
  });

  it('respects the throttle unless forced', async () => {
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW + 5 * 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await collect({ claudeDir, dataDir, fetchImpl, force: true, now: NOW + 6 * 60_000 });
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW + 30 * 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('records endpoint failures without failing the run', async () => {
    const failing = vi.fn(async () => new Response('', { status: 429 }));
    const result = await collect({ claudeDir, dataDir, fetchImpl: failing, now: NOW });
    expect(result.skipped).toBeUndefined();
    expect((await new Store(dataDir).loadStatus()).endpointResult).toBe('http-429');
    expect((await new Store(dataDir).loadRecords()).size).toBe(2);
  });

  it('keeps imported messages after Claude Code deletes a transcript', async () => {
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
    await rm(join(claudeDir, 'projects', 'proj-a', 's1.jsonl'));
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW + 60_000 });
    expect((await new Store(dataDir).loadRecords()).size).toBe(2);
  });

  it('skips the endpoint when it is disabled', async () => {
    const store = new Store(dataDir);
    await store.ensureDir();
    await store.saveSettings({ endpointEnabled: false, planHistory: [], throttleMinutes: 15 });
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exits without writing while another run holds the lock', async () => {
    await mkdir(dataDir, { recursive: true });
    const release = await acquireLock(dataDir, NOW);
    expect(await collect({ claudeDir, dataDir, fetchImpl, now: NOW })).toEqual({ skipped: 'locked' });
    await release!();
    expect(await new Store(dataDir).loadRecords()).toHaveProperty('size', 0);
  });
});
