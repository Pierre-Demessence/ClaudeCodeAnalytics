# Dashboard shell: tabs, header, theme, meters

## Goal

Turn the single-page dashboard into the tabbed layout of the redesign
(<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>), with a header holding
Refresh and a light/dark toggle, and the weekly and 5-hour meters labelled on
the bar itself. No new analytics: existing views move into their tabs.

## Acceptance criteria

- WHEN the dashboard loads with no hash, THE SYSTEM SHALL show the Overview tab
  (This week, 5-hour session, Share of the plan per week).
- WHEN the user selects the Usage tab, THE SYSTEM SHALL show the daily/weekly
  usage by model, and set the URL hash to `#/usage`.
- WHEN the user selects the Calibration tab, THE SYSTEM SHALL show the settings,
  readings and collection status, and set the hash to `#/calibration`.
- WHEN the page loads or the hash changes to a known tab, THE SYSTEM SHALL show
  that tab; IF the hash names no known tab THEN THE SYSTEM SHALL show Overview.
- THE SYSTEM SHALL mark the active tab with `aria-current="page"` and a visual
  cue that is not color alone (weight and underline).
- WHILE a summary is loaded, THE SYSTEM SHALL show in the header the current
  plan, the age of the last reading (with its exact time as tooltip), a Refresh
  button and, right of it, the theme toggle.
- WHEN the user presses Refresh, THE SYSTEM SHALL import transcripts and call
  the endpoint, as "Refresh now" does today; the Calibration tab no longer has
  its own button.
- WHEN no theme was chosen, THE SYSTEM SHALL follow the OS color scheme.
- WHEN the user presses the theme toggle, THE SYSTEM SHALL switch to the other
  theme, show a moon (to dark) or sun (to light) icon with a matching
  `aria-label`, and remember the choice in `localStorage`.
- IF `localStorage` is unavailable THEN THE SYSTEM SHALL still toggle the theme
  for the current page.
- WHEN a meter segment (used, projection) is wide enough for its label, THE
  SYSTEM SHALL draw the label inside it; otherwise above the bar, aligned to the
  segment's start and underlined, the two outside labels never overlapping.
- WHEN used is 0 %, THE SYSTEM SHALL draw no used segment and put "used 0%"
  above the bar.
- THE SYSTEM SHALL draw "likely X–Y%" centred under the range bracket, kept
  inside the card, and "limit 100%" where it cannot collide with the bracket.
- WHEN the projection or the range passes 100 %, THE SYSTEM SHALL extend the
  scale, stripe the part past the limit and label it "▲ +N%".
- THE SYSTEM SHALL put "limit 100%" above the bar by the cap line where it
  overlaps no other label, else below the bar left of the line where it clears
  the bracket, else above the bar with the other labels moved around it.
- THE SYSTEM SHALL drop the meters' separate legend and tick rows.

## Design

**Tabs.** `src/dashboard/tabs.ts`: the tab list (`overview`, `usage`,
`calibration`; Breakdown and Sessions arrive with their features) and
`useTab()`, which reads `location.hash` and listens to `hashchange`. Tabs are
`<a href="#/usage">` links, so the browser back button and bookmarks work
without a router dependency. `App.tsx` renders the active tab's components; the
auto-reload and request guard stay as they are.

**Header.** `src/dashboard/Header.tsx`: app title, plan badge, "Last reading
4 min ago" (`formatRelative`, `title` = exact time), Refresh (calls the existing
`refreshNow`, disabled while busy), theme toggle, then the tab `<nav>`. The
"Updating…" indicator moves here. `SettingsPanel` loses its Refresh button and
`onRefresh` prop.

**Theme.** `src/dashboard/theme.ts`: `useTheme()` returns the effective theme
and `toggle()`. Stored as `cca-theme` = `light` | `dark`, every access in
try/catch; applied as `data-theme` on `<html>`. With nothing stored, no
attribute is set and the existing `prefers-color-scheme` block applies; the
first toggle flips from the OS scheme (`matchMedia`). `styles.css` gets the dark
variables a second time under `:root[data-theme='dark']` (CSS cannot share one
block between a media query and an attribute selector without a preprocessor).
Recharts already uses CSS variables, so charts follow. Icons are inline stroke
SVGs (`currentColor`).

**Meter.** Rewritten in `ThisWeek.tsx`, keeping `scaleMax` for the scale.
Whether a label fits is measured, not guessed: each label is rendered once
off-screen, and one `ResizeObserver` on the track and those copies reports their
widths before the first paint and on every resize; a label fits when the segment's px width ≥ label width + padding. jsdom has no
layout, so tests inject widths through a small `measure` prop (default: the
real measurement). Rows from top to bottom: outside labels and "limit 100%" (or
nothing), the bar, the bracket, "likely X–Y%". Over the limit: the projection
segment stops at 100 %, a striped `.meter-over` segment with "▲ +N%" runs to the
median. "limit 100%" is placed after the segment labels: above the bar ending at
or starting after the cap line, else below the bar left of it, else above with
the segment labels routed around it. A fixed rule (always below when over the
limit) collides with the bracket whenever the range starts under 100 %. The `≈` prefix for
estimated usage stays in the used label. The old tick helpers in `scale.ts`
and their tests are deleted.

**Edge cases.** Stale reading warning and "too early to project" stay as they
are. A range with high = low draws no bracket (as today). Phone width: labels
that do not fit inside go outside, which also covers narrow screens.

**Not in this plan.** Budget pacing, Breakdown and Sessions tabs, the redesigned
Calibration content and every other new analytic: see `docs/roadmap.md`.

## Checklist

- [x] Baseline: run lint, tests and build; note existing warnings
- [x] `tabs.ts` + `useTab()` with tests (default, known hash, unknown hash, hashchange)
- [x] `theme.ts` + `useTheme()` with tests (OS default, toggle, persistence, storage throwing)
- [x] `:root[data-theme='dark']` variables in `styles.css`
- [x] `Header.tsx` (badge, last reading, Refresh, theme toggle, tabs) with tests
- [x] `App.tsx` renders tabs; remove Refresh from `SettingsPanel`, update its tests
- [x] Meter rewrite with measured label fit, over-limit segment, bracket label; tests for inside, outside, 0 %, over 100 %
- [x] Remove unused scale helpers and their tests; remove dead meter CSS
- [x] README feature list: tabs and theme
- [x] Lint, tests, build; check both themes and phone width in a browser
- [x] Review pass

Status: done and verified; waiting for a commit request (delete this plan in that commit).
