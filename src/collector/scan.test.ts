// @vitest-environment node
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UsageRecord } from '../core/types.ts';
import type { ScanState } from './store.ts';

import { compareVersions, malformedLineCount, scanTranscripts } from './scan.ts';

function line(id: string, output = 10) {
  return `${JSON.stringify({
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: output } },
    requestId: `req_${id}`,
    timestamp: '2026-10-02T08:00:00Z',
    type: 'assistant',
  })}\n`;
}

describe('scanTranscripts', () => {
  let claudeDir: string;
  let file: string;
  let records: Map<string, UsageRecord>;
  let state: ScanState;

  beforeEach(async () => {
    claudeDir = await mkdtemp(join(tmpdir(), 'cca-scan-'));
    await mkdir(join(claudeDir, 'projects', 'proj'), { recursive: true });
    file = join(claudeDir, 'projects', 'proj', 'session.jsonl');
    records = new Map();
    state = {};
  });
  afterEach(async () => {
    await rm(claudeDir, { force: true, recursive: true });
  });

  it('reads only what was appended since the last scan', async () => {
    await writeFile(file, line('a'));
    await scanTranscripts(claudeDir, records, state);
    const firstOffset = Object.values(state)[0]!.offset;

    await appendFile(file, line('b'));
    // Drop the record from the map: a full re-read would bring it back.
    records.delete('a|req_a');
    const result = await scanTranscripts(claudeDir, records, state);
    expect(result.filesRead).toBe(1);
    expect([...records.keys()]).toEqual(['b|req_b']);
    expect(Object.values(state)[0]!.offset).toBeGreaterThan(firstOffset);
  });

  it('skips unchanged files', async () => {
    await writeFile(file, line('a'));
    await scanTranscripts(claudeDir, records, state);
    expect((await scanTranscripts(claudeDir, records, state)).filesRead).toBe(0);
  });

  it('leaves a line still being written for the next scan', async () => {
    const full = line('a');
    await writeFile(file, full.slice(0, 20));
    await scanTranscripts(claudeDir, records, state);
    expect(records.size).toBe(0);
    expect(malformedLineCount(state)).toBe(0);

    await appendFile(file, full.slice(20));
    await scanTranscripts(claudeDir, records, state);
    expect(records.size).toBe(1);
  });

  it('accepts a complete last line without a newline', async () => {
    await writeFile(file, line('a').trimEnd());
    await scanTranscripts(claudeDir, records, state);
    expect(records.size).toBe(1);
  });

  it('starts over when a file shrinks, and keeps a running malformed count', async () => {
    await writeFile(file, `${line('a')}{broken\n${line('b')}`);
    await scanTranscripts(claudeDir, records, state);
    expect(malformedLineCount(state)).toBe(1);

    await appendFile(file, line('c'));
    await scanTranscripts(claudeDir, records, state);
    expect(malformedLineCount(state)).toBe(1);

    await writeFile(file, line('d'));
    await scanTranscripts(claudeDir, records, state);
    expect(records.has('d|req_d')).toBe(true);
    expect(malformedLineCount(state)).toBe(0);
  });
});

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('2.1.300', '2.1.287')).toBeGreaterThan(0);
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
  });
});
