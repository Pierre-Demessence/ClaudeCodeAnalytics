import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { mergeRecord, parseSkillSignal, parseTitleLine, parseTranscriptLine } from './transcript.ts';

function entry(overrides: { blocks?: unknown[]; model?: string; output?: number; requestId?: string; speed?: string; cacheCreation?: unknown } = {}) {
  return JSON.stringify({
    requestId: 'requestId' in overrides ? overrides.requestId : 'req_1',
    timestamp: '2026-10-02T08:45:17.630Z',
    type: 'assistant',
    message: {
      id: 'msg_1',
      content: overrides.blocks ?? [{ text: 'secret prompt text', type: 'text' }],
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
      tools: {},
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

  it('keeps the agent type on subagent lines only', () => {
    const subagent = entryWithMetadata({ extra: { isSidechain: true } });
    expect(parseTranscriptLine(subagent, 'proj', undefined, 'Explore')?.agentType).toBe('Explore');
    expect(parseTranscriptLine(subagent, 'proj')).not.toHaveProperty('agentType');
    expect(parseTranscriptLine(entryWithMetadata(), 'proj', undefined, 'Explore')).not.toHaveProperty('agentType');
  });

  it('marks subagent lines, which have no effort', () => {
    const record = parseTranscriptLine(entryWithMetadata({ extra: { effort: undefined, isSidechain: true } }), 'proj');
    expect(record?.sidechain).toBe(true);
    expect(record).not.toHaveProperty('effort');
  });

  it('counts the tool calls of a message by tool name, without their inputs', () => {
    const blocks = [
      { text: 'secret prompt text', type: 'text' },
      { id: 't1', name: 'Bash', input: { command: 'secret command' }, type: 'tool_use' },
      { id: 't2', name: 'Read', input: { file_path: 'secret.ts' }, type: 'tool_use' },
      { id: 't3', name: 'Read', input: { file_path: 'secret2.ts' }, type: 'tool_use' },
    ];
    const record = parseTranscriptLine(entry({ blocks }), 'proj');
    expect(record?.tools).toEqual({ Bash: 1, Read: 2 });
    expect(JSON.stringify(record)).not.toContain('secret');
  });

  it('records an empty tool count for a message without tool calls, unlike one imported before tools were kept', () => {
    expect(parseTranscriptLine(entry({ blocks: [] }), 'proj')?.tools).toEqual({});
    expect(parseTranscriptLine(entry(), 'proj')?.tools).toEqual({});
  });

  it('stamps the active skill on a main-conversation message only', () => {
    expect(parseTranscriptLine(entryWithMetadata(), 'proj', 'superpowers:brainstorming')?.skill).toBe('superpowers:brainstorming');
    expect(parseTranscriptLine(entryWithMetadata(), 'proj')).not.toHaveProperty('skill');
    expect(parseTranscriptLine(entryWithMetadata({ extra: { isSidechain: true } }), 'proj', '/commit')).not.toHaveProperty('skill');
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

describe('mergeRecord tools and skill', () => {
  const toolLine = (name: string, output = 500) => entry({ blocks: [{ id: `id_${name}`, name, type: 'tool_use' }], output });
  const toolsOf = (records: Map<string, UsageRecord>) => records.get('msg_1|req_1')?.tools;

  it('adds up the blocks of one message streamed as several lines, within one scan', () => {
    const records = new Map<string, UsageRecord>();
    const seen = new Set<string>();
    expect(mergeRecord(records, parseTranscriptLine(entry({ blocks: [{ type: 'thinking' }], output: 500 }), 'p')!, seen)).toBe(true);
    expect(mergeRecord(records, parseTranscriptLine(toolLine('Read'), 'p')!, seen)).toBe(true);
    expect(mergeRecord(records, parseTranscriptLine(toolLine('Read'), 'p')!, seen)).toBe(true);
    expect(mergeRecord(records, parseTranscriptLine(toolLine('Bash'), 'p')!, seen)).toBe(true);
    expect(toolsOf(records)).toEqual({ Bash: 1, Read: 2 });
  });

  it('keeps the tools whether the line holding them comes first or last', () => {
    const records = new Map<string, UsageRecord>();
    const seen = new Set<string>();
    mergeRecord(records, parseTranscriptLine(toolLine('Edit'), 'p')!, seen);
    mergeRecord(records, parseTranscriptLine(entry({ blocks: [{ type: 'text' }], output: 500 }), 'p')!, seen);
    expect(toolsOf(records)).toEqual({ Edit: 1 });
  });

  it('replaces the tools of a stored record on the first copy of a later scan, so a re-read does not double them', () => {
    const records = new Map<string, UsageRecord>();
    mergeRecord(records, parseTranscriptLine(toolLine('Read'), 'p')!, new Set());
    expect(mergeRecord(records, parseTranscriptLine(toolLine('Read'), 'p')!, new Set())).toBe(false);
    expect(toolsOf(records)).toEqual({ Read: 1 });
  });

  it('gives a record imported before tools were kept its tools', () => {
    const records = new Map<string, UsageRecord>();
    const old = parseTranscriptLine(toolLine('Read'), 'p')!;
    delete old.tools;
    records.set(old.key, old);
    expect(mergeRecord(records, parseTranscriptLine(toolLine('Read'), 'p')!, new Set())).toBe(true);
    expect(toolsOf(records)).toEqual({ Read: 1 });
  });

  it('keeps the skill a message was first stamped with', () => {
    const records = new Map<string, UsageRecord>();
    const seen = new Set<string>();
    mergeRecord(records, parseTranscriptLine(entryWithMetadata(), 'p', '/commit')!, seen);
    mergeRecord(records, parseTranscriptLine(entryWithMetadata(), 'p', 'other')!, seen);
    expect(records.get('msg_1|req_1')?.skill).toBe('/commit');
  });

  it('adds the agent type to a stored subagent record that has none', () => {
    const records = new Map<string, UsageRecord>();
    const subagent = entryWithMetadata({ extra: { isSidechain: true } });
    mergeRecord(records, parseTranscriptLine(subagent, 'p')!, new Set());
    expect(mergeRecord(records, parseTranscriptLine(subagent, 'p', undefined, 'Explore')!, new Set())).toBe(true);
    expect(records.get('msg_1|req_1')?.agentType).toBe('Explore');
    expect(mergeRecord(records, parseTranscriptLine(subagent, 'p', undefined, 'Explore')!, new Set())).toBe(false);
  });

  it('adds the skill to a stored record that has none', () => {
    const records = new Map<string, UsageRecord>();
    mergeRecord(records, parseTranscriptLine(entryWithMetadata(), 'p')!, new Set());
    expect(mergeRecord(records, parseTranscriptLine(entryWithMetadata(), 'p', '/commit')!, new Set())).toBe(true);
    expect(records.get('msg_1|req_1')?.skill).toBe('/commit');
  });
});

describe('parseSkillSignal', () => {
  const user = (content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ message: { content, role: 'user' }, type: 'user', ...extra });
  const assistant = (blocks: unknown[]) => JSON.stringify({ message: { id: 'm', content: blocks }, type: 'assistant' });

  it('starts a skill when the model calls the Skill tool', () => {
    expect(parseSkillSignal(assistant([{ name: 'Skill', input: { skill: 'superpowers:brainstorming' }, type: 'tool_use' }]))).toEqual({ name: 'superpowers:brainstorming', kind: 'start' });
  });

  it('starts a command when a prompt begins with a slash command', () => {
    const content = '<command-name>/commit</command-name>\n<command-message>commit</command-message>\n<command-args></command-args>';
    expect(parseSkillSignal(user(content))).toEqual({ name: '/commit', kind: 'start' });
  });

  it('ends the skill on a real prompt, as text or as content blocks', () => {
    expect(parseSkillSignal(user('Do item 2'))).toEqual({ kind: 'prompt' });
    expect(parseSkillSignal(user([{ text: 'Do item 2', type: 'text' }]))).toEqual({ kind: 'prompt' });
  });

  it('ignores tool results, meta messages, command output, subagent lines and other lines', () => {
    expect(parseSkillSignal(user([{ content: 'ok', tool_use_id: 't', type: 'tool_result' }]))).toBeNull();
    expect(parseSkillSignal(user('Base directory for this skill', { isMeta: true }))).toBeNull();
    expect(parseSkillSignal(user('<local-command-stdout>done</local-command-stdout>'))).toBeNull();
    expect(parseSkillSignal(user('This session is being continued…', { isCompactSummary: true }))).toBeNull();
    expect(parseSkillSignal(user('Explore the repo', { isSidechain: true }))).toBeNull();
    expect(parseSkillSignal(assistant([{ name: 'Bash', input: { command: 'ls' }, type: 'tool_use' }]))).toBeNull();
    expect(parseSkillSignal(assistant([{ name: 'Skill', input: { skill: '' }, type: 'tool_use' }]))).toBeNull();
    expect(parseSkillSignal('{not json "type":"user"')).toBeNull();
    expect(parseSkillSignal(JSON.stringify({ type: 'ai-title' }))).toBeNull();
  });
});
