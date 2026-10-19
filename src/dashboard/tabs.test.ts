import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { hasRange, rangeFromHash, tabFromHash, tabHref, useRangeChoice, useTab } from '@/dashboard/tabs';

describe('tabFromHash', () => {
  it('defaults to overview', () => {
    expect(tabFromHash('')).toBe('overview');
    expect(tabFromHash('#')).toBe('overview');
  });

  it('reads a known tab', () => {
    expect(tabFromHash('#/usage')).toBe('usage');
    expect(tabFromHash('#/breakdown')).toBe('breakdown');
    expect(tabFromHash('#/weeks')).toBe('weeks');
    expect(tabFromHash('#/plans')).toBe('plans');
    expect(tabFromHash('#calibration')).toBe('calibration');
  });

  it('falls back to overview for an unknown tab', () => {
    expect(tabFromHash('#/nope')).toBe('overview');
  });

  it('ignores the range after the tab', () => {
    expect(tabFromHash('#/usage?range=4weeks')).toBe('usage');
    expect(tabFromHash('#/sessions?from=2026-09-01&to=2026-09-30')).toBe('sessions');
  });
});

describe('rangeFromHash', () => {
  it('reads a preset, a step back and custom days', () => {
    expect(rangeFromHash('#/usage?range=3months')).toEqual({ back: 0, kind: 'preset', preset: '3months' });
    expect(rangeFromHash('#/weeks?range=week&back=2')).toEqual({ back: 2, kind: 'preset', preset: 'week' });
    expect(rangeFromHash('#/breakdown?from=2026-09-01&to=2026-09-30')).toEqual({ from: '2026-09-01', kind: 'custom', to: '2026-09-30' });
  });

  it('is undefined without a range or with an invalid one', () => {
    expect(rangeFromHash('#/usage')).toBeUndefined();
    expect(rangeFromHash('#/usage?range=forever')).toBeUndefined();
    expect(rangeFromHash('#/usage?from=2026-09-30&to=2026-09-01')).toBeUndefined();
    expect(rangeFromHash('#/usage?from=2026-02-31&to=2026-03-01')).toBeUndefined();
  });
});

describe('tabHref', () => {
  const range = { back: 1, kind: 'preset', preset: '4weeks' } as const;

  it('carries the range on the tabs that read it', () => {
    expect(tabHref('usage', range)).toBe('#/usage?range=4weeks&back=1');
    expect(tabHref('weeks', { from: '2026-09-01', kind: 'custom', to: '2026-09-30' })).toBe('#/weeks?from=2026-09-01&to=2026-09-30');
    expect(['usage', 'breakdown', 'sessions', 'weeks'].every(id => hasRange(id as never))).toBe(true);
  });

  it('leaves the other tabs and a missing range alone', () => {
    expect(tabHref('overview', range)).toBe('#/overview');
    expect(tabHref('calibration', range)).toBe('#/calibration');
    expect(tabHref('usage')).toBe('#/usage');
  });
});

describe('useRangeChoice', () => {
  afterEach(() => {
    location.hash = '';
  });

  it('restores the range from the hash', () => {
    location.hash = '#/usage?range=12months';
    const { result } = renderHook(() => useRangeChoice());
    expect(result.current[0]).toEqual({ back: 0, kind: 'preset', preset: '12months' });
  });

  it('writes a chosen range into the current tab hash and reads it back', () => {
    location.hash = '#/sessions';
    const { result } = renderHook(() => useRangeChoice());
    act(() => result.current[1]({ back: 0, kind: 'preset', preset: 'all' }));
    expect(location.hash).toBe('#/sessions?range=all');
    act(() => dispatchEvent(new HashChangeEvent('hashchange')));
    expect(result.current[0]).toEqual({ back: 0, kind: 'preset', preset: 'all' });
    act(() => result.current[1](undefined));
    expect(location.hash).toBe('#/sessions');
  });

  it('keeps the range while a tab without one is open', () => {
    location.hash = '#/weeks?range=3months';
    const { result } = renderHook(() => useRangeChoice());
    act(() => {
      location.hash = '#/plans';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toEqual({ back: 0, kind: 'preset', preset: '3months' });
    act(() => {
      location.hash = '#/usage';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toBeUndefined();
  });

  it('falls back to no range for an invalid hash', () => {
    location.hash = '#/usage?range=nope';
    const { result } = renderHook(() => useRangeChoice());
    expect(result.current[0]).toBeUndefined();
  });
});

describe('useTab', () => {
  afterEach(() => {
    location.hash = '';
  });

  it('follows hash changes', () => {
    location.hash = '#/usage';
    const { result } = renderHook(() => useTab());
    expect(result.current).toBe('usage');
    act(() => {
      location.hash = '#/calibration';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current).toBe('calibration');
  });
});
