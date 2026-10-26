# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it. Sections say what kind of work an item is; `docs/roadmap.md`
orders the ones that are scheduled.

## Bugs

- Sessions timeline: the "now" line crosses the in-progress window's percent label (`Sessions.tsx`), e.g. "3|1%".
- Weeks tab on a phone: the median peak card's "≈ 26% without the limit" runs past the card's edge (`src/dashboard/Weeks.tsx:91`), since `.wk-uncapped` never wraps (`src/dashboard/styles.css:2695`).
- A plan change without a drop in the readings leaves readings of two plans in one window part (`windowParts`, `src/core/restarts.ts:61`), whose plan is its last reading's: `weekHistory.ts` then reads an earlier reading's pressure on the wrong scale. Only reachable for a downgrade or an upgrade the readings do not show as a restart.
- `windowParts` and `weeklyShares` key a window by its exact reset time (`src/core/restarts.ts:35`, `src/core/share.ts:51`): a reset time that differs by a minute of rounding makes two windows, and a drop between them is not seen (`backtest.ts` tolerates 2 minutes).

## Features

New capabilities.

- `[multi-account]` Support several Claude accounts (e.g. a second Pro used when the first is limited). Not needed yet; brainstormed for when it is. Today everything assumes one: one `.credentials.json` read in `collect.ts:73`, snapshots and records carry no account, so a second account's readings would interleave with the first and corrupt calibration and forecasts. Design: one account per config folder (`CLAUDE_CONFIG_DIR`, the documented way; log out/in in one folder mixes transcripts, which carry no account id). Key each folder by `organizationUuid` from its `.credentials.json` (field exists; that it differs between two accounts is unverified until a second account is logged in). Tag records and snapshots with it, with a one-time migration tagging existing data as account 1 (back up the data dir first; `SCAN_FORMAT` bump last). Dashboard: an account picker scoping readings, windows, forecast and the Sessions calendar. Pool calibration (and the 5-hour fit) across accounts of the same plan, never across plans; each point's cost must come from its own account's transcripts. Active pace is a property of the user and is probably pooled too. Open points: the second folder starts empty (global settings, plugins, skills, statusline must be copied or linked); the analytics hook must be installed in it and told which folder it runs for; the Docker container mounts only `~/.claude` and needs the second folder read-only; how the VS Code extension picks a config dir (how to set `CLAUDE_CONFIG_DIR` there) is unchecked and must be verified, since the extension is used daily.
- `[forensics]` Project drill-down page: a project's sessions, weekly cost and cache health, reached from Breakdown's "By project".
- claude.ai vs Claude Code split per week from `claudeCodeShare` (only feeds the fit today). Design board: `Split.dc.html`.

## Enhancements

Improvements to something that exists.

### Breakdown

- `[forensics]` Skill or command per conversation: a column in "Most expensive conversations" or the skills a conversation ran. `UsageRecord.skill` already holds it.
- Cost per git branch (`UsageRecord.gitBranch`); the Breakdown tab only shows each conversation's main branch.
- `[forensics]` Carrying cost per tool ("where input goes"). Every API call is billed for the whole context, so a tool's input cost is an attribution, not a measurement: assume each result stays in the context for the rest of the conversation, so cost = tokens added × later turns × cache-read price, cut short by compaction. A dollar figure per tool, but a model, not an observation. The sizes per result are stored (`UsageRecord.context`, shown in "Where context grows"); the later turns and compactions are not tied to a result yet.
- Calibrate `CHARS_PER_TOKEN` (`src/core/contextAdded.ts:4`): 4 is the older tokenizer's rule of thumb, and Anthropic documents about 30% more tokens for the same text from Claude Opus 4.7 on, so "Where context grows" likely reads a quarter low. Measure it on the data: a tool result's characters against the growth of the next main-thread prompt (input, cache reads and writes), per model if the two tokenizers differ.

### History ranges

- Compare two periods side by side, or show deltas against the previous period.
- Ranges on the Calibration tab (drift beyond 12 weeks) and on Model ratios.
- Export a range (CSV).

### Forecast

