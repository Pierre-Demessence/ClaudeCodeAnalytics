# Plans tab

Design: <https://claude.ai/artifact/UsQ7hjznri4Nm4Ax48CCK6> (boards `Main.dc.html`
and `States.dc.html`).

## Goal

A seventh tab, **Plans**, between Weeks and Calibration. It re-reads the last 12
weeks of usage as a % of each plan's limits and says which plan fits best, with
a what-if that re-prices Opus work as Sonnet across the whole tab, and a strip
showing how far the advertised plan multipliers can be trusted.

## Acceptance criteria

- WHEN at least 3 completed weeks have a percent, THE SYSTEM SHALL show the best
  plan, the three plan cards, the per-week chart, the what-if card and the trust
  strip.
- IF fewer than 3 completed weeks have a percent THEN THE SYSTEM SHALL show only a
  "not enough history" card with the count so far.
- THE SYSTEM SHALL give each plan one verdict: **fits** (never over the limit in
  the 12 weeks or the 5-hour sessions, busiest week at least 50% of the limit),
  **close** (over in 1 or 2 weeks, with at most a tenth of the sessions over), **too small** (over in
  3 or more weeks) or **too big** (never over, busiest week under 50%). Every
  verdict has an icon and a text, never color alone.
- THE SYSTEM SHALL pick the best plan by verdict (fits, close, too big, too small),
  then fewer weeks over, fewer sessions over, lower price. The best-plan card
  names only that plan: its verdict, the weeks (dates when 3 or fewer) and
  sessions over the limit, and whether switching saves or costs money per month.
- WHEN the user moves the Opus-to-Sonnet share (None, 25%, 50%, All), THE SYSTEM
  SHALL recompute the best plan, the plan cards and the chart, and label the best
  plan card with the active share. The share is not persisted.
- WHEN a week or session reached the limit on the current plan, THE SYSTEM SHALL use
  the transcript estimate (calibration × cost) when it is higher than the capped
  reading, mark it estimated (hatched bar), and fall back to the capped value
  without a calibration.
- THE SYSTEM SHALL convert weeks and sessions between plans with the advertised
  multipliers, as `convertPercent` does today.
- WHEN the chart plan is changed, THE SYSTEM SHALL redraw the 12 weeks on that
  plan; bars over 100% are hatched with a warning icon and capped at 150%.
- THE SYSTEM SHALL show per plan the price per month and "API value per $ paid"
  (the typical month at API prices that fits under the plan's limit, divided by
  the price), and hide the value without a calibration.
- WHEN both plans of an adjacent pair (Pro/Max 5×, Max 5×/Max 20×) have at least 3
  completed drift windows, THE SYSTEM SHALL show the measured multiplier with its
  likely range next to the advertised one; otherwise "not measured".
- THE SYSTEM SHALL keep the tab usable at phone width and in both themes.

## Design

### Core (pure, no Node/DOM)

- `pricing.ts`: `sonnetSaving(record)`: for an Opus message, its cost minus the
  cost of the same tokens at the newest Sonnet price (fast-mode surcharge
  dropped); 0 for other models.
- `weekHistory.ts` / `sessions.ts`: each `WeekRow` and `FiveHourWindow` gains
  `shift?: number`, the fraction of its cost saved if all Opus ran on Sonnet.
  The saving is linear in the share moved, so the dashboard recomputes any share
  without a server round trip: `demand × (1 − share × shift)`.
- `planFit.ts` (new):
  - `PLAN_PRICES` (in `plans.ts`), thresholds as named constants.
  - `buildPlanFitInput(...)`: the last 12 completed weeks with a percent (`demand`,
    `estimated`, `cost`, `shift`) and the 5-hour sessions of those weeks
    (`demand`, `estimated`, `shift`). Demand is the final % on the current plan;
    when it reached 100, `max(100, k × cost)` with the matching calibration.
  - `evaluatePlans(input, share)`: per plan, typical (median) and busiest week,
    weeks and sessions over (≥ 100% after conversion), their dates, verdict, API
    value ratio.
  - `bestPlan(evaluations)`: the ranking above.
- `multipliers.ts` (new): drift ratios per plan (`limits.ts` `driftWindows` takes
  the plan instead of using the current one), measured ratio between adjacent
  plans from the medians, range from the quartiles (`low = q25(from) / q75(to)`,
  `high = q75(from) / q25(to)`), window counts.
- `summary.ts`: `DashboardSummary.planFit` (input above) and `multipliers`.

### Dashboard

- `tabs.ts`: `{ id: 'plans', label: 'Plans' }` after `weeks`; `App.tsx` branch.
- `Plans.tsx` with local state (`share`, chart plan) and focused children:
  `BestPlanCard`, `WhatIfCard` (reuses `Toggle`), `PlanCards`, `WeekChart`,
  `MultipliersCard`; formatting helpers in `plansData.ts`.
- Tooltips through `useTip` / `InfoTip`; icons from Lucide (circle-check,
  circle-alert, triangle-alert, circle-arrow-down); patterns for hatched bars
  follow the Weeks tab (`week-bar hit` / `estimated`), never color alone.
- The Overview's `PlanEquivalents` card and `summary.typical` (its only reader) are removed; this tab replaces them. `VerdictBox` moves out of `Overview.tsx` to be shared.

### Assumptions and failure modes

- Limits scale with API price across models (already in `decisions.md`); least
  certain for Opus versus Sonnet, so the card says "Approximate".
- "Opus as Sonnet" uses the newest Sonnet price, not the Sonnet of the same
  generation: the question is what the work would cost today.
- A week with the real reading at 100% has unknown true demand. With a calibration
  the estimate ignores claude.ai usage in that week (understated); without one the
  capped 100 is a lower bound, and scaling it down for a shift can hide a miss.
- Advertised multipliers drive every conversion; measured ones only inform.
- List prices ($20 / $100 / $200) are verified against Anthropic's pricing page
  before they go in `plans.ts`.

## Checklist

- [x] Verify the current Pro, Max 5× and Max 20× list prices
- [x] `sonnetSaving` + tests
- [x] `shift` on `WeekRow` and `FiveHourWindow` + tests
- [x] `planFit.ts`: input builder, `evaluatePlans`, `bestPlan` + tests (verdict
  edges, ranking and tie-breaks, censored weeks, linear shift)
- [x] `limits.ts` drift per plan; `multipliers.ts` + tests
- [x] `summary.ts`: `planFit`, `multipliers` + test
- [x] Tab entry, `Plans.tsx` and children, styles (both themes), tests
- [x] Browser check against the design (light and dark, phone width)
- [x] Docs: delete the roadmap item and the two backlog items it covers; add
  decisions (Sonnet price, ranking and thresholds, censored weeks); new backlog
  items (use measured multipliers for conversions, uncapped demand including
  claude.ai, shifts other than Opus to Sonnet); `AGENTS.md` layout line
- [x] Lint, test, build; one review pass; delete this plan in the final commit

Status: implemented and checked in the browser; left: review pass, then delete this plan in the final commit. Baseline was lint clean, 341 tests.
