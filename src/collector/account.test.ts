// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSubscriptionStart } from './account.ts';

function account(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    oauthAccount: { billingType: 'stripe_subscription', emailAddress: 'someone@example.com', subscriptionCreatedAt: '2026-09-28T19:26:39.464762Z', ...extra },
  });
}

describe('readSubscriptionStart', () => {
  let root: string;
  let claudeDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cca-account-'));
    claudeDir = join(root, '.claude');
    await mkdir(claudeDir);
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('reads the date from the file beside the config folder', async () => {
    await writeFile(join(root, '.claude.json'), account());
    expect(await readSubscriptionStart(claudeDir)).toBe('2026-09-28T19:26:39.464Z');
  });

  it('falls back to the folder\'s own copy', async () => {
    await writeFile(join(claudeDir, '.claude.json'), account());
    expect(await readSubscriptionStart(claudeDir)).toBe('2026-09-28T19:26:39.464Z');
  });

  it('prefers the live file over the folder\'s copy', async () => {
    await writeFile(join(root, '.claude.json'), account({ subscriptionCreatedAt: '2026-10-01T00:00:00Z' }));
    await writeFile(join(claudeDir, '.claude.json'), account());
    expect(await readSubscriptionStart(claudeDir)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('ignores another kind of billing, a bad date, bad JSON and a missing file', async () => {
    expect(await readSubscriptionStart(claudeDir)).toBeUndefined();
    await writeFile(join(root, '.claude.json'), '{broken');
    expect(await readSubscriptionStart(claudeDir)).toBeUndefined();
    await writeFile(join(root, '.claude.json'), account({ billingType: 'apple_subscription' }));
    expect(await readSubscriptionStart(claudeDir)).toBeUndefined();
    await writeFile(join(root, '.claude.json'), account({ subscriptionCreatedAt: 'soon' }));
    expect(await readSubscriptionStart(claudeDir)).toBeUndefined();
  });
});
