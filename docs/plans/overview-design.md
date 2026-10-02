# Overview matches the design

## Goal

Replace the Overview tab's content with the design's Overview artboard
(<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>, "Overview (Plan tab)" and
"Meter edge cases"): two limit cards side by side, budget pacing, past weeks and
the typical week on each plan. The current cards, stat boxes and bar chart go.

## Acceptance criteria

- WHILE the window is at least 900 px wide, THE SYSTEM SHALL show the weekly and
  5-hour cards side by side; below that, one above the other.
- THE SYSTEM SHALL show in each limit card: the title, its reset time next to it
  ("resets today, 17:50" or "resets Fri 2 Oct, 09:00"), the used % as a large
  number (with `≈` when estimated), the meter, and one verdict line.
- THE SYSTEM SHALL NOT show the stat boxes (used at last reading, resets,
  projection method) nor a projected/likely line beside the large number.
- WHEN no cap is expected, THE SYSTEM SHALL show "✓ You should last the week."
  with "Even a busy pace ends around X%." (5-hour: "✓ No cap expected this
  session." with the time left in the window).
- WHEN the median projection is 85 % or more without reaching the cap, THE
  SYSTEM SHALL show "! Tight, but you should last the week." with "A busy pace
  could reach X%." (5-hour: same wording for the session).
- WHEN the projection reaches the cap before reset, THE SYSTEM SHALL show
  "▲ Likely to hit the limit <day time>." on a red-tinted box and, when
  calibrated, "Spend under $X/day to last until the reset."
- IF the last reading is more than 6 hours old THEN THE SYSTEM SHALL keep the
  card's normal layout, dim the large number, mark it `≈`, and put a warning
  icon next to it that opens an explanation on hover and on click.
- WHEN a new week has started without a reading, THE SYSTEM SHALL show the
  weekly card as usual: reset = previous reset + 7 days, used = the usage seen
  in transcripts since the week started (a plain 0 %, without `≈`, when there
  is none; claude.ai use stays unseen until the first reading), and the
  projection.
- IF there is neither a calibration nor a completed week THEN THE SYSTEM SHALL
  project the weekly window from its own pace once 12 hours have passed, and
  before that use the typical week (median of past final %, range = 25th–75th
  percentile); the 5-hour window keeps its own-pace fallback.
- IF no projection or no window is available at all (fresh install, first
  hours without history) THEN THE SYSTEM SHALL show the card's title and
  "ⓘ Not enough history yet." with how the first projection arrives.
- IF the last 5-hour window has reset THEN THE SYSTEM SHALL show the 5-hour
  card's title and "ⓘ No session in progress."
- WHILE the current week has a reading, THE SYSTEM SHALL show "Budget pacing
  this week": the window's dates, the weekly % readings so far as a solid line,
  an even pace from 0 % to 100 % as a dashed line, the projection from now to
  reset as a dotted line with its likely range as a band, a "now" marker and
  the limit, each labelled on the chart.
- WHEN calibrated, THE SYSTEM SHALL show "Room left: ≈ $X/day to reach 100% at
  reset", with a tooltip giving this week's spend per day so far.
- WHEN completed weeks exist, THE SYSTEM SHALL list up to the last 8 as
  horizontal bars, newest first ("Week of <start>"), on the current plan, with a
  dashed marker at the typical week, "▲" and red for weeks at 100 %, and a
  hatched bar marked "est." for estimated weeks; IF none exist THEN THE SYSTEM
  SHALL say so in the card.
- WHEN a typical week exists, THE SYSTEM SHALL show "Typical week on each plan":
  one bar per plan with its %, the current plan marked "(current)", bars over
  100 % striped and capped with a legend, and the min–max range as tooltip.
- THE SYSTEM SHALL mark each limit card's verdict with a 6 px band across the
  top of the card and a tinted verdict box, both in the verdict's color: green
  (no cap expected), orange (tight), red (cap expected or reached); IF the card
  shows "Not enough history yet" or "No session in progress" THEN THE SYSTEM
  SHALL show neither. A stale reading does not change them.
- THE SYSTEM SHALL draw status marks as Lucide icons, never text symbols or
  emoji: circle-check (fine), circle-alert (tight), triangle-alert (cap
  expected, over the limit, a week that hit it, stale reading), info
  (informational messages); the header's theme toggle uses Lucide moon/sun.
- THE SYSTEM SHALL keep every colored element paired with a label, icon or line
  style, and give each number a `title` tooltip.

## Design

**States.** Drawn on the "Card states" board of the design. The weekly card has
two states besides normal: estimated (stale reading or no reading this week,
large number dimmed with `≈` and a warning icon + popover) and "Not enough
history yet". "Too early to project" no longer exists as its own state.

**Icons.** `lucide-react` (ISC license, 1.50.0 checked on npm): tree-shaken
React components, the standard set for this kind of UI and the one drawn in the
design. Icons are `aria-hidden` next to their text, colored by status
(`--good`, `--warning`, `--critical`, `--text-secondary`); shape and text carry
the meaning, so color is never the only cue. Text symbols (✓ ! ▲ ⓘ ⚠) are
removed from the dashboard, including the existing verdicts and the meter's
over-limit chip.

**Status colors.** "Both" option of the design: band and tinted verdict box,
through `card-good|tight|cap` and `verdict-good|tight|cap` classes using
`--good`, `--warning`, `--critical` and their `-bg` tints (light and dark
values from the design). A band is a large color area, readable with
deuteranomaly; the verdict icon's shape and text carry the same meaning, so
color is never the only cue.

**Core.** `forecastWindow` gets a third method, `typical`: without a calibration
and before the trend is usable, the weekly projection is the typical week
(quantiles of past final %, converted to the current plan, never below used).
`buildSummary` builds `current` without a reading for this window when a
previous reset exists: the window is the previous reset + 7 days, used is the
calibrated cost since its start (0 without usage), flagged `estimated`. The
popover text comes from the reading's age and the endpoint status.

`src/core/pacing.ts`, `weekPacing(...)`: from the current window's
readings (or the estimate at now), returns `{ from, to, points: { at, percent }[],
roomPerDay?, spentPerDay }`. `roomPerDay` = (100 − used now) ÷ k ÷ days left;
`spentPerDay` = cost since window start ÷ days elapsed. Added to `CurrentWeek` as
`pacing`. Unit-tested (no readings, stale reading, past 100 %, last day).

**Dashboard.** `Overview.tsx` replaces `ThisWeek.tsx` and `PerWeek.tsx`:
`LimitCard` (title, reset, big number, `Meter`, `Verdict`), `PacingChart`
(inline SVG with CSS variables, like the design; Recharts is kept for the Usage
tab), `PastWeeks`, `PlanEquivalents`. `Meter` moves to its own `Meter.tsx`.
`formatResets` in `format.ts` ("today, 17:50" / "Fri 2 Oct, 09:00").

**Styles.** The design's look: cards on `--surface-2` with 10 px corners, content
up to 1180 px, the verdict as a grey box (red-tinted when the cap is expected).
These card styles apply to every tab; Usage and Calibration get their own
restyle in later milestones. Dead classes (`.stats`, old `.verdict`) are removed.

**Edge cases.** No calibration: no "Room left", projection and range from the
trend method as today. Projection past 100 %: the pacing chart's scale extends
like the meter's. A plan change mid-history: past weeks are converted to the
current plan as today.

**Backlog.** "Budget pacing for the current week" is done by this milestone and
deleted from `docs/backlog.md`.

## Checklist

- [ ] Baseline: lint, tests, build
- [ ] Add `lucide-react`; `npm audit`; replace every text symbol with its icon
- [ ] `weekPacing` in `core/pacing.ts` with tests; `pacing` in `CurrentWeek`
- [ ] `typical` forecast method with tests; `current` for a week without a reading, with tests
- [ ] `formatResets` with tests
- [ ] `Meter.tsx` extracted (tests move with it)
- [ ] `LimitCard` + `Verdict` with status band and tint, with tests (good, tight, cap, estimated with popover, new week at 0 %, not enough history, no session)
- [ ] `PacingChart` with tests (lines present, labels, room left with and without calibration)
- [ ] `PastWeeks` with tests (order, 8 max, typical marker, ▲, est.)
- [ ] `PlanEquivalents` with tests (current, over 100 %, tooltip range)
- [ ] `Overview.tsx` wired in `App.tsx`; delete `ThisWeek.tsx`, `PerWeek.tsx`, dead CSS
- [ ] Update App tests; README if a feature line changes; backlog item deleted
- [ ] Lint, tests, build; compare with the design in a browser, both themes, phone width
- [ ] Review pass
