import { describe, expect, it } from 'vitest';

import type { Measure } from '@/dashboard/meter';

import { CAP_LABEL, meterLayout } from '@/dashboard/meter';

const measure: Measure = { trackPx: 500, labelPx: text => text.length * 7 };

describe('meterLayout', () => {
  it('puts labels inside segments wide enough for them', () => {
    const layout = meterLayout({ estimated: false, high: 93, low: 76, median: 84, used: 62 }, measure);
    expect(layout.used).toMatchObject({ inside: 'used 62%', left: 0, width: 0.62 });
    expect(layout.projection).toMatchObject({ inside: 'projected 84%', left: 0.62 });
    expect(layout.outside).toEqual([]);
    expect(layout.range?.label).toBe('likely 76–93%');
  });

  it('puts a label above the bar at its segment start when it does not fit', () => {
    const layout = meterLayout({ estimated: false, median: 70, used: 62 }, measure);
    expect(layout.outside).toEqual([{ key: 'projection', left: 310, text: 'projected 70%' }]);
  });

  it('keeps the limit label above the bar when there is room', () => {
    const layout = meterLayout({ estimated: false, high: 93, low: 76, median: 84, used: 62 }, measure);
    expect(layout.capLabel).toEqual({ left: 500 - CAP_LABEL.length * 7, row: 'top' });
  });

  it('moves the limit label below the bar when the row above is taken', () => {
    const layout = meterLayout({ estimated: false, high: 259, low: 157, median: 214, used: 60 }, { trackPx: 300, labelPx: text => text.length * 7 });
    expect(layout.outside.find(l => l.key === 'used')!.left).toBe(0);
    expect(layout.capLabel).toEqual({ left: 300 * 100 / 260 - CAP_LABEL.length * 7, row: 'bottom' });
  });

  it('routes labels around the limit label when no other spot is free', () => {
    const layout = meterLayout({ estimated: false, high: 101, low: 95, median: 99, used: 90 }, measure);
    const label = layout.outside.find(l => l.key === 'projection')!;
    expect(layout.capLabel?.row).toBe('top');
    expect(label.left + 'projected 99%'.length * 7).toBeLessThanOrEqual(500);
    expect(label.left + 'projected 99%'.length * 7 <= layout.capLabel!.left || label.left >= layout.capLabel!.left + CAP_LABEL.length * 7).toBe(true);
  });

  it('puts a label before the limit label when the cap is at the end of the bar', () => {
    const layout = meterLayout({ estimated: true, high: 82, low: 75, median: 80, used: 67 }, { trackPx: 300, labelPx: text => text.length * 7 });
    const label = layout.outside.find(l => l.key === 'projection')!;
    expect(layout.capLabel).toEqual({ left: 300 - CAP_LABEL.length * 7, row: 'top' });
    expect(label.left + 'projected 80%'.length * 7).toBeLessThanOrEqual(layout.capLabel!.left);
  });

  it('drops the projection segment when used is already past 100 %', () => {
    const layout = meterLayout({ estimated: true, median: 120, used: 110 }, measure);
    expect(layout.projection).toBeUndefined();
    expect(layout.over?.left).toBeCloseTo(110 / 125);
  });

  it('never overlaps two labels above the bar', () => {
    const layout = meterLayout({ estimated: true, high: 100, low: 95, median: 99, used: 40 }, { trackPx: 120, labelPx: text => text.length * 7 });
    const [first, second] = layout.outside;
    expect(second!.left).toBeGreaterThanOrEqual(first!.left + first!.text.length * 7);
  });

  it('draws no used segment at 0 % and labels it above the bar', () => {
    const layout = meterLayout({ estimated: false, high: 86, low: 58, median: 71, used: 0 }, measure);
    expect(layout.used?.width).toBe(0);
    expect(layout.outside[0]).toEqual({ key: 'used', left: 0, text: 'used 0%' });
    expect(layout.projection?.inside).toBe('projected 71%');
  });

  it('keeps two outside labels apart', () => {
    const layout = meterLayout({ estimated: true, median: 9, used: 3 }, measure);
    const [used, projection] = layout.outside;
    expect(used!.text).toBe('used ≈ 3%');
    expect(projection!.left).toBeGreaterThanOrEqual(used!.left + used!.text.length * 7);
  });

  it('stretches the scale and adds an over-limit segment past 100 %', () => {
    const layout = meterLayout({ estimated: false, high: 131, low: 104, median: 118, used: 81 }, measure);
    expect(layout.capAt).toBeCloseTo(100 / 140);
    expect(layout.projection?.width).toBeCloseTo((100 - 81) / 140);
    expect(layout.over).toMatchObject({ inside: '▲ +18%' });
    expect(layout.capLabel?.row).toBe('bottom');
  });

  it('keeps the range label inside the track', () => {
    const layout = meterLayout({ estimated: false, high: 100, low: 97, median: 98, used: 90 }, measure);
    expect(layout.range!.labelLeft + layout.range!.label.length * 7).toBeLessThanOrEqual(500);
  });
});
