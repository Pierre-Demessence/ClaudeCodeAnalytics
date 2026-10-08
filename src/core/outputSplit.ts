import type { UsageRecord } from './types.ts';

export type OutputKind = 'reply' | 'thinking' | 'tool' | 'untracked';

/** Part of a message's output tokens; `name` is the tool for `tool`. */
export interface OutputPart {
  name?: string;
  kind: OutputKind;
  tokens: number;
}

const MCP_PREFIX = 'mcp__';

/** A tool as shown: the tools of an MCP server share one label, named after the server. */
export function toolLabel(name: string): string {
  if (!name.startsWith(MCP_PREFIX))
    return name;
  const server = name.slice(MCP_PREFIX.length).split('__')[0]!.replace(/^plugin_/, '');
  // Plugin servers are named `<plugin>_<server>`, often both the same.
  const half = server.slice(0, (server.length - 1) / 2);
  return `MCP ${server === `${half}_${half}` ? half : server}`;
}

/**
 * Splits `total` over `weights` in proportion, in whole tokens: each gets its
 * rounded-down share, and the tokens left go to the largest fractions (ties
 * to the first name) so the parts always sum to `total`.
 */
function allocate(total: number, weights: [string, number][]): [string, number][] {
  const weightSum = weights.reduce((sum, [, weight]) => sum + weight, 0);
  const shares = weights.map(([name, weight]) => {
    const exact = total * weight / weightSum;
    return { name, fraction: exact - Math.floor(exact), tokens: Math.floor(exact) };
  });
  let left = total - shares.reduce((sum, share) => sum + share.tokens, 0);
  const order = [...shares].sort((a, b) => b.fraction - a.fraction || a.name.localeCompare(b.name));
  for (const share of order) {
    if (left <= 0)
      break;
    share.tokens++;
    left--;
  }
  return shares.map(share => [share.name, share.tokens]);
}

/**
 * Where one message's output tokens went. Thinking is recorded exactly; the
 * rest is the text and the tool calls, which the transcript does not size
 * separately, so it is spread evenly over the tool calls (one share per
 * call), or counted as reply text when there are none. A message imported
 * before tool calls were kept is `untracked`. The parts sum to `output`.
 */
export function splitOutput(record: Pick<UsageRecord, 'output' | 'thinking' | 'tools'>): OutputPart[] {
  const thinking = Math.min(Math.max(record.thinking ?? 0, 0), record.output);
  const rest = record.output - thinking;
  const parts: OutputPart[] = [{ kind: 'thinking', tokens: thinking }];
  const calls = Object.entries(record.tools ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (!record.tools)
    parts.push({ kind: 'untracked', tokens: rest });
  else if (calls.length === 0)
    parts.push({ kind: 'reply', tokens: rest });
  else
    parts.push(...allocate(rest, calls).map(([name, tokens]): OutputPart => ({ name, kind: 'tool', tokens })));
  return parts.filter(part => part.tokens > 0);
}
