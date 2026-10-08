import type { UsageRecord } from './types.ts';

interface RawUsage {
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number } | null;
  speed?: string | null;
}

interface RawBlock {
  name?: string;
  input?: { skill?: unknown };
  text?: string;
  type?: string;
}

interface RawEntry {
  aiTitle?: string;
  cwd?: string;
  effort?: string;
  entrypoint?: string;
  gitBranch?: string;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: { content?: string | RawBlock[]; id?: string; model?: string; usage?: RawUsage };
  requestId?: string;
  sessionId?: string;
  timestamp?: string;
  type?: string;
  version?: string;
}

const METADATA_FIELDS = ['cwd', 'effort', 'entrypoint', 'gitBranch', 'sessionId', 'version'] as const;

/** The content blocks of a message, none when it is plain text. */
function blocksOf(entry: RawEntry): RawBlock[] {
  const content = entry.message?.content;
  return Array.isArray(content) ? content : [];
}

function countTools(entry: RawEntry): Record<string, number> {
  const tools: Record<string, number> = {};
  for (const block of blocksOf(entry)) {
    if (block.type === 'tool_use' && typeof block.name === 'string' && block.name)
      tools[block.name] = (tools[block.name] ?? 0) + 1;
  }
  return tools;
}

/**
 * Turns one transcript line into a usage record, or null when the line is not
 * a real assistant response. Only token counts, tool names and the given
 * `skill` are kept, never content.
 */
export function parseTranscriptLine(line: string, project: string, skill?: string): UsageRecord | null {
  if (!line)
    return null;
  let entry: RawEntry;
  try {
    entry = JSON.parse(line) as RawEntry;
  }
  catch {
    return null;
  }
  const message = entry.message;
  const usage = message?.usage;
  // `<synthetic>` entries are local placeholders Claude Code writes without calling the API.
  if (entry.type !== 'assistant' || !usage || !message?.id || !message.model || message.model === '<synthetic>' || !entry.timestamp || Number.isNaN(Date.parse(entry.timestamp)))
    return null;

  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const split = usage.cache_creation;
  const record: UsageRecord = {
    input: usage.input_tokens ?? 0,
    key: entry.requestId ? `${message.id}|${entry.requestId}` : message.id,
    model: message.model,
    output: usage.output_tokens ?? 0,
    project,
    tools: countTools(entry),
    ts: entry.timestamp,
    // Without the split, the API default (5-minute TTL) applies.
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite1h: split ? (split.ephemeral_1h_input_tokens ?? 0) : 0,
    cacheWrite5m: split ? (split.ephemeral_5m_input_tokens ?? 0) : cacheWrite,
  };
  if (usage.speed === 'fast')
    record.speed = 'fast';
  for (const field of METADATA_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string' && value)
      record[field] = value;
  }
  if (entry.isSidechain === true)
    record.sidechain = true;
  else if (skill)
    record.skill = skill;
  const thinking = usage.output_tokens_details?.thinking_tokens;
  if (typeof thinking === 'number')
    record.thinking = thinking;
  return record;
}

/** Reads an `ai-title` line: Claude Code's title for a conversation. Null for any other line. */
export function parseTitleLine(line: string): { sessionId: string; title: string } | null {
  // Most lines are not titles: skip parsing them a second time.
  if (!line.includes('"ai-title"'))
    return null;
  let entry: RawEntry;
  try {
    entry = JSON.parse(line) as RawEntry;
  }
  catch {
    return null;
  }
  if (entry.type !== 'ai-title' || typeof entry.aiTitle !== 'string' || !entry.aiTitle || typeof entry.sessionId !== 'string' || !entry.sessionId)
    return null;
  return { sessionId: entry.sessionId, title: entry.aiTitle };
}

export type SkillSignal = { kind: 'prompt' } | { kind: 'start'; name: string };

const COMMAND_PATTERN = /<command-name>([^<]+)<\/command-name>/;

/**
 * Reads what a line says about the skill a conversation is running: the model
 * calling the `Skill` tool, or the user starting a slash command, begins one;
 * the user's next real prompt ends it. Null for any other line, including
 * tool results, meta messages, command output and subagent lines.
 */
export function parseSkillSignal(line: string): SkillSignal | null {
  // Most lines are neither: skip parsing them a second time.
  if (!line.includes('"name":"Skill"') && !line.includes('"type":"user"'))
    return null;
  let entry: RawEntry;
  try {
    entry = JSON.parse(line) as RawEntry;
  }
  catch {
    return null;
  }
  if (entry.isSidechain === true)
    return null;
  if (entry.type === 'assistant') {
    for (const block of blocksOf(entry)) {
      const skill = block.input?.skill;
      if (block.type === 'tool_use' && block.name === 'Skill' && typeof skill === 'string' && skill)
        return { name: skill, kind: 'start' };
    }
    return null;
  }
  if (entry.type !== 'user' || entry.isMeta === true || entry.isCompactSummary === true)
    return null;
  const content = entry.message?.content;
  const blocks = blocksOf(entry);
  if (blocks.some(block => block.type === 'tool_result'))
    return null;
  const text = typeof content === 'string' ? content : blocks.map(block => block.text ?? '').join('\n');
  if (text.startsWith('<local-command'))
    return null;
  const command = COMMAND_PATTERN.exec(text)?.[1]?.trim();
  return command ? { name: command, kind: 'start' } : { kind: 'prompt' };
}

function sameTools(a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean {
  if (!a || !b)
    return a === b;
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every(name => a[name] === b[name]);
}

function addTools(a: Record<string, number> | undefined, b: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!a || !b)
    return a ?? b;
  const sum = { ...a };
  for (const [name, count] of Object.entries(b))
    sum[name] = (sum[name] ?? 0) + count;
  return sum;
}

/**
 * Adds a record, deduplicating by key. Claude Code writes a message once per
 * content block while streaming; only `output` grows between copies, so the
 * highest one is final. The final copy also replaces a stored record without
 * `sessionId` (imported before the metadata fields existed) to fill them in;
 * earlier copies are skipped, as their `thinking` may still be partial.
 *
 * Each copy holds one block, so its tool calls are added up, but only among
 * the copies already met (`seen` holds their keys): the first copy of a
 * message not met yet replaces the stored tools instead, so re-reading a
 * transcript does not count them twice. A skill, once set, is kept.
 * Returns whether the map changed.
 */
export function mergeRecord(records: Map<string, UsageRecord>, record: UsageRecord, seen = new Set<string>()): boolean {
  const existing = records.get(record.key);
  const again = seen.has(record.key);
  seen.add(record.key);
  if (!existing) {
    records.set(record.key, record);
    return true;
  }
  const tools = again ? addTools(existing.tools, record.tools) : record.tools;
  const skill = existing.skill ?? record.skill;
  const fills = !existing.sessionId && record.sessionId && record.output === existing.output;
  const base = record.output > existing.output || fills ? record : existing;
  if (base === existing && sameTools(tools, existing.tools) && skill === existing.skill)
    return false;
  const merged = { ...base };
  if (tools)
    merged.tools = tools;
  else
    delete merged.tools;
  if (skill)
    merged.skill = skill;
  else
    delete merged.skill;
  records.set(record.key, merged);
  return true;
}
