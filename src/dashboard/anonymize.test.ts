import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsageRecord } from '@/core/types';
import type { Summary } from '@/dashboard/api';

import { buildSummary } from '@/core/summary';
import { anonymizeSummary, useAnonymize } from '@/dashboard/anonymize';

function rec(ts: string, extra: Partial<UsageRecord> = {}): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\secret-app', gitBranch: 'feat/secret-branch', input: 0, key: ts + JSON.stringify(extra), model: 'claude-opus-5-5', output: 1_000_000, project: 'S--Dev-secret-app', sessionId: 's1', ts, ...extra };
}

function realSummary(): Summary {
  const now = Date.parse('2026-10-02T12:00:00Z');
  return {
    ...buildSummary({
      endpointEnabled: false,
      now,
      planHistory: [],
      snapshots: [],
      timeZone: 'UTC',
      titles: { s1: { title: 'Fix the secret parser' }, s2: { title: 'Rename the payroll module' } },
      records: [
        rec('2026-10-01T10:00:00Z'),
        rec('2026-10-01T11:00:00Z', { cwd: 'S:\\Dev\\other-repo', gitBranch: 'main', project: 'S--Dev-other-repo', sessionId: 's2' }),
      ],
    }),
    status: {},
  };
}

describe('anonymizeSummary', () => {
  it('leaves no project, path, branch or title in the summary', () => {
    const json = JSON.stringify(anonymizeSummary(realSummary()));
    for (const secret of ['secret-app', 'other-repo', 'secret-branch', 'secret parser', 'payroll', 'Dev'])
      expect(json).not.toContain(secret);
  });

  it('gives the same project the same label in every view', () => {
    const summary = realSummary();
    const masked = anonymizeSummary(summary);
    const labels = (names: { name: string }[]) => names.map(p => p.name);
    const fromBreakdown = masked.breakdown.week.projects;
    expect(labels(fromBreakdown)).toHaveLength(2);
    expect(new Set(labels(fromBreakdown)).size).toBe(2);
    for (const label of masked.weekHistory.weeks.flatMap(w => labels(w.projects)).concat(masked.sessions.windows.flatMap(w => labels(w.projects))))
      expect(labels(fromBreakdown)).toContain(label);
  });

  it('keeps the numbers and a missing title missing', () => {
    const summary = realSummary();
    summary.breakdown.week.conversations[0]!.title = undefined;
    const masked = anonymizeSummary(summary);
    expect(masked.breakdown.week.conversations[0]!.title).toBeUndefined();
    expect(masked.breakdown.week.total).toEqual(summary.breakdown.week.total);
    expect(masked.breakdown.week.projects.map(p => p.cost)).toEqual(summary.breakdown.week.projects.map(p => p.cost));
  });

  it('drops the last collector error, which can hold file paths', () => {
    const summary = realSummary();
    summary.status = { lastError: String.raw`ENOENT: no such file C:\Users\someone\.claude\projects\x` };
    const masked = anonymizeSummary(summary);
    expect(masked.status.lastError).toBeUndefined();
    expect(JSON.stringify(masked)).not.toContain('someone');
  });

  it('does not change the original', () => {
    const summary = realSummary();
    const before = JSON.stringify(summary);
    anonymizeSummary(summary);
    expect(JSON.stringify(summary)).toBe(before);
  });
});

describe('useAnonymize', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is off by default, toggles and remembers the choice', () => {
    const { result } = renderHook(() => useAnonymize());
    expect(result.current.anonymous).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.anonymous).toBe(true);
    expect(renderHook(() => useAnonymize()).result.current.anonymous).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.anonymous).toBe(false);
    expect(localStorage.getItem('cca-anonymize')).toBeNull();
  });

  it('still toggles for the page when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useAnonymize());
    act(() => result.current.toggle());
    expect(result.current.anonymous).toBe(true);
  });
});
