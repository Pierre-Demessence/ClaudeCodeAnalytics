import { describe, expect, it } from 'vitest';

import type { RangeChoice, RangeContext } from './range.ts';

import { DAY_MS } from './calibration.ts';
import { customFromRange, formatRangeQuery, includesNow, parseRangeQuery, rangeDays, rangeLabel, resolveRange, stepRange } from './range.ts';

const iso = (text: string) => Date.parse(text);

/** Monday 19 Oct 2026; the weekly window runs Thursday 15 Oct 07:00 to Thursday 22 Oct 07:00 UTC. */
const ctx: RangeContext = {
  firstMessage: iso('2026-08-03T10:00:00Z'),
  now: iso('2026-10-19T12:00:00Z'),
  resets: [iso('2026-10-08T07:00:00Z'), iso('2026-10-15T07:00:00Z'), iso('2026-10-22T07:00:00Z')],
  timeZone: 'UTC',
};
const preset = (id: Extract<RangeChoice, { kind: 'preset' }>['preset'], back = 0): RangeChoice => ({ back, kind: 'preset', preset: id });
const span = (from: string, to: string) => ({ from: iso(from), to: iso(to) });

describe('resolveRange', () => {
  it('resolves This week to the current weekly window, as the Breakdown does', () => {
    expect(resolveRange(preset('week'), ctx)).toEqual(span('2026-10-15T07:00:00Z', '2026-10-22T07:00:00Z'));
  });

  it('resolves Last 4 weeks to the current window and the 3 before', () => {
    expect(resolveRange(preset('4weeks'), ctx)).toEqual(span('2026-09-24T07:00:00Z', '2026-10-22T07:00:00Z'));
  });

  it('falls back to local Mondays before any reading', () => {
    expect(resolveRange(preset('week'), { ...ctx, resets: [] })).toEqual(span('2026-10-19T00:00:00Z', '2026-10-26T00:00:00Z'));
  });

  it('resolves the month presets to whole local days ending today', () => {
    expect(resolveRange(preset('3months'), ctx)).toEqual(span('2026-07-20T00:00:00Z', '2026-10-20T00:00:00Z'));
    expect(resolveRange(preset('12months'), ctx)).toEqual(span('2025-10-20T00:00:00Z', '2026-10-20T00:00:00Z'));
  });

  it('cuts the day of the month to the shorter month', () => {
    const range = resolveRange(preset('3months'), { ...ctx, now: iso('2026-05-30T12:00:00Z') });
    // Tomorrow is 31 May; 3 months before it is 28 Feb, the month's last day.
    expect(range.from).toBe(iso('2026-02-28T00:00:00Z'));
  });

  it('starts All time on the first message\'s day', () => {
    expect(resolveRange(preset('all'), ctx)).toEqual(span('2026-08-03T00:00:00Z', '2026-10-20T00:00:00Z'));
    expect(resolveRange(preset('all'), { ...ctx, firstMessage: undefined })).toEqual(span('2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z'));
  });

  it('turns a custom range of inclusive days into local midnights', () => {
    expect(resolveRange({ from: '2026-09-01', kind: 'custom', to: '2026-09-30' }, ctx)).toEqual(span('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'));
    const paris = resolveRange({ from: '2026-09-01', kind: 'custom', to: '2026-09-01' }, { ...ctx, timeZone: 'Europe/Paris' });
    expect(paris).toEqual(span('2026-08-31T22:00:00Z', '2026-09-01T22:00:00Z'));
  });

  it('moves a preset into the past by its own length', () => {
    expect(resolveRange(preset('week', 1), ctx)).toEqual(span('2026-10-08T07:00:00Z', '2026-10-15T07:00:00Z'));
    expect(resolveRange(preset('4weeks', 1), ctx)).toEqual(span('2026-08-27T07:00:00Z', '2026-09-24T07:00:00Z'));
    expect(resolveRange(preset('3months', 1), ctx)).toEqual(span('2026-04-20T00:00:00Z', '2026-07-20T00:00:00Z'));
  });
});

describe('resolveRange across a DST change', () => {
  // Without readings the week is Monday to Monday, local; 29 Mar 2026 is the spring-forward Sunday in Paris (a 167-hour week).
  const paris: RangeContext = { firstMessage: iso('2026-01-05T10:00:00Z'), now: iso('2026-03-25T12:00:00Z'), resets: [], timeZone: 'Europe/Paris' };

  it('ends the week at the next local Monday midnight', () => {
    expect(resolveRange(preset('week'), paris)).toEqual(span('2026-03-22T23:00:00Z', '2026-03-29T22:00:00Z'));
  });

  it('chains the weeks around it', () => {
    expect(resolveRange(preset('week', 1), paris)).toEqual(span('2026-03-15T23:00:00Z', '2026-03-22T23:00:00Z'));
    expect(resolveRange(preset('4weeks'), paris).to).toBe(iso('2026-03-29T22:00:00Z'));
  });

  it('counts a custom range by calendar days', () => {
    expect(resolveRange({ from: '2026-03-28', kind: 'custom', to: '2026-03-30' }, paris)).toEqual(span('2026-03-27T23:00:00Z', '2026-03-30T22:00:00Z'));
  });
});

