// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { STOP_HOOK, withCollectorHook } from './hook.ts';

describe('withCollectorHook', () => {
  it('adds an async Stop hook running the collector quietly, keeping other settings', () => {
    const updated = withCollectorHook({ hooks: { Stop: [{ hooks: [{ command: 'other', type: 'command' }] }] }, model: 'opus' })!;
    expect(updated.model).toBe('opus');
    expect(updated.hooks!.Stop).toHaveLength(2);
    expect(updated.hooks!.Stop![1]!.hooks[0]).toBe(STOP_HOOK);
    expect(STOP_HOOK.async).toBe(true);
    expect(STOP_HOOK.command).toMatch(/^node ".*\/src\/collector\/cli\.ts" --quiet$/);
  });

  it('tolerates hook entries of other shapes', () => {
    const settings = { hooks: { Stop: [{ hooks: [{ prompt: 'x', type: 'prompt' }] }, {}] } } as unknown as Parameters<typeof withCollectorHook>[0];
    expect(withCollectorHook(settings)?.hooks?.Stop).toHaveLength(3);
  });

  it('is idempotent', () => {
    const once = withCollectorHook({})!;
    expect(withCollectorHook(once)).toBeNull();
  });
});
