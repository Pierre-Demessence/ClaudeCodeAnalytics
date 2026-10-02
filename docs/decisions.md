# Decisions

Non-obvious decisions: what was decided, why, and which alternatives were
rejected. Replace an entry when a decision is reversed.

## Limits from the undocumented usage endpoint, manual readings optional

`GET api.anthropic.com/api/oauth/usage` with Claude Code's OAuth token gives
the real weekly and 5-hour % (the numbers behind `/usage`). Anthropic does not
publish limits in tokens, so this is the only ground truth. Manual readings use
the same snapshot format, as a fallback if the endpoint breaks.

## Send a `claude-code/<version>` User-Agent

Probed 2026-10-02: an honest `claude-code-analytics` User-Agent got HTTP 429,
`claude-code/2.1.287` got 200 right after. Community tools report the same. The
version is taken from the newest transcript.

## Never refresh the OAuth token

Refreshing would rotate the refresh token Claude Code itself uses and could log
it out. An expired token skips the snapshot; Claude Code refreshes it on its
next start.

## Collect from a Claude Code `Stop` hook, not an OS scheduler

Usage only changes while Claude Code (or claude.ai) is used; the hook works on
any OS and runs async. The endpoint call is throttled to every 15 minutes.
Rejected: Windows Task Scheduler (platform-specific, runs when nothing changes);
a status line (Pierre uses the dashboard, not the terminal).

## API-equivalent cost as the usage unit

Plan limits drain faster on Opus than Sonnet, and cache reads cost far less than
fresh input, so each message is priced at public API rates. Raw token counts
were rejected: cache reads dominate them. Assumption: limits scale with API
price across models.

## Calibrate on Claude Code's share of the weekly %

The endpoint's `seven_day_breakdown` gives Claude Code's share of weekly usage;
transcripts only see Claude Code, so the fit uses `weekly × share` and
claude.ai chat usage does not distort it. The fit is a weighted least squares
through the origin, half-life 14 days, current plan only; readings under 5%
and windows older than the first imported message are skipped.

## Server-side summary in a Vite plugin

The browser cannot read `~/.claude`, and a year of message records is around
100 MB, so the dev/preview server computes the summary and serves `/api/*`.
Rejected: a separate Node server (one more process and port); shipping raw
records to the browser.

## Monthly message files

`messages-YYYY-MM.jsonl`, rewritten only for months a run changed: one file
rewritten after every Claude Code response would grow to about 100 MB a year.
SQLite was rejected: `node:sqlite` is still experimental, and a dependency
would be overkill for append-mostly data.

## Local API trust model

The `/api/*` routes run inside the Vite dev/preview server, which binds to
localhost. Writes require `application/json` and an `Origin` matching `Host`,
which blocks cross-site form posts. Reads rely on Vite's default `allowedHosts`
and CORS rules. No auth: anyone with local access can already read `~/.claude`.

## One data-dir lock for every writer

Collector runs and the dashboard's writes (settings, manual readings) take the
same lock, so a run cannot overwrite a plan change made during its endpoint
call; the dashboard waits up to 5 s, then answers 409. A run takes about a
second; a lock older than 2 minutes was left by a crashed run and is taken
over. The lock file holds a random token, so a slow run never deletes the lock
of the run that took over.

## Read transcripts incrementally

Transcripts are append-only, so the scan state keeps a byte offset per file and
only new bytes are read. A last line without a newline that is not valid JSON
is still being written and is left for the next run. A file that shrank or
changed without growing is read again from the start.

## 5-hour forecast: its own calibration and session pace

The 5-hour window is forecast with the weekly method (`forecastWindow`), with
two inputs of its own. Its % per $ is fitted separately on the 5-hour readings,
since the ratio between the 5-hour and weekly limits is not published; the
endpoint gives no Claude Code share for that window, so claude.ai usage counts
in the fit. Its pace is the average $/hour of each 5-hour session in the last
4 weeks, idle time included, rebuilt from message times. Daily cost / 24 was
rejected: a session only exists while working, so it would understate the
pace. Every reading gets the usage since it added back, not only stale ones:
15 minutes is 5% of a 5-hour window.

## Estimated weeks and stale readings

A completed week whose last reading is more than 12 h before reset is extended
with the calibrated cost since, marked "est." and capped at 100%. A current
reading older than 30 minutes gets an estimated current % from transcripts, and
the projection starts from it.

## Manual plan periods win over detection

The collector adds a plan period when Claude Code's login reports a different
plan, unless the active period was set by hand; the dashboard then shows the
mismatch with a one-click switch instead of overriding the user.
