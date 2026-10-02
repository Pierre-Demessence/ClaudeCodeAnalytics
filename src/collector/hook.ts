import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url)).replaceAll('\\', '/');

/** Runs the collector after every Claude Code response, in the background. */
export const STOP_HOOK: HookCommand = { async: true, command: `node "${cliPath}" --quiet`, type: 'command' };

/** Adds the Stop hook unless a collector hook is already there. Returns null when unchanged. */
export function withCollectorHook(settings: ClaudeSettings): ClaudeSettings | null {
  const stop = settings.hooks?.Stop ?? [];
  if (stop.some(group => group.hooks?.some(hook => typeof hook.command === 'string' && hook.command.includes('collector/cli.ts'))))
    return null;
  return { ...settings, hooks: { ...settings.hooks, Stop: [...stop, { hooks: [STOP_HOOK] }] } };
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
  return `Added the Stop hook to ${path} (backup: ${backup}).`;
}
