import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { mergeRecord, parseTranscriptLine } from './transcript.ts';

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

describe('mergeRecord', () => {
  it('keeps the copy with the highest output, since streamed copies grow', () => {
    const records = new Map<string, UsageRecord>();
    expect(mergeRecord(records, parseTranscriptLine(entry({ output: 3 }), 'p')!)).toBe(true);
    expect(mergeRecord(records, parseTranscriptLine(entry({ output: 607 }), 'p')!)).toBe(true);
    expect(mergeRecord(records, parseTranscriptLine(entry({ output: 3 }), 'p')!)).toBe(false);
    expect(records.size).toBe(1);
    expect(records.get('msg_1|req_1')?.output).toBe(607);
  });
});
