# Usage tab

## Goal

Rebuild the Usage tab to match the design board `Activity.dc.html`
(<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>): the daily/weekly chart
restyled, plus when you work (weekday × hour heatmap), cache efficiency and
cost per message with outliers. Claude Code upgrades are marked on the daily
chart (not drawn on the board; specified here).

## Acceptance criteria

### Usage chart

- THE SYSTEM SHALL show the card "Daily usage by model" ("Weekly usage by
  model" in Week mode) with a subtitle naming the range and unit ("last 35
  days, API-equivalent dollars"), the Dollars/Tokens and Day/Week toggles on
  the title row, stacked bars per model family and the legend under the chart.
- WHEN the Day view is shown, THE SYSTEM SHALL mark each local day on which the
  highest Claude Code version seen so far rose, with a dashed vertical line and
  the new version as a label, and add `Claude Code <version>` to that day's
  tooltip. The first version ever seen is not an upgrade.
- WHEN several upgrades happen the same day, THE SYSTEM SHALL draw one marker
  labelled with the day's last version.
- THE SYSTEM SHALL stack Opus at the bottom of each bar (the families in
  `SERIES` order, bottom to top), unlike the board.
- WHEN the user hovers a bar, THE SYSTEM SHALL show each family's value and the
  bar's total in the tooltip, the families in the bars' bottom-to-top order.
- THE SYSTEM SHALL write dollar amounts as "$", never "US$", across the
  dashboard (axis ticks and tooltips included).
- THE SYSTEM SHALL not show the current "Table view" under the chart (not on
  the board).

### When you work

- THE SYSTEM SHALL show a 7 × 24 grid (Monday first, local hours 00–23) of the
  average cost per weekday and hour over the last 28 days, the average being
  the cell's total divided by how many of that weekday the range holds. The
  range starts no earlier than the first imported day.
- THE SYSTEM SHALL fill each cell in one of 5 steps of a single hue (darker =
  more in light theme, lighter = more in dark), an empty cell outlined only,
  give every cell a tooltip with the weekday, hour and average $ per day, and
  show the less/more scale under the grid.
- THE SYSTEM SHALL name the busiest hour ("Busiest: Tue 14:00–15:00").
- IF the range has no usage THEN THE SYSTEM SHALL show an empty state instead
  of the grid.

### Cache efficiency (this weekly window, as the Breakdown's "This week")

- THE SYSTEM SHALL show the cache-read share of input tokens, the dollars saved
  (cache-read tokens × (input price − cache-read price)) and the share of cost
  spent on cache writes, each with a `title` tooltip.
- THE SYSTEM SHALL show the daily cache-read share for the last 14 local days
  with a dashed 90% reference line; days under 80% are drawn hatched (not only
  in another color) and the legend explains both fills and the line. A day
  without usage has no bar.

### Cost per message (this weekly window)

- THE SYSTEM SHALL show a histogram of message costs in 8 bins (<1¢, 1–3¢,
  3–10¢, 10–30¢, 30¢–$1, $1–3, $3–10, >$10) with log-scaled bar heights and the
  count above each bar.
- THE SYSTEM SHALL list up to 5 of the week's most expensive messages costing
  $1 or more, each with its local time, project, cause and cost, and the total
  count when more than 5 qualify.
- THE SYSTEM SHALL describe the cause as the largest cost component ("1h cache
  write, 554k tokens", "5m cache write, …", "output, …", "input, …"), followed
  by "after a 3 h pause" WHEN the previous message of the same conversation is
  older than that cache's lifetime (5 min or 1 h).
- IF no message reaches $1 THEN THE SYSTEM SHALL say so instead of the list.

### All cards

- IF the weekly window has no usage THEN the cache and cost-per-message cards
  SHALL show an empty state.
- WHILE the viewport is phone-width, THE SYSTEM SHALL stack the cache and
  cost-per-message cards and wrap the chart's toggles under its title.
- THE SYSTEM SHALL match the board in light and dark themes, never carry
  meaning by color alone, and give every metric a `title` tooltip.

## Design

**Computed on the server**, as the Breakdown: a new pure module
`core/activity.ts` and one new field in the summary,
`activity: Activity`. Everything is small (168 heatmap cells, 14 days, 8 bins,
5 outliers, a few upgrades).

```ts
interface Activity {
  /** Average $ per day, [weekday Monday=0][hour]; days in the range per weekday. */
  heatmap: { cells: number[][]; from: string; to: string };
  cache: {
    week: { readShare: number; saved: number; writeCostShare: number } | undefined;
    daily: { day: string; readShare?: number }[];   // 14 days, undefined = no usage
  };
  messageCost: {
    bins: number[];                                  // counts, 8 bins
    outliers: { ts: string; name: string; path: string; cost: number;
                cause: 'input' | 'output' | 'cacheWrite5m' | 'cacheWrite1h';
                tokens: number; pauseMs?: number }[];
    outlierCount: number;
  };
  /** Days (local) on which the highest Claude Code version seen rose. */
  upgrades: { day: string; version: string }[];
}
```

- **Heatmap.** Weekday and hour come from `Intl.DateTimeFormat` in the
  request's time zone. Formatting ~30k timestamps per request is the cost, so
  results are memoized per 15-minute slot (keeps half-hour time-zone offsets
  right). Range: the last 28 local days including today, clipped at the first
  record's day; weekday counts come from the clipped range.
  Steps: `ceil(value / max × 5)`, computed in the dashboard.
- **Cache.** `readShare = cacheRead / (input + cacheRead + cacheWrite5m +
  cacheWrite1h)`, as the Breakdown's project cache share. `saved` and
  `writeCostShare` need per-component costs: `pricing.ts` gains
  `costParts(record)` returning `{ input, output, cacheWrite5m, cacheWrite1h,
  cacheRead }` in USD (fast-mode multiplier applied), and `messageCost` sums it.
- **Cost per message.** Bin edges are fixed constants. The outlier's project
  uses the conversation's start directory, like the Breakdown: the
  `startCwd` map moves out of `buildBreakdown` into an exported
  `sessionProjects(records)` both modules use. The pause is the gap to the
  previous message of the same `sessionId` (main agent and subagents
  together), reported only when it exceeds the lifetime of the dominant cache
  write. Real data backs this: the 8 costliest messages of the last week
  ($1.70–$4.44) are all 1h cache writes of 200k–550k tokens.
- **Upgrades.** Versions compare numerically (`compareVersions` moves from
  `collector/scan.ts` into `core` so both use it). Walk records by time and
  keep the running maximum; a record raising it adds (or replaces) its day's
  entry. Older versions from other surfaces do not count: real data has
  `sdk-py` on 2.1.281 the same day VS Code ran 2.1.287. Only days inside the
  daily chart's 35 days are returned.
- **Week start.** Cache and cost-per-message use the `weekStart` already
  computed for the Breakdown.

**Dashboard.** `RawUsage.tsx` becomes `UsageChart.tsx` (the restyled chart
card), and a new `Usage.tsx` lays out the tab: the chart, the heatmap card,
then a two-column grid with the cache and cost-per-message cards. Each card is
its own component (`Heatmap.tsx`, `CacheCard.tsx`, `MessageCostCard.tsx`).

- The chart stays on Recharts; upgrades are `ReferenceLine`s on the day's
  category with a dashed stroke and a vertical (rotated) label, so labels on
  consecutive days never collide. Markers are hidden in Week mode.
- The tooltip is a custom Recharts `content` component: families in `SERIES`
  order (Opus first, the bars' bottom-to-top order), then the total, then the
  upgrade line when there is one.
- "US$": the en-GB currency formatter writes it; `formatUsd` and
  `formatUsdShort` pass `currencyDisplay: 'narrowSymbol'` to get "$".
- The heatmap and the small bar charts are plain CSS grid/flex elements, as on
  the board: no chart library needed for them.
- Heat colors are 5 tokens `--heat-1`…`--heat-5` in `styles.css` (light block
  and both dark blocks), from the board's ramps. The "under 80%" fill reuses the
  existing critical hatch.
- `Toggle` keeps its markup; its style moves to the board's segmented look if
  it differs.

**Edge cases.**

- Unknown-price models cost 0, as elsewhere: they land in the <1¢ bin.
- A record without `sessionId` has no pause.
- A record without `version` is ignored by the upgrade walk.
- DST: the 25-hour day adds its repeated hour to one cell; accepted.

## Checklist

- [ ] Baseline: lint, tests, build
- [ ] `pricing.ts` `costParts`, `messageCost` built on it, with tests
- [ ] `compareVersions` and `sessionProjects` moved into `core`, importers updated
- [ ] `core/activity.ts` with tests: heatmap (weekday counts, clipped range, time zone, Monday first), cache week and daily (empty days), histogram bin edges, outlier threshold/limit/count, cause and pause, upgrades (running max, same day, older surface versions, first version not counted)
- [ ] `buildSummary` `activity`, with tests (week start shared with the Breakdown)
- [ ] `format.ts` "$" instead of "US$", with tests
- [ ] `UsageChart.tsx` restyled, with upgrade markers, the total in the tooltip, Opus at the bottom, no table view
- [ ] `Usage.tsx`, `Heatmap.tsx`, `CacheCard.tsx`, `MessageCostCard.tsx`, styles (both dark blocks), `App.tsx` branch, with tests (empty states, busiest hour, outliers and count, tooltips, markers only in Day mode)
- [ ] Browser check against the board: light and dark, desktop and phone width
- [ ] Docs: README feature list and tab description; delete the done backlog items (heatmap, cache efficiency, cost-per-message, version timeline); delete milestone 1 from the roadmap; decisions entry for outliers and upgrade markers
- [ ] Review pass, then lint, tests, build
