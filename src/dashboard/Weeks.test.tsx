import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RangeChoice } from '@/core/range';
import type { ApiEvent, Snapshot, UsageRecord } from '@/core/types';
import type { Summary } from '@/dashboard/api';

import { buildSummary } from '@/core/summary';
import { viewOver } from '@/dashboard/rangeTesting';
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

function summary(records: UsageRecord[], snapshots: Snapshot[] = [], events: ApiEvent[] = []): Summary {
  return { ...buildSummary({ endpointEnabled: true, events, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' }), status: {} };
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

/** The week ended by the 100% reading, with an estimate of 212% without the limit; the week before has no percent. */
function withUncapped(data: Summary): Summary {
  const finished = data.weekHistory.weeks.find(w => w.percent === 100)!;
  const fit = { cost: 40, demand: 212, estimated: true, floor: 100, hiddenHours: 86.4, shift: 0, start: finished.start };
  return { ...data, planFit: { ...data.planFit, weeks: [fit] } };
}

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
    expect(value('peak ≥ 98%')).toBe('1');
    // Finished weeks: 100% ($40) and one without a percent ($20).
    expect(value('median peak')).toBe('100%');
    expect(value('median cost')).toBe('$30');
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

  it('flags the week a plan change started in, in the timeline and the list', () => {
    const planHistory = [
      { from: '2026-09-01T00:00:00Z', plan: 'pro', source: 'detected' },
      { from: '2026-10-02T00:00:00Z', plan: 'max5', source: 'manual' },
    ] as const;
    renderTab({ ...buildSummary({ endpointEnabled: true, events: [], now: NOW, planHistory, records, snapshots, timeZone: 'UTC' }), status: {} });
    const lines = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
    const mark = lines[0]!.querySelector('.wk-plan-change')!;
    const text = tipOf(mark);
    expect(text).toContain('Usage restarted with the change to Max 5× on Fri 2 Oct 00:00.');
    expect(text).toContain('Pro until Fri 2 Oct 00:00: ~0% of Pro');
    expect(text).toContain('Max 5× from Fri 2 Oct 00:00: 40% of Max 5×');
    expect(text).toContain('The peak adds the parts up, on Max 5×.');
    expect(lines[1]!.querySelector('.wk-plan-change')).toBeNull();
    const rows = within(card('Week list')).getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('plan change');
    expect(rows[1]!.textContent).not.toContain('plan change');
  });

  it('shows a week from an earlier plan on that plan: its bar, its peak, its estimate and the typical tick', () => {
    const planHistory = [
      { from: '2026-09-01T00:00:00Z', plan: 'pro', source: 'detected' },
      { from: '2026-10-02T00:00:00Z', plan: 'max5', source: 'manual' },
    ] as const;
    const data: Summary = { ...buildSummary({ endpointEnabled: true, events: [], now: NOW, planHistory, records, snapshots, timeZone: 'UTC' }), status: {} };
    // The week before the upgrade read 100% of Pro: 20% of Max 5×, and 42% of Max 5× without the limit.
    const pro = data.weekHistory.weeks[1]!;
    renderTab({ ...data, planFit: { ...data.planFit, weeks: [{ cost: 40, demand: 42, estimated: true, floor: 20, hiddenHours: 86.4, shift: 0, start: pro.start }] } });
    const lines = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
    expect(lines[1]!.querySelector<HTMLElement>('.week-bar.hit')!.style.width).toBe('100%');
    // Its plan is not named on the row, only in the tooltips.
    expect(lines[1]!.querySelector('.wk-peak')!.textContent).toBe('100%');
    expect(lines[1]!.querySelector('.wk-uncapped')!.textContent).toBe('≈ 210%');
    expect(tipOf(lines[1]!.querySelector('.wk-uncapped')!)).toContain('At least 100% of Pro: 3.6 days were hidden');
    // The median peak, 20% of Max 5×, is the Pro limit.
    expect(lines[1]!.querySelector<HTMLElement>('.week-typical')!.style.left).toBe('100%');
    // The legend leaves the median to the median peak card.
    const legend = card('Weekly usage, last 12 weeks').querySelector('.session-legend')!.textContent;
    expect(legend).toContain('typical week');
    expect(legend).not.toContain('median');
    // The week in progress restarted with the upgrade: its parts add up on Max 5×.
    expect(lines[0]!.querySelector('.wk-peak')!.textContent).not.toContain('Pro');
    expect(lines[0]!.querySelector<HTMLElement>('.week-typical')!.style.left).toBe('20%');
    const rows = within(card('Week list')).getAllByRole('row').slice(1);
    expect(rows[1]!.querySelectorAll('td')[4]!.textContent).toBe('100%');
    expect(rows[1]!.querySelectorAll('td')[5]!.textContent).toBe('≈ 210%');
  });

  it('flags a week whose usage reset without a plan change, with its own icon and badge', () => {
    const data = summary(records, [
      reading('2026-10-02T10:00:00Z', 60, '2026-10-08T07:00:00.000Z'),
      reading('2026-10-03T11:00:00Z', 20, '2026-10-08T07:00:00.000Z'),
    ]);
    renderTab(data);
    const lines = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
    const mark = lines[0]!.querySelector('.wk-plan-change')!;
    expect(mark.getAttribute('aria-label')).toBe('Usage reset in this week');
    const text = tipOf(mark);
    expect(text).toContain('Usage reset on Sat 3 Oct 11:00, without a plan change.');
    expect(text).toContain('Pro until Sat 3 Oct 11:00: 60% of Pro');
    expect(text).toContain('The peak adds the parts up, on Pro.');
    expect(within(card('Week list')).getAllByRole('row')[1]!.textContent).toContain('usage reset');
    expect(card('Weekly usage, last 12 weeks').textContent).toContain('usage reset in the week');
  });

  it('marks a week ended by an early reading as estimated, without a hit', () => {
    // The last reading is 2 days before the reset, and reads 100%: extended, so only an estimate.
    renderTab(summary([rec('2026-09-10T09:00:00Z')], [reading('2026-09-15T07:00:00Z', 100, '2026-09-17T07:00:00.000Z')]));
    const [, line] = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
    expect(line!.querySelector('.week-bar.estimated')).toBeTruthy();
    expect(line!.querySelector('.week-bar.hit')).toBeNull();
    expect(line!.textContent).toContain('~100%');
    expect(screen.getByRole('region', { name: 'Weeks summary' }).textContent).toContain('0peak ≥ 98%');
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

  describe('estimate without the limit', () => {
    it('shows no second figure when the estimate equals the readings', () => {
      const data = summary(records, snapshots);
      renderTab({ ...data, planFit: { ...data.planFit, weeks: data.planFit.weeks.map(w => ({ ...w, demand: w.floor })) } });
      expect(document.querySelector('.wk-uncapped')).toBeNull();
      const cells = within(card('Week list')).getAllByRole('row').slice(1).map(row => row.querySelectorAll('td')[5]!.textContent);
      expect(cells).toEqual(['', '', '']);
    });

    it('writes the estimate under the peak, in the list and under the median peak', () => {
      renderTab(withUncapped(summary(records, snapshots)));
      const lines = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
      expect(lines[1]!.querySelector('.wk-uncapped')!.textContent).toBe('≈ 212%');
      expect(lines[0]!.querySelector('.wk-uncapped')).toBeNull();
      const rows = within(card('Week list')).getAllByRole('row').slice(1);
      expect(rows[1]!.querySelectorAll('td')[5]!.textContent).toBe('≈ 212%');
      expect(rows[0]!.querySelectorAll('td')[5]!.textContent).toBe('');
      const stats = screen.getByRole('region', { name: 'Weeks summary' });
      expect(within(stats).getByText('median peak').closest('.card')!.textContent).toContain('≈ 212% without the limit');
    });

    it('keeps the reading as the bar and the hit icon, and explains the estimate in a tooltip', () => {
      renderTab(withUncapped(summary(records, snapshots)));
      const line = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)')[1]!;
      expect(line.querySelector<HTMLElement>('.week-bar.hit')!.style.width).toBe('100%');
      expect(line.querySelector('.wk-percent svg')).toBeTruthy();
      expect(line.querySelector('.wk-percent strong')!.textContent).toBe('100%');
      expect(tipOf(line.querySelector('.wk-uncapped')!)).toContain('At least 100%: 3.6 days were hidden');
    });
  });

  describe('rate-limit hits seen in the transcripts', () => {
    const events: ApiEvent[] = [
      // Inside the 5-hour window opened by the 09:00 message of the running week.
      { key: 'session-hit', kind: 'limit', limitType: 'five_hour', ts: '2026-10-02T09:30:00.000Z' },
      // The weekly limit, in the week before.
      { key: 'week-hit', kind: 'limit', limitType: 'seven_day', ts: '2026-09-27T12:00:00.000Z' },
    ];

    it('counts the weeks apart from the ones that reached the threshold', () => {
      renderTab(summary(records, snapshots, events));
      expect(screen.getByText('2 blocked by a rate limit')).toBeTruthy();
      expect(within(screen.getByRole('region', { name: 'Weeks summary' })).getByText('peak ≥ 98%').previousElementSibling!.textContent).toBe('1');
    });

    it('marks each week row with an icon and a count, and says what blocked it in the tooltip', () => {
      renderTab(summary(records, snapshots, events));
      const lines = card('Weekly usage, last 12 weeks').querySelectorAll('.wk-row:not(.wk-head)');
      const mark = (i: number) => lines[i]!.querySelector('.wk-percent .wk-blocked-mark');
      expect(mark(0)!.textContent).toBe('1');
      expect(mark(0)!.querySelector('.icon-blocked')).toBeTruthy();
      expect(tipOf(mark(0)!)).toBe('1 session blocked by a rate limit');
      expect(mark(1)!.textContent).toBe('1');
      expect(tipOf(mark(1)!)).toBe('Weekly limit hit: Sun 27 Sept 12:00');
      expect(mark(2)).toBeNull();
    });

    it('counts the blocked sessions beside the sessions in the list', () => {
      renderTab(summary(records, snapshots, events));
      const rows = within(card('Week list')).getAllByRole('row').slice(1);
      expect(rows[0]!.querySelector('.wk-blocked-sessions')!.textContent).toBe('1');
      expect(rows[0]!.querySelector('.wk-blocked-sessions .icon-blocked')).toBeTruthy();
      expect(rows[2]!.querySelector('.wk-blocked-sessions')).toBeNull();
    });
  });
});

describe('weeks tab over a range', () => {
  afterEach(cleanup);

  // One message a week, Thursdays 10:00 from 4 Jun to 1 Oct, UTC: 18 weekly windows.
  const thursdays = Array.from({ length: 18 }, (_, i) => new Date(Date.parse('2026-06-04T10:00:00Z') + i * 7 * 86_400_000).toISOString());
  const input = { endpointEnabled: true, now: NOW, planHistory: [], records: thursdays.map(ts => rec(ts)), snapshots: [], timeZone: 'UTC' };
  const renderOver = (choice: RangeChoice = { from: '2026-06-01', kind: 'custom', to: '2026-10-02' }) => {
    const { summary: data, view } = viewOver(input, choice);
    return render(<TipProvider><Weeks summary={data} view={view} /></TipProvider>);
  };

  it('names the range and shows every window that starts in it', () => {
    renderOver();
    const chart = card('Weekly usage, 1 Jun – 2 Oct 2026');
    expect(chart.querySelectorAll('.wk-row:not(.wk-head)')).toHaveLength(18);
    const stats = screen.getByRole('region', { name: 'Weeks summary' });
    expect(within(stats).getByText('weeks shown').closest('.card')!.querySelector('strong')!.textContent).toBe('18');
  });

  it('pages the week list by 12', () => {
    renderOver();
    const list = card('Week list');
    expect(within(list).getAllByRole('row')).toHaveLength(13);
    expect(within(list).getByRole('navigation', { name: 'Week list pages' }).textContent).toBe('Page 1 of 2');
    fireEvent.click(within(list).getByRole('button', { name: 'Next page' }));
    expect(within(list).getAllByRole('row')).toHaveLength(7);
    expect(within(list).getByRole('navigation', { name: 'Week list pages' }).textContent).toBe('Page 2 of 2');
  });

  it('shows no pager and no estimate without the limit for a short range', () => {
    renderOver({ from: '2026-09-01', kind: 'custom', to: '2026-10-02' });
    expect(screen.queryByRole('navigation', { name: 'Week list pages' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Weeks summary' }).querySelector('.wk-uncapped')).toBeNull();
  });

  it('says so when the range holds no window', () => {
    renderOver({ from: '2025-01-01', kind: 'custom', to: '2025-01-31' });
    expect(within(card('Week list')).getByText('No weekly window in this range.')).toBeTruthy();
  });
});
