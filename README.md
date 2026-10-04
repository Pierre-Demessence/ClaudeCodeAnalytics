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
- Daily and weekly usage by model family, in API-equivalent dollars or tokens,
  with Claude Code upgrades marked on the daily chart.
- When you work (average cost per weekday and hour), cache efficiency (share
  of input from cache, dollars saved, daily share), and the cost per message
  with this week's outliers and their cause (e.g. a cache rewrite after a pause).
- Where the usage goes, this week, the last 4 weeks or all time: by project
  (with the model mix and cache share), main agent vs subagents, effort level,
  thinking share and surface, and the most expensive conversations.
- Past 5-hour sessions of the last 7 days, on a day × hour timeline and in a
  list: cost, messages, projects and peak %, each window placed by a reading
  or estimated from transcript times, and the ones that hit the limit (from a
  configurable threshold, 95% by default).
- The last 12 weekly windows on a week × day timeline and in a list: final %
  (estimated from transcripts when no reading ends the week), cost per 24 h
  block, sessions, messages, projects, and the weeks that hit the limit.
- Plan setting with history; the plan is also detected from Claude Code's login.
- Tabs: Overview (limits and pacing), Usage (charts by model, heatmap, cache, message costs),
  Breakdown (projects, conversations, agents), Sessions (past 5-hour windows),
  Weeks (past weekly windows), Plans (which plan would have fit the last 12 weeks, an Opus-to-Sonnet what-if, and how far the advertised plan multipliers match your own weeks) and Calibration (limit drift, the fit, readings with manual ones addable and deletable, plan and collection settings, plan history).
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

## Scripts

| Script                 | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `npm run dashboard`    | Build and open the dashboard (`vite preview`).            |
| `npm run dev`          | Dashboard with hot reload.                                |
| `npm run docker:up`    | Build and (re)start the always-on Docker dashboard.       |
| `npm run collect`      | Run the collector once (`-- --force` skips the throttle). |
| `npm run hook:install` | Print or (`-- --apply`) install the Claude Code hook.     |
| `npm run build`        | Type-check, then build.                                   |
| `npm run lint`         | Lint with ESLint (`lint:fix` to auto-fix).                |
| `npm test`             | Run Vitest once (`test:watch`, `test:coverage`).          |

Project docs: [docs/backlog.md](docs/backlog.md) and [docs/decisions.md](docs/decisions.md). Agent notes: [AGENTS.md](AGENTS.md).
