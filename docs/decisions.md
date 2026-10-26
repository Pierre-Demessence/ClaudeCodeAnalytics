# Decisions

Non-obvious decisions: what was decided, why, and which alternatives were
rejected. Replace an entry when a decision is reversed.

## Limits from the undocumented usage endpoint, manual readings optional

`GET api.anthropic.com/api/oauth/usage` with Claude Code's OAuth token gives
the real weekly and 5-hour % (the numbers behind `/usage`). Anthropic does not
publish limits in tokens, so this is the only ground truth. Manual readings use
the same snapshot format, as a fallback if the endpoint breaks.

The endpoint is opt-in (`endpointEnabled` defaults to off): a tool that reads
`.credentials.json` without being asked looks like credential theft, whatever it
does with the token. Rejected: on by default, even with the README explaining it.

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

The hook is a `curl` POST to the Docker dashboard's `/api/hook`, not
`node src/collector/cli.ts`: a hook running the working copy ran whatever branch
was checked out, a contributor's included, as the user after every response.
The container runs only the image built by `docker:up`, with a read-only root and
two mounts. Rejected: running the local collector when the container is down
(brings the risk back); a copy of the collector installed outside the clone
(still runs with the user's full access).

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

Right after a plan change the current plan has no fit of its own yet (3 readings of
5% or more): the weekly and the 5-hour fits borrow the most recent other plan's,
converted at the advertised multipliers (`borrowedFrom`, said so on the Fit card),
until the plan has its own. Rejected: waiting, which leaves no projection for up to a
day after an upgrade; converting with the measured multipliers, which needs 3
completed weeks on both plans.

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
4 weeks, idle time included, rebuilt from message times; after a plan change, of the
sessions since it once there are 3, as for the weekly pace (a smaller plan's limit
cut its sessions short). Daily cost / 24 was
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
less time left. Without a calibration, a % cannot become dollars: no value. The
value stops at the reset: the use after it counts toward the next window.

## Estimated weeks and stale readings

A completed week whose last reading is more than 12 h before reset is extended
with the calibrated cost since, marked "est." and capped at 100%. A current
reading older than 30 minutes gets an estimated current % from transcripts. The
projection, the active use left and the room per day start from the reading plus
the usage since it even before then: during a heavy half hour on a small plan, a
reading shown as read trails by several points.

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
`node_modules`). The Claude Code hook asks the container for collector runs.

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
projection is the typical past week (median and quartiles of peak %, on the
current plan, never below what is used). After 12 hours the window's own trend
takes over. Only a first week without any history has no projection.

## Weekly forecast: the week's own ratio and pace, days under the current plan, resampled sums

