# Uncapped demand: estimate the usage a limit hid

## Goal

The Plans tab compares plans from each finished week's final % and each 5-hour
session's peak. A week or session that hit the limit stopped there, so its % is
only a minimum: on a capped Pro week, Max 5× always reads "≤ 20%". This plan
replaces the hidden part of each week and session with the user's typical pace,
so the comparison shows what a bigger plan would have held.

```
estimate = max(reading, % at the cutoff + hidden hours × typical %/hour)
```

## Acceptance criteria

### Weeks

- WHEN a finished week's % reaches the pressure point (`PRESSURE_PERCENT`, 90%
  of the limit of the plan active then), THE SYSTEM SHALL treat the time from
  that moment to the week's end as hidden.
- WHEN the transcripts hold a weekly-limit hit before the pressure point is read,
  THE SYSTEM SHALL start the hidden time at that hit.
- WHEN a week started before the subscription (`status.subscriptionStartedAt`),
  THE SYSTEM SHALL treat the time from the week's start to the subscription as
  hidden.
- WHEN a 5-hour session is capped inside a week's observed time, THE SYSTEM
  SHALL count the time from its cap to its end as hidden for that week too.
- THE SYSTEM SHALL compute the typical weekly pace as the sum of each week's %
  at its cutoff divided by the sum of its observed hours, over the finished
  weeks of the comparison, so idle days count toward it.
- THE SYSTEM SHALL estimate each week as
  `max(final %, % at cutoff + hidden hours × typical pace)`, and keep the final
  % as its minimum.
- IF the comparison weeks hold under `MIN_OBSERVED_WEEK_HOURS` (72 h) of
  observed time, THEN THE SYSTEM SHALL use the final % alone, as today.
- WHEN a week was estimated from transcripts (no reading), THE SYSTEM SHALL find
  its pressure point where `k × cost so far` reaches 90%.

### 5-hour sessions

- WHEN a finished session is capped (first reading at the limit threshold, or a
  5-hour limit hit, whichever is earlier), THE SYSTEM SHALL treat the time from
  the cap to the window's end as hidden.
- THE SYSTEM SHALL compute the typical session pace as the sum of each session's
  % at its cap (its peak when never capped; 100% at a hit) divided by the sum of
  its observed hours.
- THE SYSTEM SHALL estimate each capped session as
  `max(peak, % at cap + hidden hours × typical session pace)`.
- IF the sessions hold under `MIN_OBSERVED_SESSION_HOURS` (10 h) of observed
  time, THEN THE SYSTEM SHALL use the peak alone.

### Plan comparison

- THE SYSTEM SHALL compute every verdict, typical week, busiest week, weeks over
  and sessions over from the estimates.
- THE SYSTEM SHALL compute the API value per dollar from estimated weekly costs:
  `cost + (estimate − final %) × weekly budget / 100`.
- THE SYSTEM SHALL no longer raise a capped week or session with `k × cost`: that
  cost stopped at the same limit and only repeats the reading.

### Display

- WHEN a plan card's typical or busiest week differs from its minimum, THE
  SYSTEM SHALL show the estimate with "≈" and the minimum as "at least N%"
  under it.
- THE SYSTEM SHALL draw each chart bar solid up to the minimum and hatched from
  the minimum to the estimate; the over-the-limit color and warning icon follow
  the estimate.
- WHEN a bar's estimate holds hidden time, THE SYSTEM SHALL say in its tooltip
  the minimum and how many days were hidden and filled at the typical pace.
- THE SYSTEM SHALL explain the estimate once, in an `InfoTip` next to the
  chart's subtitle.
- THE SYSTEM SHALL carry no meaning by color alone: solid versus hatched, the
  "≈"/"at least" text and the warning icon carry it.

## Design

### Where each piece is computed

- `weekHistory.ts`: `WeekRow` gains `pressureAt?: string` (ISO) and
  `pressurePercent?: number` (current plan). From the first snapshot of the
  window whose raw `weekly` reaches `PRESSURE_PERCENT`, converted with the
  window's share plan; for an estimated week, from the message at which
  `calibrationK × running cost` reaches it. The loop over records already
  builds each week's cost.
