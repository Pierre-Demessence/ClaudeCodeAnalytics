import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Snapshot, UsageRecord } from '@/core/types';
import type { Summary } from '@/dashboard/api';

import { HOUR_MS } from '@/core/calibration';
import { buildSummary } from '@/core/summary';
import { Sessions } from '@/dashboard/Sessions';
import { TipProvider } from '@/dashboard/Tip';

const NOW = Date.parse('2026-10-03T12:00:00Z');

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

function reading(ago: number, fiveHour: number, resetsIn: number): Snapshot {
  return { fiveHour, fiveHourResetsAt: new Date(NOW + resetsIn).toISOString(), source: 'endpoint', ts: new Date(NOW - ago).toISOString(), weekly: 30, weeklyResetsAt: new Date(NOW + 3 * 86_400_000).toISOString() };
}

function summary(records: UsageRecord[], snapshots: Snapshot[] = [], limitThreshold?: number): Summary {
  return { ...buildSummary({ endpointEnabled: true, limitThreshold, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' }), status: {} };
}

const renderTab = (data: Summary) => render(<TipProvider><Sessions summary={data} /></TipProvider>);
const card = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

describe('sessions tab', () => {
  afterEach(cleanup);

  it('shows empty states without any window', () => {
    renderTab(summary([]));
    expect(within(card('5-hour sessions, last 7 days')).getByText('No 5-hour session in the last 7 days.')).toBeTruthy();
    expect(within(card('Session list')).getByText('No 5-hour session in the last 7 days.')).toBeTruthy();
    expect(screen.getAllByText('–')).toHaveLength(2);
  });

  it('names the threshold and flags the windows that hit it', () => {
    // A finished window 30 h ago read at 97%, and the one in progress (resets in 2 h) at 40%.
    renderTab(summary([rec(30 * HOUR_MS), rec(2 * HOUR_MS, { cwd: 'S:\\Dev\\tool', sessionId: 's2' })], [reading(28 * HOUR_MS, 97, -27 * HOUR_MS), reading(HOUR_MS, 40, 2 * HOUR_MS)]));
    expect(screen.getByText('hit the 5-hour limit (≥ 95%)')).toBeTruthy();
    const rows = within(card('Session list')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('in progress');
    expect(card('5-hour sessions, last 7 days').querySelectorAll('.session-label .wk-now')).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('tool');
    expect(rows[1]!.textContent).toContain('97%');
    expect(rows[1]!.querySelector('.session-peak-bar.capped')).toBeTruthy();
    expect(rows[1]!.querySelector('.session-peak-icon svg')).toBeTruthy();
    expect(rows[0]!.querySelector('.session-peak-icon svg')).toBeNull();
    expect(rows[0]!.querySelector('.session-peak-bar.capped')).toBeNull();
  });

  it('follows a custom threshold', () => {
    renderTab(summary([rec(HOUR_MS)], [reading(HOUR_MS, 40, 2 * HOUR_MS)], 50));
    expect(screen.getByText('hit the 5-hour limit (≥ 50%)')).toBeTruthy();
  });

  it('marks estimated windows and gives each block a tooltip', () => {
    renderTab(summary([rec(30 * HOUR_MS)]));
    const [row] = within(card('Session list')).getAllByRole('row').slice(1);
    expect(row!.textContent).toContain('estimated');
    expect(row!.textContent).toContain('–');
    const block = card('5-hour sessions, last 7 days').querySelector('.session-block.estimated')!;
    // The block shows the peak and the source: the tooltip leaves them out.
    expect(tipOf(block)).toBe('Fri 2 Oct · 06:00–11:00 · $20.00\n1 messages');
  });

  it('dims the other windows while one is focused', () => {
    renderTab(summary([rec(30 * HOUR_MS), rec(2 * HOUR_MS, { sessionId: 's2' })]));
    const blocks = [...card('5-hour sessions, last 7 days').querySelectorAll('.session-block')];
    expect(blocks).toHaveLength(2);
    fireEvent.focus(blocks[0]!);
    expect(blocks.map(block => block.classList.contains('dimmed'))).toEqual([false, true]);
    fireEvent.blur(blocks[0]!);
    expect(blocks.some(block => block.classList.contains('dimmed'))).toBe(false);
  });

  it('shows more than two projects as "+n", all in the tooltip', () => {
    renderTab(summary(['a', 'b', 'c'].map((name, i) => rec(30 * HOUR_MS - i * 60_000, { cwd: `S:\\Dev\\${name}`, sessionId: name }))));
    const cell = within(card('Session list')).getByText(/\+1$/);
    expect(tipOf(cell)).toContain('s:\\Dev\\c');
  });
});
