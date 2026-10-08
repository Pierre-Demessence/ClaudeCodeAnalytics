import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * When the paid subscription started, from the `oauthAccount` Claude Code caches in
 * `.claude.json`: the day of the month it is billed. Only that date is read: the
 * file also holds the email and account ids, which are never kept.
 *
 * The live file sits beside the config folder (`~/.claude.json`); the folder's own
 * copy is what a container that mounts only the folder can see.
 */
export async function readSubscriptionStart(claudeDir: string): Promise<string | undefined> {
  for (const path of [join(dirname(claudeDir), '.claude.json'), join(claudeDir, '.claude.json')]) {
    try {
      const account = (JSON.parse(await readFile(path, 'utf8')) as { oauthAccount?: Record<string, unknown> }).oauthAccount;
      const created = account?.subscriptionCreatedAt;
      if (account?.billingType !== 'stripe_subscription' || typeof created !== 'string' || Number.isNaN(Date.parse(created)))
        continue;
      return new Date(created).toISOString();
    }
    catch {
      // Missing or unreadable: try the next place.
    }
  }
  return undefined;
}
