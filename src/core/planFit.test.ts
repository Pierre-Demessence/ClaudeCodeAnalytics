import { describe, expect, it } from 'vitest';

import type { FitSession, FitWeek, PlanFitInput } from './planFit.ts';
import type { FiveHourWindow } from './sessions.ts';
import type { WeekRow } from './weekHistory.ts';

import { DAY_MS, WEEK_MS } from './calibration.ts';
import { bestPlan, buildPlanFitInput, evaluatePlans } from './planFit.ts';

const START = Date.parse('2026-07-10T07:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

function week(i: number, demand: number, extra: Partial<FitWeek> = {}): FitWeek {
  return { cost: 100, demand, estimated: false, shift: 0, start: iso(START + i * WEEK_MS), ...extra };
}

function session(demand: number, extra: Partial<FitSession> = {}): FitSession {
  return { demand, estimated: false, shift: 0, ...extra };
}

/** The sample of the design: Max 5× with one week and two sessions over the limit. */
function sample(extra: Partial<PlanFitInput> = {}): PlanFitInput {
  const percents = [41, 55, 63, 47, 118, 72, 58, 66, 49, 84, 62, 77];
  const peaks = [12, 35, 48, 22, 64, 71, 18, 55, 112, 41, 29, 66, 38, 52, 24, 77, 45, 33, 60, 19, 88, 43, 27, 104, 58, 36, 50, 31, 69, 40];
  return {
    plan: 'max5',
    sessions: peaks.map(peak => session(peak, { shift: 0.3 })),
    weeks: percents.map((percent, i) => week(i, percent, { estimated: percent > 100, shift: 0.3 })),
    ...extra,
  };
}

const byPlan = (input: PlanFitInput, share = 0) => Object.fromEntries(evaluatePlans(input, share).map(fit => [fit.plan, fit]));

describe('evaluatePlans', () => {
  it('converts every week and session with the advertised multipliers', () => {
    const { max20, max5, pro } = byPlan(sample());
    expect(max5).toMatchObject({ busiest: 118, sessionsOver: 2, typical: 62.5, weeksOver: 1 });
    expect(pro).toMatchObject({ busiest: 590, typical: 312.5 });
    expect(max20).toMatchObject({ busiest: 29.5, sessionsOver: 0, typical: 15.625, weeksOver: 0 });
  });

  it('lists the weeks over the limit, oldest first', () => {
    expect(byPlan(sample()).max5!.overWeeks).toEqual([iso(START + 4 * WEEK_MS)]);
  });

  it('judges the design sample: Pro too small, Max 5× close, Max 20× too big', () => {
    const { max20, max5, pro } = byPlan(sample());
    expect([pro!.verdict, max5!.verdict, max20!.verdict]).toEqual(['tooSmall', 'close', 'tooBig']);
  });

  it('re-prices with the Opus share moved to Sonnet', () => {
    // 118 × (1 − 0.3) and 112 × (1 − 0.3) both end under the limit.
    const { max5 } = byPlan(sample(), 1);
    expect(max5).toMatchObject({ busiest: 118 * 0.7, sessionsOver: 0, verdict: 'fits', weeksOver: 0 });
    expect(byPlan(sample(), 0.5).max5!.busiest).toBeCloseTo(118 * 0.85);
  });

  it('counts a week or session exactly at 100% as over the limit', () => {
    expect(byPlan({ plan: 'max5', sessions: [], weeks: [week(0, 100)] }).max5!.weeksOver).toBe(1);
    expect(byPlan({ plan: 'max5', sessions: [session(100)], weeks: [week(0, 60)] }).max5!.sessionsOver).toBe(1);
  });

  describe('verdicts', () => {
    const verdictOf = (weeks: number[], sessions: number[] = []) => byPlan({ plan: 'max5', sessions: sessions.map(s => session(s)), weeks: weeks.map((w, i) => week(i, w)) }).max5!.verdict;

    it('fits when never over and the busiest week reaches half the limit', () => {
      expect(verdictOf([30, 50, 40])).toBe('fits');
    });

    it('is too big when never over and the busiest week stays under half', () => {
      expect(verdictOf([30, 49.9, 40])).toBe('tooBig');
    });

    it('is close with 1 or 2 weeks over, too small from 3', () => {
      expect(verdictOf([30, 120, 40, 130])).toBe('close');
      expect(verdictOf([30, 120, 40, 130, 101])).toBe('tooSmall');
    });

    it('is close with sessions over only when few of them are', () => {
      const sessions = Array.from({ length: 20 }, (_, i) => (i < 2 ? 110 : 40));
      expect(verdictOf([60, 70, 80], sessions)).toBe('close');
      expect(verdictOf([60, 70, 80], sessions.map(s => (s === 40 ? 110 : s)))).toBe('tooSmall');
    });
  });

  describe('aPI value per dollar paid', () => {
    const costs = (extra: Partial<PlanFitInput> = {}): PlanFitInput => ({ plan: 'max5', sessions: [], weeklyBudget: 480, weeks: [0, 1, 2].map(i => week(i, 60, { cost: 300 })), ...extra });

    it('counts only the usage that fits under each plan', () => {
      const { max20, max5, pro } = byPlan(costs());
      // A month is 52 / 12 weeks. Pro's limit is a fifth of Max 5×' $480: $96.
      expect(pro!.apiValueRatio).toBeCloseTo(96 * 52 / 12 / 20);
      expect(max5!.apiValueRatio).toBeCloseTo(300 * 52 / 12 / 100);
      expect(max20!.apiValueRatio).toBeCloseTo(300 * 52 / 12 / 200);
    });

    it('is absent without a calibrated budget, and follows the shift', () => {
      expect(byPlan(costs({ weeklyBudget: undefined })).max5!.apiValueRatio).toBeUndefined();
      const shifted = costs({ weeks: [0, 1, 2].map(i => week(i, 60, { cost: 300, shift: 0.5 })) });
      expect(byPlan(shifted, 1).max5!.apiValueRatio).toBeCloseTo(150 * 52 / 12 / 100);
    });
  });
});

describe('bestPlan', () => {
  const best = (input: PlanFitInput, share = 0) => bestPlan(evaluatePlans(input, share)).plan;

  it('prefers a plan that fits', () => {
    expect(best(sample(), 1)).toBe('max5');
  });

  it('prefers close to too big', () => {
    // Max 5× is close; Max 20× is too big and costs more.
    expect(best(sample())).toBe('max5');
    // Pro is over in 3 weeks, so Max 5× is the cheaper of the two too big plans.
    expect(best({ plan: 'max5', sessions: [], weeks: [week(0, 20), week(1, 30), week(2, 10), week(3, 25)] })).toBe('max5');
  });

  it('prefers too big to too small', () => {
    expect(evaluatePlans({ plan: 'max5', sessions: [], weeks: [week(0, 150), week(1, 150), week(2, 150), week(3, 150), week(4, 30)] }).map(f => f.verdict)).toEqual(['tooSmall', 'tooSmall', 'tooBig']);
    expect(best({ plan: 'max5', sessions: [], weeks: [week(0, 150), week(1, 150), week(2, 150), week(3, 150), week(4, 30)] })).toBe('max20');
  });

  it('settles a tie on fewer weeks over, then on price', () => {
    // On Max 20× 400 is exactly 100%, but 100 is only 25%: fewer weeks over than the plans below.
    expect(best({ plan: 'max5', sessions: [], weeks: [400, 400, 400, 400, 100, 100].map((d, i) => week(i, d)) })).toBe('max20');
    expect(best({ plan: 'max5', sessions: [], weeks: [400, 400, 400, 400].map((d, i) => week(i, d)) })).toBe('pro');
  });
});

describe('buildPlanFitInput', () => {
  const row = (i: number, extra: Partial<WeekRow> = {}): WeekRow => ({
    blockedSessions: 0,
    cappedSessions: 0,
    cost: 100,
    days: [],
    end: iso(START + (i + 1) * WEEK_MS),
    messages: 10,
    percent: 50,
    projectCount: 0,
    projects: [],
    sessions: 0,
    shift: 0.2,
    source: 'reading',
    start: iso(START + i * WEEK_MS),
    ...extra,
  });
  const window = (startMs: number, extra: Partial<FiveHourWindow> = {}): FiveHourWindow => ({
    cost: 10,
    end: iso(startMs + 5 * 3_600_000),
    messages: 5,
    peak: 40,
    projects: [],
    shift: 0.1,
    source: 'reading',
    start: iso(startMs),
    ...extra,
  });
  // Newest first, as weekHistory has them.
  const history = (rows: WeekRow[]) => ({ stats: { blocked: 0, hit: 0 }, weeks: rows });
  const base = { limitThreshold: 95, plan: 'max5', planHistory: [{ from: iso(START - WEEK_MS), plan: 'max5', source: 'manual' }], sessionWindows: [], weekLimitThreshold: 98 } as const;

  it('keeps the finished weeks with a percent, oldest first', () => {
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(3, { inProgress: true }), row(2), row(1, { percent: undefined }), row(0, { percent: 30, shift: undefined })]) });
    expect(input.weeks.map(w => w.start)).toEqual([iso(START), iso(START + 2 * WEEK_MS)]);
    expect(input.weeks[0]).toEqual({ cost: 100, demand: 30, estimated: false, shift: 0, start: iso(START) });
  });

  it('marks a week without a final reading as estimated', () => {
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(0, { percentEstimated: true })]) });
    expect(input.weeks[0]).toMatchObject({ demand: 50, estimated: true });
  });

  it('replaces a capped week with the transcript estimate when that is higher', () => {
    const input = buildPlanFitInput({ ...base, calibrationK: 0.5, weekHistory: history([row(1, { cost: 300, hit: true, percent: 100 }), row(0, { cost: 100, hit: true, percent: 100 })]) });
    expect(input.weeks.map(w => [w.demand, w.estimated])).toEqual([[100, false], [150, true]]);
  });

  it('treats a final reading from the threshold as capped, and below it as the demand', () => {
    const input = buildPlanFitInput({ ...base, calibrationK: 0.5, weekHistory: history([row(1, { cost: 300, percent: 97 }), row(0, { cost: 300, percent: 98 })]) });
    expect(input.weeks.map(w => [w.demand, w.estimated])).toEqual([[150, true], [97, false]]);
  });

  it('keeps the capped 100 without a calibration', () => {
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(0, { cost: 300, hit: true, percent: 100 })]) });
    expect(input.weeks[0]).toMatchObject({ demand: 100, estimated: false });
  });

  it('budgets the weekly limit in dollars from the calibration', () => {
    expect(buildPlanFitInput({ ...base, calibrationK: 0.25, weekHistory: history([]) }).weeklyBudget).toBe(400);
    expect(buildPlanFitInput({ ...base, weekHistory: history([]) }).weeklyBudget).toBeUndefined();
    expect(buildPlanFitInput({ ...base, calibrationK: 0, weekHistory: history([]) }).weeklyBudget).toBeUndefined();
  });

  it('keeps the finished 5-hour windows with a peak that started in a kept week', () => {
    const input = buildPlanFitInput({
      ...base,
      weekHistory: history([row(0)]),
      sessionWindows: [
        window(START + DAY_MS, { inProgress: true }),
        window(START + 2 * DAY_MS),
        window(START + 3 * DAY_MS, { peak: undefined }),
        window(START - DAY_MS),
        window(START + 4 * DAY_MS, { peakEstimated: true, shift: undefined }),
        // Starts in a week that has no percent.
        window(START + 8 * DAY_MS),
      ],
    });
    expect(input.sessions).toEqual([{ demand: 40, estimated: false, shift: 0.1 }, { demand: 40, estimated: true, shift: 0 }]);
  });

  it('converts the peak of a window taken on another plan, and estimates a capped one', () => {
    const input = buildPlanFitInput({
      ...base,
      fiveHourK: 2,
      planHistory: [{ from: iso(START - 2 * WEEK_MS), plan: 'pro', source: 'manual' }, { from: iso(START + 3 * DAY_MS), plan: 'max5', source: 'manual' }],
      weekHistory: history([row(0)]),
      sessionWindows: [
        window(START + DAY_MS, { peak: 50 }),
        window(START + 4 * DAY_MS, { capped: true, cost: 70, peak: 100 }),
      ],
    });
    // 50% on Pro is 10% on Max 5×; the capped window's 100% is a lower bound that 2 × $70 beats.
    expect(input.sessions.map(s => [s.demand, s.estimated])).toEqual([[10, false], [140, true]]);
  });
});
