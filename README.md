# Claude Code Analytics

A local dashboard for Claude Code plan usage: **will I last the week?** and
**what share of a plan do I use per week?**, plus raw usage per day and week by
model. Scaffolded with
[create-corniflex](https://github.com/Pierre-Demessence/create-corniflex).

Everything stays on your machine. Data comes from two places:

- **Claude Code transcripts** (`~/.claude/projects/**/*.jsonl`): token counts
  per message, priced at public API rates as the usage unit, with the session,
  working directory, branch, effort and Claude Code version, and each
  conversation's AI-generated title. Message content is never stored.
- **Plan limits**: Claude Code's undocumented usage endpoint (the numbers behind
  `/usage`), read with the OAuth token Claude Code stores locally, and/or manual
  readings you type in. The token is only ever sent to `api.anthropic.com`; it is
  never logged or stored.

## Features

- Current weekly and 5-hour %, reset times, and for each window a projection
  at reset with its likely range and the time the cap would be hit, plus the
  active use left before the limit at your usual pace while working.
- Budget pacing: this week's % against an even pace, and the daily spend left
  to reach 100% at reset.
- The typical week, and its equivalent on Pro, Max 5× and Max 20×
  (approximate, from the advertised multipliers).
- What the subscription bought: what you were charged (from the billing date Claude Code caches; list price, before VAT) against the same usage at API prices, this billing cycle or all time.
- Daily and weekly usage by model family, in API-equivalent dollars or tokens,
  with Claude Code upgrades marked on the daily chart.
- When you work (average cost per weekday and hour), cache efficiency (share
  of input from cache, dollars saved, daily share, and the days the cache was
  flushed and rewritten with their extra cost), and the cost per message with
  this week's outliers and their cause (e.g. a cache rewrite after a pause).
- Where the usage goes, this week, the last 4 weeks or all time: by project
  (with the model mix and cache share), main agent vs subagents (with the subagents' types), effort level,
  thinking share and surface, and the most expensive conversations.
- Past 5-hour sessions of the last 7 days, on a day × hour timeline and in a
  list: cost, messages, projects and peak %, each window placed by a reading
  or estimated from transcript times, the ones that hit the limit (from a
  configurable threshold, 95% by default) and the ones a rate limit blocked
  (the message Claude Code printed, read from the transcripts).
- The last 12 weekly windows on a week × day timeline and in a list: peak %
  (estimated from transcripts when no reading ends the week), cost per 24 h
  block, sessions, messages, projects, the weeks that hit the limit (from a
  configurable threshold, 98% by default) and the weeks a rate limit blocked.
- Plan setting with history; the plan is also detected from Claude Code's login.
- Tabs: Overview (limits and pacing), Usage (subscription vs API prices, charts by model, heatmap, cache, message costs),
  Breakdown (projects, conversations, agents), Sessions (past 5-hour windows),
  Weeks (past weekly windows), Plans (which plan would have fit the last 12 weeks, with the demand a limit hid estimated at your typical pace, an Opus-to-Sonnet what-if, and how far the advertised plan multipliers match your own weeks) and Calibration (limit drift, the fit, readings with manual ones addable and deletable, plan and collection settings, plan history).
- Light and dark themes: follows the OS until you pick one in the header.
- Colorblind-friendly: every series has a texture and a label, not just a color.

Assumptions: transcripts come from this machine only, and plan limits scale
with API prices across models. The endpoint separates Claude Code from
claude.ai usage; a manual reading can carry that share too (from `/usage`); without it, claude.ai use counts as Claude
Code. When the endpoint fails, the dashboard warns that the last reading is old
and estimates the usage since from transcripts.

## Getting started

Requires Node ≥ 22.18 (runs the collector's `.ts` files directly).

```sh
npm install
npm run hook:install            # prints the Claude Code hook to add
npm run hook:install -- --apply # or adds it to ~/.claude/settings.json (with a backup)
npm run dashboard               # builds and opens the dashboard
```

The hook runs the collector in the background after every Claude Code
response; it calls the usage endpoint at most every 15 minutes. Opening the
dashboard also imports new transcripts.

Collected data lives in `~/.claude-code-analytics/` (override with
`CCA_DATA_DIR`). Raise `cleanupPeriodDays` in `~/.claude/settings.json` if you
want older transcripts kept, although messages already imported are kept anyway.

### Always-on dashboard (Docker)

Requires Docker Desktop and a running Traefik attached to an external `proxy`
network. `npm run docker:up` builds the image and starts it at
<http://analytics.claudecode.localhost>, behind the Traefik reverse proxy on the
external `proxy` network. The container restarts with Docker Desktop, mounts
`~/.claude` read-only and shares `~/.claude-code-analytics` with the hook, which
keeps running on the host. The container serves the version it was built from:
run `npm run docker:up` again after changing the code.

### Taskbar widget (Windows)

A small readout docked in the taskbar, left of the notification area: the 5-hour
and weekly usage as a bar, a percent and the time to reset (`2h59m`, `2d05h`).
It reads the dashboard's `/api/widget`, so the always-on dashboard must run.
It is one small native process (about 10 MB) drawn from `widget/widget.svg`.
Needs [Rust](https://www.rust-lang.org/) (`mise install`) and the Visual Studio
C++ build tools.

```sh
npm run widget:install   # builds, copies the exe to %LOCALAPPDATA%\Claude Code Analytics Widget, starts it
```

Click the readout to open the dashboard; right-click it for "Start with Windows"
and "Quit". `npm run widget:dev` runs a debug build from the source, which redraws
when `widget/widget.svg` is saved. Only one widget runs at a time: a second launch
exits at once, so quit the installed one (right-click, Quit) before `widget:dev`
or a new `widget:install`. A widget installed by the old Tauri build can
be removed with the `uninstall.exe` in the same folder first.

## Scripts


| Script                 | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `npm run dashboard`    | Build and open the dashboard (`vite preview`).            |
| `npm run dev`          | Dashboard with hot reload.                                |
| `npm run docker:up`    | Build and (re)start the always-on Docker dashboard.       |
| `npm run collect`      | Run the collector once (`-- --force` skips the throttle). |
| `npm run hook:install` | Print or (`-- --apply`) install the Claude Code hook.     |
| `npm run widget:dev`   | Run the taskbar widget from the source.                   |
| `npm run widget:install` | Build the taskbar widget and install it for the user.   |
| `npm run widget:test`  | Test and lint the widget (`cargo test`, `clippy`).        |
| `npm run build`        | Type-check, then build.                                   |
| `npm run lint`         | Lint with ESLint (`lint:fix` to auto-fix).                |
| `npm test`             | Run Vitest once (`test:watch`, `test:coverage`).          |

Project docs: [docs/backlog.md](docs/backlog.md) and [docs/decisions.md](docs/decisions.md). Agent notes: [AGENTS.md](AGENTS.md).
