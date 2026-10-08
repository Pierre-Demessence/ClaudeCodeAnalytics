// @vitest-environment node
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApiEvent, SessionInfo, UsageRecord } from '../core/types.ts';
import type { ScanState } from './store.ts';

import { malformedLineCount, scanTranscripts } from './scan.ts';

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

  it('re-reads a file whose state entry predates offsets', async () => {
    await writeFile(file, line('a'));
    await scanTranscripts(claudeDir, records, state);
    const [id, entry] = Object.entries(state)[0]!;
    state[id] = { malformed: entry.malformed, mtimeMs: entry.mtimeMs } as ScanState[string];
    records.clear();

    const result = await scanTranscripts(claudeDir, records, state);
    expect(result.filesRead).toBe(1);
    expect([...records.keys()]).toEqual(['a|req_a']);
    expect(state[id]!.offset).toBe(entry.offset);
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

describe('scanTranscripts tools and skills', () => {
  let claudeDir: string;
  let file: string;

  const assistant = (id: string, blocks: unknown[]) => `${JSON.stringify({
    message: { id, content: blocks, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 10 } },
    requestId: `req_${id}`,
    timestamp: '2026-10-02T08:00:00Z',
    type: 'assistant',
  })}\n`;
  const tool = (name: string, input: unknown = {}) => ({ id: `tool_${name}`, name, input, type: 'tool_use' });
  const user = (content: unknown) => `${JSON.stringify({ message: { content, role: 'user' }, type: 'user' })}\n`;
  const command = (name: string) => user(`<command-name>${name}</command-name>\n<command-args></command-args>`);
  const result = user([{ content: 'ok', tool_use_id: 'tool_Skill', type: 'tool_result' }]);

  beforeEach(async () => {
    claudeDir = await mkdtemp(join(tmpdir(), 'cca-skills-'));
    await mkdir(join(claudeDir, 'projects', 'proj'), { recursive: true });
    file = join(claudeDir, 'projects', 'proj', 'session.jsonl');
  });
  afterEach(async () => {
    await rm(claudeDir, { force: true, recursive: true });
  });

  it('adds up the tool calls of a message streamed as one line per block', async () => {
    await writeFile(file, assistant('a', [{ type: 'thinking' }]) + assistant('a', [tool('Read')]) + assistant('a', [tool('Read')]) + assistant('b', [{ text: 'hi', type: 'text' }]));
    const records = new Map<string, UsageRecord>();
    await scanTranscripts(claudeDir, records, {});
    expect(records.get('a|req_a')?.tools).toEqual({ Read: 2 });
    expect(records.get('b|req_b')?.tools).toEqual({});
  });

  it('does not count tools twice when a transcript is read again', async () => {
    await writeFile(file, assistant('a', [tool('Read')]) + assistant('a', [tool('Bash')]));
    const records = new Map<string, UsageRecord>();
    // An empty scan state makes each scan read the file from the start, as a format bump does.
    await scanTranscripts(claudeDir, records, {});
    await scanTranscripts(claudeDir, records, {});
    await scanTranscripts(claudeDir, records, {});
    expect(records.get('a|req_a')?.tools).toEqual({ Bash: 1, Read: 1 });
  });

  it('keeps the tools of a message whose lines fall in two scans', async () => {
    await writeFile(file, assistant('a', [{ type: 'thinking' }]) + assistant('a', [tool('Read')]));
    const records = new Map<string, UsageRecord>();
    const state: ScanState = {};
    await scanTranscripts(claudeDir, records, state);

    await appendFile(file, assistant('a', [tool('Bash')]));
    await scanTranscripts(claudeDir, records, state);
    expect(records.get('a|req_a')?.tools).toEqual({ Bash: 1, Read: 1 });
  });

  it('attributes the messages after a slash command or a Skill call to it, until the next prompt', async () => {
    await writeFile(file, [
      assistant('before', []),
      command('/commit'),
      assistant('commit1', [tool('Bash')]),
      result,
      assistant('commit2', []),
      user('Now something else'),
      assistant('plain', [tool('Skill', { skill: 'superpowers:brainstorming' })]),
      result,
      assistant('brain', []),
    ].join(''));
    const records = new Map<string, UsageRecord>();
    await scanTranscripts(claudeDir, records, {});
    const skillOf = (id: string) => records.get(`${id}|req_${id}`)?.skill;
    expect(skillOf('before')).toBeUndefined();
    expect(skillOf('commit1')).toBe('/commit');
    expect(skillOf('commit2')).toBe('/commit');
    expect(skillOf('plain')).toBeUndefined();
    expect(skillOf('brain')).toBe('superpowers:brainstorming');
  });

  it('carries the active skill over to the next scan of the same transcript', async () => {
    await writeFile(file, command('/commit') + assistant('a', []));
    const records = new Map<string, UsageRecord>();
    const state: ScanState = {};
    await scanTranscripts(claudeDir, records, state);

    await appendFile(file, assistant('b', []));
    await scanTranscripts(claudeDir, records, state);
    expect(records.get('b|req_b')?.skill).toBe('/commit');

    await appendFile(file, user('A new prompt') + assistant('c', []));
    await scanTranscripts(claudeDir, records, state);
    expect(records.get('c|req_c')?.skill).toBeUndefined();
    expect(Object.values(state)[0]!.skill).toBeUndefined();
  });
});

describe('scanTranscripts session titles', () => {
  let claudeDir: string;
  let file: string;

  const title = (aiTitle: string) => `${JSON.stringify({ aiTitle, sessionId: 's1', type: 'ai-title' })}\n`;

  beforeEach(async () => {
    claudeDir = await mkdtemp(join(tmpdir(), 'cca-titles-'));
    await mkdir(join(claudeDir, 'projects', 'proj'), { recursive: true });
    file = join(claudeDir, 'projects', 'proj', 'session.jsonl');
  });
  afterEach(async () => {
    await rm(claudeDir, { force: true, recursive: true });
  });

  it('keeps the latest title, written before or after the messages', async () => {
    const sessions: Record<string, SessionInfo> = {};
    const state: ScanState = {};
    await writeFile(file, title('First') + line('a') + title('Second'));
    expect((await scanTranscripts(claudeDir, new Map(), state, sessions)).sessionsChanged).toBe(true);
    expect(sessions).toEqual({ s1: { title: 'Second' } });
    expect(malformedLineCount(state)).toBe(0);

    await appendFile(file, line('b') + title('Third'));
    await scanTranscripts(claudeDir, new Map(), state, sessions);
    expect(sessions).toEqual({ s1: { title: 'Third' } });
  });

  it('reports no change without a new title', async () => {
    await writeFile(file, title('Same') + line('a'));
    expect((await scanTranscripts(claudeDir, new Map(), {}, { s1: { title: 'Same' } })).sessionsChanged).toBe(false);
    await writeFile(file, line('a'));
    expect((await scanTranscripts(claudeDir, new Map(), {}, {})).sessionsChanged).toBe(false);
  });

  it('collects rate-limit hits without counting them as malformed lines', async () => {
    const hit = `${JSON.stringify({
      error: 'rate_limit',
      isApiErrorMessage: true,
      message: { content: [{ text: 'You have hit your session limit', type: 'text' }], model: '<synthetic>' },
      quotaLimits: { rateLimitType: 'five_hour', resetsAt: 1790999400 },
      sessionId: 's1',
      timestamp: '2026-10-03T01:51:56.989Z',
      type: 'assistant',
      uuid: 'hit-1',
    })}
`;
    const events = new Map<string, ApiEvent>();
    const state: ScanState = {};
    await writeFile(file, line('a') + hit);
    const result = await scanTranscripts(claudeDir, new Map(), state, {}, events);
    expect(result.eventsChanged).toBe(true);
    expect([...events.values()]).toEqual([expect.objectContaining({ key: 'hit-1', kind: 'limit', limitType: 'five_hour' })]);
    expect(malformedLineCount(state)).toBe(0);

    // The same entry read again changes nothing.
    expect((await scanTranscripts(claudeDir, new Map(), {}, {}, events)).eventsChanged).toBe(false);
  });
});
