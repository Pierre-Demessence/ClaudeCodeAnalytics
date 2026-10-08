import process from 'node:process';

import { formatReport, runBacktest } from '../../core/backtest.ts';
import { dataDir, Store } from '../store.ts';

function numberArg(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? Number.NaN : Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

// Read-only: the lock is for writers, and every file is replaced atomically.
const store = new Store(dataDir());
const [records, snapshots, settings] = await Promise.all([store.loadRecords(), store.loadSnapshots(), store.loadSettings()]);
const stepHours = numberArg('--step-hours');

console.log(formatReport(runBacktest({
  limitThreshold: settings.limitThreshold,
  now: Date.now(),
  planHistory: settings.planHistory,
  records: [...records.values()],
  snapshots,
  stepMs: stepHours && stepHours * 3_600_000,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekLimitThreshold: settings.weekLimitThreshold,
  weeks: numberArg('--weeks'),
})));
