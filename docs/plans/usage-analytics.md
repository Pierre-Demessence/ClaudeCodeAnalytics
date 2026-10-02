# Usage analytics

Status: phases 0–5 done (review: no blocking findings; fixes applied, the rest
in `docs/backlog.md`). Remaining
with Pierre: install the hook (`npm run hook:install -- --apply`) and confirm a
real endpoint snapshot (`npm run collect -- --force`): the agent's sandbox may
not read the credentials file.

## Goal

A local dashboard that answers, from Pierre's own data: **will I last the
week?** (projected weekly % at reset) and **what share of a plan do I use per
week?** (typical weekly %, translated across Pro / Max 5× / Max 20×), and shows
raw usage per day and per week by model.

## Settled choices

- **Limit data:** the undocumented OAuth usage endpoint from the start. Manual
  `/usage` logging exists on top and is optional.
- **UI:** browser dashboard, Vite + React.
- **Plan:** a setting, with history (Pierre is on Pro today; a later plan change
  must not break past data).
- **Automation:** collection runs automatically; the dashboard is opened on
  demand. No status line.

## Facts checked

- `~/.claude/settings.json` already has `cleanupPeriodDays: 365`, so the brief's
  "raise retention" prerequisite is done. Local transcripts start 2026-09-28
  (150 files across 9 projects, including `<session>/subagents/*.jsonl`).
- Node 24.20 is installed: it runs `.ts` files natively (type stripping), so the
  collector needs no build step or `tsx`.
