import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Summary } from '@/dashboard/api';

import { buildSummary } from '@/core/summary';
import { Header } from '@/dashboard/Header';

function summary(): Summary {
  return {
    ...buildSummary({ endpointEnabled: true, now: Date.now(), planHistory: [], records: [], snapshots: [], timeZone: 'UTC' }),
    status: {},
  };
}

function renderHeader(props: Partial<Parameters<typeof Header>[0]> = {}) {
  render(<Header anonymous={false} busy={false} onRefresh={vi.fn()} onToggleAnonymous={vi.fn()} onToggleTheme={vi.fn()} summary={summary()} tab="usage" theme="light" {...props} />);
}

describe('header', () => {
  // Testing Library only cleans up automatically with Vitest globals, which this project does not use.
  afterEach(cleanup);

  it('says when there is no reading yet', () => {
    renderHeader();
    expect(screen.getByText('No reading yet')).toBeTruthy();
  });

  it('marks the active tab', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: 'Usage' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
  });

  it('carries the range on the links of the tabs that read it', () => {
    renderHeader({ range: { back: 2, kind: 'preset', preset: 'week' } });
    expect(screen.getByRole('link', { name: 'Usage' }).getAttribute('href')).toBe('#/usage?range=week&back=2');
    expect(screen.getByRole('link', { name: 'Sessions' }).getAttribute('href')).toBe('#/sessions?range=week&back=2');
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('#/overview');
    expect(screen.getByRole('link', { name: 'Calibration' }).getAttribute('href')).toBe('#/calibration');
  });

  it('disables Refresh while busy', () => {
    renderHeader({ busy: true });
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Updating…')).toBeTruthy();
  });

  it('offers the light theme while dark', () => {
    renderHeader({ theme: 'dark' });
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
  });

  it('shows the anonymize state as pressed and calls the toggle', () => {
    const onToggleAnonymous = vi.fn();
    renderHeader({ anonymous: true, onToggleAnonymous });
    const button = screen.getByRole('button', { name: 'Show project names and titles' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onToggleAnonymous).toHaveBeenCalledOnce();
  });
});
