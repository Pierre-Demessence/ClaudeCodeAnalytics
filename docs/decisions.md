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

## Active use left: pace per active hour, pauses over 15 minutes excluded

The cap time of a forecast is wall-clock time at a pace that averages idle
time in, so it does not say how much work is left. The limit cards also show
the active use left: the % left, turned into dollars with the calibration,
divided by the $ per active hour of the last 4 weeks. Active time is the sum of
the gaps between consecutive messages up to 15 minutes, on one timeline across
sessions since they share the limits; longer gaps are pauses. Counting every
clock hour with a message was rejected: a single message would count a full
hour and understate the pace. The cost of a burst's first message has no
active time before it, which overstates the pace slightly; that errs toward
less time left. Without a calibration, a % cannot become dollars: no value.

## Estimated weeks and stale readings

A completed week whose last reading is more than 12 h before reset is extended
with the calibrated cost since, marked "est." and capped at 100%. A current
reading older than 30 minutes gets an estimated current % from transcripts, and
the projection starts from it.

## Manual plan periods win over detection

The collector adds a plan period when Claude Code's login reports a different
plan, unless the active period was set by hand; the dashboard then shows the
mismatch with a one-click switch instead of overriding the user.

## Always-on dashboard: a rebuilt Docker image running `vite preview`

The container runs `vite preview` (the `/api` routes are a Vite plugin), so the
image keeps dev dependencies; writing a separate production server was not worth
it for a local tool. Updates go live only on `npm run docker:up`: mounting the
working copy and rebuilding at start was rejected because a half-finished edit
would go live at the next boot. The root filesystem is read-only, hence
`--configLoader native` (the default loader bundles the config into
`node_modules`). The collector hook stays on the host and shares the data dir.

## Tabs as hash links, no router

The dashboard's tabs are `<a href="#/usage">` links read by `useTab()`: the back
button and bookmarks work, and the dev/preview server needs no fallback route.
A router library was rejected as a dependency for five static views.

## Theme: `data-theme` on `<html>`, dark values written twice

With no choice stored, the stylesheet follows `prefers-color-scheme`; a choice
in the header is stored in `localStorage` and set as `data-theme`. CSS cannot
share one block between a media query and an attribute selector, so the dark
variables appear twice in `styles.css`; a preprocessor was not worth it. An
inline script in `index.html` applies a stored theme before the first paint,
since a React effect would paint the other theme first.

## Meter labels measured, not estimated

Each meter label goes inside its segment when the segment is wide enough, else
on the row above the bar. Widths come from off-screen copies of the labels and
the track, watched by one `ResizeObserver`, so the choice holds at phone width
and after font loads; a character-count estimate was rejected as wrong for
proportional fonts. "limit 100%" is placed last, in the first free spot: above
the bar by the cap line, below it left of the line, else above with the other
labels moved around it. A fixed spot collided with the range bracket.

## Weekly projection without a calibration: typical week, then trend

Without a calibration, a week's own pace is noise for its first 12 hours, so the
projection is the typical past week (median and quartiles of final %, on the
current plan, never below what is used). After 12 hours the window's own trend
takes over. Only a first week without any history has no projection.

## A week without a reading still gets a card

Weekly windows are fixed 7-day blocks, so a week with no reading yet (nothing
used since the reset) follows the last known reset. Its usage is 0 % when the
transcripts show nothing since the start, else the calibrated cost since the
start, shown as an estimate. claude.ai use stays unseen until the first reading;
a plain 0 % was preferred over marking it `≈`.

## Limit card status: color band and tinted verdict

Each limit card has a 6 px top band and a tinted verdict box in the verdict's
color (green, orange, red). A thin colored border was rejected: with
deuteranomaly small colored areas are hard to tell apart. The verdict's icon
shape and text carry the same meaning. A stale reading does not change the
color; a warning icon by the number explains it.

## Session metadata on every record, titles per session

Each record carries `sessionId`, `sidechain`, `effort`, `thinking`,
`entrypoint`, `gitBranch`, `cwd` and `version` (about +70 % size, some 15 MB a
year). A per-session table would save half of that, but the branch and `cwd`
can change within a session, and one file is simpler to keep consistent.
Titles (`ai-title` lines, the latest wins) are AI summaries of a conversation,
so they can name clients or topics and outlive the transcripts; accepted since
the data dir is local, already holds paths and branch names, and the API is
loopback-only. They live in `sessions.json`, one file to delete to drop them.

## One-time re-read on a scan-format bump

New record fields would leave every message imported before them empty. When
`scan-state.json`'s `format` is older than `SCAN_FORMAT`, the collector backs up
the message files (`backup-format-<n>/`, made once, through a temp folder),
resets every offset and rescans; `mergeRecord` fills a record lacking
`sessionId` from the copy with the same `output`, since earlier streamed copies
carry a partial `thinking` count. The format is written last, so a crash only
repeats the re-read. Records whose transcripts are gone keep their fields.

## A conversation's project is the directory it started in

The Breakdown counts every message of a conversation, subagents included,
under the working directory of its first message, drive letter lower-cased.
Claude Code moves into subfolders mid-conversation (seen: `node_modules\…`,
`docs\plans\done`), so each message's own directory scattered one project into
junk rows. The transcript folder name was rejected: it is lossy (spaces and
dots become `-`) and only serves as a fallback for records without a directory.

## Breakdown precomputed for its three periods

`buildSummary` returns the Breakdown for this week, the last 4 weeks and all
time, so the period toggle is instant; it adds a few dozen rows to the summary.
A `/api/breakdown?period=` route was rejected: one more route and a loading
state per click for no gain at this size. "Last 4 weeks" is this weekly window
and the 3 before it, so "This week" is a subset of it. A conversation that
straddles a period start is ranked and measured by its messages inside the
period only.

