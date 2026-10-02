import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import type { Settings, Snapshot, Status, UsageRecord } from '../core/types.ts';

/** Per transcript file: bytes already imported, mtime, and malformed lines seen. */
export type ScanState = Record<string, { malformed?: number; mtimeMs: number; offset: number }>;

export const DEFAULT_SETTINGS: Settings = { endpointEnabled: true, planHistory: [], throttleMinutes: 15 };

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

  async loadRecords(): Promise<Map<string, UsageRecord>> {
    const names = (await readdir(this.dir).catch(() => [])).filter(name => /^messages-\d{4}-\d{2}\.jsonl$/.test(name));
    const records = new Map<string, UsageRecord>();
    for (const name of names) {
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

  async loadSnapshots(): Promise<Snapshot[]> {
    return readJsonLines<Snapshot>(this.path('snapshots.jsonl'));
  }

  async appendSnapshot(snapshot: Snapshot): Promise<void> {
    await appendFile(this.path('snapshots.jsonl'), `${JSON.stringify(snapshot)}\n`);
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

  async loadScanState(): Promise<ScanState> {
    return readJson<ScanState>(this.path('scan-state.json'), {});
  }

  async saveScanState(state: ScanState): Promise<void> {
    await writeAtomic(this.path('scan-state.json'), JSON.stringify(state));
  }
}
