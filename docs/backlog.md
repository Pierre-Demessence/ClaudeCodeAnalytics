# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

## Ideas

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
