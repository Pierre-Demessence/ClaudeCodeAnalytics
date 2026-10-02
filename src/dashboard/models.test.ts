import { describe, expect, it } from 'vitest';

import { familyOf, modelLabel } from '@/dashboard/models';

describe('familyOf', () => {
  it('groups models by family', () => {
    expect(familyOf('claude-opus-5-5')).toBe('opus');
    expect(familyOf('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(familyOf('claude-mystery-1')).toBe('other');
  });
});

describe('modelLabel', () => {
  it('turns ids into readable names', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-opus-5')).toBe('Opus 5');
    expect(modelLabel('something-else')).toBe('something-else');
  });
});
