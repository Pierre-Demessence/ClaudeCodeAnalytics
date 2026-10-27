// @vitest-environment node
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collect } from '../collector/collect.ts';
import { apiPlugin } from './api.ts';

vi.mock('../collector/collect.ts', () => ({ collect: vi.fn(async () => ({ skipped: 'locked' })) }));

type Hook = (server: unknown) => void;

function start(hook: 'configurePreviewServer' | 'configureServer', httpServer: EventEmitter | null) {
  const plugin: Plugin = apiPlugin();
  (plugin[hook] as Hook)({ httpServer, middlewares: { use: vi.fn() } } as unknown as PreviewServer & ViteDevServer);
}

describe('apiPlugin', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(collect).mockClear();
  });

  it.each(['configurePreviewServer', 'configureServer'] as const)('collects every minute while the %s server is open', async (hook) => {
    vi.useFakeTimers();
    const httpServer = new EventEmitter();
    start(hook, httpServer);
    expect(collect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collect).toHaveBeenCalledTimes(2);

    httpServer.emit('close');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('starts no timer without an HTTP server of its own (middleware mode)', async () => {
    vi.useFakeTimers();
    start('configureServer', null);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collect).not.toHaveBeenCalled();
  });

  it('keeps the timer going when a run fails', async () => {
    vi.useFakeTimers();
    vi.mocked(collect).mockRejectedValueOnce(new Error('disk full'));
    start('configurePreviewServer', new EventEmitter());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collect).toHaveBeenCalledTimes(2);
  });
});
