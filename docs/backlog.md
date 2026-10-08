# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

## Ideas

- `[forensics]` Cache anomaly detection; chart flushes per day next to `CacheCard`. Explains days that burned more limit than the work justified. Rules, from AeternaLabsHQ/claude-code-stats `anomalies.py`: an idle-gap flush is a turn after a gap over the cache TTL (300 s, or 3600 s when the session writes the 1-hour cache) whose `cache_creation` is over 2× the rolling median (at least 100 tokens); a no-gap flush is a turn within the TTL whose `cache_read` fell below 50% of the previous turn's, ignoring turns within 120 s of a compaction (`isCompactSummary` entries, not parsed today).
- `[forensics]` Observed rate-limit and server-overload hits from transcripts, placed in the 5-hour windows. Ground truth for Calibration and for the `k × cost` demand of limit-hit weeks; check whether stored messages keep error records (else a collector change and a `SCAN_FORMAT` bump). Rules, from `limits.py` and `classify.py`: an `isApiErrorMessage` entry containing "you've hit your limit" or "usage limit reached" is a limit hit; "overloaded" or HTTP 529 is a server overload, kept apart; hits within 15 min of each other count once (parallel sessions show the same banner). Cross-check for Calibration: the median cost of limit-hit windows is a capacity estimate, floored by the highest cost of a window that did not hit the limit.
- `[forensics]` Skill or command per conversation: a column in "Most expensive conversations" or the skills a conversation ran. `UsageRecord.skill` already holds it.
- Weight the per-tool output split by tool input size instead of evenly; needs the input sizes stored per tool call (`core/outputSplit.ts`).
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
