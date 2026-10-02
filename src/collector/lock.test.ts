// @vitest-environment node
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireLock, waitForLock } from './lock.ts';

describe('acquireLock', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cca-lock-'));
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('is exclusive until released', async () => {
    const release = await acquireLock(dir);
    expect(release).not.toBeNull();
    expect(await acquireLock(dir)).toBeNull();
    await release!();
    expect(await acquireLock(dir)).not.toBeNull();
  });

  it('takes over a stale lock', async () => {
    await writeFile(join(dir, 'lock'), 'crashed-run');
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(join(dir, 'lock'), old, old);
    expect(await acquireLock(dir)).not.toBeNull();
  });

  it('waits for the holder to release, or gives up after the timeout', async () => {
    const release = await acquireLock(dir);
    expect(await waitForLock(dir, 150)).toBeNull();
    setTimeout(() => void release!(), 100);
    expect(await waitForLock(dir, 2_000)).not.toBeNull();
  });

  it('never releases a lock another run took over', async () => {
    const releaseFirst = await acquireLock(dir);
    // Simulate a takeover after the first run went stale.
    await writeFile(join(dir, 'lock'), 'second-run');
    await releaseFirst!();
    expect(await readFile(join(dir, 'lock'), 'utf8')).toBe('second-run');
    expect(await stat(join(dir, 'lock'))).toBeTruthy();
  });
});
