import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Snapshot, UsageRecord } from '@/core/types';
import type { Summary } from '@/dashboard/api';

import { buildSummary } from '@/core/summary';
import { TipProvider } from '@/dashboard/Tip';
import { Weeks } from '@/dashboard/Weeks';

const NOW = Date.parse('2026-10-03T12:00:00Z');

/** The tooltip text `el` shows when focused. */
function tipOf(el: Element): string {
  fireEvent.focus(el);
  const text = screen.getByRole('tooltip').textContent ?? '';
  fireEvent.blur(el);
  return text;
}

/** $20 of Opus 5.5 output. */
function rec(ts: string, extra: Partial<UsageRecord> = {}): UsageRecord {
  return { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, cwd: 'S:\\Dev\\app', input: 0, key: ts + JSON.stringify(extra), model: 'claude-opus-5-5', output: 1_000_000, project: 'p', sessionId: 's1', ts, ...extra };
}

function reading(ts: string, weekly: number, weeklyResetsAt: string): Snapshot {
  return { source: 'endpoint', ts, weekly, weeklyResetsAt };
}

function summary(records: UsageRecord[], snapshots: Snapshot[] = []): Summary {
  return { ...buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' }), status: {} };
}

/** Thu 1 Oct 07:00 starts the running window; the week before ended at a 100% reading; the one before has none. */
const records = [
  rec('2026-10-02T09:00:00Z'),
  rec('2026-10-03T08:00:00Z', { cwd: 'S:\\Dev\\tool', sessionId: 's2' }),
  rec('2026-09-26T10:00:00Z'),
  rec('2026-09-27T10:00:00Z'),
  rec('2026-09-20T10:00:00Z'),
];
const snapshots = [
  reading('2026-09-30T20:00:00Z', 100, '2026-10-01T07:00:00.000Z'),
  reading('2026-10-03T11:00:00Z', 40, '2026-10-08T07:00:00.000Z'),
];

const renderTab = (data: Summary) => render(<TipProvider><Weeks summary={data} /></TipProvider>);
const card = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

describe('weeks tab', () => {
  afterEach(cleanup);

  it('shows empty states without any window', () => {
    renderTab(summary([]));
    expect(within(card('Weekly usage, last 12 weeks')).getByText('No weekly window yet.')).toBeTruthy();
    expect(within(card('Week list')).getByText('No weekly window yet.')).toBeTruthy();
    expect(screen.getAllByText('–')).toHaveLength(2);
  });

  it('counts the weeks, the hits and the medians of the finished ones', () => {
    renderTab(summary(records, snapshots));
    const stats = screen.getByRole('region', { name: 'Weeks summary' });
    const value = (label: string) => within(stats).getByText(label).closest('.card')!.querySelector('strong')!.textContent;
    expect(value('weeks shown')).toBe('3');
    expect(value('hit the weekly limit (≥ 98%)')).toBe('1');
    // Finished weeks: 100% ($40) and one without a percent ($20).
    expect(value('median final %')).toBe('100%');
    expect(value('median week cost')).toBe('$30');
  });

  it('lists the weeks newest first, flagging the one in progress, the hit and the missing percent', () => {
    renderTab(summary(records, snapshots));
    const rows = within(card('Week list')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('Thu 1 Oct → Thu 8 Oct');
    expect(rows[0]!.textContent).toContain('in progress');
    expect(rows[0]!.textContent).toContain('app, tool');
    expect(rows[0]!.textContent).toContain('40%');
    expect(rows[0]!.textContent).toContain('reading');
    expect(rows[1]!.textContent).toContain('100%');
    expect(rows[2]!.textContent).toContain('–');
    expect(rows[2]!.textContent).toContain('$20.00');
  });

  it('puts a triangle beside a bar that hit the limit, and nowhere else', () => {
    renderTab(summary(records, snapshots));
    const lines = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
    expect(lines).toHaveLength(3);
    expect(lines[1]!.querySelector('.week-bar.hit')).toBeTruthy();
    expect(lines[1]!.querySelector('.wk-percent svg')).toBeTruthy();
    expect(lines[0]!.querySelector('.week-bar.hit')).toBeNull();
    expect(lines[0]!.querySelector('.wk-percent svg')).toBeNull();
  });

  it('marks a week ended by an early reading as estimated, without a hit', () => {
    // The last reading is 2 days before the reset, and reads 100%: extended, so only an estimate.
    renderTab(summary([rec('2026-09-10T09:00:00Z')], [reading('2026-09-15T07:00:00Z', 100, '2026-09-17T07:00:00.000Z')]));
    const [, line] = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
    expect(line!.querySelector('.week-bar.estimated')).toBeTruthy();
    expect(line!.querySelector('.week-bar.hit')).toBeNull();
    expect(line!.textContent).toContain('~100%');
    expect(screen.getByRole('region', { name: 'Weeks summary' }).textContent).toContain('0hit the weekly limit');
  });

  it('repeats cost, counts and projects under each week for the phone layout', () => {
    renderTab(summary(records, snapshots));
    const [row] = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
    expect(row!.querySelector('.wk-meta')!.textContent).toBe('$40.00 · 2 sessions · 2 messages · app, tool');
  });

  it('writes the cost of each day block, empty after now', () => {
    renderTab(summary(records, snapshots));
    const [row] = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
    const cells = [...row!.querySelectorAll('.wk-cell')].map(cell => cell.textContent);
    expect(cells).toEqual(['$0', '$20', '$20', '', '', '', '']);
    expect(row!.querySelectorAll('.wk-cell.later')).toHaveLength(4);
  });

  it('headlines the day columns with the weekday of the latest reset', () => {
    renderTab(summary(records, snapshots));
    expect(card('Weekly usage, last 12 weeks').querySelector('.wk-days')!.textContent).toBe('ThuFriSatSunMonTueWed');
  });

  it('gives each week label a tooltip with its range, cost and counts', () => {
    renderTab(summary(records, snapshots));
    const label = within(card('Weekly usage, last 12 weeks')).getAllByText(/^Thu 1 Oct/)[0]!;
    expect(tipOf(label)).toBe('Thu 1 Oct → Thu 8 Oct (in progress)\n$40.00 · 2 messages · 2 sessions');
  });

  it('explains the cells and the sessions column in tooltips', () => {
    renderTab(summary(records, snapshots));
    expect(tipOf(screen.getByRole('button', { name: 'About the weekly timeline' }))).toContain('Thu 07:00');
    expect(tipOf(screen.getByRole('button', { name: 'About sessions' }))).toContain('5-hour windows started in the week');
  });
});
