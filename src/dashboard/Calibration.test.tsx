import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Summary } from '@/dashboard/api';

import { WEEK_MS } from '@/core/calibration';
import { buildSummary } from '@/core/summary';
import { Calibration } from '@/dashboard/Calibration';
import { TipProvider } from '@/dashboard/Tip';

const NOW = Date.now();
const DAY = 86_400_000;
const RESET = new Date(NOW + 2 * DAY).toISOString();

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    ...buildSummary({
      endpointEnabled: true,
      now: NOW,
      planHistory: [],
      records: [],
      snapshots: [{ source: 'endpoint', ts: new Date(NOW).toISOString(), weekly: 30, weeklyResetsAt: RESET }],
      timeZone: 'UTC',
    }),
    status: { endpointResult: 'ok' },
    ...overrides,
  };
}

/** Weekly windows ending 1..n weeks ago, each with a reading of `weekly(i)` % over $100 of usage. */
function driftSummary(weekly: (i: number) => number, weeks = 6): Summary {
  const resetOf = (i: number) => NOW - i * WEEK_MS + DAY;
  // One more record, a week before the oldest window: the windows must not start before the first message.
  const records = Array.from({ length: weeks + 2 }, (_, i) => ({
    cacheRead: 0,
    cacheWrite1h: 0,
    cacheWrite5m: 0,
    input: 0,
    key: `k${i}`,
    model: 'claude-opus-5-5',
    // $100 of Opus 5.5 output, a day before each reset.
    output: 5_000_000,
    project: 'p',
    ts: new Date(resetOf(i) - (i === weeks + 1 ? 9 : 2) * DAY).toISOString(),
  }));
  const snapshots = Array.from({ length: weeks }, (_, n) => {
    const i = weeks - n;
    return { source: 'endpoint' as const, ts: new Date(resetOf(i) - DAY + 3_600_000).toISOString(), weekly: weekly(i), weeklyResetsAt: new Date(resetOf(i)).toISOString() };
  });
  return { ...buildSummary({ endpointEnabled: true, now: NOW, planHistory: [], records, snapshots, timeZone: 'UTC' }), status: {} };
}

function renderTab(data = summary()) {
  const props = {
    busy: false,
    onAddReading: vi.fn(async (_reading: unknown) => {}),
    onDeleteReading: vi.fn(async (_ts: string) => {}),
    onSaveSettings: vi.fn(async (_settings: unknown) => {}),
    summary: data,
  };
  render(<TipProvider><Calibration {...props} /></TipProvider>);
  return props;
}

