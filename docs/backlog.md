# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

## Ideas

- `[forensics]` Verify against a real transcript that a compaction writes `isCompactSummary` or a `compact_boundary` system entry (none in the local transcripts; `src/core/events.ts` assumes both), and the weekly `quotaLimits.rateLimitType` name (only `five_hour` seen; `hitScope` takes `seven_day`/`week`). Until then the no-gap flush leans on the rewritten-share rule.
- `[forensics]` Cache flushes of subagents: detection skips them because parallel subagents interleave in a session; it needs `agentId` stored per record (a `SCAN_FORMAT` bump, so do it with the tool-name fields of the next milestone).
- `[forensics]` Calibration cross-check from observed limit hits: the median cost of limit-hit windows is a capacity estimate, floored by the highest cost of a window that did not hit the limit; compare with the `k × cost` demand of limit-hit weeks. Server overloads are stored (`events.jsonl`) but not shown anywhere.
- `[forensics]` Output tokens by tool, plus a reasoning bucket, as a Breakdown card. Split each message's tokens across its tool calls with largest-remainder allocation so the parts sum to the total. Needs tool names per message.
- `[forensics]` Output tokens and cost per skill or slash command, per session and overall. Builds on the tool split.
- `[forensics]` Break "subagents" in Breakdown down by subagent type (Explore, Plan, general-purpose, …).
- `[forensics]` Anonymize toggle (hotkey) masking project names, `cwd` and conversation titles for screenshots.
- `[forensics]` Project drill-down page: a project's sessions, weekly cost and cache health, reached from Breakdown's "By project".
- `[forensics]` API-equivalent value vs plan price ("you used $X of API value on a $Y plan"); check Plans first, since pricing already exists and part of it may be shown.
- The Docker dashboard shares the `proxy` network with other containers, which can reach its API by IP (Vite always allows IP hosts, and a request without `Origin` passes the POST check). A dedicated network joined only by Traefik would close this; it needs a change in `S:\Dev\DockerInfra\compose.yml`.
- `GET /api/summary` has no Origin/Host check: it relies on Vite's default `allowedHosts` and localhost-only CORS. Add an explicit check before ever exposing the server beyond loopback.
- The calibrated range applies the 25th/75th percentile day to every remaining day, which overstates the spread of a multi-day total; a bootstrap over days would be tighter.
- Price the 4.5-generation models (Opus 4.5, Sonnet 4.5) and long-context premiums if they show up in transcripts; they are flagged as unknown today.
- Treat a `seven_day.resets_at` of null (if the endpoint ever returns it) as "no usage yet" rather than `bad-shape`.
- Per-model weekly limits (`seven_day_opus` / `seven_day_sonnet` in the endpoint response) if a plan ever reports them.
- Weekday-aware daily usage (weekends differ) for the forecast.
- Cost per git branch (`UsageRecord.gitBranch`); the Breakdown tab only shows each conversation's main branch.
- claude.ai vs Claude Code split per week from `claudeCodeShare` (only feeds the fit today). Design board: `Split.dc.html`.
- Convert between plans with the measured multipliers (Plans tab, "How far to trust the conversions") when both plans have enough weeks, instead of the advertised ones.
- A week or session that reached its limit uses `k × cost` as its demand, which leaves out claude.ai usage (understated); the endpoint's `claudeCodeShare` could scale it up.
- The what-if only moves Opus work to Sonnet; other shifts (Sonnet to Haiku, a lower effort) would reuse the same linear `shift` per week and session.