- `[forecast]` Carry the uncertainty of `k` into the forecast range, so a weakly calibrated plan shows a wider band.
- `[forecast]` Say which limit binds first (5-hour or weekly) and show a probability of hitting each, once the scheduled forecast exists.
- `[forecast]` Show the current week's own ratio (`CurrentWeek.weekCalibration`) on the Fit card, which shows only the pooled one while the week's forecast, pacing and active time use the week's own.
- `[forecast]` Check whether the usage endpoint's answer holds per-model weekly windows (`seven_day_opus`, `seven_day_sonnet`) that `src/collector/endpoint.ts:76` ignores: it reads only `seven_day` and its breakdown. A per-model limit would explain weeks of one plan disagreeing on the % per dollar.
- `[forecast]` The projections leave out future claude.ai usage: `k` is fitted on Claude Code's share of the weekly % (`src/core/calibration.ts:54`), so the typical pace (`k × cost`) projects Claude Code alone until the own-pace blend takes over on day 3, and the active use left and the room per day count all the room as Claude Code's. Check `claudeCodeShare` in `snapshots.jsonl` first: near 100, nothing to do; often under 90, scale the typical rate by the week's share, or project claude.ai on its own.
- `[forecast]` The 5-hour forecast (`src/core/forecast.ts:119`) blends nothing toward the window's own pace, and its samples are whole-window averages, idle tail included, applied to the hours left wherever the window stands. Backtest two variants on the 5-hour windows: the weekly blend toward the own pace, and samples taken from each past window's cost after the same elapsed time, over the hours left.
- `[forecast]` Active time per family (`activeByFamily`, `src/core/activeTime.ts:41`) gives each gap to the message that ends it, so subagent bursts (Explore on Haiku) take active time from the Opus main thread: the Opus-only pace reads high, the Haiku one low, and the model ratios inherit it. Measure the share of active time credited to subagent messages; if it is large, build the timeline from main-thread messages and give each subagent's cost to the main thread's family.

### Weeks

- Show which plan the bar and % of a week from an earlier plan are on, without a label on every row: only the plan-change mark (on the week of the change) and the tooltips of its estimate and of the typical-week tick say so (`src/dashboard/Weeks.tsx`).

### Plans and what-if

- The what-if only moves Opus work to Sonnet; other shifts (Sonnet to Haiku, a lower effort) would reuse the same linear `shift` per week and session.
- An upper bound for capped weeks: fill the hidden time at the week's own pace before the cutoff, next to the typical-pace estimate (`src/core/planFit.ts`).
- The current week's pace without the limit on the Overview, next to the forecast (which predicts the real, capped % at reset). Deferred from `docs/plans/uncapped-weeks.md`.
- Capped 5-hour sessions' estimate without the limit on the Sessions tab, as the Weeks tab does for weeks. `FitSession` (`src/core/planFit.ts`) needs a `start` to join on.

### Taskbar widget

