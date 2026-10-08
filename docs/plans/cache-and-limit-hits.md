# Cache and limit hits

Roadmap milestone 1 of "Transcript forensics". Backlog items: cache anomaly
detection, observed rate-limit hits.

## Goal

Show, in the dashboard, which days burned cache (flushes) and which 5-hour
windows and weeks actually hit a rate limit (observed in the transcripts, not
inferred from a reading's %), each with an explanation.

## Findings that shape the design

- Transcripts hold structured error entries today (read from 7 local files,
  not the backlog's text rules): `isApiErrorMessage: true`, `error:
  'rate_limit'`, `apiErrorStatus: 429`, and
  `quotaLimits: { rateLimitType: 'five_hour', resetsAt: <epoch s>, status:
  'rejected' }`. Other errors: `error: 'server_error'` ("Connection lost…"),
  `invalid_request`. Message text: "You've hit your session limit · resets …",
  also "plan limit", "usage limit reached", "overloaded" (counts from a grep of
  all transcripts: 15 / 1 / 14 / 13).
- `parseTranscriptLine` drops these entries: model `<synthetic>`
  (`src/core/transcript.ts:47`). They need their own parser and store.
- `resetsAt` gives the exact window: start = `resetsAt` − 5 h. No guessing
  from timestamps.
- Only `five_hour` appears locally. The weekly value of `rateLimitType` is
  **unverified** (inferred `seven_day…`); the raw string is stored and mapped
  defensively, unknown values show as "other limit".
- No compaction marker (`isCompactSummary`, `compact_boundary`) exists in the
  local transcripts (0 matches), so the no-gap-flush exclusion cannot be
  verified on real data; it is built from the documented shape and unit-tested
  with fixtures only.
- `capped` on `FiveHourWindow` (`src/core/sessions.ts:18`) is inferred from a
  reading reaching the threshold. Observed hits are a separate, stronger flag.
- Flush detection needs no new record field: `cacheWrite5m/1h`, `cacheRead`,
  `ts`, `sessionId`, `sidechain` are stored (`src/core/types.ts`).

## Acceptance criteria

- WHEN a session turn after a gap longer than the cache lifetime (5 min, or
  1 h when that turn wrote the 1-hour cache — `CACHE_LIFETIME_MS`,
  `src/core/activity.ts:18`) writes more than 2× the session's rolling median
  cache write, THE SYSTEM SHALL count it as an idle-gap flush on its local day.
- WHEN a turn within the cache lifetime reads less than 50% of the previous
  turn's cache read, and is not within 120 s of a compaction, THE SYSTEM SHALL
  count it as a no-gap flush.
- WHEN a day has flushes, THE CacheCard SHALL mark that day with an icon and
  tell the count, kinds and extra cost in its tooltip; THE card's legend SHALL
  give the flush count and extra cost over the 14 days the chart shows.
- WHEN an `isApiErrorMessage` entry has `error: 'rate_limit'`, THE SYSTEM SHALL
  store a limit hit (time, limit type, `resetsAt`, session id), never message
  text; server overloads (`overloaded`, HTTP 529) are stored apart.
- WHEN two hits of the same kind are within 15 min of each other, THE SYSTEM
  SHALL count them once.
- WHEN a 5-hour hit's window exists in Sessions, THE window SHALL show a
  "rate limit" marker with icon + text and the hit time in its tooltip,
  distinct from the inferred `capped`.
- WHEN a weekly-type hit falls in a week of Weeks, THE week SHALL show a
  marker with icon + text and the hit time in its tooltip; blocked 5-hour
  sessions are counted in the week.
- IF a record has no hit data (older stored data), THEN THE dashboard SHALL
  show no markers and no error.
- THE collector SHALL stay runnable while this is built (the hook runs it from
  the main working copy, not this worktree).
- Every new figure shown sums or counts from the stored events; tests assert it.

## Design

**Data.** New `src/core/events.ts` (pure): `parseEventLine(line)` →
`ApiEvent | null`, `ApiEvent = { key, kind: 'limit' | 'overload' |
'compaction', ts, sessionId?, limitType?, resetsAt? }`, `dedupeHits`. Key =
entry `uuid`, so re-reads are idempotent. `scan.ts` calls it for lines
`parseTranscriptLine` rejects (same branch as titles). `Store` gains
`loadEvents/saveEvents` on one `events.jsonl` (tens of lines, rewritten
atomically; not per month). `ScanResult.eventsChanged` mirrors
`sessionsChanged`.

**Detection (pure, in core).** `src/core/cacheAnomalies.ts`:
`detectFlushes(records, compactions)` → flushes `{ ts, kind: 'idle' | 'gap',
wasted }` where `wasted` = tokens written × (write price − read price), via
`costParts`/`priceFor`. Grouped by `sessionId` + `sidechain`, sorted by `ts`.
Rolling median over the previous 10 turns of the session (my choice; the
reference leaves it open). The "at least 100 tokens" floor of the reference is
read as a minimum cache write; **I will check both thresholds against the real
data and report the flush counts before settling**.

**Wiring.** `buildSummary` adds `activity.cache.flushes` per day and a week
total, and `hits` to `sessions` windows and `weekHistory` weeks (matched by
`resetsAt`, 5-hour window = `resetsAt` − 5 h). Inputs gain `events`;
`api.ts` (server) loads them.

**UI** (Lucide icons, `useTip`, never color alone — AGENTS.md):
- `CacheCard`: flush icon above the affected day bars, count + extra $ stat,
  legend entry, helper text.
- `Sessions.tsx` and `Weeks.tsx`: "Limit hit" badge (icon + text) with a tip
  naming the hit time and limit type.
- The design canvas has no cache-flush or limit-hit element (read: the Usage
  artboard and the canvas index; the other artboards were not opened). They
  are added in the existing style.

**`SCAN_FORMAT`.** Bump 2 → 3 as the very last edit, after tests pass
(AGENTS.md invariant), so the next run re-reads transcripts and picks up the
events. Records themselves gain no fields.

**Failure modes.** Malformed or unexpected error entries are skipped, not
counted as malformed lines. Unknown `rateLimitType` shows as "other limit".
Docker dashboard needs `docker:up` after merge (it runs the collector).

## Risks to the other worktree

`where-tokens-go` (milestone 2) also bumps `SCAN_FORMAT` and touches
`transcript.ts`, `types.ts`, `scan.ts`, `store.ts`, `Breakdown`. Whichever
merges second resolves a textual conflict and must set `SCAN_FORMAT` to
previous + 1 (one extra one-time re-read, harmless; a backup folder
`backup-format-<n>` is made each time).

## Checklist

- [x] Baseline recorded: lint clean, 409 tests pass (48 files).
- [x] `events.ts` parser + tests (rate limit, overload, compaction, junk, dedupe 15 min)
- [x] Store `events.jsonl` + scan integration + collect test (re-read fills events)
- [x] `cacheAnomalies.ts` + tests (idle flush, no-gap flush, compaction exclusion, 1 h cache, floor)
- [x] Tune thresholds on the real data (read-only copy), report counts (26 flushes, $34.84; subagent turns excluded)
- [x] `buildSummary` wiring + server load + types + tests
- [x] CacheCard flush marks and stats + test
- [x] Sessions and Weeks "limit hit" markers + tests
- [x] Docs: `docs/backlog.md` items removed, `docs/roadmap.md` milestone 1 removed, `docs/decisions.md` if the structured-error choice qualifies, README if it lists features, AGENTS.md (layout mentions)
- [x] Lint, build, tests; browser check of the dashboard on a temp data dir
- [x] `SCAN_FORMAT` 2 → 3 (last edit)
- [x] Peer review (fresh-context subagent), fix blocking findings

Status: implemented and verified; uncommitted. Calibration cross-check deferred to the backlog.
