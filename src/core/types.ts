// Keys are in lint-sorted order; each doc comment starts a sorting partition,
// so a documented key must sort first among the keys that follow it.

/** One deduplicated assistant message, as stored by the collector. No content. */
export interface UsageRecord {
  cacheRead: number;
  cacheWrite1h: number;
  cacheWrite5m: number;
  input: number;
  /** `message.id|requestId`; unique per API response. */
  key: string;
  model: string;
  output: number;
  /** Transcript folder name under `~/.claude/projects`. */
  project: string;
  /** Present only when the request ran in fast mode. */
  speed?: 'fast';
  /** ISO timestamp. */
  ts: string;
}

export type Plan = 'pro' | 'max5' | 'max20';

/** One reading of the plan limits, from the endpoint or typed in by hand. */
export interface Snapshot {
  /** Claude Code's share of the weekly usage, 0–100. */
  claudeCodeShare?: number;
  fiveHour?: number;
  fiveHourResetsAt?: string;
  rateLimitTier?: string;
  source: 'endpoint' | 'manual';
  subscriptionType?: string;
  /** ISO timestamp of the reading. */
  ts: string;
  /** Weekly utilization, 0–100. */
  weekly: number;
  /** ISO, rounded to the minute (as is `fiveHourResetsAt`). */
  weeklyResetsAt: string;
}

export interface PlanPeriod {
  /** ISO start; the period runs until the next entry. */
  from: string;
  plan: Plan;
  source: 'detected' | 'manual';
}

export type EndpointError = 'no-token' | 'expired' | 'bad-shape' | 'network' | `http-${number}`;

export interface Settings {
  endpointEnabled: boolean;
  planHistory: PlanPeriod[];
  throttleMinutes: number;
}

/** What the last collector run did. */
export interface Status {
  claudeCodeVersion?: string;
  endpointResult?: 'ok' | EndpointError;
  lastEndpointAttemptAt?: string;
  lastRunAt?: string;
  malformedLines?: number;
  messages?: number;
}