describe('calibration tab', () => {
  // Testing Library only cleans up automatically with Vitest globals, which this project does not use.
  afterEach(cleanup);

  describe('empty states', () => {
    it('shows the drift and fit empty states and keeps the form', () => {
      renderTab();
      expect(screen.getByText(/No weekly window with a reading of 10%/)).toBeTruthy();
      expect(screen.getByText(/Needs at least 3 readings/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Add manual reading' })).toBeTruthy();
    });

    it('shows only the form when there is no reading at all', () => {
      renderTab(summary({ limits: { drift: [], readings: [], readingsPerPeriod: [] } }));
      expect(screen.queryByRole('table', { name: '' })?.closest('.readings-table')).toBeNull();
      expect(screen.queryByText(/Showing/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Add manual reading' })).toBeTruthy();
    });
  });

  describe('limit drift', () => {
    it('hatches a bar far from the usual ratio, names the line and warns of a shift', () => {
      // 6 completed weeks at 10% per $100, the last 2 at 20%.
      const { container } = render(<TipProvider><Calibration {...{ busy: false, onAddReading: vi.fn(), onDeleteReading: vi.fn(), onSaveSettings: vi.fn(), summary: driftSummary(i => (i <= 2 ? 20 : 10)) }} /></TipProvider>);
      expect(container.querySelectorAll('.drift-bar.off')).toHaveLength(2);
      expect(container.querySelectorAll('.drift-bar')).toHaveLength(6);
      expect(screen.getByText(/usual 10\.0%/)).toBeTruthy();
      expect(screen.getByText(/costs 100% more of the limit/)).toBeTruthy();
      expect(screen.getByText('more than 15% off')).toBeTruthy();
    });

    it('draws the bars without a usual line while there are fewer than 3 completed weeks', () => {
      const { container } = render(<TipProvider><Calibration {...{ busy: false, onAddReading: vi.fn(), onDeleteReading: vi.fn(), onSaveSettings: vi.fn(), summary: driftSummary(() => 10, 2) }} /></TipProvider>);
      expect(container.querySelectorAll('.drift-bar')).toHaveLength(2);
      expect(container.querySelector('.drift-usual')).toBeNull();
      expect(screen.getByText(/Drift needs 3 completed weeks/)).toBeTruthy();
    });
  });

  describe('readings', () => {
    function manualSummary(count: number) {
      const readings = Array.from({ length: count }, (_, i) => ({
        claudeCodeShare: i === 0 ? 80 : undefined,
        source: i === 0 ? 'manual' as const : 'endpoint' as const,
        ts: new Date(NOW - i * 3_600_000).toISOString(),
        weekly: 30,
        weeklyResetsAt: RESET,
      }));
      return summary({ limits: { ...summary().limits, readings } });
    }

    it('shows 10 rows, then 20 more, and the share or a dash', () => {
      renderTab(manualSummary(45));
      const rows = () => within(screen.getAllByRole('table')[0]!).getAllByRole('row').length - 1;
      expect(rows()).toBe(10);
      expect(screen.getByText('Showing 10 of 45 readings')).toBeTruthy();
      expect(screen.getByText('80%')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(rows()).toBe(30);
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(rows()).toBe(45);
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    });

    it('deletes only a manual reading, after confirming', () => {
      const { onDeleteReading } = renderTab(manualSummary(3));
      expect(screen.getAllByRole('button', { name: /^Delete the manual reading/ })).toHaveLength(1);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
      fireEvent.click(screen.getByRole('button', { name: /^Delete the manual reading/ }));
      expect(onDeleteReading).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: /^Delete the manual reading/ }));
      expect(onDeleteReading).toHaveBeenCalledWith(new Date(NOW).toISOString());
      confirm.mockRestore();
    });

    it('submits a manual reading with a share and the current reset prefilled', () => {
      const { onAddReading } = renderTab();
      fireEvent.change(screen.getByLabelText('Weekly %'), { target: { value: '44' } });
      fireEvent.change(screen.getByLabelText('5-hour %'), { target: { value: '12' } });
      fireEvent.change(screen.getByLabelText('Claude Code share %'), { target: { value: '85' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add manual reading' }));
      expect(onAddReading).toHaveBeenCalledWith({
        claudeCodeShare: 85,
        fiveHour: 12,
        weekly: 44,
        weeklyResetsAt: new Date(Math.floor(Date.parse(RESET) / 60_000) * 60_000).toISOString(),
      });
    });
  });

  describe('settings', () => {
    it('saves the 5-hour limit threshold, prefilled with the saved one', () => {
      const { onSaveSettings } = renderTab();
      const input = screen.getByLabelText('5-hour limit hit from (%)') as HTMLInputElement;
      expect(input.value).toBe('95');
      fireEvent.change(input, { target: { value: '98' } });
      fireEvent.click(within(input.closest('form')!).getByRole('button', { name: 'Save' }));
      expect(onSaveSettings).toHaveBeenCalledWith({ limitThreshold: 98 });
    });

    it('saves the weekly limit threshold, prefilled with the saved one', () => {
      const { onSaveSettings } = renderTab();
      const input = screen.getByLabelText('Weekly limit hit from (%)') as HTMLInputElement;
      expect(input.value).toBe('98');
      fireEvent.change(input, { target: { value: '99' } });
      fireEvent.click(within(input.closest('form')!).getByRole('button', { name: 'Save' }));
      expect(onSaveSettings).toHaveBeenCalledWith({ weekLimitThreshold: 99 });
    });

    it('saves the throttle, and refuses values outside 15 to 1440', () => {
      const { onSaveSettings } = renderTab();
      const input = screen.getByLabelText('Minutes between endpoint calls') as HTMLInputElement;
      expect(input.value).toBe('15');
      const save = within(input.closest('form')!).getByRole('button', { name: 'Save' });
      fireEvent.change(input, { target: { value: '5' } });
      fireEvent.click(save);
      expect(onSaveSettings).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: '60' } });
      fireEvent.click(save);
      expect(onSaveSettings).toHaveBeenCalledWith({ throttleMinutes: 60 });
    });

    it('keeps a field empty while it is being retyped', () => {
      renderTab();
      const input = screen.getByLabelText('Minutes between endpoint calls') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '' } });
      expect(input.value).toBe('');
    });

    it('offers the detected plan, and picking it adds a detected period from now', () => {
      const data = summary({
        detected: 'max5',
        planHistory: [{ from: '2026-01-01T00:00:00.000Z', plan: 'max5', source: 'manual' }],
        planSource: 'manual',
      });
      const { onSaveSettings } = renderTab({ ...data, plan: 'max5' });
      const select = screen.getByLabelText('Plan', { selector: '#plan-select' }) as HTMLSelectElement;
      expect(select.value).toBe('max5');
      expect(within(select).getByRole('option', { name: 'Detected: Max 5×' })).toBeTruthy();
      fireEvent.change(select, { target: { value: 'detected' } });
      const { planHistory } = onSaveSettings.mock.calls[0]![0] as { planHistory: { plan: string; source: string }[] };
      expect(planHistory.at(-1)).toMatchObject({ plan: 'max5', source: 'detected' });
    });

    it('selects Detected while a detected period is active, and picking a plan adds a manual one', () => {
      const data = summary({ detected: 'max5', plan: 'max5', planHistory: [{ from: '2026-01-01T00:00:00.000Z', plan: 'max5', source: 'detected' }], planSource: 'detected' });
      const { onSaveSettings } = renderTab(data);
      const select = screen.getByLabelText('Plan', { selector: '#plan-select' }) as HTMLSelectElement;
      expect(select.value).toBe('detected');
      fireEvent.change(select, { target: { value: 'pro' } });
      const { planHistory } = onSaveSettings.mock.calls[0]![0] as { planHistory: { plan: string; source: string }[] };
      expect(planHistory.at(-1)).toMatchObject({ plan: 'pro', source: 'manual' });
    });

    it('keeps the plan assumed so far when choosing the first plan period', () => {
      const { onSaveSettings } = renderTab();
      fireEvent.change(screen.getByLabelText('Plan', { selector: '#plan-select' }), { target: { value: 'max5' } });
      const { planHistory } = onSaveSettings.mock.calls[0]![0] as { planHistory: { from: string; plan: string }[] };
      expect(planHistory.map(p => p.plan)).toEqual(['pro', 'max5']);
      expect(planHistory[0]!.from).toBe(new Date(0).toISOString());
    });

    it('offers to switch to a detected plan that differs from the setting', () => {
      const { onSaveSettings } = renderTab(summary({
        detected: 'max20',
        detectedPlan: 'max20',
        planHistory: [{ from: '2026-01-01T00:00:00.000Z', plan: 'pro', source: 'manual' }],
      }));
      fireEvent.click(screen.getByRole('button', { name: 'Switch to Max 20×' }));
      expect((onSaveSettings.mock.calls[0]![0] as { planHistory: { plan: string }[] }).planHistory.at(-1)?.plan).toBe('max20');
    });
  });

  describe('collection', () => {
    it('shows a failed run as a notice, and malformed lines only when there are some', () => {
      renderTab(summary({ status: { endpointResult: 'http-429', lastError: 'EACCES', malformedLines: 3, messages: 31_204 } }));
      expect(screen.getByText(/Last run failed: EACCES/)).toBeTruthy();
      expect(screen.getByText(/rate limited/)).toBeTruthy();
      expect(screen.getByText('Malformed lines')).toBeTruthy();
      expect(screen.getByText('31,204')).toBeTruthy();
    });

    it('leaves out the notice and the malformed lines when there are none', () => {
      renderTab();
      expect(screen.queryByText(/Last run failed/)).toBeNull();
      expect(screen.queryByText('Malformed lines')).toBeNull();
    });
  });

  describe('plan history', () => {
    const history = [
      { from: new Date(0).toISOString(), plan: 'pro' as const, source: 'manual' as const },
      { from: '2026-01-01T00:00:00.000Z', plan: 'max5' as const, source: 'detected' as const },
    ];
    const withHistory = () => summary({ limits: { ...summary().limits, readingsPerPeriod: [12, 1486] }, plan: 'max5', planHistory: history });

    it('lists periods newest first with the current one marked, until, source and readings', () => {
      renderTab(withHistory());
      const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      expect(within(rows[0]!).getByText('current')).toBeTruthy();
      expect(rows[0]!.textContent).toContain('Max 5×');
      expect(rows[0]!.textContent).toContain('now');
      expect(rows[0]!.textContent).toContain('1,486');
      expect(rows[1]!.textContent).toContain('the start');
      expect(rows[1]!.textContent).toContain('Pro');
    });

    it('removes a period', () => {
      const { onSaveSettings } = renderTab(withHistory());
      fireEvent.click(screen.getByRole('button', { name: /^Remove Pro/ }));
      expect(onSaveSettings).toHaveBeenCalledWith({ planHistory: [history[1]] });
    });

    it('shows the assumed plan as one row without Remove when there is no history', () => {
      renderTab();
      const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain('assumed');
      expect(within(rows[0]!).queryByRole('button')).toBeNull();
    });

    it('adds a past period', () => {
      const { onSaveSettings } = renderTab(withHistory());
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } });
      fireEvent.click(screen.getByRole('button', { name: 'Set plan' }));
      const { planHistory } = onSaveSettings.mock.calls[0]![0] as { planHistory: { from: string }[] };
      expect(planHistory).toHaveLength(3);
      expect(planHistory.at(-1)!.from).toBe(new Date('2026-03-01T00:00').toISOString());
    });
  });
});