The weekly calibration pools every reading of the current plan, but weeks of one
plan can burn the limit at very different rates per dollar (two weeks measured
0.028 and 0.099 % per $, likely the model mix), and the pooled ratio then
understates a heavy week. So the current week uses its own fit (`weekCalibration`)
once it has 3 readings of 5% or more, for its estimate since a stale reading, its
forecast, its pacing and its active time; everything else (past weeks, Plans,
value, the 5-hour side) keeps the pooled fit. A restarted week counts from its
restart: its own fit takes the running part's readings on the current plan, the pace
and the 3-day blend run from the restart, and the typical week is scaled to the
share of the window left after it. The pace comes from the days under
the current plan (at least 3, within the last 28, since the latest period whose plan
differs from the one before: the collector's first detected period changes nothing),
since the idle days before an upgrade say nothing about the usage after it. The forecast resamples the cost of
the days left as a sum of days drawn with replacement (seeded, 1000 draws), and
low/median/high are the quartiles of those sums. Rejected: the median day × the
days left, which is biased low for skewed usage with idle days (the median of a
sum of days is near the days × the mean, not the median day); and a weekly
calibration per model family, since the evidence is two weeks confounded with
time and the 5-hour readings do not confirm it (backlog). The 5-hour forecast
keeps the quantile of session paces × hours left: its samples are averages over
whole sessions, not independent hours.

The past days are only a prior for the week's pace: they are slow to follow an idle
week or a sudden heavy one. So the centre of the projection blends linearly toward
the week's own pace (used % over the time elapsed) over its first 3 days, and rests
on this week alone after that. The band keeps the spread of the resampled days
around that centre (floored at 0). Rejected: this week only from the start, since one
day extrapolated to a week swings 4× on this data; and a band from blended quartiles
(own pace and resampled ones alike), which collapses to a line as the own pace takes
over, since the week's own pace is a single value.

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

## Breakdown fetched on demand through `/api/range`

The summary carries the Breakdown for the default window only. Any other range
is computed by `/api/range` from the stored data: measuring all time on every
poll for a view opened rarely was wasted work, and a range is picked by the
user, so a loading state per pick is acceptable. A conversation that straddles
the range start is ranked and measured by its messages inside the range only.

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
the first message. An upgrade moves the 5-hour reset, so a reading window can start
before the previous one ends: the previous one ends there, and the messages after
the upgrade join the new window. A reading window's peak is the highest % read in it, never
topped up with an estimate; an estimated window's peak is `k × cost` from the
5-hour calibration, converted to the plan the window ran on like a reading (`k` is
fitted on the current plan), and shown with "~". Rejected: the transcript-only rebuild alone.

A window "hit the limit" when a reading reached the limit threshold (setting,
95% by default, 50–100), not only 100%: close to the limit a new agent run
stops almost at once, so the window is as good as spent. Estimates never count.

A week has its own threshold (setting, 98% by default, 50–100): 5% of a week is
hours of budget, so a run is not stopped at once at 95%, but a week read at 98%
is as good as spent. Only the Weeks tab's "hit" uses it (`weekHistory.ts`). The
forecast, the "Limit reached" verdict and a plan's "weeks over" stay at 100%:
they predict or compare against the real wall, not the user's behaviour near it.

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
weekly chart. A week's peak % is its last reading, converted to the current
plan like the Overview did; a completed week without a reading gets `k × cost`
(capped at the limit of the plan it ran on, its 90% pressure point read on that plan
too, shown with "~"). A week "hit the limit" only from a final reading at
the weekly threshold, read on the plan of that week rather than converted (a Pro week
at its limit is 20% of Max 5×): a transcript estimate, or a reading extended from before the reset, never counts, as on the Sessions tab. The day cells
are fixed 24 h blocks from the reset, not calendar days: the reset is mid-day,
and fixed blocks ignore DST. The Overview's "Past weeks" card was removed: the
tab shows the same windows with more. A week whose usage restarted shows the
parts' % added up on the current plan, flagged with a tooltip listing each part
(the median peak and the typical week include it).

## A weekly window splits where its usage restarts, and its parts add up

Anthropic restarts the weekly usage before the reset time: on an upgrade (the Pro to
Max 5× switch read 100% then 0%, with the same reset time, and restarted the 5-hour
window too) and, as the backlog notes, perhaps as a free reset. Read as one block, the
window's final % covers the new part only while its cost includes the old part's, so
such a week misleads every statistic read as one block. `windowParts` (`restarts.ts`)
splits a window into parts, recomputed from the readings and the plan history on every
summary (nothing stored, so weeks already stored come back). A reading 2 points or more
below the previous one of its window marks a restart, at the latest plan change between
the two readings, else at the later reading; an upgrade (a larger advertised limit)
before the window's first reading splits there, since the first reading already reads
the new part. A plan change without a drop (a downgrade, or one made before a
reading that shows no restart) keeps the window whole. Each reading's cost counts from
its part's start, and a week's % is the sum of its parts' final %, converted to one
plan: only the last part is extended to the reset, the ended ones come from their last
reading, else from the cost on the calibration. The threshold of 2 points is above the
rounding of one reading and well below any real restart (the one drop seen was 100 to
0). Rejected: leaving the week out, which drops one week in every upgrade from the
typical week, the median peak and the plan comparison; cutting it into separate
windows, since `weekSpan` (`planFit.ts`) fills the time it did not observe at the typical
pace and reads a short window as mostly hidden (so the parts stay in one week, each
with its own observed and hidden time); converting the earlier part on the pacing chart,
which would draw a Pro week at a fifth of its height instead of what the Pro limit read.

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

A week or session that hit its limit only shows what fit under it, so a plan's
demand is `max(reading, % at the cutoff + hidden hours × typical pace)`. The
hidden time is what the limit, or a missing subscription, kept out of the
readings: a week's tail after its pressure point (the first reading at 90%, or a
weekly hit) and the rest of each capped 5-hour session inside its observed
time; a week's time before the subscription; a session's tail after its cap. A
week estimated from transcripts also hides its time before the oldest transcript
(`transcriptsFrom`): Claude Code deletes old ones, so the first week of the data is
otherwise a light week. A week with readings needs no such time: the endpoint saw
all of it.
The pace is pooled, Σ % at the cutoff over Σ observed hours across the
comparison, so idle days count and one week cannot set it; under 72 h (weeks) or
10 h (sessions) observed it is not used and the reading stands. The usage after
the pressure point is left out of the pace: it is the slowed tail the estimate
replaces. Rejected: raising a capped week with `k × cost` (that cost stopped at
the same limit and only repeats the reading, without the claude.ai use); the week's
own pre-cap pace (assumes full speed through holidays: an upper bound, in the
backlog); a setting for the 90% (no data to tune it with).

