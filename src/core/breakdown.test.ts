import { describe, expect, it } from 'vitest';

import type { UsageRecord } from './types.ts';

import { buildBreakdown, projectOf } from './breakdown.ts';

/** $20 of Opus 5.5 output per record by default. */
function rec(ts: string, extra: Partial<UsageRecord> = {}): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\app', input: 0, key: ts + JSON.stringify(extra), model: 'claude-opus-5-5', output: 1_000_000, project: 'S--Dev-app', sessionId: 's1', ts, ...extra };
}

describe('projectOf', () => {
  it('names a directory by its last segment and lower-cases the drive letter', () => {
    expect(projectOf('S:\\Dev\\Web\\app\\', 'x')).toEqual({ name: 'app', path: 's:\\Dev\\Web\\app' });
    expect(projectOf('/home/me/app', 'x')).toEqual({ name: 'app', path: '/home/me/app' });
  });

  it('falls back to the transcript folder without a directory', () => {
    expect(projectOf(undefined, 'S--Dev-app')).toEqual({ name: 'S--Dev-app', path: 'S--Dev-app' });
  });
});

describe('buildBreakdown', () => {
  it('counts a conversation under the directory it started in', () => {
    const breakdown = buildBreakdown([
      rec('2026-10-01T10:00:00Z', { cwd: 's:\\Dev\\app' }),
      rec('2026-10-01T10:05:00Z', { cwd: 'S:\\Dev\\app\\node_modules\\x' }),
      rec('2026-10-01T10:10:00Z', { cwd: 'S:\\Dev\\app\\docs', sidechain: true }),
      rec('2026-10-01T11:00:00Z', { cwd: 'S:\\Dev\\other', sessionId: 's2' }),
      rec('2026-10-01T12:00:00Z', { cwd: undefined, project: 'old-folder', sessionId: undefined }),
    ], {});
    expect(breakdown.projects.map(p => [p.path, p.cost])).toEqual([
      ['s:\\Dev\\app', 60],
      ['old-folder', 20],
      ['s:\\Dev\\other', 20],
    ]);
  });

  it('keeps a conversation in its start directory when the period starts later', () => {
    const breakdown = buildBreakdown([
      rec('2026-09-20T10:00:00Z', { cwd: 'S:\\Dev\\app' }),
      rec('2026-10-01T10:00:00Z', { cwd: 'S:\\Dev\\app\\src' }),
    ], {}, Date.parse('2026-09-28T00:00:00Z'));
    expect(breakdown.projects.map(p => p.name)).toEqual(['app']);
    expect(breakdown.total).toEqual({ cost: 20, messages: 1 });
  });

  it('splits cost by model, share of input from cache, and totals', () => {
    const breakdown = buildBreakdown([
      rec('2026-10-01T10:00:00Z', { cacheRead: 300, input: 100 }),
      rec('2026-10-01T10:01:00Z', { cacheWrite1h: 50, cacheWrite5m: 50, model: 'claude-haiku-4-5' }),
    ], {});
    const [project] = breakdown.projects;
    expect(project!.byModel['claude-opus-5-5']).toBeCloseTo(20.00046);
    expect(project!.byModel['claude-haiku-4-5']).toBeCloseTo(5.0001625);
    expect(project!.cacheShare).toBeCloseTo(300 / 500);
    expect(breakdown.total.messages).toBe(2);
  });

  it('splits main agent and subagents, effort for the main agent only, and thinking', () => {
    const breakdown = buildBreakdown([
      rec('2026-10-01T10:00:00Z', { effort: 'max', thinking: 500_000 }),
      rec('2026-10-01T10:01:00Z', { effort: 'medium' }),
      rec('2026-10-01T10:02:00Z', { effort: 'xhigh' }),
      rec('2026-10-01T10:03:00Z', { effort: 'medium' }),
      rec('2026-10-01T10:04:00Z', { sidechain: true }),
    ], {});
    expect(breakdown.agents).toEqual({ main: 80, subagents: 20 });
    expect(breakdown.effort).toEqual([
      { cost: 40, level: 'medium' },
      { cost: 20, level: 'xhigh' },
      { cost: 20, level: 'max' },
    ]);
    expect(breakdown.thinkingShare).toBeCloseTo(0.1);
  });

  it('groups surfaces by cost, a missing one included', () => {
    const breakdown = buildBreakdown([
      rec('2026-10-01T10:00:00Z', { entrypoint: 'cli' }),
      rec('2026-10-01T10:01:00Z', { entrypoint: 'claude-vscode' }),
      rec('2026-10-01T10:02:00Z', { entrypoint: 'claude-vscode' }),
      rec('2026-10-01T10:03:00Z'),
    ], {});
    expect(breakdown.surfaces).toEqual([
      { cost: 40, entrypoint: 'claude-vscode' },
      { cost: 20, entrypoint: 'cli' },
      { cost: 20, entrypoint: undefined },
    ]);
  });

  it('ranks conversations by in-period cost, with title and majority branch', () => {
    const records = [
      rec('2026-09-27T10:00:00Z', { sessionId: 'a' }),
      rec('2026-10-01T10:00:00Z', { gitBranch: 'main', sessionId: 'a' }),
      rec('2026-10-01T11:00:00Z', { gitBranch: 'feat', sessionId: 'b' }),
      rec('2026-10-01T11:30:00Z', { gitBranch: 'feat', sessionId: 'b', sidechain: true }),
      rec('2026-10-01T12:00:00Z', { gitBranch: 'main', sessionId: 'b' }),
    ];
    const breakdown = buildBreakdown(records, { b: { title: 'Fix the parser' } }, Date.parse('2026-09-28T00:00:00Z'));
    expect(breakdown.conversations).toEqual([
      {
        name: 'app',
        branch: 'feat',
        byModel: { 'claude-opus-5-5': 60 },
        cost: 60,
        end: '2026-10-01T12:00:00Z',
        messages: 3,
        path: 's:\\Dev\\app',
        sessionId: 'b',
        start: '2026-10-01T11:00:00Z',
        subagentCost: 20,
        title: 'Fix the parser',
      },
      {
        name: 'app',
        branch: 'main',
        byModel: { 'claude-opus-5-5': 20 },
        cost: 20,
        end: '2026-10-01T10:00:00Z',
        messages: 1,
        path: 's:\\Dev\\app',
        sessionId: 'a',
        start: '2026-10-01T10:00:00Z',
        subagentCost: 0,
        title: undefined,
      },
    ]);
  });

  it('keeps the 10 most expensive conversations', () => {
    const records = Array.from({ length: 12 }, (_, i) => rec(`2026-10-01T${String(i + 10).padStart(2, '0')}:00:00Z`, { output: (i + 1) * 1_000_000, sessionId: `s${i}` }));
    const ids = buildBreakdown(records, {}).conversations.map(c => c.sessionId);
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe('s11');
    expect(ids.at(-1)).toBe('s2');
  });

  it('is empty without usage in the period', () => {
    const breakdown = buildBreakdown([rec('2026-09-01T10:00:00Z')], {}, Date.parse('2026-10-01T00:00:00Z'));
    expect(breakdown).toEqual({
      agents: { main: 0, subagents: 0 },
      conversations: [],
      effort: [],
      projects: [],
      surfaces: [],
      thinkingShare: 0,
      total: { cost: 0, messages: 0 },
    });
  });
});
