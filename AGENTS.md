# AGENTS.md

Agent operating notes for **Claude Code Analytics**: a local dashboard (Vite +
React + TypeScript strict) estimating Claude Code plan usage from local
transcripts and the plan-limit endpoint.

## Commands

- Dashboard: `npm run dashboard` (build + preview) or `npm run dev`
- Always-on dashboard: `npm run docker:up` (rebuild + restart the container
  at `http://analytics.claudecode.localhost`, behind Traefik)
- Collector: `npm run collect` (`-- --force` ignores the endpoint throttle)
- Backtest: `npm run backtest` (`-- --weeks 8 --step-hours 6`) replays the
  forecasts on the data dir, read-only, and scores them against the final %
- Hook: `npm run hook:install` prints it; `-- --apply` edits `~/.claude/settings.json`
- Build: `npm run build` (type-checks both tsconfigs, then `vite build`)
- Lint: `npm run lint` / `npm run lint:fix`
- Test: `npm test` / `npm run test:watch` / `npm run test:coverage`

Run lint, test and build before considering work done.

## Layout

- `src/core/` — pure logic, no Node or DOM APIs: transcript parsing, events
  (rate-limit hits, overloads, compactions), output split by tool, pricing,
  aggregation, calibration, forecast, active pace, weekly share, week history,
  cache anomalies, plans, plan fit, multipliers, breakdown, `buildSummary`.
- `src/collector/` — Node: transcript scan, usage endpoint client, data-dir
  store, lock, hook installer; entry `cli.ts` (also run by the Claude Code hook).
- `src/server/api.ts` — Vite plugin serving `/api/*` in dev and preview.
- `src/dashboard/` — React app (`main.tsx` entry).
- `docs/` — `backlog.md`, `decisions.md`, `plans/`.
- `Dockerfile`, `docker-compose.yml` — the always-on dashboard behind Traefik.

## Conventions

- Two tsconfigs: `tsconfig.json` (DOM: `core` + `dashboard`) and
  `tsconfig.node.json` (Node: `core`, `collector`, `server`, configs), so
  browser code cannot import Node modules. Shared types live in `core/types.ts`.
- `core`, `collector` and `server` use relative imports with `.ts` extensions:
  Node runs the collector without a build step and does not resolve `@/`. The
  dashboard imports with `@/…`.
- Co-locate tests as `<name>.test.ts(x)`. Node-side tests start with
  `// @vitest-environment node`. Vitest globals are off, so Testing Library
  needs an explicit `afterEach(cleanup)`.
- 2-space indent, single quotes, semicolons (enforced by ESLint).
- ESLint (`@antfu/eslint-config`) sorts object and interface keys with `id` and
  `name` first, and imports as one flat list. A comment line starts a new sorting
  partition, so a doc comment on an interface key stays attached only if that key
  sorts first among the keys up to the next comment. Check comments after
  `lint:fix`. Tests must not depend on object key order.
- `import-x/no-unresolved` checks every import, including the `@/` alias.
- Console output and top-level `await` are only allowed in `cli.ts` files.
- Tabs are `#/<id>` hash links (`dashboard/tabs.ts`); a new tab is one entry
  in `TABS` plus its branch in `App.tsx`.
- Theme: `data-theme` on `<html>`. Dark variables exist twice in `styles.css`
  (OS media query and `[data-theme='dark']`): change both. The storage key
  `cca-theme` is also read by the inline script in `index.html`.
- Cards side by side go in `CardGrid`/`Cell` (`dashboard/CardGrid.tsx`, 12
  columns, spans 4/6/12), never a bespoke grid: a row is as tall as its tallest
  cell, so pair cards of similar height or the shorter one leaves a gap.
- Icons: Lucide (`lucide-react`), `aria-hidden` next to their text; never
  text symbols (✓ ! ▲ ⓘ) or emoji.
- Charts: never color alone. Each model family has a fixed color slot and an
  SVG pattern (`dashboard/models.ts`, `Patterns.tsx`).
- Tooltips: never the `title` attribute (slow to appear, absent on touch).
  Use `useTip()` (`dashboard/useTip.ts`; `TipProvider` in `Tip.tsx` owns the
  bubble), which works on hover, focus and tap, for chart value readouts and
  the full text of shortened names. Explain a metric only when its meaning
  isn't obvious, through visible helper text or an `InfoTip` icon; plain
  labels, headers and subtitles get no tooltip.

## Invariants

- **The OAuth token** (`~/.claude/.credentials.json`) is read in memory only,
  sent only to `api.anthropic.com`, never logged, stored or refreshed.
- The usage endpoint needs a `claude-code/<version>` User-Agent; keep the
  throttle (default 15 min) and never add a retry loop: it shares a tight rate
  limit with Claude Code's own `/usage`.
- The installed Claude Code hook runs `src/collector/cli.ts` from this working
  copy, so uncommitted collector changes go live at the next response. Keep
  the collector runnable; it fails silently in the hook (check `lastError` in
  the status).
- The data dir (`~/.claude-code-analytics/`, or `CCA_DATA_DIR`) holds the
  user's history: never wipe it. Tests and manual runs use a temp
  `CCA_DATA_DIR`. Stored messages hold token counts and session metadata
  (`sessionId`, `cwd`, `gitBranch`, …), tool names with call counts and the
  skill or slash command name and the subagent type (from its `.meta.json`,
  never its description), never content or tool inputs; conversation titles are
  kept per session in `sessions.json`; `events.jsonl` keeps rate-limit hits,
  overloads and compactions (times and limit types, never their text). `deleted-readings.jsonl` keeps the manual readings deleted from the
  dashboard: keep it. `backup-format-<n>/` holds the message
  files from before a scan-format re-read: keep it.
- Bump `SCAN_FORMAT` (`collector/store.ts`) only when records gain fields that
  old messages need: the next run re-reads every transcript once. Make the bump
  the last edit, after the tests pass, since the hook runs it on the real data.
  The dashboard runs the collector too: rebuild the container (`docker:up`).
- The API is loopback-only: POST endpoints require `application/json` and a
  same-origin `Origin`; reads rely on Vite's default `allowedHosts`. Never set
  `server.host` or `allowedHosts: true` without adding a Host check. The Docker
  container listens on `0.0.0.0` but publishes no port: from the host, only
  Traefik (bound to `127.0.0.1:80`) reaches it, and `*.localhost` passes the
  default `allowedHosts`. Other containers on the `proxy` network can still
  call it by IP (Vite always allows IP hosts). Never publish a port.
- The container loads `vite.config.ts` with `--configLoader native` (its root
  filesystem is read-only), so the config and everything it imports must run
  under Node's type stripping, like the collector.
- The container serves the image it was built from; it mounts `~/.claude`
  read-only and shares the data dir with the host's hook.
- Keep the `@/*` alias in sync across `tsconfig.json`, `vite.config.ts` and
  `vitest.config.ts`.
- The app name comes from `brand.json`; never hard-code it in `index.html`.
