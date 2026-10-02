// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { Settings } from '../core/types.ts';

import { parseManualReading, parseSettingsUpdate } from './api.ts';

const SETTINGS: Settings = { endpointEnabled: true, planHistory: [], throttleMinutes: 15 };
const NOW = Date.parse('2026-10-02T10:00:00Z');

describe('parseSettingsUpdate', () => {
  it('accepts a plan history and the endpoint switch, sorted and normalised', () => {
    const next = parseSettingsUpdate({
      endpointEnabled: false,
      planHistory: [
        { from: '2026-11-01T00:00:00+01:00', plan: 'max5', source: 'manual' },
        { from: '2026-09-01T00:00:00Z', plan: 'pro', source: 'detected' },
      ],
    }, SETTINGS);
    expect(next.endpointEnabled).toBe(false);
    expect(next.planHistory.map(p => p.from)).toEqual(['2026-09-01T00:00:00.000Z', '2026-10-31T23:00:00.000Z']);
    expect(next.throttleMinutes).toBe(15);
  });

  it('rejects invalid values', () => {
    expect(() => parseSettingsUpdate({ endpointEnabled: 'yes' }, SETTINGS)).toThrow();
    expect(() => parseSettingsUpdate({ planHistory: [{ from: 'x', plan: 'pro', source: 'manual' }] }, SETTINGS)).toThrow();
    expect(() => parseSettingsUpdate({ planHistory: [{ from: '2026-01-01', plan: 'team', source: 'manual' }] }, SETTINGS)).toThrow();
  });

  it('ignores unknown fields', () => {
    expect(parseSettingsUpdate({ throttleMinutes: 1 }, SETTINGS)).toEqual(SETTINGS);
  });
});

describe('parseManualReading', () => {
  it('builds a manual snapshot with the reset rounded to the minute', () => {
    expect(parseManualReading({ fiveHour: 12, weekly: 44, weeklyResetsAt: '2026-10-07T20:00:20Z' }, NOW)).toEqual({
      fiveHour: 12,
      source: 'manual',
      ts: '2026-10-02T10:00:00.000Z',
      weekly: 44,
      weeklyResetsAt: '2026-10-07T20:00:00.000Z',
    });
  });

  it('rejects out-of-range or past values', () => {
    expect(() => parseManualReading({ weekly: 101, weeklyResetsAt: '2026-10-07T20:00:00Z' }, NOW)).toThrow();
    expect(() => parseManualReading({ weekly: 10, weeklyResetsAt: '2026-10-01T20:00:00Z' }, NOW)).toThrow();
    expect(() => parseManualReading({ fiveHour: -1, weekly: 10, weeklyResetsAt: '2026-10-07T20:00:00Z' }, NOW)).toThrow();
    expect(() => parseManualReading(null, NOW)).toThrow();
    expect(() => parseManualReading({ weekly: 10, weeklyResetsAt: '2026-10-20T20:00:00Z' }, NOW)).toThrow();
  });
});