- `sessions.ts`: `FiveHourWindow` gains `cappedAt?: string` and
  `capPercent?: number`. The earlier of the first snapshot at `limitThreshold`
  (its value) and the first hit (100).
- `planFit.ts`: `buildPlanFitInput` gains `subscriptionStart?: number` (already in
  the summary input) and computes, per week, observed and hidden hours, the
  pooled weekly pace and the estimate; the same for sessions with their own pace.
  `PRESSURE_PERCENT`, `MIN_OBSERVED_WEEK_HOURS` and `MIN_OBSERVED_SESSION_HOURS`
  are named constants there.
- `FitWeek` gains `floor` (the final %) and `hiddenHours`; `demand` becomes the
  estimate, `estimated` stays `percentEstimated || demand > floor`. `FitSession`
  gains `floor`. `PlanFit` gains `typicalFloor` and `busiestFloor`.
- `plansData.ts`, `PlanFitCards.tsx`, `FitChart.tsx`: the display above.

### Per week

```
observedStart = max(weekStart, subscriptionStart)
cutoff        = min(pressureAt, first weekly hit, weekEnd)
blocked       = Σ (window end − cappedAt) over capped sessions in [observedStart, cutoff)
observed      = cutoff − observedStart − blocked
hidden        = (observedStart − weekStart) + (weekEnd − cutoff) + blocked
cutoffPercent = pressurePercent when the week crossed it, else the final %
```

Typical pace = Σ cutoffPercent / Σ observed. The usage after the pressure point
is left out of the pace: it is the slowed tail the estimate replaces.

On the local data (k = 0.34 %/$, Pro): about 1.0 %/hour (24%/day). Week of
23 Sep: 71.5% → ≈ 190% (subscribed 28 Sep). Week of 30 Sep: 99% → ≈ 200%
(90% read 3 Oct 11:55, 4.3 days blocked). Week of 7 Oct: 100% → ≈ 115%. On
Max 5×: about 38%, 40% and 23% instead of 14%, 20% and 20%.

### Edge cases

- A week with no observed time (subscribed at its very end) adds nothing to the
  pace; its estimate is its % plus the hidden time at the pace.
- A plan change between weeks: the pressure point is judged on the plan active
  at the reading (that is what the user saw), the pace on the current plan.
- A session window cut short by a reading window (`end < start + 5 h`) uses its
  real end.
- The Opus-to-Sonnet `shift` applies to the estimate as it does today.
- Weeks and sessions without a cap keep their reading: estimate = minimum.

### Rejected

- **The week's own pre-cap pace** to fill the hidden time: it assumes the user
  keeps working at full speed through holidays and weekends. It would be an upper
  bound; deferred to the backlog.
- **A model of how pace drops near the limit**: it needs many weeks to tell
  slowing down from a quiet week; with 3 weeks it fits noise. In the backlog.
- **A setting for the pressure point**: a fixed 90% until real data says
  otherwise.

## Checklist

- [x] Baseline: `npm run lint`, `npm test`, `npm run build`; note warnings
- [x] `sessions.ts`: `cappedAt`, `capPercent`, with tests (reading first, hit first, estimated window with a hit)
- [x] `weekHistory.ts`: `pressureAt`, `pressurePercent`, with tests (reading crossing, estimated week crossing by cost, never crossed, plan conversion)
- [x] `planFit.ts`: observed and hidden time, pooled paces, estimates, `floor`, minimum-data fallback; drop the `k × cost` raise; tests including a steady synthetic week cut at 90% that the estimate recovers
- [x] `evaluatePlans`: estimates drive verdicts, `typicalFloor`, `busiestFloor`, estimated API value
- [x] `summary.ts`: pass `subscriptionStart`
- [x] `plansData.ts`: card texts, two-part bars, tooltips; tests
- [x] `PlanFitCards.tsx`, `FitChart.tsx`, `styles.css`: "≈"/"at least", solid + hatched bar, `InfoTip`; light and dark
- [x] Docs: replace the weekly-threshold sentence in `docs/decisions.md` ("Only the Weeks tab's hit and the Plans tab's demand…") and add the uncapped-demand decision; README if its Plans line needs it
- [x] Lint, test, build; check the Plans tab in a browser (both themes)
- [x] Peer review
