import { describe, expect, it } from 'vitest';

import type { Snapshot } from './types.ts';

import { DAY_MS } from './calibration.ts';
import { snapResets, weekBucketer, weekStarter, weekStartFor } from './weekWindows.ts';

describe('snapResets', () => {
  const reading = (ts: string, weeklyResetsAt: string): Snapshot => ({ source: 'endpoint', ts, weekly: 10, weeklyResetsAt });

  it('gives a reset time up to 2 minutes off the one of its window\'s first reading', () => {
    const readings = [
      reading('2026-10-08T10:00:00Z', '2026-10-14T20:00:00.000Z'),
      reading('2026-10-09T10:00:00Z', '2026-10-14T20:01:00.000Z'),
      reading('2026-10-10T10:00:00Z', '2026-10-14T19:58:00.000Z'),
      reading('2026-10-15T10:00:00Z', '2026-10-21T20:01:00.000Z'),
      reading('2026-10-16T10:00:00Z', '2026-10-21T20:00:00.000Z'),
    ];
    expect(snapResets(readings).map(s => s.weeklyResetsAt)).toEqual([
      '2026-10-14T20:00:00.000Z',
      '2026-10-14T20:00:00.000Z',
      '2026-10-14T20:00:00.000Z',
      '2026-10-21T20:01:00.000Z',
      '2026-10-21T20:01:00.000Z',
    ]);
  });

  it('keeps a reset time 3 minutes off apart', () => {
    const readings = [reading('2026-10-08T10:00:00Z', '2026-10-14T20:00:00.000Z'), reading('2026-10-09T10:00:00Z', '2026-10-14T20:03:00.000Z')];
    expect(snapResets(readings).map(s => s.weeklyResetsAt)).toEqual(['2026-10-14T20:00:00.000Z', '2026-10-14T20:03:00.000Z']);
  });

  it('writes the reset time as the first reading did, and leaves the other readings as they are', () => {
    const readings = [reading('2026-10-08T10:00:00Z', '2026-10-14T20:00:00Z'), reading('2026-10-09T10:00:00Z', '2026-10-14T20:00:00.000Z')];
    const snapped = snapResets(readings);
    expect(snapped.map(s => s.weeklyResetsAt)).toEqual(['2026-10-14T20:00:00Z', '2026-10-14T20:00:00Z']);
    expect(snapped[0]).toBe(readings[0]);
    expect(readings[1]!.weeklyResetsAt).toBe('2026-10-14T20:00:00.000Z');
  });
});

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
