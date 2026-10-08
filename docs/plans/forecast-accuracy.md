# Forecast accuracy: backtest, pace per model, expected active hours

## Goal

The Overview's "active use left", cap time and limit-hit prediction say how long
the user can work and whether the limit is reached before reset. Today they rest
on one flat pace (`forecast.ts`, `activePace.ts`). This plan makes them depend on
the model used and on when the user actually works, and measures every change
against past data.

```
projected % at reset = used + k × (expected active hours until reset) × (pace per active hour)
```

`k` is the existing calibration. The pace becomes per model family; the active
hours come from a weekday × hour profile. Four stages, shippable separately:
backtest, pace per model, model ratios (2b), schedule profile.

## Acceptance criteria

### Stage 1: backtest

- WHEN `npm run backtest` runs, THE SYSTEM SHALL replay the forecast at past
  instants (every 6 h over the last 8 weeks) using only records and readings
  before each instant, and print per method: the median absolute error of the
  projected % at reset, the share of final values inside [low, high], and the
  precision and recall of "median ≥ limit threshold" against windows that
  actually hit the limit.
- THE SYSTEM SHALL score the weekly and the 5-hour forecasts separately.
- IF a window has no usable final value (no reading near its reset), THEN THE
  SYSTEM SHALL leave it out of the scores and print how many were left out.
- THE SYSTEM SHALL never write to the data dir while backtesting.

### Stage 2: pace per model

- WHEN active time is measured, THE SYSTEM SHALL attribute the gap before each
  message (up to `IDLE_GAP_MS`) to that message's model family.
- THE SYSTEM SHALL compute a $/active hour per family over the last 28 days.
- IF a family has under 2 hours of active time in that period, THEN THE SYSTEM
  SHALL estimate its pace from the pooled pace and the family's price ratio, and
  mark it as low-confidence.
- WHEN a calibration exists, THE SYSTEM SHALL show the active use left per
  family on both limit cards, next to the figure for the usual mix.
- THE SYSTEM SHALL highlight the family of the latest message.
- THE SYSTEM SHALL carry no meaning by color alone: each family keeps its
  existing pattern and label.
- WHILE no calibration exists, THE SYSTEM SHALL show no active time left, as today.

### Stage 2b: model ratios

