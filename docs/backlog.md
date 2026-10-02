# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

- `index.html` has no favicon: every page load logs a 404 for `/favicon.ico`.
- The 5-hour card needs a current week (`Overview.tsx`): with usage since the weekly reset but no reading and no calibration, a still-valid 5-hour reading shows as "No session in progress". Rare (a reset within the last 5 hours).

## Tech debt

- A transcript rewritten to a larger size is read as an append from the old offset (`scan.ts`); Claude Code only appends, so this is theoretical.
- The data-dir lock (`lock.ts`, `wx` create) is shared by the host's hook and the Docker dashboard across Docker Desktop's file sharing, where exclusive create is not strictly atomic; a simultaneous run could race. Unlikely; revisit if `records` ever shows duplicates or lost writes.
- Untested: the dashboard's out-of-order request guard (`App.tsx`), old scan-state entries without `offset`, and a settings write that waits for a running collector then succeeds.

## Ideas

- The Docker dashboard shares the `proxy` network with other containers, which can reach its API by IP (Vite always allows IP hosts, and a request without `Origin` passes the POST check). A dedicated network joined only by Traefik would close this; it needs a change in `S:\Dev\DockerInfra\compose.yml`.
- `GET /api/summary` has no Origin/Host check: it relies on Vite's default `allowedHosts` and localhost-only CORS. Add an explicit check before ever exposing the server beyond loopback.
- The calibrated range applies the 25th/75th percentile day to every remaining day, which overstates the spread of a multi-day total; a bootstrap over days would be tighter.
- Manual readings have no Claude Code share, so claude.ai usage in them inflates the calibration; let the form take the share shown by `/usage`, or weight manual readings less.
- A way to delete a wrong manual reading (snapshots are append-only today).
- Price the 4.5-generation models (Opus 4.5, Sonnet 4.5) and long-context premiums if they show up in transcripts; they are flagged as unknown today.
- Treat a `seven_day.resets_at` of null (if the endpoint ever returns it) as "no usage yet" rather than `bad-shape`.
- Per-model weekly limits (`seven_day_opus` / `seven_day_sonnet` in the endpoint response) if a plan ever reports them.
- Weekday-aware daily usage (weekends differ) for the forecast.
- Usage per project: cost per project this week and past weeks; `UsageRecord.project` is stored but no view uses it.
- Activity heatmap: cost by weekday × hour from `ts`, to show when usage happens and time heavy work after a 5-hour reset.
- Cache efficiency: cache-read share of input and dollars saved versus uncached input, per day and per project.
- Past 5-hour sessions: timeline of rebuilt sessions (`aggregate.ts` `sessionCosts`) with cost and the peak 5-hour % where a reading exists.
- Cost-per-message distribution, listing outliers (date, project), e.g. a large cache write after a long-context resume.
- Per conversation (`sessionId`, not parsed today in `transcript.ts`): cost, length, model mix, duration, most expensive this week. Titles (`ai-title` lines) would be content; decide first.
- Main agent vs subagents (`isSidechain`, not parsed today): share of usage spent by subagents.
- Effort and thinking (`effort`, `usage.output_tokens_details.thinking_tokens`, not parsed today): cost by effort level, thinking share of output.
- By surface (`entrypoint`) and by `gitBranch` (not parsed today): terminal vs IDE, cost per feature branch.
- Claude Code version timeline (`version`, not parsed today): mark upgrades on the daily chart to spot token-use changes.
- The new transcript fields above change the stored record format: already-imported messages lack them unless transcripts are rescanned, and transcripts past `cleanupPeriodDays` are gone. Decide the rescan once for all of them.
- Calibration drift: plan % per dollar per week, to detect a silent limit change and test the price-scaling assumption.
- claude.ai vs Claude Code split per week from `claudeCodeShare` (only feeds the fit today).
- What-if simulator: final % of a week with another model mix (e.g. Opus as Sonnet) or another plan, from pricing and calibration.
- 5-hour sessions are rebuilt from transcript times only (`aggregate.ts` `sessionCosts`); the real windows (e.g. 07:50 for a first message at 07:59) start earlier, likely from claude.ai use or some rounding. Readings' `fiveHourResetsAt` could anchor past sessions.
