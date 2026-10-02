import { randomUUID } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A run takes seconds; an older lock was left by a crashed run. */
const STALE_MS = 2 * 60_000;

/**
 * Takes the data-dir lock; returns a release function, or null if another run
 * holds it. The lock file holds an owner token, so a run whose stale lock was
 * taken over never deletes the new owner's lock.
 */
export async function acquireLock(dir: string, now = Date.now()): Promise<(() => Promise<void>) | null> {
  const path = join(dir, 'lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, token, { flag: 'wx' });
      return async () => {
        const owner = await readFile(path, 'utf8').catch(() => undefined);
        if (owner === token)
          await rm(path, { force: true });
      };
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw error;
      const info = await stat(path).catch(() => undefined);
      if (info && now - info.mtimeMs < STALE_MS)
        return null;
      await rm(path, { force: true });
    }
  }
  return null;
}

/** Like `acquireLock`, but waits up to `timeoutMs` for the current holder. */
export async function waitForLock(dir: string, timeoutMs: number): Promise<(() => Promise<void>) | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const release = await acquireLock(dir);
    if (release || Date.now() >= deadline)
      return release;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