- WHEN two families both have a pace that is not low-confidence, THE SYSTEM SHALL
  show how many hours on one equal one hour on the other ("1 h Opus ≈ 2.6 h
  Sonnet"), with a range.
- THE SYSTEM SHALL compute the range as the 10th–90th percentile of the ratio
  over a seeded bootstrap of the active days, so results are repeatable.
- WHERE both families were used on enough of the same days, THE SYSTEM SHALL
  compare only those days; otherwise it SHALL use all days and mark the ratio
  low-confidence.
- IF either family lacks enough data, THEN THE SYSTEM SHALL show no ratio.
- THE SYSTEM SHALL split each ratio into price per token × tokens per active
  hour, so it shows whether a model drains the limit faster because it costs
  more or because it produces more.
- THE SYSTEM SHALL word the ratio as a property of the user's usage ("in your
  usage"), not of the models, since the work given to each model differs.

### Stage 3: expected active hours

- THE SYSTEM SHALL build a weekday × hour profile of active time in the user's
  time zone from the last 8 weeks.
- WHEN the forecast needs the time to reset, THE SYSTEM SHALL use the expected
  active hours between now and the reset (the current hour pro-rata) instead of
  wall-clock time.
- WHEN a calibration exists, THE SYSTEM SHALL compute the cap time by walking the
  profile forward until the active hours cover the dollars left.
- THE SYSTEM SHALL derive low/median/high by enumerating the past weeks' active
  hours for the same remaining slice × the daily paces, not by applying a
  percentile day to every remaining day.
- IF fewer than 3 weeks of history exist, THEN THE SYSTEM SHALL fall back to the
  flat pace.
- IF the backtest does not show a lower median absolute error than the flat
  method on the weekly forecast, THEN stage 3 SHALL NOT ship; its code is deleted
  and the finding goes to `docs/decisions.md`.

## Design

**Where.** `src/core/` stays pure. New: `activeTime.ts` (the active-gap walk,
extracted from `activeHourlyPace`, now returning active ms per family),
`schedule.ts` (the profile and the walk), `backtest.ts` (replay and scoring, takes
a summarize function). `activePace.ts` keeps `IDLE_GAP_MS` and `activeTimeLeft`.
`familyOf` moves from `dashboard/models.ts` to `core/` because core cannot import
dashboard code; importers are updated, no re-export. The entry is
`src/collector/backtest/cli.ts` (console output is allowed only in `cli.ts`),
run through a `backtest` npm script like the collector, under Node type
stripping.

**Active time per family.** One timeline across sessions, as today. For each
message the preceding gap (≤ 15 min) is added to its family's active ms; its cost
to the family's cost. Pace = cost / active hours. Measured rather than scaled by
price: Opus can run slower per message, so the ratio of prices is not the ratio
of paces. The price ratio is only the fallback for thin data.

**Mix.** The "usual mix" headline uses each family's share of active time over
the last 14 days: pace_mix = Σ share_f × pace_f. Per-family figures answer "if I
only use X".

**Model ratios (2b).** The ratio of two families' paces from stage 2. Its
price-per-token part comes from the price table (input/output blend at the
family's observed token mix); the rest is the ratio of tokens per active hour.
The range is a bootstrap over active days with a small seeded PRNG
(deterministic). Shown as one line on the limit cards and as a table (price,
tokens per hour, hours per hour) on the Breakdown tab, next to the existing
Opus-to-Sonnet what-if, which re-prices the same tokens and so measures a
different thing. Selection bias (harder work goes to Opus) is stated in the UI.

**Schedule profile.** 7 × 24 buckets of mean active ms per week over 8 weeks,
bucketed by local weekday and hour (DST-safe, as `dayKey`). A gap is credited to
the bucket of the later message. Expected active hours to reset sum the buckets
from now to reset. The 5-hour window uses the same profile.

**Range.** For the weekly window, each past week gives the active hours of the
same remaining slice; paired with each of the last 28 daily paces this gives a
deterministic set of projections whose 25th/50th/75th percentiles are
low/median/high. No random sampling, so tests and the backtest are repeatable.
The uncertainty in `k` is out of scope (backlog).

**Forecast method.** `WindowForecast.method` gains `'scheduled'`; the flat
`'calibrated'` path stays as the fallback and as the backtest's baseline.

**Data.** No new stored fields and no `SCAN_FORMAT` bump: model, timestamp and
cost are already in every record. No change to persisted data.

**Failure modes.** Unpriced model: cost 0, no pace for that family (existing
behavior). No messages in the period: no profile, flat fallback. Pace 0 or `k`
missing: no value, never an infinite time left.

**Backtest ground truth.** Weekly: the last reading of the week (or the "est."
value of `weekHistory.ts`). 5-hour: the window's peak (`sessions.ts`). A limit
hit is as `weekHistory` and `sessions` already define it (thresholds 98 / 95).

**Risks.** Replaying `buildSummary` ~200 times over a year of records may be slow;
if so, build the cost index once and pass it in. The schedule profile may not beat
the flat pace for irregular hours; that is why stage 3 is gated on the backtest.

## Checklist

### Stage 1: backtest

- [ ] Baseline: run lint, test and build; note existing warnings
- [ ] `core/backtest.ts` with tests (synthetic records and readings, known errors)
- [ ] `collector/backtest/cli.ts` and the `backtest` npm script, read-only
- [ ] Run on the real data; record the baseline scores in the final report

### Stage 2: pace per model

- [ ] Move `familyOf` (and its test) to `core/`, update importers
- [ ] `core/activeTime.ts`: active ms and cost per family, with tests (gaps, idle, parallel sessions, unpriced model)
- [ ] Per-family pace, thin-data fallback and mix, with tests
- [ ] `summary.ts`: expose per-family active time left on both limit cards
- [ ] `Overview.tsx`: per-family hours, current family highlighted, pattern + label, `InfoTip` for the fallback; update `Overview.test.tsx`
- [ ] Backtest unchanged or better; check in the browser

### Stage 2b: model ratios

- [ ] `core/modelRatio.ts`: pairwise ratio, same-day pairing, seeded bootstrap range, price × volume split, with tests (known ratios, thin data, no overlap days)
- [ ] `summary.ts` exposes the ratios; Overview line and Breakdown table, with `InfoTip` on the bias and the split; tests
- [ ] Check in the browser

### Stage 3: expected active hours (gated on the backtest)

- [ ] `core/schedule.ts`: profile, expected hours, forward walk, with tests (DST, partial hour, short history)
- [ ] `forecast.ts`: `'scheduled'` method and the enumerated range; flat path kept
- [ ] Backtest: scheduled vs flat; decide ship or delete
- [ ] `summary.ts` and Overview wiring (cap time, limit-hit text)

### Docs

- [ ] `AGENTS.md`: layout (new modules, backtest command)
- [ ] `docs/decisions.md`: pace measured per model, not scaled; schedule profile outcome
- [ ] `docs/backlog.md`: delete "Weekday-aware daily usage" and the bootstrap item if stage 3 ships
- [ ] Delete this plan in the final commit, naming its path in the message

Status: not started; awaiting approval.
