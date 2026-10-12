# Native taskbar widget

## Goal

Replace the Tauri + WebView2 widget with one native Rust process that draws
the same readout from an SVG template rendered by `resvg`. It should use about
10 MB instead of 95 MB across 6 processes, drop the Chromium workarounds (GPU
flags, the mouse hook, CSP, IPC), and keep the design in a markup file that
reloads live while developing.

## Acceptance criteria

- WHEN the widget runs, THE SYSTEM SHALL use one process with a private working
  set under 20 MB (`Get-Process cca-widget`).
- WHEN the widget is docked, THE SYSTEM SHALL draw the same readout as today:
  two rows (`5h`, `7d`), each with a label, a bar with gaps at 25/50/75 %, a
  right-aligned percentage (`~` prefix when estimated, `–` without a reading),
  a dot and the time to reset (`2d05h`, `2h59m`, `45m`, `<1m`, `–`).
- WHEN a row's percentage reaches its limit, THE SYSTEM SHALL hatch its bar and
  bold its percentage, so the limit never relies on color alone.
- WHILE the last fetch failed, THE SYSTEM SHALL dim both rows and show the
  Lucide `wifi-off` icon.
- WHEN the taskbar theme (`SystemUsesLightTheme`) changes, THE SYSTEM SHALL
  redraw in the matching colors without polling for it.
- WHEN the user left-clicks anywhere on the widget's rectangle, THE SYSTEM SHALL
  open the dashboard; WHEN they right-click, it SHALL show the menu (Open the
  dashboard, Start with Windows with its check state, Quit), and the taskbar's
  own context menu SHALL NOT open.
- WHEN Explorer restarts or the tray area resizes, THE SYSTEM SHALL dock again
  within one 3 s tick.
- WHEN the display DPI differs from 96, THE SYSTEM SHALL draw at the DPI of the
  monitor the widget sits on, read after docking.
- IF a second instance starts, THEN THE SYSTEM SHALL exit at once.
- WHEN polling, THE SYSTEM SHALL request only `GET /api/widget` on
  `127.0.0.1:80` with `Host: analytics.claudecode.localhost`, every 60 s, and
  redraw every 30 s for the reset countdown.
- IF the answer is not a valid widget view (bad status, bad JSON, wrong shape),
  THEN THE SYSTEM SHALL treat it as offline.
- WHILE running a debug build, WHEN `widget.svg` is saved, THE SYSTEM SHALL
  redraw from the new file within a second; IF the new file does not parse,
  THEN it SHALL keep the last good one.

## Design

### Spike first

Stage 1 is a throwaway proof of concept answering four questions before the
rest is built:

1. Does a `resvg` bitmap shown with `UpdateLayeredWindow` in a layered child
   window of `Shell_TrayWnd` look crisp, with antialiased text at 100 % and
   150 % scaling?
2. Does that window receive real `WM_LBUTTONUP` / `WM_RBUTTONUP`, and does
   handling them keep the taskbar menu closed?
3. Does `resvg` render Segoe UI Variable (`SegUIVar.ttf`, a variable font)?
   If not, it falls back to `segoeui.ttf`.
4. What is the working set?

Outcomes: if 2 fails, keep `clicks.rs` (the mouse hook) as it is, targeting
the native window. If 1 fails, stop and come back with Direct2D/DirectWrite as
the alternative renderer.

### Crate

`src-tauri/` is renamed `widget/`, since nothing in it is Tauri any more. It
depends on `windows`, `resvg` (which brings `usvg`, `tiny-skia`, `fontdb`),
`serde` and `serde_json`, plus a build dependency (`embed-resource` or
similar, picked at implementation) that embeds the app manifest and icon.
`tauri`, its three plugins, `tauri-build` and `reqwest` go. On the npm side,
`@tauri-apps/api` and `@tauri-apps/cli` go. Versions are checked when added.

The manifest declares Windows 8+ compatibility, which layered child windows
require, and per-monitor DPI awareness v2. `tauri-build` embedded one before.

### Modules

