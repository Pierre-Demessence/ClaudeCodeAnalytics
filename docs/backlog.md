# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

- `index.html` has no favicon: every page load logs a 404 for `/favicon.ico`.

## Tech debt

- `vite.config.ts` / `vitest.config.ts` use `__dirname`; Vite warns it is unsupported by the future native config loader (use `import.meta.dirname`).
- `eslint.config.ts` does not type-check (perfectionist `customGroups` typing), so it is left out of `tsconfig.node.json`.
- Collector status `malformedLines` counts only files changed in the last run, not a running total.
- `collect` reads settings at start and writes them after the endpoint call, while `/api/settings` writes without the lock: a plan change made during a run can be lost (`collect.ts`, `server/api.ts`).
- `writeAtomic` uses a per-process temp name (`store.ts`): two concurrent writes of one file from the dashboard server can collide (rare 500).
- `status.json` is only saved at the end of a run: an exception (other than an endpoint failure) leaves no trace in the status.
- An active transcript is re-read in full on every run (scan state is per file); fine now, slow with multi-MB sessions.
- The dashboard's `run()` has no ordering guard: overlapping requests can show an older summary (`App.tsx`).
- Weekly usage buckets anchor on the latest reset only, while weekly shares use each reading's own reset; they diverge if Anthropic moves the reset time (`summary.ts`).
- More tests: store and scan (scan-state skipping, month rewrite), server route handlers (415/403/413/409), settings forms in the dashboard.

## Ideas

- `GET /api/summary` has no Origin/Host check: it relies on Vite's default `allowedHosts` and localhost-only CORS. Add an explicit check before ever exposing the server beyond loopback.
- The calibrated range applies the 25th/75th percentile day to every remaining day, which overstates the spread of a multi-day total; a bootstrap over days would be tighter.
- Manual readings have no Claude Code share, so claude.ai usage in them inflates the calibration; let the form take the share shown by `/usage`, or weight manual readings less.
- A way to delete a wrong manual reading (snapshots are append-only today).
- Price the 4.5-generation models (Opus 4.5, Sonnet 4.5) and long-context premiums if they show up in transcripts; they are flagged as unknown today.
- Treat a `seven_day.resets_at` of null (if the endpoint ever returns it) as "no usage yet" rather than `bad-shape`.
- Per-model weekly limits (`seven_day_opus` / `seven_day_sonnet` in the endpoint response) if a plan ever reports them.
- A 5-hour window forecast, same method as the weekly one.
- Weekday-aware daily usage (weekends differ) for the forecast.
