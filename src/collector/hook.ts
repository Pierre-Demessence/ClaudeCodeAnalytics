import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface HookCommand {
  async?: boolean;
  command: string;
  type: 'command';
}

interface HookGroup {
  hooks: HookCommand[];
  matcher?: string;
}

interface ClaudeSettings {
  [key: string]: unknown;
  hooks?: Record<string, HookGroup[]>;
}

/**
 * Asks the Docker dashboard for a collector run after every Claude Code response, in the
 * background. The host runs no code from this folder: checking out a branch here cannot
 * run it as the user. With the container down, the run is skipped; the next one catches up.
 */
export const STOP_HOOK: HookCommand = {
  async: true,
  command: 'curl -sf -m 120 -X POST -H "Content-Type: application/json" -d "{}" http://analytics.claudecode.localhost/api/hook',
  type: 'command',
};

/** The hook this tool used to install, which ran the working copy's collector on the host. */
const isLocalCollector = (hook: HookCommand) => typeof hook.command === 'string' && hook.command.includes('collector/cli.ts');

/** Adds the Stop hook, replacing one that runs the local collector. Returns null when unchanged. */
export function withCollectorHook(settings: ClaudeSettings): ClaudeSettings | null {
  const stop = settings.hooks?.Stop ?? [];
  const installed = stop.some(group => group.hooks?.some(hook => hook.command === STOP_HOOK.command));
  let replaced = false;
  const kept = stop.flatMap((group) => {
    if (!group.hooks?.some(isLocalCollector))
      return [group];
    replaced = true;
    const hooks = group.hooks.filter(hook => !isLocalCollector(hook));
    return hooks.length ? [{ ...group, hooks }] : [];
  });
  if (installed && !replaced)
    return null;
  return { ...settings, hooks: { ...settings.hooks, Stop: installed ? kept : [...kept, { hooks: [STOP_HOOK] }] } };
}

/** Adds the hook to `<claudeDir>/settings.json`, after a backup. Returns a message for the user. */
export async function installHook(claudeDir: string): Promise<string> {
  const path = join(claudeDir, 'settings.json');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  }
  catch {
    return `Could not read ${path}; add the hook by hand (run without --apply to print it).`;
  }
  const updated = withCollectorHook(JSON.parse(text) as ClaudeSettings);
  if (!updated)
    return `The collector hook is already in ${path}.`;
  const backup = `${path}.bak-${Date.now()}`;
  await copyFile(path, backup);
  await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`);
  return `Installed the Stop hook in ${path} (backup: ${backup}). It needs the Docker dashboard running (\`npm run docker:up\`).`;
}
