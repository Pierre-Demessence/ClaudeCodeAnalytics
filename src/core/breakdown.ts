import type { SessionInfo, UsageRecord } from './types.ts';

import { contextTokens } from './contextAdded.ts';
import { splitOutput, toolLabel } from './outputSplit.ts';
import { messageCost } from './pricing.ts';

/** Conversations listed per period. */
const TOP_CONVERSATIONS = 10;
/** Tools and skills listed one by one; the rest of each is grouped. */
const TOP_TOOLS = 8;
const TOP_SKILLS = 8;
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

/** Output tokens of the period by kind; the parts sum to `total`. */
export interface OutputSplit {
  /** Tools beyond the largest ones. */
  otherTools: { count: number; tokens: number };
  /** Text of messages without a tool call. */
  reply: number;
  thinking: number;
  /** Each tool (an MCP server's tools as one), largest first. */
  tools: { name: string; tokens: number }[];
  total: number;
  /** Messages imported before tool calls were kept. */
  untracked: number;
}

/** What the tools' results added to the context in the period, estimated. */
export interface ContextSplit {
  /** Screenshots across all tools. */
  images: number;
  /** Tools beyond the largest ones. */
  otherTools: { count: number; images: number; tokens: number };
  /** Each tool (an MCP server's tools as one), largest first. */
  tokens: number;
  tools: { name: string; images: number; tokens: number }[];
}

/** What messages under one skill or slash command cost. */
export interface SkillUsage {
  name: string;
  cost: number;
  /** Output tokens only; the cost covers input and cache too. */
  output: number;
}

/** What one subagent type's messages cost; `type` is absent when it was not recorded. */
export interface SubagentTypeCost {
  cost: number;
  messages: number;
  type?: string;
}

/** Where one period's usage went. Costs are API-equivalent USD. */
export interface Breakdown {
  agents: { main: number; subagents: number };
  context: ContextSplit;
  /** The 10 most expensive conversations. */
  conversations: ConversationCost[];
  /** Main agent only: subagent messages carry no effort. */
  effort: { cost: number; level: string }[];
  /** Messages outside any skill or command, subagents included. */
  noSkill: { cost: number; output: number };
  /** Skills and commands beyond the costliest ones. */
  otherSkills: { cost: number; count: number; output: number };
  output: OutputSplit;
  projects: ProjectCost[];
  /** The costliest skills and commands. */
  skills: SkillUsage[];
  /** Subagent cost by type, costliest first. */
  subagentTypes: SubagentTypeCost[];
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

/**
 * Returns each record's project: the directory its conversation started in.
 * Claude Code moves into subfolders mid-conversation, and each message's own
 * directory would scatter a project.
 */
export function sessionProjects(records: readonly UsageRecord[]): (record: UsageRecord) => { name: string; path: string } {
  const startCwd = new Map<string, { cwd: string; ms: number }>();
  for (const record of records) {
    if (!record.sessionId || !record.cwd)
      continue;
    const ms = Date.parse(record.ts);
    const known = startCwd.get(record.sessionId);
    if (!known || ms < known.ms)
      startCwd.set(record.sessionId, { cwd: record.cwd, ms });
  }
  return record => projectOf((record.sessionId && startCwd.get(record.sessionId)?.cwd) || record.cwd, record.project);
}

/**
 * Returns each record's skill or slash command. A subagent's own transcript
 * knows none, so its messages take the one its conversation was under at the
 * time: that of the latest main-agent message before it.
 */
export function sessionSkills(records: readonly UsageRecord[]): (record: UsageRecord) => string | undefined {
  const mainBySession = new Map<string, { ms: number; skill?: string }[]>();
  for (const record of records) {
    if (record.sidechain || !record.sessionId)
      continue;
    const messages = mainBySession.get(record.sessionId) ?? [];
    messages.push({ ms: Date.parse(record.ts), skill: record.skill });
    mainBySession.set(record.sessionId, messages);
  }
  for (const messages of mainBySession.values())
    messages.sort((a, b) => a.ms - b.ms);

  return (record) => {
    if (!record.sidechain)
      return record.skill;
    const messages = record.sessionId && mainBySession.get(record.sessionId);
    if (!messages)
      return undefined;
    const ms = Date.parse(record.ts);
    // Binary search for the last main-agent message at or before `ms`.
    let low = 0;
    let high = messages.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (messages[middle]!.ms <= ms)
        low = middle + 1;
      else
        high = middle;
    }
    return low > 0 ? messages[low - 1]!.skill : undefined;
  };
}

function addTo(split: CostSplit, model: string, cost: number): void {
  split.cost += cost;
  split.byModel[model] = (split.byModel[model] ?? 0) + cost;
}

const byCost = <T extends { cost: number }>(a: T, b: T) => b.cost - a.cost;

/**
 * Usage of the records at or after `from`, by project, conversation, agent,
 * effort and surface. A conversation counts under the directory it started
 * in, even when it started before `from`.
 */
