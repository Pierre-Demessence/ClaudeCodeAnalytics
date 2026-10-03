import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CurrentWeek, FiveHourSession } from '@/core/summary';
import type { Summary } from '@/dashboard/api';

import { DAY_MS, HOUR_MS } from '@/core/calibration';
import { buildSummary } from '@/core/summary';
import { Overview } from '@/dashboard/Overview';
import { TipProvider } from '@/dashboard/Tip';

const NOW = Date.now();
const RESETS = new Date(NOW + 3 * DAY_MS).toISOString();

/** The tooltip text `el` shows when focused. */
function tipOf(el: Element): string {
  fireEvent.focus(el);
  const text = screen.getByRole('tooltip').textContent ?? '';
  fireEvent.blur(el);
  return text;
}

/** A summary with a current week built from `current`; `null` for none. */
function summary(current: Partial<CurrentWeek> | null = {}, extra: Partial<Summary> = {}): Summary {
  const base = buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records: [], snapshots: [], timeZone: 'UTC' });
  return {
    ...base,
    status: { endpointResult: 'ok' },
    current: current
      ? {
          forecast: { high: 70, low: 50, median: 60, method: 'calibrated' },
          pacing: { from: NOW - 4 * DAY_MS, points: [{ at: NOW - 4 * DAY_MS, percent: 0 }, { at: NOW - HOUR_MS, percent: 40 }], to: NOW + 3 * DAY_MS },
          readAt: new Date(NOW - HOUR_MS).toISOString(),
          resetsAt: RESETS,
          source: 'endpoint',
          weekly: 40,
          ...current,
        }
      : undefined,
    ...extra,
  };
}

const weeklyCard = () => screen.getByRole('heading', { name: 'Weekly limit' }).closest('section')!;

describe('overview', () => {
  // Testing Library only cleans up automatically with Vitest globals, which this project does not use.
  afterEach(cleanup);

  it('shows a fine week with a green band and verdict', () => {
    render(<Overview summary={summary()} />);
    expect(weeklyCard().className).toContain('card-good');
    expect(weeklyCard().textContent).toContain('40%');
    expect(screen.getByText('You should last the week.').closest('p')!.className).toContain('verdict-good');
  });

  it('marks a tight week and an expected cap', () => {
    render(<Overview summary={summary({ forecast: { high: 99, low: 80, median: 90, method: 'calibrated' } })} />);
    expect(weeklyCard().className).toContain('card-tight');
    cleanup();
    render(<Overview summary={summary({ forecast: { capAt: NOW + DAY_MS, high: 140, low: 110, median: 120, method: 'calibrated' }, pacing: { from: NOW - 4 * DAY_MS, points: [], roomPerDay: 22, to: NOW + 3 * DAY_MS } })} />);
    expect(weeklyCard().className).toContain('card-cap');
    expect(screen.getByText(/Spend under \$22\/day/)).toBeTruthy();
  });

  it('dims a stale estimate and explains it on demand', () => {
    render(<Overview summary={summary({ estimatedNow: 64, readAt: new Date(NOW - 2 * DAY_MS).toISOString() }, { status: { endpointResult: 'expired' } })} />);
    expect(screen.getByText('≈ 64%').className).toContain('dim');
    const button = screen.getByRole('button', { name: 'Why this number is an estimate' });
    expect(screen.queryByText(/Last reading 2 days ago/)).toBeNull();
    fireEvent.click(button);
    expect(screen.getByText(/Last reading 2 days ago/).closest('.popover')!.textContent).toContain('token expired');
  });

  it('keeps the explanation open when a hover or focus is followed by a click or tap', () => {
    render(<Overview summary={summary({ estimatedNow: 64, readAt: new Date(NOW - 2 * DAY_MS).toISOString() })} />);
    const button = screen.getByRole('button', { name: 'Why this number is an estimate' });
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a new week without a reading as a plain 0 %', () => {
    render(<Overview summary={summary({ weekly: 0, withoutReading: true })} />);
    expect(weeklyCard().textContent).toContain('0%');
    expect(screen.queryByRole('button', { name: 'Why this number is an estimate' })).toBeNull();
  });

  it('says there is not enough history without a current week', () => {
    render(<Overview summary={summary(null)} />);
    expect(screen.getByText('Not enough history yet.')).toBeTruthy();
    expect(weeklyCard().className).not.toMatch(/card-(good|tight|cap)/);
    expect(screen.queryByRole('heading', { name: 'Budget pacing this week' })).toBeNull();
  });

  it('says no 5-hour session is in progress', () => {
    render(<Overview summary={summary()} />);
    expect(screen.getByText('No session in progress.')).toBeTruthy();
  });

  it('shows the 5-hour session with its own verdict', () => {
    const fiveHourSession: FiveHourSession = {
      forecast: { high: 60, low: 40, median: 50, method: 'calibrated' },
      percent: 30,
      readAt: new Date(NOW - HOUR_MS).toISOString(),
      resetsAt: new Date(NOW + 2 * HOUR_MS).toISOString(),
    };
    render(<Overview summary={summary({}, { fiveHourSession })} />);
    expect(screen.getByText('No cap expected this session.')).toBeTruthy();
  });

  it('shows the 5-hour session even without a current week', () => {
    const fiveHourSession: FiveHourSession = { percent: 30, readAt: new Date(NOW - HOUR_MS).toISOString(), resetsAt: new Date(NOW + 2 * HOUR_MS).toISOString() };
    render(<Overview summary={summary(null, { fiveHourSession })} />);
    expect(screen.queryByText('No session in progress.')).toBeNull();
    expect(screen.getByRole('heading', { name: '5-hour session' }).closest('section')!.textContent).toContain('30%');
  });

  it('shows the daily room left in the pacing chart when calibrated', () => {
    render(<Overview summary={summary({ pacing: { from: NOW - 4 * DAY_MS, points: [], roomPerDay: 46, spentPerDay: 31, to: NOW + 3 * DAY_MS } })} />, { wrapper: TipProvider });
    expect(screen.getByText('≈ $46/day')).toBeTruthy();
    expect(tipOf(screen.getByRole('button', { name: 'About room left' }))).toContain('$31/day');
  });

  it('moves the actual label above the limit line when that line would cross it', () => {
    render(<Overview summary={summary({ weekly: 95 })} />);
    const label = screen.getByText('actual 95%');
    expect(Number(label.getAttribute('y'))).toBeLessThan(Number(document.querySelector('.pacing-limit')!.getAttribute('y1')));
    cleanup();
    render(<Overview summary={summary()} />);
    expect(Number(screen.getByText('actual 40%').getAttribute('y'))).toBeLessThan(Number(document.querySelector('.pacing-dot')!.getAttribute('cy')));
  });

  it('hides the room left without a calibration', () => {
    render(<Overview summary={summary()} />);
    expect(screen.queryByText(/Room left/)).toBeNull();
    expect(screen.getByRole('img', { name: /Weekly usage so far/ })).toBeTruthy();
  });
});
