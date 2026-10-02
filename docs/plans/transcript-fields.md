# Collect the new transcript fields

## Goal

Store, on every usage record, the metadata Claude Code writes on each assistant
line that the Breakdown, Usage and Sessions milestones need, and fill it in for
the messages whose transcripts are still on disk. No new views.

## Acceptance criteria

- WHEN the collector imports an assistant line, THE SYSTEM SHALL store with its
  token counts, when present: `sessionId`, `sidechain` (only when true: a
  subagent's message), `effort`, `thinking` (output tokens spent thinking),
  `entrypoint`, `gitBranch`, `cwd` and `version`.
- WHEN a transcript has a conversation title (`ai-title` lines, written by
  Claude Code), THE SYSTEM SHALL keep the latest one per session in a separate
  `sessions.json` in the data dir.
- THE SYSTEM SHALL NOT store message content, prompts, tool inputs or outputs.
- WHEN the collector first runs with this change, THE SYSTEM SHALL re-read every
  transcript still on disk once, adding the new fields to the records it already
  holds for those messages.
- THE SYSTEM SHALL keep every record it already holds, including those whose
  transcripts are gone; such records keep their current fields.
- BEFORE that one-time re-read, THE SYSTEM SHALL copy the message files to a
  backup folder in the data dir, and keep it.
- IF the re-read fails partway THEN THE SYSTEM SHALL leave the stored records
  valid and retry the re-read at the next run.
- THE SYSTEM SHALL keep reading the records written before this change (fields
  missing) and the new ones alike.

## Design

**Fields.** Read from the transcript line (sampled 2026-10-02):
`sessionId` (UUID), `isSidechain` (true in `subagents/` transcripts),
`effort` (`low`…`max`; absent on subagent lines), `entrypoint`
(`cli`, `claude-vscode`, …), `gitBranch`, `cwd` (its drive letter's case varies
within one session: normalizing is the Breakdown's job, the raw value is
stored), `version`, and `message.usage.output_tokens_details.thinking_tokens`.
Optional on `UsageRecord`, written only when present, so old records stay
valid and the tests' fixtures need no change.

**Titles.** Claude Code writes an AI-generated one-line title per conversation
(`{"type":"ai-title","aiTitle":"…","sessionId":"…"}`) and may rewrite it; the
last one wins. Titles are kept per session, not per message: a few kilobytes,
and one file to delete to drop them all. They summarize the conversation, so
they can name clients or topics, and unlike transcripts they outlive
`cleanupPeriodDays`. Accepted: the data dir is local, already holds paths and
branch names, and the API is loopback-only. The AGENTS.md invariant becomes
"no message content; conversation titles are kept per session".

**Size.** A record is about 250 bytes today (5,800 records, 1.4 MB for two
months). The new fields add about 170 bytes, roughly +70 %: about 15 MB a year
at the current pace. Rejected: a separate per-session table (`cwd`, branch,
entrypoint, version per session) would save about half of that, but the branch
and `cwd` can change within a session, and one file is simpler to keep
consistent.

**Merge.** `mergeRecord` keeps a duplicate when its output grew (streaming);
it now also takes it when the stored record has no `sessionId` and the new one
has: that is how the re-read fills old records. Counts are never lowered.

**One-time re-read.** The scan state gets a `format` number. When it is below
the current one, the collector backs up `messages-*.jsonl` to
`backup-format-1/` (once), resets every transcript's offset, scans, saves the
records, then writes the new `format`. A crash before that last write only
repeats the re-read. It reads all transcripts once (about 10 projects today, a
few seconds), inside the existing lock.

**Going live.** The installed hook runs the collector from this working copy,
so the re-read happens on the real data dir at the first Claude Code response
after the format bump is saved. The bump is the last edit, made after the tests
pass; the data dir is backed up first by the code itself.

## Checklist

- [ ] Baseline: lint, tests, build
- [ ] `UsageRecord` fields and `parseTranscriptLine` with tests (main line, subagent line, missing fields, no content kept)
- [ ] Session titles in `sessions.json`, with tests (latest title wins, title before or after the messages, no title)
- [ ] `mergeRecord` fills missing fields, with tests (old record gains fields, counts never lowered)
- [ ] Scan-state `format`, backup and one-time re-read in the collector, with tests in a temp data dir (backup made once, records kept when transcripts are gone, crash before the format write repeats the re-read)
- [ ] AGENTS.md (stored fields, titles invariant, backup folder), docs/decisions.md (per-record fields, re-read)
- [ ] Lint, tests, build; run the collector on a copy of the data dir and check the result
- [ ] Format bump saved last; check the real data dir after the next hook run
- [ ] Review pass
