import { describe, expect, it } from 'vitest';

import { compareVersions } from './versions.ts';

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('2.1.300', '2.1.287')).toBeGreaterThan(0);
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
  });
});