describe('stepRange', () => {
  it('steps a preset back and forth until it ends now', () => {
    expect(stepRange(preset('week'), -1, ctx)).toEqual(preset('week', 1));
    expect(stepRange(preset('week', 2), 1, ctx)).toEqual(preset('week', 1));
    expect(stepRange(preset('week'), 1, ctx)).toBeUndefined();
  });

  it('stops before the first message', () => {
    // The 4 weeks from 30 Jul start before the first message on 3 Aug.
    expect(stepRange(preset('4weeks', 2), -1, ctx)).toBeUndefined();
    expect(stepRange(preset('4weeks', 1), -1, ctx)).toEqual(preset('4weeks', 2));
    expect(stepRange(preset('week'), -1, { ...ctx, firstMessage: undefined })).toBeUndefined();
  });

  it('does not move All time', () => {
    expect(stepRange(preset('all'), -1, ctx)).toBeUndefined();
    expect(stepRange(preset('all'), 1, ctx)).toBeUndefined();
  });

  it('moves a custom range by its length in days', () => {
    const custom: RangeChoice = { from: '2026-09-01', kind: 'custom', to: '2026-09-10' };
    expect(stepRange(custom, -1, ctx)).toEqual({ from: '2026-08-22', kind: 'custom', to: '2026-08-31' });
    expect(stepRange(custom, 1, ctx)).toEqual({ from: '2026-09-11', kind: 'custom', to: '2026-09-20' });
  });

  it('does not step a custom range past today', () => {
    expect(stepRange({ from: '2026-10-10', kind: 'custom', to: '2026-10-17' }, 1, ctx)).toEqual({ from: '2026-10-18', kind: 'custom', to: '2026-10-19' });
  });

  it('refuses next once a custom range includes today', () => {
    expect(stepRange({ from: '2026-10-10', kind: 'custom', to: '2026-10-19' }, 1, ctx)).toBeUndefined();
  });
});

describe('range helpers', () => {
  it('counts calendar days across a DST change', () => {
    const range = resolveRange({ from: '2026-10-24', kind: 'custom', to: '2026-10-26' }, { ...ctx, timeZone: 'Europe/Paris' });
    expect(range.to - range.from).toBe(3 * DAY_MS + 3_600_000);
    expect(rangeDays(range)).toBe(3);
  });

  it('knows whether a range includes now', () => {
    expect(includesNow(resolveRange(preset('week'), ctx), ctx.now)).toBe(true);
    expect(includesNow(resolveRange(preset('week', 1), ctx), ctx.now)).toBe(false);
  });

  it('labels a range by local days', () => {
    expect(rangeLabel(resolveRange(preset('week'), ctx), 'UTC')).toBe('15 Oct – 22 Oct 2026');
    expect(rangeLabel(resolveRange(preset('12months'), ctx), 'UTC')).toBe('20 Oct 2025 – 19 Oct 2026');
    expect(rangeLabel(span('2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z'), 'UTC')).toBe('19 Oct 2026');
  });

  it('builds a custom choice from the days of a range, up to today', () => {
    expect(customFromRange(resolveRange(preset('week'), ctx), ctx)).toEqual({ from: '2026-10-15', kind: 'custom', to: '2026-10-19' });
  });
});

describe('hash query', () => {
  it('round-trips presets, steps back and custom days', () => {
    const choices: RangeChoice[] = [preset('week'), preset('4weeks', 3), preset('all'), { from: '2026-01-31', kind: 'custom', to: '2026-02-28' }];
    for (const choice of choices)
      expect(parseRangeQuery(formatRangeQuery(choice))).toEqual(choice);
    expect(formatRangeQuery(preset('3months'))).toBe('range=3months');
    expect(formatRangeQuery(preset('12months', 2))).toBe('range=12months&back=2');
  });

  it('accepts the leading question mark', () => {
    expect(parseRangeQuery('?range=week')).toEqual(preset('week'));
  });

  it('falls back to nothing for an invalid range', () => {
    for (const query of ['', 'range=decade', 'range=week&back=-1', 'range=week&back=x', 'range=week&back=1.5', 'range=week&back=99999', 'from=2026-02-30&to=2026-03-01', 'from=2026-03-02&to=2026-03-01', 'from=2026-03-01', 'from=2026-3-1&to=2026-03-02', 'to=2026-03-01'])
      expect(parseRangeQuery(query), query).toBeUndefined();
  });
});
