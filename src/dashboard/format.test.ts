import { describe, expect, it } from 'vitest';

import { formatCountdown, formatDuration, formatResets, formatUsd, formatUsdShort } from '@/dashboard/format';

describe('formatCountdown', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const later = (ms: number) => now + ms;

  it('counts hours and minutes under a day', () => {
    expect(formatCountdown(later((4 * 60 + 12) * 60_000), now)).toBe('in 4 h 12 min');
    expect(formatCountdown(later(5 * 60_000), now)).toBe('in 5 min');
  });

  it('rounds up the last partial minute', () => {
    expect(formatCountdown(later(10_000), now)).toBe('in 1 min');
  });

  it('counts days and hours from a day ahead', () => {
    expect(formatCountdown(later((2 * 24 + 23) * 3_600_000), now)).toBe('in 2 d 23 h');
    expect(formatCountdown(later(5 * 86_400_000), now)).toBe('in 5 d');
  });

  it('rounds up the last partial hour', () => {
    expect(formatCountdown(later(86_400_000 + 60_000), now)).toBe('in 1 d 1 h');
  });

  it('falls back to relative wording once past', () => {
    expect(formatCountdown(later(-3 * 3_600_000), now)).toBe('3 hours ago');
  });
});

describe('formatResets', () => {
  // Local times: the dashboard shows resets in the browser's time zone.
  const now = new Date(2026, 9, 2, 12, 0).getTime();

  it('says today for a reset later today', () => {
    expect(formatResets(new Date(2026, 9, 2, 17, 50).getTime(), now)).toBe('today, 17:50');
  });

  it('names the day otherwise', () => {
    expect(formatResets(new Date(2026, 9, 7, 9, 0).getTime(), now)).toBe('Wed 7 Oct, 09:00');
  });
});

describe('formatDuration', () => {
  it('shows hours and minutes, or minutes alone', () => {
    expect(formatDuration((2 * 60 + 10) * 60_000)).toBe('2 h 10 min');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
  });
});

describe('formatUsd', () => {
  it('writes "$", not "US$"', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsdShort(40.4)).toBe('$40');
  });
});
