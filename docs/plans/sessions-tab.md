# Sessions tab

## Goal

Add a Sessions tab matching the design board `Sessions.dc.html`
(<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>): the past 5-hour windows
of the last 7 days as summary stats, a day × hour timeline and a list, each
window anchored by readings where one exists and estimated from transcript
times otherwise.

## Acceptance criteria

### Windows

- THE SYSTEM SHALL build one window per distinct `fiveHourResetsAt` among the
  endpoint readings, running from that reset minus 5 hours to the reset, with
  source "reading".
- WHEN a message falls outside every reading window, THE SYSTEM SHALL open an
  estimated window at that message's time, running 5 hours or until the next
  reading window starts, whichever comes first; later messages before its end
  join it.
- THE SYSTEM SHALL give each window its message count, API-equivalent cost and
  projects (each conversation's start directory, as the Breakdown), the
  projects sorted by cost.
- THE SYSTEM SHALL give a reading window the highest 5-hour % read in it as its
  peak; IF a reading window holds no reading with a 5-hour % THEN it has no
  peak.
- WHEN a 5-hour calibration exists, THE SYSTEM SHALL give an estimated window
  the peak `min(100, k × cost)`, marked as an estimate; otherwise it has no
  peak.
- THE SYSTEM SHALL count a window as having hit the limit WHEN a reading in it
  shows the limit threshold or more (default 95%): close to 100%, a new
  agent run stops almost at once, so the window is as good as spent.
  Estimated peaks never count.
- THE SYSTEM SHALL let the user set the limit threshold (whole %, 50–100) in
  the Settings card of the Calibration tab, explained by a `title` tooltip,
  and keep it in `settings.json`.
- WHEN the current time falls inside a window, THE SYSTEM SHALL include it,
  marked "in progress".
- THE SYSTEM SHALL keep the windows that overlap the last 7 local days
  (today included); a reading window with no Claude Code message (claude.ai
  only) is kept with 0 messages and $0.

### Stats

- THE SYSTEM SHALL show four stat cards, each with a `title` tooltip: the
  window count ("sessions, last 7 days"), the count that hit the limit (with a
  warning icon, labelled "hit the 5-hour limit (≥ 95%)" with the threshold in
  use), the median peak of reading windows ("median peak") and the
  median window cost ("median session cost").
- IF no window has a reading peak THEN the median peak card SHALL show "–"
  with a tooltip saying why.

### Timeline

- THE SYSTEM SHALL show the card "5-hour sessions, last 7 days" with one row
  per local day (today at the top, as the list's newest-first order; labelled
  "Fri 25 Sep"), a 24-hour axis
  (ticks every 3 hours) and one block per window at its local start and length.
- THE SYSTEM SHALL draw a reading window with a solid border and an estimated
  one with a dashed border, fill the block's width in proportion to its peak
  (hatched when it hit the limit) and label it with the peak (prefixed "~"
  when estimated, the warning icon when it hit the limit, "–" without a peak).
- WHEN a window crosses local midnight, THE SYSTEM SHALL draw it on both day
  rows, the label only on the part holding its start.
- WHEN the user hovers a block, THE SYSTEM SHALL show its local start–end, peak,
  cost, message count and source.
- THE SYSTEM SHALL show the legend under the timeline: reading border,
  estimated border, hit-the-limit fill and icon.

### List

- THE SYSTEM SHALL list every window of the timeline, newest first, with the
  columns Window ("Thu 1 Oct · 10:12–15:12", plus "in progress"), Projects (up
  to 2 names, then "+n"; all in the tooltip), Messages, Cost, Peak (bar + %,
  hatched and with the warning icon when it hit the limit, "~" when estimated)
  and Source ("reading" / "estimated"), each header with a `title` tooltip.

### All cards

- IF the last 7 days hold no window THEN the timeline and list SHALL show an
  empty state and the stats "0" / "–".
- WHILE the viewport is phone-width, THE SYSTEM SHALL lay the stats out 2 × 2,
  shrink the timeline's day labels and scroll the list horizontally inside its
  card.
- THE SYSTEM SHALL add the Sessions tab between Breakdown and Calibration
  (`#/sessions`), match the board in light and dark themes and never carry
  meaning by color alone.

## Design

**Computed on the server**, as the Breakdown and Usage tabs: a new pure module
`core/sessions.ts` and one new summary field, `sessions: Sessions`. A week
holds a few dozen windows.

```ts
interface FiveHourWindow {
  start: string;            // ISO
  end: string;              // ISO
  source: 'reading' | 'estimated';
  inProgress?: true;
  messages: number;
  cost: number;
  projects: { name: string; path: string; cost: number }[];
  peak?: number;            // 0–100
  peakEstimated?: true;
  capped?: true;
}

interface Sessions {
  days: string[];           // 7 local days, newest first
  windows: FiveHourWindow[]; // newest first
  stats: { count: number; capped: number; medianPeak?: number; medianCost?: number };
}
```

- **Building windows.** Reading windows come first, from the snapshots with a
  `fiveHourResetsAt` (sorted, deduplicated; the collector already rounds it to
  the minute, so the same window always has the same value). Then one walk over
  the records sorted by time: a record inside a reading window joins it;
  otherwise it joins the open estimated window or opens one, ended at the
  earlier of start + 5 h and the next reading window's start. This is
  `sessionCosts`'s rule plus the reading anchors. Real data shows why the
  anchors matter: readings place windows at 07:50, 12:50, 17:50 and 22:50 UTC
  back to back, while the transcript rebuild starts them at the first message.
- **Peaks.** From readings: the maximum `fiveHour` of the snapshots with that
  reset. A reading taken before the end may miss the window's true peak; the
  board shows "highest % read" and the tooltip says so. Estimated: the
  `fiveHourCalibration.k` the summary already fits. Reading peaks are never
  topped up with an estimate: measured and estimated stay apart.
- **Range.** Windows ending after the start of the local day 6 days ago
  (`startOfDay`, moved from `summary.ts` next to `dayKey` in `aggregate.ts`). `now` caps the
  walk, so a window holding `now` is the in-progress one.
- **Limit threshold.** `Settings` gains `limitThreshold: number` (default 95
  in `DEFAULT_SETTINGS`); `loadSettings` already merges defaults, so existing
  `settings.json` files need no migration. `parseSettingsUpdate` keeps it only
  as an integer in 50–100. The summary passes it to `buildSessions` and
  returns it (`limitThreshold`) for the tooltips and the settings control. The
  control goes in today's `SettingsPanel` (shown on the Calibration tab); the
  Calibration milestone restyles it with the rest of the card. Weekly views
  keep 100% as their limit: the threshold is about whether a 5-hour window is
  still usable.
- **Projects.** `sessionProjects(records)` from `breakdown.ts`, as the
  Usage tab's outliers.
- **Stats.** `median` from `core/stats.ts`; medians over the 7 days' windows,
  the in-progress one excluded (its cost and peak are still growing).

**Dashboard.** `tabs.ts` gains `sessions`; `App.tsx` a branch. New
`Sessions.tsx` lays out the tab: `SessionStats`, `SessionTimeline` and
`SessionList`, in one file unless it grows past the size of `Usage.tsx`'s
cards, then split the same way (`SessionTimeline.tsx`, …).

- The timeline is CSS grid/absolute positioning, as on the board, no chart
  library. Day boundaries and block positions are computed in the dashboard
  from the ISO times with `Intl.DateTimeFormat` in the summary's `timeZone`; a
  helper `timelineRows(windows, days, timeZone)` in a `sessionsData.ts` (tested)
  returns `{ day, left%, width%, isStart }` per row.
- Styles reuse `--estimate-fill` for the peak fill, the existing critical hatch
  for capped windows, and the board's `--chip` label background (new token in
  the light block and both dark blocks).