## Accepted risks: append-only transcripts, non-atomic lock on Docker

The scan resumes each transcript from its stored byte offset and never checks
that the bytes before it are unchanged, so a transcript rewritten to a larger
size would be read from the middle of a line. Claude Code only appends, and
every scanned transcript has an offset on a line end with no malformed lines.
A checksum of the bytes before the offset would catch it; rejected as code for a
case that does not occur.

The data-dir lock (`wx` create) is shared by the host (`npm run dev`, `collect`)
and the Docker dashboard through Docker Desktop's file sharing, where exclusive create is not
strictly atomic, so two simultaneous runs could both take it. Accepted: runs
last about a second, writes are atomic (temp file, then rename), and a lost
write is imported again by the next scan because offsets only advance after a
save. A read-back of the lock file would narrow the race without closing it and
cannot be tested. Revisit if malformed lines or missing messages ever appear.

## Rate-limit hits from the structured error entries, in their own file

A limit hit is a transcript entry with `isApiErrorMessage`, `error:
'rate_limit'` and `quotaLimits.rateLimitType` / `resetsAt`; the exact window
end comes from `resetsAt`, so a hit lands in its 5-hour window without
guessing. The message text ("You've hit your session limit") is only a
fallback classifier and is never stored. Hits, overloads and compactions go to
`events.jsonl` (a few lines), not into the monthly message files: they are not
usage records and `parseTranscriptLine` drops `<synthetic>` models on purpose.
Rejected: matching the English text alone (the wording varies: "session",
"plan", "usage limit reached").

## A no-gap cache flush needs the lost read written back

Within the cache lifetime, a turn whose cache read fell under half the previous
turn's counts as a flush only if at least half of the lost read was written
back. Without that, `/clear` and compactions (context shrinks, nothing is
rebuilt) flagged 24 of 104 "flushes" on the local data, some of 473 tokens.
Rejected: the plain read-drop rule of the AeternaLabsHQ/claude-code-stats
reference.

Flushes are detected on the main conversation only: parallel subagents of one
session interleave their turns and records carry no agent id, so a subagent's
first turn read as a flush (54 of the 80 flushes found on the local data were
subagent turns, but only $3.60 of the $38.44).

A flush's extra cost counts the tokens written again only: the previous turn's
prompt, less what the turn still read from the cache, at the write price instead of
the read price. The rest of the write is the turn's new tokens, which a live cache
writes as well.

## Output split by tool: weighted by input size, per scan

Claude Code writes one transcript line per content block, each with the whole
message's `output_tokens`, so no tool call has a size of its own. A message's
non-thinking output is split across its tool calls in proportion to the
characters of their input plus a fixed overhead per call (largest remainder, so
parts sum exactly) and shown as an estimate. Only the character count of each
call's input is stored (`toolInput`), never the input, so the content stays out
of the data dir. A record without sizes splits evenly per call. Text written
beside the calls is not sized and goes to the tools too.

A skill owns the messages from the line that starts it (a slash command, or a
`Skill` tool call) to the user's next real prompt. The active skill is kept per
transcript in the scan state so an incremental scan resumes inside a turn.

