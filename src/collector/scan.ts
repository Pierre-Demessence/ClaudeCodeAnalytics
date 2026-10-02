import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { UsageRecord } from '../core/types.ts';
import type { ScanState } from './store.ts';

import { mergeRecord, parseTranscriptLine } from '../core/transcript.ts';

export interface ScanResult {
  /** Newest Claude Code version seen in the scanned files, if any. */
  claudeCodeVersion?: string;
  /** `YYYY-MM` of every message added or updated. */
  changedMonths: Set<string>;
  filesRead: number;
  /** Lines that are not valid JSON. Other skipped lines are not counted. */
  malformedLines: number;
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

const VERSION_PATTERN = /"version":"(\d+(?:\.\d+)*)"/;

/**
 * Imports usage from every changed transcript under `<claudeDir>/projects`
 * (subagent files included) into `records`. Updates `state` in place.
 */
export async function scanTranscripts(claudeDir: string, records: Map<string, UsageRecord>, state: ScanState): Promise<ScanResult> {
  const projectsDir = join(claudeDir, 'projects');
  const result: ScanResult = { changedMonths: new Set(), filesRead: 0, malformedLines: 0 };

  for (const file of await listTranscripts(projectsDir)) {
    const info = await stat(file);
    const id = relative(projectsDir, file);
    const previous = state[id];
    if (previous && previous.size === info.size && previous.mtimeMs === info.mtimeMs)
      continue;

    const project = id.split(sep)[0]!;
    const text = await readFile(file, 'utf8');
    for (const line of text.split('\n')) {
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
      else if (!isJson(line)) {
        result.malformedLines++;
      }
    }
    state[id] = { mtimeMs: info.mtimeMs, size: info.size };
    result.filesRead++;
  }
  return result;
}
