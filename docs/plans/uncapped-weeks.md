# Uncapped demand on the Weeks tab

Status: not started. Builds on the uncapped demand of the Plans tab
(`src/core/planFit.ts`: `FitWeek.demand`, `floor` and `hiddenHours`).

## Goal

The Plans tab shows each week's estimated demand without the limit (≈ 212% of
Pro), while the Weeks tab shows only the reading (99%), so the Plans numbers
appear from nowhere. The Weeks tab shows the estimate next to the reading, as a
second figure, for the weeks a limit or the subscription start cut short.

## Acceptance criteria

- WHEN a finished week's estimate exceeds its reading, THE SYSTEM SHALL show
  "≈ N% without the limit" under its peak % in the weekly timeline, and in a
  "Without the limit" column of the week list.
- WHEN a week's estimate equals its reading, or the week is in progress or has
  no percent, THE SYSTEM SHALL show no second figure (an empty cell in the list).
- WHEN the user hovers, focuses or taps the second figure, THE SYSTEM SHALL say
  in a tooltip how many days were hidden and why (the limit reached at
  `pressureAt`, blocked 5-hour sessions, before the subscription), filled at the
  typical pace.
- WHEN the median of the estimates exceeds the median peak, THE SYSTEM SHALL
  show it under the "median peak" stat as "≈ N% without the limit".
- THE SYSTEM SHALL show the same numbers as the Plans tab on the current plan
  with no Opus-to-Sonnet share: a week's estimate equals its Plans chart bar,
  the median equals the current plan's "Typical week".
- THE SYSTEM SHALL keep the reading as the main figure everywhere on the Weeks
  tab: bars, the hit icon, "peak ≥ threshold" and the median tick stay on the
  readings.
- THE SYSTEM SHALL use the words "without the limit" for the estimate on both
  tabs, including the Plans tab's `InfoTip`, which also points to the Weeks tab.

## Design

- Data: `summary.planFit.weeks` already holds the estimate per finished week.
  `weeksData.ts` joins it to `WeekRow` by `start` (`uncappedOf(planFit, start)`),
  so nothing is computed twice and both tabs read one source. The median comes
  from `evaluatePlans(planFit)` for the current plan (`typical`), so it cannot
  drift from the Plans tab.
- Bars stay 0 to 100% of the reading: an estimate above 100% does not fit the
  track, and the reading is what the tab is about. The estimate is text only.
- The tooltip uses `useTip()`; the text is built in `weeksData.ts` from
  `hiddenHours` and the week's `pressureAt` and blocked sessions.
- "≈" marks the estimate, "~" stays the transcript estimate of a reading, and
  the words "without the limit" tell them apart.

### Not in this plan

- **The Overview's current week**: its forecast predicts the real % at reset,
  which a limit caps; a "without the limit" pace there answers another question.
  Backlog.
- **Capped 5-hour sessions on the Sessions tab**: `FitSession` has no start to
  join on. Backlog.

## Checklist

- [ ] Baseline: `npm run lint`, `npm test`, `npm run build`
- [ ] `weeksData.ts`: `uncappedOf`, second-figure and tooltip texts; tests (estimate above the reading, equal, in progress, no percent)
- [ ] `Weeks.tsx`: second figure in the timeline, "Without the limit" column, median stat line; tests
- [ ] Plans tab `InfoTip`: "without the limit" wording and a pointer to the Weeks tab
- [ ] Test: a week's Weeks estimate equals its Plans chart value, and the medians match
- [ ] Lint, test, build; check both tabs in a browser (light and dark)
- [ ] Peer review
