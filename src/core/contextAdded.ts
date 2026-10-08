import type { ToolContext } from './types.ts';

/** Rough size of English and code text; the real tokenizer is not available offline. */
export const CHARS_PER_TOKEN = 4;
/** A screenshot is about this many tokens; its dimensions are not read, so one figure serves all. */
export const IMAGE_TOKENS = 1600;

/** Estimated tokens a tool's results added to the context. */
export function contextTokens(size: Pick<ToolContext, 'chars' | 'images'>): number {
  return Math.round(size.chars / CHARS_PER_TOKEN + size.images * IMAGE_TOKENS);
}
