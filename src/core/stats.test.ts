import { describe, expect, it } from 'vitest';

import { median, quantile } from './stats.ts';

describe('quantile', () => {
  it('interpolates between sorted values', () => {
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([10], 0.75)).toBe(10);
  });

  it('returns undefined for an empty list', () => {
    expect(quantile([], 0.5)).toBeUndefined();
  });
});

describe('median', () => {
  it('is the middle value', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});
