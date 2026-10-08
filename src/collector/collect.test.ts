// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collect } from './collect.ts';
import { acquireLock } from './lock.ts';
import { SCAN_FORMAT, Store } from './store.ts';

const NOW = Date.parse('2026-10-02T09:00:00Z');

function assistantLine(id: string, output: number, version = '2.1.287') {
  return JSON.stringify({
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: output } },
    requestId: `req_${id}`,
    sessionId: 's1',
    timestamp: '2026-10-02T08:00:00Z',
    type: 'assistant',
    version,
  });
}

const HIT_LINE = JSON.stringify({
  error: 'rate_limit',
  isApiErrorMessage: true,
  message: { content: [{ text: 'You have hit your session limit', type: 'text' }], model: '<synthetic>' },
  quotaLimits: { rateLimitType: 'five_hour', resetsAt: 1790999400 },
  sessionId: 's2',
  timestamp: '2026-10-02T08:30:00Z',
  type: 'assistant',
  uuid: 'hit-1',
});

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
      '',
    ].join('\n'));
    await writeFile(join(claudeDir, 'projects', 'proj-a', 'session', 'subagents', 'agent.jsonl'), assistantLine('m2', 10, '2.1.300'));
    fetchImpl.mockClear();
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('records when the subscription started, and keeps it when the file is out of sight', async () => {
    await writeFile(join(root, '.claude.json'), JSON.stringify({ oauthAccount: { billingType: 'stripe_subscription', emailAddress: 'someone@example.com', subscriptionCreatedAt: '2026-09-28T19:26:39Z' } }));
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
    expect((await new Store(dataDir).loadStatus()).subscriptionStartedAt).toBe('2026-09-28T19:26:39.000Z');
    await rm(join(root, '.claude.json'));
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW + 1000 });
    expect((await new Store(dataDir).loadStatus()).subscriptionStartedAt).toBe('2026-09-28T19:26:39.000Z');
    expect(JSON.stringify(await new Store(dataDir).loadStatus())).not.toContain('someone@example.com');
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

  it('stores rate-limit hits as events, once, without their text', async () => {
    await writeFile(join(claudeDir, 'projects', 'proj-a', 's2.jsonl'), `${HIT_LINE}\n`);
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW + 60_000 });

    const store = new Store(dataDir);
    expect([...(await store.loadEvents()).values()]).toEqual([
      { key: 'hit-1', kind: 'limit', limitType: 'five_hour', resetsAt: '2026-10-03T03:50:00.000Z', sessionId: 's2', ts: '2026-10-02T08:30:00Z' },
    ]);
    expect(await readFile(join(dataDir, 'events.jsonl'), 'utf8')).not.toContain('hit your');
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

  it('records an unexpected failure in the status and rethrows', async () => {
    // A directory where a month file should be makes loading fail.
    await mkdir(join(dataDir, 'messages-2026-10.jsonl'), { recursive: true });
    await expect(collect({ claudeDir, dataDir, fetchImpl, now: NOW })).rejects.toThrow();
    const status = await new Store(dataDir).loadStatus();
    expect(status.lastError).toBeTruthy();
    expect(status.lastRunAt).toBe(new Date(NOW).toISOString());
  });

  it('releases the lock and resets the status when status.json is corrupt', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'status.json'), '{corrupt');
    await expect(collect({ claudeDir, dataDir, fetchImpl, now: NOW })).rejects.toThrow();
    expect((await new Store(dataDir).loadStatus()).lastError).toBeTruthy();
    expect(await collect({ claudeDir, dataDir, fetchImpl, now: NOW })).not.toEqual({ skipped: 'locked' });
  });

  it('skips the endpoint when it is disabled', async () => {
    const store = new Store(dataDir);
    await store.ensureDir();
    await store.saveSettings({ endpointEnabled: false, limitThreshold: 95, planHistory: [], throttleMinutes: 15, weekLimitThreshold: 98 });
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

  it('keeps the conversation titles in sessions.json', async () => {
    await writeFile(join(claudeDir, 'projects', 'proj-a', 's2.jsonl'), `${JSON.stringify({ aiTitle: 'Plan the parser', sessionId: 's2', type: 'ai-title' })}\n`);
    await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
    expect(await new Store(dataDir).loadSessions()).toEqual({ s2: { title: 'Plan the parser' } });
  });

  it('reads a scan state from before formats existed', async () => {
    const files = { [join('proj-a', 's1.jsonl')]: { malformed: 2, mtimeMs: 0, offset: 5 } };
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'scan-state.json'), JSON.stringify(files));
    expect(await new Store(dataDir).loadScanState()).toEqual({ files, format: 1 });
  });

  it('drops the per-file keys a format-1 collector adds to a newer scan state', async () => {
    const files = { [join('proj-a', 's1.jsonl')]: { mtimeMs: 0, offset: 5 } };
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'scan-state.json'), JSON.stringify({ files, format: 2, [join('proj-a', 's2.jsonl')]: { mtimeMs: 0, offset: 9 } }));
    expect(await new Store(dataDir).loadScanState()).toEqual({ files, format: 2 });
  });

  describe('after a scan format bump', () => {
    const OLD_FORMAT = SCAN_FORMAT - 1;
    /** A record imported before the bump: token counts only. */
    const oldRecord = (key: string, output: number) => ({ cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 1, key, model: 'claude-opus-5-5', output, project: 'proj-a', ts: '2026-10-02T08:00:00Z' });

    /** `m1` is still on disk; `gone`'s transcript was deleted. Every file is marked fully imported. */
    async function seedOldDataDir() {
      const store = new Store(dataDir);
      await store.ensureDir();
      await store.saveRecords(new Map([['m1|req_m1', oldRecord('m1|req_m1', 600)], ['gone|req_gone', oldRecord('gone|req_gone', 50)]]), ['2026-10']);
      const files: Record<string, { mtimeMs: number; offset: number }> = {};
      for (const id of [join('proj-a', 's1.jsonl'), join('proj-a', 'session', 'subagents', 'agent.jsonl')]) {
        const info = await stat(join(claudeDir, 'projects', id));
        files[id] = { mtimeMs: info.mtimeMs, offset: info.size };
      }
      await store.saveScanState({ files, format: OLD_FORMAT });
      return store;
    }

    it('re-reads every transcript once, filling old records and keeping the rest', async () => {
      const store = await seedOldDataDir();
      await collect({ claudeDir, dataDir, fetchImpl, now: NOW });

      const records = await store.loadRecords();
      expect(records.get('m1|req_m1')).toMatchObject({ output: 600, sessionId: 's1' });
      expect(records.get('gone|req_gone')).toEqual(oldRecord('gone|req_gone', 50));
      expect(records.has('m2|req_m2')).toBe(true);
      expect((await store.loadScanState()).format).toBe(SCAN_FORMAT);
    });

    it('finds the events of transcripts imported before the bump', async () => {
      const hitFile = join(claudeDir, 'projects', 'proj-a', 's2.jsonl');
      await writeFile(hitFile, `${HIT_LINE}\n`);
      const store = await seedOldDataDir();
      // Marked fully imported, as before the bump: only the re-read can find the hit.
      const { files } = await store.loadScanState();
      const info = await stat(hitFile);
      files[join('proj-a', 's2.jsonl')] = { mtimeMs: info.mtimeMs, offset: info.size };
      await store.saveScanState({ files, format: OLD_FORMAT });
      await collect({ claudeDir, dataDir, fetchImpl, now: NOW });
      expect([...(await store.loadEvents()).keys()]).toEqual(['hit-1']);
    });

    it('backs up the message files once, before changing them', async () => {
      const store = await seedOldDataDir();
      const before = await readFile(join(dataDir, 'messages-2026-10.jsonl'), 'utf8');
      await collect({ claudeDir, dataDir, fetchImpl, now: NOW });

      const backup = join(dataDir, `backup-format-${OLD_FORMAT}`);
      expect(await readdir(backup)).toEqual(['messages-2026-10.jsonl']);
      expect(await readFile(join(backup, 'messages-2026-10.jsonl'), 'utf8')).toBe(before);

      // A run that repeats the re-read keeps the first backup as it is.
      await store.saveScanState({ files: {}, format: OLD_FORMAT });
      await collect({ claudeDir, dataDir, fetchImpl, now: NOW + 60_000 });
      expect(await readFile(join(backup, 'messages-2026-10.jsonl'), 'utf8')).toBe(before);
      expect((await readdir(dataDir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    });

    it('repeats the re-read when a run fails before writing the new format', async () => {
      const store = await seedOldDataDir();
      const crash = vi.spyOn(Store.prototype, 'saveScanState').mockRejectedValueOnce(new Error('crash'));
      try {
        await expect(collect({ claudeDir, dataDir, fetchImpl, now: NOW })).rejects.toThrow('crash');
      }
      finally {
        crash.mockRestore();
      }
      expect((await store.loadScanState()).format).toBe(OLD_FORMAT);
      const records = await store.loadRecords();
      expect(records.get('m1|req_m1')?.sessionId).toBe('s1');
      expect(records.get('gone|req_gone')).toEqual(oldRecord('gone|req_gone', 50));

      await collect({ claudeDir, dataDir, fetchImpl, now: NOW + 60_000 });
      expect((await store.loadScanState()).format).toBe(SCAN_FORMAT);
      expect(await store.loadRecords()).toEqual(records);
    });
  });
});
