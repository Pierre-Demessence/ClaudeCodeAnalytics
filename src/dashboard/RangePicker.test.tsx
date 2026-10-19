import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RangeChoice, RangeContext } from '@/core/range';
import type { HistoryView } from '@/dashboard/history';

import { DAY_MS } from '@/core/calibration';
import { resolveRange } from '@/core/range';
import { RangeFrame, RangePicker } from '@/dashboard/RangePicker';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const ctx: RangeContext = { firstMessage: NOW - 200 * DAY_MS, now: NOW, resets: [], timeZone: 'UTC' };

function viewOf(choice?: RangeChoice, extra: Partial<HistoryView> = {}) {
  const onChoose = vi.fn();
  const view = { choice, ctx, history: {} as HistoryView['history'], loading: false, onChoose, range: choice && resolveRange(choice, ctx), ...extra };
  return { onChoose, view };
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

describe('range picker', () => {
  afterEach(cleanup);

  it('presses Default and disables stepping without a range', () => {
    const { view } = viewOf();
    render(<RangePicker view={view} />);
    expect(pressed('Default')).toBe('true');
    expect(screen.getByText('Default windows')).toBeTruthy();
    expect(disabled('Previous period')).toBe(true);
    expect(disabled('Next period')).toBe(true);
  });

  it('chooses a preset, then the default again', () => {
    const { onChoose, view } = viewOf({ back: 0, kind: 'preset', preset: 'week' });
    render(<RangePicker view={view} />);
    expect(pressed('This week')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Last 3 months' }));
    expect(onChoose).toHaveBeenLastCalledWith({ back: 0, kind: 'preset', preset: '3months' });
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect(onChoose).toHaveBeenLastCalledWith(undefined);
  });

  it('steps into the past, and not toward now when the range ends now', () => {
    const { onChoose, view } = viewOf({ back: 0, kind: 'preset', preset: '3months' });
    render(<RangePicker view={view} />);
    expect(disabled('Next period')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(onChoose).toHaveBeenCalledWith({ back: 1, kind: 'preset', preset: '3months' });
  });

  it('steps back toward now from a past range, and not before the first message', () => {
    // The first message is 200 days ago: the 12 months before today start earlier, so there is nothing before.
    const { onChoose, view } = viewOf({ back: 1, kind: 'preset', preset: '3months' });
    render(<RangePicker view={view} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(onChoose).toHaveBeenCalledWith({ back: 0, kind: 'preset', preset: '3months' });
    cleanup();
    const first = viewOf({ back: 0, kind: 'preset', preset: '12months' });
    render(<RangePicker view={first.view} />);
    expect(disabled('Previous period')).toBe(true);
  });

  it('names the range by the dates it covers', () => {
    const { view } = viewOf({ from: '2026-09-01', kind: 'custom', to: '2026-09-30' });
    render(<RangePicker view={view} />);
    expect(screen.getByText('1 Sept – 30 Sept 2026')).toBeTruthy();
  });

  it('turns the current range into custom days', () => {
    const { onChoose, view } = viewOf({ back: 0, kind: 'preset', preset: '4weeks' });
    render(<RangePicker view={view} />);
    expect(screen.queryByLabelText('From')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect((onChoose.mock.calls[0]![0] as RangeChoice).kind).toBe('custom');
  });

  it('edits custom days and keeps from before to', () => {
    const { onChoose, view } = viewOf({ from: '2026-09-01', kind: 'custom', to: '2026-09-30' });
    render(<RangePicker view={view} />);
    expect(pressed('Custom')).toBe('true');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-10' } });
    expect(onChoose).toHaveBeenLastCalledWith({ from: '2026-09-10', kind: 'custom', to: '2026-09-30' });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-15' } });
    expect(onChoose).toHaveBeenLastCalledWith({ from: '2026-08-15', kind: 'custom', to: '2026-08-15' });
    onChoose.mockClear();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('says it is loading, and dims the content', () => {
    const { view } = viewOf({ back: 0, kind: 'preset', preset: 'all' }, { loading: true });
    render(<RangeFrame view={view}><p>Content</p></RangeFrame>);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    const content = screen.getByText('Content').parentElement!;
    expect(content.className).toContain('loading');
    expect(content.getAttribute('aria-busy')).toBe('true');
  });

  it('shows why a range could not be loaded', () => {
    const { view } = viewOf({ back: 0, kind: 'preset', preset: 'all' }, { error: 'Bad range' });
    render(<RangeFrame view={view}><p>Content</p></RangeFrame>);
    expect(screen.getByRole('alert').textContent).toBe('Bad range');
    expect(screen.getByText('Content').parentElement!.className).toContain('loading');
  });
});
