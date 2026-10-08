export type Family = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other';

export function familyOf(model: string): Family {
  for (const family of ['opus', 'sonnet', 'haiku', 'fable'] as const) {
    if (model.includes(`-${family}-`))
      return family;
  }
  return 'other';
}
