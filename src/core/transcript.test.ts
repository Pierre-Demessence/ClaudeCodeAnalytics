import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { mergeRecord, parseTitleLine, parseTranscriptLine } from './transcript.ts';

function entry(overrides: { model?: string; output?: number; requestId?: string; speed?: string; cacheCreation?: unknown } = {}) {
  return JSON.stringify({
    requestId: 'requestId' in overrides ? overrides.requestId : 'req_1',
    timestamp: '2026-10-02T08:45:17.630Z',
    type: 'assistant',
    message: {
      id: 'msg_1',
      content: [{ text: 'secret prompt text', type: 'text' }],
      model: overrides.model ?? 'claude-opus-5-5',
      usage: {
        cache_creation_input_tokens: 27003,
        cache_read_input_tokens: 26438,
        input_tokens: 2,
        output_tokens: overrides.output ?? 843,
        speed: overrides.speed ?? 'standard',
        cache_creation: 'cacheCreation' in overrides
          ? overrides.cacheCreation
          : { ephemeral_1h_input_tokens: 27003, ephemeral_5m_input_tokens: 0 },
      },
    },
  });
}

/** `entry()` with the metadata Claude Code writes on every line, plus `extra` on top. */
function entryWithMetadata({ extra = {}, output, thinking }: { extra?: Record<string, unknown>; output?: number; thinking?: number } = {}) {
  const parsed = JSON.parse(entry({ output })) as { message: { usage: Record<string, unknown> } };
  if (thinking !== undefined)
    parsed.message.usage.output_tokens_details = { thinking_tokens: thinking };
  return JSON.stringify({
    ...parsed,
    cwd: 'S:\\Dev\\proj',
    effort: 'high',
    entrypoint: 'claude-vscode',
    gitBranch: 'main',
    isSidechain: false,
    sessionId: 'session-1',
    version: '2.1.284',
    ...extra,
  });
}

describe('parseTranscriptLine', () => {
  it('extracts usage without any content', () => {
    expect(parseTranscriptLine(entry(), 'proj')).toEqual<UsageRecord>({
      cacheRead: 26438,
      cacheWrite1h: 27003,
      cacheWrite5m: 0,
      input: 2,
      key: 'msg_1|req_1',
      model: 'claude-opus-5-5',
      output: 843,
      project: 'proj',
      ts: '2026-10-02T08:45:17.630Z',
    });
  });

  it('keeps the session metadata of a main-conversation line', () => {
    expect(parseTranscriptLine(entryWithMetadata({ thinking: 200 }), 'proj')).toMatchObject({
      cwd: 'S:\\Dev\\proj',
      effort: 'high',
      entrypoint: 'claude-vscode',
      gitBranch: 'main',
      sessionId: 'session-1',
      thinking: 200,
      version: '2.1.284',
    });
    expect(parseTranscriptLine(entryWithMetadata(), 'proj')).not.toHaveProperty('sidechain');
  });

  it('marks subagent lines, which have no effort', () => {
    const record = parseTranscriptLine(entryWithMetadata({ extra: { effort: undefined, isSidechain: true } }), 'proj');
    expect(record?.sidechain).toBe(true);
    expect(record).not.toHaveProperty('effort');
  });

  it('never keeps message content', () => {
    const record = parseTranscriptLine(entryWithMetadata({ thinking: 200 }), 'proj');
    expect(JSON.stringify(record)).not.toContain('secret prompt text');
  });

  it('counts cache writes as 5-minute ones when the split is missing', () => {
    const record = parseTranscriptLine(entry({ cacheCreation: undefined }), 'proj');
    expect(record?.cacheWrite5m).toBe(27003);
    expect(record?.cacheWrite1h).toBe(0);
  });

  it('marks fast-mode requests', () => {
    expect(parseTranscriptLine(entry({ speed: 'fast' }), 'proj')?.speed).toBe('fast');
  });

  it('falls back to the message id when requestId is missing', () => {
    expect(parseTranscriptLine(entry({ requestId: undefined }), 'proj')?.key).toBe('msg_1');
  });

  it('skips synthetic entries, other entry types and malformed lines', () => {
    expect(parseTranscriptLine(entry({ model: '<synthetic>' }), 'proj')).toBeNull();
    expect(parseTranscriptLine(JSON.stringify({ message: {}, type: 'user' }), 'proj')).toBeNull();
    expect(parseTranscriptLine('{not json', 'proj')).toBeNull();
    expect(parseTranscriptLine('', 'proj')).toBeNull();
    expect(parseTranscriptLine(entry().replace('2026-10-02T08:45:17.630Z', 'not a date'), 'proj')).toBeNull();
  });
});

describe('parseTitleLine', () => {
  it('reads a conversation title', () => {
    expect(parseTitleLine(JSON.stringify({ aiTitle: 'Fix the parser', sessionId: 's1', type: 'ai-title' }))).toEqual({ sessionId: 's1', title: 'Fix the parser' });
  });

  it('ignores other lines and incomplete titles', () => {
    expect(parseTitleLine(entry())).toBeNull();
    expect(parseTitleLine(JSON.stringify({ aiTitle: '', sessionId: 's1', type: 'ai-title' }))).toBeNull();
    expect(parseTitleLine(JSON.stringify({ aiTitle: 'No session', type: 'ai-title' }))).toBeNull();
    expect(parseTitleLine('{"type":"ai-title"')).toBeNull();
  });
});

describe('mergeRecord', () => {
  it('keeps the copy with the highest output, since streamed copies grow', () => {
    const records = new Map<string, UsageRecord>();
    expect(mergeRecord(records, parseTranscriptLine(entry({ output: 3 }), 'p')!)).toBe(true);
    expect(mergeRecord(records, parseTranscriptLine(entry({ output: 607 }), 'p')!)).toBe(true);
    expect(mergeRecord(records, parseTranscriptLine(entry({ output: 3 }), 'p')!)).toBe(false);
    expect(records.size).toBe(1);
    expect(records.get('msg_1|req_1')?.output).toBe(607);
  });

  it('fills the metadata of a record imported before it existed, from the final copy only', () => {
    const records = new Map<string, UsageRecord>();
    mergeRecord(records, parseTranscriptLine(entry({ output: 607 }), 'p')!);

    const earlyCopy = parseTranscriptLine(entryWithMetadata({ output: 3, thinking: 0 }), 'p')!;
    expect(mergeRecord(records, earlyCopy)).toBe(false);

    const finalCopy = parseTranscriptLine(entryWithMetadata({ output: 607, thinking: 120 }), 'p')!;
    expect(mergeRecord(records, finalCopy)).toBe(true);
    expect(records.get('msg_1|req_1')).toMatchObject({ output: 607, sessionId: 'session-1', thinking: 120 });

    // Once filled, a re-read of the same copy changes nothing.
    expect(mergeRecord(records, finalCopy)).toBe(false);
  });

  it('never lowers the counts of a stored record', () => {
    const records = new Map<string, UsageRecord>();
    mergeRecord(records, parseTranscriptLine(entry({ output: 607 }), 'p')!);
    mergeRecord(records, parseTranscriptLine(entryWithMetadata({ output: 3 }), 'p')!);
    expect(records.get('msg_1|req_1')?.output).toBe(607);
  });
});