## Usage tab: upgrades by highest version, outliers from $1

An upgrade is a local day on which the highest Claude Code version seen so far
rose: several surfaces run at once (the Python SDK stayed on 2.1.281 while VS
Code ran 2.1.287), so comparing each message with the previous one would mark
false downgrades and upgrades. Markers are dashed lines at the start of the
day's bar, with the version written to the right of the line's top.

A message is an outlier from $1, a fixed amount rather than a percentile,
because it reads plainly and matches what the data shows: the costliest
messages are 1-hour cache rewrites of 200k–550k tokens after a pause. The cause
names the largest cost component and the pause when it outlived that cache.

## Sessions tab: windows anchored on readings, peaks kept apart

A reading's `fiveHourResetsAt` places its 5-hour window exactly; messages
outside every reading window open estimated windows (first message + 5 h), cut
short where a reading window starts. Real data showed why: readings put windows
at 07:50, 12:50… UTC back to back, while the transcript rebuild starts them at
the first message. A reading window's peak is the highest % read in it, never
topped up with an estimate; an estimated window's peak is `k × cost` from the
5-hour calibration, shown with "~". Rejected: the transcript-only rebuild alone.

A window "hit the limit" when a reading reached the limit threshold (setting,
95% by default, 50–100), not only 100%: close to the limit a new agent run
stops almost at once, so the window is as good as spent. Estimates never count.

A week has its own threshold (setting, 98% by default, 50–100): 5% of a week is
hours of budget, so a run is not stopped at once at 95%, but a week read at 98%
is as good as spent. Only the Weeks tab's "hit" and the Plans tab's demand
estimate use it (`weekHistory.ts`, `planFit.ts`). The forecast, the "Limit
reached" verdict and a plan's "weeks over" stay at 100%: they predict or compare
against the real wall, not the user's behaviour near it.

## Calibration tab: drift against the median, not the fit

The drift chart compares each weekly window's ratio (% of the limit per $100 of
Claude Code usage, from its last reading) with the median of the completed
windows, not with the fit's `k`: the fit already leans toward recent weeks
(half-life 2 weeks), so a real drift would pull the reference toward itself and
hide. A window is off beyond 15%; the alert needs the last two completed
windows off the same way. Windows under 10% are skipped (not the fit's 5%): a
whole-percent rounding is ±0.5 pt, 10% of a 5% reading, close to the threshold.

Deleting a manual reading removes its line from `snapshots.jsonl` under the
data-dir lock and keeps it in `deleted-readings.jsonl`: a manual reading cannot
be typed back, its numbers came from `/usage` at that moment. Marking readings
deleted inside `snapshots.jsonl` was rejected: every reader would need to
filter them. Only manual readings can be deleted; the endpoint's are never
touched.

## Weeks tab: windows follow the readings, estimates never hit

The Weeks tab lists the last 12 weekly windows, cut where `weekStartFor` cuts
them (the first reset after a message), so its weeks match the Usage tab's
weekly chart. A week's final % is its last reading, converted to the current
plan like the Overview did; a completed week without a reading gets `k × cost`
(capped at 100, shown with "~"). A week "hit the limit" only from a final reading at
the weekly threshold: a transcript estimate, or a reading extended from before the reset, never counts, as on the Sessions tab. The day cells
are fixed 24 h blocks from the reset, not calendar days: the reset is mid-day,
and fixed blocks ignore DST. The Overview's "Past weeks" card was removed: the
tab shows the same windows with more.

## Plans tab: best plan by verdict, Opus as Sonnet at today's price

Each plan gets one verdict from the finished weeks among the last 12 windows
and the 5-hour sessions that started in them, converted with the advertised multipliers: **fits** (never at 100%,
busiest week at least half the limit), **close** (1 or 2 weeks over, and at most
a tenth of the sessions), **too small**, **too big** (never over, busiest week
under half). The best plan ranks fits, close, too big, too small, then fewer
weeks over, fewer sessions over, lower price: a plan that fits everything but
is too big is only suggested when nothing better exists, and close beats too
big because paying double to avoid one week at the limit is rarely right. The
50% bound and the other thresholds are named constants in `core/planFit.ts`.

The Opus-to-Sonnet what-if re-prices each message's tokens at the newest Sonnet
price (the work as it would run today, not on the Sonnet of its own
generation). Each week and session carries `shift`, the share of its cost saved
if all Opus ran on Sonnet, so any share between 0 and 1 is linear and the
browser recomputes it without a server round trip. It assumes limits scale with
API price across models, the least certain for Opus versus Sonnet.

A week that reached 100% on the current plan, or a session whose reading hit the
limit threshold, only shows 100: its demand is `max(100, k × cost)` when
calibrated, otherwise the capped 100 as a lower bound. A week that was capped on
a previous plan and a session estimated from transcripts (already capped at 100)
are not lifted.

## Accepted risks: append-only transcripts, non-atomic lock on Docker

The scan resumes each transcript from its stored byte offset and never checks
that the bytes before it are unchanged, so a transcript rewritten to a larger
size would be read from the middle of a line. Claude Code only appends, and
every scanned transcript has an offset on a line end with no malformed lines.
A checksum of the bytes before the offset would catch it; rejected as code for a
case that does not occur.

The data-dir lock (`wx` create) is shared by the host's hook and the Docker
dashboard through Docker Desktop's file sharing, where exclusive create is not
strictly atomic, so two simultaneous runs could both take it. Accepted: runs
last about a second, writes are atomic (temp file, then rename), and a lost
write is imported again by the next scan because offsets only advance after a
save. A read-back of the lock file would narrow the race without closing it and
cannot be tested. Revisit if malformed lines or missing messages ever appear.