- **Endpoint** (probed 2026-10-02 on Pierre's machine; undocumented):
  `GET https://api.anthropic.com/api/oauth/usage`, headers
  `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`.
  - User-Agent `claude-code-analytics/0.0.0` got **HTTP 429**;
    `claude-code/2.1.287` got **200** right after. The collector must send
    `claude-code/<version>`, with the version taken from the newest transcript
    entry's `version` field.
  - `five_hour` / `seven_day`: `{ utilization, resets_at }`. Utilization is a
    whole number in practice (`35.0`, `44.0`), so 1% resolution.
  - The weekly window is **fixed**: `seven_day_breakdown.window_started_at`
    = 2026-09-30T20:00Z and `seven_day.resets_at` = 2026-10-07T20:00Z, exactly
    7 days. `resets_at` carries microsecond jitter: round to the minute.
  - `seven_day_breakdown.rows`: share of the weekly usage per surface
    (`claude_code`, `chat`, `cowork`, `other`, in %). This separates Claude Code
    from claude.ai usage, which transcripts cannot see.
  - `seven_day_opus` / `seven_day_sonnet` are `null` on Pro; many unexplained
    codename fields (one with a $100 monthly limit). Only the documented-looking
    fields above are parsed; the rest is ignored.
  - Rate limits shared with Claude Code's own `/usage`; calls ≥3 min apart
    reportedly always succeed
    ([#31021](https://github.com/anthropics/claude-code/issues/31021),
    [Usage-Monitor #202](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202)).
- **Credentials** `~/.claude/.credentials.json`:
  `claudeAiOauth.{ accessToken, refreshToken, expiresAt (ms), scopes,
  subscriptionType, rateLimitTier }`. The access token lives about 7 hours;
  Claude Code refreshes it. `subscriptionType` (3 chars on Pro, presumably
  `pro`) and `rateLimitTier` are not secrets and let the collector detect the
  plan.
- **Transcripts** (all 150 files, 4,866 unique messages, 0 malformed lines):
  assistant entries carry `timestamp`, `requestId`, `isSidechain`,
  `message.id`, `message.model` and `message.usage` with `input_tokens`,
  `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
  and `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`.
  One API message is written once per content block (4,866 unique of ~2× as
  many entries); duplicates never span files. In 480 messages the duplicates
  differ, **only in `output_tokens`**, which grows monotonically: the last
  (= highest) value is final. Keeping the first occurrence would undercount
  output. Models seen: `claude-opus-5-5`, `claude-sonnet-5-5`,
  `claude-haiku-4-5-20251001`, and `<synthetic>` (10 local placeholder
  entries with null tier: excluded). 5 entries lack `requestId` (key falls back
  to `message.id`). `usage.speed` exists (`standard` or absent); a non-standard
  speed (fast mode) may need its own price multiplier.
- **Hooks:** command hooks accept `"async": true` (run in background, timeout
  not enforced). On Windows, use `node <script>` directly since `.cmd` shims
  need a shell.

## Acceptance criteria

Collection

- WHEN a Claude Code response finishes in any project, THE SYSTEM SHALL run the
  collector in the background without delaying or failing the session.
- WHEN the collector runs and the last endpoint call is older than the throttle
  (default 15 min), THE SYSTEM SHALL fetch the usage endpoint and append one
  snapshot (time, 5-hour and weekly utilization, reset times, Claude Code's
  share of the weekly usage, detected subscription).
- WHEN the collector runs, THE SYSTEM SHALL import new assistant messages from
  all transcripts (including subagent files) into its own store, deduplicated by
  message id + request id, keeping only timestamp, model, project slug and token
  counts.
- IF the token is missing or expired, or the endpoint fails or returns an
  unexpected shape, THEN THE SYSTEM SHALL skip the snapshot, record the error
  kind (never the token or headers) in a status file, and still import
  transcripts.
- THE SYSTEM SHALL never log, store, copy or send the OAuth token anywhere but
  `api.anthropic.com`, and SHALL never refresh it (refreshing would rotate
  Claude Code's own credentials).
- IF a transcript is later deleted by Claude Code, THEN THE SYSTEM SHALL keep the
  messages already imported from it.
- WHILE another collector run holds the lock, THE SYSTEM SHALL exit without
  writing.

Dashboard

- WHEN the dashboard opens, THE SYSTEM SHALL import transcripts and show the
  latest weekly %, 5-hour %, both reset times and the data age.
- WHEN at least one snapshot exists in the current weekly window, THE SYSTEM
  SHALL show the projected weekly % at reset (median and a low/high range) and,
  if the median projection crosses 100%, the date and time the cap would be hit.
- WHEN at least one weekly window is complete, THE SYSTEM SHALL show the weekly
  % of each past window, the typical week (median, with range), and the
  equivalent % on each other plan, labelled as approximate.
- THE SYSTEM SHALL show cost-weighted usage and token counts per day and per
  week, split by model.
- WHEN the collector detects a subscription different from the current plan
  setting, THE SYSTEM SHALL add a plan-history entry starting at that snapshot.
- WHEN Pierre changes the plan setting, THE SYSTEM SHALL record it with an
  effective date and interpret older snapshots against the plan active at their
  time. A manual entry overrides detection for its period.
- WHEN Pierre submits a manual reading (weekly %, optional 5-hour %, reset
  time), THE SYSTEM SHALL store it as a snapshot marked manual, used like an
  endpoint snapshot.
- IF there is not enough data for a figure, THEN THE SYSTEM SHALL say what is
  missing instead of showing a number.
- THE SYSTEM SHALL never carry meaning by color alone (labels, patterns or
  direct labelling on every series), and every metric SHALL have a `title`
  tooltip explaining it.

## Design

### Architecture

```text
Claude Code Stop hook ──► collector (Node, .ts run natively)
                              │ reads ~/.claude/projects/**/*.jsonl
                              │ calls /api/oauth/usage (throttled)
                              ▼
                     ~/.claude-code-analytics/   (data dir, outside the repo)
                              ▲
        Vite server plugin: /api/* (GET data, POST settings & manual readings)
                              ▲
                     React dashboard (browser)
```

- The browser cannot read `~/.claude`, so a Node side is needed. Rather than a
  separate server, a **Vite plugin** registers `/api/*` middleware in both
  `configureServer` (dev) and `configurePreviewServer` (`npm run dashboard` =
  build + preview). One code path, no extra dependency, localhost only.
- **Automation via a Claude Code `Stop` hook** in user-level settings, not an
  OS scheduler: usage only changes while Claude Code (or claude.ai) is in use,
  hooks work the same on any OS, and the throttle keeps endpoint calls rare.
  Usage from claude.ai alone between sessions is still caught by the next
  snapshot, since the endpoint reports the account total. The hook is async
  and the collector never exits non-zero. Installing it edits
  `~/.claude/settings.json`, so it is a separate step done with Pierre's
  consent (`npm run hook:install` prints the snippet, or applies it on request).
- **Data dir** `~/.claude-code-analytics/` (override with
  `CCA_DATA_DIR`): survives repo re-clones and is never in git.

### Layout

- `src/core/` — pure, Node-free, fully tested: transcript line parsing,
  dedupe, pricing, aggregation (day/week/model), calibration, forecast, plan
  conversion.
- `src/collector/` — Node: transcript scan, endpoint client, store, lock,
  CLI entry `src/collector/cli.ts`.
- `src/server/` — Vite plugin with the API routes.
- `src/dashboard/` — React app.
- Two tsconfigs (`tsconfig.json` with DOM types for `dashboard` + `core`,
  `tsconfig.node.json` with Node types for `collector` + `server` + `core` +
  configs), so browser code cannot import Node modules. Collector files use
  relative `.ts` imports (Node's type stripping does not resolve the `@/`
  alias); the dashboard keeps `@/`.

### Data files (all in the data dir)

- `messages-YYYY-MM.jsonl` — one file per month (a run rewrites only the
  months it changed), one line per deduplicated assistant message:
  `{ key, ts, model, project, input, output, cacheWrite5m, cacheWrite1h,
  cacheRead }`. Imports merge by `key`; when the same key appears with
  different counts (streamed partial entries), the entry with the highest
  `output` wins. Rewritten atomically (temp + rename).
  Also `scan-state.json`: per transcript file, size + mtime, to skip unchanged
  files.
- `snapshots.jsonl` — append-only: `{ ts, source: 'endpoint' | 'manual',
  weekly, weeklyResetsAt, fiveHour?, fiveHourResetsAt?, claudeCodeShare?,
  subscriptionType?, rateLimitTier? }`. Reset times rounded to the minute.
  `claudeCodeShare` is the `claude_code` row of `seven_day_breakdown` (0–100).
- `settings.json` — `{ planHistory: [{ plan: 'pro' | 'max5' | 'max20', from,
  source: 'detected' | 'manual' }], endpointEnabled, throttleMinutes }`.
  Defaults: plan detected from the first snapshot (else Pro) from the first
  message date, endpoint on, 15 min. Mapping `subscriptionType` /
  `rateLimitTier` to a plan: `pro` → Pro; `max` with a tier containing `20x`
  → Max 20×, otherwise Max 5×; unknown values leave the plan unchanged and
  show a warning.
- `status.json` — last run time, last endpoint result kind (`ok`,
  `no-token`, `expired`, `http-<code>`, `bad-shape`), counts imported.
- `lock` — created with `wx`; a lock older than 2 minutes is treated as stale.

No message content, prompt text or file paths beyond the project slug are
stored.

### Usage unit: API-equivalent cost

Each message is priced at public per-model API rates: input, output, 5-minute
and 1-hour cache writes, cache reads. Limits drain faster on Opus than Sonnet
and cache reads cost ~10% of input, so cost tracks limit consumption far better
than raw tokens. The price table lives in `src/core/pricing.ts`, checked against
current Anthropic pricing at implementation time. An unknown model is counted
with zero cost **and flagged** on the dashboard, never silently dropped.
Assumption, stated in the UI: plan limits scale with API price across models.

### Weekly windows

Windows are fixed (confirmed in phase 0): `[resetsAt − 7 days, resetsAt)`,
currently Wednesday 20:00 UTC to Wednesday 20:00 UTC. Earlier weeks reuse the
same anchor stepped back by 7 days, so days before the first snapshot still
fall into proper windows. Before any snapshot exists, weekly charts fall back
to ISO weeks (Monday 00:00 local).

### Calibration: how much % does $1 of usage cost?

Intuition: if the weekly % rose by 20 points while $40 of API-equivalent usage
happened, then 1% ≈ $2 on this plan. With many readings, fit the best single
ratio.

For each snapshot *r* in window *w*: `weekly_r ≈ k × C(w.start, r.ts)`, where
*C* is the cost of imported messages in that interval and *k* is "% per
dollar". Fit *k* by weighted least squares through the origin,
`k = Σ wᵣ·uᵣ·Cᵣ / Σ wᵣ·Cᵣ²`, with weights halving every 14 days of age (limits
and promotions change). Fitted per plan (a plan change starts a new fit). The
dashboard shows *k*, the number of readings used and the typical error
(residual) so Pierre can judge it.

The fit target is the Claude Code part only: `uᵣ = weekly_r × claudeCodeShare_r
/ 100` (when the share is missing, the whole weekly % is used). Transcripts only
see Claude Code, so without this, claude.ai chat usage would distort *k*.
Utilization comes in whole percents, so readings below ~5% are too coarse and
are left out of the fit.

### Forecast: will I last the week?

`projected = current weekly % + k × dailyCost × daysLeft`, where `dailyCost` is
the median daily cost over the last 4 weeks (low/high = 25th/75th
percentile). Cap date: when the median projection reaches 100%. Without a
calibration yet (fewer than 3 readings), fall back to the current window's own
% rate (`current % ÷ days elapsed`) and say so.

### Share of a plan per week

For each completed window, the final weekly % is the last snapshot before
reset, extended by `k × cost(last snapshot → reset)` if that snapshot is more
than 12 h before reset (marked as estimated). Typical week = median over
completed windows, range = min–max. Other plans: `% on P = % × mult(current) /
mult(P)` with Pro = 1, Max 5× = 5, Max 20× = 20 (advertised multipliers,
labelled approximate). Windows from an older plan are converted to the current
plan the same way.

### Dashboard

One page, four sections:

1. **This week** — weekly % gauge (bar with numeric label), projected % at reset
   with range, cap date if any, 5-hour %, reset times, data age and endpoint
   status.
2. **Per week** — bar per window with its % (estimated ones hatched and
   marked "est."), the typical-week line, and the plan conversion table.
3. **Raw usage** — daily and weekly stacked bars by model (cost, toggle to
   tokens), direct-labelled legend plus pattern fills; a table under the chart.
4. **Settings & data** — plan + plan history, manual reading form, endpoint
   on/off, calibration details (*k*, readings, error), unknown models.

### Failure modes

- Endpoint changes shape → `bad-shape` status, manual logging still works.
- Endpoint 429 → status `http-429`, retried at next throttle tick, no retry
  loop.
- Token expired (Claude Code not run recently) → `expired`, skipped; Claude Code
  refreshes it on its next start.
- Malformed transcript line → skipped and counted, never fatal.
- Two sessions finishing together → lock, second run exits.

### Dependencies to add (approved with the plan)

Runtime: `react`, `react-dom`, `recharts` (charting; standard for React,
supports patterns and custom labels). Dev: `@vitejs/plugin-react`,
`@types/react`, `@types/react-dom`, `@types/node`, the ESLint React plugins
that `@antfu/eslint-config`'s `react: true` option requires, and
`@testing-library/react`. Versions checked when installing.
`engines.node` moves to `>=22.18` (native `.ts` execution).

## Checklist

Phase 0 — data probes (report before building)

- [x] Inspect real transcript entries: usage field shape (cache 5m/1h split),
  duplicate pattern per message id + request id, which duplicate holds final
  `output_tokens`, subagent files, models present.
- [x] Inspect the credentials file shape (key names only, values redacted).
- [x] Call the endpoint once, print the response shape (no token); test which
  User-Agent is needed.
- [x] Check that async `Stop` hooks exist in the current Claude Code docs.
- [x] Update this plan with the findings.

Phase 1 — scaffold

- [x] Add React, Recharts and dev deps; ESLint React config; two tsconfigs;
  `engines` bump; remove `src/example*`.
- [x] Layout `core` / `collector` / `server` / `dashboard`; empty dashboard
  renders.

Phase 2 — core logic (TDD)

- [x] Transcript line parser + dedupe.
- [x] Pricing table + per-message cost.
- [x] Aggregation by day / week / model.
- [x] Weekly windows from snapshots.
- [x] Calibration (weighted fit, residual).
- [x] Forecast (median/range, cap date, fallback).
- [x] Weekly share + plan conversion.

Phase 3 — collector

- [x] Transcript scan with scan-state, merge into `messages.jsonl`.
- [x] Endpoint client (token read in memory only, throttle, error kinds).
- [x] Store, lock, status file; CLI `npm run collect`.
- [x] `npm run hook:install` (print snippet; apply only with consent).

Phase 4 — server and dashboard

- [x] Vite plugin API: GET summary, GET/POST settings, POST manual reading,
  POST collect.
- [x] Sections 1–4 with tooltips and colorblind-safe charts.
- [x] Verify in a real browser against real data.

Phase 5 — finish

- [x] README, AGENTS.md (commands, layout, data dir, token rule), decisions.md.
- [x] Review pass; final report.