A subagent's transcript starts no skill of its own, so its messages take, at
aggregation time, the skill of the conversation's latest main-agent message
at or before them. Rejected: linking each `Agent` call to its subagent file (needs
the call and result ids stored, and a scan order between files). The cost is
that a background subagent still running after the user's next prompt joins
that prompt's skill.

Tool counts from the copies of one message are added when the line continues
a message already met in the scan or lies after the stored offset; the first
copy met when a transcript is read from its start replaces the stored count, so
the re-read after a `SCAN_FORMAT` bump does not double them.

## Context added per tool: sizes stored, tokens estimated at display

A tool result sits on a later `user` line that names only the call's id, so the
scan joins it to the `tool_use` of the assistant line, and keeps the calls still
waiting for their result per transcript in the scan state (the hook scans right
after a response, so the result usually arrives in the next run). The record
stores characters, screenshots and result counts per tool, not tokens: the
estimate (4 characters per token, 1,600 per screenshot) lives in
`core/contextAdded.ts` and can change without a re-read. Screenshot size is a
single figure because the image dimensions would mean decoding base64. A
`tool_reference` block (a deferred tool's name) counts as nothing.

The figure is what a result added, not what it cost: charging it for every later
turn in the context is the carrying-cost model left in the backlog.

## Subscription cost from the billing date, not prorated

The Usage card sets what was charged against the usage of the same cycle: the
list price on each billing date, the day of the month the subscription started,
at the plan active then. Rejected: prorating the price over the days with data,
which reads $6 for a $20 Pro plan ten days into a cycle; it remains the fallback
without the date. Assumes monthly billing and list prices, in dollars before VAT.

"All time" counts only the cycles that end after the first imported message:
Claude Code deletes transcripts after `cleanupPeriodDays` (30 by default), so a
subscription older than that would set every charge since it began against one
month of usage. The cycle the first message falls in keeps its whole charge.
Rejected: prorating that cycle from the first message, since nothing tells deleted
transcripts from days without usage, and a new subscription's first cycle would
lose the days before its first message.

The start is the first plan period's when it was set by hand, else
`oauthAccount.subscriptionCreatedAt` in `~/.claude.json`, which can predate the
first payment (a failed one sets it). A detected first period only marks when the
collector first saw the plan. The plan history's starts are editable, so it is
the one place to correct; a separate subscription-date setting was rejected as a
second source for the same fact.

An upgrade follows Anthropic's invoice: it starts a new cycle there and then, at
the new plan's full price less a credit for the unused time of the plan paid for,
and later billing dates count from it. Rejected: keeping the billing day and
charging the price difference for the rest of the cycle, which an invoice
disproved. A downgrade is assumed to wait for the next billing date and refund
nothing (not checked against an invoice).

## The taskbar widget is a native Rust process drawing an SVG

The widget is one Win32 process: `resvg` renders `widget.svg` (the look, with
placeholders) into a bitmap that a layered child window of the taskbar shows
(`UpdateLayeredWindow`), about 10 MB. As a native child of the taskbar it gets real
mouse messages, so no mouse hook is needed and its right click never reaches the
taskbar's own menu. Rejected: WebView2 through Tauri (95 MB in 6 processes, and
Chromium never got real mouse input inside the taskbar, which forced a system-wide
`WH_MOUSE_LL` hook); Blitz (HTML/CSS, but pre-alpha and drawn on the GPU); Slint (its
winit-owned window is an unproven fit for reparenting into the taskbar); GDI text on a color key or alpha
bitmap (no antialiased text on transparency). The exe is installed by copying it, with
no installer, and "Start with Windows" is a `Run` registry value.

## The taskbar widget fetches over plain HTTP on loopback and polls `/api/widget`

The widget's one request is a hand-written HTTP/1.0 `GET` to `127.0.0.1:80` with
`Host: analytics.claudecode.localhost`: Windows does not resolve `*.localhost`
subdomains (only browsers do), and Traefik routes on the `Host` header. HTTP/1.0
means the answer is never chunked. Rejected: an HTTP client crate (`reqwest` is most of
the build for one request); a hosts-file entry, which lives outside the repo.
The widget polls a dedicated route that runs the collector rather than reading
the data dir itself, so readings keep arriving while the PC is idle and the
token stays in the collector.
