import type { DashboardSummary } from '@/core/summary';
import type { PlanPeriod, Status } from '@/core/types';

export type Summary = DashboardSummary & { status: Status };

export interface ManualReading {
  fiveHour?: number;
  weekly: number;
  weeklyResetsAt: string;
}

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function request(path: string, body?: unknown): Promise<Summary> {
  const response = await fetch(`/api${path}?tz=${encodeURIComponent(timeZone)}`, body === undefined
    ? undefined
    : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
  const json = await response.json() as Summary | { error?: string };
  if (!response.ok)
    throw new Error(('error' in json && json.error) || response.statusText);
  return json as Summary;
}

export const loadSummary = () => request('/summary');

/** Imports transcripts and calls the endpoint now, ignoring the throttle. */
export const refreshNow = () => request('/collect', {});

export const saveSettings = (settings: { endpointEnabled?: boolean; planHistory?: readonly PlanPeriod[] }) => request('/settings', settings);

export const addReading = (reading: ManualReading) => request('/readings', reading);
