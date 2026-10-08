import { describe, expect, it } from 'vitest';

import { familyOf } from './family.ts';

describe('familyOf', () => {
  it('groups models by family', () => {
    expect(familyOf('claude-opus-5-5')).toBe('opus');
    expect(familyOf('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(familyOf('claude-mystery-1')).toBe('other');
  });
});
