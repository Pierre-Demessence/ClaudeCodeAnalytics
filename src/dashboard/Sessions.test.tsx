import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEvent, Snapshot, UsageRecord } from '@/core/types';
import type { Summary } from '@/dashboard/api';

import { HOUR_MS } from '@/core/calibration';
import { buildSummary } from '@/core/summary';
import { viewOver } from '@/dashboard/rangeTesting';
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

function summary(records: UsageRecord[], snapshots: Snapshot[] = [], limitThreshold?: number, events: ApiEvent[] = []): Summary {
  return { ...buildSummary({ endpointEnabled: true, events, limitThreshold, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' }), status: {} };
}

const renderTab = (data: Summary) => render(<TipProvider><Sessions summary={data} /></TipProvider>);
/** A label of the summary cards, not the legend that repeats it. */
const stat = (label: string) => within(screen.getByRole('region', { name: 'Sessions summary' })).getByText(label);
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
    expect(stat('peak ≥ 95%')).toBeTruthy();
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

  describe('today and now', () => {
    afterEach(() => vi.useRealTimers());

    it('names today and marks the current time on its row', () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
      renderTab(summary([rec(30 * HOUR_MS)]));
      const timeline = card('5-hour sessions, last 7 days');
      const today = timeline.querySelector('.session-day.today')!;
      expect(today.textContent).toBe('Sat 3 Octtoday');
      expect(timeline.querySelectorAll('.session-day-relative')).toHaveLength(1);
      const marks = timeline.querySelectorAll<HTMLElement>('.session-now-mark');
      expect(marks).toHaveLength(1);
      expect(marks[0]!.style.left).toBe('50%');
      expect(marks[0]!.closest('.session-row')).toBe(today.closest('.session-row'));
      expect(tipOf(marks[0]!)).toBe('Now 12:00');
    });

    it('adds tomorrow above today while the window in progress runs past midnight', () => {
      // 22:00, in a window opened at 21:30 that ends at 02:30.
      const late = NOW + 10 * HOUR_MS;
      vi.useFakeTimers({ now: late, toFake: ['Date'] });
      const data = { ...buildSummary({ endpointEnabled: true, events: [], now: late, planHistory: [], records: [rec(-9.5 * HOUR_MS)], snapshots: [], timeZone: 'UTC' }), status: {} };
      renderTab(data);
      const days = [...card('5-hour sessions, last 7 days').querySelectorAll('.session-day')].map(day => day.textContent);
      expect(days.slice(0, 2)).toEqual(['Sun 4 Octtomorrow', 'Sat 3 Octtoday']);
      expect(days).toHaveLength(8);
    });
  });

  it('follows a custom threshold', () => {
    renderTab(summary([rec(HOUR_MS)], [reading(HOUR_MS, 40, 2 * HOUR_MS)], 50));
    expect(stat('peak ≥ 50%')).toBeTruthy();
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

  describe('rate-limit hits seen in the transcripts', () => {
    // The window in progress (resets in 2 h) was blocked 1 h ago, at 11:00.
    const hit: ApiEvent = { key: 'hit-1', kind: 'limit', limitType: 'five_hour', resetsAt: new Date(NOW + 2 * HOUR_MS).toISOString(), ts: new Date(NOW - HOUR_MS).toISOString() };
    const blockedTab = () => renderTab(summary([rec(2 * HOUR_MS)], [reading(HOUR_MS, 40, 2 * HOUR_MS)], undefined, [hit]));

    it('counts the blocked windows apart from the ones that reached the threshold', () => {
      blockedTab();
      expect(screen.getByText('1 blocked by a rate limit')).toBeTruthy();
      expect(stat('peak ≥ 95%').previousElementSibling!.textContent).toBe('0');
    });

    it('marks the block and the list row with an icon and the time, and names the hit in the tooltip', () => {
      blockedTab();
      const timeline = card('5-hour sessions, last 7 days');
      expect(timeline.querySelectorAll('.session-label .icon-blocked')).toHaveLength(1);
      expect(tipOf(timeline.querySelector('.session-block')!)).toContain('Rate limit hit at 11:00');
      const [row] = within(card('Session list')).getAllByRole('row').slice(1);
      const mark = row!.querySelector('.session-peak-cell .session-peak-blocked')!;
      expect(mark.querySelector('.icon-blocked')).toBeTruthy();
      expect(tipOf(mark)).toBe('Rate limit hit at 11:00');
      // The text of the row no longer carries the hit.
      expect(row!.querySelector('th')!.textContent).not.toContain('rate limit');
    });

    it('shows no mark without a hit', () => {
      renderTab(summary([rec(2 * HOUR_MS)], [reading(HOUR_MS, 40, 2 * HOUR_MS)]));
      expect(document.querySelectorAll('.session-block .icon-blocked, .session-peak-blocked')).toHaveLength(0);
    });
  });
});

describe('sessions tab over a range', () => {
  afterEach(cleanup);

  // One session a day at 10:00 from 1 Sep to 2 Oct, UTC.
  const days = Array.from({ length: 32 }, (_, i) => new Date(Date.parse('2026-09-01T10:00:00Z') + i * 86_400_000).toISOString());
  const input = { endpointEnabled: true, now: NOW, planHistory: [], records: days.map(ts => rec(NOW - Date.parse(ts), { sessionId: ts })), snapshots: [], timeZone: 'UTC' };
  const september = { from: '2026-09-01', kind: 'custom', to: '2026-09-30' } as const;
  const renderOver = () => {
    const { summary: data, view } = viewOver(input, september);
    return render(<TipProvider><Sessions summary={data} view={view} /></TipProvider>);
  };

  it('names the range and counts its sessions', () => {
    renderOver();
    expect(screen.getByRole('heading', { name: '5-hour sessions, 1 Sept – 30 Sept 2026' })).toBeTruthy();
    expect(stat('sessions, 1 Sept – 30 Sept 2026').previousElementSibling!.textContent).toBe('30');
  });

  it('pages the session list by 25, newest first', () => {
    renderOver();
    const list = card('Session list');
    expect(within(list).getAllByRole('row')).toHaveLength(26);
    expect(within(list).getAllByRole('row')[1]!.textContent).toContain('Wed 30 Sept');
    expect(within(list).getByRole('navigation', { name: 'Session list pages' }).textContent).toBe('Page 1 of 2');
    expect((within(list).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(list).getByRole('button', { name: 'Next page' }));
    expect(within(list).getAllByRole('row')).toHaveLength(6);
    expect(within(list).getByRole('navigation', { name: 'Session list pages' }).textContent).toBe('Page 2 of 2');
    expect((within(list).getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pages the block chart by 7 days, going back in time with the left button', () => {
    renderOver();
    const chart = card('5-hour sessions, 1 Sept – 30 Sept 2026');
    const rows = () => [...chart.querySelectorAll('.session-day')].map(day => day.textContent);
    expect(rows()).toHaveLength(7);
    expect(rows()[0]).toBe('Wed 30 Sept');
    const pager = within(chart).getByRole('navigation', { name: 'Chart days' });
    expect(pager.textContent).toBe('Thu 24 Sept – Wed 30 Sept');
    expect((within(pager).getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }));
    expect(rows()[0]).toBe('Wed 23 Sept');
    expect(within(chart).getByRole('navigation', { name: 'Chart days' }).textContent).toBe('Thu 17 Sept – Wed 23 Sept');
  });

  it('shows no pager for a range that fits in one page', () => {
    const { summary: data, view } = viewOver(input, { from: '2026-09-01', kind: 'custom', to: '2026-09-05' });
    render(<TipProvider><Sessions summary={data} view={view} /></TipProvider>);
    expect(screen.queryByRole('navigation', { name: 'Session list pages' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Chart days' })).toBeNull();
  });

  it('says so when the range holds no session', () => {
    const { summary: data, view } = viewOver(input, { from: '2025-01-01', kind: 'custom', to: '2025-01-31' });
    render(<TipProvider><Sessions summary={data} view={view} /></TipProvider>);
    expect(within(card('Session list')).getByText('No 5-hour session in this range.')).toBeTruthy();
  });
});
