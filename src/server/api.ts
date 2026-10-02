import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

import { Buffer } from 'node:buffer';

import type { Plan, PlanPeriod, Settings, Snapshot } from '../core/types.ts';

import { collect } from '../collector/collect.ts';
import { claudeDir, dataDir, Store } from '../collector/store.ts';
import { PLANS } from '../core/plans.ts';
import { buildSummary } from '../core/summary.ts';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESET_AHEAD_MS = 7 * 86_400_000 + 60_000;

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Rejects cross-site writes: a web page can make the browser POST to
 * localhost, but cannot send `application/json` cross-origin without a
 * preflight, and its Origin would not match the Host.
 */
function assertSameOriginJson(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new HttpError(415, 'Expected application/json');
  const origin = req.headers.origin;
  if (origin && URL.parse(origin)?.host !== req.headers.host)
    throw new HttpError(403, 'Cross-origin request');
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  assertSameOriginJson(req);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const isIso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isPercent = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 100;

function validTimeZone(value: string | null): string {
  if (value) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
      return value;
    }
    catch {}
  }
  return 'UTC';
}

/** Validates a settings update; only known fields with valid values are kept. */
export function parseSettingsUpdate(body: unknown, current: Settings): Settings {
  const update = body as { endpointEnabled?: unknown; planHistory?: unknown } | null;
  const next = { ...current };
  if (update?.endpointEnabled !== undefined) {
    if (typeof update.endpointEnabled !== 'boolean')
      throw new HttpError(400, 'endpointEnabled must be a boolean');
    next.endpointEnabled = update.endpointEnabled;
  }
  if (update?.planHistory !== undefined) {
    if (!Array.isArray(update.planHistory))
      throw new HttpError(400, 'planHistory must be an array');
    next.planHistory = update.planHistory.map((entry: unknown): PlanPeriod => {
      const period = entry as Partial<PlanPeriod> | null;
      if (!period || !PLANS.includes(period.plan as Plan) || !isIso(period.from) || (period.source !== 'manual' && period.source !== 'detected'))
        throw new HttpError(400, 'Invalid plan period');
      return { from: new Date(period.from).toISOString(), plan: period.plan as Plan, source: period.source };
    }).sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  }
  return next;
}

/** Validates a manual `/usage` reading. */
export function parseManualReading(body: unknown, now: number): Snapshot {
  const reading = body as { fiveHour?: unknown; weekly?: unknown; weeklyResetsAt?: unknown } | null;
  if (!isPercent(reading?.weekly))
    throw new HttpError(400, 'weekly must be a percentage');
  // The weekly window is 7 days: a later reset is a typo that would skew every chart.
  if (!isIso(reading.weeklyResetsAt) || Date.parse(reading.weeklyResetsAt) <= now || Date.parse(reading.weeklyResetsAt) > now + MAX_RESET_AHEAD_MS)
    throw new HttpError(400, 'weeklyResetsAt must be within the next 7 days');
  const snapshot: Snapshot = {
    source: 'manual',
    ts: new Date(now).toISOString(),
    weekly: reading.weekly,
    weeklyResetsAt: new Date(Math.round(Date.parse(reading.weeklyResetsAt) / 60_000) * 60_000).toISOString(),
  };
  if (reading.fiveHour !== undefined) {
    if (!isPercent(reading.fiveHour))
      throw new HttpError(400, 'fiveHour must be a percentage');
    snapshot.fiveHour = reading.fiveHour;
  }
  return snapshot;
}

async function summary(store: Store, timeZone: string) {
  const [records, snapshots, settings, status] = await Promise.all([
    store.loadRecords(),
    store.loadSnapshots(),
    store.loadSettings(),
    store.loadStatus(),
  ]);
  return {
    ...buildSummary({
      endpointEnabled: settings.endpointEnabled,
      now: Date.now(),
      planHistory: settings.planHistory,
      records: [...records.values()],
      snapshots,
      timeZone,
    }),
    status,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const store = new Store(dataDir());
  const timeZone = validTimeZone(url.searchParams.get('tz'));

  if (req.method === 'GET' && url.pathname === '/summary') {
    // Opening the dashboard imports new transcripts; the endpoint keeps its throttle.
    await collect({ claudeDir: claudeDir(), dataDir: store.dir });
    return send(res, 200, await summary(store, timeZone));
  }
  if (req.method === 'POST' && url.pathname === '/collect') {
    await readBody(req);
    const result = await collect({ claudeDir: claudeDir(), dataDir: store.dir, force: true });
    if (result.skipped)
      throw new HttpError(409, 'A collector run is already in progress');
    return send(res, 200, await summary(store, timeZone));
  }
  if (req.method === 'POST' && url.pathname === '/settings') {
    await store.ensureDir();
    await store.saveSettings(parseSettingsUpdate(await readBody(req), await store.loadSettings()));
    return send(res, 200, await summary(store, timeZone));
  }
  if (req.method === 'POST' && url.pathname === '/readings') {
    const snapshot = parseManualReading(await readBody(req), Date.now());
    await store.ensureDir();
    await store.appendSnapshot(snapshot);
    return send(res, 200, await summary(store, timeZone));
  }
  throw new HttpError(404, 'Not found');
}

function middleware(req: IncomingMessage, res: ServerResponse) {
  handle(req, res).catch((error: unknown) => {
    if (error instanceof HttpError) {
      send(res, error.status, { error: error.message });
    }
    else {
      // Collector errors are file-system errors: they never contain the token.
      console.error('[usage-api]', error instanceof Error ? error.message : error);
      send(res, 500, { error: 'Internal error (see the server console)' });
    }
  });
}

/** Serves `/api/*` from the collector's data dir, in `vite dev` and `vite preview`. */
export function apiPlugin(): Plugin {
  return {
    name: 'usage-api',
    configurePreviewServer(server) {
      server.middlewares.use('/api', middleware);
    },
    configureServer(server) {
      server.middlewares.use('/api', middleware);
    },
  };
}
