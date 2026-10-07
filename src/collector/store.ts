import { randomUUID } from 'node:crypto';
import { appendFile, copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import type { SessionInfo, Settings, Snapshot, Status, UsageRecord } from '../core/types.ts';

import { DEFAULT_LIMIT_THRESHOLD } from '../core/sessions.ts';
import { DEFAULT_WEEK_LIMIT_THRESHOLD } from '../core/weekHistory.ts';

/** Per transcript file: bytes already imported, mtime, and malformed lines seen. */
export type ScanState = Record<string, { malformed?: number; mtimeMs: number; offset: number }>;

/**
 * Bumped when records gain fields that only a full re-read of the transcripts
 * can fill in for the messages already imported (see `collect`).
 */
export const SCAN_FORMAT = 2;

/** Contents of `scan-state.json`. */
export interface StoredScanState {
  files: ScanState;
  format: number;
}

export const DEFAULT_SETTINGS: Settings = { endpointEnabled: true, limitThreshold: DEFAULT_LIMIT_THRESHOLD, planHistory: [], throttleMinutes: 15, weekLimitThreshold: DEFAULT_WEEK_LIMIT_THRESHOLD };

export function dataDir(): string {
  return process.env.CCA_DATA_DIR ?? join(homedir(), '.claude-code-analytics');
}

export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined;
    throw error;
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const text = await readText(path);
  return text === undefined ? fallback : JSON.parse(text) as T;
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const text = await readText(path);
  if (!text)
    return [];
  const values: T[] = [];
  for (const line of text.split('\n')) {
    // A crash mid-append can leave a torn line; skip it rather than fail every run.
    try {
      if (line)
        values.push(JSON.parse(line) as T);
    }
    catch {}
  }
  return values;
}

/** Writes through a temp file and rename, so readers never see half a file. */
async function writeAtomic(path: string, content: string): Promise<void> {
  // Unique per write: the dashboard server can write the same file twice at once.
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
}

/** Files in the data dir; every read and write of collector data goes through here. */
export class Store {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private path(name: string) {
    return join(this.dir, name);
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  // Messages are split into one file per month (`messages-YYYY-MM.jsonl`) so a
  // run only rewrites the months it changed.

  private async messageFiles(): Promise<string[]> {
    return (await readdir(this.dir).catch(() => [])).filter(name => /^messages-\d{4}-\d{2}\.jsonl$/.test(name));
  }

  async loadRecords(): Promise<Map<string, UsageRecord>> {
    const records = new Map<string, UsageRecord>();
    for (const name of await this.messageFiles()) {
      for (const record of await readJsonLines<UsageRecord>(this.path(name)))
        records.set(record.key, record);
    }
    return records;
  }

  async saveRecords(records: Map<string, UsageRecord>, months: Iterable<string>): Promise<void> {
    for (const month of months) {
      const lines = [...records.values()]
        .filter(r => r.ts.startsWith(month))
        .sort((a, b) => a.ts.localeCompare(b.ts))
        .map(r => `${JSON.stringify(r)}\n`);
      await writeAtomic(this.path(`messages-${month}.jsonl`), lines.join(''));
    }
  }

  /**
   * Copies the message files to the `name` folder, unless it already exists:
   * a retry must not replace the backup with records it already changed.
   */
  async backupRecords(name: string): Promise<void> {
    const target = this.path(name);
    if (await stat(target).then(() => true, () => false))
      return;
    // Copied to a temp folder, then renamed, so a crash never leaves half a backup under the real name.
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(temp);
    for (const file of await this.messageFiles())
      await copyFile(this.path(file), join(temp, file));
    await rename(temp, target);
  }

  async loadSessions(): Promise<Record<string, SessionInfo>> {
    return readJson<Record<string, SessionInfo>>(this.path('sessions.json'), {});
  }

  async saveSessions(sessions: Record<string, SessionInfo>): Promise<void> {
    await writeAtomic(this.path('sessions.json'), `${JSON.stringify(sessions, null, 2)}
`);
  }

  async loadSnapshots(): Promise<Snapshot[]> {
    return readJsonLines<Snapshot>(this.path('snapshots.jsonl'));
  }

  async appendSnapshot(snapshot: Snapshot): Promise<void> {
    await appendFile(this.path('snapshots.jsonl'), `${JSON.stringify(snapshot)}\n`);
  }

  /**
   * Removes the manual reading taken at `ts` (the first match) and reports
   * whether there was one; endpoint readings are never touched. The removed
   * line is kept in `deleted-readings.jsonl`: a manual reading cannot be typed
   * back. The caller holds the data-dir lock, so nothing is appended meanwhile.
   */
  async deleteManualSnapshot(ts: string): Promise<boolean> {
    const lines = ((await readText(this.path('snapshots.jsonl'))) ?? '').split('\n');
    const index = lines.findIndex((line) => {
      try {
        const snapshot = JSON.parse(line) as Snapshot;
        return snapshot.source === 'manual' && snapshot.ts === ts;
      }
      catch {
        return false;
      }
    });
    if (index === -1)
      return false;
    await appendFile(this.path('deleted-readings.jsonl'), `${lines[index]}\n`);
    lines.splice(index, 1);
    await writeAtomic(this.path('snapshots.jsonl'), lines.join('\n'));
    return true;
  }

  async loadSettings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...await readJson<Partial<Settings>>(this.path('settings.json'), {}) };
  }

  async saveSettings(settings: Settings): Promise<void> {
    await writeAtomic(this.path('settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  }

  async loadStatus(): Promise<Status> {
    return readJson<Status>(this.path('status.json'), {});
  }

  async saveStatus(status: Status): Promise<void> {
    await writeAtomic(this.path('status.json'), `${JSON.stringify(status, null, 2)}\n`);
  }

  async loadScanState(): Promise<StoredScanState> {
    // Without a file, nothing was imported yet: there is nothing to re-read.
    const stored = await readJson<StoredScanState | ScanState>(this.path('scan-state.json'), { files: {}, format: SCAN_FORMAT });
    // Format 1 was the bare per-file map. A collector still on format 1 (an
    // unrebuilt Docker image) adds per-file keys at the top level: drop them.
    if (typeof stored.format !== 'number')
      return { files: stored as ScanState, format: 1 };
    return { files: (stored as StoredScanState).files, format: stored.format };
  }

  async saveScanState(state: StoredScanState): Promise<void> {
    await writeAtomic(this.path('scan-state.json'), JSON.stringify(state));
  }
}
