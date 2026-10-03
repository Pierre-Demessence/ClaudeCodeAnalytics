# Weeks tab

## Goal

A Weeks tab next to Sessions that shows the history of weekly usage: one row
per weekly window (last 12), with its final weekly %, cost, the cost of each of
its 7 days, its 5-hour sessions and projects. Design board:
<https://claude.ai/artifact/GbZ9iR2nNyWZ7t5uMycxNC> (`Weeks.dc.html` desktop,
`WeeksPhone.dc.html` phone; sample data, dark mode through the `dark` tweak).

The Overview's "Past weeks" card (final % of the last 8 completed weeks) is
removed: the Weeks tab shows the same windows, with more. "Typical week on each
plan" stays on the Overview.

## Acceptance criteria

### Tab

- THE SYSTEM SHALL add a "Weeks" tab between Sessions and Calibration, at
  `#/weeks`.
- THE SYSTEM SHALL no longer show "Past weeks" on the Overview; the rest of the
  Overview, "Typical week on each plan" included, is unchanged.
- THE SYSTEM SHALL lay it out as on the board: four stat cards, the weekly
  timeline card, the week list card; on a phone the timeline becomes one block
  per week (final-% bar, 7 daily bars, cost, sessions, messages, projects) and
  the stat cards sit in two columns.
- THE SYSTEM SHALL match the board in light and dark themes, never carry meaning
  by color alone, and use `useTip()` / `InfoTip` instead of `title`.

### Weeks

- THE SYSTEM SHALL show the last 12 weekly windows, newest first: every window
  with a reading or a Claude Code message, the one in progress included.
  Windows follow the reset times of the readings (`weekStartFor`), so they
  match the Usage tab's weekly chart.
- THE SYSTEM SHALL give each week its final weekly %, on the current plan
  (`convertPercent`, as "Past weeks"):
  - a completed week with a reading: `WeekShare.percent`;
  - a completed week without a reading, when calibrated: `k × cost`, capped at
    100 and marked "~" (source "estimated");
  - the week in progress: the current estimate or reading, "~" when it is an
    estimate;
  - otherwise no percent, shown as "–".
- IF a week's final reading (not an extended or estimated percent) reaches 100 THEN THE SYSTEM SHALL mark it
  as hit with the triangle icon and a hatched bar. Estimates never count.
- THE SYSTEM SHALL show the typical week (median of the completed weeks) as a
  tick on every bar.

### Timeline

- THE SYSTEM SHALL show per week 7 cells, the API-equivalent cost of each 24 h
  block from the weekly reset, shaded in five steps with the amount written in
  the cell; blocks after now are empty dashed cells.
- THE SYSTEM SHALL label the columns with the weekday of the latest reset and
  explain the cells, the bar and the reset time in an `InfoTip` by the card
  title.
- WHEN the user hovers or focuses a week's label, THE SYSTEM SHALL show its full
  date range and the cost, messages and sessions.

### Summary cards

- THE SYSTEM SHALL show: weeks shown; weeks that hit the limit (with the
  triangle when above 0); median final % of the completed weeks that have one;
  median cost of the completed weeks with Claude Code messages. Each metric
  whose meaning is not obvious has an `InfoTip`.

### Week list

- THE SYSTEM SHALL list, per week: date range (and "in progress"), up to two
  project names then "+n" (full paths in a tip), sessions with the number that
  hit the 5-hour limit (triangle icon), messages, cost, final % and source
  (`reading` or `estimated`). An `InfoTip` after the "Sessions" header explains
  that sessions are the 5-hour windows started in the week and what the
  triangle counts.
- THE SYSTEM SHALL count a session in the week holding its start, and "hit"
  with the Sessions tab's rule (a reading reached the limit threshold).
- IF there is no week THEN THE SYSTEM SHALL show "No weekly window yet." in
  both cards.

## Design

**Computed on the server**, as Sessions and Limits: a pure module
`core/weekHistory.ts` and one summary field `weekHistory: WeekHistory`. (The
names `weekly` and `weeks` are taken: usage rows and final-% shares.)