| Module | Role | Tests |
| --- | --- | --- |
| `view.rs` | `WidgetView` / `WidgetRow` (serde), `format_reset_in`, and `readout(state, now)` turning the last answer into the strings, fill fractions, at-limit and offline flags | Unit tests ported from `view.test.ts` and the `formatResetIn` cases of `core/widget.test.ts` |
| `template.rs` | Fills `widget.svg`'s `{{placeholders}}` from a readout and a theme (XML-escaped) | Unit tests |
| `render.rs` | Parses the SVG with `usvg` and renders it with `resvg` at the DPI scale into a premultiplied pixmap | Golden-image tests: fixed states rendered to PNG and compared with `widget/tests/snapshots/*.png`; `UPDATE_SNAPSHOTS=1` rewrites them |
| `fetch.rs` | The one request, over `std::net::TcpStream` (see below) | Unit test on response parsing |
| `dock.rs` | Kept; takes an `HWND` instead of a `WebviewWindow`, scales with `GetDpiForWindow` of the taskbar, read before docking | — |
| `theme.rs` | Kept; posts a message to the window instead of emitting an event | — |
| `autostart.rs` | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value `Claude Code Analytics Widget` (the name Tauri's plugin used, so an old entry is overwritten) | — |
| `window.rs` | Window class, window procedure, menu (`TrackPopupMenu`), `UpdateLayeredWindow`, `ShellExecuteW` for the dashboard | — |
| `main.rs` | Single-instance named mutex, message loop, timers, worker threads | — |

### Drawing

`widget/widget.svg` holds the whole look: layout in logical pixels
(200 × 48), bars with a `<mask>` for the gaps, a `<pattern>` for the hatching,
`text-anchor="end"` for the percentages, and the `wifi-off` paths. Its colors
are placeholders filled from the theme (today's `widget.css` values: text
`#1a1a1a` / `#fff`, accent `#1f6feb` / `#58a6ff`, limit `#d9480f` / `#ff922b`).
Rust computes only the values: texts, fill widths, flags.

Two differences from the CSS grid:
- Columns are at fixed x positions, since SVG has no auto-sized columns. The
  percent column fits `~100%` and the reset column fits `2d23h`.
- The offline icon's slot is always reserved, so nothing shifts when going
  offline. The template is 200 px wide, 10 px more than the old 190 px, to make room for it.

The background is filled with alpha 1/255, not 0. A layered window lets clicks
through fully transparent pixels, so without it the gaps between the texts
would reach the taskbar and open its menu.

A release build embeds the SVG (`include_str!`). A debug build reads it from
`widget/widget.svg` and checks its modification time every 500 ms. That is the
design hot reload. Rust edits still need a restart.

### Fetch

The request is HTTP/1.0 over `TcpStream` to `127.0.0.1:80`, with the real
`Host` header for Traefik's routing and a 10 s timeout. HTTP/1.0 rules out
chunked responses, so the body is everything after the headers. It runs on a
worker thread and posts the result to the window. Redirects are not followed.
This replaces `reqwest` while keeping the pin to loopback (`decisions.md`).

### API change

`WidgetRow.resetsAt` (ISO) becomes `resetsAtMs` (epoch ms), so Rust needs no
date parser. The widget is the route's only consumer. `formatResetIn` moves to
Rust, and its TS version and tests are deleted.

### Explorer restarts and the message loop

The window dies with the taskbar, as today. A thread timer (not tied to the
window) runs the 3 s watch: dock, or recreate the window when `IsWindow` fails.
`WM_DESTROY` of the widget never ends the message loop. Only Quit does.

### Packaging

The output is a plain exe with no installer:
- `npm run widget:build` runs `cargo build --release`.
- `npm run widget:install` builds, copies the exe to
  `%LOCALAPPDATA%\Claude Code Analytics Widget\` (where the NSIS install was) and
  starts it. The widget must be quit first, since a running exe is locked.
- "Start with Windows" points the Run value at the running exe.
- The old Tauri install is removed once through Windows' Apps settings.

### Out of scope

- Side and top taskbars, and secondary monitors (backlog item stays).
- Hot reload of Rust code (subsecond needs the `dx` CLI, experimental).
- Accessibility beyond the window text, which is set to the readout
  (`5h 42%, resets in 2h10m · 7d …`).

### Failure modes

| Condition | Behavior |
| --- | --- |
| Dashboard down | Offline icon, last values dimmed |
| Explorer not running | Window hidden until docking succeeds |
| Font missing | Text is not drawn (only the three Segoe files are loaded) |
| Bad SVG in dev | Last good template kept, error printed |
| Registry watch fails | Retry every 5 s, as today |

## Checklist

Status: implemented and checked live (look, clicks, theme, offline); Start with Windows after a logon is still to be checked.

- [x] Baseline: `npm run lint`, `npm test`, `npm run build`, `cargo build` in
  `src-tauri`; note existing warnings
- [x] Spike (throwaway): layered child window in the taskbar, `resvg` bitmap,
  real clicks, variable font, working set; report and decide on the hook
- [x] Rename `src-tauri/` to `widget/`; new `Cargo.toml`, manifest and icon
  embedding; remove Tauri files (`tauri.conf.json`, `capabilities/`, `gen/`)
- [x] `view.rs` + tests (port from `view.test.ts`, `formatResetIn` cases)
- [x] API: `resetsAtMs` in `core/widget.ts`; delete TS `formatResetIn` and its
  tests
- [x] `widget.svg` + `template.rs` + tests
- [x] `render.rs` + golden-image tests (light, dark, at limit, estimated,
  offline, no reading)
- [x] `fetch.rs` + parsing test
- [x] `window.rs`, `dock.rs`, `theme.rs`, `autostart.rs`, `main.rs`
- [x] Debug hot reload of `widget.svg`
- [x] Delete `src/widget/`, `vite.widget.config.ts`, `dist-widget`, and the
  Tauri npm packages; update `package.json` scripts (`widget:dev`,
  `widget:build`, `widget:install`, `widget:test` running `cargo test` and
  `cargo clippy`); update `.gitignore`, `tsconfig`/ESLint globs if they name
  `src/widget`
- [x] Measure the working set on the installed release build: 9.4 MB working set, 1.8 MB private
- [x] Docs: `AGENTS.md` (commands, layout, widget invariants), `README.md`
  widget section, `decisions.md` (replace the two widget entries; add the
  native + SVG decision with its rejected alternatives: WebView2, Blitz,
  Slint, GDI text), `backlog.md` (delete this item and the CSP item; delete
  the DPI item if verified fixed)
- [x] Review pass, then final report with what needs your testing (taskbar
  look, clicks, Explorer restart, theme switch, autostart)
