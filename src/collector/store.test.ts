// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Store } from './store.ts';

const failures = vi.hoisted(() => ({ rename: undefined as Error | undefined, write: undefined as Error | undefined }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (failures.rename)
        throw failures.rename;
      await actual.rename(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await actual.writeFile(...args);
      if (failures.write)
        throw failures.write;
    },
  };
});

describe('store atomic writes', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cca-store-'));
    failures.rename = undefined;
    failures.write = undefined;
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('removes its temp file when rename fails and preserves the rename error', async () => {
    const target = join(dir, 'status.json');
    await writeFile(target, 'existing');
    const error = new Error('rename failed');
    failures.rename = error;

    await expect(new Store(dir).saveStatus({ lastError: 'new' })).rejects.toBe(error);
    expect(await readdir(dir)).toEqual(['status.json']);
    expect(await readFile(target, 'utf8')).toBe('existing');
  });

  it('removes a partial temp file when writing fails and preserves the write error', async () => {
    const error = new Error('write failed');
    failures.write = error;

    await expect(new Store(dir).saveStatus({ lastError: 'new' })).rejects.toBe(error);
    expect(await readdir(dir)).toEqual([]);
  });
});
