import { describe, expect, it } from 'vitest';

import { limitVerdict } from '@/dashboard/verdict';

const now = new Date(2026, 9, 2, 12, 0).getTime();
const resetsAt = new Date(2026, 9, 7, 9, 0).toISOString();
const base = { now, resetsAt, used: 40, window: 'week' as const };

describe('limitVerdict', () => {
  it('says the week lasts, with the busy-pace end', () => {
    expect(limitVerdict({ ...base, forecast: { high: 93, low: 76, median: 84, method: 'calibrated' } })).toEqual({
      detail: 'Even a busy pace ends around 93%.',
      kind: 'good',
      title: 'You should last the week.',
    });
  });

  it('calls a median of 85 % or more tight', () => {
    expect(limitVerdict({ ...base, forecast: { high: 102, low: 80, median: 90, method: 'calibrated' } })).toMatchObject({
      detail: 'A busy pace could reach 102%.',
      kind: 'tight',
    });
  });

  it('gives the cap time and the daily budget when the cap is expected', () => {
    const capAt = new Date(2026, 9, 6, 14, 0).getTime();
    expect(limitVerdict({ ...base, forecast: { capAt, high: 140, low: 110, median: 120, method: 'calibrated' }, roomPerDay: 22 })).toEqual({
      detail: 'Spend under $22/day to last until the reset.',
      kind: 'cap',
      title: 'Likely to hit the limit around Tue 6 Oct, 14:00.',
    });
  });

  it('expects the cap without a time from a typical week past 100 %', () => {
    expect(limitVerdict({ ...base, forecast: { high: 130, low: 100, median: 110, method: 'typical' } }).title).toBe('Likely to hit the limit before the reset.');
  });

  it('reports a reached limit', () => {
    expect(limitVerdict({ ...base, forecast: { capAt: now, high: 100, low: 100, median: 100, method: 'calibrated' }, used: 100 })).toMatchObject({ kind: 'cap', title: 'Limit reached.' });
  });

  it('gives the time left in a fine 5-hour session', () => {
    const fiveHourReset = new Date(now + (2 * 60 + 10) * 60_000).toISOString();
    expect(limitVerdict({ forecast: { high: 60, low: 40, median: 50, method: 'calibrated' }, now, resetsAt: fiveHourReset, used: 20, window: 'fiveHour' })).toEqual({
      detail: '2 h 10 min left in the window.',
      kind: 'good',
      title: 'No cap expected this session.',
    });
  });

  it('is informational without a projection', () => {
    expect(limitVerdict({ ...base }).kind).toBe('info');
  });
});
