import type { ApiEvent } from './types.ts';

/** Hits closer than this count once: parallel sessions show the same banner. */
const HIT_MERGE_MS = 15 * 60_000;

interface RawEvent {
  apiErrorStatus?: number;
  error?: string;
  isApiErrorMessage?: boolean;
  isCompactSummary?: boolean;
  message?: { content?: unknown };
  quotaLimits?: { rateLimitType?: string; resetsAt?: number };
  sessionId?: string;
  subtype?: string;
  timestamp?: string;
  uuid?: string;
}

/** Text of an error entry, used only to classify it, never stored. */
function textOf(entry: RawEvent): string {
  const content = entry.message?.content;
  if (!Array.isArray(content))
    return '';
  return content.map(block => (block as { text?: unknown })?.text).filter((text): text is string => typeof text === 'string').join(' ');
}

function kindOfError(entry: RawEvent): ApiEvent['kind'] | undefined {
  const text = textOf(entry);
  if (entry.error === 'rate_limit' || entry.apiErrorStatus === 429 || /hit your [\w ]*limit|usage limit reached/i.test(text))
    return 'limit';
  if (entry.apiErrorStatus === 529 || /overloaded/i.test(text))
    return 'overload';
  return undefined;
}

/**
 * Reads a rate-limit hit, a server overload or a compaction from one
 * transcript line; null for any other line. Only metadata is kept.
 */
export function parseEventLine(line: string): ApiEvent | null {
  // Most lines are none of these: skip parsing them a second time.
  if (!line.includes('isApiErrorMessage') && !line.includes('isCompactSummary') && !line.includes('compact_boundary'))
    return null;
  let entry: RawEvent;
  try {
    entry = JSON.parse(line) as RawEvent;
  }
  catch {
    return null;
  }
  if (typeof entry.uuid !== 'string' || !entry.uuid || !entry.timestamp || Number.isNaN(Date.parse(entry.timestamp)))
    return null;

  let kind: ApiEvent['kind'] | undefined;
  if (entry.isCompactSummary === true || entry.subtype === 'compact_boundary')
    kind = 'compaction';
  else if (entry.isApiErrorMessage === true)
    kind = kindOfError(entry);
  if (!kind)
    return null;

  const event: ApiEvent = { key: entry.uuid, kind, ts: entry.timestamp };
  if (typeof entry.sessionId === 'string' && entry.sessionId)
    event.sessionId = entry.sessionId;
  if (kind === 'limit') {
    const { rateLimitType, resetsAt } = entry.quotaLimits ?? {};
    if (typeof rateLimitType === 'string' && rateLimitType)
      event.limitType = rateLimitType;
    if (typeof resetsAt === 'number' && Number.isFinite(resetsAt))
      event.resetsAt = new Date(resetsAt * 1000).toISOString();
  }
  return event;
}

/** Rate-limit hits of one limit type within 15 minutes of the last kept one are dropped; other events pass. */
export function dedupeHits(events: readonly ApiEvent[]): ApiEvent[] {
  const lastKept = new Map<string, number>();
  return [...events]
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .filter((event) => {
      if (event.kind !== 'limit')
        return true;
      const type = event.limitType ?? '';
      const ms = Date.parse(event.ts);
      const previous = lastKept.get(type);
      if (previous !== undefined && ms - previous < HIT_MERGE_MS)
        return false;
      lastKept.set(type, ms);
      return true;
    });
}

/**
 * The limit a hit ran into. Anything that is not a weekly type counts as the
 * 5-hour session limit, the common one; the weekly type's name is not seen in
 * the local transcripts yet, so any name with `seven_day` or `week` is taken.
 */
export function hitScope(event: ApiEvent): 'session' | 'week' {
  return /seven_day|week/i.test(event.limitType ?? '') ? 'week' : 'session';
}
