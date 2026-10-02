import { describe, expect, it } from 'vitest';

import { scaleMax } from '@/dashboard/scale';

describe('scaleMax', () => {
  it('ends at 100 % when every value fits', () => {
    expect(scaleMax([53, 92])).toBe(100);
    expect(scaleMax([100])).toBe(100);
  });

  it('rounds the highest value up to 10 %', () => {
    expect(scaleMax([53, 211, 257])).toBe(260);
  });

  it('leaves room past the cap', () => {
    expect(scaleMax([92, 103])).toBe(125);
  });
});
