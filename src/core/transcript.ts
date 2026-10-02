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

interface RawEntry {
  aiTitle?: string;
  cwd?: string;
  effort?: string;
  entrypoint?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  message?: { id?: string; model?: string; usage?: RawUsage };
  requestId?: string;
  sessionId?: string;
  timestamp?: string;
  type?: string;
  version?: string;
}

const METADATA_FIELDS = ['cwd', 'effort', 'entrypoint', 'gitBranch', 'sessionId', 'version'] as const;

/**
 * Turns one transcript line into a usage record, or null when the line is not
 * a real assistant response. Only token counts are kept, never content.
 */
export function parseTranscriptLine(line: string, project: string): UsageRecord | null {
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

/**
 * Adds a record, deduplicating by key. Claude Code writes a message once per
 * content block while streaming; only `output` grows between copies, so the
 * highest one is final. The final copy also replaces a stored record without
 * `sessionId` (imported before the metadata fields existed) to fill them in;
 * earlier copies are skipped, as their `thinking` may still be partial.
 * Returns whether the map changed.
 */
export function mergeRecord(records: Map<string, UsageRecord>, record: UsageRecord): boolean {
  const existing = records.get(record.key);
  const fills = existing && !existing.sessionId && record.sessionId && record.output === existing.output;
  if (existing && record.output <= existing.output && !fills)
    return false;
  records.set(record.key, record);
  return true;
}
