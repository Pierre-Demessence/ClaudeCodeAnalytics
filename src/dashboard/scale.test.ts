import { describe, expect, it } from 'vitest';

import { rangeRows, rangeTicks, scaleMax, spreadTicks, tickAlign } from '@/dashboard/scale';

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

describe('spreadTicks', () => {
  it('drops a tick too close to one with a higher priority', () => {
    const used = { at: 0.03, label: '3%' };
    const cap = { at: 0.8, label: '100%' };
    const zero = { at: 0, label: '0%' };
    expect(spreadTicks([used, cap, zero])).toEqual([used, cap]);
  });
});

describe('rangeTicks', () => {
  it('keeps both ends apart when there is room', () => {
    const low = { at: 0.4, label: '50%' };
    const high = { at: 0.8, label: '100%' };
    expect(rangeTicks(low, high)).toEqual([low, high]);
  });

  it('merges ends that would touch', () => {
    expect(rangeTicks({ at: 0.5, label: '50%' }, { at: 0.54, label: '54%' })).toEqual([{ at: 0.52, label: '50%–54%' }]);
  });
});

describe('rangeRows', () => {
  const caption = 'likely range';

  it('puts the caption between the ends of a wide range', () => {
    const low = { at: 0.2, label: '50%' };
    const high = { at: 0.8, label: '200%' };
    expect(rangeRows(low, high, caption)).toEqual([[low, { at: 0.5, label: caption }, high]]);
  });

  it('puts the caption under the ends of a narrow range', () => {
    const low = { at: 0.4, label: '50%' };
    const high = { at: 0.6, label: '75%' };
    expect(rangeRows(low, high, caption)).toEqual([[low, high], [{ at: 0.5, label: caption }]]);
  });
});

describe('tickAlign', () => {
  it('aligns ticks near an edge to it', () => {
    expect([0, 0.5, 1].map(tickAlign)).toEqual(['start', 'center', 'end']);
  });
});
