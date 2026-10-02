import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EndpointError, Snapshot } from '../core/types.ts';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/** Skip tokens this close to expiry; Claude Code refreshes them, never us. */
const EXPIRY_MARGIN_MS = 60_000;
const TIMEOUT_MS = 15_000;

export interface Credentials {
  expiresAt?: number;
  rateLimitTier?: string;
  subscriptionType?: string;
  /** Kept in memory only: never logged, stored or sent anywhere but Anthropic. */
  token: string;
}

interface RawCredentials {
  claudeAiOauth?: {
    accessToken?: unknown;
    expiresAt?: unknown;
    rateLimitTier?: unknown;
    subscriptionType?: unknown;
  };
}

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** Reads Claude Code's OAuth credentials, or says why they are unusable. */
export async function readCredentials(claudeDir: string, now: number): Promise<Credentials | EndpointError> {
  let raw: RawCredentials;
  try {
    raw = JSON.parse(await readFile(join(claudeDir, '.credentials.json'), 'utf8')) as RawCredentials;
  }
  catch {
    return 'no-token';
  }
  const oauth = raw.claudeAiOauth;
  const token = asString(oauth?.accessToken);
  if (!token)
    return 'no-token';
  const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : undefined;
  if (expiresAt !== undefined && expiresAt - EXPIRY_MARGIN_MS < now)
    return 'expired';
  return {
    expiresAt,
    rateLimitTier: asString(oauth?.rateLimitTier),
    subscriptionType: asString(oauth?.subscriptionType),
    token,
  };
}

/** Normalises the microsecond jitter in reset times. */
export function roundToMinute(iso: string): string | undefined {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms))
    return undefined;
  return new Date(Math.round(ms / 60_000) * 60_000).toISOString();
}

interface Window {
  resets_at?: unknown;
  utilization?: unknown;
}

interface RawUsage {
  five_hour?: Window | null;
  seven_day?: Window | null;
  seven_day_breakdown?: { rows?: { key?: unknown; percent?: unknown }[] } | null;
}

/** Turns an endpoint response into a snapshot; undefined if the shape changed. */
export function parseUsageResponse(body: unknown, ts: string): Snapshot | undefined {
  const usage = body as RawUsage | null;
  const weekly = usage?.seven_day?.utilization;
  const weeklyResetsAt = roundToMinute(asString(usage?.seven_day?.resets_at) ?? '');
  if (typeof weekly !== 'number' || !weeklyResetsAt)
    return undefined;

  const snapshot: Snapshot = { source: 'endpoint', ts, weekly, weeklyResetsAt };
  const fiveHour = usage?.five_hour?.utilization;
  if (typeof fiveHour === 'number') {
    snapshot.fiveHour = fiveHour;
    snapshot.fiveHourResetsAt = roundToMinute(asString(usage?.five_hour?.resets_at) ?? '');
  }
  const share = usage?.seven_day_breakdown?.rows?.find(row => row.key === 'claude_code')?.percent;
  if (typeof share === 'number')
    snapshot.claudeCodeShare = share;
  return snapshot;
}

/**
 * Calls the undocumented usage endpoint. The `claude-code/<version>`
 * User-Agent is required: other agents land in a far stricter rate limit.
 */
export async function fetchUsage(
  credentials: Credentials,
  claudeCodeVersion: string,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Snapshot | EndpointError> {
  let response: Response;
  try {
    response = await fetchImpl(USAGE_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'anthropic-beta': 'oauth-2025-04-20',
        'Authorization': `Bearer ${credentials.token}`,
        'User-Agent': `claude-code/${claudeCodeVersion}`,
      },
    });
  }
  catch {
    return 'network';
  }
  if (!response.ok)
    return `http-${response.status}`;
  let body: unknown;
  try {
    body = await response.json();
  }
  catch {
    return 'bad-shape';
  }
  const snapshot = parseUsageResponse(body, new Date(now).toISOString());
  if (!snapshot)
    return 'bad-shape';
  if (credentials.subscriptionType)
    snapshot.subscriptionType = credentials.subscriptionType;
  if (credentials.rateLimitTier)
    snapshot.rateLimitTier = credentials.rateLimitTier;
  return snapshot;
}
