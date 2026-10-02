# Breakdown tab

## Goal

Add a Breakdown tab that shows where the usage goes: by project, by
conversation, main agent vs subagents, by effort level and by surface. It
matches the design board `Projects.dc.html`
(<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>), for three periods.

## Acceptance criteria

- THE SYSTEM SHALL show a Breakdown tab at `#/breakdown`, between Usage and
  Calibration in the tab bar.
- WHEN the tab opens, THE SYSTEM SHALL show the current weekly window ("This
  week"). WHEN the user picks "Last 4 weeks" or "All time", THE SYSTEM SHALL
  show that period instead, without a new request.
- THE SYSTEM SHALL show the period's total API-equivalent cost. WHILE "This
  week" is selected and the current week has a known %, THE SYSTEM SHALL also
  show that % of the weekly limit (the estimated % now when there is one).
- THE SYSTEM SHALL list projects by descending cost. Each row shows the
  project name (the directory's last segment, with the full path as tooltip), a
  cost bar split by model family, the cost, the share of the period's total and
  the cache share of input tokens.
- THE SYSTEM SHALL count each conversation's messages under the directory the
  conversation started in, compared without the drive letter's case, including
  messages sent after Claude Code moved into a subdirectory.
- THE SYSTEM SHALL show the main agent's and the subagents' share of the
  period's cost, as a two-part bar with % and $ labels.
- THE SYSTEM SHALL show the main agent's cost share per effort level (only
  levels present, in the order low, medium, high, xhigh, max) and the thinking
  share of output tokens.
- THE SYSTEM SHALL show the cost share per surface (Terminal, VS Code, Python
  SDK, …; an unknown value shows as is; a missing one as "Unknown").
- THE SYSTEM SHALL list the 10 most expensive conversations of the period. Each
  row shows the conversation's title, project and branch, its start, duration,
  message count, model split, subagent share and cost.
- IF a conversation has no title THEN THE SYSTEM SHALL show its project and
  branch only.
- IF the period has no usage THEN THE SYSTEM SHALL show an empty state instead
  of the cards.
- THE SYSTEM SHALL never carry meaning by color alone: model bars use the family
  patterns plus a legend, the subagent part is hatched, and every bar has a %
  or $ label. Metrics carry `title` tooltips.
- WHILE the viewport is phone-width, THE SYSTEM SHALL put each project's model
  bar under its name, stack the cards, and scroll the conversations table
  inside its card.

## Design

**Computed on the server, all three periods at once.** A new pure module
`core/breakdown.ts` exports `buildBreakdown(records, titles, from)`. It
returns one period's `Breakdown`. `buildSummary` calls it three times and adds
`breakdown: Record<'week' | 'fourWeeks' | 'all', Breakdown>` to the summary.
Precomputing makes the toggle instant and keeps a year of records off the
browser (see the decision "Server-side summary"). The payload adds roughly
40 project rows and 30 conversation rows. Rejected: a `/api/breakdown?period=`
endpoint. It would add a route and a loading state per click, for no gain at
this size.

**Periods.** "This week" starts at the current weekly window's start, using the
same anchoring as the `weekly` rows (`weekStartFor` over the readings' resets,
or the local ISO week before any reading). "Last 4 weeks" starts 3 windows
earlier, so it holds this week plus the 3 before it, and "This week" is a
subset of it. "All time" has no start.

**Projects.** Each message's project is the normalized `cwd` of the first
message in its `sessionId` (normalized means drive letter lower-cased).
Claude Code `cd`s into subfolders mid-conversation: the real data has 26
distinct directories, among them `…\node_modules\three\src\nodes` and
`…\docs\plans\done`. Using each message's own `cwd` would scatter one project
into junk rows. A record without `cwd` falls back to `project` (the transcript
folder name). Subagent messages carry their parent's `sessionId`, so they land
in the parent's project. Worktrees (`X.worktrees\branch`) stay separate
projects (backlog).

**Shapes** (`core/breakdown.ts`; costs from `messageCost`):

```ts
interface CostSplit { cost: number; byModel: Record<string, number> }
interface Breakdown {
  total: { cost: number; messages: number };
  projects: (CostSplit & { path: string; name: string; cacheShare: number })[];
  agents: { main: number; subagents: number };   // $
  effort: { level: string; cost: number }[];     // main agent only
  thinkingShare: number;                         // thinking / output tokens
  surfaces: { entrypoint?: string; cost: number }[];
  conversations: (CostSplit & {
    sessionId: string; title?: string; path: string; name: string;
    branch?: string; start: string; end: string; messages: number; subagentCost: number;
  })[];
}
```

The core emits cost per model ID. The dashboard groups models into families
with `familyOf`, as the Usage tab does, because `core` cannot import
`dashboard/models.ts`. Cache share is `cacheRead / (input + cacheRead +
cacheWrite)`. A conversation's branch is the one most of its messages ran on.
Its start, end, message count and cost cover only its messages inside the
period. The ranking is by in-period cost, so a conversation that straddles the
week start shows its in-week part.

**Titles.** `server/api.ts` `summary()` also loads `sessions.json` and passes
the titles to `buildSummary` (new `SummaryInput.titles`).

**Dashboard.** `Toggle` moves from `RawUsage.tsx` to `dashboard/Toggle.tsx`,
and both tabs import it. `dashboard/Breakdown.tsx` lays out the board:

- the period toggle and the total line;
- a two-column grid: "By project" on the left; on the right, "Main agent vs
  subagents", "By effort level" and "By surface" stacked;
- the conversations table, full width.

Model-split bars are inline SVGs filled with the existing `PatternDefs`
patterns. Two patterns are added: `pattern-main` (solid) and `pattern-sub`
(hatched). Surface labels live in a small map: `cli` → Terminal,
`claude-vscode` → VS Code, `sdk-py` → Python SDK, `sdk-ts` → TypeScript SDK.
The effort label for `xhigh` is "Extra high". New tab: one `TABS` entry plus
its branch in `App.tsx`.

**Edge cases.**
- A conversation whose messages all fall outside the period is not listed.
- A conversation without a title shows "project · branch" as its label.
- With no effort data (no main-agent messages), the effort card says so.
- `unknownModels` cost is 0, as elsewhere.

## Checklist

- [ ] Baseline: lint, tests, build
- [ ] `core/breakdown.ts` with tests: start-directory attribution (subfolder moves, drive-letter case, missing `cwd`), periods, totals, agents split, effort order and main-only, thinking share, surfaces, cache share, conversation ranking, in-period stats, majority branch
- [ ] `buildSummary` `breakdown` for the three periods and `SummaryInput.titles`, with tests (week start from resets and without readings, 4-week start)
- [ ] `server/api.ts` loads `sessions.json` into the summary, with a route test
- [ ] `Toggle.tsx` extracted; `RawUsage.tsx` imports it
- [ ] `Breakdown.tsx`, patterns, styles (both dark blocks), tab entry and `App.tsx` branch, with tests (period switch, empty period, untitled conversation, labels and tooltips)
- [ ] Browser check against the board: light and dark, desktop and phone width
- [ ] Docs: README feature list; delete the done backlog items (per project, per conversation, agents, effort and thinking, surface); rewrite the branch item as "cost per branch"; add the worktree item; delete milestone 1 from the roadmap
- [ ] Review pass, then lint, tests, build
