import { Buffer } from 'node:buffer';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

import type { ApiEvent, SessionInfo, UsageRecord } from '../core/types.ts';
import type { OpenCall, ScanState } from './store.ts';

import { parseEventLine } from '../core/events.ts';
import { mergeRecord, parseSkillSignal, parseTitleLine, parseToolCalls, parseToolResults, parseTranscriptLine } from '../core/transcript.ts';
import { compareVersions } from '../core/versions.ts';

export interface ScanResult {
  /** Newest Claude Code version seen in the scanned files, if any. */
  claudeCodeVersion?: string;
  /** `YYYY-MM` of every message added or updated. */
  changedMonths: Set<string>;
  /** Whether a rate-limit hit, overload or compaction was added. */
  eventsChanged: boolean;
  filesRead: number;
  /** Whether a session title was added or changed. */
  sessionsChanged: boolean;
}

async function listTranscripts(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  }
  catch {
    return [];
  }
  return entries.filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => join(e.parentPath, e.name));
}

function isJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  }
  catch {
    return false;
  }
}

async function readFrom(file: string, offset: number, size: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(size - offset);
    // The file may have shrunk since `stat`: keep only what was actually read.
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return buffer.subarray(0, bytesRead);
  }
  finally {
    await handle.close();
  }
}

/** Total malformed lines across the transcripts in the scan state (reset by a re-read). */
export function malformedLineCount(state: ScanState): number {
  return Object.values(state).reduce((sum, entry) => sum + (entry.malformed ?? 0), 0);
}

/**
 * The type of the subagent a transcript belongs to, from the `<name>.meta.json`
 * Claude Code writes beside it. Undefined for a main transcript or a missing
 * or unreadable file.
 */
async function subagentType(file: string): Promise<string | undefined> {
  if (basename(dirname(file)) !== 'subagents')
    return undefined;
  try {
    const meta = JSON.parse(await readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as { agentType?: unknown };
    return typeof meta.agentType === 'string' && meta.agentType ? meta.agentType : undefined;
  }
  catch {
    return undefined;
  }
}

/** Calls kept per transcript while their result is awaited; calls never answered (an interrupted turn) would pile up. */
const MAX_OPEN_CALLS = 500;
const VERSION_PATTERN = /"version":"(\d+(?:\.\d+)*)"/;
const NEWLINE = 0x0A;

/**
 * Imports usage from every changed transcript under `<claudeDir>/projects`
 * (subagent files included) into `records`, conversation titles into
 * `sessions` and rate-limit hits, overloads and compactions into `events`.
 * Updates `state` in place.
 *
 * Transcripts are append-only, so only the bytes after the last scanned
 * offset are read. A trailing line without a newline that is not valid JSON
 * is still being written; it is left for the next run.
 */
export async function scanTranscripts(claudeDir: string, records: Map<string, UsageRecord>, state: ScanState, sessions: Record<string, SessionInfo> = {}, events: Map<string, ApiEvent> = new Map()): Promise<ScanResult> {
  const projectsDir = join(claudeDir, 'projects');
  const result: ScanResult = { changedMonths: new Set(), eventsChanged: false, filesRead: 0, sessionsChanged: false };
  // Messages met in this scan: `mergeRecord` adds up their tool calls only among these.
  const seen = new Set<string>();

  for (const file of await listTranscripts(projectsDir)) {
    const info = await stat(file);
    const id = relative(projectsDir, file);
    const previous = state[id];
    if (previous && previous.offset === info.size && previous.mtimeMs === info.mtimeMs)
      continue;

    // A file that shrank or changed without growing was rewritten: start over.
    const resume = previous && previous.offset < info.size ? previous : undefined;
    let offset = resume?.offset ?? 0;
    let malformed = resume?.malformed ?? 0;

    const buffer = await readFrom(file, offset, info.size);
    const lastNewline = buffer.lastIndexOf(NEWLINE);
    const lines = buffer.subarray(0, lastNewline + 1).toString('utf8').split('\n');
    const tail = buffer.subarray(lastNewline + 1).toString('utf8');
    const tailComplete = tail !== '' && isJson(tail);
    if (tailComplete)
      lines.push(tail);
    // Count bytes from the buffer, not the decoded text, which may differ for invalid UTF-8.
    offset += tailComplete ? buffer.length : lastNewline + 1;

    const project = id.split(sep)[0]!;
    let skill = resume?.skill;
    const calls: Record<string, OpenCall> = { ...resume?.calls };
    // Messages whose stored result sizes this read from the start has replaced.
    const fresh = new Set<string>();
    const agentType = await subagentType(file);
    for (const line of lines) {
      if (!line)
        continue;
      const sizes = parseToolResults(line);
      if (sizes.length > 0) {
        for (const size of sizes) {
          const call = calls[size.id];
          if (!call)
            continue;
          delete calls[size.id];
          const answered = records.get(call.key);
          if (!answered)
            continue;
          // A transcript read from its start sizes its results again: drop what an earlier read stored.
          if (!resume && !fresh.has(call.key)) {
            answered.context = {};
            fresh.add(call.key);
          }
          const tool = ((answered.context ??= {})[call.name] ??= { chars: 0, images: 0, results: 0 });
          tool.chars += size.chars;
          tool.images += size.images;
          tool.results++;
          result.changedMonths.add(answered.ts.slice(0, 7));
        }
        continue;
      }
      const record = parseTranscriptLine(line, project, skill, agentType);
      // A skill applies to the messages after the line that starts it.
      const signal = parseSkillSignal(line);
      if (signal)
        skill = signal.kind === 'start' ? signal.name : undefined;
      if (record) {
        for (const call of parseToolCalls(line))
          calls[call.id] = { name: call.name, key: record.key };
        // Lines after the stored offset continue messages already stored: add their tools.
        if (resume)
          seen.add(record.key);
        if (mergeRecord(records, record, seen))
          result.changedMonths.add(record.ts.slice(0, 7));
        const version = VERSION_PATTERN.exec(line)?.[1];
        if (version && (!result.claudeCodeVersion || compareVersions(version, result.claudeCodeVersion) > 0))
          result.claudeCodeVersion = version;
      }
      else {
        const event = parseEventLine(line);
        const title = event ? null : parseTitleLine(line);
        if (event) {
          if (!events.has(event.key)) {
            events.set(event.key, event);
            result.eventsChanged = true;
          }
        }
        else if (title) {
          if (sessions[title.sessionId]?.title !== title.title) {
            sessions[title.sessionId] = { title: title.title };
            result.sessionsChanged = true;
          }
        }
        else if (!isJson(line)) {
          malformed++;
        }
      }
    }
    const open = Object.keys(calls);
    for (const callId of open.slice(0, Math.max(0, open.length - MAX_OPEN_CALLS)))
      delete calls[callId];
    state[id] = { malformed, mtimeMs: info.mtimeMs, offset, ...(Object.keys(calls).length > 0 && { calls }), ...(skill && { skill }) };
    result.filesRead++;
  }
  return result;
}