```ts
interface WeekRow {
  /** 5-hour sessions started in the week that hit the limit threshold. */
  cappedSessions: number;
  cost: number;
  /** Cost of each 24 h block from `start`; null for a block after now. */
  days: (number | null)[];
  /** ISO end of the window. */
  end: string;
  hit?: true;
  inProgress?: true;
  messages: number;
  /** Final weekly %, on the current plan. */
  percent?: number;
  percentEstimated?: true;
  /** By cost, highest first, at most 5. */
  projects: { name: string; path: string; cost: number }[];
  projectCount: number;
  sessions: number;
  source: 'reading' | 'estimated';
  /** ISO start of the window. */
  start: string;
}

interface WeekHistory {
  /** `medianPercent` is also the typical-week tick on every bar. */
  stats: { hit: number; medianCost?: number; medianPercent?: number };
  /** Last 12, newest first. */
  weeks: WeekRow[];
}
```

- **Windows.** Group records by `weekStartFor(ms, resets)`; add the windows of
  the readings and the current one (from `current.resetsAt`, which already
  handles a week without a reading). Keep the last 12 by start.
- **Percent.** Looked up in `summary.weeks` by `resetsAt`; the formula above
  for the other cases. Needs `calibration` and `current` as inputs, so the
  module takes them from `buildSummary` rather than recomputing.
- **Sessions.** `buildSessions` keeps its public behavior; its window building
  (everything before the 7-day filter) is extracted as `fiveHourWindows` and
  `buildWeekHistory` counts those windows by start. A pure refactor, guarded by
  the existing `sessions.test.ts`. `capped` is the same expression in both.
- **Day blocks.** Fixed 24 h from the window start, not local calendar days: the
  window starts at the reset time (mid-day), and fixed blocks are immune to DST.
- **Payload.** 12 rows, about 20 numbers each. Projects are cut to five per
  week.

**Dashboard.** `Weeks.tsx` (tab: `Stats`, `Timeline`, `List`, like
`Sessions.tsx`) and `weeksData.ts` (formatting and the shading level, tested).
`PastWeeks` is deleted; `PlanEquivalents` moves to its own
`PlanEquivalents.tsx` and `Overview.tsx` imports it from there. Weeks reuses
the surviving week-bar classes (`.week-track`, `.week-bar.hit` / `.estimated`,
`.week-typical`, `.week-value`); `.week-bars li` and `.week-label` go with
`PastWeeks`. It also reuses the
critical hatch, the `--heat-1…5` variables (already defined for both themes)
and `session-stats`. New CSS for the day cells and the phone block; dark
variables are already shared, so none are added.

**Edge cases.**

- Reset time moved by Anthropic: windows follow each message's own reset
  (`weekStartFor`); the column header uses the latest reset's weekday, so older
  rows can be off by a day. Accepted; the tip shows each week's real range.
- Week with a reading but no Claude Code message (claude.ai only): cost 0, row
  shown, excluded from the cost median.
- Plan change inside the history: percents are converted to the current plan, so
  a hit can show on a week that was not a hit on its own plan. Same as "Past
  weeks".
- No reading and no calibration: percent "–", the week still shows its costs.

## Checklist

- [x] Baseline: lint, tests, build (the working tree already holds the unfinished Calibration milestone: note its failures separately)
- [x] Extract `fiveHourWindows` from `buildSessions`, existing tests green
- [x] `core/weekHistory.ts` with tests: window grouping and cap of 12, day blocks (reset mid-day, week in progress), percent cases (reading, extended, estimated, none, plan conversion), hit (reading only), session counts, project cut, medians, empty
- [x] `buildSummary` `weekHistory`, with a test
- [x] `dashboard/api.ts` type, `tabs.ts` entry, `App.tsx` branch, `tabs.test.ts`
- [x] `weeksData.ts` with tests (shading steps, date range, project text)
- [x] `Weeks.tsx` and styles, with tests (stats, hit icon beside the bar, "~" on estimates, empty state, tip text)
- [x] Remove "Past weeks": delete `PastWeeks`, move `PlanEquivalents` to `PlanEquivalents.tsx`, drop its CSS and move its Overview/App test assertions (`Overview.test.tsx:146-150`, `App.test.tsx:53`) to the Weeks tests
- [x] Browser check against the board: light and dark, desktop and phone width
- [x] Docs: README tab description, `AGENTS.md` layout, delete the backlog item, `docs/decisions.md` entry (windows follow the readings' resets; estimates never hit; fixed 24 h blocks)
- [x] Review pass (fixed: a reading extended from before the reset no longer counts as a hit; the phone timeline repeats cost, sessions, messages and projects), then lint, tests, build

Status: done; delete this plan in the feature's commit.
