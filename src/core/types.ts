// Keys are in lint-sorted order; each doc comment starts a sorting partition,
// so a documented key must sort first among the keys that follow it.

/**
 * Something in a transcript besides a usage record: a rate-limit hit, a server
 * overload or a conversation compaction. Never holds message text.
 */
export interface ApiEvent {
  /** Transcript entry `uuid`; unique per event. */
  key: string;
  kind: 'compaction' | 'limit' | 'overload';
  /** `quotaLimits.rateLimitType` of a limit hit (`five_hour`, …); absent when the entry has none. */
  limitType?: string;
  /** ISO end of the limited window, on a limit hit that reports it. */
  resetsAt?: string;
  sessionId?: string;
  /** ISO timestamp. */
  ts: string;
}

/** One deduplicated assistant message, as stored by the collector. No content. */
export interface UsageRecord {
  /** The subagent's type (`Explore`, `general-purpose`, …); present only on a subagent's message, and not when its metadata file was missing. */
  agentType?: string;
  cacheRead: number;
  cacheWrite1h: number;
  cacheWrite5m: number;
  /** Raw working directory; its drive letter's case can vary within a session. */
  cwd?: string;
  /** `low`…`max`; absent on subagent messages. */
  effort?: string;
  /** Claude Code client: `cli`, `claude-vscode`, … */
  entrypoint?: string;
  gitBranch?: string;
  input: number;
  /** `message.id|requestId`; unique per API response. */
  key: string;
  model: string;
  output: number;
  /** Transcript folder name under `~/.claude/projects`. */
  project: string;
  sessionId?: string;
  /** Present only on a subagent's message. */
  sidechain?: true;
  /** The skill or slash command (`/commit`) this main-conversation message ran under. */
  skill?: string;
  /** Present only when the request ran in fast mode. */
  speed?: 'fast';
  /** Output tokens spent thinking, part of `output`. */
  thinking?: number;
  /** Characters of the tool-call input by tool name (the input itself is never kept). Absent on a message imported before they were sized. */
  toolInput?: Record<string, number>;
  /** Tool calls by tool name; `{}` for a reply without any. Absent on a message imported before they were kept. */
  tools?: Record<string, number>;
  /** ISO timestamp. */
  ts: string;
  /** Claude Code version that wrote the message. */
  version?: string;
}

/** What is kept per conversation, in `sessions.json`, keyed by session id. */
export interface SessionInfo {
  /** Claude Code's AI-generated title; the latest one wins. */
  title: string;
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
  /** 5-hour % from which a past window counts as having hit the limit. */
  limitThreshold: number;
  planHistory: PlanPeriod[];
  throttleMinutes: number;
  /** Weekly % from which a past week counts as having hit the limit. */
  weekLimitThreshold: number;
}

/** What the last collector run did. */
export interface Status {
  claudeCodeVersion?: string;
  endpointResult?: 'ok' | EndpointError;
  lastEndpointAttemptAt?: string;
  /** Message of the last run's unexpected failure, cleared by a successful run. */
  lastError?: string;
  lastRunAt?: string;
  malformedLines?: number;
  messages?: number;
  /** ISO. When the paid subscription started; it is billed on the same day each month. */
  subscriptionStartedAt?: string;
}
