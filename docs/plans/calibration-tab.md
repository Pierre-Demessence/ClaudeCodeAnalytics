# Calibration tab

## Goal

Rebuild the Calibration tab to match the design board `Calibration.dc.html`
(<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>): limit drift, the
calibration fit, the readings table with deletable manual readings and a
Claude Code share in the manual form, and the current settings and collection
status restyled into the board's Settings, Collection and Plan history cards. The what-if
simulator and the Claude Code vs claude.ai split are parked on their own
boards (`WhatIf.dc.html`, `Split.dc.html`) and are not part of this milestone.

## Acceptance criteria

### Layout

- THE SYSTEM SHALL lay out the tab as on the board: Limit drift (wide) and
  Calibration (narrow) side by side, then Readings (wide) beside a column
  holding Settings and Collection, then Plan history full width.
- WHILE the viewport is phone-width, THE SYSTEM SHALL stack every card and
  scroll the readings table inside its card.
- THE SYSTEM SHALL match the board in light and dark themes, never carry
  meaning by color alone, and use `useTip()` / `InfoTip` instead of the
  board's `title` attributes.

### Limit drift

- THE SYSTEM SHALL show one bar per weekly window on the current plan (up to
  the last 12, the current window included and labelled "now" on the axis),
  its height and in-bar label the window's ratio in "% of the weekly limit per
  $100": the Claude Code part of its last reading (`weekly × claudeCodeShare`)
  over the cost from the window start to that reading, × 100.
- THE SYSTEM SHALL skip windows whose last reading is under 10% or that started
  before the first imported message.
- WHEN at least 3 completed windows have a ratio, THE SYSTEM SHALL draw a dashed
  "usual" line at the median ratio of the completed windows, and draw every bar
  more than 15% away from it hatched, the legend naming both fills and the line.
- WHEN the last two completed windows are both off in the same direction, THE
  SYSTEM SHALL show the alert `Since the week of <first window of that run>,
  $100 costs N% more|less of the limit.` (N from the run's median ratio) and
  "The limit may have changed; the calibration follows recent readings
  (half-life 2 weeks)."
- IF fewer than 3 completed windows have a ratio THEN THE SYSTEM SHALL show the
  bars without the usual line and say how many weeks drift needs.
- WHEN the user hovers or focuses a bar, THE SYSTEM SHALL show the week's
  dates, ratio, cost and Claude Code %.

### Calibration

- THE SYSTEM SHALL show the fit as a large "X%" with "of the weekly limit per
  $100 of API-equivalent usage", then "Typical error ±N pts", "Readings used:
  n, last W weeks" and "5-hour fit X% per $100, ±N pts", typical error and the
  5-hour fit explained by an `InfoTip`, and the note on how the fit is made.
- IF there is no weekly fit THEN THE SYSTEM SHALL show the current "needs 3
  readings" note instead; the 5-hour line is left out without a 5-hour fit.
- THE SYSTEM SHALL keep the unknown-models warning in this card.

### Readings

- THE SYSTEM SHALL list readings newest first (time, source, weekly %, 5-hour %,
  Claude Code share, "—" when absent), 10 at first, "Show more" adding 20, over
  the latest 100 readings plus every manual one, with "Showing n of …" beside
  the button.
- WHEN the user deletes a manual reading and confirms, THE SYSTEM SHALL remove
  exactly that reading from `snapshots.jsonl` and refresh the summary.
  Endpoint readings have no Delete button and the API refuses to delete them.
- THE SYSTEM SHALL offer the "Add a manual reading" form: Weekly %, 5-hour %
  (optional), Claude Code share % (optional), Weekly reset (prefilled from the
  latest reading), "Add manual reading", with the board's two helper lines.
- WHEN a manual reading carries a share, THE SYSTEM SHALL use it in the
  calibration and the drift like an endpoint share.

### Settings

- THE SYSTEM SHALL show a Plan select: `Detected: <plan>` (when detection
  exists) and the three plans, its explanation in an `InfoTip` by the label.
  Picking a plan adds a manual period from now; picking "Detected" adds a detected period from now,
  so detection takes over again. The selected option reflects the active
  period.
- THE SYSTEM SHALL show the detected-plan mismatch notice with its switch
  button under the select.
- THE SYSTEM SHALL show the endpoint checkbox and "Minutes between endpoint
  calls" (whole minutes, 15 to 1440, saved with its button; the API refuses
  values outside that range), its explanation in an `InfoTip` by the label.
- THE SYSTEM SHALL show "5-hour limit hit from (%)" with its Save button and
  explanation in an `InfoTip` by the label.

### Collection

- THE SYSTEM SHALL show the endpoint status (icon and text), last run, messages
  imported, malformed lines (only when some) and the last error (only when
  set, as a notice).

### Plan history

