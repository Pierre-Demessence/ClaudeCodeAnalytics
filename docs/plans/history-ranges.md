# History ranges: a time range picker and paged lists

## Goal

Every message, reading and event is kept forever, but the history views show
fixed recent windows (7 days of sessions, 12 weeks, 35 days of daily usage, 4
weeks of heatmap…). One range picker, shared by the Usage, Breakdown, Sessions
and Weeks tabs, lets the user open any past period, and long lists page instead
of being cut off.

## Today's fixed windows

| View (tab) | Window | Where |
| --- | --- | --- |
| Daily usage by model (Usage) | 35 days; weekly mode shows every window | `src/core/summary.ts:43`, `:327-330` |
| When you work (Usage) | 28 days | `src/core/activity.ts:11` |
| Cache efficiency (Usage) | 14 days | `src/core/activity.ts:13` |
| Cost per message (Usage) | current weekly window | `src/core/activity.ts:258` |
| Breakdown, all cards | this week / last 4 weeks / all time, all three computed on every poll | `src/core/summary.ts:335-339`, `src/dashboard/Breakdown.tsx:19` |
| 5-hour sessions chart and Session list (Sessions) | 7 days | `src/core/sessions.ts:14`, `:203` |
| Weekly usage chart and Week list (Weeks) | 12 weeks | `src/core/weekHistory.ts:16`, `:116` |
| Limit drift (Calibration) | 12 weeks | `src/core/limits.ts:8` |
| Readings (Calibration) | 100 latest + manual, "Show more" by 20 | `src/core/limits.ts:16`, `src/dashboard/ReadingsCard.tsx:18-19` |

