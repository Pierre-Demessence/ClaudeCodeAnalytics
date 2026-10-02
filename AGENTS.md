# AGENTS.md

Agent operating notes for **Claude Code Analytics**: a local dashboard (Vite +
React + TypeScript strict) estimating Claude Code plan usage from local
transcripts and the plan-limit endpoint. Work in progress:
[docs/plans/usage-analytics.md](docs/plans/usage-analytics.md).

## Commands

- Dashboard: `npm run dashboard` (build + preview) or `npm run dev`
- Collector: `npm run collect` (`-- --force` ignores the endpoint throttle)
- Hook: `npm run hook:install` prints it; `-- --apply` edits `~/.claude/settings.json`
- Build: `npm run build` (type-checks both tsconfigs, then `vite build`)
- Lint: `npm run lint` / `npm run lint:fix`
- Test: `npm test` / `npm run test:watch` / `npm run test:coverage`

Run lint, test and build before considering work done.

## Layout

- `src/core/` — pure logic, no Node or DOM APIs: transcript parsing, pricing,
  aggregation, calibration, forecast, weekly share, plans, `buildSummary`.
- `src/collector/` — Node: transcript scan, usage endpoint client, data-dir
  store, lock, hook installer; entry `cli.ts` (also run by the Claude Code hook).
- `src/server/api.ts` — Vite plugin serving `/api/*` in dev and preview.
- `src/dashboard/` — React app (`main.tsx` entry).
- `docs/` — `backlog.md`, `decisions.md`, `plans/`.

## Conventions

- Two tsconfigs: `tsconfig.json` (DOM: `core` + `dashboard`) and
  `tsconfig.node.json` (Node: `core`, `collector`, `server`, configs), so
  browser code cannot import Node modules. Shared types live in `core/types.ts`.
- `core`, `collector` and `server` use relative imports with `.ts` extensions:
  Node runs the collector without a build step and does not resolve `@/`. The
  dashboard imports with `@/…`.
- Co-locate tests as `<name>.test.ts(x)`. Node-side tests start with
  `// @vitest-environment node`.
- 2-space indent, single quotes, semicolons (enforced by ESLint).
- ESLint (`@antfu/eslint-config`) sorts object and interface keys with `id` and
  `name` first, and imports as one flat list. A comment line starts a new sorting
  partition, so a doc comment on an interface key stays attached only if that key
  sorts first among the keys up to the next comment. Check comments after
  `lint:fix`. Tests must not depend on object key order.
- `import-x/no-unresolved` checks every import, including the `@/` alias.
- Console output and top-level `await` are only allowed in `cli.ts` files.
- Charts: never color alone. Each model family has a fixed color slot and an
  SVG pattern (`dashboard/models.ts`, `Patterns.tsx`); metrics carry `title`
  tooltips.

## Invariants

- **The OAuth token** (`~/.claude/.credentials.json`) is read in memory only,
  sent only to `api.anthropic.com`, never logged, stored or refreshed.
- The usage endpoint needs a `claude-code/<version>` User-Agent; keep the
  throttle (default 15 min) and never add a retry loop: it shares a tight rate
  limit with Claude Code's own `/usage`.
- The data dir (`~/.claude-code-analytics/`, or `CCA_DATA_DIR`) holds the
  user's history: never wipe it. Tests and manual runs use a temp
  `CCA_DATA_DIR`. Stored messages contain token counts only, never content.
- The API is loopback-only: POST endpoints require `application/json` and a
  same-origin `Origin`; reads rely on Vite's default `allowedHosts`. Never set
  `server.host` or `allowedHosts: true` without adding a Host check.
- Keep the `@/*` alias in sync across `tsconfig.json`, `vite.config.ts` and
  `vitest.config.ts`.
- The app name comes from `brand.json`; never hard-code it in `index.html`.
