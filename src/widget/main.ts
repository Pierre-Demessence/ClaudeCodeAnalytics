import { invoke } from '@tauri-apps/api/core';

import type { WidgetView } from '../core/widget.ts';
import type { WidgetState } from './view.ts';

import { createWidget } from './view.ts';
import './widget.css';

const FETCH_EVERY_MS = 60_000;
const TICK_EVERY_MS = 30_000;

const root = document.getElementById('widget')!;
const widget = createWidget(root);
const state: WidgetState = { offline: false };

const render = () => widget.update(state, Date.now());

async function poll() {
  try {
    // The Rust side makes the request: see `fetch_widget` in src-tauri.
    state.view = JSON.parse(await invoke<string>('fetch_widget')) as WidgetView;
    state.offline = false;
  }
  catch {
    state.offline = true;
  }
  render();
}

render();
poll();
setInterval(poll, FETCH_EVERY_MS);
setInterval(render, TICK_EVERY_MS);
