# Summary performance: faster `/api/summary`

## Goal

Loading the dashboard waits on `GET /api/summary`: about 1.2–1.7 s in the Docker
container and about 350 ms on the host. Cut the time spent in `buildSummary`,
which is slow everywhere, and stop making the first paint wait for the
transcript scan, which is slow in the container. The summary content stays
exactly the same.

## Baseline (measured on the user's data: 9,800 records, 332 transcripts)

| Phase | Host | Container |
| --- | --- | --- |
| `scanTranscripts`, nothing new | 45 ms | ~810 ms |
| `buildSummary` | 230–310 ms | 300–370 ms |
| `loadRecords` | 20 ms | 45 ms |
| `curl /api/summary` end to end | — | 1.17–1.46 s |

- **Container scan**: the container reads `~/.claude` through Docker Desktop's
  Windows bind mount, where each file-system call costs about 1.5 ms. Listing
  `projects/` (1,108 entries) takes 332 ms. The sequential `stat` per transcript
  in `scan.ts:101-102` takes 508 ms in total, against 93 ms when run in
  parallel.
- **`buildSummary` CPU profile**, self time over 5 runs: `priceFor`
  (`pricing.ts:30`) 136 ms, `buildBreakdown` (`breakdown.ts:183`) 128 ms,
  `dayKey` (`aggregate.ts:19`) 115 ms, `projectOf` (`breakdown.ts:108`) 85 ms,
  `messageCost` 72 ms, `aggregate` 61 ms, `activeByFamily` 58 ms. Each of these
  runs per record, many times per request, on a few distinct inputs (a handful
  of models, a few dozen folders, a few hundred days).
- **Two requests in `npm run dev`** come from React `StrictMode`
  (`dashboard/main.tsx:11`), which runs effects twice in development only. Both
  requests share one Node thread, so the slower one reads about twice the
  `buildSummary` time. Not a bug; out of scope.

## Acceptance criteria

- WHEN `buildSummary` runs on the same input before and after this work, THE
  SYSTEM SHALL return identical output (same `JSON.stringify` with a fixed `now`).
- WHEN `buildSummary` runs warm on the user's data on the host, THE SYSTEM SHALL
  take at most half the baseline median (target ≤ 120 ms).
- WHEN `dayKey(ms, timeZone)` is called, THE SYSTEM SHALL return what
  `Intl.DateTimeFormat` returns for that instant, including across DST changes
  and in zones with 30- and 45-minute offsets.
- WHEN `scanTranscripts` runs, THE SYSTEM SHALL issue the per-file `stat` calls
  concurrently and still process the files in the order `listTranscripts`
  returns them.
- WHEN `/api/summary` is called in the rebuilt container, THE SYSTEM SHALL
  answer at least 400 ms faster than the baseline (median of 5 `curl` runs).
- IF a transcript disappears between listing and `stat`, THEN THE SYSTEM SHALL
  behave as today (the run fails and records `lastError`).
- WHEN `GET /api/summary?collect=0` is called, THE SYSTEM SHALL answer from the
  data dir without running the collector (no scan, no endpoint call, no write).
- WHEN `GET /api/summary` is called without `collect=0`, THE SYSTEM SHALL behave
  as today (collect, then answer).
- WHEN the dashboard loads, THE SYSTEM SHALL render from `/summary?collect=0`,
  then request `/summary` and replace the data with its answer.
- IF the fast request fails, THEN THE SYSTEM SHALL still run the full request,
  and show an error only if the full one fails too.
- WHILE the full request after the first paint is running, THE SYSTEM SHALL
  show the existing `busy` state, not the "Loading…" placeholder.
- WHEN the 5-minute auto-reload, the refresh button or a settings change runs,
  THE SYSTEM SHALL behave as today.

## Design

### Measuring (do this first and after each step)

Profile on a **copy** of the data dir, never the real one (`AGENTS.md`
invariant). Keep the scripts in the session's scratchpad, not in the repo.

```sh
cp -r ~/.claude-code-analytics "$SCRATCH/data"
# Disable the endpoint in the copy so no API call is made:
# set "endpointEnabled": false in $SCRATCH/data/settings.json
```

`bench.ts` (run with `CCA_DATA_DIR="$SCRATCH/data" node bench.ts`, Node 24 strips
the types; append `--cpu-prof --cpu-prof-dir=.` to profile):