- `[widget]` The taskbar widget docks only into a bottom taskbar on the primary monitor (`widget/src/dock.rs:47-49`: `x` comes from the tray's left edge, the height from the whole taskbar). A side or top taskbar would clip it; fall back to a floating window near the tray, and dock into each monitor's secondary taskbar.

## Waiting for data

Blocked until more history exists, so the result can be judged. Sub-sections are
ordered by how many completed weeks of data the item needs; the week counts are
estimates of when the result becomes judgeable, not limits in the code.

### 4 weeks

- Uncapped demand on real data: cut uncapped weeks at 90% after the fact and check how close the typical-pace estimate gets to their real final %. Needs at least 3 weeks that never reached the pressure point, so 4 weeks if one of them was capped.
- `[forecast]` Backtest the week's own ratio (`weekCalibration`, `src/core/summary.ts:319`), used from the week's 3rd reading of 5% or more: a whole-percent reading at 5% is worth ±10%, and the endpoint takes 3 readings within half an hour. Compare it with the pooled ratio and with a blend that leans on the own ratio as the week's cost grows.
- `[forecast]` The fits (`fitRatio`, `src/core/calibration.ts:84`) take every reading as a point: the endpoint reads every 15 minutes, idle nights included while the widget polls, so a week weighs by how long the PC was on, identical (%, cost) points repeat, and the RMSE runs over cumulative, correlated points. Compare the fit and the backtest with distinct readings only, or one point per window.
- `[forecast]` Check the forecast band with the backtest: low and high are quartiles, so about half of the final values should land inside ("final in range", `src/core/backtest.ts:190`); far from half, the band is too narrow or too wide.

### 6 weeks

- Forecast stage 3 (expected active hours from a weekday × hour profile) is paused: the backtest cannot tell whether it beats the flat pace on so little history. The profile needs 3 weeks to exist (`docs/plans/forecast-accuracy.md`) and the backtest needs about 3 more weeks to score it against the flat pace. Plan: `docs/plans/forecast-accuracy.md`.
- Weekday-aware daily usage (weekends differ) for the forecast. Covered by stage 3 of `docs/plans/forecast-accuracy.md`.
- `[forensics]` Calibration cross-check from observed limit hits: the median cost of limit-hit windows is a capacity estimate, floored by the highest cost of a window that did not hit the limit; compare with the demand estimates of limit-hit weeks. Server overloads are stored (`events.jsonl`) but not shown anywhere.
- `[forensics]` Test the credit scheme cached in `~/.claude.json` (`tengu_amber_tally`: 5-hour credits 10000 / 50000 / 200000 for Pro / Max 5× / Max 20×, and credits per million tokens per model) against the readings: replay the usage under it with the backtest and compare its error with the API-price model. Unverified: units, which token types count, whether the flag is live. Opus 5.5 : Sonnet 5.5 : Haiku 4.5 is 1833 : 1250 : 833 there, against 4 : 2 : 1 by API output price.

- `[forecast]` Fit the limit per token kind (output, cache read, cache write) instead of one `k` on the total API price; effort, model and subagents act on the limit through this mix. Seen on 2026-10-19: the first High-effort week (from 2026-10-14) used 40.7% of the weekly limit per $100 against 35.2 and 33.5 on Medium. 5-hour windows agree (median 325 vs 285 % per $100, 5 vs 19 windows). A least-squares fit on 25 windows gave cache writes about twice the weight of cache reads per API dollar, output in between. All High windows come after the Medium ones, so a limit change on 2026-10-14 cannot be ruled out; needs weeks that mix both efforts. These figures price Sonnet 5.5 cache reads at $0.20 per million tokens, twice the list price the price table holds: re-measure.

### 12 weeks

- A model of how pace slows as a week nears its limit, to replace the fixed 90% pressure point. Needs many weeks to tell slowing down from a quiet week.
- `[forecast]` A per-family weekly calibration (% per dollar by model family) instead of assuming limits scale with API price, once enough weeks with different mixes exist to tell model mix from a change in the limits. Two weeks of one plan measured 0.028 and 0.099 % per $; the current week's own fit covers it meanwhile. Both figures price Sonnet 5.5 cache reads at twice the list price: re-measure them before reading the gap as the model mix.
- `[forecast]` Pace by effort level and fast mode (`UsageRecord.effort`, `speed`), once the per-model pace shows how much the model alone explains.

### Needs a second plan

- Convert between plans with the measured multipliers (Plans tab, "How far to trust the conversions") when both plans have enough weeks, instead of the advertised ones; the same for the fit borrowed right after a plan change (`borrowedFit`, `src/core/summary.ts`).

### No week count (waits for an event)

- `[forensics]` Verify against a real transcript that a compaction writes `isCompactSummary` or a `compact_boundary` system entry (none in the local transcripts; `src/core/events.ts` assumes both), and the weekly `quotaLimits.rateLimitType` name (only `five_hour` seen; `hitScope` takes `seven_day`/`week`). Until then the no-gap flush leans on the rewritten-share rule.
- Price the 4.5-generation models (Opus 4.5, Sonnet 4.5) and long-context premiums if they show up in transcripts; they are flagged as unknown today.
- Treat a `seven_day.resets_at` of null (if the endpoint ever returns it) as "no usage yet" rather than `bad-shape`.
- Check whether a downgrade restarts the weekly usage as the Pro to Max 5× upgrade did on 2026-10-26 (100% to 0%, same reset time); only that upgrade has been seen.
- Check how a free weekly reset shows in the readings: a drop with the same reset time, or a new reset time. A new one would start a 7-day window overlapping the old one, which nothing handles: the old window's estimated extension (`weeklyShares`, `src/core/share.ts`) would count the new window's cost.

## Technical debt

- The server has no timer: the collector runs only when a client asks (Claude Code hook, the widget's 60 s poll, a dashboard tab, Refresh), so readings resume after a boot only while the widget or a tab is open. A server-side loop in `src/server/api.ts` (`configureServer`/`configurePreviewServer`, about every 60 s, same throttle) would make the dashboard work alone; then drop the 30 s retry in `App.tsx` (`RETRY_MS`). Cost: a permanent background transcript scan.
- `[forensics]` "By skill or command" lists `${name}` and `…` as skills on the local data (seen in the Breakdown tab, last 4 weeks). Probably a `Skill` call or slash command whose name was never substituted; find the source line and decide whether `parseSkillSignal` should ignore such names (`src/core/transcript.ts`). Unchecked.
- `[forensics]` Cache flushes of subagents: detection skips them because parallel subagents interleave in a session; it needs `agentId` stored per record (a `SCAN_FORMAT` bump).
- `[forensics]` A subagent whose `.meta.json` does not exist yet when its transcript is first scanned stays "Unknown": the scan reads the type once per file and later scans only read appended lines (`src/collector/scan.ts`). Not seen on the real data (0 of 125 files).
- The Docker dashboard shares the `proxy` network with other containers, which can reach its API by IP (Vite always allows IP hosts, and a request without `Origin` passes the POST check). A dedicated network joined only by Traefik would close this; it needs a change in `S:\Dev\DockerInfra\compose.yml`.
- `GET /api/summary` has no Origin/Host check: it relies on Vite's default `allowedHosts` and localhost-only CORS. Add an explicit check before ever exposing the server beyond loopback.
- `subscriptionStartedAt` (the billing day) is read from `~/.claude.json` only by host runs (`npm run dev`, `collect`, a host `npm run dashboard`): the container cannot see that file and the hook runs the collector there, so a Docker-only setup keeps the stored value or none (`collect.ts:73`). Mounting the file read-only would fix it, but Claude Code replaces it by rename, which a single-file bind mount may not follow, and it holds the email and account ids.
- `[forensics]` Check that no transcript line splits its cache writes (`cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`) into less than its `cache_creation_input_tokens`: `parseTranscriptLine` trusts the split when present (`src/core/transcript.ts:164`), so the rest would go uncounted. One scan of the transcripts tells.