export function buildBreakdown(records: readonly UsageRecord[], titles: Readonly<Record<string, SessionInfo>>, from = -Infinity): Breakdown {
  const projectFor = sessionProjects(records);
  const skillFor = sessionSkills(records);

  const total = { cost: 0, messages: 0 };
  const agents = { main: 0, subagents: 0 };
  const projects = new Map<string, ProjectCost & { cacheRead: number; inputAll: number }>();
  const effort = new Map<string, number>();
  const surfaces = new Map<string | undefined, number>();
  const subagentTypes = new Map<string | undefined, SubagentTypeCost>();
  const conversations = new Map<string, ConversationCost & { branches: Map<string, number> }>();
  let output = 0;
  let thinking = 0;
  const split = { reply: 0, thinking: 0, untracked: 0 };
  const toolTokens = new Map<string, number>();
  const toolContext = new Map<string, { chars: number; images: number }>();
  const noSkill = { cost: 0, output: 0 };
  const skills = new Map<string, SkillUsage>();

  for (const record of records) {
    const ms = Date.parse(record.ts);
    if (ms < from)
      continue;
    const { cost } = messageCost(record);
    const project = projectFor(record);

    total.cost += cost;
    total.messages++;
    output += record.output;
    thinking += record.thinking ?? 0;
    for (const part of splitOutput(record)) {
      if (part.kind === 'tool')
        toolTokens.set(toolLabel(part.name!), (toolTokens.get(toolLabel(part.name!)) ?? 0) + part.tokens);
      else
        split[part.kind] += part.tokens;
    }
    for (const [name, size] of Object.entries(record.context ?? {})) {
      const label = toolLabel(name);
      const sum = toolContext.get(label) ?? { chars: 0, images: 0 };
      sum.chars += size.chars;
      sum.images += size.images;
      toolContext.set(label, sum);
    }
    const skillName = skillFor(record);
    if (skillName) {
      const skill = skills.get(skillName) ?? { name: skillName, cost: 0, output: 0 };
      skill.cost += cost;
      skill.output += record.output;
      skills.set(skillName, skill);
    }
    else {
      noSkill.cost += cost;
      noSkill.output += record.output;
    }
    if (record.sidechain) {
      agents.subagents += cost;
      const subagentType = subagentTypes.get(record.agentType) ?? { cost: 0, messages: 0, type: record.agentType };
      subagentType.cost += cost;
      subagentType.messages++;
      subagentTypes.set(record.agentType, subagentType);
    }
    else {
      agents.main += cost;
    }
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

  const tools = [...toolTokens].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  const otherTools = tools.slice(TOP_TOOLS);
  const contextTools = [...toolContext]
    .map(([name, size]) => ({ name, images: size.images, tokens: contextTokens(size) }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  const otherContext = contextTools.slice(TOP_TOOLS);
  const rankedSkills = [...skills.values()].sort((a, b) => byCost(a, b) || a.name.localeCompare(b.name));
  const otherSkills = rankedSkills.slice(TOP_SKILLS);

  return {
    agents,
    effort: [...effort].map(([level, cost]) => ({ cost, level })).sort((a, b) => rank(a.level) - rank(b.level) || a.level.localeCompare(b.level)),
    noSkill,
    skills: rankedSkills.slice(0, TOP_SKILLS),
    subagentTypes: [...subagentTypes.values()].sort((a, b) => byCost(a, b) || (a.type ?? '').localeCompare(b.type ?? '')),
    surfaces: [...surfaces].map(([entrypoint, cost]) => ({ cost, entrypoint })).sort(byCost),
    thinkingShare: output > 0 ? thinking / output : 0,
    total,
    context: {
      images: contextTools.reduce((sum, tool) => sum + tool.images, 0),
      otherTools: { count: otherContext.length, images: otherContext.reduce((sum, tool) => sum + tool.images, 0), tokens: otherContext.reduce((sum, tool) => sum + tool.tokens, 0) },
      tokens: contextTools.reduce((sum, tool) => sum + tool.tokens, 0),
      tools: contextTools.slice(0, TOP_TOOLS),
    },
    conversations: [...conversations.values()].sort(byCost).slice(0, TOP_CONVERSATIONS).map(({ branches, ...conversation }) => {
      let branch: string | undefined;
      for (const [name, count] of branches) {
        if (!branch || count > branches.get(branch)!)
          branch = name;
      }
      return { ...conversation, branch };
    }),
    otherSkills: {
      cost: otherSkills.reduce((sum, skill) => sum + skill.cost, 0),
      count: otherSkills.length,
      output: otherSkills.reduce((sum, skill) => sum + skill.output, 0),
    },
    output: {
      ...split,
      otherTools: { count: otherTools.length, tokens: otherTools.reduce((sum, tool) => sum + tool.tokens, 0) },
      tools: tools.slice(0, TOP_TOOLS),
      total: output,
    },
    projects: [...projects.values()]
      .map(({ cacheRead, inputAll, ...project }) => ({ ...project, cacheShare: inputAll > 0 ? cacheRead / inputAll : 0 }))
      .sort((a, b) => byCost(a, b) || a.path.localeCompare(b.path)),
  };
}
