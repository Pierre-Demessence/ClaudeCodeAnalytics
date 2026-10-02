import type { SessionInfo, UsageRecord } from './types.ts';

import { messageCost } from './pricing.ts';

/** Conversations listed per period. */
const TOP_CONVERSATIONS = 10;
/** Known effort levels, lowest first; others sort after them. */
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface CostSplit {
  /** Cost per model id. */
  byModel: Record<string, number>;
  cost: number;
}

export interface ProjectCost extends CostSplit {
  name: string;
  /** Share of input tokens read from the prompt cache, 0–1. */
  cacheShare: number;
  path: string;
}

export interface ConversationCost extends CostSplit {
  name: string;
  /** The branch most of its messages ran on. */
  branch?: string;
  /** ISO time of its last message in the period. */
  end: string;
  messages: number;
  path: string;
  sessionId: string;
  /** ISO time of its first message in the period. */
  start: string;
  subagentCost: number;
  title?: string;
}

/** Where one period's usage went. Costs are API-equivalent USD. */
export interface Breakdown {
  agents: { main: number; subagents: number };
  /** The 10 most expensive conversations. */
  conversations: ConversationCost[];
  /** Main agent only: subagent messages carry no effort. */
  effort: { cost: number; level: string }[];
  projects: ProjectCost[];
  surfaces: { cost: number; entrypoint?: string }[];
  /** Thinking share of output tokens, 0–1. */
  thinkingShare: number;
  total: { cost: number; messages: number };
}

/** A working directory as a project: drive letter lower-cased, named by its last segment. */
export function projectOf(cwd: string | undefined, folder: string): { name: string; path: string } {
  if (!cwd)
    return { name: folder, path: folder };
  const path = cwd.replace(/^[a-z]:/i, drive => drive.toLowerCase()).replace(/(?<=.)[\\/]+$/, '');
  return { name: path.split(/[\\/]/).at(-1) || path, path };
}

function addTo(split: CostSplit, model: string, cost: number): void {
  split.cost += cost;
  split.byModel[model] = (split.byModel[model] ?? 0) + cost;
}

const byCost = <T extends { cost: number }>(a: T, b: T) => b.cost - a.cost;

/**
 * Usage of the records at or after `from`, by project, conversation, agent,
 * effort and surface. A conversation counts under the directory it started
 * in, even when it started before `from`: Claude Code moves into subfolders
 * mid-conversation, and each message's own directory would scatter a project.
 */
export function buildBreakdown(records: readonly UsageRecord[], titles: Readonly<Record<string, SessionInfo>>, from = -Infinity): Breakdown {
  const startCwd = new Map<string, { cwd: string; ms: number }>();
  for (const record of records) {
    if (!record.sessionId || !record.cwd)
      continue;
    const ms = Date.parse(record.ts);
    const known = startCwd.get(record.sessionId);
    if (!known || ms < known.ms)
      startCwd.set(record.sessionId, { cwd: record.cwd, ms });
  }

  const total = { cost: 0, messages: 0 };
  const agents = { main: 0, subagents: 0 };
  const projects = new Map<string, ProjectCost & { cacheRead: number; inputAll: number }>();
  const effort = new Map<string, number>();
  const surfaces = new Map<string | undefined, number>();
  const conversations = new Map<string, ConversationCost & { branches: Map<string, number> }>();
  let output = 0;
  let thinking = 0;

  for (const record of records) {
    const ms = Date.parse(record.ts);
    if (ms < from)
      continue;
    const { cost } = messageCost(record);
    const project = projectOf((record.sessionId && startCwd.get(record.sessionId)?.cwd) || record.cwd, record.project);

    total.cost += cost;
    total.messages++;
    output += record.output;
    thinking += record.thinking ?? 0;
    if (record.sidechain)
      agents.subagents += cost;
    else
      agents.main += cost;
    if (record.effort && !record.sidechain)
      effort.set(record.effort, (effort.get(record.effort) ?? 0) + cost);
    surfaces.set(record.entrypoint, (surfaces.get(record.entrypoint) ?? 0) + cost);

    let projectRow = projects.get(project.path);
    if (!projectRow) {
      projectRow = { ...project, byModel: {}, cacheRead: 0, cacheShare: 0, cost: 0, inputAll: 0 };
      projects.set(project.path, projectRow);
    }
    addTo(projectRow, record.model, cost);
    projectRow.cacheRead += record.cacheRead;
    projectRow.inputAll += record.input + record.cacheRead + record.cacheWrite5m + record.cacheWrite1h;

    if (record.sessionId) {
      let conversation = conversations.get(record.sessionId);
      if (!conversation) {
        conversation = { ...project, branches: new Map(), byModel: {}, cost: 0, end: record.ts, messages: 0, sessionId: record.sessionId, start: record.ts, subagentCost: 0, title: titles[record.sessionId]?.title };
        conversations.set(record.sessionId, conversation);
      }
      addTo(conversation, record.model, cost);
      conversation.messages++;
      if (record.sidechain)
        conversation.subagentCost += cost;
      if (ms < Date.parse(conversation.start))
        conversation.start = record.ts;
      if (ms > Date.parse(conversation.end))
        conversation.end = record.ts;
      if (record.gitBranch)
        conversation.branches.set(record.gitBranch, (conversation.branches.get(record.gitBranch) ?? 0) + 1);
    }
  }

  const rank = (level: string) => {
    const index = EFFORT_ORDER.indexOf(level);
    return index === -1 ? EFFORT_ORDER.length : index;
  };

  return {
    agents,
    effort: [...effort].map(([level, cost]) => ({ cost, level })).sort((a, b) => rank(a.level) - rank(b.level) || a.level.localeCompare(b.level)),
    surfaces: [...surfaces].map(([entrypoint, cost]) => ({ cost, entrypoint })).sort(byCost),
    thinkingShare: output > 0 ? thinking / output : 0,
    total,
    conversations: [...conversations.values()].sort(byCost).slice(0, TOP_CONVERSATIONS).map(({ branches, ...conversation }) => {
      let branch: string | undefined;
      for (const [name, count] of branches) {
        if (!branch || count > branches.get(branch)!)
          branch = name;
      }
      return { ...conversation, branch };
    }),
    projects: [...projects.values()]
      .map(({ cacheRead, inputAll, ...project }) => ({ ...project, cacheShare: inputAll > 0 ? cacheRead / inputAll : 0 }))
      .sort((a, b) => byCost(a, b) || a.path.localeCompare(b.path)),
  };
}
