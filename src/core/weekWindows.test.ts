import { describe, expect, it } from 'vitest';

import { DAY_MS } from './calibration.ts';
import { weekBucketer, weekStarter, weekStartFor } from './weekWindows.ts';

describe('weekStartFor', () => {
  const h = 3_600_000;
  // The reset moved from Wednesday 20:00 to Thursday 08:00 between two weeks.
  const resets = [Date.parse('2026-10-07T20:00:00Z'), Date.parse('2026-10-15T08:00:00Z')];

  it('uses the window of the next reset', () => {
    expect(weekStartFor(Date.parse('2026-10-05T00:00:00Z'), resets)).toBe(resets[0]! - 7 * DAY_MS);
    expect(weekStartFor(Date.parse('2026-10-10T00:00:00Z'), resets)).toBe(resets[1]! - 7 * DAY_MS);
  });

  it('steps back whole weeks before the first reading and forward after the last', () => {
    expect(weekStartFor(Date.parse('2026-09-25T00:00:00Z'), resets)).toBe(resets[0]! - 14 * DAY_MS);
    expect(weekStartFor(resets[1]! + h, resets)).toBe(resets[1]);
  });
});

describe('without readings', () => {
  const sunday = Date.parse('2026-10-18T23:00:00Z');

  it('starts the week on local Monday 00:00', () => {
    // Sunday 23:00 UTC is already Monday 01:00 in Paris.
    expect(weekStarter([], 'Europe/Paris')(sunday)).toBe(Date.parse('2026-10-18T22:00:00Z'));
    expect(weekStarter([], 'UTC')(sunday)).toBe(Date.parse('2026-10-12T00:00:00Z'));
  });

  it('labels the week by its Monday, and a window by its start once readings exist', () => {
    expect(weekBucketer([], 'UTC')(sunday)).toBe('2026-10-12');
    expect(weekBucketer([Date.parse('2026-10-22T07:00:00Z')], 'UTC')(sunday)).toBe('2026-10-15T07:00:00.000Z');
  });
});
