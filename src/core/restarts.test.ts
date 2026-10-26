import { describe, expect, it } from 'vitest';

import type { PlanPeriod, Snapshot } from './types.ts';

import { endedPartPercent, partStartOf, windowParts } from './restarts.ts';

const RESET = '2026-10-28T20:00:00.000Z';
const RESET_MS = Date.parse(RESET);
const START_MS = RESET_MS - 7 * 86_400_000;

function snap(ts: string, weekly: number, weeklyResetsAt = RESET): Snapshot {
  return { source: 'endpoint', ts, weekly, weeklyResetsAt };
}

const pro: PlanPeriod = { from: '2026-09-01T00:00:00Z', plan: 'pro', source: 'detected' };
const max5From = (from: string): PlanPeriod => ({ from, plan: 'max5', source: 'manual' });
const iso = (ms: number) => new Date(ms).toISOString();

describe('windowParts', () => {
  it('keeps a window without a drop whole', () => {
    const parts = windowParts([snap('2026-10-23T10:00:00Z', 10), snap('2026-10-24T10:00:00Z', 30)], [pro]).get(RESET_MS)!;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ end: RESET_MS, plan: 'pro', start: START_MS });
    expect(parts[0]!.readings).toHaveLength(2);
  });

  it('has no entry for a window without readings', () => {
    expect(windowParts([], [pro]).size).toBe(0);
  });

  it('splits at the later reading when the % drops by 2 points', () => {
    const parts = windowParts([snap('2026-10-23T10:00:00Z', 40), snap('2026-10-23T12:00:00Z', 38)], [pro]).get(RESET_MS)!;
    expect(parts.map(p => [p.start, p.end])).toEqual([[START_MS, Date.parse('2026-10-23T12:00:00Z')], [Date.parse('2026-10-23T12:00:00Z'), RESET_MS]]);
    expect(parts.map(p => p.readings.length)).toEqual([1, 1]);
  });

  it('does not split on a drop of 1 point', () => {
    expect(windowParts([snap('2026-10-23T10:00:00Z', 40), snap('2026-10-23T12:00:00Z', 39)], [pro]).get(RESET_MS)).toHaveLength(1);
  });

  it('splits at the plan change between the two readings (the real upgrade)', () => {
    const history = [pro, max5From('2026-10-26T16:27:00Z')];
    const parts = windowParts([snap('2026-10-26T16:16:00Z', 100), snap('2026-10-26T16:28:00Z', 0)], history).get(RESET_MS)!;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ plan: 'pro' });
    expect(parts[1]).toMatchObject({ plan: 'max5', start: Date.parse('2026-10-26T16:27:00Z') });
    expect(parts[0]!.readings.map(r => r.weekly)).toEqual([100]);
    expect(parts[1]!.readings.map(r => r.weekly)).toEqual([0]);
  });

  it('splits at an upgrade before the first reading, with an empty first part on the old plan', () => {
    const history = [pro, max5From('2026-10-26T16:27:00Z')];
    const parts = windowParts([snap('2026-10-26T17:00:00Z', 3)], history).get(RESET_MS)!;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ end: Date.parse('2026-10-26T16:27:00Z'), plan: 'pro', readings: [] });
    expect(parts[1]).toMatchObject({ plan: 'max5' });
  });

  it('does not split at a downgrade before the first reading, nor at a plan change without a drop', () => {
    const down: PlanPeriod[] = [{ ...pro, plan: 'max5' }, { from: '2026-10-26T16:27:00Z', plan: 'pro', source: 'manual' }];
    expect(windowParts([snap('2026-10-26T17:00:00Z', 3)], down).get(RESET_MS)).toHaveLength(1);
    const up = [pro, max5From('2026-10-26T16:27:00Z')];
    const parts = windowParts([snap('2026-10-26T10:00:00Z', 10), snap('2026-10-26T17:00:00Z', 12)], up).get(RESET_MS)!;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ plan: 'max5' });
  });

  it('gives two restarts three parts, and puts a reading at a split time in the later part', () => {
    const readings = [snap('2026-10-23T10:00:00Z', 50), snap('2026-10-24T10:00:00Z', 10), snap('2026-10-25T10:00:00Z', 20), snap('2026-10-26T10:00:00Z', 5)];
    const parts = windowParts(readings, [pro]).get(RESET_MS)!;
    expect(parts.map(p => p.readings.map(r => r.weekly))).toEqual([[50], [10, 20], [5]]);
  });

  it('sorts its own copy of the readings', () => {
    const readings = [snap('2026-10-24T10:00:00Z', 10), snap('2026-10-23T10:00:00Z', 50)];
    const copy = [...readings];
    const parts = windowParts(readings, [pro]).get(RESET_MS)!;
    expect(parts).toHaveLength(2);
    expect(readings).toEqual(copy);
  });

  it('groups readings by their reset time', () => {
    const other = '2026-10-21T20:00:00.000Z';
    const parts = windowParts([snap('2026-10-20T10:00:00Z', 80, other), snap('2026-10-23T10:00:00Z', 5)], [pro]);
    expect([...parts.keys()].sort()).toEqual([Date.parse(other), RESET_MS].sort());
  });
});

describe('partStartOf', () => {
  it('returns the start of the reading\'s part, and the window start for an unknown window', () => {
    const readings = [snap('2026-10-23T10:00:00Z', 50), snap('2026-10-24T10:00:00Z', 10)];
    const startOf = partStartOf(windowParts(readings, [pro]));
    expect(startOf(readings[0]!)).toBe(START_MS);
    expect(startOf(readings[1]!)).toBe(Date.parse('2026-10-24T10:00:00Z'));
    expect(startOf(snap('2026-10-10T10:00:00Z', 5, '2026-10-14T20:00:00.000Z'))).toBe(Date.parse('2026-10-07T20:00:00.000Z'));
  });
});

describe('endedPartPercent', () => {
  const part = { end: START_MS + 1000, plan: 'pro' as const, readings: [] as Snapshot[], start: START_MS };

  it('takes the last reading', () => {
    const withReadings = { ...part, readings: [snap(iso(START_MS + 10), 40), snap(iso(START_MS + 20), 100)] };
    expect(endedPartPercent(withReadings, () => 999, undefined)).toEqual({ percent: 100, plan: 'pro', start: iso(START_MS) });
  });

  it('estimates from the cost on the calibration, converted to the part\'s plan and capped', () => {
    expect(endedPartPercent(part, () => 10, { k: 1, plan: 'max5' })).toEqual({ estimated: true, percent: 50, plan: 'pro', start: iso(START_MS) });
    expect(endedPartPercent(part, () => 100, { k: 10, plan: 'max5' }).percent).toBe(100);
  });

  it('is 0, estimated, without a calibration', () => {
    expect(endedPartPercent(part, () => 10, undefined)).toEqual({ estimated: true, percent: 0, plan: 'pro', start: iso(START_MS) });
  });
});
