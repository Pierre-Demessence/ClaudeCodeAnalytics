# Context added per tool

Design canvas: https://claude.ai/artifact/36EJJ3oX6ThAnPnsJrBeSA (span 6, light and dark).

## Goal

Show which tools fill the context: the size of each tool's results, with a
screenshot count, on the Breakdown tab. Measured sizes, not a cost model
(option 1 of "Input side per tool" in the backlog).

## Acceptance criteria

- WHEN a transcript holds a `tool_result`, THE SYSTEM SHALL add its text length
  and image count to the record of the message whose `tool_use` it answers,
  under that tool's name.
- WHEN a result arrives in a later scan than its call, THE SYSTEM SHALL still
  attribute it (open call ids are kept in the scan state).
- WHEN a transcript is read again from its start, THE SYSTEM SHALL NOT count
  results twice.
- THE SYSTEM SHALL store only counts (characters, images, results), never
  content.
- WHEN the Breakdown tab shows a period, THE SYSTEM SHALL list the tools by
  tokens added (4 characters per token, 1,600 per image), an MCP server's tools
  as one, with the rest grouped as "Other tools (N)".

## Design

- `UsageRecord.context?: Record<tool, { chars; images; results }>`. Tokens are
  derived at aggregation (`core/contextAdded.ts`), so the estimate can change
  without a re-read.
- `core/transcript.ts`: `parseToolCallIds` (assistant line) and
  `parseToolResults` (user line). `mergeRecord` keeps `context` when a later
  copy replaces the record.
- `collector/scan.ts`: per file, `calls` (call id to record key and tool name)
  persists in the scan state until its result is read. The first result applied
  to a record in a read from the start resets its context.
- `SCAN_FORMAT` 6 to 7, as the last edit.
- `core/breakdown.ts`: `Breakdown.context`. Dashboard: `ContextCard`, a span-6
  cell in the Breakdown card grid.

## Checklist

- [x] Parsers and `mergeRecord` (tests first)
- [x] Scan: pending calls, no double count on re-read, later-scan result
- [x] Aggregation in `breakdown.ts`
- [x] `ContextCard` on the Breakdown tab
- [x] Docs: `AGENTS.md` invariant, `docs/decisions.md`, backlog and roadmap
- [x] Lint, build, tests; browser check; review
- [x] `SCAN_FORMAT` bump (last)
