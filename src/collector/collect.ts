import type { Status } from '../core/types.ts';

import { planFromSubscription, withDetectedPlan } from '../core/plans.ts';
import { fetchUsage, readCredentials } from './endpoint.ts';
import { acquireLock } from './lock.ts';
import { compareVersions, malformedLineCount, scanTranscripts } from './scan.ts';
import { SCAN_FORMAT, Store } from './store.ts';

/** Used only until a transcript reveals the installed version. */
const FALLBACK_CLAUDE_CODE_VERSION = '2.1.287';

export interface CollectOptions {
  claudeDir: string;
  dataDir: string;
  fetchImpl?: typeof fetch;
  /** Call the endpoint even if the throttle has not elapsed. */
  force?: boolean;
  now?: number;
}

export type CollectResult = { skipped: 'locked' } | { skipped?: undefined; status: Status };

/**
 * One collector run: import transcripts, then take an endpoint snapshot if the
 * throttle allows. Endpoint failures are recorded in the status, never thrown.
 */
export async function collect(options: CollectOptions): Promise<CollectResult> {
  const now = options.now ?? Date.now();
  const store = new Store(options.dataDir);
  await store.ensureDir();
  const release = await acquireLock(store.dir, now);
  if (!release)
    return { skipped: 'locked' };

  let status: Status = {};
  try {
    status = await store.loadStatus();
    const [records, scanState, sessions, settings] = await Promise.all([
      store.loadRecords(),
      store.loadScanState(),
      store.loadSessions(),
      store.loadSettings(),
    ]);

    // An older format re-reads every transcript still on disk once, so the
    // records imported before it gain the new fields (`mergeRecord` fills them).
    // Records whose transcripts are gone are kept as they are.
    const reread = scanState.format < SCAN_FORMAT;
    if (reread) {
      await store.backupRecords(`backup-format-${scanState.format}`);
      scanState.files = {};
    }
    const scan = await scanTranscripts(options.claudeDir, records, scanState.files, sessions);
    if (scan.filesRead > 0 || reread) {
      await store.saveRecords(records, scan.changedMonths);
      if (scan.sessionsChanged)
        await store.saveSessions(sessions);
      // Written last: a crash before it only repeats the re-read.
      scanState.format = SCAN_FORMAT;
      await store.saveScanState(scanState);
    }
    status.lastRunAt = new Date(now).toISOString();
    status.messages = records.size;
    status.malformedLines = malformedLineCount(scanState.files);
    if (scan.claudeCodeVersion && (!status.claudeCodeVersion || compareVersions(scan.claudeCodeVersion, status.claudeCodeVersion) > 0))
      status.claudeCodeVersion = scan.claudeCodeVersion;

    const lastAttempt = status.lastEndpointAttemptAt ? Date.parse(status.lastEndpointAttemptAt) : 0;
    const due = options.force || now - lastAttempt >= settings.throttleMinutes * 60_000;
    if (settings.endpointEnabled && due) {
      status.lastEndpointAttemptAt = status.lastRunAt;
      const credentials = await readCredentials(options.claudeDir, now);
      const snapshot = typeof credentials === 'string'
        ? credentials
        : await fetchUsage(credentials, status.claudeCodeVersion ?? FALLBACK_CLAUDE_CODE_VERSION, now, options.fetchImpl);
      if (typeof snapshot === 'string') {
        status.endpointResult = snapshot;
      }
      else {
        status.endpointResult = 'ok';
        await store.appendSnapshot(snapshot);
        const plan = planFromSubscription(snapshot.subscriptionType, snapshot.rateLimitTier);
        if (plan) {
          // Re-read: the dashboard may have changed settings during the endpoint call.
          const latest = await store.loadSettings();
          const planHistory = withDetectedPlan(latest.planHistory, plan, snapshot.ts);
          if (planHistory !== latest.planHistory)
            await store.saveSettings({ ...latest, planHistory: [...planHistory] });
        }
      }
    }

    delete status.lastError;
    await store.saveStatus(status);
    return { status };
  }
  catch (error) {
    // Leave a trace for the dashboard; file-system errors never contain the token.
    status.lastRunAt = new Date(now).toISOString();
    status.lastError = error instanceof Error ? error.message : String(error);
    await store.saveStatus(status).catch(() => {});
    throw error;
  }
  finally {
    await release();
  }
}
