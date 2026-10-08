import { describe, expect, it } from 'vitest';

import type { OutputPart } from './outputSplit.ts';

import { splitOutput, toolLabel } from './outputSplit.ts';

const total = (parts: OutputPart[]) => parts.reduce((sum, part) => sum + part.tokens, 0);
const byName = (parts: OutputPart[]) => Object.fromEntries(parts.map(part => [part.name ?? part.kind, part.tokens]));

describe('splitOutput', () => {
  it('counts thinking apart and the rest as reply text when there is no tool call', () => {
    const parts = splitOutput({ output: 1000, thinking: 300, tools: {} });
    expect(byName(parts)).toEqual({ reply: 700, thinking: 300 });
  });

  it('spreads the rest over the tool calls, one share per call', () => {
    const parts = splitOutput({ output: 1000, thinking: 100, tools: { Bash: 1, Read: 2 } });
    expect(byName(parts)).toEqual({ Bash: 300, Read: 600, thinking: 100 });
  });

  it('weights each call by its input size plus a fixed overhead, when the sizes are known', () => {
    const parts = splitOutput({ output: 1100, thinking: 100, toolInput: { Bash: 50, Write: 850 }, tools: { Bash: 1, Write: 1 } });
    // Weights: Bash 50 + 50, Write 850 + 50 → 100 : 900.
    expect(byName(parts)).toEqual({ Bash: 100, thinking: 100, Write: 900 });
  });

  it('counts the overhead once per call and treats a missing size as empty input', () => {
    const parts = splitOutput({ output: 900, toolInput: { Read: 100 }, tools: { Read: 2, Snapshot: 1 } });
    // Read: 100 + 2 × 50 = 200; Snapshot: 0 + 50 = 50.
    expect(byName(parts)).toEqual({ Read: 720, Snapshot: 180 });
  });

  it('spreads evenly when a record has no input sizes', () => {
    const parts = splitOutput({ output: 1000, tools: { Bash: 1, Read: 1 } });
    expect(byName(parts)).toEqual({ Bash: 500, Read: 500 });
  });

  it('gives the leftover tokens to the largest remainders, so the parts always sum to the output', () => {
    const parts = splitOutput({ output: 10, tools: { Bash: 1, Edit: 1, Read: 1 } });
    expect(total(parts)).toBe(10);
    // 10 / 3 = 3.33…: the extra token goes to the first name on a tie.
    expect(byName(parts)).toEqual({ Bash: 4, Edit: 3, Read: 3 });
    expect(total(splitOutput({ output: 7, thinking: 2, tools: { A: 3, B: 2, C: 2 } }))).toBe(7);
  });

  it('counts the output of a message imported before tools were kept as untracked', () => {
    expect(byName(splitOutput({ output: 500, thinking: 200 }))).toEqual({ thinking: 200, untracked: 300 });
  });

  it('never lets thinking exceed the output, and drops empty parts', () => {
    expect(byName(splitOutput({ output: 100, thinking: 150, tools: { Bash: 1 } }))).toEqual({ thinking: 100 });
    expect(splitOutput({ output: 0, tools: {} })).toEqual([]);
  });
});

describe('toolLabel', () => {
  it('names built-in tools as they are', () => {
    expect(toolLabel('Bash')).toBe('Bash');
  });

  it('groups the tools of an MCP server under the server', () => {
    expect(toolLabel('mcp__plugin_playwright_playwright__browser_click')).toBe('MCP playwright');
    expect(toolLabel('mcp__plugin_github_github__create_branch')).toBe('MCP github');
    expect(toolLabel('mcp__claude_ai_Claude_Docs__batch')).toBe('MCP claude_ai_Claude_Docs');
  });
});
