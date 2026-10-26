// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Store } from './store.ts';

describe('store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cca-store-'));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('removes its temp file when the write cannot replace the file', async () => {
    // A folder where the file should be makes the rename fail.
    await mkdir(join(dir, 'status.json', 'inside'), { recursive: true });
    await expect(new Store(dir).saveStatus({})).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['status.json']);
  });

  it('removes its temp folder when a backup fails', async () => {
    // A folder where a message file should be cannot be copied.
    await mkdir(join(dir, 'messages-2026-10.jsonl'));
    await expect(new Store(dir).backupRecords('backup-format-1')).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['messages-2026-10.jsonl']);
  });
});
