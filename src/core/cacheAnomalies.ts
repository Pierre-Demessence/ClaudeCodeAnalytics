import type { ApiEvent, UsageRecord } from './types.ts';

import { costParts } from './pricing.ts';
import { median } from './stats.ts';

/** How long each prompt cache lives without a hit. */
const CACHE_LIFETIME_MS = { fiveMinutes: 300_000, oneHour: 3_600_000 } as const;
/** Earlier turns of a session whose cache writes give the usual write. */
const MEDIAN_TURNS = 10;
/** A write is a flush only when over this many times the usual write… */
const FLUSH_FACTOR = 2;
/** …and over this many tokens, so a tiny usual write does not flag every turn. */
const MIN_FLUSH_TOKENS = 100;
/** A cache read under this share of the previous turn's, within the lifetime, is a flush. */
const READ_DROP_SHARE = 0.5;
/** …and only when at least this share of the lost read was written back; otherwise the context shrank (`/clear`, a compaction) and nothing was rebuilt. */
const REWRITTEN_SHARE = 0.5;
/** A read drop this close to a compaction is the compaction's doing. */
const COMPACTION_MARGIN_MS = 120_000;

/** A turn that rebuilt the prompt cache instead of reading it. */
export interface Flush {
  /** USD the rewrite cost beyond reading the same tokens from the cache. */
  extra: number;
  /** `idleGap`: after a pause longer than the cache lifetime; `noGap`: within it, yet the cache read collapsed. */
  kind: 'idleGap' | 'noGap';
  sessionId: string;
  /** Tokens written to the cache by the turn. */
  tokens: number;
  /** ISO. */
  ts: string;
}

const writtenBy = (record: UsageRecord) => record.cacheWrite5m + record.cacheWrite1h;

/** What the turn's cache writes cost beyond reading the same tokens; 0 for an unpriced model. */
function extraCost(record: UsageRecord): number {
  const written = costParts(record);
  const asRead = costParts({ ...record, cacheRead: writtenBy(record), cacheWrite1h: 0, cacheWrite5m: 0, input: 0, output: 0 });
  return written && asRead ? written.cacheWrite5m + written.cacheWrite1h - asRead.cacheRead : 0;
}

/**
 * Finds the turns that rebuilt the prompt cache, oldest first, in each
 * session's main conversation; a session's first turn has no cache to lose.
 * Subagent turns are left out: parallel subagents interleave in a session, and
 * records carry no agent id to tell their caches apart.
 */
export function detectFlushes(records: readonly UsageRecord[], events: readonly ApiEvent[]): Flush[] {
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    if (!record.sessionId || record.sidechain)
      continue;
    const group = groups.get(record.sessionId);
    if (group)
      group.push(record);
    else
      groups.set(record.sessionId, [record]);
  }

  const compactions = new Map<string, number[]>();
  for (const event of events) {
    if (event.kind !== 'compaction' || !event.sessionId)
      continue;
    compactions.set(event.sessionId, [...compactions.get(event.sessionId) ?? [], Date.parse(event.ts)]);
  }

  const flushes: Flush[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const sessionId = group[0]!.sessionId!;
    let writesOneHour = group[0]!.cacheWrite1h > 0;
    for (let i = 1; i < group.length; i++) {
      const record = group[i]!;
      const previous = group[i - 1]!;
      const ms = Date.parse(record.ts);
      const lifetime = writesOneHour ? CACHE_LIFETIME_MS.oneHour : CACHE_LIFETIME_MS.fiveMinutes;
      const tokens = writtenBy(record);
      let kind: Flush['kind'] | undefined;
      if (ms - Date.parse(previous.ts) > lifetime) {
        const usual = median(group.slice(Math.max(0, i - MEDIAN_TURNS), i).map(writtenBy)) ?? 0;
        if (tokens > Math.max(FLUSH_FACTOR * usual, MIN_FLUSH_TOKENS))
          kind = 'idleGap';
      }
      else if (record.cacheRead < READ_DROP_SHARE * previous.cacheRead && tokens >= REWRITTEN_SHARE * (previous.cacheRead - record.cacheRead) && !compactions.get(sessionId)?.some(c => Math.abs(ms - c) <= COMPACTION_MARGIN_MS)) {
        kind = 'noGap';
      }
      if (kind)
        flushes.push({ extra: extraCost(record), kind, sessionId, tokens, ts: record.ts });
      if (record.cacheWrite1h > 0)
        writesOneHour = true;
    }
  }
  return flushes.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}