- THE SYSTEM SHALL show every plan period, newest first, in a full-width card
  as a table: plan (the active one marked "current"), from, until (the next
  period's start, or "now"), source, number of readings taken in it, and a
  Remove button.
- THE SYSTEM SHALL offer "Add a plan period" (plan, from date, "Set plan") with
  the helper line saying it is for past changes.
- IF there is no plan history THEN THE SYSTEM SHALL show the plan assumed so far
  as one row without Remove.

## Design

**Computed on the server**, as the other tabs: a pure module
`core/limits.ts` and one summary field `limits: Limits`.

```ts
interface Limits {
  /** Up to 12 windows on the current plan, oldest first. */
  drift: { resetsAt: string; ratio: number; cost: number; claudeCode: number; current?: true }[];
  /** Median ratio of the completed windows; absent under 3 of them. */
  usual?: number;
  /** Trailing run of off windows, when the last two completed are off the same way. */
  shift?: { since: string; change: number };
  /** Latest 100 readings plus every manual one, newest first. */
  readings: Snapshot[];
  /** Readings taken in each plan period, by index in `planHistory`. */
  readingsPerPeriod: number[];
}
```

- **Drift.** Last reading per window (as `weeklyShares`), filtered on
  `planAt(...) === plan`, `weekly ≥ 10` and `windowStart ≥ first`. 10%, not
  the fit's 5%: one reading's whole-percent rounding is ±0.5 pt, 10% of a 5%
  reading, close to the 15% "off" threshold. The usual line is the median, not
  the fit's `k`: the fit already leans toward recent weeks, so a drift would
  move the line toward itself. Off = `|ratio − usual| / usual > 0.15`.
  The alert's run is the longest trailing run of completed windows off in the
  same direction, at least 2 long.
- **Fit facts.** `Calibration` gains `from` (ISO time of its oldest point);
  "last W weeks" is `ceil((now − from) / week)`. "% per $100" is `k × 100`.
- **Readings sent.** The latest 100 plus every manual one keeps the summary
  small: the endpoint adds about 30 readings a day.
- **Manual share.** `parseManualReading` accepts an optional
  `claudeCodeShare` percent; `ManualReading` gains it. No scan-format change:
  snapshots already have the field.
- **Deleting a manual reading.** `POST /api/readings/delete` with `{ ts }`
  (same JSON/Origin checks as the other POSTs). Under the data-dir lock,
  `Store.deleteManualSnapshot(ts)` reads `snapshots.jsonl`, drops the single
  line with `source: 'manual'` and that `ts`, and rewrites the file with
  `writeAtomic`; 404 when none matches, so an endpoint reading can never be
  deleted. The dropped line is first appended to `deleted-readings.jsonl` in
  the data dir, so a regretted delete can be undone by hand (there is no
  restore button): a manual reading cannot be typed back, its numbers came from
  `/usage` at that moment. Marking readings as deleted inside `snapshots.jsonl`
  was rejected: every reader of snapshots would need to filter them. The collector only appends under the same lock, so nothing is lost.
  The dashboard asks with `window.confirm` before calling it.
- **Plan select.** The summary gains `detected?: Plan` (raw detection from the
  latest reading) and `planSource: PlanPeriod['source'] | undefined` (the
  active period's). Picking "Detected" appends `{ source: 'detected' }` from
  now, which `withDetectedPlan` then keeps current.
- **Throttle.** `SettingsUpdate` and `parseSettingsUpdate` gain
  `throttleMinutes`, an integer from 15 to 1440: never below the 15-minute
  default, since the endpoint shares Claude Code's rate limit.

**Dashboard.** `SettingsPanel.tsx` becomes `Calibration.tsx` laying out the
tab, with one component per card: `DriftCard.tsx`, `FitCard.tsx`,
`ReadingsCard.tsx`, `SettingsCard.tsx`, `CollectionCard.tsx`,
`PlanHistoryCard.tsx`. Bars are plain
flex elements, as on the board, no chart library. The off-ratio fill reuses the
existing critical hatch. Layout uses wrapping flex rows (`flex: 999 1 560px`
and `1 1 320px`), so the cards stack at phone width without a media query.

**Edge cases.**

- No reading at all: drift empty state; the fit card's "needs 3 readings"
  note; the readings table shows only the form.
- Cost 0 in a window with a reading (all claude.ai): no ratio, skipped.
- A plan change mid-window: the window belongs to the plan at its last reading.
- Two manual readings with the same `ts` cannot happen (ms timestamps from one
  server); deletion removes the first match only.

## Checklist

- [ ] Baseline: lint, tests, build
- [ ] `Calibration.from`, with tests
- [ ] `core/limits.ts` with tests: drift filter (plan, 10%, data start), usual median, off threshold, shift run and direction, fewer than 3 weeks; readings (latest 100 + manual, order); readings per plan period
- [ ] `buildSummary` `limits`, `detected`, `planSource`, with tests
- [ ] API: manual `claudeCodeShare`, `throttleMinutes`, `POST /readings/delete` and `Store.deleteManualSnapshot` (manual only, 404, lock, line kept in `deleted-readings.jsonl`), with tests on a temp `CCA_DATA_DIR`
- [ ] `dashboard/api.ts` (`deleteReading`, new fields)
- [ ] `Calibration.tsx` and the six cards, styles (both dark blocks), `App.tsx` branch, with tests (empty states, alert, hatching cue, delete confirm, show more, plan select and "Detected", throttle bounds, collection notices, plan history rows and empty history)
- [ ] Browser check against the board: light and dark, desktop and phone width
- [ ] Docs: README tab description; delete the done backlog items (manual share, deleting manual readings, drift); point the split and what-if backlog items at their parked boards; delete milestone 1 from the roadmap; decisions entry for the drift reference
- [ ] Review pass, then lint, tests, build
