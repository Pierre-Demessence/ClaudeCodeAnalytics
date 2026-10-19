import type { Range } from '@/core/range';
import type { RangedSummary } from '@/core/ranged';
import type { DashboardSummary } from '@/core/summary';
import type { PlanPeriod, Status } from '@/core/types';

export type Summary = DashboardSummary & { status: Status };

export interface ManualReading {
  /** Claude Code's share of the weekly %, 0–100. */
  claudeCodeShare?: number;
  fiveHour?: number;
  weekly: number;
  weeklyResetsAt: string;
}

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function request<T = Summary>(path: string, body?: unknown, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ tz: timeZone, ...params });
  const response = await fetch(`/api${path}?${query}`, body === undefined
    ? { signal }
    : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, method: 'POST', signal });
  const json = await response.json() as T | { error?: string };
  if (!response.ok)
    throw new Error((json && typeof json === 'object' && 'error' in json && json.error) || response.statusText);
  return json as T;
}

export const loadSummary = () => request('/summary');

/** The summary of the data already stored, without importing transcripts first: fast, possibly a little behind. */
export const loadStoredSummary = () => request('/summary', undefined, { collect: '0' });

/** The history views over `range`, from the data already stored; `signal` abandons the request. */
export const loadRange = (range: Range, signal?: AbortSignal) => request<RangedSummary>('/range', undefined, { from: String(range.from), to: String(range.to) }, signal);

/** Imports transcripts and calls the endpoint now, ignoring the throttle. */
export const refreshNow = () => request('/collect', {});

export interface SettingsUpdate {
  endpointEnabled?: boolean;
  limitThreshold?: number;
  planHistory?: readonly PlanPeriod[];
  /** Whole minutes from 15 to 1440. */
  throttleMinutes?: number;
  weekLimitThreshold?: number;
}

export const saveSettings = (settings: SettingsUpdate) => request('/settings', settings);

export const addReading = (reading: ManualReading) => request('/readings', reading);

/** Removes the manual reading taken at `ts`; the server refuses endpoint readings. */
export const deleteReading = (ts: string) => request('/readings/delete', { ts });