- Icons: Lucide `TriangleAlert` for "hit the limit", as elsewhere.

**Edge cases.**

- Manual readings have no `fiveHourResetsAt`: they anchor nothing.
- Two readings of the same window disagreeing on `fiveHourResetsAt` by a
  minute would make two overlapping windows. The collector's rounding prevents
  it and real data (4 windows, 57 readings) never shows it; not handled.
- An estimated window cut short by a following reading window is shorter than
  5 hours; it is drawn at its real length.
- DST: positions are fractions of the real day length, so on a 23- or 25-hour
  day a block sits up to half an hour off the hour grid; accepted.
- Records before the first reading: all estimated, as today.

**Out of scope** (to `docs/backlog.md` when deferred): the forecast's
`sessionPaces` still use the transcript-only `sessionCosts`; anchoring them on
readings too is a separate change to a calibrated number.

## Checklist


- [x] Baseline: lint, tests, build
- [x] `limitThreshold` setting: type, default, `parseSettingsUpdate` validation, `SettingsPanel` control, with tests
- [x] `core/sessions.ts` with tests: reading windows (dedup, peak = max, no %), estimated windows (open/join, cut at the next reading window, 5 h limit), claude.ai-only reading window, estimated peak with and without calibration, capped only from readings at or above the threshold, in-progress window, 7-day range, projects by cost, stats (medians exclude in-progress, no reading peak)
- [x] `startOfDay` moved to `aggregate.ts`; `buildSummary` `sessions`, with a test
- [x] `sessionsData.ts` (`timelineRows`: midnight split, label part, time zone) with tests
- [x] `tabs.ts` entry, `App.tsx` branch, `Sessions.tsx` (stats, timeline, list), styles (both dark blocks), with tests (empty state, tooltips, "~" and "–" peaks, capped icon, "+n" projects, in progress)
- [x] Browser check against the board: light desktop by the agent; dark and phone width by the user
- [x] Docs: README feature list and tab description; delete the two done backlog items (past 5-hour sessions timeline; readings anchoring past sessions) and add the `sessionPaces` item; delete milestone 1 from the roadmap; decisions entry for reading-anchored windows, peaks and the limit threshold
- [x] Review pass (by the user), then lint, tests, build