```ts
const root = 'file:///S:/Dev/Web/ClaudeCodeAnalytics';
const { Store } = await import(`${root}/src/collector/store.ts`);
const { buildSummary } = await import(`${root}/src/core/summary.ts`);
const store = new Store(process.env.CCA_DATA_DIR!);
const [records, events, snapshots, settings, titles] = await Promise.all([
  store.loadRecords(), store.loadEvents(), store.loadSnapshots(), store.loadSettings(), store.loadSessions(),
]);
const NOW = Date.parse('2026-10-12T12:00:00Z'); // fixed, so outputs compare
const run = () => buildSummary({
  endpointEnabled: true, events: [...events.values()], limitThreshold: settings.limitThreshold, now: NOW,
  planHistory: settings.planHistory, records: [...records.values()], snapshots,
  throttleMinutes: settings.throttleMinutes, timeZone: 'Europe/Paris', titles,
  weekLimitThreshold: settings.weekLimitThreshold,
});
const times = [];
for (let i = 0; i < 7; i++) { const s = performance.now(); run(); times.push(performance.now() - s); }
console.log('median ms', times.sort((a, b) => a - b)[3].toFixed(0));
if (process.argv[2]) (await import('node:fs')).writeFileSync(process.argv[2], JSON.stringify(run()));
```

Before any change, save the reference output (`node bench.ts before.json`).
After each step, write `after.json` and check the two files are byte-identical.
To read a `.cpuprofile`, sum `timeDeltas` per node's `callFrame` (self time),
or load it in Chrome DevTools > Performance.

Container timings: `curl -s -o /dev/null -w '%{time_total}\n'
http://analytics.claudecode.localhost/api/summary`, 5 runs, after `npm run docker:up`.

### Step 1: cache the per-record helpers in `core`

All caches are module-level `Map`s keyed on **immutable primitive inputs**
(strings, numbers). Never key a cache on a `UsageRecord` object: the collector
mutates records in `mergeRecord`, so an object-keyed cache could return a stale
cost.

- **`priceFor(model)`** (`pricing.ts:30`): cache the result per model string,
  `undefined` included (use `has`, not a truthiness check). Distinct models are
  a handful. This also removes most of `costParts`/`messageCost` time, which is
  mainly the `priceFor` lookup; leave `partsAt`'s arithmetic alone.
- **`dayKey(ms, timeZone)`** (`aggregate.ts:19`): per time zone, cache the result
  by `Math.floor(ms / 900_000)` (15-minute slot). Every real time zone, past or
  present, changes date only on a 15-minute boundary (offsets such as +5:30,
  +5:45, +12:45, and Lord Howe's 30-minute DST shift are all multiples of 15
  minutes), so every instant in one slot has the same local date. The cache
  grows by about 96 entries per day of history per zone; that is acceptable,
  note it in a short comment.
- **`projectOf(cwd, folder)`** (`breakdown.ts:108`): cache by
  `` `${cwd}\0${folder}` `` when `cwd` is set. It returns a new object today;
  check callers do not mutate the returned object (`buildBreakdown` spreads it
  into `projectRow`, which is fine). If any caller mutates it, return a copy.
- Re-profile. If `buildBreakdown` self time is still high, look inside its
  loop (`breakdown.ts:201+`): `toolLabel` is called twice per tool part
  (compute it once), and `Date.parse(record.ts)` runs in nearly every
  aggregator. Do not introduce a shared "parsed records" structure across
  modules without asking: that is an architectural change.
- Stop optimizing once the target is met; list what is left in the final report.

### Step 2: parallel `stat` in the scan

In `scanTranscripts` (`scan.ts:101`), replace the per-iteration `await stat(file)`
with one `Promise.all(files.map(f => stat(f)))` before the loop, then iterate
the files with their stats in the original order. Reading and parsing stay
sequential: `records`, `sessions` and `events` are mutated in file order, and
`seen` depends on it. A rejected `stat` rejects the whole scan, the same as
today. Unbounded concurrency is fine: libuv runs at most 4 file-system calls at
once and queues the rest.

The `readdir` itself (332 ms in the container) cannot be made parallel this way;
step 3 takes the whole scan off the first paint instead. Step 2 still shortens
the second request and the widget's `/api/widget` polls.

### Step 3: first paint without the scan (stale-while-revalidate)

The first paint shows the stored data at once; the scan runs right after and
its result replaces it about a second later in the container.

Why not drop the dashboard's scan and rely on the Claude Code hook: the hook is
a `Stop` hook (`collector/hook.ts:26`), so it imports only when a response ends.
During a long agent turn, nothing would reach the dashboard until the turn
finished. Why not watch the folder (`fs.watch`): change notifications
from a Windows folder do not reliably reach a Docker container.

