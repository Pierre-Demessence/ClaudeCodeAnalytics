import process from 'node:process';

import { collect } from './collect.ts';
import { installHook, STOP_HOOK } from './hook.ts';
import { claudeDir, dataDir } from './store.ts';

const args = new Set(process.argv.slice(2));

if (args.has('install-hook')) {
  if (args.has('--apply')) {
    console.log(await installHook(claudeDir()));
  }
  else {
    console.log('Add this to ~/.claude/settings.json (or run `npm run hook:install -- --apply`):\n');
    console.log(JSON.stringify({ hooks: { Stop: [{ hooks: [STOP_HOOK] }] } }, null, 2));
  }
}
else {
  // Runs from a Claude Code hook: never fail or print noise into the session.
  const quiet = args.has('--quiet');
  try {
    const result = await collect({ claudeDir: claudeDir(), dataDir: dataDir(), force: args.has('--force') });
    if (!quiet) {
      if (result.skipped)
        console.log('Another collector run is in progress; skipped.');
      else
        console.log(JSON.stringify(result.status, null, 2));
    }
  }
  catch (error) {
    if (!quiet)
      console.error('Collector failed:', error instanceof Error ? error.message : error);
  }
}
