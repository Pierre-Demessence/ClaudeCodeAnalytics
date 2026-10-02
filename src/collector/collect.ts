import type { Status } from '../core/types.ts';

import { planFromSubscription, withDetectedPlan } from '../core/plans.ts';
import { fetchUsage, readCredentials } from './endpoint.ts';
import { acquireLock } from './lock.ts';
import { compareVersions, malformedLineCount, scanTranscripts } from './scan.ts';
import { Store } from './store.ts';

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
    const [records, scanState, settings] = await Promise.all([
      store.loadRecords(),
      store.loadScanState(),
      store.loadSettings(),
    ]);

    const scan = await scanTranscripts(options.claudeDir, records, scanState);
    if (scan.filesRead > 0) {
      await store.saveRecords(records, scan.changedMonths);
      await store.saveScanState(scanState);
    }
    status.lastRunAt = new Date(now).toISOString();
    status.messages = records.size;
    status.malformedLines = malformedLineCount(scanState);
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
