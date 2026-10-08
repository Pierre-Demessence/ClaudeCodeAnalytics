import { describe, expect, it } from 'vitest';

import type { ApiEvent } from './types.ts';

import { dedupeHits, hitScope, parseEventLine } from './events.ts';

function errorEntry(extra: Record<string, unknown> = {}, text = 'You\'ve hit your session limit · resets 12:20am (Europe/Paris)') {
  return JSON.stringify({
    apiErrorStatus: 429,
    error: 'rate_limit',
    isApiErrorMessage: true,
    message: { content: [{ text, type: 'text' }], model: '<synthetic>', role: 'assistant' },
    quotaLimits: { rateLimitType: 'five_hour', resetsAt: 1790999400, status: 'rejected' },
    sessionId: 'session-1',
    timestamp: '2026-10-03T01:51:56.989Z',
    type: 'assistant',
    uuid: 'uuid-1',
    ...extra,
  });
}

describe('parseEventLine', () => {
  it('reads a rate-limit hit with its window end, never the message text', () => {
    const event = parseEventLine(errorEntry());
    expect(event).toEqual<ApiEvent>({
      key: 'uuid-1',
      kind: 'limit',
      limitType: 'five_hour',
      resetsAt: '2026-10-03T03:50:00.000Z',
      sessionId: 'session-1',
      ts: '2026-10-03T01:51:56.989Z',
    });
    expect(JSON.stringify(event)).not.toContain('hit your');
  });

  it('keeps a limit hit without quota details, from its text', () => {
    const line = errorEntry({ apiErrorStatus: undefined, error: undefined, quotaLimits: undefined }, 'Claude usage limit reached. Your limit will reset at 3pm');
    expect(parseEventLine(line)).toEqual<ApiEvent>({ key: 'uuid-1', kind: 'limit', sessionId: 'session-1', ts: '2026-10-03T01:51:56.989Z' });
  });

  it('reads a limit hit from its 429 status alone', () => {
    const line = errorEntry({ error: undefined, quotaLimits: undefined }, 'Something went wrong');
    expect(parseEventLine(line)).toMatchObject({ kind: 'limit' });
  });

  it('reads a server overload apart from a limit', () => {
    const overloaded = errorEntry({ apiErrorStatus: 529, error: 'server_error', quotaLimits: undefined }, 'API Error: Overloaded');
    expect(parseEventLine(overloaded)).toMatchObject({ kind: 'overload' });
  });

  it('ignores other API errors', () => {
    const lost = errorEntry({ apiErrorStatus: undefined, error: 'server_error', quotaLimits: undefined }, 'API Error: Connection lost mid-response.');
    expect(parseEventLine(lost)).toBeNull();
  });

  it('reads a compaction summary', () => {
    const line = JSON.stringify({ isCompactSummary: true, sessionId: 'session-1', timestamp: '2026-10-03T02:00:00.000Z', type: 'user', uuid: 'uuid-2' });
    expect(parseEventLine(line)).toEqual<ApiEvent>({ key: 'uuid-2', kind: 'compaction', sessionId: 'session-1', ts: '2026-10-03T02:00:00.000Z' });
  });

  it('reads a compact boundary system entry', () => {
    const line = JSON.stringify({ sessionId: 'session-1', subtype: 'compact_boundary', timestamp: '2026-10-03T02:00:00.000Z', type: 'system', uuid: 'uuid-3' });
    expect(parseEventLine(line)).toMatchObject({ key: 'uuid-3', kind: 'compaction' });
  });

  it('returns null for ordinary, malformed and uuid-less lines', () => {
    expect(parseEventLine('')).toBeNull();
    expect(parseEventLine('{"type":"user","uuid":"u"}')).toBeNull();
    expect(parseEventLine('{"isApiErrorMessage":true,')).toBeNull();
    expect(parseEventLine(errorEntry({ uuid: undefined }))).toBeNull();
    expect(parseEventLine(errorEntry({ timestamp: 'not a date' }))).toBeNull();
  });
});

describe('dedupeHits', () => {
  const hit = (key: string, ts: string, limitType = 'five_hour'): ApiEvent => ({ key, kind: 'limit', limitType, ts });

  it('counts hits within 15 minutes of each other once', () => {
    const events = [hit('a', '2026-10-03T01:00:00Z'), hit('b', '2026-10-03T01:10:00Z'), hit('c', '2026-10-03T01:40:00Z')];
    expect(dedupeHits(events).map(e => e.key)).toEqual(['a', 'c']);
  });

  it('keeps hits of different limit types apart', () => {
    const events = [hit('a', '2026-10-03T01:00:00Z'), hit('b', '2026-10-03T01:05:00Z', 'seven_day')];
    expect(dedupeHits(events)).toHaveLength(2);
  });

  it('keeps overloads and compactions untouched', () => {
    const events: ApiEvent[] = [
      { key: 'o1', kind: 'overload', ts: '2026-10-03T01:00:00Z' },
      { key: 'o2', kind: 'overload', ts: '2026-10-03T01:01:00Z' },
      { key: 'c1', kind: 'compaction', ts: '2026-10-03T01:02:00Z' },
    ];
    expect(dedupeHits(events)).toHaveLength(3);
  });
});

describe('hitScope', () => {
  const hit = (limitType?: string): ApiEvent => ({ key: 'a', kind: 'limit', ts: '2026-10-03T01:00:00Z', ...limitType && { limitType } });

  it('takes the weekly types for the week, anything else for the 5-hour session', () => {
    expect(hitScope(hit('five_hour'))).toBe('session');
    expect(hitScope(hit())).toBe('session');
    expect(hitScope(hit('seven_day'))).toBe('week');
    expect(hitScope(hit('seven_day_opus'))).toBe('week');
  });
});
