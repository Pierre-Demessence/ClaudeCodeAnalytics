import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { UsageRecord } from '@/core/types';
import type { Summary } from '@/dashboard/api';

import { DAY_MS, HOUR_MS } from '@/core/calibration';
import { buildSummary } from '@/core/summary';
import { Breakdown } from '@/dashboard/Breakdown';
import { TipProvider } from '@/dashboard/Tip';

const NOW = Date.now();

/** The tooltip text `el` shows when focused. */
function tipOf(el: Element): string {
  fireEvent.focus(el);
  const text = screen.getByRole('tooltip').textContent ?? '';
  fireEvent.blur(el);
  return text;
}

/** $20 of Opus 5.5 output by default. */
function rec(ago: number, extra: Partial<UsageRecord> = {}): UsageRecord {
  const ts = new Date(NOW - ago).toISOString();
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\app', input: 0, key: ts + JSON.stringify(extra), model: 'claude-opus-5-5', output: 1_000_000, project: 'p', sessionId: 's1', ts, ...extra };
}

function summary(records: UsageRecord[]): Summary {
  const resetsAt = new Date(NOW + 3 * DAY_MS).toISOString();
  return {
    ...buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [],
      records,
      snapshots: [{ source: 'endpoint', ts: new Date(NOW - 10 * 60_000).toISOString(), weekly: 42, weeklyResetsAt: resetsAt }],
      timeZone: 'UTC',
      titles: { s1: { title: 'Build the tab' } },
    }),
    status: {},
  };
}

const card = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

describe('breakdown', () => {
  afterEach(cleanup);

  const records = [
    rec(HOUR_MS, { effort: 'high', entrypoint: 'claude-vscode', gitBranch: 'main', thinking: 250_000 }),
    rec(2 * HOUR_MS, { agentType: 'Explore', entrypoint: 'claude-vscode', gitBranch: 'main', sidechain: true }),
    rec(3 * HOUR_MS, { cwd: 'S:\\Dev\\other', effort: 'xhigh', entrypoint: 'cli', model: 'claude-haiku-4-5', sessionId: 's2' }),
    rec(10 * DAY_MS, { cwd: 'S:\\Dev\\old', sessionId: 's3' }),
  ];

  it('shows this week by default, with its share of the weekly limit', () => {
    render(<Breakdown summary={summary(records)} />, { wrapper: TipProvider });
    expect(screen.getByRole('button', { name: 'This week' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/^Total/).textContent).toBe('Total $45 · 42% of the weekly limit');
    const projects = within(card('By project')).getAllByRole('row').slice(1);
    expect(projects.map(row => row.querySelector('th')!.textContent)).toEqual(['app', 'other']);
    expect(tipOf(projects[0]!.querySelector('th')!)).toBe('s:\\Dev\\app');
  });

  it('switches period without the weekly limit', () => {
    render(<Breakdown summary={summary(records)} />);
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(screen.getByText(/^Total/).textContent).toBe('Total $65');
    expect(within(card('By project')).getByText('old')).toBeTruthy();
  });

  it('splits agents, effort and surfaces with labels', () => {
    render(<Breakdown summary={summary(records)} />);
    expect(card('Main agent vs subagents').textContent).toContain('Subagents 44%');
    expect(within(card('Main agent vs subagents')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Explore100%']);
    const effort = card('By effort level');
    expect(effort.textContent).toContain('High');
    expect(effort.textContent).toContain('Extra high');
    expect(effort.textContent).toContain('8% of output tokens');
    const surface = card('By surface');
    expect(surface.textContent).toContain('VS Code');
    expect(surface.textContent).toContain('Terminal');
  });

  describe('output cards', () => {
    const outputRecords = [
      rec(HOUR_MS, { skill: '/commit', thinking: 400_000, tools: { Bash: 1, Read: 1 } }),
      rec(2 * HOUR_MS, { tools: {} }),
      rec(3 * HOUR_MS, { skill: 'superpowers:brainstorming', thinking: 100_000 }),
    ];
    const rowsOf = (name: string) => within(card(name)).getAllByRole('row').slice(1).map(row => row.textContent);

    it('splits the output by thinking, reply text and tool, whose rows sum to the total', () => {
      render(<Breakdown summary={summary(outputRecords)} />, { wrapper: TipProvider });
      const output = card('Where output goes');
      expect(output.textContent).toContain('3m output tokens');
      expect(output.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Thinking 17%, Reply text 33%, Untracked 30%, Tool calls 20%');
      expect(rowsOf('Where output goes')).toEqual([
        'Thinking500k17%',
        'Reply text1m33%',
        'Untracked900k30%',
        'Bash300k10%',
        'Read300k10%',
        'Output total3m100%',
      ]);
      expect(output.textContent).toContain('Untracked: messages recorded before tool calls were kept.');
    });

    it('splits cost and output tokens by skill, with the rest under No skill', () => {
      render(<Breakdown summary={summary(outputRecords)} />, { wrapper: TipProvider });
      expect(rowsOf('By skill or command')).toEqual([
        'No skill' + 'no skill active' + '1m$2033%',
        '/commit' + 'slash command' + '1m$2033%',
        'superpowers:brainstorming' + 'skill' + '1m$2033%',
        'All messages3m$60100%',
      ]);
      expect(tipOf(screen.getByRole('button', { name: 'About tokens and cost' }))).toBe('Cost includes input and cache; tokens are output only.');
    });

    it('says so when no skill or command ran in the period', () => {
      render(<Breakdown summary={summary([rec(HOUR_MS, { tools: {} })])} />, { wrapper: TipProvider });
      expect(card('By skill or command').textContent).toContain('No skill or slash command in this period.');
      expect(card('Where output goes').textContent).not.toContain('Untracked');
    });
  });

  it('lists conversations by title, falling back to project and branch', () => {
    render(<Breakdown summary={summary(records)} />);
    const rows = within(card('Most expensive conversations')).getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('Build the tab');
    expect(rows[0]!.textContent).toContain('app · main');
    expect(rows[1]!.querySelector('th')!.textContent).toBe('other');
  });

  it('shows an empty state for a period without usage', () => {
    render(<Breakdown summary={summary([rec(10 * DAY_MS)])} />);
    expect(screen.getByText('No usage in this period.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'By project' })).toBeNull();
  });
});
