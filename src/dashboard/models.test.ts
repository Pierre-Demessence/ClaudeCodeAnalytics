import { describe, expect, it } from 'vitest';

import { modelLabel } from '@/dashboard/models';

describe('modelLabel', () => {
  it('turns ids into readable names', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-opus-5')).toBe('Opus 5');
    expect(modelLabel('something-else')).toBe('something-else');
  });
});