These stay fixed on purpose, since their window is part of what they mean: the
Overview, every forecast input (`TYPICAL_DAYS`, `summary.ts:41`), Model ratios
(the pace behind "active use left"), the Plans tab, Subscription vs API prices,
and the Calibration tab (the fit's half-life, the drift chart's "is the limit
changing now").

## Acceptance criteria

### Range

- THE SYSTEM SHALL offer the presets This week (the current weekly window), Last
  4 weeks, Last 3 months, Last 12 months, All time, and Custom (a from and a to
  day, inclusive, in the browser's time zone).
- WHEN the user presses previous or next, THE SYSTEM SHALL move the range by its
  own length (by weekly windows for This week and Last 4 weeks), and SHALL
  disable next once the range ends now, and previous once it starts before the
  first message.
- THE SYSTEM SHALL keep the range in the URL hash (`#/<tab>?range=<preset>` or
  `?from=YYYY-MM-DD&to=YYYY-MM-DD`), so back, reload and bookmarks restore it.
  A preset in a bookmark stays relative to now.
- WHEN the user switches between Usage, Breakdown, Sessions and Weeks, THE
  SYSTEM SHALL keep the same range.
- WHILE no range is in the hash, THE SYSTEM SHALL show the views as they are
  today (each view's current default window).
- IF the hash holds an invalid range (unknown preset, bad date, from after to),
  THEN THE SYSTEM SHALL fall back to the default and show no error.

### Data

- WHEN a non-default range is picked, THE SYSTEM SHALL fetch
  `GET /api/range?from=<ms>&to=<ms>&tz=<zone>` and SHALL show the previous data,
  dimmed, until it arrives.
- THE SYSTEM SHALL compute ranged numbers with the same builders as the default
  summary, so a ranged view of the default window shows the same numbers.
- THE `/api/range` route SHALL read stored data only (no collector run, no
  endpoint call), and SHALL answer 400 for missing, non-numeric or reversed
  bounds.
- WHILE a range includes now, THE SYSTEM SHALL refetch it at each summary reload.
- THE SYSTEM SHALL pass ranged data through anonymize mode like the summary:
  project names, paths, branches and conversation titles stay masked.

### Views

- Breakdown: the picker replaces the period toggle; every card follows the range.
- Usage: WHILE the range spans 62 days or fewer, the usage chart SHALL show one
  bar per day; beyond that, one bar per weekly window, and the day/week toggle
  SHALL offer only the week. When you work averages over the range; Cache
  efficiency shows its daily share (weekly beyond 62 days); Cost per message
  covers the range. Each subtitle names the range instead of "last N days".
- Sessions: the stats cover the range. The block chart SHALL show at most 7 days
  at a time, with its own previous/next week pager inside the range; the Session
  list SHALL page by 25 rows.
- Weeks: the chart and the Week list SHALL show the weekly windows that start in
  the range; the list SHALL page by 12 rows.
- WHEN a range holds no usage, each card SHALL show its existing empty state.

## Design

### Core

- `src/core/range.ts`: `Range = { from: number; to: number }` (ms, `to`
  exclusive), `RangeChoice` (a preset id, or custom days), `resolveRange(choice,
  { now, timeZone, resets, firstMessage })`, `stepRange`, `rangeLabel`, and the
  hash parse/format. This week uses `weekStartFor` (`summary.ts:182`), so it
  matches today's Breakdown "This week" exactly. Custom days become local
  midnights through `startOfDay` (`aggregate.ts:48`).
- Builders gain explicit bounds instead of their constants. The constants become
  the defaults `buildSummary` passes, so the summary does not change:
  - `buildBreakdown(records, titles, from, to?)` (it takes `from` only today).
  - `buildActivity({ …, heatmap: Range, cache: Range, messages: Range })`.
  - `buildSessions({ …, range })`: days from the range, windows overlapping it.
  - `buildWeekHistory({ …, range? })`: with a range, weeks starting in it with no
    cap; without one, the latest 12 as today.
  - The daily series: `aggregate` on the range's records, bucketed by day or by
    weekly window.
- `src/core/ranged.ts`: `buildRanged(input: SummaryInput, range): RangedSummary`
  with `breakdown`, `usage` (rows + bucket), `activity` (heatmap, cache,
  outliers), `sessions`, `weekHistory`. Everything it needs that does not depend
  on the range (sorted snapshots, both calibrations, `fiveHourWindows`,
  `weeklyShares`, resets, `current`) moves from `buildSummary` into a shared
  `prepareSummary(input)` both call, so the two can never disagree.
- `buildSummary` drops `breakdown.fourWeeks` and `breakdown.all`: computed on
  every 5-minute poll over all records today, and now fetched on demand.

### Server

- `src/server/api.ts`: `GET /range` beside `/summary` (`api.ts:196`), same
  `tz` validation, data loaded as `summary(store, timeZone)` does without
  `collect`. A GET, so the POST `Origin` rule does not apply; it is
  loopback-only like `/summary`. Bounds checked: integers, `from < to`.

### Dashboard

- `tabs.ts`: `tabFromHash` ignores the query part; a `useRange()` hook reads and
  writes it; `tabHref(id, range?)` carries the range on the four history tabs'
  links.
- `RangePicker.tsx`: the presets in the existing `Toggle`, a Custom option with
  two `<input type="date">`, previous/next buttons (Lucide chevrons with an
  `aria-label`), and the resolved dates as text. Same component in each of the
  four tabs' toolbars.
- `useRanged(range)` in `App.tsx` or a hook: fetches `/api/range`, keeps the
  last answer while loading, refetches when the summary reloads and the range
  includes now; the default range reads the summary and fetches nothing.
- `anonymize.ts`: an `anonymizeRanged` reusing the summary's masking of
  breakdown, sessions and week history, applied where the summary's is
  (`App.tsx`).
- `Pager.tsx`: previous/next and "page n of m" for the Session and Week lists.
  The Readings card keeps its "Show more".
- The Sessions block chart pages by 7 days within the range; it keeps its
  layout.

### Edge cases

- A range before the first message: empty states, previous disabled.
- A range crossing a plan change: the Weeks chart already marks each week's
  plan; the ranged builders take the plan per week from `planAt`, as today.
- DST inside a range: days are stepped at UTC noon as `buildSessions` does.
- A year of records: `buildRanged` filters records to the range first; the
  shared preparation already runs on every summary today.

## Checklist

- [ ] Design (only if the user wants it): a "History ranges" page in the
  project canvas (URL in `AGENTS.md`): the picker in a tab toolbar, the
  Sessions chart pager and the list pager, light and dark.
- [x] `src/core/range.ts` + tests: presets resolved against `now`, resets and
  the first message; stepping; hash round trip; invalid input falls back.
- [x] Bounds on `buildBreakdown`, `buildActivity`, `buildSessions`,
  `buildWeekHistory` and the daily series, defaults unchanged. The existing
  tests pass untouched; new tests for an explicit past range on each.
- [x] `prepareSummary` extracted, `buildRanged` added. Test: `buildRanged` on
  the default windows equals the summary's sections. Remove
  `breakdown.fourWeeks`/`all` from the summary and their uses.
- [x] `GET /api/range` + tests (valid answer, 400 cases, no collector run).
- [x] `tabs.ts` hash query, `useRange`, `RangePicker`, `loadRange`,
  `useRanged`, `anonymizeRanged`, with tests (hash restore, preset kept across
  tabs, anonymize masks ranged titles and projects).
- [x] Breakdown on the picker.
- [x] Usage on the picker (bucket switch, subtitles).
- [x] Sessions on the picker, chart pager, `Pager` on the list.
- [x] Weeks on the picker, `Pager` on the list.
- [x] `AGENTS.md`: the `/api/range` route, the hash query, the anonymize rule for
  ranged data. Backlog: delete nothing it does not finish; add the out-of-scope
  items below.
- [x] Browser check of the four tabs on the real data: default view unchanged,
  a past month, All time, light and dark, anonymize on.

## Out of scope (to `docs/backlog.md` when the plan starts)

- Comparing two periods side by side, or deltas against the previous period.
- Ranges on the Calibration tab (drift beyond 12 weeks) and on Model ratios.
- Exporting a range (CSV).
