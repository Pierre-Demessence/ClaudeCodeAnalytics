import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { tabFromHash, useTab } from '@/dashboard/tabs';

describe('tabFromHash', () => {
  it('defaults to overview', () => {
    expect(tabFromHash('')).toBe('overview');
    expect(tabFromHash('#')).toBe('overview');
  });

  it('reads a known tab', () => {
    expect(tabFromHash('#/usage')).toBe('usage');
    expect(tabFromHash('#calibration')).toBe('calibration');
  });

  it('falls back to overview for an unknown tab', () => {
    expect(tabFromHash('#/nope')).toBe('overview');
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
