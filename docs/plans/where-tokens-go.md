# Where tokens go

Status: implemented and verified in the worktree `where-tokens-go` (branch
`worktree-where-tokens-go`); uncommitted. Left: rebuild the container after
merging (`npm run docker:up`), then delete this plan in the final commit.

## Goal

Breakdown shows where output tokens go: by tool (with thinking and plain reply
text as their own buckets) and by skill or slash command. Every figure sums to
the period's output total.

## Acceptance criteria

- WHEN a message's content blocks are streamed as several transcript lines of
  one message, THE SYSTEM SHALL keep the union of their tool calls on the one
  stored record, whichever order the lines arrive in and across separate scans.
- THE SYSTEM SHALL split a message's non-thinking output tokens evenly across
  its tool calls with largest-remainder rounding, so the parts are integers
  summing to `output - thinking`.
- WHEN a message has no tool call, THE SYSTEM SHALL count its non-thinking
  output as `Reply text`.
- THE SYSTEM SHALL show per period (week, 4 weeks, all) a "Where output goes"
  card listing thinking, reply text and each tool, whose rows sum to the
  period's output tokens.
- WHEN a user turn starts with a slash command, or the model calls the `Skill`
  tool, THE SYSTEM SHALL attribute that turn's later messages (until the next
  real user prompt) to that skill or command.
- THE SYSTEM SHALL show a "By skill or command" card with output tokens and
  API-equivalent cost per skill, plus a `No skill` row, summing to the period
  total.
- WHILE a transcript is scanned incrementally, THE SYSTEM SHALL carry the
  active skill across scans, so a resume mid-turn keeps the attribution.
- IF a stored record has no tool data (its transcript is gone), THEN THE SYSTEM
  SHALL count its non-thinking output as `Untracked`, never dropping it.
- THE SYSTEM SHALL NOT store message content, prompts or tool inputs: only tool
  names and skill/command names.

## Design

Verified on the real transcripts (not assumed):

- Claude Code writes one line per content block with the same `message.id` and
  `output_tokens` (e.g. `thinking`, then `tool_use:Artifact`). Today
  `mergeRecord` drops equal-output copies, so tool names must be merged there.
- Tool calls are `tool_use` blocks with `name`; the `Skill` tool's input has
  `skill` (`superpowers:brainstorming`). Slash commands are user lines holding
  `<command-name>/plugin</command-name>`.
- `output_tokens` is per message, not per block, so a per-tool split is an
  estimate. An even split is the simplest rule that sums exactly; tool input
  size would be a better weight but would mean storing it.

Changes:

- `core/types.ts`: `UsageRecord.tools?: Record<string, number>` (name → calls)
  and `skill?: string`.
- `core/transcript.ts`: read `tool_use` names from `message.content`;
  `parseTranscriptLine` takes the active skill and `mergeRecord` merges `tools`
  (sum of distinct blocks is not possible to tell apart, so take the max count
  per name across copies: each copy holds a different block, and parallel calls
  of one tool arrive in separate lines, so the sum is right; see open point 1).
  New pure `parseSkillSignal(line)` returns `{ kind: 'prompt' | 'skill' |
  'command', name? }` for non-assistant lines.
- `collector/scan.ts` and `store.ts`: per-file `skill` in the scan state,
  updated line by line, reset on a real user prompt. `SCAN_FORMAT` 2 → 3, the
  last edit, after tests pass (AGENTS.md).
- `core/outputSplit.ts` (new, pure): `splitOutput(record)` with largest
  remainder; `buildBreakdown` gains `output: { label, tokens }[]` and
  `skills: { name, tokens, cost }[]`.
- `dashboard/Breakdown.tsx`: two cards, using `ShareBars`-style rows with a
  second cue (token count and percent as text, not color alone), `InfoTip`
  explaining that per-tool figures are an even split.

Edge cases: parallel tool calls in one message; a `Skill` call whose turn ends
with an interrupt; subagent files (sidechain) get no skill and count under
`No skill` (a subagent started by a skill is not attributed; backlog item);
MCP tool names are long, so group `mcp__<server>__*` under the server name.

## Open points for approval

1. Merge rule for `tools` across copies: sum if each copy holds a different
   block (what I saw), which the tests will pin down.
2. Skill attribution is by turn, not by message content: a message after
   `Skill` call is the skill's even when the model drifts. Accepted as the
   cheapest honest rule.
3. Subagent output under a skill stays `No skill`.

## Checklist

- [x] Failing tests: tool extraction and merge across streamed copies
- [x] `tools` on records, merged in `mergeRecord`
- [x] Failing tests: `splitOutput` sums exactly (largest remainder)
- [x] Skill signal parser and per-file active skill in scan state
- [x] `buildBreakdown` output and skill rollups
- [x] Breakdown cards, with tests
- [x] Bump `SCAN_FORMAT`, rebuild the container (`docker:up`)
- [x] Delete the roadmap item and the two backlog items; decisions entry if any
- [x] Lint, test, build; browser check
- [x] Peer review (one round; the cross-scan tool loss and the compaction line were fixed)
