# Max and Ultra: renamed plans, Ultra's weekly limit, no 5-hour limit

## Goal

Anthropic renamed Max 5× to **Max** and Max 20× to **Ultra** (prices unchanged:
$100 and $200), and verified Ultra accounts have no 5-hour limit. The dashboard
and widget use the new names, compare plans with Ultra's advertised weekly
limit, and stop showing a 5-hour limit to an account that has none.

Sources: <https://support.claude.com/en/articles/11049741-what-is-the-max-plan>
(Max: 5× Pro every five hours and every week) and
<https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan>
(Ultra: 10× Pro every week; verified accounts have no five-hour limit, newer
ones keep a temporary one; Settings > Usage shows no "Current session" bar when
verified). Both plans also have a separate weekly Fable limit: out of scope, see
"Out of scope".

## Acceptance criteria

- AC1: Every label, tooltip and sentence that names a plan says "Pro", "Max" or
  "Ultra" (header badge, Plans tab, plan history, settings, Weeks, pacing
  chart, value card, README). Check: tests updated to the new labels;
  `grep -rn "Max 5×\|Max 20×" src README.md` finds nothing.
- AC2: The stored plan ids stay `pro`, `max5`, `max20`: an existing
  `settings.json` plan history and snapshots load unchanged. Check: existing
  tests with `max5`/`max20` fixtures pass untouched.
- AC3: Weekly conversions use Pro 1, Max 5, Ultra 10; 5-hour conversions use
  Pro 1, Max 5 and have no Ultra value. Check: `plans.test.ts` (100% of Max's
  week is 50% of Ultra's; a Max 5-hour % has no Ultra equivalent).
- AC4: On the Plans tab, Ultra's card counts no session over the limit, and its
  weekly %s are those of a 10× limit. Check: `planFit.test.ts`.
- AC5: The multipliers card advertises Max → Ultra as 2×, and its subtitle says
  "5× and 10× Pro's weekly usage". Check: `multipliers.test.ts`, `Plans.test.tsx`.
- AC6: WHEN the plan is Ultra and the latest endpoint reading has no 5-hour
  window, THE SYSTEM SHALL show the 5-hour card as "No 5-hour limit on this
  account" (no forecast, no estimate from transcripts), and the widget's 5-hour
  row as "none" instead of 0%. Check: `Overview.test.tsx`, `widget.test.ts`,
  widget snapshot.
- AC7: WHEN the plan is Ultra and a reading does have a 5-hour window (an
  account not verified yet), THE SYSTEM SHALL treat it as today's 5-hour
  limit, calibrated on its own readings. Check: `summary.test.ts`.
- AC8: The collector detects Ultra from `subscriptionType: 'max'` with a
  `20x` rate-limit tier (as today) or from `subscriptionType: 'ultra'`.
  Check: `plans.test.ts`.

## Design

- `core/plans.ts`: `PLAN_LABELS` becomes `{ pro: 'Pro', max5: 'Max', max20: 'Ultra' }`.
  `PLAN_MULTIPLIERS` splits into `WEEKLY_MULTIPLIERS` (1/5/10) and
  `FIVE_HOUR_MULTIPLIERS` (1/5, Ultra absent). `convertPercent` takes the
  window (`'week' | 'fiveHour'`) and returns `undefined` for a 5-hour
  conversion to or from Ultra; callers on 5-hour data (`sessions.ts`,
  `planFit.ts` sessions, `summary.ts` borrowed 5-hour fit) handle it: a session
  that cannot be converted counts as not over, a borrowed 5-hour fit from or to
  Ultra is skipped. Weekly callers keep a number (a `convertWeekly` helper
  keeps their call sites short).
- Ultra's 5-hour limit: present only when the readings show it. "Has a 5-hour
  limit" = the plan is not Ultra, or the latest endpoint reading on the current
  Ultra period has a `fiveHour` value. Without one, `buildSummary` sets
  `fiveHourSession` to a `{ none: true }` state instead of an estimate, and
  the transcript-only 5-hour estimates in Sessions are skipped for Ultra
  windows (their % is undefined).
- The Plans tab's hypothetical Ultra assumes a verified account (no 5-hour
  limit): what a user upgrading gets once verified.
- `restarts.ts` compares plan sizes with the weekly multipliers.
- Widget: `WidgetRow` gains `none?: true`; `view.rs` shows "none" for it, like
  an idle row but without a percent; the golden image for this state is new.
- Detection: `planFromSubscription` also maps `subscriptionType === 'ultra'`
  to `max20`. Unverified: no Ultra credentials were seen.
- `docs/decisions.md`: one entry, "Plan ids `max5`/`max20` stay under the Max
  and Ultra labels" (they are stored in plan histories and backups; renaming
  them needs a data migration for no visible change).
- CHANGELOG (Unreleased): the renamed plans, Ultra compared at 10× Pro's weekly
  usage, no 5-hour limit shown on verified Ultra accounts.

## Out of scope

- The separate weekly Fable limit (both plans): the endpoint's field for it is
  unknown. Claude's Settings > Usage on a Max account shows it as a third bar,
  "Fable: Up to 50% of your weekly limit", with the weekly reset time and its
  own % used, so it is a cap inside the weekly limit, not an extra allowance.
  Goes into the existing `[forecast]` backlog item on per-model weekly windows,
  which gains Fable and this shape.

## Checklist

- [x] **Rename**: labels in `core/plans.ts`, every test asserting "Max 5×" /
  "Max 20×", README ("Plan fit" line, "Other plans' figures" note),
  `MultipliersCard` subtitle text, CHANGELOG line, decisions entry. Verify:
  lint, tests, build, the grep in AC1.
  Visible after: the header badge and the Plans tab say "Max" and "Ultra".
  Needs you: nothing.
- [ ] **Weekly multipliers**: split multipliers, `convertPercent` by window,
  update every caller listed by `grep -rn convertPercent src`, Ultra sessions
  never over, multipliers card at 2×, backlog line for Fable. Tests per AC3–AC5.
  Visible after: the Plans tab's Ultra card shows weeks about twice as full as
  before and no sessions over the limit; the multipliers card says 2×.
  Needs you: a look at the Plans tab (at the end).
- [ ] **No 5-hour limit**: summary state, Overview card, Sessions skip, widget
  row and snapshot, detection of `ultra`. Tests per AC6–AC8; widget
  `npm run widget:test`.
  Visible after: nothing on a Max account; an Ultra account sees "No 5-hour
  limit" on the Overview and "none" in the widget.
  Needs you: nothing (no Ultra account to check against; fixtures only).
- [ ] Delete this plan in the final commit, naming its path in the message.