**Server** (`server/api.ts:196`): `GET /summary` reads a `collect` query
parameter. `collect=0` skips the `collect(...)` call and returns
`summary(store, timeZone)`. Any other value or no parameter keeps today's
behavior. `/widget` is unchanged. The server keeps no background work after
answering: the client makes the second request, so a failed collect still
reaches the status the normal way.

**Client** (`dashboard/api.ts`, `dashboard/App.tsx:52`):

- `request` builds the URL with `URLSearchParams` so a path can carry extra
  parameters next to `tz`. Add `loadStoredSummary = () => request('/summary',
  undefined, { collect: '0' })` (or equivalent; keep `request`'s signature
  readable).
- On mount, run the fast load, then the full one, in sequence:
  `await run(loadStoredSummary)` then `void run(loadSummary)`. `run` already
  drops answers that arrive after a newer request started
  (`latestRequestRef`), so the fast answer can never overwrite the full one.
  Errors: `run` clears the error on the next success, so a failed fast request
  followed by a successful full one shows no error; check this in a test.
- The "Loading…" placeholder shows only while there is no summary at all.
  During the full request the header's `busy` indicator shows instead; check
  what `busy` currently looks like and that it reads as "updating", not as a
  blocking state.
- The interval reload, `refreshNow` and the POST actions are unchanged.
- In `npm run dev`, `StrictMode` runs the mount effect twice, so four requests
  appear. That is expected in development only.

Do not add "nothing changed" short-circuits (such as a 204 when the scan
imported nothing): the second request costs one `buildSummary` (about 100 ms
after step 1), off the critical path.

**Tests**: `server/routes.test.ts` covers `collect=0` (no collector run: no
`status.json` written in a temp data dir, or the collector stubbed, matching
the file's existing style). `dashboard/App.test.tsx` covers: the first fetch
URL has `collect=0`, the second does not, the second answer replaces the
first, and a failed fast request followed by a successful full one shows no
error.

**Expected result**: container reload around 150–200 ms to first paint
(estimate; measure it), host and `npm run dev` around 100–150 ms. In the
browser's network panel, the first `/summary?collect=0` is the request the
page waits on.

### Edge cases and failure modes

- `dayKey` across DST: the cache key is the instant, not a local time, so the
  23- and 25-hour days are handled; the test must cover both transitions.
- `priceFor` for an unknown model must keep returning `undefined` (cached).
- Unit tests that change prices or zones at runtime: check none rely on
  `priceFor` reading `PRICES` fresh each call (`PRICES` is a `const`).
- The collector runs from this working copy through the hook
  (`AGENTS.md` invariant): keep `npm run collect` working after each step. No
  `SCAN_FORMAT` bump: stored records do not change.

## Checklist

- [x] Baseline: run `npm run lint`, `npm test`, `npm run build`; note existing failures and warnings
- [x] Copy the data dir to the scratchpad, disable the endpoint in the copy, save `before.json` and the baseline median
- [x] Measure the container baseline (5 × `curl`)
- [x] Test: `dayKey` matches `Intl.DateTimeFormat` over every 7-minute instant across both 2026 DST transitions in `Europe/Paris`, and in `Asia/Kathmandu`, `Asia/Kolkata`, `Australia/Lord_Howe`, `Pacific/Chatham`
- [x] Cache `priceFor` per model (test: unknown model stays `undefined` on repeated calls)
- [x] Cache `dayKey` per 15-minute slot
- [x] Cache `projectOf` per `cwd` + folder
- [x] Re-measure: `after.json` identical to `before.json`; record the new median and profile
- [x] If over target: optimize the remaining hot spots in `buildBreakdown`, re-check identity
- [x] Parallel `stat` in `scanTranscripts`; `scan.test.ts` passes unchanged
- [x] `npm run collect` against a temp `CCA_DATA_DIR` still works
- [x] Server: `GET /summary?collect=0` skips the collector; test in `routes.test.ts`
- [x] Client: fast load then full load on mount; tests in `App.test.tsx`
- [x] `npm run lint`, `npm test`, `npm run build`: no new problems
- [x] Check in a browser on `npm run dev` that the page renders from `collect=0` and then updates
- [x] `npm run docker:up`, measure the container (5 × `curl` on both `/summary?collect=0` and `/summary`) and compare with the baseline
- [x] Peer review (fresh context, read-only) against these criteria
- [x] Final report: before/after numbers per phase, what is left
