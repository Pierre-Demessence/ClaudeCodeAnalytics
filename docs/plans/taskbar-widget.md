# Taskbar widget

## Goal

A small native Windows app (Tauri) that docks a two-line readout into the
taskbar, like Claude Code Usage Monitor, but reads the dashboard's API instead
of calling Anthropic itself:

```text
5h [████▏ ▏ ▏   ]  42% • 2h59m
7d [████████▏ ▏  ]  59% • 2d05h
```

Transparent background (text on the taskbar), a real bar with gaps at 25, 50 and
75 %, and a fixed-width percent column so one-digit values stay aligned.

## Acceptance criteria

### API

- WHEN the widget requests `GET /api/widget`, THE SYSTEM SHALL run the collector
  as `/summary` does (endpoint throttle kept) and return only the 5-hour and
  weekly rows: percent, whether it is estimated, and the reset time.
- THE SYSTEM SHALL compute the rows from `buildSummary`, so the widget and the
  Overview never disagree: `estimatedNow ?? percent` for each window.
- IF the 5-hour reading's reset time has passed, or the reading has no window,
  THEN THE SYSTEM SHALL return 0% with no reset time (an idle window).
- IF there is no weekly reading at all, THEN THE SYSTEM SHALL return the weekly
  row as unknown.

### Display

- THE SYSTEM SHALL show two rows, `5h` then `7d`, each with a progress bar, the
  percent and the time to reset.
- THE SYSTEM SHALL format the time to reset, rounded down, as `<d>d<hh>h` from
  one day, `<h>h<mm>m` from one hour, `<m>m` below, and `<1m` under a minute.
  Example: 2 h 59 min 40 s gives `2h59m`, never `2h`.
- WHILE a row has no reset time, THE SYSTEM SHALL show `–` in its place.
- WHILE a percent is estimated, THE SYSTEM SHALL prefix it with `~`, as the
  Overview marks estimates.
- THE SYSTEM SHALL fill the bar by the percent (length carries the value) and,
  at the limit thresholds, change its color, hatch the fill and bold the percent.
- THE SYSTEM SHALL update the time to reset every 30 s locally and fetch the API
  every 60 s.
- IF the API is unreachable, THEN THE SYSTEM SHALL keep the last values dimmed
  with an offline icon, and show `–` everywhere when it has never answered.
- THE SYSTEM SHALL follow the Windows light or dark theme.

### Window

- WHEN the app starts, THE SYSTEM SHALL dock the readout inside the primary
  taskbar, to the left of the notification area, without stealing focus or
  appearing in Alt+Tab.
- WHEN Explorer restarts (`TaskbarCreated`), THE SYSTEM SHALL dock again.
- WHEN the readout is clicked, THE SYSTEM SHALL open the dashboard in the
  default browser.
- THE SYSTEM SHALL offer a right-click menu on the readout (no tray icon): open the
  dashboard, start with Windows (on/off), quit.
- THE SYSTEM SHALL never read the OAuth token nor call any host but the
  dashboard's.

## Design

### Shape

- `GET /api/widget` (`src/server/api.ts`) returns `WidgetView` built by a pure
  `widgetView(summary, now)` in `src/core/widget.ts`:
  `{ fiveHour: WidgetRow, weekly: WidgetRow, generatedAt }`, with
  `WidgetRow = { percent?: number, estimated: boolean, resetsAt?: string }`.
  A dedicated route keeps the response a few hundred bytes instead of the full
  summary every minute.
- `formatResetIn(ms)` in `src/core/widget.ts` (pure, tested), so the server
  tests and the widget share it.
- The widget front end is plain TypeScript, no React: two rows of DOM.
  It lives in `src/widget/` (DOM tsconfig), built by its own
  `vite.widget.config.ts` into `dist-widget/`.
- The Tauri shell lives in `src-tauri/` (Rust): window setup, right-click menu,
  docking, autostart (`tauri-plugin-autostart`), opening the browser
  (`tauri-plugin-opener`).
- The one request is the Rust command `fetch_widget`, which pins
  `analytics.claudecode.localhost` to `127.0.0.1` (Windows does not resolve
  `*.localhost`) and follows no redirect: the webview has no network access and
  the API stays unchanged (no CORS header). See `docs/decisions.md`.

### Docking (Rust, `windows` crate)

Find `Shell_TrayWnd`, `SetParent` the widget window into it, set
`WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`, and position it left of `TrayNotifyWnd`
at the taskbar's height, scaled for DPI. Re-dock on the registered
`TaskbarCreated` message and on display or DPI changes. This is undocumented
Windows behavior: the monitor does the same (`src/native_interop.rs` in its repo).

### Data freshness

The widget polling `/api/widget` runs the collector once a minute, so endpoint
readings arrive every throttle period (15 min) while the PC is on, even when idle.
The endpoint only reads usage; it never opens a 5-hour window (seen on
2026-10-12: a reading at 12:48 UTC reported no window).

### Toolchain

- Rust through mise (`mise.toml` at the repo root, pinned stable); MSVC Build
  Tools 2022 are installed; WebView2 ships with Windows 11.
- New dev dependencies: `@tauri-apps/cli`, `@tauri-apps/api` (the opener and autostart plugins are Rust crates only).
- Scripts: `widget:dev`, `widget:build` (an NSIS installer the user runs once).
- `.gitignore`: `src-tauri/target`, `dist-widget`. ESLint ignores both.

### Edge cases

- Taskbar on top or a side, or auto-hidden: v1 supports the bottom taskbar;
  otherwise it stays a floating window near the tray.
- Several monitors: primary taskbar only in v1.
- Weekly reading from an earlier week (`withoutReading`): 0% estimated from
  transcripts, as the Overview does.
- The widget app outlives a Docker restart: it just shows offline meanwhile.

## Checklist

- [x] Proof of concept: Tauri window docked in the taskbar showing static text
      (risky part first; stop and report if WebView2 misbehaves as a child window)
- [x] Design: no canvas needed (user decision); transparent text, real bar with 25/50/75 % gaps, fixed-width percent
- [x] `formatResetIn` with tests
- [x] `widgetView` with tests (idle window, expired reset, estimated, no weekly)
- [x] `GET /api/widget` with a route test
- [x] Widget front end: render, timers, offline state; tests for the view logic
- [x] Tauri shell: right-click menu, click to open, autostart, `fetch_widget`
- [x] Docking: re-dock by a 3 s watcher that also recreates the window after an Explorer restart
- [x] Toolchain: `mise.toml`, scripts, `.gitignore`; ESLint needs none (antfu config follows `.gitignore`)
- [x] Docs: `AGENTS.md` (commands, layout, invariant: the widget never reads the
      token), `README.md` (install the widget)
- [x] Lint, test, build; `widget:build`; container rebuilt (`docker:up`)
- [ ] Review loop

Status: implemented, committed and verified by the user (docked, live values, clicks,
right-click menu, Explorer restart). Clicks come from a mouse hook, not the page
(`docs/decisions.md`). Remaining before this plan is deleted: one instance at a
time, and swallowing the right click so the taskbar's own menu stays closed.
