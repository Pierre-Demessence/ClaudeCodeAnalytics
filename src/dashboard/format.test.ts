import { describe, expect, it } from 'vitest';

import { formatCountdown } from '@/dashboard/format';

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

  it('falls back to relative days from a day ahead', () => {
    expect(formatCountdown(later(5 * 86_400_000), now)).toBe('in 5 days');
  });
});
