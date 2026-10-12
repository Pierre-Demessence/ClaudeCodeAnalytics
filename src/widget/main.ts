import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { WidgetView } from '../core/widget.ts';
import type { WidgetState } from './view.ts';

import { createWidget } from './view.ts';
import './widget.css';

const FETCH_EVERY_MS = 60_000;
const TICK_EVERY_MS = 30_000;
const THEME_POLL_MS = 300_000;

const root = document.getElementById('widget')!;
const widget = createWidget(root);
const state: WidgetState = { offline: false };

const render = () => widget.update(state, Date.now());

function setTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
}

async function applyTheme() {
  try {
    // The taskbar's theme, not the apps' one that `prefers-color-scheme` reports.
    setTheme(await invoke<string>('taskbar_theme'));
  }
  catch {
    // Without it the stylesheet falls back to `prefers-color-scheme`.
  }
}

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
applyTheme();
// Rust watches the registry; the slow poll covers a missed event.
listen<string>('taskbar-theme', event => setTheme(event.payload)).catch(() => {});
setInterval(poll, FETCH_EVERY_MS);
setInterval(render, TICK_EVERY_MS);
setInterval(applyTheme, THEME_POLL_MS);
