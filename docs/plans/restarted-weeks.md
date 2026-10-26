# Restarted weeks: split a weekly window where its usage restarts

## Goal

Anthropic can restart the weekly usage before the reset time: on an upgrade (seen at
the Pro to Max 5× switch, 100% to 0% with the same reset time) or as a free reset.
The dashboard reads every weekly window as one block from its start, so it drops a
week holding a plan change from every statistic and misreads a week with a free
reset. This plan splits a window where its usage restarted into parts, compares each
part's % with the usage since that part began, and adds the parts up for the week: no
week is lost, and the Overview's projection and pacing start again from the restart.

## Acceptance criteria

### Restarts

- WHEN a reading is 2 points or more below the previous reading of its weekly
  window, THE SYSTEM SHALL split the window between the two readings: at the latest
  plan change between them, else at the later reading.
- WHEN an upgrade (a plan with a larger advertised limit) starts inside a weekly
  window before its first reading, THE SYSTEM SHALL split the window at the upgrade.
- WHILE a plan change shows no such drop and is not an upgrade before the window's
  first reading, THE SYSTEM SHALL keep the window whole.
- THE SYSTEM SHALL put each reading in the last part starting at or before it, and
  give a part the plan of its last reading (of its start when it has none).

### Fits

- WHEN fitting the weekly ratio (pooled or the week's own), THE SYSTEM SHALL count
  each reading's cost from the start of its part, keep restarted windows, and skip
  only the parts that started before the first stored message.
- WHEN computing the limit drift for a plan, THE SYSTEM SHALL give each window one
  ratio from its parts on that plan (their Claude Code % added up over their cost
  added up), drawn when their % add up to 10 or more.
- THE multiplier check SHALL count the window of a plan change on each plan, from
  that plan's parts.

### Borrowed fit

- IF the current plan has no fit of its own (under 3 readings of 5% or more), THEN
  THE SYSTEM SHALL use the fit of the most recent other plan that has one, converted
  at the advertised multipliers, for the weekly and the 5-hour fits.
- WHILE a fit is borrowed, THE Fit card SHALL say so and name the plan it comes from.
- WHEN the current plan has a fit of its own, THE SYSTEM SHALL use it.

### Current week

- WHILE the current window has restarted, THE SYSTEM SHALL count the forecast's own
  pace and its 3-day blend, the trend and the spend per day from the restart, and
  scale the typical week to the share of the window left after the restart.
- WHILE the current window has restarted, THE pacing chart SHALL keep the 7-day
  axis; draw each earlier part on its own plan's %, as a thinner grey line ending at
  its last reading; mark the restart with a labelled vertical line ("Max 5× from Mon
  17:27" after a plan change, "usage reset Mon 17:27" otherwise); start the actual
  line and the even pace at 0 at the restart; and list the earlier part in the legend.
- THE chart SHALL tell the earlier part apart by line weight, label and legend, never
  by color alone.
- WHILE the current window never restarted, THE chart and the forecast SHALL be
  unchanged.

### Week totals

- WHEN a window restarted, THE SYSTEM SHALL take its week % as the sum of its parts'
  final %, each converted to one plan (the last part's in the weekly shares, the
  current plan on the Weeks tab); only the last part is extended to the reset when
  its last reading is early.
- THE typical week, the Weeks tab's median peak and the plan comparison SHALL include
  restarted weeks.
- WHEN any part of a window ended with a reading at or above the weekly limit
  threshold of its own plan, THE SYSTEM SHALL count the week as having hit the limit.
- WHEN the plan comparison estimates a restarted week, THE SYSTEM SHALL split its
  observed and hidden time per part, each with its own pressure point and limit hits;
  a week in one part SHALL give the same numbers as before.
- THE Weeks tab SHALL mark a restarted week with an icon and a tooltip listing its
  parts (plan, start, % of its own plan): the plan-change icon after a plan change, a
  reset icon otherwise.
- WHILE the current window has restarted, ITS Weeks row SHALL add the earlier parts
  to the current %.

### 5-hour windows

- WHEN a 5-hour reading window starts before the previous one ends, THE SYSTEM SHALL
  end the previous one at that start.
- WHEN the plan comparison converts a 5-hour window's peak, THE SYSTEM SHALL take the
  plan active at the window's end, and SHALL NOT convert an estimated window's peak,
  which is already on the current plan.

### Backtest

- THE backtest SHALL NOT score a weekly forecast made before a later restart of its
  window.

## Design

**Where.** New `src/core/restarts.ts` (pure): the split. `plans.ts` gains
`planChanges`. The rest adapts: `calibration.ts`, `summary.ts`, `limits.ts`,
`share.ts`, `weekHistory.ts`, `planFit.ts`, `forecast.ts`, `pacing.ts`, `sessions.ts`,
`backtest.ts`; in the dashboard `PacingChart.tsx`, `Weeks.tsx`, `weeksData.ts`,
`FitCard.tsx`, `DriftCard.tsx`, `styles.css`. `ranged.ts` needs no change: the parts
travel in `current` and `shares`.

**Evidence.** In 954 readings (from 2026-10-02), a window's weekly % dropped once:
100 to 0 at the upgrade, between 16:16 and 16:28 UTC on 2026-10-26, with the manual
Max 5× period from 16:27; the reset time stayed 2026-10-28T20:00Z. The 5-hour reset
moved from 19:20 to 21:20, so the new 5-hour window starts at 16:20, before the
upgrade; it is the only overlap of two 5-hour reading windows in 60.

**Restarts.**

```ts
/** A reading this many points under the previous one of its window marks a restart. */
export const RESTART_DROP = 2;
export interface WindowPart { end: number; plan: Plan; readings: Snapshot[]; start: number }
export interface PartPercent { estimated?: true; percent: number; plan: Plan; start: string }
/** Each weekly window with readings, by reset time (ms), split at its restarts; parts oldest first. */
export function windowParts(snapshots: readonly Snapshot[], planHistory: readonly PlanPeriod[]): Map<number, WindowPart[]>;
/** Where a reading's cost counts from: the start of its part. */
export function partStartOf(parts: ReadonlyMap<number, readonly WindowPart[]>): (snapshot: Snapshot) => number;
/** The final % of a part that ended at a restart, on its own plan. */
export function endedPartPercent(part: WindowPart, costBetween: (from: number, to: number) => number, calibration: { k: number; plan: Plan } | undefined): PartPercent;
```

`planChanges(history)` (`plans.ts`) lists `{ at, from, to }` for each period whose
plan differs from the one before (the first period is no change); `planChangeWithin`
is rewritten on it, same behavior.

`windowParts` sorts its own copy, groups readings by `Date.parse(weeklyResetsAt)`,
and per window `[start = reset − WEEK_MS, reset)` collects restart times:

1. for consecutive readings a, b with `b.weekly ≤ a.weekly − RESTART_DROP`: the
   latest `planChanges` time in `(a.ts, b.ts]`, else `b.ts`;
2. for each upgrade (`PLAN_MULTIPLIERS[to] > PLAN_MULTIPLIERS[from]`) at `t` with
   `start < t < reset` and the window's first reading at or after `t`: `t`. It cannot
   show as a drop, and an upgrade restarts the usage.

Parts run between consecutive restart times (sorted, deduplicated). A reading belongs
to the last part whose start is at or before it, so a stays in the earlier part and b
goes to the later one. A part's plan is `planAt` of its last reading, else of its
start. A window without a restart is one part; a window without readings is not in
the map, and consumers treat it as one part without readings. `partStartOf` returns
the start of a reading's part (the window start when its window is absent).
`endedPartPercent` is the part's last reading; without one, `min(100,
convertPercent(k × cost(start, end), calibration.plan, part.plan))`, estimated, or 0,
estimated, without a calibration.

Two points: utilization comes in whole percents and only grows inside a window, so a
smaller drop is noise and costs under 2 points if it was a restart. The later reading
when no plan change explains the drop: readings come about every 15 minutes while
Claude Code runs, so either end of the gap gives about the same cost.

A plan change without a restart keeps the window whole: each reading keeps its own
plan, and a reading on the new plan counts from the window start, which matches a %
covering the whole week on the new plan.

**Fits.** `calibrationPoints(snapshots, costBetween, dataStart, startOf = windowStart)`:
the cost and the data-start check both use `startOf(s)` (a part that started after
the first stored message has complete costs even when its window did not).
`prepareSummary` computes `parts = windowParts(snapshots, planHistory)` and
`startOf` once. The pooled fit drops `wholeWeekSnapshots`, the week's own fit drops
the `planChanged` exclusion, and both pass `startOf`; the current-plan filter stays.

**Drift and multipliers.** `driftWindows` calls `windowParts` on
`LimitsInput.snapshots` (no new input). Per window: the parts on `onPlan` with
readings and `start ≥ dataStart`; `weekly = Σ last.weekly`, `usage = Σ last.weekly ×
(claudeCodeShare ?? 100) / 100`, `cost = Σ costBetween(part.start, last.ts)`; skipped
when `weekly < MIN_PERCENT_FOR_DRIFT` or `cost ≤ 0`; `claudeCode = usage / weekly ×
100`; `ratio = usage / cost × 100`; `DriftWindow.from?` (ISO) is the first counted
part's start when it is after the window start. A free-reset week on one plan keeps
the meaning of a whole week (all its % over all its cost). `buildMultipliers` is
unchanged: each plan's drift holds the switch window from its own parts.

**Borrowed fit.** `Calibration.borrowedFrom?: Plan`. In `prepareSummary`,
`fitOn(onPlan)` and `fiveHourFitOn(onPlan)` fit the readings taken on a plan. When the
current plan's is undefined, the other plans of `planHistory` are tried, most recent
period first, and the first fit is converted: `{ ...fit, borrowedFrom, k:
convertPercent(fit.k, borrowedFrom, plan), rmse: convertPercent(fit.rmse,
borrowedFrom, plan) }`. `k` is a % per dollar, so it scales like a % (Pro's `k` / 5
on Max 5×). Everything reading `calibration` (estimates, forecasts, pacing, active
time, the shares' extension, estimated weeks, the plan comparison's budget) then
works right after a plan change. The week's own fit is never borrowed. The advertised
multipliers are approximate (`plans.ts`), so the card says the projections are rough
until the plan has its own fit.

**Current week.** The window's parts (one part `[windowFrom, resetsAt)` without
readings when `withoutReading`); the running part is the last. The forecast gets
`startsAt` = its start and always `ownPaceAfterMs: OWN_PACE_AFTER_MS`.
`CurrentWeek.parts?: PartPercent[]` when restarted: the ended parts from
`endedPartPercent` (with `calibration`), then the running part with `percent:
estimatedNow ?? used`, estimated when `estimatedNow` is set. `weekPacing` gets the
parts.

**Forecast.** `ForecastInput.startsAt?: number` (default `resetsAt − windowMs`)
replaces the window start in the blend's elapsed time and in the trend (its 12-hour
minimum counts from it). `typicalForecast` multiplies the typical quartiles by
`(resetsAt − startsAt) / windowMs`: a part of 2 days sees about 2/7 of a typical week.

**Pacing.** `PacingInput.parts` replaces `readings`. `WeekPacing.points` is the
running part (0 at its start, its readings, now when estimated); `earlier?: { plan:
Plan; points }[]` the ended parts (0 at their start, then their readings), oldest
first; `restart?: { at: number; plan: Plan; previousPlan: Plan }` the running part's
start and the plans on both sides; `spentPerDay` counts from the running part's start
(none in its first hour). `from` stays the window start: the axis keeps 7 days.

**Pacing chart.** Earlier parts: `polyline.pacing-earlier`, solid, stroke 2,
`--text-secondary` (the actual line is 3.5 and `--accent`). Restart: a dotted vertical
`line.pacing-restart` in `--text-secondary` at `x(restart.at)`, and a `pacing-label`
reading "Max 5× from Mon 17:27" (`PLAN_LABELS[plan]`, weekday and time) when `plan !==
previousPlan`, else "usage reset Mon 17:27". The label sits right of the line, under
the limit line, or left of it near the right edge, clear of the "limit", "even pace",
"now" and "actual" labels. The even pace runs from `(restart.at, 0)` to `(to, 100)`,
its label three quarters along. Legend: a grey line swatch (`legend-earlier`) with
"before the plan change" or "before the reset". Room tip: "Since the plan change (or
reset) you used …/day". Existing tokens cover both themes, so `styles.css` gets the
new classes once and no new token. Rejected: converting the earlier part to the new
plan's scale (it would show 20% of Max 5× used, when the new limit starts empty at the
restart and the budget left is the whole of it); showing only the running part (the
week would look short with no reason given).

**Week totals.** `WeekShare` gains `parts?: PartPercent[]` when restarted; `percent`
is `Σ convertPercent(part final, part.plan, last part's plan)` and may exceed 100;
`plan` is the last part's; `estimated` when any part is. Only the last part is
extended, as today (on its own plan, capped at 100); ended parts come from
`endedPartPercent` with the shares' calibration. `typicalWeek` keeps every week.
`planChange` stays, as a display flag only.

`WeekRow` gains `parts?: WeekPart[]`, with `{ end, percent (current plan),
percentEstimated?, plan, planPercent (own plan), pressureAt?, pressurePercent?
(current plan), start }`, taken from `share.parts`, or from `current.parts` for the
window in progress (`WeekHistoryInput.current` gains `parts`). The row's `percent` is
the sum of its parts' `percent`. For completed windows, a part's pressure is its first
reading at `PRESSURE_PERCENT` of its own plan within `[start, end)` (the window in
progress gets none, as today); the row's `pressureAt` and `pressurePercent` are those
of the first part that has one. `hit`: some part is not estimated and its
`planPercent` reaches `weekLimitThreshold`; a week without parts is decided as today.
`medianPercent` keeps every week.

**Plan comparison.** `weekSpan` sums one span per part (a week without `parts` is one
part `[start, end)` with the row's pressure). Per part: the observed start is the
subscription start clamped to the part; the cutoff is the earliest of the part's
pressure point, its first weekly-limit hit and its end; the cutoff % comes from the
part's final and pressure % as today; blocked time is the capped sessions inside
`[observed start, cutoff)`; hidden is the time before the observed start, after the
cutoff, and blocked. `WeekSpan.pacePercent` adds only the cutoff % of parts with
observed time ("no observed time, no pace", per part); the pooled pace uses it. The
`planChange` filter goes, and the sessions of a restarted week are kept with it.

**Weeks tab.** `restartTip(week, plan, timeZone)` in `weeksData.ts`, for example:
"Usage restarted with the change to Max 5× on Mon 26 Oct 17:27." or "Usage reset on
Thu 22 Oct 10:00, without a plan change.", then one line per part ("Pro until Mon 26
Oct 17:27: 100% of Pro", "Max 5× from Mon 26 Oct 17:27: 30% of Max 5×"), then "The peak
adds the parts up, on Max 5×." For a plan change without parts: "The plan changed in
this week without a usage reset: the % after the change covers the whole week on the
new plan." `ArrowRightLeft` marks a plan change and `RotateCcw` a reset without one,
in the timeline flags, the list badges ("plan change", "usage reset") and the legend.
The median InfoTip drops "a week with a plan change is left out".

**5-hour windows.** In `fiveHourWindows`, once `readingWindows` is sorted by start, a
window ending after the next one's start ends there: the messages after the upgrade
join the new window, the old one is no longer in progress, and a hit matched on the
old reset time falls back to the window holding its time. In `buildPlanFitInput`, a
session's plan is `planAt` of its end minus 1 ms (the new window starts up to 10
minutes before the upgrade), and an estimated window's peak is taken as it is:
`fiveHourWindows` computed it with the current plan's `k`, so converting it again from
the plan it ran on divided Pro sessions by 5 on Max 5× (found while planning).

**Backtest.** `runBacktest` computes `windowParts` over all readings once; a weekly
sample at `at` is skipped, not scored, when its window has a part starting after `at`:
that forecast predicted a part that ended early.

**Data.** No stored field, no `SCAN_FORMAT` bump, nothing written: the parts are
recomputed from the readings and the plan history on every summary, so the weeks
already stored come back. The summary JSON gains optional fields only
(`WeekShare.parts`, `CurrentWeek.parts`, `WeekPacing.earlier` and `restart`,
`WeekRow.parts`, `DriftWindow.from`, `Calibration.borrowedFrom`); `/api/widget` is
unchanged. No new name, path or title, so `anonymizeSummary` is unchanged.

**Failure modes.** A restart missed because the usage between two far-apart readings
hid the drop (under 2 points net) leaves the window whole: its later readings count
the earlier part's cost, and that window's ratio reads low. A manual reading typed 2
points or more too low splits its window; the chart then shows "usage reset", and
deleting the reading undoes it. A downgrade is split only when its readings show the
drop (whether one restarts is unverified: backlog). A free reset that moves the reset
time, instead of keeping it as the upgrade did, would start a new window overlapping
the old one, which this plan does not handle (backlog). A manual plan period with a
wrong start puts readings on the wrong plan, as today. An ended part without readings
counts `k × cost` (estimated), or 0 (estimated) without a calibration.

**Risks.** Many tests assert the exclusion this plan reverses; they are rewritten to
the new behavior (listed below), never deleted or weakened. Weeks in one part must
give identical numbers: the existing tests on them stay unchanged and must pass.
ESLint sorts interface keys and a comment starts a sorting partition, so doc comments
must be checked after `lint:fix` (AGENTS.md).

## Checklist

### Baseline

- [x] Run `npm run lint`, `npm test` and `npm run build`; note existing warnings and
  failures for the final report.

### Restarts

- [x] `plans.ts`: `planChanges`; `planChangeWithin` on top of it. Tests in
  `plans.test.ts`: the first period and same-plan periods are no change; the existing
  `planChangeWithin` tests pass unchanged.
- [x] `restarts.ts` with `restarts.test.ts`: one part without a drop; a drop of 2
  points splits at the later reading; a drop of 1 does not; a plan change between the
  two readings moves the split there (fixture of the real case: 100 at 16:16, 0 at
  16:28, Max 5× from 16:27, so parts Pro then Max 5×, split at 16:27); an upgrade before
  the window's first reading splits there, with an empty first part on the old plan; a
  downgrade before the first reading, or a plan change without a drop, does not split;
  two restarts give three parts; a reading at a split time belongs to the later part;
  unsorted input; `partStartOf`; `endedPartPercent` (last reading, `k × cost`
  converted and capped, 0 uncalibrated, the last two estimated).

Visible after: nothing (groundwork for the stages below).
Needs you: nothing.

### Fits

- [x] `calibration.ts`: `startOf` parameter. Tests: a reading after a restart counts
  its cost from the restart; a part starting after the first message is kept although
  its window started before.
- [x] `summary.ts`: `parts` and `startOf` in `prepareSummary`; the pooled fit as in the
  design (the week's own fit comes with "Current week"). Rewrite `summary.test.ts`
  "calibrates only on readings of windows that began on their plan" into "calibrates
  the readings after an upgrade from the upgrade on" (a record between the window start
  and the upgrade must not change `k`).
- [x] `limits.ts`: drift per part as in the design, `DriftWindow.from`. Rewrite
  `limits.test.ts` "skips a window holding a plan change…" into: the switch window
  counts its Max 5× part on Max 5× and its Pro part on Pro, each from its own start; a
  reset week on one plan adds both parts; parts summing under 10% are skipped.
- [x] Rewrite `multipliers.test.ts` "leaves out the window holding the switch…" into
  "counts the window holding the switch on both plans, each from its own part".
- [x] `DriftCard.tsx`: a tip line "Counted from <day, time>: the week restarted" when
  `from` is set; test in `Calibration.test.tsx`.

Visible after: on the Calibration tab, a Max 5× fit as soon as Max 5× has 3 readings
of 5% or more since the upgrade (today it waits for a week that starts on Max 5×), and
this week's Max 5× part in the drift once it reaches 10%; the Overview's projection
and room per day use that fit.
Needs you: nothing.

### Current week

- [x] `forecast.ts`: `startsAt`. Tests in `forecast.test.ts`: the trend and the blend
  count from it; the typical forecast is scaled; without it, results are unchanged.
- [x] `pacing.ts`: `parts`, `earlier`, `restart`, `spentPerDay` from the running part.
  Tests in `pacing.test.ts`, including an unchanged result for one part.
- [x] `summary.ts`: the week's own fit on the running part's readings, counted from its
  start, without the plan-change exclusion; the current week from its running part;
  `CurrentWeek.parts`. Rewrite `summary.test.ts` "keeps the pooled ratio and the typical
  pace in a week holding a plan change" into "uses the week's own ratio and pace from
  the restart": on its fixture the week's own fit becomes 0.25 %/$; derive the expected
  estimate and forecast from the fixture.
- [x] `PacingChart.tsx` and `styles.css` as in the design. Tests (a new
  `PacingChart.test.tsx`): the earlier polyline and its legend entry; the label for a
  plan change and for a reset; the even line's `x1` and the actual line's first point
  at the restart's x and 0%; nothing of this without a restart.
- [x] Check in a browser, light and dark, on a copy of the data dir: a temp
  `CCA_DATA_DIR` with `endpointEnabled` set to false (never the real dir, no endpoint
  call); the restart label clears the other labels; screenshots for the user. The real
  restart stays in the current window until Wed 28 Oct 21:00 local; after that, fake
  one in the copy: pick a reading of the current window at 5% or more and subtract its
  % from every later reading of that window, so the next one shows a drop (a reset
  without a plan change).

Visible after: on the Overview until this week resets (Wed 28 Oct, 21:00 local): the
Pro part in grey up to 100%, a marker "Max 5× from Mon 17:27", and the line, even pace
and projection from the upgrade, the projection on the pace since the upgrade.
Needs you: approve the chart from the screenshots, light and dark.

### Borrowed fit

- [x] `calibration.ts`: `Calibration.borrowedFrom`.
- [x] `summary.ts`: the borrowed weekly and 5-hour fits. Tests in `summary.test.ts`:
  right after an upgrade, `k` is Pro's divided by 5 with `borrowedFrom: 'pro'`; with 3
  readings of 5% or more on Max 5×, its own fit; with no fit on any plan, none.
- [x] `FitCard.tsx`: while borrowed, a note naming the plan it comes from and the
  conversion, for example "Borrowed from your Pro readings and converted with the
  advertised limits (Max 5× is 5× Pro) until Max 5× has 3 readings of 5% or more, so
  the projections are rough.", and "(from Pro)" on the 5-hour line; test in
  `Calibration.test.tsx`.

Visible after: only while the current plan has under 3 readings of 5% or more, so on
this data likely not before the next plan change (Max 5× reached 3% within an hour of
the upgrade); the Overview then shows a projection, room per day and active time right
after a change.
Needs you: nothing.

### Week totals

- [x] `share.ts`: shares per part; `typicalWeek` keeps every week. Rewrite
  `share.test.ts` "marks a window holding a plan change" (the flag stays, the % is the
  sum) and "leaves out a week holding a plan change" (into "keeps a restarted week,
  its parts added up").
- [x] `weekHistory.ts`: `WeekPart`, `WeekRow.parts`, the row in progress from
  `current.parts`, per-part pressure, `hit` per part, every week in the median. Rewrite
  `weekHistory.test.ts` "marks the window the new plan started in, with its full
  length" (the mark stays, with parts) and add: a reset week on one plan; a Pro part
  read at 100% is a hit; the row in progress adds the earlier part. Update
  `ranged.test.ts` "flags the week the new plan started in, as the summary does" to
  compare the parts too.
- [x] `planFit.ts`: spans per part, `pacePercent`, no `planChange` filter. Rewrite
  `planFit.test.ts` "leaves out a week holding a plan change, and the sessions that
  started in it" into "keeps a restarted week and its sessions; a part stopped at the
  pressure point adds hidden time until its restart".
- [x] Rewrite `summary.test.ts` "flags the week, and keeps it out of the typical week
  and the plan fit" into "flags the week and keeps it in the typical week and the plan
  fit".
- [x] `Weeks.tsx` and `weeksData.ts`: `restartTip`, icons, badges, legend, median tip.
  Rewrite `Weeks.test.tsx` "flags the week a plan change started in…" (the tip lists
  the parts) and add a reset week; `weeksData.test.ts` for `restartTip`.
- [x] Check the Weeks tab tooltip in the browser (same temp data dir); screenshot.

Visible after: on the Weeks tab, this week as the Pro part plus the Max 5× part on Max
5× (about 20% plus the Max 5× %), the hit mark (the Pro part reached the limit), and a
tooltip with both parts. After Wed 28 Oct 21:00 the week stays in the median peak, the
typical week and the Plans tab instead of dropping out.
Needs you: approve the tooltip from a screenshot.

### 5-hour windows

- [x] `sessions.ts`: overlapping reading windows. Test in `sessions.test.ts` with the
  real case (14:20–19:20, then 16:20–21:20): the first ends at 16:20, a message at
  17:00 joins the second, a hit whose reset is 19:20 falls back to the window holding
  its time.
- [x] `planFit.ts`: a session's plan at its end; an estimated window's peak not
  converted. Tests in `planFit.test.ts`; "converts the peak of a window taken on another
  plan" passes unchanged.

Visible after: on the Sessions tab, Monday's Pro window ends at 17:20 local and the Max
5× window from 17:20 holds the usage after the upgrade (today it shows $0). On the
Plans tab, estimated Pro sessions stop counting 5 times too small.
Needs you: nothing.

### Backtest

- [x] `backtest.ts`: skip weekly samples made before a later restart. Test in
  `backtest.test.ts`.

Visible after: `npm run backtest` no longer scores this week's forecasts made before
the upgrade.
Needs you: nothing.

### Docs

- [x] `docs/decisions.md`: replace "A week holding a plan change keeps its 7 days and
  is left out of the fits" with the split (restart rules and their evidence, the sum
  of parts, the rejected alternatives: leaving the week out, cutting it into separate
  windows since `weekSpan` reads a short week as mostly hidden, converting the earlier
  part on the chart); in "Weekly forecast: the week's own ratio and pace…", replace the
  plan-change sentence with the count from the restart; in "Calibrate on Claude Code's
  share of the weekly %", add the borrowed fit (rejected: waiting, no projection for
  up to a day after an upgrade; the measured multiplier, which needs 3 completed weeks
  on both plans); in "Sessions tab: windows anchored on readings…", the cut of an
  overlapped window; in "Weeks tab: windows follow the readings…", the sum of parts.
- [x] `CHANGELOG.md`, Unreleased: rewrite the bullet "A week in which you change plans
  no longer skews…" (the week is now split and kept, shown on the chart and the Weeks
  tab, free resets included); add the borrowed fit (Added), and the 5-hour window after
  an upgrade and the Plans tab's estimated sessions of an earlier plan (Fixed).
- [x] `AGENTS.md`: `restarts` in the `src/core/` layout list.
- [x] `docs/backlog.md`: delete the 5-hour overlap bug; extend "Convert between plans
  with the measured multipliers…" to the borrowed fit.
- [x] `README.md`: check the Overview and Weeks descriptions; the Privacy table does not
  change (nothing new is read).
- [ ] Delete this plan in the feature's final commit, naming its path in the message.

Visible after: nothing.
Needs you: nothing.

### Review

- [x] Peer review in a fresh context (Sonnet, read-only) against the acceptance
  criteria; fix blocking findings; at most 3 rounds.
