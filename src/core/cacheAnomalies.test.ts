import { describe, expect, it } from 'vitest';

import type { ApiEvent, UsageRecord } from './types.ts';

import { detectFlushes } from './cacheAnomalies.ts';

const START = Date.parse('2026-10-02T08:00:00Z');

/** A turn `seconds` after the start; cache numbers in tokens. */
function turn(seconds: number, { read = 20_000, sessionId = 's1', sidechain, write1h = 0, write5m = 200 }: { read?: number; sessionId?: string; sidechain?: true; write1h?: number; write5m?: number } = {}): UsageRecord {
  const record: UsageRecord = {
    cacheRead: read,
    cacheWrite1h: write1h,
    cacheWrite5m: write5m,
    input: 1,
    key: `k${seconds}-${sessionId}-${sidechain ? 'side' : 'main'}`,
    model: 'claude-opus-5-5',
    output: 100,
    project: 'proj',
    sessionId,
    ts: new Date(START + seconds * 1000).toISOString(),
  };
  if (sidechain)
    record.sidechain = true;
  return record;
}

/** Ten steady turns, 30 s apart, each writing a little. */
const steady = () => Array.from({ length: 10 }, (_, i) => turn(i * 30));

const compaction = (seconds: number): ApiEvent => ({ key: `c${seconds}`, kind: 'compaction', sessionId: 's1', ts: new Date(START + seconds * 1000).toISOString() });

describe('detectFlushes', () => {
  it('flags a big cache write after a gap longer than the 5-minute cache', () => {
    const flushes = detectFlushes([...steady(), turn(270 + 600, { write5m: 50_000 })], []);
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toMatchObject({ kind: 'idleGap', sessionId: 's1', tokens: 50_000, ts: new Date(START + 870_000).toISOString() });
    // 50k tokens written at 1.25 × $4/M instead of read at $0.2/M.
    expect(flushes[0]!.extra).toBeCloseTo(50_000 * (5 - 0.2) / 1_000_000, 6);
  });

  it('does not flag a write within the cache lifetime when the reads hold', () => {
    expect(detectFlushes([...steady(), turn(270 + 200, { write5m: 50_000 })], [])).toEqual([]);
  });

  it('flags a read that fell under half the previous turn within the lifetime', () => {
    const flushes = detectFlushes([...steady(), turn(300, { read: 4000, write5m: 18_000 })], []);
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toMatchObject({ kind: 'noGap', tokens: 18_000 });
  });

  it('ignores a read drop that was not written back: the context shrank, nothing was rebuilt', () => {
    expect(detectFlushes([...steady(), turn(300, { read: 4000, write5m: 800 })], [])).toEqual([]);
  });

  it('ignores a read drop within 120 seconds of a compaction of that session', () => {
    const drop = turn(300, { read: 4000, write5m: 18_000 });
    expect(detectFlushes([...steady(), drop], [compaction(250)])).toEqual([]);
    expect(detectFlushes([...steady(), drop], [compaction(100)])).toHaveLength(1);
    expect(detectFlushes([...steady(), drop], [{ ...compaction(250), sessionId: 'other' }])).toHaveLength(1);
  });

  it('keeps the cache alive for an hour once the session wrote the 1-hour cache', () => {
    const hourly = Array.from({ length: 10 }, (_, i) => turn(i * 30, { write1h: 200, write5m: 0 }));
    expect(detectFlushes([...hourly, turn(270 + 600, { write1h: 50_000, write5m: 0 })], [])).toEqual([]);
    expect(detectFlushes([...hourly, turn(270 + 4000, { write1h: 50_000, write5m: 0 })], [])).toHaveLength(1);
  });

  it('needs the write to be over twice the recent median and over 100 tokens', () => {
    expect(detectFlushes([...steady(), turn(270 + 600, { write5m: 350 })], [])).toEqual([]);
    expect(detectFlushes([...steady(), turn(270 + 600, { write5m: 450 })], [])).toHaveLength(1);
    const quiet = Array.from({ length: 10 }, (_, i) => turn(i * 30, { write5m: 0 }));
    expect(detectFlushes([...quiet, turn(270 + 600, { write5m: 80 })], [])).toEqual([]);
  });

  it('never flags the first turn of a session, and keeps sessions apart', () => {
    expect(detectFlushes([turn(0, { write5m: 90_000 })], [])).toEqual([]);
    const records = [...steady(), turn(270 + 600, { sessionId: 's2', write5m: 60_000 })];
    expect(detectFlushes(records, [])).toEqual([]);
  });

  it('leaves subagent turns out: parallel subagents interleave and their caches cannot be told apart', () => {
    const subagents = [...steady().map(r => ({ ...r, key: `${r.key}-sub`, sidechain: true as const })), { ...turn(270 + 600, { write5m: 50_000 }), key: 'sub-flush', sidechain: true as const }];
    expect(detectFlushes(subagents, [])).toEqual([]);
    // They do not disturb the main chain either.
    expect(detectFlushes([...steady(), ...subagents, turn(270 + 600, { write5m: 50_000 })], [])).toHaveLength(1);
  });

  it('skips records without a session id and counts an unpriced model as free', () => {
    const noSession = { ...turn(870, { write5m: 50_000 }), sessionId: undefined };
    expect(detectFlushes([...steady(), noSession], [])).toEqual([]);
    const unpriced = { ...turn(870, { write5m: 50_000 }), model: 'mystery-model' };
    expect(detectFlushes([...steady(), unpriced], [])).toEqual([expect.objectContaining({ extra: 0, kind: 'idleGap' })]);
  });

  it('returns flushes oldest first, whatever the order of the records', () => {
    const later = turn(270 + 600, { write5m: 50_000 });
    const flushes = detectFlushes([later, ...steady().reverse(), turn(5000, { write5m: 60_000 })], []);
    expect(flushes.map(f => f.tokens)).toEqual([50_000, 60_000]);
  });
});
