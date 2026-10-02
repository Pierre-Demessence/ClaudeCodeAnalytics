# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

- `index.html` has no favicon: every page load logs a 404 for `/favicon.ico`.

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
- 5-hour sessions are rebuilt from transcript times only (`aggregate.ts` `sessionCosts`); the real windows (e.g. 07:50 for a first message at 07:59) start earlier, likely from claude.ai use or some rounding. Readings' `fiveHourResetsAt` could anchor past sessions.
