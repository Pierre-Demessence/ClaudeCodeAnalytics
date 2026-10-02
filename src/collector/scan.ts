import { Buffer } from 'node:buffer';
import { open, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { SessionInfo, UsageRecord } from '../core/types.ts';
import type { ScanState } from './store.ts';

import { mergeRecord, parseTitleLine, parseTranscriptLine } from '../core/transcript.ts';

export interface ScanResult {
  /** Newest Claude Code version seen in the scanned files, if any. */
  claudeCodeVersion?: string;
  /** `YYYY-MM` of every message added or updated. */
  changedMonths: Set<string>;
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

/** Compares dotted version strings numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0)
      return diff;
  }
  return 0;
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

const VERSION_PATTERN = /"version":"(\d+(?:\.\d+)*)"/;
const NEWLINE = 0x0A;

/**
 * Imports usage from every changed transcript under `<claudeDir>/projects`
 * (subagent files included) into `records`, and conversation titles into
 * `sessions`. Updates `state` in place.
 *
 * Transcripts are append-only, so only the bytes after the last scanned
 * offset are read. A trailing line without a newline that is not valid JSON
 * is still being written; it is left for the next run.
 */
export async function scanTranscripts(claudeDir: string, records: Map<string, UsageRecord>, state: ScanState, sessions: Record<string, SessionInfo> = {}): Promise<ScanResult> {
  const projectsDir = join(claudeDir, 'projects');
  const result: ScanResult = { changedMonths: new Set(), filesRead: 0, sessionsChanged: false };

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
    for (const line of lines) {
      if (!line)
        continue;
      const record = parseTranscriptLine(line, project);
      if (record) {
        if (mergeRecord(records, record))
          result.changedMonths.add(record.ts.slice(0, 7));
        const version = VERSION_PATTERN.exec(line)?.[1];
        if (version && (!result.claudeCodeVersion || compareVersions(version, result.claudeCodeVersion) > 0))
          result.claudeCodeVersion = version;
      }
      else {
        const title = parseTitleLine(line);
        if (title) {
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
    state[id] = { malformed, mtimeMs: info.mtimeMs, offset };
    result.filesRead++;
  }
  return result;
}
