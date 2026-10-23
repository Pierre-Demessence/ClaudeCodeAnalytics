# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it. Sections say what kind of work an item is; `docs/roadmap.md`
orders the ones that are scheduled.

## Bugs

- Sessions timeline: the "now" line crosses the in-progress window's percent label (`Sessions.tsx`), e.g. "3|1%".

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

### History ranges

- Compare two periods side by side, or show deltas against the previous period.
- Ranges on the Calibration tab (drift beyond 12 weeks) and on Model ratios.
- Export a range (CSV).

### Forecast

- `[forecast]` Carry the uncertainty of `k` into the forecast range, so a weakly calibrated plan shows a wider band.
- `[forecast]` Say which limit binds first (5-hour or weekly) and show a probability of hitting each, once the scheduled forecast exists.

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

### 6 weeks

- Forecast stage 3 (expected active hours from a weekday × hour profile) is paused: the backtest cannot tell whether it beats the flat pace on so little history. The profile needs 3 weeks to exist (`docs/plans/forecast-accuracy.md`) and the backtest needs about 3 more weeks to score it against the flat pace. Plan: `docs/plans/forecast-accuracy.md`.
- Weekday-aware daily usage (weekends differ) for the forecast. Covered by stage 3 of `docs/plans/forecast-accuracy.md`.
- The calibrated range applies the 25th/75th percentile day to every remaining day, which overstates the spread of a multi-day total; a bootstrap over days would be tighter. Also covered by stage 3 of the plan.
- `[forensics]` Calibration cross-check from observed limit hits: the median cost of limit-hit windows is a capacity estimate, floored by the highest cost of a window that did not hit the limit; compare with the demand estimates of limit-hit weeks. Server overloads are stored (`events.jsonl`) but not shown anywhere.
- `[forensics]` Test the credit scheme cached in `~/.claude.json` (`tengu_amber_tally`: 5-hour credits 10000 / 50000 / 200000 for Pro / Max 5× / Max 20×, and credits per million tokens per model) against the readings: replay the usage under it with the backtest and compare its error with the API-price model. Unverified: units, which token types count, whether the flag is live. Opus 5.5 : Sonnet 5.5 : Haiku 4.5 is 1833 : 1250 : 833 there, against 4 : 2 : 1 by API output price.

- `[forecast]` Fit the limit per token kind (output, cache read, cache write) instead of one `k` on the total API price; effort, model and subagents act on the limit through this mix. Seen on 2026-10-19: the first High-effort week (from 2026-10-14) used 40.7% of the weekly limit per $100 against 35.2 and 33.5 on Medium. 5-hour windows agree (median 325 vs 285 % per $100, 5 vs 19 windows). A least-squares fit on 25 windows gave cache writes about twice the weight of cache reads per API dollar, output in between. All High windows come after the Medium ones, so a limit change on 2026-10-14 cannot be ruled out; needs weeks that mix both efforts.

### 12 weeks

- A model of how pace slows as a week nears its limit, to replace the fixed 90% pressure point. Needs many weeks to tell slowing down from a quiet week.
- `[forecast]` Fit `k` per model family instead of assuming limits scale with API price; needs enough readings per family.
- `[forecast]` Pace by effort level and fast mode (`UsageRecord.effort`, `speed`), once the per-model pace shows how much the model alone explains.

### Needs a second plan

- Convert between plans with the measured multipliers (Plans tab, "How far to trust the conversions") when both plans have enough weeks, instead of the advertised ones.

### No week count (waits for an event)

- `[forensics]` Verify against a real transcript that a compaction writes `isCompactSummary` or a `compact_boundary` system entry (none in the local transcripts; `src/core/events.ts` assumes both), and the weekly `quotaLimits.rateLimitType` name (only `five_hour` seen; `hitScope` takes `seven_day`/`week`). Until then the no-gap flush leans on the rewritten-share rule.
- Price the 4.5-generation models (Opus 4.5, Sonnet 4.5) and long-context premiums if they show up in transcripts; they are flagged as unknown today.
- Treat a `seven_day.resets_at` of null (if the endpoint ever returns it) as "no usage yet" rather than `bad-shape`.
- Per-model weekly limits (`seven_day_opus` / `seven_day_sonnet` in the endpoint response) if a plan ever reports them.

## Technical debt

- `writeAtomic` (`src/collector/store.ts:77`) leaves its temp file behind when `rename` throws: the data dir holds `messages-2026-10.jsonl.41372.<uuid>.tmp` from 2026-10-12 (3.6 MB). The cause is probably a Windows `EPERM`/`EBUSY` while another process reads the target (not confirmed). Remove the temp file on failure, and check whether that write was retried.

- The server has no timer: the collector runs only when a client asks (Claude Code hook, the widget's 60 s poll, a dashboard tab, Refresh), so readings resume after a boot only while the widget or a tab is open. A server-side loop in `src/server/api.ts` (`configureServer`/`configurePreviewServer`, about every 60 s, same throttle) would make the dashboard work alone; then drop the 30 s retry in `App.tsx` (`RETRY_MS`). Cost: a permanent background transcript scan.
- `[forensics]` "By skill or command" lists `${name}` and `…` as skills on the local data (seen in the Breakdown tab, last 4 weeks). Probably a `Skill` call or slash command whose name was never substituted; find the source line and decide whether `parseSkillSignal` should ignore such names (`src/core/transcript.ts`). Unchecked.
- `[forensics]` Cache flushes of subagents: detection skips them because parallel subagents interleave in a session; it needs `agentId` stored per record (a `SCAN_FORMAT` bump).
- `[forensics]` A subagent whose `.meta.json` does not exist yet when its transcript is first scanned stays "Unknown": the scan reads the type once per file and later scans only read appended lines (`src/collector/scan.ts`). Not seen on the real data (0 of 125 files).
- The Docker dashboard shares the `proxy` network with other containers, which can reach its API by IP (Vite always allows IP hosts, and a request without `Origin` passes the POST check). A dedicated network joined only by Traefik would close this; it needs a change in `S:\Dev\DockerInfra\compose.yml`.
- `GET /api/summary` has no Origin/Host check: it relies on Vite's default `allowedHosts` and localhost-only CORS. Add an explicit check before ever exposing the server beyond loopback.
- `subscriptionStartedAt` (the billing day) is read from `~/.claude.json` only by host runs (`npm run dev`, `collect`, a host `npm run dashboard`): the container cannot see that file and the hook runs the collector there, so a Docker-only setup keeps the stored value or none (`collect.ts:73`). Mounting the file read-only would fix it, but Claude Code replaces it by rename, which a single-file bind mount may not follow, and it holds the email and account ids.
