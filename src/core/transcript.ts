import type { UsageRecord } from './types.ts';

interface RawUsage {
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  speed?: string | null;
}

interface RawEntry {
  message?: { id?: string; model?: string; usage?: RawUsage };
  requestId?: string;
  timestamp?: string;
  type?: string;
}

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
  return record;
}

/**
 * Adds a record, deduplicating by key. Claude Code writes a message once per
 * content block while streaming; only `output` grows between copies, so the
 * highest one is final. Returns whether the map changed.
 */
export function mergeRecord(records: Map<string, UsageRecord>, record: UsageRecord): boolean {
  const existing = records.get(record.key);
  if (existing && record.output <= existing.output)
    return false;
  records.set(record.key, record);
  return true;
}
