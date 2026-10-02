import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Summary } from '@/dashboard/api';

import { buildSummary } from '@/core/summary';
import { SettingsPanel } from '@/dashboard/SettingsPanel';

const NOW = Date.now();
const RESET = new Date(NOW + 2 * 86_400_000).toISOString();

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

function renderPanel(data = summary()) {
  const props = {
    busy: false,
    onAddReading: vi.fn(async (_reading: unknown) => {}),
    onRefresh: vi.fn(async () => {}),
    onSaveSettings: vi.fn(async (_settings: unknown) => {}),
    summary: data,
  };
  render(<SettingsPanel {...props} />);
  return props;
}

describe('settingsPanel', () => {
  // Testing Library only cleans up automatically with Vitest globals, which this project does not use.
  afterEach(cleanup);

  it('submits a manual reading with the current reset prefilled', () => {
    const { onAddReading } = renderPanel();
    fireEvent.change(screen.getByLabelText('Weekly %'), { target: { value: '44' } });
    fireEvent.change(screen.getByLabelText('5-hour %'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reading' }));
    expect(onAddReading).toHaveBeenCalledWith({ fiveHour: 12, weekly: 44, weeklyResetsAt: new Date(Math.floor(Date.parse(RESET) / 60_000) * 60_000).toISOString() });
  });

  it('keeps the plan assumed so far when setting the first plan period', () => {
    const { onSaveSettings } = renderPanel();
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'max5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set plan' }));
    const { planHistory } = onSaveSettings.mock.calls[0]![0] as { planHistory: { from: string; plan: string }[] };
    expect(planHistory.map(p => p.plan)).toEqual(['pro', 'max5']);
    expect(planHistory[0]!.from).toBe(new Date(0).toISOString());
  });

  it('removes a plan period and offers to switch to a detected plan', () => {
    const data = summary({
      detectedPlan: 'max20',
      planHistory: [{ from: '2026-01-01T00:00:00.000Z', plan: 'pro', source: 'manual' }],
    });
    const { onSaveSettings } = renderPanel(data);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Max 20×' }));
    expect((onSaveSettings.mock.calls[0]![0] as { planHistory: { plan: string }[] }).planHistory.at(-1)?.plan).toBe('max20');
    fireEvent.click(screen.getByRole('button', { name: /^Remove Pro/ }));
    expect(onSaveSettings.mock.calls[1]![0]).toEqual({ planHistory: [] });
  });

  it('shows a failed run', () => {
    renderPanel(summary({ status: { endpointResult: 'http-429', lastError: 'EACCES' } }));
    expect(screen.getByText(/Last run failed: EACCES/)).toBeTruthy();
    expect(screen.getByText(/rate limited/)).toBeTruthy();
  });
});
