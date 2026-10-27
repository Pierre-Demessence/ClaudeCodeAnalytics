import { describe, expect, it } from 'vitest';

import type { FitSession, FitWeek, PlanFitInput } from './planFit.ts';
import type { FiveHourWindow } from './sessions.ts';
import type { PlanPeriod } from './types.ts';
import type { WeekRow } from './weekHistory.ts';

import { DAY_MS, HOUR_MS, WEEK_MS } from './calibration.ts';
import { bestPlan, buildPlanFitInput, evaluatePlans } from './planFit.ts';

const START = Date.parse('2026-07-10T07:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = HOUR_MS;

function week(i: number, demand: number, extra: Partial<FitWeek> = {}): FitWeek {
  return { cost: 100, demand, estimated: false, floor: demand, hiddenHours: 0, plans: ['max5'], shift: 0, start: iso(START + i * WEEK_MS), ...extra };
}

function session(demand: number, extra: Partial<FitSession> = {}): FitSession {
  return { demand, estimated: false, floor: demand, shift: 0, ...extra };
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

  it('reports the minimums next to the estimates, converted and shifted the same way', () => {
    const input: PlanFitInput = { plan: 'max5', sessions: [], weeks: [week(0, 30), week(1, 80, { floor: 60, shift: 0.5 }), week(2, 200, { floor: 100 })] };
    expect(byPlan(input).max5).toMatchObject({ busiest: 200, busiestFloor: 100, typical: 80, typicalFloor: 60 });
    expect(byPlan(input).pro).toMatchObject({ busiest: 1000, busiestFloor: 500, typical: 400, typicalFloor: 300 });
    // All Opus on Sonnet: the 60 floor of the second week loses half, like its estimate.
    expect(byPlan(input, 1).max5).toMatchObject({ busiest: 200, busiestFloor: 100, typical: 40, typicalFloor: 30 });
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

    it('is too big when never over, the busiest week stays under half and a cheaper plan holds the weeks', () => {
      // On Pro: 50%, 75% and 60%, which fits.
      expect(verdictOf([10, 15, 12])).toBe('tooBig');
    });

    it('fits however roomy when the cheaper plan is too small', () => {
      // On Pro: 150%, 249.5% and 200%, over in every week.
      expect(verdictOf([30, 49.9, 40])).toBe('fits');
    });

    it('is too big next to a cheaper plan that is close, or itself too big', () => {
      // On Pro: 2 of 5 weeks over, close; on Max 20× the busiest week is 6%.
      const { max20, max5, pro } = byPlan({ plan: 'max5', sessions: [], weeks: [24, 22, 10, 12, 15].map((w, i) => week(i, w)) });
      expect([pro!.verdict, max5!.verdict, max20!.verdict]).toEqual(['close', 'tooBig', 'tooBig']);
    });

    it('never calls Pro too big: nothing is cheaper', () => {
      expect(byPlan({ plan: 'max5', sessions: [], weeks: [1, 2, 1].map((w, i) => week(i, w)) }).pro!.verdict).toBe('fits');
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

    it('adds the hidden part of each week at the budget per %', () => {
      // $4.8 per % of Max 5×: the weeks cost $300, $300 and $300 + 40 % × $4.8; the median stays $300.
      const hidden = costs({ weeks: [week(0, 60, { cost: 300 }), week(1, 60, { cost: 300 }), week(2, 100, { cost: 300, floor: 60 })] });
      expect(byPlan(hidden).max5!.apiValueRatio).toBeCloseTo(300 * 52 / 12 / 100);
      const mostly = costs({ weeks: [week(0, 100, { cost: 300, floor: 60 }), week(1, 100, { cost: 300, floor: 60 }), week(2, 60, { cost: 300 })] });
      expect(byPlan(mostly).max5!.apiValueRatio).toBeCloseTo(480 * 52 / 12 / 100);
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
  });

  it('picks the smallest plan that holds the weeks, however roomy', () => {
    // Pro is over in 3 weeks, so Max 5× fits with room to grow and Max 20× is too big.
    const roomy: PlanFitInput = { plan: 'max5', sessions: [], weeks: [week(0, 20), week(1, 30), week(2, 10), week(3, 25)] };
    expect(evaluatePlans(roomy).map(f => f.verdict)).toEqual(['tooSmall', 'fits', 'tooBig']);
    expect(best(roomy)).toBe('max5');
    expect(evaluatePlans({ plan: 'max5', sessions: [], weeks: [week(0, 150), week(1, 150), week(2, 150), week(3, 150), week(4, 30)] }).map(f => f.verdict)).toEqual(['tooSmall', 'tooSmall', 'fits']);
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
    end: iso(startMs + 5 * HOUR),
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
  const base = { plan: 'max5', planHistory: [{ from: iso(START - WEEK_MS), plan: 'max5', source: 'manual' }], sessionWindows: [] } as const;
  /** Three weeks that reached 90% after `hours` and stopped at 100%. */
  const capped = (hours: number, extra: Partial<WeekRow> = {}) => [2, 1, 0].map(i => row(i, { percent: 100, pressureAt: iso(START + i * WEEK_MS + hours * HOUR), pressurePercent: 90, ...extra }));

  it('keeps the finished weeks with a percent, oldest first', () => {
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(3, { inProgress: true }), row(2), row(1, { percent: undefined }), row(0, { percent: 30, shift: undefined })]) });
    expect(input.weeks.map(w => w.start)).toEqual([iso(START), iso(START + 2 * WEEK_MS)]);
    expect(input.weeks[0]).toEqual({ cost: 100, demand: 30, estimated: false, floor: 30, hiddenHours: 0, plans: ['max5'], shift: 0, start: iso(START) });
  });

  it('keeps the plan each week was used on, the current one when a week has none', () => {
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(1), row(0, { plan: 'pro' })]) });
    expect(input.weeks.map(w => w.plans)).toEqual([['pro'], ['max5']]);
  });

  it('keeps a restarted week and the sessions that started in it', () => {
    const input = buildPlanFitInput({
      ...base,
      sessionWindows: [window(START + 2 * HOUR), window(START + WEEK_MS + 2 * HOUR), window(START + 2 * WEEK_MS + 2 * HOUR)],
      weekHistory: history([row(2), row(1, { planChange: true }), row(0)]),
    });
    expect(input.weeks.map(w => w.start)).toEqual([iso(START), iso(START + WEEK_MS), iso(START + 2 * WEEK_MS)]);
    expect(input.sessions).toHaveLength(3);
  });

  it('stops each part of a restarted week at its own pressure point, and adds the parts up', () => {
    const restart = START + WEEK_MS + 3 * DAY_MS;
    const parts = [
      { end: iso(restart), percent: 20, plan: 'pro' as const, planPercent: 100, pressureAt: iso(START + WEEK_MS + DAY_MS), pressurePercent: 18, start: iso(START + WEEK_MS) },
      { end: iso(START + 2 * WEEK_MS), percent: 10, plan: 'max5' as const, planPercent: 10, start: iso(restart) },
    ];
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(2), row(1, { parts, percent: 30, planChange: true }), row(0)]) });
    const restarted = input.weeks[1]!;
    // The first part is read for 1 day then hidden for 2; the second is whole.
    expect(restarted.hiddenHours).toBeCloseTo(48);
    // The pace pools the two plain weeks (50% over 168 h each) and the parts' cutoffs (18% + 10% over 24 h + 96 h).
    const pace = (50 + 50 + 28) / (168 + 168 + 120);
    expect(restarted.demand).toBeCloseTo(28 + 48 * pace);
    expect(restarted).toMatchObject({ estimated: true, floor: 30, plans: ['pro', 'max5'] });
  });

  it('leaves a part before the subscription out of the pace, and counts it hidden', () => {
    const restart = START + 3 * DAY_MS;
    const parts = [
      { end: iso(restart), percent: 20, plan: 'pro' as const, planPercent: 100, start: iso(START) },
      { end: iso(START + WEEK_MS), percent: 10, plan: 'max5' as const, planPercent: 10, start: iso(restart) },
    ];
    const input = buildPlanFitInput({ ...base, subscriptionStart: restart, weekHistory: history([row(2), row(1), row(0, { parts, percent: 30 })]) });
    // The first part's 3 days precede the subscription: hidden, and its 20% is not in the pace.
    expect(input.weeks[0]!.hiddenHours).toBeCloseTo(72);
    const pace = (50 + 50 + 10) / (168 + 168 + 96);
    expect(input.weeks[0]!.demand).toBeCloseTo(Math.max(30, 30 + 72 * pace));
  });

  it('marks a week without a final reading as estimated', () => {
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(0, { percentEstimated: true })]) });
    expect(input.weeks[0]).toMatchObject({ demand: 50, estimated: true, floor: 50 });
  });

  it('keeps the capped 100 of a week that has no pace to fill it with', () => {
    // 90% after 20 h: the weeks hold under 72 h together.
    const input = buildPlanFitInput({ ...base, calibrationK: 0.5, weekHistory: history(capped(10).slice(0, 2)) });
    expect(input.weeks.map(w => [w.demand, w.estimated])).toEqual([[100, false], [100, false]]);
    expect(input.weeks[0]!.hiddenHours).toBeCloseTo(158);
  });

  it('recovers the demand of a steady user whose weeks the limit cut at 90%', () => {
    // 150%/168 h of true demand: 90% is read after 100.8 h, and the last 67.2 h are hidden.
    const input = buildPlanFitInput({ ...base, weekHistory: history(capped(100.8)) });
    for (const week of input.weeks) {
      expect(week.demand).toBeCloseTo(150);
      expect(week).toMatchObject({ estimated: true, floor: 100 });
      expect(week.hiddenHours).toBeCloseTo(67.2);
    }
  });

  it('keeps the final % when it is higher than the estimate', () => {
    // 90% after 150 h; the pooled pace (100 % over 486 h) fills the last 18 h with less than the 10% the week went on to read.
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(2, { percent: 5 }), row(1, { percent: 5 }), row(0, { percent: 100, pressureAt: iso(START + 150 * HOUR), pressurePercent: 90 })]) });
    expect(input.weeks[0]).toMatchObject({ demand: 100, estimated: false, floor: 100 });
  });

  it('starts the hidden time at a weekly-limit hit that came before the pressure point', () => {
    const input = buildPlanFitInput({
      ...base,
      weekHistory: history([row(2), row(1), row(0, { limitHits: [iso(START + 2 * DAY_MS)], percent: 100, pressureAt: iso(START + 3 * DAY_MS), pressurePercent: 91 })]),
    });
    // Observed: 2 + 7 + 7 days at 100 + 50 + 50 %: 200 / 384 h. The hit week is 5 days hidden.
    expect(input.weeks[0]!.hiddenHours).toBeCloseTo(5 * 24);
    expect(input.weeks[0]!.demand).toBeCloseTo(100 + 120 * 200 / 384);
  });

  it('counts the time before the subscription as hidden, and leaves it out of the pace', () => {
    const input = buildPlanFitInput({ ...base, subscriptionStart: START + 5 * DAY_MS, weekHistory: history([row(2, { percent: 50 }), row(1, { percent: 50 }), row(0, { percent: 40 })]) });
    // Week 0: 40% over its last 2 days. The pace is (40 + 50 + 50) / (48 + 168 + 168) h.
    const pace = 140 / 384;
    expect(input.weeks[0]!.hiddenHours).toBeCloseTo(120);
    expect(input.weeks[0]!.demand).toBeCloseTo(40 + 120 * pace);
    expect(input.weeks[1]!.demand).toBe(50);
  });

  it('counts the time before the oldest transcript as hidden in a week estimated from transcripts', () => {
    // Week 0's transcripts start on its day 6: its 10% comes from its last 2 days.
    const partial = row(0, { percent: 10, percentEstimated: true, source: 'estimated', transcriptsFrom: iso(START + 5 * DAY_MS) });
    const input = buildPlanFitInput({ ...base, weekHistory: history([row(2, { percent: 35 }), row(1, { percent: 35 }), partial]) });
    // The pace is (10 + 35 + 35) / (48 + 168 + 168) h.
    expect(input.weeks[0]!.hiddenHours).toBeCloseTo(120);
    expect(input.weeks[0]!.demand).toBeCloseTo(10 + 120 * 80 / 384);
    expect(input.weeks[1]!.demand).toBe(35);
  });

  it('leaves a week without observed time out of the pace', () => {
    // Subscribed at the very end of week 0, which reads 5%: only weeks 1 and 2 (50% over 168 h each) set the pace.
    const input = buildPlanFitInput({ ...base, subscriptionStart: START + WEEK_MS, weekHistory: history([row(2), row(1), row(0, { percent: 5 })]) });
    expect(input.weeks[0]!.demand).toBeCloseTo(5 + 168 * 50 / 168);
  });

  it('counts the rest of a 5-hour session capped inside the observed time as hidden', () => {
    const blocked = window(START + DAY_MS, { cappedAt: iso(START + DAY_MS + 3 * HOUR), capPercent: 100, peak: 100 });
    const input = buildPlanFitInput({ ...base, sessionWindows: [blocked], weekHistory: history([row(2), row(1), row(0)]) });
    expect(input.weeks[0]!.hiddenHours).toBeCloseTo(2);
    // Cap after the cutoff (the week stopped at 90% first) counts for nothing.
    const after = buildPlanFitInput({ ...base, sessionWindows: [blocked], weekHistory: history([row(2), row(1), row(0, { percent: 95, pressureAt: iso(START + HOUR), pressurePercent: 90 })]) });
    expect(after.weeks[0]!.hiddenHours).toBeCloseTo(167);
  });

  it('keeps the readings when the weeks hold too little observed time', () => {
    const input = buildPlanFitInput({ ...base, subscriptionStart: START + 3 * WEEK_MS, weekHistory: history([row(2), row(1), row(0)]) });
    expect(input.weeks.map(w => [w.demand, w.estimated, w.hiddenHours])).toEqual([[50, false, 168], [50, false, 168], [50, false, 168]]);
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
    expect(input.sessions).toEqual([{ demand: 40, estimated: false, floor: 40, shift: 0.1 }, { demand: 40, estimated: true, floor: 40, shift: 0 }]);
  });

  it('converts the peak of a window taken on another plan', () => {
    const input = buildPlanFitInput({
      ...base,
      planHistory: [{ from: iso(START - 2 * WEEK_MS), plan: 'pro', source: 'manual' }, { from: iso(START + 3 * DAY_MS), plan: 'max5', source: 'manual' }],
      weekHistory: history([row(0)]),
      sessionWindows: [
        window(START + DAY_MS, { peak: 50 }),
        window(START + 4 * DAY_MS, { peak: 50 }),
      ],
    });
    // 50% on Pro is 10% on Max 5×.
    expect(input.sessions.map(s => s.demand)).toEqual([10, 50]);
  });

  describe('a window around an upgrade', () => {
    const planHistory: PlanPeriod[] = [{ from: iso(START - 2 * WEEK_MS), plan: 'pro', source: 'manual' }, { from: iso(START + 3 * DAY_MS), plan: 'max5', source: 'manual' }];
    const sessions = (windows: FiveHourWindow[]) => buildPlanFitInput({ ...base, planHistory, sessionWindows: windows, weekHistory: history([row(0)]) }).sessions;

    it('takes the plan the window ended on, although it started before the change', () => {
      // Starts 10 minutes before the upgrade: the usage it read is on Max 5×.
      expect(sessions([window(START + 3 * DAY_MS - 10 * 60_000, { peak: 50 })]).map(s => s.demand)).toEqual([50]);
    });

    it('converts the peak of an estimated window like a read one, from the plan it ran on', () => {
      // 50% of Pro is 10% of Max 5×.
      expect(sessions([window(START + DAY_MS, { peak: 50, peakEstimated: true })]).map(s => s.demand)).toEqual([10]);
    });
  });

  describe('capped sessions', () => {
    const sessions = (windows: FiveHourWindow[]) => buildPlanFitInput({ ...base, sessionWindows: windows, weekHistory: history([row(0)]) }).sessions;
    const calm = [window(START + DAY_MS, { peak: 20 }), window(START + 2 * DAY_MS, { peak: 20 })];
    const cap = (startMs: number, extra: Partial<FiveHourWindow> = {}) => window(startMs, { cappedAt: iso(startMs + 2 * HOUR), capPercent: 100, peak: 100, ...extra });

    it('fills the time after the cap at the typical session pace', () => {
      // (20 + 20 + 100) % over (5 + 5 + 2) h; 3 h hidden.
      const [, , capped] = sessions([...calm, cap(START + 3 * DAY_MS)]);
      expect(capped!.demand).toBeCloseTo(100 + 3 * 140 / 12);
      expect(capped).toMatchObject({ estimated: true, floor: 100 });
    });

    it('starts at the cap\'s own % when a reading at the threshold capped it', () => {
      const [, , capped] = sessions([...calm, cap(START + 3 * DAY_MS, { capPercent: 96, peak: 99 })]);
      // (20 + 20 + 96) / 12 h = 11.33 %/h.
      expect(capped!.demand).toBeCloseTo(96 + 3 * 136 / 12);
    });

    it('caps an estimated window at its hit', () => {
      const [, , capped] = sessions([...calm, cap(START + 3 * DAY_MS, { peak: 60, peakEstimated: true, source: 'estimated' })]);
      expect(capped!.demand).toBeGreaterThan(100);
      expect(capped!.floor).toBe(60);
    });

    it('keeps the peak when the windows hold too little observed time, and for a window that never capped', () => {
      expect(sessions([cap(START + DAY_MS)]).map(s => s.demand)).toEqual([100]);
      expect(sessions([...calm, window(START + 3 * DAY_MS, { peak: 30 })]).map(s => s.demand)).toEqual([20, 20, 30]);
    });

    it('uses the real end of a window cut short', () => {
      const short = window(START + 3 * DAY_MS, { cappedAt: iso(START + 3 * DAY_MS + HOUR), capPercent: 100, end: iso(START + 3 * DAY_MS + 2 * HOUR), peak: 100 });
      // (20 + 20 + 100) % over (5 + 5 + 1) h; 1 h hidden.
      expect(sessions([...calm, short])[2]!.demand).toBeCloseTo(100 + 140 / 11);
    });
  });
});
