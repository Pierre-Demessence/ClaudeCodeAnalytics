import type { Family } from '@/core/family';

export interface Series {
  family: Family;
  label: string;
  /** SVG pattern id: a second cue besides color, for colorblind readers. */
  pattern: string;
  /** CSS custom property holding the series color. */
  color: string;
}

// Fixed slots: a family keeps its color whatever else is on screen.
export const SERIES: readonly Series[] = [
  { color: 'var(--series-1)', family: 'opus', label: 'Opus', pattern: 'pattern-opus' },
  { color: 'var(--series-2)', family: 'sonnet', label: 'Sonnet', pattern: 'pattern-sonnet' },
  { color: 'var(--series-3)', family: 'haiku', label: 'Haiku', pattern: 'pattern-haiku' },
  { color: 'var(--series-4)', family: 'fable', label: 'Fable', pattern: 'pattern-fable' },
  { color: 'var(--series-5)', family: 'other', label: 'Other', pattern: 'pattern-other' },
];

/** `claude-opus-5-5` → `Opus 5.5`; unknown shapes are returned as is. */
export function modelLabel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model);
  if (!match)
    return model;
  const [, name, major, minor] = match;
  return `${name![0]!.toUpperCase()}${name!.slice(1)} ${major}${minor ? `.${minor}` : ''}`;
}
